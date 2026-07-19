/**
 * Netflix Subtitle Parser
 *
 * Provides Service Worker-compatible Netflix subtitle parsing and track
 * selection without depending on DOM-only content-script utilities.
 *
 * @author DualSub Extension
 * @version 2.0.0
 */

import { normalizeLanguageCode } from '../../utils/languageNormalization.js';
import { ttmlParser } from './ttmlParser.js';
import { loggingManager } from '../utils/loggingManager.js';
import { isAuthorizedSubtitleRequestSnapshot } from '../utils/subtitleRequestPolicy.js';
import { SubtitleRequestSources } from '../../content_scripts/shared/constants/messageActions.js';
import { fetchAuthorizedSubtitleText } from '../utils/subtitleFetch.js';

// Provisional security ceiling only. The repository has no authoritative
// Netflix TTML body limit, and this value has not been validated against live
// long-form catalog telemetry.
export const MAX_NETFLIX_TTML_BYTES = 2 * 1024 * 1024;

function readSafeTrackTypeForLog(record) {
    if (
        record === null ||
        (typeof record !== 'object' && typeof record !== 'function')
    ) {
        return 'other';
    }

    try {
        const descriptor = Object.getOwnPropertyDescriptor(record, 'trackType');
        const value =
            descriptor && Object.hasOwn(descriptor, 'value')
                ? descriptor.value
                : undefined;
        return value === 'PRIMARY' || value === 'ASSISTIVE' ? value : 'other';
    } catch (_) {
        return 'other';
    }
}

function hasOwnNonemptyStringForLog(record, key) {
    if (
        record === null ||
        (typeof record !== 'object' && typeof record !== 'function')
    ) {
        return false;
    }

    try {
        const descriptor = Object.getOwnPropertyDescriptor(record, key);
        return (
            descriptor !== undefined &&
            Object.hasOwn(descriptor, 'value') &&
            typeof descriptor.value === 'string' &&
            descriptor.value.length > 0
        );
    } catch (_) {
        return false;
    }
}

function createNetflixAuthorizationError() {
    const error = new Error('Netflix subtitle request is unauthorized.');
    error.name = 'NetflixParserAuthorizationError';
    error.code = 'ERR_NETFLIX_SUBTITLE_REQUEST_UNAUTHORIZED';
    return error;
}

function assertAuthorizedNetflixSnapshot(snapshot) {
    if (
        !isAuthorizedSubtitleRequestSnapshot(snapshot) ||
        snapshot.source !== SubtitleRequestSources.NETFLIX
    ) {
        throw createNetflixAuthorizationError();
    }
}

function createNetflixInputError() {
    const error = new TypeError(
        'Netflix subtitle processing input is invalid.'
    );
    error.name = 'NetflixParserInputError';
    error.code = 'ERR_NETFLIX_SUBTITLE_INPUT_INVALID';
    return error;
}

function readNetflixSignal(options) {
    if (options === undefined) return undefined;
    if (
        options === null ||
        (typeof options !== 'object' && typeof options !== 'function')
    ) {
        throw createNetflixInputError();
    }

    let descriptor;
    try {
        descriptor = Object.getOwnPropertyDescriptor(options, 'signal');
    } catch (_) {
        throw createNetflixInputError();
    }
    if (!descriptor) return undefined;
    if (!Object.hasOwn(descriptor, 'value')) throw createNetflixInputError();
    return descriptor.value;
}

function isCallerAbortError(error) {
    if (
        error === null ||
        (typeof error !== 'object' && typeof error !== 'function')
    ) {
        return false;
    }
    try {
        return (
            Object.getOwnPropertyDescriptor(error, 'code')?.value ===
            'ERR_FETCH_ABORTED'
        );
    } catch (_) {
        return false;
    }
}

class NetflixParser {
    constructor() {
        this.logger = loggingManager.createLogger('NetflixParser');
    }

