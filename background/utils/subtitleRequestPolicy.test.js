import { afterAll, beforeEach, describe, expect, test } from '@jest/globals';
import {
    MessageActions,
    SubtitleRequestSources,
} from '../../content_scripts/shared/constants/messageActions.js';
import {
    extractDisneyPlusVideoIdFromUrl,
    extractNetflixVideoIdFromUrl,
    normalizeDisneyPlusVideoId,
} from '../../content_scripts/shared/subtitleRequestIdentity.js';
import {
    assertAllowedSubtitleUrl,
    authorizeSubtitleRequest,
    isAuthorizedSubtitleRequestSnapshot,
    resolveAllowedSubtitleUrl,
} from './subtitleRequestPolicy.js';

const TEST_EXTENSION_ID = 'dualsub-test-extension-id';
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

function createSender(url, overrides = {}) {
    return {
        id: TEST_EXTENSION_ID,
        tab: { id: 17, url },
        frameId: 0,
        url,
        origin: new URL(url).origin,
        ...overrides,
    };
}

function createDisneyMessage(overrides = {}) {
    return {
        action: MessageActions.FETCH_VTT,
        source: SubtitleRequestSources.DISNEY_PLUS,
        url: 'https://captions.media.dssott.com/show/master.m3u8',
        videoId: 'episode-123',
        targetLanguage: 'zh-CN',
        originalLanguage: 'en',
        ...overrides,
    };
}

