/**
 * Shared Utility Integration Helper
 *
 * Centralizes imports and provides optimized access to shared utilities
 * from content_scripts/shared. Ensures consistent integration patterns
 * and eliminates duplicate imports.
 *
 * @author DualSub Extension
 * @version 2.0.0
 */

// ServiceWorker-compatible utility implementations
// Note: Cannot import content script utilities due to ServiceWorker restrictions

import { loggingManager } from './loggingManager.js';

/**
 * ServiceWorker-Compatible VTT Parser
 * Simplified version of content script parseVTT for ServiceWorker context
 */
function parseVTTServiceWorker(vttString) {
    const lines = vttString.split('\n');
    const cues = [];
    let i = 0;

    // Skip WEBVTT header and metadata
    while (i < lines.length && !lines[i].includes('-->')) {
        i++;
    }

    // Parse cues
    while (i < lines.length) {
        const line = lines[i].trim();

        if (line.includes('-->')) {
            const [startTime, endTime] = line.split('-->').map((t) => t.trim());
            const start = parseTimestampToSecondsServiceWorker(startTime);
            const end = parseTimestampToSecondsServiceWorker(endTime);

            // Get cue text (next non-empty lines)
            const textLines = [];
            i++;
            while (i < lines.length && lines[i].trim() !== '') {
                textLines.push(lines[i].trim());
                i++;
            }

            if (textLines.length > 0) {
                cues.push({
                    start,
                    end,
                    text: textLines.join(' '),
                });
            }
        }
        i++;
    }

    return cues;
}

/**
 * ServiceWorker-Compatible Timestamp Parser
 */
function parseTimestampToSecondsServiceWorker(timestamp) {
    const parts = timestamp.split(':');
    if (parts.length === 3) {
        const hours = parseInt(parts[0], 10);
        const minutes = parseInt(parts[1], 10);
        const secondsParts = parts[2].split('.');
        const seconds = parseInt(secondsParts[0], 10);
        const milliseconds = secondsParts[1]
            ? parseInt(secondsParts[1].padEnd(3, '0'), 10)
            : 0;

        return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
    }
    return 0;
}

/**
 * ServiceWorker-Compatible Text Formatter
 */
function formatSubtitleTextServiceWorker(text) {
    if (!text) return '';

    // Basic HTML tag removal and text cleanup
    return text
        .replace(/<[^>]*>/g, '') // Remove HTML tags
        .replace(/&nbsp;/g, ' ') // Replace non-breaking spaces
        .replace(/&amp;/g, '&') // Replace HTML entities
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .trim();
}

/**
 * Shared Utility Integration Manager
 *
 * Provides ServiceWorker-compatible utility functions with caching,
 * performance monitoring, and consistent error handling.
 */
class SharedUtilityIntegration {
    constructor() {
        this.logger = loggingManager.createLogger('SharedUtilityIntegration');
        this.cache = new Map();
        this.performanceMetrics = {
            parseVTTCalls: 0,
            parseVTTTime: 0,
            timestampParseCalls: 0,
            timestampParseTime: 0,
            cacheHits: 0,
            cacheMisses: 0,
        };
    }

    /**
     * Parse VTT content with caching and performance monitoring
     * @param {string} vttString - VTT content
     * @param {Object} options - Parsing options
     * @returns {Array} Array of parsed cues
     */
    parseVTT(vttString, options = {}) {
        const startTime = Date.now();

        // Check cache if enabled
        if (options.enableCache !== false) {
            const cacheKey = this.generateCacheKey('parseVTT', vttString);
            if (this.cache.has(cacheKey)) {
                this.performanceMetrics.cacheHits++;
                this.logger.debug('VTT parse cache hit', { cacheKey });
                return this.cache.get(cacheKey);
            }
            this.performanceMetrics.cacheMisses++;
        }

        try {
            const result = parseVTTServiceWorker(vttString);

            // Cache result if enabled
            if (options.enableCache !== false && result.length > 0) {
                const cacheKey = this.generateCacheKey('parseVTT', vttString);
                this.cache.set(cacheKey, result);
            }

            // Update performance metrics
            const processingTime = Date.now() - startTime;
            this.performanceMetrics.parseVTTCalls++;
            this.performanceMetrics.parseVTTTime += processingTime;

            this.logger.debug('VTT parsing completed', {
                cueCount: result.length,
                processingTime,
                cached: false,
            });

            return result;
        } catch (error) {
            this.logger.error('VTT parsing failed', error, {
                contentLength: vttString.length,
                contentPreview: vttString.substring(0, 100),
            });
            throw error;
        }
    }

