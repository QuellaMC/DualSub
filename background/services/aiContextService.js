/**
 * AI Context Service
 *
 * Manages AI-powered cultural, historical, and linguistic context analysis
 * for subtitle text. Follows the same architectural patterns as the translation service.
 *
 * @author DualSub Extension
 * @version 1.0.0
 */

import { analyzeContext as openaiAnalyzeContext } from '../../context_providers/openaiContextProvider.js';
import { analyzeContext as geminiAnalyzeContext } from '../../context_providers/geminiContextProvider.js';
import { configService } from '../../services/configService.js';
import { loggingManager } from '../utils/loggingManager.js';
import { ContextCache } from '../utils/contextCache.js';
import { ContextRateLimiterManager } from '../utils/contextRateLimiter.js';

const RUNTIME_CONFIG_KEYS = Object.freeze([
    'aiContextProvider',
    'openaiBaseUrl',
    'openaiModel',
    'geminiModel',
    'aiContextCacheEnabled',
    'aiContextCacheTTL',
    'aiContextMaxCacheSize',
    'aiContextRateLimit',
    'aiContextBurstLimit',
    'aiContextMandatoryDelay',
    'aiContextRetryAttempts',
    'aiContextRetryDelay',
]);
const RUNTIME_CONFIG_KEY_SET = new Set(RUNTIME_CONFIG_KEYS);
const AI_CONTEXT_DISABLED_MESSAGE = 'AI context analysis is disabled';
const AI_CONTEXT_ENABLEMENT_UNAVAILABLE_MESSAGE =
    'AI context availability could not be verified';

function createEnablementFailure(error, text, contextType, metadata) {
    return {
        success: false,
        error,
        contextType,
        originalText: text,
        metadata,
        shouldRetry: false,
        shouldCache: false,
    };
}

export class AIContextService {
    constructor() {
        this.logger = null;
        this.currentProviderId = 'openai';
        this.providers = {
            openai: {
                name: 'OpenAI GPT (API Key Required)',
                analyzeContext: openaiAnalyzeContext,
                supportsBatch: false,
                rateLimit: {
                    type: 'requests_per_minute',
                    requests: 60,
                    window: 60000, // 1 minute
                    mandatoryDelay: 1000, // 1 second between requests
                },
                category: 'api_key',
                contextTypes: ['cultural', 'historical', 'linguistic', 'all'],
            },
            gemini: {
                name: 'Google Gemini (API Key Required)',
                analyzeContext: geminiAnalyzeContext,
                supportsBatch: false,
                rateLimit: {
                    type: 'requests_per_minute',
                    requests: 60,
                    window: 60000, // 1 minute
                    mandatoryDelay: 1000, // 1 second between requests
                },
                category: 'api_key',
                contextTypes: ['cultural', 'historical', 'linguistic', 'all'],
            },
        };

        this.cache = new ContextCache({
            maxSize: 200,
            defaultTTL: 3600000, // 1 hour
            cleanupInterval: 300000, // 5 minutes
        });
        this.rateLimiterManager = new ContextRateLimiterManager();
        this.runtimeConfig = {
            cacheEnabled: true,
            cacheTTL: 3600000,
            cacheMaxSize: 200,
            rateLimit: 60,
            burstLimit: 10,
            mandatoryDelay: 1000,
            retryAttempts: 3,
            retryDelay: 2000,
        };
        this.configSnapshot = {
            openaiBaseUrl: 'https://api.openai.com/v1',
            openaiModel: 'gpt-5.6-luna',
            geminiModel: 'gemini-3.5-flash',
        };
        this.credentialGeneration = 0;
        this.removeConfigListener = null;
        this.isInitialized = false;
    }

