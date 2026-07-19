import { jest } from '@jest/globals';
import {
    act,
    fireEvent,
    render,
    screen,
    waitFor,
} from '@testing-library/react';
import { SidePanelApp } from './SidePanelApp.jsx';
import { AnalysisResults } from './components/tabs/AIAnalysisTab.jsx';
import { configService } from '../services/configService.js';
import {
    SidePanelProvider,
    useSidePanelContext,
} from './hooks/SidePanelContext.jsx';
import { useAIAnalysis } from './hooks/useAIAnalysis.js';

function createPort() {
    const messageListeners = new Set();
    const disconnectListeners = new Set();

    return {
        disconnect: jest.fn(),
        onDisconnect: {
            addListener: jest.fn((listener) =>
                disconnectListeners.add(listener)
            ),
        },
        onMessage: {
            addListener: jest.fn((listener) => messageListeners.add(listener)),
        },
        postMessage: jest.fn(),
        emit(message) {
            messageListeners.forEach((listener) => listener(message));
        },
    };
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, reject, resolve };
}

function ContextConsumers() {
    const { communication } = useSidePanelContext();
    return (
        <>
            <span>{communication.isConnected ? 'connected' : 'offline'}</span>
            <NestedConsumer />
        </>
    );
}

function NestedConsumer() {
    const { communication } = useSidePanelContext();
    return <span>{communication.getBinding().boundTabId ?? 'unbound'}</span>;
}

function AnalysisHarness() {
    const { analysisResult, error, isAnalyzing, analyzeWords, settings } =
        useAIAnalysis();

    return (
        <div>
            <span data-testid="settings-ready">
                {settings.aiContextEnabled ? 'ready' : 'loading'}
            </span>
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
        </div>
    );
}

