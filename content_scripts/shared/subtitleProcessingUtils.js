/**
 * This module provides comprehensive subtitle processing utilities for streaming platforms,
 * including dual subtitle management, official translation parsing, and display logic.
 *
 * @author DualSub Extension
 * @version 1.0.0
 */

// Import consolidated utility functions
import {
    parseTimestampToSeconds,
    sanitizeSubtitleText,
} from './subtitleUtilities.js';

/**
 * Manages dual subtitle processing and display, handling both official and API-based
 * translations, timing synchronization, and display mode switching.
 */
export class SubtitleProcessingManager {
    /**
     * Creates a new `SubtitleProcessingManager` instance.
     * @param {string} platform - The platform name (e.g., 'netflix').
     * @param {Object} [config={}] - Configuration for the manager.
     * @param {boolean} [config.useOfficialTranslations=false] - Whether to use official translations.
     * @param {string} [config.translationProvider='google'] - The translation provider for API translations.
     * @param {string} [config.displayMode='dual'] - The display mode ('dual', 'translated-only', 'original-only').
     * @param {string} [config.targetLanguage='en'] - The target language for translations.
     * @param {number} [config.timeOffset=0] - A time offset for subtitle synchronization.
     * @param {Function} [config.logger] - A logger function.
     */
    constructor(platform, config = {}) {
        this.platform = platform;
        this.config = {
            useOfficialTranslations: false,
            translationProvider: 'google',
            displayMode: 'dual',
            targetLanguage: 'en',
            timeOffset: 0,
            logger: null,
            ...config,
        };

        // Processing state
        this.subtitleQueue = [];
        this.processingQueue = false;
        this.currentVideoId = null;

        // Translation cache
        this.translationCache = new Map();

        // Performance tracking
        this.performanceMetrics = {
            initializationTime: Date.now(),
            totalProcessingTime: 0,
            processedSubtitleCount: 0,
            officialTranslationAttempts: 0,
            officialTranslationSuccesses: 0,
            apiTranslationAttempts: 0,
            apiTranslationSuccesses: 0,
            displayAttempts: 0,
            displaySuccesses: 0,
        };

        // Bind methods
        this.processSubtitleData = this.processSubtitleData.bind(this);
        this.parseOfficialTranslations =
            this.parseOfficialTranslations.bind(this);

        this._logSubtitleProcessing(
            'info',
            'SubtitleProcessingManager initialized.',
            {
                platform: this.platform,
                config: {
                    useOfficialTranslations:
                        this.config.useOfficialTranslations,
                    translationProvider: this.config.translationProvider,
                    displayMode: this.config.displayMode,
                    targetLanguage: this.config.targetLanguage,
                },
                initializationTime: this.performanceMetrics.initializationTime,
            }
        );
    }

