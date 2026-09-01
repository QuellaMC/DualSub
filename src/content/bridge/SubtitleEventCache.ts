import type { CapturedEvent } from './protocol';

const MAX_VIDEO_IDS = 8;
const MAX_TOTAL_EVENTS = 100;
const RETENTION_MS = 10 * 60 * 1000;

interface RetainedEntry {
    events: CapturedEvent[];
    storedAt: number;
}

/**
 * Document-scoped replay cache keyed by videoId. Unifies two legacy
 * mechanisms: the "events arrived before the platform was ready" buffer and
 * Netflix's next-episode preload buffer. Events for a videoId with a live
 * subscriber are delivered immediately; otherwise they are retained (LRU
 * across videoIds, bounded, time-limited) and replayed synchronously when a
 * session subscribes. Retention survives delivery so a successor session for
 * the same video can replay without a fresh page parse.
 */
export class SubtitleEventCache {
    private readonly retained = new Map<string, RetainedEntry>();
    private readonly subscribers = new Map<
        string,
        (event: CapturedEvent) => void
    >();
    private readonly now: () => number;

    constructor(now: () => number = () => Date.now()) {
        this.now = now;
    }

    publish(videoId: string, event: CapturedEvent): void {
        this.retain(videoId, event);
        this.subscribers.get(videoId)?.(event);
    }

    /** Replays retained events synchronously, then streams live ones. */
    subscribe(
        videoId: string,
        handler: (event: CapturedEvent) => void,
        signal: AbortSignal
    ): void {
        if (signal.aborted) {
            return;
        }
        this.subscribers.set(videoId, handler);
        signal.addEventListener(
            'abort',
            () => {
                if (this.subscribers.get(videoId) === handler) {
                    this.subscribers.delete(videoId);
                }
            },
            { once: true }
        );

        const entry = this.retained.get(videoId);
        if (!entry) {
            return;
        }
        if (this.now() - entry.storedAt > RETENTION_MS) {
            this.retained.delete(videoId);
            return;
        }
        for (const event of [...entry.events]) {
            if (signal.aborted) {
                return;
            }
            handler(event);
        }
    }

    clear(): void {
        this.retained.clear();
    }

    private retain(videoId: string, event: CapturedEvent): void {
        const existing = this.retained.get(videoId);
        // Re-insert to refresh LRU order.
        this.retained.delete(videoId);
        const entry: RetainedEntry = existing ?? {
            events: [],
            storedAt: this.now(),
        };
        entry.events.push(event);
        entry.storedAt = this.now();
        this.retained.set(videoId, entry);

        while (this.retained.size > MAX_VIDEO_IDS) {
            const oldest = this.retained.keys().next().value;
            if (oldest === undefined) {
                break;
            }
            this.retained.delete(oldest);
        }
        let total = 0;
        for (const retainedEntry of this.retained.values()) {
            total += retainedEntry.events.length;
        }
        while (total > MAX_TOTAL_EVENTS) {
            const oldest = this.retained.keys().next().value;
            if (oldest === undefined) {
                break;
            }
            const oldestEntry = this.retained.get(oldest)!;
            if (oldestEntry.events.length > 1) {
                oldestEntry.events.shift();
            } else {
                this.retained.delete(oldest);
            }
            total -= 1;
        }
    }
}
