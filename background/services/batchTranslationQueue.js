/**
 * Batch Translation Queue Manager
 *
 * Extends existing subtitle queue processing with batch translation capabilities.
 * Integrates with existing processSubtitleQueue() from shared utilities.
 *
 * @author DualSub Extension
 * @version 2.0.0
 */

import { loggingManager } from '../utils/loggingManager.js';
import { configService } from '../../services/configService.js';

class BatchTranslationQueue {
    constructor() {
        this.logger = loggingManager.createLogger('BatchTranslationQueue');
        this.activeBatches = new Map();
        this.pendingCues = [];
        this.processingBatch = false;
        this.config = {
            batchSize: 3,
            maxConcurrentBatches: 2,
            smartBatching: true,
            batchProcessingDelay: 100,
            translationDelay: 150,
        };
        this.performanceMetrics = {
            totalBatches: 0,
            totalCues: 0,
            averageBatchSize: 0,
            averageProcessingTime: 0,
            apiCallReduction: 0,
        };
    }

    /**
     * Initialize batch translation queue
     */
    async initialize() {
        try {
            // Load configuration from configService
            await this.loadConfiguration();

            // Listen for configuration changes
            configService.onChanged((changes) => {
                this.handleConfigurationChange(changes);
            });

            this.logger.info('Batch translation queue initialized', {
                config: this.config,
                maxConcurrentBatches: this.config.maxConcurrentBatches,
            });
        } catch (error) {
            this.logger.error(
                'Failed to initialize batch translation queue',
                error
            );
            throw error;
        }
    }

    /**
     * Load configuration from configService
     */
    async loadConfiguration() {
        try {
            this.config.batchSize =
                (await configService.get('translationBatchSize')) || 3;
            this.config.maxConcurrentBatches =
                (await configService.get('maxConcurrentBatches')) || 2;
            this.config.smartBatching =
                (await configService.get('smartBatching')) !== false;
            this.config.batchProcessingDelay =
                (await configService.get('batchProcessingDelay')) || 100;
            this.config.translationDelay =
                (await configService.get('translationDelay')) || 150;

            this.logger.debug('Configuration loaded', { config: this.config });
        } catch (error) {
            this.logger.warn(
                'Failed to load configuration, using defaults',
                error
            );
        }
    }

    /**
     * Handle configuration changes
     */
    handleConfigurationChange(changes) {
        let configChanged = false;

        if ('translationBatchSize' in changes) {
            this.config.batchSize = changes.translationBatchSize;
            configChanged = true;
        }
        if ('maxConcurrentBatches' in changes) {
            this.config.maxConcurrentBatches = changes.maxConcurrentBatches;
            configChanged = true;
        }
        if ('smartBatching' in changes) {
            this.config.smartBatching = changes.smartBatching;
            configChanged = true;
        }
        if ('batchProcessingDelay' in changes) {
            this.config.batchProcessingDelay = changes.batchProcessingDelay;
            configChanged = true;
        }
        if ('translationDelay' in changes) {
            this.config.translationDelay = changes.translationDelay;
            configChanged = true;
        }

        if (configChanged) {
            this.logger.info('Configuration updated', {
                newConfig: this.config,
            });
        }
    }

    /**
     * Add cues to batch processing queue
     * @param {Array} cues - Array of cues to process
     * @param {Object} context - Processing context
     */
    async addCuesToBatch(cues, context = {}) {
        if (!Array.isArray(cues) || cues.length === 0) {
            return;
        }

        this.logger.debug('Adding cues to batch queue', {
            cueCount: cues.length,
            context,
        });

        // Add cues to pending queue with metadata
        const enrichedCues = cues.map((cue) => ({
            ...cue,
            addedAt: Date.now(),
            context,
            priority: this.calculateCuePriority(cue, context),
        }));

        this.pendingCues.push(...enrichedCues);

        // Process batches if not already processing
        if (!this.processingBatch) {
            await this.processBatches();
        }
    }

    /**
     * Calculate priority for a cue (for smart batching)
     * @param {Object} cue - Subtitle cue
     * @param {Object} context - Processing context
     * @returns {number} Priority score (higher = more important)
     */
    calculateCuePriority(cue, context) {
        if (!this.config.smartBatching) {
            return 1; // Default priority
        }

        let priority = 1;
        const currentTime = context.currentTime || 0;
        const timeDiff = Math.abs(cue.start - currentTime);

        // Prioritize cues closer to current playback time
        if (timeDiff < 5) {
            // Within 5 seconds
            priority += 10;
        } else if (timeDiff < 15) {
            // Within 15 seconds
            priority += 5;
        } else if (timeDiff < 30) {
            // Within 30 seconds
            priority += 2;
        }

        // Prioritize visible cues
        if (cue.start <= currentTime && cue.end >= currentTime) {
            priority += 20; // Currently visible
        }

        return priority;
    }

