import { translate as googleTranslate } from './translation_providers/googleTranslate.js';
import { translate as microsoftTranslateEdgeAuth } from './translation_providers/microsoftTranslateEdgeAuth.js';
import { translate as deeplTranslate } from './translation_providers/deeplTranslate.js';
import { translate as deeplTranslateFree } from './translation_providers/deeplTranslateFree.js';
import { normalizeLanguageCode } from './utils/languageNormalization.js';
import { configService } from './services/configService.js';
import Logger from './utils/logger.js';

// Initialize background logger with ConfigService integration
const backgroundLogger = Logger.create('Background', configService);

backgroundLogger.info('Dual Subtitles background script loaded');

const translationProviders = {
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

let currentTranslationProviderId = 'deepl_free';

// Initialize provider from configuration service
configService
    .get('selectedProvider')
    .then((providerId) => {
        if (providerId && translationProviders[providerId]) {
            currentTranslationProviderId = providerId;
            backgroundLogger.info('Using translation provider', {
                providerId,
            });
        } else {
            backgroundLogger.info('Provider not found, using default', {
                requestedProvider: providerId,
                defaultProvider: currentTranslationProviderId,
            });
        }
    })
    .catch((error) => {
        backgroundLogger.error(
            'Error loading translation provider setting',
            error
        );
    });

// Initialize default settings using the configuration service
configService.initializeDefaults();

// Initialize logging level synchronization system
let currentLoggingLevel = Logger.LEVELS.INFO; // Default level

// Initialize logging level from configuration
(async () => {
    try {
        currentLoggingLevel = await configService.get('loggingLevel');
        backgroundLogger.updateLevel(currentLoggingLevel);
        backgroundLogger.info('Background logging initialized', {
            level: currentLoggingLevel,
        });
    } catch (error) {
        backgroundLogger.error('Failed to initialize logging level', error);
    }
})();

// Listen for logging level changes and broadcast to all contexts
configService.onChanged((changes) => {
    if ('loggingLevel' in changes) {
        const newLevel = changes.loggingLevel;
        currentLoggingLevel = newLevel;
        backgroundLogger.updateLevel(newLevel);
        backgroundLogger.info(
            'Logging level changed, broadcasting to all contexts',
            {
                newLevel,
            }
        );

        // Broadcast logging level change to all active tabs
        broadcastLoggingLevelChange(newLevel);
    }
});

/**
 * Broadcasts logging level changes to all active extension contexts
 * @param {number} newLevel - The new logging level to broadcast
 */
async function broadcastLoggingLevelChange(newLevel) {
    try {
        // Get all tabs to send message to content scripts
        const tabs = await chrome.tabs.query({});
        const messagePromises = [];

        for (const tab of tabs) {
            // Only send to tabs that might have our content scripts
            if (
                tab.url &&
                (tab.url.includes('netflix.com') ||
                    tab.url.includes('disneyplus.com'))
            ) {
                const messagePromise = chrome.tabs
                    .sendMessage(tab.id, {
                        type: 'LOGGING_LEVEL_CHANGED',
                        level: newLevel,
                    })
                    .catch((error) => {
                        // Content script might not be loaded, ignore these errors
                        backgroundLogger.debug(
                            'Failed to send logging level to tab',
                            error,
                            {
                                tabId: tab.id,
                                url: tab.url,
                            }
                        );
                    });
                messagePromises.push(messagePromise);
            }
        }

        // Wait for all messages to be sent (or fail)
        await Promise.allSettled(messagePromises);

        backgroundLogger.debug('Logging level broadcast completed', {
            level: newLevel,
            tabCount: tabs.length,
        });
    } catch (error) {
        backgroundLogger.error(
            'Error broadcasting logging level change',
            error,
            {
                level: newLevel,
            }
        );
    }
}

function parseAvailableSubtitleLanguages(masterPlaylistText) {
    if (!masterPlaylistText || typeof masterPlaylistText !== 'string') {
        backgroundLogger.warn(
            'Invalid playlist text provided to parseAvailableSubtitleLanguages'
        );
        return [];
    }

    const lines = masterPlaylistText.split('\n');
    const availableLanguages = [];

    for (const line of lines) {
        const trimmedLine = line.trim();
        if (
            trimmedLine.startsWith('#EXT-X-MEDIA') &&
            trimmedLine.includes('TYPE=SUBTITLES')
        ) {
            try {
                const languageMatch = trimmedLine.match(/LANGUAGE="([^"]+)"/);
                const uriMatch = trimmedLine.match(/URI="([^"]+)"/);
                const nameMatch = trimmedLine.match(/NAME="([^"]+)"/);

                if (languageMatch && uriMatch) {
                    const rawLangCode = languageMatch[1];
                    const normalizedLangCode =
                        normalizeLanguageCode(rawLangCode);
                    const displayName = nameMatch ? nameMatch[1] : rawLangCode;
                    const uri = uriMatch[1];

                    availableLanguages.push({
                        rawCode: rawLangCode,
                        normalizedCode: normalizedLangCode,
                        displayName: displayName,
                        uri: uri,
                    });
                }
            } catch (error) {
                backgroundLogger.warn(
                    'Error parsing subtitle language line',
                    error,
                    {
                        line: trimmedLine,
                    }
                );
            }
        }
    }

    return availableLanguages;
}

