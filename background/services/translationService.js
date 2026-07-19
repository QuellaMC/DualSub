/**
 * Translation Service
 *
 * Manages translation providers and coordinates translation requests.
 * Includes caching and rate limiting.
 *
 * @author DualSub Extension
 * @version 2.0.0
 */

// @ts-check

import { translate as googleTranslate } from '../../translation_providers/googleTranslate.js';
import { translate as microsoftTranslateEdgeAuth } from '../../translation_providers/microsoftTranslateEdgeAuth.js';
import { translate as deeplTranslate } from '../../translation_providers/deeplTranslate.js';
import { translate as openaiCompatibleTranslate } from '../../translation_providers/openaiCompatibleTranslate.js';
import { configService } from '../../services/configService.js';
import { loggingManager } from '../utils/loggingManager.js';
import {
    errorHandler,
    TranslationError,
    RateLimitError,
} from '../utils/errorHandler.js';
import { performanceMonitor } from '../utils/performanceMonitor.js';
import {
    Providers,
    ProviderNames,
} from '../../content_scripts/shared/constants/providers.js';
import { translate as vertexGeminiTranslate } from '../../translation_providers/geminiVertexTranslate.js';
import TTLCache from '../../utils/cache/TTLCache.js';
import { getDefaultValue, validateSetting } from '../../config/configSchema.js';

const TRANSLATION_CACHE_CONFIGURATION_KEYS = new Set([
    'deeplApiKey',
    'deeplApiPlan',
    'openaiCompatibleApiKey',
    'openaiCompatibleBaseUrl',
    'openaiCompatibleModel',
    'vertexAccessToken',
    'vertexProjectId',
    'vertexLocation',
    'vertexModel',
]);

function getBucketResetTime(entries, window, getTimestamp) {
    let oldestTimestamp = null;
    for (const entry of entries) {
        const timestamp = getTimestamp(entry);
        if (
            Number.isFinite(timestamp) &&
            (oldestTimestamp === null || timestamp < oldestTimestamp)
        ) {
            oldestTimestamp = timestamp;
        }
    }

    if (oldestTimestamp === null || !Number.isFinite(window)) return null;
    const resetTime = oldestTimestamp + window;
    return Number.isFinite(resetTime) ? resetTime : null;
}

function isFiniteUsageRecord(record, usageKey) {
    return (
        Number.isFinite(record?.timestamp) &&
        Number.isFinite(record?.[usageKey])
    );
}

function clampFutureTimestamp(timestamp, now) {
    return Math.min(timestamp, now);
}

function normalizeFutureUsageRecord(record, now) {
    const timestamp = clampFutureTimestamp(record.timestamp, now);
    return timestamp === record.timestamp ? record : { ...record, timestamp };
}

class TranslationConfigurationChangedError extends TranslationError {
    constructor() {
        super('Translation configuration changed during request', {
            errorCode: 'CONFIGURATION_CHANGED',
            isRecoverable: true,
        });
        this.name = 'TranslationConfigurationChangedError';
    }
}

/**
 * @typedef {Object} TranslationResult
 * @property {string} translatedText
 * @property {string} originalText
 * @property {string} sourceLanguage
 * @property {string} targetLanguage
 * @property {boolean} cached
 * @property {number} processingTime
 */

