import {
    afterEach,
    beforeAll,
    describe,
    expect,
    jest,
    test,
} from '@jest/globals';
import {
    getDisneySubtitleFailureMetadata,
    subtitleService,
} from './subtitleService.js';
import { configService } from '../../services/configService.js';
import {
    createAuthorizedDisneySubtitleSnapshot,
    createAuthorizedNetflixSubtitleSnapshot,
    createSubtitleFetchResponse,
} from '../../test-utils/subtitle-fetch-fixtures.js';

const originalFetch = globalThis.fetch;
const MASTER_URL =
    'https://captions.media.dssott.com/show/master.m3u8?token=master';
const ORIGINAL_MEDIA_URL = new URL('en/index.m3u8', MASTER_URL).href;
const TARGET_MEDIA_URL = new URL('zh/index.m3u8', MASTER_URL).href;
const ORIGINAL_SEGMENT_URL = new URL('original.vtt', ORIGINAL_MEDIA_URL).href;
const TARGET_SEGMENT_URL = new URL('target.vtt', TARGET_MEDIA_URL).href;
const ORIGINAL_VTT = 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nOriginal';
const TARGET_VTT = 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nTarget';
const MASTER_PLAYLIST = [
    '#EXTM3U',
    '#EXT-X-MEDIA:TYPE=SUBTITLES,NAME="English",LANGUAGE="en",URI="en/index.m3u8"',
    '#EXT-X-MEDIA:TYPE=SUBTITLES,NAME="Chinese",LANGUAGE="zh-CN",URI="zh/index.m3u8"',
].join('\n');

beforeAll(async () => {
    await subtitleService.initialize();
});

afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
});

function configureDisney({ useOfficialTranslations = true } = {}) {
    jest.spyOn(configService, 'get').mockResolvedValue({});
    jest.spyOn(configService, 'getMultiple').mockResolvedValue({
        useNativeSubtitles: true,
        useOfficialTranslations,
    });
}

function mockSubtitleChain(overrides = {}) {
    const bodies = new Map([
        [MASTER_URL, MASTER_PLAYLIST],
        [ORIGINAL_MEDIA_URL, '#EXTM3U\n#EXTINF:1,\noriginal.vtt'],
        [TARGET_MEDIA_URL, '#EXTM3U\n#EXTINF:1,\ntarget.vtt'],
        [ORIGINAL_SEGMENT_URL, ORIGINAL_VTT],
        [TARGET_SEGMENT_URL, TARGET_VTT],
        ...Object.entries(overrides),
    ]);
    globalThis.fetch = jest.fn(async (url) => {
        const value = bodies.get(url);
        if (value instanceof Error) throw value;
        if (value === undefined) throw new Error(`Unexpected URL: ${url}`);
        return createSubtitleFetchResponse(value, url);
    });
}

describe('SubtitleService Disney+', () => {
    test('rejects a snapshot authorized for another platform', async () => {
        globalThis.fetch = jest.fn();

        await expect(
            subtitleService.processDisneyPlusSubtitles(
                createAuthorizedNetflixSubtitleSnapshot()
            )
        ).rejects.toMatchObject({
            code: 'ERR_DISNEY_SUBTITLE_REQUEST_UNAUTHORIZED',
        });
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    test('returns direct VTT content without playlist expansion', async () => {
        const directUrl =
            'https://captions.media.dssott.com/show/direct-subtitles.vtt';
        const snapshot = createAuthorizedDisneySubtitleSnapshot({
            subtitleUrl: directUrl,
        });
        globalThis.fetch = jest.fn(async (url) =>
            createSubtitleFetchResponse(ORIGINAL_VTT, url)
        );

        const result =
            await subtitleService.processDisneyPlusSubtitles(snapshot);

        expect(result).toMatchObject({
            vttText: ORIGINAL_VTT,
            targetVttText: ORIGINAL_VTT,
            sourceLanguage: 'en',
            targetLanguage: 'zh-CN',
            useNativeTarget: false,
        });
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    test('fetches the selected original and official target chains once', async () => {
        configureDisney();
        mockSubtitleChain();
        const snapshot = createAuthorizedDisneySubtitleSnapshot({
            subtitleUrl: MASTER_URL,
        });

        const result =
            await subtitleService.processDisneyPlusSubtitles(snapshot);

        expect(result.vttText).toContain('Original');
        expect(result.targetVttText).toContain('Target');
        expect(result).toMatchObject({
            sourceLanguage: 'en',
            targetLanguage: 'zh-CN',
            useNativeTarget: true,
            selectedLanguage: 'en',
        });
        expect(globalThis.fetch.mock.calls.map(([url]) => url)).toEqual([
            MASTER_URL,
            ORIGINAL_MEDIA_URL,
            ORIGINAL_SEGMENT_URL,
            TARGET_MEDIA_URL,
            TARGET_SEGMENT_URL,
        ]);
    });

    test('keeps the original subtitles when the optional target fails', async () => {
        configureDisney();
        mockSubtitleChain({
            [TARGET_MEDIA_URL]: new Error('target unavailable'),
        });

        const result = await subtitleService.processDisneyPlusSubtitles(
            createAuthorizedDisneySubtitleSnapshot({ subtitleUrl: MASTER_URL })
        );

        expect(result.vttText).toContain('Original');
        expect(result.targetVttText).toBe(result.vttText);
        expect(result.useNativeTarget).toBe(false);
    });

    test('keeps an original-track failure terminal and classifies its stage', async () => {
        configureDisney();
        mockSubtitleChain({
            [ORIGINAL_MEDIA_URL]: new Error('original unavailable'),
        });

        const error = await subtitleService
            .processDisneyPlusSubtitles(
                createAuthorizedDisneySubtitleSnapshot({
                    subtitleUrl: MASTER_URL,
                })
            )
            .catch((caught) => caught);

        expect(getDisneySubtitleFailureMetadata(error)).toEqual({
            stage: 'media-fetch',
            errorCode: 'DISNEY_MEDIA_FETCH_FAILED',
        });
        expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    });

    test('propagates caller cancellation instead of treating it as fallback', async () => {
        configureDisney();
        const controller = new AbortController();
        controller.abort('private reason');
        globalThis.fetch = jest.fn();

        await expect(
            subtitleService.processDisneyPlusSubtitles(
                createAuthorizedDisneySubtitleSnapshot({
                    subtitleUrl: MASTER_URL,
                }),
                { signal: controller.signal }
            )
        ).rejects.toMatchObject({ code: 'ERR_FETCH_ABORTED' });
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    test('parses languages and applies the configured subtitle blacklist', async () => {
        jest.spyOn(configService, 'get').mockResolvedValue({
            disneyplus: ['forced'],
        });
        const playlist = [
            '#EXTM3U',
            '#EXT-X-MEDIA:TYPE=SUBTITLES,NAME="English",LANGUAGE="en-US",URI="en.m3u8"',
            '#EXT-X-MEDIA:TYPE=SUBTITLES,NAME="English Forced",LANGUAGE="en-US",URI="forced.m3u8"',
        ].join('\n');

        await expect(
            subtitleService.parseAvailableSubtitleLanguages(
                playlist,
                'disneyplus'
            )
        ).resolves.toEqual([
            expect.objectContaining({
                normalizedCode: 'en',
                displayName: 'English',
                uri: 'en.m3u8',
            }),
        ]);
    });
});
