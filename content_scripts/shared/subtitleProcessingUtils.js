/**
 * SubtitleProcessingUtils - Comprehensive subtitle processing utilities for streaming platforms
 * 
 * This module provides dual subtitle processing capabilities, official translation parsing,
 * and subtitle display management. It handles both API-based translations and platform
 * official translations for dual subtitle display.
 * 
 * @author DualSub Extension
 * @version 1.0.0
 */

/**
 * SubtitleProcessingManager - Manages dual subtitle processing and display
 * 
 * This class handles the core subtitle processing logic including:
 * - Dual subtitle display (original + translated)
 * - Official platform translation parsing
 * - API translation integration
 * - Subtitle timing and synchronization
 * - Display mode switching
 * 
 * @example
 * ```javascript
 * const processor = new SubtitleProcessingManager('netflix', {
 *     useOfficialTranslations: true,
 *     translationProvider: 'google',
 *     displayMode: 'dual',
 *     logger: myLogger
 * });
 * 
 * await processor.processSubtitleData(subtitleData);
 * ```
 */
export class SubtitleProcessingManager {
    /**
     * Creates a new SubtitleProcessingManager instance
     * @param {string} platform - Platform name (e.g., 'netflix', 'disneyplus')
     * @param {Object} config - Configuration object
     * @param {boolean} [config.useOfficialTranslations=false] - Use platform's official translations
     * @param {string} [config.translationProvider='google'] - Translation provider for API translations
     * @param {string} [config.displayMode='dual'] - Display mode ('dual', 'translated-only', 'original-only')
     * @param {string} [config.targetLanguage='en'] - Target language for translations
     * @param {number} [config.timeOffset=0] - Time offset for subtitle synchronization
     * @param {Function} [config.logger] - Logger function
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
            ...config
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
            displaySuccesses: 0
        };
        
        // Bind methods
        this.processSubtitleData = this.processSubtitleData.bind(this);
        this.parseOfficialTranslations = this.parseOfficialTranslations.bind(this);
        
        this._logSubtitleProcessing('info', 'SubtitleProcessingManager initialized', {
            platform: this.platform,
            config: {
                useOfficialTranslations: this.config.useOfficialTranslations,
                translationProvider: this.config.translationProvider,
                displayMode: this.config.displayMode,
                targetLanguage: this.config.targetLanguage
            },
            initializationTime: this.performanceMetrics.initializationTime
        });
    }

    /**
     * Process subtitle data and determine display strategy
     * @param {Object} subtitleData - Raw subtitle data from platform
     * @param {string} subtitleData.videoId - Video identifier
     * @param {Array} subtitleData.originalCues - Original language subtitle cues
     * @param {Array} [subtitleData.translatedCues] - Platform's translated subtitle cues (if available)
     * @param {Object} [subtitleData.metadata] - Additional metadata
     * @returns {Promise<Object>} Processed subtitle result
     */
    async processSubtitleData(subtitleData) {
        const processingStartTime = performance.now();
        
        this._logSubtitleProcessing('info', 'Starting subtitle data processing', {
            videoId: subtitleData.videoId,
            hasOriginal: !!subtitleData.originalCues,
            hasTranslated: !!subtitleData.translatedCues,
            originalCueCount: subtitleData.originalCues?.length || 0,
            translatedCueCount: subtitleData.translatedCues?.length || 0,
            useOfficial: this.config.useOfficialTranslations,
            translationProvider: this.config.translationProvider,
            displayMode: this.config.displayMode,
            targetLanguage: this.config.targetLanguage,
            processingStartTime
        });

        try {
            // Update current video ID
            this.currentVideoId = subtitleData.videoId;

            // Determine subtitle source strategy
            const shouldUseOfficial = this.config.useOfficialTranslations && 
                                    subtitleData.translatedCues && 
                                    subtitleData.translatedCues.length > 0;

            this._logSubtitleProcessing('info', 'Subtitle source detection completed', {
                videoId: subtitleData.videoId,
                shouldUseOfficial,
                officialTranslationsAvailable: !!(subtitleData.translatedCues?.length),
                userPreference: this.config.useOfficialTranslations,
                selectedSource: shouldUseOfficial ? 'official' : 'api'
            });

            let processedResult;

            if (shouldUseOfficial) {
                this.performanceMetrics.officialTranslationAttempts++;
                processedResult = await this._processWithOfficialTranslations(subtitleData);
                this.performanceMetrics.officialTranslationSuccesses++;
            } else {
                this.performanceMetrics.apiTranslationAttempts++;
                processedResult = await this._processWithAPITranslations(subtitleData);
                this.performanceMetrics.apiTranslationSuccesses++;
            }

            // Update subtitle queue
            this._updateSubtitleQueue(processedResult.cues);

            // Calculate processing time
            const processingTime = performance.now() - processingStartTime;
            this.performanceMetrics.totalProcessingTime += processingTime;
            this.performanceMetrics.processedSubtitleCount++;

            this._logSubtitleProcessing('info', 'Subtitle processing completed successfully', {
                videoId: subtitleData.videoId,
                cueCount: processedResult.cues.length,
                source: shouldUseOfficial ? 'official' : 'api',
                originalCount: processedResult.originalCount,
                translatedCount: processedResult.translatedCount,
                dualCount: processedResult.dualCount,
                processingTime: `${processingTime.toFixed(2)}ms`,
                averageProcessingTime: `${(this.performanceMetrics.totalProcessingTime / this.performanceMetrics.processedSubtitleCount).toFixed(2)}ms`,
                performanceMetrics: {
                    totalProcessed: this.performanceMetrics.processedSubtitleCount,
                    officialAttempts: this.performanceMetrics.officialTranslationAttempts,
                    officialSuccesses: this.performanceMetrics.officialTranslationSuccesses,
                    apiAttempts: this.performanceMetrics.apiTranslationAttempts,
                    apiSuccesses: this.performanceMetrics.apiTranslationSuccesses
                }
            });

            return processedResult;

        } catch (error) {
            const processingTime = performance.now() - processingStartTime;
            
            this._logSubtitleProcessing('error', 'Error processing subtitle data', {
                error: error.message,
                stack: error.stack,
                videoId: subtitleData.videoId,
                processingTime: `${processingTime.toFixed(2)}ms`,
                subtitleDataKeys: Object.keys(subtitleData || {}),
                hasOriginalCues: !!subtitleData?.originalCues,
                hasTranslatedCues: !!subtitleData?.translatedCues,
                configState: {
                    useOfficialTranslations: this.config.useOfficialTranslations,
                    translationProvider: this.config.translationProvider,
                    displayMode: this.config.displayMode
                }
            });
            throw error;
        }
    }

