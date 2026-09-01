import { jest } from '@jest/globals';

import {
    beginSubtitleStatePublisher,
    clearSubtitleDOM,
    clearSubtitlesDisplayAndQueue,
    ensureSubtitleContainer,
    finalizeExpiredSubtitleIfNeeded,
    initializeInteractiveSubtitleFeatures,
    originalSubtitleElement,
    setCurrentVideoId,
    setSubtitlesActive,
    subtitleQueue,
    updateSubtitles,
} from '../../shared/subtitleUtilities.js';

const CONFIG = {
    originalLanguage: 'en',
    targetLanguage: 'es',
    sourceLanguage: 'en',
    subtitleTimeOffset: 0,
    translationDelay: 0,
    subtitleFontSize: 2.5,
    subtitleGap: 0,
    subtitleLayoutOrder: 'original_top',
    subtitleLayoutOrientation: 'column',
    subtitleVerticalPosition: 2.8,
};

let publisherCleanup;
let formatterCleanup;

function createPlayback(videoId = 'video-1') {
    let currentVideoId = videoId;
    let playbackTime = 1;
    const video = document.createElement('video');
    document.body.appendChild(video);
    return {
        platform: {
            getCurrentVideoId: () => currentVideoId,
            getPlaybackTime: () => playbackTime,
            getVideoElement: () => video,
            getPlayerContainerElement: () => document.body,
            isPlayerPageActive: () => true,
            supportsProgressBarTracking: () => false,
        },
        setVideoId(value) {
            currentVideoId = value;
        },
        setPlaybackTime(value) {
            playbackTime = value;
        },
    };
}

function queueCue(videoId, text, { end = 10 } = {}) {
    subtitleQueue.push({
        original: text,
        translated: null,
        start: 0,
        end,
        videoId,
        useNativeTarget: false,
        sourceLanguage: 'en',
        targetLanguage: 'es',
        cueType: 'original',
    });
}

function render(playback, text = 'hello world', options) {
    subtitleQueue.splice(0);
    ensureSubtitleContainer(playback.platform, CONFIG, 'PublisherTest');
    queueCue(playback.platform.getCurrentVideoId(), text, options);
    updateSubtitles(1, playback.platform, CONFIG, 'PublisherTest');
}

function expectState(payload, expected) {
    expect(payload).toEqual({
        renderRevision: expect.any(Number),
        ...expected,
    });
    expect(payload.renderRevision).toBeGreaterThan(0);
    expect(Object.isFrozen(payload)).toBe(true);
}