function findSubtitleUriForLanguage(availableLanguages, targetLangCode) {
    if (!targetLangCode || availableLanguages.length === 0) {
        return null;
    }

    const isForcedTrack = (lang) => {
        return (
            lang.displayName?.toLowerCase().includes('forced') ||
            lang.displayName?.toLowerCase().includes('--forced--') ||
            lang.rawCode?.toLowerCase().includes('forced') ||
            lang.uri?.toLowerCase().includes('forced') ||
            lang.uri?.toLowerCase().includes('_forced_')
        );
    };

    const selectBestMatch = (matches) => {
        if (matches.length === 0) return null;
        if (matches.length === 1) return matches[0];

        const normalTracks = matches.filter((match) => !isForcedTrack(match));
        if (normalTracks.length > 0) {
            const explicitNormalTracks = normalTracks.filter(
                (track) =>
                    track.uri?.includes('_NORMAL_') ||
                    track.displayName?.toLowerCase().includes('normal')
            );

            if (explicitNormalTracks.length > 0) {
                return explicitNormalTracks[0];
            }

            return normalTracks[0];
        }
        return matches[0];
    };

    let matches = availableLanguages.filter(
        (lang) => lang.normalizedCode === targetLangCode
    );
    if (matches.length > 0) {
        return selectBestMatch(matches);
    }

    matches = availableLanguages.filter(
        (lang) => lang.rawCode === targetLangCode
    );
    if (matches.length > 0) {
        return selectBestMatch(matches);
    }

    const languageFamilies = [
        'zh',
        'es',
        'en',
        'fr',
        'de',
        'pt',
        'it',
        'ja',
        'ko',
    ];
    const targetFamily = languageFamilies.find((family) =>
        targetLangCode.startsWith(family)
    );

    if (targetFamily) {
        matches = availableLanguages.filter(
            (lang) =>
                lang.normalizedCode.startsWith(targetFamily) ||
                lang.rawCode.startsWith(targetFamily)
        );
        if (matches.length > 0) {
            return selectBestMatch(matches);
        }
    }

    const targetLower = targetLangCode.toLowerCase();
    matches = availableLanguages.filter(
        (lang) =>
            lang.normalizedCode.toLowerCase().includes(targetLower) ||
            lang.rawCode.toLowerCase().includes(targetLower) ||
            lang.displayName.toLowerCase().includes(targetLower)
    );
    if (matches.length > 0) {
        return selectBestMatch(matches);
    }

    return null;
}

async function fetchText(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`HTTP error ${response.status} for ${url}`);
    }
    return await response.text();
}

function getUriFromExtXMedia(line) {
    const uriMatch = line.match(/URI="([^"]+)"/);
    return uriMatch ? uriMatch[1] : null;
}

function findSubtitlePlaylistUri(masterPlaylistText) {
    const lines = masterPlaylistText.split('\n');
    let subtitlePlaylistUri = null;

    for (const line of lines) {
        const trimmedLine = line.trim();
        if (
            trimmedLine.startsWith('#EXT-X-MEDIA') &&
            trimmedLine.includes('TYPE=SUBTITLES')
        ) {
            subtitlePlaylistUri = getUriFromExtXMedia(trimmedLine);
            if (subtitlePlaylistUri) {
                backgroundLogger.debug(
                    'Found subtitle playlist URI (TYPE=SUBTITLES)',
                    {
                        uri: subtitlePlaylistUri,
                    }
                );
                return subtitlePlaylistUri;
            }
        }
    }

    backgroundLogger.debug(
        'No direct TYPE=SUBTITLES URI. Checking for streams with SUBTITLES attribute'
    );
    for (let i = 0; i < lines.length; i++) {
        const trimmedLine = lines[i].trim();
        if (
            trimmedLine.startsWith('#EXT-X-STREAM-INF') &&
            trimmedLine.includes('SUBTITLES=')
        ) {
            const subtitlesGroupIdMatch =
                trimmedLine.match(/SUBTITLES="([^"]+)"/);
            if (subtitlesGroupIdMatch) {
                const groupId = subtitlesGroupIdMatch[1];
                for (const mediaLine of lines) {
                    if (
                        mediaLine.startsWith('#EXT-X-MEDIA') &&
                        mediaLine.includes(`GROUP-ID="${groupId}"`) &&
                        mediaLine.includes('TYPE=SUBTITLES')
                    ) {
                        subtitlePlaylistUri = getUriFromExtXMedia(mediaLine);
                        if (subtitlePlaylistUri) {
                            backgroundLogger.debug(
                                'Found subtitle playlist URI (GROUP-ID)',
                                {
                                    groupId: groupId,
                                    uri: subtitlePlaylistUri,
                                }
                            );
                            return subtitlePlaylistUri;
                        }
                    }
                }
            }
        }
    }
    return null; // Not found
}

function parsePlaylistForVttSegments(playlistText, playlistUrl) {
    const lines = playlistText.split('\n');
    const segmentUrls = [];
    const baseUrl = new URL(playlistUrl);

    for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine && !trimmedLine.startsWith('#')) {
            // Basic check for VTT extension or segment-like names.
            if (
                trimmedLine.toLowerCase().includes('.vtt') ||
                trimmedLine.toLowerCase().includes('.webvtt') ||
                !trimmedLine.includes('/')
            ) {
                try {
                    const segmentUrl = new URL(trimmedLine, baseUrl.href).href;
                    segmentUrls.push(segmentUrl);
                } catch (e) {
                    backgroundLogger.warn(
                        'Could not form valid URL from M3U8 line',
                        e,
                        {
                            line: trimmedLine,
                            baseUrl: baseUrl.href,
                        }
                    );
                }
            }
        }
    }
    return segmentUrls;
}

