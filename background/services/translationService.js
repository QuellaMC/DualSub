/**
 * Translation Service
 *
 * Manages translation providers and coordinates translation requests.
 * Includes comprehensive batch processing, caching, and rate limiting.
 *
 * @author DualSub Extension
 * @version 2.0.0
 */

import { translate as googleTranslate } from '../../translation_providers/googleTranslate.js';
import { translate as microsoftTranslateEdgeAuth } from '../../translation_providers/microsoftTranslateEdgeAuth.js';
import { translate as deeplTranslate } from '../../translation_providers/deeplTranslate.js';
import { translate as deeplTranslateFree } from '../../translation_providers/deeplTranslateFree.js';
import { translate as openaiCompatibleTranslate, translateBatch as openaiCompatibleTranslateBatch } from '../../translation_providers/openaiCompatibleTranslate.js';
import { configService } from '../../services/configService.js';
import { loggingManager } from '../utils/loggingManager.js';
import { errorHandler, TranslationError, RateLimitError } from '../utils/errorHandler.js';
import { performanceMonitor } from '../utils/performanceMonitor.js';
import { universalBatchProcessor } from './universalBatchProcessor.js';

class TranslationService {
    constructor() {
        this.logger = null;
        this.currentProviderId = 'deepl_free';
        this.providers = {
            google: {
                name: 'Google Translate (Free)',
                translate: googleTranslate,
                supportsBatch: false,
                rateLimit: {
                    type: 'bytes_per_window',
                    bytes: 4500,
                    window: 6500, // 6.5 seconds
                    mandatoryDelay: 1500 // 1.5 seconds between requests
                },
                category: 'free'
            },
            microsoft_edge_auth: {
                name: 'Microsoft Translate (Free)',
                translate: microsoftTranslateEdgeAuth,
                supportsBatch: false,
                rateLimit: {
                    type: 'characters_sliding_window',
                    characters: 33300,
                    window: 60000, // 1 minute
                    maxCharacters: 2000000, // 2M chars per hour
                    maxWindow: 3600000, // 1 hour
                    mandatoryDelay: 800 // 800ms between requests
                },
                category: 'free'
            },
            deepl: {
                name: 'DeepL Translate (API Key Required)',
                translate: deeplTranslate,
                supportsBatch: false,
                rateLimit: {
                    type: 'characters_per_month',
                    characters: 500000,
                    window: 2592000000, // 30 days
                    mandatoryDelay: 500 // 500ms between requests
                },
                category: 'api_key'
            },
            deepl_free: {
                name: 'DeepL Translate (Free)',
                translate: deeplTranslateFree,
                supportsBatch: false,
                rateLimit: {
                    type: 'requests_per_hour',
                    requests: 20,
                    window: 3600000, // 1 hour
                    mandatoryDelay: 2000 // 2 seconds between requests
                },
                category: 'free'
            },
            openai_compatible: {
                name: 'OpenAI Compatible (API Key Required)',
                translate: openaiCompatibleTranslate,
                translateBatch: openaiCompatibleTranslateBatch,
                supportsBatch: true,
                rateLimit: {
                    type: 'requests_per_minute',
                    requests: 3500,
                    window: 60000, // 1 minute
                    mandatoryDelay: 100 // 100ms between requests
                },
                category: 'api_key',
                batchOptimizations: {
                    maxBatchSize: 10,
                    contextPreservation: true,
                    exponentialBackoff: true,
                    delimiter: '|SUBTITLE_BREAK|'
                }
            }
        };
        this.isInitialized = false;
        this.translationCache = new Map();
        this.rateLimitTracker = new Map();
        this.characterTracker = new Map(); // For character-based rate limiting
        this.lastRequestTime = new Map(); // For mandatory delays
        this.performanceMetrics = {
            totalTranslations: 0,
            cacheHits: 0,
            averageResponseTime: 0,
            errors: 0,
            rateLimitHits: 0
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
            }
        } catch (error) {
            this.logger.error('Error loading translation provider setting', error);
        }

