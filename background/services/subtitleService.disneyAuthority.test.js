import {
    afterEach,
    beforeAll,
    describe,
    expect,
    jest,
    test,
} from '@jest/globals';
import { subtitleService } from './subtitleService.js';
import {
    createAuthorizedDisneySubtitleSnapshot,
    createAuthorizedNetflixSubtitleSnapshot,
    createSubtitleFetchResponse,
} from '../../test-utils/subtitle-fetch-fixtures.js';
import { configService } from '../../services/configService.js';
import { MAX_M3U8_PLAYLIST_BYTES, vttParser } from '../parsers/vttParser.js';
import { normalizeLanguageCode } from '../../utils/languageNormalization.js';
import {
    MessageActions,
    SubtitleRequestSources,
} from '../../content_scripts/shared/constants/messageActions.js';
import { authorizeSubtitleRequest } from '../utils/subtitleRequestPolicy.js';

const originalFetch = global.fetch;

beforeAll(async () => {
    await subtitleService.initialize();
});

afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
});

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

function expectFixedAuthorizationError(error, ...sensitiveValues) {
    expect(error).toMatchObject({
        name: 'SubtitleServiceAuthorizationError',
        message: 'Disney+ subtitle request is unauthorized.',
        code: 'ERR_DISNEY_SUBTITLE_REQUEST_UNAUTHORIZED',
    });
    expectErrorToExclude(error, ...sensitiveValues);
}

function expectFixedAbortError(error, ...sensitiveValues) {
    expect(error).toMatchObject({
        name: 'AbortError',
        message: 'Request was aborted by the caller.',
        code: 'ERR_FETCH_ABORTED',
    });
    expectErrorToExclude(error, ...sensitiveValues);
}

function expectFixedVttAbortError(error, ...sensitiveValues) {
    expect(error).toMatchObject({
        name: 'AbortError',
        message: 'VTT playlist processing was aborted.',
        code: 'ERR_VTT_PROCESSING_ABORTED',
    });
    expectErrorToExclude(error, ...sensitiveValues);
}

function expectFixedInputError(error, ...sensitiveValues) {
    expect(error).toMatchObject({
        name: 'SubtitleServiceInputError',
        message: 'Disney+ subtitle processing input is invalid.',
        code: 'ERR_DISNEY_SUBTITLE_INPUT_INVALID',
    });
    expectErrorToExclude(error, ...sensitiveValues);
}

function expectStrictAuthorizedGetCall(call, expectedUrl) {
    const [url, options] = call;
    expect(url).toBe(expectedUrl);
    expect(Reflect.ownKeys(options).sort()).toEqual([
        'credentials',
        'method',
        'redirect',
        'signal',
    ]);
    expect(options).toMatchObject({
        method: 'GET',
        redirect: 'follow',
        credentials: 'omit',
        signal: expect.any(AbortSignal),
    });
}

function expectStrictAuthorizedGetSequence(...expectedUrls) {
    expect(global.fetch).toHaveBeenCalledTimes(expectedUrls.length);
    expectedUrls.forEach((url, index) => {
        expectStrictAuthorizedGetCall(global.fetch.mock.calls[index], url);
        expect(
            global.fetch.mock.calls.filter(([fetchedUrl]) => fetchedUrl === url)
        ).toHaveLength(1);
    });
}

function createNativeTargetChainFixture() {
    const masterUrl =
        'https://captions.media.dssott.com/show/master.m3u8?token=master';
    const originalMediaUri = 'tracks/en/index.m3u8?token=original-media';
    const targetMediaUri = 'tracks/zh/index.m3u8?token=target-media';
    const originalMediaUrl = new URL(originalMediaUri, masterUrl).href;
    const targetMediaUrl = new URL(targetMediaUri, masterUrl).href;
    const originalSegmentUrl = new URL(
        'original.vtt?token=original-segment',
        originalMediaUrl
    ).href;
    const targetSegmentUrl = new URL(
        'target.vtt?token=target-segment',
        targetMediaUrl
    ).href;
    const masterPlaylist = [
        '#EXTM3U',
        `#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",URI="${originalMediaUri}"`,
        `#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Chinese",LANGUAGE="zh-CN",URI="${targetMediaUri}"`,
    ].join('\n');
    const originalMediaPlaylist =
        '#EXTM3U\n#EXTINF:2.0,\noriginal.vtt?token=original-segment';
    const targetMediaPlaylist =
        '#EXTM3U\n#EXTINF:2.0,\ntarget.vtt?token=target-segment';
    const originalVtt = 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nOriginal';
    const targetVtt = 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nTarget';

    return {
        masterUrl,
        originalMediaUri,
        targetMediaUri,
        originalMediaUrl,
        targetMediaUrl,
        originalSegmentUrl,
        targetSegmentUrl,
        masterPlaylist,
        originalMediaPlaylist,
        targetMediaPlaylist,
        originalVtt,
        targetVtt,
        snapshot: createAuthorizedDisneySubtitleSnapshot({
            subtitleUrl: masterUrl,
        }),
    };
}

