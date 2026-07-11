if (window.disneyPlusDualSubInjectorLoaded) {
    console.log(
        'Disney+ Inject script: Already loaded, skipping initialization.'
    );
} else {
    window.disneyPlusDualSubInjectorLoaded = true;

    console.log('Disney+ Inject script: Starting execution.');

    const INJECT_SCRIPT_ID = 'disneyplus-dualsub-injector-event'; // Must match disneyPlusPlatform.js
    const originalJSONParse = JSON.parse;

    const getProgramStartOffsetSeconds = (stream) => {
        const insertionPoints = stream?.insertion?.points;
        if (!Array.isArray(insertionPoints)) return null;

        let durationMillis = 0;
        for (const point of insertionPoints) {
            if (
                point?.placement !== 'PREROLL' ||
                Number(point?.offset) !== 0 ||
                !Array.isArray(point.content)
            ) {
                continue;
            }

            for (const content of point.content) {
                const duration = Number(content?.duration);
                if (
                    content?.type === 'AUXILIARY_CONTENT' &&
                    content?.playoutRequired === true &&
                    Number.isFinite(duration) &&
                    duration > 0
                ) {
                    durationMillis += duration;
                }
            }
        }

        // Disney's playback response reports insertion durations in milliseconds.
        return durationMillis / 1000;
    };

    console.log(
        'Disney+ Inject script: Overriding JSON.parse to intercept subtitle data.'
    );

    JSON.parse = function (text, reviver) {
        let parsedObject;
        parsedObject = originalJSONParse(text, reviver);

        try {
            let subtitleUrl = null;
            let sourcePath = '';
            let stream = null;
            const nestedStream = parsedObject?.data?.stream;
            const rootStream = parsedObject?.stream;

            // Standard path for Disney+ subtitle master playlist URL (M3U8)
            if (nestedStream?.sources?.[0]?.complete?.url) {
                stream = nestedStream;
                subtitleUrl = nestedStream.sources[0].complete.url;
                sourcePath = 'data.stream.sources[0].complete.url';
            } else if (rootStream?.sources?.[0]?.complete?.url) {
                stream = rootStream;
                subtitleUrl = rootStream.sources[0].complete.url;
                sourcePath = 'stream.sources[0].complete.url';
            }

            if (subtitleUrl) {
                const programStartOffsetSeconds =
                    getProgramStartOffsetSeconds(stream);
                console.log(
                    `%c[Disney+ Inject] Found Disney+ subtitle URL via ${sourcePath}: %s`,
                    'color: blue; font-weight: bold;',
                    subtitleUrl
                );

                // Extract Video ID from current page URL
                const pathSegments = window.location.pathname.split('/');
                const fallbackPath = window.location.pathname || 'unknown';
                let videoId = `unknown_video_${encodeURIComponent(fallbackPath)}`;
                const videoIndex = pathSegments.findIndex(
                    (segment) => segment === 'video' || segment === 'play'
                );
                if (videoIndex !== -1 && videoIndex < pathSegments.length - 1) {
                    const potentialId = pathSegments[videoIndex + 1];
                    if (potentialId) {
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
                            ...(programStartOffsetSeconds !== null
                                ? { programStartOffsetSeconds }
                                : {}),
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
}
