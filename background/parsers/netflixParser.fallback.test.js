import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { netflixParser } from './netflixParser.js';
import {
    createAuthorizedNetflixSubtitleSnapshot,
    createSubtitleFetchResponse,
} from '../../test-utils/subtitle-fetch-fixtures.js';
import { normalizeLanguageCode } from '../../utils/languageNormalization.js';

const originalFetch = global.fetch;
const ORIGINAL_URL = 'https://captions.nflxvideo.net/show/original.ttml';
const TARGET_URL = 'https://captions.nflxvideo.net/show/target.ttml';
const VALID_TTML =
    '<tt><body><div><p begin="0s" end="1s">Original survives</p></div></body></tt>';
const VALID_TARGET_TTML =
    '<tt><body><div><p begin="0s" end="1s">Official target</p></div></body></tt>';
const MALFORMED_TTML = '<tt><body /></tt>';

afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
});

function createNetflixTrack(language, url) {
    return {
        language,
        displayName: language,
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

function createTracks() {
    return [
        createNetflixTrack('en', ORIGINAL_URL),
        createNetflixTrack('zh-CN', TARGET_URL),
    ];
}

async function processOfficialTarget() {
    return await netflixParser.processNetflixSubtitleData(
        createAuthorizedNetflixSubtitleSnapshot({
            tracks: createTracks(),
            targetLanguage: 'zh-CN',
            originalLanguage: 'en',
            useNativeSubtitles: true,
            useOfficialTranslations: true,
        })
    );
}

function expectOriginalTranslationFallback(result, fetchOrder) {
    expect(fetchOrder).toEqual([ORIGINAL_URL, TARGET_URL]);
    expect(result.vttText).toContain('Original survives');
    expect(result.targetVttText).toBe(result.vttText);
    expect(result.useNativeTarget).toBe(false);
}

describe('NetflixParser target-track fallback', () => {
    test('projects provider track types to fixed categories at every track-type log site', async () => {
        const trackTypeCanary = 'PRIVATE_TOKEN_123';
        const sourceTrack = {
            ...createNetflixTrack('en', ORIGINAL_URL),
            trackType: trackTypeCanary,
        };
        const targetTrack = {
            ...createNetflixTrack('zh-CN', TARGET_URL),
            trackType: trackTypeCanary,
        };
        const fallbackSnapshot = createAuthorizedNetflixSubtitleSnapshot({
            tracks: [sourceTrack, targetTrack],
            originalLanguage: 'fr',
            targetLanguage: 'zh-CN',
            useNativeSubtitles: true,
            useOfficialTranslations: true,
        });
        const noTargetDownloadSnapshot =
            createAuthorizedNetflixSubtitleSnapshot({
                tracks: [sourceTrack, targetTrack],
                originalLanguage: 'en',
                targetLanguage: 'zh-CN',
                useNativeSubtitles: true,
                useOfficialTranslations: true,
            });
        const fetchSpy = jest
            .spyOn(netflixParser, 'fetchNetflixSubtitleContent')
            .mockResolvedValueOnce(VALID_TTML)
            .mockRejectedValueOnce(new Error('Optional target unavailable'));
        const originalLogger = netflixParser.logger;
        const parserLogger = {
            debug: jest.fn(),
            error: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
        };
        netflixParser.logger = parserLogger;

        try {
            const fallbackResult =
                await netflixParser.processNetflixSubtitleData(
                    fallbackSnapshot
                );

            expect(fallbackSnapshot.data.tracks[0].trackType).toBe(
                trackTypeCanary
            );
            expect(
                fallbackResult.availableLanguages.map(
                    ({ trackType }) => trackType
                )
            ).toEqual([trackTypeCanary, trackTypeCanary]);
            expect(fallbackResult.vttText).toContain('Original survives');
            expect(fallbackResult.targetVttText).toBe(fallbackResult.vttText);
            expect(fallbackResult.useNativeTarget).toBe(false);

            expect(
                netflixParser.extractDownloadUrl({
                    language: 'en',
                    trackType: trackTypeCanary,
                    ttDownloadables: {},
                })
            ).toBeNull();

            jest.spyOn(netflixParser, 'extractNetflixTracks').mockReturnValue({
                availableLanguages: [
                    {
                        rawCode: 'en',
                        normalizedCode: 'en',
                        displayName: 'English',
                        downloadUrl: ORIGINAL_URL,
                        trackType: trackTypeCanary,
                    },
                ],
                originalTrack: {
                    language: 'en',
                    downloadUrl: ORIGINAL_URL,
                    trackType: trackTypeCanary,
                },
                targetTrack: {
                    language: 'zh-CN',
                    downloadUrl: null,
                    trackType: trackTypeCanary,
                },
            });
            fetchSpy.mockResolvedValueOnce(VALID_TTML);

            const noTargetDownloadResult =
                await netflixParser.processNetflixSubtitleData(
                    noTargetDownloadSnapshot
                );

            expect(noTargetDownloadSnapshot.data.tracks[0].trackType).toBe(
                trackTypeCanary
            );
            expect(noTargetDownloadResult.vttText).toContain(
                'Original survives'
            );
            expect(noTargetDownloadResult.targetVttText).toBe(
                noTargetDownloadResult.vttText
            );
            expect(noTargetDownloadResult.useNativeTarget).toBe(false);

            const loggerCalls = Object.values(parserLogger).flatMap(
                (method) => method.mock.calls
            );
            const expectedTrackTypeEvents = [
                'Extracting download URL from track',
                'Requested original language not found, using fallback',
                'Processing original track',
                'Processing target track (official)',
                'Official Netflix target track processing failed, falling back to API translation',
                'Target track found but no download URL available, falling back to API translation',
                'No download URL found for track',
            ];
            for (const event of expectedTrackTypeEvents) {
                expect(loggerCalls.some(([message]) => message === event)).toBe(
                    true
                );
            }
            const trackTypeCalls = loggerCalls.filter((call) => {
                const metadata = call.at(-1);
                return (
                    metadata !== null &&
                    typeof metadata === 'object' &&
                    Object.hasOwn(metadata, 'trackType')
                );
            });
            expect(trackTypeCalls.length).toBeGreaterThanOrEqual(
                expectedTrackTypeEvents.length
            );
            for (const call of trackTypeCalls) {
                expect(call.at(-1).trackType).toBe('other');
            }
            expect(JSON.stringify(loggerCalls)).not.toContain(trackTypeCanary);
            expect(fetchSpy).toHaveBeenCalledTimes(3);
        } finally {
            netflixParser.logger = originalLogger;
        }
    });

    test('keeps authorized URL-shaped language values functional but out of parser success logs', async () => {
        const sourceLanguageCanary =
            'https://x.test/s?token=PARSERSRCLANGSECRET';
        const targetLanguageCanary =
            'https://x.test/t?token=PARSERTGTLANGSECRET';
        const track = createNetflixTrack(sourceLanguageCanary, ORIGINAL_URL);
        const snapshot = createAuthorizedNetflixSubtitleSnapshot({
            tracks: [track],
            originalLanguage: sourceLanguageCanary,
            targetLanguage: targetLanguageCanary,
            useNativeSubtitles: false,
            useOfficialTranslations: false,
        });
        jest.spyOn(
            netflixParser,
            'fetchNetflixSubtitleContent'
        ).mockResolvedValue(VALID_TTML);
        const originalLogger = netflixParser.logger;
        const parserLogger = {
            debug: jest.fn(),
            error: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
        };
        netflixParser.logger = parserLogger;

        try {
            const result =
                await netflixParser.processNetflixSubtitleData(snapshot);

            expect(snapshot.originalLanguage).toBe(sourceLanguageCanary);
            expect(snapshot.targetLanguage).toBe(targetLanguageCanary);
            expect(result.sourceLanguage).toBe(
                normalizeLanguageCode(sourceLanguageCanary)
            );
            expect(result.targetLanguage).toBe(
                normalizeLanguageCode(targetLanguageCanary)
            );
            expect(result.availableLanguages[0].rawCode).toBe(
                sourceLanguageCanary
            );
            expect(parserLogger.info).toHaveBeenCalledWith(
                'Processing Netflix subtitle data',
                {
                    hasTargetLanguage: true,
                    hasOriginalLanguage: true,
                    useNativeSubtitles: false,
                    useOfficialTranslations: false,
                    hasData: true,
                    trackCount: 1,
                }
            );
            expect(parserLogger.debug).toHaveBeenCalledWith(
                'Processing original track',
                { hasLanguage: true, trackType: 'PRIMARY' }
            );
            expect(parserLogger.info).toHaveBeenCalledWith(
                'Netflix subtitle processing completed',
                {
                    originalVttLength: result.vttText.length,
                    targetVttLength: result.targetVttText.length,
                    hasSourceLanguage: true,
                    hasTargetLanguage: true,
                    useNativeTarget: false,
                    availableLanguageCount: 1,
                }
            );
            const serializedLoggerCalls = JSON.stringify(
                Object.values(parserLogger).flatMap(
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
            netflixParser.logger = originalLogger;
        }
    });

    test('keeps an asynchronous optional-target error private in fallback logs', async () => {
        const signedUrlCanary =
            'https://captions.nflxvideo.net/private/target.ttml?token=TARGET_LOG_SECRET';
        const targetError = new Error(`target failed: ${signedUrlCanary}`, {
            cause: { signedUrlCanary },
        });
        targetError.stack = `STACK ${signedUrlCanary}`;
        targetError.extraSecret = signedUrlCanary;
        const fetchSpy = jest
            .spyOn(netflixParser, 'fetchNetflixSubtitleContent')
            .mockResolvedValueOnce(VALID_TTML)
            .mockRejectedValueOnce(targetError);
        const originalLogger = netflixParser.logger;
        const parserLogger = {
            debug: jest.fn(),
            error: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
        };
        netflixParser.logger = parserLogger;

        try {
            const result = await processOfficialTarget();

            expect(result.vttText).toContain('Original survives');
            expect(result.targetVttText).toBe(result.vttText);
            expect(result.useNativeTarget).toBe(false);
            expect(parserLogger.warn).toHaveBeenCalledWith(
                'Official Netflix target track processing failed, falling back to API translation',
                {
                    stage: 'target-track',
                    source: 'netflix',
                    hasTargetLanguage: true,
                    trackType: 'PRIMARY',
                    errorCategory: 'processing',
                }
            );
            expect(
                Object.values(parserLogger).flatMap((method) =>
                    method.mock.calls.flat()
                )
            ).not.toContain(targetError);
            const serializedLoggerCalls = JSON.stringify(
                Object.values(parserLogger).flatMap(
                    (method) => method.mock.calls
                )
            );
            expect(serializedLoggerCalls).not.toContain('TARGET_LOG_SECRET');
            expect(serializedLoggerCalls).not.toContain('/private/target.ttml');
            expect(serializedLoggerCalls).not.toContain('token=');
            expect(fetchSpy).toHaveBeenCalledTimes(2);
        } finally {
            netflixParser.logger = originalLogger;
        }
    });

    test('does not lose the original when target-error or logger accessors are hostile', async () => {
        let errorDescriptorReads = 0;
        let errorValueReads = 0;
        const hostileError = new Proxy(Object.create(null), {
            getOwnPropertyDescriptor() {
                errorDescriptorReads += 1;
                throw new Error('HOSTILE_TARGET_DESCRIPTOR_CANARY');
            },
            get() {
                errorValueReads += 1;
                throw new Error('HOSTILE_TARGET_VALUE_CANARY');
            },
        });
        jest.spyOn(netflixParser, 'fetchNetflixSubtitleContent')
            .mockResolvedValueOnce(VALID_TTML)
            .mockRejectedValueOnce(hostileError);
        const originalLogger = netflixParser.logger;
        let warnAccessorReads = 0;
        const parserLogger = {
            debug: jest.fn(),
            error: jest.fn(),
            info: jest.fn(),
        };
        Object.defineProperty(parserLogger, 'warn', {
            configurable: true,
            get() {
                warnAccessorReads += 1;
                throw new Error('HOSTILE_WARN_ACCESSOR_CANARY');
            },
        });
        netflixParser.logger = parserLogger;

        try {
            const result = await processOfficialTarget();

            expect(result.vttText).toContain('Original survives');
            expect(result.targetVttText).toBe(result.vttText);
            expect(result.useNativeTarget).toBe(false);
            expect(errorDescriptorReads).toBe(1);
            expect(errorValueReads).toBe(0);
            expect(warnAccessorReads).toBe(1);
        } finally {
            netflixParser.logger = originalLogger;
        }
    });

    test('keeps a synchronous original-track failure private in processing logs', async () => {
        const signedUrlCanary =
            'https://captions.nflxvideo.net/private/original.ttml?token=PROCESS_LOG_SECRET';
        const sourceLanguageCanary =
            'https://x.test/s?token=NETFLIXFAILSRCSECRET';
        const targetLanguageCanary =
            'https://x.test/t?token=NETFLIXFAILTGTSECRET';
        const snapshot = createAuthorizedNetflixSubtitleSnapshot({
            tracks: createTracks(),
            originalLanguage: sourceLanguageCanary,
            targetLanguage: targetLanguageCanary,
            useNativeSubtitles: true,
            useOfficialTranslations: true,
        });
        const originalError = new Error(`original failed: ${signedUrlCanary}`, {
            cause: { signedUrlCanary },
        });
        originalError.stack = `STACK ${signedUrlCanary}`;
        originalError.extraSecret = signedUrlCanary;
        const fetchSpy = jest
            .spyOn(netflixParser, 'fetchNetflixSubtitleContent')
            .mockImplementation(() => {
                throw originalError;
            });
        const originalLogger = netflixParser.logger;
        const parserLogger = {
            debug: jest.fn(),
            error: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
        };
        netflixParser.logger = parserLogger;

        try {
            const error = await netflixParser
                .processNetflixSubtitleData(snapshot)
                .catch((caughtError) => caughtError);

            expect(error).toBe(originalError);
            expect(snapshot.originalLanguage).toBe(sourceLanguageCanary);
            expect(snapshot.targetLanguage).toBe(targetLanguageCanary);
            expect(parserLogger.error).toHaveBeenCalledWith(
                'Netflix subtitle processing failed',
                null,
                {
                    stage: 'process',
                    source: 'netflix',
                    hasTargetLanguage: true,
                    hasOriginalLanguage: true,
                    trackCount: 2,
                    errorCategory: 'subtitle',
                }
            );
            expect(
                Object.values(parserLogger).flatMap((method) =>
                    method.mock.calls.flat()
                )
            ).not.toContain(originalError);
            const serializedLoggerCalls = JSON.stringify(
                Object.values(parserLogger).flatMap(
                    (method) => method.mock.calls
                )
            );
            for (const sensitiveValue of [
                sourceLanguageCanary,
                targetLanguageCanary,
                normalizeLanguageCode(sourceLanguageCanary),
                normalizeLanguageCode(targetLanguageCanary),
                'PROCESS_LOG_SECRET',
                '/private/original.ttml',
                '/s?token=',
                '/t?token=',
                'token=',
            ]) {
                expect(serializedLoggerCalls).not.toContain(sensitiveValue);
            }
            expect(fetchSpy).toHaveBeenCalledTimes(1);
        } finally {
            netflixParser.logger = originalLogger;
        }
    });

    test('keeps an asynchronous track-fetch failure private in transport logs', async () => {
        const signedUrlCanary =
            'https://captions.nflxvideo.net/private/fetch.ttml?token=FETCH_LOG_SECRET';
        const transportError = new Error(`network failed: ${signedUrlCanary}`, {
            cause: { signedUrlCanary },
        });
        transportError.stack = `STACK ${signedUrlCanary}`;
        const track = createNetflixTrack('en', signedUrlCanary);
        const snapshot = createAuthorizedNetflixSubtitleSnapshot({
            tracks: [track],
            originalLanguage: 'en',
            targetLanguage: 'zh-CN',
        });
        global.fetch = jest.fn().mockRejectedValue(transportError);
        const originalLogger = netflixParser.logger;
        const parserLogger = {
            debug: jest.fn(),
            error: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
        };
        netflixParser.logger = parserLogger;

        try {
            const error = await netflixParser
                .fetchNetflixSubtitleContent(snapshot, {
                    language: 'en',
                    trackType: 'PRIMARY',
                    downloadUrl: signedUrlCanary,
                })
                .catch((caughtError) => caughtError);

            expect(error).toMatchObject({
                code: 'ERR_FETCH_FAILED',
            });
            expect(parserLogger.error).toHaveBeenCalledWith(
                'Failed to fetch Netflix subtitle content',
                null,
                {
                    stage: 'fetch',
                    source: 'netflix',
                    hasLanguage: true,
                    errorCategory: 'transport',
                }
            );
            expect(parserLogger.error.mock.calls.flat()).not.toContain(error);
            const serializedLoggerCalls = JSON.stringify(
                Object.values(parserLogger).flatMap(
                    (method) => method.mock.calls
                )
            );
            expect(serializedLoggerCalls).not.toContain('FETCH_LOG_SECRET');
            expect(serializedLoggerCalls).not.toContain('/private/fetch.ttml');
            expect(serializedLoggerCalls).not.toContain('token=');
            expect(global.fetch).toHaveBeenCalledTimes(1);
        } finally {
            netflixParser.logger = originalLogger;
        }
    });

    test('keeps unvalidated downloadable length values out of extraction logs', () => {
        const urlsLengthCanary = 'https://x.test/u?token=URLSLENGTHSECRET';
        const downloadUrlsLengthCanary =
            'https://x.test/d?token=DOWNLOADLENGTHSECRET';
        const urls = new Proxy([], {
            get(target, key, receiver) {
                return key === 'length'
                    ? urlsLengthCanary
                    : Reflect.get(target, key, receiver);
            },
        });
        const downloadUrls = new Proxy([], {
            get(target, key, receiver) {
                return key === 'length'
                    ? downloadUrlsLengthCanary
                    : Reflect.get(target, key, receiver);
            },
        });
        const track = {
            language: 'en',
            trackType: 'PRIMARY',
            ttDownloadables: {
                dfxp: {
                    urls,
                    downloadUrls,
                },
            },
        };
        const originalLogger = netflixParser.logger;
        const parserLogger = {
            debug: jest.fn(),
            error: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
        };
        netflixParser.logger = parserLogger;

        try {
            expect(netflixParser.extractDownloadUrl(track)).toBeNull();
            expect(parserLogger.debug).toHaveBeenCalledWith(
                'Checking format data',
                {
                    hasFormatData: true,
                    hasUrls: true,
                    hasDownloadUrls: true,
                    urlsLength: 0,
                    downloadUrlsLength: 0,
                }
            );
            const serializedLoggerCalls = JSON.stringify(
                Object.values(parserLogger).flatMap(
                    (method) => method.mock.calls
                )
            );
            for (const sensitiveValue of [
                urlsLengthCanary,
                downloadUrlsLengthCanary,
                '/u?token=',
                '/d?token=',
                'token=',
            ]) {
                expect(serializedLoggerCalls).not.toContain(sensitiveValue);
            }
        } finally {
            netflixParser.logger = originalLogger;
        }
    });

    test('keeps raw fallback track display, format, and download URL out of logs', async () => {
        const displayNameCanary =
            'https://captions.nflxvideo.net/private/display?token=TRACK_DISPLAY_SECRET';
        const formatCanary = 'dfxp_FORMAT_LOG_SECRET';
        const signedUrlCanary =
            'https://captions.nflxvideo.net/private/fallback.ttml?token=TRACK_URL_SECRET';
        const track = {
            language: 'en',
            displayName: displayNameCanary,
            trackType: 'PRIMARY',
            isNoneTrack: false,
            isForcedNarrative: false,
            ttDownloadables: {
                [formatCanary]: { urls: [{ url: signedUrlCanary }] },
            },
        };
        const snapshot = createAuthorizedNetflixSubtitleSnapshot({
            tracks: [track],
            originalLanguage: 'fr',
            targetLanguage: 'zh-CN',
            useNativeSubtitles: false,
            useOfficialTranslations: false,
        });
        const fetchSpy = jest
            .spyOn(netflixParser, 'fetchNetflixSubtitleContent')
            .mockResolvedValue(VALID_TTML);
        const originalLogger = netflixParser.logger;
        const parserLogger = {
            debug: jest.fn(),
            error: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
        };
        netflixParser.logger = parserLogger;

        try {
            const result =
                await netflixParser.processNetflixSubtitleData(snapshot);

            expect(result.url).toBe(signedUrlCanary);
            expect(parserLogger.info).toHaveBeenCalledWith(
                'Requested original language not found, using fallback',
                {
                    hasRequestedLanguage: true,
                    hasFallbackLanguage: true,
                    hasDisplayName: true,
                    trackType: 'PRIMARY',
                }
            );
            expect(parserLogger.debug).toHaveBeenCalledWith(
                'Using track.ttDownloadables',
                { formatCount: 1 }
            );
            expect(parserLogger.debug).toHaveBeenCalledWith(
                'Processing downloadable formats',
                { formatCount: 1 }
            );
            const serializedLoggerCalls = JSON.stringify(
                Object.values(parserLogger).flatMap(
                    (method) => method.mock.calls
                )
            );
            expect(serializedLoggerCalls).not.toContain('TRACK_DISPLAY_SECRET');
            expect(serializedLoggerCalls).not.toContain('FORMAT_LOG_SECRET');
            expect(serializedLoggerCalls).not.toContain('TRACK_URL_SECRET');
            expect(serializedLoggerCalls).not.toContain('/private/');
            expect(serializedLoggerCalls).not.toContain('token=');
            expect(fetchSpy).toHaveBeenCalledTimes(1);
        } finally {
            netflixParser.logger = originalLogger;
        }
    });

    test('keeps a valid original when the optional target fetch returns 404', async () => {
        const fetchOrder = [];
        global.fetch = jest.fn(async (url) => {
            fetchOrder.push(url);
            if (url === ORIGINAL_URL) {
                return createSubtitleFetchResponse(VALID_TTML, url);
            }
            return createSubtitleFetchResponse('not found', url, {
                ok: false,
                status: 404,
            });
        });

        const result = await processOfficialTarget();

        expectOriginalTranslationFallback(result, fetchOrder);
    });

    test('keeps a valid original when the optional target TTML is malformed', async () => {
        const fetchOrder = [];
        global.fetch = jest.fn(async (url) => {
            fetchOrder.push(url);
            return createSubtitleFetchResponse(
                url === ORIGINAL_URL ? VALID_TTML : MALFORMED_TTML,
                url
            );
        });

        const result = await processOfficialTarget();

        expectOriginalTranslationFallback(result, fetchOrder);
    });

    test('uses a successfully converted official target track', async () => {
        const fetchOrder = [];
        global.fetch = jest.fn(async (url) => {
            fetchOrder.push(url);
            return createSubtitleFetchResponse(
                url === ORIGINAL_URL ? VALID_TTML : VALID_TARGET_TTML,
                url
            );
        });

        const result = await processOfficialTarget();

        expect(fetchOrder).toEqual([ORIGINAL_URL, TARGET_URL]);
        expect(result.vttText).toContain('Original survives');
        expect(result.targetVttText).toContain('Official target');
        expect(result.targetVttText).not.toBe(result.vttText);
        expect(result.useNativeTarget).toBe(true);
    });

    test('keeps an original-track fetch failure fatal', async () => {
        global.fetch = jest.fn(async (url) =>
            createSubtitleFetchResponse('unavailable', url, {
                ok: false,
                status: 503,
            })
        );

        await expect(processOfficialTarget()).rejects.toMatchObject({
            message: 'Subtitle response rejected.',
            code: 'ERR_SUBTITLE_FETCH_HTTP',
        });
        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(global.fetch.mock.calls[0][0]).toBe(ORIGINAL_URL);
    });

    test('keeps an original-track parse failure fatal', async () => {
        global.fetch = jest.fn(async (url) =>
            createSubtitleFetchResponse(MALFORMED_TTML, url)
        );

        await expect(processOfficialTarget()).rejects.toThrow(
            'TTML conversion failed: No valid TTML subtitle entries found'
        );
        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(global.fetch.mock.calls[0][0]).toBe(ORIGINAL_URL);
    });
});