    /**
     * Parse official translations from platform-specific data
     * @param {Object} platformData - Platform-specific subtitle data
     * @param {string} platform - Platform name for format-specific parsing
     * @returns {Promise<Array>} Parsed subtitle cues
     */
    async parseOfficialTranslations(platformData, platform = this.platform) {
        const parseStartTime = performance.now();
        
        this._logSubtitleProcessing('info', 'Starting official translation parsing', {
            platform,
            dataType: typeof platformData,
            dataSize: platformData ? JSON.stringify(platformData).length : 0,
            hasData: !!platformData,
            isArray: Array.isArray(platformData),
            parseStartTime
        });

        try {
            let parsedCues = [];
            
            switch (platform.toLowerCase()) {
                case 'netflix':
                    this._logSubtitleProcessing('debug', 'Using Netflix-specific parsing logic');
                    parsedCues = await this._parseNetflixOfficialTranslations(platformData);
                    break;
                case 'disneyplus':
                    this._logSubtitleProcessing('debug', 'Using Disney+ specific parsing logic');
                    parsedCues = await this._parseDisneyPlusOfficialTranslations(platformData);
                    break;
                default:
                    this._logSubtitleProcessing('debug', 'Using generic parsing logic', { platform });
                    parsedCues = await this._parseGenericOfficialTranslations(platformData);
                    break;
            }

            const parseTime = performance.now() - parseStartTime;
            
            this._logSubtitleProcessing('info', 'Official translation parsing completed', {
                platform,
                success: true,
                parsedCueCount: parsedCues.length,
                parseTime: `${parseTime.toFixed(2)}ms`,
                firstCue: parsedCues.length > 0 ? {
                    start: parsedCues[0].start,
                    end: parsedCues[0].end,
                    textLength: parsedCues[0].text?.length || 0
                } : null,
                lastCue: parsedCues.length > 0 ? {
                    start: parsedCues[parsedCues.length - 1].start,
                    end: parsedCues[parsedCues.length - 1].end,
                    textLength: parsedCues[parsedCues.length - 1].text?.length || 0
                } : null
            });

            return parsedCues;
            
        } catch (error) {
            const parseTime = performance.now() - parseStartTime;
            
            this._logSubtitleProcessing('error', 'Error parsing official translations', {
                error: error.message,
                stack: error.stack,
                platform,
                parseTime: `${parseTime.toFixed(2)}ms`,
                dataType: typeof platformData,
                dataKeys: platformData && typeof platformData === 'object' ? Object.keys(platformData) : null,
                isArray: Array.isArray(platformData),
                arrayLength: Array.isArray(platformData) ? platformData.length : null
            });
            return [];
        }
    }

