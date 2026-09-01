// @ts-check

import { loggingManager } from '../utils/loggingManager.js';
import { MAX_M3U8_PLAYLIST_BYTES, vttParser } from '../parsers/vttParser.js';
import { netflixParser } from '../parsers/netflixParser.js';
import { normalizeLanguageCode } from '../../utils/languageNormalization.js';
import { SubtitleProcessingError } from '../utils/errorHandler.js';
import { configService } from '../../services/configService.js';
import { isAuthorizedSubtitleRequestSnapshot } from '../utils/subtitleRequestPolicy.js';
import { fetchAuthorizedSubtitleText } from '../utils/subtitleFetch.js';
import { SubtitleRequestSources } from '../../content_scripts/shared/constants/messageActions.js';

const DISNEY_MASTER_FETCH_FAILURE = Object.freeze({
    stage: 'master-fetch',
    errorCode: 'DISNEY_MASTER_FETCH_FAILED',
});
const DISNEY_MASTER_PARSE_FAILURE = Object.freeze({
    stage: 'master-parse',
    errorCode: 'DISNEY_MASTER_PARSE_FAILED',
});
const DISNEY_MEDIA_FETCH_FAILURE = Object.freeze({
    stage: 'media-fetch',
    errorCode: 'DISNEY_MEDIA_FETCH_FAILED',
});
const DISNEY_VTT_FETCH_FAILURE = Object.freeze({
    stage: 'vtt-fetch',
    errorCode: 'DISNEY_VTT_FETCH_FAILED',
});

class DisneySubtitleFailure extends Error {
    constructor({ stage, errorCode }) {
        super('Disney+ subtitle processing failed.');
        this.name = 'DisneySubtitleFailure';
        this.stage = stage;
        this.errorCode = errorCode;
    }
}

function markDisneySubtitleFailure(error, metadata) {
    if (isDisneyCallerAbortError(error)) return error;
    return new DisneySubtitleFailure(metadata);
}

export function getDisneySubtitleFailureMetadata(error) {
    return error instanceof DisneySubtitleFailure
        ? { stage: error.stage, errorCode: error.errorCode }
        : null;
}

function assertAuthorizedSnapshot(snapshot, expectedSource) {
    if (
        !isAuthorizedSubtitleRequestSnapshot(snapshot) ||
        snapshot.source !== expectedSource
    ) {
        const platformName =
            expectedSource === SubtitleRequestSources.NETFLIX
                ? 'Netflix'
                : 'Disney+';
        const error = new Error(
            `${platformName} subtitle request is unauthorized.`
        );
        error.name = 'SubtitleServiceAuthorizationError';
        error.code = `ERR_${expectedSource === SubtitleRequestSources.NETFLIX ? 'NETFLIX' : 'DISNEY'}_SUBTITLE_REQUEST_UNAUTHORIZED`;
        throw error;
    }
}

function readSignal(options) {
    return options?.signal;
}

function isNetflixCallerAbortError(error) {
    return error?.code === 'ERR_FETCH_ABORTED';
}

function isDisneyCallerAbortError(error) {
    return (
        error?.code === 'ERR_FETCH_ABORTED' ||
        error?.code === 'ERR_VTT_PROCESSING_ABORTED'
    );
}

/**
 * @typedef {Object} SubtitleProcessingResult
 * @property {string} vttText
 * @property {string} targetVttText
 * @property {string} sourceLanguage
 * @property {string} targetLanguage
 * @property {boolean} useNativeTarget
 * @property {Array<Object>} availableLanguages
 * @property {string|null} url
 */

