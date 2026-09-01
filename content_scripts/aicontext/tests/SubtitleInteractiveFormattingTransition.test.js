import { jest } from '@jest/globals';

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

let subtitleUtils;
let publisherCleanup;
let formatterCleanups;

function createPlatform() {
    const video = document.createElement('video');
    document.body.appendChild(video);
    return {
        getCurrentVideoId: () => 'video-1',
        getPlaybackTime: () => 1,
        getVideoElement: () => video,
        getPlayerContainerElement: () => document.body,
        isPlayerPageActive: () => true,
        supportsProgressBarTracking: () => false,
    };
}

function render(platform, text) {
    subtitleUtils.ensureSubtitleContainer(platform, CONFIG, 'TransitionTest');
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
    subtitleUtils.updateSubtitles(1, platform, CONFIG, 'TransitionTest');
}

function occurrenceFor(container, wordIndex = 0) {
    const word = container.querySelectorAll('.dualsub-interactive-word')[
        wordIndex
    ];
    return {
        target: word,
        value: {
            renderRevision: Number(
                container.getAttribute('data-render-revision')
            ),
            wordIndex,
            word: word.getAttribute('data-word'),
        },
    };
}

function invokeClick(handler, container, target) {
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
        subtitleUtils = await import('../../shared/subtitleUtilities.js');
        subtitleUtils.setSubtitlesActive(true);
        publisherCleanup = null;
        formatterCleanups = [];
    });

    afterEach(() => {
        formatterCleanups.reverse().forEach((cleanup) => cleanup?.());
        publisherCleanup?.();
        subtitleUtils.clearSubtitlesDisplayAndQueue(null, true);
        subtitleUtils.clearSubtitleDOM();
        document.body.replaceChildren();
        jest.restoreAllMocks();
    });

    test('turning on interactivity refreshes and binds the current plain cue once', async () => {
        const publishSubtitleState = jest.fn();
        publisherCleanup = subtitleUtils.beginSubtitleStatePublisher({
            publishSubtitleState,
        });
        const platform = createPlatform();
        render(platform, 'hello world');
        const plainRevision =
            publishSubtitleState.mock.calls[0][0].renderRevision;

        const cleanup =
            await subtitleUtils.initializeInteractiveSubtitleFeatures(
                { platform: 'netflix' },
                () => true,
                jest.fn()
            );
        formatterCleanups.push(cleanup);

        const container = subtitleUtils.originalSubtitleElement;
        const words = container.querySelectorAll('.dualsub-interactive-word');
        expect(words).toHaveLength(2);
        expect(publishSubtitleState).toHaveBeenCalledTimes(2);
        expect(publishSubtitleState.mock.calls[1][0]).toEqual(
            expect.objectContaining({
                reason: 'refresh',
                videoId: 'video-1',
                text: 'hello world',
                renderRevision: expect.any(Number),
            })
        );
        expect(
            publishSubtitleState.mock.calls[1][0].renderRevision
        ).toBeGreaterThan(plainRevision);
        expect(container).toHaveAttribute('data-interactive-listeners', 'true');

        const firstWord = words[0];
        subtitleUtils.updateSubtitles(1, platform, CONFIG, 'TransitionTest');
        expect(publishSubtitleState).toHaveBeenCalledTimes(2);
        expect(container.querySelector('.dualsub-interactive-word')).toBe(
            firstWord
        );
    });

    test('disable revokes occurrence resolution and re-enable restores the binding', async () => {
        const publishWordIntent = jest.fn();
        const cleanup =
            await subtitleUtils.initializeInteractiveSubtitleFeatures(
                { platform: 'netflix', debounceDelay: 0 },
                () => true,
                publishWordIntent
            );
        formatterCleanups.push(cleanup);
        const platform = createPlatform();
        render(platform, 'toggle cue');
        const container = subtitleUtils.originalSubtitleElement;
        const occurrence = occurrenceFor(container);

        subtitleUtils.setInteractiveSubtitlesEnabled(false);
        expect(
            subtitleUtils.resolveInteractiveOriginalWordOccurrence(
                occurrence.value
            )
        ).toBeNull();

        const addEventListener = jest.spyOn(container, 'addEventListener');
        subtitleUtils.setInteractiveSubtitlesEnabled(true);
        const clickHandler = addEventListener.mock.calls.find(
            ([type]) => type === 'click'
        )[1];
        invokeClick(clickHandler, container, occurrence.target);

        expect(container).toHaveAttribute('data-interactive-listeners', 'true');
        expect(
            subtitleUtils.resolveInteractiveOriginalWordOccurrence(
                occurrence.value
            )
        ).toBe(occurrence.target);
        expect(publishWordIntent).toHaveBeenCalledTimes(1);
    });

    test('replacement lifecycle preserves the render and alone owns word intents', async () => {
        const firstPublisher = jest.fn();
        const secondPublisher = jest.fn();
        const firstCleanup =
            await subtitleUtils.initializeInteractiveSubtitleFeatures(
                { platform: 'netflix', debounceDelay: 0 },
                () => true,
                firstPublisher
            );
        formatterCleanups.push(firstCleanup);
        const platform = createPlatform();
        render(platform, 'same cue');
        const container = subtitleUtils.originalSubtitleElement;
        const occurrence = occurrenceFor(container);
        const html = container.innerHTML;
        const revision = container.getAttribute('data-render-revision');
        const addEventListener = jest.spyOn(container, 'addEventListener');

        const secondCleanup =
            await subtitleUtils.initializeInteractiveSubtitleFeatures(
                { platform: 'netflix', debounceDelay: 0 },
                () => true,
                secondPublisher
            );
        formatterCleanups.push(secondCleanup);
        firstCleanup();

        expect(container.innerHTML).toBe(html);
        expect(container).toHaveAttribute('data-render-revision', revision);
        expect(
            subtitleUtils.resolveInteractiveOriginalWordOccurrence(
                occurrence.value
            )
        ).toBe(occurrence.target);
        const clickHandler = addEventListener.mock.calls.find(
            ([type]) => type === 'click'
        )[1];
        invokeClick(clickHandler, container, occurrence.target);
        expect(firstPublisher).not.toHaveBeenCalled();
        expect(secondPublisher).toHaveBeenCalledTimes(1);

        occurrence.target.setAttribute('data-word-index', '99');
        expect(
            subtitleUtils.resolveInteractiveOriginalWordOccurrence(
                occurrence.value
            )
        ).toBeNull();
        secondCleanup();
        expect(
            subtitleUtils.resolveInteractiveOriginalWordOccurrence(
                occurrence.value
            )
        ).toBeNull();
    });
});
