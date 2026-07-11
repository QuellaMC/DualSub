import { jest } from '@jest/globals';

import {
    attachTimeUpdateListener,
    clearSubtitleDOM,
    clearSubtitlesDisplayAndQueue,
    ensureSubtitleContainer,
    getLocalizedErrorMessage,
    handleVideoIdChange,
    originalSubtitleElement,
    processSubtitleQueue,
    setCurrentVideoId,
    setSubtitlesActive,
    subtitleQueue,
} from '../shared/subtitleUtilities.js';

const VIDEO_ID = 'seek-test-video';
const TEST_CONFIG = {
    originalLanguage: 'en',
    targetLanguage: 'zh-CN',
    subtitleTimeOffset: 0,
    translationDelay: 0,
    subtitleFontSize: 2.5,
    subtitleGap: 0,
    subtitleLayoutOrder: 'original_top',
    subtitleLayoutOrientation: 'column',
    subtitleVerticalPosition: 2.8,
};

function makeCue(original, start, end) {
    return {
        original,
        translated: null,
        start,
        end,
        videoId: VIDEO_ID,
        useNativeTarget: false,
        sourceLanguage: 'en',
        targetLanguage: 'zh-CN',
        cueType: 'original',
    };
}

function createPlaybackHarness(initialTime) {
    let playbackTime = initialTime;
    let videoId = VIDEO_ID;
    const video = document.createElement('video');

    Object.defineProperties(video, {
        currentTime: {
            configurable: true,
            get: () => playbackTime,
            set: (value) => {
                playbackTime = value;
            },
        },
        readyState: { configurable: true, value: 4 },
        HAVE_CURRENT_DATA: { configurable: true, value: 2 },
    });
    document.body.appendChild(video);

    const platform = {
        getCurrentVideoId: () => videoId,
        getPlaybackTime: () => playbackTime,
        getVideoElement: () => video,
        getPlayerContainerElement: () => document.body,
        isPlayerPageActive: () => true,
        supportsProgressBarTracking: () => false,
    };

    return {
        platform,
        video,
        seekTo(time) {
            playbackTime = time;
            video.dispatchEvent(new Event('seeked'));
        },
        setVideoId(nextVideoId) {
            videoId = nextVideoId;
        },
    };
}

function translationResponse(message) {
    return {
        translatedText: `translated:${message.text}`,
        originalText: message.text,
        cueStart: message.cueStart,
        cueVideoId: message.cueVideoId,
    };
}

async function waitForCondition(predicate, timeoutMs = 500) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error('Timed out waiting for subtitle queue condition');
}

