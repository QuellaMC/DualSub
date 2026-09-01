import { afterAll, beforeEach, describe, expect, test } from '@jest/globals';
import {
    MessageActions,
    SubtitleRequestSources,
} from '../../content_scripts/shared/constants/messageActions.js';
import {
    assertAllowedSubtitleUrl,
    authorizeSubtitleRequest,
    getDisneySubtitleCdnCounterpartUrl,
    isAuthorizedSubtitleRequestSnapshot,
    resolveAllowedSubtitleUrl,
} from './subtitleRequestPolicy.js';

const TEST_EXTENSION_ID = 'dualsub-test-extension-id';
const DISNEY_PAGE_URL = 'https://www.disneyplus.com/video/episode-123';
const NETFLIX_PAGE_URL = 'https://www.netflix.com/watch/80123456';
const DISNEY_SUBTITLE_URL =
    'https://captions.media.dssott.com/show/master.m3u8';
const NETFLIX_SUBTITLE_URL = 'https://captions.nflxvideo.net/show/en.ttml';
const originalRuntimeIdDescriptor = Object.getOwnPropertyDescriptor(
    globalThis.chrome.runtime,
    'id'
);

beforeEach(() => {
    Object.defineProperty(globalThis.chrome.runtime, 'id', {
        configurable: true,
        enumerable: true,
        value: TEST_EXTENSION_ID,
        writable: true,
    });
});

afterAll(() => {
    if (originalRuntimeIdDescriptor) {
        Object.defineProperty(
            globalThis.chrome.runtime,
            'id',
            originalRuntimeIdDescriptor
        );
    } else {
        delete globalThis.chrome.runtime.id;
    }
});

function createSender(pageUrl, overrides = {}) {
    return {
        id: TEST_EXTENSION_ID,
        tab: { id: 17, url: pageUrl },
        frameId: 0,
        url: pageUrl,
        origin: new URL(pageUrl).origin,
        ...overrides,
    };
}

function createDisneyMessage(overrides = {}) {
    return {
        action: MessageActions.FETCH_VTT,
        source: SubtitleRequestSources.DISNEY_PLUS,
        url: DISNEY_SUBTITLE_URL,
        videoId: 'episode-123',
        targetLanguage: 'zh-CN',
        originalLanguage: 'en',
        ...overrides,
    };
}

function createNetflixTrack(url = NETFLIX_SUBTITLE_URL, overrides = {}) {
    return {
        language: 'en',
        displayName: 'English',
        trackType: 'PRIMARY',
        isNoneTrack: false,
        isForcedNarrative: false,
        ttDownloadables: {
            dfxp: {
                urls: [{ url }],
            },
        },
        ...overrides,
    };
}

function createNetflixMessage(overrides = {}) {
    return {
        action: MessageActions.FETCH_VTT,
        source: SubtitleRequestSources.NETFLIX,
        data: { tracks: [createNetflixTrack()] },
        videoId: '80123456',
        targetLanguage: 'zh-CN',
        originalLanguage: 'en',
        useNativeSubtitles: true,
        useOfficialTranslations: true,
        ...overrides,
    };
}

function expectUnauthorized(callback, platform) {
    expect(callback).toThrow(
        expect.objectContaining({
            name: 'SubtitleRequestPolicyError',
            message: 'Subtitle request rejected by policy.',
            code: 'ERR_SUBTITLE_REQUEST_UNAUTHORIZED',
            platform,
            stage: 'request',
        })
    );
}

function expectCanonicalNetflixGraph(snapshot) {
    const track = snapshot.data.tracks[0];
    const [format] = Object.keys(track.ttDownloadables);

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.data)).toBe(true);
    expect(Object.isFrozen(snapshot.data.tracks)).toBe(true);
    expect(Object.isFrozen(track)).toBe(true);
    expect(Object.isFrozen(track.ttDownloadables)).toBe(true);
    expect(Object.isFrozen(track.ttDownloadables[format])).toBe(true);
    expect(Object.isFrozen(track.ttDownloadables[format].urls)).toBe(true);
}

