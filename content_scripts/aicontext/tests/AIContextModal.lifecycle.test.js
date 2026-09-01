import {
    afterEach,
    beforeEach,
    describe,
    expect,
    jest,
    test,
} from '@jest/globals';
import { AIContextModal } from '../ui/modal.js';

function selectionSnapshot(revision = 1) {
    return {
        selectionRevision: revision,
        renderRevision: revision,
        reason: 'toggle',
        entries: [{ wordIndex: 0, word: 'hello' }],
    };
}

function createAnalysisAuthority() {
    let listener = null;
    let nextRequestId = 1;
    const results = new Map();
    const unsubscribe = jest.fn();
    const capabilities = {
        requestAnalysis: jest.fn(() => nextRequestId++),
        cancelAnalysis: jest.fn(() => true),
        clearSelection: jest.fn(() => true),
        subscribeSettled: jest.fn((settledListener) => {
            listener = settledListener;
            return unsubscribe;
        }),
        takeResult: jest.fn((requestId) => {
            const result = results.get(requestId) ?? null;
            results.delete(requestId);
            return result;
        }),
    };

    return {
        capabilities,
        settle(settlement, result = null) {
            if (result !== null) results.set(settlement.requestId, result);
            return listener(settlement);
        },
        unsubscribe,
    };
}

describe('AIContextModal lifecycle', () => {
    const modals = new Set();

    async function openModal(authority = createAnalysisAuthority()) {
        const modal = new AIContextModal({
            analysisCapabilities: authority.capabilities,
        });
        modals.add(modal);
        await modal.initialize();
        expect(modal.applySelectionSnapshot(selectionSnapshot())).toBe(true);
        expect(modal.showSelectionMode({ trigger: 'word-selection' })).toBe(
            true
        );
        return { authority, modal };
    }

    beforeEach(() => {
        document.body.replaceChildren();
    });

    afterEach(async () => {
        await Promise.all([...modals].map((modal) => modal.destroy()));
        modals.clear();
        document.body.replaceChildren();
        jest.restoreAllMocks();
    });

    test('opens, analyzes, and renders a successful private result', async () => {
        const publicRequest = jest.fn();
        document.addEventListener('dualsub-analyze-selection', publicRequest);
        const { authority, modal } = await openModal();

        expect(modal.isVisible).toBe(true);
        expect(modal.state).toBe('selection');
        expect(document.getElementById('dualsub-start-analysis')).toBeEnabled();

        await expect(modal.controller.startAnalysis()).resolves.toBe(true);
        expect(modal.state).toBe('processing');
        expect(modal.isAnalyzing).toBe(true);
        expect(authority.capabilities.requestAnalysis).toHaveBeenCalledWith({
            cause: 'user',
            retryOf: null,
            contextTypes: ['cultural', 'historical', 'linguistic'],
        });
        expect(publicRequest).not.toHaveBeenCalled();

        const result = { analysis: 'A safe result', contextType: 'all' };
        expect(
            authority.settle({ requestId: 1, outcome: 'succeeded' }, result)
        ).toBe(true);

        expect(modal.state).toBe('display');
        expect(modal.isAnalyzing).toBe(false);
        expect(modal.analysisResult).toBe(result);
        expect(
            document.getElementById('dualsub-analysis-results')
        ).toHaveTextContent('A safe result');
        expect(authority.capabilities.takeResult).toHaveBeenCalledWith(1);

        document.removeEventListener(
            'dualsub-analyze-selection',
            publicRequest
        );
    });

    test('renders failure controls and correlates an explicit retry', async () => {
        const { authority, modal } = await openModal();
        let terminalActions;
        const renderFailure = modal.ui.showPrivateTerminalFailure.bind(
            modal.ui
        );
        jest.spyOn(modal.ui, 'showPrivateTerminalFailure').mockImplementation(
            (details) => {
                terminalActions = details;
                return renderFailure(details);
            }
        );
        await modal.controller.startAnalysis();

        expect(
            authority.settle({
                requestId: 1,
                outcome: 'failed',
                code: 'network',
                retryable: true,
            })
        ).toBe(true);
        const results = document.getElementById('dualsub-analysis-results');
        expect(modal.state).toBe('error');
        expect(results).toHaveTextContent('Analysis could not be completed.');
        expect(results.querySelectorAll('button')).toHaveLength(2);

        const retryButton = results.querySelector('.dualsub-btn-primary');
        retryButton.click();
        expect(authority.capabilities.requestAnalysis).toHaveBeenCalledTimes(1);
        expect(terminalActions.onRetry()).toBe(true);
        expect(authority.capabilities.requestAnalysis).toHaveBeenLastCalledWith(
            {
                cause: 'retry',
                retryOf: 1,
                contextTypes: ['cultural', 'historical', 'linguistic'],
            }
        );

        authority.settle(
            { requestId: 2, outcome: 'succeeded' },
            { analysis: 'Recovered', contextType: 'all' }
        );
        expect(modal.state).toBe('display');
        expect(results).toHaveTextContent('Recovered');
    });

    test('cancels cleanly and ignores a completion after close', async () => {
        const { authority, modal } = await openModal();
        await modal.controller.startAnalysis();

        expect(modal.controller.pauseAnalysis()).toBe(true);
        expect(modal.controller.pauseAnalysis()).toBe(false);
        expect(authority.capabilities.cancelAnalysis).toHaveBeenCalledWith(
            1,
            'user'
        );
        expect(
            authority.settle({
                requestId: 1,
                outcome: 'cancelled',
                reason: 'user',
            })
        ).toBe(true);
        expect(modal.state).toBe('selection');
        expect(modal.isAnalyzing).toBe(false);

        await modal.controller.startAnalysis();
        expect(modal.controller.closeModal()).toBe(true);
        expect(authority.capabilities.cancelAnalysis).toHaveBeenLastCalledWith(
            2,
            'modal-closed'
        );
        expect(authority.capabilities.clearSelection).toHaveBeenCalledTimes(1);
        expect(modal.state).toBe('hidden');

        expect(
            authority.settle(
                { requestId: 2, outcome: 'succeeded' },
                { analysis: 'Too late', contextType: 'all' }
            )
        ).toBe(false);
        expect(modal.state).toBe('hidden');
        expect(document.body).not.toHaveTextContent('Too late');
        expect(authority.capabilities.takeResult).toHaveBeenCalledWith(2);
    });

    test('tears down every owner once and returns one destroy promise', async () => {
        const { authority, modal } = await openModal();
        const owners = [
            [modal.events, 'removeEventListeners'],
            [modal.controller, 'destroy'],
            [modal.animations, 'cleanup'],
            [modal.ui, 'destroy'],
            [modal.core, 'destroy'],
        ];
        const spies = owners.map(([owner, method]) =>
            jest.spyOn(owner, method)
        );

        const first = modal.destroy();
        const second = modal.destroy();
        expect(second).toBe(first);
        await first;

        for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
        expect(authority.unsubscribe).toHaveBeenCalledTimes(1);
        expect(modal.element).toBeNull();
        expect(document.querySelector('.dualsub-context-modal')).toBeNull();
    });
});
