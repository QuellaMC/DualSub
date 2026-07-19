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
    translatedSubtitleElement,
} from '../shared/subtitleUtilities.js';
import {
    buildTranslationFailureResponse,
    buildTranslationSuccessResponse,
} from '../shared/protocol/messageProtocol.js';

const VIDEO_ID = 'seek-test-video';
const NO_RECEIVER_MESSAGE =
    'Could not establish connection. Receiving end does not exist.';
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

function createFramePlaybackHarness(initialTime) {
    const playback = createPlaybackHarness(initialTime);
    const pendingCallbacks = new Map();
    let nextCallbackId = 1;

    const requestVideoFrameCallback = jest.fn((callback) => {
        const callbackId = nextCallbackId++;
        pendingCallbacks.set(callbackId, callback);
        return callbackId;
    });
    const cancelVideoFrameCallback = jest.fn((callbackId) => {
        pendingCallbacks.delete(callbackId);
    });
    Object.defineProperties(playback.video, {
        requestVideoFrameCallback: {
            configurable: true,
            value: requestVideoFrameCallback,
        },
        cancelVideoFrameCallback: {
            configurable: true,
            value: cancelVideoFrameCallback,
        },
    });

    return {
        ...playback,
        cancelVideoFrameCallback,
        getFrameCallback(callbackId) {
            return pendingCallbacks.get(callbackId);
        },
        getPendingFrameCallbackIds() {
            return Array.from(pendingCallbacks.keys());
        },
        requestVideoFrameCallback,
        runFrame(
            callbackId,
            metadata = { mediaTime: playback.video.currentTime }
        ) {
            const callback = pendingCallbacks.get(callbackId);
            if (!callback) {
                throw new Error(`No pending frame callback ${callbackId}`);
            }
            pendingCallbacks.delete(callbackId);
            callback(0, metadata);
        },
    };
}

function makeReadyNativeCuePair(original, translated, start, end) {
    return [
        {
            ...makeCue(original, start, end),
            useNativeTarget: true,
        },
        {
            ...makeCue(null, start, end),
            translated,
            useNativeTarget: true,
            cueType: 'target',
        },
    ];
}

function translationResponse(message) {
    return buildTranslationSuccessResponse(message, {
        translatedText: `translated:${message.text}`,
        cached: false,
        processingTime: 0,
    });
}

function translationFailureResponse(message, retryable = false) {
    return buildTranslationFailureResponse(message, {
        retryable,
        retryAfter: retryable ? 500 : null,
    });
}