const senderBoundaryCases = [
    {
        label: 'accepts a Disney top-frame content script on the live route',
        build: () => ({
            message: createDisneyMessage(),
            sender: createSender(DISNEY_PAGE_URL),
        }),
        expected: {
            source: SubtitleRequestSources.DISNEY_PLUS,
            tabId: 17,
            videoId: 'episode-123',
        },
    },
    {
        label: 'accepts a localized Disney player route',
        build: () => {
            const pageUrl = 'https://www.disneyplus.com/en-gb/play/episode-123';
            return {
                message: createDisneyMessage(),
                sender: createSender(pageUrl),
            };
        },
        expected: {
            source: SubtitleRequestSources.DISNEY_PLUS,
            videoId: 'episode-123',
        },
    },
    {
        label: 'accepts a Netflix top-frame content script on an exact watch route',
        build: () => ({
            message: createNetflixMessage(),
            sender: createSender(NETFLIX_PAGE_URL),
        }),
        expected: {
            source: SubtitleRequestSources.NETFLIX,
            tabId: 17,
            videoId: '80123456',
        },
    },
    {
        label: 'uses the live tab route after same-document navigation',
        build: () => ({
            message: createDisneyMessage({ videoId: 'episode-456' }),
            sender: createSender(DISNEY_PAGE_URL, {
                tab: {
                    id: 17,
                    url: 'https://www.disneyplus.com/video/episode-456',
                },
            }),
        }),
        expected: { videoId: 'episode-456' },
    },
    {
        label: 'accepts an omitted sender origin and tab id zero',
        build: () => {
            const sender = createSender(DISNEY_PAGE_URL, {
                tab: { id: 0, url: DISNEY_PAGE_URL },
            });
            delete sender.origin;
            return { message: createDisneyMessage(), sender };
        },
        expected: { tabId: 0 },
    },
    {
        label: 'rejects a sender from another extension',
        build: () => ({
            message: createDisneyMessage(),
            sender: createSender(DISNEY_PAGE_URL, { id: 'other-extension' }),
        }),
    },
    {
        label: 'rejects when the trusted extension id is unavailable',
        build: () => {
            delete globalThis.chrome.runtime.id;
            return {
                message: createDisneyMessage(),
                sender: createSender(DISNEY_PAGE_URL),
            };
        },
    },
    {
        label: 'rejects a subframe sender',
        build: () => ({
            message: createDisneyMessage(),
            sender: createSender(DISNEY_PAGE_URL, { frameId: 1 }),
        }),
    },
    {
        label: 'rejects a sender without a nonnegative tab id',
        build: () => ({
            message: createDisneyMessage(),
            sender: createSender(DISNEY_PAGE_URL, {
                tab: { id: -1, url: DISNEY_PAGE_URL },
            }),
        }),
    },
    {
        label: 'rejects an insecure platform page',
        build: () => {
            const pageUrl = 'http://www.disneyplus.com/video/episode-123';
            return {
                message: createDisneyMessage(),
                sender: createSender(pageUrl),
            };
        },
    },
    {
        label: 'rejects a lookalike platform hostname',
        build: () => {
            const pageUrl =
                'https://disneyplus.com.attacker.test/video/episode-123';
            return {
                message: createDisneyMessage(),
                sender: createSender(pageUrl),
            };
        },
    },
    {
        label: 'rejects an over-limit platform page URL',
        build: () => {
            const prefix = `${DISNEY_PAGE_URL}?padding=`;
            const pageUrl = `${prefix}${'a'.repeat(
                16 * 1024 + 1 - prefix.length
            )}`;
            return {
                message: createDisneyMessage(),
                sender: createSender(pageUrl),
            };
        },
    },
    {
        label: 'rejects sender and tab origins that disagree',
        build: () => ({
            message: createDisneyMessage(),
            sender: createSender(DISNEY_PAGE_URL, {
                tab: {
                    id: 17,
                    url: 'https://disneyplus.com/video/episode-123',
                },
            }),
        }),
    },
    {
        label: 'rejects sender origin metadata that disagrees with its URL',
        build: () => ({
            message: createDisneyMessage(),
            sender: createSender(DISNEY_PAGE_URL, {
                origin: 'https://attacker.test',
            }),
        }),
    },
    {
        label: 'rejects a platform source that does not match the sender page',
        build: () => ({
            message: createNetflixMessage(),
            sender: createSender(DISNEY_PAGE_URL),
        }),
    },
    {
        label: 'rejects a message video id that does not match the live route',
        build: () => ({
            message: createNetflixMessage({ videoId: '999' }),
            sender: createSender(NETFLIX_PAGE_URL),
        }),
    },
    {
        label: 'rejects Disney route escapes according to the shared identity helper',
        build: () => {
            const pageUrl = 'https://www.disneyplus.com/video/episode%252F123';
            return {
                message: createDisneyMessage({ videoId: 'episode%2F123' }),
                sender: createSender(pageUrl),
            };
        },
    },
    {
        label: 'rejects a Netflix watch path with a trailing segment',
        build: () => {
            const pageUrl = 'https://www.netflix.com/watch/80123456/extra';
            return {
                message: createNetflixMessage(),
                sender: createSender(pageUrl),
            };
        },
    },
];

