if (window.disneyPlusDualSubInjectorLoaded) {
    console.log(
        'Disney+ Inject script: Already loaded, skipping initialization.'
    );
    window.disneyPlusDualSubPlaybackBridge?.ensurePolling?.();
} else {
    window.disneyPlusDualSubInjectorLoaded = true;

    console.log('Disney+ Inject script: Starting execution.');

    const INJECT_SCRIPT_ID = 'disneyplus-dualsub-injector-event'; // Must match disneyPlusPlatform.js
    const PLAYBACK_POLL_INTERVAL_MS = 300;
    const PLAYBACK_HEARTBEAT_MS = 1200;
    const originalJSONParse = JSON.parse;

    const getCurrentVideoId = () => {
        const pathSegments = window.location.pathname.split('/');
        const fallbackPath = window.location.pathname || 'unknown';
        const videoIndex = pathSegments.findIndex(
            (segment) => segment === 'video' || segment === 'play'
        );
        if (videoIndex !== -1 && videoIndex < pathSegments.length - 1) {
            const potentialId = pathSegments[videoIndex + 1];
            if (potentialId) return potentialId;
        }

        return `unknown_video_${encodeURIComponent(fallbackPath)}`;
    };

    const readPlaybackTimelineState = () => {
        try {
            const playerApi = document.querySelector(
                'disney-web-player-ui'
            )?.mediaPlayerApi;
            const playheadPositionMs =
                playerApi?.timeline?.info?.playheadPositionMs;
            if (
                typeof playheadPositionMs !== 'number' ||
                !Number.isFinite(playheadPositionMs) ||
                playheadPositionMs < 0
            ) {
                return null;
            }

            const playbackCriteria = playerApi?.mediaPlaybackCriteria;
            const availId = playbackCriteria?.metadata?.availId;
            const playbackSessionId =
                playbackCriteria?.telemetryParameters?.conviva?.metadata
                    ?.playbackSessionId ||
                playerApi?.telemetryParameters?.conviva?.metadata
                    ?.playbackSessionId;
            const interstitials = document.querySelector(
                'main-app-controls-overlay'
            )?.store?.interstitials;

            return {
                videoId: getCurrentVideoId(),
                availId:
                    typeof availId === 'string' && availId ? availId : null,
                playbackSessionId:
                    typeof playbackSessionId === 'string' && playbackSessionId
                        ? playbackSessionId
                        : null,
                programTimeSeconds: playheadPositionMs / 1000,
                isInterstitialPlaying:
                    typeof interstitials?.isInterstitialPlaying === 'boolean'
                        ? interstitials.isInterstitialPlaying
                        : null,
                isBumper:
                    typeof interstitials?.isBumper === 'boolean'
                        ? interstitials.isBumper
                        : null,
            };
        } catch (_) {
            return null;
        }
    };

    const createPlaybackBridge = () => {
        let pollTimer = null;
        let sequence = 0;
        let lastSignature = null;
        let lastDispatchAt = 0;

        const dispatchPlaybackState = (force = false) => {
            const state = readPlaybackTimelineState();
            if (!state) return;

            const signature = JSON.stringify(state);
            const now = Date.now();
            if (
                !force &&
                signature === lastSignature &&
                now - lastDispatchAt < PLAYBACK_HEARTBEAT_MS
            ) {
                return;
            }
            lastSignature = signature;
            lastDispatchAt = now;

            try {
                document.dispatchEvent(
                    new CustomEvent(INJECT_SCRIPT_ID, {
                        detail: {
                            type: 'PLAYBACK_TIMELINE_UPDATE',
                            ...state,
                            sequence: ++sequence,
                        },
                    })
                );
            } catch (_) {}
        };

        const handlePlaybackStateRequest = (event) => {
            if (event.detail?.type === 'REQUEST_PLAYBACK_TIMELINE') {
                dispatchPlaybackState(true);
            }
        };

        const ensurePolling = () => {
            if (pollTimer === null) {
                pollTimer = window.setInterval(
                    dispatchPlaybackState,
                    PLAYBACK_POLL_INTERVAL_MS
                );
            }
            dispatchPlaybackState(true);
        };

        const cleanup = () => {
            if (pollTimer !== null) {
                window.clearInterval(pollTimer);
                pollTimer = null;
            }
            document.removeEventListener(
                INJECT_SCRIPT_ID,
                handlePlaybackStateRequest
            );
        };

        document.addEventListener(INJECT_SCRIPT_ID, handlePlaybackStateRequest);

        return { ensurePolling, cleanup };
    };

    window.disneyPlusDualSubPlaybackBridge = createPlaybackBridge();
    window.disneyPlusDualSubPlaybackBridge.ensurePolling();

    console.log(
        'Disney+ Inject script: Overriding JSON.parse to intercept subtitle data.'
    );

    JSON.parse = function (text, reviver) {
        let parsedObject;
        parsedObject = originalJSONParse(text, reviver);

        try {
            let subtitleUrl = null;
            let sourcePath = '';
            const nestedStream = parsedObject?.data?.stream;
            const rootStream = parsedObject?.stream;

            // Standard path for Disney+ subtitle master playlist URL (M3U8)
            if (nestedStream?.sources?.[0]?.complete?.url) {
                subtitleUrl = nestedStream.sources[0].complete.url;
                sourcePath = 'data.stream.sources[0].complete.url';
            } else if (rootStream?.sources?.[0]?.complete?.url) {
                subtitleUrl = rootStream.sources[0].complete.url;
                sourcePath = 'stream.sources[0].complete.url';
            }

            if (subtitleUrl) {
                console.log(
                    `%c[Disney+ Inject] Found Disney+ subtitle URL via ${sourcePath}: %s`,
                    'color: blue; font-weight: bold;',
                    subtitleUrl
                );

                const videoId = getCurrentVideoId();
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
}