    /**
     * Update subtitle mode (official vs API translations)
     * @param {boolean} useOfficial - Whether to use official translations
     * @returns {Promise<void>}
     */
    async updateSubtitleMode(useOfficial) {
        const modeChangeTime = Date.now();
        
        this._logSubtitleProcessing('info', 'Updating subtitle mode', {
            from: this.config.useOfficialTranslations,
            to: useOfficial,
            modeChangeTime,
            currentVideoId: this.currentVideoId,
            cacheSize: this.translationCache.size,
            queueSize: this.subtitleQueue.length
        });

        const previousMode = this.config.useOfficialTranslations;
        this.config.useOfficialTranslations = useOfficial;
        
        // Clear translation cache when switching modes
        const cacheCleared = this.translationCache.size;
        this.translationCache.clear();
        
        // Reset performance metrics for the new mode
        if (previousMode !== useOfficial) {
            this.performanceMetrics.officialTranslationAttempts = 0;
            this.performanceMetrics.officialTranslationSuccesses = 0;
            this.performanceMetrics.apiTranslationAttempts = 0;
            this.performanceMetrics.apiTranslationSuccesses = 0;
        }
        
        this._logSubtitleProcessing('info', 'Subtitle mode updated successfully', {
            newMode: useOfficial ? 'official' : 'api',
            previousMode: previousMode ? 'official' : 'api',
            cacheCleared,
            metricsReset: previousMode !== useOfficial,
            reprocessingNeeded: this.subtitleQueue.length > 0,
            timeSinceInit: modeChangeTime - this.performanceMetrics.initializationTime
        });
    }

    /**
     * Get current subtitle queue
     * @returns {Array} Current subtitle cues
     */
    getSubtitleQueue() {
        return [...this.subtitleQueue];
    }

    /**
     * Clear subtitle queue
     */
    clearSubtitleQueue() {
        this.subtitleQueue = [];
        this._log('debug', 'Subtitle queue cleared');
    }

    // ========================================
    // PRIVATE PROCESSING METHODS
    // ========================================

    /**
     * Process subtitles using official platform translations
     * @private
     * @param {Object} subtitleData - Subtitle data
     * @returns {Promise<Object>} Processing result
     */
    async _processWithOfficialTranslations(subtitleData) {
        const processStartTime = performance.now();
        
        this._logSubtitleProcessing('info', 'Processing with official translations', {
            videoId: subtitleData.videoId,
            originalCueCount: subtitleData.originalCues?.length || 0,
            translatedCueCount: subtitleData.translatedCues?.length || 0
        });

        try {
            // Normalize cues with detailed logging
            this._logSubtitleProcessing('debug', 'Normalizing original cues');
            const originalCues = this._normalizeCues(subtitleData.originalCues, 'original');
            
            this._logSubtitleProcessing('debug', 'Normalizing translated cues');
            const translatedCues = this._normalizeCues(subtitleData.translatedCues, 'translated');

            this._logSubtitleProcessing('info', 'Cue normalization completed', {
                originalInput: subtitleData.originalCues?.length || 0,
                originalNormalized: originalCues.length,
                originalFiltered: (subtitleData.originalCues?.length || 0) - originalCues.length,
                translatedInput: subtitleData.translatedCues?.length || 0,
                translatedNormalized: translatedCues.length,
                translatedFiltered: (subtitleData.translatedCues?.length || 0) - translatedCues.length
            });

            // Create dual subtitle cues by matching timing
            this._logSubtitleProcessing('debug', 'Creating dual subtitle cues with official translations');
            const dualCues = this._createDualSubtitleCues(originalCues, translatedCues, true);

            const processTime = performance.now() - processStartTime;
            
            const result = {
                source: 'official',
                cues: dualCues,
                originalCount: originalCues.length,
                translatedCount: translatedCues.length,
                dualCount: dualCues.length
            };

            this._logSubtitleProcessing('info', 'Official translation processing completed', {
                ...result,
                processTime: `${processTime.toFixed(2)}ms`,
                matchingRate: originalCues.length > 0 
                    ? `${((dualCues.length / originalCues.length) * 100).toFixed(1)}%`
                    : '0%',
                averageCueLength: dualCues.length > 0
                    ? (dualCues.reduce((sum, cue) => sum + (cue.original?.length || 0) + (cue.translated?.length || 0), 0) / (dualCues.length * 2)).toFixed(1)
                    : 0
            });

            return result;
            
        } catch (error) {
            const processTime = performance.now() - processStartTime;
            
            this._logSubtitleProcessing('error', 'Error processing with official translations', {
                error: error.message,
                stack: error.stack,
                processTime: `${processTime.toFixed(2)}ms`,
                videoId: subtitleData.videoId,
                inputData: {
                    hasOriginal: !!subtitleData.originalCues,
                    hasTranslated: !!subtitleData.translatedCues,
                    originalCount: subtitleData.originalCues?.length || 0,
                    translatedCount: subtitleData.translatedCues?.length || 0
                }
            });
            throw error;
        }
    }

