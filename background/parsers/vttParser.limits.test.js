import { afterEach, describe, expect, jest, test } from '@jest/globals';
import {
    MAX_M3U8_LINE_BYTES,
    MAX_M3U8_PLAYLIST_BYTES,
    MAX_M3U8_SEGMENT_COUNT,
    MAX_VTT_AGGREGATE_BYTES,
    MAX_VTT_SEGMENT_BYTES,
    MAX_VTT_SEGMENT_CONCURRENCY,
    VTTResourceLimitError,
    vttParser,
} from './vttParser.js';
import {
    createAuthorizedDisneySubtitleSnapshot,
    createAuthorizedNetflixSubtitleSnapshot,
    createSubtitleFetchResponse,
} from '../../test-utils/subtitle-fetch-fixtures.js';
import {
    DEFAULT_FETCH_TIMEOUT_MS,
    ResponseBodyLimitError,
} from '../../utils/fetchWithTimeout.js';

const originalFetch = global.fetch;
const PLAYLIST_CANONICAL_URL =
    'https://captions.media.dssott.com/subtitles/index.m3u8';

afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
});

function createMediaPlaylist(
    segmentCount,
    uriForIndex = (index) => `segment-${index}.vtt`
) {
    return [
        '#EXTM3U',
        ...Array.from({ length: segmentCount }, (_, index) => [
            '#EXTINF:2.0,',
            uriForIndex(index),
        ]).flat(),
    ].join('\n');
}

