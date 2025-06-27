// injected_scripts/netflixInject.js

// Guard against multiple script executions
if (window.netflixDualSubInjectorLoaded) {
    console.log(
        'Netflix Inject script: Already loaded, skipping initialization.'
    );
} else {
    window.netflixDualSubInjectorLoaded = true;

    console.log('Netflix Inject script: Starting execution.');

    const INJECT_EVENT_ID = 'netflix-dualsub-injector-event'; // Must match netflixPlatform.js
    const originalJSONParse = JSON.parse;

    console.log(
        'Netflix Inject script: Overriding JSON.parse to intercept subtitle data.'
    );

    JSON.parse = function (text, reviver) {
        let parsedObject;
        parsedObject = originalJSONParse(text, reviver);

        try {
            // Look for the specific structure of Netflix subtitle data
            if (
                parsedObject &&
                parsedObject.result &&
                parsedObject.result.timedtexttracks &&
                parsedObject.result.movieId
            ) {
                console.log(
                    `%c[Netflix Inject] Found Netflix subtitle data for movieId: %s`,
                    'color: blue; font-weight: bold;',
                    parsedObject.result.movieId
                );

                // Dispatch event using the same pattern as Disney+
                document.dispatchEvent(
                    new CustomEvent(INJECT_EVENT_ID, {
                        detail: {
                            type: 'SUBTITLE_DATA_FOUND',
                            payload: {
                                movieId: parsedObject.result.movieId,
                                timedtexttracks:
                                    parsedObject.result.timedtexttracks,
                            },
                        },
                    })
                );
                console.log(
                    '[Netflix Inject] Dispatched SUBTITLE_DATA_FOUND event.'
                );
            }
        } catch (e) {
            // Do not log error for every JSON.parse to avoid console spam.
            // console.error('[Netflix Inject] Error inspecting JSON object for subtitles:', e);
        }
        return parsedObject; // Always return the original parsed object
    };

    console.log('Netflix Inject script: JSON.parse has been overridden.');

    // Dispatch an event to let the content script know the inject script is ready
    document.dispatchEvent(
        new CustomEvent(INJECT_EVENT_ID, {
            detail: { type: 'INJECT_SCRIPT_READY' },
        })
    );
    console.log('Netflix Inject script: Dispatched INJECT_SCRIPT_READY event.');
}
