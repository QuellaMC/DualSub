import { jest } from '@jest/globals';

import {
    beginSubtitleStatePublisher,
    clearSubtitleDOM,
    clearSubtitlesDisplayAndQueue,
    ensureSubtitleContainer,
    finalizeExpiredSubtitleIfNeeded,
    handleVideoIdChange,
    hideSubtitleContainer,
    initializeInteractiveSubtitleFeatures,
    originalSubtitleElement,
    setCurrentVideoId,
    setSubtitlesActive,
    subtitleQueue,
    translatedSubtitleElement,
    updateSubtitles,
} from '../../shared/subtitleUtilities.js';

const TEST_CONFIG = {
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

let publisherCleanup = null;
let formatterCleanup = null;

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
        setVideoId(nextVideoId) {
            currentVideoId = nextVideoId;
        },
        setPlaybackTime(nextPlaybackTime) {
            playbackTime = nextPlaybackTime;
        },
    };
}

function expectExactFrozenPayload(payload, expected) {
    expect(payload).toEqual(expected);
    expect(Number.isSafeInteger(payload.renderRevision)).toBe(true);
    expect(payload.renderRevision).toBeGreaterThan(0);
    expect(Object.keys(payload)).toEqual([
        'renderRevision',
        'reason',
        'videoId',
        'text',
    ]);
    expect(Object.getPrototypeOf(payload)).toBe(Object.prototype);
    expect(Object.isFrozen(payload)).toBe(true);
    expect(
        Object.values(payload).every(
            (value) =>
                value === null ||
                typeof value === 'number' ||
                typeof value === 'string'
        )
    ).toBe(true);
    for (const descriptor of Object.values(
        Object.getOwnPropertyDescriptors(payload)
    )) {
        expect(descriptor.enumerable).toBe(true);
        expect(Object.hasOwn(descriptor, 'value')).toBe(true);
        expect(Object.hasOwn(descriptor, 'get')).toBe(false);
        expect(Object.hasOwn(descriptor, 'set')).toBe(false);
    }
}

function queueOriginalCue(videoId, text, { start = 0, end = 10 } = {}) {
    subtitleQueue.push({
        original: text,
        translated: null,
        start,
        end,
        videoId,
        useNativeTarget: false,
        sourceLanguage: 'en',
        targetLanguage: 'es',
        cueType: 'original',
    });
}

function queueTranslatedCue(videoId, text, { useNativeTarget = false } = {}) {
    subtitleQueue.push({
        original: null,
        translated: text,
        start: 0,
        end: 10,
        videoId,
        useNativeTarget,
        sourceLanguage: 'en',
        targetLanguage: 'es',
        cueType: useNativeTarget ? 'target' : 'original',
    });
}

function renderOriginal(playback, text = 'route state') {
    subtitleQueue.splice(0);
    ensureSubtitleContainer(
        playback.platform,
        TEST_CONFIG,
        'StatePublisherTest'
    );
    queueOriginalCue(playback.platform.getCurrentVideoId(), text);
    updateSubtitles(1, playback.platform, TEST_CONFIG, 'StatePublisherTest');
}

