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
import { AIContextModalEvents } from '../ui/modal-events.js';
import { AIContextModalUI } from '../ui/modal-ui.js';
import { ModalController } from '../ui/events/ModalController.js';
import { SelectionPersistenceManager } from '../utils/selectionPersistence.js';

function createCapabilities(overrides = {}) {
    return {
        requestAnalysis: jest.fn(() => 1),
        cancelAnalysis: jest.fn(() => true),
        clearSelection: jest.fn(() => true),
        subscribeSettled: jest.fn(() => () => {}),
        takeResult: jest.fn(() => ({ analysis: 'ok', contextType: 'all' })),
        ...overrides,
    };
}

function selectionSnapshot(overrides = {}) {
    return {
        selectionRevision: 1,
        renderRevision: 1,
        reason: 'toggle',
        entries: [{ wordIndex: 0, word: 'hello' }],
        ...overrides,
    };
}

function createControllerHarness(capabilityOverrides = {}) {
    document.body.innerHTML = `
        <div id="dualsub-original-subtitle"></div>
        <div id="dualsub-modal-content">
            <div id="dualsub-selected-words"></div>
            <button id="dualsub-start-analysis"></button>
            <button id="dualsub-modal-close"></button>
            <button id="dualsub-new-analysis"></button>
            <div id="dualsub-analysis-results"></div>
        </div>
    `;
    const core = new AIContextModalCore({ privateAnalysis: true });
    core.contentElement = document.getElementById('dualsub-modal-content');
    core.element = core.contentElement;
    core.applyPrivateSelectionSnapshot(selectionSnapshot());
    const ui = {
        _getLocalizedMessage: jest.fn((key) => key),
        showAnalysisResults: jest.fn(),
        showInitialState: jest.fn(),
        showPrivateTerminalFailure: jest.fn(),
        showProcessingState: jest.fn(),
        updateSelectionDisplay: jest.fn(),
    };
    const animations = {
        hideModal: jest.fn(() => core.setState('hidden')),
        showProcessingState: jest.fn(),
        showResultsState: jest.fn(),
    };
    let settlementListener = null;
    const unsubscribe = jest.fn();
    const capabilities = createCapabilities({
        subscribeSettled: jest.fn((listener) => {
            settlementListener = listener;
            return unsubscribe;
        }),
        ...capabilityOverrides,
    });
    const controller = new ModalController(core, ui, animations, capabilities);
    return {
        animations,
        capabilities,
        controller,
        core,
        getSettlementListener: () => settlementListener,
        ui,
        unsubscribe,
    };
}

