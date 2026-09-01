import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { FetchAbortedError } from '@/shared/fetchWithTimeout';
import type {
    DisneyAuthorizedRequest,
    NetflixAuthorizedRequest,
} from './policy';
import { fetchAuthorizedSubtitleText } from './fetch';
import { processNetflixSubtitles } from './parsers/netflix';
import { DisneySubtitleError, processDisneyPlusSubtitles } from './service';

vi.mock('./fetch', () => ({
    fetchAuthorizedSubtitleText: vi.fn(),
}));

const mockedFetch = vi.mocked(fetchAuthorizedSubtitleText);

const TTML = (text: string) =>
    `<tt><body><p begin="1s" end="2s">${text}</p></body></tt>`;

function netflixSnapshot(
    overrides: Partial<NetflixAuthorizedRequest> = {}
): NetflixAuthorizedRequest {
    return {
        source: 'netflix',
        tabId: 1,
        videoId: '81234567',
        targetLanguage: 'zh-CN',
        originalLanguage: 'en',
        useOfficialTranslations: true,
        tracks: [
            {
                language: 'en',
                displayName: 'English',
                trackType: 'PRIMARY',
                downloadUrl: 'https://sub.nflxvideo.net/en-primary',
            },
            {
                language: 'en',
                displayName: 'English CC',
                trackType: 'ASSISTIVE',
                downloadUrl: 'https://sub.nflxvideo.net/en-assistive',
            },
            {
                language: 'zh-CN',
                displayName: '中文',
                trackType: 'PRIMARY',
                downloadUrl: 'https://sub.nflxvideo.net/zh',
            },
        ],
        ...overrides,
    };
}

describe('processNetflixSubtitles', () => {
    beforeEach(() => {
        mockedFetch.mockReset();
        mockedFetch.mockImplementation((_snapshot, reference) =>
            Promise.resolve({
                text: TTML(`cue from ${String(reference)}`),
                canonicalUrl: String(reference),
            })
        );
    });

    it('prefers the PRIMARY original track and fetches the official target', async () => {
        const result = await processNetflixSubtitles(netflixSnapshot());
        expect(result.useNativeTarget).toBe(true);
        expect(result.vttText).toContain('en-primary');
        expect(result.targetVttText).toContain('nflxvideo.net/zh');
        expect(result.sourceLanguage).toBe('en');
        expect(result.selectedLanguage).toEqual({
            normalizedCode: 'en',
            displayName: 'English',
        });
    });

    it('falls back to English then first track for unknown original languages', async () => {
        const result = await processNetflixSubtitles(
            netflixSnapshot({ originalLanguage: 'sv' })
        );
        expect(result.sourceLanguage).toBe('en');
    });

    it('keeps the original when the official target fails (never discards)', async () => {
        mockedFetch.mockImplementation((_snapshot, reference) =>
            String(reference).includes('/zh')
                ? Promise.reject(new Error('target 500'))
                : Promise.resolve({
                      text: TTML('original ok'),
                      canonicalUrl: String(reference),
                  })
        );
        const result = await processNetflixSubtitles(netflixSnapshot());
        expect(result.useNativeTarget).toBe(false);
        expect(result.targetVttText).toBeNull();
        expect(result.vttText).toContain('original ok');
    });

    it('skips the official target entirely when the setting is off', async () => {
        const result = await processNetflixSubtitles(
            netflixSnapshot({ useOfficialTranslations: false })
        );
        expect(result.useNativeTarget).toBe(false);
        expect(mockedFetch).toHaveBeenCalledTimes(1);
    });

    it('rethrows caller aborts instead of swallowing them as fallbacks', async () => {
        mockedFetch.mockImplementation((_snapshot, reference) =>
            String(reference).includes('/zh')
                ? Promise.reject(new FetchAbortedError())
                : Promise.resolve({
                      text: TTML('original'),
                      canonicalUrl: String(reference),
                  })
        );
        await expect(
            processNetflixSubtitles(netflixSnapshot())
        ).rejects.toBeInstanceOf(FetchAbortedError);
    });
});

