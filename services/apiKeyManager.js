/**
 * API Key Manager
 *
 * Provides secure storage and management for API keys used by the AI Context
 * feature. Implements basic obfuscation and validation for API keys.
 *
 * @author DualSub Extension
 * @version 1.0.0
 */

import { configService } from './configService.js';
import Logger from '../utils/logger.js';

const logger = Logger.create('APIKeyManager');

/**
 * API Key validation patterns
 */
const API_KEY_PATTERNS = {
    openai: /^sk-[a-zA-Z0-9]{48,}$/,
    gemini: /^AIza[a-zA-Z0-9_-]{35,}$/,
    deepl: /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}:fx$/,
};

/**
 * Simple obfuscation for API keys (not encryption, just basic protection)
 */
class APIKeyObfuscator {
    static obfuscate(key) {
        if (!key || typeof key !== 'string') return '';

        // Simple XOR with a fixed key (not secure, just obfuscation)
        const obfuscationKey = 'DualSubAIContext2024';
        let result = '';

        for (let i = 0; i < key.length; i++) {
            const charCode =
                key.charCodeAt(i) ^
                obfuscationKey.charCodeAt(i % obfuscationKey.length);
            result += String.fromCharCode(charCode);
        }

        return btoa(result); // Base64 encode
    }

    static deobfuscate(obfuscatedKey) {
        if (!obfuscatedKey || typeof obfuscatedKey !== 'string') return '';

        try {
            const decoded = atob(obfuscatedKey); // Base64 decode
            const obfuscationKey = 'DualSubAIContext2024';
            let result = '';

            for (let i = 0; i < decoded.length; i++) {
                const charCode =
                    decoded.charCodeAt(i) ^
                    obfuscationKey.charCodeAt(i % obfuscationKey.length);
                result += String.fromCharCode(charCode);
            }

            return result;
        } catch (error) {
            logger.error('Failed to deobfuscate API key', error);
            return '';
        }
    }
}

/**
 * API Key Manager class
 */
export class APIKeyManager {
    constructor() {
        this.cache = new Map();
        this.validationCache = new Map();
    }

    /**
     * Store an API key securely
     * @param {string} provider - Provider name (openai, gemini, etc.)
     * @param {string} apiKey - The API key to store
     * @returns {Promise<boolean>} Success status
     */
    async storeAPIKey(provider, apiKey) {
        try {
            if (!provider || !apiKey) {
                throw new Error('Provider and API key are required');
            }

            // Validate API key format
            const isValid = this.validateAPIKeyFormat(provider, apiKey);
            if (!isValid) {
                throw new Error(
                    `Invalid API key format for provider: ${provider}`
                );
            }

            const obfuscatedKey = APIKeyObfuscator.obfuscate(apiKey);
            const configKey = `${provider}ApiKey`;
            await configService.set(configKey, obfuscatedKey);

            this.cache.set(provider, apiKey);
            this.validationCache.set(provider, true);

            logger.info('API key stored successfully', {
                provider,
                keyLength: apiKey.length,
                keyPrefix: apiKey.substring(0, 8) + '...',
            });

            return true;
        } catch (error) {
            logger.error('Failed to store API key', error, {
                provider,
                keyLength: apiKey?.length || 0,
            });
            return false;
        }
    }

    /**
     * Retrieve an API key
     * @param {string} provider - Provider name
     * @returns {Promise<string>} The API key or empty string if not found
     */
    async getAPIKey(provider) {
        try {
            if (this.cache.has(provider)) {
                return this.cache.get(provider);
            }

            // Get from configuration
            const configKey = `${provider}ApiKey`;
            const obfuscatedKey = await configService.get(configKey);

            if (!obfuscatedKey) {
                return '';
            }

            // Deobfuscate the key
            const apiKey = APIKeyObfuscator.deobfuscate(obfuscatedKey);

            // Validate and cache
            if (apiKey && this.validateAPIKeyFormat(provider, apiKey)) {
                this.cache.set(provider, apiKey);
                this.validationCache.set(provider, true);
                return apiKey;
            }

            logger.warn('Retrieved API key failed validation', {
                provider,
                hasKey: !!apiKey,
            });

            return '';
        } catch (error) {
            logger.error('Failed to retrieve API key', error, { provider });
            return '';
        }
    }

