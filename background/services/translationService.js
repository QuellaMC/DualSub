/**
 * Translation Service
 *
 * Manages translation providers and coordinates translation requests.
 * Includes explicit multi-text translation, caching, and rate limiting.
 *
 * @author DualSub Extension
 * @version 2.0.0
 */

// @ts-check

import { translate as googleTranslate } from '../../translation_providers/googleTranslate.js';
import { translate as microsoftTranslateEdgeAuth } from '../../translation_providers/microsoftTranslateEdgeAuth.js';
import { translate as deeplTranslate } from '../../translation_providers/deeplTranslate.js';
import {
    translate as openaiCompatibleTranslate,
    translateBatch as openaiCompatibleTranslateBatch,
} from '../../translation_providers/openaiCompatibleTranslate.js';
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
    ProviderBatchConfigs,
} from '../../content_scripts/shared/constants/providers.js';
import {
    translate as vertexGeminiTranslate,
    translateBatch as vertexGeminiTranslateBatch,
} from '../../translation_providers/geminiVertexTranslate.js';
import TTLCache from '../../utils/cache/TTLCache.js';

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
                supportsBatch: false,
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
                supportsBatch: false,
                rateLimit: {
                    type: 'characters_sliding_window',
                    characters: 33300,
                    window: 60000, // 1 minute
                    maxCharacters: 2000000, // 2M chars per hour
                    maxWindow: 3600000, // 1 hour
                    mandatoryDelay: 800, // 800ms between requests
                },
                category: 'free',
            },
            [Providers.DEEPL]: {
                name: ProviderNames[Providers.DEEPL],
                translate: deeplTranslate,
                supportsBatch: false,
                rateLimit: {
                    type: 'characters_per_month',
                    characters: 500000,
                    window: 2592000000, // 30 days
                    mandatoryDelay: 500, // 500ms between requests
                },
                category: 'api_key',
            },
            [Providers.OPENAI_COMPATIBLE]: {
                name: ProviderNames[Providers.OPENAI_COMPATIBLE],
                translate: openaiCompatibleTranslate,
                translateBatch: openaiCompatibleTranslateBatch,
                supportsBatch: true,
                rateLimit: {
                    type: 'requests_per_minute',
                    requests: 3500,
                    window: 60000, // 1 minute
                    mandatoryDelay: 100, // 100ms between requests
                },
                category: 'api_key',
                batchOptimizations: {
                    maxBatchSize:
                        ProviderBatchConfigs[Providers.OPENAI_COMPATIBLE]
                            .maxBatchSize,
                    contextPreservation: true,
                    exponentialBackoff: true,
                    delimiter:
                        ProviderBatchConfigs[Providers.OPENAI_COMPATIBLE]
                            .delimiter,
                },
            },
            [Providers.VERTEX_GEMINI]: {
                name: ProviderNames[Providers.VERTEX_GEMINI],
                translate: vertexGeminiTranslate,
                translateBatch: vertexGeminiTranslateBatch,
                supportsBatch: true,
                rateLimit: {
                    type: 'requests_per_minute',
                    requests: 3000,
                    window: 60000,
                    mandatoryDelay: 100,
                },
                category: 'api_key',
                batchOptimizations: {
                    maxBatchSize:
                        ProviderBatchConfigs[Providers.VERTEX_GEMINI]
                            .maxBatchSize,
                    contextPreservation: true,
                    exponentialBackoff: true,
                    delimiter:
                        ProviderBatchConfigs[Providers.VERTEX_GEMINI].delimiter,
                },
            },
        };
        this.isInitialized = false;
        this.cacheMaxSize = 1000; // Maximum cache entries
        this.translationCache = new TTLCache(this.cacheMaxSize, 5 * 60 * 1000); // 5 minutes TTL
        this.characterTracker = new Map(); // For character/byte-based rate limiting
        this.rateLimitTracker = new Map(); // For request-per-window rate limiting
        this.lastRequestTime = new Map(); // For mandatory delays
        this.providerRequestSlotQueues = new Map(); // Serializes rate-limit slot acquisition per provider
        this.performanceMetrics = {
            // Counts every translate/translateBatch request, including cache hits and failures.
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

        // Listen for provider changes
        // Credential values are observed only so their rotation can invalidate
        // cached results; handleConfigurationChanges logs key names, not values.
        configService.onChanged((changes) =>
            this.handleConfigurationChanges(changes)
        );

        // Validate all providers
        await this.validateProviders();

        this.isInitialized = true;
        this.logger.info('Translation service initialized', {
            currentProvider: this.currentProviderId,
            totalProviders: Object.keys(this.providers).length,
            batchCapableProviders: Object.values(this.providers).filter(
                (p) => p.supportsBatch
            ).length,
        });
    }

    /**
     * Apply translation-related configuration changes.
     * Provider configuration values are never placed in cache keys; changing a
     * non-secret value that can affect a response invalidates the cache instead.
     * @param {Object} changes - Changed configuration keys and their new values
     */
    handleConfigurationChanges(changes) {
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
        const startTime = Date.now();
        const providerId = this.currentProviderId;
        const selectedProvider = this.providers[providerId];
        let retryCount = options.retryCount || 0;
        this.performanceMetrics.totalTranslations++;
        const timerId = performanceMonitor.startTiming('translation', {
            provider: providerId,
            textLength: text.length,
            sourceLang,
            targetLang,
        });

        const cacheKey = this.generateCacheKey(
            text,
            sourceLang,
            targetLang,
            providerId
        );

        try {
            while (true) {
                try {
                    if (!options.skipCache) {
                        const cachedResult = this.getCacheItem(cacheKey);
                        if (cachedResult !== undefined) {
                            this.performanceMetrics.cacheHits++;
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
                        skipRateLimit: options.skipRateLimit === true,
                    });

                    const translatedText = await selectedProvider.translate(
                        text,
                        sourceLang,
                        targetLang
                    );
                    this.setCacheItem(cacheKey, translatedText);

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
                        options.allowRetry === false ||
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

            case 'characters_sliding_window':
                return this.checkCharactersSlidingWindow(
                    text,
                    rateLimit,
                    now,
                    providerId
                );

            case 'characters_per_month':
                return this.checkCharactersPerMonth(
                    text,
                    rateLimit,
                    now,
                    providerId
                );

            case 'requests_per_hour':
            case 'requests_per_minute':
            default:
                return this.checkRequestsPerWindow(rateLimit, now, providerId);
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
        const recentRequests = requests.filter(
            (req) => req.timestamp > windowStart
        );
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
     * Check characters sliding window rate limit (Microsoft Translate)
     * @param {string} text - Text to translate
     * @param {Object} rateLimit - Rate limit configuration
     * @param {number} now - Current timestamp
     * @param {string} providerId - Provider to inspect
     * @returns {boolean} True if within limits
     */
    checkCharactersSlidingWindow(
        text,
        rateLimit,
        now,
        providerId = this.currentProviderId
    ) {
        const shortWindowStart = now - rateLimit.window;
        const longWindowStart = now - rateLimit.maxWindow;

        if (!this.characterTracker.has(providerId)) {
            this.characterTracker.set(providerId, []);
        }

        const requests = this.characterTracker.get(providerId);

        // Remove old requests outside the long window
        const recentRequests = requests.filter(
            (req) => req.timestamp > longWindowStart
        );
        this.characterTracker.set(providerId, recentRequests);

        // Check short window (1 minute)
        const shortWindowRequests = recentRequests.filter(
            (req) => req.timestamp > shortWindowStart
        );
        const shortWindowChars = shortWindowRequests.reduce(
            (sum, req) => sum + req.characters,
            0
        );

        // Check long window (1 hour)
        const longWindowChars = recentRequests.reduce(
            (sum, req) => sum + req.characters,
            0
        );

        const textChars = text.length;

        return (
            shortWindowChars + textChars <= rateLimit.characters &&
            longWindowChars + textChars <= rateLimit.maxCharacters
        );
    }

    /**
     * Check characters per month rate limit (DeepL)
     * @param {string} text - Text to translate
     * @param {Object} rateLimit - Rate limit configuration
     * @param {number} now - Current timestamp
     * @param {string} providerId - Provider to inspect
     * @returns {boolean} True if within limits
     */
    checkCharactersPerMonth(
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
        const recentRequests = requests.filter(
            (req) => req.timestamp > windowStart
        );
        this.characterTracker.set(providerId, recentRequests);

        // Calculate total characters in current window
        const totalChars = recentRequests.reduce(
            (sum, req) => sum + req.characters,
            0
        );
        const textChars = text.length;

        return totalChars + textChars <= rateLimit.characters;
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
        const recentRequests = requests.filter(
            (timestamp) => timestamp > windowStart
        );
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
        if (!provider.rateLimit?.mandatoryDelay) return;

        const now = Date.now();
        const lastRequest = this.lastRequestTime.get(providerId) || 0;
        const timeSinceLastRequest = now - lastRequest;
        const requiredDelay = provider.rateLimit.mandatoryDelay;

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

        // Ensure trackers exist
        if (!this.rateLimitTracker) this.rateLimitTracker = new Map();

        // Always update request tracker
        if (!this.rateLimitTracker.has(providerId)) {
            this.rateLimitTracker.set(providerId, []);
        }
        this.rateLimitTracker.get(providerId).push(now);

        // Update character/byte tracker for relevant providers
        const rateLimit = provider.rateLimit;
        if (
            rateLimit.type === 'bytes_per_window' ||
            rateLimit.type === 'characters_sliding_window' ||
            rateLimit.type === 'characters_per_month'
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
     * Change translation provider
     * @param {string} providerId - New provider ID
     * @returns {Promise<Object>} Result object
     */
    async changeProvider(providerId) {
        if (!this.providers[providerId]) {
            this.logger.error('Attempted to switch to unknown provider', null, {
                providerId,
            });
            throw new Error(`Unknown provider: ${providerId}`);
        }

        this.currentProviderId = providerId;

        // Save to configuration
        await configService.set('selectedProvider', providerId);

        const providerName = this.providers[providerId].name;
        this.logger.info('Provider changed', {
            providerId,
            providerName,
        });

        return {
            success: true,
            message: `Provider changed to ${providerName}`,
        };
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
     * Get providers that support batch processing
     * @returns {Object} Batch-capable providers
     */
    getBatchCapableProviders() {
        const filtered = {};
        for (const [id, provider] of Object.entries(this.providers)) {
            if (provider.supportsBatch) {
                filtered[id] = provider;
            }
        }
        return filtered;
    }

    /**
     * Check if current provider supports batch processing
     * @returns {boolean} True if supports batch
     */
    currentProviderSupportsBatch() {
        return this.providers[this.currentProviderId]?.supportsBatch || false;
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

            case 'characters_sliding_window':
                return this.getCharactersSlidingWindowStatus(
                    rateLimit,
                    now,
                    providerId
                );

            case 'characters_per_month':
                return this.getCharactersPerMonthStatus(
                    rateLimit,
                    now,
                    providerId
                );

            case 'requests_per_hour':
            case 'requests_per_minute':
            default:
                return this.getRequestsRateLimitStatus(
                    rateLimit,
                    now,
                    providerId
                );
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
            (req) => req.timestamp > windowStart
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
            resetTime: windowStart + rateLimit.window,
            mandatoryDelay: rateLimit.mandatoryDelay,
        };
    }

    /**
     * Get characters sliding window status
     */
    getCharactersSlidingWindowStatus(
        rateLimit,
        now,
        providerId = this.currentProviderId
    ) {
        const shortWindowStart = now - rateLimit.window;
        const longWindowStart = now - rateLimit.maxWindow;
        const requests = this.characterTracker.get(providerId) || [];

        const shortWindowRequests = requests.filter(
            (req) => req.timestamp > shortWindowStart
        );
        const longWindowRequests = requests.filter(
            (req) => req.timestamp > longWindowStart
        );

        const shortWindowChars = shortWindowRequests.reduce(
            (sum, req) => sum + req.characters,
            0
        );
        const longWindowChars = longWindowRequests.reduce(
            (sum, req) => sum + req.characters,
            0
        );

        return {
            hasLimit: true,
            type: 'characters_sliding',
            shortWindow: {
                limit: rateLimit.characters,
                used: shortWindowChars,
                remaining: rateLimit.characters - shortWindowChars,
                resetTime: shortWindowStart + rateLimit.window,
            },
            longWindow: {
                limit: rateLimit.maxCharacters,
                used: longWindowChars,
                remaining: rateLimit.maxCharacters - longWindowChars,
                resetTime: longWindowStart + rateLimit.maxWindow,
            },
            mandatoryDelay: rateLimit.mandatoryDelay,
        };
    }

    /**
     * Get characters per month status
     */
    getCharactersPerMonthStatus(
        rateLimit,
        now,
        providerId = this.currentProviderId
    ) {
        const windowStart = now - rateLimit.window;
        const requests = this.characterTracker.get(providerId) || [];
        const recentRequests = requests.filter(
            (req) => req.timestamp > windowStart
        );
        const totalChars = recentRequests.reduce(
            (sum, req) => sum + req.characters,
            0
        );

        return {
            hasLimit: true,
            type: 'characters',
            limit: rateLimit.characters,
            used: totalChars,
            remaining: rateLimit.characters - totalChars,
            resetTime: windowStart + rateLimit.window,
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
            (timestamp) => timestamp > windowStart
        );

        return {
            hasLimit: true,
            type: 'requests',
            limit: rateLimit.requests,
            used: recentRequests.length,
            remaining: rateLimit.requests - recentRequests.length,
            resetTime: windowStart + rateLimit.window,
            mandatoryDelay: rateLimit.mandatoryDelay,
        };
    }

    /**
     * Translate multiple texts in a batch
     * @param {Array<string>} texts - Array of texts to translate
     * @param {string} sourceLang - Source language code
     * @param {string} targetLang - Target language code
     * @param {Object} options - Batch translation options
     * @returns {Promise<Array<string>>} Array of translated texts
     */
    async translateBatch(texts, sourceLang, targetLang, options = {}) {
        if (!Array.isArray(texts) || texts.length === 0) {
            throw new Error('Invalid texts array for batch translation');
        }
        if (texts.some((text) => typeof text !== 'string')) {
            throw new Error('Batch translation texts must be strings');
        }

        const startTime = Date.now();
        const providerId = this.currentProviderId;
        const selectedProvider = this.providers[providerId];
        this.performanceMetrics.totalTranslations++;
        const timerId = performanceMonitor.startTiming('batch_processing', {
            provider: providerId,
            textCount: texts.length,
            totalLength: texts.reduce((sum, text) => sum + text.length, 0),
            sourceLang,
            targetLang,
        });

        try {
            if (texts.every((text) => text.trim() === '')) {
                throw new Error('Texts array contains only empty strings');
            }

            this.logger.info('Batch translation request', {
                provider: providerId,
                textCount: texts.length,
                sourceLang,
                targetLang,
                options,
            });

            if (!selectedProvider) {
                throw new Error(`Provider "${providerId}" is not configured.`);
            }

            // Check if provider supports batch processing
            if (
                !selectedProvider.supportsBatch ||
                !selectedProvider.translateBatch
            ) {
                this.logger.debug(
                    'Provider does not support batch, falling back to individual translations'
                );
                const results = await this.translateIndividually(
                    texts,
                    sourceLang,
                    targetLang,
                    options
                );
                return results;
            }

            const configuredMaxBatchSize =
                selectedProvider.batchOptimizations?.maxBatchSize;
            const maxBatchSize =
                Number.isInteger(configuredMaxBatchSize) &&
                configuredMaxBatchSize > 0
                    ? configuredMaxBatchSize
                    : texts.length;
            const textBatches = [];
            for (let index = 0; index < texts.length; index += maxBatchSize) {
                textBatches.push(texts.slice(index, index + maxBatchSize));
            }

            this.logger.debug('Prepared provider batch requests', {
                originalCount: texts.length,
                maxBatchSize,
                requestCount: textBatches.length,
            });

            const translatedTexts = [];
            for (const textBatch of textBatches) {
                const combinedText = textBatch.join(' ');
                try {
                    await this.acquireProviderRequestSlot(combinedText, {
                        providerId,
                        skipRateLimit: options.skipRateLimit === true,
                    });
                } catch (error) {
                    if (
                        error instanceof RateLimitError &&
                        selectedProvider.batchOptimizations?.exponentialBackoff
                    ) {
                        await this.exponentialBackoff();
                        await this.acquireProviderRequestSlot(combinedText, {
                            providerId,
                            skipRateLimit: options.skipRateLimit === true,
                        });
                    } else {
                        throw error;
                    }
                }

                const translatedBatch = await selectedProvider.translateBatch(
                    textBatch,
                    sourceLang,
                    targetLang,
                    selectedProvider.batchOptimizations?.delimiter ||
                        '|SUBTITLE_BREAK|'
                );

                if (
                    !Array.isArray(translatedBatch) ||
                    translatedBatch.length !== textBatch.length
                ) {
                    throw new Error(
                        `Batch translation returned ${translatedBatch?.length ?? 'an invalid result'} for ${textBatch.length} inputs`
                    );
                }

                translatedTexts.push(...translatedBatch);
            }

            if (translatedTexts.length !== texts.length) {
                throw new Error(
                    `Batch translation returned ${translatedTexts.length} results for ${texts.length} inputs`
                );
            }

            const responseTime = Date.now() - startTime;
            this.updateBatchPerformanceMetrics(
                texts.length,
                responseTime,
                true,
                textBatches.length
            );

            this.logger.info('Batch translation completed', {
                provider: providerId,
                originalCount: texts.length,
                translatedCount: translatedTexts.length,
                requestCount: textBatches.length,
                responseTime,
                apiCallReduction: Math.max(
                    0,
                    texts.length - textBatches.length
                ),
            });

            return translatedTexts;
        } catch (error) {
            const responseTime = Date.now() - startTime;
            this.updateBatchPerformanceMetrics(
                texts.length,
                responseTime,
                false
            );

            this.logger.error('Batch translation failed', error, {
                provider: providerId,
                textCount: texts.length,
            });

            // Fallback to individual translations
            if (options.allowFallback !== false) {
                this.logger.info('Falling back to individual translations');
                return this.translateIndividually(
                    texts,
                    sourceLang,
                    targetLang,
                    options
                );
            }

            throw error;
        } finally {
            performanceMonitor.endTiming(timerId);
        }
    }

    /**
     * Translate texts individually (fallback method)
     * @param {Array<string>} texts - Array of texts to translate
     * @param {string} sourceLang - Source language code
     * @param {string} targetLang - Target language code
     * @param {Object} options - Translation options
     * @returns {Promise<Array<string>>} Array of translated texts
     */
    async translateIndividually(texts, sourceLang, targetLang, options = {}) {
        const results = [];
        const provider = this.providers[this.currentProviderId];

        // Use provider-specific mandatory delay or fallback to configured delay
        const mandatoryDelay = provider.rateLimit?.mandatoryDelay || 0;
        const configuredDelay = options.individualDelay || 100;
        const delay = Math.max(mandatoryDelay, configuredDelay);

        this.logger.debug('Starting individual translations with delays', {
            provider: this.currentProviderId,
            textCount: texts.length,
            mandatoryDelay,
            configuredDelay,
            finalDelay: delay,
        });

        for (let i = 0; i < texts.length; i++) {
            try {
                const translated = await this.translate(
                    texts[i],
                    sourceLang,
                    targetLang,
                    {
                        ...options,
                        skipCache: false, // Allow caching for individual translations
                    }
                );
                results.push(translated);

                // Add delay between requests to avoid rate limiting and account lockouts
                // Note: translate() method already applies mandatory delay, but we add extra delay for safety
                if (i < texts.length - 1 && delay > 0) {
                    await new Promise((resolve) => setTimeout(resolve, delay));
                }
            } catch (error) {
                this.logger.error(
                    'Individual translation failed in batch fallback',
                    error,
                    {
                        textIndex: i,
                        textLength: texts[i].length,
                    }
                );
                results.push(texts[i]); // Use original text as fallback
            }
        }

        return results;
    }

    /**
     * Implement exponential backoff for rate limiting
     * @param {number} attempt - Current attempt number (default: 1)
     * @returns {Promise<void>}
     */
    async exponentialBackoff(attempt = 1) {
        const baseDelay = 1000; // 1 second base delay
        const maxDelay = 30000; // 30 seconds max delay
        const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);

        this.logger.info('Applying exponential backoff', {
            attempt,
            delay,
            provider: this.currentProviderId,
        });

        await new Promise((resolve) => setTimeout(resolve, delay));
    }

    /**
     * Update batch-specific performance metrics
     * @param {number} textCount - Number of texts processed
     * @param {number} responseTime - Response time in milliseconds
     * @param {boolean} success - Whether batch was successful
     * @param {number} requestCount - Number of provider requests used
     */
    updateBatchPerformanceMetrics(
        textCount,
        responseTime,
        success,
        requestCount = 1
    ) {
        // Update general metrics
        this.updatePerformanceMetrics(responseTime, success);

        // Add batch-specific metrics
        if (!this.performanceMetrics.batchMetrics) {
            this.performanceMetrics.batchMetrics = {
                totalBatches: 0,
                totalTextsInBatches: 0,
                averageBatchSize: 0,
                apiCallReduction: 0,
            };
        }

        const batchMetrics = this.performanceMetrics.batchMetrics;
        batchMetrics.totalBatches++;
        batchMetrics.totalTextsInBatches += textCount;
        batchMetrics.averageBatchSize =
            batchMetrics.totalTextsInBatches / batchMetrics.totalBatches;

        if (success && textCount > 1) {
            batchMetrics.apiCallReduction += Math.max(
                0,
                textCount - requestCount
            );
        }
    }
}

// Export singleton instance
export const translationProviders = new TranslationService();
