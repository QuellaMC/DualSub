// Simple TTL + LRU cache for strings
export default class TTLCache {
    /**
     * @param {number} maxSize
     * @param {number} [ttlMs] - optional TTL in milliseconds
     */
    constructor(maxSize, ttlMs = 0) {
        this.maxSize = Math.max(1, maxSize ?? 1);
        this.ttlMs = ttlMs || 0;
        this.map = new Map(); // key -> { value, expiresAt }
    }

    _isExpired(entry) {
        return (
            this.ttlMs > 0 && entry.expiresAt && Date.now() > entry.expiresAt
        );
    }

    get(key) {
        const entry = this.map.get(key);
        if (!entry) return undefined;
        if (this._isExpired(entry)) {
            this.map.delete(key);
            return undefined;
        }
        // LRU touch
        this.map.delete(key);
        this.map.set(key, entry);
        return entry.value;
    }

    set(key, value) {
        const expiresAt = this.ttlMs > 0 ? Date.now() + this.ttlMs : 0;
        if (this.map.has(key)) {
            this.map.delete(key);
        }
        this.map.set(key, { value, expiresAt });
        // Evict if over capacity
        while (this.map.size > this.maxSize) {
            const oldestKey = this.map.keys().next().value;
            this.map.delete(oldestKey);
        }
    }

    has(key) {
        return this.get(key) !== undefined;
    }

    clear() {
        this.map.clear();
    }
}
