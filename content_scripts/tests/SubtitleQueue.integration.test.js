import { jest } from '@jest/globals';

import {
    attachTimeUpdateListener,
    clearSubtitleDOM,
    clearSubtitlesDisplayAndQueue,
    ensureSubtitleContainer,
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

const VIDEO_ID = 'queue-test-video';
const CONFIG = {
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

function cue(original, start, end, videoId = VIDEO_ID) {
    return {
        original,
        translated: null,
        start,
        end,
        videoId,
        useNativeTarget: false,
        sourceLanguage: 'en',
        targetLanguage: 'zh-CN',
        cueType: 'original',
    };
}

function createPlayback(initialTime, initialVideoId = VIDEO_ID) {
    let playbackTime = initialTime;
    let videoId = initialVideoId;
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

    return {
        video,
        platform: {
            getCurrentVideoId: () => videoId,
            getPlaybackTime: () => playbackTime,
            getVideoElement: () => video,
            getPlayerContainerElement: () => document.body,
            isPlayerPageActive: () => true,
            supportsProgressBarTracking: () => false,
        },
        seek(time) {
            playbackTime = time;
            video.dispatchEvent(new Event('seeked'));
        },
        setVideoId(value) {
            videoId = value;
        },
    };
}

function addFrameCallbacks(playback) {
    const callbacks = new Map();
    let nextId = 1;
    playback.video.requestVideoFrameCallback = jest.fn((callback) => {
        const id = nextId++;
        callbacks.set(id, callback);
        return id;
    });
    playback.video.cancelVideoFrameCallback = jest.fn((id) => {
        callbacks.delete(id);
    });
    return {
        next(metadata = {}) {
            const [id, callback] = callbacks.entries().next().value;
            callbacks.delete(id);
            callback(0, metadata);
        },
    };
}

function nativeCuePair(original, translated, start, end, videoId = VIDEO_ID) {
    return [
        { ...cue(original, start, end, videoId), useNativeTarget: true },
        {
            ...cue(null, start, end, videoId),
            translated,
            useNativeTarget: true,
            cueType: 'target',
        },
    ];
}

function success(message) {
    return buildTranslationSuccessResponse(message, {
        translatedText: `translated:${message.text}`,
    });
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, reject, resolve };
}

async function waitFor(predicate) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error('Timed out waiting for subtitle queue');
}