function rejectCallbackAsNonDelivery(callback) {
    chrome.runtime.lastError = new Error(NO_RECEIVER_MESSAGE);
    callback(undefined);
    delete chrome.runtime.lastError;
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

    test('dispatches one exact frozen request and commits an exact protocol success', async () => {
        const { platform } = createPlaybackHarness(100);
        const cue = makeCue('current cue', 100, 102);
        subtitleQueue.push(cue);
        let dispatchedRequest = null;

        chrome.runtime.sendMessage = jest.fn((message, callback) => {
            dispatchedRequest = message;
            callback(translationResponse(message));
        });

        await processSubtitleQueue(platform, TEST_CONFIG, 'QueueTest');

        expect(dispatchedRequest).toEqual({
            action: 'translate',
            text: 'current cue',
            targetLang: 'zh-CN',
            cueStart: 100,
            cueVideoId: VIDEO_ID,
        });
        expect(Object.keys(dispatchedRequest)).toEqual([
            'action',
            'text',
            'targetLang',
            'cueStart',
            'cueVideoId',
        ]);
        expect(Object.isFrozen(dispatchedRequest)).toBe(true);
        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
        expect(cue.translated).toBe('translated:current cue');
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

    test('renders ready native cues on the first presented frame after their start', () => {
        const playback = createFramePlaybackHarness(0.999);
        subtitleQueue.push(
            ...makeReadyNativeCuePair('frame original', 'frame target', 1, 2)
        );

        ensureSubtitleContainer(playback.platform, TEST_CONFIG, 'QueueTest');
        expect(originalSubtitleElement.textContent).toBe('');
        expect(translatedSubtitleElement.textContent).toBe('');

        playback.video.currentTime = 1.05;
        const [callbackId] = playback.getPendingFrameCallbackIds();
        playback.runFrame(callbackId);

        expect(originalSubtitleElement.textContent).toContain('frame original');
        expect(translatedSubtitleElement.textContent).toContain('frame target');
    });

    test('uses the platform playback clock instead of frame callback metadata', () => {
        const playback = createFramePlaybackHarness(1.05);
        subtitleQueue.push(
            ...makeReadyNativeCuePair(
                'platform clock original',
                'platform clock target',
                1,
                2
            )
        );
        ensureSubtitleContainer(playback.platform, TEST_CONFIG, 'QueueTest');
        const [callbackId] = playback.getPendingFrameCallbackIds();

        playback.runFrame(callbackId, { mediaTime: 999 });

        expect(originalSubtitleElement.textContent).toContain(
            'platform clock original'
        );
        expect(translatedSubtitleElement.textContent).toContain(
            'platform clock target'
        );
    });

    test('keeps a frame presentation wake-up scheduled while ownership is current', () => {
        const playback = createFramePlaybackHarness(1.05);
        subtitleQueue.push(
            ...makeReadyNativeCuePair(
                'current original',
                'current target',
                1,
                2
            )
        );

        ensureSubtitleContainer(playback.platform, TEST_CONFIG, 'QueueTest');
        const [firstCallbackId] = playback.getPendingFrameCallbackIds();
        playback.runFrame(firstCallbackId);

        expect(playback.requestVideoFrameCallback).toHaveBeenCalledTimes(2);
        expect(playback.getPendingFrameCallbackIds()).toHaveLength(1);
        expect(playback.getPendingFrameCallbackIds()[0]).not.toBe(
            firstCallbackId
        );
    });

    test('does not rescan an episode queue on frames before the next cue boundary', () => {
        const playback = createFramePlaybackHarness(0.25);
        let irrelevantCueStartReads = 0;
        const irrelevantCues = Array.from({ length: 200 }, (_, index) => {
            const cue = {
                ...makeCue(
                    `later cue ${index}`,
                    100 + index * 2,
                    101 + index * 2
                ),
                translated: `later target ${index}`,
                useNativeTarget: true,
            };
            const start = cue.start;
            Object.defineProperty(cue, 'start', {
                configurable: true,
                enumerable: true,
                get() {
                    irrelevantCueStartReads += 1;
                    return start;
                },
            });
            return cue;
        });
        subtitleQueue.push(
            ...irrelevantCues,
            ...makeReadyNativeCuePair(
                'next-boundary original',
                'next-boundary target',
                10,
                11
            )
        );

        ensureSubtitleContainer(playback.platform, TEST_CONFIG, 'QueueTest');
        const [initialCallbackId] = playback.getPendingFrameCallbackIds();
        playback.runFrame(initialCallbackId);
        expect(irrelevantCueStartReads).toBeGreaterThan(0);

        irrelevantCueStartReads = 0;
        for (const time of [0.3, 0.35, 0.4, 0.45]) {
            playback.video.currentTime = time;
            const [callbackId] = playback.getPendingFrameCallbackIds();
            playback.runFrame(callbackId);
        }

        expect(irrelevantCueStartReads).toBe(0);

        playback.video.currentTime = 10.05;
        const [boundaryCallbackId] = playback.getPendingFrameCallbackIds();
        playback.runFrame(boundaryCallbackId);
        expect(originalSubtitleElement.textContent).toContain(
            'next-boundary original'
        );
        expect(translatedSubtitleElement.textContent).toContain(
            'next-boundary target'
        );
    });

    test('removes ready native cues on the next presented frame past their end', () => {
        jest.useFakeTimers();
        const playback = createFramePlaybackHarness(1.05);
        subtitleQueue.push(
            ...makeReadyNativeCuePair(
                'expiring original',
                'expiring target',
                1,
                2
            )
        );

        ensureSubtitleContainer(playback.platform, TEST_CONFIG, 'QueueTest');
        const [startCallbackId] = playback.getPendingFrameCallbackIds();
        playback.runFrame(startCallbackId);
        expect(originalSubtitleElement.textContent).toContain(
            'expiring original'
        );
        expect(translatedSubtitleElement.textContent).toContain(
            'expiring target'
        );

        jest.advanceTimersByTime(801);
        playback.video.currentTime = 2.001;
        const [endCallbackId] = playback.getPendingFrameCallbackIds();
        playback.runFrame(endCallbackId);

        expect(originalSubtitleElement.textContent).toBe('');
        expect(translatedSubtitleElement.textContent).toBe('');
    });

    test('cancels replaced video ownership and makes an already-saved callback inert', () => {
        const firstPlayback = createFramePlaybackHarness(1.05);
        firstPlayback.setVideoId('first-video');
        subtitleQueue.push(
            ...makeReadyNativeCuePair(
                'stale original',
                'stale target',
                1,
                2
            ).map((cue) => ({ ...cue, videoId: 'first-video' }))
        );
        ensureSubtitleContainer(
            firstPlayback.platform,
            TEST_CONFIG,
            'QueueTest'
        );
        const [staleCallbackId] = firstPlayback.getPendingFrameCallbackIds();
        const staleCallback = firstPlayback.getFrameCallback(staleCallbackId);

        const nextPlayback = createFramePlaybackHarness(10.05);
        nextPlayback.setVideoId('next-video');
        subtitleQueue.push(
            ...makeReadyNativeCuePair(
                'current original',
                'current target',
                10,
                11
            ).map((cue) => ({ ...cue, videoId: 'next-video' }))
        );
        ensureSubtitleContainer(
            nextPlayback.platform,
            TEST_CONFIG,
            'QueueTest'
        );

        expect(firstPlayback.cancelVideoFrameCallback).toHaveBeenCalledWith(
            staleCallbackId
        );
        staleCallback(0, { mediaTime: firstPlayback.video.currentTime });
        expect(originalSubtitleElement.textContent).not.toContain(
            'stale original'
        );
        expect(firstPlayback.requestVideoFrameCallback).toHaveBeenCalledTimes(
            1
        );

        const [currentCallbackId] = nextPlayback.getPendingFrameCallbackIds();
        nextPlayback.runFrame(currentCallbackId);
        expect(originalSubtitleElement.textContent).toContain(
            'current original'
        );
        expect(translatedSubtitleElement.textContent).toContain(
            'current target'
        );
    });

    test('clear cancels the owned frame callback terminally', () => {
        const playback = createFramePlaybackHarness(1.05);
        subtitleQueue.push(
            ...makeReadyNativeCuePair(
                'cleared original',
                'cleared target',
                1,
                2
            )
        );
        ensureSubtitleContainer(playback.platform, TEST_CONFIG, 'QueueTest');
        const [callbackId] = playback.getPendingFrameCallbackIds();
        const savedCallback = playback.getFrameCallback(callbackId);

        clearSubtitleDOM();

        expect(playback.cancelVideoFrameCallback).toHaveBeenCalledWith(
            callbackId
        );
        savedCallback(0, { mediaTime: playback.video.currentTime });
        expect(playback.requestVideoFrameCallback).toHaveBeenCalledTimes(1);
        expect(originalSubtitleElement).toBeNull();
        expect(translatedSubtitleElement).toBeNull();
    });

    test('keeps timeupdate as the presentation fallback without frame callbacks', () => {
        const playback = createPlaybackHarness(0.999);
        subtitleQueue.push(
            ...makeReadyNativeCuePair(
                'fallback original',
                'fallback target',
                1,
                2
            )
        );
        ensureSubtitleContainer(playback.platform, TEST_CONFIG, 'QueueTest');

        playback.video.currentTime = 1.05;
        expect(originalSubtitleElement.textContent).toBe('');
        expect(translatedSubtitleElement.textContent).toBe('');

        playback.video.dispatchEvent(new Event('timeupdate'));

        expect(originalSubtitleElement.textContent).toContain(
            'fallback original'
        );
        expect(translatedSubtitleElement.textContent).toContain(
            'fallback target'
        );
    });

    test('falls back without retrying when frame callback registration throws', () => {
        const playback = createPlaybackHarness(0.999);
        const requestVideoFrameCallback = jest.fn(() => {
            throw new DOMException('detached media', 'InvalidStateError');
        });
        Object.defineProperty(playback.video, 'requestVideoFrameCallback', {
            configurable: true,
            value: requestVideoFrameCallback,
        });
        subtitleQueue.push(
            ...makeReadyNativeCuePair(
                'throw fallback original',
                'throw fallback target',
                1,
                2
            )
        );

        expect(() =>
            ensureSubtitleContainer(playback.platform, TEST_CONFIG, 'QueueTest')
        ).not.toThrow();
        expect(requestVideoFrameCallback).toHaveBeenCalledTimes(1);

        playback.video.currentTime = 1.05;
        playback.video.dispatchEvent(new Event('timeupdate'));
        playback.video.dispatchEvent(new Event('timeupdate'));

        expect(originalSubtitleElement.textContent).toContain(
            'throw fallback original'
        );
        expect(translatedSubtitleElement.textContent).toContain(
            'throw fallback target'
        );
        expect(requestVideoFrameCallback).toHaveBeenCalledTimes(1);
    });

    test('keeps a cancelled callback inert when browser cancellation throws', () => {
        const playback = createFramePlaybackHarness(1.05);
        const cancelVideoFrameCallback = jest.fn(() => {
            throw new DOMException('detached media', 'InvalidStateError');
        });
        Object.defineProperty(playback.video, 'cancelVideoFrameCallback', {
            configurable: true,
            value: cancelVideoFrameCallback,
        });
        subtitleQueue.push(
            ...makeReadyNativeCuePair(
                'cancelled original',
                'cancelled target',
                1,
                2
            )
        );
        ensureSubtitleContainer(playback.platform, TEST_CONFIG, 'QueueTest');
        const [callbackId] = playback.getPendingFrameCallbackIds();
        const savedCallback = playback.getFrameCallback(callbackId);

        expect(() => clearSubtitleDOM()).not.toThrow();
        expect(cancelVideoFrameCallback).toHaveBeenCalledWith(callbackId);

        savedCallback(0, { mediaTime: playback.video.currentTime });
        expect(playback.requestVideoFrameCallback).toHaveBeenCalledTimes(1);
        expect(originalSubtitleElement).toBeNull();
        expect(translatedSubtitleElement).toBeNull();
    });

    test('does not duplicate frame ownership when attachment is already current', () => {
        const playback = createFramePlaybackHarness(1.05);
        subtitleQueue.push(
            ...makeReadyNativeCuePair('stable original', 'stable target', 1, 2)
        );

        ensureSubtitleContainer(playback.platform, TEST_CONFIG, 'QueueTest');
        attachTimeUpdateListener(
            playback.video,
            playback.platform,
            TEST_CONFIG,
            'QueueTest'
        );
        ensureSubtitleContainer(playback.platform, TEST_CONFIG, 'QueueTest');

        expect(playback.requestVideoFrameCallback).toHaveBeenCalledTimes(1);
        expect(playback.getPendingFrameCallbackIds()).toHaveLength(1);
        expect(playback.cancelVideoFrameCallback).not.toHaveBeenCalled();
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
        const staleCue = {
            ...makeCue('old pending cue', 10, 12),
            videoId: 'first-video',
        };
        subtitleQueue.push(staleCue);

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
        expect(staleCue.translated).toBeNull();
        expect(staleCue.translationAttempts).toBeUndefined();
        expect(staleCue.translationRetryAt).toBeUndefined();
        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
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

    test('translates each duplicate cue occurrence without resubmitting either cue', async () => {
        jest.useFakeTimers();
        const { platform } = createPlaybackHarness(100);
        const firstCue = makeCue('duplicate cue', 100, 102);
        const secondCue = makeCue('duplicate cue', 100, 104);
        subtitleQueue.push(firstCue, secondCue);

        chrome.runtime.sendMessage = jest.fn((message, callback) => {
            callback(translationResponse(message));
        });

        await processSubtitleQueue(platform, TEST_CONFIG, 'QueueTest');
        await jest.advanceTimersByTimeAsync(50);

        expect(firstCue.translated).toBe('translated:duplicate cue');
        expect(secondCue.translated).toBe('translated:duplicate cue');
        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(2);

        await jest.advanceTimersByTimeAsync(10_000);
        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(2);
    });

    test('retries once after proven non-delivery while playback is paused', async () => {
        jest.useFakeTimers();
        const { platform } = createPlaybackHarness(100);
        subtitleQueue.push(makeCue('current cue', 100, 102));

        let requestCount = 0;
        chrome.runtime.sendMessage = jest.fn((message, callback) => {
            requestCount++;
            if (requestCount === 1) {
                chrome.runtime.lastError = {
                    message:
                        'Could not establish connection. Receiving end does not exist.',
                };
                callback(undefined);
                delete chrome.runtime.lastError;
            } else {
                callback(translationResponse(message));
            }
        });

        let initialRunCompleted = false;
        const initialRun = processSubtitleQueue(
            platform,
            TEST_CONFIG,
            'QueueTest'
        ).then(() => {
            initialRunCompleted = true;
        });
        await jest.advanceTimersByTimeAsync(0);

        expect(initialRunCompleted).toBe(true);
        expect(subtitleQueue[0].translated).toBeNull();
        expect(subtitleQueue[0].translationAttempts).toBe(1);
        expect(subtitleQueue[0].translationRetryAt - Date.now()).toBe(500);
        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
        await initialRun;

        await jest.advanceTimersByTimeAsync(500);

        expect(subtitleQueue[0].translated).toBe('translated:current cue');
        expect(subtitleQueue[0].translationAttempts).toBeUndefined();
        expect(subtitleQueue[0].translationRetryAt).toBeUndefined();
        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(2);
    });

    test('does not attach retry state after clear invalidates an in-flight dispatch', async () => {
        jest.useFakeTimers();
        const { platform } = createPlaybackHarness(100);
        const cue = makeCue('near-future cue', 110, 112);
        subtitleQueue.push(cue);
        let releaseRequest;

        chrome.runtime.sendMessage = jest.fn((_message, callback) => {
            releaseRequest = () => rejectCallbackAsNonDelivery(callback);
        });

        const initialRun = processSubtitleQueue(
            platform,
            TEST_CONFIG,
            'QueueTest'
        );
        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
        expect(releaseRequest).toEqual(expect.any(Function));

        clearSubtitleDOM();
        releaseRequest();
        await initialRun;

        expect(cue.translated).toBeNull();
        expect(cue.translationAttempts).toBeUndefined();
        expect(cue.translationRetryAt).toBeUndefined();
        expect(jest.getTimerCount()).toBe(0);

        const freshRun = processSubtitleQueue(
            platform,
            TEST_CONFIG,
            'QueueTest'
        );
        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(2);
        releaseRequest();
        await freshRun;

        expect(cue.translationAttempts).toBe(1);
        expect(cue.translationRetryAt - Date.now()).toBe(500);
        expect(jest.getTimerCount()).toBe(1);

        clearSubtitleDOM();
        expect(cue.translationAttempts).toBeUndefined();
        expect(cue.translationRetryAt).toBeUndefined();
        expect(jest.getTimerCount()).toBe(0);

        await jest.advanceTimersByTimeAsync(10_000);
        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(2);
        expect(jest.getTimerCount()).toBe(0);
    });

    test('does not attach retry state when disable and re-enable cross an in-flight dispatch', async () => {
        jest.useFakeTimers();
        const { platform } = createPlaybackHarness(100);
        const cue = makeCue('near-future cue', 110, 112);
        subtitleQueue.push(cue);
        let releaseRequest;

        chrome.runtime.sendMessage = jest.fn((_message, callback) => {
            releaseRequest = () => rejectCallbackAsNonDelivery(callback);
        });

        const initialRun = processSubtitleQueue(
            platform,
            TEST_CONFIG,
            'QueueTest'
        );
        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);

        setSubtitlesActive(false);
        setSubtitlesActive(true);
        releaseRequest();
        await initialRun;

        expect(cue.translated).toBeNull();
        expect(cue.translationAttempts).toBeUndefined();
        expect(cue.translationRetryAt).toBeUndefined();
        expect(jest.getTimerCount()).toBe(0);

        await jest.advanceTimersByTimeAsync(10_000);
        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
        expect(jest.getTimerCount()).toBe(0);
    });

    test('disable cancels a scheduled retry and re-enable does not revive it', async () => {
        jest.useFakeTimers();
        const { platform } = createPlaybackHarness(100);
        const cue = makeCue('near-future cue', 110, 112);
        subtitleQueue.push(cue);

        chrome.runtime.sendMessage = jest.fn((_message, callback) => {
            rejectCallbackAsNonDelivery(callback);
        });

        await processSubtitleQueue(platform, TEST_CONFIG, 'QueueTest');
        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
        expect(cue.translationAttempts).toBe(1);
        expect(cue.translationRetryAt).toEqual(expect.any(Number));
        expect(jest.getTimerCount()).toBe(1);

        setSubtitlesActive(false);
        expect(cue.translationAttempts).toBeUndefined();
        expect(cue.translationRetryAt).toBeUndefined();
        expect(jest.getTimerCount()).toBe(0);

        setSubtitlesActive(true);
        await jest.advanceTimersByTimeAsync(10_000);
        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
        expect(jest.getTimerCount()).toBe(0);
    });

    test('allows a fresh cue to begin its own retry state after invalidation', async () => {
        jest.useFakeTimers();
        const { platform } = createPlaybackHarness(100);
        const staleCue = makeCue('stale cue', 110, 112);
        subtitleQueue.push(staleCue);

        chrome.runtime.sendMessage = jest.fn((_message, callback) => {
            rejectCallbackAsNonDelivery(callback);
        });

        await processSubtitleQueue(platform, TEST_CONFIG, 'QueueTest');
        expect(staleCue.translationAttempts).toBe(1);

        clearSubtitlesDisplayAndQueue(null, true, 'QueueTest');
        const freshCue = makeCue('fresh cue', 110, 112);
        subtitleQueue.push(freshCue);

        await processSubtitleQueue(platform, TEST_CONFIG, 'QueueTest');

        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(2);
        expect(freshCue.translationAttempts).toBe(1);
        expect(freshCue.translationRetryAt - Date.now()).toBe(500);
        expect(jest.getTimerCount()).toBe(1);
    });

    test('caps persistent proven non-delivery at one later cue retry', async () => {
        jest.useFakeTimers();
        const { platform } = createPlaybackHarness(100);
        subtitleQueue.push(makeCue('current cue', 100, 102));

        chrome.runtime.sendMessage = jest.fn((_message, callback) => {
            chrome.runtime.lastError = {
                message:
                    'Could not establish connection. Receiving end does not exist.',
            };
            callback(undefined);
            delete chrome.runtime.lastError;
        });

        await processSubtitleQueue(platform, TEST_CONFIG, 'QueueTest');
        expect(subtitleQueue[0].translationAttempts).toBe(1);
        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(500);

        expect(subtitleQueue[0].translated).toBe(
            getLocalizedErrorMessage('TRANSLATION_REQUEST_ERROR')
        );
        expect(subtitleQueue[0].translationAttempts).toBe(2);
        expect(subtitleQueue[0].translationRetryAt).toBeUndefined();
        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(2);

        await jest.advanceTimersByTimeAsync(10_000);
        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(2);
    });

    test('does not retry an accepted background/provider error', async () => {
        jest.useFakeTimers();
        const { platform } = createPlaybackHarness(100);
        subtitleQueue.push(makeCue('current cue', 100, 102));

        chrome.runtime.sendMessage = jest.fn((message, callback) => {
            callback(translationFailureResponse(message, true));
        });

        await processSubtitleQueue(platform, TEST_CONFIG, 'QueueTest');
        expect(subtitleQueue[0].translated).toBe(
            getLocalizedErrorMessage('TRANSLATION_API_ERROR')
        );
        expect(subtitleQueue[0].translationAttempts).toBeUndefined();
        expect(subtitleQueue[0].translationRetryAt).toBeUndefined();
        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(10_000);
        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
    });

    test('bounds persistent failures for each duplicate cue occurrence', async () => {
        jest.useFakeTimers();
        const { platform } = createPlaybackHarness(100);
        const firstCue = makeCue('duplicate cue', 100, 102);
        const secondCue = makeCue('duplicate cue', 100, 104);
        subtitleQueue.push(firstCue, secondCue);

        chrome.runtime.sendMessage = jest.fn((message, callback) => {
            callback(translationFailureResponse(message));
        });

        await processSubtitleQueue(platform, TEST_CONFIG, 'QueueTest');
        await jest.advanceTimersByTimeAsync(500);

        const terminalError = getLocalizedErrorMessage('TRANSLATION_API_ERROR');
        expect(firstCue.translated).toBe(terminalError);
        expect(secondCue.translated).toBe(terminalError);
        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(2);

        await jest.advanceTimersByTimeAsync(10_000);
        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(2);
    });

    test.each([
        'The message port closed before a response was received.',
        'Extension context invalidated.',
    ])(
        'does not retry terminal or ambiguous transport failure: %s',
        async (message) => {
            jest.useFakeTimers();
            const { platform } = createPlaybackHarness(100);
            subtitleQueue.push(makeCue('current cue', 100, 102));

            chrome.runtime.sendMessage = jest.fn((_request, callback) => {
                chrome.runtime.lastError = { message };
                callback(undefined);
                delete chrome.runtime.lastError;
            });

            await processSubtitleQueue(platform, TEST_CONFIG, 'QueueTest');

            expect(subtitleQueue[0].translated).toBe(
                getLocalizedErrorMessage('TRANSLATION_REQUEST_ERROR')
            );
            expect(subtitleQueue[0].translationAttempts).toBeUndefined();
            expect(subtitleQueue[0].translationRetryAt).toBeUndefined();
            expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);

            await jest.advanceTimersByTimeAsync(10_000);
            expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
        }
    );

    test.each([
        ['malformed', () => ({ translatedText: 'missing cue echoes' })],
        [
            'null translation',
            (message) => ({
                ...translationResponse(message),
                translatedText: null,
            }),
        ],
        [
            'non-string translation',
            (message) => ({
                ...translationResponse(message),
                translatedText: 42,
            }),
        ],
        [
            'empty translation',
            (message) => ({
                ...translationResponse(message),
                translatedText: '',
            }),
        ],
        [
            'mismatched',
            (message) => ({
                ...translationResponse(message),
                cueStart: message.cueStart + 1,
            }),
        ],
        [
            'extra-key',
            (message) => ({
                ...translationResponse(message),
                unexpected: true,
            }),
        ],
        [
            'cross-shape',
            (message) => ({
                ...translationFailureResponse(message),
                translatedText: 'not a failure field',
            }),
        ],
    ])('does not retry a %s response', async (_label, makeResponse) => {
        jest.useFakeTimers();
        const { platform } = createPlaybackHarness(100);
        subtitleQueue.push(makeCue('current cue', 100, 102));

        chrome.runtime.sendMessage = jest.fn((message, callback) => {
            callback(makeResponse(message));
        });

        await processSubtitleQueue(platform, TEST_CONFIG, 'QueueTest');

        expect(subtitleQueue[0].translated).toBe(
            getLocalizedErrorMessage('TRANSLATION_REQUEST_ERROR')
        );
        expect(subtitleQueue[0].translationRetryAt).toBeUndefined();
        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(10_000);
        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
    });

    test.each([
        [
            'own accessor',
            (message, recordRead) => {
                const response = { ...translationResponse(message) };
                Object.defineProperty(response, 'translatedText', {
                    configurable: true,
                    enumerable: true,
                    get() {
                        recordRead();
                        return 'accessor translation';
                    },
                });
                return response;
            },
        ],
        [
            'exotic instance',
            (_message, recordRead) =>
                new (class ExoticTranslationResponse {
                    get error() {
                        recordRead();
                        return undefined;
                    }

                    get translatedText() {
                        recordRead();
                        return 'exotic translation';
                    }
                })(),
        ],
    ])(
        'rejects an %s without reading response values',
        async (_label, makeResponse) => {
            const { platform } = createPlaybackHarness(100);
            const cue = makeCue('current cue', 100, 102);
            subtitleQueue.push(cue);
            const recordRead = jest.fn();

            chrome.runtime.sendMessage = jest.fn((message, callback) => {
                callback(makeResponse(message, recordRead));
            });

            await processSubtitleQueue(platform, TEST_CONFIG, 'QueueTest');

            expect(recordRead).not.toHaveBeenCalled();
            expect(cue.translated).toBe(
                getLocalizedErrorMessage('TRANSLATION_REQUEST_ERROR')
            );
            expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
        }
    );

    test('does not dispatch when the protocol request builder rejects cue input', async () => {
        const { platform } = createPlaybackHarness(100);
        const cue = makeCue('current cue', 100, 102);
        subtitleQueue.push(cue);
        const invalidConfig = { ...TEST_CONFIG, targetLanguage: '   ' };
        chrome.runtime.sendMessage = jest.fn((_message, callback) => {
            callback(undefined);
        });

        await processSubtitleQueue(platform, invalidConfig, 'QueueTest');

        expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
        expect(cue.translated).toBe(
            getLocalizedErrorMessage('TRANSLATION_REQUEST_ERROR')
        );
        expect(cue.translationAttempts).toBeUndefined();
        expect(cue.translationRetryAt).toBeUndefined();
    });

    test('does not apply content-side translationDelay pacing', async () => {
        jest.useFakeTimers();
        const { platform } = createPlaybackHarness(100);
        subtitleQueue.push(
            makeCue('current cue', 100, 102),
            makeCue('near-future cue', 110, 112)
        );
        const delayedConfig = {
            ...TEST_CONFIG,
            translationDelay: 10_000,
        };
        chrome.runtime.sendMessage = jest.fn((message, callback) => {
            callback(translationResponse(message));
        });

        let completed = false;
        const queueRun = processSubtitleQueue(
            platform,
            delayedConfig,
            'QueueTest'
        ).then(() => {
            completed = true;
        });
        await jest.advanceTimersByTimeAsync(0);

        expect(completed).toBe(true);
        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(2);
        await queueRun;
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