class TranslationService {
    constructor() {
        this.logger = null;
        this.currentProviderId = Providers.MICROSOFT_EDGE_AUTH;
        this.providers = {
            [Providers.GOOGLE]: {
                name: ProviderNames[Providers.GOOGLE],
                translate: googleTranslate,
                rateLimit: {
                    type: 'bytes_per_window',
                    bytes: 4500,
                    window: 6500, // 6.5 seconds
                    mandatoryDelay: 1500, // 1.5 seconds between requests
                },
                category: 'free',
            },
            [Providers.MICROSOFT_EDGE_AUTH]: {
                name: ProviderNames[Providers.MICROSOFT_EDGE_AUTH],
                translate: microsoftTranslateEdgeAuth,
                rateLimit: {
                    // Best-effort burst protection for this worker instance,
                    // not a durable Microsoft account-quota counter.
                    type: 'characters_per_window',
                    scope: 'worker_instance',
                    characters: 33300,
                    window: 60000, // 1 minute
                    mandatoryDelay: 800, // 800ms between requests
                },
                category: 'free',
            },
            [Providers.DEEPL]: {
                name: ProviderNames[Providers.DEEPL],
                translate: deeplTranslate,
                rateLimit: {
                    // DeepL owns quota truth; this worker reacts to provider
                    // responses and only applies local request pacing.
                    type: 'provider_response',
                    mandatoryDelay: 500, // 500ms between requests
                },
                category: 'api_key',
            },
            [Providers.OPENAI_COMPATIBLE]: {
                name: ProviderNames[Providers.OPENAI_COMPATIBLE],
                translate: openaiCompatibleTranslate,
                rateLimit: {
                    type: 'requests_per_minute',
                    requests: 3500,
                    window: 60000, // 1 minute
                    mandatoryDelay: 100, // 100ms between requests
                },
                category: 'api_key',
            },
            [Providers.VERTEX_GEMINI]: {
                name: ProviderNames[Providers.VERTEX_GEMINI],
                translate: vertexGeminiTranslate,
                rateLimit: {
                    type: 'requests_per_minute',
                    requests: 3000,
                    window: 60000,
                    mandatoryDelay: 100,
                },
                category: 'api_key',
            },
        };
        this.isInitialized = false;
        this.cacheMaxSize = 1000; // Maximum cache entries
        this.translationCache = new TTLCache(this.cacheMaxSize, 5 * 60 * 1000); // 5 minutes TTL
        this.cacheGeneration = 0;
        this.configuredRequestDelay = getDefaultValue('translationDelay');
        this.characterTracker = new Map(); // For character/byte-based rate limiting
        this.rateLimitTracker = new Map(); // For request-per-window rate limiting
        this.lastRequestTime = new Map(); // For mandatory delays
        this.providerRequestSlotQueues = new Map(); // Serializes rate-limit slot acquisition per provider
        this.performanceMetrics = {
            // Counts every translate request, including cache hits and failures.
            totalTranslations: 0,
            // Counts successful non-cached translation operations used by averageResponseTime.
            successfulTranslations: 0,
            cacheHits: 0,
            averageResponseTime: 0,
            errors: 0,
            rateLimitHits: 0,
        };
    }

    /**
     * Initialize translation service
     */
    async initialize() {
        if (this.isInitialized) {
            return;
        }

        this.logger = loggingManager.createLogger('TranslationService');

        // Initialize provider from configuration service
        try {
            const providerId = await configService.get('selectedProvider');
            if (providerId && this.providers[providerId]) {
                this.currentProviderId = providerId;
                this.logger.info('Using translation provider', { providerId });
            } else {
                this.logger.info('Provider not found, using default', {
                    requestedProvider: providerId,
                    defaultProvider: this.currentProviderId,
                });
                if (providerId) {
                    await configService.set(
                        'selectedProvider',
                        this.currentProviderId
                    );
                }
            }
        } catch (error) {
            this.logger.error(
                'Error loading translation provider setting',
                error
            );
        }

        const defaultRequestDelay = getDefaultValue('translationDelay');
        this.configuredRequestDelay = defaultRequestDelay;
        try {
            const configuredRequestDelay =
                await configService.get('translationDelay');
            if (validateSetting('translationDelay', configuredRequestDelay)) {
                this.configuredRequestDelay = configuredRequestDelay;
            }
        } catch (error) {
            this.configuredRequestDelay = defaultRequestDelay;
            this.logger.error('Error loading translation delay setting', error);
        }

        // Listen for provider changes
        // Credential values are observed only so their rotation can invalidate
        // cached results; handleConfigurationChanges logs key names, not values.
        configService.onChanged(
            (changes) => this.handleConfigurationChanges(changes),
            { includeSensitive: true }
        );

        // Validate all providers
        await this.validateProviders();

        this.isInitialized = true;
        this.logger.info('Translation service initialized', {
            currentProvider: this.currentProviderId,
            totalProviders: Object.keys(this.providers).length,
        });
    }