    /**
     * Initialize the Netflix parser.
     * @param {Object} config - Configuration options
     */
    initialize(config = {}) {
        this.config = {
            useOfficialTranslations: config.useOfficialTranslations || false,
            ...config,
        };
        this.logger.debug('Netflix parser initialized in ServiceWorker mode');
    }

    /**
     * Process Netflix subtitle data
     * @param {Object} snapshot - Authorized Netflix subtitle request snapshot
     * @param {Object} [options] - Internal processing options
     * @param {AbortSignal} [options.signal] - Optional internal abort signal
     * @returns {Promise<Object>} Processed subtitle result
     */
    async processNetflixSubtitleData(snapshot, options) {
        assertAuthorizedNetflixSnapshot(snapshot);
        const signal = readNetflixSignal(options);
        const {
            data,
            targetLanguage,
            originalLanguage,
            useNativeSubtitles,
            useOfficialTranslations,
        } = snapshot;
        let trackCountForLog = 0;
        try {
            const tracksForLog = data?.tracks;
            if (Array.isArray(tracksForLog)) {
                const tracksLengthForLog = tracksForLog.length;
                if (
                    Number.isSafeInteger(tracksLengthForLog) &&
                    tracksLengthForLog >= 0
                ) {
                    trackCountForLog = tracksLengthForLog;
                }
            }
        } catch (_) {}
        this.logger.info('Processing Netflix subtitle data', {
            hasTargetLanguage: hasOwnNonemptyStringForLog(
                snapshot,
                'targetLanguage'
            ),
            hasOriginalLanguage: hasOwnNonemptyStringForLog(
                snapshot,
                'originalLanguage'
            ),
            useNativeSubtitles: !!useNativeSubtitles,
            useOfficialTranslations: !!useOfficialTranslations,
            hasData: !!data,
            trackCount: trackCountForLog,
        });

        // Initialize if not already done
        if (!this.config) {
            this.initialize({
                useOfficialTranslations:
                    useOfficialTranslations !== undefined
                        ? useOfficialTranslations
                        : useNativeSubtitles,
            });
        }

        // Normalize the official translations setting
        const useOfficialSubtitles =
            useOfficialTranslations !== undefined
                ? useOfficialTranslations
                : useNativeSubtitles;

        if (!data || !Array.isArray(data.tracks)) {
            throw new Error('Netflix subtitle tracks must be an array');
        }

        try {
            // Extract available languages and tracks
            const { availableLanguages, originalTrack, targetTrack } =
                this.extractNetflixTracks(
                    data,
                    originalLanguage,
                    targetLanguage
                );

            this.logger.debug('Netflix tracks extracted', {
                availableLanguageCount: availableLanguages.length,
                hasOriginalTrack: !!originalTrack,
                hasTargetTrack: !!targetTrack,
            });

            // Process original language subtitles (with fallback selection)
            let originalVttText = '';
            let sourceLanguage = originalLanguage;

            // Choose effective original track with fallback when requested language is unavailable
            let selectedOriginalTrack = originalTrack;
            if (!selectedOriginalTrack) {
                // Try English first
                const englishCandidate = availableLanguages.find(
                    (lang) =>
                        lang?.normalizedCode === 'en' ||
                        (typeof lang?.normalizedCode === 'string' &&
                            lang.normalizedCode.startsWith('en'))
                );

                const fallbackCandidate =
                    englishCandidate || availableLanguages[0] || null;

                if (fallbackCandidate) {
                    this.logger.info(
                        'Requested original language not found, using fallback',
                        {
                            hasRequestedLanguage:
                                typeof originalLanguage === 'string' &&
                                originalLanguage.length > 0,
                            hasFallbackLanguage: hasOwnNonemptyStringForLog(
                                fallbackCandidate,
                                'normalizedCode'
                            ),
                            hasDisplayName: hasOwnNonemptyStringForLog(
                                fallbackCandidate,
                                'displayName'
                            ),
                            trackType:
                                readSafeTrackTypeForLog(fallbackCandidate),
                        }
                    );
                    selectedOriginalTrack = {
                        language: fallbackCandidate.rawCode,
                        trackType: fallbackCandidate.trackType,
                        downloadUrl: fallbackCandidate.downloadUrl,
                    };
                } else {
                    this.logger.warn(
                        'No available languages to fallback to for Netflix subtitles'
                    );
                }
            }

            if (!selectedOriginalTrack) {
                throw new Error(
                    'No usable Netflix subtitle track was available'
                );
            }

            this.logger.debug('Processing original track', {
                hasLanguage: hasOwnNonemptyStringForLog(
                    selectedOriginalTrack,
                    'language'
                ),
                trackType: readSafeTrackTypeForLog(selectedOriginalTrack),
            });

            const originalSubtitleText = await (signal === undefined
                ? this.fetchNetflixSubtitleContent(
                      snapshot,
                      selectedOriginalTrack
                  )
                : this.fetchNetflixSubtitleContent(
                      snapshot,
                      selectedOriginalTrack,
                      { signal }
                  ));
            originalVttText = ttmlParser.convertTtmlToVtt(originalSubtitleText);
            sourceLanguage = normalizeLanguageCode(
                selectedOriginalTrack.language
            );

            // Default to API translation so an optional official target failure
            // cannot discard the already-valid original subtitles.
            let targetVttText = originalVttText;
            let useNativeTarget = false;

            if (
                targetTrack &&
                targetTrack.downloadUrl &&
                useOfficialSubtitles
            ) {
                try {
                    this.logger.debug('Processing target track (official)', {
                        hasLanguage: hasOwnNonemptyStringForLog(
                            targetTrack,
                            'language'
                        ),
                        trackType: readSafeTrackTypeForLog(targetTrack),
                    });

                    const targetSubtitleText = await (signal === undefined
                        ? this.fetchNetflixSubtitleContent(
                              snapshot,
                              targetTrack
                          )
                        : this.fetchNetflixSubtitleContent(
                              snapshot,
                              targetTrack,
                              { signal }
                          ));
                    const convertedTargetVttText =
                        ttmlParser.convertTtmlToVtt(targetSubtitleText);
                    targetVttText = convertedTargetVttText;
                    useNativeTarget = true;
                } catch (error) {
                    if (isCallerAbortError(error)) throw error;
                    try {
                        this.logger?.warn(
                            'Official Netflix target track processing failed, falling back to API translation',
                            {
                                stage: 'target-track',
                                source: SubtitleRequestSources.NETFLIX,
                                hasTargetLanguage: hasOwnNonemptyStringForLog(
                                    targetTrack,
                                    'language'
                                ),
                                trackType: readSafeTrackTypeForLog(targetTrack),
                                errorCategory: 'processing',
                            }
                        );
                    } catch (_) {}
                }
            } else {
                if (targetTrack && !targetTrack.downloadUrl) {
                    this.logger.info(
                        'Target track found but no download URL available, falling back to API translation',
                        {
                            hasTargetLanguage: hasOwnNonemptyStringForLog(
                                targetTrack,
                                'language'
                            ),
                            trackType: readSafeTrackTypeForLog(targetTrack),
                        }
                    );
                } else {
                    this.logger.debug(
                        'Will use API translation for target language'
                    );
                }
                // API translation will be handled by the translation service
            }

            const result = {
                vttText: originalVttText,
                targetVttText: targetVttText,
                sourceLanguage: sourceLanguage,
                targetLanguage: normalizeLanguageCode(targetLanguage),
                useNativeTarget: useNativeTarget,
                availableLanguages: availableLanguages,
                url: selectedOriginalTrack?.downloadUrl || 'Netflix TTML',
            };

            this.logger.info('Netflix subtitle processing completed', {
                originalVttLength: originalVttText.length,
                targetVttLength: targetVttText.length,
                hasSourceLanguage: hasOwnNonemptyStringForLog(
                    result,
                    'sourceLanguage'
                ),
                hasTargetLanguage: hasOwnNonemptyStringForLog(
                    result,
                    'targetLanguage'
                ),
                useNativeTarget: result.useNativeTarget,
                availableLanguageCount: availableLanguages.length,
            });

            return result;
        } catch (error) {
            if (isCallerAbortError(error)) throw error;
            try {
                this.logger?.error('Netflix subtitle processing failed', null, {
                    stage: 'process',
                    source: SubtitleRequestSources.NETFLIX,
                    hasTargetLanguage: hasOwnNonemptyStringForLog(
                        snapshot,
                        'targetLanguage'
                    ),
                    hasOriginalLanguage: hasOwnNonemptyStringForLog(
                        snapshot,
                        'originalLanguage'
                    ),
                    trackCount: trackCountForLog,
                    errorCategory: 'subtitle',
                });
            } catch (_) {}

            throw error;
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
            (track) =>
                track &&
                typeof track.language === 'string' &&
                !track.isNoneTrack &&
                !track.isForcedNarrative
        );

        // Process tracks to build available languages list
        for (const track of validTracks) {
            const rawLangCode = track.language;
            const normalizedLangCode = normalizeLanguageCode(rawLangCode);
            const downloadUrl = this.extractDownloadUrl(track);

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

        const originalTrack = this.getBestTrackForLanguage(
            validTracks,
            normalizedOriginal
        );
        const targetTrack = this.getBestTrackForLanguage(
            validTracks,
            normalizedTarget
        );

        return {
            availableLanguages,
            originalTrack: originalTrack
                ? {
                      ...originalTrack,
                      downloadUrl: this.extractDownloadUrl(originalTrack),
                  }
                : null,
            targetTrack: targetTrack
                ? {
                      ...targetTrack,
                      downloadUrl: this.extractDownloadUrl(targetTrack),
                  }
                : null,
        };
    }

    /**
     * Get best track for a specific language (reuses existing logic)
     * @param {Array} tracks - Available tracks
     * @param {string} langCode - Language code
     * @returns {Object|null} Best matching track
     */
    getBestTrackForLanguage(tracks, langCode) {
        const normalizedRequestedLanguage = normalizeLanguageCode(langCode);
        const matchingTracks = tracks.filter((track) => {
            const trackLangCode = normalizeLanguageCode(track.language);
            return trackLangCode === normalizedRequestedLanguage;
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
        if (!track || typeof track !== 'object') {
            return null;
        }

        let downloadables = null;

        this.logger.debug('Extracting download URL from track', {
            hasTrack: !!track,
            hasTtDownloadables: !!track?.ttDownloadables,
            hasRawTrack: !!track?.rawTrack,
            hasLanguage: hasOwnNonemptyStringForLog(track, 'language'),
            trackType: readSafeTrackTypeForLog(track),
        });

        if (
            track.ttDownloadables &&
            typeof track.ttDownloadables === 'object' &&
            !Array.isArray(track.ttDownloadables)
        ) {
            downloadables = track.ttDownloadables;
            this.logger.debug('Using track.ttDownloadables', {
                formatCount: Object.keys(downloadables).length,
            });
        } else if (track.rawTrack?.ttDownloadables) {
            downloadables = track.rawTrack.ttDownloadables;
            this.logger.debug('Using track.rawTrack.ttDownloadables', {
                formatCount: Object.keys(downloadables).length,
            });
        }

        if (downloadables) {
            const formats = Object.keys(downloadables);
            this.logger.debug('Processing downloadable formats', {
                formatCount: formats.length,
            });

            for (const format of formats) {
                const formatData = downloadables[format];
                const urlsForLog = formatData?.urls;
                const downloadUrlsForLog = formatData?.downloadUrls;
                const rawUrlsLengthForLog = Array.isArray(urlsForLog)
                    ? urlsForLog.length
                    : 0;
                const rawDownloadUrlsLengthForLog = Array.isArray(
                    downloadUrlsForLog
                )
                    ? downloadUrlsForLog.length
                    : 0;
                this.logger.debug('Checking format data', {
                    hasFormatData: !!formatData,
                    hasUrls: !!urlsForLog,
                    hasDownloadUrls: !!downloadUrlsForLog,
                    urlsLength:
                        Number.isSafeInteger(rawUrlsLengthForLog) &&
                        rawUrlsLengthForLog >= 0
                            ? rawUrlsLengthForLog
                            : 0,
                    downloadUrlsLength:
                        Number.isSafeInteger(rawDownloadUrlsLengthForLog) &&
                        rawDownloadUrlsLengthForLog >= 0
                            ? rawDownloadUrlsLengthForLog
                            : 0,
                });

                // Check for both 'urls' and 'downloadUrls' to handle different Netflix data structures
                if (
                    formatData &&
                    formatData.urls &&
                    formatData.urls.length > 0
                ) {
                    const firstUrl = formatData.urls[0];
                    const url =
                        typeof firstUrl === 'string' ? firstUrl : firstUrl?.url;
                    if (typeof url !== 'string' || url.length === 0) {
                        continue;
                    }
                    this.logger.debug('Found URL in urls array', {
                        urlLength: url.length,
                    });
                    return url;
                } else if (
                    formatData &&
                    formatData.downloadUrls &&
                    formatData.downloadUrls.length > 0
                ) {
                    const firstUrl = formatData.downloadUrls[0];
                    const url =
                        typeof firstUrl === 'string' ? firstUrl : firstUrl?.url;
                    if (typeof url !== 'string' || url.length === 0) {
                        continue;
                    }
                    this.logger.debug('Found URL in downloadUrls array', {
                        urlLength: url.length,
                    });
                    return url;
                }
            }
        }

        this.logger.warn('No download URL found for track', {
            hasDownloadables: !!downloadables,
            hasLanguage: hasOwnNonemptyStringForLog(track, 'language'),
            trackType: readSafeTrackTypeForLog(track),
        });
        return null;
    }

    /**
     * Fetch Netflix subtitle content from URL
     * @param {Object} snapshot - Authorized Netflix subtitle request snapshot
     * @param {Object} track - Netflix track with download URL
     * @param {Object} [options] - Internal fetch options
     * @param {AbortSignal} [options.signal] - Optional internal abort signal
     * @returns {Promise<string>} Subtitle content
     */
    async fetchNetflixSubtitleContent(snapshot, track, options) {
        assertAuthorizedNetflixSnapshot(snapshot);
        const signal = readNetflixSignal(options);
        if (!track.downloadUrl) {
            throw new Error('No download URL available for Netflix track');
        }

        this.logger.debug('Fetching Netflix subtitle content', {
            hasLanguage: hasOwnNonemptyStringForLog(track, 'language'),
        });

        try {
            const fetchOptions = {
                stage: 'netflix-track',
                maxBytes: MAX_NETFLIX_TTML_BYTES,
            };
            if (signal !== undefined) fetchOptions.signal = signal;
            const { text: content } = await fetchAuthorizedSubtitleText(
                snapshot,
                track.downloadUrl,
                fetchOptions
            );

            this.logger.debug('Netflix subtitle content fetched', {
                contentLength: typeof content === 'string' ? content.length : 0,
                hasLanguage: hasOwnNonemptyStringForLog(track, 'language'),
            });

            return content;
        } catch (error) {
            if (isCallerAbortError(error)) throw error;
            try {
                this.logger?.error(
                    'Failed to fetch Netflix subtitle content',
                    null,
                    {
                        stage: 'fetch',
                        source: SubtitleRequestSources.NETFLIX,
                        hasLanguage: hasOwnNonemptyStringForLog(
                            track,
                            'language'
                        ),
                        errorCategory: 'transport',
                    }
                );
            } catch (_) {}
            throw error;
        }
    }
}

// Export singleton instance
export const netflixParser = new NetflixParser();