function padAsciiPlaylistToByteLength(playlist, targetBytes) {
    let paddedPlaylist = playlist.endsWith('\n') ? playlist : `${playlist}\n`;
    while (paddedPlaylist.length < targetBytes) {
        const remainingBytes = targetBytes - paddedPlaylist.length;
        if (remainingBytes === 1) {
            paddedPlaylist += '#';
            break;
        }

        const logicalLineBytes = Math.min(
            MAX_M3U8_LINE_BYTES,
            remainingBytes - 1
        );
        paddedPlaylist += `#${'x'.repeat(logicalLineBytes - 1)}\n`;
    }
    return paddedPlaylist;
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

describe('VTTParser playlist resource limits', () => {
    test('rejects a forged snapshot without consulting hostile fields', async () => {
        const sourceSecret = 'PRIVATE_FORGED_SNAPSHOT_SOURCE';
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

        const error = await vttParser
            .processM3U8PlaylistText(
                forgedSnapshot,
                '#EXTM3U\nsegment.vtt',
                PLAYLIST_CANONICAL_URL
            )
            .catch((caughtError) => caughtError);

        expect(sourceGetter).not.toHaveBeenCalled();
        expect(error).toMatchObject({
            name: 'VTTParserAuthorizationError',
            message: 'VTT playlist request is unauthorized.',
            code: 'ERR_VTT_REQUEST_UNAUTHORIZED',
        });
        expectErrorToExclude(error, sourceSecret);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('rejects a genuinely branded Netflix snapshot before parsing', async () => {
        global.fetch = jest.fn();

        await expect(
            vttParser.processM3U8PlaylistText(
                createAuthorizedNetflixSubtitleSnapshot(),
                '#EXTM3U\nsegment.vtt',
                PLAYLIST_CANONICAL_URL
            )
        ).rejects.toMatchObject({
            name: 'VTTParserAuthorizationError',
            message: 'VTT playlist request is unauthorized.',
            code: 'ERR_VTT_REQUEST_UNAUTHORIZED',
        });
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('turns hostile segment access into a fixed terminal input error', async () => {
        const inputSecret = 'PRIVATE_SEGMENT_ACCESS_FAILURE';
        const rawError = new Error(inputSecret);
        rawError.code = 'ERR_RESPONSE_BODY_LIMIT';
        const segmentReferences = new Proxy(['segment.vtt'], {
            get(target, property, receiver) {
                if (property === '0') throw rawError;
                return Reflect.get(target, property, receiver);
            },
        });
        global.fetch = jest.fn();

        const error = await vttParser
            .fetchAndCombineVttSegments(
                createAuthorizedDisneySubtitleSnapshot(),
                segmentReferences,
                PLAYLIST_CANONICAL_URL
            )
            .catch((caughtError) => caughtError);

        expect(error).not.toBe(rawError);
        expect(error).toMatchObject({
            name: 'VTTParserInputError',
            message: 'VTT playlist processing input is invalid.',
            code: 'ERR_VTT_INPUT_INVALID',
        });
        expectErrorToExclude(error, inputSecret);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('does not reflect a hostile value thrown by segment access', async () => {
        const sensitiveMarker = 'PRIVATE_VTT_INPUT_PROXY_TRAP';
        const trapError = new Error(`${sensitiveMarker}:message`);
        trapError.stack = `${sensitiveMarker}:stack`;
        trapError.cause = new Error(`${sensitiveMarker}:cause`);
        trapError.url = `https://captions.example/${sensitiveMarker}`;
        trapError.details = { marker: sensitiveMarker };
        const getPrototypeOf = jest.fn(() => {
            throw trapError;
        });
        const hostileThrownValue = new Proxy({}, { getPrototypeOf });
        const segmentReferences = new Proxy(['segment.vtt'], {
            get(target, property, receiver) {
                if (property === '0') throw hostileThrownValue;
                return Reflect.get(target, property, receiver);
            },
        });
        global.fetch = jest.fn();

        const publicError = await vttParser
            .fetchAndCombineVttSegments(
                createAuthorizedDisneySubtitleSnapshot(),
                segmentReferences,
                PLAYLIST_CANONICAL_URL
            )
            .catch((error) => error);

        expect(publicError).not.toBe(trapError);
        expect(publicError).not.toBe(hostileThrownValue);
        expect(publicError).toMatchObject({
            name: 'VTTParserInputError',
            message: 'VTT playlist processing input is invalid.',
            code: 'ERR_VTT_INPUT_INVALID',
        });
        expect(getPrototypeOf).not.toHaveBeenCalled();
        expectErrorToExclude(publicError, sensitiveMarker);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('does not trust a forged VTT resource error during input validation', async () => {
        const sensitiveMarker = 'PRIVATE_FORGED_VTT_INPUT_ERROR';
        const forgedError = new VTTResourceLimitError(sensitiveMarker, 1, 2);
        const segmentReferences = new Proxy(['segment.vtt'], {
            get(target, property, receiver) {
                if (property === '0') throw forgedError;
                return Reflect.get(target, property, receiver);
            },
        });
        global.fetch = jest.fn();

        const publicError = await vttParser
            .fetchAndCombineVttSegments(
                createAuthorizedDisneySubtitleSnapshot(),
                segmentReferences,
                PLAYLIST_CANONICAL_URL
            )
            .catch((error) => error);

        expect(publicError).not.toBe(forgedError);
        expect(publicError).toMatchObject({
            name: 'VTTParserInputError',
            message: 'VTT playlist processing input is invalid.',
            code: 'ERR_VTT_INPUT_INVALID',
        });
        expectErrorToExclude(publicError, sensitiveMarker);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('rejects an oversized playlist before requesting segments', async () => {
        global.fetch = jest.fn();
        const oversizedPlaylist = padAsciiPlaylistToByteLength(
            '#EXTM3U\nsegment.vtt',
            MAX_M3U8_PLAYLIST_BYTES + 1
        );

        expect(new Blob([oversizedPlaylist]).size).toBe(
            MAX_M3U8_PLAYLIST_BYTES + 1
        );

        await expect(
            vttParser.processM3U8PlaylistText(
                createAuthorizedDisneySubtitleSnapshot(),
                oversizedPlaylist,
                PLAYLIST_CANONICAL_URL
            )
        ).rejects.toMatchObject({
            name: 'VTTResourceLimitError',
            limitKind: 'playlistBytes',
            limit: MAX_M3U8_PLAYLIST_BYTES,
            observed: MAX_M3U8_PLAYLIST_BYTES + 1,
        });
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('accepts a playlist at the exact byte limit', async () => {
        const exactLimitPlaylist = padAsciiPlaylistToByteLength(
            '#EXTM3U\nsegment.vtt',
            MAX_M3U8_PLAYLIST_BYTES
        );
        global.fetch = jest.fn((url) =>
            Promise.resolve(
                createSubtitleFetchResponse(
                    'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nAt limit',
                    url
                )
            )
        );

        expect(new Blob([exactLimitPlaylist]).size).toBe(
            MAX_M3U8_PLAYLIST_BYTES
        );
        await expect(
            vttParser.processM3U8PlaylistText(
                createAuthorizedDisneySubtitleSnapshot(),
                exactLimitPlaylist,
                PLAYLIST_CANONICAL_URL
            )
        ).resolves.toContain('At limit');
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('rejects an oversized playlist line before requesting segments', async () => {
        global.fetch = jest.fn();
        const playlist = `#EXTM3U\n${'x'.repeat(MAX_M3U8_LINE_BYTES + 1)}`;

        await expect(
            vttParser.processM3U8PlaylistText(
                createAuthorizedDisneySubtitleSnapshot(),
                playlist,
                PLAYLIST_CANONICAL_URL
            )
        ).rejects.toMatchObject({
            name: 'VTTResourceLimitError',
            limitKind: 'lineBytes',
            limit: MAX_M3U8_LINE_BYTES,
        });
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('does not count a CRLF delimiter against the logical line limit', () => {
        const exactLengthComment = '#' + 'x'.repeat(MAX_M3U8_LINE_BYTES - 1);

        expect(
            vttParser.parsePlaylistForVttSegmentReferences(
                `#EXTM3U\r\n${exactLengthComment}\r\nsegment.vtt\r\n`
            )
        ).toEqual(['segment.vtt']);
    });

    test('still rejects 8193 logical line bytes before a CRLF delimiter', () => {
        const oversizedComment = '#' + 'x'.repeat(MAX_M3U8_LINE_BYTES);
        let thrownError;

        try {
            vttParser.parsePlaylistForVttSegmentReferences(
                `#EXTM3U\r\n${oversizedComment}\r\nsegment.vtt\r\n`
            );
        } catch (error) {
            thrownError = error;
        }

        expect(thrownError).toMatchObject({
            name: 'VTTResourceLimitError',
            limitKind: 'lineBytes',
            limit: MAX_M3U8_LINE_BYTES,
            observed: MAX_M3U8_LINE_BYTES + 1,
        });
    });

    test('rejects too many segment URIs before requesting any segment', async () => {
        global.fetch = jest.fn();

        await expect(
            vttParser.processM3U8PlaylistText(
                createAuthorizedDisneySubtitleSnapshot(),
                createMediaPlaylist(MAX_M3U8_SEGMENT_COUNT + 1),
                PLAYLIST_CANONICAL_URL
            )
        ).rejects.toMatchObject({
            name: 'VTTResourceLimitError',
            limitKind: 'segmentCount',
            limit: MAX_M3U8_SEGMENT_COUNT,
            observed: MAX_M3U8_SEGMENT_COUNT + 1,
        });
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('enforces the segment-count limit for direct combine calls', async () => {
        const atLimitUrls = Array.from(
            { length: MAX_M3U8_SEGMENT_COUNT },
            (_, index) => `segment-${index}.vtt`
        );
        global.fetch = jest.fn((url) =>
            Promise.resolve(
                createSubtitleFetchResponse(
                    'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nWithin limit',
                    url
                )
            )
        );

        await expect(
            vttParser.fetchAndCombineVttSegments(
                createAuthorizedDisneySubtitleSnapshot(),
                atLimitUrls,
                PLAYLIST_CANONICAL_URL
            )
        ).resolves.toContain('Within limit');
        expect(global.fetch).toHaveBeenCalledTimes(MAX_M3U8_SEGMENT_COUNT);

        global.fetch = jest.fn();
        await expect(
            vttParser.fetchAndCombineVttSegments(
                createAuthorizedDisneySubtitleSnapshot(),
                [...atLimitUrls, 'segment-over-limit.vtt'],
                PLAYLIST_CANONICAL_URL
            )
        ).rejects.toMatchObject({
            name: 'VTTResourceLimitError',
            limitKind: 'segmentCount',
            limit: MAX_M3U8_SEGMENT_COUNT,
            observed: MAX_M3U8_SEGMENT_COUNT + 1,
        });
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('bounds segment concurrency while preserving playlist order', async () => {
        const segmentCount = MAX_VTT_SEGMENT_CONCURRENCY * 2;
        const expectedPeak = Math.min(
            MAX_VTT_SEGMENT_CONCURRENCY,
            segmentCount
        );
        let activeRequests = 0;
        let maxActiveRequests = 0;
        let releaseFirstWave;
        const firstWaveGate = new Promise((resolve) => {
            releaseFirstWave = resolve;
        });

        global.fetch = jest.fn(async (url) => {
            const index = Number(url.match(/segment-(\d+)\.vtt$/)[1]);
            activeRequests++;
            maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
            await firstWaveGate;
            activeRequests--;
            return createSubtitleFetchResponse(
                `WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nCue ${index}`,
                url
            );
        });

        const processing = vttParser.processM3U8PlaylistText(
            createAuthorizedDisneySubtitleSnapshot(),
            createMediaPlaylist(segmentCount),
            PLAYLIST_CANONICAL_URL
        );
        await Promise.resolve();
        const heldFirstWave = {
            activeRequests,
            fetchCalls: global.fetch.mock.calls.length,
            maxActiveRequests,
        };
        releaseFirstWave();
        const result = await processing;

        expect(heldFirstWave).toEqual({
            activeRequests: expectedPeak,
            fetchCalls: expectedPeak,
            maxActiveRequests: expectedPeak,
        });
        expect(maxActiveRequests).toBe(expectedPeak);
        for (let index = 1; index < segmentCount; index++) {
            expect(result.indexOf(`Cue ${index - 1}`)).toBeLessThan(
                result.indexOf(`Cue ${index}`)
            );
        }
    });

    test('cancels workers on caller abort without reading or exposing its reason', async () => {
        const callerController = new AbortController();
        const callerSecret = 'PRIVATE_CALLER_ABORT_REASON';
        const nativeAbortSecret = 'PRIVATE_NATIVE_ABORT_FAILURE';
        const reasonGetter = jest.fn(() => {
            throw new Error('PRIVATE_REASON_GETTER_FAILURE');
        });
        Object.defineProperty(callerController.signal, 'reason', {
            configurable: true,
            get: reasonGetter,
        });
        const nativeSignals = [];
        let resolveWorkersStarted;
        const workersStarted = new Promise((resolve) => {
            resolveWorkersStarted = resolve;
        });
        global.fetch = jest.fn((_url, { signal }) => {
            nativeSignals.push(signal);
            if (nativeSignals.length === MAX_VTT_SEGMENT_CONCURRENCY) {
                resolveWorkersStarted();
            }
            return new Promise((_resolve, reject) => {
                signal.addEventListener(
                    'abort',
                    () => {
                        const error = new Error(nativeAbortSecret);
                        error.name = 'AbortError';
                        reject(error);
                    },
                    { once: true }
                );
            });
        });

        const processing = vttParser.processM3U8PlaylistText(
            createAuthorizedDisneySubtitleSnapshot(),
            createMediaPlaylist(MAX_VTT_SEGMENT_CONCURRENCY + 4),
            PLAYLIST_CANONICAL_URL,
            { signal: callerController.signal }
        );
        await workersStarted;
        callerController.abort(new Error(callerSecret));
        const error = await processing.catch((caughtError) => caughtError);

        expect(reasonGetter).not.toHaveBeenCalled();
        expect(error).toMatchObject({
            name: 'AbortError',
            message: 'VTT playlist processing was aborted.',
            code: 'ERR_VTT_PROCESSING_ABORTED',
        });
        expectErrorToExclude(
            error,
            callerSecret,
            nativeAbortSecret,
            'PRIVATE_REASON_GETTER_FAILURE'
        );
        expect(global.fetch).toHaveBeenCalledTimes(MAX_VTT_SEGMENT_CONCURRENCY);
        expect(nativeSignals.every((signal) => signal.aborted)).toBe(true);
        for (const signal of nativeSignals) {
            expectErrorToExclude(
                signal.reason,
                callerSecret,
                nativeAbortSecret,
                'PRIVATE_REASON_GETTER_FAILURE'
            );
        }
    });

    test('rejects a pre-aborted caller before starting a segment request', async () => {
        const callerController = new AbortController();
        const callerSecret = 'PRIVATE_PRE_ABORT_REASON';
        callerController.abort(new Error(callerSecret));
        const reasonGetter = jest.fn(() => {
            throw new Error('PRIVATE_PRE_ABORT_REASON_GETTER');
        });
        Object.defineProperty(callerController.signal, 'reason', {
            configurable: true,
            get: reasonGetter,
        });
        global.fetch = jest.fn();

        const error = await vttParser
            .fetchAndCombineVttSegments(
                createAuthorizedDisneySubtitleSnapshot(),
                ['segment.vtt'],
                PLAYLIST_CANONICAL_URL,
                { signal: callerController.signal }
            )
            .catch((caughtError) => caughtError);

        expect(reasonGetter).not.toHaveBeenCalled();
        expect(error).toMatchObject({
            name: 'AbortError',
            message: 'VTT playlist processing was aborted.',
            code: 'ERR_VTT_PROCESSING_ABORTED',
        });
        expectErrorToExclude(
            error,
            callerSecret,
            'PRIVATE_PRE_ABORT_REASON_GETTER'
        );
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('cancels every non-OK segment body within worker concurrency', async () => {
        const segmentCount = 20;
        const bodyCancellations = [];
        let outstandingBodies = 0;
        let maxOutstandingBodies = 0;
        global.fetch = jest.fn().mockImplementation((url) => {
            outstandingBodies++;
            maxOutstandingBodies = Math.max(
                maxOutstandingBodies,
                outstandingBodies
            );
            const response = createSubtitleFetchResponse('', url, {
                ok: false,
                status: 503,
            });
            const cancel = response.body.cancel.mockImplementation(async () => {
                outstandingBodies--;
            });
            bodyCancellations.push(cancel);
            return Promise.resolve(response);
        });

        await expect(
            vttParser.processM3U8PlaylistText(
                createAuthorizedDisneySubtitleSnapshot(),
                createMediaPlaylist(segmentCount),
                PLAYLIST_CANONICAL_URL
            )
        ).rejects.toMatchObject({
            message: 'No VTT segments could be fetched.',
            code: 'ERR_VTT_SEGMENTS_UNAVAILABLE',
        });
        expect(global.fetch).toHaveBeenCalledTimes(segmentCount);
        expect(bodyCancellations).toHaveLength(segmentCount);
        expect(
            bodyCancellations.every((cancel) => cancel.mock.calls.length === 1)
        ).toBe(true);
        expect(outstandingBodies).toBe(0);
        expect(maxOutstandingBodies).toBeLessThanOrEqual(
            MAX_VTT_SEGMENT_CONCURRENCY
        );
    });

    test('does not count exact empty response bodies as successful segments', async () => {
        const privateToken = 'PRIVATE_EMPTY_SEGMENT_TOKEN';
        const responses = [];
        global.fetch = jest.fn((url) => {
            const response = createSubtitleFetchResponse('', url);
            responses.push(response);
            return Promise.resolve(response);
        });

        const error = await vttParser
            .fetchAndCombineVttSegments(
                createAuthorizedDisneySubtitleSnapshot(),
                [`empty-one.vtt?token=${privateToken}`, 'empty-two.vtt'],
                PLAYLIST_CANONICAL_URL
            )
            .catch((caughtError) => caughtError);

        expect(error).toMatchObject({
            message: 'No VTT segments could be fetched.',
            code: 'ERR_VTT_SEGMENTS_UNAVAILABLE',
        });
        expectErrorToExclude(error, privateToken);
        expect(global.fetch).toHaveBeenCalledTimes(2);
        for (const response of responses) {
            expect(response.body.getReader).toHaveBeenCalledTimes(1);
            const reader = response.body.getReader.mock.results[0].value;
            expect(reader.read).toHaveBeenCalledTimes(2);
            expect(reader.cancel).not.toHaveBeenCalled();
            expect(reader.releaseLock).toHaveBeenCalledTimes(1);
            expect(response.body.cancel).not.toHaveBeenCalled();
        }
    });

    test('keeps a nonempty header-only VTT segment successful', async () => {
        const response = createSubtitleFetchResponse(
            'WEBVTT\n\n',
            'https://captions.media.dssott.com/subtitles/header-only.vtt'
        );
        global.fetch = jest.fn().mockResolvedValue(response);

        await expect(
            vttParser.fetchAndCombineVttSegments(
                createAuthorizedDisneySubtitleSnapshot(),
                ['header-only.vtt'],
                PLAYLIST_CANONICAL_URL
            )
        ).resolves.toBe('WEBVTT\n\n');
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('preserves the exact combined bytes for valid VTT segments', async () => {
        global.fetch = jest.fn((url) => {
            const cue = url.endsWith('/one.vtt')
                ? '00:00:00.000 --> 00:00:01.000\nOne'
                : '00:00:02.000 --> 00:00:03.000\nTwo';
            return Promise.resolve(
                createSubtitleFetchResponse(`WEBVTT\n\n${cue}\n`, url)
            );
        });

        await expect(
            vttParser.fetchAndCombineVttSegments(
                createAuthorizedDisneySubtitleSnapshot(),
                ['one.vtt', 'two.vtt'],
                PLAYLIST_CANONICAL_URL
            )
        ).resolves.toBe(
            'WEBVTT\n\n' +
                '00:00:00.000 --> 00:00:01.000\nOne\n\n' +
                '00:00:02.000 --> 00:00:03.000\nTwo\n\n'
        );
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    test('keeps soft failures private in fixed parser logger calls', async () => {
        const signedToken = 'PRIVATE_SIGNED_SEGMENT_TOKEN';
        const malformedReferenceMarker = 'PRIVATE_MALFORMED_REFERENCE';
        const rawTransportError = new Error(
            `PRIVATE_TRANSPORT_FAILURE:${signedToken}`
        );
        rawTransportError.code = 'ERR_RESPONSE_BODY_LIMIT';
        const rawReadError = new TypeError(
            `PRIVATE_BODY_READ_FAILURE:${signedToken}`
        );
        const rejectedBodies = [];
        const warn = jest
            .spyOn(vttParser.logger, 'warn')
            .mockImplementation(() => {});
        const info = jest
            .spyOn(vttParser.logger, 'info')
            .mockImplementation(() => {});
        const loggerError = jest
            .spyOn(vttParser.logger, 'error')
            .mockImplementation(() => {});
        global.fetch = jest.fn(async (url) => {
            const { pathname } = new URL(url);
            if (pathname.endsWith('/good.vtt')) {
                return createSubtitleFetchResponse(
                    'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nGood',
                    url
                );
            }
            if (pathname.endsWith('/redirect.vtt')) {
                const response = createSubtitleFetchResponse(
                    '',
                    'https://attacker.example/subtitles/redirect.vtt',
                    { redirected: true }
                );
                rejectedBodies.push(response.body.cancel);
                return response;
            }
            if (pathname.endsWith('/final-url.vtt')) {
                const response = createSubtitleFetchResponse(
                    '',
                    'https://captions.media.dssott.com/subtitles/other.vtt'
                );
                rejectedBodies.push(response.body.cancel);
                return response;
            }
            if (pathname.endsWith('/http.vtt')) {
                const response = createSubtitleFetchResponse('', url, {
                    ok: false,
                    status: 502,
                });
                rejectedBodies.push(response.body.cancel);
                return response;
            }
            if (pathname.endsWith('/transport.vtt')) {
                throw rawTransportError;
            }
            if (pathname.endsWith('/read.vtt')) {
                const reader = {
                    read: jest.fn().mockRejectedValue(rawReadError),
                    cancel: jest.fn(),
                    releaseLock: jest.fn(),
                };
                return createSubtitleFetchResponse('', url, {
                    body: {
                        getReader: jest.fn(() => reader),
                        cancel: jest.fn(),
                    },
                });
            }
            throw new Error('Unexpected URL in test fixture');
        });

        const segmentReferences = [
            'good.vtt',
            'redirect.vtt',
            'final-url.vtt',
            'http.vtt',
            `transport.vtt?token=${signedToken}`,
            `read.vtt?token=${signedToken}`,
            `https://attacker.example/blocked.vtt?token=${signedToken}`,
            `https://[${malformedReferenceMarker}`,
        ];
        const result = await vttParser.fetchAndCombineVttSegments(
            createAuthorizedDisneySubtitleSnapshot(),
            segmentReferences,
            PLAYLIST_CANONICAL_URL
        );

        expect(result).toContain('Good');
        expect(global.fetch).toHaveBeenCalledTimes(6);
        expect(rejectedBodies).toHaveLength(3);
        expect(
            rejectedBodies.every((cancel) => cancel.mock.calls.length === 1)
        ).toBe(true);
        expect(warn.mock.calls).toEqual(
            Array.from({ length: 7 }, () => ['VTT segment was unavailable'])
        );
        expect(info.mock.calls).toEqual([
            [
                'Fetching VTT segments from playlist',
                { segmentCount: segmentReferences.length },
            ],
            [
                'VTT segments combined successfully',
                {
                    segmentsFetched: 1,
                    totalSegments: segmentReferences.length,
                    combinedLength: result.length,
                },
            ],
        ]);
        expect(loggerError).not.toHaveBeenCalled();

        const allLoggerCalls = [
            ...warn.mock.calls,
            ...info.mock.calls,
            ...loggerError.mock.calls,
        ];
        const serializedLoggerCalls = JSON.stringify(
            allLoggerCalls,
            (_key, value) =>
                value instanceof Error
                    ? { name: value.name, message: value.message, ...value }
                    : value
        );
        for (const rawError of [rawTransportError, rawReadError]) {
            expect(allLoggerCalls.flat()).not.toContain(rawError);
            expect(serializedLoggerCalls).not.toContain(rawError.message);
        }
        for (const sensitiveValue of [
            signedToken,
            malformedReferenceMarker,
            ...segmentReferences,
            ...global.fetch.mock.calls.map(([url]) => url),
        ]) {
            expect(serializedLoggerCalls).not.toContain(sensitiveValue);
        }
    });

    test('keeps all-failure collaborators out of logs and the public error', async () => {
        const sensitiveMarker = 'PRIVATE_VTT_COLLABORATOR_FAILURE';
        const rawError = new Error(`${sensitiveMarker}:message`);
        rawError.stack = `${sensitiveMarker}:stack`;
        rawError.cause = new Error(`${sensitiveMarker}:cause`);
        rawError.url = `https://captions.example/${sensitiveMarker}`;
        rawError.details = { marker: sensitiveMarker };
        const warn = jest
            .spyOn(vttParser.logger, 'warn')
            .mockImplementation(() => {});
        const loggerError = jest
            .spyOn(vttParser.logger, 'error')
            .mockImplementation(() => {});
        global.fetch = jest.fn().mockRejectedValue(rawError);

        const publicError = await vttParser
            .fetchAndCombineVttSegments(
                createAuthorizedDisneySubtitleSnapshot(),
                ['private.vtt'],
                PLAYLIST_CANONICAL_URL
            )
            .catch((error) => error);

        expect(publicError).not.toBe(rawError);
        expect(publicError).toMatchObject({
            message: 'No VTT segments could be fetched.',
            code: 'ERR_VTT_SEGMENTS_UNAVAILABLE',
        });
        expect(Reflect.ownKeys(publicError).map(String).sort()).toEqual([
            'code',
            'message',
            'stack',
        ]);
        expect(warn.mock.calls).toEqual([['VTT segment was unavailable']]);
        expect(loggerError.mock.calls).toEqual([
            [
                'No VTT segments could be fetched',
                {
                    segmentCount: 1,
                    stage: 'segment-fetch',
                },
            ],
        ]);

        const loggerCalls = [...warn.mock.calls, ...loggerError.mock.calls];
        expect(loggerCalls.flat(Infinity)).not.toContain(rawError);
        expect(
            loggerCalls.flat(Infinity).some((value) => value instanceof Error)
        ).toBe(false);
        const rendered = JSON.stringify(
            { loggerCalls, publicError },
            (_key, value) =>
                value instanceof Error
                    ? {
                          name: value.name,
                          message: value.message,
                          stack: value.stack,
                          cause: value.cause,
                          url: value.url,
                          details: value.details,
                          code: value.code,
                      }
                    : value
        );
        expect(rendered).not.toContain(sensitiveMarker);
    });

    test('does not reflect a hostile segment-processing failure', async () => {
        const sensitiveMarker = 'PRIVATE_VTT_PROXY_TRAP_FAILURE';
        const trapError = new Error(`${sensitiveMarker}:message`);
        trapError.stack = `${sensitiveMarker}:stack`;
        trapError.cause = new Error(`${sensitiveMarker}:cause`);
        trapError.url = `https://captions.example/${sensitiveMarker}`;
        trapError.details = { marker: sensitiveMarker };
        const getPrototypeOf = jest.fn(() => {
            throw trapError;
        });
        const hostileThrownValue = new Proxy({}, { getPrototypeOf });
        const warn = jest
            .spyOn(vttParser.logger, 'warn')
            .mockImplementation(() => {});
        const info = jest
            .spyOn(vttParser.logger, 'info')
            .mockImplementation(() => {});
        const loggerError = jest
            .spyOn(vttParser.logger, 'error')
            .mockImplementation(() => {});
        const response = createSubtitleFetchResponse(
            'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nPrivate',
            'https://captions.media.dssott.com/subtitles/private.vtt'
        );
        global.fetch = jest.fn().mockResolvedValue(response);
        const OriginalBlob = global.Blob;
        let publicError;
        try {
            global.Blob = class HostileBlob {
                constructor() {
                    throw hostileThrownValue;
                }
            };
            publicError = await vttParser
                .fetchAndCombineVttSegments(
                    createAuthorizedDisneySubtitleSnapshot(),
                    ['private.vtt'],
                    PLAYLIST_CANONICAL_URL
                )
                .catch((error) => error);
        } finally {
            global.Blob = OriginalBlob;
        }

        expect(publicError).not.toBe(trapError);
        expect(publicError).not.toBe(hostileThrownValue);
        expect(publicError).toMatchObject({
            message: 'No VTT segments could be fetched.',
            code: 'ERR_VTT_SEGMENTS_UNAVAILABLE',
        });
        expect(getPrototypeOf).not.toHaveBeenCalled();
        expect(warn.mock.calls).toEqual([['VTT segment was unavailable']]);
        expect(loggerError.mock.calls).toEqual([
            [
                'No VTT segments could be fetched',
                {
                    segmentCount: 1,
                    stage: 'segment-fetch',
                },
            ],
        ]);

        const loggerCalls = [
            ...warn.mock.calls,
            ...info.mock.calls,
            ...loggerError.mock.calls,
        ];
        expect(loggerCalls.flat(Infinity)).not.toContain(trapError);
        expect(loggerCalls.flat(Infinity)).not.toContain(hostileThrownValue);
        const rendered = JSON.stringify(
            { loggerCalls, publicError },
            (_key, value) =>
                value instanceof Error
                    ? {
                          name: value.name,
                          message: value.message,
                          stack: value.stack,
                          cause: value.cause,
                          url: value.url,
                          details: value.details,
                          code: value.code,
                      }
                    : value
        );
        expect(rendered).not.toContain(sensitiveMarker);
    });

    test.each([
        [
            'VTT resource limit',
            (marker) => new VTTResourceLimitError(marker, 1, 2),
        ],
        [
            'response body limit',
            (marker) => new ResponseBodyLimitError(marker, 2),
        ],
    ])('does not trust a forged %s instance', async (_name, createError) => {
        const sensitiveMarker = 'PRIVATE_FORGED_VTT_TERMINAL_ERROR';
        const forgedError = createError(sensitiveMarker);
        const response = createSubtitleFetchResponse(
            'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nPrivate',
            'https://captions.media.dssott.com/subtitles/private.vtt'
        );
        global.fetch = jest.fn().mockResolvedValue(response);
        const OriginalBlob = global.Blob;
        let publicError;
        try {
            global.Blob = class ForgedErrorBlob {
                constructor() {
                    throw forgedError;
                }
            };
            publicError = await vttParser
                .fetchAndCombineVttSegments(
                    createAuthorizedDisneySubtitleSnapshot(),
                    ['private.vtt'],
                    PLAYLIST_CANONICAL_URL
                )
                .catch((error) => error);
        } finally {
            global.Blob = OriginalBlob;
        }

        expect(publicError).not.toBe(forgedError);
        expect(publicError).toMatchObject({
            message: 'No VTT segments could be fetched.',
            code: 'ERR_VTT_SEGMENTS_UNAVAILABLE',
        });
        expectErrorToExclude(publicError, sensitiveMarker);
    });

    test('keeps a segment timeout soft when another segment succeeds', async () => {
        jest.useFakeTimers();
        global.fetch = jest.fn((url) => {
            if (url.endsWith('/slow.vtt')) return new Promise(() => {});
            return Promise.resolve(
                createSubtitleFetchResponse(
                    'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nFast',
                    url
                )
            );
        });

        try {
            const processing = vttParser.fetchAndCombineVttSegments(
                createAuthorizedDisneySubtitleSnapshot(),
                ['slow.vtt', 'fast.vtt'],
                PLAYLIST_CANONICAL_URL
            );
            await jest.advanceTimersByTimeAsync(DEFAULT_FETCH_TIMEOUT_MS);

            await expect(processing).resolves.toContain('Fast');
            expect(global.fetch).toHaveBeenCalledTimes(2);
        } finally {
            jest.useRealTimers();
        }
    });

    test('treats an oversized segment as terminal and does not start queued requests', async () => {
        const segmentCount = MAX_VTT_SEGMENT_CONCURRENCY + 4;
        let abortedRequests = 0;
        const nativeRequests = [];
        global.fetch = jest.fn((url, { signal }) => {
            const index = Number(url.match(/segment-(\d+)\.vtt$/)[1]);
            nativeRequests.push({ index, signal });
            if (index === 0) {
                return Promise.resolve(
                    createSubtitleFetchResponse('ignored', url, {
                        headers: new Headers({
                            'Content-Length': String(MAX_VTT_SEGMENT_BYTES + 1),
                        }),
                    })
                );
            }

            return new Promise((resolve, reject) => {
                const timeoutId = setTimeout(
                    () =>
                        resolve(
                            createSubtitleFetchResponse(
                                'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nOK',
                                url
                            )
                        ),
                    25
                );
                signal.addEventListener(
                    'abort',
                    () => {
                        clearTimeout(timeoutId);
                        abortedRequests++;
                        const error = new Error('aborted');
                        error.name = 'AbortError';
                        reject(error);
                    },
                    { once: true }
                );
            });
        });

        const terminalError = await vttParser
            .processM3U8PlaylistText(
                createAuthorizedDisneySubtitleSnapshot(),
                createMediaPlaylist(segmentCount),
                PLAYLIST_CANONICAL_URL
            )
            .catch((caughtError) => caughtError);

        expect(terminalError).toMatchObject({
            name: 'ResponseBodyLimitError',
            limitBytes: MAX_VTT_SEGMENT_BYTES,
        });
        expect(global.fetch.mock.calls.length).toBeLessThanOrEqual(
            MAX_VTT_SEGMENT_CONCURRENCY
        );
        expect(abortedRequests).toBeGreaterThan(0);
        expect(nativeRequests.every(({ signal }) => signal.aborted)).toBe(true);
        // The offending response's wrapper owns and may expose its safe limit
        // error. Siblings must only receive the parser's reasonless abort,
        // which the wrapper translates to its fixed caller-abort error.
        for (const { index, signal } of nativeRequests) {
            if (index === 0) continue;
            expect(signal.reason).not.toBe(terminalError);
            expect(signal.reason).not.toMatchObject({
                name: 'ResponseBodyLimitError',
                limitBytes: MAX_VTT_SEGMENT_BYTES,
            });
        }
    });

    test('accepts segment aggregate bytes at the exact limit', async () => {
        const segmentBody =
            'WEBVTT\n\n' +
            'x'.repeat(MAX_VTT_SEGMENT_BYTES - 'WEBVTT\n\n'.length);
        const segmentCount = MAX_VTT_AGGREGATE_BYTES / MAX_VTT_SEGMENT_BYTES;
        global.fetch = jest.fn((url) =>
            Promise.resolve(createSubtitleFetchResponse(segmentBody, url))
        );

        await expect(
            vttParser.processM3U8PlaylistText(
                createAuthorizedDisneySubtitleSnapshot(),
                createMediaPlaylist(segmentCount),
                PLAYLIST_CANONICAL_URL
            )
        ).resolves.toContain('x');
        expect(global.fetch).toHaveBeenCalledTimes(segmentCount);
    });

    test('rejects segment bodies whose aggregate bytes exceed the limit', async () => {
        const fullSegmentBody =
            'WEBVTT\n\n' +
            'x'.repeat(MAX_VTT_SEGMENT_BYTES - 'WEBVTT\n\n'.length);
        const segmentCount =
            MAX_VTT_AGGREGATE_BYTES / MAX_VTT_SEGMENT_BYTES + 1;
        global.fetch = jest.fn((url) => {
            const index = Number(url.match(/segment-(\d+)\.vtt$/)[1]);
            const segmentBody =
                index === segmentCount - 1 ? 'x' : fullSegmentBody;
            return Promise.resolve(
                createSubtitleFetchResponse(segmentBody, url)
            );
        });

        await expect(
            vttParser.processM3U8PlaylistText(
                createAuthorizedDisneySubtitleSnapshot(),
                createMediaPlaylist(segmentCount),
                PLAYLIST_CANONICAL_URL
            )
        ).rejects.toMatchObject({
            name: 'VTTResourceLimitError',
            limitKind: 'aggregateBytes',
            limit: MAX_VTT_AGGREGATE_BYTES,
            observed: MAX_VTT_AGGREGATE_BYTES + 1,
        });
    });
});