    /**
     * Apply translation-related configuration changes.
     * Provider configuration values are never placed in cache keys; changing a
     * non-secret value that can affect a response invalidates the cache instead.
     * @param {Object} changes - Changed configuration keys and their new values
     */
    handleConfigurationChanges(changes) {
        try {
            const delayDescriptor = Object.getOwnPropertyDescriptor(
                changes,
                'translationDelay'
            );
            if (delayDescriptor && Object.hasOwn(delayDescriptor, 'value')) {
                if (delayDescriptor.value === undefined) {
                    this.configuredRequestDelay =
                        getDefaultValue('translationDelay');
                } else if (
                    validateSetting('translationDelay', delayDescriptor.value)
                ) {
                    this.configuredRequestDelay = delayDescriptor.value;
                }
            }
        } catch {
            // Ignore malformed change records and retain the last valid delay.
        }

        if (
            changes.selectedProvider &&
            this.providers[changes.selectedProvider]
        ) {
            this.currentProviderId = changes.selectedProvider;
            this.logger.info('Translation provider changed', {
                selectedProvider: changes.selectedProvider,
            });
        }

        const changedKeys = Object.keys(changes);
        if (
            changedKeys.some((key) =>
                TRANSLATION_CACHE_CONFIGURATION_KEYS.has(key)
            )
        ) {
            this.clearCache();
            this.logger.info(
                'Translation cache invalidated after provider configuration change',
                {
                    changedKeys: changedKeys.filter((key) =>
                        TRANSLATION_CACHE_CONFIGURATION_KEYS.has(key)
                    ),
                }
            );
        }
    }

    /**
     * Validate all translation providers
     */
    async validateProviders() {
        const validationResults = {};

        for (const [providerId, provider] of Object.entries(this.providers)) {
            try {
                // Basic validation - check if translate function exists
                if (typeof provider.translate !== 'function') {
                    throw new Error('Provider missing translate function');
                }

                validationResults[providerId] = { valid: true };
                this.logger.debug('Provider validation passed', { providerId });
            } catch (error) {
                validationResults[providerId] = {
                    valid: false,
                    error: error.message,
                };
                this.logger.warn('Provider validation failed', error, {
                    providerId,
                });
            }
        }

        this.logger.info('Provider validation completed', {
            results: validationResults,
            validProviders: Object.values(validationResults).filter(
                (r) => r.valid
            ).length,
        });
    }

