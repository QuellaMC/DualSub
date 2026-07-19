/**
 * AI Context Rate Limiter
 *
 * Implements intelligent rate limiting for AI context providers to prevent
 * API quota exhaustion and ensure fair usage across different request types.
 *
 * @author DualSub Extension
 * @version 1.0.0
 */

import Logger from '../../utils/logger.js';
import { ContextRateLimitError } from '../services/serviceInterfaces.js';

const logger = Logger.create('ContextRateLimiter');

/**
 * Rate limiter for AI context providers
 */
export class ContextRateLimiter {
    constructor(providerId, config = {}) {
        this.providerId = providerId;
        this.config = {
            type: config.type || 'requests_per_minute',
            requests: config.requests || 60,
            window: config.window || 60000, // 1 minute
            mandatoryDelay: config.mandatoryDelay || 1000, // 1 second
            burstLimit: config.burstLimit || 10,
            ...config,
        };

        this.requests = [];
        this.lastRequest = 0;
        this.burstCount = 0;
        this.burstWindow = 10000; // 10 seconds for burst detection

        logger.info('Rate limiter initialized', {
            providerId: this.providerId,
            config: this.config,
        });
    }

    /**
     * Check if a request is allowed under current rate limits
     * @param {string} contextType - Type of context request
     * @returns {Promise<boolean>} True if request is allowed
     */
    async checkLimit(contextType = 'default') {
        const now = Date.now();

        try {
            this.cleanOldRequests(now);

            if (this.isBurstLimited(now)) {
                logger.warn('Burst limit exceeded', {
                    providerId: this.providerId,
                    burstCount: this.burstCount,
                    burstLimit: this.config.burstLimit,
                });
                throw new ContextRateLimitError(
                    'Too many requests in a short time. Please slow down.',
                    this.burstWindow,
                    this.providerId
                );
            }

            if (this.isRateLimited(now)) {
                const waitTime = this.getWaitTime(now);
                logger.warn('Rate limit exceeded', {
                    providerId: this.providerId,
                    requestCount: this.requests.length,
                    limit: this.config.requests,
                    waitTime,
                });
                throw new ContextRateLimitError(
                    `Rate limit exceeded. Please wait ${Math.ceil(waitTime / 1000)} seconds.`,
                    waitTime,
                    this.providerId
                );
            }

            // Check mandatory delay
            const delayNeeded = this.getMandatoryDelay(now);
            if (delayNeeded > 0) {
                logger.debug('Applying mandatory delay', {
                    providerId: this.providerId,
                    delay: delayNeeded,
                });
                await this.wait(delayNeeded);
            }

            this.recordRequest(now, contextType);

            return true;
        } catch (error) {
            if (error instanceof ContextRateLimitError) {
                throw error;
            }

            logger.error('Rate limit check failed', error, {
                providerId: this.providerId,
                contextType,
            });
            throw new ContextRateLimitError(
                'Rate limit check failed',
                1000,
                this.providerId
            );
        }
    }

    /**
     * Clean requests outside the current window
     * @param {number} now - Current timestamp
     */
    cleanOldRequests(now) {
        const windowStart = now - this.config.window;
        this.requests = this.requests.filter(
            (req) => req.timestamp > windowStart
        );
    }

    /**
     * Check if burst limit is exceeded
     * @param {number} now - Current timestamp
     * @returns {boolean} True if burst limited
     */
    isBurstLimited(now) {
        const burstWindowStart = now - this.burstWindow;
        this.burstCount = this.requests.filter(
            (req) => req.timestamp > burstWindowStart
        ).length;

        return this.burstCount >= this.config.burstLimit;
    }

    /**
     * Check if main rate limit is exceeded
     * @param {number} now - Current timestamp
     * @returns {boolean} True if rate limited
     */
    isRateLimited(now) {
        return this.requests.length >= this.config.requests;
    }

    /**
     * Get time to wait before next request is allowed
     * @param {number} now - Current timestamp
     * @returns {number} Wait time in milliseconds
     */
    getWaitTime(now) {
        if (this.requests.length === 0) return 0;

        const oldestRequest = Math.min(
            ...this.requests.map((req) => req.timestamp)
        );
        const windowEnd = oldestRequest + this.config.window;

        return Math.max(0, windowEnd - now);
    }

