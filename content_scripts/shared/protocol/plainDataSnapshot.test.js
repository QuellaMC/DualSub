import { describe, expect, test } from '@jest/globals';
import {
    createPlainDataSnapshot,
    tryCreatePlainDataSnapshot,
    utf8ByteLength,
} from './plainDataSnapshot.js';

const DEFAULT_LIMITS = Object.freeze({
    maxDepth: 8,
    maxEntries: 256,
    maxStringBytes: 4096,
    maxTotalBytes: 16384,
});

const limits = (overrides = {}) => ({
    ...DEFAULT_LIMITS,
    ...overrides,
});

describe('plain-data snapshots', () => {
    test('counts UTF-8 bytes', () => {
        expect(utf8ByteLength('plain')).toBe(5);
        expect(utf8ByteLength('é')).toBe(2);
        expect(utf8ByteLength('😀')).toBe(4);
    });

    test('returns a detached, deeply frozen snapshot', () => {
        const source = { nested: ['value'], enabled: true };
        const snapshot = createPlainDataSnapshot(source);

        expect(snapshot.value).toEqual(source);
        expect(snapshot.value).not.toBe(source);
        expect(snapshot.value.nested).not.toBe(source.nested);
        expect(Object.isFrozen(snapshot)).toBe(true);
        expect(Object.isFrozen(snapshot.value)).toBe(true);
        expect(Object.isFrozen(snapshot.value.nested)).toBe(true);
    });

    test('preserves null-prototype records', () => {
        const source = Object.assign(Object.create(null), {
            safe: { value: 1 },
        });
        const snapshot = createPlainDataSnapshot(source);

        expect(Object.getPrototypeOf(snapshot.value)).toBeNull();
        expect(snapshot.value).toEqual(source);
        expect(snapshot.value.safe).not.toBe(source.safe);
    });

    test.each([
        undefined,
        () => {},
        1n,
        Symbol('payload'),
        Number.NaN,
        Number.POSITIVE_INFINITY,
        new Date(),
    ])('rejects unsupported value %#', (value) => {
        expect(() => createPlainDataSnapshot(value)).toThrow(TypeError);
        expect(tryCreatePlainDataSnapshot(value)).toEqual({ accepted: false });
    });

    test('rejects cycles, sparse arrays, symbol keys, and blocked keys', () => {
        const cycle = {};
        cycle.self = cycle;
        const sparse = [];
        sparse.length = 2;
        sparse[1] = 'present';
        const symbolRecord = { safe: true };
        symbolRecord[Symbol('hidden')] = true;
        const blocked = Object.create(null);
        Object.defineProperty(blocked, '__proto__', {
            enumerable: true,
            value: { polluted: true },
        });

        for (const value of [cycle, sparse, symbolRecord, blocked]) {
            expect(() => createPlainDataSnapshot(value)).toThrow(TypeError);
        }
    });

    test('enforces string and total byte limits', () => {
        const small = limits({ maxStringBytes: 4, maxTotalBytes: 8 });

        expect(createPlainDataSnapshot('éé', small).totalBytes).toBe(4);
        expect(() => createPlainDataSnapshot('ééé', small)).toThrow(TypeError);
        expect(() => createPlainDataSnapshot(['aaaa', 'bbbb'], small)).toThrow(
            TypeError
        );
    });

    test('enforces entry and depth limits', () => {
        expect(
            createPlainDataSnapshot([1, 2], limits({ maxEntries: 2 })).value
        ).toEqual([1, 2]);
        expect(() =>
            createPlainDataSnapshot([1, 2, 3], limits({ maxEntries: 2 }))
        ).toThrow(TypeError);

        expect(
            createPlainDataSnapshot({ leaf: true }, limits({ maxDepth: 0 }))
                .value
        ).toEqual({ leaf: true });
        expect(() =>
            createPlainDataSnapshot(
                { nested: { leaf: true } },
                limits({ maxDepth: 0 })
            )
        ).toThrow(TypeError);
    });

    test('uses an opaque failure result for the non-throwing API', () => {
        const first = tryCreatePlainDataSnapshot(undefined);
        const second = tryCreatePlainDataSnapshot(Symbol('unsupported'));

        expect(first).toBe(second);
        expect(first).toEqual({ accepted: false });
        expect(Object.isFrozen(first)).toBe(true);
    });
});
