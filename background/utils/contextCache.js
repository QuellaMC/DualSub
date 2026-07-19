/**
 * AI Context Cache Manager
 *
 * Intelligent caching system for AI context analysis results to optimize
 * API usage and improve performance. Implements LRU eviction and TTL.
 *
 * @author DualSub Extension
 * @version 1.0.0
 */

import Logger from '../../utils/logger.js';

const logger = Logger.create('ContextCache');

/**
 * Cache entry structure
 */
class CacheEntry {
    constructor(data, ttl = 3600000) {
        // Default 1 hour TTL
        this.data = data;
        this.timestamp = Date.now();
        this.ttl = ttl;
        this.accessCount = 1;
        this.lastAccessed = Date.now();
    }

    /**
     * Check if cache entry is expired
     * @returns {boolean} True if expired
     */
    isExpired() {
        return Date.now() - this.timestamp > this.ttl;
    }

    /**
     * Update access statistics
     */
    updateAccess() {
        this.accessCount++;
        this.lastAccessed = Date.now();
    }

    /**
     * Get cache entry age in milliseconds
     * @returns {number} Age in milliseconds
     */
    getAge() {
        return Date.now() - this.timestamp;
    }
}

/**
 * Intelligent cache for AI context analysis results
 */
export class ContextCache {
    constructor(options = {}) {
        this.maxSize = options.maxSize || 200;
        this.defaultTTL = options.defaultTTL || 3600000; // 1 hour
        this.cleanupInterval = options.cleanupInterval || 300000; // 5 minutes

        this.cache = new Map();
        this.accessOrder = new Map(); // For LRU tracking

        this.stats = {
            hits: 0,
            misses: 0,
            evictions: 0,
            cleanups: 0,
        };

        this.startCleanupTimer();

        logger.info('Context cache initialized', {
            maxSize: this.maxSize,
            defaultTTL: this.defaultTTL,
            cleanupInterval: this.cleanupInterval,
        });
    }

    /**
     * Generate cache key from context request parameters
     * @param {string} text - Text to analyze
     * @param {string} contextType - Type of context
     * @param {string} provider - Provider ID
     * @param {Object} metadata - Additional metadata
     * @returns {string} Cache key
     */
    generateKey(text, contextType, provider, metadata = {}) {
        const { sourceLanguage = '', targetLanguage = '' } = metadata;

        // Create a normalized key that's consistent but not too long
        const textHash = this.hashString(text);
        return `${provider}:${contextType}:${sourceLanguage}:${targetLanguage}:${textHash}`;
    }

    /**
     * Simple string hash function for cache keys
     * @param {string} str - String to hash
     * @returns {string} Hash string
     */
    hashString(str) {
        // Validate input - handle null, undefined, or non-string values
        if (!str || typeof str !== 'string') {
            this.logger?.warn('Invalid input to hashString', {
                str,
                type: typeof str,
            });
            return '0'; // Return consistent hash for invalid input
        }

        let hash = 0;
        if (str.length === 0) return hash.toString();

        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = (hash << 5) - hash + char;
            hash = hash & hash; // Convert to 32-bit integer
        }