function createRedirectedSignedChainFixture() {
    const requestedPrefix =
        'https://captions.media.dssott.com/show/master.m3u8?token=';
    const masterUrl =
        requestedPrefix + 'm'.repeat(538 - requestedPrefix.length);
    const redirectedMasterUrl = masterUrl.replace(
        'captions.media.dssott.com',
        'captions.dssedge.com'
    );
    const originalMediaUri =
        'tracks/en/index.m3u8?token=synthetic-original-media';
    const targetMediaUri = 'tracks/zh/index.m3u8?token=synthetic-target-media';
    const originalMediaUrl = new URL(originalMediaUri, redirectedMasterUrl)
        .href;
    const targetMediaUrl = new URL(targetMediaUri, redirectedMasterUrl).href;
    const originalSegmentUrl = new URL(
        'original.vtt?token=synthetic-original-segment',
        originalMediaUrl
    ).href;
    const targetSegmentUrl = new URL(
        'target.vtt?token=synthetic-target-segment',
        targetMediaUrl
    ).href;
    const masterPlaylist = [
        '#EXTM3U',
        `#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",URI="${originalMediaUri}"`,
        `#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Chinese",LANGUAGE="zh-CN",URI="${targetMediaUri}"`,
    ].join('\n');

    return {
        masterUrl,
        redirectedMasterUrl,
        originalMediaUrl,
        targetMediaUrl,
        originalSegmentUrl,
        targetSegmentUrl,
        masterPlaylist,
        originalMediaPlaylist:
            '#EXTM3U\n#EXTINF:2.0,\noriginal.vtt?token=synthetic-original-segment',
        targetMediaPlaylist:
            '#EXTM3U\n#EXTINF:2.0,\ntarget.vtt?token=synthetic-target-segment',
        originalVtt:
            'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nOriginal redirect',
        targetVtt: 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nTarget redirect',
        snapshot: createAuthorizedDisneySubtitleSnapshot({
            subtitleUrl: masterUrl,
        }),
    };
}

function createAuthorizedDisneySnapshotWithLanguages({
    subtitleUrl,
    originalLanguage,
    targetLanguage,
}) {
    const pageUrl = 'https://www.disneyplus.com/video/episode-123';
    createAuthorizedDisneySubtitleSnapshot({ subtitleUrl });
    return authorizeSubtitleRequest(
        {
            action: MessageActions.FETCH_VTT,
            source: SubtitleRequestSources.DISNEY_PLUS,
            url: subtitleUrl,
            videoId: 'episode-123',
            originalLanguage,
            targetLanguage,
        },
        {
            id: globalThis.chrome.runtime.id,
            tab: { id: 17, url: pageUrl },
            frameId: 0,
            url: pageUrl,
            origin: new URL(pageUrl).origin,
        }
    );
}