    /**
     * Process subtitles using API translations
     * @private
     * @param {Object} subtitleData - Subtitle data
     * @returns {Promise<Object>} Processing result
     */
    async _processWithAPITranslations(subtitleData) {
        const processStartTime = performance.now();
        
        this._logSubtitleProcessing('info', 'Processing with API translations', {
            videoId: subtitleData.videoId,
            originalCueCount: subtitleData.originalCues?.length || 0,
            translationProvider: this.config.translationProvider,
            targetLanguage: this.config.targetLanguage
        });

        try {
            // Normalize original cues
            this._logSubtitleProcessing('debug', 'Normalizing original cues for API translation');
            const originalCues = this._normalizeCues(subtitleData.originalCues, 'original');
            
            this._logSubtitleProcessing('info', 'Original cue normalization completed', {
                originalInput: subtitleData.originalCues?.length || 0,
                originalNormalized: originalCues.length,
                originalFiltered: (subtitleData.originalCues?.length || 0) - originalCues.length
            });

            // Translate original cues using API
            this._logSubtitleProcessing('debug', 'Starting API translation process');
            const translationStartTime = performance.now();
            const translatedCues = await this._translateCuesWithAPI(originalCues);
            const translationTime = performance.now() - translationStartTime;

            this._logSubtitleProcessing('info', 'API translation completed', {
                originalCueCount: originalCues.length,
                translatedCueCount: translatedCues.length,
                translationTime: `${translationTime.toFixed(2)}ms`,
                averageTimePerCue: originalCues.length > 0 
                    ? `${(translationTime / originalCues.length).toFixed(2)}ms`
                    : '0ms',
                provider: this.config.translationProvider
            });

            // Create dual subtitle cues
            this._logSubtitleProcessing('debug', 'Creating dual subtitle cues with API translations');
            const dualCues = this._createDualSubtitleCues(originalCues, translatedCues, false);

            const processTime = performance.now() - processStartTime;
            
            const result = {
                source: 'api',
                cues: dualCues,
                originalCount: originalCues.length,
                translatedCount: translatedCues.length,
                dualCount: dualCues.length
            };

            this._logSubtitleProcessing('info', 'API translation processing completed', {
                ...result,
                processTime: `${processTime.toFixed(2)}ms`,
                translationTime: `${translationTime.toFixed(2)}ms`,
                matchingRate: originalCues.length > 0 
                    ? `${((dualCues.length / originalCues.length) * 100).toFixed(1)}%`
                    : '0%',
                translationProvider: this.config.translationProvider,
                targetLanguage: this.config.targetLanguage
            });

            return result;
            
        } catch (error) {
            const processTime = performance.now() - processStartTime;
            
            this._logSubtitleProcessing('error', 'Error processing with API translations', {
                error: error.message,
                stack: error.stack,
                processTime: `${processTime.toFixed(2)}ms`,
                videoId: subtitleData.videoId,
                translationProvider: this.config.translationProvider,
                targetLanguage: this.config.targetLanguage,
                inputData: {
                    hasOriginal: !!subtitleData.originalCues,
                    originalCount: subtitleData.originalCues?.length || 0
                }
            });
            throw error;
        }
    }

    /**
     * Normalize subtitle cues to standard format
     * @private
     * @param {Array} cues - Raw subtitle cues
     * @param {string} type - Cue type ('original' or 'translated')
     * @returns {Array} Normalized cues
     */
    _normalizeCues(cues, type) {
        if (!Array.isArray(cues)) {
            return [];
        }

        return cues.map(cue => ({
            start: this._parseTimeToSeconds(cue.start),
            end: this._parseTimeToSeconds(cue.end),
            text: this._sanitizeText(cue.text),
            type,
            videoId: this.currentVideoId,
            original: type === 'original' ? this._sanitizeText(cue.text) : null,
            translated: type === 'translated' ? this._sanitizeText(cue.text) : null
        })).filter(cue => cue.text && !isNaN(cue.start) && !isNaN(cue.end));
    }