    /**
     * Translate text using current provider with caching and rate limiting
     * @param {string} text - Text to translate
     * @param {string} sourceLang - Source language code
     * @param {string} targetLang - Target language code
     * @param {Object} options - Translation options
     * @returns {Promise<string>} Translated text
     */
    async translate(text, sourceLang, targetLang, options = {}) {
        const optionSource =
            options &&
            (typeof options === 'object' || typeof options === 'function')
                ? options
                : {};
        const retryCountOption = optionSource.retryCount;
        const skipCache = optionSource.skipCache === true;
        const skipRateLimit = optionSource.skipRateLimit === true;
        const allowRetry = optionSource.allowRetry !== false;
        const onCacheHit = optionSource._onCacheHit;
        const startTime = Date.now();
        const providerId = this.currentProviderId;
        const selectedProvider = this.providers[providerId];
        const expectedCacheGeneration = this.cacheGeneration;
        let retryCount =
            Number.isInteger(retryCountOption) && retryCountOption >= 0
                ? Math.min(retryCountOption, 2)
                : 0;
        this.performanceMetrics.totalTranslations++;
        const timerId = performanceMonitor.startTiming('translation');

        try {
            const cacheKey = this.generateCacheKey(
                text,
                sourceLang,
                targetLang,
                providerId
            );
            while (true) {
                try {
                    this.assertCacheGeneration(expectedCacheGeneration);
                    if (!skipCache) {
                        const cachedResult = this.getCacheItem(cacheKey);
                        if (typeof cachedResult === 'string') {
                            this.assertCacheGeneration(expectedCacheGeneration);
                            this.performanceMetrics.cacheHits++;
                            if (typeof onCacheHit === 'function') {
                                onCacheHit();
                            }
                            this.assertCacheGeneration(expectedCacheGeneration);
                            this.logger.debug('Translation cache hit', {
                                provider: providerId,
                                sourceLang,
                                targetLang,
                            });
                            return cachedResult;
                        }
                    }

                    if (!selectedProvider?.translate) {
                        this.logger.error(
                            'Invalid translation provider',
                            null,
                            { providerId }
                        );
                        throw new Error(
                            `Provider "${providerId}" is not configured.`
                        );
                    }

                    // Atomically check, space, and record each provider attempt.
                    // The network response is deliberately outside the slot.
                    await this.acquireProviderRequestSlot(text, {
                        providerId,
                        skipRateLimit,
                    });
                    this.assertCacheGeneration(expectedCacheGeneration);

                    const translatedText = await selectedProvider.translate(
                        text,
                        sourceLang,
                        targetLang
                    );
                    if (typeof translatedText !== 'string') {
                        throw new Error(
                            'Translation provider returned an invalid result'
                        );
                    }
                    this.setCacheItemForGeneration(
                        cacheKey,
                        translatedText,
                        expectedCacheGeneration
                    );

                    const responseTime = Date.now() - startTime;
                    this.logger.debug('Translation completed', {
                        provider: providerId,
                        textLength: text.length,
                        translatedLength: translatedText.length,
                        responseTime,
                        retryCount,
                        cached: false,
                    });
                    this.updatePerformanceMetrics(responseTime, true);
                    return translatedText;
                } catch (error) {
                    if (error instanceof TranslationConfigurationChangedError) {
                        throw error;
                    }
                    if (this.cacheGeneration !== expectedCacheGeneration) {
                        throw new TranslationConfigurationChangedError();
                    }
                    const errorInfo = errorHandler.handleError(error, {
                        operation: 'translate',
                        provider: providerId,
                        textLength: text.length,
                        sourceLang,
                        targetLang,
                        hasUserImpact: true,
                        retryCount,
                    });

                    const translationError =
                        error instanceof RateLimitError
                            ? error
                            : new TranslationError(errorInfo.userMessage, {
                                  originalError: error.message,
                                  provider: providerId,
                                  errorCode: errorInfo.errorCode,
                                  isRecoverable: errorInfo.isRecoverable,
                              });

                    if (
                        !errorInfo.recovery.shouldRetry ||
                        !allowRetry ||
                        retryCount >= 2
                    ) {
                        throw translationError;
                    }

                    retryCount++;
                    this.logger.info('Attempting translation retry', {
                        retryCount,
                        retryDelay: errorInfo.recovery.retryDelay,
                    });
                    await new Promise((resolve) =>
                        setTimeout(resolve, errorInfo.recovery.retryDelay)
                    );
                }
            }
        } catch (error) {
            this.updatePerformanceMetrics(Date.now() - startTime, false);
            throw error;
        } finally {
            performanceMonitor.endTiming(timerId);
        }
    }

    /**
     * Generate cache key for translation
     * @param {string} text - Text to translate
     * @param {string} sourceLang - Source language
     * @param {string} targetLang - Target language
     * @returns {string} Cache key
     */
    generateCacheKey(
        text,
        sourceLang,
        targetLang,
        providerId = this.currentProviderId
    ) {
        return JSON.stringify([providerId, sourceLang, targetLang, text]);
    }

    /**
     * Add item to cache with LRU eviction policy
     * @param {string} key - Cache key
     * @param {string} value - Cache value
     */
    setCacheItem(key, value) {
        this.translationCache.set(key, value);
    }

