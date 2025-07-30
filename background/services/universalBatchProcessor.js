/**
 * Universal Batch Translation Processor
 * 
 * Provider-agnostic batch translation system that works with ALL translation providers.
 * Handles preprocessing (individual → batch) and postprocessing (batch → individual).
 * 
 * @author DualSub Extension
 * @version 2.0.0
 */

import { loggingManager } from '../utils/loggingManager.js';
import { configService } from '../../services/configService.js';
import { performanceMonitor } from '../utils/performanceMonitor.js';

/**
 * Provider-specific batch configuration
 */
const PROVIDER_BATCH_CONFIGS = {
    openai_compatible: {
        defaultBatchSize: 8,
        maxBatchSize: 15,
        delimiter: '|SUBTITLE_BREAK|',
        supportsBatch: true,
        batchMethod: 'delimiter',
        mandatoryDelay: 100, // 100ms between requests
        batchDelay: 50 // Shorter delay for batch processing
    },
    google: {
        defaultBatchSize: 4,
        maxBatchSize: 8,
        delimiter: '\n---SUBTITLE---\n',
        supportsBatch: false, // Will use simulated batch
        batchMethod: 'simulated',
        mandatoryDelay: 1500, // 1.5 seconds between requests (Google's requirement)
        batchDelay: 1500 // Same delay for batch processing to prevent lockouts
    },
    deepl: {
        defaultBatchSize: 3,
        maxBatchSize: 6,
        delimiter: '\n[SUBTITLE]\n',
        supportsBatch: false, // Will use simulated batch
        batchMethod: 'simulated',
        mandatoryDelay: 500, // 500ms between requests
        batchDelay: 500 // Same delay for batch processing
    },
    deepl_free: {
        defaultBatchSize: 2,
        maxBatchSize: 4,
        delimiter: '\n[SUBTITLE]\n',
        supportsBatch: false, // Will use simulated batch
        batchMethod: 'simulated',
        mandatoryDelay: 2000, // 2 seconds between requests (more conservative for free tier)
        batchDelay: 2000 // Same delay for batch processing
    },
    microsoft_edge_auth: {
        defaultBatchSize: 4,
        maxBatchSize: 8,
        delimiter: '\n||SUBTITLE||\n',
        supportsBatch: false, // Will use simulated batch
        batchMethod: 'simulated',
        mandatoryDelay: 800, // 800ms between requests (Microsoft's requirement)
        batchDelay: 800 // Same delay for batch processing
    }
};

/**
 * Universal Batch Processor
 */
class UniversalBatchProcessor {
    constructor() {
        this.logger = loggingManager.createLogger('UniversalBatchProcessor');
        this.config = {
            globalBatchSize: 5,
            batchingEnabled: true,
            useProviderDefaults: true
        };
        this.performanceMetrics = {
            totalBatches: 0,
            totalTexts: 0,
            apiCallsSaved: 0,
            averageProcessingTime: 0
        };
    }

    /**
     * Initialize the batch processor
     */
    async initialize() {
        try {
            // Load configuration
            await this.loadConfiguration();
            
            // Listen for configuration changes
            configService.onChanged((changes) => {
                this.handleConfigurationChange(changes);
            });

            this.logger.info('Universal batch processor initialized', {
                config: this.config,
                providerConfigs: Object.keys(PROVIDER_BATCH_CONFIGS).length
            });
        } catch (error) {
            this.logger.error('Failed to initialize universal batch processor', error);
            throw error;
        }
    }

    /**
     * Load configuration from configService
     */
    async loadConfiguration() {
        try {
            this.config.globalBatchSize = await configService.get('globalBatchSize') || 5;
            this.config.batchingEnabled = await configService.get('batchingEnabled') !== false;
            this.config.useProviderDefaults = await configService.get('useProviderDefaults') !== false;

            this.logger.debug('Configuration loaded', { config: this.config });
        } catch (error) {
            this.logger.warn('Failed to load configuration, using defaults', error);
        }
    }

