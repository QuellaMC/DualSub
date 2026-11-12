import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClassifiedContentSender } from '@/messaging/sender';
import { fetchAuthorizedSubtitleText, SubtitleFetchError } from './fetch';
import { authorizeSubtitleRequest } from './policy';

const VIDEO = 'arj7oStGLkU';
const CAPTION_URL = `https://www.youtube.com/api/timedtext?v=${VIDEO}&pot=token&c=WEB&fmt=vtt`;

const youtubeSnapshot = authorizeSubtitleRequest(
    {
        action: 'fetchVTT',
        source: 'youtube',
        videoId: VIDEO,
        targetLanguage: 'zh-CN',
        originalLanguage: 'en',
        useOfficialTranslations: false,
        data: {
            tracks: [
                {
                    language: 'en',
                    displayName: 'English',
                    asr: false,
                    url: CAPTION_URL,
                },
            ],
        },
    },
    {
        role: 'content',
        platform: 'youtube',
        tabId: 7,
        windowId: 1,
        documentId: 'doc',
        documentLifecycle: 'active',
        origin: 'https://www.youtube.com',
        senderUrl: `https://www.youtube.com/watch?v=${VIDEO}`,
        tabUrl: `https://www.youtube.com/watch?v=${VIDEO}`,
        frameId: 0,
    } satisfies ClassifiedContentSender
);

function respond(body: string, redirected = false): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn((url: string) => {
        const response = new Response(body, { status: 200 });
        Object.defineProperties(response, {
            url: { value: url },
            redirected: { value: redirected },
        });
        return Promise.resolve(response);
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('fetchAuthorizedSubtitleText for YouTube', () => {
    it('sends no cookies and follows no redirect', async () => {
        const fetchMock = respond('WEBVTT\n');
        await expect(
            fetchAuthorizedSubtitleText(youtubeSnapshot, CAPTION_URL, {
                maxBytes: 1024,
            })
        ).resolves.toEqual({ text: 'WEBVTT\n', canonicalUrl: CAPTION_URL });
        expect(fetchMock).toHaveBeenCalledWith(
            CAPTION_URL,
            expect.objectContaining({ credentials: 'omit', redirect: 'error' })
        );
    });

    it('rejects a redirected response', async () => {
        respond('WEBVTT\n', true);
        await expect(
            fetchAuthorizedSubtitleText(youtubeSnapshot, CAPTION_URL, {
                maxBytes: 1024,
            })
        ).rejects.toBeInstanceOf(SubtitleFetchError);
    });

    it('rejects a body over the byte cap', async () => {
        respond(`WEBVTT\n${'x'.repeat(2048)}`);
        await expect(
            fetchAuthorizedSubtitleText(youtubeSnapshot, CAPTION_URL, {
                maxBytes: 1024,
            })
        ).rejects.toThrow();
    });
});