    /**
     * Fail a request whose captured configuration has been invalidated.
     * @param {number} expectedCacheGeneration
     */
    assertCacheGeneration(expectedCacheGeneration) {
        if (this.cacheGeneration !== expectedCacheGeneration) {
            throw new TranslationConfigurationChangedError();
        }
    }

    /**
     * Commit only while the request's captured configuration is current.
     * @param {string} key
     * @param {string} value
     * @param {number} expectedCacheGeneration
     */
    setCacheItemForGeneration(key, value, expectedCacheGeneration) {
        this.assertCacheGeneration(expectedCacheGeneration);
        this.setCacheItem(key, value);
        if (this.cacheGeneration !== expectedCacheGeneration) {
            // A synchronous cache hook may invalidate while setCacheItem runs.
            // Remove that stale write without incrementing the generation again.
            this.translationCache.clear();
            throw new TranslationConfigurationChangedError();
        }
    }

    /**
     * Get item from cache and update access order
     * @param {string} key - Cache key
     * @returns {string|undefined} Cache value
     */
    getCacheItem(key) {
        return this.translationCache.get(key);
    }

    /**
     * Acquire one dispatch slot for a provider. Only rate-limit inspection,
     * mandatory spacing, and tracker reservation are serialized; callers
     * release the slot before awaiting the provider response.
     * @param {string} text - Text represented by the provider request
     * @param {{providerId?: string, skipRateLimit?: boolean}} options
     * @returns {Promise<void>}
     */
    async acquireProviderRequestSlot(
        text = '',
        { providerId = this.currentProviderId, skipRateLimit = false } = {}
    ) {
        const previousSlot =
            this.providerRequestSlotQueues.get(providerId) || Promise.resolve();
        let releaseSlot;
        const currentSlot = new Promise((resolve) => {
            releaseSlot = resolve;
        });
        this.providerRequestSlotQueues.set(providerId, currentSlot);

        await previousSlot;

        try {
            if (!skipRateLimit && !this.checkRateLimit(text, providerId)) {
                this.performanceMetrics.rateLimitHits++;
                throw new RateLimitError(
                    'Rate limit exceeded for current provider',
                    {
                        provider: providerId,
                        rateLimitStatus: this.getRateLimitStatus(providerId),
                    }
                );
            }

            await this.applyMandatoryDelay(providerId);
            this.updateRateLimitTracker(text, providerId);
        } finally {
            releaseSlot();
            if (
                this.providerRequestSlotQueues.get(providerId) === currentSlot
            ) {
                this.providerRequestSlotQueues.delete(providerId);
            }
        }
    }

    /**
     * Check if current provider is within rate limits
     * @param {string} text - Text to be translated (for character/byte counting)
     * @param {string} providerId - Provider to inspect
     * @returns {boolean} True if within limits
     */
    checkRateLimit(text = '', providerId = this.currentProviderId) {
        const provider = this.providers[providerId];
        if (!provider.rateLimit) return true;

        const rateLimit = provider.rateLimit;
        const now = Date.now();

        switch (rateLimit.type) {
            case 'bytes_per_window':
                return this.checkBytesPerWindow(
                    text,
                    rateLimit,
                    now,
                    providerId
                );

            case 'characters_per_window':
                return this.checkCharactersPerWindow(
                    text,
                    rateLimit,
                    now,
                    providerId
                );

            case 'provider_response':
                return true;

            case 'requests_per_minute':
                return this.checkRequestsPerWindow(rateLimit, now, providerId);

            default:
                return true;
        }
    }