function createNetflixTrack(
    url = 'https://captions.nflxvideo.net/show/en.ttml'
) {
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

function expectUnauthorized(callback, platform = 'unknown') {
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

function expectRecursivelyFrozen(value, seen = new Set()) {
    if (value === null || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    expect(Object.isFrozen(value)).toBe(true);
    for (const key of Reflect.ownKeys(value)) {
        expectRecursivelyFrozen(value[key], seen);
    }
}

function defineThrowingAccessor(record, key, onInvoke) {
    Object.defineProperty(record, key, {
        configurable: true,
        enumerable: true,
        get() {
            onInvoke();
            throw new Error(`secret accessor: ${String(key)}`);
        },
    });
}

function defineDangerousOwnKey(record, key) {
    Object.defineProperty(record, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: 'attacker-controlled',
    });
}

function createAsciiUrlAtByteLength(origin, byteLength) {
    const prefix = `${origin}/`;
    return `${prefix}${'a'.repeat(byteLength - prefix.length)}`;
}

const disneyAsciiBoundary = 'a'.repeat(256);
const disneyMultibyteBoundary = 'é'.repeat(128);
const netflixBoundary = '7'.repeat(256);
const identityParityCases = [
    {
        label: 'Disney root video route',
        source: SubtitleRequestSources.DISNEY_PLUS,
        pageUrl: 'https://www.disneyplus.com/video/opaque-id',
        wireId: 'opaque-id',
        expectedId: 'opaque-id',
    },
    {
        label: 'Disney localized video route',
        source: SubtitleRequestSources.DISNEY_PLUS,
        pageUrl: 'https://www.disneyplus.com/en-gb/video/opaque-id',
        wireId: 'opaque-id',
        expectedId: 'opaque-id',
    },
    {
        label: 'Disney prefixed play route with one decode',
        source: SubtitleRequestSources.DISNEY_PLUS,
        pageUrl: 'https://www.disneyplus.com/fr-fr/browse/play/opaque%20id/',
        wireId: 'opaque id',
        expectedId: 'opaque id',
    },
    {
        label: 'Disney canonical literal percent',
        source: SubtitleRequestSources.DISNEY_PLUS,
        pageUrl: 'https://www.disneyplus.com/play/price%25off',
        wireId: 'price%off',
        expectedId: 'price%off',
    },
    {
        label: 'Disney canonical trailing percent',
        source: SubtitleRequestSources.DISNEY_PLUS,
        pageUrl: 'https://www.disneyplus.com/play/trailing%25',
        wireId: 'trailing%',
        expectedId: 'trailing%',
    },
    {
        label: 'Disney non-escape percent survives one decode',
        source: SubtitleRequestSources.DISNEY_PLUS,
        pageUrl: 'https://www.disneyplus.com/play/value%252G',
        wireId: 'value%2G',
        expectedId: 'value%2G',
    },
    {
        label: 'Disney exact 256 ASCII-byte identity',
        source: SubtitleRequestSources.DISNEY_PLUS,
        pageUrl: `https://www.disneyplus.com/play/${disneyAsciiBoundary}`,
        wireId: disneyAsciiBoundary,
        expectedId: disneyAsciiBoundary,
    },
    {
        label: 'Disney exact 256 multibyte identity',
        source: SubtitleRequestSources.DISNEY_PLUS,
        pageUrl: `https://www.disneyplus.com/play/${encodeURIComponent(disneyMultibyteBoundary)}`,
        wireId: disneyMultibyteBoundary,
        expectedId: disneyMultibyteBoundary,
    },
    ...[
        ['residual encoded slash', 'opaque%252Fid', 'opaque%2Fid'],
        ['residual encoded backslash', 'opaque%255Cid', 'opaque%5Cid'],
        ['residual encoded dots', '%252e%252e', '%2e%2e'],
        ['residual encoded A', '%2541', '%41'],
        ['residual encoded NUL', '%2500', '%00'],
        ['decoded slash', 'folder%2Fepisode', 'folder/episode'],
        ['decoded backslash', 'folder%5Cepisode', 'folder\\episode'],
        ['decoded C0 control', 'bad%00id', 'bad\0id'],
        ['decoded C1 control', 'bad%C2%80id', 'bad\u0080id'],
        ['blank identity', '%20%20', '  '],
        ['unknown identity', 'unknown_video_123', 'unknown_video_123'],
        ['over 256 ASCII bytes', 'a'.repeat(257), 'a'.repeat(257)],
        [
            'over 256 multibyte bytes',
            encodeURIComponent('é'.repeat(129)),
            'é'.repeat(129),
        ],
    ].map(([label, routeId, wireId]) => ({
        label: `Disney rejects ${label}`,
        source: SubtitleRequestSources.DISNEY_PLUS,
        pageUrl: `https://www.disneyplus.com/play/${routeId}`,
        wireId,
        expectedId: null,
    })),
    {
        label: 'Disney rejects malformed percent encoding',
        source: SubtitleRequestSources.DISNEY_PLUS,
        pageUrl: 'https://www.disneyplus.com/play/bad%',
        wireId: 'bad%',
        expectedId: null,
    },
    {
        label: 'Disney rejects a nonterminal player route',
        source: SubtitleRequestSources.DISNEY_PLUS,
        pageUrl: 'https://www.disneyplus.com/play/opaque-id/extra',
        wireId: 'opaque-id',
        expectedId: null,
    },
    {
        label: 'Disney rejects an encoded wire id after A1 canonicalization',
        source: SubtitleRequestSources.DISNEY_PLUS,
        pageUrl: 'https://www.disneyplus.com/play/episode%20one',
        wireId: 'episode%20one',
        expectedId: 'episode one',
        authorized: false,
    },
    {
        label: 'Disney rejects a lone-surrogate wire identity',
        source: SubtitleRequestSources.DISNEY_PLUS,
        pageUrl: 'https://www.disneyplus.com/play/%EF%BF%BD',
        wireId: '\ud800',
        expectedId: '�',
        authorized: false,
        wireNormalization: null,
    },
    {
        label: 'Netflix exact watch route',
        source: SubtitleRequestSources.NETFLIX,
        pageUrl: 'https://www.netflix.com/watch/80123456',
        wireId: '80123456',
        expectedId: '80123456',
    },
    {
        label: 'Netflix optional trailing slash and leading zeros',
        source: SubtitleRequestSources.NETFLIX,
        pageUrl: 'https://www.netflix.com/watch/000123/',
        wireId: '000123',
        expectedId: '000123',
    },
    {
        label: 'Netflix exact 256-byte identity',
        source: SubtitleRequestSources.NETFLIX,
        pageUrl: `https://www.netflix.com/watch/${netflixBoundary}`,
        wireId: netflixBoundary,
        expectedId: netflixBoundary,
    },
    ...[
        ['localized prefix', '/en/watch/80123456', '80123456'],
        ['browse prefix', '/browse/watch/80123456', '80123456'],
        ['suffix', '/watch/80123456/extra', '80123456'],
        ['encoded digit', '/watch/%31', '1'],
        ['nondigit', '/watch/not-digits', 'not-digits'],
        ['over 256 bytes', `/watch/${'8'.repeat(257)}`, '8'.repeat(257)],
    ].map(([label, pathname, wireId]) => ({
        label: `Netflix rejects ${label}`,
        source: SubtitleRequestSources.NETFLIX,
        pageUrl: `https://www.netflix.com${pathname}`,
        wireId,
        expectedId: null,
    })),
    {
        label: 'Netflix rejects a numeric noncanonical wire id',
        source: SubtitleRequestSources.NETFLIX,
        pageUrl: 'https://www.netflix.com/watch/80123456',
        wireId: 80123456,
        expectedId: '80123456',
        authorized: false,
    },
];

describe('subtitle request policy', () => {
    test('copies a legitimate Disney request into a branded frozen snapshot', () => {
        const message = createDisneyMessage();
        const sender = createSender(
            'https://www.disneyplus.com/en-gb/play/episode-123'
        );

        const snapshot = authorizeSubtitleRequest(message, sender);

        expect(snapshot).toEqual({
            action: MessageActions.FETCH_VTT,
            source: SubtitleRequestSources.DISNEY_PLUS,
            tabId: 17,
            videoId: 'episode-123',
            url: 'https://captions.media.dssott.com/show/master.m3u8',
            targetLanguage: 'zh-CN',
            originalLanguage: 'en',
        });
        expect(snapshot).not.toBe(message);
        expect(Object.isFrozen(snapshot)).toBe(true);
        expect(isAuthorizedSubtitleRequestSnapshot(snapshot)).toBe(true);
        expect(isAuthorizedSubtitleRequestSnapshot({ ...snapshot })).toBe(
            false
        );
    });

    test('accepts the already-canonical Disney wire id without decoding it again', () => {
        const snapshot = authorizeSubtitleRequest(
            createDisneyMessage({ videoId: 'price%off' }),
            createSender('https://www.disneyplus.com/play/price%25off')
        );

        expect(snapshot.videoId).toBe('price%off');
    });

    test('copies one legitimate Netflix track into a minimal branded snapshot', () => {
        const message = createNetflixMessage();
        const snapshot = authorizeSubtitleRequest(
            message,
            createSender('https://www.netflix.com/watch/80123456')
        );

        expect(snapshot).toEqual({
            action: MessageActions.FETCH_VTT,
            source: SubtitleRequestSources.NETFLIX,
            tabId: 17,
            videoId: '80123456',
            targetLanguage: 'zh-CN',
            originalLanguage: 'en',
            useNativeSubtitles: true,
            useOfficialTranslations: true,
            data: {
                tracks: [
                    {
                        language: 'en',
                        displayName: 'English',
                        trackType: 'PRIMARY',
                        isNoneTrack: false,
                        isForcedNarrative: false,
                        ttDownloadables: {
                            dfxp: {
                                urls: [
                                    'https://captions.nflxvideo.net/show/en.ttml',
                                ],
                            },
                        },
                    },
                ],
            },
        });
        expect(snapshot.data).not.toBe(message.data);
        expect(snapshot.data.tracks).not.toBe(message.data.tracks);
        expect(snapshot.data.tracks[0]).not.toBe(message.data.tracks[0]);
        expect(Object.isFrozen(snapshot.data.tracks[0])).toBe(true);
        expect(Object.isFrozen(snapshot.data.tracks[0].ttDownloadables)).toBe(
            true
        );
        expect(isAuthorizedSubtitleRequestSnapshot(snapshot)).toBe(true);
    });

    test.each(identityParityCases)(
        'uses the shared route identity grammar: $label',
        ({
            source,
            pageUrl,
            wireId,
            expectedId,
            authorized = expectedId !== null,
            wireNormalization,
        }) => {
            const extractedId =
                source === SubtitleRequestSources.DISNEY_PLUS
                    ? extractDisneyPlusVideoIdFromUrl(pageUrl)
                    : extractNetflixVideoIdFromUrl(pageUrl);
            expect(extractedId).toBe(expectedId);
            if (wireNormalization !== undefined) {
                expect(normalizeDisneyPlusVideoId(wireId)).toBe(
                    wireNormalization
                );
            }

            const message =
                source === SubtitleRequestSources.DISNEY_PLUS
                    ? createDisneyMessage({ videoId: wireId })
                    : createNetflixMessage({ videoId: wireId });
            if (authorized) {
                expect(
                    authorizeSubtitleRequest(message, createSender(pageUrl))
                        .videoId
                ).toBe(expectedId);
            } else {
                expectUnauthorized(
                    () =>
                        authorizeSubtitleRequest(
                            message,
                            createSender(pageUrl)
                        ),
                    source
                );
            }
        }
    );

    test('uses the live Disney tab route after same-document navigation', () => {
        const sender = createSender(
            'https://www.disneyplus.com/en-gb/play/episode-a?sender=1'
        );
        sender.tab.url =
            'https://www.disneyplus.com/en-gb/video/episode-123?tab=1';

        expect(
            authorizeSubtitleRequest(createDisneyMessage(), sender).videoId
        ).toBe('episode-123');
    });

    test('uses the live Netflix tab route after same-document navigation', () => {
        const sender = createSender(
            'https://www.netflix.com/watch/80000001?sender=1'
        );
        sender.tab.url = 'https://www.netflix.com/watch/80123456?tab=1';

        expect(
            authorizeSubtitleRequest(createNetflixMessage(), sender).videoId
        ).toBe('80123456');
    });

    test('accepts an absent optional origin and a maximum safe tab id', () => {
        const sender = createSender(
            'https://DISNEYPLUS.COM:443/play/episode-123'
        );
        sender.tab.id = Number.MAX_SAFE_INTEGER;
        delete sender.origin;

        expect(
            authorizeSubtitleRequest(createDisneyMessage(), sender).tabId
        ).toBe(Number.MAX_SAFE_INTEGER);
    });

    test('accepts zero as the nonnegative tab id lower bound', () => {
        const sender = createSender(
            'https://www.disneyplus.com/play/episode-123'
        );
        sender.tab.id = 0;

        expect(
            authorizeSubtitleRequest(createDisneyMessage(), sender).tabId
        ).toBe(0);
    });

    test('accepts the exact Netflix page base with an explicit default port', () => {
        expect(
            authorizeSubtitleRequest(
                createNetflixMessage(),
                createSender('https://NETFLIX.COM:443/watch/80123456')
            ).videoId
        ).toBe('80123456');
    });

    test.each([
        ['missing tab', (sender) => delete sender.tab],
        ['missing extension id', (sender) => delete sender.id],
        ['empty extension id', (sender) => (sender.id = '')],
        ['wrong extension id', (sender) => (sender.id = 'attacker-extension')],
        ['non-string extension id', (sender) => (sender.id = 17)],
        ['non-record tab', (sender) => (sender.tab = 17)],
        ['missing tab id', (sender) => delete sender.tab.id],
        ['negative tab id', (sender) => (sender.tab.id = -1)],
        ['fractional tab id', (sender) => (sender.tab.id = 1.5)],
        ['NaN tab id', (sender) => (sender.tab.id = Number.NaN)],
        [
            'infinite tab id',
            (sender) => (sender.tab.id = Number.POSITIVE_INFINITY),
        ],
        [
            'unsafe tab id',
            (sender) => (sender.tab.id = Number.MAX_SAFE_INTEGER + 1),
        ],
        ['string tab id', (sender) => (sender.tab.id = '17')],
        ['missing frame id', (sender) => delete sender.frameId],
        ['non-top frame', (sender) => (sender.frameId = 1)],
        ['string frame id', (sender) => (sender.frameId = '0')],
        ['missing sender URL', (sender) => delete sender.url],
        ['missing tab URL', (sender) => delete sender.tab.url],
    ])('rejects invalid sender proof: %s', (_label, mutateSender) => {
        const sender = createSender(
            'https://www.disneyplus.com/play/episode-123'
        );
        mutateSender(sender);

        expectUnauthorized(
            () => authorizeSubtitleRequest(createDisneyMessage(), sender),
            SubtitleRequestSources.DISNEY_PLUS
        );
    });

    test.each([
        'not a URL',
        '/play/episode-123',
        'http://www.disneyplus.com/play/episode-123',
        'https://user:secret@www.disneyplus.com/play/episode-123',
        'https://www.disneyplus.com:444/play/episode-123',
        'https://disneyplus.com./play/episode-123',
        'https://disneyplus.com.attacker.test/play/episode-123',
        'https://evildisneyplus.com/play/episode-123',
        'https://127.0.0.1/play/episode-123',
        'https://dіsneyplus.com/play/episode-123',
        `chrome-extension://${TEST_EXTENSION_ID}/options/options.html`,
    ])('rejects an unsafe sender URL authority: %s', (url) => {
        const sender = createSender(
            'https://www.disneyplus.com/play/episode-123'
        );
        sender.url = url;
        sender.tab.url = url;
        delete sender.origin;

        expectUnauthorized(
            () => authorizeSubtitleRequest(createDisneyMessage(), sender),
            SubtitleRequestSources.DISNEY_PLUS
        );
    });

    test.each([
        'not a URL',
        '/watch/80123456',
        'http://www.netflix.com/watch/80123456',
        'https://user:secret@www.netflix.com/watch/80123456',
        'https://www.netflix.com:444/watch/80123456',
        'https://netflix.com./watch/80123456',
        'https://netflix.com.attacker.test/watch/80123456',
        'https://evilnetflix.com/watch/80123456',
        'https://127.0.0.1/watch/80123456',
        'https://netflіx.com/watch/80123456',
        `chrome-extension://${TEST_EXTENSION_ID}/options/options.html`,
    ])('rejects an unsafe Netflix sender authority: %s', (url) => {
        const sender = createSender('https://www.netflix.com/watch/80123456');
        sender.url = url;
        sender.tab.url = url;
        delete sender.origin;

        expectUnauthorized(
            () => authorizeSubtitleRequest(createNetflixMessage(), sender),
            SubtitleRequestSources.NETFLIX
        );
    });

    test.each([
        ['opaque origin', 'null'],
        ['foreign origin', 'https://attacker.test'],
        ['origin with path separator', 'https://www.disneyplus.com/'],
        ['noncanonical capitalization', 'HTTPS://WWW.DISNEYPLUS.COM'],
        ['non-string origin', 17],
    ])('rejects a non-exact optional origin: %s', (_label, origin) => {
        const sender = createSender(
            'https://www.disneyplus.com/play/episode-123'
        );
        sender.origin = origin;

        expectUnauthorized(
            () => authorizeSubtitleRequest(createDisneyMessage(), sender),
            SubtitleRequestSources.DISNEY_PLUS
        );
    });

    test.each([
        [
            'sender and tab origins differ',
            (sender) => {
                sender.url = 'https://player.disneyplus.com/play/episode-123';
                delete sender.origin;
            },
        ],
        [
            'tab route differs',
            (sender) => {
                sender.tab.url =
                    'https://www.disneyplus.com/play/episode-other';
            },
        ],
    ])('rejects inconsistent live sender proof: %s', (_label, mutate) => {
        const sender = createSender(
            'https://www.disneyplus.com/play/episode-123'
        );
        mutate(sender);

        expectUnauthorized(
            () => authorizeSubtitleRequest(createDisneyMessage(), sender),
            SubtitleRequestSources.DISNEY_PLUS
        );
    });

    test('does not let broad optional provider permission bypass fixed subtitle CDNs', () => {
        const originalPermissions = globalThis.chrome.permissions;
        let permissionChecks = 0;
        globalThis.chrome.permissions = {
            contains() {
                permissionChecks += 1;
                return Promise.resolve(true);
            },
        };

        try {
            expectUnauthorized(
                () =>
                    authorizeSubtitleRequest(
                        createDisneyMessage({
                            url: 'https://custom-provider.example/subtitles/master.m3u8',
                        }),
                        createSender(
                            'https://www.disneyplus.com/play/episode-123'
                        )
                    ),
                SubtitleRequestSources.DISNEY_PLUS
            );

            const netflixMessage = createNetflixMessage();
            netflixMessage.data.tracks[0].ttDownloadables.dfxp.urls[0].url =
                'https://custom-provider.example/subtitles/en.ttml';
            expectUnauthorized(
                () =>
                    authorizeSubtitleRequest(
                        netflixMessage,
                        createSender('https://www.netflix.com/watch/80123456')
                    ),
                SubtitleRequestSources.NETFLIX
            );
        } finally {
            if (originalPermissions === undefined) {
                delete globalThis.chrome.permissions;
            } else {
                globalThis.chrome.permissions = originalPermissions;
            }
        }

        expect(permissionChecks).toBe(0);
    });

    test.each([
        [
            SubtitleRequestSources.DISNEY_PLUS,
            () => createDisneyMessage(),
            'https://www.disneyplus.com/play/episode-123',
        ],
        [
            SubtitleRequestSources.NETFLIX,
            () => createNetflixMessage(),
            'https://www.netflix.com/watch/80123456',
        ],
    ])(
        'rejects leaked page-channel authority on the %s runtime route',
        (source, createMessage, pageUrl) => {
            const message = createMessage();
            message.dualsubChannel = {
                platform: source,
                capability: 'a'.repeat(64),
            };

            expectUnauthorized(
                () => authorizeSubtitleRequest(message, createSender(pageUrl)),
                source
            );
        }
    );

    test.each([
        [
            'missing action',
            () => {
                const message = createDisneyMessage();
                delete message.action;
                return message;
            },
            'https://www.disneyplus.com/play/episode-123',
            SubtitleRequestSources.DISNEY_PLUS,
        ],
        [
            'wrong action',
            () => createDisneyMessage({ action: 'translate' }),
            'https://www.disneyplus.com/play/episode-123',
            SubtitleRequestSources.DISNEY_PLUS,
        ],
        [
            'missing source',
            () => {
                const message = createDisneyMessage();
                delete message.source;
                return message;
            },
            'https://www.disneyplus.com/play/episode-123',
            'unknown',
        ],
        [
            'Disney source on Netflix page',
            () => createDisneyMessage(),
            'https://www.netflix.com/watch/80123456',
            SubtitleRequestSources.DISNEY_PLUS,
        ],
        [
            'Netflix source on Disney page',
            () => createNetflixMessage(),
            'https://www.disneyplus.com/play/episode-123',
            SubtitleRequestSources.NETFLIX,
        ],
        [
            'unexpected message field',
            () => createDisneyMessage({ data: undefined }),
            'https://www.disneyplus.com/play/episode-123',
            SubtitleRequestSources.DISNEY_PLUS,
        ],
    ])(
        'rejects an action/source union mismatch: %s',
        (_label, makeMessage, pageUrl, platform) => {
            expectUnauthorized(
                () =>
                    authorizeSubtitleRequest(
                        makeMessage(),
                        createSender(pageUrl)
                    ),
                platform
            );
        }
    );

    test.each([
        [
            'null message',
            null,
            createSender('https://www.disneyplus.com/play/episode-123'),
            'unknown',
        ],
        [
            'array message',
            [],
            createSender('https://www.disneyplus.com/play/episode-123'),
            'unknown',
        ],
        [
            'null sender',
            createDisneyMessage(),
            null,
            SubtitleRequestSources.DISNEY_PLUS,
        ],
        [
            'array sender',
            createDisneyMessage(),
            [],
            SubtitleRequestSources.DISNEY_PLUS,
        ],
    ])(
        'safely rejects a malformed top-level shape: %s',
        (_label, message, sender, platform) => {
            expectUnauthorized(
                () => authorizeSubtitleRequest(message, sender),
                platform
            );
        }
    );

    test.each([
        [
            'Disney numeric video id',
            () => createDisneyMessage({ videoId: 123 }),
            'https://www.disneyplus.com/play/123',
            SubtitleRequestSources.DISNEY_PLUS,
        ],
        [
            'Disney missing URL',
            () => {
                const message = createDisneyMessage();
                delete message.url;
                return message;
            },
            'https://www.disneyplus.com/play/episode-123',
            SubtitleRequestSources.DISNEY_PLUS,
        ],
        [
            'Disney missing original language',
            () => {
                const message = createDisneyMessage();
                delete message.originalLanguage;
                return message;
            },
            'https://www.disneyplus.com/play/episode-123',
            SubtitleRequestSources.DISNEY_PLUS,
        ],
        [
            'Netflix unexpected URL field',
            () => createNetflixMessage({ url: undefined }),
            'https://www.netflix.com/watch/80123456',
            SubtitleRequestSources.NETFLIX,
        ],
        [
            'Netflix missing data',
            () => {
                const message = createNetflixMessage();
                delete message.data;
                return message;
            },
            'https://www.netflix.com/watch/80123456',
            SubtitleRequestSources.NETFLIX,
        ],
        [
            'Netflix missing tracks',
            () => createNetflixMessage({ data: {} }),
            'https://www.netflix.com/watch/80123456',
            SubtitleRequestSources.NETFLIX,
        ],
        [
            'Netflix empty tracks',
            () => createNetflixMessage({ data: { tracks: [] } }),
            'https://www.netflix.com/watch/80123456',
            SubtitleRequestSources.NETFLIX,
        ],
    ])(
        'rejects an incomplete source union: %s',
        (_label, makeMessage, pageUrl, platform) => {
            expectUnauthorized(
                () =>
                    authorizeSubtitleRequest(
                        makeMessage(),
                        createSender(pageUrl)
                    ),
                platform
            );
        }
    );

    test('deep-freezes the entire fresh Netflix graph and ignores later raw mutation', () => {
        const message = createNetflixMessage();
        const rawTrack = message.data.tracks[0];
        const snapshot = authorizeSubtitleRequest(
            message,
            createSender('https://www.netflix.com/watch/80123456')
        );

        expectRecursivelyFrozen(snapshot);
        rawTrack.language = 'attacker-language';
        rawTrack.displayName = 'attacker-display';
        rawTrack.ttDownloadables.dfxp.urls[0].url =
            'https://attacker.test/secret';
        message.videoId = '999';
        message.data.tracks.push(createNetflixTrack());

        expect(snapshot.videoId).toBe('80123456');
        expect(snapshot.data.tracks).toHaveLength(1);
        expect(snapshot.data.tracks[0]).toEqual(
            expect.objectContaining({
                language: 'en',
                displayName: 'English',
            })
        );
        expect(snapshot.data.tracks[0].ttDownloadables.dfxp.urls).toEqual([
            'https://captions.nflxvideo.net/show/en.ttml',
        ]);
        expect(
            Object.getPrototypeOf(snapshot.data.tracks[0].ttDownloadables)
        ).toBe(null);
    });

    test('brands only the exact minted snapshot identity', () => {
        const snapshot = authorizeSubtitleRequest(
            createDisneyMessage(),
            createSender('https://www.disneyplus.com/play/episode-123')
        );
        const lookalikes = [
            { ...snapshot },
            Object.freeze({ ...snapshot }),
            JSON.parse(JSON.stringify(snapshot)),
            snapshot.url,
            snapshot.videoId,
            null,
        ];
        if (typeof structuredClone === 'function') {
            lookalikes.push(structuredClone(snapshot));
        }

        for (const lookalike of lookalikes) {
            expect(isAuthorizedSubtitleRequestSnapshot(lookalike)).toBe(false);
        }
        expect(
            isAuthorizedSubtitleRequestSnapshot(new Proxy(snapshot, {}))
        ).toBe(false);

        let trapped = false;
        const hostileLookalike = new Proxy(
            {},
            {
                get() {
                    trapped = true;
                    throw new Error('brand getter secret');
                },
                ownKeys() {
                    trapped = true;
                    throw new Error('brand ownKeys secret');
                },
            }
        );
        expect(isAuthorizedSubtitleRequestSnapshot(hostileLookalike)).toBe(
            false
        );
        expect(trapped).toBe(false);
    });

    test('rejects every branded-sink lookalike before URL handling', () => {
        const snapshot = authorizeSubtitleRequest(
            createDisneyMessage(),
            createSender('https://www.disneyplus.com/play/episode-123')
        );
        const lookalikes = [
            { ...snapshot },
            Object.freeze({ ...snapshot }),
            JSON.parse(JSON.stringify(snapshot)),
            new Proxy(snapshot, {}),
        ];
        if (typeof structuredClone === 'function') {
            lookalikes.push(structuredClone(snapshot));
        }
        const revoked = Proxy.revocable(snapshot, {});
        revoked.revoke();
        lookalikes.push(revoked.proxy);

        for (const lookalike of lookalikes) {
            expectUnauthorized(() =>
                assertAllowedSubtitleUrl(
                    lookalike,
                    'https://captions.media.dssott.com/never-parsed.vtt',
                    'segment'
                )
            );
        }
    });

    test('copies a behaviorally transparent proxy once without retaining it', () => {
        const rawMessage = createDisneyMessage();
        const transparentProxy = new Proxy(rawMessage, {});
        const snapshot = authorizeSubtitleRequest(
            transparentProxy,
            createSender('https://www.disneyplus.com/play/episode-123')
        );

        rawMessage.url = 'https://attacker.test/secret';
        expect(snapshot.url).toBe(
            'https://captions.media.dssott.com/show/master.m3u8'
        );
        expect(snapshot).not.toBe(transparentProxy);
        expect(isAuthorizedSubtitleRequestSnapshot(transparentProxy)).toBe(
            false
        );
    });

    test.each([
        [
            'message source',
            (message, define) => define(message, 'source'),
            'unknown',
        ],
        [
            'message data',
            (message, define) => define(message, 'data'),
            SubtitleRequestSources.NETFLIX,
        ],
        [
            'data tracks',
            (message, define) => define(message.data, 'tracks'),
            SubtitleRequestSources.NETFLIX,
        ],
        [
            'track array index',
            (message, define) => define(message.data.tracks, '0'),
            SubtitleRequestSources.NETFLIX,
        ],
        [
            'track language',
            (message, define) => define(message.data.tracks[0], 'language'),
            SubtitleRequestSources.NETFLIX,
        ],
        [
            'track flag',
            (message, define) => define(message.data.tracks[0], 'isNoneTrack'),
            SubtitleRequestSources.NETFLIX,
        ],
        [
            'direct downloadables',
            (message, define) =>
                define(message.data.tracks[0], 'ttDownloadables'),
            SubtitleRequestSources.NETFLIX,
        ],
        [
            'format value',
            (message, define) =>
                define(message.data.tracks[0].ttDownloadables, 'dfxp'),
            SubtitleRequestSources.NETFLIX,
        ],
        [
            'URL list',
            (message, define) =>
                define(message.data.tracks[0].ttDownloadables.dfxp, 'urls'),
            SubtitleRequestSources.NETFLIX,
        ],
        [
            'URL list index',
            (message, define) =>
                define(message.data.tracks[0].ttDownloadables.dfxp.urls, '0'),
            SubtitleRequestSources.NETFLIX,
        ],
        [
            'URL object field',
            (message, define) =>
                define(
                    message.data.tracks[0].ttDownloadables.dfxp.urls[0],
                    'url'
                ),
            SubtitleRequestSources.NETFLIX,
        ],
        [
            'raw fallback downloadables',
            (message, define) => {
                const track = message.data.tracks[0];
                track.rawTrack = { ttDownloadables: track.ttDownloadables };
                delete track.ttDownloadables;
                define(track.rawTrack, 'ttDownloadables');
            },
            SubtitleRequestSources.NETFLIX,
        ],
    ])(
        'rejects an accessor without invoking it: %s',
        (_label, installAccessor, platform) => {
            const message = createNetflixMessage();
            let invoked = false;
            installAccessor(message, (record, key) =>
                defineThrowingAccessor(record, key, () => {
                    invoked = true;
                })
            );

            expectUnauthorized(
                () =>
                    authorizeSubtitleRequest(
                        message,
                        createSender('https://www.netflix.com/watch/80123456')
                    ),
                platform
            );
            expect(invoked).toBe(false);
        }
    );

    test('rejects sender accessors and revoked proxies without leaking trap details', () => {
        const sender = createSender(
            'https://www.disneyplus.com/play/episode-123'
        );
        let invoked = false;
        defineThrowingAccessor(sender, 'url', () => {
            invoked = true;
        });
        expectUnauthorized(
            () => authorizeSubtitleRequest(createDisneyMessage(), sender),
            SubtitleRequestSources.DISNEY_PLUS
        );
        expect(invoked).toBe(false);

        const { proxy, revoke } = Proxy.revocable(createDisneyMessage(), {});
        revoke();
        let error;
        try {
            authorizeSubtitleRequest(
                proxy,
                createSender('https://www.disneyplus.com/play/episode-123')
            );
        } catch (caughtError) {
            error = caughtError;
        }
        expect(error).toEqual(
            expect.objectContaining({
                code: 'ERR_SUBTITLE_REQUEST_UNAUTHORIZED',
                platform: 'unknown',
            })
        );
        expect(error.message).toBe('Subtitle request rejected by policy.');
        expect(String(error)).toBe(
            'SubtitleRequestPolicyError: Subtitle request rejected by policy.'
        );
        expect(JSON.stringify(error)).not.toContain('revoked');
        expect(error.stack).not.toContain('revoked');
    });

    test('translates a nested throwing proxy into one fixed non-leaking error', () => {
        const message = createNetflixMessage();
        message.data = new Proxy(message.data, {
            ownKeys() {
                throw new Error('nested-proxy-secret');
            },
        });

        let error;
        try {
            authorizeSubtitleRequest(
                message,
                createSender('https://www.netflix.com/watch/80123456')
            );
        } catch (caughtError) {
            error = caughtError;
        }
        expect(error).toEqual(
            expect.objectContaining({
                code: 'ERR_SUBTITLE_REQUEST_UNAUTHORIZED',
                platform: SubtitleRequestSources.NETFLIX,
                stage: 'request',
            })
        );
        expect(error.message).toBe('Subtitle request rejected by policy.');
        expect(String(error)).toBe(
            'SubtitleRequestPolicyError: Subtitle request rejected by policy.'
        );
        expect(JSON.stringify(error)).not.toContain('nested-proxy-secret');
        expect(error.stack).not.toContain('nested-proxy-secret');
    });

    test('rejects an inherited or accessor sender id without invoking it', () => {
        const pageUrl = 'https://www.disneyplus.com/play/episode-123';
        const inheritedSender = Object.create({ id: TEST_EXTENSION_ID });
        Object.assign(inheritedSender, createSender(pageUrl));
        delete inheritedSender.id;
        expectUnauthorized(
            () =>
                authorizeSubtitleRequest(
                    createDisneyMessage(),
                    inheritedSender
                ),
            SubtitleRequestSources.DISNEY_PLUS
        );

        const accessorSender = createSender(pageUrl);
        let invoked = false;
        defineThrowingAccessor(accessorSender, 'id', () => {
            invoked = true;
        });
        expectUnauthorized(
            () =>
                authorizeSubtitleRequest(createDisneyMessage(), accessorSender),
            SubtitleRequestSources.DISNEY_PLUS
        );
        expect(invoked).toBe(false);
    });

    test.each([
        ['sender.tab', (sender, define) => define(sender, 'tab')],
        ['sender.frameId', (sender, define) => define(sender, 'frameId')],
        ['sender.url', (sender, define) => define(sender, 'url')],
        ['sender.origin', (sender, define) => define(sender, 'origin')],
        ['sender.tab.id', (sender, define) => define(sender.tab, 'id')],
        ['sender.tab.url', (sender, define) => define(sender.tab, 'url')],
    ])('rejects an own accessor proof field: %s', (_label, installAccessor) => {
        const sender = createSender(
            'https://www.disneyplus.com/play/episode-123'
        );
        let invoked = false;
        installAccessor(sender, (record, key) =>
            defineThrowingAccessor(record, key, () => {
                invoked = true;
            })
        );

        expectUnauthorized(
            () => authorizeSubtitleRequest(createDisneyMessage(), sender),
            SubtitleRequestSources.DISNEY_PLUS
        );
        expect(invoked).toBe(false);
    });

    test('fails closed when the trusted runtime extension id is unavailable', () => {
        delete globalThis.chrome.runtime.id;

        expectUnauthorized(
            () =>
                authorizeSubtitleRequest(
                    createDisneyMessage(),
                    createSender('https://www.disneyplus.com/play/episode-123')
                ),
            SubtitleRequestSources.DISNEY_PLUS
        );
    });

    test.each([
        [
            'inherited message fields',
            () => Object.create(createDisneyMessage()),
            'https://www.disneyplus.com/play/episode-123',
            'unknown',
        ],
        [
            'inherited tracks',
            () =>
                createNetflixMessage({
                    data: Object.create({
                        tracks: [createNetflixTrack()],
                    }),
                }),
            'https://www.netflix.com/watch/80123456',
            SubtitleRequestSources.NETFLIX,
        ],
        [
            'inherited track fields',
            () => {
                const message = createNetflixMessage();
                message.data.tracks = [Object.create(message.data.tracks[0])];
                return message;
            },
            'https://www.netflix.com/watch/80123456',
            SubtitleRequestSources.NETFLIX,
        ],
        [
            'inherited URL field',
            () => {
                const message = createNetflixMessage();
                message.data.tracks[0].ttDownloadables.dfxp.urls = [
                    Object.create({
                        url: 'https://captions.nflxvideo.net/inherited.ttml',
                    }),
                ];
                return message;
            },
            'https://www.netflix.com/watch/80123456',
            SubtitleRequestSources.NETFLIX,
        ],
        [
            'exotic data map',
            () => {
                const data = new Map();
                data.tracks = [createNetflixTrack()];
                return createNetflixMessage({ data });
            },
            'https://www.netflix.com/watch/80123456',
            SubtitleRequestSources.NETFLIX,
        ],
    ])(
        'rejects inherited or exotic input: %s',
        (_label, makeMessage, pageUrl, platform) => {
            expectUnauthorized(
                () =>
                    authorizeSubtitleRequest(
                        makeMessage(),
                        createSender(pageUrl)
                    ),
                platform
            );
        }
    );

    test.each([
        [
            'message __proto__',
            (message) => defineDangerousOwnKey(message, '__proto__'),
        ],
        [
            'track constructor',
            (message) =>
                defineDangerousOwnKey(message.data.tracks[0], 'constructor'),
        ],
        [
            'format-map prototype',
            (message) =>
                defineDangerousOwnKey(
                    message.data.tracks[0].ttDownloadables,
                    'prototype'
                ),
        ],
    ])('rejects dangerous own keys: %s', (_label, mutateMessage) => {
        const message = createNetflixMessage();
        mutateMessage(message);

        expectUnauthorized(
            () =>
                authorizeSubtitleRequest(
                    message,
                    createSender('https://www.netflix.com/watch/80123456')
                ),
            SubtitleRequestSources.NETFLIX
        );
    });

    test.each([
        [
            'sparse tracks',
            (message) => {
                const tracks = new Array(2);
                tracks[0] = createNetflixTrack();
                message.data.tracks = tracks;
            },
        ],
        [
            'tracks with an extra property',
            (message) => (message.data.tracks.extra = createNetflixTrack()),
        ],
        [
            'tracks with a custom prototype',
            (message) => Object.setPrototypeOf(message.data.tracks, null),
        ],
        [
            'sparse URL list',
            (message) => {
                const urls = new Array(2);
                urls[0] = 'https://captions.nflxvideo.net/valid.ttml';
                message.data.tracks[0].ttDownloadables.dfxp.urls = urls;
            },
        ],
        [
            'URL list with an extra property',
            (message) =>
                (message.data.tracks[0].ttDownloadables.dfxp.urls.extra =
                    'secret'),
        ],
    ])('rejects a non-dense array: %s', (_label, mutateMessage) => {
        const message = createNetflixMessage();
        mutateMessage(message);

        expectUnauthorized(
            () =>
                authorizeSubtitleRequest(
                    message,
                    createSender('https://www.netflix.com/watch/80123456')
                ),
            SubtitleRequestSources.NETFLIX
        );
    });

    test('never coerces hostile URL-like objects', () => {
        let coerced = false;
        const hostileUrl = {
            [Symbol.toPrimitive]() {
                coerced = true;
                throw new Error('coercion secret');
            },
            toString() {
                coerced = true;
                throw new Error('toString secret');
            },
        };

        expectUnauthorized(
            () =>
                authorizeSubtitleRequest(
                    createDisneyMessage({ url: hostileUrl }),
                    createSender('https://www.disneyplus.com/play/episode-123')
                ),
            SubtitleRequestSources.DISNEY_PLUS
        );
        expect(coerced).toBe(false);
    });

    test.each([
        [
            'direct urls string',
            (track) => {
                track.ttDownloadables = {
                    webvtt: {
                        urls: [
                            'https://CAPTIONS.NFLXVIDEO.NET:443/show/en.vtt',
                        ],
                    },
                };
            },
            'webvtt',
            'https://captions.nflxvideo.net/show/en.vtt',
        ],
        [
            'direct downloadUrls object',
            (track) => {
                track.ttDownloadables = {
                    dfxp: {
                        downloadUrls: [
                            {
                                url: 'https://captions.nflxvideo.net/show/en.ttml',
                            },
                        ],
                    },
                };
            },
            'dfxp',
            'https://captions.nflxvideo.net/show/en.ttml',
        ],
        [
            'rawTrack fallback',
            (track) => {
                track.rawTrack = { ttDownloadables: track.ttDownloadables };
                delete track.ttDownloadables;
            },
            'dfxp',
            'https://captions.nflxvideo.net/show/en.ttml',
        ],
        [
            'primitive direct fallback',
            (track) => {
                track.rawTrack = { ttDownloadables: track.ttDownloadables };
                track.ttDownloadables = 'not-an-object';
            },
            'dfxp',
            'https://captions.nflxvideo.net/show/en.ttml',
        ],
        [
            'array direct fallback',
            (track) => {
                track.rawTrack = { ttDownloadables: track.ttDownloadables };
                track.ttDownloadables = [];
            },
            'dfxp',
            'https://captions.nflxvideo.net/show/en.ttml',
        ],
        [
            'null direct fallback',
            (track) => {
                track.rawTrack = { ttDownloadables: track.ttDownloadables };
                track.ttDownloadables = null;
            },
            'dfxp',
            'https://captions.nflxvideo.net/show/en.ttml',
        ],
    ])(
        'normalizes Netflix parser-compatible input: %s',
        (_label, mutateTrack, expectedFormat, expectedUrl) => {
            const message = createNetflixMessage();
            mutateTrack(message.data.tracks[0]);

            const snapshot = authorizeSubtitleRequest(
                message,
                createSender('https://www.netflix.com/watch/80123456')
            );
            const track = snapshot.data.tracks[0];

            expect(track.ttDownloadables).toEqual({
                [expectedFormat]: { urls: [expectedUrl] },
            });
            expect(track).not.toHaveProperty('rawTrack');
            expect(Object.keys(track.ttDownloadables)).toEqual([
                expectedFormat,
            ]);
            expect(Object.getPrototypeOf(track.ttDownloadables)).toBe(null);
        }
    );

    test('keeps a valid direct map authoritative over rawTrack fallback', () => {
        const message = createNetflixMessage();
        const track = message.data.tracks[0];
        track.rawTrack = { ttDownloadables: track.ttDownloadables };
        track.ttDownloadables = {};

        expectUnauthorized(
            () =>
                authorizeSubtitleRequest(
                    message,
                    createSender('https://www.netflix.com/watch/80123456')
                ),
            SubtitleRequestSources.NETFLIX
        );
    });

    test('uses urls before downloadUrls and canonicalizes only index zero', () => {
        const message = createNetflixMessage();
        message.data.tracks[0].ttDownloadables = {
            dfxp: {
                urls: [
                    'https://captions.nflxvideo.net/urls-first.ttml',
                    'https://captions.nflxvideo.net/ignored-index-one.ttml',
                ],
                downloadUrls: [
                    'https://captions.nflxvideo.net/ignored-fallback.ttml',
                ],
            },
        };

        const track = authorizeSubtitleRequest(
            message,
            createSender('https://www.netflix.com/watch/80123456')
        ).data.tracks[0];

        expect(track.ttDownloadables.dfxp.urls).toEqual([
            'https://captions.nflxvideo.net/urls-first.ttml',
        ]);
    });

    test('uses downloadUrls only when urls is empty', () => {
        const message = createNetflixMessage();
        message.data.tracks[0].ttDownloadables = {
            dfxp: {
                urls: [],
                downloadUrls: [
                    'https://captions.nflxvideo.net/download-fallback.ttml',
                ],
            },
        };

        expect(
            authorizeSubtitleRequest(
                message,
                createSender('https://www.netflix.com/watch/80123456')
            ).data.tracks[0].ttDownloadables.dfxp.urls
        ).toEqual(['https://captions.nflxvideo.net/download-fallback.ttml']);
    });

    test('skips an invalid first entry to the next format, not same-format downloadUrls', () => {
        const message = createNetflixMessage();
        message.data.tracks[0].ttDownloadables = {
            first: {
                urls: [null, 'https://captions.nflxvideo.net/ignored.ttml'],
                downloadUrls: [
                    'https://captions.nflxvideo.net/also-ignored.ttml',
                ],
            },
            second: {
                urls: ['https://captions.nflxvideo.net/selected.ttml'],
            },
        };

        const downloadables = authorizeSubtitleRequest(
            message,
            createSender('https://www.netflix.com/watch/80123456')
        ).data.tracks[0].ttDownloadables;

        expect(Object.keys(downloadables)).toEqual(['second']);
        expect(downloadables.second.urls).toEqual([
            'https://captions.nflxvideo.net/selected.ttml',
        ]);
    });

    test('rejects an unsafe selected URL instead of promoting a later format', () => {
        const message = createNetflixMessage();
        message.data.tracks[0].ttDownloadables = {
            first: { urls: ['https://attacker.test/secret.ttml'] },
            second: {
                urls: ['https://captions.nflxvideo.net/safe.ttml'],
            },
        };

        expectUnauthorized(
            () =>
                authorizeSubtitleRequest(
                    message,
                    createSender('https://www.netflix.com/watch/80123456')
                ),
            SubtitleRequestSources.NETFLIX
        );
    });

    test('preserves format insertion order and safely handles a toString format', () => {
        const message = createNetflixMessage();
        const downloadables = {};
        Object.defineProperty(downloadables, 'toString', {
            enumerable: true,
            value: {
                urls: ['https://captions.nflxvideo.net/to-string.ttml'],
            },
        });
        downloadables.firstInsertedLater = {
            urls: ['https://captions.nflxvideo.net/later.ttml'],
        };
        message.data.tracks[0].ttDownloadables = downloadables;

        const sanitizedDownloadables = authorizeSubtitleRequest(
            message,
            createSender('https://www.netflix.com/watch/80123456')
        ).data.tracks[0].ttDownloadables;

        expect(Object.keys(sanitizedDownloadables)).toEqual(['toString']);
        expect(sanitizedDownloadables.toString.urls).toEqual([
            'https://captions.nflxvideo.net/to-string.ttml',
        ]);
        expect(Object.getPrototypeOf(sanitizedDownloadables)).toBe(null);
    });

    test('preserves Object.keys ordering for integer-like Netflix formats', () => {
        const message = createNetflixMessage();
        const downloadables = {};
        Object.defineProperty(downloadables, '10', {
            enumerable: true,
            value: {
                urls: ['https://captions.nflxvideo.net/ten.ttml'],
            },
        });
        Object.defineProperty(downloadables, '2', {
            enumerable: true,
            value: {
                urls: ['https://captions.nflxvideo.net/two.ttml'],
            },
        });
        message.data.tracks[0].ttDownloadables = downloadables;

        const sanitizedDownloadables = authorizeSubtitleRequest(
            message,
            createSender('https://www.netflix.com/watch/80123456')
        ).data.tracks[0].ttDownloadables;

        expect(Object.keys(downloadables)).toEqual(['2', '10']);
        expect(Object.keys(sanitizedDownloadables)).toEqual(['2']);
        expect(sanitizedDownloadables['2'].urls).toEqual([
            'https://captions.nflxvideo.net/two.ttml',
        ]);
    });

    test('defaults optional track fields without inventing a track type', () => {
        const message = createNetflixMessage();
        const track = message.data.tracks[0];
        delete track.displayName;
        delete track.trackType;
        delete track.isNoneTrack;
        delete track.isForcedNarrative;

        const sanitizedTrack = authorizeSubtitleRequest(
            message,
            createSender('https://www.netflix.com/watch/80123456')
        ).data.tracks[0];

        expect(sanitizedTrack).toEqual(
            expect.objectContaining({
                language: 'en',
                displayName: 'en',
                isNoneTrack: false,
                isForcedNarrative: false,
            })
        );
        expect(sanitizedTrack).not.toHaveProperty('trackType');
    });

    test('drops every unknown raw track field from the exact snapshot union', () => {
        const message = createNetflixMessage();
        message.data.tracks[0].id = 'raw-track-id';
        message.data.tracks[0].unusedNestedMetadata = {
            token: 'must-not-survive',
        };

        const sanitizedTrack = authorizeSubtitleRequest(
            message,
            createSender('https://www.netflix.com/watch/80123456')
        ).data.tracks[0];

        expect(Object.keys(sanitizedTrack)).toEqual([
            'language',
            'displayName',
            'trackType',
            'isNoneTrack',
            'isForcedNarrative',
            'ttDownloadables',
        ]);
        expect(JSON.stringify(sanitizedTrack)).not.toContain(
            'must-not-survive'
        );
    });

    test('drops true none/forced tracks and unusable tracks while preserving order', () => {
        const noneTrack = createNetflixTrack();
        noneTrack.language = 'none';
        noneTrack.isNoneTrack = true;
        const unusableTrack = createNetflixTrack();
        unusableTrack.language = 'unusable';
        unusableTrack.ttDownloadables = {};
        const firstUsable = createNetflixTrack(
            'https://captions.nflxvideo.net/first.ttml'
        );
        firstUsable.language = 'first';
        const forcedTrack = createNetflixTrack();
        forcedTrack.language = 'forced';
        forcedTrack.isForcedNarrative = true;
        const secondUsable = createNetflixTrack(
            'https://captions.nflxvideo.net/second.ttml'
        );
        secondUsable.language = 'second';
        const message = createNetflixMessage({
            data: {
                tracks: [
                    noneTrack,
                    unusableTrack,
                    firstUsable,
                    forcedTrack,
                    secondUsable,
                ],
            },
        });

        const languages = authorizeSubtitleRequest(
            message,
            createSender('https://www.netflix.com/watch/80123456')
        ).data.tracks.map((track) => track.language);

        expect(languages).toEqual(['first', 'second']);
    });

    test('preserves track order and PRIMARY/ASSISTIVE type values for parser selection', () => {
        const assistive = createNetflixTrack(
            'https://captions.nflxvideo.net/assistive.ttml'
        );
        assistive.trackType = 'ASSISTIVE';
        const primary = createNetflixTrack(
            'https://captions.nflxvideo.net/primary.ttml'
        );
        primary.trackType = 'PRIMARY';
        const untyped = createNetflixTrack(
            'https://captions.nflxvideo.net/untyped.ttml'
        );
        delete untyped.trackType;

        const tracks = authorizeSubtitleRequest(
            createNetflixMessage({
                data: { tracks: [assistive, primary, untyped] },
            }),
            createSender('https://www.netflix.com/watch/80123456')
        ).data.tracks;

        expect(tracks.map((track) => track.trackType)).toEqual([
            'ASSISTIVE',
            'PRIMARY',
            undefined,
        ]);
    });

    test('rejects a request when no track survives sanitization', () => {
        const flaggedTrack = createNetflixTrack();
        flaggedTrack.isNoneTrack = true;
        const noUrlTrack = createNetflixTrack();
        noUrlTrack.ttDownloadables = {};

        expectUnauthorized(
            () =>
                authorizeSubtitleRequest(
                    createNetflixMessage({
                        data: { tracks: [flaggedTrack, noUrlTrack] },
                    }),
                    createSender('https://www.netflix.com/watch/80123456')
                ),
            SubtitleRequestSources.NETFLIX
        );
    });

    test.each([
        [
            'nonboolean none flag',
            (message) => (message.data.tracks[0].isNoneTrack = 0),
        ],
        [
            'nonboolean forced flag',
            (message) => (message.data.tracks[0].isForcedNarrative = undefined),
        ],
        [
            'nonstring display name',
            (message) => (message.data.tracks[0].displayName = 17),
        ],
        [
            'blank display name',
            (message) => (message.data.tracks[0].displayName = '   '),
        ],
        [
            'nonstring track type',
            (message) => (message.data.tracks[0].trackType = false),
        ],
        [
            'blank track type',
            (message) => (message.data.tracks[0].trackType = ''),
        ],
        [
            'blank language',
            (message) => (message.data.tracks[0].language = '\t'),
        ],
        [
            'non-string language',
            (message) => (message.data.tracks[0].language = 17),
        ],
        [
            'missing language',
            (message) => delete message.data.tracks[0].language,
        ],
        [
            'missing useNativeSubtitles',
            (message) => delete message.useNativeSubtitles,
        ],
        [
            'nonboolean useOfficialTranslations',
            (message) => (message.useOfficialTranslations = 'true'),
        ],
    ])('rejects invalid Netflix primitives: %s', (_label, mutateMessage) => {
        const message = createNetflixMessage();
        mutateMessage(message);

        expectUnauthorized(
            () =>
                authorizeSubtitleRequest(
                    message,
                    createSender('https://www.netflix.com/watch/80123456')
                ),
            SubtitleRequestSources.NETFLIX
        );
    });

    test.each([
        [
            'exotic direct map',
            (track) => {
                const downloadables = new Date();
                downloadables.dfxp = track.ttDownloadables.dfxp;
                track.ttDownloadables = downloadables;
            },
        ],
        [
            'non-record format data',
            (track) => (track.ttDownloadables.dfxp = 'bad'),
        ],
        [
            'non-array urls',
            (track) => (track.ttDownloadables.dfxp.urls = 'bad'),
        ],
        [
            'exotic URL entry',
            (track) => {
                const entry = new Date();
                entry.url = 'https://captions.nflxvideo.net/exotic.ttml';
                track.ttDownloadables.dfxp.urls = [entry];
            },
        ],
    ])('rejects malformed Netflix containers: %s', (_label, mutateTrack) => {
        const message = createNetflixMessage();
        mutateTrack(message.data.tracks[0]);

        expectUnauthorized(
            () =>
                authorizeSubtitleRequest(
                    message,
                    createSender('https://www.netflix.com/watch/80123456')
                ),
            SubtitleRequestSources.NETFLIX
        );
    });

    test('brand-gates public URL sinks before inspecting attacker URL input', () => {
        let coerced = false;
        const hostileUrl = new Proxy(
            {},
            {
                get() {
                    coerced = true;
                    throw new Error('signed-url-secret');
                },
            }
        );
        const fakeSnapshot = Object.freeze({
            source: SubtitleRequestSources.DISNEY_PLUS,
        });

        expectUnauthorized(() =>
            assertAllowedSubtitleUrl(fakeSnapshot, hostileUrl, 'segment')
        );
        expectUnauthorized(() =>
            resolveAllowedSubtitleUrl(
                fakeSnapshot,
                hostileUrl,
                hostileUrl,
                'segment'
            )
        );
        expect(coerced).toBe(false);
    });

    test('brand-gates public URL sinks before parsing valid URL strings', () => {
        const fakeSnapshot = Object.freeze({
            source: SubtitleRequestSources.DISNEY_PLUS,
        });
        const NativeURL = globalThis.URL;
        let parseCount = 0;
        globalThis.URL = function CountingURL(...args) {
            parseCount += 1;
            return Reflect.construct(NativeURL, args);
        };

        try {
            expectUnauthorized(() =>
                assertAllowedSubtitleUrl(
                    fakeSnapshot,
                    'https://captions.media.dssott.com/cue.vtt',
                    'segment'
                )
            );
            expectUnauthorized(() =>
                resolveAllowedSubtitleUrl(
                    fakeSnapshot,
                    'cue.vtt',
                    'https://captions.media.dssott.com/master.m3u8',
                    'segment'
                )
            );
        } finally {
            globalThis.URL = NativeURL;
        }
        expect(parseCount).toBe(0);
    });

    test('pre-caps a relative reference before invoking the URL parser', () => {
        const snapshot = authorizeSubtitleRequest(
            createDisneyMessage(),
            createSender('https://www.disneyplus.com/play/episode-123')
        );
        const NativeURL = globalThis.URL;
        let parserInvoked = false;
        globalThis.URL = function UnexpectedUrlParse() {
            parserInvoked = true;
            throw new Error('URL parser must not run');
        };

        try {
            expect(() =>
                resolveAllowedSubtitleUrl(
                    snapshot,
                    'a'.repeat(16 * 1024 + 1),
                    'https://captions.media.dssott.com/show/master.m3u8',
                    'segment'
                )
            ).toThrow(
                expect.objectContaining({
                    code: 'ERR_SUBTITLE_URL_INVALID',
                    platform: SubtitleRequestSources.DISNEY_PLUS,
                    stage: 'segment',
                })
            );
        } finally {
            globalThis.URL = NativeURL;
        }
        expect(parserInvoked).toBe(false);
    });

    test('pre-caps raw sink and sender URLs before invoking the URL parser', () => {
        const snapshot = authorizeSubtitleRequest(
            createDisneyMessage(),
            createSender('https://www.disneyplus.com/play/episode-123')
        );
        const hugeUrl = 'a'.repeat(16 * 1024 + 1);
        const hugeSender = {
            id: TEST_EXTENSION_ID,
            tab: { id: 17, url: hugeUrl },
            frameId: 0,
            url: hugeUrl,
            origin: 'https://www.disneyplus.com',
        };
        const NativeURL = globalThis.URL;
        let parserInvoked = false;
        globalThis.URL = function UnexpectedUrlParse() {
            parserInvoked = true;
            throw new Error('URL parser must not run');
        };

        try {
            expect(() =>
                assertAllowedSubtitleUrl(snapshot, hugeUrl, 'segment')
            ).toThrow(
                expect.objectContaining({
                    code: 'ERR_SUBTITLE_URL_INVALID',
                })
            );
            expectUnauthorized(
                () =>
                    authorizeSubtitleRequest(createDisneyMessage(), hugeSender),
                SubtitleRequestSources.DISNEY_PLUS
            );
        } finally {
            globalThis.URL = NativeURL;
        }
        expect(parserInvoked).toBe(false);
    });

    test('canonicalizes brand-derived platform URLs and safe relative references', () => {
        const disneySnapshot = authorizeSubtitleRequest(
            createDisneyMessage(),
            createSender('https://www.disneyplus.com/play/episode-123')
        );
        const netflixSnapshot = authorizeSubtitleRequest(
            createNetflixMessage(),
            createSender('https://www.netflix.com/watch/80123456')
        );

        expect(
            assertAllowedSubtitleUrl(
                disneySnapshot,
                'https://CAPTIONS.MEDIA.DSSOTT.COM:443/show/master.m3u8?token=abc',
                'initial'
            )
        ).toBe('https://captions.media.dssott.com/show/master.m3u8?token=abc');
        expect(
            assertAllowedSubtitleUrl(
                netflixSnapshot,
                'https://captions.nflxvideo.net/show/en.ttml',
                'netflix-original'
            )
        ).toBe('https://captions.nflxvideo.net/show/en.ttml');
        expect(
            assertAllowedSubtitleUrl(
                disneySnapshot,
                'https://media.dssott.com/exact-base.m3u8',
                'initial'
            )
        ).toBe('https://media.dssott.com/exact-base.m3u8');
        expect(
            assertAllowedSubtitleUrl(
                netflixSnapshot,
                'https://nflxvideo.net/exact-base.ttml',
                'netflix-original'
            )
        ).toBe('https://nflxvideo.net/exact-base.ttml');
        expect(
            resolveAllowedSubtitleUrl(
                disneySnapshot,
                '../segments/cue-1.vtt?token=signed',
                'https://a.media.dssott.com/show/en/index.m3u8',
                'segment'
            )
        ).toBe(
            'https://a.media.dssott.com/show/segments/cue-1.vtt?token=signed'
        );
    });

    test('accepts a branded Disney resource on the trusted edge CDN', () => {
        const snapshot = authorizeSubtitleRequest(
            createDisneyMessage(),
            createSender('https://www.disneyplus.com/play/episode-123')
        );
        const edgeUrl =
            'https://captions.dssedge.com/show/master.m3u8?token=synthetic';

        expect(
            assertAllowedSubtitleUrl(snapshot, edgeUrl, 'disney-master')
        ).toBe(edgeUrl);
        expect(
            resolveAllowedSubtitleUrl(
                snapshot,
                'segments/cue-1.vtt?token=segment',
                edgeUrl,
                'segment'
            )
        ).toBe(
            'https://captions.dssedge.com/show/segments/cue-1.vtt?token=segment'
        );
    });

    test('strips fragments while preserving signed queries in every canonical URL path', () => {
        const firstDisney = authorizeSubtitleRequest(
            createDisneyMessage({
                url: 'https://captions.media.dssott.com/show/master.m3u8?token=a%2Bb#one',
            }),
            createSender('https://www.disneyplus.com/play/episode-123')
        );
        const secondDisney = authorizeSubtitleRequest(
            createDisneyMessage({
                url: 'https://captions.media.dssott.com/show/master.m3u8?token=a%2Bb#two',
            }),
            createSender('https://www.disneyplus.com/play/episode-123')
        );
        expect(firstDisney.url).toBe(
            'https://captions.media.dssott.com/show/master.m3u8?token=a%2Bb'
        );
        expect(secondDisney.url).toBe(firstDisney.url);

        const netflixMessage = createNetflixMessage();
        netflixMessage.data.tracks[0].ttDownloadables.dfxp.urls[0].url =
            'https://captions.nflxvideo.net/show/en.ttml?token=signed#cue-fragment';
        const netflixSnapshot = authorizeSubtitleRequest(
            netflixMessage,
            createSender('https://www.netflix.com/watch/80123456')
        );
        expect(
            netflixSnapshot.data.tracks[0].ttDownloadables.dfxp.urls[0]
        ).toBe('https://captions.nflxvideo.net/show/en.ttml?token=signed');

        expect(
            resolveAllowedSubtitleUrl(
                firstDisney,
                'cue.vtt?token=segment#ignored',
                'https://captions.media.dssott.com/show/master.m3u8#base',
                'segment'
            )
        ).toBe('https://captions.media.dssott.com/show/cue.vtt?token=segment');
    });

    test.each([
        'http://captions.media.dssott.com/master.m3u8',
        'https://user:secret@captions.media.dssott.com/master.m3u8',
        'https://captions.media.dssott.com:444/master.m3u8',
        'https://media.dssott.com./master.m3u8',
        'https://media.dssott.com.attacker.test/master.m3u8',
        'https://evilmedia.dssott.com/master.m3u8',
        'https://captions.dssedge.com/master.m3u8',
        'https://127.0.0.1/master.m3u8',
        'https://[::1]/master.m3u8',
        'https://captions.nflxvideo.net/master.m3u8',
        'https://medіa.dssott.com/master.m3u8',
        'ftp://captions.media.dssott.com/master.m3u8',
        'data:text/vtt,WEBVTT',
        'blob:https://captions.media.dssott.com/id',
        'javascript:alert(1)',
        'relative/cue.vtt',
        'https://%/cue.vtt',
    ])('rejects a Disney URL outside its exact HTTPS CDN: %s', (url) => {
        expectUnauthorized(
            () =>
                authorizeSubtitleRequest(
                    createDisneyMessage({ url }),
                    createSender('https://www.disneyplus.com/play/episode-123')
                ),
            SubtitleRequestSources.DISNEY_PLUS
        );
    });

    test.each([
        'http://captions.nflxvideo.net/show/en.ttml',
        'https://user:secret@captions.nflxvideo.net/show/en.ttml',
        'https://captions.nflxvideo.net:444/show/en.ttml',
        'https://nflxvideo.net./show/en.ttml',
        'https://nflxvideo.net.attacker.test/show/en.ttml',
        'https://evilnflxvideo.net/show/en.ttml',
        'https://127.0.0.1/show/en.ttml',
        'https://captions.media.dssott.com/show/en.ttml',
        'data:text/plain,secret',
        'blob:https://captions.nflxvideo.net/id',
        'relative/en.ttml',
        'not a URL',
    ])('rejects a Netflix URL outside its exact HTTPS CDN: %s', (url) => {
        const message = createNetflixMessage();
        message.data.tracks[0].ttDownloadables.dfxp.urls[0].url = url;

        expectUnauthorized(
            () =>
                authorizeSubtitleRequest(
                    message,
                    createSender('https://www.netflix.com/watch/80123456')
                ),
            SubtitleRequestSources.NETFLIX
        );
    });

    test.each([
        '//attacker.test/steal.vtt',
        'https://captions.nflxvideo.net/cross-platform.vtt',
        'http://captions.media.dssott.com/insecure.vtt',
        'data:text/vtt,WEBVTT',
        '\\\\attacker.test\\steal.vtt',
    ])(
        'rejects a relative reference that escapes its branded CDN: %s',
        (ref) => {
            const snapshot = authorizeSubtitleRequest(
                createDisneyMessage(),
                createSender('https://www.disneyplus.com/play/episode-123')
            );

            expect(() =>
                resolveAllowedSubtitleUrl(
                    snapshot,
                    ref,
                    'https://a.media.dssott.com/show/index.m3u8',
                    'segment'
                )
            ).toThrow(
                expect.objectContaining({
                    name: 'SubtitleRequestPolicyError',
                    platform: SubtitleRequestSources.DISNEY_PLUS,
                    stage: 'segment',
                })
            );
        }
    );

    test('keeps public URL policy errors fixed and free of signed URL data', () => {
        const snapshot = authorizeSubtitleRequest(
            createDisneyMessage(),
            createSender('https://www.disneyplus.com/play/episode-123')
        );
        const signedUrl =
            'https://attacker.test/super-secret-path/master.m3u8?token=signed-secret';
        let error;
        try {
            assertAllowedSubtitleUrl(
                snapshot,
                signedUrl,
                'attacker-stage?token=signed-secret'
            );
        } catch (caughtError) {
            error = caughtError;
        }

        expect(error).toEqual(
            expect.objectContaining({
                name: 'SubtitleRequestPolicyError',
                code: 'ERR_SUBTITLE_URL_NOT_ALLOWED',
                platform: SubtitleRequestSources.DISNEY_PLUS,
                stage: 'unknown',
            })
        );
        expect(error.message).toBe('Subtitle request rejected by policy.');
        expect(String(error)).toBe(
            'SubtitleRequestPolicyError: Subtitle request rejected by policy.'
        );
        const serialized = JSON.stringify(error);
        expect(serialized).not.toContain('super-secret-path');
        expect(serialized).not.toContain('signed-secret');
        expect(serialized).not.toContain('attacker.test');
        expect(error.stack).not.toContain('super-secret-path');
        expect(error.stack).not.toContain('signed-secret');
        expect(error.stack).not.toContain('attacker.test');
    });

    test.each([
        ['target language ASCII', 'targetLanguage', 'a'.repeat(64)],
        ['target language multibyte', 'targetLanguage', 'é'.repeat(32)],
        ['original language ASCII', 'originalLanguage', 'b'.repeat(64)],
        ['original language multibyte', 'originalLanguage', 'é'.repeat(32)],
    ])('accepts a 64-byte request %s', (_label, field, value) => {
        const snapshot = authorizeSubtitleRequest(
            createDisneyMessage({ [field]: value }),
            createSender('https://www.disneyplus.com/play/episode-123')
        );
        expect(snapshot[field]).toBe(value);
    });

    test.each([
        ['target language ASCII', 'targetLanguage', 'a'.repeat(65)],
        ['target language multibyte', 'targetLanguage', 'é'.repeat(33)],
        ['original language ASCII', 'originalLanguage', 'b'.repeat(65)],
        ['original language multibyte', 'originalLanguage', 'é'.repeat(33)],
        ['target language lone surrogate', 'targetLanguage', '\ud800'],
        ['non-string target language', 'targetLanguage', 17],
        ['undefined original language', 'originalLanguage', undefined],
        ['blank original language', 'originalLanguage', '   '],
    ])('rejects an invalid or over-cap request %s', (_label, field, value) => {
        expectUnauthorized(
            () =>
                authorizeSubtitleRequest(
                    createDisneyMessage({ [field]: value }),
                    createSender('https://www.disneyplus.com/play/episode-123')
                ),
            SubtitleRequestSources.DISNEY_PLUS
        );
    });

    test.each([
        ['language ASCII', 'language', 'l'.repeat(64)],
        ['language multibyte', 'language', 'é'.repeat(32)],
        ['track type ASCII', 'trackType', 't'.repeat(64)],
        ['track type multibyte', 'trackType', 'é'.repeat(32)],
        ['display name ASCII', 'displayName', 'd'.repeat(256)],
        ['display name multibyte', 'displayName', 'é'.repeat(128)],
    ])('accepts an exact Netflix string cap: %s', (_label, field, value) => {
        const message = createNetflixMessage();
        message.data.tracks[0][field] = value;

        expect(
            authorizeSubtitleRequest(
                message,
                createSender('https://www.netflix.com/watch/80123456')
            ).data.tracks[0][field]
        ).toBe(value);
    });

    test.each([
        ['language ASCII', 'language', 'l'.repeat(65)],
        ['language multibyte', 'language', 'é'.repeat(33)],
        ['track type ASCII', 'trackType', 't'.repeat(65)],
        ['track type multibyte', 'trackType', 'é'.repeat(33)],
        ['display name ASCII', 'displayName', 'd'.repeat(257)],
        ['display name multibyte', 'displayName', 'é'.repeat(129)],
        ['language lone surrogate', 'language', '\ud800'],
    ])('rejects a Netflix string cap + 1: %s', (_label, field, value) => {
        const message = createNetflixMessage();
        message.data.tracks[0][field] = value;

        expectUnauthorized(
            () =>
                authorizeSubtitleRequest(
                    message,
                    createSender('https://www.netflix.com/watch/80123456')
                ),
            SubtitleRequestSources.NETFLIX
        );
    });

    test.each([
        ['ASCII format', 'f'.repeat(64)],
        ['multibyte format', 'é'.repeat(32)],
    ])('accepts an exact 64-byte %s', (_label, format) => {
        const message = createNetflixMessage();
        message.data.tracks[0].ttDownloadables = {
            [format]: {
                urls: ['https://captions.nflxvideo.net/format.ttml'],
            },
        };

        expect(
            Object.keys(
                authorizeSubtitleRequest(
                    message,
                    createSender('https://www.netflix.com/watch/80123456')
                ).data.tracks[0].ttDownloadables
            )
        ).toEqual([format]);
    });

    test.each([
        ['ASCII format', 'f'.repeat(65)],
        ['multibyte format', 'é'.repeat(33)],
        ['blank format', ''],
        ['lone-surrogate format', '\ud800'],
    ])('rejects a malformed or over-cap %s', (_label, format) => {
        const message = createNetflixMessage();
        message.data.tracks[0].ttDownloadables = {
            [format]: {
                urls: ['https://captions.nflxvideo.net/format.ttml'],
            },
        };

        expectUnauthorized(
            () =>
                authorizeSubtitleRequest(
                    message,
                    createSender('https://www.netflix.com/watch/80123456')
                ),
            SubtitleRequestSources.NETFLIX
        );
    });

    test('accepts 16 formats and rejects the 17th without truncation', () => {
        const exactMessage = createNetflixMessage();
        exactMessage.data.tracks[0].ttDownloadables = Object.fromEntries(
            Array.from({ length: 16 }, (_, index) => [
                `format-${index}`,
                index === 15
                    ? {
                          urls: ['https://captions.nflxvideo.net/last.ttml'],
                      }
                    : { urls: [] },
            ])
        );
        expect(
            Object.keys(
                authorizeSubtitleRequest(
                    exactMessage,
                    createSender('https://www.netflix.com/watch/80123456')
                ).data.tracks[0].ttDownloadables
            )
        ).toEqual(['format-15']);

        const overMessage = createNetflixMessage();
        overMessage.data.tracks[0].ttDownloadables = Object.fromEntries(
            Array.from({ length: 17 }, (_, index) => [
                `format-${index}`,
                {
                    urls: [`https://captions.nflxvideo.net/${index}.ttml`],
                },
            ])
        );
        expectUnauthorized(
            () =>
                authorizeSubtitleRequest(
                    overMessage,
                    createSender('https://www.netflix.com/watch/80123456')
                ),
            SubtitleRequestSources.NETFLIX
        );
    });

    test('accepts 8 URL entries and rejects the 9th without truncation', () => {
        const exactMessage = createNetflixMessage();
        exactMessage.data.tracks[0].ttDownloadables.dfxp.urls = Array.from(
            { length: 8 },
            (_, index) => `https://captions.nflxvideo.net/${index}.ttml`
        );
        expect(
            authorizeSubtitleRequest(
                exactMessage,
                createSender('https://www.netflix.com/watch/80123456')
            ).data.tracks[0].ttDownloadables.dfxp.urls
        ).toEqual(['https://captions.nflxvideo.net/0.ttml']);

        const overMessage = createNetflixMessage();
        overMessage.data.tracks[0].ttDownloadables.dfxp.urls = Array.from(
            { length: 9 },
            (_, index) => `https://captions.nflxvideo.net/${index}.ttml`
        );
        expectUnauthorized(
            () =>
                authorizeSubtitleRequest(
                    overMessage,
                    createSender('https://www.netflix.com/watch/80123456')
                ),
            SubtitleRequestSources.NETFLIX
        );
    });

    test('accepts exactly 8 downloadUrls entries before canonicalizing index zero', () => {
        const message = createNetflixMessage();
        message.data.tracks[0].ttDownloadables.dfxp = {
            downloadUrls: Array.from(
                { length: 8 },
                (_, index) =>
                    `https://captions.nflxvideo.net/download-${index}.ttml`
            ),
        };

        expect(
            authorizeSubtitleRequest(
                message,
                createSender('https://www.netflix.com/watch/80123456')
            ).data.tracks[0].ttDownloadables.dfxp.urls
        ).toEqual(['https://captions.nflxvideo.net/download-0.ttml']);
    });

    test.each([
        [
            'oversized ignored downloadUrls',
            Array.from(
                { length: 9 },
                (_, index) =>
                    `https://captions.nflxvideo.net/ignored-${index}.ttml`
            ),
        ],
        ['non-array ignored downloadUrls', 'not-an-array'],
        ['sparse ignored downloadUrls', new Array(1)],
    ])('rejects %s even when nonempty urls wins', (_label, downloadUrls) => {
        const message = createNetflixMessage();
        message.data.tracks[0].ttDownloadables.dfxp = {
            urls: ['https://captions.nflxvideo.net/selected.ttml'],
            downloadUrls,
        };

        expectUnauthorized(
            () =>
                authorizeSubtitleRequest(
                    message,
                    createSender('https://www.netflix.com/watch/80123456')
                ),
            SubtitleRequestSources.NETFLIX
        );
    });

    test('rejects an oversized URL list in a later unselected format', () => {
        const message = createNetflixMessage();
        message.data.tracks[0].ttDownloadables = {
            selected: {
                urls: ['https://captions.nflxvideo.net/selected.ttml'],
            },
            later: {
                urls: Array.from(
                    { length: 9 },
                    (_, index) =>
                        `https://captions.nflxvideo.net/later-${index}.ttml`
                ),
            },
        };

        expectUnauthorized(
            () =>
                authorizeSubtitleRequest(
                    message,
                    createSender('https://www.netflix.com/watch/80123456')
                ),
            SubtitleRequestSources.NETFLIX
        );
    });

    test.each([
        [
            'over-cap format name',
            'x'.repeat(65),
            {
                urls: ['https://captions.nflxvideo.net/later.ttml'],
            },
        ],
        ['malformed URL list', 'later', { urls: 'not-an-array' }],
    ])(
        'rejects a structurally invalid later format: %s',
        (_label, laterFormat, laterFormatData) => {
            const message = createNetflixMessage();
            message.data.tracks[0].ttDownloadables = {
                selected: {
                    urls: ['https://captions.nflxvideo.net/selected.ttml'],
                },
                [laterFormat]: laterFormatData,
            };

            expectUnauthorized(
                () =>
                    authorizeSubtitleRequest(
                        message,
                        createSender('https://www.netflix.com/watch/80123456')
                    ),
                SubtitleRequestSources.NETFLIX
            );
        }
    );

    test('rejects a malformed empty urls branch before selecting downloadUrls', () => {
        const message = createNetflixMessage();
        const malformedEmptyUrls = [];
        malformedEmptyUrls.extra = 'attacker-controlled';
        message.data.tracks[0].ttDownloadables.dfxp = {
            urls: malformedEmptyUrls,
            downloadUrls: [
                'https://captions.nflxvideo.net/selected-download.ttml',
            ],
        };

        expectUnauthorized(
            () =>
                authorizeSubtitleRequest(
                    message,
                    createSender('https://www.netflix.com/watch/80123456')
                ),
            SubtitleRequestSources.NETFLIX
        );
    });

    test('locks the derived 2 MiB retained URL ceiling at exact track and URL caps', () => {
        const maxUrl = createAsciiUrlAtByteLength(
            'https://captions.nflxvideo.net',
            16 * 1024
        );
        const message = createNetflixMessage({
            data: {
                tracks: Array.from({ length: 128 }, () =>
                    createNetflixTrack(maxUrl)
                ),
            },
        });

        const snapshot = authorizeSubtitleRequest(
            message,
            createSender('https://www.netflix.com/watch/80123456')
        );
        const retainedBytes = snapshot.data.tracks.reduce(
            (total, track) => total + track.ttDownloadables.dfxp.urls[0].length,
            0
        );
        expect(snapshot.data.tracks).toHaveLength(128);
        expect(retainedBytes).toBe(2 * 1024 * 1024);
    });

    test('rejects track count and URL byte caps at +1', () => {
        const overTracks = createNetflixMessage({
            data: {
                tracks: Array.from({ length: 129 }, () => createNetflixTrack()),
            },
        });
        expectUnauthorized(
            () =>
                authorizeSubtitleRequest(
                    overTracks,
                    createSender('https://www.netflix.com/watch/80123456')
                ),
            SubtitleRequestSources.NETFLIX
        );

        const overUrl = createAsciiUrlAtByteLength(
            'https://captions.nflxvideo.net',
            16 * 1024 + 1
        );
        expectUnauthorized(
            () =>
                authorizeSubtitleRequest(
                    createNetflixMessage({
                        data: { tracks: [createNetflixTrack(overUrl)] },
                    }),
                    createSender('https://www.netflix.com/watch/80123456')
                ),
            SubtitleRequestSources.NETFLIX
        );
    });

    test('rejects a raw URL whose canonical href expands beyond 16 KiB', () => {
        const expandingUrl = `https://captions.nflxvideo.net/${'é'.repeat(3_000)}`;
        expect(new Blob([expandingUrl]).size).toBeLessThanOrEqual(16 * 1024);
        expect(new Blob([new URL(expandingUrl).href]).size).toBeGreaterThan(
            16 * 1024
        );

        expectUnauthorized(
            () =>
                authorizeSubtitleRequest(
                    createNetflixMessage({
                        data: {
                            tracks: [createNetflixTrack(expandingUrl)],
                        },
                    }),
                    createSender('https://www.netflix.com/watch/80123456')
                ),
            SubtitleRequestSources.NETFLIX
        );
    });

    test('rejects a page URL whose canonical href expands beyond 16 KiB', () => {
        const expandingPageUrl = `https://www.disneyplus.com/play/episode-123?value=${'é'.repeat(3_000)}`;
        expect(new Blob([expandingPageUrl]).size).toBeLessThanOrEqual(
            16 * 1024
        );
        expect(new Blob([new URL(expandingPageUrl).href]).size).toBeGreaterThan(
            16 * 1024
        );

        expectUnauthorized(
            () =>
                authorizeSubtitleRequest(
                    createDisneyMessage(),
                    createSender(expandingPageUrl)
                ),
            SubtitleRequestSources.DISNEY_PLUS
        );
    });

    test('accepts a page URL at exactly the 16 KiB raw and canonical cap', () => {
        const prefix = 'https://www.disneyplus.com/play/episode-123?padding=';
        const exactPageUrl = `${prefix}${'a'.repeat(16 * 1024 - prefix.length)}`;
        expect(new Blob([exactPageUrl]).size).toBe(16 * 1024);
        expect(new Blob([new URL(exactPageUrl).href]).size).toBe(16 * 1024);

        expect(
            authorizeSubtitleRequest(
                createDisneyMessage(),
                createSender(exactPageUrl)
            ).videoId
        ).toBe('episode-123');
    });
});
