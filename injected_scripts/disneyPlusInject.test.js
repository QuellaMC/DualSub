import fs from 'node:fs';

import {
    afterEach,
    beforeEach,
    describe,
    expect,
    jest,
    test,
} from '@jest/globals';

const injectorSource = fs.readFileSync(
    new URL('./disneyPlusInject.js', import.meta.url),
    'utf8'
);
const consoleMethods = ['log', 'error', 'warn', 'info', 'debug'];
const INJECT_EVENT_ID = 'disneyplus-dualsub-injector-event';
const INJECT_SCRIPT_TAG_ID = 'disneyplus-dualsub-injector-script-tag';
const CHANNEL_CAPABILITY = 'a'.repeat(64);

function createChannelAuthority(capability = CHANNEL_CAPABILITY) {
    return {
        platform: 'disneyplus',
        capability,
    };
}

function createControlDetail(type, capability = CHANNEL_CAPABILITY) {
    return {
        type,
        dualsubChannel: createChannelAuthority(capability),
    };
}

function installInjectorScriptTag(
    fragment = `#dualsub-channel=disneyplus.${CHANNEL_CAPABILITY}`,
    {
        id = INJECT_SCRIPT_TAG_ID,
        source = `chrome-extension://test-extension/injected_scripts/disneyPlusInject.js${fragment}`,
    } = {}
) {
    document.getElementById(INJECT_SCRIPT_TAG_ID)?.remove();
    const script = document.createElement('script');
    script.id = id;
    script.src = source;
    Object.defineProperty(document, 'currentScript', {
        configurable: true,
        value: script,
    });
    return script;
}

