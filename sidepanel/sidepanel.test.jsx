import { jest } from '@jest/globals';
import { useState } from 'react';
import {
    act,
    fireEvent,
    render,
    screen,
    waitFor,
} from '@testing-library/react';
import { SidePanelApp } from './SidePanelApp.jsx';
import { AnalysisResults } from './components/tabs/AIAnalysisTab.jsx';
import {
    SidePanelProvider,
    useSidePanelContext,
} from './hooks/SidePanelContext.jsx';
import { useAIAnalysis } from './hooks/useAIAnalysis.js';
import {
    MessageSenderRoles,
    buildAnalyzeContextSuccessResponse,
    buildSidePanelBindingConfirmationMessage,
    buildSidePanelSelectionStateMessage,
    buildSidePanelTabActivatedMessage,
} from '../content_scripts/shared/protocol/messageProtocol.js';

function createPort({ acknowledge = true } = {}) {
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
            if (acknowledge && message.action === 'sidePanelRegister') {
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

function deferred() {
    let resolve;
    const promise = new Promise((settle) => {
        resolve = settle;
    });
    return { promise, resolve };
}

function CommunicationProbe() {
    const { activeTabId, communication } = useSidePanelContext();
    const [, rerender] = useState(0);
    return (
        <>
            <span data-testid="connection">
                {communication.isConnected ? 'connected' : 'offline'}
            </span>
            <span data-testid="connection-error">
                {communication.error?.message || ''}
            </span>
            <span data-testid="active-tab">{activeTabId ?? 'inactive'}</span>
            <button
                type="button"
                onClick={() => rerender((value) => value + 1)}
            >
                Rerender
            </button>
        </>
    );
}

function AnalysisHarness() {
    const { activeTabId } = useSidePanelContext();
    const {
        analysisResult,
        error,
        isAnalyzing,
        analyzeWords,
        retryAnalysis,
        settingsLoading,
    } = useAIAnalysis();
    return (
        <>
            <span data-testid="settings-state">
                {settingsLoading ? 'loading' : 'ready'}
            </span>
            <span data-testid="analysis-tab">{activeTabId ?? 'inactive'}</span>
            <span data-testid="analysis-state">
                {isAnalyzing ? 'analyzing' : 'idle'}
            </span>
            <span data-testid="analysis-result">
                {analysisResult?.definition || ''}
            </span>
            <span data-testid="analysis-error">{error || ''}</span>
            <button type="button" onClick={() => void analyzeWords()}>
                Analyze selected
            </button>
            <button type="button" onClick={() => void analyzeWords(['first'])}>
                Analyze first
            </button>
            <button type="button" onClick={() => void analyzeWords(['second'])}>
                Analyze second
            </button>
            <button type="button" onClick={() => void retryAnalysis()}>
                Retry
            </button>
        </>
    );
}

describe('side panel React behavior', () => {
    let port;

    beforeEach(() => {
        port = createPort();
        chrome.runtime.connect = jest.fn(() => port);
        chrome.runtime.sendMessage = jest.fn();
        chrome.tabs.query
            .mockReset()
            .mockResolvedValue([{ active: true, id: 7, windowId: 1 }]);
        const messages = {
            sidepanelAnalyzeButton: 'Analyze',
            sidepanelAnalyzing: 'Analyzing',
            sidepanelErrorGeneric: 'Analysis failed',
            sidepanelErrorNoWords: 'No words selected for analysis',
            sidepanelErrorRetry: 'Retry',
            sidepanelLoading: 'Loading',
            sidepanelTabAIAnalysis: 'AI Analysis',
            sidepanelWordInputPlaceholder:
                'Click subtitle words to select them',
            sidepanelWordsToAnalyze: 'Words to Analyze',
        };
        chrome.i18n = {
            getMessage: jest.fn((key) => messages[key] || key),
        };
        window.matchMedia = jest.fn(() => ({
            addEventListener: jest.fn(),
            matches: false,
            removeEventListener: jest.fn(),
        }));
        global.testUtils.setupChromeStorage({
            aiContextEnabled: true,
            aiContextProvider: 'openai',
            aiContextTypes: ['cultural'],
            sidePanelTheme: 'light',
            targetLanguage: 'es',
        });
    });

    test('opens one connection and registers the active tab once', async () => {
        render(
            <SidePanelProvider>
                <CommunicationProbe />
            </SidePanelProvider>
        );

        await waitFor(() =>
            expect(
                port.postMessage.mock.calls.filter(
                    ([message]) => message.action === 'sidePanelRegister'
                )
            ).toHaveLength(1)
        );
        expect(chrome.runtime.connect).toHaveBeenCalledTimes(1);
        expect(chrome.tabs.query).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('connection')).toHaveTextContent('connected');
        expect(screen.getByTestId('active-tab')).toHaveTextContent('7');

        fireEvent.click(screen.getByText('Rerender'));
        expect(chrome.runtime.connect).toHaveBeenCalledTimes(1);
        expect(chrome.tabs.query).toHaveBeenCalledTimes(1);
    });

    test('does not let a stale initial tab lookup replace a newer activation', async () => {
        const lookup = deferred();
        chrome.tabs.query.mockReset().mockReturnValue(lookup.promise);
        render(
            <SidePanelProvider>
                <CommunicationProbe />
            </SidePanelProvider>
        );

        act(() => {
            port.emit(
                buildSidePanelTabActivatedMessage({ tabId: 8, windowId: 1 })
            );
        });
        expect(screen.getByTestId('active-tab')).toHaveTextContent('8');

        await act(async () => {
            lookup.resolve([{ active: true, id: 7, windowId: 1 }]);
            await lookup.promise;
        });
        const registrations = port.postMessage.mock.calls
            .map(([message]) => message)
            .filter((message) => message.action === 'sidePanelRegister');
        expect(registrations).toHaveLength(1);
        expect(registrations[0].data.tabId).toBe(8);
        expect(screen.getByTestId('active-tab')).toHaveTextContent('8');
    });

    test('reconnects and registers again after an unexpected disconnect', async () => {
        jest.useFakeTimers();
        const replacement = createPort();
        chrome.runtime.connect
            .mockImplementationOnce(() => port)
            .mockImplementationOnce(() => replacement);
        render(
            <SidePanelProvider>
                <CommunicationProbe />
            </SidePanelProvider>
        );
        await act(async () => Promise.resolve());
        expect(port.postMessage).toHaveBeenCalled();

        act(() => port.emitDisconnect());
        expect(screen.getByTestId('connection')).toHaveTextContent('offline');
        await act(async () => {
            jest.advanceTimersByTime(1000);
            await Promise.resolve();
        });

        expect(chrome.runtime.connect).toHaveBeenCalledTimes(2);
        expect(replacement.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'sidePanelRegister' })
        );
        expect(screen.getByTestId('connection')).toHaveTextContent('connected');
        jest.useRealTimers();
    });

    test('retires an unacknowledged registration and retries on a new port', async () => {
        jest.useFakeTimers();
        port = createPort({ acknowledge: false });
        const replacement = createPort();
        chrome.runtime.connect
            .mockImplementationOnce(() => port)
            .mockImplementationOnce(() => replacement);
        render(
            <SidePanelProvider>
                <CommunicationProbe />
            </SidePanelProvider>
        );
        await act(async () => Promise.resolve());

        act(() => jest.advanceTimersByTime(2000));
        expect(port.disconnect).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('connection')).toHaveTextContent('offline');
        await act(async () => {
            jest.advanceTimersByTime(1000);
            await Promise.resolve();
        });
        expect(replacement.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'sidePanelRegister' })
        );
        jest.useRealTimers();
    });

    test('surfaces a connection error and retries', async () => {
        jest.useFakeTimers();
        const replacement = createPort();
        chrome.runtime.connect
            .mockImplementationOnce(() => {
                throw new Error('worker unavailable');
            })
            .mockImplementationOnce(() => replacement);
        render(
            <SidePanelProvider>
                <CommunicationProbe />
            </SidePanelProvider>
        );
        expect(screen.getByTestId('connection-error')).toHaveTextContent(
            'worker unavailable'
        );

        await act(async () => {
            jest.advanceTimersByTime(2000);
            await Promise.resolve();
        });
        expect(screen.getByTestId('connection')).toHaveTextContent('connected');
        expect(screen.getByTestId('connection-error')).toBeEmptyDOMElement();
        jest.useRealTimers();
    });

    test('renders only the shipped analysis view', async () => {
        render(<SidePanelApp />);
        expect(
            await screen.findByRole('heading', { name: 'AI Analysis' })
        ).toBeInTheDocument();
        expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    });

    test('renders structured analysis sections', () => {
        render(
            <AnalysisResults
                result={{
                    definition: 'a concise meaning',
                    key_insights: ['first', 'second'],
                }}
                selectedWords={['word']}
                t={(key) => key}
            />
        );
        expect(screen.getByText('a concise meaning')).toBeInTheDocument();
        expect(screen.getByText('first')).toBeInTheDocument();
        expect(screen.getByText('second')).toBeInTheDocument();
    });

    test('validates an empty selection without sending a request', async () => {
        render(
            <SidePanelProvider>
                <AnalysisHarness />
            </SidePanelProvider>
        );
        await screen.findByText('ready');
        await waitFor(() =>
            expect(screen.getByTestId('analysis-tab')).toHaveTextContent('7')
        );
        fireEvent.click(screen.getByText('Analyze selected'));
        await waitFor(() =>
            expect(screen.getByTestId('analysis-error')).toHaveTextContent(
                'No words selected for analysis'
            )
        );
        expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    test('keeps the newest analysis when responses finish out of order', async () => {
        const first = deferred();
        const second = deferred();
        chrome.runtime.sendMessage
            .mockImplementationOnce(() => first.promise)
            .mockImplementationOnce(() => second.promise);
        render(
            <SidePanelProvider>
                <AnalysisHarness />
            </SidePanelProvider>
        );
        await screen.findByText('ready');
        await waitFor(() =>
            expect(screen.getByTestId('analysis-tab')).toHaveTextContent('7')
        );
        fireEvent.click(screen.getByText('Analyze first'));
        await waitFor(() =>
            expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1)
        );
        fireEvent.click(screen.getByText('Analyze second'));
        await waitFor(() =>
            expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(2)
        );

        const firstMessage = chrome.runtime.sendMessage.mock.calls[0][0];
        const secondMessage = chrome.runtime.sendMessage.mock.calls[1][0];
        await act(async () => {
            second.resolve(
                buildAnalyzeContextSuccessResponse(
                    MessageSenderRoles.SIDEPANEL,
                    secondMessage,
                    { analysis: { definition: 'new result' } }
                )
            );
            await second.promise;
        });
        expect(screen.getByTestId('analysis-result')).toHaveTextContent(
            'new result'
        );

        await act(async () => {
            first.resolve(
                buildAnalyzeContextSuccessResponse(
                    MessageSenderRoles.SIDEPANEL,
                    firstMessage,
                    { analysis: { definition: 'stale result' } }
                )
            );
            await first.promise;
        });
        expect(screen.getByTestId('analysis-result')).toHaveTextContent(
            'new result'
        );
    });

    test('shows request errors and retries with the same words', async () => {
        chrome.runtime.sendMessage
            .mockRejectedValueOnce(new Error('provider offline'))
            .mockImplementationOnce((message) =>
                Promise.resolve(
                    buildAnalyzeContextSuccessResponse(
                        MessageSenderRoles.SIDEPANEL,
                        message,
                        { analysis: { definition: 'recovered' } }
                    )
                )
            );
        render(
            <SidePanelProvider>
                <AnalysisHarness />
            </SidePanelProvider>
        );
        await screen.findByText('ready');
        await waitFor(() =>
            expect(screen.getByTestId('analysis-tab')).toHaveTextContent('7')
        );
        const binding = port.postMessage.mock.calls.find(
            ([message]) => message.action === 'sidePanelRegister'
        )[0].data;
        act(() => {
            port.emit(
                buildSidePanelSelectionStateMessage(binding, {
                    selectionOwnerGeneration: 1,
                    selectionRevision: 1,
                    renderRevision: 1,
                    reason: 'add',
                    entries: [{ word: 'retryable', wordIndex: 0 }],
                })
            );
        });
        fireEvent.click(screen.getByText('Analyze selected'));
        await waitFor(() =>
            expect(screen.getByTestId('analysis-error')).toHaveTextContent(
                'Analysis failed'
            )
        );

        fireEvent.click(screen.getByText('Retry'));
        await waitFor(() =>
            expect(screen.getByTestId('analysis-result')).toHaveTextContent(
                'recovered'
            )
        );
        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(2);
    });
});
