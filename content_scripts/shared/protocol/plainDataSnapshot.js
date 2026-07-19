export const PLAIN_DATA_SNAPSHOT_DEFAULT_LIMITS = Object.freeze({
    maxDepth: 8,
    maxEntries: 256,
    maxStringBytes: 4096,
    maxTotalBytes: 16384,
});

const SNAPSHOT_LIMIT_KEYS = Object.freeze([
    'maxDepth',
    'maxEntries',
    'maxStringBytes',
    'maxTotalBytes',
]);
const FAILED_SNAPSHOT = Object.freeze({ accepted: false });
const DANGEROUS_RECORD_KEYS = new Set([
    '__proto__',
    'prototype',
    'constructor',
]);

// A fully transparent Proxy is observationally indistinguishable from the
// plain object or array it wraps. Trap failures are rejected, but successful
// transparent traps remain a residual of accepting caller-owned plain data.

export function utf8ByteLength(value) {
    let bytes = 0;

    for (let index = 0; index < value.length; index += 1) {
        const codeUnit = value.charCodeAt(index);
        if (codeUnit <= 0x7f) {
            bytes += 1;
        } else if (codeUnit <= 0x7ff) {
            bytes += 2;
        } else if (
            codeUnit >= 0xd800 &&
            codeUnit <= 0xdbff &&
            index + 1 < value.length
        ) {
            const nextCodeUnit = value.charCodeAt(index + 1);
            if (nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff) {
                bytes += 4;
                index += 1;
            } else {
                bytes += 3;
            }
        } else {
            bytes += 3;
        }
    }

    return bytes;
}

function copySnapshotLimits(limits) {
    if (!limits || typeof limits !== 'object' || Array.isArray(limits)) {
        throw new TypeError('Invalid plain-data snapshot limits');
    }

    const prototype = Object.getPrototypeOf(limits);
    if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError('Invalid plain-data snapshot limits');
    }

    const keys = Reflect.ownKeys(limits);
    if (
        keys.length !== SNAPSHOT_LIMIT_KEYS.length ||
        !keys.every(
            (key) =>
                typeof key === 'string' && SNAPSHOT_LIMIT_KEYS.includes(key)
        )
    ) {
        throw new TypeError('Invalid plain-data snapshot limits');
    }

    const copied = Object.create(null);
    for (const key of SNAPSHOT_LIMIT_KEYS) {
        const descriptor = Object.getOwnPropertyDescriptor(limits, key);
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
            throw new TypeError('Invalid plain-data snapshot limits');
        }
        copied[key] = descriptor.value;
    }

    if (
        !Number.isSafeInteger(copied.maxDepth) ||
        copied.maxDepth < 0 ||
        !Number.isSafeInteger(copied.maxEntries) ||
        copied.maxEntries <= 0 ||
        !Number.isSafeInteger(copied.maxStringBytes) ||
        copied.maxStringBytes <= 0 ||
        !Number.isSafeInteger(copied.maxTotalBytes) ||
        copied.maxTotalBytes <= 0
    ) {
        throw new TypeError('Invalid plain-data snapshot limits');
    }

    return copied;
}

function consumeBytes(state, bytes) {
    state.totalBytes += bytes;
    if (state.totalBytes > state.limits.maxTotalBytes) {
        throw new TypeError('Payload exceeds total size limit');
    }
}

function consumeString(state, value) {
    if (value.length > state.limits.maxStringBytes) {
        throw new TypeError('Payload string exceeds size limit');
    }
    const bytes = utf8ByteLength(value);
    if (bytes > state.limits.maxStringBytes) {
        throw new TypeError('Payload string exceeds size limit');
    }
    consumeBytes(state, bytes);
}

function consumeEntry(state) {
    state.entries += 1;
    if (state.entries > state.limits.maxEntries) {
        throw new TypeError('Payload exceeds entry limit');
    }
}

function readOwnDescriptors(value, maximumOwnKeys) {
    const keys = Reflect.ownKeys(value);
    if (keys.length > maximumOwnKeys) {
        throw new TypeError('Payload exceeds entry limit');
    }
    const descriptors = [];

    for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor) {
            throw new TypeError('Payload changed while being inspected');
        }
        descriptors.push([key, descriptor]);
    }

    return descriptors;
}

