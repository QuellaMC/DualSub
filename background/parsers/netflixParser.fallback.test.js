import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { netflixParser } from './netflixParser.js';
import {
    createAuthorizedNetflixSubtitleSnapshot,
    createSubtitleFetchResponse,
} from '../../test-utils/subtitle-fetch-fixtures.js';

const originalFetch = globalThis.fetch;
const ORIGINAL_URL = 'https://captions.nflxvideo.net/show/original.ttml';
const TARGET_URL = 'https://captions.nflxvideo.net/show/target.ttml';
const ORIGINAL_TTML =
    '<tt><body><div><p begin="0s" end="1s">Original survives</p></div></body></tt>';
const TARGET_TTML =
    '<tt><body><div><p begin="0s" end="1s">Official target</p></div></body></tt>';

function createTrack(language, url) {
    return {
        language,
        displayName: language,
        trackType: 'PRIMARY',
        isNoneTrack: false,
        isForcedNarrative: false,
        ttDownloadables: { dfxp: { urls: [{ url }] } },
    };
}

function createSnapshot(overrides = {}) {
    return createAuthorizedNetflixSubtitleSnapshot({
        tracks: [
            createTrack('en', ORIGINAL_URL),
            createTrack('zh-CN', TARGET_URL),
        ],
        originalLanguage: 'en',
        targetLanguage: 'zh-CN',
        useNativeSubtitles: true,
        useOfficialTranslations: true,
        ...overrides,
    });
}

afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
});

describe('NetflixParser target fallback', () => {
    test('uses a successfully converted official target track', async () => {
        const bodies = new Map([
            [ORIGINAL_URL, ORIGINAL_TTML],
            [TARGET_URL, TARGET_TTML],
        ]);
        globalThis.fetch = jest.fn(async (url) =>
            createSubtitleFetchResponse(bodies.get(url), url)
        );

        const result =
            await netflixParser.processNetflixSubtitleData(createSnapshot());

        expect(result.vttText).toContain('Original survives');
        expect(result.targetVttText).toContain('Official target');
        expect(result.useNativeTarget).toBe(true);
    });

    test.each([
        ['HTTP failure', { ok: false }],
        ['malformed TTML', {}, '<tt><body /></tt>'],
    ])(
        'keeps the original when the optional target has an %s',
        async (_, responseOverrides, targetBody = 'unavailable') => {
            globalThis.fetch = jest.fn(async (url) =>
                url === ORIGINAL_URL
                    ? createSubtitleFetchResponse(ORIGINAL_TTML, url)
                    : createSubtitleFetchResponse(
                          targetBody,
                          url,
                          responseOverrides
                      )
            );

            const result =
                await netflixParser.processNetflixSubtitleData(
                    createSnapshot()
                );

            expect(result.vttText).toContain('Original survives');
            expect(result.targetVttText).toBe(result.vttText);
            expect(result.useNativeTarget).toBe(false);
        }
    );

    test('preserves caller cancellation during optional target retrieval', async () => {
        const abortError = Object.assign(new Error('cancelled'), {
            code: 'ERR_FETCH_ABORTED',
        });
        jest.spyOn(netflixParser, 'fetchNetflixSubtitleContent')
            .mockResolvedValueOnce(ORIGINAL_TTML)
            .mockRejectedValueOnce(abortError);

        await expect(
            netflixParser.processNetflixSubtitleData(createSnapshot())
        ).rejects.toBe(abortError);
    });

    test('falls back to English when the requested original is unavailable', async () => {
        globalThis.fetch = jest.fn(async (url) =>
            createSubtitleFetchResponse(ORIGINAL_TTML, url)
        );

        const result = await netflixParser.processNetflixSubtitleData(
            createSnapshot({
                tracks: [createTrack('en-US', ORIGINAL_URL)],
                originalLanguage: 'fr',
                useNativeSubtitles: false,
                useOfficialTranslations: false,
            })
        );

        expect(result.vttText).toContain('Original survives');
        expect(result.sourceLanguage).toBe('en');
        expect(result.useNativeTarget).toBe(false);
    });

    test.each([
        ['transport', 'unavailable', { ok: false }],
        ['parse', '<tt><body /></tt>', {}],
    ])(
        'keeps an original-track %s failure fatal',
        async (_, body, overrides) => {
            globalThis.fetch = jest.fn(async (url) =>
                createSubtitleFetchResponse(body, url, overrides)
            );

            await expect(
                netflixParser.processNetflixSubtitleData(
                    createSnapshot({
                        tracks: [createTrack('en', ORIGINAL_URL)],
                        useOfficialTranslations: false,
                    })
                )
            ).rejects.toBeDefined();
            expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        }
    );

    test('supports Netflix alternate downloadable shapes at the extraction seam', () => {
        expect(
            netflixParser.extractDownloadUrl({
                rawTrack: {
                    ttDownloadables: {
                        dfxp: { downloadUrls: [{ url: ORIGINAL_URL }] },
                    },
                },
            })
        ).toBe(ORIGINAL_URL);
    });
});