async function fetchAndCombineVttSegments(
    segmentUrls,
    playlistUrlForLogging = 'N/A'
) {
    backgroundLogger.info('Found VTT segments from playlist, fetching', {
        segmentCount: segmentUrls.length,
        playlistUrl: playlistUrlForLogging,
    });

    const fetchPromises = segmentUrls.map(async (url) => {
        try {
            return await fetchText(url);
        } catch (e) {
            backgroundLogger.warn('Error fetching VTT segment', e, { url });
            return null;
        }
    });

    const segmentTexts = await Promise.all(fetchPromises);
    let combinedVttText = 'WEBVTT\n\n';
    let segmentsFetchedCount = 0;

    for (const segmentText of segmentTexts) {
        if (segmentText) {
            segmentsFetchedCount++;
            const cleanedSegment = segmentText
                .replace(/^WEBVTT\s*/i, '')
                .trim();
            if (cleanedSegment) {
                combinedVttText += cleanedSegment + '\n\n';
            }
        }
    }

    if (segmentsFetchedCount === 0 && segmentUrls.length > 0) {
        throw new Error(
            `Failed to fetch any of the ${segmentUrls.length} VTT segments.`
        );
    }

    backgroundLogger.info('VTT segments combined', {
        segmentsFetched: segmentsFetchedCount,
        totalSegments: segmentUrls.length,
    });
    return combinedVttText;
}

