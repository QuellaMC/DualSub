import { normalizeLanguageCode } from '../../utils/languageNormalization.js';
import { ttmlParser } from './ttmlParser.js';
import { loggingManager } from '../utils/loggingManager.js';
import { isAuthorizedSubtitleRequestSnapshot } from '../utils/subtitleRequestPolicy.js';
import { SubtitleRequestSources } from '../../content_scripts/shared/constants/messageActions.js';
import { fetchAuthorizedSubtitleText } from '../utils/subtitleFetch.js';

const MAX_NETFLIX_TTML_BYTES = 2 * 1024 * 1024;

function trackTypeForLog(track) {
    return track?.trackType === 'PRIMARY' || track?.trackType === 'ASSISTIVE'
        ? track.trackType
        : 'other';
}

function hasText(record, key) {
    return typeof record?.[key] === 'string' && record[key].length > 0;
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

function readNetflixSignal(options) {
    return options?.signal;
}

function isCallerAbortError(error) {
    return error?.code === 'ERR_FETCH_ABORTED';
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
        const trackCountForLog = Array.isArray(data?.tracks)
            ? data.tracks.length
            : 0;
        this.logger.info('Processing Netflix subtitle data', {
            hasTargetLanguage: hasText(snapshot, 'targetLanguage'),
            hasOriginalLanguage: hasText(snapshot, 'originalLanguage'),
            useNativeSubtitles: !!useNativeSubtitles,
            useOfficialTranslations: !!useOfficialTranslations,
            hasData: !!data,
            trackCount: trackCountForLog,
        });

        if (!this.config) {
            this.initialize({
                useOfficialTranslations:
                    useOfficialTranslations !== undefined
                        ? useOfficialTranslations
                        : useNativeSubtitles,
            });
        }

        const useOfficialSubtitles =
            useOfficialTranslations !== undefined
                ? useOfficialTranslations
                : useNativeSubtitles;

        if (!data || !Array.isArray(data.tracks)) {
            throw new Error('Netflix subtitle tracks must be an array');
        }

        try {
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

            let originalVttText = '';
            let sourceLanguage = originalLanguage;

            let selectedOriginalTrack = originalTrack;
            if (!selectedOriginalTrack) {
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
                            hasFallbackLanguage: hasText(
                                fallbackCandidate,
                                'normalizedCode'
                            ),
                            hasDisplayName: hasText(
                                fallbackCandidate,
                                'displayName'
                            ),
                            trackType: trackTypeForLog(fallbackCandidate),
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
                hasLanguage: hasText(selectedOriginalTrack, 'language'),
                trackType: trackTypeForLog(selectedOriginalTrack),
            });

            const originalSubtitleText = await this.fetchNetflixSubtitleContent(
                snapshot,
                selectedOriginalTrack,
                { signal }
            );
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
                        hasLanguage: hasText(targetTrack, 'language'),
                        trackType: trackTypeForLog(targetTrack),
                    });

                    const targetSubtitleText =
                        await this.fetchNetflixSubtitleContent(
                            snapshot,
                            targetTrack,
                            { signal }
                        );
                    const convertedTargetVttText =
                        ttmlParser.convertTtmlToVtt(targetSubtitleText);
                    targetVttText = convertedTargetVttText;
                    useNativeTarget = true;
                } catch (error) {
                    if (isCallerAbortError(error)) throw error;
                    this.logger?.warn(
                        'Official Netflix target track processing failed, falling back to API translation',
                        {
                            stage: 'target-track',
                            source: SubtitleRequestSources.NETFLIX,
                            hasTargetLanguage: hasText(targetTrack, 'language'),
                            trackType: trackTypeForLog(targetTrack),
                            errorCategory: 'processing',
                        }
                    );
                }
            } else {
                if (targetTrack && !targetTrack.downloadUrl) {
                    this.logger.info(
                        'Target track found but no download URL available, falling back to API translation',
                        {
                            hasTargetLanguage: hasText(targetTrack, 'language'),
                            trackType: trackTypeForLog(targetTrack),
                        }
                    );
                } else {
                    this.logger.debug(
                        'Will use API translation for target language'
                    );
                }
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
                hasSourceLanguage: hasText(result, 'sourceLanguage'),
                hasTargetLanguage: hasText(result, 'targetLanguage'),
                useNativeTarget: result.useNativeTarget,
                availableLanguageCount: availableLanguages.length,
            });

            return result;
        } catch (error) {
            if (isCallerAbortError(error)) throw error;
            this.logger?.error('Netflix subtitle processing failed', null, {
                stage: 'process',
                source: SubtitleRequestSources.NETFLIX,
                hasTargetLanguage: hasText(snapshot, 'targetLanguage'),
                hasOriginalLanguage: hasText(snapshot, 'originalLanguage'),
                trackCount: trackCountForLog,
                errorCategory: 'subtitle',
            });

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

        const validTracks = timedtexttracks.filter(
            (track) =>
                track &&
                typeof track.language === 'string' &&
                !track.isNoneTrack &&
                !track.isForcedNarrative
        );

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

        const primaryTrack = matchingTracks.find(
            (track) => track.trackType === 'PRIMARY'
        );
        if (primaryTrack) {
            return primaryTrack;
        }

        const assistiveTrack = matchingTracks.find(
            (track) => track.trackType === 'ASSISTIVE'
        );
        if (assistiveTrack) {
            return assistiveTrack;
        }

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

        this.logger.debug('Extracting download URL from track', {
            hasTtDownloadables: !!track?.ttDownloadables,
            hasRawTrack: !!track?.rawTrack,
            hasLanguage: hasText(track, 'language'),
            trackType: trackTypeForLog(track),
        });

        const downloadables =
            track.ttDownloadables ?? track.rawTrack?.ttDownloadables;
        if (!downloadables || typeof downloadables !== 'object') return null;

        for (const formatData of Object.values(downloadables)) {
            const candidates = formatData?.urls?.length
                ? formatData.urls
                : formatData?.downloadUrls;
            const first = candidates?.[0];
            const url = typeof first === 'string' ? first : first?.url;
            if (typeof url === 'string' && url.length > 0) return url;
        }

        this.logger.warn('No download URL found for track', {
            hasLanguage: hasText(track, 'language'),
            trackType: trackTypeForLog(track),
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
            hasLanguage: hasText(track, 'language'),
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
                hasLanguage: hasText(track, 'language'),
            });

            return content;
        } catch (error) {
            if (isCallerAbortError(error)) throw error;
            this.logger?.error(
                'Failed to fetch Netflix subtitle content',
                null,
                {
                    stage: 'fetch',
                    source: SubtitleRequestSources.NETFLIX,
                    hasLanguage: hasText(track, 'language'),
                    errorCategory: 'transport',
                }
            );
            throw error;
        }
    }
}

export const netflixParser = new NetflixParser();