    /**
     * Processes raw subtitle data to determine the appropriate display strategy.
     * @param {Object} subtitleData - The raw subtitle data from the platform.
     * @returns {Promise<Object>} A promise that resolves to the processed subtitle result.
     */
    async processSubtitleData(subtitleData) {
        const processingStartTime = performance.now();

        this._logSubtitleProcessing(
            'info',
            'Starting subtitle data processing.',
            {
                videoId: subtitleData.videoId,
                hasOriginal: !!subtitleData.originalCues,
                hasTranslated: !!subtitleData.translatedCues,
                originalCueCount: subtitleData.originalCues?.length || 0,
                translatedCueCount: subtitleData.translatedCues?.length || 0,
                useOfficial: this.config.useOfficialTranslations,
                translationProvider: this.config.translationProvider,
                displayMode: this.config.displayMode,
                targetLanguage: this.config.targetLanguage,
                processingStartTime,
            }
        );

        try {
            this.currentVideoId = subtitleData.videoId;

            const shouldUseOfficial =
                this.config.useOfficialTranslations &&
                subtitleData.translatedCues?.length > 0;

            this._logSubtitleProcessing(
                'info',
                'Subtitle source detection completed.',
                {
                    videoId: subtitleData.videoId,
                    shouldUseOfficial,
                    officialTranslationsAvailable:
                        !!subtitleData.translatedCues?.length,
                    userPreference: this.config.useOfficialTranslations,
                    selectedSource: shouldUseOfficial ? 'official' : 'api',
                }
            );

            let processedResult;
            if (shouldUseOfficial) {
                this.performanceMetrics.officialTranslationAttempts++;
                processedResult =
                    await this._processWithOfficialTranslations(subtitleData);
                this.performanceMetrics.officialTranslationSuccesses++;
            } else {
                this.performanceMetrics.apiTranslationAttempts++;
                processedResult =
                    await this._processWithAPITranslations(subtitleData);
                this.performanceMetrics.apiTranslationSuccesses++;
            }

            this._updateSubtitleQueue(processedResult.cues);

            const processingTime = performance.now() - processingStartTime;
            this.performanceMetrics.totalProcessingTime += processingTime;
            this.performanceMetrics.processedSubtitleCount++;

            this._logSubtitleProcessing(
                'info',
                'Subtitle processing completed successfully.',
                {
                    videoId: subtitleData.videoId,
                    cueCount: processedResult.cues.length,
                    source: shouldUseOfficial ? 'official' : 'api',
                    originalCount: processedResult.originalCount,
                    translatedCount: processedResult.translatedCount,
                    dualCount: processedResult.dualCount,
                    processingTime: `${processingTime.toFixed(2)}ms`,
                    averageProcessingTime: `${(this.performanceMetrics.totalProcessingTime / this.performanceMetrics.processedSubtitleCount).toFixed(2)}ms`,
                    performanceMetrics: {
                        totalProcessed:
                            this.performanceMetrics.processedSubtitleCount,
                        officialAttempts:
                            this.performanceMetrics.officialTranslationAttempts,
                        officialSuccesses:
                            this.performanceMetrics
                                .officialTranslationSuccesses,
                        apiAttempts:
                            this.performanceMetrics.apiTranslationAttempts,
                        apiSuccesses:
                            this.performanceMetrics.apiTranslationSuccesses,
                    },
                }
            );

            return processedResult;
        } catch (error) {
            const processingTime = performance.now() - processingStartTime;

            this._logSubtitleProcessing(
                'error',
                'Error processing subtitle data.',
                {
                    error: error.message,
                    stack: error.stack,
                    videoId: subtitleData.videoId,
                    processingTime: `${processingTime.toFixed(2)}ms`,
                    subtitleDataKeys: Object.keys(subtitleData || {}),
                    hasOriginalCues: !!subtitleData?.originalCues,
                    hasTranslatedCues: !!subtitleData?.translatedCues,
                    configState: {
                        useOfficialTranslations:
                            this.config.useOfficialTranslations,
                        translationProvider: this.config.translationProvider,
                        displayMode: this.config.displayMode,
                    },
                }
            );
            throw error;
        }
    }

    /**
     * Parses official translations from platform-specific data formats.
     * @param {Object} platformData - The platform-specific subtitle data.
     * @param {string} [platform=this.platform] - The platform name for format-specific parsing.
     * @returns {Promise<Array>} A promise that resolves to an array of parsed subtitle cues.
     */
    async parseOfficialTranslations(platformData, platform = this.platform) {
        const parseStartTime = performance.now();

        this._logSubtitleProcessing(
            'info',
            'Starting official translation parsing.',
            {
                platform,
                dataType: typeof platformData,
                dataSize: platformData
                    ? JSON.stringify(platformData).length
                    : 0,
                hasData: !!platformData,
                isArray: Array.isArray(platformData),
                parseStartTime,
            }
        );

        try {
            let parsedCues = [];

            switch (platform.toLowerCase()) {
                case 'netflix':
                    this._logSubtitleProcessing(
                        'debug',
                        'Using Netflix-specific parsing logic.'
                    );
                    parsedCues =
                        await this._parseNetflixOfficialTranslations(
                            platformData
                        );
                    break;
                case 'disneyplus':
                    this._logSubtitleProcessing(
                        'debug',
                        'Using Disney+ specific parsing logic.'
                    );
                    parsedCues =
                        await this._parseDisneyPlusOfficialTranslations(
                            platformData
                        );
                    break;
                default:
                    this._logSubtitleProcessing(
                        'debug',
                        'Using generic parsing logic.',
                        { platform }
                    );
                    parsedCues =
                        await this._parseGenericOfficialTranslations(
                            platformData
                        );
                    break;
            }

            const parseTime = performance.now() - parseStartTime;

            this._logSubtitleProcessing(
                'info',
                'Official translation parsing completed.',
                {
                    platform,
                    success: true,
                    parsedCueCount: parsedCues.length,
                    parseTime: `${parseTime.toFixed(2)}ms`,
                    firstCue:
                        parsedCues.length > 0
                            ? {
                                  start: parsedCues[0].start,
                                  end: parsedCues[0].end,
                                  textLength: parsedCues[0].text?.length || 0,
                              }
                            : null,
                    lastCue:
                        parsedCues.length > 0
                            ? {
                                  start: parsedCues[parsedCues.length - 1]
                                      .start,
                                  end: parsedCues[parsedCues.length - 1].end,
                                  textLength:
                                      parsedCues[parsedCues.length - 1].text
                                          ?.length || 0,
                              }
                            : null,
                }
            );

            return parsedCues;
        } catch (error) {
            const parseTime = performance.now() - parseStartTime;

            this._logSubtitleProcessing(
                'error',
                'Error parsing official translations.',
                {
                    error: error.message,
                    stack: error.stack,
                    platform,
                    parseTime: `${parseTime.toFixed(2)}ms`,
                    dataType: typeof platformData,
                    dataKeys:
                        platformData && typeof platformData === 'object'
                            ? Object.keys(platformData)
                            : null,
                    isArray: Array.isArray(platformData),
                    arrayLength: Array.isArray(platformData)
                        ? platformData.length
                        : null,
                }
            );
            return [];
        }
    }