describe('subtitle state publisher', () => {
    beforeAll(async () => {
        formatterCleanup = await initializeInteractiveSubtitleFeatures({
            sourceLanguage: 'en',
            targetLanguage: 'es',
        });
    });

    afterAll(() => formatterCleanup?.());

    beforeEach(() => {
        publisherCleanup?.();
        publisherCleanup = null;
        clearSubtitlesDisplayAndQueue(null, true);
        clearSubtitleDOM();
        document.body.replaceChildren();
        setSubtitlesActive(true);
        setCurrentVideoId(null);
    });

    afterEach(() => {
        publisherCleanup?.();
        publisherCleanup = null;
        clearSubtitlesDisplayAndQueue(null, true);
        clearSubtitleDOM();
        document.body.replaceChildren();
        jest.restoreAllMocks();
    });

    test('publishes and stamps each rendered original subtitle', () => {
        const publish = jest.fn();
        publisherCleanup = beginSubtitleStatePublisher({
            publishSubtitleState: publish,
        });
        const playback = createPlayback();

        render(playback);

        expect(publish).toHaveBeenCalledTimes(1);
        const state = publish.mock.calls[0][0];
        expectState(state, {
            reason: 'render',
            videoId: 'video-1',
            text: 'hello world',
        });
        const revision = String(state.renderRevision);
        expect(originalSubtitleElement).toHaveAttribute(
            'data-render-revision',
            revision
        );
        const words = originalSubtitleElement.querySelectorAll(
            '.dualsub-interactive-word'
        );
        expect(words).toHaveLength(2);
        expect(
            [...words].every(
                (word) => word.getAttribute('data-render-revision') === revision
            )
        ).toBe(true);
    });

    test('does not republish an unchanged render and repairs a stale stamp once', () => {
        const publish = jest.fn();
        publisherCleanup = beginSubtitleStatePublisher({
            publishSubtitleState: publish,
        });
        const playback = createPlayback();
        render(playback);
        const firstRevision = publish.mock.calls[0][0].renderRevision;
        publish.mockClear();

        updateSubtitles(1, playback.platform, CONFIG, 'PublisherTest');
        expect(publish).not.toHaveBeenCalled();

        originalSubtitleElement.removeAttribute('data-render-revision');
        updateSubtitles(1, playback.platform, CONFIG, 'PublisherTest');

        expect(publish).toHaveBeenCalledTimes(1);
        expectState(publish.mock.calls[0][0], {
            reason: 'refresh',
            videoId: 'video-1',
            text: 'hello world',
        });
        expect(publish.mock.calls[0][0].renderRevision).toBeGreaterThan(
            firstRevision
        );
    });

    test('distinguishes cue expiry from an explicit full clear', () => {
        const publish = jest.fn();
        publisherCleanup = beginSubtitleStatePublisher({
            publishSubtitleState: publish,
        });
        const playback = createPlayback();
        render(playback, 'short cue', { end: 2 });
        publish.mockClear();

        playback.setPlaybackTime(3);
        expect(finalizeExpiredSubtitleIfNeeded(0.1, playback.platform)).toBe(
            true
        );
        expectState(publish.mock.calls[0][0], {
            reason: 'expired',
            videoId: 'video-1',
            text: '',
        });

        render(playback, 'next cue');
        publish.mockClear();
        clearSubtitlesDisplayAndQueue(playback.platform, true);
        expectState(publish.mock.calls[0][0], {
            reason: 'clear',
            videoId: null,
            text: '',
        });
        expect(originalSubtitleElement).not.toHaveAttribute(
            'data-render-revision'
        );
    });

    test('commits navigation clear before rendering the next video', () => {
        const publish = jest.fn();
        publisherCleanup = beginSubtitleStatePublisher({
            publishSubtitleState: publish,
        });
        const playback = createPlayback();
        render(playback, 'old video');
        publish.mockClear();
        const originalUrl = window.location.href;
        history.pushState({}, '', '/next-video');
        playback.setVideoId('video-2');
        subtitleQueue.splice(0);
        queueCue('video-2', 'new video');

        try {
            updateSubtitles(1, playback.platform, CONFIG, 'PublisherTest');
        } finally {
            history.replaceState({}, '', originalUrl);
        }

        expect(publish.mock.calls.map(([state]) => state.reason)).toEqual([
            'clear',
            'render',
        ]);
        expect(publish.mock.calls[1][0]).toMatchObject({
            videoId: 'video-2',
            text: 'new video',
        });
    });

    test('replacement publisher owns refresh and old cleanup cannot revoke it', () => {
        const first = jest.fn();
        const second = jest.fn();
        const firstCleanup = beginSubtitleStatePublisher({
            publishSubtitleState: first,
        });
        const playback = createPlayback();
        render(playback, 'lifecycle state');

        publisherCleanup = beginSubtitleStatePublisher({
            publishSubtitleState: second,
        });
        firstCleanup();
        updateSubtitles(1, playback.platform, CONFIG, 'PublisherTest');

        expect(first).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledTimes(1);
        expect(second.mock.calls[0][0].reason).toBe('refresh');

        publisherCleanup();
        publisherCleanup = null;
        originalSubtitleElement.removeAttribute('data-render-revision');
        updateSubtitles(1, playback.platform, CONFIG, 'PublisherTest');
        expect(second).toHaveBeenCalledTimes(1);
    });

    test('publisher failure is isolated and invalid text revokes private state', () => {
        const publish = jest.fn(() => {
            throw new Error('publisher failed');
        });
        publisherCleanup = beginSubtitleStatePublisher({
            publishSubtitleState: publish,
        });
        const playback = createPlayback();

        expect(() => render(playback, 'valid text')).not.toThrow();
        expect(publish).toHaveBeenCalledTimes(1);
        publisherCleanup();

        const invalidPublish = jest.fn();
        publisherCleanup = beginSubtitleStatePublisher({
            publishSubtitleState: invalidPublish,
        });
        clearSubtitlesDisplayAndQueue(null, true);
        clearSubtitleDOM();
        const invalidText = 'x'.repeat(4_097);
        render(playback, invalidText);

        expect(invalidPublish).toHaveBeenCalledTimes(1);
        expectState(invalidPublish.mock.calls[0][0], {
            reason: 'clear',
            videoId: null,
            text: '',
        });
        expect(originalSubtitleElement.textContent).toBe(invalidText);
        expect(originalSubtitleElement).not.toHaveAttribute(
            'data-render-revision'
        );
    });
});
