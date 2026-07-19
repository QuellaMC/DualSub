import { jest } from '@jest/globals';

import { AIContextManager } from '../core/AIContextManager.js';
import * as interactiveFormatter from '../../shared/interactiveSubtitleFormatter.js';

const { attachInteractiveEventListeners, initializeInteractiveSubtitles } =
    interactiveFormatter;

describe('AI context lifecycle binding', () => {
    test('the manager ignores untrusted lifecycle grants and exposes no lifecycle authority', () => {
        const lifecycleTrap = jest.fn(() => {
            throw new Error('UNTRUSTED_LIFECYCLE_GRANT_ACCESSED');
        });
        const hostileLifecycleGrant = new Proxy(
            {},
            {
                get: lifecycleTrap,
                getOwnPropertyDescriptor: lifecycleTrap,
                getPrototypeOf: lifecycleTrap,
                has: lifecycleTrap,
                ownKeys: lifecycleTrap,
            }
        );
        const manager = new AIContextManager(
            'netflix',
            { provider: { timeout: 1234 } },
            hostileLifecycleGrant
        );

        expect(lifecycleTrap).not.toHaveBeenCalled();
        expect('aiContextChannel' in manager).toBe(false);
        expect('aiContextLifecycleGeneration' in manager).toBe(false);
        expect(manager.config.provider).toEqual({ timeout: 1234 });
        expect(manager.config).not.toHaveProperty('channel');
        expect(manager.config).not.toHaveProperty('generation');
        expect(manager.config).not.toHaveProperty('aiContextChannel');
    });

    test('interactive lifecycle reset is bus-free, compare-and-swap, terminal, and idempotent', () => {
        expect(interactiveFormatter).not.toHaveProperty('bindAIContextChannel');
        expect(interactiveFormatter.beginInteractiveLifecycle).toEqual(
            expect.any(Function)
        );

        initializeInteractiveSubtitles({
            enabled: true,
            clickableWords: true,
            debounceDelay: 60_000,
        });
        const container = document.createElement('div');
        container.id = 'dualsub-original-subtitle';
        container.setAttribute('data-render-revision', '1');
        const word = document.createElement('span');
        word.className = 'dualsub-interactive-word';
        word.setAttribute('data-subtitle-type', 'original');
        word.setAttribute('data-render-revision', '1');
        word.setAttribute('data-word-index', '0');
        word.setAttribute('data-word', 'hello');
        word.setAttribute('data-source-lang', 'en');
        word.setAttribute('data-target-lang', 'es');
        word.setAttribute('data-context', 'hello');
        word.textContent = 'hello';
        container.appendChild(word);
        document.body.appendChild(container);
        const bindingSnapshot = Object.freeze({
            element: container,
            renderRevision: 1,
            occurrences: Object.freeze([
                Object.freeze({
                    element: word,
                    renderRevision: 1,
                    wordIndex: 0,
                    word: 'hello',
                    sourceLanguage: 'en',
                    targetLanguage: 'es',
                }),
            ]),
        });
        const beginLifecycle = () =>
            interactiveFormatter.beginInteractiveLifecycle({
                resolveOriginalWordBindingSnapshot: (element) =>
                    element === container ? bindingSnapshot : null,
            });

        const onWordSelected = jest.fn();
        document.addEventListener('dualsub-word-selected', onWordSelected);

        const cleanupFirst = beginLifecycle();
        attachInteractiveEventListeners(container);
        word.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(onWordSelected).toHaveBeenCalledTimes(1);

        const cleanupSecond = beginLifecycle();
        attachInteractiveEventListeners(container);
        word.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(onWordSelected).toHaveBeenCalledTimes(2);

        cleanupFirst();
        word.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(onWordSelected).toHaveBeenCalledTimes(2);

        cleanupSecond();
        word.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(onWordSelected).toHaveBeenCalledTimes(2);
        cleanupSecond();
        word.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(onWordSelected).toHaveBeenCalledTimes(2);

        document.removeEventListener('dualsub-word-selected', onWordSelected);
        container.remove();
    });
});
