/**
 * Translation Service
 * 
 * Manages translation providers and coordinates translation requests.
 * Will be enhanced with batch processing in Phase 4.
 * 
 * @author DualSub Extension
 * @version 2.0.0
 */

import { translate as googleTranslate } from '../../translation_providers/googleTranslate.js';
import { translate as microsoftTranslateEdgeAuth } from '../../translation_providers/microsoftTranslateEdgeAuth.js';
import { translate as deeplTranslate } from '../../translation_providers/deeplTranslate.js';
import { translate as deeplTranslateFree } from '../../translation_providers/deeplTranslateFree.js';
import { configService } from '../../services/configService.js';
import { loggingManager } from '../utils/loggingManager.js';

class TranslationService {
    constructor() {
        this.logger = null;
        this.currentProviderId = 'deepl_free';
        this.providers = {
            google: {
                name: 'Google Translate (Free)',
                translate: googleTranslate,
            },
            microsoft_edge_auth: {
                name: 'Microsoft Translate (Free)',
                translate: microsoftTranslateEdgeAuth,
            },
            deepl: {
                name: 'DeepL Translate (API Key Required)',
                translate: deeplTranslate,
            },
            deepl_free: {
                name: 'DeepL Translate (Free)',
                translate: deeplTranslateFree,
            },
        };
        this.isInitialized = false;
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

        this.isInitialized = true;
        this.logger.info('Translation service initialized');
    }

    /**
     * Translate text using current provider
     * @param {string} text - Text to translate
     * @param {string} sourceLang - Source language code
     * @param {string} targetLang - Target language code
     * @returns {Promise<string>} Translated text
     */
    async translate(text, sourceLang, targetLang) {
        const selectedProvider = this.providers[this.currentProviderId];

        if (!selectedProvider?.translate) {
            this.logger.error('Invalid translation provider', null, {
                providerId: this.currentProviderId,
            });
            throw new Error(`Provider "${this.currentProviderId}" is not configured.`);
        }

        try {
            const translatedText = await selectedProvider.translate(text, sourceLang, targetLang);
            this.logger.debug('Translation completed', {
                provider: this.currentProviderId,
                textLength: text.length,
                translatedLength: translatedText.length,
            });
            return translatedText;
        } catch (error) {
            this.logger.error('Translation failed for provider', error, {
                providerName: selectedProvider.name,
                textPreview: text.substring(0, 50),
            });
            throw error;
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
}

// Export singleton instance
export const translationProviders = new TranslationService();
