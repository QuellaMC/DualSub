import { describe, expect, it } from 'vitest';
import { youtubeDescriptor } from './descriptor';

describe('youtubeDescriptor', () => {
    it('separates sessions by route, since the player and its video are reused', () => {
        expect(youtubeDescriptor.capabilities).toEqual({
            directMediaControl: true,
            videoReplacedAcrossEpisodes: false,
        });
        expect(
            youtubeDescriptor.parseVideoIdFromUrl(
                'https://www.youtube.com/shorts/xmQVy2w3FyQ'
            )
        ).toBe('xmQVy2w3FyQ');
    });

    it('keys subtitle data by the video the event names', () => {
        const subtitleData = (videoId: string) =>
            youtubeDescriptor.classifyBridgeEvent({
                t: 'subtitle-data',
                platform: 'youtube',
                videoId,
                languages: ['en'],
                tracks: [],
            });
        expect(subtitleData('Ks-_Mh1QhMc')).toEqual({
            kind: 'subtitle',
            videoId: 'Ks-_Mh1QhMc',
        });
        expect(subtitleData('not-an-id')).toBeNull();
    });

    it('routes the spoken language to its video', () => {
        expect(
            youtubeDescriptor.classifyBridgeEvent({
                t: 'spoken-language',
                platform: 'youtube',
                videoId: 'arj7oStGLkU',
                language: 'ja',
            })
        ).toEqual({
            kind: 'spoken-language',
            videoId: 'arj7oStGLkU',
            language: 'ja',
        });
    });

    it('draws YouTube’s default caption style, as no appearance is reported', () => {
        expect(
            youtubeDescriptor.classifyBridgeEvent({
                t: 'subtitle-appearance',
                platform: 'youtube',
                appearance: {},
            })
        ).toBeNull();
        expect(youtubeDescriptor.parsePlatformLook({})).toBeNull();
        expect(youtubeDescriptor.look).toMatchObject({
            originalColor: '#ffffff',
            background: 'rgba(8, 8, 8, 0.75)',
        });
    });
});
