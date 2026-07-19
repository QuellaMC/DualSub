import {
    jest,
    describe,
    test,
    beforeEach,
    afterEach,
    expect,
} from '@jest/globals';
import { TestHelpers } from '../../../test-utils/test-helpers.js';
import { AIContextManager } from '../core/AIContextManager.js';
import { EVENT_TYPES, MODAL_STATES } from '../core/constants.js';
import { TextSelectionHandler } from '../handlers/textSelection.js';
import { AIContextProvider } from '../providers/AIContextProvider.js';
import { AIContextModal } from '../ui/modal.js';

global.fetch =
    global.fetch ||
    (() =>
        Promise.resolve({
            text: () => Promise.resolve(''),
        }));

function createDeferred() {
    let resolve;
    const promise = new Promise((settle) => {
        resolve = settle;
    });
    return { promise, resolve };
}

describe('AIContextManager destroy', () => {
    let testEnv;
    let manager;

    beforeEach(() => {
        const testHelpers = new TestHelpers();
        testEnv = testHelpers.setupTestEnvironment({
            platform: 'netflix',
            enableLogger: true,
            enableChromeApi: true,
            enableLocation: true,
        });
    });

    afterEach(async () => {
        if (manager?.initialized) {
            await manager.destroy();
        }
        testEnv?.cleanup();
    });

    test('cleans up real components and listeners without reset-only teardown metrics', async () => {
        manager = new AIContextManager('netflix');
        expect(await manager.initialize()).toBe(true);

        const components = [
            manager.getModal(),
            manager.getProvider(),
            manager.getTextHandler(),
        ];
        const destroySpies = components.map((component) =>
            jest.spyOn(component, 'destroy')
        );
        const registeredDocumentListeners = [
            ...manager.eventListeners.entries(),
        ];
        const lifetimeMetrics = manager.metrics;
        const removeDocumentListenerSpy = jest.spyOn(
            document,
            'removeEventListener'
        );

        expect(registeredDocumentListeners.length).toBeGreaterThan(0);
        expect(lifetimeMetrics).not.toHaveProperty('memoryUsage');

        await manager.destroy();

        destroySpies.forEach((destroySpy) => {
            expect(destroySpy).toHaveBeenCalledTimes(1);
        });
        registeredDocumentListeners.forEach(([event, listener]) => {
            expect(removeDocumentListenerSpy).toHaveBeenCalledWith(
                event,
                listener
            );
        });
        expect(manager.components.size).toBe(0);
        expect(manager.eventListeners.size).toBe(0);
        expect(manager._earlyWordSelectionListener).toBeNull();
        expect(manager.metrics).toBe(lifetimeMetrics);
        expect(manager.metrics).not.toHaveProperty('memoryUsage');
    });

    test('shares one permanent destroy promise across simultaneous and later callers', async () => {
        manager = new AIContextManager('netflix');

        const firstDestroy = manager.destroy();
        const simultaneousDestroy = manager.destroy();

        expect(simultaneousDestroy).toBe(firstDestroy);
        await firstDestroy;
        expect(manager.destroy()).toBe(firstDestroy);
    });

    test('single-flights initialization and cannot commit after terminal destroy begins', async () => {
        manager = new AIContextManager('netflix');
        const initializationGate = createDeferred();
        const initializeComponents = jest
            .spyOn(manager, '_initializeComponents')
            .mockReturnValue(initializationGate.promise);
        const setupEventCoordination = jest.spyOn(
            manager,
            '_setupEventCoordination'
        );

        const firstInitialization = manager.initialize();
        const secondInitialization = manager.initialize();

        expect(secondInitialization).toBe(firstInitialization);
        await Promise.resolve();
        expect(initializeComponents).toHaveBeenCalledTimes(1);

        const destroyPromise = manager.destroy();
        initializationGate.resolve(true);

        await expect(firstInitialization).resolves.toBe(false);
        await destroyPromise;
        expect(setupEventCoordination).not.toHaveBeenCalled();
        expect(manager.initialized).toBe(false);
        expect(manager.getEnabledFeatures()).toEqual([]);
        expect(manager.components.size).toBe(0);
    });

    test('cannot publish an enabled feature after its work crosses terminal destroy', async () => {
        manager = new AIContextManager('netflix');
        const featureGate = createDeferred();
        const enableInteractiveSubtitles = jest
            .spyOn(manager, '_enableInteractiveSubtitles')
            .mockReturnValue(featureGate.promise);

        const enablePromise = manager.enableFeature('interactiveSubtitles');
        expect(enableInteractiveSubtitles).toHaveBeenCalledTimes(1);

        const destroyPromise = manager.destroy();
        featureGate.resolve();

        await expect(enablePromise).resolves.toBe(false);
        await destroyPromise;
        expect(manager.getEnabledFeatures()).toEqual([]);
    });

    test('cannot publish a component candidate after its initialization crosses terminal destroy', async () => {
        manager = new AIContextManager('netflix');
        const modalGate = createDeferred();
        const modalInitialize = jest
            .spyOn(AIContextModal.prototype, 'initialize')
            .mockReturnValue(modalGate.promise);
        const modalDestroy = jest
            .spyOn(AIContextModal.prototype, 'destroy')
            .mockResolvedValue(undefined);

        try {
            const componentInitialization = manager._initializeComponents();
            expect(modalInitialize).toHaveBeenCalledTimes(1);
            expect(manager.getModal()).toBeInstanceOf(AIContextModal);

            const destroyPromise = manager.destroy();
            modalGate.resolve(true);

            await expect(componentInitialization).resolves.toBe(false);
            await destroyPromise;
            expect(modalDestroy).toHaveBeenCalledTimes(1);
            expect(manager.getModal()).toBeNull();
            expect(manager.getProvider()).toBeNull();
            expect(manager.getTextHandler()).toBeNull();
            expect(manager.components.size).toBe(0);
        } finally {
            modalInitialize.mockRestore();
            modalDestroy.mockRestore();
        }
    });

    test.each([false, { success: true }])(
        'rolls back private component owners when provider initialization returns %p',
        async (providerInitializationResult) => {
            const unsubscribe = jest.fn();
            manager = new AIContextManager('netflix', {
                analysisAuthority: {
                    channel: {
                        publish: jest.fn(),
                        subscribe: jest.fn(() => unsubscribe),
                    },
                    allocateRequestId: jest.fn(() => 1),
                    getSelectionSnapshot: jest.fn(() => null),
                    clearSelection: jest.fn(() => true),
                },
            });
            const modalInitialize = jest
                .spyOn(AIContextModal.prototype, 'initialize')
                .mockResolvedValue(true);
            const modalDestroy = jest
                .spyOn(AIContextModal.prototype, 'destroy')
                .mockResolvedValue(undefined);
            const providerInitialize = jest
                .spyOn(AIContextProvider.prototype, 'initialize')
                .mockResolvedValue(providerInitializationResult);
            const providerDestroy = jest
                .spyOn(AIContextProvider.prototype, 'destroy')
                .mockResolvedValue(undefined);
            const textInitialize = jest.spyOn(
                TextSelectionHandler.prototype,
                'initialize'
            );

            try {
                await expect(manager.initialize()).resolves.toBe(false);

                expect(providerInitialize).toHaveBeenCalledTimes(1);
                expect(providerDestroy).toHaveBeenCalledTimes(1);
                expect(modalDestroy).toHaveBeenCalledTimes(1);
                expect(textInitialize).not.toHaveBeenCalled();
                expect(unsubscribe).toHaveBeenCalled();
                expect(manager.initialized).toBe(false);
                expect(manager.getModal()).toBeNull();
                expect(manager.getProvider()).toBeNull();
                expect(manager.components.size).toBe(0);
            } finally {
                modalInitialize.mockRestore();
                modalDestroy.mockRestore();
                providerInitialize.mockRestore();
                providerDestroy.mockRestore();
                textInitialize.mockRestore();
            }
        }
    );

    test('cannot replay buffered selection after modal readiness crosses terminal destroy', async () => {
        manager = new AIContextManager('netflix');
        manager.earlySelectionQueue.push({ word: 'stale-selection' });
        const readyGate = createDeferred();
        const readyWaitReached = createDeferred();
        const modalInitialize = jest
            .spyOn(AIContextModal.prototype, 'initialize')
            .mockImplementation(function initializeModalForTest() {
                Object.defineProperty(this.core, 'onceReady', {
                    configurable: true,
                    get() {
                        readyWaitReached.resolve();
                        return readyGate.promise;
                    },
                });
                return Promise.resolve(true);
            });
        const modalDestroy = jest
            .spyOn(AIContextModal.prototype, 'destroy')
            .mockResolvedValue(undefined);
        const handleWordSelection = jest.spyOn(
            AIContextModal.prototype,
            'handleWordSelection'
        );
        const providerInitialize = jest
            .spyOn(AIContextProvider.prototype, 'initialize')
            .mockResolvedValue(true);
        const providerDestroy = jest
            .spyOn(AIContextProvider.prototype, 'destroy')
            .mockResolvedValue(undefined);
        const textInitialize = jest
            .spyOn(TextSelectionHandler.prototype, 'initialize')
            .mockResolvedValue(true);
        const textDestroy = jest
            .spyOn(TextSelectionHandler.prototype, 'destroy')
            .mockResolvedValue(undefined);

        try {
            const componentInitialization = manager._initializeComponents();
            await readyWaitReached.promise;

            const destroyPromise = manager.destroy();
            readyGate.resolve();

            await expect(componentInitialization).resolves.toBe(false);
            await destroyPromise;
            expect(handleWordSelection).not.toHaveBeenCalled();
            expect(manager.earlySelectionQueue).toEqual([]);
        } finally {
            readyGate.resolve();
            modalInitialize.mockRestore();
            modalDestroy.mockRestore();
            handleWordSelection.mockRestore();
            providerInitialize.mockRestore();
            providerDestroy.mockRestore();
            textInitialize.mockRestore();
            textDestroy.mockRestore();
        }
    });

    test('suppresses late analysis settlement after terminal destroy begins', async () => {
        manager = new AIContextManager('netflix');
        const analysisGate = createDeferred();
        const provider = {
            analyzeContext: jest.fn(() => analysisGate.promise),
            destroy: jest.fn(),
        };
        manager.provider = provider;
        manager.components.set('provider', provider);
        const contextResult = jest.fn();
        const analysisComplete = jest.fn();
        const analysisError = jest.fn();
        document.addEventListener('dualsub-context-result', contextResult);
        document.addEventListener(
            EVENT_TYPES.ANALYSIS_COMPLETE,
            analysisComplete
        );
        document.addEventListener(EVENT_TYPES.ANALYSIS_ERROR, analysisError);

        try {
            const analysisPromise = manager._handleAnalysisRequest({
                detail: {
                    requestId: 'terminal-analysis',
                    text: 'late result must not publish',
                },
            });
            expect(provider.analyzeContext).toHaveBeenCalledTimes(1);

            const destroyPromise = manager.destroy();
            analysisGate.resolve({
                success: true,
                result: { analysis: 'late result' },
            });

            await analysisPromise;
            await destroyPromise;
            expect(contextResult).not.toHaveBeenCalled();
            expect(analysisComplete).not.toHaveBeenCalled();
            expect(analysisError).not.toHaveBeenCalled();
            expect(manager.metrics.errorCount).toBe(0);
        } finally {
            analysisGate.resolve({ success: false });
            document.removeEventListener(
                'dualsub-context-result',
                contextResult
            );
            document.removeEventListener(
                EVENT_TYPES.ANALYSIS_COMPLETE,
                analysisComplete
            );
            document.removeEventListener(
                EVENT_TYPES.ANALYSIS_ERROR,
                analysisError
            );
        }
    });

    test('revokes every inbound listener and early replay before collaborator cleanup starts', async () => {
        manager = new AIContextManager('netflix');
        const documentListeners = new Map(
            [
                'dualsub-analyze-selection',
                EVENT_TYPES.MODAL_STATE_CHANGE,
                EVENT_TYPES.ANALYSIS_PAUSE,
                EVENT_TYPES.SELECTION_CLEARED,
            ].map((eventName) => [eventName, jest.fn()])
        );
        for (const [eventName, listener] of documentListeners) {
            document.addEventListener(eventName, listener);
            manager.eventListeners.set(eventName, listener);
        }
        const earlyListener = jest.fn();
        document.addEventListener('dualsub-word-selected', earlyListener, true);
        manager._earlyWordSelectionListener = earlyListener;
        manager.earlySelectionQueue.push({ word: 'stale' });

        const modalCleanup = createDeferred();
        let stateObservedByModal = null;
        manager.modal = {
            destroy: jest.fn(() => {
                stateObservedByModal = {
                    documentListenerCount: manager.eventListeners.size,
                    earlyListener: manager._earlyWordSelectionListener,
                    earlyQueueLength: manager.earlySelectionQueue.length,
                };
                return modalCleanup.promise;
            }),
        };
        const removeDocumentListenerSpy = jest.spyOn(
            document,
            'removeEventListener'
        );

        const destroyPromise = manager.destroy();

        expect(stateObservedByModal).toEqual({
            documentListenerCount: 0,
            earlyListener: null,
            earlyQueueLength: 0,
        });
        for (const [eventName, listener] of documentListeners) {
            expect(removeDocumentListenerSpy).toHaveBeenCalledWith(
                eventName,
                listener
            );
        }
        expect(removeDocumentListenerSpy).toHaveBeenCalledWith(
            'dualsub-word-selected',
            earlyListener,
            true
        );
        modalCleanup.resolve();
        await destroyPromise;
    });

    test('detaches state, starts each unique collaborator once, and awaits all returned cleanup', async () => {
        const hostFacade = Object.freeze({ marker: 'host-facade' });
        manager = new AIContextManager('netflix', {
            contentScript: hostFacade,
            modal: { contentScript: hostFacade },
        });
        manager.initialized = true;
        manager.enabledFeatures.add('contextModal');
        manager.activeRequest = 'request-1';
        manager._inflightIds = new Set(['request-1']);
        manager.currentState = 'processing';

        const modalCleanup = createDeferred();
        const modal = { destroy: jest.fn(() => modalCleanup.promise) };
        const provider = {
            destroy: jest.fn(() => {
                throw new Error('provider cleanup failed');
            }),
        };
        const hostileThenable = {};
        Object.defineProperty(hostileThenable, 'then', {
            get() {
                throw new Error('hostile then getter');
            },
        });
        const textHandler = {
            destroy: jest.fn(() => hostileThenable),
        };
        manager.modal = modal;
        manager.provider = provider;
        manager.textHandler = textHandler;
        manager.components.set('modal', modal);
        manager.components.set('duplicate-modal', modal);
        manager.components.set('provider', provider);
        manager.components.set('textHandler', textHandler);

        let destroySettled = false;
        const destroyPromise = manager.destroy().then(() => {
            destroySettled = true;
        });

        try {
            expect(modal.destroy).toHaveBeenCalledTimes(1);
            expect(provider.destroy).toHaveBeenCalledTimes(1);
            expect(textHandler.destroy).toHaveBeenCalledTimes(1);
            expect(destroySettled).toBe(false);
            expect(manager.getModal()).toBeNull();
            expect(manager.getProvider()).toBeNull();
            expect(manager.getTextHandler()).toBeNull();
            expect(manager.components.size).toBe(0);
            expect(manager.initialized).toBe(false);
            expect(manager.getEnabledFeatures()).toEqual([]);
            expect(manager.activeRequest).toBeNull();
            expect(manager._inflightIds.size).toBe(0);
            expect(manager.currentState).toBe(MODAL_STATES.HIDDEN);
            expect(manager.contentScript).toBeNull();
            expect(manager.config).toBeNull();
        } finally {
            modalCleanup.resolve();
            await destroyPromise;
        }
        expect(destroySettled).toBe(true);
    });

    test('keeps saved document handlers inert after terminal destroy begins', async () => {
        manager = new AIContextManager('netflix');
        manager.provider = {
            analyzeContext: jest.fn().mockResolvedValue({
                success: true,
                result: { analysis: 'late result' },
            }),
            destroy: jest.fn(),
        };
        await manager._setupEventCoordination();
        const savedListeners = new Map(manager.eventListeners);
        await manager.destroy();
        chrome.runtime.sendMessage.mockClear();

        const contextResultListener = jest.fn();
        const analysisCompleteListener = jest.fn();
        document.addEventListener(
            'dualsub-context-result',
            contextResultListener
        );
        document.addEventListener(
            EVENT_TYPES.ANALYSIS_COMPLETE,
            analysisCompleteListener
        );
        try {
            savedListeners.get('dualsub-analyze-selection')(
                new CustomEvent('dualsub-analyze-selection', {
                    detail: { requestId: 'late', text: 'late request' },
                })
            );
            savedListeners.get(EVENT_TYPES.MODAL_STATE_CHANGE)(
                new CustomEvent(EVENT_TYPES.MODAL_STATE_CHANGE, {
                    detail: {
                        currentState: 'processing',
                        data: { requestId: 'late' },
                    },
                })
            );
            savedListeners.get(EVENT_TYPES.ANALYSIS_PAUSE)(
                new CustomEvent(EVENT_TYPES.ANALYSIS_PAUSE, {
                    detail: { requestId: 'late' },
                })
            );
            await manager._handleAnalysisRequest({
                detail: { requestId: 'late-direct', text: 'late direct' },
            });
            await manager.enableFeature('interactiveSubtitles');
            manager._handleModalStateChange({
                detail: {
                    currentState: 'processing',
                    data: { requestId: 'late-direct' },
                },
            });
            manager._handlePauseAnalysisEvent({ requestId: 'late-direct' });
            manager._dispatchEvent('late-manager-event', { marker: 'late' });
            await Promise.resolve();
            await Promise.resolve();

            expect(contextResultListener).not.toHaveBeenCalled();
            expect(analysisCompleteListener).not.toHaveBeenCalled();
            expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
            expect(manager.getEnabledFeatures()).toEqual([]);
            expect(manager.currentState).toBe(MODAL_STATES.HIDDEN);
            expect(manager.activeRequest).toBeNull();
            expect(manager.config).toBeNull();
        } finally {
            document.removeEventListener(
                'dualsub-context-result',
                contextResultListener
            );
            document.removeEventListener(
                EVENT_TYPES.ANALYSIS_COMPLETE,
                analysisCompleteListener
            );
        }
    });

    test('keeps captured cleanup runnable without allowing returned work to republish manager references', async () => {
        const hostFacade = Object.freeze({ marker: 'host-facade' });
        manager = new AIContextManager('netflix', {
            contentScript: hostFacade,
            modal: { contentScript: hostFacade },
        });
        const cleanupGate = createDeferred();
        let stateObservedAtCleanupStart = null;
        const component = {
            destroy: jest.fn(() => {
                stateObservedAtCleanupStart = {
                    modal: manager.getModal(),
                    provider: manager.getProvider(),
                    textHandler: manager.getTextHandler(),
                    contentScript: manager.contentScript,
                    config: manager.config,
                };
                manager.modal = component;
                manager.provider = component;
                manager.textHandler = component;
                manager.components.set('republished', component);
                manager.contentScript = hostFacade;
                manager.config = {
                    contentScript: hostFacade,
                    modal: { contentScript: hostFacade },
                };
                return cleanupGate.promise.then(() => {
                    manager.modal = component;
                    manager.components.set('late-republished', component);
                    manager.contentScript = hostFacade;
                    manager.config = { contentScript: hostFacade };
                });
            }),
        };
        manager.modal = component;
        manager.provider = component;
        manager.textHandler = component;
        manager.components.set('component', component);

        const destroyPromise = manager.destroy();

        try {
            expect(component.destroy).toHaveBeenCalledTimes(1);
            expect(stateObservedAtCleanupStart).toEqual({
                modal: null,
                provider: null,
                textHandler: null,
                contentScript: null,
                config: null,
            });
            expect(manager.getModal()).toBeNull();
            expect(manager.getProvider()).toBeNull();
            expect(manager.getTextHandler()).toBeNull();
            expect(manager.components.size).toBe(0);
            expect(manager.contentScript).toBeNull();
            expect(manager.config).toBeNull();
        } finally {
            cleanupGate.resolve();
            await destroyPromise;
        }
        expect(manager.getModal()).toBeNull();
        expect(manager.components.size).toBe(0);
        expect(manager.contentScript).toBeNull();
        expect(manager.config).toBeNull();
    });

    test('isolates removal and telemetry failures without logging raw cleanup reasons', async () => {
        manager = new AIContextManager('netflix');
        const firstListener = jest.fn();
        const secondListener = jest.fn();
        document.addEventListener('dualsub-removal-one', firstListener);
        document.addEventListener('dualsub-removal-two', secondListener);
        manager.eventListeners.set('dualsub-removal-one', firstListener);
        manager.eventListeners.set('dualsub-removal-two', secondListener);
        const originalRemoveEventListener =
            document.removeEventListener.bind(document);
        const removeDocumentListenerSpy = jest
            .spyOn(document, 'removeEventListener')
            .mockImplementationOnce(() => {
                throw new Error('REMOVAL_RAW_SECRET');
            })
            .mockImplementation((...args) =>
                originalRemoveEventListener(...args)
            );

        const rawFailure = Object.assign(new Error('COMPONENT_RAW_SECRET'), {
            payload: 'COMPONENT_ENUMERABLE_SECRET',
        });
        const failingComponent = {
            destroy: jest.fn(() => {
                throw rawFailure;
            }),
        };
        const stableComponent = { destroy: jest.fn() };
        manager.modal = failingComponent;
        manager.provider = stableComponent;
        const logger = {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(() => {
                throw new Error('LOGGER_RAW_SECRET');
            }),
        };
        manager.logger = logger;

        try {
            await expect(manager.destroy()).resolves.toBeUndefined();

            expect(stableComponent.destroy).toHaveBeenCalledTimes(1);
            expect(removeDocumentListenerSpy).toHaveBeenCalledWith(
                'dualsub-removal-two',
                secondListener
            );
            expect(logger.error).toHaveBeenCalledWith(
                'AI Context Manager cleanup completed with failures',
                expect.objectContaining({ cleanupFailureCount: 2 })
            );
            const serializedLogs = JSON.stringify(logger.error.mock.calls);
            expect(serializedLogs).not.toContain('REMOVAL_RAW_SECRET');
            expect(serializedLogs).not.toContain('COMPONENT_RAW_SECRET');
            expect(serializedLogs).not.toContain('COMPONENT_ENUMERABLE_SECRET');
            expect(serializedLogs).not.toContain('LOGGER_RAW_SECRET');
            expect(manager.logger).toBeNull();
        } finally {
            removeDocumentListenerSpy.mockRestore();
            document.removeEventListener('dualsub-removal-one', firstListener);
            document.removeEventListener('dualsub-removal-two', secondListener);
        }
    });

    test('keeps the saved production early-selection listener inert after destroy', async () => {
        const addDocumentListenerSpy = jest.spyOn(document, 'addEventListener');
        manager = new AIContextManager('netflix');

        try {
            expect(await manager.initialize()).toBe(true);
            const earlyListenerRegistration =
                addDocumentListenerSpy.mock.calls.find(
                    ([eventName, _listener, options]) =>
                        eventName === 'dualsub-word-selected' &&
                        options === true
                );
            expect(earlyListenerRegistration).toBeDefined();
            const savedEarlyListener = earlyListenerRegistration[1];

            await manager.destroy();
            savedEarlyListener(
                new CustomEvent('dualsub-word-selected', {
                    detail: { word: 'late-word' },
                })
            );

            expect(manager.earlySelectionQueue).toEqual([]);
        } finally {
            addDocumentListenerSpy.mockRestore();
        }
    });

    test('finishes every cleanup and detaches republished state when collection helpers are replaced', async () => {
        const arrayPushDescriptor = Object.getOwnPropertyDescriptor(
            Array.prototype,
            'push'
        );
        const arrayFilterDescriptor = Object.getOwnPropertyDescriptor(
            Array.prototype,
            'filter'
        );
        const mapClearDescriptor = Object.getOwnPropertyDescriptor(
            Map.prototype,
            'clear'
        );
        const setClearDescriptor = Object.getOwnPropertyDescriptor(
            Set.prototype,
            'clear'
        );
        const firstCleanup = createDeferred();
        const secondCleanup = createDeferred();
        const hostFacade = Object.freeze({ marker: 'host-facade' });
        manager = new AIContextManager('netflix', {
            contentScript: hostFacade,
        });
        const pollutedComponents = new Map();
        const pollutedFeatures = new Map([['late-feature', {}]]);
        const pollutedEventListeners = new Map([['late-event', () => {}]]);
        const pollutedEnabledFeatures = new Set(['late-feature']);
        const pollutedInflightIds = new Set(['late-request']);
        const pollutedQueue = [{ word: 'late-word' }];
        const lateEarlyListener = () => {};
        const logger = {
            debug() {},
            info() {},
            warn() {},
            error() {},
        };
        let hostilePushCalls = 0;
        let hostileFilterCalls = 0;
        let hostileMapClearCalls = 0;
        let hostileSetClearCalls = 0;
        let firstDestroyCalls = 0;
        let secondDestroyCalls = 0;
        let thirdDestroyCalls = 0;
        let secondObservedDetached = false;
        let thirdObservedDetached = false;
        let destroySettled = false;
        let settledWhileBothPending = null;
        let settledWhileSecondPending = null;
        let firstComponent;
        let secondComponent;
        let thirdComponent;

        const republishEveryReference = () => {
            manager.modal = firstComponent;
            manager.provider = secondComponent;
            manager.textHandler = thirdComponent;
            manager.components = pollutedComponents;
            manager.features = pollutedFeatures;
            manager.eventListeners = pollutedEventListeners;
            manager.enabledFeatures = pollutedEnabledFeatures;
            manager._inflightIds = pollutedInflightIds;
            manager.earlySelectionQueue = pollutedQueue;
            manager._earlyWordSelectionListener = lateEarlyListener;
            manager.initialized = true;
            manager.currentState = 'processing';
            manager.activeRequest = 'late-request';
            manager.contentScript = hostFacade;
            manager.config = { contentScript: hostFacade };
            manager.logger = logger;
        };

        firstComponent = {
            destroy() {
                firstDestroyCalls += 1;
                Array.prototype.push = function hostilePush() {
                    hostilePushCalls += 1;
                    throw new Error('HOSTILE_ARRAY_PUSH');
                };
                Array.prototype.filter = function hostileFilter() {
                    hostileFilterCalls += 1;
                    throw new Error('HOSTILE_ARRAY_FILTER');
                };
                Map.prototype.clear = function hostileMapClear() {
                    hostileMapClearCalls += 1;
                    throw new Error('HOSTILE_MAP_CLEAR');
                };
                Set.prototype.clear = function hostileSetClear() {
                    hostileSetClearCalls += 1;
                    throw new Error('HOSTILE_SET_CLEAR');
                };
                republishEveryReference();
                return firstCleanup.promise.then(republishEveryReference);
            },
        };
        secondComponent = {
            destroy() {
                secondDestroyCalls += 1;
                secondObservedDetached =
                    manager.modal === null &&
                    manager.provider === null &&
                    manager.textHandler === null &&
                    manager.components.size === 0 &&
                    manager.enabledFeatures.size === 0 &&
                    manager._inflightIds.size === 0 &&
                    manager.contentScript === null &&
                    manager.config === null;
                return secondCleanup.promise;
            },
        };
        thirdComponent = {
            destroy() {
                thirdDestroyCalls += 1;
                thirdObservedDetached =
                    manager.modal === null &&
                    manager.provider === null &&
                    manager.textHandler === null &&
                    manager.components.size === 0 &&
                    manager.enabledFeatures.size === 0 &&
                    manager._inflightIds.size === 0 &&
                    manager.contentScript === null &&
                    manager.config === null;
            },
        };
        pollutedComponents.set('republished', firstComponent);
        manager.modal = firstComponent;
        manager.provider = secondComponent;
        manager.textHandler = thirdComponent;
        manager.components.set('first', firstComponent);
        manager.components.set('second', secondComponent);
        manager.components.set('third', thirdComponent);
        manager.logger = logger;

        let destroyPromise;
        let observedDestroy;
        try {
            destroyPromise = manager.destroy();
            observedDestroy = destroyPromise.then(() => {
                destroySettled = true;
            });
            await Promise.resolve();
            await Promise.resolve();
            settledWhileBothPending = destroySettled;

            firstCleanup.resolve();
            await Promise.resolve();
            await Promise.resolve();
            settledWhileSecondPending = destroySettled;

            secondCleanup.resolve();
            await observedDestroy;
        } finally {
            Object.defineProperty(Array.prototype, 'push', arrayPushDescriptor);
            Object.defineProperty(
                Array.prototype,
                'filter',
                arrayFilterDescriptor
            );
            Object.defineProperty(Map.prototype, 'clear', mapClearDescriptor);
            Object.defineProperty(Set.prototype, 'clear', setClearDescriptor);
            firstCleanup.resolve();
            secondCleanup.resolve();
            await destroyPromise;
        }

        expect(settledWhileBothPending).toBe(false);
        expect(settledWhileSecondPending).toBe(false);
        expect(firstDestroyCalls).toBe(1);
        expect(secondDestroyCalls).toBe(1);
        expect(thirdDestroyCalls).toBe(1);
        expect(secondObservedDetached).toBe(true);
        expect(thirdObservedDetached).toBe(true);
        expect(hostilePushCalls).toBe(0);
        expect(hostileFilterCalls).toBe(0);
        expect(hostileMapClearCalls).toBe(0);
        expect(hostileSetClearCalls).toBe(0);
        expect(manager.getModal()).toBeNull();
        expect(manager.getProvider()).toBeNull();
        expect(manager.getTextHandler()).toBeNull();
        expect(manager.components.size).toBe(0);
        expect(manager.features.size).toBe(0);
        expect(manager.eventListeners.size).toBe(0);
        expect(manager.enabledFeatures.size).toBe(0);
        expect(manager._inflightIds.size).toBe(0);
        expect(manager.earlySelectionQueue).toEqual([]);
        expect(manager._earlyWordSelectionListener).toBeNull();
        expect(manager.initialized).toBe(false);
        expect(manager.currentState).toBe(MODAL_STATES.HIDDEN);
        expect(manager.activeRequest).toBeNull();
        expect(manager.contentScript).toBeNull();
        expect(manager.config).toBeNull();
        expect(manager.logger).toBeNull();
    });

    test('uses trusted intrinsics when an earlier collaborator replaces ambient promise and apply helpers', async () => {
        const promiseDescriptor = Object.getOwnPropertyDescriptor(
            globalThis,
            'Promise'
        );
        const reflectApplyDescriptor = Object.getOwnPropertyDescriptor(
            Reflect,
            'apply'
        );
        const cleanupGate = createDeferred();
        const hostileReceivers = [];
        const hostileApply = jest.fn((_target, receiver) => {
            hostileReceivers.push(receiver);
            throw new Error('HOSTILE_APPLY_CALLED');
        });
        const hostileAllSettled = jest.fn(() => {
            throw new Error('HOSTILE_ALL_SETTLED_CALLED');
        });
        const hostileResolve = jest.fn(() => {
            throw new Error('HOSTILE_RESOLVE_CALLED');
        });
        const hostilePromise = jest.fn(() => {
            throw new Error('HOSTILE_PROMISE_CONSTRUCTOR_CALLED');
        });
        hostilePromise.allSettled = hostileAllSettled;
        hostilePromise.resolve = hostileResolve;

        manager = new AIContextManager('netflix');
        const firstComponent = {
            destroy: jest.fn(() => {
                Reflect.apply = hostileApply;
                globalThis.Promise = hostilePromise;
                return cleanupGate.promise;
            }),
        };
        const secondComponent = { destroy: jest.fn() };
        const thirdCleanup = createDeferred();
        const thirdComponent = {
            destroy: jest.fn(() => thirdCleanup.promise),
        };
        manager.modal = firstComponent;
        manager.provider = secondComponent;
        manager.textHandler = thirdComponent;

        let destroyPromise;
        try {
            destroyPromise = manager.destroy();

            expect(firstComponent.destroy).toHaveBeenCalledTimes(1);
            expect(secondComponent.destroy).toHaveBeenCalledTimes(1);
            expect(thirdComponent.destroy).toHaveBeenCalledTimes(1);
            expect(hostileApply).not.toHaveBeenCalled();
            expect(hostileAllSettled).not.toHaveBeenCalled();
            expect(hostileResolve).not.toHaveBeenCalled();
            expect(hostilePromise).not.toHaveBeenCalled();
            expect(hostileReceivers).toEqual([]);
        } finally {
            Object.defineProperty(globalThis, 'Promise', promiseDescriptor);
            Object.defineProperty(Reflect, 'apply', reflectApplyDescriptor);
            cleanupGate.resolve();
            thirdCleanup.resolve();
            await destroyPromise;
        }
    });
});
