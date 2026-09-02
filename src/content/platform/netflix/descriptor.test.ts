import { describe, expect, it } from 'vitest';
import { netflixDescriptor } from './descriptor';

describe('netflixDescriptor', () => {
    it('derives the videoId from watch routes only', () => {
        expect(
            netflixDescriptor.parseVideoIdFromUrl(
                'https://www.netflix.com/watch/81234567?trackId=1'
            )
        ).toBe('81234567');
        expect(
            netflixDescriptor.parseVideoIdFromUrl(
                'https://www.netflix.com/watch/81234567/'
            )
        ).toBe('81234567');
        expect(
            netflixDescriptor.parseVideoIdFromUrl(
                'https://www.netflix.com/browse'
            )
        ).toBeNull();
        expect(
            netflixDescriptor.parseVideoIdFromUrl(
                'https://www.netflix.com/watch/abc'
            )
        ).toBeNull();
    });

    it('keys subtitle events by their own movieId (preload-safe)', () => {
        expect(
            netflixDescriptor.classifyBridgeEvent({
                t: 'subtitle-data',
                platform: 'netflix',
                movieId: '99',
                languages: ['en'],
                tracks: [],
            })
        ).toEqual({ kind: 'subtitle', videoId: '99' });
        expect(
            netflixDescriptor.classifyBridgeEvent({
                t: 'subtitle-data',
                platform: 'netflix',
                movieId: 'not-numeric',
                languages: ['en'],
                tracks: [],
            })
        ).toBeNull();
        expect(
            netflixDescriptor.classifyBridgeEvent({
                t: 'subtitle-url',
                platform: 'disneyplus',
                url: 'https://x',
                videoId: 'a',
            })
        ).toBeNull();
    });
});
