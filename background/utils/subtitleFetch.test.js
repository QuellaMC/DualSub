import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { fetchAuthorizedSubtitleText } from './subtitleFetch.js';
import {
    createAuthorizedDisneySubtitleSnapshot,
    createAuthorizedNetflixSubtitleSnapshot,
    createSubtitleFetchResponse,
} from '../../test-utils/subtitle-fetch-fixtures.js';

const originalFetch = globalThis.fetch;
const DISNEY_URL = 'https://captions.media.dssott.com/show/master.m3u8';
const NETFLIX_URL = 'https://captions.nflxvideo.net/show/en.ttml';

afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
});

describe('fetchAuthorizedSubtitleText', () => {
    test('fetches bounded Disney text with the locked transport options', async () => {
        const snapshot = createAuthorizedDisneySubtitleSnapshot({
            subtitleUrl: DISNEY_URL,
        });
        globalThis.fetch = jest.fn(async (url) =>
            createSubtitleFetchResponse('WEBVTT', url)
        );

        await expect(
            fetchAuthorizedSubtitleText(snapshot, DISNEY_URL, {
                stage: 'disney-master',
                maxBytes: 64,
            })
        ).resolves.toEqual({ text: 'WEBVTT', canonicalUrl: DISNEY_URL });
        expect(globalThis.fetch).toHaveBeenCalledWith(
            DISNEY_URL,
            expect.objectContaining({
                method: 'GET',
                redirect: 'error',
                credentials: 'omit',
            })
        );
    });

    test('retries a blocked Disney redirect only on the known CDN counterpart', async () => {
        const snapshot = createAuthorizedDisneySubtitleSnapshot({
            subtitleUrl: DISNEY_URL,
        });
        const edgeUrl = DISNEY_URL.replace('media.dssott.com', 'dssedge.com');
        const segmentUrl = new URL('one.vtt', edgeUrl).href;
        globalThis.fetch = jest
            .fn()
            .mockRejectedValueOnce(new TypeError('redirect blocked'))
            .mockResolvedValueOnce(
                createSubtitleFetchResponse('#EXTM3U', edgeUrl)
            )
            .mockResolvedValueOnce(
                createSubtitleFetchResponse('WEBVTT', segmentUrl)
            );

        const playlist = await fetchAuthorizedSubtitleText(
            snapshot,
            DISNEY_URL,
            { stage: 'disney-master', maxBytes: 64 }
        );
        const segment = await fetchAuthorizedSubtitleText(snapshot, 'one.vtt', {
            baseUrl: playlist.canonicalUrl,
            stage: 'disney-segment',
            maxBytes: 64,
        });

        expect(playlist.canonicalUrl).toBe(edgeUrl);
        expect(segment).toEqual({ text: 'WEBVTT', canonicalUrl: segmentUrl });
        expect(globalThis.fetch.mock.calls.map(([url]) => url)).toEqual([
            DISNEY_URL,
            edgeUrl,
            segmentUrl,
        ]);
        expect(
            globalThis.fetch.mock.calls.every(
                ([, options]) => options.redirect === 'error'
            )
        ).toBe(true);
    });

    test('never requests anything beyond the two known Disney CDN candidates', async () => {
        const snapshot = createAuthorizedDisneySubtitleSnapshot({
            subtitleUrl: DISNEY_URL,
        });
        const edgeUrl = DISNEY_URL.replace('media.dssott.com', 'dssedge.com');
        globalThis.fetch = jest
            .fn()
            .mockRejectedValue(new TypeError('redirect blocked'));

        await expect(
            fetchAuthorizedSubtitleText(snapshot, DISNEY_URL, {
                stage: 'disney-master',
                maxBytes: 64,
            })
        ).rejects.toMatchObject({ code: 'ERR_FETCH_FAILED' });
        expect(globalThis.fetch.mock.calls.map(([url]) => url)).toEqual([
            DISNEY_URL,
            edgeUrl,
        ]);
        expect(
            globalThis.fetch.mock.calls.every(
                ([, options]) => options.redirect === 'error'
            )
        ).toBe(true);
    });

    test('keeps Netflix redirects disabled and requires the exact final URL', async () => {
        const snapshot = createAuthorizedNetflixSubtitleSnapshot({
            subtitleUrl: NETFLIX_URL,
        });
        globalThis.fetch = jest.fn(async (url) =>
            createSubtitleFetchResponse('TTML', url)
        );

        await expect(
            fetchAuthorizedSubtitleText(snapshot, NETFLIX_URL, {
                stage: 'netflix-track',
                maxBytes: 64,
            })
        ).resolves.toEqual({ text: 'TTML', canonicalUrl: NETFLIX_URL });
        expect(globalThis.fetch).toHaveBeenCalledWith(
            NETFLIX_URL,
            expect.objectContaining({ redirect: 'error' })
        );
    });

    test('blocks an unauthorized host before network access', async () => {
        const snapshot = createAuthorizedNetflixSubtitleSnapshot();
        globalThis.fetch = jest.fn();

        await expect(
            fetchAuthorizedSubtitleText(
                snapshot,
                'https://example.com/subtitle.ttml',
                { stage: 'netflix-track', maxBytes: 64 }
            )
        ).rejects.toMatchObject({ code: 'ERR_SUBTITLE_URL_NOT_ALLOWED' });
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    test('rejects non-success responses and cancels their bodies', async () => {
        const snapshot = createAuthorizedNetflixSubtitleSnapshot({
            subtitleUrl: NETFLIX_URL,
        });
        const response = createSubtitleFetchResponse('', NETFLIX_URL, {
            ok: false,
        });
        globalThis.fetch = jest.fn().mockResolvedValue(response);

        await expect(
            fetchAuthorizedSubtitleText(snapshot, NETFLIX_URL, {
                stage: 'netflix-track',
                maxBytes: 64,
            })
        ).rejects.toMatchObject({ code: 'ERR_SUBTITLE_FETCH_HTTP' });
        expect(response.body.cancel).toHaveBeenCalledTimes(1);
    });

    test('enforces the caller-provided response byte limit', async () => {
        const snapshot = createAuthorizedNetflixSubtitleSnapshot({
            subtitleUrl: NETFLIX_URL,
        });
        globalThis.fetch = jest.fn(async () =>
            createSubtitleFetchResponse('12345', NETFLIX_URL)
        );

        await expect(
            fetchAuthorizedSubtitleText(snapshot, NETFLIX_URL, {
                stage: 'netflix-track',
                maxBytes: 4,
            })
        ).rejects.toMatchObject({ code: 'ERR_RESPONSE_BODY_LIMIT' });
    });
});
