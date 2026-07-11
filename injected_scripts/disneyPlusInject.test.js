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

describe('Disney+ page injector lifecycle', () => {
    let originalJsonParse;
    let subtitleEvents;
    let injectorEvents;
    let eventHandler;

    beforeEach(() => {
        originalJsonParse = JSON.parse;
        document.body.replaceChildren();
        subtitleEvents = [];
        injectorEvents = [];
        eventHandler = (event) => {
            injectorEvents.push(event.detail);
            if (event.detail?.type === 'SUBTITLE_URL_FOUND') {
                subtitleEvents.push(event.detail);
            }
        };
        document.addEventListener(
            'disneyplus-dualsub-injector-event',
            eventHandler
        );
        window.history.replaceState(
            {},
            '',
            '/play/0123456789abcdef0123456789abcdef'
        );
        delete window.disneyPlusDualSubInjectorLoaded;
        jest.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        JSON.parse = originalJsonParse;
        window.disneyPlusDualSubPlaybackBridge?.cleanup?.();
        delete window.disneyPlusDualSubPlaybackBridge;
        delete window.disneyPlusDualSubInjectorLoaded;
        document.removeEventListener(
            'disneyplus-dualsub-injector-event',
            eventHandler
        );
        document.body.replaceChildren();
        window.history.replaceState({}, '', '/');
    });

    test('remains single-installed across SPA reinjection and uses a stable play ID', () => {
        window.eval(injectorSource);
        const installedParser = JSON.parse;
        window.eval(injectorSource);

        expect(JSON.parse).toBe(installedParser);

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
        expect(subtitleEvents[0].videoId).toBe(
            '0123456789abcdef0123456789abcdef'
        );
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
            new CustomEvent('disneyplus-dualsub-injector-event', {
                detail: { type: 'REQUEST_PLAYBACK_TIMELINE' },
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
            new CustomEvent('disneyplus-dualsub-injector-event', {
                detail: { type: 'REQUEST_PLAYBACK_TIMELINE' },
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
            new CustomEvent('disneyplus-dualsub-injector-event', {
                detail: { type: 'REQUEST_PLAYBACK_TIMELINE' },
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
});