describe('Disney+ page injector lifecycle', () => {
    let originalJsonParse;
    let subtitleEvents;
    let injectorEvents;
    let eventHandler;
    let consoleSpies;
    let originalCurrentScriptDescriptor;

    beforeEach(() => {
        originalJsonParse = JSON.parse;
        originalCurrentScriptDescriptor = Object.getOwnPropertyDescriptor(
            document,
            'currentScript'
        );
        document.body.replaceChildren();
        subtitleEvents = [];
        injectorEvents = [];
        eventHandler = (event) => {
            injectorEvents.push(event.detail);
            if (event.detail?.type === 'SUBTITLE_URL_FOUND') {
                subtitleEvents.push(event.detail);
            }
        };
        document.addEventListener(INJECT_EVENT_ID, eventHandler);
        window.history.replaceState(
            {},
            '',
            '/play/0123456789abcdef0123456789abcdef'
        );
        delete window.disneyPlusDualSubInjectorLoaded;
        installInjectorScriptTag();
        consoleSpies = Object.fromEntries(
            consoleMethods.map((method) => [
                method,
                jest.spyOn(console, method).mockImplementation(() => {}),
            ])
        );
    });

    afterEach(() => {
        JSON.parse = originalJsonParse;
        window.disneyPlusDualSubPlaybackBridge?.cleanup?.();
        delete window.disneyPlusDualSubPlaybackBridge;
        delete window.disneyPlusDualSubInjectorLoaded;
        document.removeEventListener(INJECT_EVENT_ID, eventHandler);
        document.getElementById(INJECT_SCRIPT_TAG_ID)?.remove();
        if (originalCurrentScriptDescriptor) {
            Object.defineProperty(
                document,
                'currentScript',
                originalCurrentScriptDescriptor
            );
        } else {
            delete document.currentScript;
        }
        document.body.replaceChildren();
        window.history.replaceState({}, '', '/');
        Object.values(consoleSpies).forEach((spy) => spy.mockRestore());
    });

    test('remains single-installed across SPA reinjection and uses a stable play ID', () => {
        window.eval(injectorSource);
        const installedParser = JSON.parse;
        const firstReadyEvent = injectorEvents.find(
            ({ type }) => type === 'INJECT_SCRIPT_READY'
        );
        expect(firstReadyEvent?.dualsubChannel).toEqual(
            createChannelAuthority()
        );
        expect(Object.isFrozen(firstReadyEvent)).toBe(true);
        expect(Object.isFrozen(firstReadyEvent.dualsubChannel)).toBe(true);

        injectorEvents.length = 0;
        window.eval(injectorSource);

        expect(JSON.parse).toBe(installedParser);
        expect(injectorEvents).toEqual([
            {
                type: 'INJECT_SCRIPT_READY',
                dualsubChannel: createChannelAuthority(),
            },
        ]);

        JSON.parse(
            JSON.stringify({
                data: {
                    stream: {
                        sources: [
                            {
                                complete: {
                                    url: 'https://example.com/master.m3u8',
                                },
                            },
                        ],
                    },
                },
            })
        );

        expect(subtitleEvents).toHaveLength(1);
        expect(Object.isFrozen(subtitleEvents[0])).toBe(true);
        expect(Object.isFrozen(subtitleEvents[0].dualsubChannel)).toBe(true);
        expect(subtitleEvents[0].videoId).toBe(
            '0123456789abcdef0123456789abcdef'
        );
    });

    test('rejects invalid bootstrap state without poisoning a later valid install', () => {
        const parserBefore = JSON.parse;
        document.getElementById(INJECT_SCRIPT_TAG_ID)?.remove();
        Object.defineProperty(document, 'currentScript', {
            configurable: true,
            value: null,
        });

        window.eval(injectorSource);
        expect(JSON.parse).toBe(parserBefore);
        expect(window.disneyPlusDualSubInjectorLoaded).toBeUndefined();
        expect(injectorEvents).toHaveLength(0);

        installInjectorScriptTag(
            `#dualsub-channel=netflix.${CHANNEL_CAPABILITY}`
        );
        window.eval(injectorSource);
        expect(JSON.parse).toBe(parserBefore);

        installInjectorScriptTag(undefined, {
            source: `https://example.com/injected_scripts/disneyPlusInject.js#dualsub-channel=disneyplus.${CHANNEL_CAPABILITY}`,
        });
        window.eval(injectorSource);
        expect(JSON.parse).toBe(parserBefore);

        installInjectorScriptTag();
        window.eval(injectorSource);
        expect(window.disneyPlusDualSubInjectorLoaded).toBe(true);
        expect(JSON.parse).not.toBe(parserBefore);
    });

    test('keeps an already-installed bridge inert to a reinjection carrying an old token', () => {
        window.eval(injectorSource);
        const installedParser = JSON.parse;
        injectorEvents.length = 0;
        installInjectorScriptTag(
            `#dualsub-channel=disneyplus.${'b'.repeat(64)}`
        );

        window.eval(injectorSource);

        expect(JSON.parse).toBe(installedParser);
        expect(injectorEvents).toHaveLength(0);
    });

    test('does not treat declared preroll metadata as proof that it played', () => {
        window.eval(injectorSource);

        JSON.parse(
            JSON.stringify({
                stream: {
                    sources: [
                        {
                            complete: {
                                url: 'https://example.com/master.m3u8',
                            },
                        },
                    ],
                    insertion: {
                        mode: 'SGAI',
                        points: [
                            {
                                offset: 0,
                                placement: 'PREROLL',
                                content: [
                                    {
                                        type: 'AUXILIARY_CONTENT',
                                        subtype: 'BRAND_BUMPER',
                                        playoutRequired: true,
                                        duration: 3003,
                                    },
                                ],
                            },
                        ],
                    },
                },
            })
        );

        expect(subtitleEvents).toHaveLength(1);
        expect(subtitleEvents[0]).not.toHaveProperty(
            'programStartOffsetSeconds'
        );
        expect(
            injectorEvents.filter(
                ({ type }) => type === 'PLAYBACK_TIMELINE_UPDATE'
            )
        ).toHaveLength(0);
    });

    test('reports the live program clock and actual interstitial state on request', () => {
        const player = document.createElement('disney-web-player-ui');
        player.mediaPlayerApi = {
            timeline: {
                info: {
                    playheadPositionMs: 1084,
                },
            },
            mediaPlaybackCriteria: {
                metadata: {
                    availId: 'disney-avail-id',
                },
                telemetryParameters: {
                    conviva: {
                        metadata: {
                            playbackSessionId: 'playback-session-id',
                        },
                    },
                },
            },
        };
        const controls = document.createElement('main-app-controls-overlay');
        controls.store = {
            interstitials: {
                hasCurrentSession: false,
                isInterstitialPlaying: false,
                isBumper: false,
            },
        };
        document.body.append(player, controls);

        window.eval(injectorSource);
        injectorEvents.length = 0;
        document.dispatchEvent(
            new CustomEvent(INJECT_EVENT_ID, {
                detail: createControlDetail('REQUEST_PLAYBACK_TIMELINE'),
            })
        );

        expect(injectorEvents).toContainEqual(
            expect.objectContaining({
                type: 'PLAYBACK_TIMELINE_UPDATE',
                videoId: '0123456789abcdef0123456789abcdef',
                availId: 'disney-avail-id',
                playbackSessionId: 'playback-session-id',
                programTimeSeconds: 1.084,
                isInterstitialPlaying: false,
                isBumper: false,
            })
        );

        controls.store.interstitials = {
            hasCurrentSession: true,
            isInterstitialPlaying: true,
            isBumper: true,
        };
        document.dispatchEvent(
            new CustomEvent(INJECT_EVENT_ID, {
                detail: createControlDetail('REQUEST_PLAYBACK_TIMELINE'),
            })
        );

        expect(injectorEvents.at(-1)).toEqual(
            expect.objectContaining({
                type: 'PLAYBACK_TIMELINE_UPDATE',
                isInterstitialPlaying: true,
                isBumper: true,
            })
        );
    });

    test('does not turn an unavailable program playhead into zero', () => {
        const player = document.createElement('disney-web-player-ui');
        player.mediaPlayerApi = {
            timeline: {
                info: {
                    playheadPositionMs: null,
                },
            },
        };
        document.body.appendChild(player);

        window.eval(injectorSource);
        injectorEvents.length = 0;
        document.dispatchEvent(
            new CustomEvent(INJECT_EVENT_ID, {
                detail: createControlDetail('REQUEST_PLAYBACK_TIMELINE'),
            })
        );

        expect(
            injectorEvents.filter(
                ({ type }) => type === 'PLAYBACK_TIMELINE_UPDATE'
            )
        ).toHaveLength(0);
    });

    test('repeats an unchanged paused state as a sparse recovery heartbeat', () => {
        const player = document.createElement('disney-web-player-ui');
        player.mediaPlayerApi = {
            timeline: {
                info: {
                    playheadPositionMs: 5000,
                },
            },
            mediaPlaybackCriteria: {
                metadata: { availId: 'paused-avail' },
                telemetryParameters: {
                    conviva: {
                        metadata: { playbackSessionId: 'paused-session' },
                    },
                },
            },
        };
        document.body.appendChild(player);
        jest.useFakeTimers();

        try {
            window.eval(injectorSource);
            document.dispatchEvent(
                new CustomEvent(INJECT_EVENT_ID, {
                    detail: createControlDetail('PLAYBACK_BRIDGE_RESUME'),
                })
            );
            const playbackUpdates = () =>
                injectorEvents.filter(
                    ({ type }) => type === 'PLAYBACK_TIMELINE_UPDATE'
                );
            expect(playbackUpdates()).toHaveLength(1);

            jest.advanceTimersByTime(900);
            expect(playbackUpdates()).toHaveLength(1);

            jest.advanceTimersByTime(300);
            expect(playbackUpdates()).toHaveLength(2);
        } finally {
            window.disneyPlusDualSubPlaybackBridge?.cleanup?.();
            jest.useRealTimers();
        }
    });

    test('requires valid authority to resume or pause playback polling', () => {
        const player = document.createElement('disney-web-player-ui');
        player.mediaPlayerApi = {
            timeline: { info: { playheadPositionMs: 5000 } },
            mediaPlaybackCriteria: {
                metadata: { availId: 'control-avail' },
                telemetryParameters: {
                    conviva: {
                        metadata: { playbackSessionId: 'control-session' },
                    },
                },
            },
        };
        document.body.appendChild(player);
        jest.useFakeTimers();
        try {
            window.eval(injectorSource);
            document.dispatchEvent(
                new CustomEvent(INJECT_EVENT_ID, {
                    detail: { type: 'PLAYBACK_BRIDGE_RESUME' },
                })
            );
            document.dispatchEvent(
                new CustomEvent(INJECT_EVENT_ID, {
                    detail: createControlDetail(
                        'PLAYBACK_BRIDGE_RESUME',
                        'b'.repeat(64)
                    ),
                })
            );
            expect(jest.getTimerCount()).toBe(0);

            document.dispatchEvent(
                new CustomEvent(INJECT_EVENT_ID, {
                    detail: createControlDetail('PLAYBACK_BRIDGE_RESUME'),
                })
            );
            expect(jest.getTimerCount()).toBe(1);

            document.dispatchEvent(
                new CustomEvent(INJECT_EVENT_ID, {
                    detail: { type: 'PLAYBACK_BRIDGE_PAUSE' },
                })
            );
            document.dispatchEvent(
                new CustomEvent(INJECT_EVENT_ID, {
                    detail: createControlDetail(
                        'PLAYBACK_BRIDGE_PAUSE',
                        'b'.repeat(64)
                    ),
                })
            );
            expect(jest.getTimerCount()).toBe(1);

            document.dispatchEvent(
                new CustomEvent(INJECT_EVENT_ID, {
                    detail: createControlDetail('PLAYBACK_BRIDGE_PAUSE'),
                })
            );
            expect(jest.getTimerCount()).toBe(0);
        } finally {
            window.disneyPlusDualSubPlaybackBridge?.cleanup?.();
            jest.useRealTimers();
        }
    });

    test('pauses polling across player lifecycles and resumes exactly one inert-safe interval', () => {
        const player = document.createElement('disney-web-player-ui');
        player.mediaPlayerApi = {
            timeline: { info: { playheadPositionMs: 5000 } },
            mediaPlaybackCriteria: {
                metadata: { availId: 'lifecycle-avail' },
                telemetryParameters: {
                    conviva: {
                        metadata: {
                            playbackSessionId: 'lifecycle-session',
                        },
                    },
                },
            },
        };
        document.body.appendChild(player);
        jest.useFakeTimers();
        const intervalSpy = jest.spyOn(window, 'setInterval');
        const addEventListenerSpy = jest.spyOn(document, 'addEventListener');

        try {
            window.eval(injectorSource);
            const bridgeListener = addEventListenerSpy.mock.calls.find(
                ([type]) => type === 'disneyplus-dualsub-injector-event'
            )?.[1];
            const playbackUpdates = () =>
                injectorEvents.filter(
                    ({ type }) => type === 'PLAYBACK_TIMELINE_UPDATE'
                );

            expect(jest.getTimerCount()).toBe(0);
            document.dispatchEvent(
                new CustomEvent(INJECT_EVENT_ID, {
                    detail: createControlDetail('PLAYBACK_BRIDGE_RESUME'),
                })
            );
            expect(jest.getTimerCount()).toBe(1);
            expect(playbackUpdates()).toHaveLength(1);
            const staleIntervalCallback = intervalSpy.mock.calls[0][0];

            document.dispatchEvent(
                new CustomEvent(INJECT_EVENT_ID, {
                    detail: createControlDetail('PLAYBACK_BRIDGE_RESUME'),
                })
            );
            expect(jest.getTimerCount()).toBe(1);

            document.dispatchEvent(
                new CustomEvent(INJECT_EVENT_ID, {
                    detail: createControlDetail('PLAYBACK_BRIDGE_PAUSE'),
                })
            );
            expect(jest.getTimerCount()).toBe(0);
            const pausedUpdateCount = playbackUpdates().length;
            staleIntervalCallback();
            expect(playbackUpdates()).toHaveLength(pausedUpdateCount);

            document.dispatchEvent(
                new CustomEvent(INJECT_EVENT_ID, {
                    detail: createControlDetail('PLAYBACK_BRIDGE_RESUME'),
                })
            );
            expect(jest.getTimerCount()).toBe(1);
            const resumedUpdateCount = playbackUpdates().length;
            staleIntervalCallback();
            expect(playbackUpdates()).toHaveLength(resumedUpdateCount);

            window.disneyPlusDualSubPlaybackBridge.cleanup();
            expect(jest.getTimerCount()).toBe(0);
            bridgeListener({
                detail: createControlDetail('PLAYBACK_BRIDGE_RESUME'),
            });
            expect(jest.getTimerCount()).toBe(0);
        } finally {
            addEventListenerSpy.mockRestore();
            intervalSpy.mockRestore();
            window.disneyPlusDualSubPlaybackBridge?.cleanup?.();
            jest.useRealTimers();
        }
    });

    test('reinjection preserves the paused state and never multiplies an active interval', () => {
        jest.useFakeTimers();
        try {
            window.eval(injectorSource);
            document.dispatchEvent(
                new CustomEvent(INJECT_EVENT_ID, {
                    detail: createControlDetail('PLAYBACK_BRIDGE_RESUME'),
                })
            );
            expect(jest.getTimerCount()).toBe(1);

            window.eval(injectorSource);
            expect(jest.getTimerCount()).toBe(1);

            document.dispatchEvent(
                new CustomEvent(INJECT_EVENT_ID, {
                    detail: createControlDetail('PLAYBACK_BRIDGE_PAUSE'),
                })
            );
            expect(jest.getTimerCount()).toBe(0);

            window.eval(injectorSource);
            expect(jest.getTimerCount()).toBe(0);
        } finally {
            window.disneyPlusDualSubPlaybackBridge?.cleanup?.();
            jest.useRealTimers();
        }
    });

    test('falls back to the root stream when a nested stream has no source URL', () => {
        window.eval(injectorSource);

        JSON.parse(
            JSON.stringify({
                data: { stream: {} },
                stream: {
                    sources: [
                        {
                            complete: {
                                url: 'https://example.com/root-master.m3u8',
                            },
                        },
                    ],
                },
            })
        );

        expect(subtitleEvents).toHaveLength(1);
        expect(subtitleEvents[0]).toEqual(
            expect.objectContaining({
                url: 'https://example.com/root-master.m3u8',
                source: 'stream.sources[0].complete.url',
            })
        );
    });

    test('keeps signed subtitle and video identifiers out of serialized console output', () => {
        const signedUrl =
            'https://media.example/master.m3u8?token=SIGNED_URL_QUERY_CANARY';
        const pathCanary = 'VIDEO_PATH_CANARY';
        window.history.replaceState(
            {},
            '',
            `/browse/${pathCanary}/%E7%A7%98%E5%AF%86`
        );
        const videoId = `unknown_video_${encodeURIComponent(window.location.pathname)}`;
        window.eval(injectorSource);

        JSON.parse(
            JSON.stringify({
                data: {
                    stream: {
                        sources: [{ complete: { url: signedUrl } }],
                    },
                },
            })
        );

        expect(subtitleEvents).toContainEqual({
            type: 'SUBTITLE_URL_FOUND',
            url: signedUrl,
            videoId,
            source: 'data.stream.sources[0].complete.url',
            dualsubChannel: createChannelAuthority(),
        });

        const consoleArguments = Object.values(consoleSpies).flatMap((spy) =>
            spy.mock.calls.flat()
        );
        expect(consoleArguments.length).toBeGreaterThan(0);
        for (const argument of consoleArguments) {
            expect(typeof argument).toBe('string');
            expect(argument).not.toContain('SIGNED_URL_QUERY_CANARY');
            expect(argument).not.toContain(pathCanary);
            expect(argument).not.toContain(
                encodeURIComponent(window.location.pathname)
            );
            expect(argument).not.toContain(CHANNEL_CAPABILITY);
        }
    });
});
