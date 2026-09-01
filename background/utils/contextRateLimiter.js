import { RateLimitError } from '../services/serviceInterfaces.js';

const DEFAULTS = Object.freeze({
    requests: 60,
    window: 60_000,
    mandatoryDelay: 1_000,
    burstLimit: 10,
});
const BURST_WINDOW = 10_000;

function rateLimitError(message, retryAfter, provider) {
    return new RateLimitError(message, { retryAfter, provider });
}

export class ContextRateLimiter {
    constructor(providerId, config = {}) {
        this.providerId = providerId;
        this.config = { ...DEFAULTS, ...config };
        this.requests = [];
        this.lastRequest = 0;
        this.acquisitionQueue = Promise.resolve();
    }

    checkLimit() {
        const acquisition = this.acquisitionQueue.then(() => this._acquire());
        this.acquisitionQueue = acquisition.catch(() => undefined);
        return acquisition;
    }

    async _acquire() {
        const checkedAt = Date.now();
        this._discardExpiredRequests(checkedAt);

        const burstCount = this.requests.filter(
            (timestamp) => timestamp > checkedAt - BURST_WINDOW
        ).length;
        if (burstCount >= this.config.burstLimit) {
            throw rateLimitError(
                'Too many requests in a short time. Please slow down.',
                BURST_WINDOW,
                this.providerId
            );
        }

        if (this.requests.length >= this.config.requests) {
            const retryAfter = this._windowWait(checkedAt);
            throw rateLimitError(
                `Rate limit exceeded. Please wait ${Math.ceil(retryAfter / 1000)} seconds.`,
                retryAfter,
                this.providerId
            );
        }

        const delay = Math.max(
            0,
            this.config.mandatoryDelay - (checkedAt - this.lastRequest)
        );
        if (delay > 0) {
            await new Promise((resolve) => setTimeout(resolve, delay));
        }

        const timestamp = Date.now();
        this._discardExpiredRequests(timestamp);
        this.requests.push(timestamp);
        this.lastRequest = timestamp;
        return true;
    }

    _discardExpiredRequests(now) {
        const windowStart = now - this.config.window;
        this.requests = this.requests.filter(
            (timestamp) => timestamp > windowStart
        );
    }

    _windowWait(now) {
        if (this.requests.length === 0) return 0;
        return Math.max(0, this.requests[0] + this.config.window - now);
    }

    updateConfig(config) {
        this.config = { ...this.config, ...config };
    }
}

export class ContextRateLimiterManager {
    constructor() {
        this.limiters = new Map();
    }

    getLimiter(providerId, config = {}) {
        let limiter = this.limiters.get(providerId);
        if (!limiter) {
            limiter = new ContextRateLimiter(providerId, config);
            this.limiters.set(providerId, limiter);
        } else if (Object.keys(config).length > 0) {
            limiter.updateConfig(config);
        }
        return limiter;
    }

    checkLimit(providerId, config = {}) {
        return this.getLimiter(providerId, config).checkLimit();
    }

    cleanup() {
        this.limiters.clear();
    }
}
