// disneyplus-dualsub-chrome-extension/background.js
import { translate as googleTranslate } from './translation_providers/googleTranslate.js';
import { translate as microsoftTranslateEdgeAuth } from './translation_providers/microsoftTranslateEdgeAuth.js';
console.log("Disney+ Dual Subtitles background script loaded.");

// Translation Provider Registry
const translationProviders = {
    'google': {
        name: 'Google Translate (Free)',
        translate: googleTranslate
    },
    'microsoft_edge_auth': {
        name: 'Microsoft Translate (Free)',
        translate: microsoftTranslateEdgeAuth
    }
    // Future providers can be added here
};

let currentTranslationProviderId = 'google'; // Default provider

// Load the selected provider from storage on startup.
chrome.storage.sync.get('selectedProvider', (data) => {
    if (data.selectedProvider && translationProviders[data.selectedProvider]) {
        currentTranslationProviderId = data.selectedProvider;
        console.log(`Background: Loaded provider from storage: ${translationProviders[currentTranslationProviderId].name}`);
    } else {
        // If no provider is in storage, set the default.
        chrome.storage.sync.set({ selectedProvider: currentTranslationProviderId });
        console.log(`Background: Using default provider: ${translationProviders[currentTranslationProviderId].name}`);
    }
});

// Initialize default settings on installation
chrome.runtime.onInstalled.addListener(() => {
    // A list of all settings to ensure they have a default value.
    const allSettingKeys = [
        'subtitlesEnabled', 'targetLanguage', 'subtitleTimeOffset',
        'subtitleLayoutOrder', 'subtitleLayoutOrientation', 'subtitleFontSize',
        'subtitleGap', 'translationBatchSize', 'translationDelay',
        'selectedProvider'
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

        if (Object.keys(defaultsToSet).length > 0) {
            chrome.storage.sync.set(defaultsToSet, () => {
                console.log("Background: Default settings initialized.", defaultsToSet);
            });
        }
    });
});

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

async function fetchAndProcessSubtitleUrl(masterPlaylistUrl) {
    console.log("Background: Fetching master URL:", masterPlaylistUrl);
    const masterPlaylistText = await fetchText(masterPlaylistUrl);

    if (masterPlaylistText.trim().toUpperCase().startsWith("WEBVTT")) {
        console.log("Background: Master URL points directly to a VTT file.");
        return masterPlaylistText;
    }

    if (!masterPlaylistText.trim().startsWith("#EXTM3U")) {
        throw new Error("Content is not a recognized M3U8 playlist or VTT file.");
    }
    
    console.log("Background: Master content is an M3U8 playlist. Parsing...");
    const subtitlePlaylistUri = findSubtitlePlaylistUri(masterPlaylistText);

    if (subtitlePlaylistUri) {
        const fullSubtitlePlaylistUrl = new URL(subtitlePlaylistUri, masterPlaylistUrl).href;
        console.log("Background: Fetching subtitle-specific playlist:", fullSubtitlePlaylistUrl);
        const subtitlePlaylistText = await fetchText(fullSubtitlePlaylistUrl);

        if (subtitlePlaylistText.trim().toUpperCase().startsWith("WEBVTT")) {
            console.log("Background: Subtitle playlist URI pointed directly to VTT content.");
            return subtitlePlaylistText;
        }

        if (!subtitlePlaylistText.trim().startsWith("#EXTM3U")) {
            throw new Error("Content from subtitle playlist URI was not a recognized M3U8 or VTT.");
        }

        console.log("Background: Subtitle-specific playlist is an M3U8. Parsing for VTT segments...");
        const vttSegmentUrls = parsePlaylistForVttSegments(subtitlePlaylistText, fullSubtitlePlaylistUrl);
        if (vttSegmentUrls.length === 0) {
            throw new Error("No VTT segments found in the subtitle-specific M3U8 playlist.");
        }
        return fetchAndCombineVttSegments(vttSegmentUrls, fullSubtitlePlaylistUrl);
    } else {
        console.warn("Background: No explicit subtitle playlist URI found. Attempting fallback...");
        const vttSegmentUrls = parsePlaylistForVttSegments(masterPlaylistText, masterPlaylistUrl);

        if (vttSegmentUrls.length > 0) {
            console.log("Background (fallback): Found direct VTT segments in master playlist.");
            return fetchAndCombineVttSegments(vttSegmentUrls, masterPlaylistUrl);
        }

        throw new Error("Could not find subtitle URI or any VTT segments in master playlist.");
    }
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
            const { url, videoId } = message;
            console.log("Background: Received fetchVTT request for URL:", url);
            fetchAndProcessSubtitleUrl(url)
                .then(vttText => {
                    console.log("Background: Successfully fetched and processed VTT. Length:", vttText?.length);
                    sendResponse({ success: true, vttText, videoId, url });
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
