import { describe, expect, test } from '@jest/globals';
import {
    createPlainDataSnapshot,
    PLAIN_DATA_SNAPSHOT_DEFAULT_LIMITS,
    tryCreatePlainDataSnapshot,
    utf8ByteLength,
} from './plainDataSnapshot.js';

function createLimits(overrides = {}) {
    return { ...PLAIN_DATA_SNAPSHOT_DEFAULT_LIMITS, ...overrides };
}

function createNestedRecord(depth) {
    let value = 'leaf';
    for (let index = 0; index < depth; index += 1) {
        value = { next: value };
    }
    return value;
}

function expectRejected(value, limits) {
    const createSnapshot = () => createPlainDataSnapshot(value, limits);
    const result = tryCreatePlainDataSnapshot(value, limits);

    expect(createSnapshot).toThrow(TypeError);
    expect(result).toEqual({ accepted: false });
}

describe('plain-data snapshot protocol', () => {
    test('exports the exact frozen default limits', () => {
        expect(PLAIN_DATA_SNAPSHOT_DEFAULT_LIMITS).toEqual({
            maxDepth: 8,
            maxEntries: 256,
            maxStringBytes: 4096,
            maxTotalBytes: 16384,
        });
        expect(Reflect.ownKeys(PLAIN_DATA_SNAPSHOT_DEFAULT_LIMITS)).toEqual([
            'maxDepth',
            'maxEntries',
            'maxStringBytes',
            'maxTotalBytes',
        ]);
        expect(Object.isFrozen(PLAIN_DATA_SNAPSHOT_DEFAULT_LIMITS)).toBe(true);
    });

    test('counts UTF-8 bytes with the existing surrogate semantics', () => {
        expect(utf8ByteLength('plain')).toBe(5);
        expect(utf8ByteLength('é')).toBe(2);
        expect(utf8ByteLength('😀')).toBe(4);
        expect(utf8ByteLength('\ud800')).toBe(3);
    });

    test('returns a fresh deeply frozen plain-data snapshot', () => {
        const source = { nested: ['value'] };

        const snapshot = createPlainDataSnapshot(source);
        const accepted = tryCreatePlainDataSnapshot(source);
        const secondAccepted = tryCreatePlainDataSnapshot(source);

        expect(snapshot).toEqual({
            value: { nested: ['value'] },
            totalBytes: 15,
        });
        expect(Reflect.ownKeys(snapshot)).toEqual(['value', 'totalBytes']);
        expect(snapshot.value).not.toBe(source);
        expect(snapshot.value.nested).not.toBe(source.nested);
        expect(Object.isFrozen(snapshot)).toBe(true);
        expect(Object.isFrozen(snapshot.value)).toBe(true);
        expect(Object.isFrozen(snapshot.value.nested)).toBe(true);

        expect(accepted).toEqual({
            accepted: true,
            value: { nested: ['value'] },
            totalBytes: 15,
        });
        expect(Reflect.ownKeys(accepted)).toEqual([
            'accepted',
            'value',
            'totalBytes',
        ]);
        expect(accepted).not.toBe(secondAccepted);
        expect(accepted.value).not.toBe(snapshot.value);
        expect(accepted.value).not.toBe(secondAccepted.value);
        expect(Object.isFrozen(accepted)).toBe(true);
        expect(Object.isFrozen(accepted.value)).toBe(true);
    });

    test('returns one opaque frozen failure result', () => {
        const first = tryCreatePlainDataSnapshot(undefined);
        const second = tryCreatePlainDataSnapshot(Symbol('unsupported'));

        expect(first).toBe(second);
        expect(first).toEqual({ accepted: false });
        expect(Reflect.ownKeys(first)).toEqual(['accepted']);
        expect(Object.isFrozen(first)).toBe(true);
    });

    test('preserves null prototypes and source enumerability', () => {
        const source = Object.create(null);
        const nested = [{ safe: true }];
        Object.defineProperty(source, 'hidden', {
            configurable: true,
            enumerable: false,
            value: nested,
            writable: true,
        });

        const snapshot = createPlainDataSnapshot(source);
        const descriptor = Object.getOwnPropertyDescriptor(
            snapshot.value,
            'hidden'
        );

        expect(Object.getPrototypeOf(snapshot.value)).toBeNull();
        expect(descriptor.enumerable).toBe(false);
        expect(descriptor.value).not.toBe(nested);
        expect(descriptor.value[0]).not.toBe(nested[0]);
        expect(Object.isFrozen(descriptor.value)).toBe(true);
        expect(Object.isFrozen(descriptor.value[0])).toBe(true);
    });

    test('enforces the current default string and total-byte boundaries', () => {
        const exactString = createPlainDataSnapshot('\u00e9'.repeat(2048));
        const exactTotal = createPlainDataSnapshot([
            'a'.repeat(4096),
            'b'.repeat(4096),
            'c'.repeat(4095),
            'd'.repeat(4095),
        ]);

        expect(exactString.totalBytes).toBe(4096);
        expectRejected(`a${'\u00e9'.repeat(2048)}`);
        expect(exactTotal.totalBytes).toBe(16384);
        expectRejected([
            'a'.repeat(4096),
            'b'.repeat(4096),
            'c'.repeat(4096),
            'd'.repeat(4095),
        ]);
    });

    test('enforces entry and depth limits at N and N plus one', () => {
        const entryBoundary = createPlainDataSnapshot(Array(256).fill(1));
        const depthBoundary = createPlainDataSnapshot(createNestedRecord(9));

        const zeroDepthLimits = createLimits({ maxDepth: 0 });
        const zeroDepthBoundary = createPlainDataSnapshot(
            { leaf: 'value' },
            zeroDepthLimits
        );

        expect(entryBoundary.value).toHaveLength(256);
        expectRejected(Array(257).fill(1));
        expect(depthBoundary.value).toEqual(createNestedRecord(9));
        expectRejected(createNestedRecord(10));
        expect(zeroDepthBoundary.value).toEqual({ leaf: 'value' });
        expectRejected({ nested: {} }, zeroDepthLimits);
    });

    test('supports an explicit 64 KiB string and total-byte profile', () => {
        const limits = createLimits({
            maxStringBytes: 65536,
            maxTotalBytes: 65536,
        });
        const aboveDefault = createPlainDataSnapshot('a'.repeat(16385), limits);
        const exactMaximum = createPlainDataSnapshot('a'.repeat(65536), limits);

        expect(aboveDefault.totalBytes).toBe(16385);
        expect(exactMaximum.totalBytes).toBe(65536);
        expectRejected('a'.repeat(65537), limits);
    });

    test('rejects hostile shapes without invoking executable properties', () => {
        let getterCalls = 0;
        const accessorRecord = {};
        Object.defineProperty(accessorRecord, 'secret', {
            enumerable: true,
            get() {
                getterCalls += 1;
                return 'leaked';
            },
        });
        const symbolRecord = { safe: true };
        symbolRecord[Symbol('hidden')] = 'value';
        const sparseArray = [];
        sparseArray.length = 2;
        sparseArray[1] = 'present';
        const cycle = {};
        cycle.self = cycle;
        const dangerousRecord = Object.create(null);
        Object.defineProperty(dangerousRecord, '__proto__', {
            enumerable: true,
            value: { polluted: true },
        });

        const rejectedValues = [
            undefined,
            () => {},
            1n,
            Symbol('payload'),
            Number.NaN,
            Number.POSITIVE_INFINITY,
            new Date(),
            accessorRecord,
            symbolRecord,
            sparseArray,
            cycle,
            dangerousRecord,
            { constructor: 'blocked' },
            { prototype: 'blocked' },
        ];

        for (const value of rejectedValues) {
            expectRejected(value);
        }
        expect(getterCalls).toBe(0);
    });

    test('rejects payload reflection trap failures as TypeErrors', () => {
        const throwingPrototype = new Proxy(
            {},
            {
                getPrototypeOf() {
                    throw new Error('prototype trap canary');
                },
            }
        );
        const throwingOwnKeys = new Proxy(
            {},
            {
                ownKeys() {
                    throw new Error('ownKeys trap canary');
                },
            }
        );
        const throwingDescriptor = new Proxy(
            { key: 'value' },
            {
                getOwnPropertyDescriptor() {
                    throw new Error('descriptor trap canary');
                },
            }
        );

        for (const value of [
            throwingPrototype,
            throwingOwnKeys,
            throwingDescriptor,
        ]) {
            expectRejected(value);
        }
    });

    test('rejects a cycle before walking the repeated identity again', () => {
        const target = {};
        let prototypeCalls = 0;
        let ownKeysCalls = 0;
        let descriptorCalls = 0;
        const cycle = new Proxy(target, {
            getPrototypeOf(value) {
                prototypeCalls += 1;
                return Reflect.getPrototypeOf(value);
            },
            ownKeys(value) {
                ownKeysCalls += 1;
                return Reflect.ownKeys(value);
            },
            getOwnPropertyDescriptor(value, key) {
                descriptorCalls += 1;
                return Reflect.getOwnPropertyDescriptor(value, key);
            },
        });
        target.self = cycle;

        expect(() => createPlainDataSnapshot(cycle)).toThrow(TypeError);
        expect(prototypeCalls).toBe(1);
        expect(ownKeysCalls).toBe(1);
        expect(descriptorCalls).toBe(1);
    });

    test('captures each payload descriptor once before cloning values', () => {
        const target = { first: 'before', second: 'stable' };
        let ownKeysCalls = 0;
        let descriptorCalls = 0;
        const payload = new Proxy(target, {
            ownKeys() {
                ownKeysCalls += 1;
                return Reflect.ownKeys(target);
            },
            getOwnPropertyDescriptor(_target, key) {
                descriptorCalls += 1;
                const descriptor = Object.getOwnPropertyDescriptor(target, key);
                if (key === 'second') target.first = 'after';
                return descriptor;
            },
        });

        const snapshot = createPlainDataSnapshot(payload);

        expect(snapshot.value).toEqual({ first: 'before', second: 'stable' });
        expect(target.first).toBe('after');
        expect(ownKeysCalls).toBe(1);
        expect(descriptorCalls).toBe(2);
    });

    test('copies valid limits before traversing the payload', () => {
        const limits = createLimits({ maxTotalBytes: 100 });
        let payloadPrototypeCalls = 0;
        const payload = new Proxy(
            { safe: 'value' },
            {
                getPrototypeOf(target) {
                    payloadPrototypeCalls += 1;
                    limits.maxTotalBytes = 1;
                    return Object.getPrototypeOf(target);
                },
            }
        );

        const snapshot = createPlainDataSnapshot(payload, limits);

        expect(snapshot.value).toEqual({ safe: 'value' });
        expect(payloadPrototypeCalls).toBe(1);
        expect(limits.maxTotalBytes).toBe(1);
    });

    test('rejects invalid limit profiles before touching the payload', () => {
        let limitGetterCalls = 0;
        const accessorLimits = createLimits();
        Object.defineProperty(accessorLimits, 'maxDepth', {
            enumerable: true,
            get() {
                limitGetterCalls += 1;
                return 8;
            },
        });
        const symbolLimits = createLimits();
        symbolLimits[Symbol('extra')] = true;
        const invalidLimits = [
            null,
            [],
            { maxDepth: 8 },
            { ...createLimits(), extra: true },
            symbolLimits,
            Object.assign(Object.create({}), createLimits()),
            accessorLimits,
            createLimits({ maxDepth: -1 }),
            createLimits({ maxDepth: 1.5 }),
            createLimits({ maxDepth: Number.MAX_SAFE_INTEGER + 1 }),
            createLimits({ maxEntries: 0 }),
            createLimits({ maxStringBytes: 0 }),
            createLimits({ maxTotalBytes: 0 }),
        ];
        let payloadTrapCalls = 0;
        const payload = new Proxy(
            {},
            {
                getPrototypeOf() {
                    payloadTrapCalls += 1;
                    throw new Error('payload prototype trap canary');
                },
                ownKeys() {
                    payloadTrapCalls += 1;
                    throw new Error('payload ownKeys trap canary');
                },
                getOwnPropertyDescriptor() {
                    payloadTrapCalls += 1;
                    throw new Error('payload descriptor trap canary');
                },
            }
        );

        for (const limits of invalidLimits) {
            expectRejected(payload, limits);
        }
        expect(limitGetterCalls).toBe(0);
        expect(payloadTrapCalls).toBe(0);
    });
});