    /**
     * Updates the subtitle mode between official and API translations.
     * @param {boolean} useOfficial - `true` to use official translations, `false` for API.
     */
    async updateSubtitleMode(useOfficial) {
        const modeChangeTime = Date.now();

        this._logSubtitleProcessing('info', 'Updating subtitle mode.', {
            from: this.config.useOfficialTranslations,
            to: useOfficial,
            modeChangeTime,
            currentVideoId: this.currentVideoId,
            cacheSize: this.translationCache.size,
            queueSize: this.subtitleQueue.length,
        });

        const previousMode = this.config.useOfficialTranslations;
        this.config.useOfficialTranslations = useOfficial;

        const cacheCleared = this.translationCache.size;
        this.translationCache.clear();

        if (previousMode !== useOfficial) {
            this.performanceMetrics.officialTranslationAttempts = 0;
            this.performanceMetrics.officialTranslationSuccesses = 0;
            this.performanceMetrics.apiTranslationAttempts = 0;
            this.performanceMetrics.apiTranslationSuccesses = 0;
        }

        this._logSubtitleProcessing(
            'info',
            'Subtitle mode updated successfully.',
            {
                newMode: useOfficial ? 'official' : 'api',
                previousMode: previousMode ? 'official' : 'api',
                cacheCleared,
                metricsReset: previousMode !== useOfficial,
                reprocessingNeeded: this.subtitleQueue.length > 0,
                timeSinceInit:
                    modeChangeTime - this.performanceMetrics.initializationTime,
            }
        );
    }

    /**
     * Gets the current subtitle queue.
     * @returns {Array} An array of the current subtitle cues.
     */
    getSubtitleQueue() {
        return [...this.subtitleQueue];
    }

    /**
     * Clears the subtitle queue.
     */
    clearSubtitleQueue() {
        this.subtitleQueue = [];
        this._log('debug', 'Subtitle queue cleared.');
    }

    // ========================================
    // PRIVATE PROCESSING METHODS
    // ========================================

    /**
     * Processes subtitles using official platform translations.
     * @private
     * @param {Object} subtitleData - The subtitle data.
     * @returns {Promise<Object>} A promise that resolves to the processing result.
     */
    async _processWithOfficialTranslations(subtitleData) {
        const processStartTime = performance.now();

        this._logSubtitleProcessing(
            'info',
            'Processing with official translations.',
            {
                videoId: subtitleData.videoId,
                originalCueCount: subtitleData.originalCues?.length || 0,
                translatedCueCount: subtitleData.translatedCues?.length || 0,
            }
        );

        try {
            this._logSubtitleProcessing('debug', 'Normalizing original cues.');
            const originalCues = this._normalizeCues(
                subtitleData.originalCues,
                'original'
            );

            this._logSubtitleProcessing(
                'debug',
                'Normalizing translated cues.'
            );
            const translatedCues = this._normalizeCues(
                subtitleData.translatedCues,
                'translated'
            );

            this._logSubtitleProcessing(
                'info',
                'Cue normalization completed.',
                {
                    originalInput: subtitleData.originalCues?.length || 0,
                    originalNormalized: originalCues.length,
                    originalFiltered:
                        (subtitleData.originalCues?.length || 0) -
                        originalCues.length,
                    translatedInput: subtitleData.translatedCues?.length || 0,
                    translatedNormalized: translatedCues.length,
                    translatedFiltered:
                        (subtitleData.translatedCues?.length || 0) -
                        translatedCues.length,
                }
            );

            this._logSubtitleProcessing(
                'debug',
                'Creating dual subtitle cues with official translations.'
            );
            const dualCues = this._createDualSubtitleCues(
                originalCues,
                translatedCues,
                true
            );

            const processTime = performance.now() - processStartTime;

            const result = {
                source: 'official',
                cues: dualCues,
                originalCount: originalCues.length,
                translatedCount: translatedCues.length,
                dualCount: dualCues.length,
            };

            this._logSubtitleProcessing(
                'info',
                'Official translation processing completed.',
                {
                    ...result,
                    processTime: `${processTime.toFixed(2)}ms`,
                    matchingRate:
                        originalCues.length > 0
                            ? `${((dualCues.length / originalCues.length) * 100).toFixed(1)}%`
                            : '0%',
                    averageCueLength:
                        dualCues.length > 0
                            ? (
                                  dualCues.reduce(
                                      (sum, cue) =>
                                          sum +
                                          (cue.original?.length || 0) +
                                          (cue.translated?.length || 0),
                                      0
                                  ) /
                                  (dualCues.length * 2)
                              ).toFixed(1)
                            : 0,
                }
            );

            return result;
        } catch (error) {
            const processTime = performance.now() - processStartTime;

            this._logSubtitleProcessing(
                'error',
                'Error processing with official translations.',
                {
                    error: error.message,
                    stack: error.stack,
                    processTime: `${processTime.toFixed(2)}ms`,
                    videoId: subtitleData.videoId,
                    inputData: {
                        hasOriginal: !!subtitleData.originalCues,
                        hasTranslated: !!subtitleData.translatedCues,
                        originalCount: subtitleData.originalCues?.length || 0,
                        translatedCount:
                            subtitleData.translatedCues?.length || 0,
                    },
                }
            );
            throw error;
        }
    }