    /**
     * Get mandatory delay needed before next request
     * @param {number} now - Current timestamp
     * @returns {number} Delay in milliseconds
     */
    getMandatoryDelay(now) {
        const timeSinceLastRequest = now - this.lastRequest;
        return Math.max(0, this.config.mandatoryDelay - timeSinceLastRequest);
    }

    /**
     * Record a new request
     * @param {number} now - Current timestamp
     * @param {string} contextType - Type of context request
     */
    recordRequest(now, contextType) {
        this.requests.push({
            timestamp: now,
            contextType,
        });
        this.lastRequest = now;

        logger.debug('Request recorded', {
            providerId: this.providerId,
            contextType,
            requestCount: this.requests.length,
            limit: this.config.requests,
        });
    }

    /**
     * Wait for specified time
     * @param {number} ms - Milliseconds to wait
     * @returns {Promise<void>}
     */
    wait(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /**
     * Get current rate limit status
     * @returns {Object} Rate limit status
     */
    getStatus() {
        const now = Date.now();
        this.cleanOldRequests(now);

        const usage = this.requests.length / this.config.requests;
        const burstUsage = this.burstCount / this.config.burstLimit;

        return {
            providerId: this.providerId,
            requests: this.requests.length,
            limit: this.config.requests,
            usage: `${(usage * 100).toFixed(1)}%`,
            burstCount: this.burstCount,
            burstLimit: this.config.burstLimit,
            burstUsage: `${(burstUsage * 100).toFixed(1)}%`,
            nextRequestAllowed: this.getNextRequestTime(now),
            windowResetTime: this.getWindowResetTime(now),
        };
    }

    /**
     * Get time when next request will be allowed
     * @param {number} now - Current timestamp
     * @returns {number} Timestamp when next request is allowed
     */
    getNextRequestTime(now) {
        const mandatoryDelay = this.getMandatoryDelay(now);
        const rateLimitWait = this.isRateLimited(now)
            ? this.getWaitTime(now)
            : 0;

        return now + Math.max(mandatoryDelay, rateLimitWait);
    }

    /**
     * Get time when rate limit window resets
     * @param {number} now - Current timestamp
     * @returns {number} Timestamp when window resets
     */
    getWindowResetTime(now) {
        if (this.requests.length === 0) return now;

        const oldestRequest = Math.min(
            ...this.requests.map((req) => req.timestamp)
        );
        return oldestRequest + this.config.window;
    }

    /**
     * Reset rate limiter state
     */
    reset() {
        this.requests = [];
        this.lastRequest = 0;
        this.burstCount = 0;

        logger.info('Rate limiter reset', {
            providerId: this.providerId,
        });
    }

    /**
     * Update rate limiter configuration
     * @param {Object} newConfig - New configuration
     */
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };

        logger.info('Rate limiter configuration updated', {
            providerId: this.providerId,
            config: this.config,
        });
    }
}

/**
 * Rate limiter manager for multiple providers
 */
export class ContextRateLimiterManager {
    constructor() {
        this.limiters = new Map();
        logger.info('Rate limiter manager initialized');
    }

    /**
     * Get or create rate limiter for provider
     * @param {string} providerId - Provider ID
     * @param {Object} config - Rate limiter configuration
     * @returns {ContextRateLimiter} Rate limiter instance
     */
    getLimiter(providerId, config = {}) {
        if (!this.limiters.has(providerId)) {
            this.limiters.set(
                providerId,
                new ContextRateLimiter(providerId, config)
            );
        }
        return this.limiters.get(providerId);
    }

    /**
     * Check rate limit for provider
     * @param {string} providerId - Provider ID
     * @param {string} contextType - Context type
     * @param {Object} config - Rate limiter configuration
     * @returns {Promise<boolean>} True if request is allowed
     */
    async checkLimit(providerId, contextType, config = {}) {
        const limiter = this.getLimiter(providerId, config);
        return await limiter.checkLimit(contextType);
    }

    /**
     * Get status for all rate limiters
     * @returns {Object} Status for all providers
     */
    getAllStatus() {
        const status = {};
        for (const [providerId, limiter] of this.limiters) {
            status[providerId] = limiter.getStatus();
        }
        return status;
    }

    /**
     * Reset all rate limiters
     */
    resetAll() {
        for (const limiter of this.limiters.values()) {
            limiter.reset();
        }
        logger.info('All rate limiters reset');
    }

    /**
     * Cleanup resources
     */
    cleanup() {
        this.limiters.clear();
        logger.info('Rate limiter manager cleaned up');
    }
}
