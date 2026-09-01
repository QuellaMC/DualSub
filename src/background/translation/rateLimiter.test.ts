import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RateLimitExhaustedError, RequestPacer } from './rateLimiter';

async function rejection(promise: Promise<unknown>): Promise<unknown> {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    throw new Error('expected rejection');
}

describe('RequestPacer', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('rejects once the byte window is full and reports when it resets', async () => {
        vi.setSystemTime(10_000);
        const pacer = new RequestPacer({
            policy: { kind: 'bytes', limit: 10, windowMs: 1000 },
            minDelayMs: 0,
        });
        await pacer.acquire('12345', 0);
        await pacer.acquire('12345', 0);

        const error = await rejection(pacer.acquire('1', 0));
        expect(error).toBeInstanceOf(RateLimitExhaustedError);
        expect((error as RateLimitExhaustedError).resetAt).toBe(11_000);

        vi.setSystemTime(11_001);
        await expect(pacer.acquire('12345', 0)).resolves.toBeUndefined();
    });

    it('counts multi-byte characters by their UTF-8 size', async () => {
        const pacer = new RequestPacer({
            policy: { kind: 'bytes', limit: 5, windowMs: 1000 },
            minDelayMs: 0,
        });
        await pacer.acquire('日', 0);
        await expect(pacer.acquire('日', 0)).rejects.toBeInstanceOf(
            RateLimitExhaustedError
        );
    });

    it('counts requests for a request window', async () => {
        const pacer = new RequestPacer({
            policy: { kind: 'requests', limit: 2, windowMs: 60_000 },
            minDelayMs: 0,
        });
        await pacer.acquire('a', 0);
        await pacer.acquire('b', 0);
        await expect(pacer.acquire('c', 0)).rejects.toBeInstanceOf(
            RateLimitExhaustedError
        );
    });

    it('never rejects when the provider owns quota', async () => {
        const pacer = new RequestPacer({
            policy: { kind: 'provider' },
            minDelayMs: 0,
        });
        for (let i = 0; i < 50; i += 1) {
            await pacer.acquire('x'.repeat(1000), 0);
        }
    });

    it('spaces dispatches by the larger of the provider and configured delay', async () => {
        vi.setSystemTime(0);
        const pacer = new RequestPacer({
            policy: { kind: 'provider' },
            minDelayMs: 500,
        });
        await pacer.acquire('a', 100);

        let second = false;
        const pending = pacer.acquire('b', 800).then(() => {
            second = true;
        });
        await vi.advanceTimersByTimeAsync(799);
        expect(second).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await pending;
        expect(second).toBe(true);
    });

    it('serializes concurrent acquisitions in order', async () => {
        vi.setSystemTime(0);
        const pacer = new RequestPacer({
            policy: { kind: 'provider' },
            minDelayMs: 100,
        });
        await pacer.acquire('a', 0);
        const order: string[] = [];
        const b = pacer.acquire('b', 0).then(() => order.push('b'));
        const c = pacer.acquire('c', 0).then(() => order.push('c'));

        await vi.advanceTimersByTimeAsync(100);
        expect(order).toEqual(['b']);
        await vi.advanceTimersByTimeAsync(100);
        await Promise.all([b, c]);
        expect(order).toEqual(['b', 'c']);
    });

    it('reserves window capacity before the caller dispatches', async () => {
        const pacer = new RequestPacer({
            policy: { kind: 'requests', limit: 1, windowMs: 60_000 },
            minDelayMs: 0,
        });
        await pacer.acquire('a', 0);
        // The provider response for "a" is still outstanding, yet "b" is
        // already refused: capacity is consumed at admission.
        await expect(pacer.acquire('b', 0)).rejects.toBeInstanceOf(
            RateLimitExhaustedError
        );
    });

    it('bounds pacing to one delay after a clock rollback', async () => {
        vi.setSystemTime(1000);
        const pacer = new RequestPacer({
            policy: { kind: 'provider' },
            minDelayMs: 500,
        });
        await pacer.acquire('a', 0);

        vi.setSystemTime(0);
        let done = false;
        const pending = pacer.acquire('b', 0).then(() => {
            done = true;
        });
        await vi.advanceTimersByTimeAsync(499);
        expect(done).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await pending;
        expect(done).toBe(true);
    });

    it('clamps future-dated usage after a rollback so the window ages out', async () => {
        vi.setSystemTime(5000);
        const pacer = new RequestPacer({
            policy: { kind: 'bytes', limit: 10, windowMs: 1000 },
            minDelayMs: 0,
        });
        await pacer.acquire('1234567890', 0);

        vi.setSystemTime(100);
        const error = await rejection(pacer.acquire('1', 0));
        expect((error as RateLimitExhaustedError).resetAt).toBe(1100);

        vi.setSystemTime(1101);
        await expect(pacer.acquire('1', 0)).resolves.toBeUndefined();
    });
});