    /**
     * Initialize the AI Context Service
     * @returns {Promise<void>}
     */
    async initialize() {
        try {
            this.logger = loggingManager.createLogger('AIContextService');

            // Load provider configuration from storage
            const config = await this._loadRuntimeConfiguration();
            this._applyRuntimeConfiguration(config);
            const savedProvider = config.aiContextProvider;

            this.logger.debug('Loading AI Context provider configuration', {
                defaultProvider: this.currentProviderId,
                savedProvider,
                availableProviders: Object.keys(this.providers),
            });

            if (savedProvider && this.providers[savedProvider]) {
                this.currentProviderId = savedProvider;
                this.logger.info('Using saved provider configuration', {
                    provider: this.currentProviderId,
                    providerName: this.providers[this.currentProviderId].name,
                });
            } else if (savedProvider) {
                this.logger.warn(
                    'Saved provider not available, using default',
                    {
                        savedProvider,
                        defaultProvider: this.currentProviderId,
                        availableProviders: Object.keys(this.providers),
                    }
                );
            }

            // Set up configuration change listener
            this._setupConfigurationListener();

            this.isInitialized = true;
            this.logger.info('AI Context Service initialized successfully', {
                currentProvider: this.currentProviderId,
                providerName: this.providers[this.currentProviderId].name,
                availableProviders: Object.keys(this.providers),
            });
        } catch (error) {
            this.logger?.error(
                'AI Context Service initialization failed',
                error
            );
            throw error;
        }
    }

    _positiveNumber(value, fallback, { integer = false } = {}) {
        if (!Number.isFinite(value) || value <= 0) {
            return fallback;
        }
        return integer ? Math.floor(value) : value;
    }

    _selectRuntimeConfiguration(config = {}) {
        return Object.fromEntries(
            Object.entries(config).filter(([key]) =>
                RUNTIME_CONFIG_KEY_SET.has(key)
            )
        );
    }

    async _loadRuntimeConfiguration() {
        return configService.getMultiple(RUNTIME_CONFIG_KEYS);
    }

    /**
     * Apply the persisted cache, rate-limit, retry, and provider identity
     * settings used by the service.
     * @param {Object} config
     * @private
     */
    _applyRuntimeConfiguration(config = {}) {
        this.configSnapshot = {
            ...this.configSnapshot,
            ...this._selectRuntimeConfiguration(config),
        };
        const effectiveConfig = this.configSnapshot;
        this.runtimeConfig = {
            cacheEnabled: effectiveConfig.aiContextCacheEnabled !== false,
            cacheTTL: this._positiveNumber(
                effectiveConfig.aiContextCacheTTL,
                this.runtimeConfig.cacheTTL
            ),
            cacheMaxSize: this._positiveNumber(
                effectiveConfig.aiContextMaxCacheSize,
                this.runtimeConfig.cacheMaxSize,
                { integer: true }
            ),
            rateLimit: this._positiveNumber(
                effectiveConfig.aiContextRateLimit,
                this.runtimeConfig.rateLimit,
                { integer: true }
            ),
            burstLimit: this._positiveNumber(
                effectiveConfig.aiContextBurstLimit,
                this.runtimeConfig.burstLimit,
                { integer: true }
            ),
            mandatoryDelay: this._positiveNumber(
                effectiveConfig.aiContextMandatoryDelay,
                this.runtimeConfig.mandatoryDelay
            ),
            retryAttempts: Math.min(
                5,
                this._positiveNumber(
                    effectiveConfig.aiContextRetryAttempts,
                    this.runtimeConfig.retryAttempts,
                    { integer: true }
                )
            ),
            retryDelay: this._positiveNumber(
                effectiveConfig.aiContextRetryDelay,
                this.runtimeConfig.retryDelay
            ),
        };

        this.cache.updateConfig({
            maxSize: this.runtimeConfig.cacheMaxSize,
            defaultTTL: this.runtimeConfig.cacheTTL,
        });
        if (!this.runtimeConfig.cacheEnabled) {
            this.cache.clear();
        }

        for (const [providerId, provider] of Object.entries(this.providers)) {
            this.rateLimiterManager.getLimiter(
                providerId,
                this._getEffectiveRateLimit(provider)
            );
        }
    }

