import { describe, expect, it } from 'vitest';
import { TtlCache } from './ttlCache';

describe('TtlCache', () => {
    it('stores and returns values until they expire', () => {
        let now = 0;
        const cache = new TtlCache<string>(10, 100, () => now);
        cache.set('a', 'A');
        expect(cache.get('a')).toBe('A');
        now = 100;
        expect(cache.get('a')).toBe('A');
        now = 101;
        expect(cache.get('a')).toBeUndefined();
        expect(cache.size).toBe(0);
    });

    it('evicts the least recently used entry when over capacity', () => {
        const cache = new TtlCache<string>(2, 1000);
        cache.set('a', 'A');
        cache.set('b', 'B');
        expect(cache.get('a')).toBe('A');
        cache.set('c', 'C');
        expect(cache.get('b')).toBeUndefined();
        expect(cache.get('a')).toBe('A');
        expect(cache.get('c')).toBe('C');
    });

    it('refreshes the expiry when a key is overwritten', () => {
        let now = 0;
        const cache = new TtlCache<string>(10, 100, () => now);
        cache.set('a', 'A');
        now = 90;
        cache.set('a', 'A2');
        now = 150;
        expect(cache.get('a')).toBe('A2');
    });

    it('clears everything', () => {
        const cache = new TtlCache<string>(10, 1000);
        cache.set('a', 'A');
        cache.clear();
        expect(cache.get('a')).toBeUndefined();
        expect(cache.size).toBe(0);
    });

    it('rejects a non-positive size or ttl', () => {
        expect(() => new TtlCache<string>(0, 1000)).toThrow(TypeError);
        expect(() => new TtlCache<string>(1, 0)).toThrow(TypeError);
    });
});