    /**
     * Processes subtitles using API-based translations.
     * @private
     * @param {Object} subtitleData - The subtitle data.
     * @returns {Promise<Object>} A promise that resolves to the processing result.
     */
    async _processWithAPITranslations(subtitleData) {
        const processStartTime = performance.now();

        this._logSubtitleProcessing(
            'info',
            'Processing with API translations.',
            {
                videoId: subtitleData.videoId,
                originalCueCount: subtitleData.originalCues?.length || 0,
                translationProvider: this.config.translationProvider,
                targetLanguage: this.config.targetLanguage,
            }
        );

        try {
            this._logSubtitleProcessing(
                'debug',
                'Normalizing original cues for API translation.'
            );
            const originalCues = this._normalizeCues(
                subtitleData.originalCues,
                'original'
            );

            this._logSubtitleProcessing(
                'info',
                'Original cue normalization completed.',
                {
                    originalInput: subtitleData.originalCues?.length || 0,
                    originalNormalized: originalCues.length,
                    originalFiltered:
                        (subtitleData.originalCues?.length || 0) -
                        originalCues.length,
                }
            );

            this._logSubtitleProcessing(
                'debug',
                'Starting API translation process.'
            );
            const translationStartTime = performance.now();
            const translatedCues =
                await this._translateCuesWithAPI(originalCues);
            const translationTime = performance.now() - translationStartTime;

            this._logSubtitleProcessing('info', 'API translation completed.', {
                originalCueCount: originalCues.length,
                translatedCueCount: translatedCues.length,
                translationTime: `${translationTime.toFixed(2)}ms`,
                averageTimePerCue:
                    originalCues.length > 0
                        ? `${(translationTime / originalCues.length).toFixed(2)}ms`
                        : '0ms',
                provider: this.config.translationProvider,
            });

            this._logSubtitleProcessing(
                'debug',
                'Creating dual subtitle cues with API translations.'
            );
            const dualCues = this._createDualSubtitleCues(
                originalCues,
                translatedCues,
                false
            );

            const processTime = performance.now() - processStartTime;

            const result = {
                source: 'api',
                cues: dualCues,
                originalCount: originalCues.length,
                translatedCount: translatedCues.length,
                dualCount: dualCues.length,
            };

            this._logSubtitleProcessing(
                'info',
                'API translation processing completed.',
                {
                    ...result,
                    processTime: `${processTime.toFixed(2)}ms`,
                    translationTime: `${translationTime.toFixed(2)}ms`,
                    matchingRate:
                        originalCues.length > 0
                            ? `${((dualCues.length / originalCues.length) * 100).toFixed(1)}%`
                            : '0%',
                    translationProvider: this.config.translationProvider,
                    targetLanguage: this.config.targetLanguage,
                }
            );

            return result;
        } catch (error) {
            const processTime = performance.now() - processStartTime;

            this._logSubtitleProcessing(
                'error',
                'Error processing with API translations.',
                {
                    error: error.message,
                    stack: error.stack,
                    processTime: `${processTime.toFixed(2)}ms`,
                    videoId: subtitleData.videoId,
                    translationProvider: this.config.translationProvider,
                    targetLanguage: this.config.targetLanguage,
                    inputData: {
                        hasOriginal: !!subtitleData.originalCues,
                        originalCount: subtitleData.originalCues?.length || 0,
                    },
                }
            );
            throw error;
        }
    }