    /**
     * Check if an API key exists for a provider
     * @param {string} provider - Provider name
     * @returns {Promise<boolean>} True if API key exists and is valid
     */
    async hasValidAPIKey(provider) {
        try {
            // Check validation cache first
            if (this.validationCache.has(provider)) {
                return this.validationCache.get(provider);
            }

            const apiKey = await this.getAPIKey(provider);
            const isValid =
                !!apiKey && this.validateAPIKeyFormat(provider, apiKey);

            this.validationCache.set(provider, isValid);
            return isValid;
        } catch (error) {
            logger.error('Failed to check API key validity', error, {
                provider,
            });
            return false;
        }
    }

    /**
     * Remove an API key
     * @param {string} provider - Provider name
     * @returns {Promise<boolean>} Success status
     */
    async removeAPIKey(provider) {
        try {
            const configKey = `${provider}ApiKey`;
            await configService.set(configKey, '');

            // Clear cache
            this.cache.delete(provider);
            this.validationCache.delete(provider);

            logger.info('API key removed', { provider });
            return true;
        } catch (error) {
            logger.error('Failed to remove API key', error, { provider });
            return false;
        }
    }

    /**
     * Validate API key format
     * @param {string} provider - Provider name
     * @param {string} apiKey - API key to validate
     * @returns {boolean} True if format is valid
     */
    validateAPIKeyFormat(provider, apiKey) {
        if (!apiKey || typeof apiKey !== 'string') {
            return false;
        }

        const pattern = API_KEY_PATTERNS[provider];
        if (!pattern) {
            logger.warn('No validation pattern for provider', { provider });
            return apiKey.length > 10; // Basic length check
        }

        return pattern.test(apiKey);
    }

    /**
     * Mask an API key for display purposes
     * @param {string} apiKey - API key to mask
     * @returns {string} Masked API key
     */
    maskAPIKey(apiKey) {
        if (!apiKey || typeof apiKey !== 'string') {
            return '';
        }

        if (apiKey.length <= 8) {
            return '*'.repeat(apiKey.length);
        }

        const start = apiKey.substring(0, 4);
        const end = apiKey.substring(apiKey.length - 4);
        const middle = '*'.repeat(Math.max(4, apiKey.length - 8));

        return `${start}${middle}${end}`;
    }

    /**
     * Get API key status for all providers
     * @returns {Promise<Object>} Status object with provider validity
     */
    async getAPIKeyStatus() {
        const status = {};
        const providers = ['openai', 'gemini', 'deepl'];

        for (const provider of providers) {
            try {
                const hasKey = await this.hasValidAPIKey(provider);
                const apiKey = hasKey ? await this.getAPIKey(provider) : '';

                status[provider] = {
                    hasValidKey: hasKey,
                    keyMask: hasKey ? this.maskAPIKey(apiKey) : '',
                    keyLength: apiKey.length,
                };
            } catch (error) {
                status[provider] = {
                    hasValidKey: false,
                    keyMask: '',
                    keyLength: 0,
                    error: error.message,
                };
            }
        }

        return status;
    }

    /**
     * Clear all cached API keys
     */
    clearCache() {
        this.cache.clear();
        this.validationCache.clear();
        logger.info('API key cache cleared');
    }

    /**
     * Test an API key by making a simple request
     * @param {string} provider - Provider name
     * @param {string} apiKey - API key to test (optional, uses stored key if not provided)
     * @returns {Promise<Object>} Test result
     */
    async testAPIKey(provider, apiKey = null) {
        try {
            const keyToTest = apiKey || (await this.getAPIKey(provider));

            if (!keyToTest) {
                return {
                    success: false,
                    error: 'No API key provided or stored',
                };
            }

            // Format validation
            if (!this.validateAPIKeyFormat(provider, keyToTest)) {
                return {
                    success: false,
                    error: 'Invalid API key format',
                };
            }

            // For now, just return format validation
            // In a real implementation, you might make a test API call
            return {
                success: true,
                message: 'API key format is valid',
                provider,
                keyMask: this.maskAPIKey(keyToTest),
            };
        } catch (error) {
            logger.error('API key test failed', error, { provider });
            return {
                success: false,
                error: error.message,
            };
        }
    }
}

// Export singleton instance
export const apiKeyManager = new APIKeyManager();
