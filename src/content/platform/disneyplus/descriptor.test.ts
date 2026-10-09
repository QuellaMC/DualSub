import { describe, expect, it } from 'vitest';
import { DISNEY_DEFAULT_APPEARANCE } from './appearance';
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

    it('routes appearance events document-wide and turns them into a look', () => {
        const appearance = { textEdge: 'raised' };
        expect(
            disneyPlusDescriptor.classifyBridgeEvent({
                t: 'subtitle-appearance',
                platform: 'disneyplus',
                appearance,
            })
        ).toEqual({ kind: 'appearance', appearance });
        expect(
            disneyPlusDescriptor.parsePlatformLook(DISNEY_DEFAULT_APPEARANCE)
        ).toEqual(disneyPlusDescriptor.look);
        expect(
            disneyPlusDescriptor.parsePlatformLook(appearance)?.textShadow
        ).toBe('2px 2px 0 rgba(0,0,0,.5)');
        expect(disneyPlusDescriptor.parsePlatformLook({})).toBeNull();
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
