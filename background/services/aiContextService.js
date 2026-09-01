import { analyzeContext as openaiAnalyzeContext } from '../../context_providers/openaiContextProvider.js';
import { analyzeContext as geminiAnalyzeContext } from '../../context_providers/geminiContextProvider.js';
import { getDefaultValue } from '../../config/configSchema.js';
import { configService } from '../../services/configService.js';
import { CONTEXT_TYPES } from '../../content_scripts/shared/constants/contextTypes.js';
import { RateLimitError } from './serviceInterfaces.js';
import { loggingManager } from '../utils/loggingManager.js';
import { ContextCache } from '../utils/contextCache.js';
import { errorHandler } from '../utils/errorHandler.js';
import { ContextRateLimiterManager } from '../utils/contextRateLimiter.js';

const CONFIG_KEYS = Object.freeze([
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
const CONFIG_KEY_SET = new Set(CONFIG_KEYS);
const CREDENTIAL_KEYS = new Set(['openaiApiKey', 'geminiApiKey']);
const CACHE_IDENTITY_KEYS = new Set([
    'aiContextProvider',
    'openaiBaseUrl',
    'openaiModel',
    'geminiModel',
    ...CREDENTIAL_KEYS,
]);
const CACHE_CONFIGURATION_KEYS = new Set([
    'aiContextCacheEnabled',
    'aiContextCacheTTL',
    'aiContextMaxCacheSize',
]);
const SUPPORTED_CONTEXT_TYPES = new Set([...CONTEXT_TYPES, 'all']);
const PROVIDERS = {
    openai: {
        analyzeContext: openaiAnalyzeContext,
        rateLimit: { window: 60_000 },
    },
    gemini: {
        analyzeContext: geminiAnalyzeContext,
        rateLimit: { window: 60_000 },
    },
};

function defaultConfiguration() {
    return Object.fromEntries(
        CONFIG_KEYS.map((key) => [key, getDefaultValue(key)])
    );
}

function analysisFailure(error, text, contextType, metadata) {
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
        this.providers = { ...PROVIDERS };
        this.configuration = defaultConfiguration();
        this.currentProviderId = this.configuration.aiContextProvider;
        this.runtimeConfig = this._runtimeConfiguration();
        this.cache = new ContextCache({
            maxSize: this.runtimeConfig.cacheMaxSize,
            defaultTTL: this.runtimeConfig.cacheTTL,
        });
        this.rateLimiterManager = new ContextRateLimiterManager();
        this.credentialGeneration = 0;
        this.removeConfigListener = null;
        this.isInitialized = false;
    }

    async initialize() {
        this.logger = loggingManager.createLogger('AIContextService');
        this._applyConfiguration(await configService.getMultiple(CONFIG_KEYS));
        this._setupConfigurationListener();
        this.isInitialized = true;
        this.logger.info('AI context service initialized', {
            provider: this.currentProviderId,
        });
    }

    _runtimeConfiguration() {
        return {
            cacheEnabled: this.configuration.aiContextCacheEnabled,
            cacheTTL: this.configuration.aiContextCacheTTL,
            cacheMaxSize: this.configuration.aiContextMaxCacheSize,
            rateLimit: this.configuration.aiContextRateLimit,
            burstLimit: this.configuration.aiContextBurstLimit,
            mandatoryDelay: this.configuration.aiContextMandatoryDelay,
            retryAttempts: this.configuration.aiContextRetryAttempts,
            retryDelay: this.configuration.aiContextRetryDelay,
        };
    }

    _applyConfiguration(changes = {}) {
        for (const [key, value] of Object.entries(changes)) {
            if (CONFIG_KEY_SET.has(key)) this.configuration[key] = value;
        }

        const selectedProvider = this.configuration.aiContextProvider;
        if (this.providers[selectedProvider]) {
            this.currentProviderId = selectedProvider;
        }

        this.runtimeConfig = this._runtimeConfiguration();
        this.cache.updateConfig({
            maxSize: this.runtimeConfig.cacheMaxSize,
            defaultTTL: this.runtimeConfig.cacheTTL,
        });
        if (!this.runtimeConfig.cacheEnabled) this.cache.clear();

        for (const [providerId, provider] of Object.entries(this.providers)) {
            this.rateLimiterManager.getLimiter(
                providerId,
                this._rateLimitConfiguration(provider)
            );
        }
    }

    _rateLimitConfiguration(provider) {
        return {
            ...provider.rateLimit,
            requests: this.runtimeConfig.rateLimit,
            burstLimit: this.runtimeConfig.burstLimit,
            mandatoryDelay: this.runtimeConfig.mandatoryDelay,
        };
    }

    _providerCacheIdentity() {
        const credential = `credential-${this.credentialGeneration}`;
        if (this.currentProviderId === 'openai') {
            return [
                'openai',
                this.configuration.openaiBaseUrl,
                this.configuration.openaiModel,
                credential,
            ].join(':');
        }
        return [
            this.currentProviderId,
            this.configuration.geminiModel,
            credential,
        ].join(':');
    }

    async _enablementFailure(text, contextType, metadata) {
        let enabled;
        try {
            enabled =
                await configService.readStoredBooleanStrict('aiContextEnabled');
        } catch {
            return analysisFailure(
                'AI context availability could not be verified',
                text,
                contextType,
                metadata
            );
        }
        return enabled === true
            ? null
            : analysisFailure(
                  enabled === false
                      ? 'AI context analysis is disabled'
                      : 'AI context availability could not be verified',
                  text,
                  contextType,
                  metadata
              );
    }

    async _analyzeWithRetry(provider, text, contextType, metadata) {
        let lastResult;
        let lastError;

        for (
            let attempt = 0;
            attempt < this.runtimeConfig.retryAttempts;
            attempt += 1
        ) {
            await this.rateLimiterManager.checkLimit(
                this.currentProviderId,
                this._rateLimitConfiguration(provider)
            );

            let disabled = await this._enablementFailure(
                text,
                contextType,
                metadata
            );
            if (disabled) return disabled;

            try {
                lastResult = await provider.analyzeContext(
                    text,
                    contextType,
                    metadata
                );
                lastError = null;
            } catch (error) {
                lastError = error;
            }

            disabled = await this._enablementFailure(
                text,
                contextType,
                metadata
            );
            if (disabled) return disabled;
            if (
                lastResult &&
                (lastResult.success === true || lastResult.shouldRetry !== true)
            ) {
                return lastResult;
            }

            if (attempt + 1 < this.runtimeConfig.retryAttempts) {
                const delay = this.runtimeConfig.retryDelay * 2 ** attempt;
                this.logger.warn('Retrying AI context request', {
                    provider: this.currentProviderId,
                    attempt: attempt + 2,
                    delay,
                });
                await new Promise((resolve) => setTimeout(resolve, delay));
                disabled = await this._enablementFailure(
                    text,
                    contextType,
                    metadata
                );
                if (disabled) return disabled;
            }
        }

        if (lastError) throw lastError;
        return lastResult;
    }

    _generateCacheKey(text, contextType, metadata = {}) {
        return this.cache.generateKey(
            text,
            contextType,
            this._providerCacheIdentity(),
            metadata
        );
    }

    async analyzeContext(text, contextType = 'all', metadata = {}) {
        if (!this.isInitialized) {
            throw new Error('AI Context Service not initialized');
        }
        if (typeof text !== 'string' || text.trim() === '') {
            return analysisFailure(
                'Invalid or empty text provided for analysis',
                typeof text === 'string' ? text : '',
                contextType,
                metadata
            );
        }
        const normalizedText = text.trim();
        if (!SUPPORTED_CONTEXT_TYPES.has(contextType)) {
            return analysisFailure(
                'Unsupported AI context type',
                normalizedText,
                contextType,
                metadata
            );
        }

        const disabled = await this._enablementFailure(
            normalizedText,
            contextType,
            metadata
        );
        if (disabled) return disabled;

        const requestGeneration = this.credentialGeneration;
        const cacheKey = this._generateCacheKey(
            normalizedText,
            contextType,
            metadata
        );
        if (this.runtimeConfig.cacheEnabled) {
            const cached = this.cache.get(cacheKey);
            if (cached) return { ...cached, cached: true };
        }

        try {
            const result = await this._analyzeWithRetry(
                this.providers[this.currentProviderId],
                normalizedText,
                contextType,
                metadata
            );
            if (
                this.runtimeConfig.cacheEnabled &&
                result?.success === true &&
                result.shouldCache !== false &&
                requestGeneration === this.credentialGeneration
            ) {
                this.cache.set(cacheKey, result, this.runtimeConfig.cacheTTL);
            }
            return result;
        } catch (error) {
            const failure = errorHandler.handleError(error, {
                operation: 'analyzeContext',
                provider: this.currentProviderId,
                retryCount:
                    error instanceof RateLimitError
                        ? 0
                        : this.runtimeConfig.retryAttempts,
                hasUserImpact: true,
            });
            return {
                ...analysisFailure(
                    failure.userMessage,
                    normalizedText,
                    contextType,
                    metadata
                ),
                shouldRetry: failure.shouldRetry,
            };
        }
    }

    _setupConfigurationListener() {
        this.removeConfigListener?.();
        this.removeConfigListener = configService.onChanged(
            (changes) => {
                const changedKeys = Object.keys(changes);
                this._applyConfiguration(changes);

                if (changedKeys.some((key) => CREDENTIAL_KEYS.has(key))) {
                    this.credentialGeneration += 1;
                }
                if (
                    changedKeys.some(
                        (key) =>
                            CACHE_IDENTITY_KEYS.has(key) ||
                            CACHE_CONFIGURATION_KEYS.has(key)
                    )
                ) {
                    this.cache.clear();
                }
            },
            { includeSensitive: true }
        );
    }

    cleanup() {
        this.removeConfigListener?.();
        this.removeConfigListener = null;
        this.cache.destroy();
        this.rateLimiterManager.cleanup();
        this.isInitialized = false;
    }
}

export const aiContextService = new AIContextService();