describe('AIContextModal private analysis capabilities', () => {
    beforeEach(() => {
        document.body.replaceChildren();
    });

    afterEach(() => {
        jest.useRealTimers();
        document.body.replaceChildren();
    });

    test('strips capabilities and freezes the private-mode flag', () => {
        const capabilities = createCapabilities();
        const modal = new AIContextModal({
            analysisCapabilities: capabilities,
            marker: 'retained',
        });

        expect(modal.config.marker).toBe('retained');
        expect(modal.config.analysisCapabilities).toBeUndefined();
        expect(modal.config.privateAnalysis).toBe(true);
        expect(Reflect.set(modal.config, 'privateAnalysis', false)).toBe(false);
        expect(modal.config.privateAnalysis).toBe(true);
    });

    test.each([
        ['undefined', () => ({ analysisCapabilities: undefined })],
        ['null', () => ({ analysisCapabilities: null })],
        [
            'incomplete',
            () => ({
                analysisCapabilities: {
                    requestAnalysis() {},
                    cancelAnalysis() {},
                    subscribeSettled() {},
                    takeResult() {},
                },
            }),
        ],
        [
            'extra key',
            () => ({
                analysisCapabilities: {
                    ...createCapabilities(),
                    extra() {},
                },
            }),
        ],
        [
            'nonfunction',
            () => ({
                analysisCapabilities: {
                    ...createCapabilities(),
                    clearSelection: true,
                },
            }),
        ],
        [
            'inner accessor',
            () => {
                const capabilities = createCapabilities();
                Object.defineProperty(capabilities, 'clearSelection', {
                    enumerable: true,
                    get() {
                        throw new Error('must not invoke inner accessor');
                    },
                });
                return { analysisCapabilities: capabilities };
            },
        ],
        [
            'outer accessor',
            () => {
                const config = {};
                Object.defineProperty(config, 'analysisCapabilities', {
                    enumerable: true,
                    get() {
                        throw new Error('must not invoke outer accessor');
                    },
                });
                return config;
            },
        ],
    ])(
        'present-invalid capabilities fail closed: %s',
        (_name, createConfig) => {
            expect(() => new AIContextModal(createConfig())).toThrow(
                new TypeError('Invalid analysisCapabilities configuration')
            );
        }
    );

    test('capability absence alone retains legacy mode', () => {
        const modal = new AIContextModal({ marker: 'legacy' });

        expect(modal.config.privateAnalysis).toBe(false);
        expect(modal.config.marker).toBe('legacy');
    });

    test('legacy close retains direct local selection cleanup', () => {
        const core = new AIContextModalCore();
        core.addWordToSelection('hello', {
            subtitleType: 'original',
            wordIndex: 0,
        });
        const animations = {
            hideModal: jest.fn(() => core.setState('hidden')),
        };
        const controller = new ModalController(
            core,
            { updateSelectionDisplay: jest.fn() },
            animations
        );

        expect(core.selectedWords.size).toBe(1);
        expect(controller.closeModal()).toBeUndefined();
        expect(core.selectedWords.size).toBe(0);
        expect(core.state).toBe('hidden');
        expect(animations.hideModal).toHaveBeenCalledTimes(1);
        controller.destroy();
    });

    test('private events omit public authority ingress', async () => {
        document.body.innerHTML = `
            <div id="modal-root">
                <div id="dualsub-selected-words"></div>
                <button id="dualsub-start-analysis"></button>
                <button id="dualsub-pause-analysis"></button>
                <button id="dualsub-new-analysis"></button>
            </div>
        `;
        const core = new AIContextModalCore({ privateAnalysis: true });
        core.element = document.getElementById('modal-root');
        core.contentElement = core.element;
        core.applyPrivateSelectionSnapshot(selectionSnapshot());
        const ui = {
            clearTerminalRetryActions: jest.fn(),
            updateSelectionDisplay: jest.fn(),
        };
        const events = new AIContextModalEvents(core, ui);

        await events.setupEventListeners();

        expect([...events.boundHandlers.keys()]).not.toEqual(
            expect.arrayContaining([
                'word-selection',
                'analysis-request',
                'analysis-result',
                'words-click',
            ])
        );
        const before = core.selectionModel.getOrderedEntries();
        document.dispatchEvent(
            new CustomEvent('dualsub-word-selected', {
                detail: { word: 'hostile', action: 'toggle' },
            })
        );
        document.dispatchEvent(
            new CustomEvent('dualsub-context-result', {
                detail: { requestId: 1, success: true, result: {} },
            })
        );
        expect(core.selectionModel.getOrderedEntries()).toEqual(before);

        events.removeEventListeners();
    });

    test('private DOM actions require trusted events while direct controller calls remain available', async () => {
        const harness = createControllerHarness({
            requestAnalysis: jest.fn(() => 31),
        });
        harness.core.isVisible = true;
        const events = new AIContextModalEvents(
            harness.core,
            harness.ui,
            harness.animations
        );
        events.modalController = harness.controller;
        harness.controller.events = events;
        await events.setupEventListeners();

        document.getElementById('dualsub-start-analysis').click();
        document.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'Enter',
                ctrlKey: true,
                bubbles: true,
            })
        );
        expect(harness.capabilities.requestAnalysis).not.toHaveBeenCalled();

        const trustedClick = {
            isTrusted: true,
            preventDefault: jest.fn(),
            stopPropagation: jest.fn(),
        };
        await expect(
            events.boundHandlers.get('start-analysis').handler(trustedClick)
        ).resolves.toBe(true);
        expect(harness.capabilities.requestAnalysis).toHaveBeenCalledTimes(1);

        document.getElementById('dualsub-start-analysis').click();
        document.getElementById('dualsub-modal-close').click();
        document.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
        );
        expect(harness.capabilities.cancelAnalysis).not.toHaveBeenCalled();
        expect(harness.animations.hideModal).not.toHaveBeenCalled();

        harness.controller._buttonListenerRecords
            .get('analysis-button')
            .handler(trustedClick);
        expect(harness.capabilities.cancelAnalysis).toHaveBeenCalledWith(
            31,
            'user'
        );
        events.boundHandlers.get('close-click').handler(trustedClick);
        expect(harness.animations.hideModal).toHaveBeenCalledTimes(1);

        events.removeEventListeners();
        harness.controller.destroy();
    });

    test('drains one exact reentrant success before UI mutation', async () => {
        let listener;
        const leasedResult = { analysis: 'safe result', contextType: 'all' };
        const rawComplete = jest.fn();
        document.addEventListener('aicontext:analysis:complete', rawComplete);
        const harness = createControllerHarness({
            requestAnalysis: jest.fn(() => {
                expect(harness.core.isAnalyzing).toBe(false);
                expect(harness.core.state).toBe('hidden');
                listener({ requestId: 7, outcome: 'succeeded' });
                return 7;
            }),
            subscribeSettled: jest.fn((settlementListener) => {
                listener = settlementListener;
                return jest.fn();
            }),
            takeResult: jest.fn(() => leasedResult),
        });

        await expect(harness.controller.startAnalysis()).resolves.toBe(true);

        expect(harness.capabilities.requestAnalysis).toHaveBeenCalledWith({
            cause: 'user',
            retryOf: null,
            contextTypes: ['cultural', 'historical', 'linguistic'],
        });
        expect(harness.capabilities.takeResult).toHaveBeenCalledTimes(1);
        expect(harness.capabilities.takeResult).toHaveBeenCalledWith(7);
        expect(harness.animations.showProcessingState).not.toHaveBeenCalled();
        expect(harness.animations.showResultsState).toHaveBeenCalledTimes(1);
        expect(harness.core.currentRequest).toBeNull();
        expect(harness.core.isAnalyzing).toBe(false);
        expect(harness.core.analysisResult).toBe(leasedResult);
        expect(rawComplete).not.toHaveBeenCalled();
        document.removeEventListener(
            'aicontext:analysis:complete',
            rawComplete
        );
        harness.controller.destroy();
    });

    test.each([
        ['a mismatched settlement', [{ requestId: 99, outcome: 'succeeded' }]],
        [
            'multiple settlements',
            [
                { requestId: 8, outcome: 'succeeded' },
                { requestId: 8, outcome: 'succeeded' },
            ],
        ],
        ['a malformed settlement', [{ requestId: 8, outcome: 'failed' }]],
    ])('fails closed during request: %s', async (_name, signals) => {
        let listener;
        const harness = createControllerHarness({
            requestAnalysis: jest.fn(() => {
                for (const signal of signals) listener(signal);
                return 8;
            }),
            subscribeSettled: jest.fn((settlementListener) => {
                listener = settlementListener;
                return jest.fn();
            }),
        });

        await expect(harness.controller.startAnalysis()).resolves.toBe(false);

        expect(harness.capabilities.cancelAnalysis).toHaveBeenCalledWith(
            8,
            'superseded'
        );
        expect(harness.animations.showProcessingState).not.toHaveBeenCalled();
        expect(harness.animations.showResultsState).not.toHaveBeenCalled();
        expect(harness.core.currentRequest).toBeNull();
        expect(harness.core.isAnalyzing).toBe(false);
        harness.controller.destroy();
    });

    test('uses explicit retry correlation and exact cancellation', async () => {
        const requestIds = [11, 12];
        const harness = createControllerHarness({
            requestAnalysis: jest.fn(() => requestIds.shift()),
        });
        const listener = harness.getSettlementListener();

        await expect(harness.controller.startAnalysis()).resolves.toBe(true);
        expect(harness.core.currentRequest).toBe(11);
        expect(harness.core.isAnalyzing).toBe(true);

        expect(
            listener({
                requestId: 99,
                outcome: 'failed',
                code: 'network',
                retryable: true,
            })
        ).toBe(false);
        expect(harness.core.currentRequest).toBe(11);
        expect(
            listener({
                requestId: 11,
                outcome: 'failed',
                code: 'network',
                retryable: true,
            })
        ).toBe(true);

        expect(harness.core.currentRequest).toBeNull();
        expect(harness.core.isAnalyzing).toBe(false);
        expect(harness.capabilities.requestAnalysis).toHaveBeenCalledTimes(1);
        const terminal = harness.ui.showPrivateTerminalFailure.mock.calls[0][0];
        expect(terminal.retryable).toBe(true);

        expect(terminal.onRetry()).toBe(true);
        expect(harness.capabilities.requestAnalysis).toHaveBeenLastCalledWith({
            cause: 'retry',
            retryOf: 11,
            contextTypes: ['cultural', 'historical', 'linguistic'],
        });
        expect(harness.core.currentRequest).toBe(12);
        expect(harness.controller.pauseAnalysis()).toBe(true);
        expect(harness.controller.pauseAnalysis()).toBe(false);
        expect(harness.capabilities.cancelAnalysis).toHaveBeenCalledTimes(1);
        expect(harness.capabilities.cancelAnalysis).toHaveBeenCalledWith(
            12,
            'user'
        );
        expect(
            listener({
                requestId: 12,
                outcome: 'cancelled',
                reason: 'user',
            })
        ).toBe(true);
        expect(harness.core.currentRequest).toBeNull();
        harness.controller.destroy();
    });

    test.each([
        ['returns false', () => false],
        ['returns a truthy non-boolean', () => ({ cancelled: true })],
        [
            'throws',
            () => {
                throw new Error('synthetic cancellation failure');
            },
        ],
    ])(
        'failed private cancellation remains retryable when it %s',
        async (_name, cancel) => {
            const harness = createControllerHarness({
                requestAnalysis: jest.fn(() => 33),
                cancelAnalysis: jest.fn(cancel),
            });
            await harness.controller.startAnalysis();

            expect(harness.controller.pauseAnalysis()).toBe(false);
            expect(harness.controller._privateCancelRequestedFor).toBeNull();
            expect(harness.core.currentRequest).toBe(33);
            expect(harness.controller.pauseAnalysis()).toBe(false);
            expect(harness.capabilities.cancelAnalysis).toHaveBeenCalledTimes(
                2
            );
            expect(harness.controller._privateCancelRequestedFor).toBeNull();
            harness.controller.destroy();
        }
    );

    test('private close requests one canonical selection clear and hides the modal', () => {
        const harness = createControllerHarness();

        expect(harness.core.selectedWords.size).toBe(1);
        expect(harness.controller.closeModal()).toBe(true);
        expect(harness.capabilities.clearSelection).toHaveBeenCalledTimes(1);
        expect(harness.animations.hideModal).toHaveBeenCalledTimes(1);
        expect(harness.core.state).toBe('hidden');
        harness.controller.destroy();
    });

    test.each([
        ['returns false', () => false],
        [
            'throws',
            () => {
                throw new Error('synthetic clear failure');
            },
        ],
        [
            'rejects',
            () => Promise.reject(new Error('synthetic clear rejection')),
        ],
    ])(
        'private close remains hidden when canonical clear %s',
        async (_name, clearSelection) => {
            const harness = createControllerHarness({
                clearSelection: jest.fn(clearSelection),
            });

            expect(harness.controller.closeModal()).toBe(true);
            expect(harness.core.state).toBe('hidden');
            await Promise.resolve();
            expect(harness.capabilities.clearSelection).toHaveBeenCalledTimes(
                1
            );
            expect(harness.animations.hideModal).toHaveBeenCalledTimes(1);
            harness.controller.destroy();
        }
    );

    test('private close tombstones and cancels a pending analysis before clearing selection', async () => {
        const operations = [];
        const harness = createControllerHarness({
            requestAnalysis: jest.fn(() => 40),
            cancelAnalysis: jest.fn(() => {
                operations.push('cancel');
                return true;
            }),
            clearSelection: jest.fn(() => {
                operations.push('clear');
                return true;
            }),
        });
        await harness.controller.startAnalysis();

        expect(harness.controller.closeModal()).toBe(true);
        expect(operations).toEqual(['cancel', 'clear']);
        expect(harness.capabilities.cancelAnalysis).toHaveBeenCalledWith(
            40,
            'modal-closed'
        );
        expect(harness.core.currentRequest).toBeNull();
        expect(harness.core.isAnalyzing).toBe(false);
        expect(harness.core.state).toBe('hidden');
        harness.controller.destroy();
    });

    test('pause then close tombstones the request and suppresses queued cancellation rendering', async () => {
        const harness = createControllerHarness({
            requestAnalysis: jest.fn(() => 41),
        });
        const listener = harness.getSettlementListener();
        await harness.controller.startAnalysis();

        expect(harness.controller.pauseAnalysis()).toBe(true);
        expect(harness.controller.closeModal()).toBe(true);
        expect(harness.core.currentRequest).toBeNull();
        expect(harness.core.isAnalyzing).toBe(false);
        expect(harness.core.state).toBe('hidden');

        expect(
            listener({
                requestId: 41,
                outcome: 'cancelled',
                reason: 'user',
            })
        ).toBe(true);
        expect(harness.ui.showInitialState).not.toHaveBeenCalled();
        expect(harness.ui.showPrivateTerminalFailure).not.toHaveBeenCalled();
        expect(harness.animations.showResultsState).not.toHaveBeenCalled();
        expect(harness.capabilities.takeResult).not.toHaveBeenCalled();
        harness.controller.destroy();
    });

    test('close tombstone precedes synchronous cancellation settlement and clears at a successor request', async () => {
        let listener;
        const requestIds = [51, 52];
        const harness = createControllerHarness({
            requestAnalysis: jest.fn(() => requestIds.shift()),
            subscribeSettled: jest.fn((settlementListener) => {
                listener = settlementListener;
                return jest.fn();
            }),
            cancelAnalysis: jest.fn((requestId) => {
                listener({
                    requestId,
                    outcome: 'cancelled',
                    reason: 'modal-closed',
                });
                return true;
            }),
        });
        const controller = harness.controller;
        await controller.startAnalysis();

        expect(controller.closeModal()).toBe(true);
        expect(harness.ui.showInitialState).not.toHaveBeenCalled();
        expect(harness.core.state).toBe('hidden');

        harness.core.applyPrivateSelectionSnapshot(
            selectionSnapshot({ selectionRevision: 2 })
        );
        await expect(controller.startAnalysis()).resolves.toBe(true);
        expect(harness.core.currentRequest).toBe(52);
        expect(harness.core.isAnalyzing).toBe(true);
        controller.destroy();
    });

    test('destroy makes a saved settlement listener inert', async () => {
        const harness = createControllerHarness({
            requestAnalysis: jest.fn(() => 21),
        });
        const listener = harness.getSettlementListener();
        await harness.controller.startAnalysis();

        harness.controller.destroy();
        harness.controller.destroy();

        expect(harness.unsubscribe).toHaveBeenCalledTimes(1);
        expect(listener({ requestId: 21, outcome: 'succeeded' })).toBe(false);
        expect(harness.capabilities.takeResult).not.toHaveBeenCalled();
        expect(harness.animations.showResultsState).not.toHaveBeenCalled();
    });

    test('applies occurrence snapshots without removable modal chips', () => {
        const modal = new AIContextModal({
            analysisCapabilities: createCapabilities(),
        });
        document.body.innerHTML = `
            <div id="dualsub-modal-content">
                <div id="dualsub-selected-words"></div>
                <button id="dualsub-start-analysis"></button>
            </div>
        `;
        modal.core.contentElement = document.getElementById(
            'dualsub-modal-content'
        );
        modal.ui = new AIContextModalUI(modal.core);
        modal.core.selectionPersistence.lastSelectionState = {
            stale: true,
        };

        expect(
            modal.applySelectionSnapshot(
                selectionSnapshot({
                    selectionRevision: 4,
                    renderRevision: 9,
                    entries: [
                        { wordIndex: 1, word: 'echo' },
                        { wordIndex: 3, word: 'echo' },
                    ],
                })
            )
        ).toBe(true);
        expect(modal.core.selectionModel.getOrderedEntries()).toEqual([
            { wordIndex: 1, word: 'echo' },
            { wordIndex: 3, word: 'echo' },
        ]);
        expect(modal.core.selectedText).toBe('echo echo');
        expect(
            document.querySelectorAll('.dualsub-selected-word')
        ).toHaveLength(2);
        expect(document.querySelector('.dualsub-word-remove')).toBeNull();
        expect(modal.core.selectionPersistence.lastSelectionState).toBeNull();

        expect(
            modal.applySelectionSnapshot(
                selectionSnapshot({
                    selectionRevision: 5,
                    entries: [
                        { wordIndex: 3, word: 'echo' },
                        { wordIndex: 1, word: 'echo' },
                    ],
                })
            )
        ).toBe(false);
        expect(modal.core.privateSelectionRevision).toBe(4);
    });

    test('private persistence only requests canonical reapplication and never adopts public state', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-07-18T12:00:00.000Z'));
        const canonical = selectionSnapshot({
            selectionRevision: 7,
            renderRevision: 3,
            entries: [{ wordIndex: 2, word: 'canonical' }],
        });
        document.body.innerHTML = `
            <div id="dualsub-original-subtitle" data-text-sig="new"></div>
        `;
        const core = new AIContextModalCore({
            privateAnalysis: true,
            onSelectionRestored: jest.fn(() => {
                expect(core.selectionModel.getOrderedEntries()).toEqual([
                    { wordIndex: 2, word: 'canonical' },
                ]);
            }),
        });
        core.isVisible = true;
        core.applyPrivateSelectionSnapshot(canonical);
        core.selectionPersistence.lastSelectionState = {
            selectedWords: ['stale'],
            selectedWordPositions: new Map([
                [
                    'stale:original:0',
                    {
                        word: 'stale',
                        position: { wordIndex: 0, subtitleType: 'original' },
                    },
                ],
            ]),
            selectedWordsOrder: ['stale:original:0'],
            selectedText: 'stale',
            timestamp: Date.now(),
            signature: 'old',
        };
        const clearSelection = jest.spyOn(core, 'clearSelection');
        const captureSelectionState = jest.spyOn(core, 'captureSelectionState');
        const restoreSelectionState = jest.spyOn(core, 'restoreSelectionState');
        const manager = new SelectionPersistenceManager(core);
        manager.startMonitoring();

        manager._handleSubtitleContentChange(
            Object.defineProperty({}, 'detail', {
                get() {
                    throw new Error(
                        'private mode must not inspect event detail'
                    );
                },
            })
        );
        document.getElementById('dualsub-original-subtitle').textContent =
            'host mutation';
        await Promise.resolve();
        jest.advanceTimersByTime(200);

        expect(core.config.onSelectionRestored).toHaveBeenCalledTimes(1);
        expect(clearSelection).not.toHaveBeenCalled();
        expect(captureSelectionState).not.toHaveBeenCalled();
        expect(restoreSelectionState).not.toHaveBeenCalled();
        expect(core.selectionModel.getOrderedEntries()).toEqual([
            { wordIndex: 2, word: 'canonical' },
        ]);
        expect(core.restoreSelectionState()).toBe(false);
        expect(core.selectionModel.getOrderedEntries()).toEqual([
            { wordIndex: 2, word: 'canonical' },
        ]);
        manager.stopMonitoring();
    });

    test.each([
        ['false return', () => false],
        [
            'throw',
            () => {
                throw new Error('synthetic reapplication failure');
            },
        ],
    ])(
        'private canonical reapplication %s leaves the prior snapshot exact',
        (_name, callbackImplementation) => {
            jest.useFakeTimers();
            const callback = jest.fn(callbackImplementation);
            const core = new AIContextModalCore({
                privateAnalysis: true,
                onSelectionRestored: callback,
            });
            core.isVisible = true;
            core.applyPrivateSelectionSnapshot(selectionSnapshot());
            const manager = new SelectionPersistenceManager(core);
            manager.startMonitoring();

            manager._handleSubtitleMutation([], 'original', null);
            expect(() => jest.advanceTimersByTime(200)).not.toThrow();

            expect(callback).toHaveBeenCalledTimes(1);
            expect(core.selectionModel.getOrderedEntries()).toEqual([
                { wordIndex: 0, word: 'hello' },
            ]);
            manager.stopMonitoring();
        }
    );

    test('private terminal retry UI has no attempt or debug disclosure', () => {
        document.body.innerHTML = `
            <div id="dualsub-modal-content">
                <div id="dualsub-analysis-results"></div>
            </div>
        `;
        const core = new AIContextModalCore({ privateAnalysis: true });
        core.contentElement = document.getElementById('dualsub-modal-content');
        const ui = new AIContextModalUI(core);
        ui._getLocalizedMessage = jest.fn((key) => key);
        const onRetry = jest.fn();
        const onClose = jest.fn();
        const savedHandlers = [];
        const nativeAddEventListener =
            HTMLButtonElement.prototype.addEventListener;
        jest.spyOn(
            HTMLButtonElement.prototype,
            'addEventListener'
        ).mockImplementation(function (eventName, handler, options) {
            if (eventName === 'click') savedHandlers.push(handler);
            return nativeAddEventListener.call(
                this,
                eventName,
                handler,
                options
            );
        });

        ui.showPrivateTerminalFailure({
            retryable: true,
            onRetry,
            onClose,
        });

        const results = document.getElementById('dualsub-analysis-results');
        expect(results).toHaveTextContent('Analysis could not be completed.');
        expect(results).not.toHaveTextContent(
            /attempt|debug|provider|network/i
        );
        expect(results.querySelector('details, pre')).toBeNull();
        expect(results.querySelectorAll('button')).toHaveLength(2);
        results.querySelector('.dualsub-btn-primary').click();
        expect(onRetry).not.toHaveBeenCalled();
        savedHandlers[0]({ isTrusted: true });
        expect(onRetry).toHaveBeenCalledTimes(1);
        expect(onClose).not.toHaveBeenCalled();
    });

    test.each([undefined, null])(
        'selection display remains null-safe when core config is %s',
        (config) => {
            document.body.innerHTML = `
                <div id="dualsub-modal-content">
                    <div id="dualsub-selected-words"></div>
                    <button id="dualsub-start-analysis"></button>
                </div>
            `;
            const core = new AIContextModalCore();
            core.contentElement = document.getElementById(
                'dualsub-modal-content'
            );
            core.addWordToSelection('legacy', { wordIndex: 0 });
            core.config = config;
            const ui = new AIContextModalUI(core);

            expect(() => ui.updateSelectionDisplay()).not.toThrow();
            expect(
                document.querySelector('.dualsub-word-remove')
            ).not.toBeNull();
        }
    );
});
