import { describe, expect, it } from 'vitest';
import {
    extractYouTubeVideoIdFromUrl,
    normalizeYouTubeVideoId,
} from './routeIdentity';

describe('YouTube route identity', () => {
    it.each([
        ['https://www.youtube.com/watch?v=arj7oStGLkU', 'arj7oStGLkU'],
        ['https://www.youtube.com/watch?v=Ks-_Mh1QhMc&t=42s', 'Ks-_Mh1QhMc'],
        ['https://www.youtube.com/watch?list=PL1&v=7kk3VajdeaM', '7kk3VajdeaM'],
        ['https://www.youtube.com/shorts/xmQVy2w3FyQ', 'xmQVy2w3FyQ'],
        ['https://www.youtube.com/shorts/3k_wxTkYN50/', '3k_wxTkYN50'],
    ])('reads the video of %s', (url, videoId) => {
        expect(extractYouTubeVideoIdFromUrl(url)).toBe(videoId);
    });

    it.each([
        ['the home page', 'https://www.youtube.com/'],
        ['a channel', 'https://www.youtube.com/@TED/videos'],
        ['a watch page without a video', 'https://www.youtube.com/watch'],
        [
            'a watch page naming two videos',
            'https://www.youtube.com/watch?v=arj7oStGLkU&v=Ks-_Mh1QhMc',
        ],
        ['a short id', 'https://www.youtube.com/watch?v=arj7oStGLk'],
        ['a long id', 'https://www.youtube.com/watch?v=arj7oStGLkUU'],
        [
            'a forbidden character',
            'https://www.youtube.com/watch?v=arj7oSt%2FLkU',
        ],
        [
            'an encoded Shorts id',
            'https://www.youtube.com/shorts/xmQVy2w3F%79Q',
        ],
        ['a Shorts sub-path', 'https://www.youtube.com/shorts/xmQVy2w3FyQ/x'],
        ['an embed', 'https://www.youtube.com/embed/arj7oStGLkU'],
        ['a watch-like path', 'https://www.youtube.com/watchx?v=arj7oStGLkU'],
        ['no URL', 'not a url'],
    ])('names no video for %s', (_case, url) => {
        expect(extractYouTubeVideoIdFromUrl(url)).toBeNull();
    });

    it('accepts only well-formed ids from page data', () => {
        expect(normalizeYouTubeVideoId('arj7oStGLkU')).toBe('arj7oStGLkU');
        expect(normalizeYouTubeVideoId('arj7oStGLkU ')).toBeNull();
        expect(normalizeYouTubeVideoId(12345678901)).toBeNull();
    });
});