async function processNetflixSubtitleData(
    data,
    targetLanguage = 'zh-CN',
    originalLanguage = 'en',
    useNativeSubtitles = true,
    useOfficialTranslations = undefined
) {
    // Normalize the official translations setting
    const useOfficialSubtitles = useOfficialTranslations !== undefined 
        ? useOfficialTranslations 
        : useNativeSubtitles;
    if (!data || !data.tracks) {
        throw new Error('Invalid Netflix subtitle data provided');
    }

    const timedtexttracks = data.tracks;
    const availableLanguages = [];

    const validTracks = timedtexttracks.filter(
        (track) => !track.isNoneTrack && !track.isForcedNarrative
    );

    function getBestTrackForLanguage(tracks, langCode) {
        const matchingTracks = tracks.filter((track) => {
            const trackLangCode = normalizeLanguageCode(track.language);
            return trackLangCode === langCode;
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

    for (const track of validTracks) {
        const rawLangCode = track.language;
        const normalizedLangCode = normalizeLanguageCode(rawLangCode);

        let downloadUrl = null;
        let downloadables = null;

        if (
            track.ttDownloadables &&
            typeof track.ttDownloadables === 'object' &&
            !Array.isArray(track.ttDownloadables)
        ) {
            downloadables = track.ttDownloadables;
        } else if (track.rawTrack?.ttDownloadables) {
            downloadables = track.rawTrack.ttDownloadables;
        }

        if (downloadables) {
            const formats = Object.keys(downloadables);
            for (const format of formats) {
                const formatData = downloadables[format];
                if (
                    formatData &&
                    Array.isArray(formatData.urls) &&
                    formatData.urls.length > 0
                ) {
                    const urlObject = formatData.urls[0];
                    if (urlObject && typeof urlObject.url === 'string') {
                        downloadUrl = urlObject.url;
                        break;
                    }
                }
            }
        }

        if (downloadUrl) {
            availableLanguages.push({
                rawCode: rawLangCode,
                normalizedCode: normalizedLangCode,
                displayName:
                    track.displayName ||
                    track.rawTrack?.languageDescription ||
                    rawLangCode,
                uri: downloadUrl,
                trackType: track.trackType,
                isForcedNarrative: track.isForcedNarrative || false,
                track: track,
            });
        }
    }

    if (availableLanguages.length === 0) {
        throw new Error(
            'No downloadable subtitle tracks found in Netflix data'
        );
    }

    let targetLanguageInfo = null;
    let originalLanguageInfo = null;
    let useNativeTarget = false;

    // Step 1: Try to find native target language if enabled
    if (useOfficialSubtitles && targetLanguage) {
        targetLanguageInfo = getBestTrackForLanguage(
            validTracks,
            targetLanguage
        );
        if (targetLanguageInfo) {
            targetLanguageInfo = availableLanguages.find(
                (lang) => lang.track === targetLanguageInfo
            );

            if (targetLanguageInfo) {
                useNativeTarget = true;
                backgroundLogger.info('Netflix native target found', {
                    targetLanguage,
                    displayName: targetLanguageInfo.displayName,
                });
            }
        } else {
            backgroundLogger.info(
                'Netflix native target NOT found, will use translation mode',
                {
                    targetLanguage,
                }
            );
        }
    } else {
        backgroundLogger.info(
            'Official subtitles disabled or no target language specified, will use translation mode'
        );
    }

    // Step 2: Find original language track
    if (originalLanguage && !originalLanguageInfo) {
        const originalTrack = getBestTrackForLanguage(
            validTracks,
            originalLanguage
        );
        if (originalTrack) {
            originalLanguageInfo = availableLanguages.find(
                (lang) => lang.track === originalTrack
            );
            if (originalLanguageInfo) {
                backgroundLogger.info('Netflix original language found', {
                    originalLanguage,
                    displayName: originalLanguageInfo.displayName,
                });
            }
        } else {
            backgroundLogger.info(
                'Netflix original language NOT found, trying English fallback',
                {
                    originalLanguage,
                }
            );
            const englishTrack = getBestTrackForLanguage(validTracks, 'en');
            if (englishTrack) {
                originalLanguageInfo = availableLanguages.find(
                    (lang) => lang.track === englishTrack
                );
                if (originalLanguageInfo) {
                    backgroundLogger.info('Netflix English fallback found', {
                        displayName: originalLanguageInfo.displayName,
                    });
                }
            }
        }
    }

    // Step 3: Final fallback to first available language
    if (!originalLanguageInfo && availableLanguages.length > 0) {
        originalLanguageInfo = availableLanguages[0];
        backgroundLogger.warn(
            'Netflix using first available language as last resort',
            {
                normalizedCode: originalLanguageInfo.normalizedCode,
                displayName: originalLanguageInfo.displayName,
            }
        );
    }

    if (!originalLanguageInfo) {
        throw new Error('No suitable Netflix subtitle language found');
    }

    backgroundLogger.info('Netflix processing mode', {
        useNativeTarget,
        originalLang: originalLanguageInfo.normalizedCode,
        targetLang: targetLanguage || 'none',
    });

    // Step 4: Fetch and process original language subtitles
    backgroundLogger.info('Fetching Netflix original language subtitles', {
        uriPreview: originalLanguageInfo.uri.substring(0, 100),
    });
    const originalSubtitleText = await fetchText(originalLanguageInfo.uri);
    backgroundLogger.debug('Netflix original subtitle raw size', {
        size: originalSubtitleText.length,
    });

    let originalVttText;
    if (
        originalSubtitleText.trim().startsWith('<?xml') ||
        originalSubtitleText.includes('<tt')
    ) {
        backgroundLogger.info(
            'Netflix original subtitle detected as TTML, converting'
        );
        originalVttText = convertTtmlToVtt(originalSubtitleText);
        backgroundLogger.info('Netflix original TTML converted to VTT', {
            size: originalVttText.length,
        });

        // Count cues in original
        const originalCueCount = (
            originalVttText.match(
                /\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}/g
            ) || []
        ).length;
        backgroundLogger.debug('Netflix original VTT cue count', {
            cueCount: originalCueCount,
        });
    } else if (originalSubtitleText.trim().toUpperCase().startsWith('WEBVTT')) {
        originalVttText = originalSubtitleText;
        backgroundLogger.info('Netflix original VTT loaded directly', {
            size: originalVttText.length,
        });
        const originalCueCount = (
            originalVttText.match(
                /\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}/g
            ) || []
        ).length;
        backgroundLogger.debug('Netflix original VTT cue count', {
            cueCount: originalCueCount,
        });
    } else {
        const preview = originalSubtitleText.substring(0, 200);
        backgroundLogger.error(
            'Netflix original subtitle format not recognized',
            null,
            {
                preview,
            }
        );
        throw new Error(
            'Netflix subtitle format not recognized (not TTML or VTT)'
        );
    }

    // Step 5: Fetch target language subtitles only if using native target
    let targetVttText = null;
    if (useNativeTarget && targetLanguageInfo) {
        backgroundLogger.info('Fetching Netflix native target subtitles', {
            uriPreview: targetLanguageInfo.uri.substring(0, 100),
        });
        const targetSubtitleText = await fetchText(targetLanguageInfo.uri);
        backgroundLogger.debug('Netflix target subtitle raw size', {
            size: targetSubtitleText.length,
        });

        if (
            targetSubtitleText.trim().startsWith('<?xml') ||
            targetSubtitleText.includes('<tt')
        ) {
            backgroundLogger.info(
                'Netflix target subtitle detected as TTML, converting'
            );
            targetVttText = convertTtmlToVtt(targetSubtitleText);
            backgroundLogger.info('Netflix target TTML converted to VTT', {
                size: targetVttText.length,
            });

            // Count cues in target and compare timing
            const targetCueCount = (
                targetVttText.match(
                    /\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}/g
                ) || []
            ).length;
            const originalCueCount = (
                originalVttText.match(
                    /\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}/g
                ) || []
            ).length;
            backgroundLogger.debug('Netflix target VTT cue count comparison', {
                targetCueCount,
                originalCueCount,
            });

            if (targetCueCount !== originalCueCount) {
                backgroundLogger.warn(
                    'Netflix subtitle cue count mismatch! This may cause synchronization issues',
                    {
                        targetCueCount,
                        originalCueCount,
                    }
                );

                const originalTimings =
                    originalVttText.match(
                        /\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}/g
                    ) || [];
                const targetTimings =
                    targetVttText.match(
                        /\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}/g
                    ) || [];

                backgroundLogger.debug('First 3 timing comparisons', {
                    originalTimings: originalTimings.slice(0, 3),
                    targetTimings: targetTimings.slice(0, 3),
                });
            } else {
                backgroundLogger.info(
                    'Netflix original and target subtitle cue counts match perfectly'
                );
            }
        } else if (
            targetSubtitleText.trim().toUpperCase().startsWith('WEBVTT')
        ) {
            targetVttText = targetSubtitleText;
            backgroundLogger.info('Netflix target VTT loaded directly', {
                size: targetVttText.length,
            });
            const targetCueCount = (
                targetVttText.match(
                    /\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}/g
                ) || []
            ).length;
            const originalCueCount = (
                originalVttText.match(
                    /\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}/g
                ) || []
            ).length;
            backgroundLogger.debug('Netflix target VTT cue count comparison', {
                targetCueCount,
                originalCueCount,
            });
        } else {
            const preview = targetSubtitleText.substring(0, 200);
            backgroundLogger.error(
                'Netflix target subtitle format not recognized',
                null,
                {
                    preview,
                }
            );
            throw new Error('Netflix target subtitle format not recognized');
        }
    } else {
        backgroundLogger.info(
            'Netflix will use translation mode for target language',
            {
                targetLanguage: targetLanguage || 'none',
            }
        );
    }

    const result = {
        vttText: originalVttText,
        targetVttText: targetVttText,
        sourceLanguage: originalLanguageInfo.normalizedCode,
        targetLanguage: useNativeTarget
            ? targetLanguageInfo.normalizedCode
            : targetLanguage, // Pass through target language for translation
        useNativeTarget: useNativeTarget,
        availableLanguages: availableLanguages,
        url: originalLanguageInfo.uri,
        selectedLanguage: originalLanguageInfo,
    };

    backgroundLogger.info('Netflix processing complete', {
        mode: useNativeTarget ? 'Native' : 'Translation',
        originalLanguage: result.sourceLanguage,
        targetLanguage: result.targetLanguage,
    });
    return result;
}