describe('subtitle state publisher', () => {
    beforeAll(async () => {
        formatterCleanup = await initializeInteractiveSubtitleFeatures({
            sourceLanguage: 'en',
            targetLanguage: 'es',
        });
    });

    afterAll(() => {
        formatterCleanup?.();
    });

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

    test('publishes one exact frozen render state through the existing display path', () => {
        const publishSubtitleState = jest.fn();
        publisherCleanup = beginSubtitleStatePublisher({
            publishSubtitleState,
        });
        const { platform } = createPlayback();
        ensureSubtitleContainer(platform, TEST_CONFIG, 'StatePublisherTest');
        queueOriginalCue('video-1', 'hello world');

        updateSubtitles(1, platform, TEST_CONFIG, 'StatePublisherTest');

        expect(publishSubtitleState).toHaveBeenCalledTimes(1);
        const payload = publishSubtitleState.mock.calls[0][0];
        expectExactFrozenPayload(payload, {
            renderRevision: expect.any(Number),
            reason: 'render',
            videoId: 'video-1',
            text: 'hello world',
        });
    });

    test('advances revisions and stamps every original interactive word on changed renders', () => {
        jest.spyOn(
            window,
            'dualsub_formatInteractiveSubtitleText'
        ).mockImplementation((text, { subtitleType }) =>
            text
                .split(' ')
                .map(
                    (word, index) =>
                        `<span class="dualsub-interactive-word" data-word-index="${index}" data-subtitle-type="${subtitleType}">${word}</span>`
                )
                .join(' ')
        );
        const publishSubtitleState = jest.fn();
        publisherCleanup = beginSubtitleStatePublisher({
            publishSubtitleState,
        });
        const { platform } = createPlayback();
        ensureSubtitleContainer(platform, TEST_CONFIG, 'StatePublisherTest');
        queueOriginalCue('video-1', 'hello world');

        updateSubtitles(1, platform, TEST_CONFIG, 'StatePublisherTest');
        const firstPayload = publishSubtitleState.mock.calls[0][0];
        const firstRevision = String(firstPayload.renderRevision);
        expect(originalSubtitleElement).toHaveAttribute(
            'data-render-revision',
            firstRevision
        );
        expect(
            Array.from(
                originalSubtitleElement.querySelectorAll(
                    '.dualsub-interactive-word'
                ),
                (word) => word.getAttribute('data-render-revision')
            )
        ).toEqual([firstRevision, firstRevision]);

        subtitleQueue.splice(0);
        queueOriginalCue('video-1', 'good night');
        updateSubtitles(1, platform, TEST_CONFIG, 'StatePublisherTest');

        expect(publishSubtitleState).toHaveBeenCalledTimes(2);
        const secondPayload = publishSubtitleState.mock.calls[1][0];
        const secondRevision = String(secondPayload.renderRevision);
        expect(secondPayload).not.toBe(firstPayload);
        expect(secondPayload.renderRevision).toBeGreaterThan(
            firstPayload.renderRevision
        );
        expect(originalSubtitleElement).toHaveAttribute(
            'data-render-revision',
            secondRevision
        );
        expect(
            Array.from(
                originalSubtitleElement.querySelectorAll(
                    '.dualsub-interactive-word'
                ),
                (word) => word.getAttribute('data-render-revision')
            )
        ).toEqual([secondRevision, secondRevision]);
    });

    test('no-ops current same-pair commits and refreshes missing or stale stamps once', () => {
        const publishSubtitleState = jest.fn();
        publisherCleanup = beginSubtitleStatePublisher({
            publishSubtitleState,
        });
        const { platform } = createPlayback();
        ensureSubtitleContainer(platform, TEST_CONFIG, 'StatePublisherTest');
        queueOriginalCue('video-1', 'hello world');
        updateSubtitles(1, platform, TEST_CONFIG, 'StatePublisherTest');
        const renderRevision =
            publishSubtitleState.mock.calls[0][0].renderRevision;
        publishSubtitleState.mockClear();

        updateSubtitles(1, platform, TEST_CONFIG, 'StatePublisherTest');
        expect(publishSubtitleState).not.toHaveBeenCalled();

        originalSubtitleElement.removeAttribute('data-render-revision');
        updateSubtitles(1, platform, TEST_CONFIG, 'StatePublisherTest');
        expect(publishSubtitleState).toHaveBeenCalledTimes(1);
        const missingStampRefresh = publishSubtitleState.mock.calls[0][0];
        expectExactFrozenPayload(missingStampRefresh, {
            renderRevision: expect.any(Number),
            reason: 'refresh',
            videoId: 'video-1',
            text: 'hello world',
        });
        expect(missingStampRefresh.renderRevision).toBeGreaterThan(
            renderRevision
        );
        publishSubtitleState.mockClear();

        const firstWord = originalSubtitleElement.querySelector(
            '.dualsub-interactive-word'
        );
        firstWord.setAttribute('data-render-revision', '1');
        updateSubtitles(1, platform, TEST_CONFIG, 'StatePublisherTest');

        expect(publishSubtitleState).toHaveBeenCalledTimes(1);
        const staleWordRefresh = publishSubtitleState.mock.calls[0][0];
        expect(staleWordRefresh).not.toBe(missingStampRefresh);
        expect(staleWordRefresh.reason).toBe('refresh');
        expect(staleWordRefresh.renderRevision).toBeGreaterThan(
            missingStampRefresh.renderRevision
        );
        const repairedRevision = String(staleWordRefresh.renderRevision);
        expect(originalSubtitleElement).toHaveAttribute(
            'data-render-revision',
            repairedRevision
        );
        expect(
            Array.from(
                originalSubtitleElement.querySelectorAll(
                    '.dualsub-interactive-word'
                ),
                (word) => word.getAttribute('data-render-revision')
            )
        ).toEqual([repairedRevision, repairedRevision]);
    });

    test('distinguishes timed expiry from explicit full clear', () => {
        const publishSubtitleState = jest.fn();
        publisherCleanup = beginSubtitleStatePublisher({
            publishSubtitleState,
        });
        const playback = createPlayback();
        ensureSubtitleContainer(
            playback.platform,
            TEST_CONFIG,
            'StatePublisherTest'
        );
        queueOriginalCue('video-1', 'short lived', { end: 2 });
        updateSubtitles(
            1,
            playback.platform,
            TEST_CONFIG,
            'StatePublisherTest'
        );
        const renderPayload = publishSubtitleState.mock.calls[0][0];
        publishSubtitleState.mockClear();

        playback.setPlaybackTime(3);
        const didExpire = finalizeExpiredSubtitleIfNeeded(
            0.1,
            playback.platform
        );
        expect(didExpire).toBe(true);

        expect(publishSubtitleState).toHaveBeenCalledTimes(1);
        const expiredPayload = publishSubtitleState.mock.calls[0][0];
        expectExactFrozenPayload(expiredPayload, {
            renderRevision: expect.any(Number),
            reason: 'expired',
            videoId: 'video-1',
            text: '',
        });
        expect(expiredPayload).not.toBe(renderPayload);
        expect(expiredPayload.renderRevision).toBeGreaterThan(
            renderPayload.renderRevision
        );
        expect(originalSubtitleElement).not.toHaveAttribute(
            'data-render-revision'
        );

        subtitleQueue.splice(0);
        queueOriginalCue('video-1', 'render again');
        updateSubtitles(
            1,
            playback.platform,
            TEST_CONFIG,
            'StatePublisherTest'
        );
        const secondRenderPayload = publishSubtitleState.mock.calls[1][0];
        publishSubtitleState.mockClear();

        clearSubtitlesDisplayAndQueue(playback.platform, true);

        expect(publishSubtitleState).toHaveBeenCalledTimes(1);
        const clearPayload = publishSubtitleState.mock.calls[0][0];
        expectExactFrozenPayload(clearPayload, {
            renderRevision: expect.any(Number),
            reason: 'clear',
            videoId: null,
            text: '',
        });
        expect(clearPayload).not.toBe(expiredPayload);
        expect(clearPayload.renderRevision).toBeGreaterThan(
            secondRenderPayload.renderRevision
        );
        expect(originalSubtitleElement).not.toHaveAttribute(
            'data-render-revision'
        );
    });

    test.each([
        ['container hide', () => hideSubtitleContainer()],
        ['DOM teardown', () => clearSubtitleDOM()],
        [
            'video ID change',
            () => {
                setCurrentVideoId('video-1');
                handleVideoIdChange('video-2', 'StatePublisherTest');
            },
        ],
    ])('routes %s through one explicit clear commit', (_label, clearRoute) => {
        const publishSubtitleState = jest.fn();
        publisherCleanup = beginSubtitleStatePublisher({
            publishSubtitleState,
        });
        const playback = createPlayback();
        renderOriginal(playback);
        const renderPayload = publishSubtitleState.mock.calls[0][0];
        publishSubtitleState.mockClear();

        clearRoute();

        expect(publishSubtitleState).toHaveBeenCalledTimes(1);
        const clearPayload = publishSubtitleState.mock.calls[0][0];
        expectExactFrozenPayload(clearPayload, {
            renderRevision: expect.any(Number),
            reason: 'clear',
            videoId: null,
            text: '',
        });
        expect(clearPayload.renderRevision).toBeGreaterThan(
            renderPayload.renderRevision
        );
    });

    test.each([false, true])(
        'expires an original for a translated-only cue without publishing or stamping the translation (native=%s)',
        (useNativeTarget) => {
            const publishSubtitleState = jest.fn();
            publisherCleanup = beginSubtitleStatePublisher({
                publishSubtitleState,
            });
            const playback = createPlayback();
            renderOriginal(playback, 'original state');
            const renderRevision =
                publishSubtitleState.mock.calls[0][0].renderRevision;
            publishSubtitleState.mockClear();
            subtitleQueue.splice(0);
            queueTranslatedCue('video-1', 'solo traduccion', {
                useNativeTarget,
            });

            updateSubtitles(
                1,
                playback.platform,
                TEST_CONFIG,
                'StatePublisherTest'
            );

            expect(publishSubtitleState).toHaveBeenCalledTimes(1);
            const expiredPayload = publishSubtitleState.mock.calls[0][0];
            expectExactFrozenPayload(expiredPayload, {
                renderRevision: expect.any(Number),
                reason: 'expired',
                videoId: 'video-1',
                text: '',
            });
            expect(expiredPayload.renderRevision).toBeGreaterThan(
                renderRevision
            );
            expect(translatedSubtitleElement).not.toHaveAttribute(
                'data-render-revision'
            );
            expect(
                Array.from(
                    translatedSubtitleElement.querySelectorAll(
                        '.dualsub-interactive-word'
                    ),
                    (word) => word.getAttribute('data-render-revision')
                )
            ).toEqual([null, null]);
        }
    );

    test('publishes one expiry when the active cue window is truly over', () => {
        const publishSubtitleState = jest.fn();
        publisherCleanup = beginSubtitleStatePublisher({
            publishSubtitleState,
        });
        const playback = createPlayback();
        ensureSubtitleContainer(
            playback.platform,
            TEST_CONFIG,
            'StatePublisherTest'
        );
        queueOriginalCue('video-1', 'short cue', { end: 2 });
        updateSubtitles(
            1,
            playback.platform,
            TEST_CONFIG,
            'StatePublisherTest'
        );
        const renderRevision =
            publishSubtitleState.mock.calls[0][0].renderRevision;
        publishSubtitleState.mockClear();
        const afterStyleGrace = Date.now() + 1_000;
        jest.spyOn(Date, 'now').mockReturnValue(afterStyleGrace);
        subtitleQueue.splice(0);

        updateSubtitles(
            3,
            playback.platform,
            TEST_CONFIG,
            'StatePublisherTest'
        );

        expect(publishSubtitleState).toHaveBeenCalledTimes(1);
        const expiredPayload = publishSubtitleState.mock.calls[0][0];
        expectExactFrozenPayload(expiredPayload, {
            renderRevision: expect.any(Number),
            reason: 'expired',
            videoId: 'video-1',
            text: '',
        });
        expect(expiredPayload.renderRevision).toBeGreaterThan(renderRevision);
    });

    test('commits one clear across overlapping navigation guards before the next render', () => {
        const publishSubtitleState = jest.fn();
        publisherCleanup = beginSubtitleStatePublisher({
            publishSubtitleState,
        });
        const playback = createPlayback();
        renderOriginal(playback, 'old video');
        publishSubtitleState.mockClear();
        const originalUrl = window.location.href;
        history.pushState({}, '', '/packet-b-next-video');
        playback.setVideoId('video-2');
        subtitleQueue.splice(0);
        queueOriginalCue('video-2', 'new video');

        try {
            updateSubtitles(
                1,
                playback.platform,
                TEST_CONFIG,
                'StatePublisherTest'
            );
        } finally {
            history.replaceState({}, '', originalUrl);
        }

        expect(
            publishSubtitleState.mock.calls.map(([payload]) => payload.reason)
        ).toEqual(['clear', 'render']);
        const [clearPayload, renderPayload] =
            publishSubtitleState.mock.calls.map(([payload]) => payload);
        expect(clearPayload.videoId).toBeNull();
        expect(clearPayload.text).toBe('');
        expect(renderPayload.videoId).toBe('video-2');
        expect(renderPayload.text).toBe('new video');
        expect(renderPayload.renderRevision).toBeGreaterThan(
            clearPayload.renderRevision
        );
    });

    test('replacement refreshes without revision reuse and old cleanup cannot revoke it', () => {
        const firstPublisher = jest.fn();
        const secondPublisher = jest.fn();
        const firstCleanup = beginSubtitleStatePublisher({
            publishSubtitleState: firstPublisher,
        });
        const playback = createPlayback();
        renderOriginal(playback, 'lifecycle state');
        const firstRevision = firstPublisher.mock.calls[0][0].renderRevision;

        publisherCleanup = beginSubtitleStatePublisher({
            publishSubtitleState: secondPublisher,
        });
        firstCleanup();
        firstCleanup();
        updateSubtitles(
            1,
            playback.platform,
            TEST_CONFIG,
            'StatePublisherTest'
        );

        expect(firstPublisher).toHaveBeenCalledTimes(1);
        expect(secondPublisher).toHaveBeenCalledTimes(1);
        const successorRefresh = secondPublisher.mock.calls[0][0];
        expect(successorRefresh.reason).toBe('refresh');
        expect(successorRefresh.renderRevision).toBeGreaterThan(firstRevision);
        secondPublisher.mockClear();

        updateSubtitles(
            1,
            playback.platform,
            TEST_CONFIG,
            'StatePublisherTest'
        );
        expect(secondPublisher).not.toHaveBeenCalled();

        publisherCleanup();
        publisherCleanup();
        publisherCleanup = null;
        originalSubtitleElement.removeAttribute('data-render-revision');
        updateSubtitles(
            1,
            playback.platform,
            TEST_CONFIG,
            'StatePublisherTest'
        );
        expect(secondPublisher).not.toHaveBeenCalled();
    });

    test('isolates throwing publishers and ignores returned thenables', () => {
        const playback = createPlayback();
        const throwingPublisher = jest.fn(() => {
            throw new Error('SUBTITLE_PUBLISHER_FAILURE');
        });
        publisherCleanup = beginSubtitleStatePublisher({
            publishSubtitleState: throwingPublisher,
        });

        expect(() => renderOriginal(playback, 'throwing state')).not.toThrow();
        expect(throwingPublisher).toHaveBeenCalledTimes(1);
        publisherCleanup();

        const thenTrap = jest.fn(() => {
            throw new Error('PUBLISHER_THEN_ACCESSED');
        });
        const publisherResult = {};
        Object.defineProperty(publisherResult, 'then', { get: thenTrap });
        const returningPublisher = jest.fn(() => publisherResult);
        publisherCleanup = beginSubtitleStatePublisher({
            publishSubtitleState: returningPublisher,
        });
        subtitleQueue.splice(0);
        queueOriginalCue('video-1', 'thenable state');

        expect(() =>
            updateSubtitles(
                1,
                playback.platform,
                TEST_CONFIG,
                'StatePublisherTest'
            )
        ).not.toThrow();
        expect(returningPublisher).toHaveBeenCalledTimes(1);
        expect(thenTrap).not.toHaveBeenCalled();
    });

    test('does not coerce a non-function publisher into authority', () => {
        const authorityTrap = jest.fn(() => {
            throw new Error('NON_FUNCTION_PUBLISHER_ACCESSED');
        });
        const nonFunctionPublisher = new Proxy(
            {},
            {
                get: authorityTrap,
                getOwnPropertyDescriptor: authorityTrap,
                getPrototypeOf: authorityTrap,
                has: authorityTrap,
                ownKeys: authorityTrap,
            }
        );
        publisherCleanup = beginSubtitleStatePublisher({
            publishSubtitleState: nonFunctionPublisher,
        });
        const playback = createPlayback();

        expect(() => renderOriginal(playback, 'no authority')).not.toThrow();
        expect(authorityTrap).not.toHaveBeenCalled();
    });

    test('keeps the publisher out of config, DOM, document, and window values', () => {
        const publishSubtitleState = jest.fn();
        publisherCleanup = beginSubtitleStatePublisher({
            publishSubtitleState,
        });
        const playback = createPlayback();
        renderOriginal(playback, 'private state');

        expect(Object.values(TEST_CONFIG)).not.toContain(publishSubtitleState);
        for (const node of [
            document,
            document.body,
            originalSubtitleElement,
            translatedSubtitleElement,
        ]) {
            const ownValues = Reflect.ownKeys(node)
                .map((key) => Object.getOwnPropertyDescriptor(node, key))
                .filter((descriptor) => descriptor && 'value' in descriptor)
                .map((descriptor) => descriptor.value);
            expect(ownValues).not.toContain(publishSubtitleState);
        }
        expect(
            Reflect.ownKeys(window)
                .map((key) => Object.getOwnPropertyDescriptor(window, key))
                .filter((descriptor) => descriptor && 'value' in descriptor)
                .map((descriptor) => descriptor.value)
        ).not.toContain(publishSubtitleState);
        for (const node of [
            originalSubtitleElement,
            translatedSubtitleElement,
        ]) {
            expect(
                Array.from(node.attributes, (attribute) => attribute.value)
            ).not.toContain(String(publishSubtitleState));
        }
    });

    test.each([' ', 'v'.repeat(257), '\ud800'])(
        'revokes prior authority for invalid video ID %p',
        (invalidVideoId) => {
            const publishSubtitleState = jest.fn();
            publisherCleanup = beginSubtitleStatePublisher({
                publishSubtitleState,
            });
            const playback = createPlayback();
            renderOriginal(playback, 'valid state');
            publishSubtitleState.mockClear();
            playback.setVideoId(invalidVideoId);
            subtitleQueue.splice(0);
            queueOriginalCue(invalidVideoId, 'public fallback');

            updateSubtitles(
                1,
                playback.platform,
                TEST_CONFIG,
                'StatePublisherTest'
            );

            expect(publishSubtitleState).toHaveBeenCalledTimes(1);
            const clearPayload = publishSubtitleState.mock.calls[0][0];
            expectExactFrozenPayload(clearPayload, {
                renderRevision: expect.any(Number),
                reason: 'clear',
                videoId: null,
                text: '',
            });
            expect(originalSubtitleElement.textContent).toBe('public fallback');
            expect(originalSubtitleElement).not.toHaveAttribute(
                'data-render-revision'
            );
            const wordRevisions = Array.from(
                originalSubtitleElement.querySelectorAll(
                    '.dualsub-interactive-word'
                ),
                (word) => word.getAttribute('data-render-revision')
            );
            expect(wordRevisions).toEqual([null, null]);
        }
    );

    test.each([null, undefined, '', 7])(
        'classifies invalid video ID %p as clear, never expired',
        (invalidVideoId) => {
            const publishSubtitleState = jest.fn();
            publisherCleanup = beginSubtitleStatePublisher({
                publishSubtitleState,
            });
            const playback = createPlayback();
            renderOriginal(playback, 'valid state');
            publishSubtitleState.mockClear();
            playback.setVideoId(invalidVideoId);
            subtitleQueue.splice(0);
            queueOriginalCue(invalidVideoId, 'invalid video state');

            updateSubtitles(
                1,
                playback.platform,
                TEST_CONFIG,
                'StatePublisherTest'
            );

            expect(publishSubtitleState).toHaveBeenCalledTimes(1);
            const clearPayload = publishSubtitleState.mock.calls[0][0];
            expectExactFrozenPayload(clearPayload, {
                renderRevision: expect.any(Number),
                reason: 'clear',
                videoId: null,
                text: '',
            });
            expect(originalSubtitleElement).not.toHaveAttribute(
                'data-render-revision'
            );
        }
    );

    test.each(['x'.repeat(4_097), '\ud800 malformed'])(
        'revokes prior authority without publishing schema-invalid text %#',
        (invalidText) => {
            const publishSubtitleState = jest.fn();
            publisherCleanup = beginSubtitleStatePublisher({
                publishSubtitleState,
            });
            const playback = createPlayback();
            renderOriginal(playback, 'valid state');
            publishSubtitleState.mockClear();
            subtitleQueue.splice(0);
            queueOriginalCue('video-1', invalidText);

            updateSubtitles(
                1,
                playback.platform,
                TEST_CONFIG,
                'StatePublisherTest'
            );

            expect(publishSubtitleState).toHaveBeenCalledTimes(1);
            const clearPayload = publishSubtitleState.mock.calls[0][0];
            expectExactFrozenPayload(clearPayload, {
                renderRevision: expect.any(Number),
                reason: 'clear',
                videoId: null,
                text: '',
            });
            expect(originalSubtitleElement).not.toHaveAttribute(
                'data-render-revision'
            );
            const wordRevisions = Array.from(
                originalSubtitleElement.querySelectorAll(
                    '.dualsub-interactive-word'
                ),
                (word) => word.getAttribute('data-render-revision')
            );
            expect(wordRevisions.every((revision) => revision === null)).toBe(
                true
            );
        }
    );

    test('an invalid first render stays public but creates no private state', () => {
        const publishSubtitleState = jest.fn();
        publisherCleanup = beginSubtitleStatePublisher({
            publishSubtitleState,
        });
        const playback = createPlayback();
        ensureSubtitleContainer(
            playback.platform,
            TEST_CONFIG,
            'StatePublisherTest'
        );
        const invalidText = 'x'.repeat(4_097);
        queueOriginalCue('video-1', invalidText);

        updateSubtitles(
            1,
            playback.platform,
            TEST_CONFIG,
            'StatePublisherTest'
        );

        expect(publishSubtitleState).not.toHaveBeenCalled();
        expect(originalSubtitleElement.textContent).toBe(invalidText);
        expect(originalSubtitleElement).not.toHaveAttribute(
            'data-render-revision'
        );
    });
});
