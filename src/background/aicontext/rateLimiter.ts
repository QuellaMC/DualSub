import { browser } from 'wxt/browser';

export interface RateLimitPolicy {
    readonly requestsPerWindow: number;
    readonly windowMs: number;
    readonly burstLimit: number;
    readonly burstWindowMs: number;
    readonly mandatoryDelayMs: number;
}

export const BURST_WINDOW_MS = 10_000;

/** The local usage window cannot admit another request yet. */
export class ContextRateLimitError extends Error {
    override readonly name = 'ContextRateLimitError';
    readonly retryAfterMs: number;

    constructor(message: string, retryAfterMs: number) {
        super(message);
        this.retryAfterMs = retryAfterMs;
    }
}

/** Where dispatch timestamps live between service-worker lifetimes. */
export interface UsageStore {
    readonly read: () => Promise<readonly number[]>;
    readonly write: (timestamps: readonly number[]) => Promise<void>;
}

/**
 * Session storage outlives the worker but not the browser session, so a
 * worker restart cannot forget paid requests made moments ago.
 */
export function sessionUsageStore(key: string): UsageStore {
    return {
        async read() {
            const stored: unknown = (await browser.storage.session.get(key))[
                key
            ];
            return Array.isArray(stored)
                ? stored.filter(
                      (value): value is number =>
                          typeof value === 'number' && Number.isFinite(value)
                  )
                : [];
        },
        async write(timestamps) {
            await browser.storage.session.set({ [key]: timestamps });
        },
    };
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Admission control for one paid provider: a burst guard, a sliding
 * request window, and a minimum spacing between dispatches, acquired
 * through one serialized queue. Timestamps are persisted after every
 * admission and read back before every check, so the guard is honest
 * across worker restarts; a failing store degrades to worker memory.
 */
export class ContextRateLimiter {
    private policy: RateLimitPolicy;
    private memory: readonly number[] = [];
    private tail: Promise<void> = Promise.resolve();

    constructor(
        private readonly store: UsageStore,
        policy: RateLimitPolicy,
        private readonly clock: {
            now: () => number;
            sleep: (ms: number) => Promise<void>;
        } = {
            now: Date.now,
            sleep,
        }
    ) {
        this.policy = policy;
    }

    configure(policy: RateLimitPolicy): void {
        this.policy = policy;
    }

    /** Resolves once a request may be dispatched. Rejects with
     *  ContextRateLimitError when the window is full. */
    acquire(): Promise<void> {
        const turn = this.tail.then(() => this.admit());
        this.tail = turn.catch(() => undefined);
        return turn;
    }

    private async load(): Promise<readonly number[]> {
        try {
            return await this.store.read();
        } catch {
            return this.memory;
        }
    }

    private async admit(): Promise<void> {
        const { policy } = this;
        const now = this.clock.now();
        // A clock rollback would pin future-dated usage forever; clamp it.
        const timestamps = (await this.load())
            .map((at) => Math.min(at, now))
            .filter((at) => at > now - policy.windowMs)
            .sort((a, b) => a - b);

        const burst = timestamps.filter(
            (at) => at > now - policy.burstWindowMs
        ).length;
        if (burst >= policy.burstLimit) {
            throw new ContextRateLimitError(
                'Too many requests in a short time. Please slow down.',
                policy.burstWindowMs
            );
        }
        if (timestamps.length >= policy.requestsPerWindow) {
            const retryAfterMs = Math.max(
                0,
                timestamps[0]! + policy.windowMs - now
            );
            throw new ContextRateLimitError(
                `Rate limit exceeded. Please wait ${Math.ceil(retryAfterMs / 1000)} seconds.`,
                retryAfterMs
            );
        }

        const last = timestamps.at(-1);
        if (last !== undefined) {
            const wait = policy.mandatoryDelayMs - (now - last);
            if (wait > 0) {
                await this.clock.sleep(wait);
            }
        }

        const recorded = [...timestamps, this.clock.now()];
        this.memory = recorded;
        try {
            await this.store.write(recorded);
        } catch {
            // Worker memory still holds the record for this lifetime.
        }
    }
}
