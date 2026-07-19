/**
 * AI Context Service
 *
 * Manages AI-powered cultural, historical, and linguistic context analysis
 * for subtitle text. Follows the same architectural patterns as the translation service.
 *
 * @author DualSub Extension
 * @version 1.0.0
 */

import {
    analyzeContext as openaiAnalyzeContext,
    getAvailableModels as getOpenAIModels,
    getDefaultModel as getOpenAIDefaultModel,
} from '../../context_providers/openaiContextProvider.js';
import {
    analyzeContext as geminiAnalyzeContext,
    getAvailableModels as getGeminiModels,
    getDefaultModel as getGeminiDefaultModel,
} from '../../context_providers/geminiContextProvider.js';
import { configService } from '../../services/configService.js';
import { loggingManager } from '../utils/loggingManager.js';
import { ContextCache } from '../utils/contextCache.js';
import { ContextRateLimiterManager } from '../utils/contextRateLimiter.js';

class AIContextService {
    constructor() {
        this.logger = null;
        this.currentProviderId = 'openai';
        this.providers = {
            openai: {
                name: 'OpenAI GPT (API Key Required)',
                analyzeContext: openaiAnalyzeContext,
                getAvailableModels: getOpenAIModels,
                getDefaultModel: getOpenAIDefaultModel,
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
                getAvailableModels: getGeminiModels,
                getDefaultModel: getGeminiDefaultModel,
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
        this.isInitialized = false;
    }

    /**
     * Initialize the AI Context Service
     * @returns {Promise<void>}
     */
    async initialize() {
        try {
            this.logger = loggingManager.createLogger('AIContextService');

            for (const [providerId, provider] of Object.entries(
                this.providers
            )) {
                this.rateLimiterManager.getLimiter(
                    providerId,
                    provider.rateLimit
                );
            }

            // Load provider configuration from storage
            const config = await configService.getAll();
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
     * Change context provider
     * @param {string} providerId - New provider ID
     * @returns {Promise<Object>} Result object
     */
    async changeProvider(providerId) {
        if (!this.providers[providerId]) {
            this.logger.error(
                'Attempted to switch to unknown context provider',
                null,
                {
                    providerId,
                    availableProviders: Object.keys(this.providers),
                }
            );
            throw new Error(`Unknown context provider: ${providerId}`);
        }

        const previousProvider = this.currentProviderId;
        this.currentProviderId = providerId;

        // Save to configuration
        await configService.set('aiContextProvider', providerId);

        const providerName = this.providers[providerId].name;
        this.logger.info('Context provider changed successfully', {
            previousProvider,
            newProvider: providerId,
            providerName,
        });

        return {
            success: true,
            message: `Context provider changed to ${providerName}`,
            previousProvider,
            newProvider: providerId,
        };
    }

    /**
     * Reload provider configuration from storage
     * @returns {Promise<void>}
     */
    async reloadProviderConfig() {
        try {
            const config = await configService.getAll();
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
                provider.rateLimit
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
            this.currentProviderId,
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
                text: text?.substring(0, 50),
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

        this.logger.info('Context analysis request received', {
            provider: this.currentProviderId,
            providerName: this.providers[this.currentProviderId].name,
            contextType,
            textLength: text.length,
            sourceLanguage: metadata.sourceLanguage,
            targetLanguage: metadata.targetLanguage,
        });

        const cacheKey = this.generateCacheKey(text, contextType, metadata);
        const cachedResult = this.cache.get(cacheKey);
        if (cachedResult) {
            this.logger.debug('Returning cached context analysis', {
                cacheKey,
            });
            return {
                ...cachedResult,
                cached: true,
            };
        }

        await this.checkRateLimit(this.currentProviderId, contextType);

        try {
            const provider = this.providers[this.currentProviderId];

            this.logger.info('Starting context analysis', {
                provider: this.currentProviderId,
                providerName: provider.name,
                contextType,
                textLength: text.length,
                hasMetadata: Object.keys(metadata).length > 0,
            });

            const result = await provider.analyzeContext(
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
            if (result.success && result.shouldCache !== false) {
                this.cache.set(cacheKey, result);
                this.logger.debug('Result cached successfully', { cacheKey });
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
     * Get available models for a specific provider
     * @param {string} providerId - Provider ID (optional, defaults to current)
     * @returns {Array} Array of available models
     */
    getAvailableModels(providerId = null) {
        const targetProviderId = providerId || this.currentProviderId;
        const provider = this.providers[targetProviderId];

        if (!provider || !provider.getAvailableModels) {
            this.logger.warn('Provider does not support model enumeration', {
                providerId: targetProviderId,
            });
            return [];
        }

        try {
            const models = provider.getAvailableModels();
            this.logger.debug('Retrieved available models', {
                providerId: targetProviderId,
                modelCount: models.length,
            });
            return models;
        } catch (error) {
            this.logger.error('Failed to get available models', error, {
                providerId: targetProviderId,
            });
            return [];
        }
    }

    /**
     * Get default model for a specific provider
     * @param {string} providerId - Provider ID (optional, defaults to current)
     * @returns {string} Default model ID
     */
    getDefaultModel(providerId = null) {
        const targetProviderId = providerId || this.currentProviderId;
        const provider = this.providers[targetProviderId];

        if (!provider || !provider.getDefaultModel) {
            this.logger.warn('Provider does not support default model', {
                providerId: targetProviderId,
            });
            return null;
        }

        try {
            const defaultModel = provider.getDefaultModel();
            this.logger.debug('Retrieved default model', {
                providerId: targetProviderId,
                defaultModel,
            });
            return defaultModel;
        } catch (error) {
            this.logger.error('Failed to get default model', error, {
                providerId: targetProviderId,
            });
            return null;
        }
    }

    /**
     * Set up configuration change listener to automatically update provider
     * @private
     */
    _setupConfigurationListener() {
        // Listen for configuration changes
        if (
            typeof chrome !== 'undefined' &&
            chrome.storage &&
            chrome.storage.onChanged
        ) {
            chrome.storage.onChanged.addListener((changes, areaName) => {
                if (changes.aiContextProvider && areaName === 'sync') {
                    const newProvider = changes.aiContextProvider.newValue;
                    const oldProvider = changes.aiContextProvider.oldValue;

                    this.logger.debug(
                        'AI Context provider configuration changed',
                        {
                            oldProvider,
                            newProvider,
                            currentProvider: this.currentProviderId,
                        }
                    );

                    if (
                        newProvider &&
                        this.providers[newProvider] &&
                        newProvider !== this.currentProviderId
                    ) {
                        this.currentProviderId = newProvider;
                        this.logger.info(
                            'AI Context provider automatically updated from configuration change',
                            {
                                oldProvider,
                                newProvider,
                                providerName: this.providers[newProvider].name,
                            }
                        );
                    }
                }
            });
        }
    }

    /**
     * Cleanup service resources
     */
    cleanup() {
        this.cache.destroy();
        this.rateLimiterManager.cleanup();
        this.isInitialized = false;
        this.logger?.info('AI Context Service cleaned up');
    }
}

// Export singleton instance
export const aiContextService = new AIContextService();
