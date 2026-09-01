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
import { DisneyPlusPlatform } from './disneyPlusPlatform.js';

function response(videoId = '12345') {
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

function subtitleEvent(videoId, url = 'https://example.test/master.m3u8') {
    return { type: 'SUBTITLE_URL_FOUND', videoId, url };
}

function timelineEvent({
    videoId = '12345',
    programTimeSeconds = 100,
    sequence = 1,
    playbackSessionId = 'session-a',
    isInterstitialPlaying = false,
} = {}) {
    return {
        type: 'PLAYBACK_TIMELINE_UPDATE',
        videoId,
        programTimeSeconds,
        sequence,
        playbackSessionId,
        isInterstitialPlaying,
    };
}

function createVideo({
    currentTime = 0,
    paused = true,
    ended = false,
    readyState = 4,
    width = 1000,
    height = 600,
    currentSrc = 'blob:video',
} = {}) {
    const video = document.createElement('video');
    const state = {
        currentTime,
        paused,
        ended,
        readyState,
        currentSrc,
    };
    for (const key of Object.keys(state)) {
        Object.defineProperty(video, key, {
            configurable: true,
            get: () => state[key],
        });
    }
    video.getBoundingClientRect = jest.fn(() => ({
        width,
        height,
        top: 0,
        left: 0,
        right: width,
        bottom: height,
    }));
    return { video, state };
}

function mountTimeline(value) {
    const overlay = document.createElement('main-app-controls-overlay');
    const overlayRoot = overlay.attachShadow({ mode: 'open' });
    const progress = document.createElement('progress-bar');
    const progressRoot = progress.attachShadow({ mode: 'open' });
    const timeline = document.createElement('div');
    timeline.className = 'progress-bar__seekable-range';
    timeline.setAttribute('role', 'slider');
    timeline.setAttribute('aria-valuenow', String(value));
    progressRoot.appendChild(timeline);
    overlayRoot.appendChild(progress);
    document.body.appendChild(overlay);
    return { overlay, overlayRoot, timeline };
}

function mountPlaybackController(videoState) {
    const player = document.createElement('disney-web-player-ui');
    const playerRoot = player.attachShadow({ mode: 'open' });
    const toggle = document.createElement('toggle-play-pause');
    const toggleRoot = toggle.attachShadow({ mode: 'open' });
    const button = document.createElement('button');
    button.addEventListener('click', () => {
        videoState.paused = !videoState.paused;
        if (!videoState.paused) videoState.ended = false;
    });
    toggleRoot.appendChild(button);
    playerRoot.appendChild(toggle);
    document.body.appendChild(player);
    return button;
}

describe('DisneyPlusPlatform', () => {
    let platform;
    let routeVideoId;
    let onSubtitles;
    let onVideoChange;
    let dispatchControl;

    beforeEach(async () => {
        document.head.replaceChildren();
        document.body.replaceChildren();
        routeVideoId = '12345';
        onSubtitles = jest.fn();
        onVideoChange = jest.fn();
        dispatchControl = jest.fn(() => true);
        jest.spyOn(Logger, 'create').mockReturnValue({
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            updateLevel: jest.fn(),
        });
        jest.spyOn(configService, 'get').mockResolvedValue(false);
        jest.spyOn(configService, 'getMultiple').mockResolvedValue({
            targetLanguage: 'zh-CN',
            originalLanguage: 'en',
        });
        jest.spyOn(configService, 'onChanged').mockReturnValue(jest.fn());

        platform = new DisneyPlusPlatform();
        jest.spyOn(platform, 'isPlatformActive').mockReturnValue(true);
        jest.spyOn(
            platform,
            'extractVideoIdFromCurrentRoute'
        ).mockImplementation(() => routeVideoId);
        await platform.initialize(onSubtitles, onVideoChange, dispatchControl);
    });

    afterEach(() => {
        platform?.cleanup();
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    test('starts and stops the page playback bridge', () => {
        expect(dispatchControl.mock.calls.slice(0, 2)).toEqual([
            ['PLAYBACK_BRIDGE_RESUME'],
            ['REQUEST_PLAYBACK_TIMELINE'],
        ]);

        platform.prepareForInjectionChannelRevocation();
        platform.cleanup();

        expect(dispatchControl).toHaveBeenCalledWith('PLAYBACK_BRIDGE_PAUSE');
        expect(
            dispatchControl.mock.calls.filter(
                ([type]) => type === 'PLAYBACK_BRIDGE_PAUSE'
            )
        ).toHaveLength(1);
    });

    test('adopts only its current canonical player route', () => {
        platform.currentVideoId = '22222';
        expect(
            platform.hasAdoptedPlayerRoute(
                'https://www.disneyplus.com/play/22222'
            )
        ).toBe(true);
        expect(
            platform.hasAdoptedPlayerRoute(
                'https://www.disneyplus.com/play/11111'
            )
        ).toBe(false);
    });

    test('projects a current subtitle response and sends the canonical request', async () => {
        const send = jest
            .spyOn(platform, '_sendMessageResilient')
            .mockResolvedValue(response());

        await platform.handleInjectorEvents(subtitleEvent('12345'));

        expect(onVideoChange).toHaveBeenCalledWith('12345');
        expect(send).toHaveBeenCalledWith(
            expect.objectContaining({
                source: SubtitleRequestSources.DISNEY_PLUS,
                videoId: '12345',
                url: 'https://example.test/master.m3u8',
                targetLanguage: 'zh-CN',
                originalLanguage: 'en',
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

    test('rejects mismatched routes, stale lifecycles, and response identities', async () => {
        const retiredGeneration = platform._lifecycleGeneration;
        await platform.initialize(onSubtitles, onVideoChange, dispatchControl);
        const send = jest
            .spyOn(platform, '_sendMessageResilient')
            .mockResolvedValue(response('different'));

        await platform.handleInjectorEvents(subtitleEvent('99999'));
        await platform.handleInjectorEvents(
            subtitleEvent('12345'),
            retiredGeneration
        );
        await platform.handleInjectorEvents(subtitleEvent('12345'));

        expect(send).toHaveBeenCalledTimes(1);
        expect(onSubtitles).not.toHaveBeenCalled();
    });

    test('drops a deferred request after player navigation and then permits the new route', async () => {
        let resolveSettings;
        configService.getMultiple.mockReturnValueOnce(
            new Promise((resolve) => {
                resolveSettings = resolve;
            })
        );
        const send = jest
            .spyOn(platform, '_sendMessageResilient')
            .mockResolvedValue(response('67890'));

        const oldRequest = platform.handleInjectorEvents(
            subtitleEvent('12345')
        );
        routeVideoId = '67890';
        resolveSettings({ targetLanguage: 'zh-CN', originalLanguage: 'en' });
        await oldRequest;
        await platform.handleInjectorEvents(subtitleEvent('67890'));

        expect(send).toHaveBeenCalledTimes(1);
        expect(onSubtitles).toHaveBeenCalledTimes(1);
    });

    test('selects the visible ready player video', () => {
        const dormant = createVideo({
            readyState: 0,
            width: 0,
            height: 0,
            currentSrc: '',
        });
        const active = createVideo({ currentTime: 20, paused: false });
        document.body.append(dormant.video, active.video);

        expect(platform.getVideoElement()).toBe(active.video);
    });

    test('anchors program time to the continuously advancing media clock', () => {
        const { video, state } = createVideo({ currentTime: 10 });
        document.body.appendChild(video);
        platform.currentVideoId = '12345';

        platform.handleInjectorEvents(
            timelineEvent({ programTimeSeconds: 100 })
        );
        state.currentTime = 14;

        expect(platform.getPlaybackTime()).toBe(104);
    });

    test('suppresses subtitles only while the bridge reports an interstitial', () => {
        const { video, state } = createVideo({ currentTime: 10 });
        document.body.appendChild(video);
        platform.currentVideoId = '12345';
        platform.handleInjectorEvents(
            timelineEvent({
                programTimeSeconds: 100,
                isInterstitialPlaying: true,
            })
        );
        expect(platform.getPlaybackTime()).toBeNull();

        state.currentTime = 11;
        platform.handleInjectorEvents(
            timelineEvent({
                programTimeSeconds: 101,
                sequence: 2,
                isInterstitialPlaying: false,
            })
        );
        expect(platform.getPlaybackTime()).toBe(101);
    });

    test('rejects old sequence and playback-session samples after navigation', async () => {
        const { video, state } = createVideo({ currentTime: 10 });
        document.body.appendChild(video);
        platform.currentVideoId = '12345';
        platform.handleInjectorEvents(
            timelineEvent({ programTimeSeconds: 100, sequence: 5 })
        );
        platform.handleInjectorEvents(
            timelineEvent({ programTimeSeconds: 500, sequence: 4 })
        );
        expect(platform.getPlaybackTime()).toBe(100);

        jest.spyOn(platform, '_sendMessageResilient').mockResolvedValue(
            response('67890')
        );
        routeVideoId = '67890';
        await platform.handleInjectorEvents(subtitleEvent('67890'));
        state.currentTime = 20;
        platform.handleInjectorEvents(
            timelineEvent({
                videoId: '67890',
                programTimeSeconds: 500,
                sequence: 6,
                playbackSessionId: 'session-a',
            })
        );
        expect(platform.getPlaybackTime()).toBe(20);

        platform.handleInjectorEvents(
            timelineEvent({
                videoId: '67890',
                programTimeSeconds: 200,
                sequence: 7,
                playbackSessionId: 'session-b',
            })
        );
        expect(platform.getPlaybackTime()).toBe(200);
    });

    test('uses the semantic timeline until a seek requests a fresh bridge sample', () => {
        const { video } = createVideo({ currentTime: 10 });
        document.body.appendChild(video);
        mountTimeline(50);
        platform.currentVideoId = '12345';

        expect(platform.getPlaybackTime()).toBe(50);
        platform.invalidatePlaybackClockCalibration();
        expect(platform.getPlaybackTime()).toBe(10);
        expect(dispatchControl).toHaveBeenCalledWith(
            'REQUEST_PLAYBACK_TIMELINE'
        );
    });

    test('pauses and resumes through the Disney controller', async () => {
        jest.useFakeTimers();
        const { video, state } = createVideo({ paused: false });
        document.body.appendChild(video);
        const button = mountPlaybackController(state);

        const pause = platform.pausePlayback();
        await jest.advanceTimersByTimeAsync(160);
        await expect(pause).resolves.toBe(true);
        const resume = platform.resumePlayback();
        await jest.advanceTimersByTimeAsync(160);
        await expect(resume).resolves.toBe(true);

        expect(button.click).toBeDefined();
        expect(platform.allowsDirectMediaPlaybackFallback()).toBe(false);
    });

    test('fails closed when the Disney playback controller is absent', async () => {
        const { video } = createVideo({ paused: false });
        document.body.appendChild(video);
        await expect(platform.pausePlayback()).resolves.toBe(false);
    });

    test('observes scoped player roots and releases observer, styles, and state', () => {
        const player = document.createElement('div');
        const { video } = createVideo();
        player.appendChild(video);
        document.body.appendChild(player);
        const { overlayRoot } = mountTimeline(10);
        const observer = { observe: jest.fn(), disconnect: jest.fn() };
        jest.spyOn(globalThis, 'MutationObserver').mockImplementation(
            () => observer
        );

        platform.handleNativeSubtitles();

        expect(observer.observe).toHaveBeenCalledWith(player, {
            childList: true,
            subtree: true,
        });
        expect(observer.observe).toHaveBeenCalledWith(overlayRoot, {
            childList: true,
            subtree: true,
        });
        expect(
            document.getElementById('dualsub-disneyplus-subtitle-hider')
        ).not.toBeNull();

        platform.cleanup();
        expect(observer.disconnect).toHaveBeenCalledTimes(1);
        expect(
            document.getElementById('dualsub-disneyplus-subtitle-hider')
        ).toBeNull();
        expect(platform.currentVideoId).toBeNull();
    });
});