        return Math.abs(hash).toString(36);
    }

    /**
     * Get cached context analysis result
     * @param {string} key - Cache key
     * @returns {Object|null} Cached result or null if not found/expired
     */
    get(key) {
        const entry = this.cache.get(key);

        if (!entry) {
            this.stats.misses++;
            logger.debug('Cache miss', { key });
            return null;
        }

        if (entry.isExpired()) {
            this.cache.delete(key);
            this.accessOrder.delete(key);
            this.stats.misses++;
            logger.debug('Cache entry expired', { key, age: entry.getAge() });
            return null;
        }

        entry.updateAccess();
        this.accessOrder.delete(key);
        this.accessOrder.set(key, Date.now());

        this.stats.hits++;
        logger.debug('Cache hit', {
            key,
            accessCount: entry.accessCount,
            age: entry.getAge(),
        });

        return entry.data;
    }

    /**
     * Store context analysis result in cache
     * @param {string} key - Cache key
     * @param {Object} data - Context analysis result
     * @param {number} ttl - Time to live in milliseconds (optional)
     */
    set(key, data, ttl = null) {
        const entryTTL = ttl || this.defaultTTL;
        const entry = new CacheEntry(data, entryTTL);

        if (this.cache.size >= this.maxSize) {
            this.evictLRU();
        }

        this.cache.set(key, entry);
        this.accessOrder.set(key, Date.now());

        logger.debug('Cache entry stored', {
            key,
            ttl: entryTTL,
            cacheSize: this.cache.size,
        });
    }

    /**
     * Evict least recently used entry
     */
    evictLRU() {
        if (this.accessOrder.size === 0) return;

        // Find the oldest accessed entry
        let oldestKey = null;
        let oldestTime = Date.now();

        for (const [key, accessTime] of this.accessOrder) {
            if (accessTime < oldestTime) {
                oldestTime = accessTime;
                oldestKey = key;
            }
        }

        if (oldestKey) {
            this.cache.delete(oldestKey);
            this.accessOrder.delete(oldestKey);
            this.stats.evictions++;

            logger.debug('LRU eviction', {
                evictedKey: oldestKey,
                cacheSize: this.cache.size,
            });
        }
    }

    /**
     * Clean up expired entries
     */
    cleanup() {
        const beforeSize = this.cache.size;
        const now = Date.now();

        for (const [key, entry] of this.cache) {
            if (entry.isExpired()) {
                this.cache.delete(key);
                this.accessOrder.delete(key);
            }
        }

        const cleaned = beforeSize - this.cache.size;
        if (cleaned > 0) {
            this.stats.cleanups++;
            logger.debug('Cache cleanup completed', {
                entriesRemoved: cleaned,
                cacheSize: this.cache.size,
            });
        }
    }

    /**
     * Start periodic cleanup timer
     */
    startCleanupTimer() {
        this.cleanupTimer = setInterval(() => {
            this.cleanup();
        }, this.cleanupInterval);
    }

    /**
     * Stop cleanup timer
     */
    stopCleanupTimer() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
    }

    /**
     * Clear all cache entries
     */
    clear() {
        const size = this.cache.size;
        this.cache.clear();
        this.accessOrder.clear();

        logger.info('Cache cleared', { entriesRemoved: size });
    }

    /**
     * Get cache statistics
     * @returns {Object} Cache statistics
     */
    getStats() {
        const hitRate =
            this.stats.hits + this.stats.misses > 0
                ? (
                      (this.stats.hits /
                          (this.stats.hits + this.stats.misses)) *
                      100
                  ).toFixed(2)
                : 0;

        return {
            ...this.stats,
            hitRate: `${hitRate}%`,
            size: this.cache.size,
            maxSize: this.maxSize,
        };
    }

    /**
     * Get cache status information
     * @returns {Object} Cache status
     */
    getStatus() {
        return {
            size: this.cache.size,
            maxSize: this.maxSize,
            stats: this.getStats(),
            oldestEntry: this.getOldestEntryAge(),
            newestEntry: this.getNewestEntryAge(),
        };
    }

    /**
     * Get age of oldest cache entry
     * @returns {number|null} Age in milliseconds or null if cache is empty
     */
    getOldestEntryAge() {
        let oldest = null;
        for (const entry of this.cache.values()) {
            const age = entry.getAge();
            if (oldest === null || age > oldest) {
                oldest = age;
            }
        }
        return oldest;
    }

    /**
     * Get age of newest cache entry
     * @returns {number|null} Age in milliseconds or null if cache is empty
     */
    getNewestEntryAge() {
        let newest = null;
        for (const entry of this.cache.values()) {
            const age = entry.getAge();
            if (newest === null || age < newest) {
                newest = age;
            }
        }
        return newest;
    }

    /**
     * Cleanup resources
     */
    destroy() {
        this.stopCleanupTimer();
        this.clear();
        logger.info('Context cache destroyed');
    }
}
