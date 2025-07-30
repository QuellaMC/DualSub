/**
 * Subtitle Service
 *
 * Coordinates subtitle fetching, processing, and platform-specific handling.
 * Integrates with parser modules and shared utilities.
 *
 * @author DualSub Extension
 * @version 2.0.0
 */

import { loggingManager } from '../utils/loggingManager.js';
import { vttParser } from '../parsers/vttParser.js';
import { netflixParser } from '../parsers/netflixParser.js';
import { normalizeLanguageCode } from '../../utils/languageNormalization.js';
import {
    errorHandler,
    SubtitleProcessingError,
} from '../utils/errorHandler.js';
import { configService } from '../../services/configService.js';

class SubtitleService {
    constructor() {
        this.logger = null;
        this.isInitialized = false;
        this.supportedPlatforms = new Set(['netflix', 'disneyplus', 'generic']);
        this.processingCache = new Map();
        this.performanceMetrics = {
            totalProcessed: 0,
            averageProcessingTime: 0,
            cacheHits: 0,
            errors: 0,
        };
    }

    /**
     * Initialize subtitle service
     */
    async initialize() {
        if (this.isInitialized) {
            return;
        }

        this.logger = loggingManager.createLogger('SubtitleService');

        // Initialize parser modules
        await this.initializeParsers();

        this.isInitialized = true;
        this.logger.info('Subtitle service initialized', {
            supportedPlatforms: Array.from(this.supportedPlatforms),
            parsersReady: true,
        });
    }

    /**
     * Initialize parser modules
     */
    async initializeParsers() {
        try {
            // Initialize Netflix parser with default configuration
            netflixParser.initialize({
                useOfficialTranslations: false,
                enableCaching: true,
            });

            this.logger.debug('Parser modules initialized successfully');
        } catch (error) {
            this.logger.error('Failed to initialize parser modules', error);
            throw error;
        }
    }

    /**
     * Process Netflix subtitle data
     * @param {Object} data - Netflix subtitle data
     * @param {string} targetLanguage - Target language code
     * @param {string} originalLanguage - Original language code
     * @param {boolean} useNativeSubtitles - Whether to use native subtitles
     * @param {boolean} useOfficialTranslations - Whether to use official translations
     * @returns {Promise<Object>} Processed subtitle result
     */
    async processNetflixSubtitles(
        data,
        targetLanguage,
        originalLanguage,
        useNativeSubtitles,
        useOfficialTranslations
    ) {
        this.logger.info('Processing Netflix subtitles', {
            targetLanguage,
            originalLanguage,
            useNativeSubtitles,
            useOfficialTranslations,
        });

        try {
            return await netflixParser.processNetflixSubtitleData(
                data,
                targetLanguage,
                originalLanguage,
                useNativeSubtitles,
                useOfficialTranslations
            );
        } catch (error) {
            // Handle error with comprehensive error handler
            const errorInfo = errorHandler.handleError(error, {
                operation: 'processNetflixSubtitles',
                platform: 'netflix',
                targetLanguage,
                originalLanguage,
                hasUserImpact: true,
                isCriticalPath: true,
            });

            const subtitleError = new SubtitleProcessingError(
                errorInfo.userMessage,
                {
                    originalError: error.message,
                    platform: 'netflix',
                    errorCode: errorInfo.errorCode,
                    isRecoverable: errorInfo.isRecoverable,
                }
            );

            throw subtitleError;
        }
    }

    /**
     * Fetch and process generic subtitles
     * @param {string} url - Subtitle URL
     * @param {string} targetLanguage - Target language code
     * @param {string} originalLanguage - Original language code
     * @returns {Promise<Object>} Processed subtitle result
     */
    async fetchAndProcessSubtitles(url, targetLanguage, originalLanguage) {
        this.logger.info('Fetching and processing subtitles', {
            url: url.substring(0, 100),
            targetLanguage,
            originalLanguage,
        });

        try {
            // Use the complete Disney+ processing logic from the original background script
            return await this.processDisneyPlusSubtitles(
                url,
                targetLanguage,
                originalLanguage
            );
        } catch (error) {
            this.logger.error('Disney+ subtitle processing failed', error, {
                url: url.substring(0, 100),
            });
            throw error;
        }
    }