    /**
     * Process batches from pending queue
     */
    async processBatches() {
        if (this.processingBatch || this.pendingCues.length === 0) {
            return;
        }

        this.processingBatch = true;

        try {
            while (
                this.pendingCues.length > 0 &&
                this.activeBatches.size < this.config.maxConcurrentBatches
            ) {
                const batch = this.createBatch();
                if (batch.length > 0) {
                    await this.processBatch(batch);

                    // Add delay between batches
                    if (this.config.batchProcessingDelay > 0) {
                        await new Promise((resolve) =>
                            setTimeout(
                                resolve,
                                this.config.batchProcessingDelay
                            )
                        );
                    }
                }
            }
        } catch (error) {
            this.logger.error('Error processing batches', error);
        } finally {
            this.processingBatch = false;
        }
    }

    /**
     * Create a batch from pending cues
     * @returns {Array} Batch of cues
     */
    createBatch() {
        if (this.pendingCues.length === 0) {
            return [];
        }

        // Sort by priority if smart batching is enabled
        if (this.config.smartBatching) {
            this.pendingCues.sort((a, b) => b.priority - a.priority);
        }

        // Take up to batchSize cues
        const batchSize = Math.min(
            this.config.batchSize,
            this.pendingCues.length
        );
        const batch = this.pendingCues.splice(0, batchSize);

        this.logger.debug('Created batch', {
            batchSize: batch.length,
            remainingCues: this.pendingCues.length,
            smartBatching: this.config.smartBatching,
        });

        return batch;
    }

    /**
     * Process a single batch
     * @param {Array} batch - Batch of cues to process
     */
    async processBatch(batch) {
        const batchId = this.generateBatchId();
        const startTime = Date.now();

        this.activeBatches.set(batchId, {
            cues: batch,
            startTime,
            status: 'processing',
        });

        try {
            this.logger.info('Processing batch', {
                batchId,
                cueCount: batch.length,
                activeBatches: this.activeBatches.size,
            });

            // Check if provider supports batch processing
            const supportsBatch = await this.checkBatchSupport();

            if (supportsBatch && batch.length > 1) {
                await this.processBatchTranslation(batchId, batch);
            } else {
                await this.processIndividualTranslations(batchId, batch);
            }

            // Update performance metrics
            const processingTime = Date.now() - startTime;
            this.updatePerformanceMetrics(
                batch.length,
                processingTime,
                supportsBatch
            );

            this.logger.info('Batch processing completed', {
                batchId,
                processingTime,
                cueCount: batch.length,
                method: supportsBatch ? 'batch' : 'individual',
            });
        } catch (error) {
            this.logger.error('Batch processing failed', error, { batchId });

            // Fallback to individual processing
            if (batch.length > 1) {
                this.logger.info('Falling back to individual processing', {
                    batchId,
                });
                await this.processIndividualTranslations(batchId, batch);
            }
        } finally {
            this.activeBatches.delete(batchId);
        }
    }

    /**
     * Check if current provider supports batch processing
     * @returns {Promise<boolean>} True if batch processing is supported
     */
    async checkBatchSupport() {
        try {
            // Send message to background to check batch support
            return new Promise((resolve) => {
                chrome.runtime.sendMessage(
                    { action: 'checkBatchSupport' },
                    (response) => {
                        resolve(response?.supportsBatch || false);
                    }
                );
            });
        } catch (error) {
            this.logger.warn('Failed to check batch support', error);
            return false;
        }
    }