    /**
     * Handle configuration changes
     */
    handleConfigurationChange(changes) {
        let configChanged = false;

        if ('globalBatchSize' in changes) {
            this.config.globalBatchSize = changes.globalBatchSize;
            configChanged = true;
        }
        if ('batchingEnabled' in changes) {
            this.config.batchingEnabled = changes.batchingEnabled;
            configChanged = true;
        }
        if ('useProviderDefaults' in changes) {
            this.config.useProviderDefaults = changes.useProviderDefaults;
            configChanged = true;
        }

        if (configChanged) {
            this.logger.info('Configuration updated', { newConfig: this.config });
        }
    }

    /**
     * Get effective batch size for a provider
     * @param {string} providerId - Provider identifier
     * @returns {number} Effective batch size
     */
    getEffectiveBatchSize(providerId) {
        if (!this.config.batchingEnabled) {
            return 1; // Disable batching
        }

        const providerConfig = PROVIDER_BATCH_CONFIGS[providerId];
        if (!providerConfig) {
            return this.config.globalBatchSize;
        }

        if (this.config.useProviderDefaults) {
            return providerConfig.defaultBatchSize;
        }

        // Use global setting but respect provider max
        return Math.min(this.config.globalBatchSize, providerConfig.maxBatchSize);
    }

    /**
     * Check if provider supports native batch processing
     * @param {string} providerId - Provider identifier
     * @returns {boolean} True if provider supports native batching
     */
    providerSupportsBatch(providerId) {
        const providerConfig = PROVIDER_BATCH_CONFIGS[providerId];
        return providerConfig ? providerConfig.supportsBatch : false;
    }

    /**
     * Preprocess texts for batch translation
     * @param {Array<string>} texts - Individual texts to batch
     * @param {string} providerId - Provider identifier
     * @returns {Object} Batch processing result
     */
    preprocessForBatch(texts, providerId) {
        const timerId = performanceMonitor.startTiming('batch_preprocessing', {
            provider: providerId,
            textCount: texts.length
        });

        try {
            const batchSize = this.getEffectiveBatchSize(providerId);
            const providerConfig = PROVIDER_BATCH_CONFIGS[providerId] || {};
            
            if (batchSize === 1 || texts.length === 1) {
                // No batching needed
                performanceMonitor.endTiming(timerId);
                return {
                    batches: texts.map(text => ({ texts: [text], combined: text })),
                    batchMethod: 'individual',
                    delimiter: null
                };
            }

            const batches = [];
            for (let i = 0; i < texts.length; i += batchSize) {
                const batchTexts = texts.slice(i, i + batchSize);
                
                if (providerConfig.supportsBatch && batchTexts.length > 1) {
                    // Native batch processing
                    const combined = batchTexts.join(providerConfig.delimiter);
                    batches.push({
                        texts: batchTexts,
                        combined,
                        delimiter: providerConfig.delimiter,
                        method: 'native'
                    });
                } else {
                    // Simulated batch (rapid individual requests)
                    batches.push({
                        texts: batchTexts,
                        combined: null,
                        delimiter: null,
                        method: 'simulated'
                    });
                }
            }

            performanceMonitor.endTiming(timerId);

            this.logger.debug('Batch preprocessing completed', {
                provider: providerId,
                originalCount: texts.length,
                batchCount: batches.length,
                batchSize,
                method: providerConfig.batchMethod || 'simulated'
            });

            return {
                batches,
                batchMethod: providerConfig.batchMethod || 'simulated',
                delimiter: providerConfig.delimiter
            };

        } catch (error) {
            performanceMonitor.endTiming(timerId);
            this.logger.error('Batch preprocessing failed', error, {
                provider: providerId,
                textCount: texts.length
            });
            throw error;
        }
    }