    _getEffectiveRateLimit(provider) {
        return {
            ...provider.rateLimit,
            requests: this.runtimeConfig.rateLimit,
            mandatoryDelay: this.runtimeConfig.mandatoryDelay,
            burstLimit: this.runtimeConfig.burstLimit,
        };
    }

    _getProviderCacheIdentity() {
        if (this.currentProviderId === 'openai') {
            return `openai:${this.configSnapshot.openaiBaseUrl}:${this.configSnapshot.openaiModel}:credential-generation-${this.credentialGeneration}`;
        }
        if (this.currentProviderId === 'gemini') {
            return `gemini:${this.configSnapshot.geminiModel}:credential-generation-${this.credentialGeneration}`;
        }
        return `${this.currentProviderId}:credential-generation-${this.credentialGeneration}`;
    }

    async _readEnablementFailure(text, contextType, metadata) {
        let enabled;
        try {
            enabled =
                await configService.readStoredBooleanStrict('aiContextEnabled');
        } catch {
            return createEnablementFailure(
                AI_CONTEXT_ENABLEMENT_UNAVAILABLE_MESSAGE,
                text,
                contextType,
                metadata
            );
        }
        if (typeof enabled !== 'boolean') {
            return createEnablementFailure(
                AI_CONTEXT_ENABLEMENT_UNAVAILABLE_MESSAGE,
                text,
                contextType,
                metadata
            );
        }
        if (!enabled) {
            return createEnablementFailure(
                AI_CONTEXT_DISABLED_MESSAGE,
                text,
                contextType,
                metadata
            );
        }
        return null;
    }

    async _analyzeWithRetry(provider, text, contextType, metadata) {
        let lastResult;
        let lastError;

        for (
            let attempt = 1;
            attempt <= this.runtimeConfig.retryAttempts;
            attempt++
        ) {
            await this.checkRateLimit(this.currentProviderId, contextType);
            let enablementFailure = await this._readEnablementFailure(
                text,
                contextType,
                metadata
            );
            if (enablementFailure) {
                return enablementFailure;
            }

            try {
                lastResult = await provider.analyzeContext(
                    text,
                    contextType,
                    metadata
                );
            } catch (error) {
                lastError = error;
            }

            enablementFailure = await this._readEnablementFailure(
                text,
                contextType,
                metadata
            );
            if (enablementFailure) {
                return enablementFailure;
            }
            if (
                lastResult &&
                (lastResult.success || lastResult.shouldRetry !== true)
            ) {
                return lastResult;
            }

            if (attempt < this.runtimeConfig.retryAttempts) {
                const delay =
                    this.runtimeConfig.retryDelay * 2 ** (attempt - 1);
                this.logger.warn('Retrying context analysis', {
                    provider: this.currentProviderId,
                    contextType,
                    attempt: attempt + 1,
                    maxAttempts: this.runtimeConfig.retryAttempts,
                    delay,
                });
                await new Promise((resolve) => setTimeout(resolve, delay));
                enablementFailure = await this._readEnablementFailure(
                    text,
                    contextType,
                    metadata
                );
                if (enablementFailure) {
                    return enablementFailure;
                }
            }
        }

        if (lastError) {
            throw lastError;
        }
        return lastResult;
    }

    /**
     * Get available context providers
     * @returns {Object} Available providers with their capabilities
     */
    getAvailableProviders() {
        return Object.entries(this.providers).map(([id, provider]) => ({
            id,
            name: provider.name,
            category: provider.category,
            contextTypes: provider.contextTypes,
            supportsBatch: provider.supportsBatch,
        }));
    }