    /**
     * Normalizes subtitle cues to a standard format.
     * @private
     * @param {Array} cues - The raw subtitle cues.
     * @param {string} type - The cue type ('original' or 'translated').
     * @returns {Array} The normalized cues.
     */
    _normalizeCues(cues, type) {
        if (!Array.isArray(cues)) {
            return [];
        }

        return cues
            .map((cue) => ({
                start: this._parseTimeToSeconds(cue.start),
                end: this._parseTimeToSeconds(cue.end),
                text: this._sanitizeText(cue.text),
                type,
                videoId: this.currentVideoId,
                original:
                    type === 'original' ? this._sanitizeText(cue.text) : null,
                translated:
                    type === 'translated' ? this._sanitizeText(cue.text) : null,
            }))
            .filter((cue) => cue.text && !isNaN(cue.start) && !isNaN(cue.end));
    }

    /**
     * Creates dual subtitle cues by matching original and translated cues.
     * @private
     * @param {Array} originalCues - The original language cues.
     * @param {Array} translatedCues - The translated cues.
     * @param {boolean} useNativeTarget - Whether the translations are from the platform.
     * @returns {Array} An array of dual subtitle cues.
     */
    _createDualSubtitleCues(originalCues, translatedCues, useNativeTarget) {
        const dualCues = [];

        // Create a map of translated cues by timing for efficient lookup
        const translatedMap = new Map();
        translatedCues.forEach((cue) => {
            const key = `${cue.start}-${cue.end}`;
            translatedMap.set(key, cue);
        });

        // Match original cues with translated cues
        originalCues.forEach((originalCue) => {
            const key = `${originalCue.start}-${originalCue.end}`;
            const translatedCue = translatedMap.get(key);

            if (translatedCue) {
                // Perfect timing match
                dualCues.push({
                    start: originalCue.start,
                    end: originalCue.end,
                    original: originalCue.text,
                    translated: translatedCue.text,
                    videoId: this.currentVideoId,
                    useNativeTarget,
                    cueType: 'dual',
                });
            } else {
                // Find best overlapping translated cue
                const overlappingCue = this._findBestOverlappingCue(
                    originalCue,
                    translatedCues
                );

                dualCues.push({
                    start: originalCue.start,
                    end: originalCue.end,
                    original: originalCue.text,
                    translated: overlappingCue
                        ? overlappingCue.text
                        : '[Translation pending...]',
                    videoId: this.currentVideoId,
                    useNativeTarget,
                    cueType: 'dual',
                });
            }
        });

        return dualCues;
    }

    /**
     * Finds the best overlapping translated cue for an original cue.
     * @private
     * @param {Object} originalCue - The original cue to match.
     * @param {Array} translatedCues - The available translated cues.
     * @returns {Object|null} The best matching translated cue, or `null`.
     */
    _findBestOverlappingCue(originalCue, translatedCues) {
        let bestCue = null;
        let maxOverlap = 0;

        translatedCues.forEach((translatedCue) => {
            const overlapStart = Math.max(
                originalCue.start,
                translatedCue.start
            );
            const overlapEnd = Math.min(originalCue.end, translatedCue.end);
            const overlap = Math.max(0, overlapEnd - overlapStart);

            if (overlap > maxOverlap) {
                maxOverlap = overlap;
                bestCue = translatedCue;
            }
        });

        return maxOverlap > 0.1 ? bestCue : null;
    }

    /**
     * Translates cues using an API translation service.
     * @private
     * @param {Array} originalCues - The original cues to translate.
     * @returns {Promise<Array>} A promise that resolves to the translated cues.
     */
    async _translateCuesWithAPI(originalCues) {
        // TODO: Implement actual translation service integration.
        this._log('info', 'Translating cues with API.', {
            provider: this.config.translationProvider,
            cueCount: originalCues.length,
        });

        // TODO: Integrate with actual translation service
        return originalCues.map((cue) => ({
            ...cue,
            text: `[${cue.text}]`, // Placeholder translation
            type: 'translated',
        }));
    }

    /**
     * Updates the subtitle queue with new cues.
     * @private
     * @param {Array} newCues - The new subtitle cues to add.
     */
    _updateSubtitleQueue(newCues) {
        // Clear existing cues for this video
        this.subtitleQueue = this.subtitleQueue.filter(
            (cue) => cue.videoId !== this.currentVideoId
        );

        // Add new cues
        this.subtitleQueue.push(...newCues);

        // Sort by start time
        this.subtitleQueue.sort((a, b) => a.start - b.start);

        this._log('debug', 'Subtitle queue updated.', {
            videoId: this.currentVideoId,
            totalCues: this.subtitleQueue.length,
            newCues: newCues.length,
        });
    }

