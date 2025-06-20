import { translate as googleTranslate } from './translation_providers/googleTranslate.js';
import { translate as microsoftTranslateEdgeAuth } from './translation_providers/microsoftTranslateEdgeAuth.js';
import { translate as deeplTranslate } from './translation_providers/deeplTranslate.js';
import { normalizeLanguageCode } from './utils/languageNormalization.js';

console.log("Dual Subtitles background script loaded.");

const translationProviders = {
    'google': {
        name: 'Google Translate (Free)',
        translate: googleTranslate
    },
    'microsoft_edge_auth': {
        name: 'Microsoft Translate (Free)',
        translate: microsoftTranslateEdgeAuth
    },
    'deepl': {
        name: 'DeepL Translate',
        translate: deeplTranslate
    }
};

let currentTranslationProviderId = 'google';

chrome.storage.sync.get('selectedProvider', (data) => {
    if (data.selectedProvider && translationProviders[data.selectedProvider]) {
        currentTranslationProviderId = data.selectedProvider;
    } else {
        chrome.storage.sync.set({ selectedProvider: currentTranslationProviderId });
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
            chrome.storage.sync.set(defaultsToSet);
        }
    });
});

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
    
    const isForcedTrack = (lang) => {
        return lang.displayName?.toLowerCase().includes('forced') || 
               lang.displayName?.toLowerCase().includes('--forced--') ||
               lang.rawCode?.toLowerCase().includes('forced') ||
               lang.uri?.toLowerCase().includes('forced') ||
               lang.uri?.toLowerCase().includes('_forced_');
    };
    
    const selectBestMatch = (matches) => {
        if (matches.length === 0) return null;
        if (matches.length === 1) return matches[0];
        
        const normalTracks = matches.filter(match => !isForcedTrack(match));
        if (normalTracks.length > 0) {
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
    
    let matches = availableLanguages.filter(lang => lang.normalizedCode === targetLangCode);
    if (matches.length > 0) {
        return selectBestMatch(matches);
    }
    
    matches = availableLanguages.filter(lang => lang.rawCode === targetLangCode);
    if (matches.length > 0) {
        return selectBestMatch(matches);
    }
    
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

async function processNetflixSubtitleData(data, targetLanguage = 'zh-CN', originalLanguage = 'en', useNativeSubtitles = true) {
    if (!data || !data.tracks) {
        throw new Error("Invalid Netflix subtitle data provided");
    }
    
    const timedtexttracks = data.tracks;
    const availableLanguages = [];
    
    const validTracks = timedtexttracks.filter(track => 
        !track.isNoneTrack && !track.isForcedNarrative
    );
    
    function getBestTrackForLanguage(tracks, langCode) {
        const matchingTracks = tracks.filter(track => {
            const trackLangCode = normalizeLanguageCode(track.language);
            return trackLangCode === langCode;
        });
        
        if (matchingTracks.length === 0) return null;
        
        const primaryTrack = matchingTracks.find(track => track.trackType === 'PRIMARY');
        if (primaryTrack) {
            return primaryTrack;
        }
        
        const assistiveTrack = matchingTracks.find(track => track.trackType === 'ASSISTIVE');
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
        
        if (track.ttDownloadables && typeof track.ttDownloadables === 'object' && !Array.isArray(track.ttDownloadables)) {
            downloadables = track.ttDownloadables;
        }
        else if (track.rawTrack?.ttDownloadables) {
            downloadables = track.rawTrack.ttDownloadables;
        }
        
        if (downloadables) {
            const formats = Object.keys(downloadables);
            for (const format of formats) {
                const formatData = downloadables[format];
                if (formatData && Array.isArray(formatData.urls) && formatData.urls.length > 0) {
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
                displayName: track.displayName || track.rawTrack?.languageDescription || rawLangCode,
                uri: downloadUrl,
                trackType: track.trackType,
                isForcedNarrative: track.isForcedNarrative || false,
                track: track
            });
        }
    }
    
    if (availableLanguages.length === 0) {
        throw new Error("No downloadable subtitle tracks found in Netflix data");
    }
    
    let targetLanguageInfo = null;
    let originalLanguageInfo = null;
    let useNativeTarget = false;
    
    // Step 1: Try to find native target language if enabled
    if (useNativeSubtitles && targetLanguage) {
        targetLanguageInfo = getBestTrackForLanguage(validTracks, targetLanguage);
        if (targetLanguageInfo) {
            targetLanguageInfo = availableLanguages.find(lang => 
                lang.track === targetLanguageInfo
            );
            
            if (targetLanguageInfo) {
                useNativeTarget = true;
                console.log(`Background: ✅ Netflix native target found: ${targetLanguage} (${targetLanguageInfo.displayName})`);
            }
        } else {
            console.log(`Background: ❌ Netflix native target NOT found for: ${targetLanguage}. Will use translation mode.`);
        }
    } else {
        console.log(`Background: Native subtitles disabled or no target language specified. Will use translation mode.`);
    }
    
    // Step 2: Find original language track
    if (originalLanguage && !originalLanguageInfo) {
        const originalTrack = getBestTrackForLanguage(validTracks, originalLanguage);
        if (originalTrack) {
            originalLanguageInfo = availableLanguages.find(lang => 
                lang.track === originalTrack
            );
            if (originalLanguageInfo) {
                console.log(`Background: ✅ Netflix original language found: ${originalLanguage} (${originalLanguageInfo.displayName})`);
            }
        } else {
            console.log(`Background: ❌ Netflix original language NOT found: ${originalLanguage}. Trying English fallback...`);
            const englishTrack = getBestTrackForLanguage(validTracks, 'en');
            if (englishTrack) {
                originalLanguageInfo = availableLanguages.find(lang => 
                    lang.track === englishTrack
                );
                if (originalLanguageInfo) {
                    console.log(`Background: ✅ Netflix English fallback found: (${originalLanguageInfo.displayName})`);
                }
            }
        }
    }
    
    // Step 3: Final fallback to first available language
    if (!originalLanguageInfo && availableLanguages.length > 0) {
        originalLanguageInfo = availableLanguages[0];
        console.log(`Background: ⚠️ Netflix using first available language as last resort: ${originalLanguageInfo.normalizedCode} (${originalLanguageInfo.displayName})`);
    }
    
    if (!originalLanguageInfo) {
        throw new Error("No suitable Netflix subtitle language found");
    }
    
    console.log(`Background: 🎬 Netflix processing mode - useNativeTarget: ${useNativeTarget}, originalLang: ${originalLanguageInfo.normalizedCode}, targetLang: ${targetLanguage || 'none'}`);
    
    // Step 4: Fetch and process original language subtitles
    console.log(`Background: 📥 Fetching Netflix original language subtitles from: ${originalLanguageInfo.uri.substring(0, 100)}...`);
    const originalSubtitleText = await fetchText(originalLanguageInfo.uri);
    console.log(`Background: 📄 Netflix original subtitle raw size: ${originalSubtitleText.length} characters`);
    
    let originalVttText;
    if (originalSubtitleText.trim().startsWith('<?xml') || originalSubtitleText.includes('<tt')) {
        console.log(`Background: 🔄 Netflix original subtitle detected as TTML, converting...`);
        originalVttText = convertTtmlToVtt(originalSubtitleText);
        console.log(`Background: ✅ Netflix original TTML converted to VTT (${originalVttText.length} chars)`);
        
        // Count cues in original
        const originalCueCount = (originalVttText.match(/\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}/g) || []).length;
        console.log(`Background: 📊 Netflix original VTT contains ${originalCueCount} cues`);
    } else if (originalSubtitleText.trim().toUpperCase().startsWith("WEBVTT")) {
        originalVttText = originalSubtitleText;
        console.log(`Background: ✅ Netflix original VTT loaded directly (${originalVttText.length} chars)`);
        const originalCueCount = (originalVttText.match(/\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}/g) || []).length;
        console.log(`Background: 📊 Netflix original VTT contains ${originalCueCount} cues`);
    } else {
        console.error(`Background: ❌ Netflix original subtitle format not recognized. First 200 chars: ${originalSubtitleText.substring(0, 200)}`);
        throw new Error("Netflix subtitle format not recognized (not TTML or VTT)");
    }
    
    // Step 5: Fetch target language subtitles only if using native target
    let targetVttText = null;
    if (useNativeTarget && targetLanguageInfo) {
        console.log(`Background: 📥 Fetching Netflix native target subtitles from: ${targetLanguageInfo.uri.substring(0, 100)}...`);
        const targetSubtitleText = await fetchText(targetLanguageInfo.uri);
        console.log(`Background: 📄 Netflix target subtitle raw size: ${targetSubtitleText.length} characters`);
        
        if (targetSubtitleText.trim().startsWith('<?xml') || targetSubtitleText.includes('<tt')) {
            console.log(`Background: 🔄 Netflix target subtitle detected as TTML, converting...`);
            targetVttText = convertTtmlToVtt(targetSubtitleText);
            console.log(`Background: ✅ Netflix target TTML converted to VTT (${targetVttText.length} chars)`);
            
            // Count cues in target and compare timing
            const targetCueCount = (targetVttText.match(/\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}/g) || []).length;
            const originalCueCount = (originalVttText.match(/\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}/g) || []).length;
            console.log(`Background: 📊 Netflix target VTT contains ${targetCueCount} cues vs ${originalCueCount} original cues`);
            
            if (targetCueCount !== originalCueCount) {
                console.warn(`Background: ⚠️  Netflix subtitle cue count mismatch! This may cause synchronization issues.`);
                console.log(`Background: 🔍 First 3 original timings:`);
                const originalTimings = originalVttText.match(/\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}/g) || [];
                originalTimings.slice(0, 3).forEach((timing, i) => console.log(`Background: 🕐 Original ${i+1}: ${timing}`));
                
                console.log(`Background: 🔍 First 3 target timings:`);
                const targetTimings = targetVttText.match(/\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}/g) || [];
                targetTimings.slice(0, 3).forEach((timing, i) => console.log(`Background: 🕐 Target ${i+1}: ${timing}`));
            } else {
                console.log(`Background: ✅ Netflix original and target subtitle cue counts match perfectly`);
            }
        } else if (targetSubtitleText.trim().toUpperCase().startsWith("WEBVTT")) {
            targetVttText = targetSubtitleText;
            console.log(`Background: ✅ Netflix target VTT loaded directly (${targetVttText.length} chars)`);
            const targetCueCount = (targetVttText.match(/\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}/g) || []).length;
            const originalCueCount = (originalVttText.match(/\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}/g) || []).length;
            console.log(`Background: 📊 Netflix target VTT contains ${targetCueCount} cues vs ${originalCueCount} original cues`);
        } else {
            console.error(`Background: ❌ Netflix target subtitle format not recognized. First 200 chars: ${targetSubtitleText.substring(0, 200)}`);
            throw new Error("Netflix target subtitle format not recognized");
        }
    } else {
        console.log(`Background: 🔄 Netflix will use translation mode for target language: ${targetLanguage || 'none'}`);
    }
    
    const result = {
        vttText: originalVttText,
        targetVttText: targetVttText,
        sourceLanguage: originalLanguageInfo.normalizedCode,
        targetLanguage: useNativeTarget ? targetLanguageInfo.normalizedCode : targetLanguage, // Pass through target language for translation
        useNativeTarget: useNativeTarget,
        availableLanguages: availableLanguages,
        url: originalLanguageInfo.uri,
        selectedLanguage: originalLanguageInfo
    };
    
    console.log(`Background: ✅ Netflix processing complete. Mode: ${useNativeTarget ? 'Native' : 'Translation'}, Original: ${result.sourceLanguage}, Target: ${result.targetLanguage}`);
    return result;
}

