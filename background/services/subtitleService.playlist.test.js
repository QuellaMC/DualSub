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
    createSubtitleFetchResponse,
} from '../../test-utils/subtitle-fetch-fixtures.js';

const originalFetch = globalThis.fetch;
const MASTER_URL = 'https://captions.media.dssott.com/show/master.m3u8';

beforeAll(async () => {
    await subtitleService.initialize();
});

afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
});

describe('SubtitleService language playlists', () => {
    test('parses the already-fetched media playlist without requesting it twice', async () => {
        const mediaUri = 'tracks/en/index.m3u8';
        const mediaUrl = new URL(mediaUri, MASTER_URL).href;
        const segmentUrl = new URL('one.vtt', mediaUrl).href;
        const snapshot = createAuthorizedDisneySubtitleSnapshot({
            subtitleUrl: MASTER_URL,
        });
        globalThis.fetch = jest.fn(async (url) => {
            if (url === mediaUrl) {
                return createSubtitleFetchResponse(
                    '#EXTM3U\n#EXTINF:1,\none.vtt',
                    url
                );
            }
            return createSubtitleFetchResponse(
                'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nOne',
                url
            );
        });

        await expect(
            subtitleService.fetchLanguageSpecificSubtitles(
                snapshot,
                mediaUri,
                MASTER_URL
            )
        ).resolves.toContain('One');
        expect(globalThis.fetch.mock.calls.map(([url]) => url)).toEqual([
            mediaUrl,
            segmentUrl,
        ]);
    });

    test('returns direct VTT content after one request', async () => {
        const uri = 'tracks/en/subtitles.vtt';
        const url = new URL(uri, MASTER_URL).href;
        const vtt = 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nDirect';
        globalThis.fetch = jest.fn(async () =>
            createSubtitleFetchResponse(vtt, url)
        );

        await expect(
            subtitleService.fetchLanguageSpecificSubtitles(
                createAuthorizedDisneySubtitleSnapshot({
                    subtitleUrl: MASTER_URL,
                }),
                uri,
                MASTER_URL
            )
        ).resolves.toBe(vtt);
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    test('rejects content that is neither VTT nor an M3U8 playlist', async () => {
        const uri = 'tracks/en/subtitles.txt';
        const url = new URL(uri, MASTER_URL).href;
        globalThis.fetch = jest.fn(async () =>
            createSubtitleFetchResponse('not subtitles', url)
        );

        await expect(
            subtitleService.fetchLanguageSpecificSubtitles(
                createAuthorizedDisneySubtitleSnapshot({
                    subtitleUrl: MASTER_URL,
                }),
                uri,
                MASTER_URL
            )
        ).rejects.toThrow('not a recognized M3U8 or VTT');
    });
});
