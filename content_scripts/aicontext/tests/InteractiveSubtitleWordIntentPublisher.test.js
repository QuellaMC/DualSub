import { jest } from '@jest/globals';

import {
    attachInteractiveEventListeners,
    beginInteractiveLifecycle as beginFormatterInteractiveLifecycle,
    formatInteractiveSubtitleText,
    getInteractiveConfig,
    initializeInteractiveSubtitles,
    projectInteractiveWordIntent,
    resolveInteractiveOriginalWordOccurrence,
    setInteractiveEnabled,
} from '../../shared/interactiveSubtitleFormatter.js';

let activeCleanup = null;
let originalBindingSnapshots = new WeakMap();

function captureOriginalBindingSnapshot(container) {
    const renderRevision = Number(
        container.getAttribute('data-render-revision')
    );
    const occurrences = Object.freeze(
        Array.from(
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
        )
    );
    const snapshot = Object.freeze({
        element: container,
        renderRevision,
        occurrences,
    });
    originalBindingSnapshots.set(container, snapshot);
    return snapshot;
}

function beginInteractiveLifecycle(options = {}) {
    return beginFormatterInteractiveLifecycle({
        ...options,
        resolveOriginalWordBindingSnapshot: (container) =>
            originalBindingSnapshots.get(container) || null,
    });
}

function createOriginalWord({
    renderRevision = '1',
    wordIndex = '0',
    word = 'hello',
    sourceLanguage = 'en',
    targetLanguage = 'es',
} = {}) {
    const container = document.createElement('div');
    container.id = 'dualsub-original-subtitle';
    container.setAttribute('data-render-revision', renderRevision);

    const target = document.createElement('span');
    target.className = 'dualsub-interactive-word';
    target.setAttribute('data-subtitle-type', 'original');
    target.setAttribute('data-render-revision', renderRevision);
    target.setAttribute('data-word-index', wordIndex);
    target.setAttribute('data-word', word);
    target.setAttribute('data-source-lang', sourceLanguage);
    target.setAttribute('data-target-lang', targetLanguage);
    target.textContent = word;
    container.appendChild(target);
    document.body.appendChild(container);
    captureOriginalBindingSnapshot(container);

    return { container, target };
}

function attachRegisteredOriginal(container, options = {}) {
    return attachInteractiveEventListeners(container, options);
}

