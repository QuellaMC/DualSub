import { describe, expect, it } from 'vitest';
import {
    PLAIN_DATA_SNAPSHOT_DEFAULT_LIMITS,
    createPlainDataSnapshot,
    tryCreatePlainDataSnapshot,
    utf8ByteLength,
} from './snapshot';

// Mined from the legacy hostile-input matrix: these payload shapes are what
// a compromised page or poisoned context could hand the extension.
describe('tryCreatePlainDataSnapshot', () => {
    it('accepts plain nested data and freezes the clone', () => {
        const result = tryCreatePlainDataSnapshot({
            action: 'translate',
            nested: { list: [1, 'two', true, null] },
        });
        expect(result.accepted).toBe(true);
        if (result.accepted) {
            const value = result.value as Record<string, unknown>;
            expect(Object.isFrozen(value)).toBe(true);
            expect(Object.isFrozen(value.nested)).toBe(true);
            expect(value).toEqual({
                action: 'translate',
                nested: { list: [1, 'two', true, null] },
            });
        }
    });

    it('rejects dangerous record keys', () => {
        const hostile = JSON.parse('{"__proto__": {"polluted": 1}}') as object;
        expect(tryCreatePlainDataSnapshot(hostile).accepted).toBe(false);
        expect(tryCreatePlainDataSnapshot({ constructor: 1 }).accepted).toBe(
            false
        );
        expect(tryCreatePlainDataSnapshot({ prototype: 1 }).accepted).toBe(
            false
        );
    });

    it('rejects exotic prototypes', () => {
        const exotic = Object.create({ inherited: true }) as object;
        expect(tryCreatePlainDataSnapshot(exotic).accepted).toBe(false);
        expect(tryCreatePlainDataSnapshot(new Date()).accepted).toBe(false);
        expect(tryCreatePlainDataSnapshot(new Map()).accepted).toBe(false);
        class Subclassed extends Array {}
        expect(tryCreatePlainDataSnapshot(Subclassed.from([1])).accepted).toBe(
            false
        );
    });

    it('accepts null-prototype records', () => {
        const record = Object.create(null) as Record<string, unknown>;
        record.ok = true;
        expect(tryCreatePlainDataSnapshot(record).accepted).toBe(true);
    });

    it('rejects sparse arrays and symbol keys', () => {
        const sparse = new Array<number>(3);
        sparse[0] = 1;
        sparse[2] = 3;
        expect(tryCreatePlainDataSnapshot(sparse).accepted).toBe(false);
        const withSymbol: Record<PropertyKey, unknown> = { a: 1 };
        withSymbol[Symbol('hidden')] = 'x';
        expect(tryCreatePlainDataSnapshot(withSymbol).accepted).toBe(false);
    });

    it('rejects accessor properties instead of evaluating them twice', () => {
        const trapped = {};
        let reads = 0;
        Object.defineProperty(trapped, 'value', {
            enumerable: true,
            get() {
                reads += 1;
                return 'innocent';
            },
        });
        expect(tryCreatePlainDataSnapshot(trapped).accepted).toBe(false);
        expect(reads).toBe(0);
    });

    it('rejects cycles', () => {
        const node: Record<string, unknown> = {};
        node.self = node;
        expect(tryCreatePlainDataSnapshot(node).accepted).toBe(false);
    });

    it('rejects non-finite numbers and unsupported types', () => {
        expect(tryCreatePlainDataSnapshot({ n: NaN }).accepted).toBe(false);
        expect(tryCreatePlainDataSnapshot({ n: Infinity }).accepted).toBe(
            false
        );
        expect(tryCreatePlainDataSnapshot({ f: () => 1 }).accepted).toBe(false);
        expect(tryCreatePlainDataSnapshot({ b: 10n }).accepted).toBe(false);
        expect(tryCreatePlainDataSnapshot({ u: undefined }).accepted).toBe(
            false
        );
        expect(tryCreatePlainDataSnapshot(Symbol('s')).accepted).toBe(false);
    });

    it('enforces the depth budget', () => {
        let atLimit: unknown = 'leaf';
        for (let i = 0; i < 9; i += 1) {
            atLimit = { next: atLimit };
        }
        expect(tryCreatePlainDataSnapshot(atLimit).accepted).toBe(true);
        expect(tryCreatePlainDataSnapshot({ next: atLimit }).accepted).toBe(
            false
        );
    });

    it('enforces entry, string, and total byte budgets', () => {
        const manyEntries = Object.fromEntries(
            Array.from({ length: 300 }, (_, i) => [`k${i}`, i])
        );
        expect(tryCreatePlainDataSnapshot(manyEntries).accepted).toBe(false);

        expect(
            tryCreatePlainDataSnapshot({ s: 'x'.repeat(5000) }).accepted
        ).toBe(false);

        const bulky = Object.fromEntries(
            Array.from({ length: 8 }, (_, i) => [`k${i}`, 'y'.repeat(4000)])
        );
        expect(tryCreatePlainDataSnapshot(bulky).accepted).toBe(false);

        expect(
            tryCreatePlainDataSnapshot(
                { s: 'tight' },
                {
                    maxDepth: 1,
                    maxEntries: 1,
                    maxStringBytes: 5,
                    maxTotalBytes: 8,
                }
            ).accepted
        ).toBe(true);
    });

    it('counts astral characters by UTF-8 bytes, not code units', () => {
        expect(utf8ByteLength('a')).toBe(1);
        expect(utf8ByteLength('é')).toBe(2);
        expect(utf8ByteLength('中')).toBe(3);
        expect(utf8ByteLength('😀')).toBe(4);
        expect(utf8ByteLength('\ud800')).toBe(3);
        expect(
            tryCreatePlainDataSnapshot(
                { s: '😀😀' },
                {
                    maxDepth: 1,
                    maxEntries: 1,
                    maxStringBytes: 7,
                    maxTotalBytes: 32,
                }
            ).accepted
        ).toBe(false);
    });

    it('createPlainDataSnapshot throws a bare TypeError with no detail leak', () => {
        expect(() => createPlainDataSnapshot({ f: () => 1 })).toThrowError(
            new TypeError('Invalid plain-data snapshot')
        );
    });

    it('rejects malformed limit objects', () => {
        expect(
            tryCreatePlainDataSnapshot(
                { ok: true },
                {
                    maxDepth: -1,
                    maxEntries: 1,
                    maxStringBytes: 1,
                    maxTotalBytes: 1,
                }
            ).accepted
        ).toBe(false);
        expect(PLAIN_DATA_SNAPSHOT_DEFAULT_LIMITS.maxTotalBytes).toBe(16384);
    });
});
