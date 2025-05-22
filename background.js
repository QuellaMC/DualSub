// disneyplus-dualsub-chrome-extension/background.js
import { translate as googleTranslate } from './translation_providers/googleTranslate.js';
import { translate as microsoftTranslateEdgeAuth } from './translation_providers/microsoftTranslateEdgeAuth.js';
console.log("Disney+ Dual Subtitles background script loaded (v2.4 - Enhanced Translation Error Handling & VTT Fetch).");

// Translation Provider Registry
const translationProviders = {
    'google': {
        name: 'Google Translate (Free)',
        translate: googleTranslate // The function imported from ./translation_providers/googleTranslate.js
    },
    'microsoft_edge_auth': {
        name: 'Microsoft Translate (Free)',
        translate: microsoftTranslateEdgeAuth // The function imported from ./translation_providers/microsoftTranslateEdgeAuth.js
    }
    // Future providers will be added here, e.g.:
    // 'deepl': { name: 'DeepL', translate: deeplTranslateFunction }
};

let currentTranslationProviderId = 'google'; // Default provider

chrome.storage.sync.get('selectedProvider', (data) => {
    if (data.selectedProvider && translationProviders[data.selectedProvider]) {
        currentTranslationProviderId = data.selectedProvider;
        console.log(`Background: Loaded translation provider from storage: ${translationProviders[currentTranslationProviderId].name}`);
    } else {
        // If not found or invalid, stick to default and potentially save the default
        chrome.storage.sync.set({ selectedProvider: currentTranslationProviderId });
        console.log(`Background: Using default translation provider: ${translationProviders[currentTranslationProviderId].name}`);
    }
});

// Initialize default settings on installation
chrome.runtime.onInstalled.addListener(() => {
    // Define all keys we manage to ensure they are all considered.
    const allSettingKeys = [
        'subtitlesEnabled', 'targetLanguage', 'subtitleTimeOffset', 
        'subtitleLayoutOrder', 'subtitleLayoutOrientation', 'subtitleFontSize',
        'subtitleGap', 'translationBatchSize', 'translationDelay'
    ];

    chrome.storage.sync.get(allSettingKeys, (items) => {
        const defaultsToSet = {};
        
        if (items.subtitlesEnabled === undefined) {
            defaultsToSet.subtitlesEnabled = true;
        }
        if (items.targetLanguage === undefined) {
            defaultsToSet.targetLanguage = 'zh-CN'; 
        }
        if (items.subtitleTimeOffset === undefined) {
            defaultsToSet.subtitleTimeOffset = 0.3;
        }
        if (items.subtitleLayoutOrder === undefined) {
            defaultsToSet.subtitleLayoutOrder = 'original_top';
        }
        if (items.subtitleLayoutOrientation === undefined) {
            defaultsToSet.subtitleLayoutOrientation = 'column';
        }
        if (items.subtitleFontSize === undefined) {
            defaultsToSet.subtitleFontSize = 1.1;
        }
        if (items.subtitleGap === undefined) {
            defaultsToSet.subtitleGap = 0.3;
        }
        if (items.translationBatchSize === undefined) {
            defaultsToSet.translationBatchSize = 3;
        }
        if (items.translationDelay === undefined) {
            defaultsToSet.translationDelay = 150;
        }

        if (Object.keys(defaultsToSet).length > 0) {
            chrome.storage.sync.set(defaultsToSet, () => {
                console.log("Background: Default settings initialized/ensured:", defaultsToSet);
            });
        } else {
            console.log("Background: Existing settings found, defaults not overwritten.");
        }
    });
});

// Function to parse URI from #EXT-X-MEDIA tag
function getUriFromExtXMedia(line) {
    const uriMatch = line.match(/URI="([^"]+)"/);
    return uriMatch ? uriMatch[1] : null;
}

