const PLAIN_DATA_SNAPSHOT_DEFAULT_LIMITS = Object.freeze({
    maxDepth: 8,
    maxEntries: 256,
    maxStringBytes: 4096,
    maxTotalBytes: 16384,
});

const FAILED_SNAPSHOT = Object.freeze({ accepted: false });
const BLOCKED_RECORD_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

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
            const next = value.charCodeAt(index + 1);
            if (next >= 0xdc00 && next <= 0xdfff) {
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

function validateLimits(limits) {
    const copy = {
        maxDepth: limits?.maxDepth,
        maxEntries: limits?.maxEntries,
        maxStringBytes: limits?.maxStringBytes,
        maxTotalBytes: limits?.maxTotalBytes,
    };

    if (
        !Number.isSafeInteger(copy.maxDepth) ||
        copy.maxDepth < 0 ||
        !Number.isSafeInteger(copy.maxEntries) ||
        copy.maxEntries <= 0 ||
        !Number.isSafeInteger(copy.maxStringBytes) ||
        copy.maxStringBytes <= 0 ||
        !Number.isSafeInteger(copy.maxTotalBytes) ||
        copy.maxTotalBytes <= 0
    ) {
        throw new TypeError('Invalid plain-data snapshot limits');
    }

    return copy;
}

function addBytes(state, bytes) {
    state.totalBytes += bytes;
    if (state.totalBytes > state.limits.maxTotalBytes) {
        throw new TypeError('Payload exceeds total size limit');
    }
}

function addEntry(state) {
    state.entries += 1;
    if (state.entries > state.limits.maxEntries) {
        throw new TypeError('Payload exceeds entry limit');
    }
}

function cloneString(value, state) {
    const bytes = utf8ByteLength(value);
    if (bytes > state.limits.maxStringBytes) {
        throw new TypeError('Payload string exceeds size limit');
    }
    addBytes(state, bytes);
    return value;
}

function cloneArray(value, depth, state) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
        throw new TypeError('Payload array has an exotic prototype');
    }

    const keys = Object.keys(value);
    if (
        Object.getOwnPropertySymbols(value).length > 0 ||
        keys.length !== value.length ||
        keys.some((key, index) => key !== String(index))
    ) {
        throw new TypeError('Payload array must be dense');
    }

    const clone = [];
    for (const item of value) {
        addEntry(state);
        clone.push(cloneValue(item, depth + 1, state));
    }
    return Object.freeze(clone);
}

function cloneRecord(value, depth, state) {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError('Payload record has an exotic prototype');
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
        throw new TypeError('Payload record contains a symbol key');
    }

    const clone = prototype === null ? Object.create(null) : {};
    for (const [key, item] of Object.entries(value)) {
        if (BLOCKED_RECORD_KEYS.has(key)) {
            throw new TypeError('Payload record contains a blocked key');
        }
        addEntry(state);
        cloneString(key, state);
        clone[key] = cloneValue(item, depth + 1, state);
    }
    return Object.freeze(clone);
}

function cloneValue(value, depth, state) {
    if (value === null) {
        addBytes(state, 1);
        return null;
    }
    if (typeof value === 'boolean') {
        addBytes(state, 1);
        return value;
    }
    if (typeof value === 'string') return cloneString(value, state);
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            throw new TypeError('Payload number must be finite');
        }
        addBytes(state, 8);
        return value;
    }
    if (typeof value !== 'object') {
        throw new TypeError('Payload contains an unsupported value');
    }
    if (depth > state.limits.maxDepth) {
        throw new TypeError('Payload exceeds depth limit');
    }
    if (state.ancestors.has(value)) {
        throw new TypeError('Payload contains a cycle');
    }

    state.ancestors.add(value);
    addBytes(state, 2);
    try {
        return Array.isArray(value)
            ? cloneArray(value, depth, state)
            : cloneRecord(value, depth, state);
    } finally {
        state.ancestors.delete(value);
    }
}

export function createPlainDataSnapshot(
    value,
    limits = PLAIN_DATA_SNAPSHOT_DEFAULT_LIMITS
) {
    try {
        const state = {
            ancestors: new WeakSet(),
            entries: 0,
            limits: validateLimits(limits),
            totalBytes: 0,
        };
        const snapshot = cloneValue(value, 0, state);
        return Object.freeze({ value: snapshot, totalBytes: state.totalBytes });
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
        return Object.freeze({ accepted: true, ...snapshot });
    } catch {
        return FAILED_SNAPSHOT;
    }
}