describe('seek-aware subtitle translation scheduling', () => {
    beforeEach(() => {
        document.body.replaceChildren();
        clearSubtitleDOM();
        setSubtitlesActive(true);
        setCurrentVideoId(VIDEO_ID);
        clearSubtitlesDisplayAndQueue(null, true);
    });

    afterEach(() => {
        clearSubtitleDOM();
        clearSubtitlesDisplayAndQueue(null, true);
        document.body.replaceChildren();
        jest.useRealTimers();
    });

    test('wakes the existing queue when playback seeks behind the late-start position', async () => {
        const { platform, video, seekTo } = createPlaybackHarness(100);
        subtitleQueue.push(
            makeCue('early cue', 10, 12),
            makeCue('current cue', 100, 102),
            makeCue('near-future cue', 110, 112)
        );

        chrome.runtime.sendMessage = jest.fn((message, callback) => {
            const response = translationResponse(message);
            callback(response);
            return Promise.resolve(response);
        });

        attachTimeUpdateListener(video, platform, TEST_CONFIG, 'QueueTest');
        await processSubtitleQueue(platform, TEST_CONFIG, 'QueueTest');

        expect(
            subtitleQueue.find((cue) => cue.original === 'early cue').translated
        ).toBeNull();

        seekTo(10.5);

        await waitForCondition(
            () =>
                subtitleQueue.find((cue) => cue.original === 'early cue')
                    .translated !== null
        );
        expect(
            subtitleQueue.find((cue) => cue.original === 'early cue').translated
        ).toBe('translated:early cue');
    });

    test('rebinds playback events to the current platform after an SPA video replacement', () => {
        const firstPlayback = createPlaybackHarness(10);
        firstPlayback.setVideoId('first-video');
        setCurrentVideoId('first-video');
        subtitleQueue.push({
            ...makeCue('first cue', 10, 12),
            translated: 'translated:first cue',
            videoId: 'first-video',
        });

        ensureSubtitleContainer(
            firstPlayback.platform,
            TEST_CONFIG,
            'QueueTest'
        );
        firstPlayback.video.dispatchEvent(new Event('timeupdate'));
        expect(originalSubtitleElement.textContent).toContain('first cue');

        firstPlayback.video.remove();
        const nextPlayback = createPlaybackHarness(100);
        nextPlayback.setVideoId('next-video');
        handleVideoIdChange('next-video', 'QueueTest');
        subtitleQueue.push({
            ...makeCue('next cue', 100, 102),
            translated: 'translated:next cue',
            videoId: 'next-video',
        });

        ensureSubtitleContainer(
            nextPlayback.platform,
            TEST_CONFIG,
            'QueueTest'
        );
        nextPlayback.video.dispatchEvent(new Event('timeupdate'));

        expect(originalSubtitleElement.textContent).toContain('next cue');

        firstPlayback.video.dispatchEvent(new Event('timeupdate'));
        expect(originalSubtitleElement.textContent).toContain('next cue');
    });

    test('rebinds playback events when SPA navigation reuses the same video element with a new platform', () => {
        const playback = createPlaybackHarness(10);
        playback.setVideoId('first-video');
        setCurrentVideoId('first-video');
        subtitleQueue.push({
            ...makeCue('first cue', 10, 12),
            translated: 'translated:first cue',
            videoId: 'first-video',
        });

        ensureSubtitleContainer(playback.platform, TEST_CONFIG, 'QueueTest');
        playback.video.dispatchEvent(new Event('timeupdate'));
        expect(originalSubtitleElement.textContent).toContain('first cue');

        playback.setVideoId(null);
        const nextPlaybackTime = 100;
        const nextPlatform = {
            ...playback.platform,
            getCurrentVideoId: () => 'next-video',
            getPlaybackTime: () => nextPlaybackTime,
            getVideoElement: () => playback.video,
        };
        handleVideoIdChange('next-video', 'QueueTest');
        subtitleQueue.push({
            ...makeCue('same-node next cue', 100, 102),
            translated: 'translated:same-node next cue',
            videoId: 'next-video',
        });

        ensureSubtitleContainer(nextPlatform, TEST_CONFIG, 'QueueTest');
        playback.video.dispatchEvent(new Event('timeupdate'));

        expect(originalSubtitleElement.textContent).toContain(
            'same-node next cue'
        );
    });

    test('does not clear a rendered cue for a duplicate video ID notification', () => {
        const { platform, video } = createPlaybackHarness(10);
        subtitleQueue.push({
            ...makeCue('stable cue', 10, 12),
            translated: 'translated:stable cue',
        });

        ensureSubtitleContainer(platform, TEST_CONFIG, 'QueueTest');
        video.dispatchEvent(new Event('timeupdate'));
        expect(originalSubtitleElement.textContent).toContain('stable cue');

        handleVideoIdChange(VIDEO_ID, 'QueueTest');

        expect(originalSubtitleElement.textContent).toContain('stable cue');
    });

    test('does not let an old video translation completion clear the SPA replacement cue', async () => {
        const firstPlayback = createPlaybackHarness(10);
        firstPlayback.setVideoId('first-video');
        setCurrentVideoId('first-video');
        subtitleQueue.push({
            ...makeCue('old pending cue', 10, 12),
            videoId: 'first-video',
        });

        let releaseOldTranslation;
        chrome.runtime.sendMessage = jest.fn((message, callback) => {
            releaseOldTranslation = () =>
                callback({
                    ...translationResponse(message),
                    cueVideoId: 'first-video',
                });
        });

        const oldQueueRun = processSubtitleQueue(
            firstPlayback.platform,
            TEST_CONFIG,
            'QueueTest'
        );
        await waitForCondition(() => releaseOldTranslation !== undefined);

        firstPlayback.setVideoId(null);
        firstPlayback.video.remove();
        const nextPlayback = createPlaybackHarness(100);
        nextPlayback.setVideoId('next-video');
        handleVideoIdChange('next-video', 'QueueTest');
        subtitleQueue.push({
            ...makeCue('next stable cue', 100, 102),
            translated: 'translated:next stable cue',
            videoId: 'next-video',
        });

        ensureSubtitleContainer(
            nextPlayback.platform,
            TEST_CONFIG,
            'QueueTest'
        );
        nextPlayback.video.dispatchEvent(new Event('timeupdate'));
        expect(originalSubtitleElement.textContent).toContain(
            'next stable cue'
        );

        releaseOldTranslation();
        await oldQueueRun;

        expect(originalSubtitleElement.textContent).toContain(
            'next stable cue'
        );
    });

    test('preserves a seek wake that arrives while a translation request is in flight', async () => {
        const { platform, video, seekTo } = createPlaybackHarness(100);
        subtitleQueue.push(
            makeCue('early cue', 10, 12),
            makeCue('current cue', 100, 102),
            makeCue('near-future cue 1', 105, 107),
            makeCue('near-future cue 2', 110, 112)
        );

        const requestedTexts = [];
        let releaseFirstRequest = null;
        chrome.runtime.sendMessage = jest.fn((message, callback) => {
            requestedTexts.push(message.text);
            const respond = () => callback(translationResponse(message));
            if (requestedTexts.length === 1) {
                releaseFirstRequest = respond;
            } else {
                respond();
            }
        });

        attachTimeUpdateListener(video, platform, TEST_CONFIG, 'QueueTest');
        const initialRun = processSubtitleQueue(
            platform,
            TEST_CONFIG,
            'QueueTest'
        );
        await waitForCondition(() => releaseFirstRequest !== null);

        seekTo(10.5);
        releaseFirstRequest();
        await initialRun;

        await waitForCondition(() => requestedTexts.includes('early cue'));
        expect(requestedTexts.slice(0, 2)).toEqual([
            'current cue',
            'early cue',
        ]);
    });

    test('prefetches a bounded playback window instead of translating the rest of the episode', async () => {
        const { platform } = createPlaybackHarness(100);
        subtitleQueue.push(
            makeCue('current cue', 100, 102),
            makeCue('near-future cue', 110, 112),
            makeCue('far-future cue', 1000, 1002)
        );

        chrome.runtime.sendMessage = jest.fn((message, callback) => {
            const response = translationResponse(message);
            callback(response);
            return Promise.resolve(response);
        });

        await processSubtitleQueue(platform, TEST_CONFIG, 'QueueTest');

        expect(
            subtitleQueue.find((cue) => cue.original === 'current cue')
                .translated
        ).toBe('translated:current cue');
        expect(
            subtitleQueue.find((cue) => cue.original === 'near-future cue')
                .translated
        ).toBe('translated:near-future cue');
        expect(
            subtitleQueue.find((cue) => cue.original === 'far-future cue')
                .translated
        ).toBeNull();
    });

    test('recovers a transient cue failure on a scheduled retry while playback is paused', async () => {
        jest.useFakeTimers();
        const { platform } = createPlaybackHarness(100);
        subtitleQueue.push(makeCue('current cue', 100, 102));

        let requestCount = 0;
        chrome.runtime.sendMessage = jest.fn((message, callback) => {
            requestCount++;
            if (requestCount === 1) {
                callback({ error: 'temporary provider failure' });
            } else {
                callback(translationResponse(message));
            }
        });

        await processSubtitleQueue(platform, TEST_CONFIG, 'QueueTest');

        expect(subtitleQueue[0].translated).toBeNull();
        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(500);

        expect(subtitleQueue[0].translated).toBe('translated:current cue');
        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(2);
    });

    test('stores a terminal cue error after bounded retry exhaustion without provider spam', async () => {
        jest.useFakeTimers();
        const { platform } = createPlaybackHarness(100);
        subtitleQueue.push(makeCue('current cue', 100, 102));

        chrome.runtime.sendMessage = jest.fn((_message, callback) => {
            callback({ error: 'persistent provider failure' });
        });

        await processSubtitleQueue(platform, TEST_CONFIG, 'QueueTest');
        expect(subtitleQueue[0].translated).toBeNull();

        await jest.advanceTimersByTimeAsync(500);

        expect(subtitleQueue[0].translated).toBe(
            getLocalizedErrorMessage('TRANSLATION_REQUEST_ERROR')
        );
        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(2);

        await jest.advanceTimersByTimeAsync(10_000);
        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(2);
    });

    test('stops a static batch after the video context changes', async () => {
        const { platform, setVideoId } = createPlaybackHarness(100);
        subtitleQueue.push(
            makeCue('current cue', 100, 102),
            makeCue('near-future cue 1', 105, 107),
            makeCue('near-future cue 2', 110, 112)
        );

        const requestedTexts = [];
        let releaseFirstRequest = null;
        chrome.runtime.sendMessage = jest.fn((message, callback) => {
            requestedTexts.push(message.text);
            const respond = () => callback(translationResponse(message));
            if (requestedTexts.length === 1) releaseFirstRequest = respond;
            else respond();
        });

        const initialRun = processSubtitleQueue(
            platform,
            TEST_CONFIG,
            'QueueTest'
        );
        await waitForCondition(() => releaseFirstRequest !== null);

        setVideoId('next-video');
        handleVideoIdChange('next-video', 'QueueTest');
        releaseFirstRequest();
        await initialRun;
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(requestedTexts).toEqual(['current cue']);
    });

    test('stops a static batch when subtitles are disabled and its queue is cleared', async () => {
        const { platform } = createPlaybackHarness(100);
        subtitleQueue.push(
            makeCue('current cue', 100, 102),
            makeCue('near-future cue 1', 105, 107),
            makeCue('near-future cue 2', 110, 112)
        );

        const requestedTexts = [];
        let releaseFirstRequest = null;
        chrome.runtime.sendMessage = jest.fn((message, callback) => {
            requestedTexts.push(message.text);
            const respond = () => callback(translationResponse(message));
            if (requestedTexts.length === 1) releaseFirstRequest = respond;
            else respond();
        });

        const initialRun = processSubtitleQueue(
            platform,
            TEST_CONFIG,
            'QueueTest'
        );
        await waitForCondition(() => releaseFirstRequest !== null);

        setSubtitlesActive(false);
        clearSubtitlesDisplayAndQueue(null, true, 'QueueTest');
        releaseFirstRequest();
        await initialRun;
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(requestedTexts).toEqual(['current cue']);
    });
});
