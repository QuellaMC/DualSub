import { describe, expect, it } from 'vitest';
import {
    isCapturedEvent,
    isHelloMessage,
    isIsolatedToMain,
    isMainToIsolated,
} from './protocol';

const capability = 'a'.repeat(64);

describe('bridge protocol validators', () => {
    it('accepts well-formed captured events', () => {
        expect(
            isCapturedEvent({
                t: 'subtitle-data',
                platform: 'netflix',
                movieId: '81234567',
                tracks: [],
            })
        ).toBe(true);
        expect(
            isCapturedEvent({
                t: 'subtitle-url',
                platform: 'disneyplus',
                url: 'https://x/master.m3u8',
                videoId: 'abc',
            })
        ).toBe(true);
        expect(
            isCapturedEvent({
                t: 'timeline-update',
                platform: 'disneyplus',
                sequence: 3,
                videoId: 'abc',
                programTimeSeconds: 12.5,
                availId: null,
                playbackSessionId: 'ps',
                isInterstitialPlaying: false,
            })
        ).toBe(true);
    });

    it.each([
        [
            'wrong platform',
            {
                t: 'subtitle-data',
                platform: 'disneyplus',
                movieId: '1',
                tracks: [],
            },
        ],
        [
            'missing tracks',
            { t: 'subtitle-data', platform: 'netflix', movieId: '1' },
        ],
        [
            'empty url',
            {
                t: 'subtitle-url',
                platform: 'disneyplus',
                url: '',
                videoId: 'a',
            },
        ],
        [
            'non-finite time',
            {
                t: 'timeline-update',
                platform: 'disneyplus',
                sequence: 1,
                videoId: 'a',
                programTimeSeconds: Infinity,
                availId: null,
                playbackSessionId: null,
                isInterstitialPlaying: null,
            },
        ],
        ['unknown type', { t: 'mystery' }],
        ['array', []],
    ])('rejects %s', (_label, value) => {
        expect(isCapturedEvent(value)).toBe(false);
    });

    it('validates ready frames including buffered events', () => {
        expect(isMainToIsolated({ t: 'ready', capability, buffered: [] })).toBe(
            true
        );
        expect(
            isMainToIsolated({ t: 'ready', capability: 'short', buffered: [] })
        ).toBe(false);
        expect(
            isMainToIsolated({
                t: 'ready',
                capability,
                buffered: [{ t: 'bad' }],
            })
        ).toBe(false);
    });

    it('validates hello and control frames', () => {
        expect(
            isHelloMessage(
                { dualsub: 'hello', platform: 'netflix', capability },
                'netflix'
            )
        ).toBe(true);
        expect(
            isHelloMessage(
                { dualsub: 'hello', platform: 'netflix', capability },
                'disneyplus'
            )
        ).toBe(false);
        expect(
            isHelloMessage(
                { dualsub: 'hello', platform: 'netflix', capability: 'zz' },
                'netflix'
            )
        ).toBe(false);
        expect(isIsolatedToMain({ t: 'close' })).toBe(true);
        expect(isIsolatedToMain({ t: 'ready' })).toBe(false);
    });
});

describe('track resolution frames', () => {
    it('accepts a bounded language list and the cancel frame', () => {
        expect(
            isIsolatedToMain({
                t: 'request-subtitle-tracks',
                videoId: '70283145',
                languages: ['en', 'zh-CN'],
            })
        ).toBe(true);
        expect(isIsolatedToMain({ t: 'cancel-subtitle-tracks' })).toBe(true);
    });

    it.each([
        ['no languages', { videoId: '1', languages: [] }],
        ['blank videoId', { videoId: '', languages: ['en'] }],
        ['non-string language', { videoId: '1', languages: ['en', 5] }],
        [
            'too many languages',
            { videoId: '1', languages: Array<string>(5).fill('en') },
        ],
        ['missing languages', { videoId: '1' }],
    ])('rejects a request with %s', (_label, frame) => {
        expect(
            isIsolatedToMain({ t: 'request-subtitle-tracks', ...frame })
        ).toBe(false);
    });
});
