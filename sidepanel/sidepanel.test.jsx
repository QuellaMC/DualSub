import { jest } from '@jest/globals';
import { StrictMode, useEffect, useState } from 'react';
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
import { SidePanelService } from '../background/services/sidePanelService.js';
import {
    SidePanelProvider,
    useSidePanelContext,
} from './hooks/SidePanelContext.jsx';
import { useAIAnalysis } from './hooks/useAIAnalysis.js';
import {
    buildSidePanelSelectionRemovalResultMessage,
    buildSidePanelSelectionStateMessage,
} from '../content_scripts/shared/protocol/messageProtocol.js';

const defaultTabsQuery = chrome.tabs.query.getMockImplementation();

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

function createLinkedSidePanelPorts() {
    const clientMessageListeners = new Set();
    const clientDisconnectListeners = new Set();
    const backgroundMessageListeners = new Set();
    const backgroundDisconnectListeners = new Set();
    let disconnected = false;
    const disconnectFromClient = () => {
        if (disconnected) return;
        disconnected = true;
        backgroundDisconnectListeners.forEach((listener) => listener());
    };
    const disconnectFromBackground = () => {
        if (disconnected) return;
        disconnected = true;
        clientDisconnectListeners.forEach((listener) => listener());
    };
    const clientPort = {
        disconnect: jest.fn(disconnectFromClient),
        onDisconnect: {
            addListener: jest.fn((listener) =>
                clientDisconnectListeners.add(listener)
            ),
        },
        onMessage: {
            addListener: jest.fn((listener) =>
                clientMessageListeners.add(listener)
            ),
        },
        postMessage: jest.fn((message) => {
            if (disconnected) throw new Error('Port is disconnected');
            backgroundMessageListeners.forEach((listener) => listener(message));
        }),
    };
    const backgroundPort = {
        disconnect: jest.fn(disconnectFromBackground),
        onDisconnect: {
            addListener: jest.fn((listener) =>
                backgroundDisconnectListeners.add(listener)
            ),
        },
        onMessage: {
            addListener: jest.fn((listener) =>
                backgroundMessageListeners.add(listener)
            ),
        },
        postMessage: jest.fn((message) => {
            if (disconnected) throw new Error('Port is disconnected');
            clientMessageListeners.forEach((listener) => listener(message));
        }),
    };
    return { backgroundPort, clientPort };
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

function createCanonicalAnalysisSuccess(message, analysis) {
    const contextTypes = [...message.contextTypes];
    return {
        success: true,
        result: {
            analysis,
            contextType:
                contextTypes.length === 1
                    ? contextTypes[0]
                    : contextTypes.length === 3
                      ? 'all'
                      : 'combined',
            contextTypes,
            isStructured: true,
        },
        requestId: message.requestId,
    };
}

function ContextConsumers() {
    const { activeTabId, communication, selectedWords } = useSidePanelContext();
    const [, forceRender] = useState(0);
    const [discoveredTabId, setDiscoveredTabId] = useState('unset');
    const register = (tabId, windowId) => {
        communication.registerTab(tabId, windowId);
        forceRender((revision) => revision + 1);
    };
    return (
        <>
            <span>{communication.isConnected ? 'connected' : 'offline'}</span>
            <span data-testid="active-tab">{activeTabId ?? 'inactive'}</span>
            <span data-testid="selected-words">{selectedWords.join('|')}</span>
            <span data-testid="discovered-tab">{discoveredTabId}</span>
            <button type="button" onClick={() => register(8, 1)}>
                Register valid tab
            </button>
            <button type="button" onClick={() => register(Infinity, 1)}>
                Register invalid tab
            </button>
            <button type="button" onClick={() => register(8, Infinity)}>
                Register invalid window
            </button>
            <button
                type="button"
                onClick={() =>
                    void communication
                        .getActiveTab()
                        .then((tab) => setDiscoveredTabId(tab?.id ?? 'none'))
                }
            >
                Discover active tab
            </button>
            <NestedConsumer />
        </>
    );
}

function NestedConsumer() {
    const { communication } = useSidePanelContext();
    return (
        <span data-testid="communication-api">
            {Object.keys(communication).sort().join('|')}
        </span>
    );
}

function PortListenerProbe({ action, callback }) {
    const { communication } = useSidePanelContext();

    useEffect(
        () => communication.onMessage(action, callback),
        [action, callback, communication]
    );

    return null;
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
        chrome.tabs.query.mockReset().mockImplementation(defaultTabsQuery);
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
        await waitFor(() => expect(chrome.tabs.query).toHaveBeenCalledTimes(1));

        rerender(
            <SidePanelProvider>
                <ContextConsumers />
            </SidePanelProvider>
        );
        await act(async () => Promise.resolve());

        expect(chrome.runtime.connect).toHaveBeenCalledTimes(1);
        expect(chrome.tabs.query).toHaveBeenCalledTimes(1);
    });

    test('exposes only the precise side-panel communication API', () => {
        render(
            <SidePanelProvider>
                <ContextConsumers />
            </SidePanelProvider>
        );

        expect(screen.getByTestId('communication-api')).toHaveTextContent(
            [
                'error',
                'getActiveTab',
                'isConnected',
                'onMessage',
                'onSelectionState',
                'registerTab',
                'requestSelectionRemoval',
            ].join('|')
        );
    });

    test('shares one initial active-tab snapshot for activation and registration', async () => {
        const olderSnapshot = deferred();
        chrome.tabs.query
            .mockImplementationOnce(() => olderSnapshot.promise)
            .mockResolvedValueOnce([
                {
                    id: 8,
                    active: true,
                    windowId: 1,
                    url: 'https://www.netflix.com/watch/2',
                },
            ]);
        render(
            <SidePanelProvider>
                <ContextConsumers />
            </SidePanelProvider>
        );

        await act(async () => Promise.resolve());
        await act(async () => {
            olderSnapshot.resolve([
                {
                    id: 7,
                    active: true,
                    windowId: 1,
                    url: 'https://www.netflix.com/watch/1',
                },
            ]);
            await olderSnapshot.promise;
        });
        await waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));

        expect(chrome.tabs.query).toHaveBeenCalledTimes(1);
        expect(port.postMessage.mock.calls[0][0].data).toEqual({
            registrationId: expect.any(Number),
            tabId: 7,
            windowId: 1,
        });
        expect(screen.getByTestId('active-tab')).toHaveTextContent('7');
    });

    test('registers the active tab with exactly one contracted port message', async () => {
        render(
            <SidePanelProvider>
                <ContextConsumers />
            </SidePanelProvider>
        );

        await waitFor(() => expect(port.postMessage).toHaveBeenCalled());

        expect(port.postMessage).toHaveBeenCalledTimes(1);
        expect(port.postMessage).toHaveBeenCalledWith({
            action: 'sidePanelRegister',
            data: {
                registrationId: expect.any(Number),
                tabId: 7,
                windowId: 1,
            },
            source: 'sidepanel',
            timestamp: expect.any(Number),
        });
        expect(port.postMessage.mock.calls[0][0].data).not.toHaveProperty(
            'panelInstanceId'
        );
    });

    test('keeps an enqueued registration unbound until its exact acknowledgement', async () => {
        port.postMessage.mockImplementation(() => undefined);
        render(
            <SidePanelProvider>
                <ContextConsumers />
            </SidePanelProvider>
        );

        await waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));
        const registration = port.postMessage.mock.calls[0][0];
        expect(registration.data.registrationId).toEqual(expect.any(Number));
        expect(Number.isSafeInteger(registration.data.registrationId)).toBe(
            true
        );
        expect(registration.data.registrationId).toBeGreaterThan(0);
        const selectionMessage = buildSidePanelSelectionStateMessage(
            registration.data,
            {
                selectionOwnerGeneration: 1,
                selectionRevision: 1,
                renderRevision: 1,
                reason: 'add',
                entries: [{ wordIndex: 0, word: 'acknowledged' }],
            }
        );

        act(() => port.emit(selectionMessage));
        expect(screen.getByTestId('selected-words')).toBeEmptyDOMElement();

        act(() => {
            port.emit({
                action: 'sidePanelBindingConfirmed',
                data: registration.data,
            });
            port.emit(selectionMessage);
        });

        expect(screen.getByTestId('selected-words')).toHaveTextContent(
            'acknowledged'
        );
    });

    test('commits a reentrant acknowledgement emitted inside registration posting', async () => {
        render(
            <SidePanelProvider>
                <ContextConsumers />
            </SidePanelProvider>
        );

        await waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));
        const registration = port.postMessage.mock.calls[0][0];
        expect(registration.data.registrationId).toEqual(expect.any(Number));
        act(() => {
            port.emit(
                buildSidePanelSelectionStateMessage(registration.data, {
                    selectionOwnerGeneration: 1,
                    selectionRevision: 1,
                    renderRevision: 1,
                    reason: 'add',
                    entries: [{ wordIndex: 0, word: 'reentrant' }],
                })
            );
        });
        expect(screen.getByTestId('selected-words')).toHaveTextContent(
            'reentrant'
        );
    });

    test('revokes a reentrant acknowledgement when registration posting then fails', async () => {
        port.postMessage.mockImplementation((message) => {
            port.emit({
                action: 'sidePanelBindingConfirmed',
                data: message.data,
            });
            throw new Error('registration posting failed after reentrant ACK');
        });
        render(
            <SidePanelProvider>
                <ContextConsumers />
            </SidePanelProvider>
        );

        await waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));
        const registration = port.postMessage.mock.calls[0][0];
        act(() => {
            port.emit(
                buildSidePanelSelectionStateMessage(registration.data, {
                    selectionOwnerGeneration: 1,
                    selectionRevision: 1,
                    renderRevision: 1,
                    reason: 'add',
                    entries: [{ wordIndex: 0, word: 'revoked' }],
                })
            );
        });
        expect(screen.getByTestId('selected-words')).toBeEmptyDOMElement();
    });

    test('times out an unacknowledged registration without binding the tab', async () => {
        port.postMessage.mockImplementation(() => undefined);
        const originalSetTimeout = global.setTimeout;
        let acknowledgementTimeout;
        const timeoutSpy = jest
            .spyOn(global, 'setTimeout')
            .mockImplementation((callback, delay, ...args) => {
                if (delay === 2000) {
                    acknowledgementTimeout = callback;
                    return 71;
                }
                return originalSetTimeout(callback, delay, ...args);
            });
        render(
            <SidePanelProvider>
                <ContextConsumers />
            </SidePanelProvider>
        );

        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(port.postMessage).toHaveBeenCalledTimes(1);
        expect(acknowledgementTimeout).toEqual(expect.any(Function));

        act(() => acknowledgementTimeout());

        expect(port.disconnect).toHaveBeenCalledTimes(1);
        timeoutSpy.mockRestore();
    });

    test('retires registration authority when acknowledgement timeout scheduling fails', async () => {
        port.postMessage.mockImplementation(() => undefined);
        const originalSetTimeout = global.setTimeout;
        const timeoutSpy = jest
            .spyOn(global, 'setTimeout')
            .mockImplementation((callback, delay, ...args) => {
                if (delay === 2000) {
                    throw new Error('timeout scheduling failed');
                }
                return originalSetTimeout(callback, delay, ...args);
            });
        render(
            <SidePanelProvider>
                <ContextConsumers />
            </SidePanelProvider>
        );

        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(port.postMessage).toHaveBeenCalledTimes(1);
        expect(port.disconnect).toHaveBeenCalledTimes(1);
        timeoutSpy.mockRestore();
    });

    test('accepts background registration before publishing the canonical empty selection', async () => {
        const { backgroundPort, clientPort } = createLinkedSidePanelPorts();
        const service = new SidePanelService();
        service.handleSidePanelConnection(backgroundPort);
        chrome.runtime.connect = jest.fn(() => clientPort);
        chrome.tabs.get = jest.fn(async (tabId) => ({
            active: true,
            id: tabId,
            windowId: 1,
        }));
        chrome.tabs.sendMessage = jest.fn();
        const { unmount } = render(
            <SidePanelProvider>
                <ContextConsumers />
            </SidePanelProvider>
        );

        await waitFor(() =>
            expect(service.bindingByPort.get(backgroundPort)).toMatchObject({
                confirmed: true,
                tabId: 7,
                windowId: 1,
            })
        );
        expect(screen.getByText('connected')).toBeInTheDocument();
        expect(backgroundPort.postMessage.mock.calls).toEqual([
            [
                {
                    action: 'sidePanelBindingConfirmed',
                    data: {
                        registrationId: expect.any(Number),
                        tabId: 7,
                        windowId: 1,
                    },
                },
            ],
            [
                {
                    action: 'sidePanelSelectionSync',
                    data: {
                        binding: {
                            registrationId: expect.any(Number),
                            tabId: 7,
                            windowId: 1,
                        },
                        selection: null,
                    },
                },
            ],
        ]);
        expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
            7,
            {
                action: 'sidePanelGetState',
                data: { requestId: expect.any(Number) },
            },
            { frameId: 0 }
        );

        unmount();
        expect(service.bindingByPort).toHaveProperty('size', 0);
        expect(service.registrationClaimsByTab).toHaveProperty('size', 0);
        expect(service.registrationClaimByPort).toHaveProperty('size', 0);
        expect(clientPort.disconnect).toHaveBeenCalledTimes(1);

        service.destroy();
    });

    test('clears a confirmed background binding when its linked client disconnects', async () => {
        const { backgroundPort, clientPort } = createLinkedSidePanelPorts();
        const service = new SidePanelService();
        service.handleSidePanelConnection(backgroundPort);
        chrome.runtime.connect = jest.fn(() => clientPort);
        chrome.tabs.get = jest.fn(async (tabId) => ({
            active: true,
            id: tabId,
            windowId: 1,
        }));
        const { unmount } = render(
            <SidePanelProvider>
                <ContextConsumers />
            </SidePanelProvider>
        );
        await waitFor(() =>
            expect(service.bindingByPort.get(backgroundPort)).toMatchObject({
                confirmed: true,
                tabId: 7,
                windowId: 1,
            })
        );

        unmount();
        expect(service.bindingByPort).toHaveProperty('size', 0);
        expect(service.registrationClaimsByTab).toHaveProperty('size', 0);
        expect(service.registrationClaimByPort).toHaveProperty('size', 0);

        service.destroy();
    });

    test('does not let a stale acknowledgement timeout clear a newer binding', async () => {
        port.postMessage.mockImplementation(() => undefined);
        const originalSetTimeout = global.setTimeout;
        const acknowledgementTimeouts = [];
        const timeoutSpy = jest
            .spyOn(global, 'setTimeout')
            .mockImplementation((callback, delay, ...args) => {
                if (delay === 2000) {
                    acknowledgementTimeouts.push(callback);
                    return 72 + acknowledgementTimeouts.length;
                }
                return originalSetTimeout(callback, delay, ...args);
            });
        render(
            <SidePanelProvider>
                <ContextConsumers />
            </SidePanelProvider>
        );
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(acknowledgementTimeouts).toHaveLength(1);

        fireEvent.click(
            screen.getByRole('button', { name: 'Register valid tab' })
        );
        expect(acknowledgementTimeouts).toHaveLength(2);

        act(() => acknowledgementTimeouts[0]());
        expect(port.disconnect).not.toHaveBeenCalled();

        const currentRegistration = port.postMessage.mock.calls[1][0];
        act(() => {
            port.emit({
                action: 'sidePanelBindingConfirmed',
                data: currentRegistration.data,
            });
            acknowledgementTimeouts[0]();
        });
        expect(port.disconnect).not.toHaveBeenCalled();
        timeoutSpy.mockRestore();
    });

    test.each(['tabActivated', 'sidePanelForceBindTab'])(
        '%s invalidates the old binding until the replacement is acknowledged',
        async (action) => {
            render(
                <SidePanelProvider>
                    <ContextConsumers />
                </SidePanelProvider>
            );
            await waitFor(() =>
                expect(port.postMessage).toHaveBeenCalledTimes(1)
            );
            const initialRegistration = port.postMessage.mock.calls[0][0];
            act(() => {
                port.emit(
                    buildSidePanelSelectionStateMessage(
                        initialRegistration.data,
                        {
                            selectionOwnerGeneration: 1,
                            selectionRevision: 1,
                            renderRevision: 1,
                            reason: 'add',
                            entries: [{ wordIndex: 0, word: 'old' }],
                        }
                    )
                );
            });
            expect(screen.getByTestId('selected-words')).toHaveTextContent(
                'old'
            );

            port.postMessage.mockImplementation(() => undefined);
            act(() => {
                port.emit({
                    action,
                    data: { tabId: 8, windowId: 1 },
                });
            });
            expect(port.postMessage).toHaveBeenCalledTimes(2);
            expect(screen.getByTestId('selected-words')).toBeEmptyDOMElement();

            const replacement = port.postMessage.mock.calls[1][0];
            const replacementSelection = buildSidePanelSelectionStateMessage(
                replacement.data,
                {
                    selectionOwnerGeneration: 2,
                    selectionRevision: 1,
                    renderRevision: 1,
                    reason: 'add',
                    entries: [{ wordIndex: 0, word: 'replacement' }],
                }
            );
            act(() => port.emit(replacementSelection));
            expect(screen.getByTestId('selected-words')).toBeEmptyDOMElement();

            act(() => {
                port.emit({
                    action: 'sidePanelBindingConfirmed',
                    data: replacement.data,
                });
                port.emit(replacementSelection);
            });
            expect(screen.getByTestId('selected-words')).toHaveTextContent(
                'replacement'
            );
        }
    );

    test('ignores malformed, wrong, old, duplicate, and out-of-order acknowledgements', async () => {
        port.postMessage.mockImplementation(() => undefined);
        render(
            <SidePanelProvider>
                <ContextConsumers />
            </SidePanelProvider>
        );
        await waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));
        const oldRegistration = port.postMessage.mock.calls[0][0];

        act(() => {
            port.emit({
                action: 'tabActivated',
                data: { tabId: 8, windowId: 1 },
            });
        });
        expect(port.postMessage).toHaveBeenCalledTimes(2);
        const currentRegistration = port.postMessage.mock.calls[1][0];
        const currentSelection = buildSidePanelSelectionStateMessage(
            currentRegistration.data,
            {
                selectionOwnerGeneration: 2,
                selectionRevision: 1,
                renderRevision: 1,
                reason: 'add',
                entries: [{ wordIndex: 0, word: 'current' }],
            }
        );
        let hostileAcknowledgementAccessCount = 0;
        const hostileAcknowledgement = {};
        Object.defineProperty(hostileAcknowledgement, 'registrationId', {
            enumerable: true,
            get() {
                hostileAcknowledgementAccessCount++;
                throw new Error('hostile acknowledgement getter ran');
            },
        });

        const rejectedAcknowledgements = [
            {},
            hostileAcknowledgement,
            {
                registrationId: currentRegistration.data.registrationId,
                tabId: 9,
                windowId: 1,
            },
            {
                registrationId: currentRegistration.data.registrationId,
                tabId: 8,
                windowId: 2,
            },
            oldRegistration.data,
            { ...currentRegistration.data, unexpected: true },
        ];
        for (const data of rejectedAcknowledgements) {
            act(() => {
                port.emit({
                    action: 'sidePanelBindingConfirmed',
                    data,
                });
            });
        }
        act(() => {
            port.emit({
                action: 'sidePanelBindingConfirmed',
                data: currentRegistration.data,
                unexpected: true,
            });
            port.emit(currentSelection);
        });
        expect(screen.getByTestId('selected-words')).toBeEmptyDOMElement();
        expect(hostileAcknowledgementAccessCount).toBe(0);

        act(() => {
            port.emit({
                action: 'sidePanelBindingConfirmed',
                data: currentRegistration.data,
            });
            port.emit({
                action: 'sidePanelBindingConfirmed',
                data: currentRegistration.data,
            });
            port.emit({
                action: 'sidePanelBindingConfirmed',
                data: oldRegistration.data,
            });
            port.emit(currentSelection);
        });
        expect(screen.getByTestId('selected-words')).toHaveTextContent(
            'current'
        );
    });

    test('swallows a malformed binding confirmation before user listeners without disrupting ordinary routing', async () => {
        const acknowledgementListener = jest.fn();
        const ordinaryListener = jest.fn();
        const ordinaryData = { sequence: 1, value: 'unchanged' };

        render(
            <SidePanelProvider>
                <PortListenerProbe
                    action="sidePanelBindingConfirmed"
                    callback={acknowledgementListener}
                />
                <PortListenerProbe
                    action="ordinaryPortEvent"
                    callback={ordinaryListener}
                />
            </SidePanelProvider>
        );
        await waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));
        const registration = port.postMessage.mock.calls[0][0];

        act(() => {
            port.emit({
                action: 'sidePanelBindingConfirmed',
                data: registration.data,
                unexpected: true,
            });
            port.emit({
                action: 'ordinaryPortEvent',
                data: ordinaryData,
            });
        });

        expect(acknowledgementListener).not.toHaveBeenCalled();
        expect(ordinaryListener).toHaveBeenCalledTimes(1);
        expect(ordinaryListener.mock.calls[0][0]).toBe(ordinaryData);
    });

    test('does not resurrect a registration disconnected during acknowledgement normalization', async () => {
        port.postMessage.mockImplementation(() => undefined);
        render(
            <SidePanelProvider>
                <ContextConsumers />
            </SidePanelProvider>
        );
        await waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));
        const registration = port.postMessage.mock.calls[0][0];
        let prototypeChecks = 0;
        const reentrantAcknowledgement = new Proxy(
            { ...registration.data },
            {
                getPrototypeOf(target) {
                    prototypeChecks++;
                    port.emitDisconnect();
                    return Reflect.getPrototypeOf(target);
                },
            }
        );

        act(() => {
            port.emit({
                action: 'sidePanelBindingConfirmed',
                data: reentrantAcknowledgement,
            });
        });

        expect(prototypeChecks).toBe(1);
        expect(screen.getByText('offline')).toBeInTheDocument();
    });

    test('ignores an old-port acknowledgement after reconnect', async () => {
        port.postMessage.mockImplementation(() => undefined);
        const replacementPort = createPort({
            acknowledgeRegistrations: false,
        });
        chrome.runtime.connect
            .mockImplementationOnce(() => port)
            .mockImplementationOnce(() => replacementPort);
        render(
            <SidePanelProvider>
                <ContextConsumers />
            </SidePanelProvider>
        );
        await waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));
        const oldRegistration = port.postMessage.mock.calls[0][0];

        const reconnectTimer = jest
            .spyOn(global, 'setTimeout')
            .mockImplementationOnce((callback) => {
                callback();
                return 73;
            });
        act(() => port.emitDisconnect());
        reconnectTimer.mockRestore();
        await waitFor(() =>
            expect(replacementPort.postMessage).toHaveBeenCalledTimes(1)
        );
        const replacementRegistration =
            replacementPort.postMessage.mock.calls[0][0];

        act(() => {
            port.emit({
                action: 'sidePanelBindingConfirmed',
                data: oldRegistration.data,
            });
        });
        expect(replacementPort.postMessage).toHaveBeenCalledTimes(1);

        act(() => {
            replacementPort.emit({
                action: 'sidePanelBindingConfirmed',
                data: replacementRegistration.data,
            });
        });
        expect(screen.getByText('connected')).toBeInTheDocument();
    });

    test('uses positive monotonically increasing registration IDs across intents and ports', async () => {
        const replacementPort = createPort();
        chrome.runtime.connect
            .mockImplementationOnce(() => port)
            .mockImplementationOnce(() => replacementPort);
        render(
            <SidePanelProvider>
                <ContextConsumers />
            </SidePanelProvider>
        );
        await waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));
        act(() => {
            port.emit({
                action: 'tabActivated',
                data: { tabId: 8, windowId: 1 },
            });
        });
        expect(port.postMessage).toHaveBeenCalledTimes(2);

        const reconnectTimer = jest
            .spyOn(global, 'setTimeout')
            .mockImplementationOnce((callback) => {
                callback();
                return 74;
            });
        act(() => port.emitDisconnect());
        reconnectTimer.mockRestore();
        await waitFor(() =>
            expect(replacementPort.postMessage).toHaveBeenCalledTimes(1)
        );

        const registrationIds = [
            ...port.postMessage.mock.calls,
            ...replacementPort.postMessage.mock.calls,
        ].map(([message]) => message.data.registrationId);
        expect(registrationIds).toEqual([1, 2, 3]);
        expect(registrationIds.every(Number.isSafeInteger)).toBe(true);
        expect(registrationIds.every((id) => id > 0)).toBe(true);
    });

    test('ignores the retired bindingChanged route', async () => {
        render(
            <SidePanelProvider>
                <ContextConsumers />
            </SidePanelProvider>
        );
        await waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));

        act(() => {
            port.emit({
                action: 'bindingChanged',
                data: { tabId: 99, windowId: 9 },
            });
        });

        expect(port.postMessage).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('active-tab')).toHaveTextContent('7');
    });

    test('re-registers with the same contracted payload when the active tab changes', async () => {
        render(
            <SidePanelProvider>
                <ContextConsumers />
            </SidePanelProvider>
        );
        await waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));

        act(() => {
            port.emit({
                action: 'tabActivated',
                data: { tabId: 8, windowId: 1 },
            });
        });

        await waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(2));
        expect(port.postMessage).toHaveBeenLastCalledWith({
            action: 'sidePanelRegister',
            data: {
                registrationId: expect.any(Number),
                tabId: 8,
                windowId: 1,
            },
            source: 'sidepanel',
            timestamp: expect.any(Number),
        });
        for (const [message] of port.postMessage.mock.calls) {
            expect(message.action).toBe('sidePanelRegister');
            expect(message.data).not.toHaveProperty('panelInstanceId');
        }
    });

    test('reconnects and re-registers after an unintentional disconnect', async () => {
        const replacementPort = createPort();
        chrome.runtime.connect
            .mockImplementationOnce(() => port)
            .mockImplementationOnce(() => replacementPort);
        render(
            <SidePanelProvider>
                <ContextConsumers />
            </SidePanelProvider>
        );
        await waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));

        const timer = jest
            .spyOn(global, 'setTimeout')
            .mockImplementationOnce((callback) => {
                callback();
                return 1;
            });
        act(() => port.emitDisconnect());
        timer.mockRestore();

        await waitFor(() =>
            expect(chrome.runtime.connect).toHaveBeenCalledTimes(2)
        );
        await waitFor(() =>
            expect(replacementPort.postMessage).toHaveBeenCalledTimes(1)
        );
        expect(replacementPort.postMessage).toHaveBeenCalledWith({
            action: 'sidePanelRegister',
            data: {
                registrationId: expect.any(Number),
                tabId: 7,
                windowId: 1,
            },
            source: 'sidepanel',
            timestamp: expect.any(Number),
        });
    });

    test('ignores an old active-tab lookup after a replacement port registers', async () => {
        const oldLookup = deferred();
        const replacementPort = createPort();
        chrome.runtime.connect
            .mockImplementationOnce(() => port)
            .mockImplementationOnce(() => replacementPort);
        chrome.tabs.query
            .mockImplementationOnce(() => oldLookup.promise)
            .mockResolvedValueOnce([
                {
                    id: 8,
                    active: true,
                    windowId: 1,
                    url: 'https://www.netflix.com/watch/2',
                },
            ]);

        render(
            <SidePanelProvider>
                <ContextConsumers />
            </SidePanelProvider>
        );
        await waitFor(() => expect(chrome.tabs.query).toHaveBeenCalledTimes(1));

        const timer = jest
            .spyOn(global, 'setTimeout')
            .mockImplementationOnce((callback) => {
                callback();
                return 1;
            });
        act(() => port.emitDisconnect());
        timer.mockRestore();

        await waitFor(() =>
            expect(replacementPort.postMessage).toHaveBeenCalledTimes(1)
        );
        expect(replacementPort.postMessage).toHaveBeenLastCalledWith({
            action: 'sidePanelRegister',
            data: {
                registrationId: expect.any(Number),
                tabId: 8,
                windowId: 1,
            },
            source: 'sidepanel',
            timestamp: expect.any(Number),
        });

        await act(async () => {
            oldLookup.resolve([
                {
                    id: 7,
                    active: true,
                    windowId: 1,
                    url: 'https://www.netflix.com/watch/1',
                },
            ]);
            await oldLookup.promise;
        });

        expect(replacementPort.postMessage).toHaveBeenCalledTimes(1);
    });

    test('does not let an older same-port lookup undo tab activation', async () => {
        const oldLookup = deferred();
        chrome.tabs.query.mockImplementationOnce(() => oldLookup.promise);
        render(
            <SidePanelProvider>
                <ContextConsumers />
            </SidePanelProvider>
        );
        await waitFor(() => expect(chrome.tabs.query).toHaveBeenCalledTimes(1));

        act(() => {
            port.emit({
                action: 'tabActivated',
                data: { tabId: 8, windowId: 1 },
            });
        });
        expect(port.postMessage).toHaveBeenCalledTimes(1);

        await act(async () => {
            oldLookup.resolve([
                {
                    id: 7,
                    active: true,
                    windowId: 1,
                    url: 'https://www.netflix.com/watch/1',
                },
            ]);
            await oldLookup.promise;
        });

        expect(port.postMessage).toHaveBeenCalledTimes(1);
        expect(port.postMessage.mock.calls[0][0].data).toEqual({
            registrationId: expect.any(Number),
            tabId: 8,
            windowId: 1,
        });
        expect(screen.getByTestId('active-tab')).toHaveTextContent('8');
    });

    test('does not let an older same-port lookup undo forced binding', async () => {
        const oldLookup = deferred();
        chrome.tabs.query.mockImplementationOnce(() => oldLookup.promise);
        render(
            <SidePanelProvider>
                <ContextConsumers />
            </SidePanelProvider>
        );
        await waitFor(() => expect(chrome.tabs.query).toHaveBeenCalledTimes(1));

        act(() => {
            port.emit({
                action: 'sidePanelForceBindTab',
                data: { tabId: 8, windowId: 1 },
            });
        });
        expect(port.postMessage).toHaveBeenCalledTimes(1);

        await act(async () => {
            oldLookup.resolve([
                {
                    id: 7,
                    active: true,
                    windowId: 1,
                    url: 'https://www.netflix.com/watch/1',
                },
            ]);
            await oldLookup.promise;
        });

        expect(port.postMessage).toHaveBeenCalledTimes(1);
        expect(port.postMessage.mock.calls[0][0].data).toEqual({
            registrationId: expect.any(Number),
            tabId: 8,
            windowId: 1,
        });
        expect(screen.getByTestId('active-tab')).toHaveTextContent('8');
    });

    test('ignores tab activation delivered by a replaced port', async () => {
        const replacementPort = createPort();
        chrome.runtime.connect
            .mockImplementationOnce(() => port)
            .mockImplementationOnce(() => replacementPort);
        render(
            <SidePanelProvider>
                <ContextConsumers />
            </SidePanelProvider>
        );
        await waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));

        const timer = jest
            .spyOn(global, 'setTimeout')
            .mockImplementationOnce((callback) => {
                callback();
                return 1;
            });
        act(() => port.emitDisconnect());
        timer.mockRestore();
        await waitFor(() =>
            expect(replacementPort.postMessage).toHaveBeenCalledTimes(1)
        );

        act(() => {
            port.emit({
                action: 'tabActivated',
                data: { tabId: 8, windowId: 1 },
            });
        });

        expect(replacementPort.postMessage).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('active-tab')).toHaveTextContent('7');
    });

    test('ignores forced binding delivered by a replaced port', async () => {
        const replacementPort = createPort();
        chrome.runtime.connect
            .mockImplementationOnce(() => port)
            .mockImplementationOnce(() => replacementPort);
        render(
            <SidePanelProvider>
                <ContextConsumers />
            </SidePanelProvider>
        );
        await waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));

        const timer = jest
            .spyOn(global, 'setTimeout')
            .mockImplementationOnce((callback) => {
                callback();
                return 1;
            });
        act(() => port.emitDisconnect());
        timer.mockRestore();
        await waitFor(() =>
            expect(replacementPort.postMessage).toHaveBeenCalledTimes(1)
        );

        act(() => {
            port.emit({
                action: 'sidePanelForceBindTab',
                data: { tabId: 8, windowId: 1 },
            });
        });

        expect(replacementPort.postMessage).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('active-tab')).toHaveTextContent('7');
    });

    test('ignores selection sync delivered by a replaced port', async () => {
        const replacementPort = createPort();
        chrome.runtime.connect
            .mockImplementationOnce(() => port)
            .mockImplementationOnce(() => replacementPort);
        render(
            <SidePanelProvider>
                <ContextConsumers />
            </SidePanelProvider>
        );
        await waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));
        const oldBinding = port.postMessage.mock.calls[0][0].data;

        const timer = jest
            .spyOn(global, 'setTimeout')
            .mockImplementationOnce((callback) => {
                callback();
                return 1;
            });
        act(() => port.emitDisconnect());
        timer.mockRestore();
        await waitFor(() =>
            expect(replacementPort.postMessage).toHaveBeenCalledTimes(1)
        );

        act(() => {
            port.emit(
                buildSidePanelSelectionStateMessage(oldBinding, {
                    selectionOwnerGeneration: 3,
                    selectionRevision: 4,
                    renderRevision: 5,
                    reason: 'add',
                    entries: [{ wordIndex: 2, word: 'stale' }],
                })
            );
        });

        expect(screen.getByTestId('selected-words')).toBeEmptyDOMElement();
    });

    test('treats a stale old-port disconnect as inert after replacement', async () => {
        const replacementPort = createPort();
        chrome.runtime.connect
            .mockImplementationOnce(() => port)
            .mockImplementationOnce(() => replacementPort);
        render(
            <SidePanelProvider>
                <ContextConsumers />
            </SidePanelProvider>
        );
        await waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));

        const reconnectTimer = jest
            .spyOn(global, 'setTimeout')
            .mockImplementationOnce((callback) => {
                callback();
                return 1;
            });
        act(() => port.emitDisconnect());
        reconnectTimer.mockRestore();
        await waitFor(() =>
            expect(replacementPort.postMessage).toHaveBeenCalledTimes(1)
        );

        const staleTimer = jest.spyOn(global, 'setTimeout');
        act(() => port.emitDisconnect());

        expect(staleTimer).not.toHaveBeenCalled();
        expect(chrome.runtime.connect).toHaveBeenCalledTimes(2);
        expect(screen.getByText('connected')).toBeInTheDocument();
        staleTimer.mockRestore();
    });

    test('does nothing when an active-tab lookup resolves after unmount', async () => {
        const pendingLookup = deferred();
        chrome.tabs.query.mockImplementationOnce(() => pendingLookup.promise);
        const { unmount } = render(
            <SidePanelProvider>
                <ContextConsumers />
            </SidePanelProvider>
        );
        await waitFor(() => expect(chrome.tabs.query).toHaveBeenCalledTimes(1));

        unmount();
        await act(async () => {
            pendingLookup.resolve([
                {
                    id: 7,
                    active: true,
                    windowId: 1,
                    url: 'https://www.netflix.com/watch/1',
                },
            ]);
            await pendingLookup.promise;
        });

        expect(port.disconnect).toHaveBeenCalledTimes(1);
        expect(port.postMessage).not.toHaveBeenCalled();
        expect(chrome.runtime.connect).toHaveBeenCalledTimes(1);
    });

    test('registers and handles current replacement-port messages exactly once', async () => {
        const replacementPort = createPort();
        chrome.runtime.connect
            .mockImplementationOnce(() => port)
            .mockImplementationOnce(() => replacementPort);
        render(
            <SidePanelProvider>
                <ContextConsumers />
            </SidePanelProvider>
        );
        await waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));

        const timer = jest
            .spyOn(global, 'setTimeout')
            .mockImplementationOnce((callback) => {
                callback();
                return 1;
            });
        act(() => port.emitDisconnect());
        timer.mockRestore();
        await waitFor(() =>
            expect(replacementPort.postMessage).toHaveBeenCalledTimes(1)
        );

        act(() => {
            replacementPort.emit({
                action: 'tabActivated',
                data: { tabId: 8, windowId: 1 },
            });
            replacementPort.emit({
                action: 'sidePanelForceBindTab',
                data: { tabId: 9, windowId: 1 },
            });
            const binding = replacementPort.postMessage.mock.calls[2][0].data;
            replacementPort.emit(
                buildSidePanelSelectionStateMessage(binding, {
                    selectionOwnerGeneration: 3,
                    selectionRevision: 4,
                    renderRevision: 5,
                    reason: 'add',
                    entries: [{ wordIndex: 2, word: 'current' }],
                })
            );
        });

        expect(replacementPort.postMessage).toHaveBeenCalledTimes(3);
        expect(
            replacementPort.postMessage.mock.calls.map(
                ([message]) => message.data.tabId
            )
        ).toEqual([7, 8, 9]);
        expect(screen.getByTestId('active-tab')).toHaveTextContent('9');
        expect(screen.getByTestId('selected-words')).toHaveTextContent(
            'current'
        );
    });

    test('ignores a canceled reconnect callback invoked after unmount', async () => {
        const replacementPort = createPort();
        let staleReconnect;
        chrome.runtime.connect
            .mockImplementationOnce(() => port)
            .mockImplementationOnce(() => replacementPort);
        const { unmount } = render(
            <SidePanelProvider>
                <ContextConsumers />
            </SidePanelProvider>
        );
        await waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));

        const timer = jest
            .spyOn(global, 'setTimeout')
            .mockImplementationOnce((callback) => {
                staleReconnect = callback;
                return 41;
            });
        act(() => port.emitDisconnect());
        timer.mockRestore();
        expect(staleReconnect).toEqual(expect.any(Function));

        unmount();
        act(() => staleReconnect());

        expect(chrome.runtime.connect).toHaveBeenCalledTimes(1);
        expect(replacementPort.postMessage).not.toHaveBeenCalled();
    });

    test('establishes the replayed StrictMode connection', async () => {
        const replacementPort = createPort();
        chrome.runtime.connect
            .mockImplementationOnce(() => port)
            .mockImplementationOnce(() => replacementPort);

        render(
            <StrictMode>
                <SidePanelProvider>
                    <ContextConsumers />
                </SidePanelProvider>
            </StrictMode>
        );

        await waitFor(() =>
            expect(chrome.runtime.connect).toHaveBeenCalledTimes(2)
        );
        await waitFor(() =>
            expect(replacementPort.postMessage).toHaveBeenCalledTimes(1)
        );
        expect(port.disconnect).toHaveBeenCalledTimes(1);
        expect(screen.getByText('connected')).toBeInTheDocument();
    });

    test('rejects non-safe registration IDs without posting or rebinding', async () => {
        render(
            <SidePanelProvider>
                <ContextConsumers />
            </SidePanelProvider>
        );
        await waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));

        fireEvent.click(
            screen.getByRole('button', { name: 'Register invalid tab' })
        );
        fireEvent.click(
            screen.getByRole('button', { name: 'Register invalid window' })
        );

        expect(port.postMessage).toHaveBeenCalledTimes(1);
    });

    test('revokes the prior binding when replacement registration posting fails', async () => {
        render(
            <SidePanelProvider>
                <ContextConsumers />
            </SidePanelProvider>
        );
        await waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));
        port.postMessage.mockImplementationOnce(() => {
            throw new Error('disconnected during registration');
        });

        fireEvent.click(
            screen.getByRole('button', { name: 'Register valid tab' })
        );

        expect(port.postMessage).toHaveBeenCalledTimes(2);
    });

    test('ignores a stale public active-tab discovery after reconnect', async () => {
        const stalePublicLookup = deferred();
        const replacementPort = createPort();
        chrome.runtime.connect
            .mockImplementationOnce(() => port)
            .mockImplementationOnce(() => replacementPort);
        chrome.tabs.query
            .mockResolvedValueOnce([
                {
                    id: 7,
                    active: true,
                    windowId: 1,
                    url: 'https://www.netflix.com/watch/1',
                },
            ])
            .mockImplementationOnce(() => stalePublicLookup.promise)
            .mockResolvedValueOnce([
                {
                    id: 8,
                    active: true,
                    windowId: 1,
                    url: 'https://www.netflix.com/watch/2',
                },
            ]);
        render(
            <SidePanelProvider>
                <ContextConsumers />
            </SidePanelProvider>
        );
        await waitFor(() => expect(port.postMessage).toHaveBeenCalledTimes(1));

        fireEvent.click(
            screen.getByRole('button', { name: 'Discover active tab' })
        );
        await waitFor(() => expect(chrome.tabs.query).toHaveBeenCalledTimes(2));

        const timer = jest
            .spyOn(global, 'setTimeout')
            .mockImplementationOnce((callback) => {
                callback();
                return 1;
            });
        act(() => port.emitDisconnect());
        timer.mockRestore();
        await waitFor(() =>
            expect(replacementPort.postMessage).toHaveBeenCalledTimes(1)
        );

        await act(async () => {
            stalePublicLookup.resolve([
                {
                    id: 7,
                    active: true,
                    windowId: 1,
                    url: 'https://www.netflix.com/watch/1',
                },
            ]);
            await stalePublicLookup.promise;
        });

        expect(screen.getByTestId('discovered-tab')).toHaveTextContent('none');
        expect(replacementPort.postMessage.mock.calls[0][0].data.tabId).toBe(8);
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
        expect(chrome.runtime.sendMessage.mock.calls[0][0]).toEqual(
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
            secondRequest.resolve(
                createCanonicalAnalysisSuccess(
                    chrome.runtime.sendMessage.mock.calls[1][0],
                    { definition: 'new result' }
                )
            );
            await secondRequest.promise;
        });
        await waitFor(() =>
            expect(screen.getByTestId('analysis-result')).toHaveTextContent(
                'new result'
            )
        );

        await act(async () => {
            firstRequest.resolve(
                createCanonicalAnalysisSuccess(
                    chrome.runtime.sendMessage.mock.calls[0][0],
                    { definition: 'stale result' }
                )
            );
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
        chrome.runtime.sendMessage.mockImplementation((message) =>
            Promise.resolve(
                createCanonicalAnalysisSuccess(message, {
                    definition: 'combined result',
                })
            )
        );

        render(
            <SidePanelProvider>
                <AnalysisHarness />
            </SidePanelProvider>
        );
        await screen.findByText('ready');

        fireEvent.click(screen.getByRole('button', { name: 'Analyze first' }));

        await waitFor(() =>
            expect(chrome.runtime.sendMessage.mock.calls[0][0]).toEqual(
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
            request.resolve(
                createCanonicalAnalysisSuccess(
                    chrome.runtime.sendMessage.mock.calls[0][0],
                    { definition: 'obsolete result' }
                )
            );
            await request.promise;
        });

        expect(screen.getByTestId('analysis-result')).toBeEmptyDOMElement();
    });

    test('preserves duplicate tokens for analysis and removes one indexed chip', async () => {
        chrome.runtime.sendMessage.mockImplementation((message) =>
            Promise.resolve(
                createCanonicalAnalysisSuccess(message, {
                    definition: 'intensified phrase',
                })
            )
        );

        render(<SidePanelApp />);
        await screen.findByRole('heading', { name: 'AI Analysis' });
        await waitFor(() =>
            expect(
                port.postMessage.mock.calls.some(
                    ([message]) => message.action === 'sidePanelRegister'
                )
            ).toBe(true)
        );

        const binding = port.postMessage.mock.calls.find(
            ([message]) => message.action === 'sidePanelRegister'
        )[0].data;
        act(() => {
            port.emit(
                buildSidePanelSelectionStateMessage(binding, {
                    selectionOwnerGeneration: 3,
                    selectionRevision: 4,
                    renderRevision: 5,
                    reason: 'add',
                    entries: [
                        { wordIndex: 0, word: 'very' },
                        { wordIndex: 1, word: 'very' },
                        { wordIndex: 2, word: 'good' },
                    ],
                })
            );
        });

        const duplicateRemoveButtons = await screen.findAllByRole('button', {
            name: /Remove very at position/,
        });
        expect(duplicateRemoveButtons).toHaveLength(2);

        fireEvent.click(screen.getByRole('button', { name: 'Analyze' }));
        await waitFor(() =>
            expect(chrome.runtime.sendMessage.mock.calls[0][0]).toEqual(
                expect.objectContaining({
                    action: 'analyzeContext',
                    text: 'very very good',
                })
            )
        );
        await screen.findByText('intensified phrase');

        fireEvent.click(duplicateRemoveButtons[1]);
        const removalMessage = port.postMessage.mock.calls.find(
            ([message]) => message.action === 'sidePanelUpdateState'
        );
        expect(removalMessage?.[0]).toEqual({
            action: 'sidePanelUpdateState',
            data: {
                binding,
                requestId: expect.any(Number),
                selectionOwnerGeneration: 3,
                selectionRevision: 4,
                renderRevision: 5,
                wordIndex: 1,
            },
        });
        expect(
            screen.getAllByRole('button', {
                name: /Remove very at position/,
            })
        ).toHaveLength(2);

        act(() => {
            port.emit(
                buildSidePanelSelectionStateMessage(binding, {
                    selectionOwnerGeneration: 3,
                    selectionRevision: 5,
                    renderRevision: 5,
                    reason: 'remove',
                    entries: [
                        { wordIndex: 0, word: 'very' },
                        { wordIndex: 2, word: 'good' },
                    ],
                })
            );
            port.emit(
                buildSidePanelSelectionRemovalResultMessage(
                    removalMessage[0].data,
                    'applied'
                )
            );
        });
        await waitFor(() =>
            expect(
                screen.getAllByRole('button', {
                    name: /Remove very at position/,
                })
            ).toHaveLength(1)
        );
        expect(
            chrome.tabs.sendMessage.mock.calls.some(
                ([, message]) => message?.action === 'sidePanelUpdateState'
            )
        ).toBe(false);
    });
});