    /**
     * Reload provider configuration from storage
     * @returns {Promise<void>}
     */
    async reloadProviderConfig() {
        try {
            const config = await this._loadRuntimeConfiguration();
            this._applyRuntimeConfiguration(config);
            const savedProvider = config.aiContextProvider;

            this.logger.debug('Reloading provider configuration', {
                currentProvider: this.currentProviderId,
                savedProvider,
                availableProviders: Object.keys(this.providers),
            });

            if (
                savedProvider &&
                this.providers[savedProvider] &&
                savedProvider !== this.currentProviderId
            ) {
                const previousProvider = this.currentProviderId;
                this.currentProviderId = savedProvider;

                this.logger.info('Provider configuration reloaded', {
                    previousProvider,
                    newProvider: this.currentProviderId,
                    providerName: this.providers[this.currentProviderId].name,
                });
            }
        } catch (error) {
            this.logger.error('Failed to reload provider configuration', error);
        }
    }

    /**
     * Check rate limits for a provider
     * @param {string} providerId - Provider ID
     * @param {string} contextType - Type of context request
     * @returns {Promise<boolean>} True if request is allowed
     */
    async checkRateLimit(providerId, contextType = 'default') {
        const provider = this.providers[providerId];

        if (!provider) {
            return true;
        }

        try {
            await this.rateLimiterManager.checkLimit(
                providerId,
                contextType,
                this._getEffectiveRateLimit(provider)
            );
            return true;
        } catch (error) {
            this.logger.warn('Rate limit check failed', {
                providerId,
                contextType,
                error: error.message,
            });
            throw error;
        }
    }

    /**
     * Generate cache key for context requests
     * @param {string} text - Text to analyze
     * @param {string} contextType - Type of context
     * @param {Object} metadata - Additional metadata
     * @returns {string} Cache key
     */
    generateCacheKey(text, contextType, metadata = {}) {
        return this.cache.generateKey(
            text,
            contextType,
            this._getProviderCacheIdentity(),
            metadata
        );
    }

    /**
     * Analyze text for cultural, historical, and linguistic context
     * @param {string} text - Text to analyze
     * @param {string} contextType - Type of context ('cultural', 'historical', 'linguistic', 'all')
     * @param {Object} metadata - Additional context metadata
     * @returns {Promise<Object>} Context analysis result
     */
    async analyzeContext(text, contextType = 'all', metadata = {}) {
        if (!this.isInitialized) {
            throw new Error('AI Context Service not initialized');
        }

        // Validate input text
        if (!text || typeof text !== 'string' || text.trim() === '') {
            this.logger.warn('Invalid text provided for context analysis', {
                textLength: typeof text === 'string' ? text.length : 0,
                type: typeof text,
                contextType,
            });
            return {
                success: false,
                error: 'Invalid or empty text provided for analysis',
                contextType,
                originalText: text || '',
                metadata,
            };
        }

        text = text.trim();

        const enablementFailure = await this._readEnablementFailure(
            text,
            contextType,
            metadata
        );
        if (enablementFailure) {
            return enablementFailure;
        }

        this.logger.info('Context analysis request received', {
            provider: this.currentProviderId,
            providerName: this.providers[this.currentProviderId].name,
            contextType,
            textLength: text.length,
            sourceLanguage: metadata.sourceLanguage,
            targetLanguage: metadata.targetLanguage,
        });

        const requestCredentialGeneration = this.credentialGeneration;
        const cacheKey = this.generateCacheKey(text, contextType, metadata);
        const cachedResult = this.runtimeConfig.cacheEnabled
            ? this.cache.get(cacheKey)
            : null;
        if (cachedResult) {
            this.logger.debug('Returning cached context analysis', {
                provider: this.currentProviderId,
                contextType,
            });
            return {
                ...cachedResult,
                cached: true,
            };
        }

        try {
            const provider = this.providers[this.currentProviderId];

            this.logger.info('Starting context analysis', {
                provider: this.currentProviderId,
                providerName: provider.name,
                contextType,
                textLength: text.length,
                hasMetadata: Object.keys(metadata).length > 0,
            });

            const result = await this._analyzeWithRetry(
                provider,
                text,
                contextType,
                metadata
            );

            this.logger.debug('Provider returned result', {
                provider: this.currentProviderId,
                success: result.success,
                hasAnalysis: !!result.analysis,
                hasResult: !!result.result,
                hasCultural: !!result.cultural,
                hasHistorical: !!result.historical,
                hasLinguistic: !!result.linguistic,
                analysisLength: result.analysis?.length || 0,
                resultKeys: Object.keys(result),
                contextType: result.contextType,
            });

            // Cache successful results
            if (
                this.runtimeConfig.cacheEnabled &&
                result.success &&
                result.shouldCache !== false &&
                this.credentialGeneration === requestCredentialGeneration
            ) {
                this.cache.set(cacheKey, result, this.runtimeConfig.cacheTTL);
                this.logger.debug('Result cached successfully', {
                    provider: this.currentProviderId,
                    contextType,
                });
            }

            this.logger.info('Context analysis completed', {
                provider: this.currentProviderId,
                providerName: provider.name,
                success: result.success,
                contextType,
                cached: false,
                hasResult: !!(
                    result.analysis ||
                    result.result ||
                    result.cultural ||
                    result.historical ||
                    result.linguistic
                ),
            });

            this.logger.debug('Returning result to caller', {
                success: result.success,
                resultType: typeof result,
                resultKeys: Object.keys(result),
            });

            return result;
        } catch (error) {
            this.logger.error('Context analysis failed', error, {
                provider: this.currentProviderId,
                contextType,
                textLength: text?.length || 0,
            });

            return {
                success: false,
                error: error.message,
                contextType,
                originalText: text,
                metadata,
            };
        }
    }

