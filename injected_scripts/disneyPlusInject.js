console.log('Disney+ Inject script: Starting execution.');

const INJECT_SCRIPT_ID = 'disneyplus-dualsub-injector-event'; // Must match disneyPlusPlatform.js
const originalJSONParse = JSON.parse;

console.log(
    'Disney+ Inject script: Overriding JSON.parse to intercept subtitle data.'
);

JSON.parse = function (text, reviver) {
    let parsedObject;
    parsedObject = originalJSONParse(text, reviver);

    try {
        let subtitleUrl = null;
        let sourcePath = '';

        // Standard path for Disney+ subtitle master playlist URL (M3U8)
        if (parsedObject?.data?.stream?.sources?.[0]?.complete?.url) {
            subtitleUrl = parsedObject.data.stream.sources[0].complete.url;
            sourcePath = 'data.stream.sources[0].complete.url';
        }
        // Fallback path if the structure changes
        else if (parsedObject?.stream?.sources?.[0]?.complete?.url) {
            subtitleUrl = parsedObject.stream.sources[0].complete.url;
            sourcePath = 'stream.sources[0].complete.url';
        }

        if (subtitleUrl) {
            console.log(
                `%c[Disney+ Inject] Found Disney+ subtitle URL via ${sourcePath}: %s`,
                'color: blue; font-weight: bold;',
                subtitleUrl
            );

            // Extract Video ID from current page URL
            const pathSegments = window.location.pathname.split('/');
            let videoId = 'unknown_video_' + Date.now(); // Fallback with timestamp
            const videoIndex = pathSegments.indexOf('video');
            if (videoIndex !== -1 && videoIndex < pathSegments.length - 1) {
                const potentialId = pathSegments[videoIndex + 1];
                if (potentialId && potentialId.length > 10) {
                    // Simple length check
                    videoId = potentialId;
                }
            }
            console.log(
                '[Disney+ Inject] Associated Video ID from URL:',
                videoId
            );

            document.dispatchEvent(
                new CustomEvent(INJECT_SCRIPT_ID, {
                    detail: {
                        type: 'SUBTITLE_URL_FOUND',
                        url: subtitleUrl,
                        videoId: videoId,
                        source: sourcePath,
                    },
                })
            );
            console.log(
                '[Disney+ Inject] Dispatched SUBTITLE_URL_FOUND event.'
            );
        }
    } catch (e) {
        // Do not log error for every JSON.parse to avoid console spam.
        // console.error('[Disney+ Inject] Error inspecting JSON object for subtitles:', e);
    }
    return parsedObject; // Always return the original parsed object
};

console.log('Disney+ Inject script: JSON.parse has been overridden.');

// Dispatch an event to let the content script know the inject script is ready
document.dispatchEvent(
    new CustomEvent(INJECT_SCRIPT_ID, {
        detail: { type: 'INJECT_SCRIPT_READY' },
    })
);
console.log('Disney+ Inject script: Dispatched INJECT_SCRIPT_READY event.');
