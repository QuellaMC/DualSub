import {
    afterEach,
    beforeAll,
    describe,
    expect,
    jest,
    test,
} from '@jest/globals';
import { MAX_M3U8_PLAYLIST_BYTES } from '../parsers/vttParser.js';
import { subtitleService } from './subtitleService.js';
import {
    createAuthorizedDisneySubtitleSnapshot,
    createSubtitleFetchResponse,
} from '../../test-utils/subtitle-fetch-fixtures.js';

const originalFetch = global.fetch;

beforeAll(async () => {
    await subtitleService.initialize();
});

afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
});

describe('SubtitleService language playlist fetching', () => {
    test('parses already-fetched M3U8 text without requesting the media playlist twice', async () => {
        const masterUrl = 'https://captions.media.dssott.com/show/master.m3u8';
        const mediaUri = 'tracks/en/index.m3u8?signature=short-lived';
        const mediaUrl = new URL(mediaUri, masterUrl).href;
        const segmentUrl = new URL('segment-1.vtt', mediaUrl).href;
        const mediaRequests = [];
        const snapshot = createAuthorizedDisneySubtitleSnapshot({
            subtitleUrl: masterUrl,
        });

        global.fetch = jest.fn(async (url) => {
            if (url === mediaUrl) {
                mediaRequests.push(url);
                if (mediaRequests.length > 1) {
                    throw new Error('media playlist was fetched twice');
                }
                return createSubtitleFetchResponse(
                    '#EXTM3U\n#EXTINF:2.0,\nsegment-1.vtt',
                    url
                );
            }
            if (url === segmentUrl) {
                return createSubtitleFetchResponse(
                    'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nOne',
                    url
                );
            }
            throw new Error('Unexpected subtitle URL');
        });

        await expect(
            subtitleService.fetchLanguageSpecificSubtitles(
                snapshot,
                mediaUri,
                masterUrl
            )
        ).resolves.toContain('One');
        expect(mediaRequests).toHaveLength(1);
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    test('returns direct VTT content after exactly one request', async () => {
        const masterUrl = 'https://captions.media.dssott.com/show/master.m3u8';
        const directUri = 'tracks/en/subtitles.vtt';
        const directUrl = new URL(directUri, masterUrl).href;
        const directVtt = 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nDirect';
        const snapshot = createAuthorizedDisneySubtitleSnapshot({
            subtitleUrl: masterUrl,
        });
        global.fetch = jest
            .fn()
            .mockResolvedValue(
                createSubtitleFetchResponse(directVtt, directUrl)
            );

        await expect(
            subtitleService.fetchLanguageSpecificSubtitles(
                snapshot,
                directUri,
                masterUrl
            )
        ).resolves.toBe(directVtt);
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('cancels a non-OK classification body while preserving the fixed HTTP rejection', async () => {
        const cancel = jest
            .fn()
            .mockRejectedValue(new Error('body cancellation failed'));
        const masterUrl = 'https://captions.media.dssott.com/show/master.m3u8';
        const directUri = 'tracks/en/subtitles.vtt';
        const directUrl = new URL(directUri, masterUrl).href;
        const snapshot = createAuthorizedDisneySubtitleSnapshot({
            subtitleUrl: masterUrl,
        });
        const response = createSubtitleFetchResponse('', directUrl, {
            ok: false,
            body: { cancel },
        });
        global.fetch = jest.fn().mockResolvedValue(response);

        await expect(
            subtitleService.fetchLanguageSpecificSubtitles(
                snapshot,
                directUri,
                masterUrl
            )
        ).rejects.toMatchObject({
            name: 'SubtitleFetchError',
            message: 'Subtitle response rejected.',
            code: 'ERR_SUBTITLE_FETCH_HTTP',
        });
        expect(cancel).toHaveBeenCalledTimes(1);
    });

    test('accepts direct VTT content exactly at the 2 MiB classification cap', async () => {
        const masterUrl = 'https://captions.media.dssott.com/show/master.m3u8';
        const directUri = 'tracks/en/subtitles.vtt';
        const directUrl = new URL(directUri, masterUrl).href;
        const vttHeader = 'WEBVTT\n\n';
        const directVtt =
            vttHeader + 'x'.repeat(MAX_M3U8_PLAYLIST_BYTES - vttHeader.length);
        const snapshot = createAuthorizedDisneySubtitleSnapshot({
            subtitleUrl: masterUrl,
        });
        global.fetch = jest
            .fn()
            .mockResolvedValue(
                createSubtitleFetchResponse(directVtt, directUrl)
            );

        await expect(
            subtitleService.fetchLanguageSpecificSubtitles(
                snapshot,
                directUri,
                masterUrl
            )
        ).resolves.toBe(directVtt);
        expect(directVtt).toHaveLength(MAX_M3U8_PLAYLIST_BYTES);
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('rejects and stops a direct VTT body one byte above the 2 MiB classification cap', async () => {
        const masterUrl = 'https://captions.media.dssott.com/show/master.m3u8';
        const directUri = 'tracks/en/subtitles.vtt';
        const directUrl = new URL(directUri, masterUrl).href;
        const snapshot = createAuthorizedDisneySubtitleSnapshot({
            subtitleUrl: masterUrl,
        });
        const firstChunk = new Uint8Array(MAX_M3U8_PLAYLIST_BYTES);
        firstChunk.set([87, 69, 66, 86, 84, 84, 10, 10]);
        const reader = {
            read: jest
                .fn()
                .mockResolvedValueOnce({ done: false, value: firstChunk })
                .mockResolvedValueOnce({
                    done: false,
                    value: new Uint8Array([120]),
                })
                .mockResolvedValue({ done: true }),
            cancel: jest.fn().mockResolvedValue(undefined),
            releaseLock: jest.fn(),
        };
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            url: directUrl,
            redirected: false,
            headers: new Headers(),
            body: { getReader: () => reader },
        });

        await expect(
            subtitleService.fetchLanguageSpecificSubtitles(
                snapshot,
                directUri,
                masterUrl
            )
        ).rejects.toMatchObject({
            name: 'ResponseBodyLimitError',
            limitBytes: MAX_M3U8_PLAYLIST_BYTES,
            observedBytes: MAX_M3U8_PLAYLIST_BYTES + 1,
        });
        expect(reader.read).toHaveBeenCalledTimes(2);
        expect(reader.cancel).toHaveBeenCalledTimes(1);
        expect(reader.releaseLock).toHaveBeenCalledTimes(1);
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });
});