    // ========================================
    // PLATFORM-SPECIFIC PARSING METHODS
    // ========================================

    /**
     * Parses official Netflix translations.
     * @private
     * @param {Object} platformData - The Netflix subtitle data.
     * @returns {Promise<Array>} A promise that resolves to the parsed cues.
     */
    async _parseNetflixOfficialTranslations(platformData) {
        this._logSubtitleProcessing(
            'debug',
            'Starting Netflix official translation parsing.',
            {
                hasData: !!platformData,
                dataType: typeof platformData,
                hasEvents: !!platformData?.events,
                eventCount: platformData?.events?.length || 0,
            }
        );

        try {
            if (platformData?.events && Array.isArray(platformData.events)) {
                const parsedCues = platformData.events
                    .filter((event) => event && typeof event === 'object')
                    .map((event, index) => {
                        const cue = {
                            start: event.startMs ? event.startMs / 1000 : 0,
                            end: event.endMs ? event.endMs / 1000 : 0,
                            text: event.text || '',
                        };

                        if (!event.startMs || !event.endMs) {
                            this._logSubtitleProcessing(
                                'warn',
                                'Netflix event missing timing data.',
                                {
                                    eventIndex: index,
                                    event: {
                                        hasStartMs: !!event.startMs,
                                        hasEndMs: !!event.endMs,
                                        hasText: !!event.text,
                                        startMs: event.startMs,
                                        endMs: event.endMs,
                                    },
                                }
                            );
                        }

                        if (!event.text || event.text.trim() === '') {
                            this._logSubtitleProcessing(
                                'warn',
                                'Netflix event missing text content.',
                                {
                                    eventIndex: index,
                                    timing: `${event.startMs}ms - ${event.endMs}ms`,
                                }
                            );
                        }

                        return cue;
                    })
                    .filter(
                        (cue) => cue.text.trim() !== '' && cue.start < cue.end
                    );

                this._logSubtitleProcessing(
                    'info',
                    'Netflix official translation parsing completed.',
                    {
                        originalEventCount: platformData.events.length,
                        parsedCueCount: parsedCues.length,
                        filteredOut:
                            platformData.events.length - parsedCues.length,
                        firstCue:
                            parsedCues.length > 0
                                ? {
                                      start: parsedCues[0].start,
                                      end: parsedCues[0].end,
                                      textPreview: parsedCues[0].text.substring(
                                          0,
                                          50
                                      ),
                                  }
                                : null,
                    }
                );

                return parsedCues;
            } else {
                this._logSubtitleProcessing(
                    'warn',
                    'Netflix platform data is invalid or missing events.',
                    {
                        hasData: !!platformData,
                        dataKeys: platformData
                            ? Object.keys(platformData)
                            : null,
                        hasEvents: !!platformData?.events,
                        eventsType: platformData?.events
                            ? typeof platformData.events
                            : null,
                    }
                );
                return [];
            }
        } catch (error) {
            this._logSubtitleProcessing(
                'error',
                'Error in Netflix official translation parsing.',
                {
                    error: error.message,
                    stack: error.stack,
                    platformDataType: typeof platformData,
                    hasEvents: !!platformData?.events,
                }
            );
            return [];
        }
    }

