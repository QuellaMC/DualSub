import { jest } from '@jest/globals';
import { useState } from 'react';
import {
    act,
    fireEvent,
    render,
    screen,
    waitFor,
} from '@testing-library/react';
import {
    buildSidePanelBindingConfirmationMessage,
    buildSidePanelSelectionRemovalResultMessage,
    buildSidePanelSelectionStateMessage,
    buildSidePanelTabActivatedMessage,
} from '../../content_scripts/shared/protocol/messageProtocol.js';
import { SidePanelProvider, useSidePanelContext } from './SidePanelContext.jsx';
import { useWordSelection } from './useWordSelection.js';

function createPort() {
    const messageListeners = new Set();
    const disconnectListeners = new Set();
    const port = {
        disconnect: jest.fn(),
        onDisconnect: {
            addListener: jest.fn((listener) =>
                disconnectListeners.add(listener)
            ),
        },
        onMessage: {
            addListener: jest.fn((listener) => messageListeners.add(listener)),
        },
        postMessage: jest.fn((message) => {
            if (message.action === 'sidePanelRegister') {
                port.emit(
                    buildSidePanelBindingConfirmationMessage(message.data)
                );
            }
        }),
        emit(message) {
            for (const listener of [...messageListeners]) listener(message);
        },
        emitDisconnect() {
            for (const listener of [...disconnectListeners]) listener();
        },
    };
    return port;
}

function lastPosted(port, action) {
    return port.postMessage.mock.calls
        .map(([message]) => message)
        .filter((message) => message.action === action)
        .at(-1);
}

function makeSelection({
    entries = [
        { word: 'echo', wordIndex: 1 },
        { word: 'echo', wordIndex: 4 },
    ],
    owner = 1,
    reason = 'add',
    render = 1,
    revision = 1,
} = {}) {
    return {
        selectionOwnerGeneration: owner,
        selectionRevision: revision,
        renderRevision: render,
        reason,
        entries,
    };
}

function ContextProbe() {
    const {
        activeTabId,
        analysisResult,
        error,
        selectedWords,
        updateTabState,
    } = useSidePanelContext();
    const { isUpdatingSelection, removeWordAt } = useWordSelection();
    const [removalResult, setRemovalResult] = useState('unset');

    return (
        <>
            <span data-testid="active-tab">{activeTabId ?? 'inactive'}</span>
            <span data-testid="selected-words">{selectedWords.join('|')}</span>
            <span data-testid="analysis">
                {analysisResult?.definition || ''}
            </span>
            <span data-testid="error">{error || ''}</span>
            <span data-testid="updating">
                {isUpdatingSelection ? 'updating' : 'idle'}
            </span>
            <span data-testid="removal-result">{removalResult}</span>
            <button
                type="button"
                onClick={() =>
                    updateTabState(activeTabId, {
                        analysisResult: { definition: 'cached' },
                        error: 'cached error',
                    })
                }
            >
                Seed analysis
            </button>
            <button
                type="button"
                onClick={() =>
                    void removeWordAt(1).then((applied) =>
                        setRemovalResult(applied ? 'applied' : 'rejected')
                    )
                }
            >
                Remove second
            </button>
        </>
    );
}