async function fetchAndProcessSubtitleUrl(masterPlaylistUrl) {
    let masterPlaylistText;
    try {
        console.log("Background: Fetching master playlist:", masterPlaylistUrl);
        const response = await fetch(masterPlaylistUrl);
        if (!response.ok) {
            throw new Error(`HTTP error ${response.status} for master playlist ${masterPlaylistUrl}`);
        }
        masterPlaylistText = await response.text();
    } catch (e) {
        console.error(`Background: Initial fetch failed for ${masterPlaylistUrl}:`, e);
        // It's possible the masterPlaylistUrl itself is a direct VTT URL
        if (e.message.includes("Failed to fetch") || e.message.includes("HTTP error")) {
             // Let's try to see if it's a VTT directly
            if (masterPlaylistText && masterPlaylistText.trim().toUpperCase().startsWith("WEBVTT")) {
                console.log("Background: Master URL content looks like direct VTT after fetch failure analysis.");
                return masterPlaylistText;
            }
        }
        throw e; // Re-throw to be caught by the caller
    }

    if (masterPlaylistText.trim().toUpperCase().startsWith("WEBVTT")) {
         console.log("Background: Content from master URL is direct VTT.");
         return masterPlaylistText;
    }

    if (!masterPlaylistText.trim().startsWith("#EXTM3U")) {
        console.warn("Background: Fetched content is not an M3U8 playlist. Assuming direct VTT or unsupported format.", masterPlaylistUrl);
        throw new Error("Content fetched was not a recognized M3U8 master playlist nor direct VTT.");
    }

    console.log("Background: Master M3U8 playlist fetched. Searching for subtitle playlist URI...");
    const lines = masterPlaylistText.split('\n');
    let subtitlePlaylistUri = null;
    const masterBaseUrl = new URL(masterPlaylistUrl); // For resolving relative URIs

    for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine.startsWith("#EXT-X-MEDIA") && trimmedLine.includes("TYPE=SUBTITLES")) {
            subtitlePlaylistUri = getUriFromExtXMedia(trimmedLine);
            if (subtitlePlaylistUri) {
                console.log("Background: Found subtitle playlist URI (TYPE=SUBTITLES) in master:", subtitlePlaylistUri);
                break;
            }
        }
    }

    if (!subtitlePlaylistUri) {
        console.log("Background: No TYPE=SUBTITLES found. Checking for EXT-X-STREAM-INF with SUBTITLES attribute...");
        for (let i = 0; i < lines.length; i++) {
            const trimmedLine = lines[i].trim();
            if (trimmedLine.startsWith("#EXT-X-STREAM-INF") && trimmedLine.includes("SUBTITLES=")) {
                const subtitlesGroupIdMatch = trimmedLine.match(/SUBTITLES="([^"]+)"/);
                if (subtitlesGroupIdMatch) {
                    const groupId = subtitlesGroupIdMatch[1];
                    for (const mediaLine of lines) {
                        if (mediaLine.startsWith("#EXT-X-MEDIA") &&
                            mediaLine.includes(`GROUP-ID="${groupId}"`) &&
                            mediaLine.includes("TYPE=SUBTITLES")) {
                            subtitlePlaylistUri = getUriFromExtXMedia(mediaLine);
                            if (subtitlePlaylistUri) {
                                console.log(`Background: Found subtitle playlist URI (GROUP-ID="${groupId}", TYPE=SUBTITLES):`, subtitlePlaylistUri);
                                break;
                            }
                        }
                    }
                }
                if (subtitlePlaylistUri) break;
            }
        }
    }


    if (!subtitlePlaylistUri) {
        console.warn("Background: No explicit subtitle playlist URI found. Attempting to parse current M3U8 for direct VTT segments (fallback)...", masterPlaylistUrl);
        const vttSegmentUrlsFromMaster = [];
        for (const line of lines) {
            const trimmedLine = line.trim();
            // Look for lines that are not comments and seem like relative/absolute paths to .vtt files
            if (trimmedLine && !trimmedLine.startsWith("#") && trimmedLine.toLowerCase().includes(".vtt")) {
                 try {
                    const segmentUrl = new URL(trimmedLine, masterBaseUrl.href).href;
                    vttSegmentUrlsFromMaster.push(segmentUrl);
                } catch (e) {
                    console.warn(`Background: Could not form valid URL from M3U8 (fallback) line: ${trimmedLine} relative to ${masterBaseUrl.href}`);
                }
            }
        }
        if (vttSegmentUrlsFromMaster.length > 0) {
            console.log("Background (fallback): Found direct VTT segments in the provided M3U8:", vttSegmentUrlsFromMaster);
            return fetchAndCombineVttSegments(vttSegmentUrlsFromMaster, masterPlaylistUrl);
        }
        console.error("Background: Could not find subtitle playlist URI in master playlist, and no direct VTTs found with fallback.");
        throw new Error("No subtitle playlist URI found in master M3U8 and no direct VTTs in fallback.");
    }

    const fullSubtitlePlaylistUrl = new URL(subtitlePlaylistUri, masterBaseUrl.href).href;
    console.log("Background: Fetching subtitle-specific M3U8 playlist:", fullSubtitlePlaylistUrl);

    let subtitlePlaylistText;
    try {
        const subPlaylistResponse = await fetch(fullSubtitlePlaylistUrl);
        if (!subPlaylistResponse.ok) {
            throw new Error(`HTTP error ${subPlaylistResponse.status} for subtitle playlist ${fullSubtitlePlaylistUrl}`);
        }
        subtitlePlaylistText = await subPlaylistResponse.text();
    } catch (e) {
        console.error(`Background: Fetch failed for subtitle M3U8 ${fullSubtitlePlaylistUrl}:`, e);
        throw e;
    }

    if (subtitlePlaylistText.trim().toUpperCase().startsWith("WEBVTT")) {
         console.log("Background: Subtitle playlist URI pointed directly to VTT content.");
         return subtitlePlaylistText;
    }

    if (!subtitlePlaylistText.trim().startsWith("#EXTM3U")) {
        console.warn("Background: Fetched subtitle playlist content is not an M3U8 playlist.", fullSubtitlePlaylistUrl);
        throw new Error("Content from subtitle playlist URI was not a recognized M3U8 playlist nor direct VTT.");
    }

    console.log("Background: Subtitle-specific M3U8 playlist fetched. Parsing for VTT segments...");
    const subtitleLines = subtitlePlaylistText.split('\n');
    const vttSegmentUrls = [];
    const subtitlePlaylistBaseUrl = new URL(fullSubtitlePlaylistUrl);

    for (const line of subtitleLines) {
        const trimmedLine = line.trim();
        if (trimmedLine && !trimmedLine.startsWith("#")) {
            // Check if the line looks like a segment URI (e.g., ends with .vtt or is just a filename)
            if (trimmedLine.toLowerCase().includes(".vtt") || trimmedLine.toLowerCase().includes(".webvtt") || !trimmedLine.includes("/")) {
                 try {
                    const segmentUrl = new URL(trimmedLine, subtitlePlaylistBaseUrl.href).href;
                    vttSegmentUrls.push(segmentUrl);
                } catch (e) {
                    console.warn(`Background: Could not form valid URL from subtitle M3U8 line: ${trimmedLine} relative to ${subtitlePlaylistBaseUrl.href}`);
                }
            }
        }
    }

    if (vttSegmentUrls.length === 0) {
        console.error("Background: Subtitle M3U8 parsed, but no VTT segment URLs found within it.", fullSubtitlePlaylistUrl);
        throw new Error("No VTT segments found in the subtitle-specific M3U8 playlist.");
    }

    return fetchAndCombineVttSegments(vttSegmentUrls, fullSubtitlePlaylistUrl);
}