// Simple TTML to VTT converter for Netflix subtitles (service worker compatible)
function convertTtmlToVtt(ttmlText) {
    backgroundLogger.debug('Starting TTML to VTT conversion', {
        inputLength: ttmlText.length,
    });

    let vtt = 'WEBVTT\n\n';

    try {
        // Step 1: Parse region layouts to get their x/y coordinates
        backgroundLogger.debug('Step 1: Parsing region layouts');
        const regionLayouts = new Map();
        const regionRegex =
            /<region\s+xml:id="([^"]+)"[^>]*\s+tts:origin="([^"]+)"/gi;
        let regionMatch;
        let regionCount = 0;
        while ((regionMatch = regionRegex.exec(ttmlText)) !== null) {
            const regionId = regionMatch[1];
            const origin = regionMatch[2].split(' ');
            if (origin.length === 2) {
                const x = parseFloat(origin[0]);
                const y = parseFloat(origin[1]);
                regionLayouts.set(regionId, { x, y });
                regionCount++;
                backgroundLogger.debug('Region layout parsed', {
                    regionId,
                    x,
                    y,
                });
            }
        }
        backgroundLogger.debug('Found regions with layout info', {
            regionCount,
        });

        // Step 2: Parse all <p> tags into an intermediate structure, including their region
        backgroundLogger.debug('Step 2: Parsing <p> elements');
        const intermediateCues = [];
        const pElementRegex =
            /<p[^>]*\s+begin="([^"]+)"[^>]*\s+end="([^"]+)"[^>]*\s+region="([^"]+)"[^>]*>([\s\S]*?)<\/p>/gi;
        let pMatch;
        let pElementCount = 0;
        while ((pMatch = pElementRegex.exec(ttmlText)) !== null) {
            const [_, begin, end, region, textContent] = pMatch;
            pElementCount++;

            let text = textContent
                .replace(/<br\s*\/?>/gi, ' ')
                .replace(/<[^>]*>/g, '')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&amp;/g, '&')
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .replace(/\r?\n/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();

            intermediateCues.push({ begin, end, region, text });

            if (pElementCount <= 5) {
                backgroundLogger.debug('Parsed cue', {
                    cueNumber: pElementCount,
                    begin,
                    end,
                    region,
                    textPreview:
                        text.substring(0, 50) + (text.length > 50 ? '...' : ''),
                });
            }
        }
        backgroundLogger.debug('Parsed p elements into intermediate cues', {
            pElementCount,
            intermediateCueCount: intermediateCues.length,
        });

        if (intermediateCues.length === 0) {
            backgroundLogger.error('No valid TTML subtitle entries found');
            throw new Error('No valid TTML subtitle entries found');
        }

        // Step 3: Group cues by their timestamp
        backgroundLogger.debug('Step 3: Grouping cues by timestamp');
        const groupedByTime = new Map();
        for (const cue of intermediateCues) {
            const key = `${cue.begin}-${cue.end}`;
            if (!groupedByTime.has(key)) {
                groupedByTime.set(key, []);
            }
            groupedByTime.get(key).push(cue);
        }
        backgroundLogger.debug('Grouped into unique time segments', {
            segmentCount: groupedByTime.size,
        });

        // Log some examples of grouped cues
        let exampleCount = 0;
        for (const [key, group] of groupedByTime.entries()) {
            if (exampleCount < 3) {
                backgroundLogger.debug('Time segment example', {
                    key,
                    cueCount: group.length,
                    regions: group.map((c) => c.region),
                });
                exampleCount++;
            } else if (exampleCount === 3) {
                break;
            }
        }

        // Step 4: For each group, sort by position and merge into a final cue
        backgroundLogger.debug('Step 4: Sorting by position and merging');
        const finalCues = [];
        let mergedCount = 0;
        for (const [key, group] of groupedByTime.entries()) {
            // Sort the group based on region position (top-to-bottom, then left-to-right)
            group.sort((a, b) => {
                const regionA = regionLayouts.get(a.region) || {
                    y: 999,
                    x: 999,
                };
                const regionB = regionLayouts.get(b.region) || {
                    y: 999,
                    x: 999,
                };

                // Primary sort: Y-coordinate (top to bottom)
                if (regionA.y < regionB.y) return -1;
                if (regionA.y > regionB.y) return 1;

                // Secondary sort: X-coordinate (left to right)
                if (regionA.x < regionB.x) return -1;
                if (regionA.x > regionB.x) return 1;

                return 0;
            });

            // Merge the text of the now-sorted group
            const mergedText = group
                .map((cue) => cue.text)
                .join(' ')
                .trim();

            const [begin, end] = key.split('-');
            finalCues.push({
                begin,
                end,
                text: mergedText,
            });

            mergedCount++;
            if (mergedCount <= 3) {
                backgroundLogger.debug('Merged cues', {
                    groupSize: group.length,
                    textPreview:
                        mergedText.substring(0, 80) +
                        (mergedText.length > 80 ? '...' : ''),
                });
            }
        }
        backgroundLogger.debug('Created final merged cues', {
            finalCueCount: finalCues.length,
        });

        // Step 5: Sort the final, merged cues by start time and build the VTT string
        backgroundLogger.debug('Step 5: Sorting by time and building VTT');
        finalCues.sort((a, b) => parseInt(a.begin) - parseInt(b.begin));

        let vttCueCount = 0;
        for (const cue of finalCues) {
            const startTime = convertTtmlTimeToVtt(cue.begin);
            const endTime = convertTtmlTimeToVtt(cue.end);

            vtt += `${startTime} --> ${endTime}\n`;
            vtt += `${cue.text}\n\n`;
            vttCueCount++;

            if (vttCueCount <= 3) {
                backgroundLogger.debug('VTT Cue created', {
                    cueNumber: vttCueCount,
                    startTime,
                    endTime,
                    textPreview:
                        cue.text.substring(0, 60) +
                        (cue.text.length > 60 ? '...' : ''),
                });
            }
        }

        backgroundLogger.info('TTML to VTT conversion complete', {
            finalCueCount: finalCues.length,
            vttLength: vtt.length,
            timeRange:
                finalCues.length > 0
                    ? `${convertTtmlTimeToVtt(finalCues[0].begin)} to ${convertTtmlTimeToVtt(finalCues[finalCues.length - 1].end)}`
                    : 'N/A',
        });

        return vtt;
    } catch (error) {
        backgroundLogger.error('Error converting TTML to VTT', error, {
            ttmlSample: ttmlText.substring(0, 500),
        });
        throw new Error(`TTML conversion failed: ${error.message}`);
    }
}

