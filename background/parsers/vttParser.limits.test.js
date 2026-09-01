import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { vttParser } from './vttParser.js';
import {
    createAuthorizedDisneySubtitleSnapshot,
    createAuthorizedNetflixSubtitleSnapshot,
    createSubtitleFetchResponse,
} from '../../test-utils/subtitle-fetch-fixtures.js';

const originalFetch = global.fetch;
const PLAYLIST_URL = 'https://captions.media.dssott.com/subtitles/index.m3u8';
const MAX_M3U8_PLAYLIST_BYTES = 2_097_152;
const MAX_M3U8_LINE_BYTES = 8_192;
const MAX_M3U8_SEGMENT_COUNT = 5_000;
const MAX_VTT_SEGMENT_BYTES = 524_288;
const MAX_VTT_AGGREGATE_BYTES = 16_777_216;
const MAX_VTT_SEGMENT_CONCURRENCY = 6;

afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
});

function playlist(segmentCount) {
    return [
        '#EXTM3U',
        ...Array.from(
            { length: segmentCount },
            (_, index) => `#EXTINF:2.0,\nsegment-${index}.vtt`
        ),
    ].join('\n');
}

function cue(index) {
    return `WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nCue ${index}`;
}

describe('VTTParser resource limits', () => {
    test('requires an authorized Disney request', async () => {
        global.fetch = jest.fn();

        await expect(
            vttParser.processM3U8PlaylistText(
                createAuthorizedNetflixSubtitleSnapshot(),
                '#EXTM3U\nsegment.vtt',
                PLAYLIST_URL
            )
        ).rejects.toMatchObject({
            name: 'VTTParserAuthorizationError',
            code: 'ERR_VTT_REQUEST_UNAUTHORIZED',
        });
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('caps playlist, logical line, and segment count before fetch', () => {
        expect(() =>
            vttParser.parsePlaylistForVttSegmentReferences(
                'x'.repeat(MAX_M3U8_PLAYLIST_BYTES + 1)
            )
        ).toThrow(
            expect.objectContaining({
                limitKind: 'playlistBytes',
                limit: MAX_M3U8_PLAYLIST_BYTES,
            })
        );

        const exactLine = `#${'x'.repeat(MAX_M3U8_LINE_BYTES - 1)}`;
        expect(
            vttParser.parsePlaylistForVttSegmentReferences(
                `#EXTM3U\r\n${exactLine}\r\nsegment.vtt\r\n`
            )
        ).toEqual(['segment.vtt']);
        expect(() =>
            vttParser.parsePlaylistForVttSegmentReferences(
                `#EXTM3U\n${exactLine}x`
            )
        ).toThrow(
            expect.objectContaining({
                limitKind: 'lineBytes',
                limit: MAX_M3U8_LINE_BYTES,
            })
        );

        expect(() =>
            vttParser.parsePlaylistForVttSegmentReferences(
                playlist(MAX_M3U8_SEGMENT_COUNT + 1)
            )
        ).toThrow(
            expect.objectContaining({
                limitKind: 'segmentCount',
                limit: MAX_M3U8_SEGMENT_COUNT,
            })
        );
    });

    test('bounds concurrency and emits successful segments in playlist order', async () => {
        const segmentCount = MAX_VTT_SEGMENT_CONCURRENCY * 2;
        let active = 0;
        let peak = 0;
        let releaseFirstWave;
        let confirmFirstWave;
        const firstWave = new Promise((resolve) => {
            confirmFirstWave = resolve;
        });
        const gate = new Promise((resolve) => {
            releaseFirstWave = resolve;
        });

        global.fetch = jest.fn(async (url) => {
            const index = Number(url.match(/segment-(\d+)\.vtt$/)[1]);
            active++;
            peak = Math.max(peak, active);
            if (active === MAX_VTT_SEGMENT_CONCURRENCY) confirmFirstWave();
            await gate;
            active--;
            return createSubtitleFetchResponse(cue(index), url);
        });

        const processing = vttParser.processM3U8PlaylistText(
            createAuthorizedDisneySubtitleSnapshot(),
            playlist(segmentCount),
            PLAYLIST_URL
        );
        await firstWave;
        expect(global.fetch).toHaveBeenCalledTimes(MAX_VTT_SEGMENT_CONCURRENCY);
        releaseFirstWave();

        const result = await processing;
        expect(peak).toBe(MAX_VTT_SEGMENT_CONCURRENCY);
        for (let index = 1; index < segmentCount; index++) {
            expect(result.indexOf(`Cue ${index - 1}`)).toBeLessThan(
                result.indexOf(`Cue ${index}`)
            );
        }
    });

    test('aborts active workers when the caller aborts', async () => {
        const controller = new AbortController();
        const signals = [];
        let confirmWorkersStarted;
        const workersStarted = new Promise((resolve) => {
            confirmWorkersStarted = resolve;
        });

        global.fetch = jest.fn((_url, { signal }) => {
            signals.push(signal);
            if (signals.length === MAX_VTT_SEGMENT_CONCURRENCY) {
                confirmWorkersStarted();
            }
            return new Promise((_resolve, reject) => {
                signal.addEventListener('abort', () => reject(signal.reason), {
                    once: true,
                });
            });
        });

        const processing = vttParser.processM3U8PlaylistText(
            createAuthorizedDisneySubtitleSnapshot(),
            playlist(MAX_VTT_SEGMENT_CONCURRENCY + 2),
            PLAYLIST_URL,
            { signal: controller.signal }
        );
        await workersStarted;
        controller.abort(new Error('caller detail'));

        await expect(processing).rejects.toMatchObject({
            name: 'AbortError',
            code: 'ERR_VTT_PROCESSING_ABORTED',
        });
        expect(global.fetch).toHaveBeenCalledTimes(MAX_VTT_SEGMENT_CONCURRENCY);
        expect(signals.every((signal) => signal.aborted)).toBe(true);
    });

    test('rejects a pre-aborted caller without starting a request', async () => {
        const controller = new AbortController();
        controller.abort();
        global.fetch = jest.fn();

        await expect(
            vttParser.fetchAndCombineVttSegments(
                createAuthorizedDisneySubtitleSnapshot(),
                ['segment.vtt'],
                PLAYLIST_URL,
                { signal: controller.signal }
            )
        ).rejects.toMatchObject({ code: 'ERR_VTT_PROCESSING_ABORTED' });
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('keeps ordinary segment failures soft when another segment succeeds', async () => {
        global.fetch = jest.fn(async (url) => {
            if (url.endsWith('/good.vtt')) {
                return createSubtitleFetchResponse(cue('good'), url);
            }
            return createSubtitleFetchResponse('', url, {
                ok: false,
                status: 503,
            });
        });

        await expect(
            vttParser.fetchAndCombineVttSegments(
                createAuthorizedDisneySubtitleSnapshot(),
                ['missing.vtt', 'good.vtt'],
                PLAYLIST_URL
            )
        ).resolves.toContain('Cue good');
    });

    test('fails when no segment can be fetched', async () => {
        global.fetch = jest.fn(async (url) =>
            createSubtitleFetchResponse('', url, {
                ok: false,
                status: 503,
            })
        );

        await expect(
            vttParser.fetchAndCombineVttSegments(
                createAuthorizedDisneySubtitleSnapshot(),
                ['one.vtt', 'two.vtt'],
                PLAYLIST_URL
            )
        ).rejects.toMatchObject({ code: 'ERR_VTT_SEGMENTS_UNAVAILABLE' });
    });

    test('treats an oversized segment as terminal and cancels its siblings', async () => {
        const signals = [];
        global.fetch = jest.fn((url, { signal }) => {
            signals.push(signal);
            if (url.endsWith('/segment-0.vtt')) {
                return Promise.resolve(
                    createSubtitleFetchResponse('ignored', url, {
                        headers: new Headers({
                            'Content-Length': String(MAX_VTT_SEGMENT_BYTES + 1),
                        }),
                    })
                );
            }
            return new Promise((_resolve, reject) => {
                signal.addEventListener('abort', () => reject(signal.reason), {
                    once: true,
                });
            });
        });

        await expect(
            vttParser.processM3U8PlaylistText(
                createAuthorizedDisneySubtitleSnapshot(),
                playlist(MAX_VTT_SEGMENT_CONCURRENCY + 3),
                PLAYLIST_URL
            )
        ).rejects.toMatchObject({
            name: 'ResponseBodyLimitError',
            limitBytes: MAX_VTT_SEGMENT_BYTES,
        });
        expect(global.fetch.mock.calls.length).toBeLessThanOrEqual(
            MAX_VTT_SEGMENT_CONCURRENCY
        );
        expect(signals.every((signal) => signal.aborted)).toBe(true);
    });

    test('caps aggregate segment bytes', async () => {
        const fullSegment = 'x'.repeat(MAX_VTT_SEGMENT_BYTES);
        const segmentCount =
            MAX_VTT_AGGREGATE_BYTES / MAX_VTT_SEGMENT_BYTES + 1;
        global.fetch = jest.fn((url) => {
            const index = Number(url.match(/segment-(\d+)\.vtt$/)[1]);
            return Promise.resolve(
                createSubtitleFetchResponse(
                    index === segmentCount - 1 ? 'x' : fullSegment,
                    url
                )
            );
        });

        await expect(
            vttParser.processM3U8PlaylistText(
                createAuthorizedDisneySubtitleSnapshot(),
                playlist(segmentCount),
                PLAYLIST_URL
            )
        ).rejects.toMatchObject({
            name: 'VTTResourceLimitError',
            limitKind: 'aggregateBytes',
            limit: MAX_VTT_AGGREGATE_BYTES,
        });
    });
});