async function fetchAndCombineVttSegments(segmentUrls, playlistUrlForLogging = "N/A") {
    console.log(`Background: Found ${segmentUrls.length} VTT segment URLs from playlist: ${playlistUrlForLogging}. Fetching and combining...`);
    let combinedVttText = "WEBVTT\n\n";
    let segmentsFetchedCount = 0;

    for (const segmentUrl of segmentUrls) {
        try {
            const segmentResponse = await fetch(segmentUrl);
            if (!segmentResponse.ok) {
                console.warn(`Background: Failed to fetch VTT segment ${segmentUrl}: ${segmentResponse.status}`);
                continue;
            }
            let segmentText = await segmentResponse.text();
            segmentsFetchedCount++;

            // Remove WEBVTT header from individual segments if present, but only after the first one.
            if (combinedVttText !== "WEBVTT\n\n" || !segmentText.trim().toUpperCase().startsWith("WEBVTT")) {
                segmentText = segmentText.replace(/^WEBVTT\s*/i, "").trim();
            } else if (segmentText.trim().toUpperCase().startsWith("WEBVTT")) {
                 // For the very first actual segment, if it has WEBVTT, we keep it, then strip for subsequent ones.
                 // This logic ensures the combinedVTT starts with WEBVTT.
                 if (combinedVttText === "WEBVTT\n\n") { // This is the first segment with content
                    // Do nothing, keep its WEBVTT header if it's the first actual content
                 } else {
                    segmentText = segmentText.replace(/^WEBVTT\s*/i, "").trim();
                 }
            }


            if (segmentText) {
                 combinedVttText += segmentText + "\n\n";
            }
        } catch (e) {
            console.warn(`Background: Error fetching or processing VTT segment ${segmentUrl}:`, e);
        }
    }
    if (segmentsFetchedCount === 0 && segmentUrls.length > 0) {
        throw new Error(`Failed to fetch any of the ${segmentUrls.length} VTT segments.`);
    }
    console.log(`Background: ${segmentsFetchedCount}/${segmentUrls.length} VTT segments processed. Total combined VTT length:`, combinedVttText.length);
    return combinedVttText;
}


chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "translate") {
        const sourceText = message.text;
        const targetLang = message.targetLang;
        const sourceLang = 'auto'; // Or from message if available
        const cueStart = message.cueStart;
        const cueVideoId = message.cueVideoId;

        const selectedProvider = translationProviders[currentTranslationProviderId];

        if (!selectedProvider || typeof selectedProvider.translate !== 'function') {
            console.error(`Background: Invalid or missing translation provider: ${currentTranslationProviderId}`);
            sendResponse({
                error: "Translation failed",
                details: `Selected translation provider "${currentTranslationProviderId}" is not configured correctly.`,
                originalText: sourceText,
                cueStart: cueStart,
                cueVideoId: cueVideoId
            });
            return true;
        }

        selectedProvider.translate(sourceText, sourceLang, targetLang)
            .then(translatedText => {
                sendResponse({
                    translatedText: translatedText,
                    originalText: sourceText,
                    cueStart: cueStart,
                    cueVideoId: cueVideoId
                });
            })
            .catch(error => {
                console.error(`Background: Translation failed using provider '${selectedProvider.name}':`, error);
                sendResponse({
                    error: "Translation failed",
                    details: error.message || `Error from ${selectedProvider.name}`,
                    originalText: sourceText,
                    cueStart: cueStart,
                    cueVideoId: cueVideoId
                });
            });
        return true; // Indicates an asynchronous response.
    } else if (message.action === "fetchVTT") {
        const vttMasterUrl = message.url;
        console.log("Background: Received fetchVTT request for Master URL:", vttMasterUrl);
        fetchAndProcessSubtitleUrl(vttMasterUrl)
            .then(vttText => {
                console.log("Background: Successfully fetched and processed VTT content. Final length:", vttText?.length);
                sendResponse({ success: true, vttText: vttText, videoId: message.videoId, url: vttMasterUrl });
            })
            .catch(error => {
                console.error("Background: Failed to fetch/process VTT content for URL:", vttMasterUrl, error);
                sendResponse({ success: false, error: `VTT Processing Error: ${error.message}`, videoId: message.videoId, url: vttMasterUrl });
            });
        return true;
    } else if (message.action === "changeProvider") {
        const newProviderId = message.providerId;
        if (translationProviders[newProviderId]) {
            currentTranslationProviderId = newProviderId;
            chrome.storage.sync.set({ selectedProvider: newProviderId }, () => {
                console.log(`Background: Translation provider changed to: ${translationProviders[currentTranslationProviderId].name}`);
                sendResponse({ success: true, message: `Provider changed to ${translationProviders[currentTranslationProviderId].name}` });
            });
        } else {
            console.error(`Background: Attempted to switch to unknown provider: ${newProviderId}`);
            sendResponse({ success: false, message: `Unknown provider: ${newProviderId}` });
        }
        return true; // For async response
    }
});

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync') {
        for (let [key, { oldValue, newValue }] of Object.entries(changes)) {
            console.log(
                `Background: Storage key "${key}" changed.`,
                `Old value:`, oldValue, `, New value:`, newValue
            );
        }
    }
});