    /**
     * Process batch translation (multiple cues in one request)
     * @param {string} batchId - Batch identifier
     * @param {Array} batch - Batch of cues
     */
    async processBatchTranslation(batchId, batch) {
        const texts = batch.map((cue) => cue.original);
        const delimiter = '|SUBTITLE_BREAK|';
        const combinedText = texts.join(delimiter);

        this.logger.debug('Sending batch translation request', {
            batchId,
            textCount: texts.length,
            combinedLength: combinedText.length,
        });

        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(
                {
                    action: 'translateBatch',
                    texts: texts,
                    delimiter: delimiter,
                    targetLang: batch[0].context.targetLanguage || 'zh-CN',
                    batchId: batchId,
                    cueMetadata: batch.map((cue) => ({
                        start: cue.start,
                        videoId: cue.videoId,
                    })),
                },
                (response) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else if (response?.error) {
                        reject(new Error(response.error));
                    } else if (response?.translations) {
                        this.handleBatchTranslationResponse(
                            batch,
                            response.translations
                        );
                        resolve(response);
                    } else {
                        reject(new Error('Invalid batch translation response'));
                    }
                }
            );
        });
    }

    /**
     * Process individual translations (fallback method)
     * @param {string} batchId - Batch identifier
     * @param {Array} batch - Batch of cues
     */
    async processIndividualTranslations(batchId, batch) {
        this.logger.debug('Processing individual translations', {
            batchId,
            cueCount: batch.length,
        });

        for (const cue of batch) {
            try {
                await new Promise((resolve, reject) => {
                    chrome.runtime.sendMessage(
                        {
                            action: 'translate',
                            text: cue.original,
                            targetLang: cue.context.targetLanguage || 'zh-CN',
                            cueStart: cue.start,
                            cueVideoId: cue.videoId,
                        },
                        (response) => {
                            if (chrome.runtime.lastError) {
                                reject(
                                    new Error(chrome.runtime.lastError.message)
                                );
                            } else if (response?.error) {
                                reject(new Error(response.error));
                            } else if (response?.translatedText) {
                                cue.translated = response.translatedText;
                                resolve(response);
                            } else {
                                reject(
                                    new Error('Invalid translation response')
                                );
                            }
                        }
                    );
                });

                // Add delay between individual translations
                if (this.config.translationDelay > 0) {
                    await new Promise((resolve) =>
                        setTimeout(resolve, this.config.translationDelay)
                    );
                }
            } catch (error) {
                this.logger.error('Individual translation failed', error, {
                    cueStart: cue.start,
                    text: cue.original.substring(0, 50),
                });
            }
        }
    }

    /**
     * Handle batch translation response
     * @param {Array} batch - Original batch of cues
     * @param {Array} translations - Translated texts
     */
    handleBatchTranslationResponse(batch, translations) {
        if (translations.length !== batch.length) {
            this.logger.warn('Batch translation count mismatch', {
                expectedCount: batch.length,
                receivedCount: translations.length,
            });
        }

        for (let i = 0; i < Math.min(batch.length, translations.length); i++) {
            batch[i].translated = translations[i];
        }
    }

    /**
     * Update performance metrics
     * @param {number} cueCount - Number of cues processed
     * @param {number} processingTime - Processing time in milliseconds
     * @param {boolean} usedBatch - Whether batch processing was used
     */
    updatePerformanceMetrics(cueCount, processingTime, usedBatch) {
        this.performanceMetrics.totalBatches++;
        this.performanceMetrics.totalCues += cueCount;

        // Update average batch size
        this.performanceMetrics.averageBatchSize =
            this.performanceMetrics.totalCues /
            this.performanceMetrics.totalBatches;

        // Update average processing time
        const totalBatches = this.performanceMetrics.totalBatches;
        const currentAvg = this.performanceMetrics.averageProcessingTime;
        this.performanceMetrics.averageProcessingTime =
            (currentAvg * (totalBatches - 1) + processingTime) / totalBatches;

        // Calculate API call reduction (batch vs individual)
        if (usedBatch && cueCount > 1) {
            const apiCallsSaved = cueCount - 1; // 1 batch call vs N individual calls
            this.performanceMetrics.apiCallReduction += apiCallsSaved;
        }
    }

    /**
     * Generate unique batch ID
     * @returns {string} Batch ID
     */
    generateBatchId() {
        return `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Get performance metrics
     * @returns {Object} Performance metrics
     */
    getPerformanceMetrics() {
        return {
            ...this.performanceMetrics,
            activeBatches: this.activeBatches.size,
            pendingCues: this.pendingCues.length,
            apiCallReductionPercentage:
                this.performanceMetrics.totalCues > 0
                    ? (this.performanceMetrics.apiCallReduction /
                          this.performanceMetrics.totalCues) *
                      100
                    : 0,
        };
    }

    /**
     * Clear pending queue
     */
    clearQueue() {
        this.pendingCues = [];
        this.logger.debug('Batch queue cleared');
    }
}

// Export singleton instance
export const batchTranslationQueue = new BatchTranslationQueue();
