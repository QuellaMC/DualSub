import { translate as googleTranslate } from './translation_providers/googleTranslate.js';
import { translate as microsoftTranslateEdgeAuth } from './translation_providers/microsoftTranslateEdgeAuth.js';
console.log("Disney+ Dual Subtitles background script loaded.");

const translationProviders = {
    'google': {
        name: 'Google Translate (Free)',
        translate: googleTranslate
    },
    'microsoft_edge_auth': {
        name: 'Microsoft Translate (Free)',
        translate: microsoftTranslateEdgeAuth
    }
};

let currentTranslationProviderId = 'google';

chrome.storage.sync.get('selectedProvider', (data) => {
    if (data.selectedProvider && translationProviders[data.selectedProvider]) {
        currentTranslationProviderId = data.selectedProvider;
        console.log(`Background: Loaded provider from storage: ${translationProviders[currentTranslationProviderId].name}`);
    } else {
        chrome.storage.sync.set({ selectedProvider: currentTranslationProviderId });
        console.log(`Background: Using default provider: ${translationProviders[currentTranslationProviderId].name}`);
    }
});

chrome.runtime.onInstalled.addListener(() => {
    const allSettingKeys = [
        'subtitlesEnabled', 'targetLanguage', 'subtitleTimeOffset',
        'subtitleLayoutOrder', 'subtitleLayoutOrientation', 'subtitleFontSize',
        'subtitleGap', 'translationBatchSize', 'translationDelay',
        'selectedProvider', 'useNativeSubtitles'
    ];

    chrome.storage.sync.get(allSettingKeys, (items) => {
        const defaultsToSet = {};

        if (items.subtitlesEnabled === undefined) defaultsToSet.subtitlesEnabled = true;
        if (items.targetLanguage === undefined) defaultsToSet.targetLanguage = 'zh-CN';
        if (items.subtitleTimeOffset === undefined) defaultsToSet.subtitleTimeOffset = 0.3;
        if (items.subtitleLayoutOrder === undefined) defaultsToSet.subtitleLayoutOrder = 'original_top';
        if (items.subtitleLayoutOrientation === undefined) defaultsToSet.subtitleLayoutOrientation = 'column';
        if (items.subtitleFontSize === undefined) defaultsToSet.subtitleFontSize = 1.1;
        if (items.subtitleGap === undefined) defaultsToSet.subtitleGap = 0.3;
        if (items.translationBatchSize === undefined) defaultsToSet.translationBatchSize = 3;
        if (items.translationDelay === undefined) defaultsToSet.translationDelay = 150;
        if (items.selectedProvider === undefined) defaultsToSet.selectedProvider = 'google';
        if (items.useNativeSubtitles === undefined) defaultsToSet.useNativeSubtitles = true;

        if (Object.keys(defaultsToSet).length > 0) {
            chrome.storage.sync.set(defaultsToSet, () => {
                console.log("Background: Default settings initialized.", defaultsToSet);
            });
        }
    });
});

const languageNormalizationCache = new Map();

const normalizedMap = {
    'en': 'en',
    'en-us': 'en',
    'es': 'es',
    'es-419': 'es', // Latin American Spanish
    'es-es': 'es', // European Spanish
    'fr': 'fr',
    'fr-ca': 'fr', // Canadian French
    'fr-fr': 'fr', // European French
    'de': 'de',
    'de-de': 'de',
    'it': 'it',
    'it-it': 'it',
    'pt': 'pt',
    'pt-br': 'pt', // Brazilian Portuguese
    'pt-pt': 'pt', // European Portuguese
    'ja': 'ja',
    'ja-jp': 'ja',
    'ko': 'ko',
    'ko-kr': 'ko',
    'zh': 'zh-CN',
    'zh-cn': 'zh-CN',
    'zh-hans': 'zh-CN', // Simplified Chinese
    'zh-tw': 'zh-TW',
    'zh-hant': 'zh-TW', // Traditional Chinese
    'ru': 'ru',
    'ru-ru': 'ru',
    'ar': 'ar',
    'hi': 'hi',
    'hi-in': 'hi'
};

function normalizeLanguageCode(platformLangCode) {
    if (!platformLangCode || typeof platformLangCode !== 'string') {
        console.warn('Background: Invalid language code provided to normalizeLanguageCode:', platformLangCode);
        return 'en';
    }

    // Normalize to lowercase for case-insensitive caching and lookup
    const lowerCaseCode = platformLangCode.toLowerCase();

    if (languageNormalizationCache.has(lowerCaseCode)) {
        return languageNormalizationCache.get(lowerCaseCode);
    }

    const normalized = normalizedMap[lowerCaseCode] || platformLangCode;
    languageNormalizationCache.set(lowerCaseCode, normalized);
    return normalized;
}