    /**
     * Parse timestamp with caching and performance monitoring
     * @param {string} timestamp - Timestamp string
     * @param {Object} options - Parsing options
     * @returns {number} Timestamp in seconds
     */
    parseTimestampToSeconds(timestamp, options = {}) {
        const startTime = Date.now();

        // Check cache if enabled
        if (options.enableCache !== false) {
            const cacheKey = this.generateCacheKey('timestamp', timestamp);
            if (this.cache.has(cacheKey)) {
                this.performanceMetrics.cacheHits++;
                return this.cache.get(cacheKey);
            }
            this.performanceMetrics.cacheMisses++;
        }

        try {
            const result = parseTimestampToSecondsServiceWorker(timestamp);

            // Cache result if enabled
            if (options.enableCache !== false) {
                const cacheKey = this.generateCacheKey('timestamp', timestamp);
                this.cache.set(cacheKey, result);
            }

            // Update performance metrics
            const processingTime = Date.now() - startTime;
            this.performanceMetrics.timestampParseCalls++;
            this.performanceMetrics.timestampParseTime += processingTime;

            return result;
        } catch (error) {
            this.logger.error('Timestamp parsing failed', error, { timestamp });
            throw error;
        }
    }

    /**
     * Format subtitle text for display
     * @param {string} text - Raw subtitle text
     * @param {Object} options - Formatting options
     * @returns {string} Formatted text
     */
    formatSubtitleText(text, options = {}) {
        try {
            return formatSubtitleTextServiceWorker(text);
        } catch (error) {
            this.logger.error('Text formatting failed', error, {
                text: text.substring(0, 50),
            });
            return text; // Fallback to original text
        }
    }

    /**
     * Note: DOM-related utilities (SubtitleProcessingManager, VideoElementDetector,
     * DOMManipulator, PlayerReadyDetector) are not available in ServiceWorker context.
     * These should be used directly in content scripts where DOM access is available.
     */

    /**
     * Generate cache key for caching
     * @param {string} type - Operation type
     * @param {string} content - Content to hash
     * @returns {string} Cache key
     */
    generateCacheKey(type, content) {
        // Simple hash function for cache keys
        let hash = 0;
        const str = `${type}:${content}`;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = (hash << 5) - hash + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return `${type}_${hash.toString(36)}`;
    }

    /**
     * Get performance metrics
     * @returns {Object} Performance metrics
     */
    getPerformanceMetrics() {
        return {
            ...this.performanceMetrics,
            averageParseVTTTime:
                this.performanceMetrics.parseVTTCalls > 0
                    ? this.performanceMetrics.parseVTTTime /
                      this.performanceMetrics.parseVTTCalls
                    : 0,
            averageTimestampParseTime:
                this.performanceMetrics.timestampParseCalls > 0
                    ? this.performanceMetrics.timestampParseTime /
                      this.performanceMetrics.timestampParseCalls
                    : 0,
            cacheHitRate:
                this.performanceMetrics.cacheHits +
                    this.performanceMetrics.cacheMisses >
                0
                    ? (this.performanceMetrics.cacheHits /
                          (this.performanceMetrics.cacheHits +
                              this.performanceMetrics.cacheMisses)) *
                      100
                    : 0,
            cacheSize: this.cache.size,
        };
    }

    /**
     * Clear cache
     */
    clearCache() {
        this.cache.clear();
        this.logger.debug('Shared utility cache cleared');
    }

    /**
     * Get cache statistics
     * @returns {Object} Cache statistics
     */
    getCacheStats() {
        return {
            size: this.cache.size,
            hits: this.performanceMetrics.cacheHits,
            misses: this.performanceMetrics.cacheMisses,
            hitRate:
                this.performanceMetrics.cacheHits +
                    this.performanceMetrics.cacheMisses >
                0
                    ? (this.performanceMetrics.cacheHits /
                          (this.performanceMetrics.cacheHits +
                              this.performanceMetrics.cacheMisses)) *
                      100
                    : 0,
        };
    }
}

// Export singleton instance
export const sharedUtilityIntegration = new SharedUtilityIntegration();

// Export ServiceWorker-compatible utilities for direct access when needed
export {
    parseVTTServiceWorker as parseVTT,
    parseTimestampToSecondsServiceWorker as parseTimestampToSeconds,
    formatSubtitleTextServiceWorker as formatSubtitleTextForDisplay,
};