describe('SidePanelContext selection UX', () => {
    let port;

    beforeEach(() => {
        port = createPort();
        chrome.runtime.connect = jest.fn(() => port);
        chrome.tabs.query
            .mockReset()
            .mockResolvedValue([{ active: true, id: 7, windowId: 1 }]);
    });

    async function renderPanel() {
        render(
            <SidePanelProvider>
                <ContextProbe />
            </SidePanelProvider>
        );
        await waitFor(() =>
            expect(lastPosted(port, 'sidePanelRegister')).toBeDefined()
        );
        return lastPosted(port, 'sidePanelRegister').data;
    }

    test('shows the authoritative selection and preserves duplicate occurrences', async () => {
        const binding = await renderPanel();

        act(() => {
            port.emit(
                buildSidePanelSelectionStateMessage(binding, makeSelection())
            );
        });

        expect(screen.getByTestId('active-tab')).toHaveTextContent('7');
        expect(screen.getByTestId('selected-words')).toHaveTextContent(
            'echo|echo'
        );
    });

    test('clears prior analysis when a newer selection arrives', async () => {
        const binding = await renderPanel();
        act(() => {
            port.emit(
                buildSidePanelSelectionStateMessage(binding, makeSelection())
            );
        });
        fireEvent.click(screen.getByText('Seed analysis'));
        expect(screen.getByTestId('analysis')).toHaveTextContent('cached');
        expect(screen.getByTestId('error')).toHaveTextContent('cached error');

        act(() => {
            port.emit(
                buildSidePanelSelectionStateMessage(
                    binding,
                    makeSelection({
                        entries: [{ word: 'next', wordIndex: 2 }],
                        revision: 2,
                    })
                )
            );
        });

        expect(screen.getByTestId('selected-words')).toHaveTextContent('next');
        expect(screen.getByTestId('analysis')).toBeEmptyDOMElement();
        expect(screen.getByTestId('error')).toBeEmptyDOMElement();
    });

    test('ignores stale, wrong-binding, and malformed selection messages', async () => {
        const binding = await renderPanel();
        const current = makeSelection({
            entries: [{ word: 'current', wordIndex: 2 }],
            revision: 2,
        });
        act(() => {
            port.emit(buildSidePanelSelectionStateMessage(binding, current));
            port.emit(
                buildSidePanelSelectionStateMessage(
                    binding,
                    makeSelection({
                        entries: [{ word: 'stale', wordIndex: 1 }],
                        revision: 1,
                    })
                )
            );
            port.emit(
                buildSidePanelSelectionStateMessage(
                    { ...binding, registrationId: binding.registrationId + 1 },
                    makeSelection({
                        entries: [{ word: 'wrong', wordIndex: 3 }],
                        revision: 3,
                    })
                )
            );
            port.emit({
                action: 'sidePanelSelectionSync',
                data: { binding, selection: { entries: 'invalid' } },
            });
        });

        expect(screen.getByTestId('selected-words')).toHaveTextContent(
            'current'
        );
    });

    test('switches tabs only through a valid registration and rejects old state', async () => {
        const oldBinding = await renderPanel();
        act(() => {
            port.emit(
                buildSidePanelSelectionStateMessage(oldBinding, makeSelection())
            );
            port.emit(
                buildSidePanelTabActivatedMessage({ tabId: 8, windowId: 1 })
            );
        });
        const newBinding = lastPosted(port, 'sidePanelRegister').data;

        expect(newBinding.tabId).toBe(8);
        expect(screen.getByTestId('active-tab')).toHaveTextContent('8');
        expect(screen.getByTestId('selected-words')).toBeEmptyDOMElement();

        act(() => {
            port.emit(
                buildSidePanelSelectionStateMessage(
                    oldBinding,
                    makeSelection({
                        entries: [{ word: 'old', wordIndex: 1 }],
                    })
                )
            );
            port.emit(
                buildSidePanelSelectionStateMessage(
                    newBinding,
                    makeSelection({
                        entries: [{ word: 'new', wordIndex: 1 }],
                        owner: 2,
                    })
                )
            );
        });
        expect(screen.getByTestId('selected-words')).toHaveTextContent('new');
    });

    test('removes one duplicate only after the authoritative successor and terminal result', async () => {
        const binding = await renderPanel();
        const selection = makeSelection();
        act(() => {
            port.emit(buildSidePanelSelectionStateMessage(binding, selection));
        });

        fireEvent.click(screen.getByText('Remove second'));
        const removal = lastPosted(port, 'sidePanelUpdateState');
        expect(removal.data.wordIndex).toBe(4);
        expect(screen.getByTestId('updating')).toHaveTextContent('updating');

        act(() => {
            port.emit(
                buildSidePanelSelectionStateMessage(
                    binding,
                    makeSelection({
                        entries: [{ word: 'echo', wordIndex: 1 }],
                        reason: 'remove',
                        revision: 2,
                    })
                )
            );
            port.emit(
                buildSidePanelSelectionRemovalResultMessage(
                    removal.data,
                    'applied'
                )
            );
        });

        await waitFor(() =>
            expect(screen.getByTestId('removal-result')).toHaveTextContent(
                'applied'
            )
        );
        expect(screen.getByTestId('selected-words')).toHaveTextContent('echo');
        expect(screen.getByTestId('updating')).toHaveTextContent('idle');
    });

    test('keeps the selection when the background rejects removal', async () => {
        const binding = await renderPanel();
        act(() => {
            port.emit(
                buildSidePanelSelectionStateMessage(binding, makeSelection())
            );
        });
        fireEvent.click(screen.getByText('Remove second'));
        const removal = lastPosted(port, 'sidePanelUpdateState');

        act(() => {
            port.emit(
                buildSidePanelSelectionRemovalResultMessage(
                    removal.data,
                    'rejected'
                )
            );
        });

        await waitFor(() =>
            expect(screen.getByTestId('removal-result')).toHaveTextContent(
                'rejected'
            )
        );
        expect(screen.getByTestId('selected-words')).toHaveTextContent(
            'echo|echo'
        );
    });

    test('clears selection on disconnect and ignores the retired port', async () => {
        const binding = await renderPanel();
        act(() => {
            port.emit(
                buildSidePanelSelectionStateMessage(binding, makeSelection())
            );
            port.emitDisconnect();
            port.emit(
                buildSidePanelSelectionStateMessage(
                    binding,
                    makeSelection({
                        entries: [{ word: 'late', wordIndex: 2 }],
                        revision: 2,
                    })
                )
            );
        });

        expect(screen.getByTestId('selected-words')).toBeEmptyDOMElement();
    });
});