    /**
     * Process Disney+ subtitles using the complete logic from original background script
     * This implements the full master playlist → language playlist → VTT segments flow
     */
    async processDisneyPlusSubtitles(
        masterPlaylistUrl,
        targetLanguage,
        originalLanguage
    ) {
        this.logger.info('Processing Disney+ subtitles with complete logic', {
            masterPlaylistUrl: masterPlaylistUrl.substring(0, 100),
            originalLanguage,
            targetLanguage,
        });

        // Step 1: Fetch master playlist
        const masterPlaylistText = await vttParser.fetchText(masterPlaylistUrl);

        // Check if it's direct VTT content
        if (masterPlaylistText.trim().toUpperCase().startsWith('WEBVTT')) {
            this.logger.info('Master URL points directly to a VTT file');
            return {
                vttText: masterPlaylistText,
                targetVttText: masterPlaylistText,
                sourceLanguage: normalizeLanguageCode(
                    originalLanguage || 'unknown'
                ),
                targetLanguage: normalizeLanguageCode(targetLanguage),
                useNativeTarget: false,
                availableLanguages: [],
                selectedLanguage: originalLanguage,
                targetLanguageInfo: { code: targetLanguage },
            };
        }

        // Check if it's M3U8 playlist - ignore leading whitespace and comments
        const trimmedContent = masterPlaylistText.trim();
        const lines = trimmedContent
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
        const firstNonCommentLine = lines.find(
            (line) => !line.startsWith('#') || line.startsWith('#EXTM3U')
        );

        if (
            !firstNonCommentLine ||
            !firstNonCommentLine.startsWith('#EXTM3U')
        ) {
            throw new Error(
                'Content is not a recognized M3U8 playlist or VTT file.'
            );
        }

        this.logger.info(
            'Master content is an M3U8 playlist. Parsing available languages'
        );

        // Step 2: Parse available languages from master playlist
        const availableLanguages =
            this.parseAvailableSubtitleLanguages(masterPlaylistText);
        this.logger.debug('Available subtitle languages', {
            languages: availableLanguages.map(
                (lang) => `${lang.normalizedCode} (${lang.displayName})`
            ),
        });

        // Step 3: Get user settings for smart subtitle logic
        const settings = await configService.getMultiple([
            'useNativeSubtitles',
            'useOfficialTranslations',
        ]);
        const useOfficialTranslations =
            settings.useOfficialTranslations !== undefined
                ? settings.useOfficialTranslations
                : settings.useNativeSubtitles !== false;

        this.logger.debug('Smart subtitle settings', {
            useOfficialTranslations,
            targetLanguage,
            originalLanguage,
        });

        // Step 4: Find appropriate language tracks
        let useNativeTarget = false;
        let targetLanguageInfo = null;
        let originalLanguageInfo = null;

        // Check if we should use native target language
        if (useOfficialTranslations && targetLanguage) {
            targetLanguageInfo = this.findSubtitleUriForLanguage(
                availableLanguages,
                targetLanguage
            );
            if (targetLanguageInfo) {
                this.logger.info('Target language found natively', {
                    targetLanguage,
                    displayName: targetLanguageInfo.displayName,
                });
                useNativeTarget = true;
            }
        }

        // Find original language subtitle
        if (originalLanguage) {
            originalLanguageInfo = this.findSubtitleUriForLanguage(
                availableLanguages,
                originalLanguage
            );
            if (!originalLanguageInfo) {
                // Fallback to English
                originalLanguageInfo = this.findSubtitleUriForLanguage(
                    availableLanguages,
                    'en'
                );
            }
        }

        // Universal fallback to first available language
        if (!originalLanguageInfo && availableLanguages.length > 0) {
            originalLanguageInfo = availableLanguages[0];
            this.logger.info('Using first available language as fallback', {
                displayName: originalLanguageInfo.displayName,
                normalizedCode: originalLanguageInfo.normalizedCode,
            });
        }

        if (!originalLanguageInfo) {
            throw new Error(
                'No suitable subtitle language found despite available languages.'
            );
        }

        // Step 5: Fetch and process original language subtitles
        const originalVttText = await this.fetchLanguageSpecificSubtitles(
            originalLanguageInfo.uri,
            masterPlaylistUrl
        );

        // Step 6: Fetch target language subtitles if using native target
        let targetVttText = null;
        if (useNativeTarget && targetLanguageInfo) {
            targetVttText = await this.fetchLanguageSpecificSubtitles(
                targetLanguageInfo.uri,
                masterPlaylistUrl
            );
        }

        const result = {
            vttText: originalVttText,
            targetVttText: targetVttText || originalVttText,
            sourceLanguage: normalizeLanguageCode(
                originalLanguageInfo.normalizedCode
            ),
            targetLanguage: normalizeLanguageCode(targetLanguage),
            useNativeTarget,
            availableLanguages,
            selectedLanguage: originalLanguageInfo.normalizedCode,
            targetLanguageInfo: targetLanguageInfo || { code: targetLanguage },
        };

        this.logger.info('Disney+ subtitle processing completed', {
            useNativeTarget,
            originalLanguage: result.sourceLanguage,
            targetLanguage: result.targetLanguage,
            availableLanguageCount: availableLanguages.length,
        });

        return result;
    }

