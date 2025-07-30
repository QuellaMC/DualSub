/**
 * Netflix Subtitle Parser
 * 
 * Integrates with SubtitleProcessingManager from shared utilities
 * and adds Netflix-specific subtitle data processing.
 * 
 * Reuses existing Netflix parsing logic and track selection.
 * 
 * @author DualSub Extension
 * @version 2.0.0
 */

import { normalizeLanguageCode } from '../../utils/languageNormalization.js';
import { ttmlParser } from './ttmlParser.js';
import { loggingManager } from '../utils/loggingManager.js';

class NetflixParser {
    constructor() {
        this.logger = loggingManager.createLogger('NetflixParser');
        this.subtitleManager = null;
    }

    /**
     * Initialize the Netflix parser with SubtitleProcessingManager
     * @param {Object} config - Configuration options
     */
    initialize(config = {}) {
        // Note: SubtitleProcessingManager not available in ServiceWorker context
        // Netflix processing will use simplified ServiceWorker-compatible methods
        this.config = {
            useOfficialTranslations: config.useOfficialTranslations || false,
            ...config
        };
        this.logger.debug('Netflix parser initialized in ServiceWorker mode');
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
    async processNetflixSubtitleData(
        data,
        targetLanguage = 'zh-CN',
        originalLanguage = 'en',
        useNativeSubtitles = true,
        useOfficialTranslations = undefined
    ) {
        this.logger.info('Processing Netflix subtitle data', {
            targetLanguage,
            originalLanguage,
            useNativeSubtitles,
            useOfficialTranslations,
            hasData: !!data,
            trackCount: data?.tracks?.length || 0,
        });

        // Initialize if not already done
        if (!this.subtitleManager) {
            this.initialize({
                useOfficialTranslations: useOfficialTranslations !== undefined 
                    ? useOfficialTranslations 
                    : useNativeSubtitles
            });
        }

        // Normalize the official translations setting
        const useOfficialSubtitles = useOfficialTranslations !== undefined
            ? useOfficialTranslations
            : useNativeSubtitles;

        if (!data || !data.tracks) {
            throw new Error('Invalid Netflix subtitle data provided');
        }

        try {
            // Extract available languages and tracks
            const { availableLanguages, originalTrack, targetTrack } = 
                this.extractNetflixTracks(data, originalLanguage, targetLanguage);

            this.logger.debug('Netflix tracks extracted', {
                availableLanguageCount: availableLanguages.length,
                hasOriginalTrack: !!originalTrack,
                hasTargetTrack: !!targetTrack,
            });

            // Process original language subtitles
            let originalVttText = '';
            let sourceLanguage = originalLanguage;

            if (originalTrack) {
                this.logger.debug('Processing original track', {
                    language: originalTrack.language,
                    trackType: originalTrack.trackType,
                });

                const originalSubtitleText = await this.fetchNetflixSubtitleContent(originalTrack);
                originalVttText = ttmlParser.convertTtmlToVtt(originalSubtitleText);
                sourceLanguage = normalizeLanguageCode(originalTrack.language);
            }

            // Process target language subtitles
            let targetVttText = '';
            let useNativeTarget = false;

            if (targetTrack && useOfficialSubtitles) {
                this.logger.debug('Processing target track (official)', {
                    language: targetTrack.language,
                    trackType: targetTrack.trackType,
                });

                const targetSubtitleText = await this.fetchNetflixSubtitleContent(targetTrack);
                targetVttText = ttmlParser.convertTtmlToVtt(targetSubtitleText);
                useNativeTarget = true;
            } else if (originalVttText) {
                this.logger.debug('Will use API translation for target language');
                // API translation will be handled by the translation service
                targetVttText = originalVttText; // Placeholder - will be translated
                useNativeTarget = false;
            }

            const result = {
                vttText: originalVttText,
                targetVttText: targetVttText,
                sourceLanguage: sourceLanguage,
                targetLanguage: normalizeLanguageCode(targetLanguage),
                useNativeTarget: useNativeTarget,
                availableLanguages: availableLanguages,
                url: originalTrack?.downloadUrl || 'Netflix TTML',
            };

            this.logger.info('Netflix subtitle processing completed', {
                originalVttLength: originalVttText.length,
                targetVttLength: targetVttText.length,
                sourceLanguage: result.sourceLanguage,
                targetLanguage: result.targetLanguage,
                useNativeTarget: result.useNativeTarget,
                availableLanguageCount: availableLanguages.length,
            });

            return result;

        } catch (error) {
            this.logger.error('Netflix subtitle processing failed', error, {
                targetLanguage,
                originalLanguage,
                trackCount: data.tracks.length,
                errorMessage: error.message,
                errorStack: error.stack
            });

            // Return a fallback response instead of throwing to prevent the entire pipeline from failing
            return {
                vttText: '',
                targetVttText: '',
                sourceLanguage: originalLanguage,
                targetLanguage: targetLanguage,
                useNativeTarget: false,
                availableLanguages: [],
                url: null,
                error: error.message
            };
        }
    }

    /**
     * Extract and organize Netflix tracks
     * @param {Object} data - Netflix subtitle data
     * @param {string} originalLanguage - Original language code
     * @param {string} targetLanguage - Target language code
     * @returns {Object} Extracted tracks and languages
     */
    extractNetflixTracks(data, originalLanguage, targetLanguage) {
        const timedtexttracks = data.tracks;
        const availableLanguages = [];

        // Filter valid tracks
        const validTracks = timedtexttracks.filter(
            (track) => !track.isNoneTrack && !track.isForcedNarrative
        );

        // Process tracks to build available languages list
        for (const track of validTracks) {
            const rawLangCode = track.language;
            const normalizedLangCode = normalizeLanguageCode(rawLangCode);
            let downloadUrl = this.extractDownloadUrl(track);

            if (downloadUrl) {
                availableLanguages.push({
                    rawCode: rawLangCode,
                    normalizedCode: normalizedLangCode,
                    displayName: track.displayName || rawLangCode,
                    downloadUrl: downloadUrl,
                    trackType: track.trackType,
                });
            }
        }

        // Find best tracks for original and target languages
        const normalizedOriginal = normalizeLanguageCode(originalLanguage);
        const normalizedTarget = normalizeLanguageCode(targetLanguage);

        const originalTrack = this.getBestTrackForLanguage(validTracks, normalizedOriginal);
        const targetTrack = this.getBestTrackForLanguage(validTracks, normalizedTarget);

        return {
            availableLanguages,
            originalTrack: originalTrack ? {
                ...originalTrack,
                downloadUrl: this.extractDownloadUrl(originalTrack)
            } : null,
            targetTrack: targetTrack ? {
                ...targetTrack,
                downloadUrl: this.extractDownloadUrl(targetTrack)
            } : null,
        };
    }

    /**
     * Get best track for a specific language (reuses existing logic)
     * @param {Array} tracks - Available tracks
     * @param {string} langCode - Language code
     * @returns {Object|null} Best matching track
     */
    getBestTrackForLanguage(tracks, langCode) {
        const matchingTracks = tracks.filter((track) => {
            const trackLangCode = normalizeLanguageCode(track.language);
            return trackLangCode === langCode;
        });

        if (matchingTracks.length === 0) return null;

        // Prefer PRIMARY track type
        const primaryTrack = matchingTracks.find(
            (track) => track.trackType === 'PRIMARY'
        );
        if (primaryTrack) {
            return primaryTrack;
        }

        // Fall back to ASSISTIVE track type
        const assistiveTrack = matchingTracks.find(
            (track) => track.trackType === 'ASSISTIVE'
        );
        if (assistiveTrack) {
            return assistiveTrack;
        }

        // Return first available track
        return matchingTracks[0];
    }

    /**
     * Extract download URL from Netflix track
     * @param {Object} track - Netflix track object
     * @returns {string|null} Download URL
     */
    extractDownloadUrl(track) {
        let downloadables = null;

        this.logger.debug('Extracting download URL from track', {
            hasTrack: !!track,
            hasTtDownloadables: !!track?.ttDownloadables,
            hasRawTrack: !!track?.rawTrack,
            trackLanguage: track?.language,
            trackKeys: track ? Object.keys(track) : []
        });

        if (
            track.ttDownloadables &&
            typeof track.ttDownloadables === 'object' &&
            !Array.isArray(track.ttDownloadables)
        ) {
            downloadables = track.ttDownloadables;
            this.logger.debug('Using track.ttDownloadables', {
                formats: Object.keys(downloadables)
            });
        } else if (track.rawTrack?.ttDownloadables) {
            downloadables = track.rawTrack.ttDownloadables;
            this.logger.debug('Using track.rawTrack.ttDownloadables', {
                formats: Object.keys(downloadables)
            });
        }

        if (downloadables) {
            const formats = Object.keys(downloadables);
            this.logger.debug('Processing downloadable formats', {
                formats,
                formatCount: formats.length
            });

            for (const format of formats) {
                const formatData = downloadables[format];
                this.logger.debug('Checking format data', {
                    format,
                    hasFormatData: !!formatData,
                    hasUrls: !!formatData?.urls,
                    hasDownloadUrls: !!formatData?.downloadUrls,
                    urlsLength: formatData?.urls?.length || 0,
                    downloadUrlsLength: formatData?.downloadUrls?.length || 0
                });

                // Check for both 'urls' and 'downloadUrls' to handle different Netflix data structures
                if (formatData && formatData.urls && formatData.urls.length > 0) {
                    const url = formatData.urls[0].url || formatData.urls[0];
                    this.logger.debug('Found URL in urls array', { format, url: url.substring(0, 100) + '...' });
                    return url;
                } else if (formatData && formatData.downloadUrls && formatData.downloadUrls.length > 0) {
                    const url = formatData.downloadUrls[0].url || formatData.downloadUrls[0];
                    this.logger.debug('Found URL in downloadUrls array', { format, url: url.substring(0, 100) + '...' });
                    return url;
                }
            }
        }

        this.logger.warn('No download URL found for track', {
            hasDownloadables: !!downloadables,
            trackLanguage: track?.language
        });
        return null;
    }

    /**
     * Fetch Netflix subtitle content from URL
     * @param {Object} track - Netflix track with download URL
     * @returns {Promise<string>} Subtitle content
     */
    async fetchNetflixSubtitleContent(track) {
        if (!track.downloadUrl) {
            throw new Error('No download URL available for Netflix track');
        }

        this.logger.debug('Fetching Netflix subtitle content', {
            url: track.downloadUrl,
            language: track.language,
        });

        try {
            const response = await fetch(track.downloadUrl);
            if (!response.ok) {
                throw new Error(`HTTP error ${response.status} for ${track.downloadUrl}`);
            }
            const content = await response.text();
            
            this.logger.debug('Netflix subtitle content fetched', {
                contentLength: content.length,
                language: track.language,
            });

            return content;
        } catch (error) {
            this.logger.error('Failed to fetch Netflix subtitle content', error, {
                url: track.downloadUrl,
                language: track.language,
            });
            throw error;
        }
    }
}

// Export singleton instance
export const netflixParser = new NetflixParser();
