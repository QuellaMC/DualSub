import { jest } from '@jest/globals';
import {
    TextDecoder as NodeTextDecoder,
    TextEncoder as NodeTextEncoder,
} from 'node:util';
import { fetchAuthorizedSubtitleText } from './subtitleFetch.js';
import { authorizeSubtitleRequest } from './subtitleRequestPolicy.js';
import {
    MessageActions,
    SubtitleRequestSources,
} from '../../content_scripts/shared/constants/messageActions.js';

const TEST_EXTENSION_ID = 'dualsub-subtitle-fetch-test';
const DISNEY_PAGE_URL = 'https://www.disneyplus.com/video/episode-123';
const DISNEY_SUBTITLE_URL =
    'https://captions.media.dssott.com/show/master.m3u8';
const NETFLIX_PAGE_URL = 'https://www.netflix.com/watch/80123456';
const NETFLIX_SUBTITLE_URL = 'https://captions.nflxvideo.net/show/en.ttml';

function createDisneySnapshot() {
    return authorizeSubtitleRequest(
        {
            action: MessageActions.FETCH_VTT,
            source: SubtitleRequestSources.DISNEY_PLUS,
            url: DISNEY_SUBTITLE_URL,
            videoId: 'episode-123',
            targetLanguage: 'zh-CN',
            originalLanguage: 'en',
        },
        {
            id: TEST_EXTENSION_ID,
            tab: { id: 17, url: DISNEY_PAGE_URL },
            frameId: 0,
            url: DISNEY_PAGE_URL,
            origin: new URL(DISNEY_PAGE_URL).origin,
        }
    );
}

function createNetflixSnapshot() {
    return authorizeSubtitleRequest(
        {
            action: MessageActions.FETCH_VTT,
            source: SubtitleRequestSources.NETFLIX,
            data: {
                tracks: [
                    {
                        language: 'en',
                        displayName: 'English',
                        trackType: 'PRIMARY',
                        isNoneTrack: false,
                        isForcedNarrative: false,
                        ttDownloadables: {
                            dfxp: { urls: [{ url: NETFLIX_SUBTITLE_URL }] },
                        },
                    },
                ],
            },
            videoId: '80123456',
            targetLanguage: 'zh-CN',
            originalLanguage: 'en',
            useNativeSubtitles: true,
            useOfficialTranslations: false,
        },
        {
            id: TEST_EXTENSION_ID,
            tab: { id: 23, url: NETFLIX_PAGE_URL },
            frameId: 0,
            url: NETFLIX_PAGE_URL,
            origin: new URL(NETFLIX_PAGE_URL).origin,
        }
    );
}

function createFetchedResponse(text, url, overrides = {}) {
    const bytes = new NodeTextEncoder().encode(text);
    let delivered = false;
    return {
        ok: true,
        url,
        redirected: false,
        headers: { get: jest.fn(() => null) },
        body: {
            getReader: jest.fn(() => ({
                read: jest.fn(async () => {
                    if (delivered) return { done: true, value: undefined };
                    delivered = true;
                    return { done: false, value: bytes };
                }),
                cancel: jest.fn(),
                releaseLock: jest.fn(),
            })),
            cancel: jest.fn(),
        },
        ...overrides,
    };
}

function expectErrorToExclude(error, ...sensitiveValues) {
    const rendered = [
        error?.message,
        String(error),
        error?.stack,
        JSON.stringify(error),
    ].join('\n');

    for (const sensitiveValue of sensitiveValues) {
        expect(rendered).not.toContain(sensitiveValue);
    }
    for (const property of ['cause', 'input', 'url', 'reason']) {
        expect(Object.hasOwn(error, property)).toBe(false);
    }
}