describe('subtitle queue and presentation', () => {
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

    test('sends canonical requests for only the current playback window', async () => {
        const { platform } = createPlayback(100);
        const current = cue('current', 100, 102);
        const near = cue('near', 110, 112);
        const far = cue('far', 1000, 1002);
        subtitleQueue.push(current, near, far);
        chrome.runtime.sendMessage = jest.fn((message) =>
            Promise.resolve(success(message))
        );

        await processSubtitleQueue(platform, CONFIG, 'QueueTest');

        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(2);
        expect(chrome.runtime.sendMessage.mock.calls[0][0]).toEqual({
            action: 'translate',
            text: 'current',
            targetLang: 'zh-CN',
            cueStart: 100,
            cueVideoId: VIDEO_ID,
        });
        expect(
            Object.isFrozen(chrome.runtime.sendMessage.mock.calls[0][0])
        ).toBe(true);
        expect(current.translated).toBe('translated:current');
        expect(near.translated).toBe('translated:near');
        expect(far.translated).toBeNull();
    });

    test('translates duplicate cue occurrences once each', async () => {
        const { platform } = createPlayback(100);
        const first = cue('duplicate', 100, 102);
        const second = cue('duplicate', 100, 104);
        subtitleQueue.push(first, second);
        chrome.runtime.sendMessage = jest.fn((message) =>
            Promise.resolve(success(message))
        );

        await processSubtitleQueue(platform, CONFIG, 'QueueTest');
        await processSubtitleQueue(platform, CONFIG, 'QueueTest');

        expect(first.translated).toBe('translated:duplicate');
        expect(second.translated).toBe('translated:duplicate');
        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(2);
    });

    test('a seek wakes cues outside the previous lookahead window', async () => {
        const playback = createPlayback(100);
        const early = cue('early', 10, 12);
        subtitleQueue.push(early, cue('current', 100, 102));
        chrome.runtime.sendMessage = jest.fn((message) =>
            Promise.resolve(success(message))
        );

        attachTimeUpdateListener(
            playback.video,
            playback.platform,
            CONFIG,
            'QueueTest'
        );
        await processSubtitleQueue(playback.platform, CONFIG, 'QueueTest');
        expect(early.translated).toBeNull();

        playback.seek(10.5);
        await waitFor(() => early.translated !== null);

        expect(early.translated).toBe('translated:early');
    });

    test('video frames render and expire native cues using the platform clock', () => {
        jest.useFakeTimers();
        const playback = createPlayback(0.999);
        const frames = addFrameCallbacks(playback);
        subtitleQueue.push(...nativeCuePair('original', 'target', 1, 2));

        ensureSubtitleContainer(playback.platform, CONFIG, 'QueueTest');
        playback.video.currentTime = 1.05;
        frames.next({ mediaTime: 999 });
        expect(originalSubtitleElement.textContent).toContain('original');
        expect(translatedSubtitleElement.textContent).toContain('target');

        jest.advanceTimersByTime(801);
        playback.video.currentTime = 2.001;
        frames.next();
        expect(originalSubtitleElement.textContent).toBe('');
        expect(translatedSubtitleElement.textContent).toBe('');
    });

    test('SPA replacement rebinds time updates and leaves the old video inert', () => {
        const first = createPlayback(10, 'first-video');
        setCurrentVideoId('first-video');
        subtitleQueue.push({
            ...cue('first', 10, 12, 'first-video'),
            translated: 'translated:first',
        });
        ensureSubtitleContainer(first.platform, CONFIG, 'QueueTest');
        first.video.dispatchEvent(new Event('timeupdate'));
        expect(originalSubtitleElement.textContent).toContain('first');

        const next = createPlayback(100, 'next-video');
        handleVideoIdChange('next-video', 'QueueTest');
        subtitleQueue.push({
            ...cue('next', 100, 102, 'next-video'),
            translated: 'translated:next',
        });
        ensureSubtitleContainer(next.platform, CONFIG, 'QueueTest');
        next.video.dispatchEvent(new Event('timeupdate'));
        first.video.dispatchEvent(new Event('timeupdate'));

        expect(originalSubtitleElement.textContent).toContain('next');
        expect(originalSubtitleElement.textContent).not.toContain('first');
    });

    test('progress-bar mutations update subtitle presentation time', async () => {
        const playback = createPlayback(0);
        Object.defineProperty(playback.video, 'duration', {
            configurable: true,
            value: 200,
        });
        const slider = document.createElement('div');
        slider.setAttribute('aria-valuenow', '0');
        slider.setAttribute('aria-valuetext', '0 of 100');
        document.body.appendChild(slider);
        const platform = {
            ...playback.platform,
            supportsProgressBarTracking: () => true,
            getProgressBarElement: () => slider,
        };
        subtitleQueue.push(
            ...nativeCuePair('progress original', 'progress target', 100, 101)
        );

        ensureSubtitleContainer(platform, CONFIG, 'QueueTest');
        expect(originalSubtitleElement.textContent).toBe('');

        slider.setAttribute('aria-valuetext', '50 of 100');
        slider.setAttribute('aria-valuenow', '50');
        await waitFor(() =>
            originalSubtitleElement.textContent.includes('progress original')
        );

        expect(translatedSubtitleElement.textContent).toContain(
            'progress target'
        );
    });

    test('retries once when Chrome proves non-delivery', async () => {
        jest.useFakeTimers();
        const { platform } = createPlayback(100);
        const current = cue('current', 100, 102);
        subtitleQueue.push(current);
        chrome.runtime.sendMessage = jest
            .fn()
            .mockRejectedValueOnce(
                new Error(
                    'Could not establish connection. Receiving end does not exist.'
                )
            )
            .mockImplementation((message) => Promise.resolve(success(message)));

        await processSubtitleQueue(platform, CONFIG, 'QueueTest');
        expect(current.translated).toBeNull();
        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(500);

        expect(current.translated).toBe('translated:current');
        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(2);
    });

    test.each([
        [
            'accepted provider failure',
            (message) =>
                Promise.resolve(buildTranslationFailureResponse(message, {})),
        ],
        [
            'ambiguous transport failure',
            () =>
                Promise.reject(
                    new Error(
                        'The message port closed before a response was received.'
                    )
                ),
        ],
    ])('does not retry an %s', async (_label, response) => {
        jest.useFakeTimers();
        const { platform } = createPlayback(100);
        const current = cue('current', 100, 102);
        subtitleQueue.push(current);
        chrome.runtime.sendMessage = jest.fn(response);

        await processSubtitleQueue(platform, CONFIG, 'QueueTest');
        await jest.advanceTimersByTimeAsync(10_000);

        expect(current.translated).toEqual(
            expect.stringContaining('Translation')
        );
        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
    });

    test('clear invalidates an in-flight failure without scheduling a retry', async () => {
        jest.useFakeTimers();
        const { platform } = createPlayback(100);
        const current = cue('current', 100, 102);
        subtitleQueue.push(current);
        const request = deferred();
        chrome.runtime.sendMessage = jest.fn(() => request.promise);

        const processing = processSubtitleQueue(platform, CONFIG, 'QueueTest');
        clearSubtitlesDisplayAndQueue(null, true, 'QueueTest');
        request.reject(
            new Error(
                'Could not establish connection. Receiving end does not exist.'
            )
        );
        await processing;

        expect(current.translated).toBeNull();
        expect(current.translationAttempts).toBeUndefined();
        expect(jest.getTimerCount()).toBe(0);
    });

    test('a video change stops the remaining in-flight batch', async () => {
        const playback = createPlayback(100);
        subtitleQueue.push(
            cue('first', 100, 102),
            cue('second', 105, 107),
            cue('third', 110, 112)
        );
        const firstRequest = deferred();
        const requests = [];
        chrome.runtime.sendMessage = jest.fn((message) => {
            requests.push(message.text);
            return requests.length === 1
                ? firstRequest.promise
                : Promise.resolve(success(message));
        });

        const processing = processSubtitleQueue(
            playback.platform,
            CONFIG,
            'QueueTest'
        );
        await waitFor(() => requests.length === 1);
        playback.setVideoId('next-video');
        handleVideoIdChange('next-video', 'QueueTest');
        firstRequest.resolve(
            success(chrome.runtime.sendMessage.mock.calls[0][0])
        );
        await processing;

        expect(requests).toEqual(['first']);
    });

    test('content-side translationDelay does not pace background requests', async () => {
        const { platform } = createPlayback(100);
        subtitleQueue.push(cue('first', 100, 102), cue('second', 105, 107));
        chrome.runtime.sendMessage = jest.fn((message) =>
            Promise.resolve(success(message))
        );

        await processSubtitleQueue(
            platform,
            { ...CONFIG, translationDelay: 10_000 },
            'QueueTest'
        );

        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(2);
    });
});