    /**
     * Process subtitles for any supported platform
     * @param {string} platform - Platform identifier
     * @param {Object} data - Platform-specific data
     * @param {Object} options - Processing options
     * @returns {Promise<Object>} Processed subtitle result
     */
    async processSubtitles(platform, data, options = {}) {
        const startTime = Date.now();

        try {
            this.logger.info('Processing subtitles', {
                platform,
                hasData: !!data,
                options,
            });

            if (!this.supportedPlatforms.has(platform)) {
                const supported = Array.from(this.supportedPlatforms).join(
                    ', '
                );
                throw new Error(
                    `Unsupported platform: ${platform}. Supported platforms are: ${supported}`
                );
            }

            let result;
            switch (platform) {
                case 'netflix':
                    result = await this.processNetflixSubtitles(
                        data,
                        options.targetLanguage,
                        options.originalLanguage,
                        options.useNativeSubtitles,
                        options.useOfficialTranslations
                    );
                    break;

                case 'disneyplus':
                case 'generic':
                    result = await this.fetchAndProcessSubtitles(
                        data.url || data,
                        options.targetLanguage,
                        options.originalLanguage
                    );
                    break;

                default:
                    throw new Error(
                        `Platform processing not implemented: ${platform}`
                    );
            }

            // Update performance metrics
            const processingTime = Date.now() - startTime;
            this.updatePerformanceMetrics(processingTime, true);

            this.logger.info('Subtitle processing completed', {
                platform,
                processingTime,
                resultSize: result.vttText?.length || 0,
            });

            return result;
        } catch (error) {
            this.updatePerformanceMetrics(Date.now() - startTime, false);
            this.logger.error('Subtitle processing failed', error, {
                platform,
            });
            throw error;
        }
    }

    /**
     * Get available subtitle languages for platform data
     * @param {string} platform - Platform identifier
     * @param {Object} data - Platform-specific data
     * @returns {Promise<Array>} Available languages
     */
    async getAvailableLanguages(platform, data) {
        try {
            this.logger.debug('Getting available languages', { platform });

            switch (platform) {
                case 'netflix': {
                    if (!data || !data.tracks) {
                        return [];
                    }
                    const { availableLanguages } =
                        netflixParser.extractNetflixTracks(
                            data,
                            'en-US',
                            'zh-CN' // Default languages for extraction
                        );
                    return availableLanguages;
                }

                case 'disneyplus':
                case 'generic':
                    // For generic platforms, we can't determine available languages
                    // without additional metadata
                    return [];

                default:
                    this.logger.warn(
                        'Language detection not supported for platform',
                        { platform }
                    );
                    return [];
            }
        } catch (error) {
            this.logger.error('Failed to get available languages', error, {
                platform,
            });
            return [];
        }
    }

    /**
     * Update performance metrics
     * @param {number} processingTime - Processing time in milliseconds
     * @param {boolean} success - Whether processing was successful
     */
    updatePerformanceMetrics(processingTime, success) {
        this.performanceMetrics.totalProcessed++;

        if (success) {
            // Update average processing time
            const total = this.performanceMetrics.totalProcessed;
            const currentAvg = this.performanceMetrics.averageProcessingTime;
            this.performanceMetrics.averageProcessingTime =
                (currentAvg * (total - 1) + processingTime) / total;
        } else {
            this.performanceMetrics.errors++;
        }
    }

