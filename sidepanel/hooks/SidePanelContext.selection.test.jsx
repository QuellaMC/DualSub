import { jest } from '@jest/globals';
import { useEffect, useRef, useState } from 'react';
import {
    act,
    fireEvent,
    render,
    screen,
    waitFor,
} from '@testing-library/react';
import {
    buildSidePanelForceBindTabMessage,
    buildSidePanelSelectionRemovalResultMessage,
    buildSidePanelSelectionStateMessage,
    buildSidePanelTabActivatedMessage,
} from '../../content_scripts/shared/protocol/messageProtocol.js';
import { SidePanelProvider, useSidePanelContext } from './SidePanelContext.jsx';
import { useWordSelection } from './useWordSelection.js';

function createPort({ acknowledgeRegistrations = true } = {}) {
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
        postMessage: null,
        emit(message) {
            messageListeners.forEach((listener) => listener(message));
        },
        emitDisconnect() {
            disconnectListeners.forEach((listener) => listener());
        },
    };
    port.postMessage = jest.fn((message) => {
        if (
            acknowledgeRegistrations &&
            message?.action === 'sidePanelRegister'
        ) {
            port.emit({
                action: 'sidePanelBindingConfirmed',
                data: message.data,
            });
        }
    });
    return port;
}

function SelectionProbe() {
    const {
        activeTabId,
        analysisResult,
        error,
        selection,
        selectedWords,
        updateTabState,
    } = useSidePanelContext();

    return (
        <>
            <span data-testid="selected-words">{selectedWords.join('|')}</span>
            <span data-testid="active-tab">{activeTabId ?? 'inactive'}</span>
            <span data-testid="selection">
                {selection ? JSON.stringify(selection) : 'null'}
            </span>
            <span data-testid="analysis-result">
                {analysisResult?.definition || ''}
            </span>
            <span data-testid="analysis-error">{error || ''}</span>
            <button
                type="button"
                onClick={() =>
                    updateTabState(activeTabId, {
                        analysisResult: { definition: 'cached analysis' },
                        error: 'cached error',
                    })
                }
            >
                Seed analysis
            </button>
        </>
    );
}

function ReentrantClearProbe({ onClear }) {
    const { communication } = useSidePanelContext();
    const armedRef = useRef(false);
    const handledClearRef = useRef(false);

    useEffect(
        () =>
            communication.onSelectionState(({ selection, tabId }) => {
                if (
                    selection !== null ||
                    tabId !== 7 ||
                    !armedRef.current ||
                    handledClearRef.current
                ) {
                    return;
                }
                handledClearRef.current = true;
                onClear(communication);
            }),
        [communication, onClear]
    );

    return (
        <button
            type="button"
            onClick={() => {
                armedRef.current = true;
                communication.registerTab(8, 1);
            }}
        >
            Replace binding
        </button>
    );
}

function GenericMessageProbe({ action, callback }) {
    const { communication } = useSidePanelContext();

    useEffect(
        () => communication.onMessage(action, callback),
        [action, callback, communication]
    );
    return null;
}

function SelectionEventProbe({ callback }) {
    const { communication } = useSidePanelContext();

    useEffect(
        () => communication.onSelectionState(callback),
        [callback, communication]
    );
    return null;
}

function WordSelectionProbe() {
    const { isUpdatingSelection, removeWordAt, selectedWords } =
        useWordSelection();
    const [lastApplied, setLastApplied] = useState('unset');

    return (
        <>
            <span data-testid="word-selection-values">
                {selectedWords.join('|')}
            </span>
            <span data-testid="word-selection-updating">
                {isUpdatingSelection ? 'updating' : 'idle'}
            </span>
            <span data-testid="word-selection-result">{lastApplied}</span>
            <button
                type="button"
                onClick={() =>
                    void removeWordAt(1).then((applied) =>
                        setLastApplied(applied ? 'applied' : 'rejected')
                    )
                }
            >
                Remove second occurrence
            </button>
        </>
    );
}