function parseAvailableSubtitleLanguages(masterPlaylistText) {
    if (!masterPlaylistText || typeof masterPlaylistText !== 'string') {
        console.warn('Background: Invalid playlist text provided to parseAvailableSubtitleLanguages');
        return [];
    }

    const lines = masterPlaylistText.split('\n');
    const availableLanguages = [];

    for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine.startsWith("#EXT-X-MEDIA") && trimmedLine.includes("TYPE=SUBTITLES")) {
            try {
                const languageMatch = trimmedLine.match(/LANGUAGE="([^"]+)"/);
                const uriMatch = trimmedLine.match(/URI="([^"]+)"/);
                const nameMatch = trimmedLine.match(/NAME="([^"]+)"/);
                
                if (languageMatch && uriMatch) {
                    const rawLangCode = languageMatch[1];
                    const normalizedLangCode = normalizeLanguageCode(rawLangCode);
                    const displayName = nameMatch ? nameMatch[1] : rawLangCode;
                    const uri = uriMatch[1];
                    
                    availableLanguages.push({
                        rawCode: rawLangCode,
                        normalizedCode: normalizedLangCode,
                        displayName: displayName,
                        uri: uri
                    });
                    
                    console.log(`Background: Found subtitle language: ${rawLangCode} -> ${normalizedLangCode} (${displayName})`);
                }
            } catch (error) {
                console.warn('Background: Error parsing subtitle language line:', trimmedLine, error);
            }
        }
    }
    
    return availableLanguages;
}

