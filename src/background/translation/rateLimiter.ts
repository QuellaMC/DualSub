import { utf8ByteLength } from '@/messaging/snapshot';
import type { ProviderPacing, RateLimitPolicy } from './provider';

interface UsageRecord {
    readonly at: number;
    readonly cost: number;
}

/** The local usage window is full; `resetAt` is when the oldest usage ages out. */
export class RateLimitExhaustedError extends Error {
    override readonly name = 'RateLimitExhaustedError';
    readonly resetAt: number | null;

    constructor(resetAt: number | null) {
        super('Local rate limit exhausted');
        this.resetAt = resetAt;
    }
}

function costOf(policy: RateLimitPolicy, text: string): number {
    switch (policy.kind) {
        case 'bytes':
            return utf8ByteLength(text);
        case 'characters':
            return text.length;
        case 'requests':
            return 1;
        case 'provider':
            return 0;
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Per-provider admission control: a sliding usage window plus a minimum
 * spacing between dispatches, both acquired through one serialized queue so
 * two concurrent requests can never pass the same check. The provider
 * response itself is deliberately outside the slot. Usage is worker-local
 * and best-effort burst protection, never a durable account quota.
 */
export class RequestPacer {
    private history: UsageRecord[] = [];
    private lastDispatchAt: number | null = null;
    private tail: Promise<void> = Promise.resolve();

    constructor(
        private readonly pacing: ProviderPacing,
        private readonly now: () => number = Date.now
    ) {}

    /**
     * Resolves once the request may be dispatched. Rejects with
     * RateLimitExhaustedError when the window cannot admit the text.
     */
    acquire(text: string, configuredDelayMs: number): Promise<void> {
        const turn = this.tail.then(() => this.admit(text, configuredDelayMs));
        this.tail = turn.catch(() => undefined);
        return turn;
    }

    private async admit(
        text: string,
        configuredDelayMs: number
    ): Promise<void> {
        const cost = costOf(this.pacing.policy, text);
        const resetAt = this.windowRejection(cost);
        if (resetAt !== undefined) {
            throw new RateLimitExhaustedError(resetAt);
        }
        await this.space(Math.max(this.pacing.minDelayMs, configuredDelayMs));
        if (this.pacing.policy.kind !== 'provider') {
            this.history.push({ at: this.now(), cost });
        }
    }

    /** undefined when admitted; otherwise the reset time (or null if unknown). */
    private windowRejection(cost: number): number | null | undefined {
        const { policy } = this.pacing;
        if (policy.kind === 'provider') {
            return undefined;
        }
        const now = this.now();
        // A clock rollback would leave future-dated usage pinning the window
        // open forever; clamp it to now so it ages out normally.
        this.history = this.history
            .map((record) =>
                record.at > now ? { at: now, cost: record.cost } : record
            )
            .filter((record) => record.at > now - policy.windowMs);
        const used = this.history.reduce((sum, record) => sum + record.cost, 0);
        if (used + cost <= policy.limit) {
            return undefined;
        }
        const oldest = this.history[0];
        return oldest ? oldest.at + policy.windowMs : null;
    }

    private async space(requiredDelayMs: number): Promise<void> {
        if (this.lastDispatchAt !== null) {
            const elapsed = Math.max(0, this.now() - this.lastDispatchAt);
            const wait = requiredDelayMs - elapsed;
            if (wait > 0) {
                await sleep(wait);
            }
        }
        this.lastDispatchAt = this.now();
    }
}