describe('subtitle request sender and route ingress', () => {
    test.each(senderBoundaryCases)('$label', ({ build, expected }) => {
        const { message, sender } = build();
        if (!expected) {
            expectUnauthorized(
                () => authorizeSubtitleRequest(message, sender),
                message.source
            );
            return;
        }

        const snapshot = authorizeSubtitleRequest(message, sender);
        expect(snapshot).toMatchObject(expected);
        expect(Object.isFrozen(snapshot)).toBe(true);
        expect(isAuthorizedSubtitleRequestSnapshot(snapshot)).toBe(true);
    });
});

const disneyPayloadCases = [
    {
        label: 'canonicalizes one detached Disney request',
        message: () =>
            createDisneyMessage({
                url: 'https://CAPTIONS.MEDIA.DSSOTT.COM:443/show/master.m3u8?token=abc#cue',
                futureProviderField: 'not retained',
            }),
        expectedUrl:
            'https://captions.media.dssott.com/show/master.m3u8?token=abc',
    },
    {
        label: 'accepts language fields at their length limit',
        message: () =>
            createDisneyMessage({
                targetLanguage: 't'.repeat(64),
                originalLanguage: 'o'.repeat(64),
            }),
        expectedUrl: DISNEY_SUBTITLE_URL,
    },
    {
        label: 'accepts an initial URL at its length limit',
        message: () => {
            const prefix = 'https://captions.media.dssott.com/';
            return createDisneyMessage({
                url: `${prefix}${'a'.repeat(16 * 1024 - prefix.length)}`,
            });
        },
        expectedUrlLength: 16 * 1024,
    },
    {
        label: 'rejects the wrong message action',
        message: () => createDisneyMessage({ action: 'translate' }),
    },
    {
        label: 'rejects a non-HTTPS subtitle URL',
        message: () =>
            createDisneyMessage({
                url: 'http://captions.media.dssott.com/show/master.m3u8',
            }),
    },
    {
        label: 'rejects a credentialed subtitle URL',
        message: () =>
            createDisneyMessage({
                url: 'https://user:secret@captions.media.dssott.com/master.m3u8',
            }),
    },
    {
        label: 'rejects a non-default subtitle port',
        message: () =>
            createDisneyMessage({
                url: 'https://captions.media.dssott.com:444/master.m3u8',
            }),
    },
    {
        label: 'rejects a cross-platform subtitle CDN',
        message: () => createDisneyMessage({ url: NETFLIX_SUBTITLE_URL }),
    },
    {
        label: 'rejects the Disney edge CDN at initial request ingress',
        message: () =>
            createDisneyMessage({
                url: 'https://captions.dssedge.com/master.m3u8',
            }),
    },
    {
        label: 'rejects a lookalike subtitle CDN hostname',
        message: () =>
            createDisneyMessage({
                url: 'https://media.dssott.com.attacker.test/master.m3u8',
            }),
    },
    {
        label: 'rejects a URL above its length limit',
        message: () => {
            const prefix = 'https://captions.media.dssott.com/';
            return createDisneyMessage({
                url: `${prefix}${'a'.repeat(16 * 1024 + 1 - prefix.length)}`,
            });
        },
    },
    {
        label: 'rejects a URL whose canonical form expands past the limit',
        message: () =>
            createDisneyMessage({
                url: `https://captions.media.dssott.com/${'é'.repeat(3_000)}`,
            }),
    },
    {
        label: 'rejects a blank target language',
        message: () => createDisneyMessage({ targetLanguage: '   ' }),
    },
    {
        label: 'rejects an over-limit original language',
        message: () =>
            createDisneyMessage({ originalLanguage: 'o'.repeat(65) }),
    },
    {
        label: 'rejects a non-string language',
        message: () => createDisneyMessage({ targetLanguage: 17 }),
    },
];

