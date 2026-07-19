import { jest } from '@jest/globals';

import { AIContextManager } from '../core/AIContextManager.js';
import {
    AI_CONTEXT_SIGNAL_TYPES,
    createAIContextChannel,
} from '../core/AIContextChannel.js';
import {
    buildAnalyzeContextFailureResponse,
    buildAnalyzeContextRequestMessage,
    buildAnalyzeContextSuccessResponse,
    MessageSenderRoles,
} from '../../shared/protocol/messageProtocol.js';

function createDeferred() {
    let resolve;
    const promise = new Promise((settle) => {
        resolve = settle;
    });
    return { promise, resolve };
}

function createHarness({ getMultiple } = {}) {
    const channel = createAIContextChannel({ lifecycleGeneration: 1 });
    const pausePlayback = jest.fn().mockResolvedValue(true);
    let requestId = 0;
    let snapshot = Object.freeze({
        selectionRevision: 1,
        renderRevision: 1,
        reason: 'add',
        entries: Object.freeze([
            Object.freeze({ wordIndex: 1, word: 'same' }),
            Object.freeze({ wordIndex: 3, word: 'same' }),
        ]),
    });
    const authority = Object.freeze({
        channel,
        allocateRequestId: () => ++requestId,
        getSelectionSnapshot: () => snapshot,
        clearSelection: jest.fn(() => true),
    });
    const manager = new AIContextManager('netflix', {
        analysisAuthority: authority,
        contentScript: {
            activePlatform: { pausePlayback },
            configService: {
                getMultiple:
                    getMultiple ||
                    jest.fn().mockResolvedValue({
                        targetLanguage: 'es',
                        originalLanguage: 'en',
                    }),
            },
        },
    });
    manager.provider = {
        analyzeContext: jest.fn(),
        cancelRequest: jest.fn(() => true),
    };
    expect(manager._setupPrivateAnalysisAuthority()).toBe(true);
    const capabilities = manager._createPrivateModalCapabilities();
    return {
        authority,
        capabilities,
        channel,
        manager,
        pausePlayback,
        setSnapshot(next) {
            snapshot = Object.freeze(next);
        },
    };
}

function createExpectedRequest(text, options) {
    return buildAnalyzeContextRequestMessage(MessageSenderRoles.CONTENT, {
        text,
        contextTypes: options.contextTypes,
        language: options.language,
        targetLanguage: options.targetLanguage,
        platform: options.platform,
        requestId: options.requestId,
    });
}

