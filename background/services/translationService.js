/** Coordinates provider selection, caching, pacing, and retries. */

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
import { Providers } from '../../content_scripts/shared/constants/providers.js';
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

class TranslationConfigurationChangedError extends TranslationError {
    constructor() {
        super('Translation configuration changed during request', {
            errorCode: 'CONFIGURATION_CHANGED',
            isRecoverable: true,
        });
        this.name = 'TranslationConfigurationChangedError';
    }
}

class TranslationService {
    constructor() {
        this.logger = null;
        this.currentProviderId = Providers.MICROSOFT_EDGE_AUTH;
        this.providers = {
            [Providers.GOOGLE]: {
                translate: googleTranslate,
                rateLimit: {
                    type: 'bytes_per_window',
                    bytes: 4500,
                    window: 6_500,
                    mandatoryDelay: 1_500,
                },
            },
            [Providers.MICROSOFT_EDGE_AUTH]: {
                translate: microsoftTranslateEdgeAuth,
                rateLimit: {
                    // Best-effort burst protection for this worker instance,
                    // not a durable Microsoft account-quota counter.
                    type: 'characters_per_window',
                    characters: 33_300,
                    window: 60_000,
                    mandatoryDelay: 800,
                },
            },
            [Providers.DEEPL]: {
                translate: deeplTranslate,
                rateLimit: {
                    // DeepL owns quota truth; this worker reacts to provider
                    // responses and only applies local request pacing.
                    type: 'provider_response',
                    mandatoryDelay: 500,
                },
            },
            [Providers.OPENAI_COMPATIBLE]: {
                translate: openaiCompatibleTranslate,
                rateLimit: {
                    type: 'requests_per_minute',
                    requests: 3500,
                    window: 60_000,
                    mandatoryDelay: 100,
                },
            },
            [Providers.VERTEX_GEMINI]: {
                translate: vertexGeminiTranslate,
                rateLimit: {
                    type: 'requests_per_minute',
                    requests: 3000,
                    window: 60_000,
                    mandatoryDelay: 100,
                },
            },
        };
        this.isInitialized = false;
        this.translationCache = new TTLCache(1000, 5 * 60 * 1000);
        this.cacheGeneration = 0;
        this.configuredRequestDelay = getDefaultValue('translationDelay');
        this.characterTracker = new Map();
        this.rateLimitTracker = new Map();
        this.lastRequestTime = new Map();
        this.providerRequestSlotQueues = new Map();
    }

    async initialize() {
        if (this.isInitialized) {
            return;
        }

        this.logger = loggingManager.createLogger('TranslationService');

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

        // Credential rotation must invalidate responses produced with old config.
        configService.onChanged(
            (changes) => this.#handleConfigurationChanges(changes),
            { includeSensitive: true }
        );

        this.isInitialized = true;
        this.logger.info('Translation service initialized', {
            currentProvider: this.currentProviderId,
        });
    }

    #handleConfigurationChanges(changes) {
        if (Object.hasOwn(changes, 'translationDelay')) {
            const delay = changes.translationDelay;
            if (delay === undefined) {
                this.configuredRequestDelay =
                    getDefaultValue('translationDelay');
            } else if (validateSetting('translationDelay', delay)) {
                this.configuredRequestDelay = delay;
            }
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
            this.cacheGeneration++;
            this.translationCache.clear();
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

    async translate(text, sourceLang, targetLang) {
        const startTime = Date.now();
        const providerId = this.currentProviderId;
        const selectedProvider = this.providers[providerId];
        const expectedCacheGeneration = this.cacheGeneration;
        let retryCount = 0;
        const timerId = performanceMonitor.startTiming('translation');

        try {
            const cacheKey = JSON.stringify([
                providerId,
                sourceLang,
                targetLang,
                text,
            ]);
            while (true) {
                try {
                    this.#assertCacheGeneration(expectedCacheGeneration);
                    const cachedResult = this.translationCache.get(cacheKey);
                    if (typeof cachedResult === 'string') {
                        this.logger.debug('Translation cache hit', {
                            provider: providerId,
                            sourceLang,
                            targetLang,
                        });
                        return cachedResult;
                    }

                    // Reserve a paced slot before starting the provider request.
                    await this.#acquireProviderRequestSlot(text, providerId);
                    this.#assertCacheGeneration(expectedCacheGeneration);

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
                    this.#assertCacheGeneration(expectedCacheGeneration);
                    this.translationCache.set(cacheKey, translatedText);

                    const responseTime = Date.now() - startTime;
                    this.logger.debug('Translation completed', {
                        provider: providerId,
                        textLength: text.length,
                        translatedLength: translatedText.length,
                        responseTime,
                        retryCount,
                        cached: false,
                    });
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
                        hasUserImpact: true,
                        retryCount,
                    });

                    const translationError =
                        error instanceof RateLimitError
                            ? error
                            : new TranslationError(errorInfo.userMessage, {
                                  provider: providerId,
                                  errorCode: errorInfo.errorCode,
                                  isRecoverable: errorInfo.isRecoverable,
                              });

                    if (!errorInfo.recovery.shouldRetry || retryCount >= 2) {
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
        } finally {
            performanceMonitor.endTiming(timerId);
        }
    }

    #assertCacheGeneration(expectedCacheGeneration) {
        if (this.cacheGeneration !== expectedCacheGeneration) {
            throw new TranslationConfigurationChangedError();
        }
    }

    async #acquireProviderRequestSlot(text, providerId) {
        const previousSlot =
            this.providerRequestSlotQueues.get(providerId) || Promise.resolve();
        let releaseSlot;
        const currentSlot = new Promise((resolve) => {
            releaseSlot = resolve;
        });
        this.providerRequestSlotQueues.set(providerId, currentSlot);

        await previousSlot;

        try {
            if (!this.#checkRateLimit(text, providerId)) {
                throw new RateLimitError(
                    'Rate limit exceeded for current provider',
                    { provider: providerId }
                );
            }

            await this.#applyMandatoryDelay(providerId);
            this.#updateRateLimitTracker(text, providerId);
        } finally {
            releaseSlot();
            if (
                this.providerRequestSlotQueues.get(providerId) === currentSlot
            ) {
                this.providerRequestSlotQueues.delete(providerId);
            }
        }
    }