describe('Disney request payload ingress', () => {
    test.each(disneyPayloadCases)(
        '$label',
        ({ message: createMessage, expectedUrl, expectedUrlLength }) => {
            const message = createMessage();
            if (!expectedUrl && !expectedUrlLength) {
                expectUnauthorized(
                    () =>
                        authorizeSubtitleRequest(
                            message,
                            createSender(DISNEY_PAGE_URL)
                        ),
                    SubtitleRequestSources.DISNEY_PLUS
                );
                return;
            }

            const expectedLanguages = {
                originalLanguage: message.originalLanguage,
                targetLanguage: message.targetLanguage,
            };
            const snapshot = authorizeSubtitleRequest(
                message,
                createSender(DISNEY_PAGE_URL)
            );
            expect(Object.keys(snapshot).sort()).toEqual(
                [
                    'action',
                    'source',
                    'tabId',
                    'videoId',
                    'url',
                    'targetLanguage',
                    'originalLanguage',
                ].sort()
            );
            expect(snapshot).toMatchObject(expectedLanguages);
            if (expectedUrl) expect(snapshot.url).toBe(expectedUrl);
            if (expectedUrlLength) {
                expect(snapshot.url).toHaveLength(expectedUrlLength);
            }

            message.url = 'https://attacker.test/mutated.vtt';
            message.targetLanguage = 'fr';
            expect(snapshot).toMatchObject(expectedLanguages);
            expect(Object.isFrozen(snapshot)).toBe(true);
        }
    );
});

