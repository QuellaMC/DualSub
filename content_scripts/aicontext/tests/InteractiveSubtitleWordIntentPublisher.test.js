import {
    afterEach,
    beforeEach,
    describe,
    expect,
    jest,
    test,
} from '@jest/globals';
import {
    attachInteractiveEventListeners,
    beginInteractiveLifecycle as beginFormatterLifecycle,
    formatInteractiveSubtitleText,
    getStableSpanId,
    initializeInteractiveSubtitles,
    projectInteractiveWordIntent,
    resolveInteractiveOriginalWordOccurrence,
    setInteractiveEnabled,
} from '../../shared/interactiveSubtitleFormatter.js';

let cleanup = null;
let bindingSnapshots;

function captureBinding(container) {
    const renderRevision = Number(
        container.getAttribute('data-render-revision')
    );
    const occurrences = Array.from(
        container.querySelectorAll(
            '.dualsub-interactive-word[data-subtitle-type="original"]'
        ),
        (element, wordIndex) =>
            Object.freeze({
                element,
                renderRevision,
                wordIndex,
                word: element.getAttribute('data-word'),
                sourceLanguage: element.getAttribute('data-source-lang'),
                targetLanguage: element.getAttribute('data-target-lang'),
            })
    );
    const snapshot = Object.freeze({
        element: container,
        renderRevision,
        occurrences: Object.freeze(occurrences),
    });
    bindingSnapshots.set(container, snapshot);
    return snapshot;
}

function beginLifecycle(publishWordIntent) {
    return beginFormatterLifecycle({
        publishWordIntent,
        resolveOriginalWordBindingSnapshot: (container) =>
            bindingSnapshots.get(container) ?? null,
    });
}

function createOriginalWords(text = 'hello world', renderRevision = 1) {
    const container = document.createElement('div');
    container.id = 'dualsub-original-subtitle';
    container.setAttribute('data-render-revision', String(renderRevision));
    container.innerHTML = formatInteractiveSubtitleText(text, {
        sourceLanguage: 'en',
        targetLanguage: 'es',
        subtitleType: 'original',
        renderRevision,
    });
    document.body.appendChild(container);
    captureBinding(container);
    return {
        container,
        words: [...container.querySelectorAll('.dualsub-interactive-word')],
    };
}

function trustedActivation(container, target, overrides = {}) {
    return {
        isTrusted: true,
        type: 'click',
        target,
        currentTarget: container,
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
        ...overrides,
    };
}

function install(container, publishWordIntent) {
    const addEventListener = jest.spyOn(container, 'addEventListener');
    cleanup = beginLifecycle(publishWordIntent);
    expect(attachInteractiveEventListeners(container)).toBe(true);
    return Object.fromEntries(
        addEventListener.mock.calls.map(([type, listener]) => [type, listener])
    );
}