    /**
     * Check bytes per window rate limit (Google Translate)
     * @param {string} text - Text to translate
     * @param {Object} rateLimit - Rate limit configuration
     * @param {number} now - Current timestamp
     * @param {string} providerId - Provider to inspect
     * @returns {boolean} True if within limits
     */
    checkBytesPerWindow(
        text,
        rateLimit,
        now,
        providerId = this.currentProviderId
    ) {
        const windowStart = now - rateLimit.window;

        if (!this.characterTracker.has(providerId)) {
            this.characterTracker.set(providerId, []);
        }

        const requests = this.characterTracker.get(providerId);

        // Remove old requests outside the window
        const recentRequests = requests
            .filter((request) => Number.isFinite(request?.timestamp))
            .map((request) => normalizeFutureUsageRecord(request, now))
            .filter((request) => request.timestamp > windowStart);
        this.characterTracker.set(providerId, recentRequests);

        // Calculate total bytes in current window
        const totalBytes = recentRequests.reduce(
            (sum, req) => sum + req.bytes,
            0
        );
        const textBytes = new TextEncoder().encode(text).length;

        return totalBytes + textBytes <= rateLimit.bytes;
    }

    /**
     * Check worker-local characters per window (Microsoft Translate)
     * @param {string} text - Text to translate
     * @param {Object} rateLimit - Rate limit configuration
     * @param {number} now - Current timestamp
     * @param {string} providerId - Provider to inspect
     * @returns {boolean} True if within the worker-local guard
     */
    checkCharactersPerWindow(
        text,
        rateLimit,
        now,
        providerId = this.currentProviderId
    ) {
        const windowStart = now - rateLimit.window;

        if (!this.characterTracker.has(providerId)) {
            this.characterTracker.set(providerId, []);
        }

        const requests = this.characterTracker.get(providerId);
        const recentRequests = requests
            .filter(
                (request) =>
                    isFiniteUsageRecord(request, 'characters') &&
                    request.characters >= 0
            )
            .map((request) => normalizeFutureUsageRecord(request, now))
            .filter((request) => request.timestamp > windowStart);
        this.characterTracker.set(providerId, recentRequests);

        const totalCharacters = recentRequests.reduce((sum, request) => {
            const nextTotal = sum + request.characters;
            return Number.isFinite(nextTotal) ? nextTotal : Number.MAX_VALUE;
        }, 0);

        return totalCharacters + text.length <= rateLimit.characters;
    }

    /**
     * Check requests per window rate limit
     * @param {Object} rateLimit - Rate limit configuration
     * @param {number} now - Current timestamp
     * @param {string} providerId - Provider to inspect
     * @returns {boolean} True if within limits
     */
    checkRequestsPerWindow(
        rateLimit,
        now,
        providerId = this.currentProviderId
    ) {
        const windowStart = now - rateLimit.window;

        if (!this.rateLimitTracker.has(providerId)) {
            this.rateLimitTracker.set(providerId, []);
        }

        const requests = this.rateLimitTracker.get(providerId);

        // Remove old requests outside the window
        const recentRequests = requests
            .filter((timestamp) => Number.isFinite(timestamp))
            .map((timestamp) => clampFutureTimestamp(timestamp, now))
            .filter((timestamp) => timestamp > windowStart);
        this.rateLimitTracker.set(providerId, recentRequests);

        return recentRequests.length < rateLimit.requests;
    }

    /**
     * Apply mandatory delay before translation
     * @param {string} providerId - Provider to space
     * @returns {Promise<void>}
     */
    async applyMandatoryDelay(providerId = this.currentProviderId) {
        const provider = this.providers[providerId];
        const providerRequestDelay =
            Number.isFinite(provider?.rateLimit?.mandatoryDelay) &&
            provider.rateLimit.mandatoryDelay >= 0
                ? provider.rateLimit.mandatoryDelay
                : 0;
        const configuredRequestDelay = validateSetting(
            'translationDelay',
            this.configuredRequestDelay
        )
            ? this.configuredRequestDelay
            : getDefaultValue('translationDelay');
        const requiredDelay = Math.max(
            providerRequestDelay,
            configuredRequestDelay
        );

        const now = Date.now();
        const lastRequest = this.lastRequestTime.get(providerId);
        if (!Number.isFinite(lastRequest)) {
            this.lastRequestTime.set(providerId, now);
            return;
        }
        const timeSinceLastRequest = Math.max(0, now - lastRequest);

        if (timeSinceLastRequest < requiredDelay) {
            const delayNeeded = requiredDelay - timeSinceLastRequest;
            this.logger.debug('Applying mandatory delay', {
                provider: providerId,
                delayNeeded,
                requiredDelay,
                timeSinceLastRequest,
            });
            await new Promise((resolve) => setTimeout(resolve, delayNeeded));
        }

        this.lastRequestTime.set(providerId, Date.now());
    }