class SubtitleService {
    constructor() {
        this.logger = null;
        this.isInitialized = false;
        this.supportedPlatforms = new Set(['netflix', 'disneyplus', 'generic']);
        this.performanceMetrics = {
            totalProcessed: 0,
            successfulProcessed: 0,
            averageProcessingTime: 0,
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
            netflixParser.initialize({
                useOfficialTranslations: false,
            });

            this.logger.debug('Parser modules initialized successfully');
        } catch (error) {
            this.logger?.error(
                'Failed to initialize subtitle parser modules',
                null,
                {
                    stage: 'initialize',
                    source: 'parsers',
                }
            );
            throw error;
        }
    }

    /**
     * Process Netflix subtitle data
     * @param {Object} snapshot - Authorized Netflix subtitle request snapshot
     * @param {Object} [options] - Internal processing options
     * @param {AbortSignal} [options.signal] - Optional internal abort signal
     * @returns {Promise<Object>} Processed subtitle result
     */
    async processNetflixSubtitles(snapshot, options) {
        assertAuthorizedSnapshot(snapshot, SubtitleRequestSources.NETFLIX);
        const signal = readSignal(options);
        const {
            targetLanguage,
            originalLanguage,
            useNativeSubtitles,
            useOfficialTranslations,
        } = snapshot;
        this.logger.info('Processing Netflix subtitles', {
            hasTargetLanguage:
                typeof targetLanguage === 'string' && targetLanguage.length > 0,
            hasOriginalLanguage:
                typeof originalLanguage === 'string' &&
                originalLanguage.length > 0,
            useNativeSubtitles: !!useNativeSubtitles,
            useOfficialTranslations: !!useOfficialTranslations,
        });

        try {
            return await netflixParser.processNetflixSubtitleData(snapshot, {
                signal,
            });
        } catch (error) {
            if (isNetflixCallerAbortError(error)) throw error;
            this.logger?.error('Netflix subtitle processing failed', null, {
                stage: 'process',
                source: SubtitleRequestSources.NETFLIX,
                category: 'subtitle',
                errorCode: 'SUBTITLE_PROCESSING_FAILED',
            });

            throw new SubtitleProcessingError(
                'Subtitle processing failed. Some subtitles may not be available.',
                {
                    platform: SubtitleRequestSources.NETFLIX,
                    category: 'subtitle',
                    errorCode: 'SUBTITLE_PROCESSING_FAILED',
                    isRecoverable: true,
                }
            );
        }
    }

    /**
     * Process Disney+ subtitles using the complete logic from original background script
     * This implements the full master playlist → language playlist → VTT segments flow
     */
    async processDisneyPlusSubtitles(snapshot, options = {}) {
        assertAuthorizedSnapshot(snapshot, SubtitleRequestSources.DISNEY_PLUS);
        const signal = readSignal(options);
        const {
            url: masterPlaylistUrl,
            targetLanguage,
            originalLanguage,
        } = snapshot;
        this.logger.info('Processing Disney+ subtitles with complete logic', {
            masterPlaylistUrlLength: masterPlaylistUrl.length,
            hasOriginalLanguage:
                typeof originalLanguage === 'string' &&
                originalLanguage.length > 0,
            hasTargetLanguage:
                typeof targetLanguage === 'string' && targetLanguage.length > 0,
        });

        let masterPlaylist;
        try {
            masterPlaylist = await fetchAuthorizedSubtitleText(
                snapshot,
                snapshot.url,
                {
                    stage: 'disney-master',
                    signal,
                    maxBytes: MAX_M3U8_PLAYLIST_BYTES,
                }
            );
        } catch (error) {
            throw markDisneySubtitleFailure(error, DISNEY_MASTER_FETCH_FAILURE);
        }
        const { text: masterPlaylistText, canonicalUrl: masterCanonicalUrl } =
            masterPlaylist;

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
            throw markDisneySubtitleFailure(
                new Error(
                    'Content is not a recognized M3U8 playlist or VTT file.'
                ),
                DISNEY_MASTER_PARSE_FAILURE
            );
        }

        this.logger.info(
            'Master content is an M3U8 playlist. Parsing available languages'
        );