    /**
     * Get service performance metrics
     * @returns {Object} Performance metrics
     */
    getPerformanceMetrics() {
        return {
            ...this.performanceMetrics,
            errorRate:
                this.performanceMetrics.totalProcessed > 0
                    ? (this.performanceMetrics.errors /
                          this.performanceMetrics.totalProcessed) *
                      100
                    : 0,
        };
    }

    /**
     * Clear processing cache
     */
    clearCache() {
        this.processingCache.clear();
        this.logger.debug('Processing cache cleared');
    }

    /**
     * Get supported platforms
     * @returns {Array} Supported platform names
     */
    getSupportedPlatforms() {
        return Array.from(this.supportedPlatforms);
    }

    /**
     * Fetch language-specific subtitles from URI
     */
    async fetchLanguageSpecificSubtitles(uri, masterPlaylistUrl) {
        const fullSubtitleUrl = new URL(uri, masterPlaylistUrl).href;
        this.logger.info('Fetching language-specific subtitle playlist', {
            url: fullSubtitleUrl.substring(0, 100),
        });

        const subtitleText = await vttParser.fetchText(fullSubtitleUrl);

        if (subtitleText.trim().toUpperCase().startsWith('WEBVTT')) {
            this.logger.debug('Subtitle URI pointed directly to VTT content');
            return subtitleText;
        } else if (subtitleText.trim().startsWith('#EXTM3U')) {
            this.logger.debug(
                'Subtitle-specific playlist is an M3U8. Parsing for VTT segments'
            );
            return await vttParser.processM3U8Playlist(fullSubtitleUrl);
        } else {
            throw new Error(
                'Content from subtitle playlist URI was not a recognized M3U8 or VTT.'
            );
        }
    }

    /**
     * Parse available subtitle languages from master M3U8 playlist
     * Ported from original background script
     */
    parseAvailableSubtitleLanguages(masterPlaylistText) {
        const lines = masterPlaylistText.split('\n');
        const languages = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith('#EXT-X-MEDIA:TYPE=SUBTITLES')) {
                const languageMatch = line.match(/LANGUAGE="([^"]+)"/);
                const nameMatch = line.match(/NAME="([^"]+)"/);
                const uriMatch = line.match(/URI="([^"]+)"/);

                if (languageMatch && nameMatch && uriMatch) {
                    const languageCode = languageMatch[1];
                    const displayName = nameMatch[1];
                    const uri = uriMatch[1];

                    languages.push({
                        normalizedCode: normalizeLanguageCode(languageCode),
                        displayName: displayName,
                        uri: uri,
                        originalCode: languageCode,
                    });
                }
            }
        }

        this.logger.debug('Parsed subtitle languages from master playlist', {
            count: languages.length,
            languages: languages.map(
                (l) => `${l.normalizedCode} (${l.displayName})`
            ),
        });

        return languages;
    }

    /**
     * Find subtitle URI for specific language
     * Ported from original background script
     */
    findSubtitleUriForLanguage(availableLanguages, targetLanguageCode) {
        const normalizedTarget = normalizeLanguageCode(targetLanguageCode);

        // First try exact match
        let match = availableLanguages.find(
            (lang) => lang.normalizedCode === normalizedTarget
        );

        if (!match) {
            // Try partial match (e.g., 'en' matches 'en-US')
            match = availableLanguages.find(
                (lang) =>
                    lang.normalizedCode.startsWith(normalizedTarget) ||
                    normalizedTarget.startsWith(lang.normalizedCode)
            );
        }

        if (match) {
            this.logger.debug('Found subtitle URI for language', {
                targetLanguage: targetLanguageCode,
                normalizedTarget,
                foundLanguage: match.normalizedCode,
                displayName: match.displayName,
                uri: match.uri,
            });
        } else {
            this.logger.debug('No subtitle URI found for language', {
                targetLanguage: targetLanguageCode,
                normalizedTarget,
                availableLanguages: availableLanguages.map(
                    (l) => l.normalizedCode
                ),
            });
        }

        return match || null;
    }
}

// Export singleton instance
export const subtitleService = new SubtitleService();