    /**
     * Update rate limit tracker
     * @param {string} text - Text that was translated
     * @param {string} providerId - Provider whose request was dispatched
     */
    updateRateLimitTracker(text = '', providerId = this.currentProviderId) {
        const now = Date.now();
        const provider = this.providers[providerId];

        if (!provider.rateLimit) return;

        const rateLimit = provider.rateLimit;
        if (rateLimit.type === 'requests_per_minute') {
            if (!this.rateLimitTracker) this.rateLimitTracker = new Map();
            if (!this.rateLimitTracker.has(providerId)) {
                this.rateLimitTracker.set(providerId, []);
            }
            this.rateLimitTracker.get(providerId).push(now);
        }

        if (
            rateLimit.type === 'bytes_per_window' ||
            rateLimit.type === 'characters_per_window'
        ) {
            if (!this.characterTracker.has(providerId)) {
                this.characterTracker.set(providerId, []);
            }

            const entry = {
                timestamp: now,
                characters: text.length,
                bytes: new TextEncoder().encode(text).length,
            };

            this.characterTracker.get(providerId).push(entry);
        }
    }

    /**
     * Get current provider information
     * @returns {Object} Provider information
     */
    getCurrentProvider() {
        return {
            id: this.currentProviderId,
            ...this.providers[this.currentProviderId],
        };
    }

    /**
     * Get all available providers
     * @returns {Object} All providers
     */
    getAvailableProviders() {
        return { ...this.providers };
    }

    /**
     * Update performance metrics
     * @param {number} responseTime - Response time in milliseconds
     * @param {boolean} success - Whether translation was successful
     */
    updatePerformanceMetrics(responseTime, success) {
        if (success) {
            // Cached responses never reach this method. Keep the average over
            // successful provider-backed operations only; errors and cache
            // hits remain represented in their own counters.
            const successfulTranslations =
                this.performanceMetrics.successfulTranslations || 0;
            const currentAvg = this.performanceMetrics.averageResponseTime;
            const nextSuccessfulTranslations = successfulTranslations + 1;
            this.performanceMetrics.averageResponseTime =
                (currentAvg * successfulTranslations + responseTime) /
                nextSuccessfulTranslations;
            this.performanceMetrics.successfulTranslations =
                nextSuccessfulTranslations;
        } else {
            this.performanceMetrics.errors++;
        }
    }

    /**
     * Get translation performance metrics
     * totalTranslations is the number of caller-visible requests, including
     * cache hits and failures. averageResponseTime covers successful,
     * provider-backed operations only.
     * @returns {Object} Performance metrics
     */
    getPerformanceMetrics() {
        return {
            ...this.performanceMetrics,
            errorRate:
                this.performanceMetrics.totalTranslations > 0
                    ? (this.performanceMetrics.errors /
                          this.performanceMetrics.totalTranslations) *
                      100
                    : 0,
            cacheHitRate:
                this.performanceMetrics.totalTranslations > 0
                    ? (this.performanceMetrics.cacheHits /
                          this.performanceMetrics.totalTranslations) *
                      100
                    : 0,
        };
    }

    /**
     * Clear translation cache
     */
    clearCache() {
        this.cacheGeneration++;
        this.translationCache.clear();
        this.logger.debug('Translation cache cleared');
    }

    /**
     * Get providers by category
     * @param {string} category - Provider category ('free', 'api_key')
     * @returns {Object} Filtered providers
     */
    getProvidersByCategory(category) {
        const filtered = {};
        for (const [id, provider] of Object.entries(this.providers)) {
            if (provider.category === category) {
                filtered[id] = provider;
            }
        }
        return filtered;
    }