    /**
     * Postprocess batch translation results
     * @param {Array} batchResults - Results from batch translation
     * @param {Object} preprocessResult - Result from preprocessing
     * @returns {Array<string>} Individual translation results
     */
    postprocessBatchResults(batchResults, preprocessResult) {
        const timerId = performanceMonitor.startTiming('batch_postprocessing', {
            batchCount: batchResults.length,
            method: preprocessResult.batchMethod
        });

        try {
            const individualResults = [];

            for (let i = 0; i < batchResults.length; i++) {
                const batchResult = batchResults[i];
                const batch = preprocessResult.batches[i];

                if (batch.method === 'native' && batch.delimiter) {
                    // Split native batch result
                    const splitResults = this.splitBatchResult(
                        batchResult, 
                        batch.delimiter, 
                        batch.texts.length
                    );
                    individualResults.push(...splitResults);
                } else {
                    // Simulated batch - results are already individual
                    if (Array.isArray(batchResult)) {
                        individualResults.push(...batchResult);
                    } else {
                        individualResults.push(batchResult);
                    }
                }
            }

            performanceMonitor.endTiming(timerId);

            // Update performance metrics
            this.updatePerformanceMetrics(preprocessResult.batches, individualResults);

            this.logger.debug('Batch postprocessing completed', {
                batchCount: batchResults.length,
                individualCount: individualResults.length,
                method: preprocessResult.batchMethod
            });

            return individualResults;

        } catch (error) {
            performanceMonitor.endTiming(timerId);
            this.logger.error('Batch postprocessing failed', error);
            throw error;
        }
    }

    /**
     * Split batch translation result back to individual texts
     * @param {string} batchResult - Combined batch result
     * @param {string} delimiter - Delimiter used for batching
     * @param {number} expectedCount - Expected number of individual results
     * @returns {Array<string>} Individual translation results
     */
    splitBatchResult(batchResult, delimiter, expectedCount) {
        if (!batchResult || typeof batchResult !== 'string') {
            this.logger.warn('Invalid batch result for splitting', {
                resultType: typeof batchResult,
                expectedCount
            });
            return new Array(expectedCount).fill('');
        }

        const results = batchResult
            .split(delimiter)
            .map(text => text.trim())
            .filter(text => text.length > 0);

        // Ensure we have the expected number of results
        while (results.length < expectedCount) {
            results.push('');
        }

        if (results.length > expectedCount) {
            results.splice(expectedCount);
        }

        return results;
    }

    /**
     * Update performance metrics
     * @param {Array} batches - Batch information
     * @param {Array} results - Individual results
     */
    updatePerformanceMetrics(batches, results) {
        this.performanceMetrics.totalBatches += batches.length;
        this.performanceMetrics.totalTexts += results.length;

        // Calculate API calls saved
        const totalTexts = results.length;
        const actualApiCalls = batches.length;
        const wouldBeApiCalls = totalTexts;
        this.performanceMetrics.apiCallsSaved += (wouldBeApiCalls - actualApiCalls);
    }

    /**
     * Get provider batch configuration
     * @param {string} providerId - Provider identifier
     * @returns {Object} Provider batch configuration
     */
    getProviderBatchConfig(providerId) {
        return PROVIDER_BATCH_CONFIGS[providerId] || {
            defaultBatchSize: this.config.globalBatchSize,
            maxBatchSize: this.config.globalBatchSize,
            delimiter: '\n---\n',
            supportsBatch: false,
            batchMethod: 'simulated'
        };
    }

    /**
     * Get all provider batch configurations
     * @returns {Object} All provider configurations
     */
    getAllProviderConfigs() {
        return { ...PROVIDER_BATCH_CONFIGS };
    }

    /**
     * Get performance metrics
     * @returns {Object} Performance metrics
     */
    getPerformanceMetrics() {
        return {
            ...this.performanceMetrics,
            apiCallReductionPercentage: this.performanceMetrics.totalTexts > 0
                ? (this.performanceMetrics.apiCallsSaved / this.performanceMetrics.totalTexts) * 100
                : 0
        };
    }

    /**
     * Reset performance metrics
     */
    resetPerformanceMetrics() {
        this.performanceMetrics = {
            totalBatches: 0,
            totalTexts: 0,
            apiCallsSaved: 0,
            averageProcessingTime: 0
        };
        this.logger.debug('Performance metrics reset');
    }

