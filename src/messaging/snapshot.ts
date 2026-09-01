// Hardened deep-copy for untrusted cross-context payloads. Runs BEFORE any
// zod schema so validation never touches attacker-controlled objects: own
// data descriptors only, dense arrays, no dangerous keys, no exotic
// prototypes, finite numbers, cycle detection, and byte/entry/depth budgets.
//
// A fully transparent Proxy is observationally indistinguishable from the
// plain object or array it wraps. Trap failures are rejected, but successful
// transparent traps remain a residual of accepting caller-owned plain data.

export interface SnapshotLimits {
    readonly maxDepth: number;
    readonly maxEntries: number;
    readonly maxStringBytes: number;
    readonly maxTotalBytes: number;
}

export const PLAIN_DATA_SNAPSHOT_DEFAULT_LIMITS: SnapshotLimits = Object.freeze(
    {
        maxDepth: 8,
        maxEntries: 256,
        maxStringBytes: 4096,
        maxTotalBytes: 16384,
    }
);

const DANGEROUS_RECORD_KEYS = new Set([
    '__proto__',
    'prototype',
    'constructor',
]);

export function utf8ByteLength(value: string): number {
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

interface SnapshotState {
    readonly ancestors: WeakSet<object>;
    entries: number;
    readonly limits: SnapshotLimits;
    totalBytes: number;
}

function assertValidLimits(limits: SnapshotLimits): void {
    if (
        !Number.isSafeInteger(limits.maxDepth) ||
        limits.maxDepth < 0 ||
        !Number.isSafeInteger(limits.maxEntries) ||
        limits.maxEntries <= 0 ||
        !Number.isSafeInteger(limits.maxStringBytes) ||
        limits.maxStringBytes <= 0 ||
        !Number.isSafeInteger(limits.maxTotalBytes) ||
        limits.maxTotalBytes <= 0
    ) {
        throw new TypeError('Invalid plain-data snapshot limits');
    }
}

function consumeBytes(state: SnapshotState, bytes: number): void {
    state.totalBytes += bytes;
    if (state.totalBytes > state.limits.maxTotalBytes) {
        throw new TypeError('Payload exceeds total size limit');
    }
}

function consumeString(state: SnapshotState, value: string): void {
    if (value.length > state.limits.maxStringBytes) {
        throw new TypeError('Payload string exceeds size limit');
    }
    const bytes = utf8ByteLength(value);
    if (bytes > state.limits.maxStringBytes) {
        throw new TypeError('Payload string exceeds size limit');
    }
    consumeBytes(state, bytes);
}

function consumeEntry(state: SnapshotState): void {
    state.entries += 1;
    if (state.entries > state.limits.maxEntries) {
        throw new TypeError('Payload exceeds entry limit');
    }
}

function readOwnDescriptors(
    value: object,
    maximumOwnKeys: number
): [PropertyKey, PropertyDescriptor][] {
    const keys = Reflect.ownKeys(value);
    if (keys.length > maximumOwnKeys) {
        throw new TypeError('Payload exceeds entry limit');
    }
    const descriptors: [PropertyKey, PropertyDescriptor][] = [];
    for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor) {
            throw new TypeError('Payload changed while being inspected');
        }
        descriptors.push([key, descriptor]);
    }
    return descriptors;
}

function cloneArray(
    value: object,
    depth: number,
    state: SnapshotState
): unknown[] {
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

    const length: unknown = lengthEntry[1].value;
    if (!Number.isSafeInteger(length) || (length as number) < 0) {
        throw new TypeError('Payload array has an invalid length');
    }
    if (descriptors.length !== (length as number) + 1) {
        throw new TypeError('Payload array must be dense');
    }

    const entriesByIndex = new Map<number, PropertyDescriptor>();
    for (const [key, descriptor] of descriptors) {
        if (key === 'length') {
            continue;
        }
        if (
            typeof key !== 'string' ||
            !/^(0|[1-9]\d*)$/.test(key) ||
            Number(key) >= (length as number) ||
            !Object.hasOwn(descriptor, 'value')
        ) {
            throw new TypeError('Payload array contains a non-data entry');
        }
        entriesByIndex.set(Number(key), descriptor);
    }

    const clone = new Array<unknown>(length as number);
    for (let index = 0; index < (length as number); index += 1) {
        const descriptor = entriesByIndex.get(index);
        if (!descriptor) {
            throw new TypeError('Payload array must be dense');
        }
        consumeEntry(state);
        Object.defineProperty(clone, index, {
            configurable: true,
            enumerable: descriptor.enumerable,
            writable: true,
            value: cloneValue(descriptor.value, depth + 1, state),
        });
    }
    return Object.freeze(clone) as unknown[];
}

function cloneRecord(
    value: object,
    depth: number,
    state: SnapshotState
): Record<string, unknown> {
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError('Payload record has an exotic prototype');
    }

    const descriptors = readOwnDescriptors(
        value,
        state.limits.maxEntries - state.entries
    );
    const clone = (prototype === null ? Object.create(null) : {}) as Record<
        string,
        unknown
    >;

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

function cloneValue(
    value: unknown,
    depth: number,
    state: SnapshotState
): unknown {
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

export interface PlainDataSnapshot {
    readonly value: unknown;
    readonly totalBytes: number;
}

/** @throws {TypeError} when the payload violates any hardening rule */
export function createPlainDataSnapshot(
    value: unknown,
    limits: SnapshotLimits = PLAIN_DATA_SNAPSHOT_DEFAULT_LIMITS
): PlainDataSnapshot {
    try {
        assertValidLimits(limits);
        const state: SnapshotState = {
            ancestors: new WeakSet(),
            entries: 0,
            limits,
            totalBytes: 0,
        };
        const snapshot = cloneValue(value, 0, state);
        return Object.freeze({ value: snapshot, totalBytes: state.totalBytes });
    } catch {
        throw new TypeError('Invalid plain-data snapshot');
    }
}

export type SnapshotAttempt =
    | {
          readonly accepted: true;
          readonly value: unknown;
          readonly totalBytes: number;
      }
    | { readonly accepted: false };

const FAILED_SNAPSHOT: SnapshotAttempt = Object.freeze({ accepted: false });

export function tryCreatePlainDataSnapshot(
    value: unknown,
    limits: SnapshotLimits = PLAIN_DATA_SNAPSHOT_DEFAULT_LIMITS
): SnapshotAttempt {
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