        const availableLanguages = await this.parseAvailableSubtitleLanguages(
            masterPlaylistText,
            'disneyplus'
        );
        this.logger.debug('Available subtitle languages', {
            source: SubtitleRequestSources.DISNEY_PLUS,
            languageCount: availableLanguages.length,
        });

        const settings = await configService.getMultiple([
            'useNativeSubtitles',
            'useOfficialTranslations',
        ]);
        const useOfficialTranslations =
            settings.useOfficialTranslations !== undefined
                ? settings.useOfficialTranslations
                : settings.useNativeSubtitles !== false;

        this.logger.debug('Smart subtitle settings', {
            useOfficialTranslations: !!useOfficialTranslations,
            hasTargetLanguage:
                typeof targetLanguage === 'string' && targetLanguage.length > 0,
            hasOriginalLanguage:
                typeof originalLanguage === 'string' &&
                originalLanguage.length > 0,
        });

        let useNativeTarget = false;
        let targetLanguageInfo = null;
        let originalLanguageInfo = null;

        if (useOfficialTranslations && targetLanguage) {
            targetLanguageInfo = this.findSubtitleUriForLanguage(
                availableLanguages,
                targetLanguage
            );
            if (targetLanguageInfo) {
                this.logger.info('Target language found natively', {
                    hasTargetLanguage:
                        typeof targetLanguage === 'string' &&
                        targetLanguage.length > 0,
                    hasUri:
                        typeof targetLanguageInfo.uri === 'string' &&
                        targetLanguageInfo.uri.length > 0,
                });
                useNativeTarget = true;
            }
        }

        if (originalLanguage) {
            originalLanguageInfo = this.findSubtitleUriForLanguage(
                availableLanguages,
                originalLanguage
            );
            if (!originalLanguageInfo) {
                originalLanguageInfo = this.findSubtitleUriForLanguage(
                    availableLanguages,
                    'en'
                );
            }
        }

        if (!originalLanguageInfo && availableLanguages.length > 0) {
            originalLanguageInfo = availableLanguages[0];
            this.logger.info('Using first available language as fallback', {
                hasLanguage:
                    typeof originalLanguageInfo.normalizedCode === 'string' &&
                    originalLanguageInfo.normalizedCode.length > 0,
                hasUri:
                    typeof originalLanguageInfo.uri === 'string' &&
                    originalLanguageInfo.uri.length > 0,
            });
        }

        if (!originalLanguageInfo) {
            throw new Error(
                'No suitable subtitle language found despite available languages.'
            );
        }

        const originalVttText = await this.fetchLanguageSpecificSubtitles(
            snapshot,
            originalLanguageInfo.uri,
            masterCanonicalUrl,
            { signal }
        );

