import { describe, expect, it } from 'vitest';
import type { ClassifiedContentSender } from '@/messaging/sender';
import {
    assertAllowedSubtitleUrl,
    authorizeSubtitleRequest,
    isAuthorizedSubtitleRequestSnapshot,
    resolveAllowedSubtitleUrl,
    SubtitleRequestPolicyError,
} from './policy';

function contentSender(
    overrides: Partial<ClassifiedContentSender> = {}
): ClassifiedContentSender {
    return {
        role: 'content',
        platform: 'disneyplus',
        tabId: 7,
        windowId: 1,
        documentId: 'doc',
        documentLifecycle: 'active',
        origin: 'https://www.disneyplus.com',
        senderUrl: 'https://www.disneyplus.com/play/abc123',
        tabUrl: 'https://www.disneyplus.com/play/abc123',
        frameId: 0,
        ...overrides,
    };
}

function netflixSender(): ClassifiedContentSender {
    return contentSender({
        platform: 'netflix',
        origin: 'https://www.netflix.com',
        senderUrl: 'https://www.netflix.com/watch/81234567',
        tabUrl: 'https://www.netflix.com/watch/81234567',
    });
}

const disneyRequest = {
    action: 'fetchVTT' as const,
    source: 'disneyplus' as const,
    videoId: 'abc123',
    url: 'https://cdn.media.dssott.com/master.m3u8#frag',
    targetLanguage: 'zh-CN',
    originalLanguage: 'en',
    useOfficialTranslations: false,
};

function netflixRequest(tracks: unknown[]) {
    return {
        action: 'fetchVTT' as const,
        source: 'netflix' as const,
        videoId: '81234567',
        targetLanguage: 'zh-CN',
        originalLanguage: 'en',
        useOfficialTranslations: true,
        data: { tracks },
    };
}

const NETFLIX_CDN_URL = 'https://sub.nflxvideo.net/track?o=1';

describe('Disney authorization', () => {
    it('authorizes a route-matching request with a canonical CDN URL', () => {
        const snapshot = authorizeSubtitleRequest(
            disneyRequest,
            contentSender()
        );
        expect(isAuthorizedSubtitleRequestSnapshot(snapshot)).toBe(true);
        expect(snapshot).toMatchObject({
            source: 'disneyplus',
            tabId: 7,
            videoId: 'abc123',
            // Fragment stripped by canonicalization.
            url: 'https://cdn.media.dssott.com/master.m3u8',
            useOfficialTranslations: false,
        });
        expect(Object.isFrozen(snapshot)).toBe(true);
    });

    it('rejects when the tab route does not match the requested videoId', () => {
        expect(() =>
            authorizeSubtitleRequest(
                { ...disneyRequest, videoId: 'other-video' },
                contentSender()
            )
        ).toThrow(SubtitleRequestPolicyError);
        expect(() =>
            authorizeSubtitleRequest(
                disneyRequest,
                contentSender({
                    tabUrl: 'https://www.disneyplus.com/home',
                })
            )
        ).toThrow(SubtitleRequestPolicyError);
    });

    it('rejects a sender from the wrong platform', () => {
        expect(() =>
            authorizeSubtitleRequest(disneyRequest, netflixSender())
        ).toThrow(SubtitleRequestPolicyError);
    });

    it.each([
        ['http scheme', 'http://cdn.media.dssott.com/master.m3u8'],
        ['foreign host', 'https://evil.example.com/master.m3u8'],
        ['lookalike host', 'https://media.dssott.com.evil.dev/m.m3u8'],
        ['netflix CDN for disney', NETFLIX_CDN_URL],
        ['userinfo', 'https://user:pw@cdn.media.dssott.com/m.m3u8'],
        ['explicit port', 'https://cdn.media.dssott.com:8443/m.m3u8'],
        ['edge CDN at request time', 'https://cdn.dssedge.com/master.m3u8'],
    ])('rejects %s', (_label, url) => {
        expect(() =>
            authorizeSubtitleRequest({ ...disneyRequest, url }, contentSender())
        ).toThrow(SubtitleRequestPolicyError);
    });
});

