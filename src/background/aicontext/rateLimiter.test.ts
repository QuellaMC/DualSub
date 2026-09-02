import { describe, expect, it, vi } from 'vitest';
import {
    ContextRateLimiter,
    ContextRateLimitError,
    type RateLimitPolicy,
    type UsageStore,
} from './rateLimiter';

const POLICY: RateLimitPolicy = {
    requestsPerWindow: 3,
    windowMs: 60_000,
    burstLimit: 2,
    burstWindowMs: 10_000,
    mandatoryDelayMs: 1000,
};

function memoryStore(initial: readonly number[] = []) {
    let stored: readonly number[] = initial;
    const store: UsageStore & { failReads: boolean } = {
        failReads: false,
        read: vi.fn(() =>
            store.failReads
                ? Promise.reject(new Error('session storage unavailable'))
                : Promise.resolve(stored)
        ),
        write: vi.fn((timestamps: readonly number[]) => {
            stored = timestamps;
            return Promise.resolve();
        }),
    };
    return {
        store,
        get stored() {
            return stored;
        },
    };
}

function clockAt(start: number) {
    let now = start;
    const sleeps: number[] = [];
    return {
        sleeps,
        advance(ms: number) {
            now += ms;
        },
        clock: {
            now: () => now,
            sleep: (ms: number) => {
                sleeps.push(ms);
                now += ms;
                return Promise.resolve();
            },
        },
    };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    throw new Error('expected rejection');
}

describe('ContextRateLimiter', () => {
    it('records each admission in the store', async () => {
        const { store, stored } = memoryStore();
        void stored;
        const time = clockAt(100_000);
        const limiter = new ContextRateLimiter(store, POLICY, time.clock);
        await limiter.acquire();
        expect(store.write).toHaveBeenCalledWith([100_000]);
    });

    it('rejects a burst before the per-minute window fills', async () => {
        const { store } = memoryStore();
        const time = clockAt(100_000);
        const limiter = new ContextRateLimiter(store, POLICY, time.clock);
        await limiter.acquire();
        time.advance(1000);
        await limiter.acquire();
        time.advance(1000);
        const error = await rejection(limiter.acquire());
        expect(error).toBeInstanceOf(ContextRateLimitError);
        expect((error as ContextRateLimitError).retryAfterMs).toBe(10_000);
        expect(store.write).toHaveBeenCalledTimes(2);
    });

    it('rejects a full window and reports when the oldest request ages out', async () => {
        const { store } = memoryStore([50_000, 70_000, 90_000]);
        const time = clockAt(100_000);
        const limiter = new ContextRateLimiter(
            store,
            { ...POLICY, burstLimit: 10 },
            time.clock
        );
        const error = (await rejection(
            limiter.acquire()
        )) as ContextRateLimitError;
        expect(error.retryAfterMs).toBe(10_000);
        expect(error.message).toContain('10 seconds');
    });

    it('spaces dispatches by the mandatory delay', async () => {
        const { store } = memoryStore();
        const time = clockAt(100_000);
        const limiter = new ContextRateLimiter(
            store,
            { ...POLICY, burstLimit: 10 },
            time.clock
        );
        await limiter.acquire();
        time.advance(400);
        await limiter.acquire();
        expect(time.sleeps).toEqual([600]);
        expect(store.write).toHaveBeenLastCalledWith([100_000, 101_000]);
    });

    it('honors usage persisted by a previous worker lifetime', async () => {
        const { store } = memoryStore([95_000, 99_000]);
        const time = clockAt(100_000);
        const limiter = new ContextRateLimiter(store, POLICY, time.clock);
        const error = await rejection(limiter.acquire());
        expect(error).toBeInstanceOf(ContextRateLimitError);
    });

    it('drops future-dated and expired usage', async () => {
        const { store } = memoryStore([10_000, 500_000]);
        const time = clockAt(100_000);
        const limiter = new ContextRateLimiter(
            store,
            { ...POLICY, burstLimit: 10 },
            time.clock
        );
        await limiter.acquire();
        expect(time.sleeps).toEqual([1000]);
        expect(store.write).toHaveBeenLastCalledWith([100_000, 101_000]);
    });

    it('falls back to worker memory when the store cannot be read', async () => {
        const { store } = memoryStore();
        const time = clockAt(100_000);
        const limiter = new ContextRateLimiter(store, POLICY, time.clock);
        await limiter.acquire();
        store.failReads = true;
        time.advance(1000);
        await limiter.acquire();
        time.advance(1000);
        const error = await rejection(limiter.acquire());
        expect(error).toBeInstanceOf(ContextRateLimitError);
    });

    it('serializes concurrent acquisitions through one queue', async () => {
        const { store } = memoryStore();
        const time = clockAt(100_000);
        const limiter = new ContextRateLimiter(
            store,
            { ...POLICY, burstLimit: 1 },
            time.clock
        );
        const outcomes = await Promise.allSettled([
            limiter.acquire(),
            limiter.acquire(),
        ]);
        expect(outcomes.map((outcome) => outcome.status)).toEqual([
            'fulfilled',
            'rejected',
        ]);
    });
});