const netflixPayloadCases = [
    {
        label: 'copies one direct track into a minimal immutable request',
        message: () => createNetflixMessage(),
        verify(snapshot, message) {
            const track = snapshot.data.tracks[0];
            expect(Object.keys(snapshot).sort()).toEqual(
                [
                    'action',
                    'source',
                    'tabId',
                    'videoId',
                    'targetLanguage',
                    'originalLanguage',
                    'useNativeSubtitles',
                    'useOfficialTranslations',
                    'data',
                ].sort()
            );
            expect(track).toMatchObject({
                language: 'en',
                displayName: 'English',
                trackType: 'PRIMARY',
                isNoneTrack: false,
                isForcedNarrative: false,
            });
            expect(track.ttDownloadables.dfxp.urls).toEqual([
                NETFLIX_SUBTITLE_URL,
            ]);
            expectCanonicalNetflixGraph(snapshot);

            message.data.tracks[0].language = 'fr';
            message.data.tracks[0].ttDownloadables.dfxp.urls[0].url =
                'https://attacker.test/mutated.ttml';
            expect(track.language).toBe('en');
            expect(track.ttDownloadables.dfxp.urls[0]).toBe(
                NETFLIX_SUBTITLE_URL
            );
        },
    },
    {
        label: 'supports rawTrack downloadUrls and defaults optional labels',
        message: () =>
            createNetflixMessage({
                data: {
                    tracks: [
                        {
                            language: 'fr',
                            rawTrack: {
                                ttDownloadables: {
                                    webvtt: {
                                        downloadUrls: [
                                            'https://captions.nflxvideo.net/show/fr.vtt',
                                        ],
                                    },
                                },
                            },
                            providerOnly: 'not retained',
                        },
                    ],
                },
            }),
        verify(snapshot) {
            expect(snapshot.data.tracks[0]).toEqual({
                language: 'fr',
                displayName: 'fr',
                isNoneTrack: false,
                isForcedNarrative: false,
                ttDownloadables: expect.any(Object),
            });
            expect(snapshot.data.tracks[0].ttDownloadables.webvtt.urls).toEqual(
                ['https://captions.nflxvideo.net/show/fr.vtt']
            );
        },
    },
    {
        label: 'drops none, forced, and unusable tracks while preserving usable order',
        message: () =>
            createNetflixMessage({
                data: {
                    tracks: [
                        { isNoneTrack: true },
                        { isForcedNarrative: true },
                        { language: 'de' },
                        createNetflixTrack(
                            'https://captions.nflxvideo.net/show/fr.ttml',
                            { language: 'fr', displayName: 'French' }
                        ),
                        createNetflixTrack(
                            'https://captions.nflxvideo.net/show/en.ttml'
                        ),
                    ],
                },
            }),
        verify(snapshot) {
            expect(snapshot.data.tracks.map((track) => track.language)).toEqual(
                ['fr', 'en']
            );
        },
    },
    {
        label: 'uses urls before downloadUrls and ignores later provider formats',
        message: () => {
            const track = createNetflixTrack();
            track.ttDownloadables = {
                selected: {
                    urls: ['https://captions.nflxvideo.net/selected.ttml#cue'],
                    downloadUrls: [
                        'https://captions.nflxvideo.net/not-selected.ttml',
                    ],
                },
                ignoredAfterSelection: 'provider-specific value',
            };
            return createNetflixMessage({ data: { tracks: [track] } });
        },
        verify(snapshot) {
            expect(
                snapshot.data.tracks[0].ttDownloadables.selected.urls
            ).toEqual(['https://captions.nflxvideo.net/selected.ttml']);
        },
    },
    {
        label: 'accepts track, format, URL-list, and track-count limits',
        message: () => {
            const formats = Object.fromEntries(
                Array.from({ length: 16 }, (_, index) => [
                    `format-${index}`,
                    index === 15
                        ? {
                              urls: Array.from(
                                  { length: 8 },
                                  (_unused, urlIndex) =>
                                      `https://captions.nflxvideo.net/${urlIndex}.ttml`
                              ),
                          }
                        : { urls: [] },
                ])
            );
            const limitedTrack = createNetflixTrack(undefined, {
                language: 'l'.repeat(64),
                displayName: 'd'.repeat(256),
                trackType: 't'.repeat(64),
                ttDownloadables: formats,
            });
            return createNetflixMessage({
                data: {
                    tracks: Array.from({ length: 128 }, () => limitedTrack),
                },
            });
        },
        verify(snapshot) {
            expect(snapshot.data.tracks).toHaveLength(128);
            const track = snapshot.data.tracks[0];
            expect(track.language).toHaveLength(64);
            expect(track.displayName).toHaveLength(256);
            expect(track.trackType).toHaveLength(64);
            expect(Object.keys(track.ttDownloadables)).toEqual(['format-15']);
            expect(track.ttDownloadables['format-15'].urls).toEqual([
                'https://captions.nflxvideo.net/0.ttml',
            ]);
        },
    },
    {
        label: 'rejects missing track data',
        message: () => createNetflixMessage({ data: {} }),
    },
    {
        label: 'rejects an empty track collection',
        message: () => createNetflixMessage({ data: { tracks: [] } }),
    },
    {
        label: 'rejects more than 128 tracks',
        message: () =>
            createNetflixMessage({
                data: {
                    tracks: Array.from({ length: 129 }, () =>
                        createNetflixTrack()
                    ),
                },
            }),
    },
    {
        label: 'rejects non-boolean subtitle selection flags',
        message: () => createNetflixMessage({ useOfficialTranslations: 'yes' }),
    },
    {
        label: 'rejects a malformed track',
        message: () =>
            createNetflixMessage({ data: { tracks: ['not-a-track'] } }),
    },
    {
        label: 'rejects an over-limit track language',
        message: () => {
            const track = createNetflixTrack();
            track.language = 'l'.repeat(65);
            return createNetflixMessage({ data: { tracks: [track] } });
        },
    },
    {
        label: 'rejects an over-limit display name',
        message: () => {
            const track = createNetflixTrack();
            track.displayName = 'd'.repeat(257);
            return createNetflixMessage({ data: { tracks: [track] } });
        },
    },
    {
        label: 'rejects more than 16 formats before selecting one',
        message: () => {
            const track = createNetflixTrack();
            track.ttDownloadables = Object.fromEntries(
                Array.from({ length: 17 }, (_, index) => [
                    `format-${index}`,
                    {
                        urls: [`https://captions.nflxvideo.net/${index}.ttml`],
                    },
                ])
            );
            return createNetflixMessage({ data: { tracks: [track] } });
        },
    },
    {
        label: 'rejects more than eight URLs in the selected format',
        message: () => {
            const track = createNetflixTrack();
            track.ttDownloadables.dfxp.urls = Array.from(
                { length: 9 },
                (_, index) => `https://captions.nflxvideo.net/${index}.ttml`
            );
            return createNetflixMessage({ data: { tracks: [track] } });
        },
    },
    {
        label: 'rejects a selected URL outside the Netflix CDN',
        message: () =>
            createNetflixMessage({
                data: {
                    tracks: [
                        createNetflixTrack(
                            'https://attacker.test/private.ttml'
                        ),
                    ],
                },
            }),
    },
    {
        label: 'rejects a request with no usable track URL',
        message: () =>
            createNetflixMessage({
                data: { tracks: [{ language: 'en' }] },
            }),
    },
];

