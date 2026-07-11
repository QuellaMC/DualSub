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
    let eventHandler;

    beforeEach(() => {
        originalJsonParse = JSON.parse;
        subtitleEvents = [];
        eventHandler = (event) => {
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
        delete window.disneyPlusDualSubInjectorLoaded;
        document.removeEventListener(
            'disneyplus-dualsub-injector-event',
            eventHandler
        );
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

    test('reports required auxiliary preroll duration as the program start offset', () => {
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
        expect(subtitleEvents[0].programStartOffsetSeconds).toBeCloseTo(3.003);
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