describe('SidePanelContext authoritative selection state', () => {
    let port;

    beforeEach(() => {
        port = createPort();
        chrome.runtime.connect = jest.fn(() => port);
        chrome.tabs.query.mockReset().mockResolvedValue([
            {
                active: true,
                id: 7,
                windowId: 1,
                url: 'https://www.netflix.com/watch/1',
            },
        ]);
        global.testUtils.setupChromeStorage({ targetLanguage: 'es' });
    });

    test('preserves duplicate occurrences from one canonical bound selection', async () => {
        render(
            <SidePanelProvider>
                <SelectionProbe />
            </SidePanelProvider>
        );
        await waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));
        const binding = port.postMessage.mock.calls[0][0].data;
        const selection = {
            selectionOwnerGeneration: 3,
            selectionRevision: 4,
            renderRevision: 5,
            reason: 'add',
            entries: [
                { wordIndex: 2, word: 'very' },
                { wordIndex: 3, word: 'very' },
                { wordIndex: 4, word: 'good' },
            ],
        };

        act(() => {
            port.emit(buildSidePanelSelectionStateMessage(binding, selection));
        });

        expect(screen.getByTestId('selected-words')).toHaveTextContent(
            'very|very|good'
        );
        expect(JSON.parse(screen.getByTestId('selection').textContent)).toEqual(
            selection
        );
    });

    test('rejects stale or conflicting selection states without regressing selection analysis', async () => {
        render(
            <SidePanelProvider>
                <SelectionProbe />
            </SidePanelProvider>
        );
        await waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));
        const binding = port.postMessage.mock.calls[0][0].data;
        const accepted = {
            selectionOwnerGeneration: 5,
            selectionRevision: 6,
            renderRevision: 7,
            reason: 'add',
            entries: [{ wordIndex: 1, word: 'current' }],
        };
        act(() => {
            port.emit(buildSidePanelSelectionStateMessage(binding, accepted));
        });
        fireEvent.click(screen.getByRole('button', { name: 'Seed analysis' }));

        const rejectedStates = [
            {
                selectionOwnerGeneration: 4,
                selectionRevision: 99,
                renderRevision: 99,
                reason: 'add',
                entries: [{ wordIndex: 2, word: 'lower-owner' }],
            },
            {
                ...accepted,
                selectionRevision: 5,
                entries: [{ wordIndex: 2, word: 'lower-revision' }],
            },
            {
                ...accepted,
                selectionRevision: 7,
                renderRevision: 6,
                entries: [{ wordIndex: 2, word: 'render-regression' }],
            },
            {
                ...accepted,
                renderRevision: 8,
                entries: [{ wordIndex: 2, word: 'same-revision-conflict' }],
            },
        ];
        act(() => {
            for (const rejected of rejectedStates) {
                port.emit(
                    buildSidePanelSelectionStateMessage(binding, rejected)
                );
            }
            port.emit(
                buildSidePanelSelectionStateMessage(binding, { ...accepted })
            );
        });

        expect(JSON.parse(screen.getByTestId('selection').textContent)).toEqual(
            accepted
        );
        expect(screen.getByTestId('selected-words')).toHaveTextContent(
            'current'
        );
        expect(screen.getByTestId('analysis-result')).toHaveTextContent(
            'cached analysis'
        );
        expect(screen.getByTestId('analysis-error')).toHaveTextContent(
            'cached error'
        );

        act(() => {
            port.emit(
                buildSidePanelSelectionStateMessage(binding, {
                    selectionOwnerGeneration: 6,
                    selectionRevision: 1,
                    renderRevision: 1,
                    reason: 'add',
                    entries: [{ wordIndex: 3, word: 'new-owner' }],
                })
            );
        });

        expect(screen.getByTestId('selected-words')).toHaveTextContent(
            'new-owner'
        );
        expect(screen.getByTestId('analysis-result')).toBeEmptyDOMElement();
        expect(screen.getByTestId('analysis-error')).toBeEmptyDOMElement();
    });

    test('resets the freshness cursor when the exact binding is replaced', async () => {
        render(
            <SidePanelProvider>
                <SelectionProbe />
            </SidePanelProvider>
        );
        await waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));
        const firstBinding = port.postMessage.mock.calls[0][0].data;
        act(() => {
            port.emit(
                buildSidePanelSelectionStateMessage(firstBinding, {
                    selectionOwnerGeneration: 20,
                    selectionRevision: 21,
                    renderRevision: 22,
                    reason: 'add',
                    entries: [{ wordIndex: 1, word: 'old-binding' }],
                })
            );
            port.emit({
                action: 'tabActivated',
                data: { tabId: 8, windowId: 1 },
            });
        });

        expect(port.postMessage).toHaveBeenCalledTimes(2);
        const replacementBinding = port.postMessage.mock.calls[1][0].data;
        expect(replacementBinding).toMatchObject({ tabId: 8, windowId: 1 });
        act(() => {
            port.emit(
                buildSidePanelSelectionStateMessage(replacementBinding, {
                    selectionOwnerGeneration: 1,
                    selectionRevision: 1,
                    renderRevision: 1,
                    reason: 'add',
                    entries: [{ wordIndex: 2, word: 'replacement' }],
                })
            );
        });

        expect(screen.getByTestId('selected-words')).toHaveTextContent(
            'replacement'
        );
    });

    test.each([
        ['activation', buildSidePanelTabActivatedMessage],
        ['force bind', buildSidePanelForceBindTabMessage],
    ])(
        'changes the visible tab only after a valid %s registration is posted',
        async (_label, buildMessage) => {
            render(
                <SidePanelProvider>
                    <SelectionProbe />
                </SidePanelProvider>
            );
            await waitFor(() =>
                expect(port.postMessage).toHaveBeenCalledTimes(1)
            );
            expect(screen.getByTestId('active-tab')).toHaveTextContent('7');

            port.postMessage.mockImplementation((message) => {
                if (
                    message.action === 'sidePanelRegister' &&
                    message.data.tabId === 8
                ) {
                    throw new Error('registration post failed');
                }
            });
            act(() => {
                port.emit(buildMessage({ tabId: 8, windowId: 1 }));
            });

            expect(port.postMessage).toHaveBeenCalledTimes(2);
            expect(screen.getByTestId('active-tab')).toHaveTextContent('7');
        }
    );

    test('rejects malformed tab-binding routes without invoking accessors or changing visible state', async () => {
        render(
            <SidePanelProvider>
                <SelectionProbe />
            </SidePanelProvider>
        );
        await waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));
        let reads = 0;
        const accessorData = { windowId: 1 };
        Object.defineProperty(accessorData, 'tabId', {
            enumerable: true,
            get() {
                reads += 1;
                return 8;
            },
        });
        const malformed = [
            {
                action: 'tabActivated',
                data: { tabId: 8, windowId: 1, extra: true },
            },
            {
                action: 'sidePanelForceBindTab',
                data: { tabId: -1, windowId: 1 },
            },
            {
                action: 'tabActivated',
                data: { tabId: 1.5, windowId: 1 },
            },
            {
                action: 'sidePanelForceBindTab',
                data: accessorData,
            },
            {
                action: 'tabActivated',
                data: { tabId: 8, windowId: 1 },
                extra: true,
            },
        ];

        act(() => {
            malformed.forEach((message) => port.emit(message));
        });

        expect(port.postMessage).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('active-tab')).toHaveTextContent('7');
        expect(reads).toBe(0);
    });

    test('clears a cached target selection at replacement intent before acknowledgement', async () => {
        render(
            <SidePanelProvider>
                <SelectionProbe />
            </SidePanelProvider>
        );
        await waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));
        const initialBinding = port.postMessage.mock.calls[0][0].data;
        act(() => {
            port.emit(
                buildSidePanelSelectionStateMessage(initialBinding, {
                    selectionOwnerGeneration: 3,
                    selectionRevision: 4,
                    renderRevision: 5,
                    reason: 'add',
                    entries: [{ wordIndex: 2, word: 'cached' }],
                })
            );
        });
        expect(screen.getByTestId('selected-words')).toHaveTextContent(
            'cached'
        );

        port.postMessage.mockImplementation(() => undefined);
        act(() => {
            port.emit({
                action: 'tabActivated',
                data: { tabId: 7, windowId: 1 },
            });
        });

        expect(port.postMessage).toHaveBeenCalledTimes(2);
        expect(screen.getByTestId('selected-words')).toBeEmptyDOMElement();
        expect(screen.getByTestId('selection')).toHaveTextContent('null');
    });

    test('does not let an outer clear overwrite a newer same-port registration', async () => {
        const selectionListener = jest.fn();
        const rebind = jest.fn((communication) => {
            communication.registerTab(9, 1);
        });
        render(
            <SidePanelProvider>
                <SelectionProbe />
                <ReentrantClearProbe onClear={rebind} />
                <SelectionEventProbe callback={selectionListener} />
            </SidePanelProvider>
        );
        await waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));

        fireEvent.click(
            screen.getByRole('button', { name: 'Replace binding' })
        );

        expect(rebind).toHaveBeenCalledTimes(1);
        expect(
            port.postMessage.mock.calls.map(([message]) => message.data.tabId)
        ).toEqual([7, 9]);
        const survivingBinding = port.postMessage.mock.calls[1][0].data;
        selectionListener.mockClear();
        const survivingSelection = {
            selectionOwnerGeneration: 10,
            selectionRevision: 11,
            renderRevision: 12,
            reason: 'add',
            entries: [{ wordIndex: 3, word: 'surviving' }],
        };
        act(() => {
            port.emit(
                buildSidePanelSelectionStateMessage(
                    survivingBinding,
                    survivingSelection
                )
            );
        });
        expect(selectionListener).toHaveBeenCalledWith({
            selection: survivingSelection,
            tabId: 9,
        });
    });

    test('retires the port when a clear callback disconnects reentrantly', async () => {
        const originalSetTimeout = global.setTimeout;
        const reconnectTimer = jest
            .spyOn(global, 'setTimeout')
            .mockImplementation((callback, delay, ...args) => {
                if (delay === 1000) {
                    return 71;
                }
                return originalSetTimeout(callback, delay, ...args);
            });
        const disconnect = jest.fn(() => port.emitDisconnect());
        render(
            <SidePanelProvider>
                <SelectionProbe />
                <ReentrantClearProbe onClear={disconnect} />
            </SidePanelProvider>
        );
        await waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));

        fireEvent.click(
            screen.getByRole('button', { name: 'Replace binding' })
        );

        expect(disconnect).toHaveBeenCalledTimes(1);
        expect(port.postMessage).toHaveBeenCalledTimes(1);
        reconnectTimer.mockRestore();
    });

    test('swallows unconfirmed, wrong-binding, and malformed selection state without disrupting ordinary routing', async () => {
        port = createPort({ acknowledgeRegistrations: false });
        chrome.runtime.connect.mockImplementation(() => port);
        const ordinaryListener = jest.fn();
        const genericSelectionListener = jest.fn();
        render(
            <SidePanelProvider>
                <SelectionProbe />
                <GenericMessageProbe
                    action="ordinaryPortEvent"
                    callback={ordinaryListener}
                />
                <GenericMessageProbe
                    action="sidePanelSelectionSync"
                    callback={genericSelectionListener}
                />
            </SidePanelProvider>
        );
        await waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));
        const binding = port.postMessage.mock.calls[0][0].data;
        const selection = {
            selectionOwnerGeneration: 7,
            selectionRevision: 8,
            renderRevision: 9,
            reason: 'add',
            entries: [{ wordIndex: 4, word: 'trusted' }],
        };

        act(() => {
            port.emit(buildSidePanelSelectionStateMessage(binding, selection));
        });
        expect(screen.getByTestId('selected-words')).toBeEmptyDOMElement();

        act(() => {
            port.emit({
                action: 'sidePanelBindingConfirmed',
                data: binding,
            });
            for (const wrongBinding of [
                { ...binding, registrationId: binding.registrationId + 1 },
                { ...binding, tabId: binding.tabId + 1 },
                { ...binding, windowId: binding.windowId + 1 },
            ]) {
                port.emit(
                    buildSidePanelSelectionStateMessage(wrongBinding, selection)
                );
            }
            const canonical = buildSidePanelSelectionStateMessage(
                binding,
                selection
            );
            port.emit({ ...canonical, extra: true });
            port.emit({
                action: 'sidePanelSelectionSync',
                data: { selectedWords: ['legacy'], tabId: binding.tabId },
            });
            const ordinaryData = { sequence: 1 };
            port.emit({ action: 'ordinaryPortEvent', data: ordinaryData });
        });

        expect(screen.getByTestId('selected-words')).toBeEmptyDOMElement();
        expect(genericSelectionListener).not.toHaveBeenCalled();
        expect(ordinaryListener).toHaveBeenCalledTimes(1);
        expect(ordinaryListener.mock.calls[0][0]).toEqual({ sequence: 1 });

        act(() => {
            port.emit(buildSidePanelSelectionStateMessage(binding, selection));
        });
        expect(screen.getByTestId('selected-words')).toHaveTextContent(
            'trusted'
        );
    });

    test('treats the same word at a different occurrence as a new selection and clears prior analysis', async () => {
        render(
            <SidePanelProvider>
                <SelectionProbe />
            </SidePanelProvider>
        );
        await waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));
        const binding = port.postMessage.mock.calls[0][0].data;
        act(() => {
            port.emit(
                buildSidePanelSelectionStateMessage(binding, {
                    selectionOwnerGeneration: 5,
                    selectionRevision: 6,
                    renderRevision: 7,
                    reason: 'add',
                    entries: [{ wordIndex: 1, word: 'same' }],
                })
            );
        });
        fireEvent.click(screen.getByRole('button', { name: 'Seed analysis' }));
        expect(screen.getByTestId('analysis-result')).toHaveTextContent(
            'cached analysis'
        );
        expect(screen.getByTestId('analysis-error')).toHaveTextContent(
            'cached error'
        );

        act(() => {
            port.emit(
                buildSidePanelSelectionStateMessage(binding, {
                    selectionOwnerGeneration: 5,
                    selectionRevision: 8,
                    renderRevision: 9,
                    reason: 'toggle',
                    entries: [{ wordIndex: 4, word: 'same' }],
                })
            );
        });

        expect(screen.getByTestId('selected-words')).toHaveTextContent('same');
        expect(JSON.parse(screen.getByTestId('selection').textContent)).toEqual(
            expect.objectContaining({
                selectionRevision: 8,
                entries: [{ wordIndex: 4, word: 'same' }],
            })
        );
        expect(screen.getByTestId('analysis-result')).toBeEmptyDOMElement();
        expect(screen.getByTestId('analysis-error')).toBeEmptyDOMElement();
    });

    test('clears on disconnect and ignores late state from the retired port', async () => {
        const originalSetTimeout = global.setTimeout;
        const reconnectTimer = jest
            .spyOn(global, 'setTimeout')
            .mockImplementation((callback, delay, ...args) => {
                if (delay === 1000) {
                    return 72;
                }
                return originalSetTimeout(callback, delay, ...args);
            });
        render(
            <SidePanelProvider>
                <SelectionProbe />
            </SidePanelProvider>
        );
        await waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));
        const binding = port.postMessage.mock.calls[0][0].data;
        const currentMessage = buildSidePanelSelectionStateMessage(binding, {
            selectionOwnerGeneration: 5,
            selectionRevision: 6,
            renderRevision: 7,
            reason: 'add',
            entries: [{ wordIndex: 1, word: 'current' }],
        });
        act(() => port.emit(currentMessage));
        expect(screen.getByTestId('selected-words')).toHaveTextContent(
            'current'
        );

        act(() => port.emitDisconnect());
        expect(screen.getByTestId('selected-words')).toBeEmptyDOMElement();

        act(() => port.emit(currentMessage));
        expect(screen.getByTestId('selected-words')).toBeEmptyDOMElement();
        reconnectTimer.mockRestore();
    });

    test('rechecks authority when selection parsing disconnects reentrantly', async () => {
        const originalSetTimeout = global.setTimeout;
        const reconnectTimer = jest
            .spyOn(global, 'setTimeout')
            .mockImplementation((callback, delay, ...args) => {
                if (delay === 1000) {
                    return 73;
                }
                return originalSetTimeout(callback, delay, ...args);
            });
        render(
            <SidePanelProvider>
                <SelectionProbe />
            </SidePanelProvider>
        );
        await waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));
        const binding = port.postMessage.mock.calls[0][0].data;
        act(() => {
            port.emit(
                buildSidePanelSelectionStateMessage(binding, {
                    selectionOwnerGeneration: 5,
                    selectionRevision: 6,
                    renderRevision: 7,
                    reason: 'add',
                    entries: [{ wordIndex: 1, word: 'current' }],
                })
            );
        });
        let prototypeChecks = 0;
        const reentrantBinding = new Proxy(
            { ...binding },
            {
                getPrototypeOf(target) {
                    prototypeChecks += 1;
                    port.emitDisconnect();
                    return Reflect.getPrototypeOf(target);
                },
            }
        );

        act(() => {
            port.emit({
                action: 'sidePanelSelectionSync',
                data: {
                    binding: reentrantBinding,
                    selection: {
                        selectionOwnerGeneration: 8,
                        selectionRevision: 9,
                        renderRevision: 10,
                        reason: 'add',
                        entries: [{ wordIndex: 2, word: 'stale' }],
                    },
                },
            });
        });

        expect(prototypeChecks).toBeGreaterThan(0);
        expect(screen.getByTestId('selected-words')).toBeEmptyDOMElement();
        reconnectTimer.mockRestore();
    });

    test('requests removal by canonical occurrence and waits for an authoritative successor', async () => {
        render(
            <SidePanelProvider>
                <WordSelectionProbe />
            </SidePanelProvider>
        );
        await waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));
        const binding = port.postMessage.mock.calls[0][0].data;
        const selection = {
            selectionOwnerGeneration: 5,
            selectionRevision: 6,
            renderRevision: 7,
            reason: 'add',
            entries: [
                { wordIndex: 2, word: 'very' },
                { wordIndex: 4, word: 'very' },
                { wordIndex: 8, word: 'good' },
            ],
        };
        act(() => {
            port.emit(buildSidePanelSelectionStateMessage(binding, selection));
        });

        fireEvent.click(
            screen.getByRole('button', { name: 'Remove second occurrence' })
        );

        expect(screen.getByTestId('word-selection-values')).toHaveTextContent(
            'very|very|good'
        );
        expect(screen.getByTestId('word-selection-updating')).toHaveTextContent(
            'updating'
        );
        const removalMessage = port.postMessage.mock.calls[1][0];
        expect(removalMessage).toEqual({
            action: 'sidePanelUpdateState',
            data: {
                binding,
                requestId: 1,
                selectionOwnerGeneration: 5,
                selectionRevision: 6,
                renderRevision: 7,
                wordIndex: 4,
            },
        });
        expect(Reflect.ownKeys(removalMessage)).toEqual(['action', 'data']);
        expect(Number.isSafeInteger(removalMessage.data.requestId)).toBe(true);
        expect(removalMessage.data.requestId).toBeGreaterThan(0);

        act(() => {
            port.emit(
                buildSidePanelSelectionStateMessage(binding, {
                    ...selection,
                    selectionRevision: 7,
                    reason: 'remove',
                    entries: [
                        { wordIndex: 2, word: 'very' },
                        { wordIndex: 8, word: 'good' },
                    ],
                })
            );
        });

        expect(screen.getByTestId('word-selection-updating')).toHaveTextContent(
            'updating'
        );
        expect(screen.getByTestId('word-selection-values')).toHaveTextContent(
            'very|good'
        );
        act(() => {
            port.emit(
                buildSidePanelSelectionRemovalResultMessage(
                    removalMessage.data,
                    'applied'
                )
            );
        });
        await waitFor(() =>
            expect(
                screen.getByTestId('word-selection-result')
            ).toHaveTextContent('applied')
        );
        expect(screen.getByTestId('word-selection-values')).toHaveTextContent(
            'very|good'
        );
        expect(screen.getByTestId('word-selection-updating')).toHaveTextContent(
            'idle'
        );
    });

    test('accepts only one exact correlated removal terminal and never mutates selection optimistically', async () => {
        const genericRemovalListener = jest.fn();
        render(
            <SidePanelProvider>
                <WordSelectionProbe />
                <GenericMessageProbe
                    action="sidePanelUpdateState"
                    callback={genericRemovalListener}
                />
            </SidePanelProvider>
        );
        await waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));
        const binding = port.postMessage.mock.calls[0][0].data;
        const selection = {
            selectionOwnerGeneration: 11,
            selectionRevision: 12,
            renderRevision: 13,
            reason: 'add',
            entries: [
                { wordIndex: 1, word: 'first' },
                { wordIndex: 9, word: 'second' },
            ],
        };
        act(() => {
            port.emit(buildSidePanelSelectionStateMessage(binding, selection));
        });
        fireEvent.click(
            screen.getByRole('button', { name: 'Remove second occurrence' })
        );
        const removal = port.postMessage.mock.calls[1][0].data;

        act(() => {
            port.emit(
                buildSidePanelSelectionRemovalResultMessage(
                    { ...removal, requestId: removal.requestId + 1 },
                    'applied'
                )
            );
            port.emit({
                action: 'sidePanelUpdateState',
                data: { requestId: removal.requestId, success: true },
            });
        });
        expect(screen.getByTestId('word-selection-updating')).toHaveTextContent(
            'updating'
        );
        expect(screen.getByTestId('word-selection-values')).toHaveTextContent(
            'first|second'
        );
        expect(genericRemovalListener).not.toHaveBeenCalled();

        act(() => {
            port.emit(
                buildSidePanelSelectionRemovalResultMessage(removal, 'rejected')
            );
        });
        await waitFor(() =>
            expect(
                screen.getByTestId('word-selection-result')
            ).toHaveTextContent('rejected')
        );
        expect(screen.getByTestId('word-selection-values')).toHaveTextContent(
            'first|second'
        );

        fireEvent.click(
            screen.getByRole('button', { name: 'Remove second occurrence' })
        );
        const retry = port.postMessage.mock.calls[2][0].data;
        expect(retry.requestId).toBe(removal.requestId + 1);
        act(() => {
            port.emit(
                buildSidePanelSelectionRemovalResultMessage(retry, 'applied')
            );
        });
        expect(screen.getByTestId('word-selection-updating')).toHaveTextContent(
            'updating'
        );
        expect(screen.getByTestId('word-selection-values')).toHaveTextContent(
            'first|second'
        );
        act(() => {
            port.emit(
                buildSidePanelSelectionStateMessage(binding, {
                    ...selection,
                    selectionRevision: selection.selectionRevision + 1,
                    reason: 'remove',
                    entries: [{ wordIndex: 1, word: 'first' }],
                })
            );
        });
        await waitFor(() =>
            expect(
                screen.getByTestId('word-selection-result')
            ).toHaveTextContent('applied')
        );
        expect(screen.getByTestId('word-selection-values')).toHaveTextContent(
            'first'
        );
        expect(genericRemovalListener).not.toHaveBeenCalled();
    });

    test('rejects a pending removal synchronously when its binding is replaced', async () => {
        render(
            <SidePanelProvider>
                <WordSelectionProbe />
            </SidePanelProvider>
        );
        await waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));
        const binding = port.postMessage.mock.calls[0][0].data;
        act(() => {
            port.emit(
                buildSidePanelSelectionStateMessage(binding, {
                    selectionOwnerGeneration: 15,
                    selectionRevision: 16,
                    renderRevision: 17,
                    reason: 'add',
                    entries: [
                        { wordIndex: 1, word: 'first' },
                        { wordIndex: 2, word: 'second' },
                    ],
                })
            );
        });
        fireEvent.click(
            screen.getByRole('button', { name: 'Remove second occurrence' })
        );
        const removal = port.postMessage.mock.calls[1][0].data;
        expect(screen.getByTestId('word-selection-updating')).toHaveTextContent(
            'updating'
        );

        act(() => {
            port.emit({
                action: 'tabActivated',
                data: { tabId: 8, windowId: 1 },
            });
        });
        await waitFor(() =>
            expect(
                screen.getByTestId('word-selection-result')
            ).toHaveTextContent('rejected')
        );
        expect(screen.getByTestId('word-selection-updating')).toHaveTextContent(
            'idle'
        );
        expect(
            screen.getByTestId('word-selection-values')
        ).toBeEmptyDOMElement();

        act(() => {
            port.emit(
                buildSidePanelSelectionRemovalResultMessage(removal, 'applied')
            );
        });
        expect(screen.getByTestId('word-selection-result')).toHaveTextContent(
            'rejected'
        );
    });

    test('unmount revokes selection delivery without notifying unmounted subscribers', async () => {
        const selectionListener = jest.fn();
        const { unmount } = render(
            <SidePanelProvider>
                <SelectionEventProbe callback={selectionListener} />
            </SidePanelProvider>
        );
        await waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));
        const binding = port.postMessage.mock.calls[0][0].data;
        const message = buildSidePanelSelectionStateMessage(binding, {
            selectionOwnerGeneration: 5,
            selectionRevision: 6,
            renderRevision: 7,
            reason: 'add',
            entries: [{ wordIndex: 1, word: 'current' }],
        });
        act(() => port.emit(message));
        expect(selectionListener).toHaveBeenLastCalledWith({
            tabId: 7,
            selection: expect.objectContaining({
                entries: [{ wordIndex: 1, word: 'current' }],
            }),
        });
        const callCountBeforeUnmount = selectionListener.mock.calls.length;

        unmount();
        act(() => port.emit(message));

        expect(selectionListener).toHaveBeenCalledTimes(callCountBeforeUnmount);
    });
});
