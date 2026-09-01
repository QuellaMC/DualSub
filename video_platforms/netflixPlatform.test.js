import {
    afterEach,
    beforeEach,
    describe,
    expect,
    jest,
    test,
} from '@jest/globals';
import Logger from '../utils/logger.js';
import { configService } from '../services/configService.js';
import { SubtitleRequestSources } from '../content_scripts/shared/constants/messageActions.js';
import { NetflixPlatform } from './netflixPlatform.js';

const settings = {
    targetLanguage: 'zh-CN',
    originalLanguage: 'en',
    useNativeSubtitles: true,
    useOfficialTranslations: true,
};

function subtitleEvent(movieId, url = `https://example.test/${movieId}.vtt`) {
    return {
        type: 'SUBTITLE_DATA_FOUND',
        payload: {
            movieId,
            timedtexttracks: [
                {
                    episodeId: movieId,
                    ttDownloadables: {
                        webvtt: { urls: [{ url }] },
                    },
                },
            ],
        },
    };
}

function successfulResponse(videoId) {
    return {
        success: true,
        videoId,
        vttText: 'WEBVTT',
        targetVttText: null,
        sourceLanguage: 'en',
        targetLanguage: 'zh-CN',
        useNativeTarget: false,
        selectedLanguage: {
            normalizedCode: 'en',
            displayName: 'English',
        },
    };
}