    /**
     * Process texts using universal batch translation
     * @param {Array<string>} texts - Texts to translate
     * @param {string} sourceLang - Source language
     * @param {string} targetLang - Target language
     * @param {string} providerId - Provider identifier
     * @param {Object} translationService - Translation service instance
     * @param {Object} options - Processing options
     * @returns {Promise<Array<string>>} Translated texts
     */
    async processTexts(texts, sourceLang, targetLang, providerId, translationService, options = {}) {
        const startTime = Date.now();

        try {
            this.logger.info('Universal batch processing started', {
                provider: providerId,
                textCount: texts.length,
                sourceLang,
                targetLang
            });

            // Preprocess texts into batches
            const preprocessResult = this.preprocessForBatch(texts, providerId);

            // Process each batch
            const batchResults = [];
            for (const batch of preprocessResult.batches) {
                if (batch.method === 'native' && batch.combined) {
                    // Use native batch processing
                    const provider = translationService.providers[providerId];
                    if (provider.translateBatch) {
                        const result = await provider.translateBatch(
                            batch.texts,
                            sourceLang,
                            targetLang,
                            batch.delimiter
                        );
                        batchResults.push(result);
                    } else {
                        // Fallback to individual processing
                        const individualResults = await this.processIndividualBatch(
                            batch.texts, sourceLang, targetLang, translationService, options
                        );
                        batchResults.push(individualResults);
                    }
                } else {
                    // Use simulated batch (rapid individual requests)
                    const individualResults = await this.processIndividualBatch(
                        batch.texts, sourceLang, targetLang, translationService, options
                    );
                    batchResults.push(individualResults);
                }
            }

            // Postprocess batch results back to individual translations
            const finalResults = this.postprocessBatchResults(batchResults, preprocessResult);

            const processingTime = Date.now() - startTime;
            this.logger.info('Universal batch processing completed', {
                provider: providerId,
                originalCount: texts.length,
                translatedCount: finalResults.length,
                processingTime,
                batchMethod: preprocessResult.batchMethod
            });

            return finalResults;

        } catch (error) {
            this.logger.error('Universal batch processing failed', error, {
                provider: providerId,
                textCount: texts.length
            });

            // Fallback to individual translations
            return await this.processIndividualBatch(
                texts, sourceLang, targetLang, translationService, options
            );
        }
    }

    /**
     * Process individual batch (for simulated batching)
     * @param {Array<string>} texts - Texts to translate
     * @param {string} sourceLang - Source language
     * @param {string} targetLang - Target language
     * @param {Object} translationService - Translation service instance
     * @param {Object} options - Translation options
     * @returns {Promise<Array<string>>} Translated texts
     */
    async processIndividualBatch(texts, sourceLang, targetLang, translationService, options = {}) {
        const results = [];
        const providerId = translationService.currentProviderId;
        const providerConfig = this.getProviderBatchConfig(providerId);

        // Use provider-specific batch delay or fallback to configured delay
        const providerDelay = providerConfig.batchDelay || providerConfig.mandatoryDelay || 50;
        const delay = options.batchDelay || providerDelay;

        this.logger.debug('Processing individual batch with provider-specific delays', {
            provider: providerId,
            textCount: texts.length,
            providerDelay,
            finalDelay: delay
        });

        for (let i = 0; i < texts.length; i++) {
            try {
                const translated = await translationService.translate(texts[i], sourceLang, targetLang, {
                    ...options,
                    skipCache: false,
                    allowRetry: false // Avoid nested retries in batch
                });
                results.push(translated);

                // Add delay between requests to prevent account lockouts
                // Note: translate() method already applies mandatory delay, but we add extra delay for batch safety
                if (i < texts.length - 1 && delay > 0) {
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            } catch (error) {
                this.logger.error('Individual translation failed in batch', error, {
                    textIndex: i,
                    text: texts[i].substring(0, 50)
                });
                results.push(texts[i]); // Use original text as fallback
            }
        }

        return results;
    }
}

// Export singleton instance
export const universalBatchProcessor = new UniversalBatchProcessor();