function findSubtitleUriForLanguage(availableLanguages, targetLangCode) {
    if (!targetLangCode || availableLanguages.length === 0) {
        return null;
    }
    
    // Helper function to check if a subtitle track is forced
    const isForcedTrack = (lang) => {
        return lang.displayName?.toLowerCase().includes('forced') || 
               lang.displayName?.toLowerCase().includes('--forced--') ||
               lang.rawCode?.toLowerCase().includes('forced') ||
               lang.uri?.toLowerCase().includes('forced') ||
               lang.uri?.toLowerCase().includes('_forced_');
    };
    
    // Helper function to prefer normal tracks over forced tracks
    const selectBestMatch = (matches) => {
        if (matches.length === 0) return null;
        if (matches.length === 1) return matches[0];
        
        // Prefer non-forced tracks
        const normalTracks = matches.filter(match => !isForcedTrack(match));
        if (normalTracks.length > 0) {
            // Within normal tracks, prefer those with "NORMAL" in URI or display name
            const explicitNormalTracks = normalTracks.filter(track => 
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
    
    // Exact match on normalized code
    let matches = availableLanguages.filter(lang => lang.normalizedCode === targetLangCode);
    if (matches.length > 0) {
        return selectBestMatch(matches);
    }
    
    // Exact match on raw code
    matches = availableLanguages.filter(lang => lang.rawCode === targetLangCode);
    if (matches.length > 0) {
        return selectBestMatch(matches);
    }
    
    // Language family matching
    const languageFamilies = ['zh', 'es', 'en', 'fr', 'de', 'pt', 'it', 'ja', 'ko'];
    const targetFamily = languageFamilies.find(family => targetLangCode.startsWith(family));
    
    if (targetFamily) {
        matches = availableLanguages.filter(lang => 
            lang.normalizedCode.startsWith(targetFamily) || lang.rawCode.startsWith(targetFamily)
        );
        if (matches.length > 0) {
            return selectBestMatch(matches);
        }
    }
    
    // Case-insensitive partial matching
    const targetLower = targetLangCode.toLowerCase();
    matches = availableLanguages.filter(lang => 
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
        if (trimmedLine.startsWith("#EXT-X-MEDIA") && trimmedLine.includes("TYPE=SUBTITLES")) {
            subtitlePlaylistUri = getUriFromExtXMedia(trimmedLine);
            if (subtitlePlaylistUri) {
                console.log("Background: Found subtitle playlist URI (TYPE=SUBTITLES):", subtitlePlaylistUri);
                return subtitlePlaylistUri;
            }
        }
    }

    console.log("Background: No direct TYPE=SUBTITLES URI. Checking for streams with SUBTITLES attribute...");
    for (let i = 0; i < lines.length; i++) {
        const trimmedLine = lines[i].trim();
        if (trimmedLine.startsWith("#EXT-X-STREAM-INF") && trimmedLine.includes("SUBTITLES=")) {
            const subtitlesGroupIdMatch = trimmedLine.match(/SUBTITLES="([^"]+)"/);
            if (subtitlesGroupIdMatch) {
                const groupId = subtitlesGroupIdMatch[1];
                for (const mediaLine of lines) {
                    if (mediaLine.startsWith("#EXT-X-MEDIA") && mediaLine.includes(`GROUP-ID="${groupId}"`) && mediaLine.includes("TYPE=SUBTITLES")) {
                        subtitlePlaylistUri = getUriFromExtXMedia(mediaLine);
                        if (subtitlePlaylistUri) {
                            console.log(`Background: Found subtitle playlist URI (GROUP-ID="${groupId}"):`, subtitlePlaylistUri);
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
        if (trimmedLine && !trimmedLine.startsWith("#")) {
            // Basic check for VTT extension or segment-like names.
            if (trimmedLine.toLowerCase().includes(".vtt") || trimmedLine.toLowerCase().includes(".webvtt") || !trimmedLine.includes("/")) {
                try {
                    const segmentUrl = new URL(trimmedLine, baseUrl.href).href;
                    segmentUrls.push(segmentUrl);
                } catch (e) {
                    console.warn(`Background: Could not form valid URL from M3U8 line: "${trimmedLine}" relative to ${baseUrl.href}`);
                }
            }
        }
    }
    return segmentUrls;
}

async function fetchAndCombineVttSegments(segmentUrls, playlistUrlForLogging = "N/A") {
    console.log(`Background: Found ${segmentUrls.length} VTT segments from playlist: ${playlistUrlForLogging}. Fetching...`);

    const fetchPromises = segmentUrls.map(async (url) => {
        try {
            return await fetchText(url);
        } catch (e) {
            console.warn(`Background: Error fetching VTT segment ${url}:`, e);
            return null;
        }
    });

    const segmentTexts = await Promise.all(fetchPromises);
    let combinedVttText = "WEBVTT\n\n";
    let segmentsFetchedCount = 0;

    for (const segmentText of segmentTexts) {
        if (segmentText) {
            segmentsFetchedCount++;
            const cleanedSegment = segmentText.replace(/^WEBVTT\s*/i, "").trim();
            if (cleanedSegment) {
                combinedVttText += cleanedSegment + "\n\n";
            }
        }
    }

    if (segmentsFetchedCount === 0 && segmentUrls.length > 0) {
        throw new Error(`Failed to fetch any of the ${segmentUrls.length} VTT segments.`);
    }

    console.log(`Background: ${segmentsFetchedCount}/${segmentUrls.length} VTT segments combined.`);
    return combinedVttText;
}

async function fetchAndProcessSubtitleUrl(masterPlaylistUrl, targetLanguage = null, originalLanguage = 'en') {
    console.log("Background: Fetching master URL:", masterPlaylistUrl);
    console.log("Background: User preferences - Original:", originalLanguage, "Target:", targetLanguage);
    
    const masterPlaylistText = await fetchText(masterPlaylistUrl);

    if (masterPlaylistText.trim().toUpperCase().startsWith("WEBVTT")) {
        console.log("Background: Master URL points directly to a VTT file.");
        return {
            vttText: masterPlaylistText,
            sourceLanguage: 'unknown',
            useNativeTarget: false,
            availableLanguages: []
        };
    }

    if (!masterPlaylistText.trim().startsWith("#EXTM3U")) {
        throw new Error("Content is not a recognized M3U8 playlist or VTT file.");
    }
    
    console.log("Background: Master content is an M3U8 playlist. Parsing available languages...");
    const availableLanguages = parseAvailableSubtitleLanguages(masterPlaylistText);
    console.log("Background: Available subtitle languages:", availableLanguages.map(lang => `${lang.normalizedCode} (${lang.displayName})`));
    
    // Get user settings for smart subtitle logic
    const settings = await chrome.storage.sync.get(['useNativeSubtitles']);
    const useNativeSubtitles = settings.useNativeSubtitles !== false; // Default to true
    
    console.log("Background: Smart subtitle settings - useNativeSubtitles:", useNativeSubtitles);
    
    let useNativeTarget = false;
    let targetLanguageInfo = null;
    let originalLanguageInfo = null;
    
    // Step 1: Check if we should use native target language (when available and smart subtitles enabled)
    if (useNativeSubtitles && targetLanguage) {
        if (targetLanguage === originalLanguage) {
            // Find the target language natively for single language mode
            targetLanguageInfo = findSubtitleUriForLanguage(availableLanguages, targetLanguage);
            if (targetLanguageInfo) {
                console.log(`Background: ✅ Found native language ${targetLanguage}: ${targetLanguageInfo.displayName}`);
                useNativeTarget = true;
                // In this case, we'll use the same language for both original and target
                originalLanguageInfo = targetLanguageInfo;
            } else {
                console.log(`Background: ❌ Native language ${targetLanguage} not available`);
            }
        } else {
            // Different target and original languages - dual language mode
            targetLanguageInfo = findSubtitleUriForLanguage(availableLanguages, targetLanguage);
            if (targetLanguageInfo) {
                console.log(`Background: ✅ Target language ${targetLanguage} found natively: ${targetLanguageInfo.displayName}`);
                useNativeTarget = true;
            } else {
                console.log(`Background: ❌ Target language ${targetLanguage} not available natively`);
            }
        }
    }
    
    // Step 2: Find original language subtitle for dual display (skip if already found in Step 1)
    if (originalLanguage && !originalLanguageInfo) {
        originalLanguageInfo = findSubtitleUriForLanguage(availableLanguages, originalLanguage);
        if (originalLanguageInfo) {
            console.log(`Background: ✅ Found original language ${originalLanguage}: ${originalLanguageInfo.displayName}`);
        } else {
            console.log(`Background: ❌ Original language ${originalLanguage} not available`);
            // Fallback to English if original language is not available
            originalLanguageInfo = findSubtitleUriForLanguage(availableLanguages, 'en');
            if (originalLanguageInfo) {
                console.log(`Background: ✅ Using English fallback for original: ${originalLanguageInfo.displayName}`);
            }
        }
    }
    
    // Step 3: Universal fallback to first available language if no suitable original found
    if (!originalLanguageInfo) {
        console.log("Background: No suitable original language found. Attempting universal fallback...");
        
        // Use the first available language if no original language found
        if (availableLanguages.length > 0) {
            originalLanguageInfo = availableLanguages[0];
            console.log(`Background: ✅ Using first available language as fallback: ${originalLanguageInfo.displayName} (${originalLanguageInfo.normalizedCode})`);
        }
    }
    
    if (!originalLanguageInfo) {
        if (availableLanguages.length === 0) {
            throw new Error("No subtitle languages are available for this content.");
        } else {
            throw new Error("No suitable subtitle language found despite available languages.");
        }
    }
    
    console.log(`Background: Final decision - Original: ${originalLanguageInfo.normalizedCode} (${originalLanguageInfo.displayName}), Native target: ${useNativeTarget}`);
    if (useNativeTarget && targetLanguageInfo) {
        console.log(`Background: Will use native target: ${targetLanguageInfo.normalizedCode} (${targetLanguageInfo.displayName})`);
    }
    
    // Step 4: Fetch original language subtitles
    const fullOriginalSubtitleUrl = new URL(originalLanguageInfo.uri, masterPlaylistUrl).href;
    console.log("Background: Fetching original subtitle playlist:", fullOriginalSubtitleUrl);
    const originalSubtitleText = await fetchText(fullOriginalSubtitleUrl);

    let originalVttText;
    if (originalSubtitleText.trim().toUpperCase().startsWith("WEBVTT")) {
        console.log("Background: Original subtitle playlist URI pointed directly to VTT content.");
        originalVttText = originalSubtitleText;
    } else if (originalSubtitleText.trim().startsWith("#EXTM3U")) {
        console.log("Background: Original subtitle-specific playlist is an M3U8. Parsing for VTT segments...");
        const vttSegmentUrls = parsePlaylistForVttSegments(originalSubtitleText, fullOriginalSubtitleUrl);
        if (vttSegmentUrls.length === 0) {
            throw new Error("No VTT segments found in the original subtitle-specific M3U8 playlist.");
        }
        originalVttText = await fetchAndCombineVttSegments(vttSegmentUrls, fullOriginalSubtitleUrl);
    } else {
        throw new Error("Content from original subtitle playlist URI was not a recognized M3U8 or VTT.");
    }
    
    // Step 5: Fetch target language subtitles if using native target
    let targetVttText = null;
    if (useNativeTarget && targetLanguageInfo) {
        const fullTargetSubtitleUrl = new URL(targetLanguageInfo.uri, masterPlaylistUrl).href;
        console.log("Background: Fetching target subtitle playlist:", fullTargetSubtitleUrl);
        const targetSubtitleText = await fetchText(fullTargetSubtitleUrl);

        if (targetSubtitleText.trim().toUpperCase().startsWith("WEBVTT")) {
            console.log("Background: Target subtitle playlist URI pointed directly to VTT content.");
            targetVttText = targetSubtitleText;
        } else if (targetSubtitleText.trim().startsWith("#EXTM3U")) {
            console.log("Background: Target subtitle-specific playlist is an M3U8. Parsing for VTT segments...");
            const vttSegmentUrls = parsePlaylistForVttSegments(targetSubtitleText, fullTargetSubtitleUrl);
            if (vttSegmentUrls.length === 0) {
                throw new Error("No VTT segments found in the target subtitle-specific M3U8 playlist.");
            }
            targetVttText = await fetchAndCombineVttSegments(vttSegmentUrls, fullTargetSubtitleUrl);
        } else {
            throw new Error("Content from target subtitle playlist URI was not a recognized M3U8 or VTT.");
        }
    }
    
    console.log(`Background: Successfully processed VTT - Original: ${originalVttText.length} chars, Target: ${targetVttText ? targetVttText.length + ' chars' : 'null'}, useNativeTarget: ${useNativeTarget}`);
    
    return {
        vttText: originalVttText,
        targetVttText: targetVttText,
        sourceLanguage: originalLanguageInfo.normalizedCode,
        targetLanguage: useNativeTarget ? targetLanguageInfo.normalizedCode : null,
        useNativeTarget: useNativeTarget,
        availableLanguages: availableLanguages,
        selectedLanguage: originalLanguageInfo,
        targetLanguageInfo: targetLanguageInfo
    };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
        case "translate": {
            const { text, targetLang, cueStart, cueVideoId } = message;
            const sourceLang = 'auto';
            const selectedProvider = translationProviders[currentTranslationProviderId];

            if (!selectedProvider?.translate) {
                console.error(`Background: Invalid translation provider: ${currentTranslationProviderId}`);
                sendResponse({
                    error: "Translation failed",
                    details: `Provider "${currentTranslationProviderId}" is not configured.`,
                    originalText: text, cueStart, cueVideoId
                });
                return true;
            }

            selectedProvider.translate(text, sourceLang, targetLang)
                .then(translatedText => {
                    sendResponse({ translatedText, originalText: text, cueStart, cueVideoId });
                })
                .catch(error => {
                    console.error(`Background: Translation failed for provider '${selectedProvider.name}':`, error);
                    sendResponse({
                        error: "Translation failed",
                        errorType: "TRANSLATION_API_ERROR",
                        details: error.message || `Error from ${selectedProvider.name}`,
                        originalText: text, cueStart, cueVideoId
                    });
                });
            return true; // Indicates an asynchronous response.
        }

        case "fetchVTT": {
            const { url, videoId, targetLanguage, originalLanguage } = message;
            console.log("Background: Received fetchVTT request for URL:", url, "Target:", targetLanguage, "Original:", originalLanguage);
            fetchAndProcessSubtitleUrl(url, targetLanguage, originalLanguage)
                .then(result => {
                    console.log("Background: Successfully fetched and processed VTT. Original length:", result.vttText?.length, "Target length:", result.targetVttText?.length);
                    console.log("Background: Source language:", result.sourceLanguage, "Target language:", result.targetLanguage, "Use native target:", result.useNativeTarget);
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
                        targetLanguageInfo: result.targetLanguageInfo
                    });
                })
                .catch(error => {
                    console.error("Background: Failed to fetch/process VTT for URL:", url, error);
                    sendResponse({ success: false, error: `VTT Processing Error: ${error.message}`, videoId, url });
                });
            return true;
        }

        case "changeProvider": {
            const newProviderId = message.providerId;
            if (translationProviders[newProviderId]) {
                currentTranslationProviderId = newProviderId;
                chrome.storage.sync.set({ selectedProvider: newProviderId }, () => {
                    const providerName = translationProviders[currentTranslationProviderId].name;
                    console.log(`Background: Translation provider changed to: ${providerName}`);
                    sendResponse({ success: true, message: `Provider changed to ${providerName}` });
                });
            } else {
                console.error(`Background: Attempted to switch to unknown provider: ${newProviderId}`);
                sendResponse({ success: false, message: `Unknown provider: ${newProviderId}` });
            }
            return true;
        }
    }
    // Return false for unhandled actions.
    return false;
});

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync') {
        for (let [key, { oldValue, newValue }] of Object.entries(changes)) {
            // Log setting changes for easier debugging from the background script.
            console.log(
                `Background: Storage key "${key}" in "sync" changed.`,
                { from: oldValue, to: newValue }
            );
            // Specifically handle provider change if it happens in another context (e.g., options page)
            if (key === 'selectedProvider' && translationProviders[newValue]) {
                currentTranslationProviderId = newValue;
                console.log(`Background: Translation provider updated to: ${translationProviders[currentTranslationProviderId].name}`);
            }
        }
    }
});