function deferred() {
    let resolve;
    const promise = new Promise((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

function playbackVideo(playing) {
    const video = document.createElement('video');
    const state = { paused: !playing, ended: false };
    Object.defineProperties(video, {
        paused: { configurable: true, get: () => state.paused },
        ended: { configurable: true, get: () => state.ended },
        pause: {
            configurable: true,
            value: jest.fn(() => {
                state.paused = true;
            }),
        },
        play: {
            configurable: true,
            value: jest.fn(async () => {
                state.paused = false;
                state.ended = false;
            }),
        },
    });
    return { video, state };
}

describe('NetflixPlatform', () => {
    let platform;
    let routeVideoId;
    let onSubtitles;
    let onVideoChange;

    beforeEach(async () => {
        document.head.replaceChildren();
        document.body.replaceChildren();
        routeVideoId = '12345';
        onSubtitles = jest.fn();
        onVideoChange = jest.fn();
        jest.spyOn(Logger, 'create').mockReturnValue({
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            updateLevel: jest.fn(),
        });
        jest.spyOn(configService, 'get').mockResolvedValue(false);
        jest.spyOn(configService, 'getMultiple').mockResolvedValue(settings);
        jest.spyOn(configService, 'onChanged').mockReturnValue(jest.fn());

        platform = new NetflixPlatform();
        jest.spyOn(platform, 'isPlatformActive').mockReturnValue(true);
        jest.spyOn(platform, 'extractMovieIdFromUrl').mockImplementation(
            () => routeVideoId
        );
        await platform.initialize(onSubtitles, onVideoChange);
    });

    afterEach(() => {
        platform?.cleanup();
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    test('adopts only its current canonical watch route', () => {
        platform.currentVideoId = '22222';
        expect(
            platform.hasAdoptedPlayerRoute(
                'https://www.netflix.com/watch/22222'
            )
        ).toBe(true);
        expect(
            platform.hasAdoptedPlayerRoute(
                'https://www.netflix.com/watch/11111'
            )
        ).toBe(false);
        expect(
            platform.hasAdoptedPlayerRoute(
                'https://www.netflix.com/browse/watch/22222'
            )
        ).toBe(false);
    });

    test('projects a current subtitle response and sends the canonical request', async () => {
        const send = jest
            .spyOn(platform, '_sendMessageResilient')
            .mockResolvedValue(successfulResponse('12345'));

        await platform.handleInjectorEvents(subtitleEvent('12345'));

        expect(onVideoChange).toHaveBeenCalledWith('12345');
        expect(send).toHaveBeenCalledWith(
            expect.objectContaining({
                source: SubtitleRequestSources.NETFLIX,
                videoId: '12345',
                targetLanguage: 'zh-CN',
                originalLanguage: 'en',
                useNativeSubtitles: true,
            }),
            expect.objectContaining({ canDispatch: expect.any(Function) })
        );
        expect(onSubtitles).toHaveBeenCalledWith({
            vttText: 'WEBVTT',
            targetVttText: null,
            videoId: '12345',
            sourceLanguage: 'en',
            targetLanguage: 'zh-CN',
            useNativeTarget: false,
            selectedLanguage: {
                normalizedCode: 'en',
                displayName: 'English',
            },
        });
    });

    test('coalesces the same request while it is in flight', async () => {
        const response = deferred();
        const send = jest
            .spyOn(platform, '_sendMessageResilient')
            .mockReturnValue(response.promise);

        const first = platform.handleInjectorEvents(subtitleEvent('12345'));
        await Promise.resolve();
        await Promise.resolve();
        const second = platform.handleInjectorEvents(subtitleEvent('12345'));
        response.resolve(successfulResponse('12345'));
        await Promise.all([first, second]);

        expect(send).toHaveBeenCalledTimes(1);
        expect(onSubtitles).toHaveBeenCalledTimes(1);
    });

    test('permits retry when subtitle delivery fails', async () => {
        jest.spyOn(platform, '_sendMessageResilient').mockResolvedValue(
            successfulResponse('12345')
        );
        onSubtitles.mockImplementationOnce(() => {
            throw new Error('render failed');
        });

        await platform.handleInjectorEvents(subtitleEvent('12345'));
        await platform.handleInjectorEvents(subtitleEvent('12345'));

        expect(onSubtitles).toHaveBeenCalledTimes(2);
    });

    test('drops a request whose route changes before dispatch', async () => {
        const pendingSettings = deferred();
        configService.getMultiple.mockReturnValueOnce(pendingSettings.promise);
        const send = jest.spyOn(platform, '_sendMessageResilient');

        const pending = platform.handleInjectorEvents(subtitleEvent('12345'));
        routeVideoId = '67890';
        pendingSettings.resolve(settings);
        await pending;

        expect(send).not.toHaveBeenCalled();
        expect(onSubtitles).not.toHaveBeenCalled();
    });

    test('buffers an upcoming episode and revalidates it after navigation', async () => {
        const send = jest
            .spyOn(platform, '_sendMessageResilient')
            .mockResolvedValue(successfulResponse('67890'));

        await platform.handleInjectorEvents(subtitleEvent('67890'));
        expect(send).not.toHaveBeenCalled();

        routeVideoId = '67890';
        await platform.onUrlChange();

        expect(send).toHaveBeenCalledTimes(1);
        expect(onVideoChange).toHaveBeenLastCalledWith('67890');
        expect(onSubtitles).toHaveBeenCalledTimes(1);
    });

    test('rejects stale lifecycle data and responses for another video', async () => {
        const retiredGeneration = platform._lifecycleGeneration;
        await platform.initialize(onSubtitles, onVideoChange);
        const send = jest
            .spyOn(platform, '_sendMessageResilient')
            .mockResolvedValue(successfulResponse('different'));

        await platform.handleInjectorEvents(
            subtitleEvent('12345'),
            retiredGeneration
        );
        await platform.handleInjectorEvents(subtitleEvent('12345'));

        expect(send).toHaveBeenCalledTimes(1);
        expect(onSubtitles).not.toHaveBeenCalled();
    });

    test('ignores events without usable subtitle tracks', async () => {
        const send = jest.spyOn(platform, '_sendMessageResilient');

        await platform.handleInjectorEvents({
            type: 'SUBTITLE_DATA_FOUND',
            payload: { movieId: '12345', timedtexttracks: [] },
        });
        await platform.handleInjectorEvents({
            type: 'SUBTITLE_DATA_FOUND',
            payload: {
                movieId: '12345',
                timedtexttracks: [
                    {
                        isForcedNarrative: true,
                        ttDownloadables: {
                            webvtt: {
                                urls: [{ url: 'https://example.test/a.vtt' }],
                            },
                        },
                    },
                ],
            },
        });

        expect(send).not.toHaveBeenCalled();
    });

    test('pauses and resumes the current video, including replacement verification', async () => {
        const first = playbackVideo(true);
        const second = playbackVideo(false);
        document.body.appendChild(first.video);
        first.video.pause.mockImplementationOnce(() => {
            first.state.paused = true;
            first.video.replaceWith(second.video);
        });

        await expect(platform.pausePlayback()).resolves.toBe(true);
        await expect(platform.resumePlayback()).resolves.toBe(true);
        expect(first.video.pause).toHaveBeenCalledTimes(1);
        expect(second.video.play).toHaveBeenCalledTimes(1);
        expect(platform.allowsDirectMediaPlaybackFallback()).toBe(true);
    });

    test('applies native subtitle setting changes and restores on cleanup', async () => {
        let listener;
        const unsubscribe = jest.fn();
        configService.get.mockResolvedValue(true);
        configService.onChanged.mockImplementation((next) => {
            listener = next;
            return unsubscribe;
        });
        await platform.initialize(onSubtitles, onVideoChange);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        const subtitle = document.createElement('div');
        subtitle.className = 'official-subtitle';
        document.body.appendChild(subtitle);
        await platform.handleNativeSubtitlesWithSetting(['.official-subtitle']);
        expect(subtitle).toHaveAttribute('data-dualsub-hidden', 'true');

        listener({ hideOfficialSubtitles: false });
        expect(subtitle).not.toHaveAttribute('data-dualsub-hidden');
        platform.hideOfficialSubtitleContainers(['.official-subtitle']);
        platform.cleanup();
        expect(subtitle).not.toHaveAttribute('data-dualsub-hidden');
        expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    test('observes the player root and releases observer, styles, and state', () => {
        const root = document.createElement('div');
        root.className = 'watch-video';
        root.appendChild(document.createElement('video'));
        document.body.appendChild(root);
        const observer = { observe: jest.fn(), disconnect: jest.fn() };
        jest.spyOn(globalThis, 'MutationObserver').mockImplementation(
            () => observer
        );

        platform.handleNativeSubtitles();
        expect(observer.observe).toHaveBeenCalledWith(root, {
            childList: true,
            subtree: true,
        });
        expect(
            document.getElementById('dualsub-netflix-subtitle-hider')
        ).not.toBeNull();

        platform.cleanup();
        expect(observer.disconnect).toHaveBeenCalledTimes(1);
        expect(
            document.getElementById('dualsub-netflix-subtitle-hider')
        ).toBeNull();
        expect(platform.currentVideoId).toBeNull();
    });
});