// Convert TTML time format to VTT time format
function convertTtmlTimeToVtt(ttmlTime) {
    // Handle Netflix's tick-based time format (e.g., "107607500t")
    if (ttmlTime.endsWith('t')) {
        const ticks = parseInt(ttmlTime.slice(0, -1));
        const tickRate = 10000000; // Netflix uses 10,000,000 ticks per second
        const seconds = ticks / tickRate;

        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;

        // Format as HH:MM:SS.mmm
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toFixed(3).padStart(6, '0')}`;
    }

    // Handle standard time format: 00:00:01.500 or 00:00:01,500
    // VTT format: 00:00:01.500
    return ttmlTime.replace(',', '.');
}

async function fetchAndProcessSubtitleUrl(
    masterPlaylistUrl,
    targetLanguage = null,
    originalLanguage = 'en'
) {
    backgroundLogger.info('Fetching master URL', {
        masterPlaylistUrl,
        originalLanguage,
        targetLanguage,
    });

    const masterPlaylistText = await fetchText(masterPlaylistUrl);

    if (masterPlaylistText.trim().toUpperCase().startsWith('WEBVTT')) {
        backgroundLogger.info('Master URL points directly to a VTT file');
        return {
            vttText: masterPlaylistText,
            sourceLanguage: 'unknown',
            useNativeTarget: false,
            availableLanguages: [],
        };
    }

    if (!masterPlaylistText.trim().startsWith('#EXTM3U')) {
        throw new Error(
            'Content is not a recognized M3U8 playlist or VTT file.'
        );
    }

    backgroundLogger.info(
        'Master content is an M3U8 playlist. Parsing available languages'
    );
    const availableLanguages =
        parseAvailableSubtitleLanguages(masterPlaylistText);
    backgroundLogger.debug('Available subtitle languages', {
        languages: availableLanguages.map(
            (lang) => `${lang.normalizedCode} (${lang.displayName})`
        ),
    });

    // Get user settings for smart subtitle logic
    const settings = await chrome.storage.sync.get(['useNativeSubtitles', 'useOfficialTranslations']);
    const useOfficialTranslations = settings.useOfficialTranslations !== undefined 
        ? settings.useOfficialTranslations 
        : (settings.useNativeSubtitles !== false); // Default to true, with backward compatibility
    const useNativeSubtitles = useOfficialTranslations; // For backward compatibility in this function

    backgroundLogger.debug('Smart subtitle settings', {
        useOfficialTranslations,
        useNativeSubtitles, // For backward compatibility logging
        targetLanguage,
        originalLanguage,
    });

    let useNativeTarget = false;
    let targetLanguageInfo = null;
    let originalLanguageInfo = null;

    // Step 1: Check if we should use native target language (when available and smart subtitles enabled)
    if (useNativeSubtitles && targetLanguage) {
        if (targetLanguage === originalLanguage) {
            // Find the target language natively for single language mode
            targetLanguageInfo = findSubtitleUriForLanguage(
                availableLanguages,
                targetLanguage
            );
            if (targetLanguageInfo) {
                backgroundLogger.info('Found native language', {
                    targetLanguage,
                    displayName: targetLanguageInfo.displayName,
                });
                useNativeTarget = true;
                // In this case, we'll use the same language for both original and target
                originalLanguageInfo = targetLanguageInfo;
            } else {
                backgroundLogger.info('Native language not available', {
                    targetLanguage,
                });
            }
        } else {
            // Different target and original languages - dual language mode
            targetLanguageInfo = findSubtitleUriForLanguage(
                availableLanguages,
                targetLanguage
            );
            if (targetLanguageInfo) {
                backgroundLogger.info('Target language found natively', {
                    targetLanguage,
                    displayName: targetLanguageInfo.displayName,
                });
                useNativeTarget = true;
            } else {
                backgroundLogger.info(
                    'Target language not available natively',
                    {
                        targetLanguage,
                    }
                );
            }
        }
    }

    // Step 2: Find original language subtitle for dual display (skip if already found in Step 1)
    if (originalLanguage && !originalLanguageInfo) {
        originalLanguageInfo = findSubtitleUriForLanguage(
            availableLanguages,
            originalLanguage
        );
        if (originalLanguageInfo) {
            backgroundLogger.info('Found original language', {
                originalLanguage,
                displayName: originalLanguageInfo.displayName,
            });
        } else {
            backgroundLogger.info('Original language not available', {
                originalLanguage,
            });
            // Fallback to English if original language is not available
            originalLanguageInfo = findSubtitleUriForLanguage(
                availableLanguages,
                'en'
            );
            if (originalLanguageInfo) {
                backgroundLogger.info('Using English fallback for original', {
                    displayName: originalLanguageInfo.displayName,
                });
            }
        }
    }

    // Step 3: Universal fallback to first available language if no suitable original found
    if (!originalLanguageInfo) {
        backgroundLogger.info(
            'No suitable original language found. Attempting universal fallback'
        );

        // Use the first available language if no original language found
        if (availableLanguages.length > 0) {
            originalLanguageInfo = availableLanguages[0];
            backgroundLogger.info(
                'Using first available language as fallback',
                {
                    displayName: originalLanguageInfo.displayName,
                    normalizedCode: originalLanguageInfo.normalizedCode,
                }
            );
        }
    }

    if (!originalLanguageInfo) {
        if (availableLanguages.length === 0) {
            throw new Error(
                'No subtitle languages are available for this content.'
            );
        } else {
            throw new Error(
                'No suitable subtitle language found despite available languages.'
            );
        }
    }

    backgroundLogger.info('Final decision', {
        originalCode: originalLanguageInfo.normalizedCode,
        originalDisplayName: originalLanguageInfo.displayName,
        useNativeTarget,
    });
    if (useNativeTarget && targetLanguageInfo) {
        backgroundLogger.info('Will use native target', {
            targetCode: targetLanguageInfo.normalizedCode,
            targetDisplayName: targetLanguageInfo.displayName,
        });
    }

    // Step 4: Fetch original language subtitles
    const fullOriginalSubtitleUrl = new URL(
        originalLanguageInfo.uri,
        masterPlaylistUrl
    ).href;
    backgroundLogger.info('Fetching original subtitle playlist', {
        url: fullOriginalSubtitleUrl,
    });
    const originalSubtitleText = await fetchText(fullOriginalSubtitleUrl);

    let originalVttText;
    if (originalSubtitleText.trim().toUpperCase().startsWith('WEBVTT')) {
        backgroundLogger.debug(
            'Original subtitle playlist URI pointed directly to VTT content'
        );
        originalVttText = originalSubtitleText;
    } else if (originalSubtitleText.trim().startsWith('#EXTM3U')) {
        backgroundLogger.debug(
            'Original subtitle-specific playlist is an M3U8. Parsing for VTT segments'
        );
        const vttSegmentUrls = parsePlaylistForVttSegments(
            originalSubtitleText,
            fullOriginalSubtitleUrl
        );
        if (vttSegmentUrls.length === 0) {
            throw new Error(
                'No VTT segments found in the original subtitle-specific M3U8 playlist.'
            );
        }
        originalVttText = await fetchAndCombineVttSegments(
            vttSegmentUrls,
            fullOriginalSubtitleUrl
        );
    } else {
        throw new Error(
            'Content from original subtitle playlist URI was not a recognized M3U8 or VTT.'
        );
    }

    // Step 5: Fetch target language subtitles if using native target
    let targetVttText = null;
    if (useNativeTarget && targetLanguageInfo) {
        const fullTargetSubtitleUrl = new URL(
            targetLanguageInfo.uri,
            masterPlaylistUrl
        ).href;
        backgroundLogger.info('Fetching target subtitle playlist', {
            url: fullTargetSubtitleUrl,
        });
        const targetSubtitleText = await fetchText(fullTargetSubtitleUrl);

        if (targetSubtitleText.trim().toUpperCase().startsWith('WEBVTT')) {
            backgroundLogger.debug(
                'Target subtitle playlist URI pointed directly to VTT content'
            );
            targetVttText = targetSubtitleText;
        } else if (targetSubtitleText.trim().startsWith('#EXTM3U')) {
            backgroundLogger.debug(
                'Target subtitle-specific playlist is an M3U8. Parsing for VTT segments'
            );
            const vttSegmentUrls = parsePlaylistForVttSegments(
                targetSubtitleText,
                fullTargetSubtitleUrl
            );
            if (vttSegmentUrls.length === 0) {
                throw new Error(
                    'No VTT segments found in the target subtitle-specific M3U8 playlist.'
                );
            }
            targetVttText = await fetchAndCombineVttSegments(
                vttSegmentUrls,
                fullTargetSubtitleUrl
            );
        } else {
            throw new Error(
                'Content from target subtitle playlist URI was not a recognized M3U8 or VTT.'
            );
        }
    }

    backgroundLogger.info('Successfully processed VTT', {
        originalLength: originalVttText.length,
        targetLength: targetVttText ? targetVttText.length : null,
        useNativeTarget,
    });

    return {
        vttText: originalVttText,
        targetVttText: targetVttText,
        sourceLanguage: originalLanguageInfo.normalizedCode,
        targetLanguage: useNativeTarget
            ? targetLanguageInfo.normalizedCode
            : null,
        useNativeTarget: useNativeTarget,
        availableLanguages: availableLanguages,
        selectedLanguage: originalLanguageInfo,
        targetLanguageInfo: targetLanguageInfo,
    };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
        case 'translate': {
            const { text, targetLang, cueStart, cueVideoId } = message;
            const sourceLang = 'auto';
            const selectedProvider =
                translationProviders[currentTranslationProviderId];

            if (!selectedProvider?.translate) {
                backgroundLogger.error('Invalid translation provider', null, {
                    providerId: currentTranslationProviderId,
                });
                sendResponse({
                    error: 'Translation failed',
                    details: `Provider "${currentTranslationProviderId}" is not configured.`,
                    originalText: text,
                    cueStart,
                    cueVideoId,
                });
                return true;
            }

            selectedProvider
                .translate(text, sourceLang, targetLang)
                .then((translatedText) => {
                    sendResponse({
                        translatedText,
                        originalText: text,
                        cueStart,
                        cueVideoId,
                    });
                })
                .catch((error) => {
                    backgroundLogger.error(
                        'Translation failed for provider',
                        error,
                        {
                            providerName: selectedProvider.name,
                        }
                    );
                    sendResponse({
                        error: 'Translation failed',
                        errorType: 'TRANSLATION_API_ERROR',
                        details:
                            error.message ||
                            `Error from ${selectedProvider.name}`,
                        originalText: text,
                        cueStart,
                        cueVideoId,
                    });
                });
            return true;
        }

        case 'fetchVTT': {
            if (message.source === 'netflix') {
                const {
                    data,
                    videoId,
                    targetLanguage,
                    originalLanguage,
                    useNativeSubtitles,
                    useOfficialTranslations,
                } = message;

                processNetflixSubtitleData(
                    data,
                    targetLanguage,
                    originalLanguage,
                    useNativeSubtitles,
                    useOfficialTranslations
                )
                    .then((result) => {
                        sendResponse({
                            success: true,
                            vttText: result.vttText,
                            targetVttText: result.targetVttText,
                            videoId,
                            url: result.url,
                            sourceLanguage: result.sourceLanguage,
                            targetLanguage: result.targetLanguage,
                            useNativeTarget: result.useNativeTarget,
                            availableLanguages: result.availableLanguages,
                        });
                    })
                    .catch((error) => {
                        backgroundLogger.error(
                            'Failed to process Netflix VTT for videoId',
                            error,
                            {
                                videoId,
                            }
                        );
                        sendResponse({
                            success: false,
                            error: `Netflix VTT Processing Error: ${error.message}`,
                            videoId,
                        });
                    });
            } else {
                const { url, videoId, targetLanguage, originalLanguage } =
                    message;
                fetchAndProcessSubtitleUrl(
                    url,
                    targetLanguage,
                    originalLanguage
                )
                    .then((result) => {
                        sendResponse({
                            success: true,
                            vttText: result.vttText,
                            targetVttText: result.targetVttText,
                            videoId,
                            url,
                            sourceLanguage: result.sourceLanguage,
                            targetLanguage: result.targetLanguage,
                            useNativeTarget: result.useNativeTarget,
                            availableLanguages: result.availableLanguages,
                            selectedLanguage: result.selectedLanguage,
                            targetLanguageInfo: result.targetLanguageInfo,
                        });
                    })
                    .catch((error) => {
                        backgroundLogger.error(
                            'Failed to fetch/process VTT for URL',
                            error,
                            {
                                url,
                            }
                        );
                        sendResponse({
                            success: false,
                            error: `VTT Processing Error: ${error.message}`,
                            videoId,
                            url,
                        });
                    });
            }
            return true;
        }

        case 'changeProvider': {
            const newProviderId = message.providerId;
            if (translationProviders[newProviderId]) {
                currentTranslationProviderId = newProviderId;
                chrome.storage.sync.set(
                    { selectedProvider: newProviderId },
                    () => {
                        const providerName =
                            translationProviders[currentTranslationProviderId]
                                .name;
                        sendResponse({
                            success: true,
                            message: `Provider changed to ${providerName}`,
                        });
                    }
                );
            } else {
                backgroundLogger.error(
                    'Attempted to switch to unknown provider',
                    null,
                    {
                        providerId: newProviderId,
                    }
                );
                sendResponse({
                    success: false,
                    message: `Unknown provider: ${newProviderId}`,
                });
            }
            return true;
        }
    }
    return false;
});

// Listen for configuration changes using the configuration service
configService.onChanged((changes) => {
    if (
        changes.selectedProvider &&
        translationProviders[changes.selectedProvider]
    ) {
        currentTranslationProviderId = changes.selectedProvider;
        backgroundLogger.info('Translation provider changed', {
            selectedProvider: changes.selectedProvider,
        });
    }
});