describe('side panel React behavior', () => {
    let port;

    beforeEach(() => {
        port = createPort();
        chrome.runtime.connect = jest.fn(() => port);
        chrome.tabs.sendMessage = jest.fn(() =>
            Promise.resolve({ success: true })
        );
        const messages = {
            sidepanelAnalyzeButton: 'Analyze',
            sidepanelErrorNoWords: 'No words selected for analysis',
            sidepanelErrorNoContextTypes:
                'Select at least one context type before analyzing',
            sidepanelTabAIAnalysis: 'AI Analysis',
            sidepanelWordInputPlaceholder:
                'Click subtitle words to select them',
            sidepanelWordsToAnalyze: 'Words to Analyze',
        };
        chrome.i18n = {
            getMessage: jest.fn((key) => messages[key] || key),
        };
        chrome.tabs.addTab({
            id: 7,
            active: true,
            windowId: 1,
            url: 'https://www.netflix.com/watch/1',
        });
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
            uiLanguage: 'en',
        });
    });

    test('mounts one port and does not re-query the tab after state rerenders', async () => {
        const { rerender } = render(
            <SidePanelProvider>
                <ContextConsumers />
            </SidePanelProvider>
        );

        await waitFor(() =>
            expect(screen.getByText('connected')).toBeInTheDocument()
        );
        await waitFor(() => expect(chrome.tabs.query).toHaveBeenCalledTimes(2));

        rerender(
            <SidePanelProvider>
                <ContextConsumers />
            </SidePanelProvider>
        );
        await act(async () => Promise.resolve());

        expect(chrome.runtime.connect).toHaveBeenCalledTimes(1);
        expect(chrome.tabs.query).toHaveBeenCalledTimes(2);
    });

    test('renders only the shipped AI analysis view', async () => {
        render(<SidePanelApp />);

        expect(
            await screen.findByRole('heading', { name: 'AI Analysis' })
        ).toBeInTheDocument();
        expect(screen.queryByText('Words Lists')).not.toBeInTheDocument();
        expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    });

    test('renders a primitive analysis response as one result section', () => {
        render(
            <AnalysisResults
                result="plain analysis"
                selectedWords={['word']}
                t={(key, substitution) =>
                    key === 'sidepanelResultsTitle'
                        ? `Results for ${substitution}`
                        : key
                }
            />
        );

        expect(screen.getByText('plain analysis')).toBeInTheDocument();
        expect(screen.getAllByRole('heading')).toHaveLength(2);
        expect(
            screen.getByRole('heading', { name: 'Analysis' })
        ).toBeInTheDocument();
    });

    test('validates an empty selection without sending a request', async () => {
        render(
            <SidePanelProvider>
                <AnalysisHarness />
            </SidePanelProvider>
        );
        await screen.findByText('ready');

        fireEvent.click(
            screen.getByRole('button', { name: 'Analyze selected' })
        );

        await waitFor(() =>
            expect(screen.getByTestId('analysis-error')).toHaveTextContent(
                'No words selected for analysis'
            )
        );
        expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    test('sends the reactive context setting and ignores a stale response', async () => {
        const firstRequest = deferred();
        const secondRequest = deferred();
        chrome.runtime.sendMessage
            .mockImplementationOnce(() => firstRequest.promise)
            .mockImplementationOnce(() => secondRequest.promise);

        render(
            <SidePanelProvider>
                <AnalysisHarness />
            </SidePanelProvider>
        );
        await screen.findByText('ready');

        fireEvent.click(screen.getByRole('button', { name: 'Analyze first' }));
        await waitFor(() =>
            expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1)
        );
        expect(chrome.runtime.sendMessage).toHaveBeenLastCalledWith(
            expect.objectContaining({
                contextType: 'cultural',
                targetLanguage: 'es',
                text: 'first',
            })
        );

        fireEvent.click(screen.getByRole('button', { name: 'Analyze second' }));
        await waitFor(() =>
            expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(2)
        );

        await act(async () => {
            secondRequest.resolve({
                success: true,
                result: { analysis: { definition: 'new result' } },
            });
            await secondRequest.promise;
        });
        await waitFor(() =>
            expect(screen.getByTestId('analysis-result')).toHaveTextContent(
                'new result'
            )
        );

        await act(async () => {
            firstRequest.resolve({
                success: true,
                result: { analysis: { definition: 'stale result' } },
            });
            await firstRequest.promise;
        });

        expect(screen.getByTestId('analysis-result')).toHaveTextContent(
            'new result'
        );
        expect(screen.getByTestId('analysis-state')).toHaveTextContent('idle');
    });

    test('sends an exact multi-type subset without coercing it to all', async () => {
        global.testUtils.setupChromeStorage({
            aiContextEnabled: true,
            aiContextProvider: 'openai',
            aiContextTypes: ['cultural', 'linguistic'],
            sidePanelTheme: 'light',
            targetLanguage: 'es',
            uiLanguage: 'en',
        });
        chrome.runtime.sendMessage.mockResolvedValue({
            success: true,
            result: { analysis: { definition: 'combined result' } },
        });

        render(
            <SidePanelProvider>
                <AnalysisHarness />
            </SidePanelProvider>
        );
        await screen.findByText('ready');

        fireEvent.click(screen.getByRole('button', { name: 'Analyze first' }));

        await waitFor(() =>
            expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
                expect.objectContaining({
                    contextTypes: ['cultural', 'linguistic'],
                    text: 'first',
                })
            )
        );
        expect(chrome.runtime.sendMessage.mock.calls[0][0]).not.toEqual(
            expect.objectContaining({ contextType: 'all' })
        );
    });

    test('rejects an empty configured context-type selection', async () => {
        global.testUtils.setupChromeStorage({
            aiContextEnabled: true,
            aiContextProvider: 'openai',
            aiContextTypes: [],
            sidePanelTheme: 'light',
            targetLanguage: 'es',
            uiLanguage: 'en',
        });

        render(
            <SidePanelProvider>
                <AnalysisHarness />
            </SidePanelProvider>
        );
        await screen.findByText('ready');

        fireEvent.click(screen.getByRole('button', { name: 'Analyze first' }));

        await waitFor(() =>
            expect(screen.getByTestId('analysis-error')).toHaveTextContent(
                'Select at least one context type before analyzing'
            )
        );
        expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    test('invalidates an active request when its provider setting changes', async () => {
        const request = deferred();
        chrome.runtime.sendMessage.mockImplementationOnce(
            () => request.promise
        );

        render(
            <SidePanelProvider>
                <AnalysisHarness />
            </SidePanelProvider>
        );
        await screen.findByText('ready');

        fireEvent.click(screen.getByRole('button', { name: 'Analyze first' }));
        await waitFor(() =>
            expect(screen.getByTestId('analysis-state')).toHaveTextContent(
                'analyzing'
            )
        );

        act(() => {
            configService.changeListeners.forEach((listener) =>
                listener({ aiContextProvider: 'gemini' })
            );
        });

        await waitFor(() =>
            expect(screen.getByTestId('analysis-state')).toHaveTextContent(
                'idle'
            )
        );

        await act(async () => {
            request.resolve({
                success: true,
                result: { analysis: { definition: 'obsolete result' } },
            });
            await request.promise;
        });

        expect(screen.getByTestId('analysis-result')).toBeEmptyDOMElement();
    });

    test('preserves duplicate tokens for analysis and removes one indexed chip', async () => {
        chrome.runtime.sendMessage.mockResolvedValue({
            success: true,
            result: { analysis: { definition: 'intensified phrase' } },
        });

        render(<SidePanelApp />);
        await screen.findByRole('heading', { name: 'AI Analysis' });
        await waitFor(() =>
            expect(
                port.postMessage.mock.calls.some(
                    ([message]) => message.action === 'sidePanelRegister'
                )
            ).toBe(true)
        );

        act(() => {
            port.emit({
                action: 'sidePanelSelectionSync',
                data: {
                    selectedWords: ['very', 'very', 'good'],
                    tabId: 7,
                },
            });
        });

        const duplicateRemoveButtons = await screen.findAllByRole('button', {
            name: /Remove very at position/,
        });
        expect(duplicateRemoveButtons).toHaveLength(2);

        fireEvent.click(screen.getByRole('button', { name: 'Analyze' }));
        await waitFor(() =>
            expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
                expect.objectContaining({
                    action: 'analyzeContext',
                    text: 'very very good',
                })
            )
        );
        await screen.findByText('intensified phrase');

        fireEvent.click(duplicateRemoveButtons[1]);
        await waitFor(() =>
            expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
                7,
                expect.objectContaining({
                    action: 'sidePanelUpdateState',
                    data: {
                        removeSelectionIndex: 1,
                        selectedWords: ['very', 'good'],
                    },
                })
            )
        );
    });
});
