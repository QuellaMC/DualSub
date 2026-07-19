/**
 * Runtime service error contracts and the active background service registry.
 *
 * This module intentionally contains only exports consumed by production code.
 */

/**
 * Service Error Types
 *
 * Standard error types for service operations
 */
const translationErrorMetadata = new WeakMap();
const rateLimitErrorMetadata = new WeakMap();

function isObjectLike(value) {
    return (
        value !== null &&
        (typeof value === 'object' || typeof value === 'function')
    );
}

function getOwnDataValue(value, key) {
    if (!isObjectLike(value)) {
        return undefined;
    }
    try {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return descriptor && Object.hasOwn(descriptor, 'value')
            ? descriptor.value
            : undefined;
    } catch (_) {
        return undefined;
    }
}

function snapshotTranslationErrorMetadata(details) {
    return Object.freeze({
        retryable: getOwnDataValue(details, 'isRecoverable') === true,
    });
}

function appendFiniteResetTime(resetTimes, value) {
    const resetTime = getOwnDataValue(value, 'resetTime');
    if (typeof resetTime === 'number' && Number.isFinite(resetTime)) {
        resetTimes.push(resetTime);
    }
}

function snapshotRateLimitErrorMetadata(details) {
    const resetTimes = [];
    const status = getOwnDataValue(details, 'rateLimitStatus');
    if (isObjectLike(status)) {
        appendFiniteResetTime(resetTimes, status);
        for (const windowKey of ['shortWindow', 'longWindow']) {
            const windowStatus = getOwnDataValue(status, windowKey);
            if (isObjectLike(windowStatus)) {
                appendFiniteResetTime(resetTimes, windowStatus);
            }
        }
    }
    return Object.freeze({ resetTimes: Object.freeze(resetTimes) });
}

export class ServiceError extends Error {
    constructor(message, type = 'SERVICE_ERROR', details = {}) {
        super(message);
        this.name = 'ServiceError';
        this.type = type;
        this.details = details;
        this.timestamp = Date.now();
    }
}

export class TranslationError extends ServiceError {
    constructor(message, details = {}) {
        super(message, 'TRANSLATION_ERROR', details);
        this.name = 'TranslationError';
        translationErrorMetadata.set(
            this,
            snapshotTranslationErrorMetadata(details)
        );
    }
}

export class SubtitleProcessingError extends ServiceError {
    constructor(message, details = {}) {
        super(message, 'SUBTITLE_PROCESSING_ERROR', details);
        this.name = 'SubtitleProcessingError';
    }
}

export class RateLimitError extends ServiceError {
    constructor(message, details = {}) {
        super(message, 'RATE_LIMIT_ERROR', details);
        this.name = 'RateLimitError';
        rateLimitErrorMetadata.set(
            this,
            snapshotRateLimitErrorMetadata(details)
        );
    }
}

/**
 * Return a fresh, non-sensitive retry metadata view for a genuine internal
 * translation error. The constructors are the trust boundary: public details
 * remain compatible but cannot mutate these private snapshots later.
 *
 * @param {unknown} error
 * @returns {{retryable: boolean, resetTimes: number[] | null} | null}
 */
export function getTrustedTranslationFailureMetadata(error) {
    if (!isObjectLike(error)) {
        return null;
    }

    const rateLimitSnapshot = rateLimitErrorMetadata.get(error);
    if (rateLimitSnapshot) {
        return Object.freeze({
            retryable: true,
            resetTimes: Object.freeze([...rateLimitSnapshot.resetTimes]),
        });
    }

    const translationSnapshot = translationErrorMetadata.get(error);
    if (translationSnapshot) {
        return Object.freeze({
            retryable: translationSnapshot.retryable,
            resetTimes: null,
        });
    }

    return null;
}
/**
 * Service Registry
 *
 * Central registry for service discovery and dependency injection
 */
export class ServiceRegistry {
    constructor() {
        this.services = new Map();
        this.dependencies = new Map();
    }

    /**
     * Register a service
     * @param {string} name - Service name
     * @param {Object} service - Service instance
     * @param {Array} dependencies - Service dependencies
     */
    register(name, service, dependencies = []) {
        this.services.set(name, service);
        this.dependencies.set(name, dependencies);
    }

    /**
     * Get a service
     * @param {string} name - Service name
     * @returns {Object} Service instance
     */
    get(name) {
        return this.services.get(name);
    }

    /**
     * Check if service is registered
     * @param {string} name - Service name
     * @returns {boolean} True if registered
     */
    has(name) {
        return this.services.has(name);
    }

    /**
     * Get all registered services
     * @returns {Array} Service names
     */
    getServiceNames() {
        return Array.from(this.services.keys());
    }

    /**
     * Validate service dependencies
     * @param {string} name - Service name
     * @returns {boolean} True if all dependencies are satisfied
     */
    validateDependencies(name) {
        const deps = this.dependencies.get(name) || [];
        return deps.every((dep) => this.services.has(dep));
    }
}
/**
 * AI Context Error Classes
 */
export class AIContextError extends Error {
    constructor(message, originalError = null, provider = null) {
        super(message);
        this.name = 'AIContextError';
        this.category = 'ai_context';
        this.severity = 'medium';
        this.originalError = originalError;
        this.provider = provider;
        this.timestamp = Date.now();
    }
}
export class ContextRateLimitError extends AIContextError {
    constructor(message, retryAfter = null, provider = null) {
        super(message, null, provider);
        this.name = 'ContextRateLimitError';
        this.category = 'rate_limit';
        this.retryAfter = retryAfter;
    }
}
// Export singleton registry
export const serviceRegistry = new ServiceRegistry();
