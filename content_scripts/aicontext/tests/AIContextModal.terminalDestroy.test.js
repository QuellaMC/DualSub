import {
    afterEach,
    beforeEach,
    describe,
    expect,
    jest,
    test,
} from '@jest/globals';
import { AIContextModal } from '../ui/modal.js';
import { AIContextModalCore } from '../ui/modal-core.js';
import { AIContextModalUI } from '../ui/modal-ui.js';
import { AIContextModalAnimations } from '../ui/modal-animations.js';

function createCapabilities() {
    return {
        requestAnalysis: jest.fn(() => 1),
        cancelAnalysis: jest.fn(),
        clearSelection: jest.fn(() => true),
        subscribeSettled: jest.fn(() => () => {}),
        takeResult: jest.fn(() => null),
    };
}

function createDeferred() {
    let resolve;
    const promise = new Promise((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

describe('AIContextModal terminal destruction', () => {
    beforeEach(() => {
        document.body.replaceChildren();
    });

    afterEach(() => {
        jest.useRealTimers();
        document.body.replaceChildren();
        document.getElementById('dualsub-ui-root')?.remove();
    });

    test('UI destroy removes only exact owned nodes and revokes the store subscriber', async () => {
        const core = new AIContextModalCore();
        const ui = new AIContextModalUI(core);
        ui._languageInitialized = true;
        ui._injectModalStyles = jest.fn().mockResolvedValue(undefined);
        await ui.createModalElement();

        const oldModal = core.element;
        const oldOverlay = core.overlayElement;
        const oldContent = core.contentElement;
        expect(core.store._subscribers.size).toBe(1);

        const delayedCleanup = createDeferred();
        ui._configLanguageUnsubscribe = jest.fn(() => delayedCleanup.promise);
        const destruction = ui.destroy();
        await Promise.resolve();

        expect(oldModal.isConnected).toBe(false);
        expect(oldOverlay.isConnected).toBe(false);
        expect(oldContent.isConnected).toBe(false);
        expect(core.store._subscribers.size).toBe(0);

        const successorModal = document.createElement('div');
        successorModal.id = 'dualsub-context-modal';
        const successorOverlay = document.createElement('div');
        successorOverlay.id = 'dualsub-modal-overlay';
        const successorContent = document.createElement('div');
        successorContent.id = 'dualsub-modal-content';
        document.body.append(
            successorModal,
            successorOverlay,
            successorContent
        );

        delayedCleanup.resolve();
        await destruction;

        expect(successorModal.isConnected).toBe(true);
        expect(successorOverlay.isConnected).toBe(true);
        expect(successorContent.isConnected).toBe(true);
        expect(core._storeUnsubscribe).toBeNull();
    });

    test('store subscription reentrancy revokes the unpublished candidate', async () => {
        const unsubscribe = jest.fn();
        let ui;
        let destruction;
        const core = {
            _log: jest.fn(),
            markUiReady: jest.fn(),
            store: {
                subscribe: jest.fn(() => {
                    destruction = ui.destroy();
                    return unsubscribe;
                }),
            },
        };
        ui = new AIContextModalUI(core);
        ui._languageInitialized = true;
        ui._injectModalStyles = jest.fn().mockResolvedValue(undefined);

        await ui.createModalElement();
        await destruction;

        expect(unsubscribe).toHaveBeenCalledTimes(1);
        expect(ui.core).toBeNull();
    });

    test('in-flight translation reload settles inertly after destroy', async () => {
        const translationFetch = createDeferred();
        const originalFetch = global.fetch;
        let terminalCoreReads = 0;
        let terminal = false;
        const coreTarget = {
            _log: jest.fn(),
            isVisible: true,
        };
        const core = new Proxy(coreTarget, {
            get(target, key, receiver) {
                if (terminal) terminalCoreReads += 1;
                return Reflect.get(target, key, receiver);
            },
        });
        const ui = new AIContextModalUI(core);
        ui._translationsCache = { retained: { message: 'old' } };
        ui._currentLanguage = 'en';
        ui._refreshModalUI = jest.fn();
        ui.getTranslationDebugInfo = jest.fn();
        global.fetch = jest.fn(() => translationFetch.promise);

        try {
            const reload = ui.reloadTranslations('fr');
            expect(global.fetch).toHaveBeenCalledTimes(1);
            await ui.destroy();
            terminal = true;
            const logCallsAfterDestroy = coreTarget._log.mock.calls.length;

            const responseJson = jest.fn().mockResolvedValue({
                aiContextModalTitle: { message: 'late' },
            });
            translationFetch.resolve({ ok: true, json: responseJson });

            await expect(reload).resolves.toBeUndefined();
            expect(terminalCoreReads).toBe(0);
            expect(coreTarget._log).toHaveBeenCalledTimes(logCallsAfterDestroy);
            expect(responseJson).not.toHaveBeenCalled();
            expect(ui._translationsCache).toBeNull();
            expect(ui._currentLanguage).toBeNull();
            expect(ui._refreshModalUI).not.toHaveBeenCalled();
            expect(ui.getTranslationDebugInfo).not.toHaveBeenCalled();
        } finally {
            global.fetch = originalFetch;
        }
    });

    test.each([
        ['neither marker', false, false],
        ['only UI', true, false],
        ['only events', false, true],
        ['both markers', true, true],
    ])(
        'core readiness settles on destroy after %s and saved markers stay inert',
        async (_name, markUi, markEvents) => {
            const core = new AIContextModalCore();
            const savedMarkUiReady = core.markUiReady.bind(core);
            const savedMarkEventsReady = core.markEventsReady.bind(core);
            if (markUi) savedMarkUiReady();
            if (markEvents) savedMarkEventsReady();
            const stateBeforeDestroy = {
                uiReady: core.uiReady,
                eventsReady: core.eventsReady,
            };
            let readySettlements = 0;
            core.onceReady.then(() => {
                readySettlements += 1;
            });

            await core.destroy();
            await core.onceReady;
            expect(readySettlements).toBe(1);
            expect(core._readyResolve).toBeNull();

            expect(savedMarkUiReady()).toBe(false);
            expect(savedMarkEventsReady()).toBe(false);
            await Promise.resolve();
            expect({
                uiReady: core.uiReady,
                eventsReady: core.eventsReady,
            }).toEqual(stateBeforeDestroy);
            expect(readySettlements).toBe(1);
        }
    );

    test('animation cleanup revokes persistence, observers, and every delayed callback', () => {
        jest.useFakeTimers();
        const originalResizeObserver = window.ResizeObserver;
        class TestResizeObserver {
            observe = jest.fn();
            disconnect = jest.fn();
        }
        window.ResizeObserver = TestResizeObserver;
        global.ResizeObserver = TestResizeObserver;

        const core = new AIContextModalCore();
        core.element = document.createElement('div');
        core.overlayElement = document.createElement('div');
        core.contentElement = document.createElement('div');
        core.contentElement.innerHTML = `
            <div class="dualsub-modal-header"></div>
            <div class="dualsub-modal-body"></div>
            <button id="dualsub-start-analysis"></button>
            <div id="dualsub-processing-state"><i class="loader-square"></i></div>
        `;
        document.body.append(
            core.element,
            core.overlayElement,
            core.contentElement
        );
        const persistence = {
            startMonitoring: jest.fn(),
            stopMonitoring: jest.fn(),
        };
        core.selectionPersistenceManager = persistence;
        const ui = {
            clearTerminalRetryActions: jest.fn(),
            showProcessingState: jest.fn(),
            updateSelectionDisplay: jest.fn(),
        };
        const animations = new AIContextModalAnimations(core, ui);

        try {
            expect(animations.showModal()).toBe(true);
            animations.showProcessingState();
            const resizeObserver = animations.resizeObserver;
            const mutationObserver = animations.mutationObserver;
            const disconnectMutation = jest.spyOn(
                mutationObserver,
                'disconnect'
            );
            const updatesBeforeCleanup =
                ui.updateSelectionDisplay.mock.calls.length;

            animations.cleanup();
            expect(persistence.stopMonitoring).toHaveBeenCalledTimes(1);
            expect(resizeObserver.disconnect).toHaveBeenCalledTimes(1);
            expect(disconnectMutation).toHaveBeenCalledTimes(1);
            expect(jest.getTimerCount()).toBe(0);

            jest.runAllTimers();
            expect(ui.updateSelectionDisplay).toHaveBeenCalledTimes(
                updatesBeforeCleanup
            );
            expect(animations.core).toBeNull();
            expect(animations.ui).toBeNull();
        } finally {
            window.ResizeObserver = originalResizeObserver;
            global.ResizeObserver = originalResizeObserver;
        }
    });

    test('core destroy cancels restoration RAF and prevents its nested timeout', async () => {
        jest.useFakeTimers();
        const originalRequestAnimationFrame = global.requestAnimationFrame;
        const originalCancelAnimationFrame = global.cancelAnimationFrame;
        let savedAnimationFrame;
        global.requestAnimationFrame = jest.fn((callback) => {
            savedAnimationFrame = callback;
            return 77;
        });
        global.cancelAnimationFrame = jest.fn();
        document.body.innerHTML = `
            <div id="dualsub-original-subtitle" data-text-sig="same"></div>
        `;
        const core = new AIContextModalCore();
        core.selectionPersistence.lastSelectionState = {
            selectedWords: ['word'],
            selectedWordPositions: new Map([
                [
                    'word:original:0',
                    {
                        word: 'word',
                        position: { wordIndex: 0, subtitleType: 'original' },
                    },
                ],
            ]),
            selectedWordsOrder: ['word:original:0'],
            selectedText: 'word',
            timestamp: Date.now(),
            signature: 'same',
        };

        try {
            expect(core.restoreSelectionState()).toBe(true);
            expect(savedAnimationFrame).toEqual(expect.any(Function));
            await core.destroy();

            expect(global.cancelAnimationFrame).toHaveBeenCalledWith(77);
            savedAnimationFrame();
            expect(jest.getTimerCount()).toBe(0);
        } finally {
            global.requestAnimationFrame = originalRequestAnimationFrame;
            global.cancelAnimationFrame = originalCancelAnimationFrame;
        }
    });

    test('modal teardown waits for authority cleanup then detaches animations before UI and core', async () => {
        const authorityCleanup = createDeferred();
        const order = [];
        const modal = new AIContextModal({
            analysisCapabilities: createCapabilities(),
        });
        modal.events = {
            removeEventListeners: jest.fn(() => {
                order.push('events');
                return authorityCleanup.promise;
            }),
        };
        modal.controller = {
            destroy: jest.fn(() => order.push('controller')),
        };
        modal.animations = {
            cleanup: jest.fn(() => order.push('animations')),
        };
        modal.ui = { destroy: jest.fn(() => order.push('ui')) };
        modal.core = { destroy: jest.fn(() => order.push('core')) };

        const destruction = modal.destroy();
        await Promise.resolve();
        expect(order).toEqual(['events', 'controller']);

        authorityCleanup.resolve();
        await destruction;
        expect(order).toEqual([
            'events',
            'controller',
            'animations',
            'ui',
            'core',
        ]);
    });
});