// Simple TTML to VTT converter for Netflix subtitles (service worker compatible)
function convertTtmlToVtt(ttmlText) {
    console.log("Background: 🔄 Starting TTML to VTT conversion...");
    console.log("Background: 📄 TTML input length:", ttmlText.length, "characters");
    
    let vtt = "WEBVTT\n\n";

    try {
        // Step 1: Parse region layouts to get their x/y coordinates
        console.log("Background: 🎯 Step 1: Parsing region layouts...");
        const regionLayouts = new Map();
        const regionRegex = /<region\s+xml:id="([^"]+)"[^>]*\s+tts:origin="([^"]+)"/gi;
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
                console.log(`Background: 📍 Region ${regionId}: x=${x}, y=${y}`);
            }
        }
        console.log(`Background: ✅ Found ${regionCount} regions with layout info`);

        // Step 2: Parse all <p> tags into an intermediate structure, including their region
        console.log("Background: 🎯 Step 2: Parsing <p> elements...");
        const intermediateCues = [];
        const pElementRegex = /<p[^>]*\s+begin="([^"]+)"[^>]*\s+end="([^"]+)"[^>]*\s+region="([^"]+)"[^>]*>([\s\S]*?)<\/p>/gi;
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
                console.log(`Background: 📝 Cue ${pElementCount}: ${begin}-${end} [${region}] "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
            } else if (pElementCount === 6) {
                console.log("Background: 📝 ... (showing first 5 cues only)");
            }
        }
        console.log(`Background: ✅ Parsed ${pElementCount} <p> elements into ${intermediateCues.length} intermediate cues`);

        if (intermediateCues.length === 0) {
            console.error("Background: ❌ No valid TTML subtitle entries found");
            throw new Error("No valid TTML subtitle entries found");
        }

        // Step 3: Group cues by their timestamp
        console.log("Background: 🎯 Step 3: Grouping cues by timestamp...");
        const groupedByTime = new Map();
        for (const cue of intermediateCues) {
            const key = `${cue.begin}-${cue.end}`;
            if (!groupedByTime.has(key)) {
                groupedByTime.set(key, []);
            }
            groupedByTime.get(key).push(cue);
        }
        console.log(`Background: ✅ Grouped into ${groupedByTime.size} unique time segments`);
        
        // Log some examples of grouped cues
        let exampleCount = 0;
        for (const [key, group] of groupedByTime.entries()) {
            if (exampleCount < 3) {
                console.log(`Background: 📊 Time segment "${key}": ${group.length} cue(s) - regions: [${group.map(c => c.region).join(', ')}]`);
                exampleCount++;
            } else if (exampleCount === 3) {
                console.log("Background: 📊 ... (showing first 3 time segments only)");
                break;
            }
        }
        
        // Step 4: For each group, sort by position and merge into a final cue
        console.log("Background: 🎯 Step 4: Sorting by position and merging...");
        const finalCues = [];
        let mergedCount = 0;
        for (const [key, group] of groupedByTime.entries()) {
            // Sort the group based on region position (top-to-bottom, then left-to-right)
            group.sort((a, b) => {
                const regionA = regionLayouts.get(a.region) || { y: 999, x: 999 };
                const regionB = regionLayouts.get(b.region) || { y: 999, x: 999 };

                // Primary sort: Y-coordinate (top to bottom)
                if (regionA.y < regionB.y) return -1;
                if (regionA.y > regionB.y) return 1;

                // Secondary sort: X-coordinate (left to right)
                if (regionA.x < regionB.x) return -1;
                if (regionA.x > regionB.x) return 1;
                
                return 0;
            });
            
            // Merge the text of the now-sorted group
            const mergedText = group.map(cue => cue.text).join(' ').trim();
            
            const [begin, end] = key.split('-');
            finalCues.push({
                begin,
                end,
                text: mergedText
            });
            
            mergedCount++;
            if (mergedCount <= 3) {
                console.log(`Background: 🔗 Merged ${group.length} cue(s) into: "${mergedText.substring(0, 80)}${mergedText.length > 80 ? '...' : ''}"`);
            } else if (mergedCount === 4) {
                console.log("Background: 🔗 ... (showing first 3 merged cues only)");
            }
        }
        console.log(`Background: ✅ Created ${finalCues.length} final merged cues`);

        // Step 5: Sort the final, merged cues by start time and build the VTT string
        console.log("Background: 🎯 Step 5: Sorting by time and building VTT...");
        finalCues.sort((a, b) => parseInt(a.begin) - parseInt(b.begin));
        
        let vttCueCount = 0;
        for (const cue of finalCues) {
            const startTime = convertTtmlTimeToVtt(cue.begin);
            const endTime = convertTtmlTimeToVtt(cue.end);
            
            vtt += `${startTime} --> ${endTime}\n`;
            vtt += `${cue.text}\n\n`;
            vttCueCount++;
            
            if (vttCueCount <= 3) {
                console.log(`Background: ⏱️  VTT Cue ${vttCueCount}: ${startTime} --> ${endTime} | "${cue.text.substring(0, 60)}${cue.text.length > 60 ? '...' : ''}"`);
            } else if (vttCueCount === 4) {
                console.log("Background: ⏱️  ... (showing first 3 VTT cues only)");
            }
        }
        
        console.log(`Background: ✅ TTML to VTT conversion complete!`);
        console.log(`Background: 📊 Final stats: ${finalCues.length} cues, ${vtt.length} characters`);
        console.log(`Background: 🎬 Time range: ${finalCues.length > 0 ? `${convertTtmlTimeToVtt(finalCues[0].begin)} to ${convertTtmlTimeToVtt(finalCues[finalCues.length - 1].end)}` : 'N/A'}`);
        
        return vtt;

    } catch (error) {
        console.error("Background: ❌ Error converting TTML to VTT:", error);
        console.error("Background: 🔍 TTML sample (first 500 chars):", ttmlText.substring(0, 500));
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
            return true;
        }

        case "fetchVTT": {
            if (message.source === 'netflix') {
                const { data, videoId, targetLanguage, originalLanguage, useNativeSubtitles } = message;
                
                processNetflixSubtitleData(data, targetLanguage, originalLanguage, useNativeSubtitles)
                    .then(result => {
                        sendResponse({ 
                            success: true, 
                            vttText: result.vttText, 
                            targetVttText: result.targetVttText,
                            videoId, 
                            url: result.url,
                            sourceLanguage: result.sourceLanguage,
                            targetLanguage: result.targetLanguage,
                            useNativeTarget: result.useNativeTarget,
                            availableLanguages: result.availableLanguages
                        });
                    })
                    .catch(error => {
                        console.error("Background: Failed to process Netflix VTT for videoId:", videoId, error);
                        sendResponse({ success: false, error: `Netflix VTT Processing Error: ${error.message}`, videoId });
                    });
            } else {
                const { url, videoId, targetLanguage, originalLanguage } = message;
                fetchAndProcessSubtitleUrl(url, targetLanguage, originalLanguage)
                    .then(result => {
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
            }
            return true;
        }

        case "changeProvider": {
            const newProviderId = message.providerId;
            if (translationProviders[newProviderId]) {
                currentTranslationProviderId = newProviderId;
                chrome.storage.sync.set({ selectedProvider: newProviderId }, () => {
                    const providerName = translationProviders[currentTranslationProviderId].name;
                    sendResponse({ success: true, message: `Provider changed to ${providerName}` });
                });
            } else {
                console.error(`Background: Attempted to switch to unknown provider: ${newProviderId}`);
                sendResponse({ success: false, message: `Unknown provider: ${newProviderId}` });
            }
            return true;
        }
    }
    return false;
});

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync') {
        for (let [key, { newValue }] of Object.entries(changes)) {
            if (key === 'selectedProvider' && translationProviders[newValue]) {
                currentTranslationProviderId = newValue;
            }
        }
    }
});