    /**
     * Create dual subtitle cues by matching original and translated cues
     * @private
     * @param {Array} originalCues - Original language cues
     * @param {Array} translatedCues - Translated cues
     * @param {boolean} useNativeTarget - Whether using platform's native translations
     * @returns {Array} Dual subtitle cues
     */
    _createDualSubtitleCues(originalCues, translatedCues, useNativeTarget) {
        const dualCues = [];

        // Create a map of translated cues by timing for efficient lookup
        const translatedMap = new Map();
        translatedCues.forEach(cue => {
            const key = `${cue.start}-${cue.end}`;
            translatedMap.set(key, cue);
        });

        // Match original cues with translated cues
        originalCues.forEach(originalCue => {
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
                    cueType: 'dual'
                });
            } else {
                // Find best overlapping translated cue
                const overlappingCue = this._findBestOverlappingCue(originalCue, translatedCues);
                
                dualCues.push({
                    start: originalCue.start,
                    end: originalCue.end,
                    original: originalCue.text,
                    translated: overlappingCue ? overlappingCue.text : '[Translation pending...]',
                    videoId: this.currentVideoId,
                    useNativeTarget,
                    cueType: 'dual'
                });
            }
        });

        return dualCues;
    }

    /**
     * Find the best overlapping translated cue for an original cue
     * @private
     * @param {Object} originalCue - Original cue to match
     * @param {Array} translatedCues - Available translated cues
     * @returns {Object|null} Best matching translated cue
     */
    _findBestOverlappingCue(originalCue, translatedCues) {
        let bestCue = null;
        let maxOverlap = 0;

        translatedCues.forEach(translatedCue => {
            const overlapStart = Math.max(originalCue.start, translatedCue.start);
            const overlapEnd = Math.min(originalCue.end, translatedCue.end);
            const overlap = Math.max(0, overlapEnd - overlapStart);

            if (overlap > maxOverlap) {
                maxOverlap = overlap;
                bestCue = translatedCue;
            }
        });

        return maxOverlap > 0.1 ? bestCue : null; // Minimum 0.1 second overlap
    }

    /**
     * Translate cues using API translation service
     * @private
     * @param {Array} originalCues - Original cues to translate
     * @returns {Promise<Array>} Translated cues
     */
    async _translateCuesWithAPI(originalCues) {
        // This would integrate with the existing translation service
        // For now, return placeholder implementation
        this._log('info', 'Translating cues with API', {
            provider: this.config.translationProvider,
            cueCount: originalCues.length
        });

        // TODO: Integrate with actual translation service
        return originalCues.map(cue => ({
            ...cue,
            text: `[${cue.text}]`, // Placeholder translation
            type: 'translated'
        }));
    }

    /**
     * Update the subtitle queue with new cues
     * @private
     * @param {Array} newCues - New subtitle cues
     */
    _updateSubtitleQueue(newCues) {
        // Clear existing cues for this video
        this.subtitleQueue = this.subtitleQueue.filter(
            cue => cue.videoId !== this.currentVideoId
        );

        // Add new cues
        this.subtitleQueue.push(...newCues);

        // Sort by start time
        this.subtitleQueue.sort((a, b) => a.start - b.start);

        this._log('debug', 'Subtitle queue updated', {
            videoId: this.currentVideoId,
            totalCues: this.subtitleQueue.length,
            newCues: newCues.length
        });
    }

    // ========================================
    // PLATFORM-SPECIFIC PARSING METHODS
    // ========================================

    /**
     * Parse Netflix official translations
     * @private
     * @param {Object} platformData - Netflix subtitle data
     * @returns {Promise<Array>} Parsed cues
     */
    async _parseNetflixOfficialTranslations(platformData) {
        this._logSubtitleProcessing('debug', 'Starting Netflix official translation parsing', {
            hasData: !!platformData,
            dataType: typeof platformData,
            hasEvents: !!(platformData?.events),
            eventCount: platformData?.events?.length || 0
        });
        
        try {
            // Netflix-specific parsing logic
            if (platformData && platformData.events && Array.isArray(platformData.events)) {
                const parsedCues = platformData.events
                    .filter(event => event && typeof event === 'object')
                    .map((event, index) => {
                        const cue = {
                            start: event.startMs ? event.startMs / 1000 : 0,
                            end: event.endMs ? event.endMs / 1000 : 0,
                            text: event.text || ''
                        };
                        
                        // Log parsing issues for individual events
                        if (!event.startMs || !event.endMs) {
                            this._logSubtitleProcessing('warn', 'Netflix event missing timing data', {
                                eventIndex: index,
                                event: {
                                    hasStartMs: !!event.startMs,
                                    hasEndMs: !!event.endMs,
                                    hasText: !!event.text,
                                    startMs: event.startMs,
                                    endMs: event.endMs
                                }
                            });
                        }
                        
                        if (!event.text || event.text.trim() === '') {
                            this._logSubtitleProcessing('warn', 'Netflix event missing text content', {
                                eventIndex: index,
                                timing: `${event.startMs}ms - ${event.endMs}ms`
                            });
                        }
                        
                        return cue;
                    })
                    .filter(cue => cue.text.trim() !== '' && cue.start < cue.end);

                this._logSubtitleProcessing('info', 'Netflix official translation parsing completed', {
                    originalEventCount: platformData.events.length,
                    parsedCueCount: parsedCues.length,
                    filteredOut: platformData.events.length - parsedCues.length,
                    firstCue: parsedCues.length > 0 ? {
                        start: parsedCues[0].start,
                        end: parsedCues[0].end,
                        textPreview: parsedCues[0].text.substring(0, 50)
                    } : null
                });

                return parsedCues;
            } else {
                this._logSubtitleProcessing('warn', 'Netflix platform data invalid or missing events', {
                    hasData: !!platformData,
                    dataKeys: platformData ? Object.keys(platformData) : null,
                    hasEvents: !!(platformData?.events),
                    eventsType: platformData?.events ? typeof platformData.events : null
                });
                return [];
            }
        } catch (error) {
            this._logSubtitleProcessing('error', 'Error in Netflix official translation parsing', {
                error: error.message,
                stack: error.stack,
                platformDataType: typeof platformData,
                hasEvents: !!(platformData?.events)
            });
            return [];
        }
    }

    /**
     * Parse Disney+ official translations
     * @private
     * @param {Object} platformData - Disney+ subtitle data
     * @returns {Promise<Array>} Parsed cues
     */
    async _parseDisneyPlusOfficialTranslations(platformData) {
        this._logSubtitleProcessing('debug', 'Starting Disney+ official translation parsing', {
            hasData: !!platformData,
            dataType: typeof platformData,
            isArray: Array.isArray(platformData),
            arrayLength: Array.isArray(platformData) ? platformData.length : null
        });
        
        try {
            // Disney+-specific parsing logic
            if (platformData && Array.isArray(platformData)) {
                const parsedCues = platformData
                    .filter(item => item && typeof item === 'object')
                    .map((item, index) => {
                        const startTime = this._parseTimeToSeconds(item.start);
                        const endTime = this._parseTimeToSeconds(item.end);
                        const text = item.text || '';
                        
                        // Log parsing issues for individual items
                        if (isNaN(startTime) || isNaN(endTime)) {
                            this._logSubtitleProcessing('warn', 'Disney+ item has invalid timing', {
                                itemIndex: index,
                                originalStart: item.start,
                                originalEnd: item.end,
                                parsedStart: startTime,
                                parsedEnd: endTime
                            });
                        }
                        
                        if (!text || text.trim() === '') {
                            this._logSubtitleProcessing('warn', 'Disney+ item missing text content', {
                                itemIndex: index,
                                timing: `${startTime}s - ${endTime}s`,
                                hasText: !!item.text,
                                textLength: item.text ? item.text.length : 0
                            });
                        }
                        
                        return {
                            start: startTime,
                            end: endTime,
                            text: text
                        };
                    })
                    .filter(cue => cue.text.trim() !== '' && !isNaN(cue.start) && !isNaN(cue.end) && cue.start < cue.end);

                this._logSubtitleProcessing('info', 'Disney+ official translation parsing completed', {
                    originalItemCount: platformData.length,
                    parsedCueCount: parsedCues.length,
                    filteredOut: platformData.length - parsedCues.length,
                    firstCue: parsedCues.length > 0 ? {
                        start: parsedCues[0].start,
                        end: parsedCues[0].end,
                        textPreview: parsedCues[0].text.substring(0, 50)
                    } : null,
                    lastCue: parsedCues.length > 0 ? {
                        start: parsedCues[parsedCues.length - 1].start,
                        end: parsedCues[parsedCues.length - 1].end,
                        textPreview: parsedCues[parsedCues.length - 1].text.substring(0, 50)
                    } : null
                });

                return parsedCues;
            } else {
                this._logSubtitleProcessing('warn', 'Disney+ platform data invalid or not an array', {
                    hasData: !!platformData,
                    dataType: typeof platformData,
                    isArray: Array.isArray(platformData),
                    dataKeys: platformData && typeof platformData === 'object' ? Object.keys(platformData) : null
                });
                return [];
            }
        } catch (error) {
            this._logSubtitleProcessing('error', 'Error in Disney+ official translation parsing', {
                error: error.message,
                stack: error.stack,
                platformDataType: typeof platformData,
                isArray: Array.isArray(platformData),
                arrayLength: Array.isArray(platformData) ? platformData.length : null
            });
            return [];
        }
    }

    /**
     * Parse generic official translations
     * @private
     * @param {Object} platformData - Generic subtitle data
     * @returns {Promise<Array>} Parsed cues
     */
    async _parseGenericOfficialTranslations(platformData) {
        this._log('debug', 'Parsing generic official translations');
        
        // Generic parsing logic for unknown platforms
        if (Array.isArray(platformData)) {
            return platformData.map(item => ({
                start: this._parseTimeToSeconds(item.start || item.startTime),
                end: this._parseTimeToSeconds(item.end || item.endTime),
                text: item.text || item.content || ''
            }));
        }
        
        return [];
    }

    // ========================================
    // UTILITY METHODS
    // ========================================

    /**
     * Parse time value to seconds
     * @private
     * @param {string|number} time - Time value
     * @returns {number} Time in seconds
     */
    _parseTimeToSeconds(time) {
        if (typeof time === 'number') {
            return time;
        }
        
        if (typeof time === 'string') {
            // Handle various time formats
            if (time.includes(':')) {
                const parts = time.split(':');
                let seconds = 0;
                
                if (parts.length === 3) {
                    seconds += parseInt(parts[0], 10) * 3600; // hours
                    seconds += parseInt(parts[1], 10) * 60;   // minutes
                    seconds += parseFloat(parts[2].replace(',', '.')); // seconds
                } else if (parts.length === 2) {
                    seconds += parseInt(parts[0], 10) * 60;   // minutes
                    seconds += parseFloat(parts[1].replace(',', '.')); // seconds
                }
                
                return isNaN(seconds) ? 0 : seconds;
            } else {
                return parseFloat(time) || 0;
            }
        }
        
        return 0;
    }

    /**
     * Sanitize subtitle text
     * @private
     * @param {string} text - Raw text
     * @returns {string} Sanitized text
     */
    _sanitizeText(text) {
        if (!text) return '';
        
        return text
            .replace(/<br\s*\/?>/gi, ' ')
            .replace(/<[^>]*>/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * Log messages with fallback
     * @private
     * @param {string} level - Log level
     * @param {string} message - Log message
     * @param {Object} [data] - Additional data
     */
    _log(level, message, data = {}) {
        if (this.config.logger) {
            this.config.logger(level, `[SubtitleProcessor:${this.platform}] ${message}`, data);
        } else {
            console.log(`[SubtitleProcessor:${this.platform}] [${level.toUpperCase()}] ${message}`, data);
        }
    }

    /**
     * Enhanced logging specifically for subtitle processing with detailed context
     * @private
     * @param {string} level - Log level
     * @param {string} message - Log message
     * @param {Object} [data] - Additional data
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
                isProcessing: this.processingQueue
            },
            config: {
                useOfficialTranslations: this.config.useOfficialTranslations,
                translationProvider: this.config.translationProvider,
                displayMode: this.config.displayMode,
                targetLanguage: this.config.targetLanguage
            }
        };

        if (this.config.logger) {
            this.config.logger(level, `[SubtitleProcessing:${this.platform}] ${message}`, enhancedData);
        } else {
            console.log(`[SubtitleProcessing:${this.platform}] [${level.toUpperCase()}] ${message}`, enhancedData);
        }
    }

    /**
     * Log subtitle display attempts and results
     * @param {boolean} success - Whether display was successful
     * @param {Object} displayData - Display attempt data
     * @param {Error} [error] - Error if display failed
     */
    logDisplayAttempt(success, displayData = {}, error = null) {
        this.performanceMetrics.displayAttempts++;
        if (success) {
            this.performanceMetrics.displaySuccesses++;
        }

        const logLevel = success ? 'info' : 'error';
        const message = success ? 'Subtitle display successful' : 'Subtitle display failed';

        this._logSubtitleProcessing(logLevel, message, {
            success,
            displayData: {
                cueCount: displayData.cueCount || 0,
                displayMode: displayData.displayMode || this.config.displayMode,
                containerIds: displayData.containerIds || [],
                timing: displayData.timing || null,
                ...displayData
            },
            error: error ? {
                message: error.message,
                stack: error.stack,
                name: error.name
            } : null,
            displayMetrics: {
                totalAttempts: this.performanceMetrics.displayAttempts,
                totalSuccesses: this.performanceMetrics.displaySuccesses,
                successRate: this.performanceMetrics.displayAttempts > 0 
                    ? ((this.performanceMetrics.displaySuccesses / this.performanceMetrics.displayAttempts) * 100).toFixed(2) + '%'
                    : '0%'
            }
        });
    }
}

/**
 * SubtitleSourceManager - Manages subtitle source detection and switching
 * 
 * This class handles the logic for determining whether to use official platform
 * translations or API translations, and provides seamless switching between modes.
 */
export class SubtitleSourceManager {
    /**
     * Creates a new SubtitleSourceManager instance
     * @param {string} platform - Platform name
     * @param {Object} config - Configuration object
     */
    constructor(platform, config = {}) {
        this.platform = platform;
        this.config = config;
        this.currentSource = 'api'; // 'api' or 'official'
    }

    /**
     * Determine the appropriate subtitle source
     * @param {Object} availableSources - Available subtitle sources
     * @param {boolean} availableSources.hasOfficial - Whether official translations are available
     * @param {boolean} availableSources.hasAPI - Whether API translation is available
     * @param {boolean} userPreference - User's preference for official translations
     * @returns {string} Chosen source ('official' or 'api')
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
     * Get current subtitle source
     * @returns {string} Current source
     */
    getCurrentSource() {
        return this.currentSource;
    }

    /**
     * Check if official translations should be used
     * @param {Object} config - Current configuration
     * @param {Object} availability - Translation availability
     * @returns {boolean} Whether to use official translations
     */
    shouldUseOfficialTranslations(config, availability) {
        return config.useOfficialTranslations && 
               availability.hasOfficial && 
               availability.officialLanguageMatches;
    }
}

/**
 * Utility functions for subtitle processing
 */

/**
 * Format subtitle text for display
 * @param {string} text - Raw subtitle text
 * @returns {string} Formatted text
 */
export function formatSubtitleTextForDisplay(text) {
    if (!text) return '';
    
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .trim();
}

/**
 * Parse VTT subtitle format
 * @param {string} vttString - VTT format string
 * @returns {Array} Parsed subtitle cues
 */
export function parseVTT(vttString) {
    if (!vttString || !vttString.trim().toUpperCase().startsWith('WEBVTT')) {
        return [];
    }

    const cues = [];
    const cueBlocks = vttString
        .split(/\r?\n\r?\n/)
        .filter(block => block.trim() !== '');

    for (const block of cueBlocks) {
        if (!block.includes('-->')) {
            continue;
        }

        const lines = block.split(/\r?\n/);
        let timestampLine = '';
        let textLines = [];

        if (lines[0].includes('-->')) {
            timestampLine = lines[0];
            textLines = lines.slice(1);
        } else if (lines.length > 1 && lines[1].includes('-->')) {
            timestampLine = lines[1];
            textLines = lines.slice(2);
        } else {
            continue;
        }

        const timeParts = timestampLine.split(' --> ');
        if (timeParts.length < 2) continue;

        const startTimeStr = timeParts[0].trim();
        const endTimeStr = timeParts[1].split(' ')[0].trim();

        const start = parseTimestampToSeconds(startTimeStr);
        const end = parseTimestampToSeconds(endTimeStr);

        const text = textLines
            .join(' ')
            .replace(/<br\s*\/?>/gi, ' ')
            .replace(/<[^>]*>/g, '')
            .replace(/\s+/g, ' ')
            .trim();

        if (text && !isNaN(start) && !isNaN(end)) {
            cues.push({ start, end, text });
        }
    }

    return cues;
}

/**
 * Parse timestamp to seconds
 * @param {string} timestamp - Timestamp string
 * @returns {number} Time in seconds
 */
export function parseTimestampToSeconds(timestamp) {
    const parts = timestamp.split(':');
    let seconds = 0;

    try {
        if (parts.length === 3) {
            seconds += parseInt(parts[0], 10) * 3600;
            seconds += parseInt(parts[1], 10) * 60;
            seconds += parseFloat(parts[2].replace(',', '.'));
        } else if (parts.length === 2) {
            seconds += parseInt(parts[0], 10) * 60;
            seconds += parseFloat(parts[1].replace(',', '.'));
        } else if (parts.length === 1) {
            seconds += parseFloat(parts[0].replace(',', '.'));
        }

        return isNaN(seconds) ? 0 : seconds;
    } catch {
        return 0;
    }
}