        let targetVttText = null;
        if (useNativeTarget && targetLanguageInfo) {
            try {
                targetVttText = await this.fetchLanguageSpecificSubtitles(
                    snapshot,
                    targetLanguageInfo.uri,
                    masterCanonicalUrl,
                    { signal }
                );
            } catch (error) {
                if (isDisneyCallerAbortError(error)) throw error;

                targetLanguageInfo = null;
                useNativeTarget = false;
                this.logger?.warn(
                    'Official Disney+ target subtitles unavailable; using original subtitles',
                    {
                        source: SubtitleRequestSources.DISNEY_PLUS,
                        stage: 'official-target',
                    }
                );
            }
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
            hasSourceLanguage:
                typeof result.sourceLanguage === 'string' &&
                result.sourceLanguage.length > 0,
            hasTargetLanguage:
                typeof result.targetLanguage === 'string' &&
                result.targetLanguage.length > 0,
            availableLanguageCount: availableLanguages.length,
        });

        return result;
    }

    /**
     * Get available subtitle languages for platform data
     * @param {string} platform - Platform identifier
     * @param {Object} data - Platform-specific data
     * @returns {Promise<Array>} Available languages
     */
    async getAvailableLanguages(platform, data) {
        const source =
            typeof platform === 'string' &&
            this.supportedPlatforms.has(platform)
                ? platform
                : 'unknown';
        try {
            this.logger.debug('Getting available languages', {
                source,
                supported: source !== 'unknown',
            });

            switch (platform) {
                case 'netflix': {
                    if (!data || !data.tracks) {
                        return [];
                    }
                    const { availableLanguages } =
                        netflixParser.extractNetflixTracks(
                            data,
                            'en-US',
                            'zh-CN'
                        );
                    return availableLanguages;
                }

                case 'disneyplus':
                case 'generic':
                    return [];

                default:
                    this.logger.warn(
                        'Language detection not supported for platform',
                        { source }
                    );
                    return [];
            }
        } catch (_) {
            this.logger?.error(
                'Failed to get available subtitle languages',
                null,
                {
                    stage: 'inventory',
                    source,
                }
            );
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
            const successfulProcessed =
                this.performanceMetrics.successfulProcessed || 0;
            const nextSuccessfulProcessed = successfulProcessed + 1;
            const currentAvg = this.performanceMetrics.averageProcessingTime;
            this.performanceMetrics.averageProcessingTime =
                (currentAvg * successfulProcessed + processingTime) /
                nextSuccessfulProcessed;
            this.performanceMetrics.successfulProcessed =
                nextSuccessfulProcessed;
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
     * Get supported platforms
     * @returns {Array} Supported platform names
     */
    getSupportedPlatforms() {
        return Array.from(this.supportedPlatforms);
    }

    /**
     * Fetch language-specific subtitles from URI
     */
    async fetchLanguageSpecificSubtitles(
        snapshot,
        uri,
        baseCanonicalUrl,
        options = {}
    ) {
        assertAuthorizedSnapshot(snapshot, SubtitleRequestSources.DISNEY_PLUS);
        const signal = readSignal(options);
        this.logger.info('Fetching language-specific subtitle playlist', {
            referenceLength: typeof uri === 'string' ? uri.length : 0,
        });

        let mediaPlaylist;
        try {
            mediaPlaylist = await fetchAuthorizedSubtitleText(snapshot, uri, {
                baseUrl: baseCanonicalUrl,
                stage: 'disney-language',
                signal,
                maxBytes: MAX_M3U8_PLAYLIST_BYTES,
            });
        } catch (error) {
            throw markDisneySubtitleFailure(error, DISNEY_MEDIA_FETCH_FAILURE);
        }
        const { text: subtitleText, canonicalUrl } = mediaPlaylist;

        if (subtitleText.trim().toUpperCase().startsWith('WEBVTT')) {
            this.logger.debug('Subtitle URI pointed directly to VTT content');
            return subtitleText;
        } else if (subtitleText.trim().startsWith('#EXTM3U')) {
            this.logger.debug(
                'Subtitle-specific playlist is an M3U8. Parsing for VTT segments'
            );
            try {
                return await vttParser.processM3U8PlaylistText(
                    snapshot,
                    subtitleText,
                    canonicalUrl,
                    { signal }
                );
            } catch (error) {
                throw markDisneySubtitleFailure(
                    error,
                    DISNEY_VTT_FETCH_FAILURE
                );
            }
        } else {
            throw new Error(
                'Content from subtitle playlist URI was not a recognized M3U8 or VTT.'
            );
        }
    }

    /**
     * Check if subtitle should be filtered based on platform blacklist
     * @param {string} displayName - Subtitle display name
     * @param {string} line - Full M3U8 line
     * @param {string} platform - Platform name (disneyplus, netflix, generic)
     * @param {Array<string>} blacklist - Blacklist keywords
     * @returns {boolean} True if subtitle should be skipped
     */
    isSubtitleBlacklisted(displayName, line, platform, blacklist) {
        if (!blacklist || blacklist.length === 0) {
            return false;
        }

        const displayNameLower = displayName.toLowerCase();

        for (const keyword of blacklist) {
            const keywordLower = keyword.toLowerCase().trim();
            if (!keywordLower) continue;

            // Check if keyword is in display name
            if (displayNameLower.includes(keywordLower)) {
                this.logger.debug('Subtitle blacklisted by name', {
                    source:
                        typeof platform === 'string' &&
                        this.supportedPlatforms.has(platform)
                            ? platform
                            : 'unknown',
                    matchKind: 'name',
                    displayNameLength: displayName.length,
                    keywordLength: keyword.length,
                });
                return true;
            }

            // For attribute patterns (contains =), check the full line exactly
            // This prevents "forced" from matching "FORCED=NO"
            if (keywordLower.includes('=')) {
                const lineLower = line.toLowerCase();
                if (lineLower.includes(keywordLower)) {
                    this.logger.debug('Subtitle blacklisted by attribute', {
                        source:
                            typeof platform === 'string' &&
                            this.supportedPlatforms.has(platform)
                                ? platform
                                : 'unknown',
                        matchKind: 'attribute',
                        displayNameLength: displayName.length,
                        keywordLength: keyword.length,
                    });
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Parse available subtitle languages from master M3U8 playlist
     * Ported from original background script
     * @param {string} masterPlaylistText - M3U8 master playlist content
     * @param {string} platform - Platform name (disneyplus, netflix, generic)
     * @returns {Promise<Array>} Array of subtitle language objects
     */
    async parseAvailableSubtitleLanguages(
        masterPlaylistText,
        platform = 'generic'
    ) {
        const lines = masterPlaylistText.split('\n');
        const languages = [];

        const blacklistConfig = await configService.get('subtitleBlacklist');
        const platformBlacklist = blacklistConfig?.[platform] || [];

        this.logger.debug('Using subtitle blacklist', {
            source:
                typeof platform === 'string' &&
                this.supportedPlatforms.has(platform)
                    ? platform
                    : 'unknown',
            blacklistCount: Array.isArray(platformBlacklist)
                ? platformBlacklist.length
                : 0,
        });

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

                    if (
                        this.isSubtitleBlacklisted(
                            displayName,
                            line,
                            platform,
                            platformBlacklist
                        )
                    ) {
                        continue;
                    }

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
            source:
                typeof platform === 'string' &&
                this.supportedPlatforms.has(platform)
                    ? platform
                    : 'unknown',
            languageCount: languages.length,
        });

        return languages;
    }

    /**
     * Find subtitle URI for specific language
     * Ported from original background script
     */
    findSubtitleUriForLanguage(availableLanguages, targetLanguageCode) {
        const normalizedTarget = normalizeLanguageCode(targetLanguageCode);

        let match = availableLanguages.find(
            (lang) => lang.normalizedCode === normalizedTarget
        );

        if (!match) {
            match = availableLanguages.find(
                (lang) =>
                    lang.normalizedCode.startsWith(normalizedTarget) ||
                    normalizedTarget.startsWith(lang.normalizedCode)
            );
        }

        if (match) {
            this.logger.debug('Found subtitle URI for language', {
                hasTargetLanguage:
                    typeof normalizedTarget === 'string' &&
                    normalizedTarget.length > 0,
                hasFoundLanguage:
                    typeof match.normalizedCode === 'string' &&
                    match.normalizedCode.length > 0,
                languagesEqual: match.normalizedCode === normalizedTarget,
                hasUri: typeof match.uri === 'string' && match.uri.length > 0,
            });
        } else {
            this.logger.debug('No subtitle URI found for language', {
                hasTargetLanguage:
                    typeof normalizedTarget === 'string' &&
                    normalizedTarget.length > 0,
                availableLanguageCount: availableLanguages.length,
            });
        }

        return match || null;
    }
}

export const subtitleService = new SubtitleService();
