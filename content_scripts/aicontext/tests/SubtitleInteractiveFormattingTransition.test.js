import { jest } from '@jest/globals';

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

let subtitleUtils;
let publisherCleanup;
let formatterCleanups;

function createPlayback(videoId = 'video-1') {
    const video = document.createElement('video');
    document.body.appendChild(video);
    return {
        getCurrentVideoId: () => videoId,
        getPlaybackTime: () => 1,
        getVideoElement: () => video,
        getPlayerContainerElement: () => document.body,
        isPlayerPageActive: () => true,
        supportsProgressBarTracking: () => false,
    };
}

function queueOriginalCue(text) {
    subtitleUtils.subtitleQueue.push({
        original: text,
        translated: null,
        start: 0,
        end: 10,
        videoId: 'video-1',
        useNativeTarget: false,
        sourceLanguage: 'en',
        targetLanguage: 'es',
        cueType: 'original',
    });
}

function renderCurrentCue(platform, text) {
    subtitleUtils.ensureSubtitleContainer(
        platform,
        TEST_CONFIG,
        'InteractiveFormattingTransitionTest'
    );
    queueOriginalCue(text);
    subtitleUtils.updateSubtitles(
        1,
        platform,
        TEST_CONFIG,
        'InteractiveFormattingTransitionTest'
    );
}

function invokeTrustedClick(handler, container, target) {
    handler({
        isTrusted: true,
        type: 'click',
        target,
        currentTarget: container,
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
    });
}