describe('SubtitleService Disney authority', () => {
    test('keeps authorized URL-shaped language values functional but out of success logs', async () => {
        const sourceLanguageCanary =
            'https://x.test/s?token=DISNEYSRCLANGSECRET';
        const targetLanguageCanary =
            'https://x.test/t?token=DISNEYTGTLANGSECRET';
        const masterUrl =
            'https://captions.media.dssott.com/show/language-log.vtt';
        const directVtt =
            'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nLanguage log';
        const snapshot = createAuthorizedDisneySnapshotWithLanguages({
            subtitleUrl: masterUrl,
            originalLanguage: sourceLanguageCanary,
            targetLanguage: targetLanguageCanary,
        });
        global.fetch = jest.fn(async (url) =>
            createSubtitleFetchResponse(directVtt, url)
        );
        const originalLogger = subtitleService.logger;
        const serviceLogger = {
            debug: jest.fn(),
            error: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
        };
        subtitleService.logger = serviceLogger;

        try {
            const result =
                await subtitleService.processDisneyPlusSubtitles(snapshot);

            expect(snapshot.originalLanguage).toBe(sourceLanguageCanary);
            expect(snapshot.targetLanguage).toBe(targetLanguageCanary);
            expect(result.sourceLanguage).toBe(
                normalizeLanguageCode(sourceLanguageCanary)
            );
            expect(result.targetLanguage).toBe(
                normalizeLanguageCode(targetLanguageCanary)
            );
            expect(result.selectedLanguage).toBe(sourceLanguageCanary);
            expect(result.targetLanguageInfo).toEqual({
                code: targetLanguageCanary,
            });
            const serializedLoggerCalls = JSON.stringify(
                Object.values(serviceLogger).flatMap(
                    (method) => method.mock.calls
                )
            );
            for (const sensitiveValue of [
                sourceLanguageCanary,
                targetLanguageCanary,
                result.sourceLanguage,
                result.targetLanguage,
                '/s?token=',
                '/t?token=',
                'token=',
            ]) {
                expect(serializedLoggerCalls).not.toContain(sensitiveValue);
            }
            expect(serviceLogger.info).toHaveBeenCalledWith(
                'Processing Disney+ subtitles with complete logic',
                {
                    masterPlaylistUrlLength: masterUrl.length,
                    hasOriginalLanguage: true,
                    hasTargetLanguage: true,
                }
            );
        } finally {
            subtitleService.logger = originalLogger;
        }
    });

    test('keeps authorized URL-shaped language values out of failure-path logs', async () => {
        const sourceLanguageCanary =
            'https://x.test/s?token=DISNEYFAILSRCSECRET';
        const targetLanguageCanary =
            'https://x.test/t?token=DISNEYFAILTGTSECRET';
        const settingCanary = 'https://x.test/o?token=DISNEYSETTINGSECRET';
        const masterUrl =
            'https://captions.media.dssott.com/show/language-failure.m3u8';
        const mediaUri = 'tracks/en/index.m3u8?token=media';
        const mediaUrl = new URL(mediaUri, masterUrl).href;
        const masterPlaylist = [
            '#EXTM3U',
            `#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",URI="${mediaUri}"`,
        ].join('\n');
        const snapshot = createAuthorizedDisneySnapshotWithLanguages({
            subtitleUrl: masterUrl,
            originalLanguage: sourceLanguageCanary,
            targetLanguage: targetLanguageCanary,
        });
        jest.spyOn(configService, 'get').mockResolvedValue({ disneyplus: [] });
        jest.spyOn(configService, 'getMultiple').mockResolvedValue({
            useNativeSubtitles: false,
            useOfficialTranslations: settingCanary,
        });
        global.fetch = jest.fn(async (url) => {
            if (url === masterUrl) {
                return createSubtitleFetchResponse(masterPlaylist, url);
            }
            if (url === mediaUrl) {
                throw new Error(
                    'PRIVATE_DISNEY_LANGUAGE_FAILURE_TRANSPORT_ERROR'
                );
            }
            throw new Error('Unexpected subtitle URL');
        });
        const originalLogger = subtitleService.logger;
        const serviceLogger = {
            debug: jest.fn(),
            error: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
        };
        subtitleService.logger = serviceLogger;

        try {
            const error = await subtitleService
                .processDisneyPlusSubtitles(snapshot)
                .catch((caughtError) => caughtError);

            expect(snapshot.originalLanguage).toBe(sourceLanguageCanary);
            expect(snapshot.targetLanguage).toBe(targetLanguageCanary);
            expect(error).toMatchObject({ code: 'ERR_FETCH_FAILED' });
            const serializedLoggerCalls = JSON.stringify(
                Object.values(serviceLogger).flatMap(
                    (method) => method.mock.calls
                )
            );
            for (const sensitiveValue of [
                sourceLanguageCanary,
                targetLanguageCanary,
                normalizeLanguageCode(sourceLanguageCanary),
                normalizeLanguageCode(targetLanguageCanary),
                settingCanary,
                '/s?token=',
                '/t?token=',
                '/o?token=',
                'token=',
            ]) {
                expect(serializedLoggerCalls).not.toContain(sensitiveValue);
            }
            expect(serviceLogger.debug).toHaveBeenCalledWith(
                'Smart subtitle settings',
                {
                    useOfficialTranslations: true,
                    hasTargetLanguage: true,
                    hasOriginalLanguage: true,
                }
            );
            expect(serviceLogger.debug).toHaveBeenCalledWith(
                'No subtitle URI found for language',
                {
                    hasTargetLanguage: true,
                    availableLanguageCount: 1,
                }
            );
        } finally {
            subtitleService.logger = originalLogger;
        }
    });

    test('logs a language match without retaining its signed playlist URI', () => {
        const signedUriCanary =
            'tracks/en/index.m3u8?token=FIND_LANGUAGE_URI_SECRET';
        const language = {
            normalizedCode: 'en',
            displayName: 'English',
            uri: signedUriCanary,
        };
        const originalLogger = subtitleService.logger;
        const serviceLogger = {
            debug: jest.fn(),
            error: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
        };
        subtitleService.logger = serviceLogger;

        try {
            expect(
                subtitleService.findSubtitleUriForLanguage([language], 'en')
            ).toBe(language);
            expect(serviceLogger.debug).toHaveBeenCalledWith(
                'Found subtitle URI for language',
                {
                    hasTargetLanguage: true,
                    hasFoundLanguage: true,
                    languagesEqual: true,
                    hasUri: true,
                }
            );
            const serializedLoggerCalls = JSON.stringify(
                Object.values(serviceLogger).flatMap(
                    (method) => method.mock.calls
                )
            );
            expect(serializedLoggerCalls).not.toContain(
                'FIND_LANGUAGE_URI_SECRET'
            );
            expect(serializedLoggerCalls).not.toContain('/index.m3u8');
            expect(serializedLoggerCalls).not.toContain('token=');
        } finally {
            subtitleService.logger = originalLogger;
        }
    });

    test('logs parsed language counts without playlist display-name or URI data', async () => {
        const displayNameCanary =
            'https://captions.media.dssott.com/private/display?token=LANGUAGE_DISPLAY_SECRET';
        const signedUriCanary =
            'tracks/en/index.m3u8?token=PARSED_LANGUAGE_URI_SECRET';
        const masterPlaylist = [
            '#EXTM3U',
            `#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="${displayNameCanary}",LANGUAGE="en",URI="${signedUriCanary}"`,
        ].join('\n');
        jest.spyOn(configService, 'get').mockResolvedValue({ disneyplus: [] });
        const originalLogger = subtitleService.logger;
        const serviceLogger = {
            debug: jest.fn(),
            error: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
        };
        subtitleService.logger = serviceLogger;

        try {
            const languages =
                await subtitleService.parseAvailableSubtitleLanguages(
                    masterPlaylist,
                    'disneyplus'
                );

            expect(languages).toEqual([
                {
                    normalizedCode: 'en',
                    displayName: displayNameCanary,
                    uri: signedUriCanary,
                    originalCode: 'en',
                },
            ]);
            expect(serviceLogger.debug).toHaveBeenCalledWith(
                'Using subtitle blacklist',
                {
                    source: 'disneyplus',
                    blacklistCount: 0,
                }
            );
            expect(serviceLogger.debug).toHaveBeenCalledWith(
                'Parsed subtitle languages from master playlist',
                {
                    source: 'disneyplus',
                    languageCount: 1,
                }
            );
            const serializedLoggerCalls = JSON.stringify(
                Object.values(serviceLogger).flatMap(
                    (method) => method.mock.calls
                )
            );
            expect(serializedLoggerCalls).not.toContain(
                'LANGUAGE_DISPLAY_SECRET'
            );
            expect(serializedLoggerCalls).not.toContain(
                'PARSED_LANGUAGE_URI_SECRET'
            );
            expect(serializedLoggerCalls).not.toContain('/private/display');
            expect(serializedLoggerCalls).not.toContain('token=');
        } finally {
            subtitleService.logger = originalLogger;
        }
    });

    test('logs blacklist matches without display-name or keyword contents', () => {
        const displayNameCanary =
            'https://captions.media.dssott.com/private/forced?token=BLACKLIST_DISPLAY_SECRET';
        const keywordCanary = 'token=BLACKLIST_DISPLAY_SECRET';
        const originalLogger = subtitleService.logger;
        const serviceLogger = {
            debug: jest.fn(),
            error: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
        };
        subtitleService.logger = serviceLogger;

        try {
            expect(
                subtitleService.isSubtitleBlacklisted(
                    displayNameCanary,
                    `NAME="${displayNameCanary}"`,
                    'disneyplus',
                    [keywordCanary]
                )
            ).toBe(true);
            expect(serviceLogger.debug).toHaveBeenCalledWith(
                'Subtitle blacklisted by name',
                {
                    source: 'disneyplus',
                    matchKind: 'name',
                    displayNameLength: displayNameCanary.length,
                    keywordLength: keywordCanary.length,
                }
            );
            const serializedLoggerCalls = JSON.stringify(
                Object.values(serviceLogger).flatMap(
                    (method) => method.mock.calls
                )
            );
            expect(serializedLoggerCalls).not.toContain(
                'BLACKLIST_DISPLAY_SECRET'
            );
            expect(serializedLoggerCalls).not.toContain('/private/forced');
            expect(serializedLoggerCalls).not.toContain('token=');
        } finally {
            subtitleService.logger = originalLogger;
        }
    });

    test('exposes no unbranded generic Disney network compatibility ingress', () => {
        expect(subtitleService).not.toHaveProperty('processSubtitles');
        expect(subtitleService).not.toHaveProperty('fetchAndProcessSubtitles');
        expect(vttParser).not.toHaveProperty('fetchText');
    });

    test('rejects an unbranded snapshot before consulting hostile fields', async () => {
        const sourceSecret = 'PRIVATE_FORGED_DISNEY_SOURCE';
        const sourceGetter = jest.fn(() => {
            throw new Error(sourceSecret);
        });
        const forgedSnapshot = {};
        Object.defineProperty(forgedSnapshot, 'source', {
            configurable: true,
            enumerable: true,
            get: sourceGetter,
        });
        global.fetch = jest.fn();

        const error = await subtitleService
            .processDisneyPlusSubtitles(forgedSnapshot)
            .catch((caughtError) => caughtError);

        expect(sourceGetter).not.toHaveBeenCalled();
        expectFixedAuthorizationError(error, sourceSecret);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('rejects a branded Netflix snapshot before consulting other arguments', async () => {
        const optionsSecret = 'PRIVATE_HOSTILE_OPTIONS_SIGNAL';
        const signalGetter = jest.fn(() => {
            throw new Error(optionsSecret);
        });
        const hostileOptions = {};
        Object.defineProperty(hostileOptions, 'signal', {
            configurable: true,
            enumerable: true,
            get: signalGetter,
        });
        global.fetch = jest.fn();

        const error = await subtitleService
            .processDisneyPlusSubtitles(
                createAuthorizedNetflixSubtitleSnapshot(),
                hostileOptions
            )
            .catch((caughtError) => caughtError);

        expect(signalGetter).not.toHaveBeenCalled();
        expectFixedAuthorizationError(error, optionsSecret);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('guards language fetching before consulting any non-snapshot argument', async () => {
        const argumentSecret = 'PRIVATE_HOSTILE_LANGUAGE_ARGUMENT';
        const hostileReads = jest.fn(() => {
            throw new Error(argumentSecret);
        });
        const hostileArgument = new Proxy(
            {},
            {
                get: hostileReads,
                ownKeys: hostileReads,
                getOwnPropertyDescriptor: hostileReads,
            }
        );
        const hostileOptions = {};
        Object.defineProperty(hostileOptions, 'signal', {
            configurable: true,
            enumerable: true,
            get: hostileReads,
        });
        global.fetch = jest.fn();

        const error = await subtitleService
            .fetchLanguageSpecificSubtitles(
                createAuthorizedNetflixSubtitleSnapshot(),
                hostileArgument,
                hostileArgument,
                hostileOptions
            )
            .catch((caughtError) => caughtError);

        expect(hostileReads).not.toHaveBeenCalled();
        expectFixedAuthorizationError(error, argumentSecret);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('normalizes hostile internal options to a fixed input failure', async () => {
        const optionsSecret = 'PRIVATE_DISNEY_OPTIONS_FAILURE';
        const signalGetter = jest.fn(() => {
            throw new Error(optionsSecret);
        });
        const hostileOptions = {};
        Object.defineProperty(hostileOptions, 'signal', {
            configurable: true,
            enumerable: true,
            get: signalGetter,
        });
        global.fetch = jest.fn();

        const error = await subtitleService
            .processDisneyPlusSubtitles(
                createAuthorizedDisneySubtitleSnapshot(),
                hostileOptions
            )
            .catch((caughtError) => caughtError);

        expect(signalGetter).toHaveBeenCalledTimes(1);
        expectFixedInputError(error, optionsSecret);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('carries one branded snapshot through the canonical master media and segment chain', async () => {
        const masterUrl = 'https://captions.media.dssott.com/show/master.m3u8';
        const mediaUri = 'tracks/en/index.m3u8?token=short-lived';
        const mediaUrl = new URL(mediaUri, masterUrl).href;
        const segmentUrl = new URL('segment-1.vtt', mediaUrl).href;
        const masterPlaylist = [
            '#EXTM3U',
            `#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",URI="${mediaUri}"`,
        ].join('\n');
        const mediaPlaylist = '#EXTM3U\n#EXTINF:2.0,\nsegment-1.vtt';
        const segmentVtt = 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nOne';
        const snapshot = createAuthorizedDisneySubtitleSnapshot({
            subtitleUrl: masterUrl,
        });

        global.fetch = jest.fn(async (url) => {
            if (url === masterUrl) {
                return createSubtitleFetchResponse(masterPlaylist, url);
            }
            if (url === mediaUrl) {
                return createSubtitleFetchResponse(mediaPlaylist, url);
            }
            if (url === segmentUrl) {
                return createSubtitleFetchResponse(segmentVtt, url);
            }
            throw new Error('Unexpected subtitle URL');
        });

        await expect(
            subtitleService.processDisneyPlusSubtitles(snapshot)
        ).resolves.toEqual({
            vttText: 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nOne\n\n',
            targetVttText: 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nOne\n\n',
            sourceLanguage: 'en',
            targetLanguage: 'zh-CN',
            useNativeTarget: false,
            availableLanguages: [
                {
                    normalizedCode: 'en',
                    displayName: 'English',
                    uri: mediaUri,
                    originalCode: 'en',
                },
            ],
            selectedLanguage: 'en',
            targetLanguageInfo: { code: 'zh-CN' },
        });

        expect(global.fetch).toHaveBeenCalledTimes(3);
        expectStrictAuthorizedGetCall(global.fetch.mock.calls[0], masterUrl);
        expectStrictAuthorizedGetCall(global.fetch.mock.calls[1], mediaUrl);
        expectStrictAuthorizedGetCall(global.fetch.mock.calls[2], segmentUrl);
        expect(
            global.fetch.mock.calls.filter(([url]) => url === mediaUrl)
        ).toHaveLength(1);
    });

    test('resolves distinct original and native target chains from the canonical master URL', async () => {
        const fixture = createNativeTargetChainFixture();
        const getMultiple = jest
            .spyOn(configService, 'getMultiple')
            .mockResolvedValue({
                useNativeSubtitles: false,
                useOfficialTranslations: true,
            });
        global.fetch = jest.fn(async (url) => {
            const responses = new Map([
                [fixture.masterUrl, fixture.masterPlaylist],
                [fixture.originalMediaUrl, fixture.originalMediaPlaylist],
                [fixture.originalSegmentUrl, fixture.originalVtt],
                [fixture.targetMediaUrl, fixture.targetMediaPlaylist],
                [fixture.targetSegmentUrl, fixture.targetVtt],
            ]);
            if (!responses.has(url)) throw new Error('Unexpected subtitle URL');
            return createSubtitleFetchResponse(responses.get(url), url);
        });

        const result = await subtitleService.processDisneyPlusSubtitles(
            fixture.snapshot
        );

        expect(result).toEqual({
            vttText: 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nOriginal\n\n',
            targetVttText:
                'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nTarget\n\n',
            sourceLanguage: 'en',
            targetLanguage: 'zh-CN',
            useNativeTarget: true,
            availableLanguages: [
                {
                    normalizedCode: 'en',
                    displayName: 'English',
                    uri: fixture.originalMediaUri,
                    originalCode: 'en',
                },
                {
                    normalizedCode: 'zh-CN',
                    displayName: 'Chinese',
                    uri: fixture.targetMediaUri,
                    originalCode: 'zh-CN',
                },
            ],
            selectedLanguage: 'en',
            targetLanguageInfo: {
                normalizedCode: 'zh-CN',
                displayName: 'Chinese',
                uri: fixture.targetMediaUri,
                originalCode: 'zh-CN',
            },
        });
        expect(result.vttText).not.toBe(result.targetVttText);
        expect(getMultiple).toHaveBeenCalledWith([
            'useNativeSubtitles',
            'useOfficialTranslations',
        ]);
        expectStrictAuthorizedGetSequence(
            fixture.masterUrl,
            fixture.originalMediaUrl,
            fixture.originalSegmentUrl,
            fixture.targetMediaUrl,
            fixture.targetSegmentUrl
        );
    });

    test.each([
        ['translation/original-only', false, false, 3],
        ['native-target', true, true, 5],
    ])(
        'follows one bounded 538-character Disney master redirect through the %s chain',
        async (_mode, useOfficialTranslations, expectedNativeTarget, calls) => {
            const fixture = createRedirectedSignedChainFixture();
            expect(fixture.masterUrl).toHaveLength(538);
            jest.spyOn(configService, 'get').mockResolvedValue({
                disneyplus: [],
            });
            jest.spyOn(configService, 'getMultiple').mockResolvedValue({
                useNativeSubtitles: false,
                useOfficialTranslations,
            });
            global.fetch = jest.fn(async (url) => {
                if (url === fixture.masterUrl) {
                    return createSubtitleFetchResponse(
                        fixture.masterPlaylist,
                        fixture.redirectedMasterUrl,
                        { redirected: true }
                    );
                }
                const responses = new Map([
                    [fixture.originalMediaUrl, fixture.originalMediaPlaylist],
                    [fixture.originalSegmentUrl, fixture.originalVtt],
                    [fixture.targetMediaUrl, fixture.targetMediaPlaylist],
                    [fixture.targetSegmentUrl, fixture.targetVtt],
                ]);
                if (!responses.has(url)) {
                    throw new Error('Unexpected subtitle URL');
                }
                return createSubtitleFetchResponse(responses.get(url), url);
            });

            const result = await subtitleService.processDisneyPlusSubtitles(
                fixture.snapshot
            );

            expect(result.useNativeTarget).toBe(expectedNativeTarget);
            expect(result.vttText).toContain('Original redirect');
            if (expectedNativeTarget) {
                expect(result.targetVttText).toContain('Target redirect');
            } else {
                expect(result.targetVttText).toBe(result.vttText);
            }
            const expectedUrls = [
                fixture.masterUrl,
                fixture.originalMediaUrl,
                fixture.originalSegmentUrl,
            ];
            if (expectedNativeTarget) {
                expectedUrls.push(
                    fixture.targetMediaUrl,
                    fixture.targetSegmentUrl
                );
            }
            expect(expectedUrls).toHaveLength(calls);
            expectStrictAuthorizedGetSequence(...expectedUrls);
        }
    );

    test('soft-falls back to the valid original after a target-segment transport failure', async () => {
        const fixture = createNativeTargetChainFixture();
        const transportSecret = 'PRIVATE_TARGET_TRANSPORT_FAILURE';
        const causeSecret = 'PRIVATE_TARGET_TRANSPORT_CAUSE';
        const reasonSecret = 'PRIVATE_TARGET_TRANSPORT_REASON';
        const rawError = Object.assign(new TypeError(transportSecret), {
            cause: new Error(causeSecret),
            input: fixture.targetSegmentUrl,
            url: fixture.targetSegmentUrl,
            reason: reasonSecret,
        });
        jest.spyOn(configService, 'getMultiple').mockResolvedValue({
            useNativeSubtitles: false,
            useOfficialTranslations: true,
        });
        global.fetch = jest.fn(async (url) => {
            if (url === fixture.targetSegmentUrl) throw rawError;
            const responses = new Map([
                [fixture.masterUrl, fixture.masterPlaylist],
                [fixture.originalMediaUrl, fixture.originalMediaPlaylist],
                [fixture.originalSegmentUrl, fixture.originalVtt],
                [fixture.targetMediaUrl, fixture.targetMediaPlaylist],
            ]);
            if (!responses.has(url)) throw new Error('Unexpected subtitle URL');
            return createSubtitleFetchResponse(responses.get(url), url);
        });

        const result = await subtitleService.processDisneyPlusSubtitles(
            fixture.snapshot
        );

        expect(result).toMatchObject({
            sourceLanguage: 'en',
            targetLanguage: 'zh-CN',
            useNativeTarget: false,
            targetLanguageInfo: { code: 'zh-CN' },
        });
        expect(result.vttText).toContain('Original');
        expect(result.targetVttText).toBe(result.vttText);

        expectStrictAuthorizedGetSequence(
            fixture.masterUrl,
            fixture.originalMediaUrl,
            fixture.originalSegmentUrl,
            fixture.targetMediaUrl,
            fixture.targetSegmentUrl
        );
    });

    test.each([
        ['transport', 'ERR_FETCH_FAILED'],
        ['policy', 'ERR_SUBTITLE_URL_NOT_ALLOWED'],
        ['timeout', 'ERR_FETCH_TIMEOUT'],
        ['limit', 'ERR_RESPONSE_BODY_LIMIT'],
        ['conversion', 'ERR_VTT_SEGMENTS_EMPTY'],
    ])(
        'soft-falls back after an official-target %s failure (%s)',
        async (_failureKind, failureCode) => {
            const fixture = createNativeTargetChainFixture();
            const originalFetchLanguageSpecificSubtitles =
                subtitleService.fetchLanguageSpecificSubtitles.bind(
                    subtitleService
                );
            const targetFailure = Object.assign(
                new Error(`PRIVATE_TARGET_${failureCode}`),
                { code: failureCode }
            );
            jest.spyOn(configService, 'getMultiple').mockResolvedValue({
                useNativeSubtitles: false,
                useOfficialTranslations: true,
            });
            global.fetch = jest.fn(async (url) => {
                const responses = new Map([
                    [fixture.masterUrl, fixture.masterPlaylist],
                    [fixture.originalMediaUrl, fixture.originalMediaPlaylist],
                    [fixture.originalSegmentUrl, fixture.originalVtt],
                ]);
                if (!responses.has(url)) {
                    throw new Error('Unexpected subtitle URL');
                }
                return createSubtitleFetchResponse(responses.get(url), url);
            });
            jest.spyOn(
                subtitleService,
                'fetchLanguageSpecificSubtitles'
            ).mockImplementation((snapshot, uri, baseUrl, options) => {
                if (uri === fixture.targetMediaUri) {
                    return Promise.reject(targetFailure);
                }
                return originalFetchLanguageSpecificSubtitles(
                    snapshot,
                    uri,
                    baseUrl,
                    options
                );
            });

            const result = await subtitleService.processDisneyPlusSubtitles(
                fixture.snapshot
            );

            expect(result.useNativeTarget).toBe(false);
            expect(result.targetVttText).toBe(result.vttText);
            expect(result.vttText).toContain('Original');
            expect(result.targetLanguageInfo).toEqual({ code: 'zh-CN' });
            expectStrictAuthorizedGetSequence(
                fixture.masterUrl,
                fixture.originalMediaUrl,
                fixture.originalSegmentUrl
            );
        }
    );

    test('keeps a mandatory-original transport failure terminal', async () => {
        const fixture = createNativeTargetChainFixture();
        jest.spyOn(configService, 'getMultiple').mockResolvedValue({
            useNativeSubtitles: false,
            useOfficialTranslations: true,
        });
        global.fetch = jest.fn(async (url) => {
            if (url === fixture.originalSegmentUrl) {
                throw new TypeError('PRIVATE_ORIGINAL_TRANSPORT_FAILURE');
            }
            const responses = new Map([
                [fixture.masterUrl, fixture.masterPlaylist],
                [fixture.originalMediaUrl, fixture.originalMediaPlaylist],
            ]);
            if (!responses.has(url)) throw new Error('Unexpected subtitle URL');
            return createSubtitleFetchResponse(responses.get(url), url);
        });

        const error = await subtitleService
            .processDisneyPlusSubtitles(fixture.snapshot)
            .catch((caughtError) => caughtError);

        expect(error).toMatchObject({
            message: 'No VTT segments could be fetched.',
            code: 'ERR_VTT_SEGMENTS_UNAVAILABLE',
        });
        expect(global.fetch).not.toHaveBeenCalledWith(
            fixture.targetMediaUrl,
            expect.anything()
        );
    });

    test('keeps caller abort terminal and fixed while the native target is in flight', async () => {
        const fixture = createNativeTargetChainFixture();
        const abortSecret = 'PRIVATE_TARGET_ABORT_REASON';
        const controller = new AbortController();
        let markTargetFetchStarted;
        const targetFetchStarted = new Promise((resolve) => {
            markTargetFetchStarted = resolve;
        });
        jest.spyOn(configService, 'getMultiple').mockResolvedValue({
            useNativeSubtitles: false,
            useOfficialTranslations: true,
        });
        global.fetch = jest.fn(async (url) => {
            if (url === fixture.targetMediaUrl) {
                markTargetFetchStarted();
                return await new Promise(() => {});
            }
            const responses = new Map([
                [fixture.masterUrl, fixture.masterPlaylist],
                [fixture.originalMediaUrl, fixture.originalMediaPlaylist],
                [fixture.originalSegmentUrl, fixture.originalVtt],
            ]);
            if (!responses.has(url)) throw new Error('Unexpected subtitle URL');
            return createSubtitleFetchResponse(responses.get(url), url);
        });

        const operation = subtitleService.processDisneyPlusSubtitles(
            fixture.snapshot,
            { signal: controller.signal }
        );
        await targetFetchStarted;
        controller.abort(new Error(abortSecret));
        const error = await operation.catch((caughtError) => caughtError);

        expectFixedAbortError(error, abortSecret);
        expectStrictAuthorizedGetSequence(
            fixture.masterUrl,
            fixture.originalMediaUrl,
            fixture.originalSegmentUrl,
            fixture.targetMediaUrl
        );
        expect(
            global.fetch.mock.calls.filter(
                ([url]) => url === fixture.targetSegmentUrl
            )
        ).toHaveLength(0);
    });

    test('keeps caller abort terminal while an official-target segment is in flight', async () => {
        const fixture = createNativeTargetChainFixture();
        const abortSecret = 'PRIVATE_TARGET_SEGMENT_ABORT_REASON';
        const controller = new AbortController();
        let markTargetSegmentFetchStarted;
        const targetSegmentFetchStarted = new Promise((resolve) => {
            markTargetSegmentFetchStarted = resolve;
        });
        jest.spyOn(configService, 'getMultiple').mockResolvedValue({
            useNativeSubtitles: false,
            useOfficialTranslations: true,
        });
        global.fetch = jest.fn(async (url) => {
            if (url === fixture.targetSegmentUrl) {
                markTargetSegmentFetchStarted();
                return await new Promise(() => {});
            }
            const responses = new Map([
                [fixture.masterUrl, fixture.masterPlaylist],
                [fixture.originalMediaUrl, fixture.originalMediaPlaylist],
                [fixture.originalSegmentUrl, fixture.originalVtt],
                [fixture.targetMediaUrl, fixture.targetMediaPlaylist],
            ]);
            if (!responses.has(url)) throw new Error('Unexpected subtitle URL');
            return createSubtitleFetchResponse(responses.get(url), url);
        });

        const operation = subtitleService.processDisneyPlusSubtitles(
            fixture.snapshot,
            { signal: controller.signal }
        );
        await targetSegmentFetchStarted;
        controller.abort(new Error(abortSecret));
        const error = await operation.catch((caughtError) => caughtError);

        expectFixedVttAbortError(error, abortSecret);
        expectStrictAuthorizedGetSequence(
            fixture.masterUrl,
            fixture.originalMediaUrl,
            fixture.originalSegmentUrl,
            fixture.targetMediaUrl,
            fixture.targetSegmentUrl
        );
    });

    test('accepts direct WEBVTT at the exact classification byte cap', async () => {
        const masterUrl =
            'https://captions.media.dssott.com/show/direct-at-cap.vtt';
        const header = 'WEBVTT\n\n';
        const directVtt =
            header + 'x'.repeat(MAX_M3U8_PLAYLIST_BYTES - header.length);
        const snapshot = createAuthorizedDisneySubtitleSnapshot({
            subtitleUrl: masterUrl,
        });
        global.fetch = jest.fn(async (url) =>
            createSubtitleFetchResponse(directVtt, url)
        );

        const result =
            await subtitleService.processDisneyPlusSubtitles(snapshot);

        expect(new Blob([directVtt]).size).toBe(MAX_M3U8_PLAYLIST_BYTES);
        expect(result).toEqual({
            vttText: directVtt,
            targetVttText: directVtt,
            sourceLanguage: 'en',
            targetLanguage: 'zh-CN',
            useNativeTarget: false,
            availableLanguages: [],
            selectedLanguage: 'en',
            targetLanguageInfo: { code: 'zh-CN' },
        });
        expect(global.fetch).toHaveBeenCalledTimes(1);
        expectStrictAuthorizedGetCall(global.fetch.mock.calls[0], masterUrl);
    });

    test('rejects direct WEBVTT one byte above the classification cap', async () => {
        const masterUrl =
            'https://captions.media.dssott.com/show/direct-over-cap.vtt';
        const header = 'WEBVTT\n\n';
        const directVtt =
            header + 'x'.repeat(MAX_M3U8_PLAYLIST_BYTES + 1 - header.length);
        const snapshot = createAuthorizedDisneySubtitleSnapshot({
            subtitleUrl: masterUrl,
        });
        global.fetch = jest.fn(async (url) =>
            createSubtitleFetchResponse(directVtt, url)
        );

        await expect(
            subtitleService.processDisneyPlusSubtitles(snapshot)
        ).rejects.toMatchObject({
            name: 'ResponseBodyLimitError',
            code: 'ERR_RESPONSE_BODY_LIMIT',
            limitBytes: MAX_M3U8_PLAYLIST_BYTES,
            observedBytes: MAX_M3U8_PLAYLIST_BYTES + 1,
        });

        expect(new Blob([directVtt]).size).toBe(MAX_M3U8_PLAYLIST_BYTES + 1);
        expect(global.fetch).toHaveBeenCalledTimes(1);
        expectStrictAuthorizedGetCall(global.fetch.mock.calls[0], masterUrl);
    });

    test.each([
        [
            'final URL mismatch',
            {
                url: 'https://captions.media.dssott.com/show/other.vtt',
            },
            'ERR_SUBTITLE_FETCH_FINAL_URL',
        ],
        ['non-OK HTTP response', { ok: false }, 'ERR_SUBTITLE_FETCH_HTTP'],
    ])(
        'inherits %s rejection from authorized transport',
        async (_label, responseOverrides, expectedCode) => {
            const masterUrl =
                'https://captions.media.dssott.com/show/rejected.vtt';
            const snapshot = createAuthorizedDisneySubtitleSnapshot({
                subtitleUrl: masterUrl,
            });
            const response = createSubtitleFetchResponse(
                'WEBVTT\n\nRejected',
                masterUrl,
                responseOverrides
            );
            global.fetch = jest.fn().mockResolvedValue(response);

            await expect(
                subtitleService.processDisneyPlusSubtitles(snapshot)
            ).rejects.toMatchObject({
                name: 'SubtitleFetchError',
                message: 'Subtitle response rejected.',
                code: expectedCode,
            });

            expect(global.fetch).toHaveBeenCalledTimes(1);
            expectStrictAuthorizedGetCall(
                global.fetch.mock.calls[0],
                masterUrl
            );
            expect(response.body.cancel).toHaveBeenCalledTimes(1);
        }
    );

    test('pre-abort stops before network without exposing the caller reason', async () => {
        const abortSecret = 'PRIVATE_PRE_ABORT_REASON';
        const controller = new AbortController();
        controller.abort(new Error(abortSecret));
        const snapshot = createAuthorizedDisneySubtitleSnapshot();
        global.fetch = jest.fn();

        const error = await subtitleService
            .processDisneyPlusSubtitles(snapshot, {
                signal: controller.signal,
            })
            .catch((caughtError) => caughtError);

        expectFixedAbortError(error, abortSecret);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('in-flight abort rejects without exposing the caller reason', async () => {
        const abortSecret = 'PRIVATE_IN_FLIGHT_ABORT_REASON';
        const controller = new AbortController();
        const snapshot = createAuthorizedDisneySubtitleSnapshot();
        global.fetch = jest.fn(() => new Promise(() => {}));

        const operation = subtitleService.processDisneyPlusSubtitles(snapshot, {
            signal: controller.signal,
        });
        await Promise.resolve();
        await Promise.resolve();
        expect(global.fetch).toHaveBeenCalledTimes(1);

        controller.abort(new Error(abortSecret));
        const error = await operation.catch((caughtError) => caughtError);

        expectFixedAbortError(error, abortSecret);
    });
});