describe('fetchAuthorizedSubtitleText', () => {
    const originalChrome = globalThis.chrome;
    const originalFetch = globalThis.fetch;
    const originalTextDecoder = globalThis.TextDecoder;

    beforeEach(() => {
        globalThis.chrome = { runtime: { id: TEST_EXTENSION_ID } };
        globalThis.TextDecoder = NodeTextDecoder;
        globalThis.fetch = jest.fn((input) =>
            Promise.resolve(createFetchedResponse('WEBVTT', input))
        );
    });

    afterEach(() => {
        if (originalChrome === undefined) delete globalThis.chrome;
        else globalThis.chrome = originalChrome;
        if (originalFetch === undefined) delete globalThis.fetch;
        else globalThis.fetch = originalFetch;
        globalThis.TextDecoder = originalTextDecoder;
    });

    test('returns bounded text from an authorized absolute Disney URL through the forced transport', async () => {
        const snapshot = createDisneySnapshot();
        const callerController = new AbortController();
        const response = createFetchedResponse('WEBVTT', DISNEY_SUBTITLE_URL);
        globalThis.fetch.mockResolvedValue(response);

        const result = await fetchAuthorizedSubtitleText(
            snapshot,
            DISNEY_SUBTITLE_URL,
            {
                stage: 'initial',
                signal: callerController.signal,
                maxBytes: 64,
            }
        );

        expect(result).toStrictEqual({
            text: 'WEBVTT',
            canonicalUrl: DISNEY_SUBTITLE_URL,
        });
        expect(Reflect.ownKeys(result).sort()).toEqual(
            ['canonicalUrl', 'text'].sort()
        );
        expect(typeof result.text).toBe('string');
        expect(typeof result.canonicalUrl).toBe('string');
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        const [input, init] = globalThis.fetch.mock.calls[0];
        expect(input).toBe(DISNEY_SUBTITLE_URL);
        expect(Reflect.ownKeys(init).sort()).toEqual(
            ['credentials', 'method', 'redirect', 'signal'].sort()
        );
        expect(init).toMatchObject({
            method: 'GET',
            redirect: 'follow',
            credentials: 'omit',
        });
        expect(init.signal).toBeInstanceOf(AbortSignal);
        expect(init.signal).not.toBe(callerController.signal);
        const reader = response.body.getReader.mock.results[0].value;
        expect(reader.cancel).not.toHaveBeenCalled();
        expect(reader.releaseLock).toHaveBeenCalledTimes(1);
        expect(response.body.cancel).not.toHaveBeenCalled();
    });

    test('follows a trusted Disney CDN redirect and carries the final edge URL into the next relative fetch', async () => {
        const snapshot = createDisneySnapshot();
        const requestedUrl = `${DISNEY_SUBTITLE_URL}?token=synthetic-master`;
        const finalUrl =
            'https://captions.dssedge.com/show/master.m3u8?token=synthetic-master';
        const segmentUrl =
            'https://captions.dssedge.com/show/segments/cue-1.vtt?token=synthetic-segment';
        globalThis.fetch
            .mockResolvedValueOnce(
                createFetchedResponse('PLAYLIST', finalUrl, {
                    redirected: true,
                })
            )
            .mockResolvedValueOnce(
                createFetchedResponse('SEGMENT', segmentUrl)
            );

        const playlist = await fetchAuthorizedSubtitleText(
            snapshot,
            requestedUrl,
            { stage: 'disney-master', maxBytes: 64 }
        );
        const segment = await fetchAuthorizedSubtitleText(
            snapshot,
            'segments/cue-1.vtt?token=synthetic-segment',
            {
                baseUrl: playlist.canonicalUrl,
                stage: 'segment',
                maxBytes: 64,
            }
        );

        expect(playlist).toStrictEqual({
            text: 'PLAYLIST',
            canonicalUrl: finalUrl,
        });
        expect(segment).toStrictEqual({
            text: 'SEGMENT',
            canonicalUrl: segmentUrl,
        });
        expect(globalThis.fetch.mock.calls.map(([input]) => input)).toEqual([
            requestedUrl,
            segmentUrl,
        ]);
        expect(
            globalThis.fetch.mock.calls.map(([, options]) => options.redirect)
        ).toEqual(['follow', 'follow']);
    });

    test('rejects a Disney redirect that lands on an unrelated host', async () => {
        const snapshot = createDisneySnapshot();
        const requestedUrl = `${DISNEY_SUBTITLE_URL}?token=synthetic-host`;
        const response = createFetchedResponse(
            'UNTRUSTED',
            'https://captions.attacker.test/show/master.m3u8?token=synthetic-host',
            { redirected: true }
        );
        globalThis.fetch.mockResolvedValue(response);

        await expect(
            fetchAuthorizedSubtitleText(snapshot, requestedUrl, {
                stage: 'disney-master',
                maxBytes: 64,
            })
        ).rejects.toMatchObject({
            name: 'SubtitleFetchError',
            code: 'ERR_SUBTITLE_FETCH_FINAL_URL',
        });
        expect(response.body.cancel).toHaveBeenCalledTimes(1);
        expect(response.body.getReader).not.toHaveBeenCalled();
    });

    test('rejects an allowed relative Disney child redirected to an unauthorized final authority', async () => {
        const snapshot = createDisneySnapshot();
        const baseUrl =
            'https://captions.media.dssott.com/show/tracks/en/index.m3u8?token=synthetic-base';
        const reference = 'cue-1.vtt?token=synthetic-child';
        const requestedUrl = new URL(reference, baseUrl).href;
        const response = createFetchedResponse(
            'UNTRUSTED',
            'https://captions.attacker.test/show/tracks/en/cue-1.vtt?token=synthetic-child',
            { redirected: true }
        );
        globalThis.fetch.mockResolvedValue(response);

        await expect(
            fetchAuthorizedSubtitleText(snapshot, reference, {
                baseUrl,
                stage: 'vtt-segment',
                maxBytes: 64,
            })
        ).rejects.toMatchObject({
            name: 'SubtitleFetchError',
            code: 'ERR_SUBTITLE_FETCH_FINAL_URL',
        });
        expect(globalThis.fetch).toHaveBeenCalledWith(
            requestedUrl,
            expect.objectContaining({
                redirect: 'follow',
                credentials: 'omit',
            })
        );
        expect(response.body.cancel).toHaveBeenCalledTimes(1);
        expect(response.body.getReader).not.toHaveBeenCalled();
    });

    test('rejects a trusted Disney CDN redirect that changes the canonical path', async () => {
        const snapshot = createDisneySnapshot();
        const requestedUrl = `${DISNEY_SUBTITLE_URL}?token=synthetic-path`;
        const response = createFetchedResponse(
            'CHANGED',
            'https://captions.dssedge.com/show/other.m3u8?token=synthetic-path',
            { redirected: true }
        );
        globalThis.fetch.mockResolvedValue(response);

        await expect(
            fetchAuthorizedSubtitleText(snapshot, requestedUrl, {
                stage: 'disney-master',
                maxBytes: 64,
            })
        ).rejects.toMatchObject({
            name: 'SubtitleFetchError',
            code: 'ERR_SUBTITLE_FETCH_FINAL_URL',
        });
        expect(response.body.cancel).toHaveBeenCalledTimes(1);
        expect(response.body.getReader).not.toHaveBeenCalled();
    });

    test('rejects a trusted Disney CDN redirect that changes the canonical query', async () => {
        const snapshot = createDisneySnapshot();
        const requestedUrl = `${DISNEY_SUBTITLE_URL}?token=synthetic-query`;
        const response = createFetchedResponse(
            'CHANGED',
            'https://captions.dssedge.com/show/master.m3u8?token=changed-query',
            { redirected: true }
        );
        globalThis.fetch.mockResolvedValue(response);

        await expect(
            fetchAuthorizedSubtitleText(snapshot, requestedUrl, {
                stage: 'disney-master',
                maxBytes: 64,
            })
        ).rejects.toMatchObject({
            name: 'SubtitleFetchError',
            code: 'ERR_SUBTITLE_FETCH_FINAL_URL',
        });
        expect(response.body.cancel).toHaveBeenCalledTimes(1);
        expect(response.body.getReader).not.toHaveBeenCalled();
    });

    test('resolves a Netflix relative reference through the branded policy before fetching text', async () => {
        const snapshot = createNetflixSnapshot();
        const baseUrl =
            'https://captions.nflxvideo.net/show/playlist/master.m3u8?token=base';
        const expectedUrl =
            'https://captions.nflxvideo.net/show/segments/en.vtt?token=derived';

        const result = await fetchAuthorizedSubtitleText(
            snapshot,
            '../segments/en.vtt?token=derived#ignored',
            { baseUrl, stage: 'segment', maxBytes: 64 }
        );

        expect(result).toStrictEqual({
            text: 'WEBVTT',
            canonicalUrl: expectedUrl,
        });
        expect(typeof result.text).toBe('string');
        expect(typeof result.canonicalUrl).toBe('string');
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        expect(globalThis.fetch.mock.calls[0][0]).toBe(expectedUrl);
    });

    test('accepts frozen own-data options for an authorized relative request', async () => {
        const snapshot = createNetflixSnapshot();
        const callerController = new AbortController();
        const baseUrl =
            'https://captions.nflxvideo.net/show/playlist/master.m3u8?token=frozen-base';
        const expectedUrl =
            'https://captions.nflxvideo.net/show/segments/en.vtt?token=frozen-derived';
        const options = Object.freeze({
            baseUrl,
            stage: 'frozen-segment',
            signal: callerController.signal,
            maxBytes: 64,
        });

        await expect(
            fetchAuthorizedSubtitleText(
                snapshot,
                '../segments/en.vtt?token=frozen-derived',
                options
            )
        ).resolves.toStrictEqual({
            text: 'WEBVTT',
            canonicalUrl: expectedUrl,
        });

        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        const [input, init] = globalThis.fetch.mock.calls[0];
        expect(input).toBe(expectedUrl);
        expect(init.signal).toBeInstanceOf(AbortSignal);
        expect(init.signal).not.toBe(callerController.signal);
    });

    test('carries the exact authorized relative URL into the next relative fetch base', async () => {
        const snapshot = createNetflixSnapshot();
        const rootBase =
            'https://captions.nflxvideo.net/show/manifests/root.m3u8?token=root';
        const playlistUrl =
            'https://captions.nflxvideo.net/show/playlists/master.m3u8?token=playlist';
        const segmentUrl =
            'https://captions.nflxvideo.net/show/playlists/segments/part-1.vtt?token=segment';
        globalThis.fetch.mockImplementation((input) =>
            Promise.resolve(
                createFetchedResponse(
                    input === playlistUrl ? 'PLAYLIST' : 'SEGMENT',
                    input
                )
            )
        );

        const playlist = await fetchAuthorizedSubtitleText(
            snapshot,
            '../playlists/master.m3u8?token=playlist#ignored',
            { baseUrl: rootBase, stage: 'playlist', maxBytes: 64 }
        );
        const segment = await fetchAuthorizedSubtitleText(
            snapshot,
            './segments/part-1.vtt?token=segment#ignored',
            {
                baseUrl: playlist.canonicalUrl,
                stage: 'segment',
                maxBytes: 64,
            }
        );

        expect(playlist).toStrictEqual({
            text: 'PLAYLIST',
            canonicalUrl: playlistUrl,
        });
        expect(segment).toStrictEqual({
            text: 'SEGMENT',
            canonicalUrl: segmentUrl,
        });
        expect(globalThis.fetch.mock.calls.map(([input]) => input)).toEqual([
            playlistUrl,
            segmentUrl,
        ]);
    });

    test('rejects a relative reference that resolves away from the branded CDN', async () => {
        const snapshot = createNetflixSnapshot();
        const baseUrl =
            'https://captions.nflxvideo.net/show/playlist/master.m3u8';
        const reference =
            '//attacker.test/subtitle.vtt?token=PRIVATE_DERIVED_HOST';

        const error = await fetchAuthorizedSubtitleText(snapshot, reference, {
            baseUrl,
            stage: 'segment',
            maxBytes: 64,
        }).catch((caughtError) => caughtError);

        expect(error).toMatchObject({
            name: 'SubtitleRequestPolicyError',
            message: 'Subtitle request rejected by policy.',
            code: 'ERR_SUBTITLE_URL_NOT_ALLOWED',
            platform: SubtitleRequestSources.NETFLIX,
            stage: 'segment',
        });
        expect(globalThis.fetch).not.toHaveBeenCalled();
        expectErrorToExclude(error, reference, 'PRIVATE_DERIVED_HOST');
    });

    test('rejects an unbranded snapshot before inspecting the reference or fetching', async () => {
        let rawReads = 0;
        const hostileReference = new Proxy(
            {},
            {
                get() {
                    rawReads += 1;
                    throw new Error('PRIVATE_UNBRANDED_REFERENCE');
                },
            }
        );

        const error = await fetchAuthorizedSubtitleText(
            Object.freeze({ source: SubtitleRequestSources.DISNEY_PLUS }),
            hostileReference,
            { stage: 'initial', maxBytes: 64 }
        ).catch((caughtError) => caughtError);

        expect(error).toMatchObject({
            name: 'SubtitleRequestPolicyError',
            message: 'Subtitle request rejected by policy.',
            code: 'ERR_SUBTITLE_REQUEST_UNAUTHORIZED',
            platform: 'unknown',
            stage: 'request',
        });
        expect(rawReads).toBe(0);
        expect(globalThis.fetch).not.toHaveBeenCalled();
        expectErrorToExclude(error, 'PRIVATE_UNBRANDED_REFERENCE');
    });

    test('rejects an unbranded snapshot before inspecting options or the reference', async () => {
        const optionReads = [];
        const optionReflections = [];
        const hostileOptions = new Proxy(
            {},
            {
                get(_target, key) {
                    optionReads.push(key);
                    if (key === 'baseUrl') {
                        return 'PRIVATE_UNBRANDED_BASE_URL';
                    }
                    if (key === 'stage') return 'PRIVATE_UNBRANDED_STAGE';
                    if (key === 'signal') return undefined;
                    if (key === 'maxBytes') return 64;
                    return undefined;
                },
                getPrototypeOf() {
                    optionReflections.push('getPrototypeOf');
                    return Object.prototype;
                },
                ownKeys() {
                    optionReflections.push('ownKeys');
                    return [];
                },
                getOwnPropertyDescriptor() {
                    optionReflections.push('getOwnPropertyDescriptor');
                    return undefined;
                },
                has() {
                    optionReflections.push('has');
                    return false;
                },
            }
        );
        const snapshotObservations = [];
        const unbrandedSnapshot = new Proxy(
            {},
            {
                get(_target, key) {
                    snapshotObservations.push(`get:${String(key)}`);
                    throw new Error('PRIVATE_UNBRANDED_SNAPSHOT');
                },
                getPrototypeOf() {
                    snapshotObservations.push('getPrototypeOf');
                    throw new Error('PRIVATE_UNBRANDED_SNAPSHOT');
                },
                ownKeys() {
                    snapshotObservations.push('ownKeys');
                    throw new Error('PRIVATE_UNBRANDED_SNAPSHOT');
                },
            }
        );
        let referenceReads = 0;
        const hostileReference = new Proxy(
            {},
            {
                get() {
                    referenceReads += 1;
                    throw new Error('PRIVATE_UNBRANDED_REFERENCE');
                },
            }
        );

        const error = await fetchAuthorizedSubtitleText(
            unbrandedSnapshot,
            hostileReference,
            hostileOptions
        ).catch((caughtError) => caughtError);

        expect(error).toMatchObject({
            name: 'SubtitleRequestPolicyError',
            message: 'Subtitle request rejected by policy.',
            code: 'ERR_SUBTITLE_REQUEST_UNAUTHORIZED',
            platform: 'unknown',
            stage: 'request',
        });
        expect(optionReads).toEqual([]);
        expect(optionReflections).toEqual([]);
        expect(snapshotObservations).toEqual([]);
        expect(referenceReads).toBe(0);
        expect(globalThis.fetch).not.toHaveBeenCalled();
        expectErrorToExclude(
            error,
            'PRIVATE_UNBRANDED_BASE_URL',
            'PRIVATE_UNBRANDED_STAGE',
            'PRIVATE_UNBRANDED_SNAPSHOT',
            'PRIVATE_UNBRANDED_REFERENCE'
        );
    });

    test('rejects accessor-backed options without invoking the accessor or inspecting the URL', async () => {
        const snapshot = createDisneySnapshot();
        let optionReads = 0;
        const hostileOptions = {};
        Object.defineProperty(hostileOptions, 'maxBytes', {
            get() {
                optionReads += 1;
                throw new Error('PRIVATE_OPTIONS_ACCESSOR');
            },
        });
        let referenceReads = 0;
        const hostileReference = new Proxy(
            {},
            {
                get() {
                    referenceReads += 1;
                    throw new Error('PRIVATE_OPTIONS_REFERENCE');
                },
            }
        );

        const error = await fetchAuthorizedSubtitleText(
            snapshot,
            hostileReference,
            hostileOptions
        ).catch((caughtError) => caughtError);

        expect(error).toMatchObject({
            name: 'TypeError',
            message: 'Subtitle fetch options are invalid.',
            code: 'ERR_SUBTITLE_FETCH_OPTIONS_INVALID',
        });
        expect(optionReads).toBe(0);
        expect(referenceReads).toBe(0);
        expect(globalThis.fetch).not.toHaveBeenCalled();
        expectErrorToExclude(
            error,
            'PRIVATE_OPTIONS_ACCESSOR',
            'PRIVATE_OPTIONS_REFERENCE'
        );
    });

    test.each([
        [
            'accessor-backed',
            (signal, recordRead) => {
                const options = { maxBytes: 64 };
                Object.defineProperty(options, 'signal', {
                    get() {
                        recordRead();
                        throw new Error('PRIVATE_OPTIONS_SIGNAL_ACCESSOR');
                    },
                });
                return options;
            },
        ],
        [
            'inherited',
            (signal) => {
                const options = Object.create({ signal });
                Object.defineProperty(options, 'maxBytes', {
                    value: 64,
                    enumerable: true,
                });
                return options;
            },
        ],
    ])('rejects an %s signal option', async (_label, createOptions) => {
        const snapshot = createDisneySnapshot();
        const callerController = new AbortController();
        let signalReads = 0;

        const error = await fetchAuthorizedSubtitleText(
            snapshot,
            DISNEY_SUBTITLE_URL,
            createOptions(callerController.signal, () => {
                signalReads += 1;
            })
        ).catch((caughtError) => caughtError);

        expect(error).toMatchObject({
            name: 'TypeError',
            message: 'Subtitle fetch options are invalid.',
            code: 'ERR_SUBTITLE_FETCH_OPTIONS_INVALID',
        });
        expect(signalReads).toBe(0);
        expect(globalThis.fetch).not.toHaveBeenCalled();
        expectErrorToExclude(error, 'PRIVATE_OPTIONS_SIGNAL_ACCESSOR');
    });

    test('sanitizes option reflection failures before inspecting the URL', async () => {
        const snapshot = createDisneySnapshot();
        let reflectionTraps = 0;
        let propertyReads = 0;
        const hostileOptions = new Proxy(
            {},
            {
                getPrototypeOf() {
                    reflectionTraps += 1;
                    return Object.prototype;
                },
                ownKeys() {
                    reflectionTraps += 1;
                    throw new Error('PRIVATE_OPTIONS_OWN_KEYS');
                },
                get() {
                    propertyReads += 1;
                    throw new Error('PRIVATE_OPTIONS_GET');
                },
            }
        );
        let referenceReads = 0;
        const hostileReference = new Proxy(
            {},
            {
                get() {
                    referenceReads += 1;
                    throw new Error('PRIVATE_OPTIONS_REFERENCE');
                },
            }
        );

        const error = await fetchAuthorizedSubtitleText(
            snapshot,
            hostileReference,
            hostileOptions
        ).catch((caughtError) => caughtError);

        expect(error).toMatchObject({
            name: 'TypeError',
            message: 'Subtitle fetch options are invalid.',
            code: 'ERR_SUBTITLE_FETCH_OPTIONS_INVALID',
        });
        expect(reflectionTraps).toBe(2);
        expect(propertyReads).toBe(0);
        expect(referenceReads).toBe(0);
        expect(globalThis.fetch).not.toHaveBeenCalled();
        expectErrorToExclude(
            error,
            'PRIVATE_OPTIONS_OWN_KEYS',
            'PRIVATE_OPTIONS_GET',
            'PRIVATE_OPTIONS_REFERENCE'
        );
    });

    test.each([
        ['null', () => null],
        ['primitive', () => 64],
        [
            'sparse array',
            () => {
                const options = new Array(2);
                options.maxBytes = 64;
                return options;
            },
        ],
        ['inherited value', () => Object.create({ maxBytes: 64 })],
        [
            'unexpected key',
            () => ({ maxBytes: 64, extra: 'PRIVATE_OPTIONS_EXTRA' }),
        ],
        [
            'symbol key',
            () => ({
                maxBytes: 64,
                [Symbol('PRIVATE_OPTIONS_SYMBOL')]: true,
            }),
        ],
        [
            'dangerous key',
            () => {
                const options = Object.create(null);
                Object.defineProperty(options, 'maxBytes', {
                    value: 64,
                    enumerable: true,
                });
                Object.defineProperty(options, '__proto__', {
                    value: 'PRIVATE_OPTIONS_DANGEROUS',
                    enumerable: true,
                });
                return options;
            },
        ],
        ['function', () => function privateOptionsFunction() {}],
    ])(
        'rejects %s options before inspecting the URL',
        async (_label, createOptions) => {
            const snapshot = createDisneySnapshot();
            let referenceReads = 0;
            const hostileReference = new Proxy(
                {},
                {
                    get() {
                        referenceReads += 1;
                        throw new Error('PRIVATE_INVALID_OPTIONS_REFERENCE');
                    },
                }
            );

            const error = await fetchAuthorizedSubtitleText(
                snapshot,
                hostileReference,
                createOptions()
            ).catch((caughtError) => caughtError);

            expect(error).toMatchObject({
                name: 'TypeError',
                message: 'Subtitle fetch options are invalid.',
                code: 'ERR_SUBTITLE_FETCH_OPTIONS_INVALID',
            });
            expect(referenceReads).toBe(0);
            expect(globalThis.fetch).not.toHaveBeenCalled();
            expectErrorToExclude(
                error,
                'PRIVATE_OPTIONS_EXTRA',
                'PRIVATE_OPTIONS_SYMBOL',
                'PRIVATE_OPTIONS_DANGEROUS',
                'PRIVATE_INVALID_OPTIONS_REFERENCE'
            );
        }
    );

    test('fetches the exact policy-canonical URL for uppercase host, default port, fragment, and escapes', async () => {
        const snapshot = createDisneySnapshot();
        const rawUrl =
            'https://CAPTIONS.MEDIA.DSSOTT.COM:443/show/%6daster.m3u8?token=a%2Bb#ignored';
        const canonicalUrl =
            'https://captions.media.dssott.com/show/%6daster.m3u8?token=a%2Bb';

        await expect(
            fetchAuthorizedSubtitleText(snapshot, rawUrl, {
                stage: 'initial',
                maxBytes: 64,
            })
        ).resolves.toStrictEqual({ text: 'WEBVTT', canonicalUrl });

        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        expect(globalThis.fetch.mock.calls[0][0]).toBe(canonicalUrl);
    });

    test.each([undefined, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
        'rejects invalid maxBytes %p before URL inspection or fetch',
        async (maxBytes) => {
            const snapshot = createDisneySnapshot();
            const OriginalURL = globalThis.URL;
            let urlConstructions = 0;
            globalThis.URL = class {
                constructor() {
                    urlConstructions += 1;
                    throw new Error('PRIVATE_INVALID_LIMIT_URL_PARSER');
                }
            };

            let error;
            try {
                error = await fetchAuthorizedSubtitleText(
                    snapshot,
                    DISNEY_SUBTITLE_URL,
                    { stage: 'initial', maxBytes }
                ).catch((caughtError) => caughtError);
            } finally {
                globalThis.URL = OriginalURL;
            }

            expect(error).toMatchObject({
                name: 'TypeError',
                message: 'Subtitle response byte limit is invalid.',
                code: 'ERR_SUBTITLE_FETCH_LIMIT_INVALID',
            });
            expect(urlConstructions).toBe(0);
            expect(globalThis.fetch).not.toHaveBeenCalled();
            expectErrorToExclude(error, 'PRIVATE_INVALID_LIMIT_URL_PARSER');
        }
    );

    test('rejects an unbranded snapshot before validating its byte limit', async () => {
        const error = await fetchAuthorizedSubtitleText(
            Object.freeze({ source: SubtitleRequestSources.DISNEY_PLUS }),
            DISNEY_SUBTITLE_URL,
            { stage: 'initial', maxBytes: 0 }
        ).catch((caughtError) => caughtError);

        expect(error).toMatchObject({
            name: 'SubtitleRequestPolicyError',
            message: 'Subtitle request rejected by policy.',
            code: 'ERR_SUBTITLE_REQUEST_UNAUTHORIZED',
            platform: 'unknown',
            stage: 'request',
        });
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    test.each([
        [
            'cross-host URL',
            'https://attacker.test/subtitle.vtt?token=PRIVATE_CROSS_HOST',
            'ERR_SUBTITLE_URL_NOT_ALLOWED',
            'PRIVATE_CROSS_HOST',
        ],
        [
            'HTTP URL',
            'http://captions.media.dssott.com/subtitle.vtt?token=PRIVATE_HTTP',
            'ERR_SUBTITLE_URL_NOT_ALLOWED',
            'PRIVATE_HTTP',
        ],
        [
            'credentialed URL',
            'https://user:PRIVATE_PASSWORD@captions.media.dssott.com/subtitle.vtt',
            'ERR_SUBTITLE_URL_NOT_ALLOWED',
            'PRIVATE_PASSWORD',
        ],
        [
            'non-default port URL',
            'https://captions.media.dssott.com:444/subtitle.vtt?token=PRIVATE_PORT',
            'ERR_SUBTITLE_URL_NOT_ALLOWED',
            'PRIVATE_PORT',
        ],
        [
            'oversized reference',
            `${'a'.repeat(16 * 1024 + 1)}PRIVATE_OVERSIZE`,
            'ERR_SUBTITLE_URL_INVALID',
            'PRIVATE_OVERSIZE',
        ],
    ])(
        'rejects a %s through policy before native fetch',
        async (_label, reference, code, secret) => {
            const snapshot = createDisneySnapshot();

            const error = await fetchAuthorizedSubtitleText(
                snapshot,
                reference,
                { stage: 'initial', maxBytes: 64 }
            ).catch((caughtError) => caughtError);

            expect(error).toMatchObject({
                name: 'SubtitleRequestPolicyError',
                message: 'Subtitle request rejected by policy.',
                code,
                platform: SubtitleRequestSources.DISNEY_PLUS,
                stage: 'initial',
            });
            expect(globalThis.fetch).not.toHaveBeenCalled();
            expectErrorToExclude(error, secret);
        }
    );

    test('fixed-rejects a non-OK response and cancels its body exactly once', async () => {
        const snapshot = createDisneySnapshot();
        const signedUrl = `${DISNEY_SUBTITLE_URL}?token=PRIVATE_SIGNED_TOKEN`;
        const response = createFetchedResponse(
            'PRIVATE_RESPONSE_BODY',
            signedUrl,
            { ok: false, status: 403 }
        );
        globalThis.fetch.mockResolvedValue(response);

        const error = await fetchAuthorizedSubtitleText(snapshot, signedUrl, {
            stage: 'initial',
            maxBytes: 64,
        }).catch((caughtError) => caughtError);

        expect(error).toMatchObject({
            name: 'SubtitleFetchError',
            message: 'Subtitle response rejected.',
            code: 'ERR_SUBTITLE_FETCH_HTTP',
        });
        expect(response.body.cancel).toHaveBeenCalledTimes(1);
        expect(response.body.getReader).not.toHaveBeenCalled();
        const cancellationReason = response.body.cancel.mock.calls[0][0];
        expect(cancellationReason).not.toBe(error);
        expect(cancellationReason).toMatchObject({
            name: 'AbortError',
            message: 'Response body consumption was cancelled.',
            code: 'ERR_RESPONSE_BODY_CANCELLED',
        });
        expectErrorToExclude(
            error,
            signedUrl,
            'PRIVATE_SIGNED_TOKEN',
            'PRIVATE_RESPONSE_BODY'
        );
        expectErrorToExclude(
            cancellationReason,
            signedUrl,
            'PRIVATE_SIGNED_TOKEN',
            'PRIVATE_RESPONSE_BODY'
        );
    });

    test('rejects missing HTTP success metadata and cancels its body exactly once', async () => {
        const snapshot = createDisneySnapshot();
        const signedUrl = `${DISNEY_SUBTITLE_URL}?token=PRIVATE_MISSING_OK`;
        const response = createFetchedResponse(
            'PRIVATE_MISSING_OK_BODY',
            signedUrl
        );
        delete response.ok;
        globalThis.fetch.mockResolvedValue(response);

        const error = await fetchAuthorizedSubtitleText(snapshot, signedUrl, {
            stage: 'initial',
            maxBytes: 64,
        }).catch((caughtError) => caughtError);

        expect(error).toMatchObject({
            name: 'SubtitleFetchError',
            message: 'Subtitle response rejected.',
            code: 'ERR_SUBTITLE_FETCH_HTTP',
        });
        expect(response.body.cancel).toHaveBeenCalledTimes(1);
        expect(response.body.getReader).not.toHaveBeenCalled();
        expectErrorToExclude(
            error,
            signedUrl,
            'PRIVATE_MISSING_OK',
            'PRIVATE_MISSING_OK_BODY'
        );
    });

    test('keeps Netflix redirects disabled and rejects redirect metadata before HTTP status', async () => {
        const snapshot = createNetflixSnapshot();
        const signedUrl = `${NETFLIX_SUBTITLE_URL}?token=PRIVATE_REDIRECT_TOKEN`;
        const response = createFetchedResponse(
            'PRIVATE_REDIRECT_BODY',
            signedUrl,
            {
                ok: false,
                status: 302,
                redirected: true,
            }
        );
        globalThis.fetch.mockResolvedValue(response);

        const error = await fetchAuthorizedSubtitleText(snapshot, signedUrl, {
            stage: 'initial',
            maxBytes: 64,
        }).catch((caughtError) => caughtError);

        expect(error).toMatchObject({
            name: 'SubtitleFetchError',
            message: 'Subtitle response rejected.',
            code: 'ERR_SUBTITLE_FETCH_REDIRECT',
        });
        expect(response.body.cancel).toHaveBeenCalledTimes(1);
        expect(response.body.getReader).not.toHaveBeenCalled();
        expect(globalThis.fetch.mock.calls[0][1].redirect).toBe('error');
        expectErrorToExclude(
            error,
            signedUrl,
            'PRIVATE_REDIRECT_TOKEN',
            'PRIVATE_REDIRECT_BODY'
        );
    });

    test('rejects missing redirect metadata before final-URL validation', async () => {
        const snapshot = createDisneySnapshot();
        const signedUrl = `${DISNEY_SUBTITLE_URL}?token=PRIVATE_REDIRECT_METADATA`;
        const response = createFetchedResponse(
            'PRIVATE_REDIRECT_METADATA_BODY',
            '',
            { ok: false }
        );
        delete response.redirected;
        globalThis.fetch.mockResolvedValue(response);

        const error = await fetchAuthorizedSubtitleText(snapshot, signedUrl, {
            stage: 'initial',
            maxBytes: 64,
        }).catch((caughtError) => caughtError);

        expect(error).toMatchObject({
            name: 'SubtitleFetchError',
            message: 'Subtitle response rejected.',
            code: 'ERR_SUBTITLE_FETCH_REDIRECT',
        });
        expect(response.body.cancel).toHaveBeenCalledTimes(1);
        expect(response.body.getReader).not.toHaveBeenCalled();
        expectErrorToExclude(
            error,
            signedUrl,
            'PRIVATE_REDIRECT_METADATA',
            'PRIVATE_REDIRECT_METADATA_BODY'
        );
    });

    test('rejects an exact final-URL mismatch before HTTP status and cancels once', async () => {
        const snapshot = createDisneySnapshot();
        const signedUrl = `${DISNEY_SUBTITLE_URL}?token=PRIVATE_REQUEST_TOKEN`;
        const finalUrl =
            'https://captions.media.dssott.com/show/other.m3u8?token=PRIVATE_FINAL_TOKEN';
        const response = createFetchedResponse('PRIVATE_FINAL_BODY', finalUrl, {
            ok: false,
            status: 500,
        });
        globalThis.fetch.mockResolvedValue(response);

        const error = await fetchAuthorizedSubtitleText(snapshot, signedUrl, {
            stage: 'initial',
            maxBytes: 64,
        }).catch((caughtError) => caughtError);

        expect(error).toMatchObject({
            name: 'SubtitleFetchError',
            message: 'Subtitle response rejected.',
            code: 'ERR_SUBTITLE_FETCH_FINAL_URL',
        });
        expect(response.body.cancel).toHaveBeenCalledTimes(1);
        expect(response.body.getReader).not.toHaveBeenCalled();
        expectErrorToExclude(
            error,
            signedUrl,
            finalUrl,
            'PRIVATE_REQUEST_TOKEN',
            'PRIVATE_FINAL_TOKEN',
            'PRIVATE_FINAL_BODY'
        );
    });

    test.each([
        ['empty', (response) => Object.assign(response, { url: '' })],
        [
            'missing',
            (response) => {
                delete response.url;
                return response;
            },
        ],
    ])(
        'rejects a %s final response URL and cancels once',
        async (_label, removeFinalUrl) => {
            const snapshot = createDisneySnapshot();
            const signedUrl = `${DISNEY_SUBTITLE_URL}?token=PRIVATE_MISSING_FINAL_URL`;
            const response = removeFinalUrl(
                createFetchedResponse('PRIVATE_MISSING_FINAL_BODY', signedUrl)
            );
            globalThis.fetch.mockResolvedValue(response);

            const error = await fetchAuthorizedSubtitleText(
                snapshot,
                signedUrl,
                { stage: 'initial', maxBytes: 64 }
            ).catch((caughtError) => caughtError);

            expect(error).toMatchObject({
                name: 'SubtitleFetchError',
                message: 'Subtitle response rejected.',
                code: 'ERR_SUBTITLE_FETCH_FINAL_URL',
            });
            expect(response.body.cancel).toHaveBeenCalledTimes(1);
            expect(response.body.getReader).not.toHaveBeenCalled();
            expectErrorToExclude(
                error,
                signedUrl,
                'PRIVATE_MISSING_FINAL_URL',
                'PRIVATE_MISSING_FINAL_BODY'
            );
        }
    );

    test('preserves a streamed byte-limit error and cancels only the reader once', async () => {
        const snapshot = createDisneySnapshot();
        const signedUrl = `${DISNEY_SUBTITLE_URL}?token=PRIVATE_LIMIT_TOKEN`;
        const reader = {
            read: jest
                .fn()
                .mockResolvedValueOnce({
                    done: false,
                    value: new NodeTextEncoder().encode('1234'),
                })
                .mockResolvedValueOnce({
                    done: false,
                    value: new NodeTextEncoder().encode('5678'),
                }),
            cancel: jest.fn().mockResolvedValue(undefined),
            releaseLock: jest.fn(),
        };
        const response = createFetchedResponse('', signedUrl, {
            body: {
                getReader: jest.fn(() => reader),
                cancel: jest.fn().mockResolvedValue(undefined),
            },
        });
        globalThis.fetch.mockResolvedValue(response);

        const error = await fetchAuthorizedSubtitleText(snapshot, signedUrl, {
            stage: 'segment',
            maxBytes: 6,
        }).catch((caughtError) => caughtError);

        expect(error).toMatchObject({
            name: 'ResponseBodyLimitError',
            message: 'Response body exceeds the 6 byte limit.',
            code: 'ERR_RESPONSE_BODY_LIMIT',
            limitBytes: 6,
            observedBytes: 8,
        });
        expect(reader.read).toHaveBeenCalledTimes(2);
        expect(reader.cancel).toHaveBeenCalledTimes(1);
        expect(reader.cancel.mock.calls[0][0]).toBe(error);
        expect(reader.releaseLock).toHaveBeenCalledTimes(1);
        expect(response.body.cancel).not.toHaveBeenCalled();
        expectErrorToExclude(error, signedUrl, 'PRIVATE_LIMIT_TOKEN');
    });

    test('preserves a sanitized transport failure without exposing raw fetch data', async () => {
        const snapshot = createDisneySnapshot();
        const signedUrl = `${DISNEY_SUBTITLE_URL}?token=PRIVATE_FETCH_URL_TOKEN`;
        const rawError = Object.assign(
            new TypeError('PRIVATE_NATIVE_FETCH_FAILURE', {
                cause: new Error('PRIVATE_FETCH_CAUSE'),
            }),
            {
                input: signedUrl,
                url: signedUrl,
                reason: 'PRIVATE_FETCH_REASON',
            }
        );
        globalThis.fetch.mockRejectedValue(rawError);

        const error = await fetchAuthorizedSubtitleText(snapshot, signedUrl, {
            stage: 'initial',
            maxBytes: 64,
        }).catch((caughtError) => caughtError);

        expect(error).not.toBe(rawError);
        expect(error).toMatchObject({
            name: 'TypeError',
            message: 'Failed to fetch',
            code: 'ERR_FETCH_FAILED',
            retryable: true,
        });
        expectErrorToExclude(
            error,
            signedUrl,
            'PRIVATE_FETCH_URL_TOKEN',
            'PRIVATE_NATIVE_FETCH_FAILURE',
            'PRIVATE_FETCH_CAUSE',
            'PRIVATE_FETCH_REASON'
        );
    });

    test('preserves a sanitized stream-read failure and cancels only the reader once', async () => {
        const snapshot = createDisneySnapshot();
        const signedUrl = `${DISNEY_SUBTITLE_URL}?token=PRIVATE_READ_URL_TOKEN`;
        const rawError = Object.assign(
            new TypeError('PRIVATE_STREAM_READ_FAILURE', {
                cause: new Error('PRIVATE_STREAM_READ_CAUSE'),
            }),
            {
                input: signedUrl,
                url: signedUrl,
                reason: 'PRIVATE_STREAM_READ_REASON',
            }
        );
        const reader = {
            read: jest.fn().mockRejectedValue(rawError),
            cancel: jest.fn().mockResolvedValue(undefined),
            releaseLock: jest.fn(),
        };
        const response = createFetchedResponse('', signedUrl, {
            body: {
                getReader: jest.fn(() => reader),
                cancel: jest.fn().mockResolvedValue(undefined),
            },
        });
        globalThis.fetch.mockResolvedValue(response);

        const error = await fetchAuthorizedSubtitleText(snapshot, signedUrl, {
            stage: 'segment',
            maxBytes: 64,
        }).catch((caughtError) => caughtError);

        expect(error).not.toBe(rawError);
        expect(error).toMatchObject({
            name: 'TypeError',
            message: 'Failed to read response body.',
            code: 'ERR_RESPONSE_BODY_READ',
            retryable: true,
        });
        expect(reader.read).toHaveBeenCalledTimes(1);
        expect(reader.cancel).toHaveBeenCalledTimes(1);
        expect(reader.cancel.mock.calls[0][0]).toBe(error);
        expect(reader.releaseLock).toHaveBeenCalledTimes(1);
        expect(response.body.cancel).not.toHaveBeenCalled();
        expectErrorToExclude(
            error,
            signedUrl,
            'PRIVATE_READ_URL_TOKEN',
            'PRIVATE_STREAM_READ_FAILURE',
            'PRIVATE_STREAM_READ_CAUSE',
            'PRIVATE_STREAM_READ_REASON'
        );
    });

    test('preserves a sanitized caller abort while a streamed body is pending', async () => {
        const snapshot = createDisneySnapshot();
        const signedUrl = `${DISNEY_SUBTITLE_URL}?token=PRIVATE_ABORT_URL_TOKEN`;
        const callerController = new AbortController();
        let markReadStarted;
        const readStarted = new Promise((resolve) => {
            markReadStarted = resolve;
        });
        const reader = {
            read: jest.fn(() => {
                markReadStarted();
                return new Promise(() => {});
            }),
            cancel: jest.fn().mockResolvedValue(undefined),
            releaseLock: jest.fn(),
        };
        const response = createFetchedResponse('', signedUrl, {
            body: {
                getReader: jest.fn(() => reader),
                cancel: jest.fn().mockResolvedValue(undefined),
            },
        });
        let internalSignal;
        globalThis.fetch.mockImplementation((_input, init) => {
            internalSignal = init.signal;
            return Promise.resolve(response);
        });
        const rawAbortReason = Object.assign(
            new Error('PRIVATE_CALLER_ABORT_REASON', {
                cause: new Error('PRIVATE_CALLER_ABORT_CAUSE'),
            }),
            {
                input: signedUrl,
                url: signedUrl,
                reason: 'PRIVATE_NESTED_ABORT_REASON',
            }
        );

        const result = fetchAuthorizedSubtitleText(snapshot, signedUrl, {
            stage: 'segment',
            signal: callerController.signal,
            maxBytes: 64,
        }).catch((caughtError) => caughtError);
        await readStarted;
        callerController.abort(rawAbortReason);
        const error = await result;

        expect(error).not.toBe(rawAbortReason);
        expect(error).toMatchObject({
            name: 'AbortError',
            message: 'Request was aborted by the caller.',
            code: 'ERR_FETCH_ABORTED',
        });
        expect(internalSignal).toBeInstanceOf(AbortSignal);
        expect(internalSignal).not.toBe(callerController.signal);
        expect(internalSignal.aborted).toBe(true);
        expect(reader.read).toHaveBeenCalledTimes(1);
        expect(reader.cancel).toHaveBeenCalledTimes(1);
        expect(reader.cancel.mock.calls[0][0]).toBe(error);
        expect(reader.releaseLock).toHaveBeenCalledTimes(1);
        expect(response.body.cancel).not.toHaveBeenCalled();
        expectErrorToExclude(
            error,
            signedUrl,
            'PRIVATE_ABORT_URL_TOKEN',
            'PRIVATE_CALLER_ABORT_REASON',
            'PRIVATE_CALLER_ABORT_CAUSE',
            'PRIVATE_NESTED_ABORT_REASON'
        );
    });

    test('uses the fixed 30-second deadline while a streamed body is pending', async () => {
        jest.useFakeTimers();
        const snapshot = createDisneySnapshot();
        const signedUrl = `${DISNEY_SUBTITLE_URL}?token=PRIVATE_TIMEOUT_URL_TOKEN`;
        let markReadStarted;
        const readStarted = new Promise((resolve) => {
            markReadStarted = resolve;
        });
        const reader = {
            read: jest.fn(() => {
                markReadStarted();
                return new Promise(() => {});
            }),
            cancel: jest.fn().mockResolvedValue(undefined),
            releaseLock: jest.fn(),
        };
        const response = createFetchedResponse('', signedUrl, {
            body: {
                getReader: jest.fn(() => reader),
                cancel: jest.fn().mockResolvedValue(undefined),
            },
        });
        let internalSignal;
        globalThis.fetch.mockImplementation((_input, init) => {
            internalSignal = init.signal;
            return Promise.resolve(response);
        });

        try {
            const result = fetchAuthorizedSubtitleText(snapshot, signedUrl, {
                stage: 'segment',
                maxBytes: 64,
            }).catch((caughtError) => caughtError);
            let settled = false;
            void result.then(() => {
                settled = true;
            });
            await readStarted;
            await jest.advanceTimersByTimeAsync(29_999);
            expect(settled).toBe(false);
            expect(internalSignal.aborted).toBe(false);
            expect(reader.cancel).not.toHaveBeenCalled();
            expect(reader.releaseLock).not.toHaveBeenCalled();

            await jest.advanceTimersByTimeAsync(1);
            const error = await result;

            expect(error).toMatchObject({
                name: 'TimeoutError',
                message: 'Request timed out after 30000ms',
                code: 'ERR_FETCH_TIMEOUT',
                retryable: true,
            });
            expect(internalSignal).toBeInstanceOf(AbortSignal);
            expect(internalSignal.aborted).toBe(true);
            expect(reader.read).toHaveBeenCalledTimes(1);
            expect(reader.cancel).toHaveBeenCalledTimes(1);
            expect(reader.cancel.mock.calls[0][0]).toBe(error);
            expect(reader.releaseLock).toHaveBeenCalledTimes(1);
            expect(response.body.cancel).not.toHaveBeenCalled();
            expect(jest.getTimerCount()).toBe(0);
            expectErrorToExclude(error, signedUrl, 'PRIVATE_TIMEOUT_URL_TOKEN');
        } finally {
            jest.useRealTimers();
        }
    });
});
