import { describe, expect, it } from 'vitest';
import { disneyPlusDescriptor } from './descriptor';

describe('disneyPlusDescriptor', () => {
    it('derives the videoId from play and video routes', () => {
        expect(
            disneyPlusDescriptor.parseVideoIdFromUrl(
                'https://www.disneyplus.com/play/abc-123'
            )
        ).toBe('abc-123');
        expect(
            disneyPlusDescriptor.parseVideoIdFromUrl(
                'https://www.disneyplus.com/video/xyz/'
            )
        ).toBe('xyz');
        expect(
            disneyPlusDescriptor.parseVideoIdFromUrl(
                'https://www.disneyplus.com/home'
            )
        ).toBeNull();
    });

    it('classifies subtitle URLs as subtitle events and timeline updates as platform events', () => {
        expect(
            disneyPlusDescriptor.classifyBridgeEvent({
                t: 'subtitle-url',
                platform: 'disneyplus',
                url: 'https://cdn.media.dssott.com/m.m3u8',
                videoId: 'abc-123',
            })
        ).toEqual({ kind: 'subtitle', videoId: 'abc-123' });
        expect(
            disneyPlusDescriptor.classifyBridgeEvent({
                t: 'timeline-update',
                platform: 'disneyplus',
                sequence: 1,
                videoId: 'abc-123',
                programTimeSeconds: 1,
                availId: null,
                playbackSessionId: null,
                isInterstitialPlaying: null,
            })
        ).toEqual({ kind: 'platform', videoId: 'abc-123' });
        expect(
            disneyPlusDescriptor.classifyBridgeEvent({
                t: 'subtitle-data',
                platform: 'netflix',
                movieId: '1',
                languages: ['en'],
                tracks: [],
            })
        ).toBeNull();
    });
});