describe('interactive subtitle formatting transitions', () => {
    beforeEach(async () => {
        jest.resetModules();
        document.body.replaceChildren();
        delete window.dualsub_formatInteractiveSubtitleText;
        delete window.dualsub_attachInteractiveEventListeners;
        delete window.dualsub_setInteractiveEnabled;
        subtitleUtils = await import('../../shared/subtitleUtilities.js');
        subtitleUtils.setSubtitlesActive(true);
        publisherCleanup = null;
        formatterCleanups = [];
    });

    afterEach(() => {
        for (const cleanup of formatterCleanups.reverse()) cleanup?.();
        publisherCleanup?.();
        subtitleUtils.clearSubtitlesDisplayAndQueue(null, true);
        subtitleUtils.clearSubtitleDOM();
        document.body.replaceChildren();
        jest.restoreAllMocks();
    });

    test('refreshes and binds a current plain cue exactly once when formatting becomes interactive', async () => {
        const publishSubtitleState = jest.fn();
        publisherCleanup = subtitleUtils.beginSubtitleStatePublisher({
            publishSubtitleState,
        });
        const platform = createPlayback();
        renderCurrentCue(platform, 'hello world');

        const plainRevision =
            publishSubtitleState.mock.calls[0][0].renderRevision;
        expect(
            subtitleUtils.originalSubtitleElement.querySelectorAll(
                '.dualsub-interactive-word'
            )
        ).toHaveLength(0);
        expect(subtitleUtils.originalSubtitleElement).not.toHaveAttribute(
            'data-interactive-listeners'
        );

        const cleanup =
            await subtitleUtils.initializeInteractiveSubtitleFeatures(
                { platform: 'netflix' },
                () => true,
                jest.fn()
            );
        formatterCleanups.push(cleanup);

        expect(publishSubtitleState).toHaveBeenCalledTimes(2);
        const refresh = publishSubtitleState.mock.calls[1][0];
        expect(refresh).toEqual(
            expect.objectContaining({
                reason: 'refresh',
                videoId: 'video-1',
                text: 'hello world',
            })
        );
        expect(refresh.renderRevision).toBeGreaterThan(plainRevision);
        const words = Array.from(
            subtitleUtils.originalSubtitleElement.querySelectorAll(
                '.dualsub-interactive-word[data-subtitle-type="original"]'
            )
        );
        expect(words).toHaveLength(2);
        expect(
            words.map((word) => ({
                revision: word.getAttribute('data-render-revision'),
                sourceLanguage: word.getAttribute('data-source-lang'),
                targetLanguage: word.getAttribute('data-target-lang'),
            }))
        ).toEqual([
            {
                revision: String(refresh.renderRevision),
                sourceLanguage: 'en',
                targetLanguage: 'es',
            },
            {
                revision: String(refresh.renderRevision),
                sourceLanguage: 'en',
                targetLanguage: 'es',
            },
        ]);
        expect(subtitleUtils.originalSubtitleElement).toHaveAttribute(
            'data-interactive-listeners',
            'true'
        );

        const firstWord = words[0];
        subtitleUtils.updateSubtitles(
            1,
            platform,
            TEST_CONFIG,
            'InteractiveFormattingTransitionTest'
        );
        expect(publishSubtitleState).toHaveBeenCalledTimes(2);
        expect(
            subtitleUtils.originalSubtitleElement.querySelector(
                '.dualsub-interactive-word'
            )
        ).toBe(firstWord);
    });

    test('explicit disable invalidates a pending formatter initialization', async () => {
        const publishSubtitleState = jest.fn();
        publisherCleanup = subtitleUtils.beginSubtitleStatePublisher({
            publishSubtitleState,
        });
        const publishWordIntent = jest.fn();
        const platform = createPlayback();
        renderCurrentCue(platform, 'remain plain');

        const pendingInitialization =
            subtitleUtils.initializeInteractiveSubtitleFeatures(
                { platform: 'netflix', debounceDelay: 0 },
                () => true,
                publishWordIntent
            );
        subtitleUtils.setInteractiveSubtitlesEnabled(false);
        const cleanup = await pendingInitialization;
        formatterCleanups.push(cleanup);
        subtitleUtils.updateSubtitles(
            1,
            platform,
            TEST_CONFIG,
            'InteractiveFormattingTransitionTest'
        );

        expect(publishSubtitleState).toHaveBeenCalledTimes(1);
        expect(
            subtitleUtils.originalSubtitleElement.querySelectorAll(
                '.dualsub-interactive-word'
            )
        ).toHaveLength(0);
        expect(subtitleUtils.originalSubtitleElement).not.toHaveAttribute(
            'data-interactive-listeners'
        );
        expect(publishWordIntent).not.toHaveBeenCalled();
        expect(window.dualsub_attachInteractiveEventListeners).toBeUndefined();
    });

    test('reenabling an installed lifecycle rebinds the unchanged current cue', async () => {
        const publishSubtitleState = jest.fn();
        publisherCleanup = subtitleUtils.beginSubtitleStatePublisher({
            publishSubtitleState,
        });
        const publishWordIntent = jest.fn();
        const cleanup =
            await subtitleUtils.initializeInteractiveSubtitleFeatures(
                { platform: 'netflix', debounceDelay: 0 },
                () => true,
                publishWordIntent
            );
        formatterCleanups.push(cleanup);
        const platform = createPlayback();
        renderCurrentCue(platform, 'toggle cue');
        const container = subtitleUtils.originalSubtitleElement;
        const target = container.querySelector('.dualsub-interactive-word');
        const occurrence = {
            renderRevision: Number(
                container.getAttribute('data-render-revision')
            ),
            wordIndex: 0,
            word: 'toggle',
        };
        const addEventListener = jest.spyOn(container, 'addEventListener');

        subtitleUtils.setInteractiveSubtitlesEnabled(false);
        expect(container).not.toHaveAttribute('data-interactive-listeners');
        expect(
            subtitleUtils.resolveInteractiveOriginalWordOccurrence(occurrence)
        ).toBeNull();

        subtitleUtils.setInteractiveSubtitlesEnabled(true);
        const clickHandler = addEventListener.mock.calls.find(
            ([type]) => type === 'click'
        )[1];
        invokeTrustedClick(clickHandler, container, target);

        expect(publishSubtitleState).toHaveBeenCalledTimes(1);
        expect(container).toHaveAttribute('data-interactive-listeners', 'true');
        expect(
            subtitleUtils.resolveInteractiveOriginalWordOccurrence(occurrence)
        ).toBe(target);
        expect(publishWordIntent).toHaveBeenCalledTimes(1);
    });

    test('replaces lifecycle ownership without rerendering the current interactive cue', async () => {
        const publishSubtitleState = jest.fn();
        publisherCleanup = subtitleUtils.beginSubtitleStatePublisher({
            publishSubtitleState,
        });
        const firstPublisher = jest.fn();
        const secondPublisher = jest.fn();
        const cleanupFirst =
            await subtitleUtils.initializeInteractiveSubtitleFeatures(
                { platform: 'netflix', debounceDelay: 0 },
                () => true,
                firstPublisher
            );
        formatterCleanups.push(cleanupFirst);
        const platform = createPlayback();
        renderCurrentCue(platform, 'same cue');
        const container = subtitleUtils.originalSubtitleElement;
        const firstWord = container.querySelector('.dualsub-interactive-word');
        const renderRevision = container.getAttribute('data-render-revision');
        const renderedHtml = container.innerHTML;
        const addEventListener = jest.spyOn(container, 'addEventListener');

        const occurrence = {
            renderRevision: Number(renderRevision),
            wordIndex: 0,
            word: 'same',
        };
        const secondInitialization =
            subtitleUtils.initializeInteractiveSubtitleFeatures(
                { platform: 'netflix', debounceDelay: 0 },
                () => true,
                secondPublisher
            );
        expect(
            subtitleUtils.resolveInteractiveOriginalWordOccurrence(occurrence)
        ).toBeNull();
        const cleanupSecond = await secondInitialization;
        formatterCleanups.push(cleanupSecond);

        expect(publishSubtitleState).toHaveBeenCalledTimes(1);
        expect(container).toHaveAttribute(
            'data-render-revision',
            renderRevision
        );
        expect(container.innerHTML).toBe(renderedHtml);
        expect(container.querySelector('.dualsub-interactive-word')).toBe(
            firstWord
        );
        expect(container).toHaveAttribute('data-interactive-listeners', 'true');
        expect(
            subtitleUtils.resolveInteractiveOriginalWordOccurrence(occurrence)
        ).toBe(firstWord);
        const clickHandlers = addEventListener.mock.calls.filter(
            ([type]) => type === 'click'
        );
        expect(clickHandlers).toHaveLength(1);

        cleanupFirst();
        cleanupFirst();
        invokeTrustedClick(clickHandlers[0][1], container, firstWord);
        expect(firstPublisher).not.toHaveBeenCalled();
        expect(secondPublisher).toHaveBeenCalledTimes(1);
        expect(container).toHaveAttribute('data-interactive-listeners', 'true');
    });

    test('exports only the current exact registered original occurrence', async () => {
        const cleanup =
            await subtitleUtils.initializeInteractiveSubtitleFeatures(
                { platform: 'netflix', debounceDelay: 0 },
                () => true,
                jest.fn()
            );
        formatterCleanups.push(cleanup);
        const platform = createPlayback();
        renderCurrentCue(platform, 'registry word');
        const container = subtitleUtils.originalSubtitleElement;
        const target = container.querySelector('.dualsub-interactive-word');
        const occurrence = {
            renderRevision: Number(
                container.getAttribute('data-render-revision')
            ),
            wordIndex: 0,
            word: 'registry',
        };

        expect(
            subtitleUtils.resolveInteractiveOriginalWordOccurrence(occurrence)
        ).toBe(target);
        target.setAttribute('data-word-index', '1');
        expect(
            subtitleUtils.resolveInteractiveOriginalWordOccurrence(occurrence)
        ).toBeNull();
        target.setAttribute('data-word-index', '0');
        cleanup();
        expect(
            subtitleUtils.resolveInteractiveOriginalWordOccurrence(occurrence)
        ).toBeNull();
    });

    test('abandons a lifecycle superseded reentrantly during immediate attach', async () => {
        const publishSubtitleState = jest.fn();
        publisherCleanup = subtitleUtils.beginSubtitleStatePublisher({
            publishSubtitleState,
        });
        const firstPublisher = jest.fn();
        const secondPublisher = jest.fn();
        const finalPublisher = jest.fn();
        const cleanupFirst =
            await subtitleUtils.initializeInteractiveSubtitleFeatures(
                { platform: 'netflix', debounceDelay: 0 },
                () => true,
                firstPublisher
            );
        formatterCleanups.push(cleanupFirst);
        const platform = createPlayback();
        renderCurrentCue(platform, 'reentrant cue');
        const container = subtitleUtils.originalSubtitleElement;
        const target = container.querySelector('.dualsub-interactive-word');
        const nativeAddEventListener =
            container.addEventListener.bind(container);
        let finalInitialization = null;
        let triggerSupersession = true;
        const addEventListener = jest
            .spyOn(container, 'addEventListener')
            .mockImplementation((type, listener, options) => {
                if (type === 'click' && triggerSupersession) {
                    triggerSupersession = false;
                    finalInitialization =
                        subtitleUtils.initializeInteractiveSubtitleFeatures(
                            { platform: 'netflix', debounceDelay: 0 },
                            () => true,
                            finalPublisher
                        );
                }
                nativeAddEventListener(type, listener, options);
            });

        const cleanupSecond =
            await subtitleUtils.initializeInteractiveSubtitleFeatures(
                { platform: 'netflix', debounceDelay: 0 },
                () => true,
                secondPublisher
            );
        formatterCleanups.push(cleanupSecond);
        const cleanupFinal = await finalInitialization;
        formatterCleanups.push(cleanupFinal);

        cleanupFirst();
        cleanupSecond();
        const clickHandler = addEventListener.mock.calls
            .filter(([type]) => type === 'click')
            .at(-1)[1];
        invokeTrustedClick(clickHandler, container, target);

        expect(publishSubtitleState).toHaveBeenCalledTimes(1);
        expect(firstPublisher).not.toHaveBeenCalled();
        expect(secondPublisher).not.toHaveBeenCalled();
        expect(finalPublisher).toHaveBeenCalledTimes(1);
        expect(container).toHaveAttribute('data-interactive-listeners', 'true');
    });

    test('refreshes a word-bearing interactive render whose occurrence identity was stripped', async () => {
        const publishSubtitleState = jest.fn();
        publisherCleanup = subtitleUtils.beginSubtitleStatePublisher({
            publishSubtitleState,
        });
        const cleanupFirst =
            await subtitleUtils.initializeInteractiveSubtitleFeatures(
                { platform: 'netflix' },
                () => true,
                jest.fn()
            );
        formatterCleanups.push(cleanupFirst);
        const platform = createPlayback();
        renderCurrentCue(platform, 'restore words');
        const firstRevision =
            publishSubtitleState.mock.calls[0][0].renderRevision;
        subtitleUtils.originalSubtitleElement
            .querySelectorAll('.dualsub-interactive-word')
            .forEach((word) =>
                word.classList.remove('dualsub-interactive-word')
            );

        const cleanupSecond =
            await subtitleUtils.initializeInteractiveSubtitleFeatures(
                { platform: 'netflix' },
                () => true,
                jest.fn()
            );
        formatterCleanups.push(cleanupSecond);

        expect(publishSubtitleState).toHaveBeenCalledTimes(2);
        const refresh = publishSubtitleState.mock.calls[1][0];
        expect(refresh.reason).toBe('refresh');
        expect(refresh.renderRevision).toBeGreaterThan(firstRevision);
        expect(
            subtitleUtils.originalSubtitleElement.querySelectorAll(
                '.dualsub-interactive-word[data-subtitle-type="original"]'
            )
        ).toHaveLength(2);
        expect(subtitleUtils.originalSubtitleElement).toHaveAttribute(
            'data-interactive-listeners',
            'true'
        );
    });

    test('does not repeatedly refresh an interactive punctuation-only cue', async () => {
        const publishSubtitleState = jest.fn();
        publisherCleanup = subtitleUtils.beginSubtitleStatePublisher({
            publishSubtitleState,
        });
        const platform = createPlayback();
        renderCurrentCue(platform, '...');

        const cleanup =
            await subtitleUtils.initializeInteractiveSubtitleFeatures(
                { platform: 'netflix' },
                () => true,
                jest.fn()
            );
        formatterCleanups.push(cleanup);
        expect(publishSubtitleState).toHaveBeenCalledTimes(2);
        const refreshRevision =
            publishSubtitleState.mock.calls[1][0].renderRevision;
        expect(
            subtitleUtils.originalSubtitleElement.querySelectorAll(
                '.dualsub-interactive-word'
            )
        ).toHaveLength(0);

        subtitleUtils.updateSubtitles(
            1,
            platform,
            TEST_CONFIG,
            'InteractiveFormattingTransitionTest'
        );
        expect(publishSubtitleState).toHaveBeenCalledTimes(2);
        expect(subtitleUtils.originalSubtitleElement).toHaveAttribute(
            'data-render-revision',
            String(refreshRevision)
        );
    });
});
