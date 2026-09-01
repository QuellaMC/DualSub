interface CacheEntry<V> {
    readonly value: V;
    readonly expiresAt: number;
}

/** Bounded least-recently-used map whose entries expire after a fixed TTL. */
export class TtlCache<V> {
    private readonly entries = new Map<string, CacheEntry<V>>();

    constructor(
        private readonly maxSize: number,
        private readonly ttlMs: number,
        private readonly now: () => number = Date.now
    ) {
        if (!Number.isSafeInteger(maxSize) || maxSize < 1) {
            throw new TypeError('maxSize must be a positive safe integer.');
        }
        if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
            throw new TypeError('ttlMs must be a positive number.');
        }
    }

    get(key: string): V | undefined {
        const entry = this.entries.get(key);
        if (!entry) {
            return undefined;
        }
        if (this.now() > entry.expiresAt) {
            this.entries.delete(key);
            return undefined;
        }
        this.entries.delete(key);
        this.entries.set(key, entry);
        return entry.value;
    }

    set(key: string, value: V): void {
        this.entries.delete(key);
        this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
        while (this.entries.size > this.maxSize) {
            const oldest = this.entries.keys().next();
            if (oldest.done) {
                break;
            }
            this.entries.delete(oldest.value);
        }
    }

    clear(): void {
        this.entries.clear();
    }

    get size(): number {
        return this.entries.size;
    }
}