function createTrustedActivation(container, target, overrides = {}) {
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

function expectProjectionRejected(label, mutate) {
    document.body.replaceChildren();
    const subject = createOriginalWord();
    activeCleanup = beginInteractiveLifecycle({
        publishWordIntent: jest.fn(),
    });
    attachRegisteredOriginal(subject.container);
    const alternateContainer = mutate(subject);
    const projection = projectInteractiveWordIntent(
        createTrustedActivation(
            alternateContainer || subject.container,
            subject.target
        )
    );

    expect({ label, projection }).toEqual({ label, projection: null });
}

describe('interactive subtitle word-intent publisher', () => {
    afterEach(() => {
        activeCleanup?.();
        activeCleanup = null;
        originalBindingSnapshots = new WeakMap();
        document.body.replaceChildren();
        jest.restoreAllMocks();
    });

    test('projects a fresh exact intent, including index zero', () => {
        initializeInteractiveSubtitles({
            enabled: true,
            clickableWords: true,
        });
        const { container, target } = createOriginalWord();
        activeCleanup = beginInteractiveLifecycle({
            publishWordIntent: jest.fn(),
        });
        attachRegisteredOriginal(container);

        const first = projectInteractiveWordIntent(
            createTrustedActivation(container, target)
        );
        const second = projectInteractiveWordIntent(
            createTrustedActivation(container, target)
        );

        expect(first).toEqual({
            action: 'toggle',
            renderRevision: 1,
            wordIndex: 0,
            word: 'hello',
            sourceLanguage: 'en',
            targetLanguage: 'es',
        });
        expect(second).toEqual(first);
        expect(second).not.toBe(first);
        expect(Object.getPrototypeOf(first)).toBe(Object.prototype);
        expect(Object.isFrozen(first)).toBe(true);
        expect(Object.isFrozen(second)).toBe(true);
        expect(Object.keys(first)).toEqual([
            'action',
            'renderRevision',
            'wordIndex',
            'word',
            'sourceLanguage',
            'targetLanguage',
        ]);
    });

    test('stamps a valid revision on every formatted original word', () => {
        initializeInteractiveSubtitles({
            enabled: true,
            clickableWords: true,
        });
        const container = document.createElement('div');
        container.innerHTML = formatInteractiveSubtitleText('hello world', {
            sourceLanguage: 'en',
            targetLanguage: 'es',
            subtitleType: 'original',
            renderRevision: 7,
        });

        expect(
            Array.from(
                container.querySelectorAll('.dualsub-interactive-word'),
                (word) => word.getAttribute('data-render-revision')
            )
        ).toEqual(['7', '7']);
    });

    test('publishes one exact private intent for a trusted click', () => {
        initializeInteractiveSubtitles({
            enabled: true,
            clickableWords: true,
            debounceDelay: 0,
        });
        const publishWordIntent = jest.fn();
        const { container, target } = createOriginalWord();
        const addEventListener = jest.spyOn(container, 'addEventListener');
        activeCleanup = beginInteractiveLifecycle({ publishWordIntent });
        attachRegisteredOriginal(container);
        const clickHandler = addEventListener.mock.calls.find(
            ([type]) => type === 'click'
        )[1];

        clickHandler({
            isTrusted: true,
            type: 'click',
            target,
            currentTarget: container,
            preventDefault: jest.fn(),
            stopPropagation: jest.fn(),
        });

        expect(publishWordIntent).toHaveBeenCalledTimes(1);
        expect(publishWordIntent).toHaveBeenCalledWith({
            action: 'toggle',
            renderRevision: 1,
            wordIndex: 0,
            word: 'hello',
            sourceLanguage: 'en',
            targetLanguage: 'es',
        });
    });

    test('resolves only the exact registered identity with unchanged presentation', () => {
        initializeInteractiveSubtitles({
            enabled: true,
            clickableWords: true,
            debounceDelay: 0,
        });
        const publishWordIntent = jest.fn();
        const { container, target } = createOriginalWord();
        activeCleanup = beginInteractiveLifecycle({ publishWordIntent });
        attachRegisteredOriginal(container);
        const occurrence = {
            renderRevision: 1,
            wordIndex: 0,
            word: 'hello',
            sourceLanguage: 'en',
            targetLanguage: 'es',
        };

        expect(resolveInteractiveOriginalWordOccurrence(occurrence)).toBe(
            target
        );
        target.setAttribute('data-word', 'forged');
        expect(resolveInteractiveOriginalWordOccurrence(occurrence)).toBeNull();
        expect(
            projectInteractiveWordIntent(
                createTrustedActivation(container, target)
            )
        ).toBeNull();

        target.setAttribute('data-word', 'hello');
        target.textContent = 'forged';
        expect(resolveInteractiveOriginalWordOccurrence(occurrence)).toBeNull();
        expect(publishWordIntent).not.toHaveBeenCalled();
    });

    test('resolver requires own canonical fields and ignores noncanonical hints', () => {
        initializeInteractiveSubtitles({
            enabled: true,
            clickableWords: true,
            debounceDelay: 0,
        });
        const { container, target } = createOriginalWord();
        activeCleanup = beginInteractiveLifecycle({
            publishWordIntent: jest.fn(),
        });
        attachRegisteredOriginal(container);

        for (const occurrence of [
            { wordIndex: 0, word: 'hello' },
            { renderRevision: 1, word: 'hello' },
            { renderRevision: 1, wordIndex: 0 },
            { renderRevision: 2, wordIndex: 0, word: 'hello' },
            { renderRevision: 1, wordIndex: 1, word: 'hello' },
            { renderRevision: 1, wordIndex: 0, word: 'other' },
            Object.create({
                renderRevision: 1,
                wordIndex: 0,
                word: 'hello',
            }),
        ]) {
            expect(
                resolveInteractiveOriginalWordOccurrence(occurrence)
            ).toBeNull();
        }

        const getter = jest.fn(() => 1);
        const accessorIntent = { wordIndex: 0, word: 'hello' };
        Object.defineProperty(accessorIntent, 'renderRevision', {
            get: getter,
        });
        expect(
            resolveInteractiveOriginalWordOccurrence(accessorIntent)
        ).toBeNull();
        expect(getter).not.toHaveBeenCalled();

        expect(
            resolveInteractiveOriginalWordOccurrence({
                renderRevision: 1,
                wordIndex: 0,
                word: 'hello',
                sourceLanguage: 'forged-source-hint',
                targetLanguage: 'forged-target-hint',
            })
        ).toBe(target);
    });

    test('rejects a forged span appended after the accepted binding snapshot', () => {
        initializeInteractiveSubtitles({
            enabled: true,
            clickableWords: true,
            debounceDelay: 0,
        });
        const publishWordIntent = jest.fn();
        const { container, target } = createOriginalWord();
        const addEventListener = jest.spyOn(container, 'addEventListener');
        activeCleanup = beginInteractiveLifecycle({ publishWordIntent });
        attachRegisteredOriginal(container);
        const clickHandler = addEventListener.mock.calls.find(
            ([type]) => type === 'click'
        )[1];
        const forged = target.cloneNode(true);
        container.appendChild(forged);

        clickHandler(createTrustedActivation(container, forged));

        expect(publishWordIntent).not.toHaveBeenCalled();
        expect(
            resolveInteractiveOriginalWordOccurrence({
                renderRevision: 1,
                wordIndex: 0,
                word: 'hello',
            })
        ).toBeNull();
    });

    test('public attach options cannot seed an original-word registry', () => {
        initializeInteractiveSubtitles({
            enabled: true,
            clickableWords: true,
            debounceDelay: 0,
        });
        const publishWordIntent = jest.fn();
        const { container, target } = createOriginalWord();
        activeCleanup = beginFormatterInteractiveLifecycle({
            publishWordIntent,
        });

        expect(
            attachInteractiveEventListeners(container, {
                renderRevision: 1,
                originalWordElements: [target],
            })
        ).toBe(false);
        expect(container).not.toHaveAttribute('data-interactive-listeners');
        expect(
            resolveInteractiveOriginalWordOccurrence({
                renderRevision: 1,
                wordIndex: 0,
                word: 'hello',
            })
        ).toBeNull();
        expect(publishWordIntent).not.toHaveBeenCalled();
    });

    test.each([
        [
            'word and text',
            ({ target }) => {
                target.setAttribute('data-word', 'mutated');
                target.textContent = 'mutated';
            },
        ],
        [
            'word index',
            ({ target }) => target.setAttribute('data-word-index', '1'),
        ],
        [
            'source language',
            ({ target }) => target.setAttribute('data-source-lang', 'fr'),
        ],
        [
            'target language',
            ({ target }) => target.setAttribute('data-target-lang', 'de'),
        ],
        [
            'word revision',
            ({ target }) => target.setAttribute('data-render-revision', '2'),
        ],
        [
            'container revision',
            ({ container }) =>
                container.setAttribute('data-render-revision', '2'),
        ],
    ])('rejects coherent pre-binding mutation of %s', (_label, mutate) => {
        initializeInteractiveSubtitles({
            enabled: true,
            clickableWords: true,
            debounceDelay: 0,
        });
        const subject = createOriginalWord();
        mutate(subject);
        activeCleanup = beginInteractiveLifecycle({
            publishWordIntent: jest.fn(),
        });

        expect(attachRegisteredOriginal(subject.container)).toBe(false);
        expect(subject.container).not.toHaveAttribute(
            'data-interactive-listeners'
        );
        expect(
            resolveInteractiveOriginalWordOccurrence({
                renderRevision: 1,
                wordIndex: 0,
                word: 'hello',
            })
        ).toBeNull();
    });

    test.each([
        ['source language', 'data-source-lang', 'fr'],
        ['target language', 'data-target-lang', 'de'],
    ])(
        'resolver rejects live mutation of %s',
        (_label, attribute, mutatedValue) => {
            initializeInteractiveSubtitles({
                enabled: true,
                clickableWords: true,
                debounceDelay: 0,
            });
            const { container, target } = createOriginalWord();
            activeCleanup = beginInteractiveLifecycle({
                publishWordIntent: jest.fn(),
            });
            attachRegisteredOriginal(container);
            target.setAttribute(attribute, mutatedValue);

            expect(
                resolveInteractiveOriginalWordOccurrence({
                    renderRevision: 1,
                    wordIndex: 0,
                    word: 'hello',
                })
            ).toBeNull();
        }
    );

    test('resolves duplicate words by exact index and rejects reordered nodes', () => {
        initializeInteractiveSubtitles({
            enabled: true,
            clickableWords: true,
            debounceDelay: 0,
        });
        const { container, target: first } = createOriginalWord({
            word: 'same',
        });
        const second = first.cloneNode(true);
        second.setAttribute('data-word-index', '1');
        container.appendChild(second);
        captureOriginalBindingSnapshot(container);
        activeCleanup = beginInteractiveLifecycle({
            publishWordIntent: jest.fn(),
        });
        expect(attachRegisteredOriginal(container)).toBe(true);

        expect(
            resolveInteractiveOriginalWordOccurrence({
                renderRevision: 1,
                wordIndex: 0,
                word: 'same',
            })
        ).toBe(first);
        expect(
            resolveInteractiveOriginalWordOccurrence({
                renderRevision: 1,
                wordIndex: 1,
                word: 'same',
            })
        ).toBe(second);

        container.appendChild(first);

        expect(
            projectInteractiveWordIntent(
                createTrustedActivation(container, first)
            )
        ).toBeNull();
        expect(
            resolveInteractiveOriginalWordOccurrence({
                renderRevision: 1,
                wordIndex: 0,
                word: 'same',
            })
        ).toBeNull();
        expect(
            resolveInteractiveOriginalWordOccurrence({
                renderRevision: 1,
                wordIndex: 1,
                word: 'same',
            })
        ).toBeNull();
    });

    test('disabling synchronously revokes registry and saved handlers', () => {
        initializeInteractiveSubtitles({
            enabled: true,
            clickableWords: true,
            debounceDelay: 0,
        });
        const publishWordIntent = jest.fn();
        const { container, target } = createOriginalWord();
        const addEventListener = jest.spyOn(container, 'addEventListener');
        activeCleanup = beginInteractiveLifecycle({ publishWordIntent });
        expect(attachRegisteredOriginal(container)).toBe(true);
        const clickHandler = addEventListener.mock.calls.find(
            ([type]) => type === 'click'
        )[1];

        setInteractiveEnabled(false);
        clickHandler(createTrustedActivation(container, target));

        expect(container).not.toHaveAttribute('data-interactive-listeners');
        expect(publishWordIntent).not.toHaveBeenCalled();
        expect(
            resolveInteractiveOriginalWordOccurrence({
                renderRevision: 1,
                wordIndex: 0,
                word: 'hello',
            })
        ).toBeNull();
    });

    test('does not recapture mutated attributes during lifecycle replacement', () => {
        initializeInteractiveSubtitles({
            enabled: true,
            clickableWords: true,
            debounceDelay: 0,
        });
        const { container, target } = createOriginalWord();
        const firstCleanup = beginInteractiveLifecycle({
            publishWordIntent: jest.fn(),
        });
        attachRegisteredOriginal(container);
        target.setAttribute('data-word', 'redirected');

        activeCleanup = beginInteractiveLifecycle({
            publishWordIntent: jest.fn(),
        });
        firstCleanup();

        expect(attachRegisteredOriginal(container)).toBe(false);
        expect(
            resolveInteractiveOriginalWordOccurrence({
                renderRevision: 1,
                wordIndex: 0,
                word: 'hello',
            })
        ).toBeNull();
        expect(
            resolveInteractiveOriginalWordOccurrence({
                renderRevision: 1,
                wordIndex: 0,
                word: 'redirected',
            })
        ).toBeNull();
        expect(container).not.toHaveAttribute('data-interactive-listeners');
    });

    test('revokes moved and old nodes across cleanup and rebinding', () => {
        initializeInteractiveSubtitles({
            enabled: true,
            clickableWords: true,
            debounceDelay: 0,
        });
        const firstPublisher = jest.fn();
        const secondPublisher = jest.fn();
        const { container: firstContainer, target: firstTarget } =
            createOriginalWord();
        const addEventListener = jest.spyOn(firstContainer, 'addEventListener');
        const firstCleanup = beginInteractiveLifecycle({
            publishWordIntent: firstPublisher,
        });
        attachRegisteredOriginal(firstContainer);
        const savedClickHandler = addEventListener.mock.calls.find(
            ([type]) => type === 'click'
        )[1];
        const firstOccurrence = {
            renderRevision: 1,
            wordIndex: 0,
            word: 'hello',
        };
        expect(resolveInteractiveOriginalWordOccurrence(firstOccurrence)).toBe(
            firstTarget
        );

        const secondCleanup = beginInteractiveLifecycle({
            publishWordIntent: secondPublisher,
        });
        activeCleanup = secondCleanup;
        firstCleanup();
        expect(
            resolveInteractiveOriginalWordOccurrence(firstOccurrence)
        ).toBeNull();
        attachRegisteredOriginal(firstContainer);
        expect(resolveInteractiveOriginalWordOccurrence(firstOccurrence)).toBe(
            firstTarget
        );

        firstContainer.remove();
        const { container: secondContainer, target: secondTarget } =
            createOriginalWord({ renderRevision: '2', word: 'next' });
        attachRegisteredOriginal(secondContainer);
        savedClickHandler(createTrustedActivation(firstContainer, firstTarget));

        expect(firstPublisher).not.toHaveBeenCalled();
        expect(secondPublisher).not.toHaveBeenCalled();
        expect(
            resolveInteractiveOriginalWordOccurrence(firstOccurrence)
        ).toBeNull();
        expect(
            resolveInteractiveOriginalWordOccurrence({
                renderRevision: 2,
                wordIndex: 0,
                word: 'next',
            })
        ).toBe(secondTarget);

        secondCleanup();
        activeCleanup = null;
        expect(
            resolveInteractiveOriginalWordOccurrence({
                renderRevision: 2,
                wordIndex: 0,
                word: 'next',
            })
        ).toBeNull();
    });

    test('rejects trusted activation from an unbound container', () => {
        initializeInteractiveSubtitles({
            enabled: true,
            clickableWords: true,
            debounceDelay: 0,
        });
        const publishWordIntent = jest.fn();
        const { container, target } = createOriginalWord();
        const addEventListener = jest.spyOn(container, 'addEventListener');
        activeCleanup = beginInteractiveLifecycle({ publishWordIntent });
        attachRegisteredOriginal(container);
        const clickHandler = addEventListener.mock.calls.find(
            ([type]) => type === 'click'
        )[1];

        clickHandler({
            isTrusted: true,
            type: 'click',
            target,
            currentTarget: document.body,
            preventDefault: jest.fn(),
            stopPropagation: jest.fn(),
        });

        expect(publishWordIntent).not.toHaveBeenCalled();
    });

    test('current cleanup detaches and makes saved handlers inert', () => {
        initializeInteractiveSubtitles({
            enabled: true,
            clickableWords: true,
            debounceDelay: 0,
        });
        const publishWordIntent = jest.fn();
        const { container, target } = createOriginalWord();
        const addEventListener = jest.spyOn(container, 'addEventListener');
        const removeEventListener = jest.spyOn(
            container,
            'removeEventListener'
        );
        activeCleanup = beginInteractiveLifecycle({ publishWordIntent });
        attachRegisteredOriginal(container);
        const clickHandler = addEventListener.mock.calls.find(
            ([type]) => type === 'click'
        )[1];
        const keydownHandler = addEventListener.mock.calls.find(
            ([type]) => type === 'keydown'
        )[1];

        activeCleanup();
        activeCleanup = null;
        clickHandler({
            isTrusted: true,
            type: 'click',
            target,
            currentTarget: container,
            preventDefault: jest.fn(),
            stopPropagation: jest.fn(),
        });
        const preventDefault = jest.fn();
        const stopPropagation = jest.fn();
        keydownHandler({
            isTrusted: true,
            type: 'keydown',
            key: 'Enter',
            target,
            currentTarget: container,
            preventDefault,
            stopPropagation,
        });

        expect(container).not.toHaveAttribute('data-interactive-listeners');
        for (const type of [
            'click',
            'mousedown',
            'touchstart',
            'mouseenter',
            'mouseleave',
            'keydown',
        ]) {
            const handler = addEventListener.mock.calls.find(
                ([registeredType]) => registeredType === type
            )[1];
            expect(removeEventListener).toHaveBeenCalledWith(
                type,
                handler,
                true
            );
        }
        expect(publishWordIntent).not.toHaveBeenCalled();
        expect(preventDefault).not.toHaveBeenCalled();
        expect(stopPropagation).not.toHaveBeenCalled();
    });

    test('rebinding detaches the prior original container', () => {
        initializeInteractiveSubtitles({
            enabled: true,
            clickableWords: true,
            debounceDelay: 0,
        });
        activeCleanup = beginInteractiveLifecycle({
            publishWordIntent: jest.fn(),
        });
        const { container: firstContainer } = createOriginalWord();
        attachRegisteredOriginal(firstContainer);
        firstContainer.remove();
        const { container: secondContainer } = createOriginalWord({
            renderRevision: '2',
        });

        attachRegisteredOriginal(secondContainer);

        expect(firstContainer).not.toHaveAttribute(
            'data-interactive-listeners'
        );
        expect(secondContainer).toHaveAttribute(
            'data-interactive-listeners',
            'true'
        );
    });

    test('new lifecycle survives old cleanup and revokes old binding', () => {
        initializeInteractiveSubtitles({
            enabled: true,
            clickableWords: true,
            debounceDelay: 0,
        });
        const firstPublisher = jest.fn();
        const secondPublisher = jest.fn();
        const { container, target } = createOriginalWord();
        const firstCleanup = beginInteractiveLifecycle({
            publishWordIntent: firstPublisher,
        });
        attachRegisteredOriginal(container);

        activeCleanup = beginInteractiveLifecycle({
            publishWordIntent: secondPublisher,
        });
        expect(container).not.toHaveAttribute('data-interactive-listeners');

        const addEventListener = jest.spyOn(container, 'addEventListener');
        attachRegisteredOriginal(container);
        const clickHandler = addEventListener.mock.calls.find(
            ([type]) => type === 'click'
        )[1];
        firstCleanup();
        clickHandler({
            isTrusted: true,
            type: 'click',
            target,
            currentTarget: container,
            preventDefault: jest.fn(),
            stopPropagation: jest.fn(),
        });

        expect(firstPublisher).not.toHaveBeenCalled();
        expect(secondPublisher).toHaveBeenCalledTimes(1);
        expect(container).toHaveAttribute('data-interactive-listeners', 'true');
    });

    test('failed attachment removes listeners installed before the failure', () => {
        initializeInteractiveSubtitles({
            enabled: true,
            clickableWords: true,
            debounceDelay: 0,
        });
        const { container, target } = createOriginalWord();
        const nativeAddEventListener =
            container.addEventListener.bind(container);
        jest.spyOn(container, 'addEventListener').mockImplementation(
            (type, listener, options) => {
                if (type === 'keydown') {
                    throw new Error('ATTACHMENT_FAILED');
                }
                nativeAddEventListener(type, listener, options);
            }
        );
        const selected = jest.fn();
        document.addEventListener('dualsub-word-selected', selected);
        activeCleanup = beginInteractiveLifecycle();

        expect(() => attachInteractiveEventListeners(container)).toThrow(
            'ATTACHMENT_FAILED'
        );
        target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        document.removeEventListener('dualsub-word-selected', selected);

        expect(selected).not.toHaveBeenCalled();
        expect(container).not.toHaveAttribute('data-interactive-listeners');
    });

    test('untrusted input cannot publish or advance debounce', () => {
        initializeInteractiveSubtitles({
            enabled: true,
            clickableWords: true,
            debounceDelay: 60_000,
        });
        jest.spyOn(Date, 'now').mockReturnValue(100_000);
        const publishWordIntent = jest.fn();
        const { container, target } = createOriginalWord();
        const addEventListener = jest.spyOn(container, 'addEventListener');
        activeCleanup = beginInteractiveLifecycle({ publishWordIntent });
        attachRegisteredOriginal(container);
        const clickHandler = addEventListener.mock.calls.find(
            ([type]) => type === 'click'
        )[1];

        target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(publishWordIntent).not.toHaveBeenCalled();

        clickHandler({
            isTrusted: true,
            type: 'click',
            target,
            currentTarget: container,
            preventDefault: jest.fn(),
            stopPropagation: jest.fn(),
        });
        expect(publishWordIntent).toHaveBeenCalledTimes(1);
    });

    test('only trusted Enter and Space publish keyboard intents', () => {
        initializeInteractiveSubtitles({
            enabled: true,
            clickableWords: true,
            debounceDelay: 0,
        });
        const publishWordIntent = jest.fn();
        const { container, target } = createOriginalWord();
        const addEventListener = jest.spyOn(container, 'addEventListener');
        activeCleanup = beginInteractiveLifecycle({ publishWordIntent });
        attachRegisteredOriginal(container);
        const keydownHandler = addEventListener.mock.calls.find(
            ([type]) => type === 'keydown'
        )[1];

        for (const key of ['Enter', ' ', 'Escape']) {
            keydownHandler({
                isTrusted: true,
                type: 'keydown',
                key,
                target,
                currentTarget: container,
                preventDefault: jest.fn(),
                stopPropagation: jest.fn(),
            });
        }

        expect(publishWordIntent).toHaveBeenCalledTimes(2);
    });

    test('publisher-free lifecycle preserves the legacy event path', () => {
        initializeInteractiveSubtitles({
            enabled: true,
            clickableWords: true,
            debounceDelay: 0,
        });
        const onLegacyWordSelected = jest.fn();
        document.addEventListener(
            'dualsub-word-selected',
            onLegacyWordSelected
        );
        const { container, target } = createOriginalWord();
        activeCleanup = beginInteractiveLifecycle();
        attachRegisteredOriginal(container);

        target.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(onLegacyWordSelected).toHaveBeenCalledTimes(1);
        expect(onLegacyWordSelected.mock.calls[0][0].detail).toEqual(
            expect.objectContaining({
                word: 'hello',
                element: target,
                sourceLanguage: 'en',
                targetLanguage: 'es',
                subtitleType: 'original',
            })
        );
        document.removeEventListener(
            'dualsub-word-selected',
            onLegacyWordSelected
        );
    });

    test('non-function publishers are not coerced into authority', () => {
        initializeInteractiveSubtitles({
            enabled: true,
            clickableWords: true,
            debounceDelay: 0,
        });
        const authorityTrap = jest.fn(() => {
            throw new Error('NON_FUNCTION_AUTHORITY_ACCESSED');
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
        const onLegacyWordSelected = jest.fn();
        document.addEventListener(
            'dualsub-word-selected',
            onLegacyWordSelected
        );
        const { container, target } = createOriginalWord();
        activeCleanup = beginInteractiveLifecycle({
            publishWordIntent: nonFunctionPublisher,
        });
        attachRegisteredOriginal(container);

        target.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(authorityTrap).not.toHaveBeenCalled();
        expect(onLegacyWordSelected).toHaveBeenCalledTimes(1);
        document.removeEventListener(
            'dualsub-word-selected',
            onLegacyWordSelected
        );
    });

    test('private publisher suppresses legacy and forged events', () => {
        initializeInteractiveSubtitles({
            enabled: true,
            clickableWords: true,
            debounceDelay: 0,
        });
        const publishWordIntent = jest.fn();
        const onLegacyWordSelected = jest.fn();
        document.addEventListener(
            'dualsub-word-selected',
            onLegacyWordSelected
        );
        const { container, target } = createOriginalWord();
        const addEventListener = jest.spyOn(container, 'addEventListener');
        activeCleanup = beginInteractiveLifecycle({ publishWordIntent });
        attachRegisteredOriginal(container);
        const clickHandler = addEventListener.mock.calls.find(
            ([type]) => type === 'click'
        )[1];

        clickHandler({
            isTrusted: true,
            type: 'click',
            target,
            currentTarget: container,
            preventDefault: jest.fn(),
            stopPropagation: jest.fn(),
        });
        expect(publishWordIntent).toHaveBeenCalledTimes(1);
        expect(onLegacyWordSelected).not.toHaveBeenCalled();

        document.dispatchEvent(
            new CustomEvent('dualsub-word-selected', {
                detail: { word: 'forged' },
            })
        );
        expect(publishWordIntent).toHaveBeenCalledTimes(1);
        document.removeEventListener(
            'dualsub-word-selected',
            onLegacyWordSelected
        );
    });

    test('rejects malformed or unauthorized word targets', () => {
        expectProjectionRejected('detached container', ({ container }) =>
            container.remove()
        );
        expectProjectionRejected('wrong bound container', ({ target }) => {
            const wrongContainer = document.createElement('div');
            wrongContainer.appendChild(target);
            document.body.appendChild(wrongContainer);
            return wrongContainer;
        });
        expectProjectionRejected('detached target', ({ target }) =>
            target.remove()
        );
        expectProjectionRejected('translated target', ({ target }) =>
            target.setAttribute('data-subtitle-type', 'translated')
        );
        expectProjectionRejected('missing interactive class', ({ target }) =>
            target.classList.remove('dualsub-interactive-word')
        );
        expectProjectionRejected('stale target revision', ({ target }) =>
            target.setAttribute('data-render-revision', '2')
        );
        expectProjectionRejected('missing target revision', ({ target }) =>
            target.removeAttribute('data-render-revision')
        );
        expectProjectionRejected(
            'missing container revision',
            ({ container }) => container.removeAttribute('data-render-revision')
        );

        for (const revision of ['0', '01', '1.5', '9007199254740992']) {
            expectProjectionRejected(
                `malformed revision ${revision}`,
                ({ container, target }) => {
                    container.setAttribute('data-render-revision', revision);
                    target.setAttribute('data-render-revision', revision);
                }
            );
        }
        for (const wordIndex of ['-1', '1.5', '9007199254740992']) {
            expectProjectionRejected(
                `invalid word index ${wordIndex}`,
                ({ target }) =>
                    target.setAttribute('data-word-index', wordIndex)
            );
        }

        expectProjectionRejected('missing word index', ({ target }) =>
            target.removeAttribute('data-word-index')
        );
        expectProjectionRejected(
            'data-position without word index',
            ({ target }) => {
                target.removeAttribute('data-word-index');
                target.setAttribute('data-position', '0');
            }
        );
        expectProjectionRejected('word with whitespace', ({ target }) =>
            target.setAttribute('data-word', ' hello')
        );
        expectProjectionRejected('empty word', ({ target }) =>
            target.setAttribute('data-word', '')
        );
        expectProjectionRejected('empty source language', ({ target }) =>
            target.setAttribute('data-source-lang', '')
        );
        expectProjectionRejected('empty target language', ({ target }) =>
            target.setAttribute('data-target-lang', '')
        );
    });

    test.each([undefined, null, 0, -1, 1.5, 9_007_199_254_740_992, '1'])(
        'omits an invalid original render revision %p',
        (renderRevision) => {
            initializeInteractiveSubtitles({
                enabled: true,
                clickableWords: true,
            });
            const container = document.createElement('div');
            container.innerHTML = formatInteractiveSubtitleText('hello', {
                sourceLanguage: 'en',
                targetLanguage: 'es',
                subtitleType: 'original',
                renderRevision,
            });

            expect(
                container.querySelector('.dualsub-interactive-word')
            ).not.toHaveAttribute('data-render-revision');
        }
    );

    test('translated formatting never creates a private word', () => {
        initializeInteractiveSubtitles({
            enabled: true,
            clickableWords: true,
        });
        const container = document.createElement('div');
        container.id = 'dualsub-original-subtitle';
        container.setAttribute('data-render-revision', '3');
        container.innerHTML = formatInteractiveSubtitleText('hola', {
            sourceLanguage: 'es',
            targetLanguage: 'en',
            subtitleType: 'translated',
            renderRevision: 3,
        });
        document.body.appendChild(container);
        const target = container.querySelector('.dualsub-interactive-word');

        expect(target).not.toHaveAttribute('data-render-revision');
        expect(
            projectInteractiveWordIntent(
                createTrustedActivation(container, target)
            )
        ).toBeNull();
    });

    test('publisher throws are isolated and returned thenables ignored', () => {
        initializeInteractiveSubtitles({
            enabled: true,
            clickableWords: true,
            debounceDelay: 0,
        });
        const { container, target } = createOriginalWord();
        const addEventListener = jest.spyOn(container, 'addEventListener');
        const throwingPublisher = jest.fn(() => {
            throw new Error('PUBLISHER_FAILURE');
        });
        activeCleanup = beginInteractiveLifecycle({
            publishWordIntent: throwingPublisher,
        });
        attachRegisteredOriginal(container);
        let clickHandler = addEventListener.mock.calls.find(
            ([type]) => type === 'click'
        )[1];
        const trustedClick = () =>
            clickHandler({
                isTrusted: true,
                type: 'click',
                target,
                currentTarget: container,
                preventDefault: jest.fn(),
                stopPropagation: jest.fn(),
            });

        expect(trustedClick).not.toThrow();
        expect(throwingPublisher).toHaveBeenCalledTimes(1);

        activeCleanup();
        const thenTrap = jest.fn(() => {
            throw new Error('THEN_ACCESSED');
        });
        const publisherResult = {};
        Object.defineProperty(publisherResult, 'then', { get: thenTrap });
        const returningPublisher = jest.fn(() => publisherResult);
        activeCleanup = beginInteractiveLifecycle({
            publishWordIntent: returningPublisher,
        });
        addEventListener.mockClear();
        attachRegisteredOriginal(container);
        clickHandler = addEventListener.mock.calls.find(
            ([type]) => type === 'click'
        )[1];

        expect(trustedClick).not.toThrow();
        expect(returningPublisher).toHaveBeenCalledTimes(1);
        expect(thenTrap).not.toHaveBeenCalled();
    });

    test('publisher stays out of config, DOM, and window values', () => {
        initializeInteractiveSubtitles({
            enabled: true,
            clickableWords: true,
            debounceDelay: 0,
        });
        const publishWordIntent = jest.fn();
        const { container, target } = createOriginalWord();
        activeCleanup = beginInteractiveLifecycle({ publishWordIntent });
        attachRegisteredOriginal(container, {
            ignoredPublicOption: true,
        });

        expect(Object.values(getInteractiveConfig())).not.toContain(
            publishWordIntent
        );
        for (const node of [container, target]) {
            const ownValues = Reflect.ownKeys(node)
                .map((key) => Object.getOwnPropertyDescriptor(node, key))
                .filter((descriptor) => descriptor && 'value' in descriptor)
                .map((descriptor) => descriptor.value);
            expect(ownValues).not.toContain(publishWordIntent);
            expect(
                Array.from(node.attributes, (attribute) => attribute.value)
            ).not.toContain(String(publishWordIntent));
        }
        expect(
            [
                window.dualsub_formatInteractiveSubtitleText,
                window.dualsub_attachInteractiveEventListeners,
                window.dualsub_setInteractiveEnabled,
            ].filter(Boolean)
        ).not.toContain(publishWordIntent);
    });
});
