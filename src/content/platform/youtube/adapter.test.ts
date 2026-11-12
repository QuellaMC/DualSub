// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '@/shared/logger';
import type { AdapterContext } from '../types';
import { YouTubeAdapter } from './adapter';

function setup() {
    const sendControl = vi.fn(() => true);
    const context: AdapterContext = {
        signal: new AbortController().signal,
        videoId: 'arj7oStGLkU',
        languages: () => ({
            originalLanguage: 'en',
            targetLanguage: 'zh-CN',
            useOfficialTranslations: true,
        }),
        bridge: { connected: true, sendControl },
        config: { get: vi.fn() },
        logger: createLogger('test'),
    };
    return { adapter: new YouTubeAdapter(context), sendControl };
}

/** A player whose video is laid out `top` pixels down the viewport. */
function addPlayer(id: string, visible: boolean, top = 0): HTMLVideoElement {
    const player = document.createElement('div');
    player.id = id;
    player.className = 'html5-video-player';
    const video = document.createElement('video');
    video.className = 'video-stream html5-main-video';
    const width = visible ? 394 : 0;
    const height = visible ? 700 : 0;
    video.getBoundingClientRect = () =>
        ({
            left: 0,
            top,
            width,
            height,
            right: width,
            bottom: top + height,
        }) as DOMRect;
    player.append(video);
    document.body.append(player);
    return video;
}

afterEach(() => {
    document.body.replaceChildren();
    history.replaceState(null, '', '/');
});

describe('YouTubeAdapter', () => {
    it('binds the watch page’s player', () => {
        history.replaceState(null, '', '/watch?v=arj7oStGLkU');
        const { adapter } = setup();
        const video = addPlayer('movie_player', true);
        expect(adapter.discoverVideo()).toBe(video);
        expect(adapter.getPlayerContainer(video)?.id).toBe('movie_player');
    });

    it('binds the Short on screen, not the hidden preload player', () => {
        history.replaceState(null, '', '/shorts/xmQVy2w3FyQ');
        const { adapter } = setup();
        addPlayer('movie_player', false);
        const short = addPlayer('shorts-player', true);
        expect(adapter.discoverVideo()).toBe(short);
    });

    it('binds the Short on screen over one laid out off screen', () => {
        history.replaceState(null, '', '/shorts/xmQVy2w3FyQ');
        const { adapter } = setup();
        addPlayer('shorts-player', true, -2000);
        const onScreen = addPlayer('shorts-player', true);
        expect(adapter.discoverVideo()).toBe(onScreen);
    });

    it('keeps a lone watch player bound while the page scrolls it out of view', () => {
        history.replaceState(null, '', '/watch?v=arj7oStGLkU');
        const { adapter } = setup();
        const video = addPlayer('movie_player', true, -1500);
        expect(adapter.discoverVideo()).toBe(video);
    });

    it('binds nothing while the route’s player shows no picture', () => {
        history.replaceState(null, '', '/shorts/xmQVy2w3FyQ');
        const { adapter } = setup();
        addPlayer('shorts-player', false);
        addPlayer('movie_player', true);
        expect(adapter.discoverVideo()).toBeNull();
    });

    it('suppresses subtitles while an ad plays in the same video', () => {
        const { adapter } = setup();
        const video = addPlayer('movie_player', true);
        video.currentTime = 12;
        expect(adapter.getPlaybackTime(video)).toBe(12);
        video.parentElement!.classList.add('ad-showing');
        expect(adapter.getPlaybackTime(video)).toBeNull();
    });

    it('asks the page for tracks on connect and on a languages change, and cancels before abort', () => {
        const { adapter, sendControl } = setup();
        adapter.onBridgeConnected();
        adapter.onLanguagesChanged();
        adapter.beforeAbort();
        expect(sendControl.mock.calls).toEqual([
            [
                {
                    t: 'request-subtitle-tracks',
                    videoId: 'arj7oStGLkU',
                    languages: ['en', 'zh-CN'],
                },
            ],
            [
                {
                    t: 'request-subtitle-tracks',
                    videoId: 'arj7oStGLkU',
                    languages: ['en', 'zh-CN'],
                },
            ],
            [{ t: 'cancel-subtitle-tracks' }],
        ]);
    });

    it('turns the page’s answer into a YouTube fetch spec', () => {
        const { adapter } = setup();
        const tracks = [{ language: 'en', asr: false, url: 'https://x' }];
        expect(
            adapter.interpretSubtitleEvent({
                t: 'subtitle-data',
                platform: 'youtube',
                videoId: 'arj7oStGLkU',
                languages: ['en', 'zh-CN'],
                tracks,
            })
        ).toEqual({ kind: 'page-tracks', source: 'youtube', tracks });
    });
});
