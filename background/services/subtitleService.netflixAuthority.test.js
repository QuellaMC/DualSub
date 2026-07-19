import {
    afterEach,
    beforeAll,
    describe,
    expect,
    jest,
    test,
} from '@jest/globals';
import {
    MAX_NETFLIX_TTML_BYTES,
    netflixParser,
} from '../parsers/netflixParser.js';
import { subtitleService } from './subtitleService.js';
import {
    createAuthorizedDisneySubtitleSnapshot,
    createAuthorizedNetflixSubtitleSnapshot,
    createSubtitleFetchResponse,
} from '../../test-utils/subtitle-fetch-fixtures.js';
import { normalizeLanguageCode } from '../../utils/languageNormalization.js';

const originalFetch = global.fetch;
const NETFLIX_ORIGINAL_URL = 'https://captions.nflxvideo.net/show/en.ttml';
const NETFLIX_TARGET_URL = 'https://captions.nflxvideo.net/show/zh-CN.ttml';
const VALID_ORIGINAL_TTML =
    '<tt><body><div><p begin="0s" end="1s">Original</p></div></body></tt>';
const VALID_TARGET_TTML =
    '<tt><body><div><p begin="0s" end="1s">Target</p></div></body></tt>';

function createNetflixTrack(language, url) {
    return {
        language,
        displayName: language,
        trackType: 'PRIMARY',
        isNoneTrack: false,
        isForcedNarrative: false,
        ttDownloadables: {
            dfxp: { urls: [{ url }] },
        },
    };
}

function createOfficialTargetSnapshot() {
    return createAuthorizedNetflixSubtitleSnapshot({
        tracks: [
            createNetflixTrack('en', NETFLIX_ORIGINAL_URL),
            createNetflixTrack('zh-CN', NETFLIX_TARGET_URL),
        ],
        originalLanguage: 'en',
        targetLanguage: 'zh-CN',
        useNativeSubtitles: true,
        useOfficialTranslations: true,
    });
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
        redirect: 'error',
        credentials: 'omit',
        signal: expect.any(AbortSignal),
    });
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

function expectOriginalTargetFallback(result) {
    expect(result.vttText).toContain('Original');
    expect(result.targetVttText).toBe(result.vttText);
    expect(result.useNativeTarget).toBe(false);
}

beforeAll(async () => {
    await subtitleService.initialize();
});

afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
});