const MASTER = [
    '#EXTM3U',
    '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",LANGUAGE="en",NAME="English",URI="en.m3u8"',
    '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",LANGUAGE="zh-Hans",NAME="中文",URI="zh.m3u8"',
    '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",LANGUAGE="en",NAME="English --forced--",URI="forced.m3u8"',
    '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",LANGUAGE="fr",NAME="Français",FORCED=YES,URI="fr-forced.m3u8"',
].join('\n');

function disneySnapshot(): DisneyAuthorizedRequest {
    return {
        source: 'disneyplus',
        tabId: 2,
        videoId: 'abc',
        url: 'https://cdn.media.dssott.com/master.m3u8',
        targetLanguage: 'zh-CN',
        originalLanguage: 'en',
    };
}

describe('processDisneyPlusSubtitles', () => {
    beforeEach(async () => {
        await fakeBrowser.storage.sync.clear();
        await fakeBrowser.storage.local.clear();
        mockedFetch.mockReset();
    });

    it('walks master → language playlists, honoring the blacklist', async () => {
        mockedFetch.mockImplementation((_snapshot, reference) => {
            if (String(reference).endsWith('master.m3u8')) {
                return Promise.resolve({
                    text: MASTER,
                    canonicalUrl: 'https://cdn.media.dssott.com/master.m3u8',
                });
            }
            return Promise.resolve({
                text: `WEBVTT\n\ncue for ${String(reference)}`,
                canonicalUrl: String(reference),
            });
        });

        const result = await processDisneyPlusSubtitles(disneySnapshot());
        expect(result.useNativeTarget).toBe(true);
        expect(result.vttText).toContain('en.m3u8');
        expect(result.targetVttText).toContain('zh.m3u8');
        expect(result.selectedLanguage).toEqual({
            normalizedCode: 'en',
            displayName: 'English',
        });
        // Blacklisted variants (--forced-- name, FORCED=YES attribute) are
        // never fetched.
        const fetched = mockedFetch.mock.calls.map((call) => call[1]);
        expect(fetched).not.toContain('forced.m3u8');
        expect(fetched).not.toContain('fr-forced.m3u8');
    });

    it('returns direct VTT masters as-is without a native target', async () => {
        mockedFetch.mockResolvedValue({
            text: 'WEBVTT\n\ndirect cue',
            canonicalUrl: 'https://cdn.media.dssott.com/master.m3u8',
        });
        const result = await processDisneyPlusSubtitles(disneySnapshot());
        expect(result.vttText).toContain('direct cue');
        expect(result.useNativeTarget).toBe(false);
        expect(result.targetVttText).toBeNull();
    });

    it('keeps the original when the official target playlist fails', async () => {
        mockedFetch.mockImplementation((_snapshot, reference) => {
            if (String(reference).endsWith('master.m3u8')) {
                return Promise.resolve({
                    text: MASTER,
                    canonicalUrl: 'https://cdn.media.dssott.com/master.m3u8',
                });
            }
            if (String(reference) === 'zh.m3u8') {
                return Promise.reject(new Error('zh playlist down'));
            }
            return Promise.resolve({
                text: 'WEBVTT\n\nen cue',
                canonicalUrl: String(reference),
            });
        });
        const result = await processDisneyPlusSubtitles(disneySnapshot());
        expect(result.useNativeTarget).toBe(false);
        expect(result.vttText).toContain('en cue');
    });

    it.each([
        [
            'master-fetch',
            () => mockedFetch.mockRejectedValue(new Error('network down')),
        ],
        [
            'master-parse',
            () =>
                mockedFetch.mockResolvedValue({
                    text: '<html>not a playlist</html>',
                    canonicalUrl: 'https://cdn.media.dssott.com/master.m3u8',
                }),
        ],
    ])('tags %s failures with their stage', async (stage, arrange) => {
        arrange();
        const error = await processDisneyPlusSubtitles(disneySnapshot()).catch(
            (caught: unknown) => caught
        );
        expect(error).toBeInstanceOf(DisneySubtitleError);
        expect((error as DisneySubtitleError).stage).toBe(stage);
    });
});