describe('Netflix authorization', () => {
    const goodTrack = {
        language: 'en',
        displayName: 'English',
        trackType: 'PRIMARY',
        url: NETFLIX_CDN_URL,
    };

    it('vets each resolved track URL and freezes the snapshot', () => {
        const snapshot = authorizeSubtitleRequest(
            netflixRequest([goodTrack]),
            netflixSender()
        );
        expect(snapshot.source).toBe('netflix');
        if (snapshot.source === 'netflix') {
            expect(snapshot.tracks).toEqual([
                {
                    language: 'en',
                    displayName: 'English',
                    trackType: 'PRIMARY',
                    downloadUrl: NETFLIX_CDN_URL,
                },
            ]);
        }
        expect(Object.isFrozen(snapshot)).toBe(true);
    });

    it('defaults the display name and omits an absent track type', () => {
        const snapshot = authorizeSubtitleRequest(
            netflixRequest([
                { language: 'ja', url: `${NETFLIX_CDN_URL}#frag` },
            ]),
            netflixSender()
        );
        if (snapshot.source === 'netflix') {
            expect(snapshot.tracks).toEqual([
                {
                    language: 'ja',
                    displayName: 'ja',
                    downloadUrl: NETFLIX_CDN_URL,
                },
            ]);
        }
    });

    it.each([
        [
            'a URL off the Netflix CDN',
            { language: 'en', url: 'https://evil.example/track' },
        ],
        [
            'an http URL',
            { language: 'en', url: 'http://sub.nflxvideo.net/track' },
        ],
        ['a missing URL', { language: 'en' }],
        ['an unknown key', { ...goodTrack, trackId: 'x' }],
        ['a blank language', { ...goodTrack, language: ' ' }],
        ['a non-string track type', { ...goodTrack, trackType: 1 }],
        [
            'an oversized display name',
            { ...goodTrack, displayName: 'x'.repeat(257) },
        ],
        ['a non-object track', 'en'],
    ])('rejects a track with %s', (_label, track) => {
        expect(() =>
            authorizeSubtitleRequest(netflixRequest([track]), netflixSender())
        ).toThrow(SubtitleRequestPolicyError);
    });

    it('rejects the whole request when any track is invalid', () => {
        expect(() =>
            authorizeSubtitleRequest(
                netflixRequest([
                    goodTrack,
                    { language: 'fr', url: 'https://evil.example/track' },
                ]),
                netflixSender()
            )
        ).toThrow(SubtitleRequestPolicyError);
    });

    it('rejects a videoId that is not the tab route', () => {
        expect(() =>
            authorizeSubtitleRequest(
                { ...netflixRequest([goodTrack]), videoId: '1' },
                netflixSender()
            )
        ).toThrow(SubtitleRequestPolicyError);
    });
});

const YOUTUBE_VIDEO_ID = 'arj7oStGLkU';
const YOUTUBE_CAPTION_URL = `https://www.youtube.com/api/timedtext?v=${YOUTUBE_VIDEO_ID}&lang=en&pot=token&c=WEB&fmt=vtt`;

function youtubeSender(
    tabUrl = `https://www.youtube.com/watch?v=${YOUTUBE_VIDEO_ID}`
): ClassifiedContentSender {
    return contentSender({
        platform: 'youtube',
        origin: 'https://www.youtube.com',
        senderUrl: tabUrl,
        tabUrl,
    });
}

function youtubeRequest(tracks: unknown[], videoId = YOUTUBE_VIDEO_ID) {
    return {
        action: 'fetchVTT' as const,
        source: 'youtube' as const,
        videoId,
        targetLanguage: 'zh-CN',
        originalLanguage: 'en',
        useOfficialTranslations: true,
        data: { tracks },
    };
}