describe('SubtitleService Netflix authority', () => {
    test('keeps a synchronous parser-initialization failure out of logs', async () => {
        const signedUrlCanary =
            'https://captions.nflxvideo.net/private/init.ttml?token=INIT_LOG_SECRET';
        const parserError = new Error(`parser init failed: ${signedUrlCanary}`);
        parserError.stack = `STACK ${signedUrlCanary}`;
        const initializeSpy = jest
            .spyOn(netflixParser, 'initialize')
            .mockImplementation(() => {
                throw parserError;
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
            await expect(subtitleService.initializeParsers()).rejects.toBe(
                parserError
            );
            expect(serviceLogger.error).toHaveBeenCalledWith(
                'Failed to initialize subtitle parser modules',
                null,
                {
                    stage: 'initialize',
                    source: 'parsers',
                }
            );
            expect(serviceLogger.error.mock.calls.flat()).not.toContain(
                parserError
            );
            const serializedLoggerCalls = JSON.stringify(
                Object.values(serviceLogger).flatMap(
                    (method) => method.mock.calls
                )
            );
            expect(serializedLoggerCalls).not.toContain('INIT_LOG_SECRET');
            expect(serializedLoggerCalls).not.toContain('/private/init.ttml');
            expect(serializedLoggerCalls).not.toContain('token=');
            expect(initializeSpy).toHaveBeenCalledTimes(1);
        } finally {
            subtitleService.logger = originalLogger;
        }
    });

    test('rejects an unbranded snapshot before consulting a hostile source getter', async () => {
        const sourceSecret = 'PRIVATE_FORGED_NETFLIX_SOURCE';
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
            .processNetflixSubtitles(forgedSnapshot)
            .catch((caughtError) => caughtError);

        expect(sourceGetter).not.toHaveBeenCalled();
        expect(error).toMatchObject({
            name: 'SubtitleServiceAuthorizationError',
            message: 'Netflix subtitle request is unauthorized.',
            code: 'ERR_NETFLIX_SUBTITLE_REQUEST_UNAUTHORIZED',
        });
        expect(String(error)).not.toContain(sourceSecret);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('passes the exact branded snapshot to the parser without synthetic options', async () => {
        const snapshot = createAuthorizedNetflixSubtitleSnapshot();
        const result = {
            vttText: 'WEBVTT',
            targetVttText: 'WEBVTT',
            sourceLanguage: 'en',
            targetLanguage: 'zh-CN',
            useNativeTarget: false,
            availableLanguages: [],
            url: 'Netflix TTML',
        };
        const processSpy = jest
            .spyOn(netflixParser, 'processNetflixSubtitleData')
            .mockResolvedValue(result);

        await expect(
            subtitleService.processNetflixSubtitles(snapshot)
        ).resolves.toBe(result);

        expect(processSpy).toHaveBeenCalledTimes(1);
        expect(processSpy).toHaveBeenCalledWith(snapshot);
    });

    test('keeps authorized URL-shaped language values functional but out of service success logs', async () => {
        const sourceLanguageCanary =
            'https://x.test/s?token=NETFLIXSRCLANGSECRET';
        const targetLanguageCanary =
            'https://x.test/t?token=NETFLIXTGTLANGSECRET';
        const snapshot = createAuthorizedNetflixSubtitleSnapshot({
            originalLanguage: sourceLanguageCanary,
            targetLanguage: targetLanguageCanary,
        });
        const result = {
            vttText: 'WEBVTT',
            targetVttText: 'WEBVTT',
            sourceLanguage: normalizeLanguageCode(sourceLanguageCanary),
            targetLanguage: normalizeLanguageCode(targetLanguageCanary),
            useNativeTarget: false,
            availableLanguages: [],
            url: 'Netflix TTML',
        };
        jest.spyOn(
            netflixParser,
            'processNetflixSubtitleData'
        ).mockResolvedValue(result);
        const originalLogger = subtitleService.logger;
        const serviceLogger = {
            debug: jest.fn(),
            error: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
        };
        subtitleService.logger = serviceLogger;

        try {
            await expect(
                subtitleService.processNetflixSubtitles(snapshot)
            ).resolves.toBe(result);
            expect(snapshot.originalLanguage).toBe(sourceLanguageCanary);
            expect(snapshot.targetLanguage).toBe(targetLanguageCanary);
            expect(result.sourceLanguage).toBe(
                normalizeLanguageCode(sourceLanguageCanary)
            );
            expect(result.targetLanguage).toBe(
                normalizeLanguageCode(targetLanguageCanary)
            );
            expect(serviceLogger.info).toHaveBeenCalledWith(
                'Processing Netflix subtitles',
                {
                    hasTargetLanguage: true,
                    hasOriginalLanguage: true,
                    useNativeSubtitles: true,
                    useOfficialTranslations: false,
                }
            );
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
        } finally {
            subtitleService.logger = originalLogger;
        }
    });

    test('keeps an asynchronous parser failure private in service errors and logs', async () => {
        const signedUrlCanary =
            'https://captions.nflxvideo.net/private/en.ttml?token=SERVICE_LOG_SECRET';
        const sourceLanguageCanary =
            'https://x.test/s?token=NETFLIXFAILSRCSECRET';
        const targetLanguageCanary =
            'https://x.test/t?token=NETFLIXFAILTGTSECRET';
        const snapshot = createAuthorizedNetflixSubtitleSnapshot({
            originalLanguage: sourceLanguageCanary,
            targetLanguage: targetLanguageCanary,
        });
        const parserError = new Error(`fetch failed: ${signedUrlCanary}`, {
            cause: { signedUrlCanary },
        });
        parserError.stack = `STACK ${signedUrlCanary}`;
        parserError.extraSecret = signedUrlCanary;
        const processSpy = jest
            .spyOn(netflixParser, 'processNetflixSubtitleData')
            .mockRejectedValue(parserError);
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
                .processNetflixSubtitles(snapshot)
                .catch((caughtError) => caughtError);

            expect(error).toMatchObject({
                name: 'SubtitleProcessingError',
                message:
                    'Subtitle processing failed. Some subtitles may not be available.',
                type: 'SUBTITLE_PROCESSING_ERROR',
                details: {
                    platform: 'netflix',
                    category: 'subtitle',
                    errorCode: 'SUBTITLE_PROCESSING_FAILED',
                    isRecoverable: true,
                },
            });
            expect(error.details).not.toHaveProperty('originalError');
            expect(serviceLogger.error).toHaveBeenCalledWith(
                'Netflix subtitle processing failed',
                null,
                {
                    stage: 'process',
                    source: 'netflix',
                    category: 'subtitle',
                    errorCode: 'SUBTITLE_PROCESSING_FAILED',
                }
            );
            expect(
                Object.values(serviceLogger).flatMap((method) =>
                    method.mock.calls.flat()
                )
            ).not.toContain(parserError);
            const serializedLoggerCalls = JSON.stringify(
                Object.values(serviceLogger).flatMap(
                    (method) => method.mock.calls
                )
            );
            for (const sensitiveValue of [
                'SERVICE_LOG_SECRET',
                sourceLanguageCanary,
                targetLanguageCanary,
                normalizeLanguageCode(sourceLanguageCanary),
                normalizeLanguageCode(targetLanguageCanary),
                '/private/en.ttml',
                '/s?token=',
                '/t?token=',
                'token=',
            ]) {
                expect(serializedLoggerCalls).not.toContain(sensitiveValue);
            }
            expect(JSON.stringify(error)).not.toContain('SERVICE_LOG_SECRET');
            expect(processSpy).toHaveBeenCalledTimes(1);
        } finally {
            subtitleService.logger = originalLogger;
        }
    });

    test('does not replace a parser failure when error or logger accessors are hostile', async () => {
        let errorDescriptorReads = 0;
        let errorValueReads = 0;
        const hostileError = new Proxy(Object.create(null), {
            getOwnPropertyDescriptor() {
                errorDescriptorReads += 1;
                throw new Error('HOSTILE_ERROR_DESCRIPTOR_CANARY');
            },
            get() {
                errorValueReads += 1;
                throw new Error('HOSTILE_ERROR_VALUE_CANARY');
            },
        });
        jest.spyOn(
            netflixParser,
            'processNetflixSubtitleData'
        ).mockRejectedValue(hostileError);
        const originalLogger = subtitleService.logger;
        let loggerErrorReads = 0;
        const serviceLogger = {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
        };
        Object.defineProperty(serviceLogger, 'error', {
            configurable: true,
            get() {
                loggerErrorReads += 1;
                throw new Error('HOSTILE_LOGGER_ACCESSOR_CANARY');
            },
        });
        subtitleService.logger = serviceLogger;

        try {
            const error = await subtitleService
                .processNetflixSubtitles(
                    createAuthorizedNetflixSubtitleSnapshot()
                )
                .catch((caughtError) => caughtError);

            expect(error).toMatchObject({
                name: 'SubtitleProcessingError',
                message:
                    'Subtitle processing failed. Some subtitles may not be available.',
                type: 'SUBTITLE_PROCESSING_ERROR',
            });
            expect(errorDescriptorReads).toBe(1);
            expect(errorValueReads).toBe(0);
            expect(loggerErrorReads).toBe(1);
            expect(String(error)).not.toContain('HOSTILE_');
        } finally {
            subtitleService.logger = originalLogger;
        }
    });

    test('keeps a synchronous language-inventory parser failure private', async () => {
        const signedUrlCanary =
            'https://captions.nflxvideo.net/private/inventory.ttml?token=INVENTORY_LOG_SECRET';
        const parserError = new Error(`inventory failed: ${signedUrlCanary}`);
        parserError.stack = `STACK ${signedUrlCanary}`;
        parserError.cause = { signedUrlCanary };
        const extractSpy = jest
            .spyOn(netflixParser, 'extractNetflixTracks')
            .mockImplementation(() => {
                throw parserError;
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
            await expect(
                subtitleService.getAvailableLanguages('netflix', {
                    tracks: [{}],
                })
            ).resolves.toEqual([]);
            expect(serviceLogger.error).toHaveBeenCalledWith(
                'Failed to get available subtitle languages',
                null,
                {
                    stage: 'inventory',
                    source: 'netflix',
                }
            );
            expect(
                Object.values(serviceLogger).flatMap((method) =>
                    method.mock.calls.flat()
                )
            ).not.toContain(parserError);
            const serializedLoggerCalls = JSON.stringify(
                Object.values(serviceLogger).flatMap(
                    (method) => method.mock.calls
                )
            );
            expect(serializedLoggerCalls).not.toContain('INVENTORY_LOG_SECRET');
            expect(serializedLoggerCalls).not.toContain(
                '/private/inventory.ttml'
            );
            expect(serializedLoggerCalls).not.toContain('token=');
            expect(extractSpy).toHaveBeenCalledTimes(1);
        } finally {
            subtitleService.logger = originalLogger;
        }
    });

    test('does not log an unsupported platform identifier as URL content', async () => {
        const platformCanary =
            'https://attacker.example/private/platform?token=PLATFORM_LOG_SECRET';
        const originalLogger = subtitleService.logger;
        const serviceLogger = {
            debug: jest.fn(),
            error: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
        };
        subtitleService.logger = serviceLogger;

        try {
            await expect(
                subtitleService.getAvailableLanguages(platformCanary, {})
            ).resolves.toEqual([]);
            expect(serviceLogger.debug).toHaveBeenCalledWith(
                'Getting available languages',
                {
                    source: 'unknown',
                    supported: false,
                }
            );
            expect(serviceLogger.warn).toHaveBeenCalledWith(
                'Language detection not supported for platform',
                { source: 'unknown' }
            );
            const serializedLoggerCalls = JSON.stringify(
                Object.values(serviceLogger).flatMap(
                    (method) => method.mock.calls
                )
            );
            expect(serializedLoggerCalls).not.toContain('PLATFORM_LOG_SECRET');
            expect(serializedLoggerCalls).not.toContain('/private/platform');
            expect(serializedLoggerCalls).not.toContain('token=');
        } finally {
            subtitleService.logger = originalLogger;
        }
    });

    test('parser rejects an unbranded snapshot before consulting a hostile source getter', async () => {
        const sourceSecret = 'PRIVATE_FORGED_NETFLIX_PARSER_SOURCE';
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

        const error = await netflixParser
            .processNetflixSubtitleData(forgedSnapshot)
            .catch((caughtError) => caughtError);

        expect(sourceGetter).not.toHaveBeenCalled();
        expect(error).toMatchObject({
            name: 'NetflixParserAuthorizationError',
            message: 'Netflix subtitle request is unauthorized.',
            code: 'ERR_NETFLIX_SUBTITLE_REQUEST_UNAUTHORIZED',
        });
        expect(String(error)).not.toContain(sourceSecret);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('fetches one authorized original track with the strict transport contract', async () => {
        const snapshot = createAuthorizedNetflixSubtitleSnapshot({
            subtitleUrl: NETFLIX_ORIGINAL_URL,
        });
        global.fetch = jest.fn(async (url) =>
            createSubtitleFetchResponse(VALID_ORIGINAL_TTML, url)
        );

        const result = await subtitleService.processNetflixSubtitles(snapshot);

        expect(result.vttText).toContain('Original');
        expect(result.targetVttText).toBe(result.vttText);
        expect(result.useNativeTarget).toBe(false);
        expect(global.fetch).toHaveBeenCalledTimes(1);
        expectStrictAuthorizedGetCall(
            global.fetch.mock.calls[0],
            NETFLIX_ORIGINAL_URL
        );
    });

    test('fetches each selected original and official target exactly once with one snapshot', async () => {
        const snapshot = createOfficialTargetSnapshot();
        const trackFetchSpy = jest.spyOn(
            netflixParser,
            'fetchNetflixSubtitleContent'
        );
        global.fetch = jest.fn(async (url) =>
            createSubtitleFetchResponse(
                url === NETFLIX_ORIGINAL_URL
                    ? VALID_ORIGINAL_TTML
                    : VALID_TARGET_TTML,
                url
            )
        );

        const result = await subtitleService.processNetflixSubtitles(snapshot);

        expect(result.vttText).toContain('Original');
        expect(result.targetVttText).toContain('Target');
        expect(result.useNativeTarget).toBe(true);
        expect(global.fetch).toHaveBeenCalledTimes(2);
        expectStrictAuthorizedGetCall(
            global.fetch.mock.calls[0],
            NETFLIX_ORIGINAL_URL
        );
        expectStrictAuthorizedGetCall(
            global.fetch.mock.calls[1],
            NETFLIX_TARGET_URL
        );
        expect(trackFetchSpy).toHaveBeenCalledTimes(2);
        expect(trackFetchSpy.mock.calls[0][0]).toBe(snapshot);
        expect(trackFetchSpy.mock.calls[1][0]).toBe(snapshot);
        expect(trackFetchSpy.mock.calls[0]).toHaveLength(2);
        expect(trackFetchSpy.mock.calls[1]).toHaveLength(2);
    });

    test('passes an internal signal with the exact snapshot and preserves caller abort identity', async () => {
        const snapshot = createAuthorizedNetflixSubtitleSnapshot();
        const controller = new AbortController();
        const callerAbort = new Error('Request was aborted by the caller.');
        callerAbort.name = 'AbortError';
        callerAbort.code = 'ERR_FETCH_ABORTED';
        const processSpy = jest
            .spyOn(netflixParser, 'processNetflixSubtitleData')
            .mockRejectedValue(callerAbort);

        const error = await subtitleService
            .processNetflixSubtitles(snapshot, {
                signal: controller.signal,
            })
            .catch((caughtError) => caughtError);

        expect(processSpy).toHaveBeenCalledTimes(1);
        expect(processSpy).toHaveBeenCalledWith(snapshot, {
            signal: controller.signal,
        });
        expect(error).toBe(callerAbort);
    });

    test('carries one internal signal beside the exact snapshot into both selected track fetches', async () => {
        const snapshot = createOfficialTargetSnapshot();
        const controller = new AbortController();
        const trackFetchSpy = jest.spyOn(
            netflixParser,
            'fetchNetflixSubtitleContent'
        );
        global.fetch = jest.fn(async (url) =>
            createSubtitleFetchResponse(
                url === NETFLIX_ORIGINAL_URL
                    ? VALID_ORIGINAL_TTML
                    : VALID_TARGET_TTML,
                url
            )
        );

        await subtitleService.processNetflixSubtitles(snapshot, {
            signal: controller.signal,
        });

        expect(trackFetchSpy).toHaveBeenCalledTimes(2);
        for (const call of trackFetchSpy.mock.calls) {
            expect(call[0]).toBe(snapshot);
            expect(call[2]).toEqual({ signal: controller.signal });
            expect(call).toHaveLength(3);
        }
    });

    test('service rejects a branded Disney snapshot before reading hostile options', async () => {
        const signalGetter = jest.fn(() => {
            throw new Error('PRIVATE_CROSS_SOURCE_SERVICE_SIGNAL');
        });
        const options = {};
        Object.defineProperty(options, 'signal', {
            configurable: true,
            enumerable: true,
            get: signalGetter,
        });

        const error = await subtitleService
            .processNetflixSubtitles(
                createAuthorizedDisneySubtitleSnapshot(),
                options
            )
            .catch((caughtError) => caughtError);

        expect(signalGetter).not.toHaveBeenCalled();
        expect(error).toMatchObject({
            name: 'SubtitleServiceAuthorizationError',
            code: 'ERR_NETFLIX_SUBTITLE_REQUEST_UNAUTHORIZED',
        });
    });

    test('parser rejects a branded Disney snapshot before reading hostile options', async () => {
        const signalGetter = jest.fn(() => {
            throw new Error('PRIVATE_CROSS_SOURCE_PARSER_SIGNAL');
        });
        const options = {};
        Object.defineProperty(options, 'signal', {
            configurable: true,
            enumerable: true,
            get: signalGetter,
        });

        const error = await netflixParser
            .processNetflixSubtitleData(
                createAuthorizedDisneySubtitleSnapshot(),
                options
            )
            .catch((caughtError) => caughtError);

        expect(signalGetter).not.toHaveBeenCalled();
        expect(error).toMatchObject({
            name: 'NetflixParserAuthorizationError',
            code: 'ERR_NETFLIX_SUBTITLE_REQUEST_UNAUTHORIZED',
        });
    });

    test('track fetch rejects a branded Disney snapshot before reading hostile track or options', async () => {
        const hostileRead = jest.fn(() => {
            throw new Error('PRIVATE_CROSS_SOURCE_TRACK');
        });
        const track = {};
        const options = {};
        Object.defineProperty(track, 'downloadUrl', {
            configurable: true,
            enumerable: true,
            get: hostileRead,
        });
        Object.defineProperty(options, 'signal', {
            configurable: true,
            enumerable: true,
            get: hostileRead,
        });
        global.fetch = jest.fn();

        const error = await netflixParser
            .fetchNetflixSubtitleContent(
                createAuthorizedDisneySubtitleSnapshot(),
                track,
                options
            )
            .catch((caughtError) => caughtError);

        expect(hostileRead).not.toHaveBeenCalled();
        expect(error).toMatchObject({
            name: 'NetflixParserAuthorizationError',
            code: 'ERR_NETFLIX_SUBTITLE_REQUEST_UNAUTHORIZED',
        });
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test.each([
        [
            'service',
            (snapshot, options) =>
                subtitleService.processNetflixSubtitles(snapshot, options),
            'SubtitleServiceInputError',
            'ERR_NETFLIX_SUBTITLE_INPUT_INVALID',
        ],
        [
            'parser',
            (snapshot, options) =>
                netflixParser.processNetflixSubtitleData(snapshot, options),
            'NetflixParserInputError',
            'ERR_NETFLIX_SUBTITLE_INPUT_INVALID',
        ],
        [
            'track fetch',
            (snapshot, options) =>
                netflixParser.fetchNetflixSubtitleContent(
                    snapshot,
                    {
                        language: 'en',
                        downloadUrl: NETFLIX_ORIGINAL_URL,
                    },
                    options
                ),
            'NetflixParserInputError',
            'ERR_NETFLIX_SUBTITLE_INPUT_INVALID',
        ],
    ])(
        'rejects an accessor-backed internal signal at the %s boundary without invoking it',
        async (_label, operation, expectedName, expectedCode) => {
            const signalGetter = jest.fn(() => {
                throw new Error('PRIVATE_INTERNAL_SIGNAL_GETTER');
            });
            const options = {};
            Object.defineProperty(options, 'signal', {
                configurable: true,
                enumerable: true,
                get: signalGetter,
            });
            const snapshot = createAuthorizedNetflixSubtitleSnapshot();
            global.fetch = jest.fn();

            const error = await operation(snapshot, options).catch(
                (caughtError) => caughtError
            );

            expect(signalGetter).not.toHaveBeenCalled();
            expect(error).toMatchObject({
                name: expectedName,
                code: expectedCode,
            });
            expect(global.fetch).not.toHaveBeenCalled();
        }
    );

    test.each([
        [
            'service',
            (snapshot, options) =>
                subtitleService.processNetflixSubtitles(snapshot, options),
        ],
        [
            'parser',
            (snapshot, options) =>
                netflixParser.processNetflixSubtitleData(snapshot, options),
        ],
        [
            'track fetch',
            (snapshot, options) =>
                netflixParser.fetchNetflixSubtitleContent(
                    snapshot,
                    {
                        language: 'en',
                        downloadUrl: NETFLIX_ORIGINAL_URL,
                    },
                    options
                ),
        ],
    ])(
        'ignores an inherited internal signal at the %s boundary without invoking it',
        async (_label, operation) => {
            const signalGetter = jest.fn(() => {
                throw new Error('PRIVATE_INHERITED_SIGNAL_GETTER');
            });
            const prototype = {};
            Object.defineProperty(prototype, 'signal', {
                configurable: true,
                get: signalGetter,
            });
            const options = Object.create(prototype);
            const snapshot = createAuthorizedNetflixSubtitleSnapshot({
                subtitleUrl: NETFLIX_ORIGINAL_URL,
            });
            global.fetch = jest.fn(async (url) =>
                createSubtitleFetchResponse(VALID_ORIGINAL_TTML, url)
            );

            await expect(operation(snapshot, options)).resolves.toBeDefined();

            expect(signalGetter).not.toHaveBeenCalled();
            expect(global.fetch).toHaveBeenCalledTimes(1);
        }
    );

    test('blocks a cross-origin Netflix track before issuing a request', async () => {
        const snapshot = createAuthorizedNetflixSubtitleSnapshot();
        const blockedUrl = 'https://attacker.example/private.ttml';
        global.fetch = jest.fn();

        const error = await netflixParser
            .fetchNetflixSubtitleContent(snapshot, {
                language: 'en',
                downloadUrl: blockedUrl,
            })
            .catch((caughtError) => caughtError);

        expect(error).toMatchObject({
            name: 'SubtitleRequestPolicyError',
            code: 'ERR_SUBTITLE_URL_NOT_ALLOWED',
            platform: 'netflix',
            stage: 'netflix-track',
        });
        expectErrorToExclude(error, blockedUrl);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('does not resolve a Netflix track reference against an implicit base URL', async () => {
        const snapshot = createAuthorizedNetflixSubtitleSnapshot();
        global.fetch = jest.fn();

        const error = await netflixParser
            .fetchNetflixSubtitleContent(snapshot, {
                language: 'en',
                downloadUrl: '/show/relative.ttml',
            })
            .catch((caughtError) => caughtError);

        expect(error).toMatchObject({
            name: 'SubtitleRequestPolicyError',
            code: 'ERR_SUBTITLE_URL_INVALID',
            platform: 'netflix',
            stage: 'netflix-track',
        });
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test.each([
        [
            'redirected response',
            { redirected: true },
            'ERR_SUBTITLE_FETCH_REDIRECT',
        ],
        [
            'mismatched final URL',
            {
                url: 'https://captions.nflxvideo.net/show/other.ttml',
            },
            'ERR_SUBTITLE_FETCH_FINAL_URL',
        ],
        ['non-OK HTTP response', { ok: false }, 'ERR_SUBTITLE_FETCH_HTTP'],
    ])(
        'keeps an original-track %s terminal',
        async (_label, overrides, expectedCode) => {
            const snapshot = createAuthorizedNetflixSubtitleSnapshot({
                subtitleUrl: NETFLIX_ORIGINAL_URL,
            });
            global.fetch = jest.fn(async (url) =>
                createSubtitleFetchResponse(VALID_ORIGINAL_TTML, url, overrides)
            );

            const error = await netflixParser
                .processNetflixSubtitleData(snapshot)
                .catch((caughtError) => caughtError);

            expect(error).toMatchObject({
                message: 'Subtitle response rejected.',
                code: expectedCode,
            });
            expect(global.fetch).toHaveBeenCalledTimes(1);
        }
    );

    test('keeps an original transport failure terminal and strips its reason', async () => {
        const transportSecret = 'PRIVATE_NETFLIX_TRANSPORT_REASON';
        const snapshot = createAuthorizedNetflixSubtitleSnapshot({
            subtitleUrl: NETFLIX_ORIGINAL_URL,
        });
        global.fetch = jest.fn(async () => {
            throw new Error(transportSecret);
        });

        const error = await netflixParser
            .processNetflixSubtitleData(snapshot)
            .catch((caughtError) => caughtError);

        expect(error).toMatchObject({
            name: 'TypeError',
            message: 'Failed to fetch',
            code: 'ERR_FETCH_FAILED',
        });
        expectErrorToExclude(error, transportSecret, NETFLIX_ORIGINAL_URL);
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('accepts a Netflix TTML body exactly at the provisional byte ceiling', async () => {
        const snapshot = createAuthorizedNetflixSubtitleSnapshot({
            subtitleUrl: NETFLIX_ORIGINAL_URL,
        });
        const exactBody = 'x'.repeat(MAX_NETFLIX_TTML_BYTES);
        global.fetch = jest.fn(async (url) =>
            createSubtitleFetchResponse(exactBody, url)
        );

        await expect(
            netflixParser.fetchNetflixSubtitleContent(snapshot, {
                language: 'en',
                downloadUrl: NETFLIX_ORIGINAL_URL,
            })
        ).resolves.toBe(exactBody);
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('rejects a Netflix TTML body one byte above the provisional ceiling', async () => {
        const snapshot = createAuthorizedNetflixSubtitleSnapshot({
            subtitleUrl: NETFLIX_ORIGINAL_URL,
        });
        global.fetch = jest.fn(async (url) =>
            createSubtitleFetchResponse('x', url, {
                headers: {
                    get: jest.fn(() => String(MAX_NETFLIX_TTML_BYTES + 1)),
                },
            })
        );

        const error = await netflixParser
            .processNetflixSubtitleData(snapshot)
            .catch((caughtError) => caughtError);

        expect(error).toMatchObject({
            name: 'ResponseBodyLimitError',
            code: 'ERR_RESPONSE_BODY_LIMIT',
            limitBytes: MAX_NETFLIX_TTML_BYTES,
            observedBytes: MAX_NETFLIX_TTML_BYTES + 1,
        });
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('keeps a real original-track caller abort terminal and private', async () => {
        const abortSecret = 'PRIVATE_NETFLIX_ABORT_REASON';
        const snapshot = createAuthorizedNetflixSubtitleSnapshot({
            subtitleUrl: NETFLIX_ORIGINAL_URL,
        });
        const controller = new AbortController();
        controller.abort(new Error(abortSecret));
        global.fetch = jest.fn();

        const error = await subtitleService
            .processNetflixSubtitles(snapshot, {
                signal: controller.signal,
            })
            .catch((caughtError) => caughtError);

        expect(error).toMatchObject({
            name: 'AbortError',
            message: 'Request was aborted by the caller.',
            code: 'ERR_FETCH_ABORTED',
        });
        expectErrorToExclude(error, abortSecret, NETFLIX_ORIGINAL_URL);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test.each([
        ['redirected response'],
        ['mismatched final URL'],
        ['non-OK HTTP response'],
        ['body cap'],
        ['transport failure'],
    ])(
        'soft-falls back to the valid original after an optional target %s',
        async (failureKind) => {
            const snapshot = createOfficialTargetSnapshot();
            global.fetch = jest.fn(async (url) => {
                if (url === NETFLIX_ORIGINAL_URL) {
                    return createSubtitleFetchResponse(
                        VALID_ORIGINAL_TTML,
                        url
                    );
                }
                if (failureKind === 'transport failure') {
                    throw new Error('PRIVATE_TARGET_TRANSPORT');
                }
                const overrides =
                    failureKind === 'redirected response'
                        ? { redirected: true }
                        : failureKind === 'mismatched final URL'
                          ? {
                                url: 'https://captions.nflxvideo.net/show/other.ttml',
                            }
                          : failureKind === 'non-OK HTTP response'
                            ? { ok: false }
                            : {
                                  headers: {
                                      get: jest.fn(() =>
                                          String(MAX_NETFLIX_TTML_BYTES + 1)
                                      ),
                                  },
                              };
                return createSubtitleFetchResponse(
                    VALID_TARGET_TTML,
                    url,
                    overrides
                );
            });

            const result =
                await netflixParser.processNetflixSubtitleData(snapshot);

            expectOriginalTargetFallback(result);
            expect(global.fetch).toHaveBeenCalledTimes(2);
        }
    );

    test('soft-falls back when an optional target is rejected by policy', async () => {
        const snapshot = createOfficialTargetSnapshot();
        const blockedUrl = 'https://attacker.example/private-target.ttml';
        const policyError = await netflixParser
            .fetchNetflixSubtitleContent(snapshot, {
                language: 'zh-CN',
                downloadUrl: blockedUrl,
            })
            .catch((caughtError) => caughtError);
        const realTrackFetch =
            netflixParser.fetchNetflixSubtitleContent.bind(netflixParser);
        const trackFetchSpy = jest
            .spyOn(netflixParser, 'fetchNetflixSubtitleContent')
            .mockImplementationOnce((...args) => realTrackFetch(...args))
            .mockRejectedValueOnce(policyError);
        global.fetch = jest.fn(async (url) =>
            createSubtitleFetchResponse(VALID_ORIGINAL_TTML, url)
        );

        const result = await netflixParser.processNetflixSubtitleData(snapshot);

        expect(policyError).toMatchObject({
            name: 'SubtitleRequestPolicyError',
            code: 'ERR_SUBTITLE_URL_NOT_ALLOWED',
        });
        expectOriginalTargetFallback(result);
        expect(trackFetchSpy).toHaveBeenCalledTimes(2);
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('soft-falls back when an optional target times out', async () => {
        const snapshot = createOfficialTargetSnapshot();
        const timeoutError = new Error('Subtitle request timed out.');
        timeoutError.name = 'TimeoutError';
        timeoutError.code = 'ERR_FETCH_TIMEOUT';
        const realTrackFetch =
            netflixParser.fetchNetflixSubtitleContent.bind(netflixParser);
        const trackFetchSpy = jest
            .spyOn(netflixParser, 'fetchNetflixSubtitleContent')
            .mockImplementationOnce((...args) => realTrackFetch(...args))
            .mockRejectedValueOnce(timeoutError);
        global.fetch = jest.fn(async (url) =>
            createSubtitleFetchResponse(VALID_ORIGINAL_TTML, url)
        );

        const result = await netflixParser.processNetflixSubtitleData(snapshot);

        expectOriginalTargetFallback(result);
        expect(trackFetchSpy).toHaveBeenCalledTimes(2);
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('keeps a real optional-target caller abort terminal and private', async () => {
        const abortSecret = 'PRIVATE_NETFLIX_TARGET_ABORT_REASON';
        const snapshot = createOfficialTargetSnapshot();
        const controller = new AbortController();
        global.fetch = jest.fn(async (url) => {
            if (url === NETFLIX_ORIGINAL_URL) {
                return createSubtitleFetchResponse(VALID_ORIGINAL_TTML, url);
            }
            controller.abort(new Error(abortSecret));
            return await new Promise(() => {});
        });

        const error = await subtitleService
            .processNetflixSubtitles(snapshot, {
                signal: controller.signal,
            })
            .catch((caughtError) => caughtError);

        expect(error).toMatchObject({
            name: 'AbortError',
            message: 'Request was aborted by the caller.',
            code: 'ERR_FETCH_ABORTED',
        });
        expectErrorToExclude(error, abortSecret, NETFLIX_TARGET_URL);
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });
});