describe('Netflix request payload ingress', () => {
    test.each(netflixPayloadCases)(
        '$label',
        ({ message: createMessage, verify }) => {
            const message = createMessage();
            if (!verify) {
                expectUnauthorized(
                    () =>
                        authorizeSubtitleRequest(
                            message,
                            createSender(NETFLIX_PAGE_URL)
                        ),
                    SubtitleRequestSources.NETFLIX
                );
                return;
            }

            const snapshot = authorizeSubtitleRequest(
                message,
                createSender(NETFLIX_PAGE_URL)
            );
            expect(snapshot).toMatchObject({
                action: MessageActions.FETCH_VTT,
                source: SubtitleRequestSources.NETFLIX,
                tabId: 17,
                videoId: '80123456',
            });
            expect(isAuthorizedSubtitleRequestSnapshot(snapshot)).toBe(true);
            expect(Object.isFrozen(snapshot)).toBe(true);
            verify(snapshot, message);
        }
    );
});

const urlBoundaryCases = [
    {
        label: 'derives the paired Disney edge URL without changing path or query',
        run: ({ disney }) =>
            getDisneySubtitleCdnCounterpartUrl(
                disney,
                'https://a.media.dssott.com/show/cue.vtt?token=abc',
                'vtt-segment'
            ),
        expected: 'https://a.dssedge.com/show/cue.vtt?token=abc',
    },
    {
        label: 'accepts an absolute Disney media CDN URL',
        run: ({ disney }) =>
            assertAllowedSubtitleUrl(
                disney,
                'https://a.media.dssott.com/show/cue.vtt#one',
                'vtt-segment'
            ),
        expected: 'https://a.media.dssott.com/show/cue.vtt',
    },
    {
        label: 'accepts a Disney edge CDN URL after ingress',
        run: ({ disney }) =>
            assertAllowedSubtitleUrl(
                disney,
                'https://captions.dssedge.com/show/media.m3u8',
                'disney-master'
            ),
        expected: 'https://captions.dssedge.com/show/media.m3u8',
    },
    {
        label: 'resolves a relative Disney segment on an allowed base',
        run: ({ disney }) =>
            resolveAllowedSubtitleUrl(
                disney,
                '../cue-1.vtt?token=abc#fragment',
                'https://a.media.dssott.com/show/tracks/index.m3u8',
                'vtt-segment'
            ),
        expected: 'https://a.media.dssott.com/show/cue-1.vtt?token=abc',
    },
    {
        label: 'accepts an absolute Netflix subtitle URL',
        run: ({ netflix }) =>
            assertAllowedSubtitleUrl(
                netflix,
                'https://nflxvideo.net/show/cue.ttml',
                'netflix-track'
            ),
        expected: 'https://nflxvideo.net/show/cue.ttml',
    },
    {
        label: 'rejects a value without canonical action and source routing',
        run: () =>
            assertAllowedSubtitleUrl(
                { source: SubtitleRequestSources.DISNEY_PLUS },
                DISNEY_SUBTITLE_URL,
                'segment'
            ),
        error: {
            code: 'ERR_SUBTITLE_REQUEST_UNAUTHORIZED',
            platform: 'unknown',
            stage: 'request',
        },
    },
    {
        label: 'rejects a cross-host absolute URL',
        run: ({ disney }) =>
            assertAllowedSubtitleUrl(
                disney,
                'https://attacker.test/private.vtt?token=sensitive-marker',
                'segment'
            ),
        error: {
            code: 'ERR_SUBTITLE_URL_NOT_ALLOWED',
            platform: SubtitleRequestSources.DISNEY_PLUS,
            stage: 'segment',
        },
        secret: 'sensitive-marker',
    },
    {
        label: 'rejects an insecure absolute URL',
        run: ({ netflix }) =>
            assertAllowedSubtitleUrl(
                netflix,
                'http://captions.nflxvideo.net/show/cue.ttml',
                'netflix-track'
            ),
        error: {
            code: 'ERR_SUBTITLE_URL_NOT_ALLOWED',
            platform: SubtitleRequestSources.NETFLIX,
            stage: 'netflix-track',
        },
    },
    {
        label: 'rejects a protocol-relative reference that escapes the CDN',
        run: ({ disney }) =>
            resolveAllowedSubtitleUrl(
                disney,
                '//attacker.test/private.vtt',
                DISNEY_SUBTITLE_URL,
                'segment'
            ),
        error: {
            code: 'ERR_SUBTITLE_URL_NOT_ALLOWED',
            platform: SubtitleRequestSources.DISNEY_PLUS,
            stage: 'segment',
        },
    },
    {
        label: 'rejects a relative reference above the URL length limit',
        run: ({ disney }) =>
            resolveAllowedSubtitleUrl(
                disney,
                'a'.repeat(16 * 1024 + 1),
                DISNEY_SUBTITLE_URL,
                'segment'
            ),
        error: {
            code: 'ERR_SUBTITLE_URL_INVALID',
            platform: SubtitleRequestSources.DISNEY_PLUS,
            stage: 'segment',
        },
    },
    {
        label: 'rejects a Netflix request to the Disney edge CDN',
        run: ({ netflix }) =>
            assertAllowedSubtitleUrl(
                netflix,
                'https://captions.dssedge.com/show/cue.vtt',
                'netflix-track'
            ),
        error: {
            code: 'ERR_SUBTITLE_URL_NOT_ALLOWED',
            platform: SubtitleRequestSources.NETFLIX,
            stage: 'netflix-track',
        },
    },
    {
        label: 'normalizes an invalid public error stage',
        run: ({ disney }) =>
            assertAllowedSubtitleUrl(
                disney,
                'https://attacker.test/private.vtt',
                'segment?sensitive-marker'
            ),
        error: {
            code: 'ERR_SUBTITLE_URL_NOT_ALLOWED',
            platform: SubtitleRequestSources.DISNEY_PLUS,
            stage: 'unknown',
        },
        secret: 'sensitive-marker',
    },
];

describe('canonical subtitle URL transport boundary', () => {
    test.each(urlBoundaryCases)(
        '$label',
        ({ run, expected, error: expectedError, secret }) => {
            const snapshots = {
                disney: authorizeSubtitleRequest(
                    createDisneyMessage(),
                    createSender(DISNEY_PAGE_URL)
                ),
                netflix: authorizeSubtitleRequest(
                    createNetflixMessage(),
                    createSender(NETFLIX_PAGE_URL)
                ),
            };

            if (expected) {
                expect(run(snapshots)).toBe(expected);
                return;
            }

            let error;
            try {
                run(snapshots);
            } catch (caughtError) {
                error = caughtError;
            }
            expect(error).toMatchObject({
                name: 'SubtitleRequestPolicyError',
                message: 'Subtitle request rejected by policy.',
                ...expectedError,
            });
            if (secret) {
                expect(String(error)).not.toContain(secret);
                expect(JSON.stringify(error)).not.toContain(secret);
            }
        }
    );
});