    /**
     * Parses official Disney+ translations.
     * @private
     * @param {Object} platformData - The Disney+ subtitle data.
     * @returns {Promise<Array>} A promise that resolves to the parsed cues.
     */
    async _parseDisneyPlusOfficialTranslations(platformData) {
        this._logSubtitleProcessing(
            'debug',
            'Starting Disney+ official translation parsing.',
            {
                hasData: !!platformData,
                dataType: typeof platformData,
                isArray: Array.isArray(platformData),
                arrayLength: Array.isArray(platformData)
                    ? platformData.length
                    : null,
            }
        );

        try {
            if (Array.isArray(platformData)) {
                const parsedCues = platformData
                    .filter((item) => item && typeof item === 'object')
                    .map((item, index) => {
                        const startTime = this._parseTimeToSeconds(item.start);
                        const endTime = this._parseTimeToSeconds(item.end);
                        const text = item.text || '';

                        if (isNaN(startTime) || isNaN(endTime)) {
                            this._logSubtitleProcessing(
                                'warn',
                                'Disney+ item has invalid timing.',
                                {
                                    itemIndex: index,
                                    originalStart: item.start,
                                    originalEnd: item.end,
                                    parsedStart: startTime,
                                    parsedEnd: endTime,
                                }
                            );
                        }

                        if (!text || text.trim() === '') {
                            this._logSubtitleProcessing(
                                'warn',
                                'Disney+ item missing text content.',
                                {
                                    itemIndex: index,
                                    timing: `${startTime}s - ${endTime}s`,
                                    hasText: !!item.text,
                                    textLength: item.text
                                        ? item.text.length
                                        : 0,
                                }
                            );
                        }

                        return {
                            start: startTime,
                            end: endTime,
                            text: text,
                        };
                    })
                    .filter(
                        (cue) =>
                            cue.text.trim() !== '' &&
                            !isNaN(cue.start) &&
                            !isNaN(cue.end) &&
                            cue.start < cue.end
                    );

                this._logSubtitleProcessing(
                    'info',
                    'Disney+ official translation parsing completed.',
                    {
                        originalItemCount: platformData.length,
                        parsedCueCount: parsedCues.length,
                        filteredOut: platformData.length - parsedCues.length,
                        firstCue:
                            parsedCues.length > 0
                                ? {
                                      start: parsedCues[0].start,
                                      end: parsedCues[0].end,
                                      textPreview: parsedCues[0].text.substring(
                                          0,
                                          50
                                      ),
                                  }
                                : null,
                        lastCue:
                            parsedCues.length > 0
                                ? {
                                      start: parsedCues[parsedCues.length - 1]
                                          .start,
                                      end: parsedCues[parsedCues.length - 1]
                                          .end,
                                      textPreview: parsedCues[
                                          parsedCues.length - 1
                                      ].text.substring(0, 50),
                                  }
                                : null,
                    }
                );

                return parsedCues;
            } else {
                this._logSubtitleProcessing(
                    'warn',
                    'Disney+ platform data is invalid or not an array.',
                    {
                        hasData: !!platformData,
                        dataType: typeof platformData,
                        isArray: Array.isArray(platformData),
                        dataKeys:
                            platformData && typeof platformData === 'object'
                                ? Object.keys(platformData)
                                : null,
                    }
                );
                return [];
            }
        } catch (error) {
            this._logSubtitleProcessing(
                'error',
                'Error in Disney+ official translation parsing.',
                {
                    error: error.message,
                    stack: error.stack,
                    platformDataType: typeof platformData,
                    isArray: Array.isArray(platformData),
                    arrayLength: Array.isArray(platformData)
                        ? platformData.length
                        : null,
                }
            );
            return [];
        }
    }

    /**
     * Parses generic official translations.
     * @private
     * @param {Object} platformData - The generic subtitle data.
     * @returns {Promise<Array>} A promise that resolves to the parsed cues.
     */
    async _parseGenericOfficialTranslations(platformData) {
        this._log('debug', 'Parsing generic official translations.');

        if (Array.isArray(platformData)) {
            return platformData.map((item) => ({
                start: this._parseTimeToSeconds(item.start || item.startTime),
                end: this._parseTimeToSeconds(item.end || item.endTime),
                text: item.text || item.content || '',
            }));
        }

        return [];
    }

    // ========================================
    // UTILITY METHODS
    // ========================================

    /**
     * Parses a time value into seconds using the consolidated utility function.
     * @private
     * @param {string|number} time - The time value to parse.
     * @returns {number} The time in seconds.
     */
    _parseTimeToSeconds(time) {
        // Handle numeric input directly
        if (typeof time === 'number') {
            return time;
        }

        // For string input, use the consolidated parseTimestampToSeconds function
        if (typeof time === 'string') {
            // Handle simple numeric strings
            if (!time.includes(':')) {
                return parseFloat(time) || 0;
            }

            // Use consolidated function for timestamp format
            return parseTimestampToSeconds(time);
        }

        return 0;
    }

    /**
     * Sanitizes subtitle text using the consolidated utility function.
     * @private
     * @param {string} text - The raw text to sanitize.
     * @returns {string} The sanitized text.
     */
    _sanitizeText(text) {
        return sanitizeSubtitleText(text);
    }

    /**
     * Logs messages with a fallback to the console.
     * @private
     * @param {string} level - The log level.
     * @param {string} message - The log message.
     * @param {Object} [data] - Additional data to log.
     */
    _log(level, message, data = {}) {
        if (this.config.logger) {
            this.config.logger(
                level,
                `[SubtitleProcessor:${this.platform}] ${message}`,
                data
            );
        } else {
            console.log(
                `[SubtitleProcessor:${this.platform}] [${level.toUpperCase()}] ${message}`,
                data
            );
        }
    }