    /**
     * Get rate limit status for current provider
     * @returns {Object} Rate limit status
     */
    getRateLimitStatus(providerId = this.currentProviderId) {
        const provider = this.providers[providerId];
        if (!provider.rateLimit) {
            return { hasLimit: false };
        }

        const rateLimit = provider.rateLimit;
        const now = Date.now();

        switch (rateLimit.type) {
            case 'bytes_per_window':
                return this.getBytesRateLimitStatus(rateLimit, now, providerId);

            case 'characters_per_window':
                return this.getCharactersPerWindowStatus(
                    rateLimit,
                    now,
                    providerId
                );

            case 'provider_response':
                return {
                    hasLimit: false,
                    type: 'provider_response',
                    mandatoryDelay: rateLimit.mandatoryDelay,
                };

            case 'requests_per_minute':
                return this.getRequestsRateLimitStatus(
                    rateLimit,
                    now,
                    providerId
                );

            default:
                return {
                    hasLimit: false,
                    mandatoryDelay: rateLimit.mandatoryDelay,
                };
        }
    }

    /**
     * Get bytes rate limit status
     */
    getBytesRateLimitStatus(
        rateLimit,
        now,
        providerId = this.currentProviderId
    ) {
        const windowStart = now - rateLimit.window;
        const requests = this.characterTracker.get(providerId) || [];
        const recentRequests = requests.filter(
            (req) =>
                isFiniteUsageRecord(req, 'bytes') &&
                req.timestamp <= now &&
                req.timestamp > windowStart
        );
        const totalBytes = recentRequests.reduce(
            (sum, req) => sum + req.bytes,
            0
        );

        return {
            hasLimit: true,
            type: 'bytes',
            limit: rateLimit.bytes,
            used: totalBytes,
            remaining: rateLimit.bytes - totalBytes,
            resetTime: getBucketResetTime(
                recentRequests,
                rateLimit.window,
                (request) => request.timestamp
            ),
            mandatoryDelay: rateLimit.mandatoryDelay,
        };
    }

    /**
     * Get worker-local characters-per-window status
     */
    getCharactersPerWindowStatus(
        rateLimit,
        now,
        providerId = this.currentProviderId
    ) {
        const windowStart = now - rateLimit.window;
        const requests = this.characterTracker.get(providerId) || [];
        const recentRequests = requests.filter(
            (request) =>
                isFiniteUsageRecord(request, 'characters') &&
                request.characters >= 0 &&
                request.timestamp <= now &&
                request.timestamp > windowStart
        );
        const totalCharacters = recentRequests.reduce((sum, request) => {
            const nextTotal = sum + request.characters;
            return Number.isFinite(nextTotal) ? nextTotal : Number.MAX_VALUE;
        }, 0);

        return {
            hasLimit: true,
            type: 'characters_per_window',
            scope: rateLimit.scope,
            limit: rateLimit.characters,
            used: totalCharacters,
            remaining: Math.max(0, rateLimit.characters - totalCharacters),
            resetTime: getBucketResetTime(
                recentRequests,
                rateLimit.window,
                (request) => request.timestamp
            ),
            mandatoryDelay: rateLimit.mandatoryDelay,
        };
    }

    /**
     * Get requests rate limit status
     */
    getRequestsRateLimitStatus(
        rateLimit,
        now,
        providerId = this.currentProviderId
    ) {
        const windowStart = now - rateLimit.window;
        const requests = this.rateLimitTracker.get(providerId) || [];
        const recentRequests = requests.filter(
            (timestamp) =>
                Number.isFinite(timestamp) &&
                timestamp <= now &&
                timestamp > windowStart
        );

        return {
            hasLimit: true,
            type: 'requests',
            limit: rateLimit.requests,
            used: recentRequests.length,
            remaining: rateLimit.requests - recentRequests.length,
            resetTime: getBucketResetTime(
                recentRequests,
                rateLimit.window,
                (timestamp) => timestamp
            ),
            mandatoryDelay: rateLimit.mandatoryDelay,
        };
    }
}

// Export singleton instance
export const translationProviders = new TranslationService();