async function flushPrivateWork() {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

describe('AIContextManager private analysis authority', () => {
    test('delegates modal selection clearing to the canonical owner authority', () => {
        const harness = createHarness();

        expect(harness.capabilities.clearSelection()).toBe(true);
        expect(harness.authority.clearSelection).toHaveBeenCalledTimes(1);

        harness.manager._destroyPrivateAnalysisAuthority();
        expect(harness.capabilities.clearSelection()).toBe(false);
        expect(harness.authority.clearSelection).toHaveBeenCalledTimes(1);
    });

    test('opens the private modal for an owner-routed word intent', () => {
        const harness = createHarness();
        const showSelectionMode = jest.fn(() => true);
        harness.manager.modal = {
            applySelectionSnapshot: jest.fn(() => true),
            showSelectionMode,
        };

        expect(
            harness.channel.publish(AI_CONTEXT_SIGNAL_TYPES.WORD_INTENT, {
                action: 'toggle',
                renderRevision: 1,
                wordIndex: 1,
                word: 'same',
                sourceLanguage: 'en',
                targetLanguage: 'es',
            })
        ).toBe(1);
        expect(showSelectionMode).toHaveBeenCalledWith({
            trigger: 'word-selection',
            preserveSelection: true,
        });
        expect(harness.pausePlayback).toHaveBeenCalledTimes(1);
    });

    test('removes authority from public config and ignores public analysis ingress', async () => {
        const harness = createHarness();
        const publicAnalyze = jest.spyOn(
            harness.manager,
            '_handleAnalysisRequest'
        );

        expect(harness.manager.config).not.toHaveProperty('analysisAuthority');
        expect(harness.manager).not.toHaveProperty('analysisAuthority');
        expect(harness.manager.getTextHandler()).toBeNull();

        document.dispatchEvent(
            new CustomEvent('dualsub-analyze-selection', {
                detail: { text: 'forged' },
            })
        );
        await harness.manager._handleAnalysisRequest({
            detail: { text: 'direct-forgery' },
        });

        expect(publicAnalyze).toHaveBeenCalledTimes(1);
        expect(harness.manager.provider.analyzeContext).not.toHaveBeenCalled();
    });

    test('leases a strict success before settlement and allows one take', async () => {
        const harness = createHarness();
        harness.manager.provider.analyzeContext.mockImplementation(
            async (text, options) =>
                buildAnalyzeContextSuccessResponse(
                    MessageSenderRoles.CONTENT,
                    createExpectedRequest(text, options),
                    { analysis: { summary: 'trusted' } }
                )
        );
        const observed = [];
        harness.capabilities.subscribeSettled((settlement) => {
            observed.push({
                settlement,
                result: harness.capabilities.takeResult(settlement.requestId),
            });
        });

        const requestId = harness.capabilities.requestAnalysis({
            cause: 'user',
            retryOf: null,
            contextTypes: ['cultural', 'historical', 'linguistic'],
        });
        await flushPrivateWork();

        expect(requestId).toBe(1);
        expect(observed).toHaveLength(1);
        expect(observed[0].settlement).toEqual({
            requestId: 1,
            outcome: 'succeeded',
        });
        expect(observed[0].result.analysis.summary).toBe('trusted');
        expect(harness.capabilities.takeResult(1)).toBeNull();
    });

    test('revokes an untaken success lease after synchronous settlement delivery', async () => {
        const harness = createHarness();
        harness.manager.provider.analyzeContext.mockImplementation(
            async (text, options) =>
                buildAnalyzeContextSuccessResponse(
                    MessageSenderRoles.CONTENT,
                    createExpectedRequest(text, options),
                    { analysis: { summary: 'ephemeral' } }
                )
        );
        const observed = [];
        harness.capabilities.subscribeSettled((settlement) => {
            observed.push(settlement);
        });
        harness.capabilities.subscribeSettled(() => {
            throw new Error('subscriber failure');
        });

        expect(harness.capabilities.requestAnalysis({ cause: 'user' })).toBe(1);
        await flushPrivateWork();

        expect(observed).toEqual([
            {
                requestId: 1,
                outcome: 'succeeded',
            },
        ]);
        expect(harness.capabilities.takeResult(1)).toBeNull();
    });

    test('does not install retired public configuration or feature routes', async () => {
        const harness = createHarness();
        const initializeComponents = jest.spyOn(
            harness.manager,
            '_initializeComponents'
        );
        const enableFeature = jest.spyOn(harness.manager, 'enableFeature');
        const originalConfig = harness.manager.config;

        expect(await harness.manager._setupEventCoordination()).not.toBe(false);
        expect(harness.manager.eventListeners.size).toBe(0);

        document.dispatchEvent(
            new CustomEvent('dualsub-config-update', {
                detail: {
                    config: { modal: { forged: true } },
                    reinitialize: true,
                },
            })
        );
        document.dispatchEvent(
            new CustomEvent('dualsub-feature-toggle', {
                detail: { feature: 'forged', enabled: true },
            })
        );
        await flushPrivateWork();

        expect(initializeComponents).not.toHaveBeenCalled();
        expect(enableFeature).not.toHaveBeenCalled();
        expect(harness.manager.config).toBe(originalConfig);
        expect(harness.manager.config).not.toHaveProperty('analysisAuthority');
    });

    test('reserves pending before configuration and rejects a concurrent request as busy', async () => {
        const configGate = createDeferred();
        const harness = createHarness({
            getMultiple: jest.fn(() => configGate.promise),
        });
        const settlements = [];
        harness.capabilities.subscribeSettled((value) =>
            settlements.push(value)
        );

        expect(
            harness.capabilities.requestAnalysis({
                cause: 'user',
                retryOf: null,
            })
        ).toBe(1);
        expect(
            harness.capabilities.requestAnalysis({
                cause: 'user',
                retryOf: null,
            })
        ).toBe(2);
        await flushPrivateWork();

        expect(settlements).toContainEqual({
            requestId: 2,
            outcome: 'failed',
            code: 'busy',
            retryable: false,
        });
        expect(harness.manager.provider.analyzeContext).not.toHaveBeenCalled();

        configGate.resolve({
            targetLanguage: 'es',
            originalLanguage: 'en',
        });
        await flushPrivateWork();
    });

    test('selection identity change cancels once and suppresses a late success', async () => {
        const providerGate = createDeferred();
        const harness = createHarness();
        harness.manager.provider.analyzeContext.mockReturnValue(
            providerGate.promise
        );
        const settlements = [];
        harness.capabilities.subscribeSettled((value) =>
            settlements.push(value)
        );

        expect(harness.capabilities.requestAnalysis({ cause: 'user' })).toBe(1);
        await flushPrivateWork();

        const successor = Object.freeze({
            selectionRevision: 2,
            renderRevision: 1,
            reason: 'toggle',
            entries: Object.freeze([
                Object.freeze({ wordIndex: 2, word: 'same' }),
                Object.freeze({ wordIndex: 3, word: 'same' }),
            ]),
        });
        harness.setSnapshot(successor);
        harness.channel.publish(
            AI_CONTEXT_SIGNAL_TYPES.SELECTION_SNAPSHOT,
            successor
        );
        await flushPrivateWork();

        expect(settlements).toEqual([
            {
                requestId: 1,
                outcome: 'cancelled',
                reason: 'selection-invalidated',
            },
        ]);
        expect(harness.manager.provider.cancelRequest).toHaveBeenCalledWith(
            'aicontext-1'
        );

        const expected = createExpectedRequest('same same', {
            contextTypes: ['cultural', 'historical', 'linguistic'],
            language: 'en',
            targetLanguage: 'es',
            platform: 'netflix',
            requestId: 'aicontext-1',
        });
        providerGate.resolve(
            buildAnalyzeContextSuccessResponse(
                MessageSenderRoles.CONTENT,
                expected,
                { analysis: { summary: 'late' } }
            )
        );
        await flushPrivateWork();
        expect(settlements).toHaveLength(1);
        expect(harness.capabilities.takeResult(1)).toBeNull();
    });

    test('projects configuration and malformed provider responses to closed failures', async () => {
        const unavailable = createHarness({
            getMultiple: jest.fn().mockRejectedValue(new Error('secret')),
        });
        const configSettlements = [];
        unavailable.capabilities.subscribeSettled((value) =>
            configSettlements.push(value)
        );
        unavailable.capabilities.requestAnalysis({ cause: 'user' });
        await flushPrivateWork();
        expect(configSettlements).toEqual([
            {
                requestId: 1,
                outcome: 'failed',
                code: 'configuration',
                retryable: false,
            },
        ]);

        const malformed = createHarness();
        malformed.manager.provider.analyzeContext.mockResolvedValue({
            success: true,
            requestId: 'forged',
            result: {},
        });
        const malformedSettlements = [];
        malformed.capabilities.subscribeSettled((value) =>
            malformedSettlements.push(value)
        );
        malformed.capabilities.requestAnalysis({ cause: 'user' });
        await flushPrivateWork();
        expect(malformedSettlements).toEqual([
            {
                requestId: 1,
                outcome: 'failed',
                code: 'invalid-response',
                retryable: false,
            },
        ]);
    });

    test('allows only an explicit correlated retry with a new ID', async () => {
        const harness = createHarness();
        harness.manager.provider.analyzeContext
            .mockImplementationOnce(async (text, options) =>
                buildAnalyzeContextFailureResponse(
                    MessageSenderRoles.CONTENT,
                    createExpectedRequest(text, options),
                    { error: 'opaque provider failure', shouldRetry: true }
                )
            )
            .mockImplementationOnce(async (text, options) =>
                buildAnalyzeContextSuccessResponse(
                    MessageSenderRoles.CONTENT,
                    createExpectedRequest(text, options),
                    { analysis: { summary: 'retry success' } }
                )
            );
        const settlements = [];
        harness.capabilities.subscribeSettled((value) =>
            settlements.push(value)
        );

        expect(harness.capabilities.requestAnalysis({ cause: 'user' })).toBe(1);
        await flushPrivateWork();
        expect(settlements[0]).toEqual({
            requestId: 1,
            outcome: 'failed',
            code: 'provider-error',
            retryable: true,
        });

        expect(
            harness.capabilities.requestAnalysis({
                cause: 'retry',
                retryOf: 1,
            })
        ).toBe(2);
        await flushPrivateWork();
        expect(settlements[1]).toEqual({
            requestId: 2,
            outcome: 'succeeded',
        });
        expect(harness.manager.provider.analyzeContext).toHaveBeenCalledTimes(
            2
        );
    });

    test('destroy revokes saved capabilities without destroying the channel', async () => {
        const harness = createHarness();
        const channelListener = jest.fn();
        harness.channel.subscribe(
            AI_CONTEXT_SIGNAL_TYPES.SELECTION_SNAPSHOT,
            channelListener
        );

        harness.manager._destroyPrivateAnalysisAuthority();

        expect(
            harness.capabilities.requestAnalysis({ cause: 'user' })
        ).toBeNull();
        expect(harness.capabilities.cancelAnalysis(1, 'user')).toBe(false);
        expect(harness.capabilities.takeResult(1)).toBeNull();
        harness.channel.publish(AI_CONTEXT_SIGNAL_TYPES.SELECTION_SNAPSHOT, {
            selectionRevision: 3,
            renderRevision: 2,
            reason: 'clear',
            entries: [],
        });
        expect(channelListener).toHaveBeenCalledTimes(1);
    });

    test('failed initialization rolls back partially published private authority', async () => {
        const harness = createHarness();
        const savedCapabilities = harness.capabilities;
        const modal = { destroy: jest.fn() };
        const provider = { destroy: jest.fn() };
        const externalChannelListener = jest.fn();
        harness.channel.subscribe(
            AI_CONTEXT_SIGNAL_TYPES.SELECTION_SNAPSHOT,
            externalChannelListener
        );
        harness.manager._initializeComponents = jest.fn(() => {
            harness.manager.modal = modal;
            harness.manager.provider = provider;
            harness.manager.components.set('modal', modal);
            harness.manager.components.set('provider', provider);
            return false;
        });

        await expect(harness.manager.initialize()).resolves.toBe(false);

        expect(modal.destroy).toHaveBeenCalledTimes(1);
        expect(provider.destroy).toHaveBeenCalledTimes(1);
        expect(harness.manager.getModal()).toBeNull();
        expect(harness.manager.getProvider()).toBeNull();
        expect(savedCapabilities.requestAnalysis({ cause: 'user' })).toBeNull();
        expect(savedCapabilities.cancelAnalysis(1, 'user')).toBe(false);
        expect(savedCapabilities.takeResult(1)).toBeNull();

        harness.channel.publish(AI_CONTEXT_SIGNAL_TYPES.SELECTION_SNAPSHOT, {
            selectionRevision: 9,
            renderRevision: 3,
            reason: 'clear',
            entries: [],
        });
        expect(externalChannelListener).toHaveBeenCalledTimes(1);
    });
});