function cloneArray(value, depth, state) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
        throw new TypeError('Payload array has an exotic prototype');
    }

    const descriptors = readOwnDescriptors(
        value,
        state.limits.maxEntries - state.entries + 1
    );
    const lengthEntry = descriptors.find(([key]) => key === 'length');
    if (!lengthEntry || !Object.hasOwn(lengthEntry[1], 'value')) {
        throw new TypeError('Payload array has an invalid length');
    }

    const length = lengthEntry[1].value;
    if (!Number.isSafeInteger(length) || length < 0) {
        throw new TypeError('Payload array has an invalid length');
    }
    if (descriptors.length !== length + 1) {
        throw new TypeError('Payload array must be dense');
    }

    const entriesByIndex = new Map();
    for (const [key, descriptor] of descriptors) {
        if (key === 'length') continue;
        if (
            typeof key !== 'string' ||
            !/^(0|[1-9]\d*)$/.test(key) ||
            Number(key) >= length ||
            !Object.hasOwn(descriptor, 'value')
        ) {
            throw new TypeError('Payload array contains a non-data entry');
        }
        entriesByIndex.set(Number(key), descriptor);
    }

    const clone = new Array(length);
    for (let index = 0; index < length; index += 1) {
        if (!entriesByIndex.has(index)) {
            throw new TypeError('Payload array must be dense');
        }
        consumeEntry(state);
        Object.defineProperty(clone, index, {
            configurable: true,
            enumerable: entriesByIndex.get(index).enumerable,
            writable: true,
            value: cloneValue(
                entriesByIndex.get(index).value,
                depth + 1,
                state
            ),
        });
    }

    return Object.freeze(clone);
}

function cloneRecord(value, depth, state) {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError('Payload record has an exotic prototype');
    }

    const descriptors = readOwnDescriptors(
        value,
        state.limits.maxEntries - state.entries
    );
    const clone = prototype === null ? Object.create(null) : {};

    for (const [key, descriptor] of descriptors) {
        if (
            typeof key !== 'string' ||
            DANGEROUS_RECORD_KEYS.has(key) ||
            !Object.hasOwn(descriptor, 'value')
        ) {
            throw new TypeError('Payload record contains a non-data entry');
        }

        consumeEntry(state);
        consumeString(state, key);
        Object.defineProperty(clone, key, {
            configurable: true,
            enumerable: descriptor.enumerable,
            writable: true,
            value: cloneValue(descriptor.value, depth + 1, state),
        });
    }

    return Object.freeze(clone);
}

function cloneValue(value, depth, state) {
    if (value === null) {
        consumeBytes(state, 1);
        return null;
    }

    switch (typeof value) {
        case 'boolean':
            consumeBytes(state, 1);
            return value;
        case 'string':
            consumeString(state, value);
            return value;
        case 'number':
            if (!Number.isFinite(value)) {
                throw new TypeError('Payload number must be finite');
            }
            consumeBytes(state, 8);
            return value;
        case 'object':
            break;
        default:
            throw new TypeError('Payload contains an unsupported value');
    }

    if (depth > state.limits.maxDepth) {
        throw new TypeError('Payload exceeds depth limit');
    }
    if (state.ancestors.has(value)) {
        throw new TypeError('Payload contains a cycle');
    }

    state.ancestors.add(value);
    consumeBytes(state, 2);
    try {
        return Array.isArray(value)
            ? cloneArray(value, depth, state)
            : cloneRecord(value, depth, state);
    } finally {
        state.ancestors.delete(value);
    }
}

function createSnapshot(value, limits) {
    const state = {
        ancestors: new WeakSet(),
        entries: 0,
        limits,
        totalBytes: 0,
    };

    const snapshot = cloneValue(value, 0, state);
    return Object.freeze({ value: snapshot, totalBytes: state.totalBytes });
}

export function createPlainDataSnapshot(
    value,
    limits = PLAIN_DATA_SNAPSHOT_DEFAULT_LIMITS
) {
    try {
        const copiedLimits = copySnapshotLimits(limits);
        return createSnapshot(value, copiedLimits);
    } catch {
        throw new TypeError('Invalid plain-data snapshot');
    }
}

export function tryCreatePlainDataSnapshot(
    value,
    limits = PLAIN_DATA_SNAPSHOT_DEFAULT_LIMITS
) {
    try {
        const snapshot = createPlainDataSnapshot(value, limits);
        return Object.freeze({
            accepted: true,
            value: snapshot.value,
            totalBytes: snapshot.totalBytes,
        });
    } catch {
        return FAILED_SNAPSHOT;
    }
}