        // Listen for provider changes
        configService.onChanged((changes) => {
            if (
                changes.selectedProvider &&
                this.providers[changes.selectedProvider]
            ) {
                this.currentProviderId = changes.selectedProvider;
                this.logger.info('Translation provider changed', {
                    selectedProvider: changes.selectedProvider,
                });
            }
        });

        // Validate all providers
        await this.validateProviders();

        // Initialize universal batch processor
        await universalBatchProcessor.initialize();

        this.isInitialized = true;
        this.logger.info('Translation service initialized', {
            currentProvider: this.currentProviderId,
            totalProviders: Object.keys(this.providers).length,
            batchCapableProviders: Object.values(this.providers).filter(p => p.supportsBatch).length,
            universalBatchProcessor: true
        });
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
                validationResults[providerId] = { valid: false, error: error.message };
                this.logger.warn('Provider validation failed', error, { providerId });
            }
        }

        this.logger.info('Provider validation completed', {
            results: validationResults,
            validProviders: Object.values(validationResults).filter(r => r.valid).length
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
        const timerId = performanceMonitor.startTiming('translation', {
            provider: this.currentProviderId,
            textLength: text.length,
            sourceLang,
            targetLang
        });

        try {
            // Check cache first
            const cacheKey = this.generateCacheKey(text, sourceLang, targetLang);
            if (!options.skipCache && this.translationCache.has(cacheKey)) {
                this.performanceMetrics.cacheHits++;
                this.logger.debug('Translation cache hit', { cacheKey });
                return this.translationCache.get(cacheKey);
            }

            // Check rate limits
            if (!options.skipRateLimit && !this.checkRateLimit(text)) {
                this.performanceMetrics.rateLimitHits++;
                const rateLimitError = new RateLimitError('Rate limit exceeded for current provider', {
                    provider: this.currentProviderId,
                    rateLimitStatus: this.getRateLimitStatus()
                });
                throw rateLimitError;
            }

            // Apply mandatory delay before translation
            await this.applyMandatoryDelay();

            const selectedProvider = this.providers[this.currentProviderId];
            if (!selectedProvider?.translate) {
                this.logger.error('Invalid translation provider', null, {
                    providerId: this.currentProviderId,
                });
                throw new Error(`Provider "${this.currentProviderId}" is not configured.`);
            }

            // Perform translation
            const translatedText = await selectedProvider.translate(text, sourceLang, targetLang);

            // Cache the result
            this.translationCache.set(cacheKey, translatedText);

            // Update rate limit tracker
            this.updateRateLimitTracker(text);

            // Update performance metrics
            const responseTime = Date.now() - startTime;
            this.updatePerformanceMetrics(responseTime, true);

            // End performance monitoring
            performanceMonitor.endTiming(timerId);

            this.logger.debug('Translation completed', {
                provider: this.currentProviderId,
                textLength: text.length,
                translatedLength: translatedText.length,
                responseTime,
                cached: false
            });

            return translatedText;
        } catch (error) {
            this.updatePerformanceMetrics(Date.now() - startTime, false);

            // End performance monitoring for error case
            performanceMonitor.endTiming(timerId);

            // Handle error with comprehensive error handler
            const errorInfo = errorHandler.handleError(error, {
                operation: 'translate',
                provider: this.currentProviderId,
                textLength: text.length,
                sourceLang,
                targetLang,
                hasUserImpact: true,
                retryCount: options.retryCount || 0
            });

            // Create appropriate error type
            let translationError;
            if (error instanceof RateLimitError) {
                translationError = error;
            } else {
                translationError = new TranslationError(
                    errorInfo.userMessage,
                    {
                        originalError: error.message,
                        provider: this.currentProviderId,
                        errorCode: errorInfo.errorCode,
                        isRecoverable: errorInfo.isRecoverable
                    }
                );
            }

            // Attempt recovery if possible
            if (errorInfo.recovery.shouldRetry && options.allowRetry !== false) {
                this.logger.info('Attempting translation retry', {
                    retryCount: (options.retryCount || 0) + 1,
                    retryDelay: errorInfo.recovery.retryDelay
                });

                // Wait for retry delay
                await new Promise(resolve => setTimeout(resolve, errorInfo.recovery.retryDelay));

                // Retry with incremented count
                return await this.translate(text, sourceLang, targetLang, {
                    ...options,
                    retryCount: (options.retryCount || 0) + 1,
                    allowRetry: (options.retryCount || 0) < 2 // Max 3 total attempts
                });
            }

            throw translationError;
        }
    }

    /**
     * Generate cache key for translation
     * @param {string} text - Text to translate
     * @param {string} sourceLang - Source language
     * @param {string} targetLang - Target language
     * @returns {string} Cache key
     */
    generateCacheKey(text, sourceLang, targetLang) {
        const textHash = this.simpleHash(text);
        return `${this.currentProviderId}:${sourceLang}:${targetLang}:${textHash}`;
    }

    /**
     * Simple hash function for text
     * @param {string} text - Text to hash
     * @returns {string} Hash
     */
    simpleHash(text) {
        let hash = 0;
        for (let i = 0; i < text.length; i++) {
            const char = text.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return hash.toString(36);
    }

    /**
     * Check if current provider is within rate limits
     * @param {string} text - Text to be translated (for character/byte counting)
     * @returns {boolean} True if within limits
     */
    checkRateLimit(text = '') {
        const provider = this.providers[this.currentProviderId];
        if (!provider.rateLimit) return true;

        const rateLimit = provider.rateLimit;
        const now = Date.now();

        switch (rateLimit.type) {
            case 'bytes_per_window':
                return this.checkBytesPerWindow(text, rateLimit, now);

            case 'characters_sliding_window':
                return this.checkCharactersSlidingWindow(text, rateLimit, now);

            case 'characters_per_month':
                return this.checkCharactersPerMonth(text, rateLimit, now);

            case 'requests_per_hour':
            case 'requests_per_minute':
            default:
                return this.checkRequestsPerWindow(rateLimit, now);
        }
    }

    /**
     * Check bytes per window rate limit (Google Translate)
     * @param {string} text - Text to translate
     * @param {Object} rateLimit - Rate limit configuration
     * @param {number} now - Current timestamp
     * @returns {boolean} True if within limits
     */
    checkBytesPerWindow(text, rateLimit, now) {
        const windowStart = now - rateLimit.window;

        if (!this.characterTracker.has(this.currentProviderId)) {
            this.characterTracker.set(this.currentProviderId, []);
        }

        const requests = this.characterTracker.get(this.currentProviderId);

        // Remove old requests outside the window
        const recentRequests = requests.filter(req => req.timestamp > windowStart);
        this.characterTracker.set(this.currentProviderId, recentRequests);

        // Calculate total bytes in current window
        const totalBytes = recentRequests.reduce((sum, req) => sum + req.bytes, 0);
        const textBytes = new TextEncoder().encode(text).length;

        return (totalBytes + textBytes) <= rateLimit.bytes;
    }

    /**
     * Check characters sliding window rate limit (Microsoft Translate)
     * @param {string} text - Text to translate
     * @param {Object} rateLimit - Rate limit configuration
     * @param {number} now - Current timestamp
     * @returns {boolean} True if within limits
     */
    checkCharactersSlidingWindow(text, rateLimit, now) {
        const shortWindowStart = now - rateLimit.window;
        const longWindowStart = now - rateLimit.maxWindow;

        if (!this.characterTracker.has(this.currentProviderId)) {
            this.characterTracker.set(this.currentProviderId, []);
        }

        const requests = this.characterTracker.get(this.currentProviderId);

        // Remove old requests outside the long window
        const recentRequests = requests.filter(req => req.timestamp > longWindowStart);
        this.characterTracker.set(this.currentProviderId, recentRequests);

        // Check short window (1 minute)
        const shortWindowRequests = recentRequests.filter(req => req.timestamp > shortWindowStart);
        const shortWindowChars = shortWindowRequests.reduce((sum, req) => sum + req.characters, 0);

        // Check long window (1 hour)
        const longWindowChars = recentRequests.reduce((sum, req) => sum + req.characters, 0);

        const textChars = text.length;

        return (shortWindowChars + textChars) <= rateLimit.characters &&
               (longWindowChars + textChars) <= rateLimit.maxCharacters;
    }

    /**
     * Check characters per month rate limit (DeepL)
     * @param {string} text - Text to translate
     * @param {Object} rateLimit - Rate limit configuration
     * @param {number} now - Current timestamp
     * @returns {boolean} True if within limits
     */
    checkCharactersPerMonth(text, rateLimit, now) {
        const windowStart = now - rateLimit.window;

        if (!this.characterTracker.has(this.currentProviderId)) {
            this.characterTracker.set(this.currentProviderId, []);
        }

        const requests = this.characterTracker.get(this.currentProviderId);

        // Remove old requests outside the window
        const recentRequests = requests.filter(req => req.timestamp > windowStart);
        this.characterTracker.set(this.currentProviderId, recentRequests);

        // Calculate total characters in current window
        const totalChars = recentRequests.reduce((sum, req) => sum + req.characters, 0);
        const textChars = text.length;

        return (totalChars + textChars) <= rateLimit.characters;
    }

    /**
     * Check requests per window rate limit (OpenAI, DeepL Free)
     * @param {Object} rateLimit - Rate limit configuration
     * @param {number} now - Current timestamp
     * @returns {boolean} True if within limits
     */
    checkRequestsPerWindow(rateLimit, now) {
        const windowStart = now - rateLimit.window;

        if (!this.rateLimitTracker.has(this.currentProviderId)) {
            this.rateLimitTracker.set(this.currentProviderId, []);
        }

        const requests = this.rateLimitTracker.get(this.currentProviderId);

        // Remove old requests outside the window
        const recentRequests = requests.filter(timestamp => timestamp > windowStart);
        this.rateLimitTracker.set(this.currentProviderId, recentRequests);

        return recentRequests.length < rateLimit.requests;
    }

    /**
     * Apply mandatory delay before translation
     * @returns {Promise<void>}
     */
    async applyMandatoryDelay() {
        const provider = this.providers[this.currentProviderId];
        if (!provider.rateLimit?.mandatoryDelay) return;

        const now = Date.now();
        const lastRequest = this.lastRequestTime.get(this.currentProviderId) || 0;
        const timeSinceLastRequest = now - lastRequest;
        const requiredDelay = provider.rateLimit.mandatoryDelay;

        if (timeSinceLastRequest < requiredDelay) {
            const delayNeeded = requiredDelay - timeSinceLastRequest;
            this.logger.debug('Applying mandatory delay', {
                provider: this.currentProviderId,
                delayNeeded,
                requiredDelay,
                timeSinceLastRequest
            });
            await new Promise(resolve => setTimeout(resolve, delayNeeded));
        }

        this.lastRequestTime.set(this.currentProviderId, Date.now());
    }

    /**
     * Update rate limit tracker
     * @param {string} text - Text that was translated
     */
    updateRateLimitTracker(text = '') {
        const now = Date.now();
        const provider = this.providers[this.currentProviderId];

        if (!provider.rateLimit) return;

        // Always update request tracker
        if (!this.rateLimitTracker.has(this.currentProviderId)) {
            this.rateLimitTracker.set(this.currentProviderId, []);
        }
        this.rateLimitTracker.get(this.currentProviderId).push(now);

        // Update character/byte tracker for relevant providers
        const rateLimit = provider.rateLimit;
        if (rateLimit.type === 'bytes_per_window' ||
            rateLimit.type === 'characters_sliding_window' ||
            rateLimit.type === 'characters_per_month') {

            if (!this.characterTracker.has(this.currentProviderId)) {
                this.characterTracker.set(this.currentProviderId, []);
            }

            const entry = {
                timestamp: now,
                characters: text.length,
                bytes: new TextEncoder().encode(text).length
            };

            this.characterTracker.get(this.currentProviderId).push(entry);
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
        this.performanceMetrics.totalTranslations++;

        if (success) {
            // Update average response time
            const total = this.performanceMetrics.totalTranslations;
            const currentAvg = this.performanceMetrics.averageResponseTime;
            this.performanceMetrics.averageResponseTime =
                ((currentAvg * (total - 1)) + responseTime) / total;
        } else {
            this.performanceMetrics.errors++;
        }
    }

    /**
     * Get translation performance metrics
     * @returns {Object} Performance metrics
     */
    getPerformanceMetrics() {
        return {
            ...this.performanceMetrics,
            errorRate: this.performanceMetrics.totalTranslations > 0
                ? (this.performanceMetrics.errors / this.performanceMetrics.totalTranslations) * 100
                : 0,
            cacheHitRate: this.performanceMetrics.totalTranslations > 0
                ? (this.performanceMetrics.cacheHits / this.performanceMetrics.totalTranslations) * 100
                : 0
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
    getRateLimitStatus() {
        const provider = this.providers[this.currentProviderId];
        if (!provider.rateLimit) {
            return { hasLimit: false };
        }

        const rateLimit = provider.rateLimit;
        const now = Date.now();

        switch (rateLimit.type) {
            case 'bytes_per_window':
                return this.getBytesRateLimitStatus(rateLimit, now);

            case 'characters_sliding_window':
                return this.getCharactersSlidingWindowStatus(rateLimit, now);

            case 'characters_per_month':
                return this.getCharactersPerMonthStatus(rateLimit, now);

            case 'requests_per_hour':
            case 'requests_per_minute':
            default:
                return this.getRequestsRateLimitStatus(rateLimit, now);
        }
    }

    /**
     * Get bytes rate limit status
     */
    getBytesRateLimitStatus(rateLimit, now) {
        const windowStart = now - rateLimit.window;
        const requests = this.characterTracker.get(this.currentProviderId) || [];
        const recentRequests = requests.filter(req => req.timestamp > windowStart);
        const totalBytes = recentRequests.reduce((sum, req) => sum + req.bytes, 0);

        return {
            hasLimit: true,
            type: 'bytes',
            limit: rateLimit.bytes,
            used: totalBytes,
            remaining: rateLimit.bytes - totalBytes,
            resetTime: windowStart + rateLimit.window,
            mandatoryDelay: rateLimit.mandatoryDelay
        };
    }

    /**
     * Get characters sliding window status
     */
    getCharactersSlidingWindowStatus(rateLimit, now) {
        const shortWindowStart = now - rateLimit.window;
        const longWindowStart = now - rateLimit.maxWindow;
        const requests = this.characterTracker.get(this.currentProviderId) || [];

        const shortWindowRequests = requests.filter(req => req.timestamp > shortWindowStart);
        const longWindowRequests = requests.filter(req => req.timestamp > longWindowStart);

        const shortWindowChars = shortWindowRequests.reduce((sum, req) => sum + req.characters, 0);
        const longWindowChars = longWindowRequests.reduce((sum, req) => sum + req.characters, 0);

        return {
            hasLimit: true,
            type: 'characters_sliding',
            shortWindow: {
                limit: rateLimit.characters,
                used: shortWindowChars,
                remaining: rateLimit.characters - shortWindowChars,
                resetTime: shortWindowStart + rateLimit.window
            },
            longWindow: {
                limit: rateLimit.maxCharacters,
                used: longWindowChars,
                remaining: rateLimit.maxCharacters - longWindowChars,
                resetTime: longWindowStart + rateLimit.maxWindow
            },
            mandatoryDelay: rateLimit.mandatoryDelay
        };
    }

    /**
     * Get characters per month status
     */
    getCharactersPerMonthStatus(rateLimit, now) {
        const windowStart = now - rateLimit.window;
        const requests = this.characterTracker.get(this.currentProviderId) || [];
        const recentRequests = requests.filter(req => req.timestamp > windowStart);
        const totalChars = recentRequests.reduce((sum, req) => sum + req.characters, 0);

        return {
            hasLimit: true,
            type: 'characters',
            limit: rateLimit.characters,
            used: totalChars,
            remaining: rateLimit.characters - totalChars,
            resetTime: windowStart + rateLimit.window,
            mandatoryDelay: rateLimit.mandatoryDelay
        };
    }

    /**
     * Get requests rate limit status
     */
    getRequestsRateLimitStatus(rateLimit, now) {
        const windowStart = now - rateLimit.window;
        const requests = this.rateLimitTracker.get(this.currentProviderId) || [];
        const recentRequests = requests.filter(timestamp => timestamp > windowStart);

        return {
            hasLimit: true,
            type: 'requests',
            limit: rateLimit.requests,
            used: recentRequests.length,
            remaining: rateLimit.requests - recentRequests.length,
            resetTime: windowStart + rateLimit.window,
            mandatoryDelay: rateLimit.mandatoryDelay
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
        const startTime = Date.now();
        const timerId = performanceMonitor.startTiming('batch_processing', {
            provider: this.currentProviderId,
            textCount: texts.length,
            totalLength: texts.reduce((sum, text) => sum + text.length, 0),
            sourceLang,
            targetLang
        });

        try {
            if (!Array.isArray(texts) || texts.length === 0) {
                throw new Error('Invalid texts array for batch translation');
            }

            this.logger.info('Batch translation request', {
                provider: this.currentProviderId,
                textCount: texts.length,
                sourceLang,
                targetLang,
                options
            });

            const selectedProvider = this.providers[this.currentProviderId];
            if (!selectedProvider) {
                throw new Error(`Provider "${this.currentProviderId}" is not configured.`);
            }

            // Check if provider supports batch processing
            if (!selectedProvider.supportsBatch || !selectedProvider.translateBatch) {
                this.logger.debug('Provider does not support batch, falling back to individual translations');
                return await this.translateIndividually(texts, sourceLang, targetLang, options);
            }

            // Check rate limits for batch request
            const combinedText = texts.join(' '); // Approximate text for rate limiting
            if (!options.skipRateLimit && !this.checkRateLimit(combinedText)) {
                this.performanceMetrics.rateLimitHits++;

                // Implement exponential backoff if supported
                if (selectedProvider.batchOptimizations?.exponentialBackoff) {
                    await this.exponentialBackoff();
                    // Retry after backoff
                    if (!this.checkRateLimit(combinedText)) {
                        throw new Error('Rate limit exceeded after exponential backoff');
                    }
                }
            }

            // Apply mandatory delay before batch translation
            await this.applyMandatoryDelay();

            // Apply provider-specific optimizations
            const optimizedTexts = this.applyBatchOptimizations(texts, selectedProvider);

            // Perform batch translation
            const translatedTexts = await selectedProvider.translateBatch(
                optimizedTexts,
                sourceLang,
                targetLang,
                selectedProvider.batchOptimizations?.delimiter || '|SUBTITLE_BREAK|'
            );

            // Update rate limit tracker
            this.updateRateLimitTracker(combinedText);

            // Update performance metrics
            const responseTime = Date.now() - startTime;
            this.updateBatchPerformanceMetrics(texts.length, responseTime, true);

            // End performance monitoring
            performanceMonitor.endTiming(timerId);

            this.logger.info('Batch translation completed', {
                provider: this.currentProviderId,
                originalCount: texts.length,
                translatedCount: translatedTexts.length,
                responseTime,
                apiCallReduction: texts.length - 1 // N texts in 1 call vs N calls
            });

            return translatedTexts;

        } catch (error) {
            const responseTime = Date.now() - startTime;
            this.updateBatchPerformanceMetrics(texts.length, responseTime, false);

            // End performance monitoring for error case
            performanceMonitor.endTiming(timerId);

            this.logger.error('Batch translation failed', error, {
                provider: this.currentProviderId,
                textCount: texts.length
            });

            // Fallback to individual translations
            if (options.allowFallback !== false) {
                this.logger.info('Falling back to individual translations');
                return await this.translateIndividually(texts, sourceLang, targetLang, options);
            }

            throw error;
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
            finalDelay: delay
        });

        for (let i = 0; i < texts.length; i++) {
            try {
                const translated = await this.translate(texts[i], sourceLang, targetLang, {
                    ...options,
                    skipCache: false // Allow caching for individual translations
                });
                results.push(translated);

                // Add delay between requests to avoid rate limiting and account lockouts
                // Note: translate() method already applies mandatory delay, but we add extra delay for safety
                if (i < texts.length - 1 && delay > 0) {
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            } catch (error) {
                this.logger.error('Individual translation failed in batch fallback', error, {
                    textIndex: i,
                    text: texts[i].substring(0, 50)
                });
                results.push(texts[i]); // Use original text as fallback
            }
        }

        return results;
    }

    /**
     * Apply provider-specific batch optimizations
     * @param {Array<string>} texts - Original texts
     * @param {Object} provider - Provider configuration
     * @returns {Array<string>} Optimized texts
     */
    applyBatchOptimizations(texts, provider) {
        if (!provider.batchOptimizations) {
            return texts;
        }

        let optimizedTexts = [...texts];

        // Apply max batch size limit
        if (provider.batchOptimizations.maxBatchSize &&
            optimizedTexts.length > provider.batchOptimizations.maxBatchSize) {
            this.logger.debug('Applying max batch size limit', {
                originalCount: optimizedTexts.length,
                maxBatchSize: provider.batchOptimizations.maxBatchSize
            });
            optimizedTexts = optimizedTexts.slice(0, provider.batchOptimizations.maxBatchSize);
        }

        // Context preservation (for subtitle continuity)
        if (provider.batchOptimizations.contextPreservation) {
            // Sort by timing if available, or maintain original order
            // This helps maintain subtitle context and flow
            this.logger.debug('Applying context preservation optimization');
        }

        return optimizedTexts;
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
            provider: this.currentProviderId
        });

        await new Promise(resolve => setTimeout(resolve, delay));
    }

    /**
     * Update batch-specific performance metrics
     * @param {number} textCount - Number of texts processed
     * @param {number} responseTime - Response time in milliseconds
     * @param {boolean} success - Whether batch was successful
     */
    updateBatchPerformanceMetrics(textCount, responseTime, success) {
        // Update general metrics
        this.updatePerformanceMetrics(responseTime, success);

        // Add batch-specific metrics
        if (!this.performanceMetrics.batchMetrics) {
            this.performanceMetrics.batchMetrics = {
                totalBatches: 0,
                totalTextsInBatches: 0,
                averageBatchSize: 0,
                apiCallReduction: 0
            };
        }

        const batchMetrics = this.performanceMetrics.batchMetrics;
        batchMetrics.totalBatches++;
        batchMetrics.totalTextsInBatches += textCount;
        batchMetrics.averageBatchSize = batchMetrics.totalTextsInBatches / batchMetrics.totalBatches;

        if (success && textCount > 1) {
            batchMetrics.apiCallReduction += (textCount - 1); // N texts in 1 call vs N calls
        }
    }

    /**
     * Universal batch translation using the universal batch processor
     * Works with ALL providers, not just batch-capable ones
     * @param {Array<string>} texts - Array of texts to translate
     * @param {string} sourceLang - Source language code
     * @param {string} targetLang - Target language code
     * @param {Object} options - Translation options
     * @returns {Promise<Array<string>>} Array of translated texts
     */
    async translateUniversalBatch(texts, sourceLang, targetLang, options = {}) {
        // Use the universal batch processor for all providers
        return await universalBatchProcessor.processTexts(
            texts,
            sourceLang,
            targetLang,
            this.currentProviderId,
            this,
            options
        );
    }
}

// Export singleton instance
export const translationProviders = new TranslationService();
