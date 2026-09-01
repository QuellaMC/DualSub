import { jest } from '@jest/globals';

let modalConfig;
const modalApplySelection = jest.fn(() => true);
const modalShowSelection = jest.fn(() => true);
const providerAnalyze = jest.fn();
const providerCancel = jest.fn(() => true);

jest.unstable_mockModule('../ui/modal.js', () => ({
    AIContextModal: class {
        constructor(config) {
            modalConfig = config;
        }

        setLogger() {}

        async initialize() {
            return true;
        }

        applySelectionSnapshot(value) {
            return modalApplySelection(value);
        }

        showSelectionMode(options) {
            return modalShowSelection(options);
        }

        async destroy() {}
    },
}));

jest.unstable_mockModule('../providers/AIContextProvider.js', () => ({
    AIContextProvider: class {
        async initialize() {
            return true;
        }

        analyzeContext(text, options) {
            return providerAnalyze(text, options);
        }

        cancelRequest(requestId) {
            return providerCancel(requestId);
        }

        async destroy() {}
    },
}));

const { AIContextManager } = await import('../core/AIContextManager.js');
const { AI_CONTEXT_SIGNAL_TYPES, createAIContextChannel } =
    await import('../core/AIContextChannel.js');
const {
    buildAnalyzeContextFailureResponse,
    buildAnalyzeContextRequestMessage,
    buildAnalyzeContextSuccessResponse,
    MessageSenderRoles,
} = await import('../../shared/protocol/messageProtocol.js');

function selection(revision = 1, words = ['same', 'word']) {
    return Object.freeze({
        selectionRevision: revision,
        renderRevision: revision,
        reason: words.length ? 'toggle' : 'clear',
        entries: Object.freeze(
            words.map((word, wordIndex) => Object.freeze({ wordIndex, word }))
        ),
    });
}

describe('AIContextManager selection analysis', () => {
    let manager;
    let channel;
    let capabilities;
    let currentSelection;
    let requestId;
    let clearSelection;
    let pausePlayback;

    beforeEach(async () => {
        jest.clearAllMocks();
        currentSelection = selection();
        requestId = 0;
        clearSelection = jest.fn(() => true);
        pausePlayback = jest.fn().mockResolvedValue(true);
        channel = createAIContextChannel({ lifecycleGeneration: 1 });
        manager = new AIContextManager('netflix', {
            analysisAuthority: {
                channel,
                allocateRequestId: () => ++requestId,
                getSelectionSnapshot: () => currentSelection,
                clearSelection,
            },
            contentScript: {
                activePlatform: { pausePlayback },
                configService: {
                    getMultiple: jest.fn().mockResolvedValue({
                        targetLanguage: 'es',
                        originalLanguage: 'en',
                    }),
                },
            },
        });
        expect(await manager.initialize()).toBe(true);
        capabilities = modalConfig.analysisCapabilities;
    });

    afterEach(async () => {
        await manager?.destroy();
    });

    test('opens from a canonical word intent and delegates selection clearing', () => {
        channel.publish(AI_CONTEXT_SIGNAL_TYPES.WORD_INTENT, {
            action: 'toggle',
            renderRevision: 1,
            wordIndex: 0,
            word: 'same',
        });

        expect(modalShowSelection).toHaveBeenCalledWith({
            trigger: 'word-selection',
            preserveSelection: true,
        });
        expect(pausePlayback).toHaveBeenCalledTimes(1);
        expect(capabilities.clearSelection()).toBe(true);
        expect(clearSelection).toHaveBeenCalledTimes(1);
    });

    test('delivers one correlated result to the modal', async () => {
        providerAnalyze.mockImplementation(async (text, options) =>
            buildAnalyzeContextSuccessResponse(
                MessageSenderRoles.CONTENT,
                buildAnalyzeContextRequestMessage(MessageSenderRoles.CONTENT, {
                    text,
                    ...options,
                }),
                { analysis: { summary: 'trusted' } }
            )
        );
        const observed = [];
        capabilities.subscribeSettled((settlement) => {
            observed.push({
                settlement,
                result: capabilities.takeResult(settlement.requestId),
            });
        });

        expect(capabilities.requestAnalysis({ cause: 'user' })).toBe(1);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        expect(observed).toEqual([
            {
                settlement: { requestId: 1, outcome: 'succeeded' },
                result: expect.objectContaining({
                    analysis: { summary: 'trusted' },
                }),
            },
        ]);
        expect(capabilities.takeResult(1)).toBeNull();
    });

    test('allows a correlated retry after a retryable provider failure', async () => {
        providerAnalyze
            .mockImplementationOnce(async (text, options) =>
                buildAnalyzeContextFailureResponse(
                    MessageSenderRoles.CONTENT,
                    buildAnalyzeContextRequestMessage(
                        MessageSenderRoles.CONTENT,
                        { text, ...options }
                    ),
                    { error: 'temporary', shouldRetry: true }
                )
            )
            .mockImplementationOnce(async (text, options) =>
                buildAnalyzeContextSuccessResponse(
                    MessageSenderRoles.CONTENT,
                    buildAnalyzeContextRequestMessage(
                        MessageSenderRoles.CONTENT,
                        { text, ...options }
                    ),
                    { analysis: { summary: 'recovered' } }
                )
            );
        const settlements = [];
        capabilities.subscribeSettled((value) => settlements.push(value));

        expect(capabilities.requestAnalysis({ cause: 'user' })).toBe(1);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        expect(settlements[0]).toMatchObject({
            requestId: 1,
            outcome: 'failed',
            retryable: true,
        });

        expect(
            capabilities.requestAnalysis({ cause: 'retry', retryOf: 1 })
        ).toBe(2);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        expect(settlements.at(-1)).toEqual({
            requestId: 2,
            outcome: 'succeeded',
        });
    });

    test('selection replacement cancels pending work and ignores its late result', async () => {
        let resolveAnalysis;
        providerAnalyze.mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveAnalysis = resolve;
                })
        );
        const settlements = [];
        capabilities.subscribeSettled((value) => settlements.push(value));

        expect(capabilities.requestAnalysis({ cause: 'user' })).toBe(1);
        await Promise.resolve();
        currentSelection = selection(2, ['new']);
        channel.publish(
            AI_CONTEXT_SIGNAL_TYPES.SELECTION_SNAPSHOT,
            currentSelection
        );
        await Promise.resolve();

        expect(providerCancel).toHaveBeenCalledWith('aicontext-1');
        expect(settlements).toEqual([
            {
                requestId: 1,
                outcome: 'cancelled',
                reason: 'selection-invalidated',
            },
        ]);

        resolveAnalysis({ success: true, result: { analysis: {} } });
        await Promise.resolve();
        await Promise.resolve();
        expect(settlements).toHaveLength(1);
    });
});