    /**
     * Clear the context cache
     */
    clearCache() {
        this.cache.clear();
        this.logger.info('Context cache cleared');
    }

    /**
     * Get service status
     * @returns {Object} Service status information
     */
    getStatus() {
        return {
            initialized: this.isInitialized,
            currentProvider: this.currentProviderId,
            cache: this.cache.getStatus(),
            rateLimiters: this.rateLimiterManager.getAllStatus(),
            availableProviders: Object.keys(this.providers),
        };
    }

    /**
     * Get current provider information
     * @returns {Object} Current provider info
     */
    getCurrentProvider() {
        return {
            id: this.currentProviderId,
            ...this.providers[this.currentProviderId],
        };
    }

    /**
     * Set up configuration change listener to automatically update provider
     * @private
     */
    _setupConfigurationListener() {
        this.removeConfigListener?.();
        this.removeConfigListener = configService.onChanged(
            (changes) => {
                const cacheIdentityKeys = new Set([
                    'aiContextProvider',
                    'openaiBaseUrl',
                    'openaiModel',
                    'geminiModel',
                    'openaiApiKey',
                    'geminiApiKey',
                ]);
                const cacheConfigurationKeys = new Set([
                    'aiContextCacheEnabled',
                    'aiContextCacheTTL',
                    'aiContextMaxCacheSize',
                ]);
                const credentialKeys = new Set([
                    'openaiApiKey',
                    'geminiApiKey',
                ]);
                const changedKeys = Object.keys(changes);

                if (
                    changes.aiContextProvider &&
                    this.providers[changes.aiContextProvider]
                ) {
                    this.currentProviderId = changes.aiContextProvider;
                }

                this._applyRuntimeConfiguration(
                    this._selectRuntimeConfiguration(changes)
                );

                if (changedKeys.some((key) => credentialKeys.has(key))) {
                    this.credentialGeneration++;
                }

                if (
                    changedKeys.some(
                        (key) =>
                            cacheIdentityKeys.has(key) ||
                            cacheConfigurationKeys.has(key)
                    )
                ) {
                    this.cache.clear();
                }

                this.logger.info('AI Context configuration updated', {
                    changedKeys,
                    currentProvider: this.currentProviderId,
                });
            },
            { includeSensitive: true }
        );
    }

    /**
     * Cleanup service resources
     */
    cleanup() {
        this.removeConfigListener?.();
        this.removeConfigListener = null;
        this.cache.destroy();
        this.rateLimiterManager.cleanup();
        this.isInitialized = false;
        this.logger?.info('AI Context Service cleaned up');
    }
}

// Export singleton instance
export const aiContextService = new AIContextService();