describe('interactive subtitle word intents', () => {
    beforeEach(() => {
        bindingSnapshots = new WeakMap();
        initializeInteractiveSubtitles({
            enabled: true,
            clickableWords: true,
            debounceDelay: 0,
        });
    });

    afterEach(() => {
        cleanup?.();
        cleanup = null;
        setInteractiveEnabled(true);
        document.body.replaceChildren();
        jest.restoreAllMocks();
    });

    test('formats accessible original-word occurrences with one render revision', () => {
        const { words } = createOriginalWords();

        expect(words).toHaveLength(2);
        expect(words.map((word) => word.id)).toEqual([
            getStableSpanId('original', 0),
            getStableSpanId('original', 1),
        ]);
        expect(words.map((word) => word.dataset.renderRevision)).toEqual([
            '1',
            '1',
        ]);
        expect(
            words.every((word) => word.getAttribute('role') === 'button')
        ).toBe(true);
        expect(words.every((word) => !word.hasAttribute('data-context'))).toBe(
            true
        );
    });

    test('publishes one canonical intent for a trusted click', () => {
        const publishWordIntent = jest.fn();
        const { container, words } = createOriginalWords('hello');
        const handlers = install(container, publishWordIntent);
        const event = trustedActivation(container, words[0]);

        handlers.click(event);

        expect(event.preventDefault).toHaveBeenCalledTimes(1);
        expect(event.stopPropagation).toHaveBeenCalledTimes(1);
        expect(publishWordIntent).toHaveBeenCalledWith({
            action: 'toggle',
            renderRevision: 1,
            wordIndex: 0,
            word: 'hello',
            sourceLanguage: 'en',
            targetLanguage: 'es',
        });
    });

    test('resolves only the registered occurrence with unchanged presentation', () => {
        const { container, words } = createOriginalWords('hello');
        cleanup = beginLifecycle(jest.fn());
        expect(attachInteractiveEventListeners(container)).toBe(true);
        const occurrence = {
            renderRevision: 1,
            wordIndex: 0,
            word: 'hello',
        };

        expect(resolveInteractiveOriginalWordOccurrence(occurrence)).toBe(
            words[0]
        );

        words[0].textContent = 'changed';
        expect(resolveInteractiveOriginalWordOccurrence(occurrence)).toBeNull();
    });

    test('rejects forged, translated, detached, and stale word targets', () => {
        const publishWordIntent = jest.fn();
        const { container, words } = createOriginalWords('hello');
        const handlers = install(container, publishWordIntent);

        const forged = words[0].cloneNode(true);
        container.appendChild(forged);
        expect(
            projectInteractiveWordIntent(trustedActivation(container, forged))
        ).toBeNull();

        words[0].setAttribute('data-subtitle-type', 'translated');
        handlers.click(trustedActivation(container, words[0]));
        words[0].setAttribute('data-subtitle-type', 'original');
        words[0].setAttribute('data-render-revision', '2');
        handlers.click(trustedActivation(container, words[0]));
        words[0].remove();
        handlers.click(trustedActivation(container, words[0]));

        expect(publishWordIntent).not.toHaveBeenCalled();
    });

    test('Enter and Space publish through the same word-intent path', () => {
        const publishWordIntent = jest.fn();
        const { container, words } = createOriginalWords('hello');
        const handlers = install(container, publishWordIntent);

        for (const key of ['Enter', ' ']) {
            handlers.keydown(
                trustedActivation(container, words[0], {
                    type: 'keydown',
                    key,
                })
            );
        }
        handlers.keydown(
            trustedActivation(container, words[0], {
                type: 'keydown',
                key: 'Escape',
            })
        );

        expect(publishWordIntent).toHaveBeenCalledTimes(2);
    });

    test('disabled and analyzing states suppress publication', () => {
        const publishWordIntent = jest.fn();
        const { container, words } = createOriginalWords('hello');
        const handlers = install(container, publishWordIntent);

        setInteractiveEnabled(false);
        handlers.click(trustedActivation(container, words[0]));
        setInteractiveEnabled(true);

        const modal = document.createElement('div');
        modal.id = 'dualsub-modal-content';
        modal.className = 'is-analyzing';
        document.body.appendChild(modal);
        handlers.click(trustedActivation(container, words[0]));

        expect(publishWordIntent).not.toHaveBeenCalled();
    });

    test('replacing or cleaning a lifecycle makes saved handlers inert', () => {
        const firstPublisher = jest.fn();
        const secondPublisher = jest.fn();
        const first = createOriginalWords('first', 1);
        const firstHandlers = install(first.container, firstPublisher);
        const firstCleanup = cleanup;

        first.container.remove();
        const second = createOriginalWords('second', 2);
        cleanup = beginLifecycle(secondPublisher);
        const secondAdd = jest.spyOn(second.container, 'addEventListener');
        expect(attachInteractiveEventListeners(second.container)).toBe(true);
        const secondClick = secondAdd.mock.calls.find(
            ([type]) => type === 'click'
        )[1];

        firstHandlers.click(trustedActivation(first.container, first.words[0]));
        firstCleanup();
        secondClick(trustedActivation(second.container, second.words[0]));
        cleanup();
        secondClick(trustedActivation(second.container, second.words[0]));

        expect(firstPublisher).not.toHaveBeenCalled();
        expect(secondPublisher).toHaveBeenCalledTimes(1);
    });
});
