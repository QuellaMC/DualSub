(() => {
    const INJECT_SCRIPT_ID = 'disneyplus-dualsub-injector-event'; // Must match disneyPlusPlatform.js
    const INJECT_SCRIPT_TAG_ID = 'disneyplus-dualsub-injector-script-tag';
    const CHANNEL_PLATFORM = 'disneyplus';
    const CHANNEL_FRAGMENT_PATTERN =
        /^#dualsub-channel=disneyplus\.([0-9a-f]{64})$/u;
    const MAX_SCRIPT_URL_CODE_UNITS = 4096;
    const CONTROL_TYPES = new Set([
        'REQUEST_PLAYBACK_TIMELINE',
        'PLAYBACK_BRIDGE_RESUME',
        'PLAYBACK_BRIDGE_PAUSE',
    ]);
    const DETAIL_KEYS = new Set(['dualsubChannel', 'type']);
    const CHANNEL_KEYS = new Set(['capability', 'platform']);
    const ORDINARY_OBJECT_PROTOTYPE_KEYS = new Set(
        Reflect.ownKeys(Object.prototype)
    );
    const PLAYBACK_POLL_INTERVAL_MS = 300;
    const PLAYBACK_HEARTBEAT_MS = 1200;
    const nativeCustomEventDetailGetter =
        typeof CustomEvent === 'function'
            ? Object.getOwnPropertyDescriptor(CustomEvent.prototype, 'detail')
                  ?.get
            : null;

    const isOrdinaryRecordPrototype = (prototype) => {
        if (prototype === null || prototype === Object.prototype) return true;
        try {
            if (Object.getPrototypeOf(prototype) !== null) return false;
            const keys = Reflect.ownKeys(prototype);
            if (keys.length !== ORDINARY_OBJECT_PROTOTYPE_KEYS.size) {
                return false;
            }
            for (const key of keys) {
                if (!ORDINARY_OBJECT_PROTOTYPE_KEYS.has(key)) return false;
                const descriptor = Object.getOwnPropertyDescriptor(
                    prototype,
                    key
                );
                if (!descriptor || descriptor.enumerable) return false;
                if (key === 'constructor') {
                    if (
                        !Object.hasOwn(descriptor, 'value') ||
                        typeof descriptor.value !== 'function'
                    ) {
                        return false;
                    }
                    const nameDescriptor = Object.getOwnPropertyDescriptor(
                        descriptor.value,
                        'name'
                    );
                    if (
                        !nameDescriptor ||
                        !Object.hasOwn(nameDescriptor, 'value') ||
                        nameDescriptor.value !== 'Object'
                    ) {
                        return false;
                    }
                }
            }
            return true;
        } catch (_) {
            return false;
        }
    };

    const inspectExactDataRecord = (value, allowedKeys) => {
        try {
            if (
                value === null ||
                typeof value !== 'object' ||
                Array.isArray(value)
            ) {
                return null;
            }
            if (!isOrdinaryRecordPrototype(Object.getPrototypeOf(value))) {
                return null;
            }

            const keys = Reflect.ownKeys(value);
            if (keys.length !== allowedKeys.size) return null;
            const snapshot = Object.create(null);
            for (const key of keys) {
                if (typeof key !== 'string' || !allowedKeys.has(key)) {
                    return null;
                }
                const descriptor = Object.getOwnPropertyDescriptor(value, key);
                if (
                    !descriptor ||
                    !descriptor.enumerable ||
                    !Object.hasOwn(descriptor, 'value')
                ) {
                    return null;
                }
                snapshot[key] = descriptor.value;
            }
            return snapshot;
        } catch (_) {
            return null;
        }
    };

    const readEventDetail = (event) => {
        if (
            event === null ||
            (typeof event !== 'object' && typeof event !== 'function')
        ) {
            return null;
        }
        try {
            const descriptor = Object.getOwnPropertyDescriptor(event, 'detail');
            if (descriptor) {
                return Object.hasOwn(descriptor, 'value')
                    ? descriptor.value
                    : null;
            }
        } catch (_) {
            return null;
        }
        if (typeof nativeCustomEventDetailGetter !== 'function') return null;
        try {
            return nativeCustomEventDetailGetter.call(event);
        } catch (_) {
            return null;
        }
    };

    const readCapabilityFromScriptTag = () => {
        try {
            const script = document.currentScript;
            if (!script || script.localName !== 'script') return null;
            if (script.getAttribute('id') !== INJECT_SCRIPT_TAG_ID) return null;
            const source = script.getAttribute('src');
            if (
                typeof source !== 'string' ||
                source.length === 0 ||
                source.length > MAX_SCRIPT_URL_CODE_UNITS
            ) {
                return null;
            }
            const parsedUrl = new URL(source);
            if (
                parsedUrl.protocol !== 'chrome-extension:' ||
                parsedUrl.username !== '' ||
                parsedUrl.password !== '' ||
                parsedUrl.port !== '' ||
                parsedUrl.search !== '' ||
                parsedUrl.pathname !== '/injected_scripts/disneyPlusInject.js'
            ) {
                return null;
            }
            const match = CHANNEL_FRAGMENT_PATTERN.exec(parsedUrl.hash);
            return match ? match[1] : null;
        } catch (_) {
            return null;
        }
    };

    const capability = readCapabilityFromScriptTag();
    if (!capability) return;

    const createChannelAuthority = () =>
        Object.freeze({
            platform: CHANNEL_PLATFORM,
            capability,
        });
    const createAuthorizedDetail = (type, fields = null) =>
        Object.freeze({
            type,
            ...(fields || {}),
            dualsubChannel: createChannelAuthority(),
        });
    const readAuthorizedControlType = (event) => {
        const detail = inspectExactDataRecord(
            readEventDetail(event),
            DETAIL_KEYS
        );
        if (!detail || !CONTROL_TYPES.has(detail.type)) return null;
        const channel = inspectExactDataRecord(
            detail.dualsubChannel,
            CHANNEL_KEYS
        );
        if (
            !channel ||
            channel.platform !== CHANNEL_PLATFORM ||
            channel.capability !== capability
        ) {
            return null;
        }
        return detail.type;
    };

    if (window.disneyPlusDualSubInjectorLoaded) {
        const bridge = window.disneyPlusDualSubPlaybackBridge;
        if (bridge?.matchesCapability?.(capability)) {
            console.log(
                'Disney+ Inject script: Already loaded, skipping initialization.'
            );
            bridge.announceReady?.();
        }
        return;
    }

    window.disneyPlusDualSubInjectorLoaded = true;

    console.log('Disney+ Inject script: Starting execution.');

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
        let generation = 0;
        let isPolling = false;
        let isTerminal = false;
        let sequence = 0;
        let lastSignature = null;
        let lastDispatchAt = 0;

        const dispatchPlaybackState = (
            force = false,
            expectedGeneration = generation,
            allowPaused = false
        ) => {
            if (
                isTerminal ||
                expectedGeneration !== generation ||
                (!allowPaused && !isPolling)
            ) {
                return;
            }
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
                        detail: createAuthorizedDetail(
                            'PLAYBACK_TIMELINE_UPDATE',
                            {
                                ...state,
                                sequence: ++sequence,
                            }
                        ),
                    })
                );
            } catch (_) {}
        };

        const handlePlaybackStateRequest = (event) => {
            const type = readAuthorizedControlType(event);
            if (type === 'REQUEST_PLAYBACK_TIMELINE') {
                dispatchPlaybackState(true, generation, true);
            } else if (type === 'PLAYBACK_BRIDGE_RESUME') {
                resumePolling();
            } else if (type === 'PLAYBACK_BRIDGE_PAUSE') {
                pausePolling();
            }
        };

        const resumePolling = () => {
            if (isTerminal) return;
            if (isPolling && pollTimer !== null) return;

            isPolling = true;
            const pollingGeneration = ++generation;
            pollTimer = window.setInterval(
                () => dispatchPlaybackState(false, pollingGeneration),
                PLAYBACK_POLL_INTERVAL_MS
            );
            dispatchPlaybackState(true, pollingGeneration);
        };

        const pausePolling = () => {
            if (isTerminal) return;
            isPolling = false;
            generation += 1;
            if (pollTimer !== null) {
                window.clearInterval(pollTimer);
                pollTimer = null;
            }
        };

        const announceReady = () => {
            if (isTerminal) return;
            try {
                document.dispatchEvent(
                    new CustomEvent(INJECT_SCRIPT_ID, {
                        detail: createAuthorizedDetail('INJECT_SCRIPT_READY'),
                    })
                );
            } catch (_) {}
        };

        const cleanup = () => {
            if (isTerminal) return;
            pausePolling();
            isTerminal = true;
            generation += 1;
            document.removeEventListener(
                INJECT_SCRIPT_ID,
                handlePlaybackStateRequest
            );
        };

        document.addEventListener(INJECT_SCRIPT_ID, handlePlaybackStateRequest);

        return {
            announceReady,
            cleanup,
            matchesCapability(value) {
                return value === capability;
            },
        };
    };

    window.disneyPlusDualSubPlaybackBridge = createPlaybackBridge();

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
                console.log('[Disney+ Inject] Found subtitle data.');

                const videoId = getCurrentVideoId();
                console.log('[Disney+ Inject] Associated video identifier.');

                document.dispatchEvent(
                    new CustomEvent(INJECT_SCRIPT_ID, {
                        detail: createAuthorizedDetail('SUBTITLE_URL_FOUND', {
                            url: subtitleUrl,
                            videoId: videoId,
                            source: sourcePath,
                        }),
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
    window.disneyPlusDualSubPlaybackBridge.announceReady();
    console.log('Disney+ Inject script: Dispatched INJECT_SCRIPT_READY event.');
})();
