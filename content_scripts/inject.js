// disneyplus-dualsub-chrome-extension/content_scripts/inject.js
console.log("Inject script: Starting execution (v6 - direct extraction as per report).");

const INJECT_SCRIPT_ID = 'disneyplus-dualsub-injector-event'; // Must match content.js
const originalJSONParse = JSON.parse;

console.log("Inject script: About to override JSON.parse (v6).");

JSON.parse = function (text, reviver) {
    let parsedObject;
    try {
        parsedObject = originalJSONParse(text, reviver);
    } catch (e) {
        throw e;
    }

    try {
        // Path for Disney+ subtitle master playlist URL (M3U8)
        if (parsedObject &&
            parsedObject.data &&
            parsedObject.data.stream &&
            parsedObject.data.stream.sources &&
            Array.isArray(parsedObject.data.stream.sources) &&
            parsedObject.data.stream.sources.length > 0 &&
            parsedObject.data.stream.sources[0] &&
            parsedObject.data.stream.sources[0].complete &&
            parsedObject.data.stream.sources[0].complete.url) {

            const subtitleUrl = parsedObject.data.stream.sources[0].complete.url;
            console.log("%c[Inject v6] Found Disney+ URL (data.stream.sources[0].complete.url): %s", "color: blue; font-weight: bold;", subtitleUrl);

            // Extract Video ID from current page URL
            const pathSegments = window.location.pathname.split('/');
            let videoId = 'unknown_video_' + Date.now(); // Fallback with timestamp
            const videoIndex = pathSegments.indexOf('video');
            if (videoIndex !== -1 && videoIndex < pathSegments.length - 1) {
                const potentialId = pathSegments[videoIndex + 1];
                if (potentialId && potentialId.length > 10) { // Simple length check
                    videoId = potentialId;
                }
            }
            console.log("[Inject v6] Associated Video ID from URL:", videoId);

            document.dispatchEvent(new CustomEvent(INJECT_SCRIPT_ID, {
                detail: {
                    type: 'SUBTITLE_URL_FOUND',
                    url: subtitleUrl,
                    videoId: videoId,
                    source: 'data.stream.sources[0].complete.url'
                }
            }));
            console.log("[Inject v6] Dispatched SUBTITLE_URL_FOUND event with the above URL and Video ID.");
        }
        // Add other potential paths if Disney+ changes its JSON structure
        else if (parsedObject &&
            parsedObject.stream &&
            parsedObject.stream.sources &&
            Array.isArray(parsedObject.stream.sources) &&
            parsedObject.stream.sources.length > 0 &&
            parsedObject.stream.sources[0] &&
            parsedObject.stream.sources[0].complete &&
            parsedObject.stream.sources[0].complete.url) {

            const subtitleUrl = parsedObject.stream.sources[0].complete.url;
            console.log("%c[Inject v6] Found Disney+ URL (parsedObject.stream.sources[0].complete.url): %s", "color: blue; font-weight: bold;", subtitleUrl);
            
            const pathSegments = window.location.pathname.split('/');
            let videoId = 'unknown_video_' + Date.now();
            const videoIndex = pathSegments.indexOf('video');
            if (videoIndex !== -1 && videoIndex < pathSegments.length - 1) {
                 const potentialId = pathSegments[videoIndex + 1];
                 if (potentialId && potentialId.length > 10) videoId = potentialId;
            }
            console.log("[Inject v6] Associated Video ID from URL:", videoId);

            document.dispatchEvent(new CustomEvent(INJECT_SCRIPT_ID, {
                detail: {
                    type: 'SUBTITLE_URL_FOUND',
                    url: subtitleUrl,
                    videoId: videoId,
                    source: 'parsedObject.stream.sources[0].complete.url'
                }
            }));
            console.log("[Inject v6] Dispatched SUBTITLE_URL_FOUND event (alternate path).");
        }


    } catch (e) {
        // Do not log error for every JSON.parse to avoid console spam.
        // console.error('[Inject v6] Error inspecting JSON object for subtitles:', e, 'Parsed object (if available):', parsedObject);
    }
    return parsedObject; // Always return the original parsed object
};

console.log("Inject script: JSON.parse overridden (v6).");

// Dispatch an event to let the content script know the inject script is ready
document.dispatchEvent(new CustomEvent(INJECT_SCRIPT_ID, { detail: { type: 'INJECT_SCRIPT_READY' } }));
console.log("Inject script: Dispatched INJECT_SCRIPT_READY event (v6).");
