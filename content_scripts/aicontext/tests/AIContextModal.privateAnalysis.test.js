import {
    afterEach,
    beforeEach,
    describe,
    expect,
    jest,
    test,
} from '@jest/globals';
import { AIContextModalCore } from '../ui/modal-core.js';
import { ModalController } from '../ui/events/ModalController.js';

function selectionSnapshot() {
    return {
        selectionRevision: 1,
        renderRevision: 1,
        reason: 'toggle',
        entries: [{ wordIndex: 0, word: 'hello' }],
    };
}

function createHarness(capabilityOverrides = {}) {
    document.body.innerHTML = `
        <div id="dualsub-original-subtitle"></div>
        <div id="dualsub-modal-content">
            <div id="dualsub-selected-words"></div>
            <button id="dualsub-start-analysis"></button>
            <div id="dualsub-analysis-results"></div>
        </div>
    `;

    const core = new AIContextModalCore({ privateAnalysis: true });
    core.contentElement = document.getElementById('dualsub-modal-content');
    core.element = core.contentElement;
    core.applyPrivateSelectionSnapshot(selectionSnapshot());

    const ui = {
        _getLocalizedMessage: jest.fn((key) => key),
        clearTerminalRetryActions: jest.fn(),
        showAnalysisResults: jest.fn(),
        showInitialState: jest.fn(),
        showPrivateTerminalFailure: jest.fn(() => core.setState('error')),
        showProcessingState: jest.fn(),
        updateSelectionDisplay: jest.fn(),
    };
    const animations = {
        hideModal: jest.fn(() => core.setState('hidden')),
        showProcessingState: jest.fn(),
        showResultsState: jest.fn(() => core.setState('display')),
    };

    let settlementListener = null;
    const unsubscribe = jest.fn();
    const capabilities = {
        requestAnalysis: jest.fn(() => 1),
        cancelAnalysis: jest.fn(() => true),
        clearSelection: jest.fn(() => true),
        subscribeSettled: jest.fn((listener) => {
            settlementListener = listener;
            return unsubscribe;
        }),
        takeResult: jest.fn(() => ({
            analysis: 'A safe result',
            contextType: 'all',
        })),
        ...capabilityOverrides,
    };
    const controller = new ModalController(core, ui, animations, capabilities);

    return {
        animations,
        capabilities,
        controller,
        core,
        settle: (settlement) => settlementListener(settlement),
        ui,
        unsubscribe,
    };
}

describe('AIContextModal private analysis', () => {
    const controllers = new Set();

    function setup(capabilityOverrides) {
        const harness = createHarness(capabilityOverrides);
        controllers.add(harness.controller);
        return harness;
    }

    beforeEach(() => {
        document.body.replaceChildren();
    });

    afterEach(() => {
        for (const controller of controllers) controller.destroy();
        controllers.clear();
        document.body.replaceChildren();
    });

    test('success consumes the correlated result and renders it', async () => {
        const result = { analysis: 'A safe result', contextType: 'all' };
        const harness = setup({
            requestAnalysis: jest.fn(() => 11),
            takeResult: jest.fn(() => result),
        });

        await expect(harness.controller.startAnalysis()).resolves.toBe(true);
        expect(harness.capabilities.requestAnalysis).toHaveBeenCalledWith({
            cause: 'user',
            retryOf: null,
            contextTypes: ['cultural', 'historical', 'linguistic'],
        });

        expect(harness.settle({ requestId: 11, outcome: 'succeeded' })).toBe(
            true
        );
        expect(harness.capabilities.takeResult).toHaveBeenCalledWith(11);
        expect(harness.core.analysisResult).toBe(result);
        expect(harness.core.state).toBe('display');
        expect(harness.animations.showResultsState).toHaveBeenCalledWith(
            expect.stringContaining('A safe result')
        );
    });

    test('failure exposes one retry correlated to the failed request', async () => {
        const requestIds = [21, 22];
        const harness = setup({
            requestAnalysis: jest.fn(() => requestIds.shift()),
        });
        await harness.controller.startAnalysis();

        expect(
            harness.settle({
                requestId: 21,
                outcome: 'failed',
                code: 'network',
                retryable: true,
            })
        ).toBe(true);
        expect(harness.core.state).toBe('error');
        const failure = harness.ui.showPrivateTerminalFailure.mock.calls[0][0];
        expect(failure.retryable).toBe(true);

        expect(failure.onRetry()).toBe(true);
        expect(harness.capabilities.requestAnalysis).toHaveBeenLastCalledWith({
            cause: 'retry',
            retryOf: 21,
            contextTypes: ['cultural', 'historical', 'linguistic'],
        });
        expect(harness.core.currentRequest).toBe(22);
    });

    test('cancel is requested once and returns to selection on settlement', async () => {
        const harness = setup({ requestAnalysis: jest.fn(() => 31) });
        await harness.controller.startAnalysis();

        expect(harness.controller.pauseAnalysis()).toBe(true);
        expect(harness.controller.pauseAnalysis()).toBe(false);
        expect(harness.capabilities.cancelAnalysis).toHaveBeenCalledTimes(1);
        expect(harness.capabilities.cancelAnalysis).toHaveBeenCalledWith(
            31,
            'user'
        );

        expect(
            harness.settle({
                requestId: 31,
                outcome: 'cancelled',
                reason: 'user',
            })
        ).toBe(true);
        expect(harness.core.currentRequest).toBeNull();
        expect(harness.core.isAnalyzing).toBe(false);
        expect(harness.core.state).toBe('selection');
        expect(harness.ui.showInitialState).toHaveBeenCalledTimes(1);
    });

    test('stale successes are drained and saved listeners become inert', async () => {
        const harness = setup({ requestAnalysis: jest.fn(() => 41) });
        await harness.controller.startAnalysis();

        expect(harness.settle({ requestId: 999, outcome: 'succeeded' })).toBe(
            false
        );
        expect(harness.capabilities.takeResult).toHaveBeenCalledWith(999);
        expect(harness.core.currentRequest).toBe(41);
        expect(harness.animations.showResultsState).not.toHaveBeenCalled();

        harness.controller.destroy();
        expect(harness.unsubscribe).toHaveBeenCalledTimes(1);
        expect(harness.settle({ requestId: 41, outcome: 'succeeded' })).toBe(
            false
        );
        expect(harness.capabilities.takeResult).not.toHaveBeenCalledWith(41);
    });

    test('close cancels before clearing and ignores the late settlement', async () => {
        const operations = [];
        const harness = setup({
            requestAnalysis: jest.fn(() => 51),
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
            51,
            'modal-closed'
        );
        expect(harness.core.currentRequest).toBeNull();
        expect(harness.core.state).toBe('hidden');
        expect(harness.animations.hideModal).toHaveBeenCalledTimes(1);

        expect(
            harness.settle({
                requestId: 51,
                outcome: 'cancelled',
                reason: 'modal-closed',
            })
        ).toBe(false);
        expect(harness.ui.showInitialState).not.toHaveBeenCalled();
    });
});