    /**
     * A specialized logging function for subtitle processing with detailed context.
     * @private
     * @param {string} level - The log level.
     * @param {string} message - The log message.
     * @param {Object} [data] - Additional data to log.
     */
    _logSubtitleProcessing(level, message, data = {}) {
        const enhancedData = {
            ...data,
            timestamp: new Date().toISOString(),
            platform: this.platform,
            videoId: this.currentVideoId,
            processingState: {
                queueSize: this.subtitleQueue.length,
                cacheSize: this.translationCache.size,
                isProcessing: this.processingQueue,
            },
            config: {
                useOfficialTranslations: this.config.useOfficialTranslations,
                translationProvider: this.config.translationProvider,
                displayMode: this.config.displayMode,
                targetLanguage: this.config.targetLanguage,
            },
        };

        if (this.config.logger) {
            this.config.logger(
                level,
                `[SubtitleProcessing:${this.platform}] ${message}`,
                enhancedData
            );
        } else {
            console.log(
                `[SubtitleProcessing:${this.platform}] [${level.toUpperCase()}] ${message}`,
                enhancedData
            );
        }
    }

    /**
     * Logs subtitle display attempts and their results.
     * @param {boolean} success - Whether the display was successful.
     * @param {Object} [displayData={}] - Data related to the display attempt.
     * @param {Error|null} [error=null] - The error if the display failed.
     */
    logDisplayAttempt(success, displayData = {}, error = null) {
        this.performanceMetrics.displayAttempts++;
        if (success) {
            this.performanceMetrics.displaySuccesses++;
        }

        const logLevel = success ? 'info' : 'error';
        const message = success
            ? 'Subtitle display successful'
            : 'Subtitle display failed';

        this._logSubtitleProcessing(logLevel, message, {
            success,
            displayData: {
                cueCount: displayData.cueCount || 0,
                displayMode: displayData.displayMode || this.config.displayMode,
                containerIds: displayData.containerIds || [],
                timing: displayData.timing || null,
                ...displayData,
            },
            error: error
                ? {
                      message: error.message,
                      stack: error.stack,
                      name: error.name,
                  }
                : null,
            displayMetrics: {
                totalAttempts: this.performanceMetrics.displayAttempts,
                totalSuccesses: this.performanceMetrics.displaySuccesses,
                successRate:
                    this.performanceMetrics.displayAttempts > 0
                        ? (
                              (this.performanceMetrics.displaySuccesses /
                                  this.performanceMetrics.displayAttempts) *
                              100
                          ).toFixed(2) + '%'
                        : '0%',
            },
        });
    }
}

/**
 * Manages subtitle source detection and switching between official and API translations.
 */
export class SubtitleSourceManager {
    /**
     * Creates a new `SubtitleSourceManager` instance.
     * @param {string} platform - The platform name.
     * @param {Object} [config={}] - Configuration for the manager.
     */
    constructor(platform, config = {}) {
        this.platform = platform;
        this.config = config;
        this.currentSource = 'api';
    }

    /**
     * Determines the appropriate subtitle source based on availability and user preference.
     * @param {Object} availableSources - The available subtitle sources.
     * @param {boolean} availableSources.hasOfficial - Whether official translations are available.
     * @param {boolean} availableSources.hasAPI - Whether API translation is available.
     * @param {boolean} userPreference - The user's preference for official translations.
     * @returns {string} The chosen source ('official', 'api', or 'none').
     */
    determineSubtitleSource(availableSources, userPreference) {
        if (userPreference && availableSources.hasOfficial) {
            this.currentSource = 'official';
            return 'official';
        }

        if (availableSources.hasAPI) {
            this.currentSource = 'api';
            return 'api';
        }

        // Fallback to official if API is not available
        if (availableSources.hasOfficial) {
            this.currentSource = 'official';
            return 'official';
        }

        this.currentSource = 'none';
        return 'none';
    }

    /**
     * Gets the current subtitle source.
     * @returns {string} The current source ('official', 'api', or 'none').
     */
    getCurrentSource() {
        return this.currentSource;
    }

    /**
     * Checks if official translations should be used.
     * @param {Object} config - The current configuration.
     * @param {Object} availability - The translation availability.
     * @returns {boolean} `true` if official translations should be used.
     */
    shouldUseOfficialTranslations(config, availability) {
        return (
            config.useOfficialTranslations &&
            availability.hasOfficial &&
            availability.officialLanguageMatches
        );
    }
}

/**
 * Utility functions for subtitle processing.
 *
 * Note: parseVTT, formatSubtitleTextForDisplay, and parseTimestampToSeconds
 * functions have been consolidated to content_scripts/shared/subtitleUtilities.js
 * to eliminate code duplication. Import these functions from subtitleUtilities.js
 * if needed in other modules.
 */