    #checkRateLimit(text, providerId) {
        const provider = this.providers[providerId];
        if (!provider.rateLimit) return true;

        const rateLimit = provider.rateLimit;
        const now = Date.now();

        switch (rateLimit.type) {
            case 'bytes_per_window':
                return this.#checkBytesPerWindow(
                    text,
                    rateLimit,
                    now,
                    providerId
                );

            case 'characters_per_window':
                return this.#checkCharactersPerWindow(
                    text,
                    rateLimit,
                    now,
                    providerId
                );

            case 'provider_response':
                return true;

            case 'requests_per_minute':
                return this.#checkRequestsPerWindow(rateLimit, now, providerId);

            default:
                return true;
        }
    }

    #checkBytesPerWindow(text, rateLimit, now, providerId) {
        const windowStart = now - rateLimit.window;

        const recentRequests = (
            this.characterTracker.get(providerId) || []
        ).filter((request) => request.timestamp > windowStart);
        this.characterTracker.set(providerId, recentRequests);
        const totalBytes = recentRequests.reduce(
            (sum, req) => sum + req.bytes,
            0
        );
        const textBytes = new TextEncoder().encode(text).length;

        return totalBytes + textBytes <= rateLimit.bytes;
    }

    #checkCharactersPerWindow(text, rateLimit, now, providerId) {
        const windowStart = now - rateLimit.window;

        const recentRequests = (
            this.characterTracker.get(providerId) || []
        ).filter((request) => request.timestamp > windowStart);
        this.characterTracker.set(providerId, recentRequests);
        const totalCharacters = recentRequests.reduce(
            (sum, request) => sum + request.characters,
            0
        );

        return totalCharacters + text.length <= rateLimit.characters;
    }

    #checkRequestsPerWindow(rateLimit, now, providerId) {
        const windowStart = now - rateLimit.window;

        const recentRequests = (
            this.rateLimitTracker.get(providerId) || []
        ).filter((timestamp) => timestamp > windowStart);
        this.rateLimitTracker.set(providerId, recentRequests);

        return recentRequests.length < rateLimit.requests;
    }

    async #applyMandatoryDelay(providerId) {
        const provider = this.providers[providerId];
        const requiredDelay = Math.max(
            provider.rateLimit?.mandatoryDelay ?? 0,
            this.configuredRequestDelay
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

    #updateRateLimitTracker(text, providerId) {
        const now = Date.now();
        const provider = this.providers[providerId];

        if (!provider.rateLimit) return;

        const rateLimit = provider.rateLimit;
        if (rateLimit.type === 'requests_per_minute') {
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

            const entry =
                rateLimit.type === 'bytes_per_window'
                    ? {
                          timestamp: now,
                          bytes: new TextEncoder().encode(text).length,
                      }
                    : { timestamp: now, characters: text.length };

            this.characterTracker.get(providerId).push(entry);
        }
    }
}

export const translationProviders = new TranslationService();
