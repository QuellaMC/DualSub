import {
    afterEach,
    beforeAll,
    describe,
    expect,
    jest,
    test,
} from '@jest/globals';
import { netflixParser } from '../parsers/netflixParser.js';
import { subtitleService } from './subtitleService.js';
import {
    createAuthorizedDisneySubtitleSnapshot,
    createAuthorizedNetflixSubtitleSnapshot,
    createSubtitleFetchResponse,
} from '../../test-utils/subtitle-fetch-fixtures.js';

const originalFetch = globalThis.fetch;
const ORIGINAL_URL = 'https://captions.nflxvideo.net/show/en.ttml';
const TARGET_URL = 'https://captions.nflxvideo.net/show/zh-CN.ttml';
const ORIGINAL_TTML =
    '<tt><body><div><p begin="0s" end="1s">Original</p></div></body></tt>';
const TARGET_TTML =
    '<tt><body><div><p begin="0s" end="1s">Target</p></div></body></tt>';

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

function createOfficialTargetSnapshot() {
    return createAuthorizedNetflixSubtitleSnapshot({
        tracks: [
            createTrack('en', ORIGINAL_URL),
            createTrack('zh-CN', TARGET_URL),
        ],
        originalLanguage: 'en',
        targetLanguage: 'zh-CN',
        useNativeSubtitles: true,
        useOfficialTranslations: true,
    });
}

beforeAll(async () => {
    await subtitleService.initialize();
});

afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
});

describe('SubtitleService Netflix', () => {
    test('rejects a snapshot authorized for another platform', async () => {
        globalThis.fetch = jest.fn();

        await expect(
            subtitleService.processNetflixSubtitles(
                createAuthorizedDisneySubtitleSnapshot()
            )
        ).rejects.toMatchObject({
            code: 'ERR_NETFLIX_SUBTITLE_REQUEST_UNAUTHORIZED',
        });
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    test('retrieves one original and one official target track', async () => {
        const bodies = new Map([
            [ORIGINAL_URL, ORIGINAL_TTML],
            [TARGET_URL, TARGET_TTML],
        ]);
        globalThis.fetch = jest.fn(async (url) =>
            createSubtitleFetchResponse(bodies.get(url), url)
        );

        const result = await subtitleService.processNetflixSubtitles(
            createOfficialTargetSnapshot()
        );

        expect(result.vttText).toContain('Original');
        expect(result.targetVttText).toContain('Target');
        expect(result).toMatchObject({
            sourceLanguage: 'en',
            targetLanguage: 'zh-CN',
            useNativeTarget: true,
        });
        expect(globalThis.fetch.mock.calls.map(([url]) => url)).toEqual([
            ORIGINAL_URL,
            TARGET_URL,
        ]);
    });

    test('passes the caller signal through the parser boundary', async () => {
        const snapshot = createAuthorizedNetflixSubtitleSnapshot();
        const signal = new AbortController().signal;
        const result = {
            vttText: 'WEBVTT',
            targetVttText: 'WEBVTT',
            sourceLanguage: 'en',
            targetLanguage: 'zh-CN',
            useNativeTarget: false,
            availableLanguages: [],
            url: 'Netflix TTML',
        };
        const process = jest
            .spyOn(netflixParser, 'processNetflixSubtitleData')
            .mockResolvedValue(result);

        await expect(
            subtitleService.processNetflixSubtitles(snapshot, { signal })
        ).resolves.toBe(result);
        expect(process).toHaveBeenCalledWith(snapshot, { signal });
    });

    test('turns parser failures into the stable recoverable service error', async () => {
        jest.spyOn(
            netflixParser,
            'processNetflixSubtitleData'
        ).mockRejectedValue(new Error('signed URL must stay private'));

        await expect(
            subtitleService.processNetflixSubtitles(
                createAuthorizedNetflixSubtitleSnapshot()
            )
        ).rejects.toMatchObject({
            name: 'SubtitleProcessingError',
            message:
                'Subtitle processing failed. Some subtitles may not be available.',
            details: {
                errorCode: 'SUBTITLE_PROCESSING_FAILED',
                isRecoverable: true,
            },
        });
    });

    test('preserves caller cancellation instead of wrapping it', async () => {
        const abortError = Object.assign(new Error('Request was aborted.'), {
            code: 'ERR_FETCH_ABORTED',
        });
        jest.spyOn(
            netflixParser,
            'processNetflixSubtitleData'
        ).mockRejectedValue(abortError);

        await expect(
            subtitleService.processNetflixSubtitles(
                createAuthorizedNetflixSubtitleSnapshot()
            )
        ).rejects.toBe(abortError);
    });
});