describe('YouTube authorization', () => {
    const goodTrack = {
        language: 'en',
        displayName: 'English (auto-generated)',
        asr: true,
        url: YOUTUBE_CAPTION_URL,
    };

    it('vets each track URL for the routed video and freezes the snapshot', () => {
        const snapshot = authorizeSubtitleRequest(
            youtubeRequest([goodTrack]),
            youtubeSender()
        );
        expect(snapshot).toMatchObject({
            source: 'youtube',
            videoId: YOUTUBE_VIDEO_ID,
            tracks: [
                {
                    language: 'en',
                    displayName: 'English (auto-generated)',
                    asr: true,
                    downloadUrl: YOUTUBE_CAPTION_URL,
                },
            ],
        });
        expect(Object.isFrozen(snapshot)).toBe(true);
    });

    it('authorizes a Short by its path', () => {
        expect(
            authorizeSubtitleRequest(
                youtubeRequest([goodTrack]),
                youtubeSender(
                    `https://www.youtube.com/shorts/${YOUTUBE_VIDEO_ID}`
                )
            ).source
        ).toBe('youtube');
    });

    const withUrl = (url: string) => ({ ...goodTrack, url });
    it.each([
        ['another host', withUrl(YOUTUBE_CAPTION_URL.replace('www.', 'm.'))],
        [
            'a Google video host',
            withUrl(
                YOUTUBE_CAPTION_URL.replace(
                    'www.youtube.com',
                    'rr1---sn.googlevideo.com'
                )
            ),
        ],
        [
            'another path',
            withUrl(YOUTUBE_CAPTION_URL.replace('/api/timedtext', '/api/x')),
        ],
        [
            'an explicit port',
            withUrl(YOUTUBE_CAPTION_URL.replace('.com/', '.com:8443/')),
        ],
        [
            'credentials',
            withUrl(YOUTUBE_CAPTION_URL.replace('https://', 'https://a:b@')),
        ],
        ['an http URL', withUrl(YOUTUBE_CAPTION_URL.replace('https', 'http'))],
        [
            'another video in its URL',
            withUrl(
                YOUTUBE_CAPTION_URL.replace(YOUTUBE_VIDEO_ID, 'Ks-_Mh1QhMc')
            ),
        ],
        [
            'two videos in its URL',
            withUrl(`${YOUTUBE_CAPTION_URL}&v=${YOUTUBE_VIDEO_ID}`),
        ],
        [
            'no video in its URL',
            withUrl(YOUTUBE_CAPTION_URL.replace(`v=${YOUTUBE_VIDEO_ID}&`, '')),
        ],
        [
            'an overlong URL',
            withUrl(`${YOUTUBE_CAPTION_URL}&x=${'a'.repeat(16 * 1024)}`),
        ],
        ['a missing asr flag', { language: 'en', url: YOUTUBE_CAPTION_URL }],
        ['a non-boolean asr flag', { ...goodTrack, asr: 'asr' }],
        ['an unknown key', { ...goodTrack, kind: 'asr' }],
        ['a blank language', { ...goodTrack, language: ' ' }],
    ])('rejects a track with %s', (_label, track) => {
        expect(() =>
            authorizeSubtitleRequest(youtubeRequest([track]), youtubeSender())
        ).toThrow(SubtitleRequestPolicyError);
    });

    it('rejects a videoId that is not the tab route', () => {
        expect(() =>
            authorizeSubtitleRequest(
                youtubeRequest([goodTrack]),
                youtubeSender('https://www.youtube.com/watch?v=Ks-_Mh1QhMc')
            )
        ).toThrow(SubtitleRequestPolicyError);
        expect(() =>
            authorizeSubtitleRequest(
                youtubeRequest([goodTrack]),
                youtubeSender('https://www.youtube.com/')
            )
        ).toThrow(SubtitleRequestPolicyError);
    });

    it('rejects a YouTube request from another site', () => {
        expect(() =>
            authorizeSubtitleRequest(
                youtubeRequest([goodTrack]),
                netflixSender()
            )
        ).toThrow(SubtitleRequestPolicyError);
    });
});

describe('URL gates for authorized snapshots', () => {
    const snapshot = authorizeSubtitleRequest(disneyRequest, contentSender());

    it('refuses unbranded snapshot lookalikes', () => {
        const forged = { ...snapshot };
        expect(() =>
            assertAllowedSubtitleUrl(forged, disneyRequest.url, 'stage')
        ).toThrow(SubtitleRequestPolicyError);
    });

    it('allows the Disney edge CDN after authorization (redirect target)', () => {
        expect(
            assertAllowedSubtitleUrl(
                snapshot,
                'https://x.dssedge.com/seg.vtt',
                'vtt-segment'
            )
        ).toBe('https://x.dssedge.com/seg.vtt');
    });

    it('resolves relative references against an allowed base only', () => {
        expect(
            resolveAllowedSubtitleUrl(
                snapshot,
                'seg1.vtt',
                'https://cdn.media.dssott.com/playlists/lang.m3u8',
                'vtt-segment'
            )
        ).toBe('https://cdn.media.dssott.com/playlists/seg1.vtt');

        expect(() =>
            resolveAllowedSubtitleUrl(
                snapshot,
                'https://evil.example/abs.vtt',
                'https://cdn.media.dssott.com/playlists/lang.m3u8',
                'vtt-segment'
            )
        ).toThrow(SubtitleRequestPolicyError);
    });
});
