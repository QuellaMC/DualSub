import fs from 'node:fs';
import vm from 'node:vm';

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

    test.each([
        ['missing script tag', null],
        ['missing fragment', ''],
        ['wrong platform', `#dualsub-channel=netflix.${CHANNEL_CAPABILITY}`],
        [
            'uppercase capability',
            `#dualsub-channel=disneyplus.${'A'.repeat(64)}`,
        ],
        ['short capability', '#dualsub-channel=disneyplus.abc123'],
        [
            'extra fragment data',
            `#dualsub-channel=disneyplus.${CHANNEL_CAPABILITY}&extra=true`,
        ],
    ])('installs no hooks or events for %s', (_label, fragment) => {
        const parserBefore = JSON.parse;
        if (fragment === null) {
            document.getElementById(INJECT_SCRIPT_TAG_ID)?.remove();
            Object.defineProperty(document, 'currentScript', {
                configurable: true,
                value: null,
            });
        } else {
            installInjectorScriptTag(fragment);
        }

        window.eval(injectorSource);

        expect(JSON.parse).toBe(parserBefore);
        expect(window.disneyPlusDualSubInjectorLoaded).toBeUndefined();
        expect(window.disneyPlusDualSubPlaybackBridge).toBeUndefined();
        expect(injectorEvents).toHaveLength(0);
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

    test.each([
        ['wrong script id', { id: 'wrong-injector-tag' }],
        [
            'HTTPS source',
            {
                source: `https://example.com/injected_scripts/disneyPlusInject.js#dualsub-channel=disneyplus.${CHANNEL_CAPABILITY}`,
            },
        ],
        [
            'wrong extension path',
            {
                source: `chrome-extension://test-extension/wrong.js#dualsub-channel=disneyplus.${CHANNEL_CAPABILITY}`,
            },
        ],
        [
            'query-bearing source',
            {
                source: `chrome-extension://test-extension/injected_scripts/disneyPlusInject.js?x=1#dualsub-channel=disneyplus.${CHANNEL_CAPABILITY}`,
            },
        ],
    ])(
        'rejects %s without poisoning a later valid install',
        (_label, options) => {
            const parserBefore = JSON.parse;
            installInjectorScriptTag(undefined, options);

            window.eval(injectorSource);

            expect(JSON.parse).toBe(parserBefore);
            expect(window.disneyPlusDualSubInjectorLoaded).toBeUndefined();
            expect(injectorEvents).toHaveLength(0);

            installInjectorScriptTag();
            window.eval(injectorSource);
            expect(window.disneyPlusDualSubInjectorLoaded).toBe(true);
            expect(JSON.parse).not.toBe(parserBefore);
        }
    );

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

    test('rejects wrong, stale, extra, accessor, inherited, and hostile control authority without invoking getters', () => {
        const player = document.createElement('disney-web-player-ui');
        player.mediaPlayerApi = {
            timeline: { info: { playheadPositionMs: 1200 } },
            mediaPlaybackCriteria: {
                metadata: { availId: 'authority-avail' },
                telemetryParameters: {
                    conviva: {
                        metadata: { playbackSessionId: 'authority-session' },
                    },
                },
            },
        };
        document.body.appendChild(player);
        const addEventListenerSpy = jest.spyOn(document, 'addEventListener');
        const capabilityGetter = jest.fn(() => CHANNEL_CAPABILITY);
        const channelGetter = jest.fn(() => createChannelAuthority());
        const proxyGetter = jest.fn(() => CHANNEL_CAPABILITY);

        try {
            window.eval(injectorSource);
            const bridgeListener = addEventListenerSpy.mock.calls.find(
                ([type]) => type === INJECT_EVENT_ID
            )?.[1];
            expect(typeof bridgeListener).toBe('function');
            injectorEvents.length = 0;

            const accessorChannel = { platform: 'disneyplus' };
            Object.defineProperty(accessorChannel, 'capability', {
                enumerable: true,
                get: capabilityGetter,
            });
            const accessorDetail = {
                type: 'REQUEST_PLAYBACK_TIMELINE',
            };
            Object.defineProperty(accessorDetail, 'dualsubChannel', {
                enumerable: true,
                get: channelGetter,
            });
            const inheritedChannel = Object.create(createChannelAuthority());
            const inheritedDetail = Object.create({
                dualsubChannel: createChannelAuthority(),
            });
            inheritedDetail.type = 'REQUEST_PLAYBACK_TIMELINE';
            const hostileChannel = new Proxy(createChannelAuthority(), {
                getPrototypeOf() {
                    throw new Error('hostile proxy');
                },
                get(_target, property) {
                    proxyGetter(property);
                    return CHANNEL_CAPABILITY;
                },
            });
            const invalidDetails = [
                createControlDetail(
                    'REQUEST_PLAYBACK_TIMELINE',
                    'b'.repeat(64)
                ),
                createControlDetail('REQUEST_PLAYBACK_TIMELINE', 'ABC123'),
                {
                    ...createControlDetail('REQUEST_PLAYBACK_TIMELINE'),
                    extra: true,
                },
                {
                    type: 'REQUEST_PLAYBACK_TIMELINE',
                    dualsubChannel: {
                        ...createChannelAuthority(),
                        extra: true,
                    },
                },
                {
                    type: 'REQUEST_PLAYBACK_TIMELINE',
                    dualsubChannel: accessorChannel,
                },
                accessorDetail,
                {
                    type: 'REQUEST_PLAYBACK_TIMELINE',
                    dualsubChannel: inheritedChannel,
                },
                inheritedDetail,
                {
                    type: 'REQUEST_PLAYBACK_TIMELINE',
                    dualsubChannel: hostileChannel,
                },
            ];

            for (const detail of invalidDetails) {
                bridgeListener({ detail });
            }

            expect(injectorEvents).toHaveLength(0);
            expect(capabilityGetter).not.toHaveBeenCalled();
            expect(channelGetter).not.toHaveBeenCalled();
            expect(proxyGetter).not.toHaveBeenCalled();

            bridgeListener({
                detail: createControlDetail('REQUEST_PLAYBACK_TIMELINE'),
            });
            expect(injectorEvents).toHaveLength(1);
            expect(injectorEvents[0]).toEqual(
                expect.objectContaining({
                    type: 'PLAYBACK_TIMELINE_UPDATE',
                    dualsubChannel: createChannelAuthority(),
                })
            );
            expect(Object.isFrozen(injectorEvents[0])).toBe(true);
            expect(Object.isFrozen(injectorEvents[0].dualsubChannel)).toBe(
                true
            );
        } finally {
            addEventListenerSpy.mockRestore();
        }
    });

    test('accepts an exact control detail created in a foreign isolated realm', () => {
        const player = document.createElement('disney-web-player-ui');
        player.mediaPlayerApi = {
            timeline: { info: { playheadPositionMs: 2400 } },
            mediaPlaybackCriteria: {
                metadata: { availId: 'foreign-avail' },
                telemetryParameters: {
                    conviva: {
                        metadata: { playbackSessionId: 'foreign-session' },
                    },
                },
            },
        };
        document.body.appendChild(player);
        window.eval(injectorSource);
        injectorEvents.length = 0;
        const detail = vm.runInNewContext(
            `({
                type: 'REQUEST_PLAYBACK_TIMELINE',
                dualsubChannel: {
                    platform: 'disneyplus',
                    capability: '${CHANNEL_CAPABILITY}'
                }
            })`
        );

        document.dispatchEvent(new CustomEvent(INJECT_EVENT_ID, { detail }));

        expect(
            injectorEvents.filter(
                ({ type }) => type === 'PLAYBACK_TIMELINE_UPDATE'
            )
        ).toEqual([
            expect.objectContaining({
                type: 'PLAYBACK_TIMELINE_UPDATE',
                programTimeSeconds: 2.4,
                dualsubChannel: createChannelAuthority(),
            }),
        ]);
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
