import { jest } from '@jest/globals';
import { SidePanelService } from './sidePanelService.js';
import { configService } from '../../services/configService.js';
import { MessageActions } from '../../content_scripts/shared/constants/messageActions.js';
import {
    MessageSenderRoles,
    buildSidePanelRegistrationMessage,
    buildSidePanelSelectionRemovalRequestMessage,
    parseSidePanelBindingConfirmationMessage,
    parseSidePanelForceBindTabMessage,
    parseSidePanelSelectionRemovalCommandMessage,
    parseSidePanelSelectionRemovalResultMessage,
    parseSidePanelSelectionStateMessage,
    parseSidePanelTabActivatedMessage,
} from '../../content_scripts/shared/protocol/messageProtocol.js';

const EXTENSION_ID = 'dualsub-test-extension';
const EXTENSION_ORIGIN = `chrome-extension://${EXTENSION_ID}`;
const SIDE_PANEL_URL = `${EXTENSION_ORIGIN}/sidepanel/sidepanel.html`;

function createChromeEvent() {
    const listeners = new Set();
    return {
        addListener: jest.fn((listener) => listeners.add(listener)),
        removeListener: jest.fn((listener) => listeners.delete(listener)),
        emit: (...args) => {
            for (const listener of [...listeners]) listener(...args);
        },
    };
}

function createPort(sender = {}) {
    const onMessage = createChromeEvent();
    const onDisconnect = createChromeEvent();
    return {
        name: 'sidepanel',
        sender: {
            id: EXTENSION_ID,
            origin: EXTENSION_ORIGIN,
            url: SIDE_PANEL_URL,
            ...sender,
        },
        onMessage,
        onDisconnect,
        disconnect: jest.fn(),
        postMessage: jest.fn(),
        emit(message) {
            onMessage.emit(message);
        },
        emitDisconnect() {
            onDisconnect.emit();
        },
    };
}

function setupChrome({ getTab, sendMessage, sidePanel = true } = {}) {
    const events = {
        onActivated: createChromeEvent(),
        onConnect: createChromeEvent(),
        onRemoved: createChromeEvent(),
        onUpdated: createChromeEvent(),
    };
    global.chrome = {
        runtime: {
            id: EXTENSION_ID,
            getURL: jest.fn((path = '') => `${EXTENSION_ORIGIN}/${path}`),
            onConnect: events.onConnect,
        },
        tabs: {
            get: jest.fn(
                getTab ??
                    (async (tabId) => ({
                        active: true,
                        id: tabId,
                        windowId: 1,
                    }))
            ),
            onActivated: events.onActivated,
            onRemoved: events.onRemoved,
            onUpdated: events.onUpdated,
            sendMessage: jest.fn(
                sendMessage ?? (async () => ({ success: true }))
            ),
        },
    };
    if (sidePanel) {
        chrome.sidePanel = { open: jest.fn(async () => undefined) };
    }
    return events;
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

async function flushAsync() {
    for (let index = 0; index < 8; index += 1) {
        await Promise.resolve();
    }
}

function emitRegistration(port, binding, timestamp = 1) {
    port.emit(buildSidePanelRegistrationMessage(binding, timestamp));
}

function createIdentity(overrides = {}) {
    return Object.freeze({
        role: MessageSenderRoles.CONTENT,
        tabId: 7,
        windowId: 1,
        frameId: 0,
        documentId: 'document-7-a',
        documentLifecycle: 'active',
        ...overrides,
    });
}

function createSnapshot(overrides = {}) {
    return Object.freeze({
        lifecycleGeneration: 1,
        selectionRevision: 1,
        renderRevision: 4,
        reason: 'add',
        entries: Object.freeze([
            Object.freeze({ wordIndex: 1, word: 'very' }),
            Object.freeze({ wordIndex: 3, word: 'good' }),
        ]),
        ...overrides,
    });
}

function messagesFor(port, action) {
    return port.postMessage.mock.calls
        .map(([message]) => message)
        .filter((message) => message.action === action);
}

function latestSelection(port, binding) {
    const messages = messagesFor(port, MessageActions.SIDEPANEL_SELECTION_SYNC);
    return parseSidePanelSelectionStateMessage(messages.at(-1), binding);
}

async function connectAndBind(service, events, port, binding) {
    service.registerListeners();
    events.onConnect.emit(port);
    emitRegistration(port, binding);
    await flushAsync();
    return binding;
}

describe('SidePanelService connection and binding flows', () => {
    let events;
    let service;

    beforeEach(() => {
        events = setupChrome();
        service = new SidePanelService();
    });

    afterEach(() => {
        service.destroy();
    });

    test('registers an active tab, confirms it, and requests selection republish', async () => {
        const port = createPort();
        const binding = { registrationId: 1, tabId: 7, windowId: 1 };

        await connectAndBind(service, events, port, binding);

        expect(chrome.tabs.get).toHaveBeenCalledWith(7);
        expect(port.postMessage).toHaveBeenCalledTimes(2);
        expect(
            parseSidePanelBindingConfirmationMessage(
                port.postMessage.mock.calls[0][0]
            )
        ).toEqual(binding);
        expect(latestSelection(port, binding)).toEqual({
            binding,
            selection: null,
        });
        expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
            7,
            {
                action: MessageActions.SIDEPANEL_GET_STATE,
                data: { requestId: 1 },
            },
            { frameId: 0 }
        );
    });

    test('holds registration behind background readiness', async () => {
        const ready = deferred();
        const readiness = {
            isReady: jest.fn(() => false),
            waitUntilReady: jest.fn(() => ready.promise),
        };
        const port = createPort();
        service.registerListeners(readiness);
        events.onConnect.emit(port);

        emitRegistration(port, {
            registrationId: 2,
            tabId: 7,
            windowId: 1,
        });
        await flushAsync();

        expect(chrome.tabs.get).not.toHaveBeenCalled();
        expect(port.postMessage).not.toHaveBeenCalled();

        ready.resolve();
        await flushAsync();
        expect(chrome.tabs.get).toHaveBeenCalledWith(7);
        expect(port.postMessage).toHaveBeenCalledTimes(2);
    });

    test('rejects an untrusted port without reading registration data', () => {
        service.registerListeners();
        const port = createPort({
            url: 'https://www.netflix.com/watch/1',
            origin: 'https://www.netflix.com',
        });

        events.onConnect.emit(port);

        expect(port.disconnect).toHaveBeenCalledTimes(1);
        expect(chrome.tabs.get).not.toHaveBeenCalled();
        expect(port.postMessage).not.toHaveBeenCalled();
    });

    test('fails closed for a malformed message on a trusted connection', async () => {
        service.registerListeners();
        const port = createPort();
        events.onConnect.emit(port);

        port.emit({ action: MessageActions.SIDEPANEL_REGISTER });
        await flushAsync();

        expect(port.disconnect).toHaveBeenCalledTimes(1);
        expect(chrome.tabs.get).not.toHaveBeenCalled();
        expect(port.postMessage).not.toHaveBeenCalled();
    });

    test.each([
        [
            'missing tab',
            async () => {
                throw new Error('missing');
            },
        ],
        [
            'inactive tab',
            async (tabId) => ({
                active: false,
                id: tabId,
                windowId: 1,
            }),
        ],
        [
            'wrong window',
            async (tabId) => ({
                active: true,
                id: tabId,
                windowId: 2,
            }),
        ],
    ])(
        'disconnects without disclosing state for a %s',
        async (_name, getTab) => {
            events = setupChrome({ getTab });
            service.destroy();
            service = new SidePanelService();
            const port = createPort();

            await connectAndBind(service, events, port, {
                registrationId: 3,
                tabId: 7,
                windowId: 1,
            });

            expect(port.disconnect).toHaveBeenCalledTimes(1);
            expect(port.postMessage).not.toHaveBeenCalled();
            expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
        }
    );

    test('lets the newest same-port registration win an async race', async () => {
        const firstLookup = deferred();
        events = setupChrome({
            getTab: (tabId) =>
                tabId === 7
                    ? firstLookup.promise
                    : Promise.resolve({
                          active: true,
                          id: tabId,
                          windowId: 2,
                      }),
        });
        service.destroy();
        service = new SidePanelService();
        service.registerListeners();
        const port = createPort();
        events.onConnect.emit(port);

        emitRegistration(port, {
            registrationId: 10,
            tabId: 7,
            windowId: 1,
        });
        emitRegistration(port, {
            registrationId: 11,
            tabId: 8,
            windowId: 2,
        });
        await flushAsync();

        const confirmations = messagesFor(
            port,
            MessageActions.SIDEPANEL_BINDING_CONFIRMED
        );
        expect(confirmations).toHaveLength(1);
        expect(
            parseSidePanelBindingConfirmationMessage(confirmations[0])
        ).toEqual({ registrationId: 11, tabId: 8, windowId: 2 });

        firstLookup.resolve({ active: true, id: 7, windowId: 1 });
        await flushAsync();
        expect(
            messagesFor(port, MessageActions.SIDEPANEL_BINDING_CONFIRMED)
        ).toHaveLength(1);
        expect(port.disconnect).not.toHaveBeenCalled();
    });

    test('a reconnecting port replaces the prior owner of the same tab', async () => {
        const first = createPort();
        const second = createPort();
        const binding = { registrationId: 20, tabId: 7, windowId: 1 };
        await connectAndBind(service, events, first, binding);

        events.onConnect.emit(second);
        emitRegistration(second, {
            registrationId: 21,
            tabId: 7,
            windowId: 1,
        });
        await flushAsync();

        expect(first.disconnect).toHaveBeenCalledTimes(1);
        expect(
            parseSidePanelBindingConfirmationMessage(
                messagesFor(
                    second,
                    MessageActions.SIDEPANEL_BINDING_CONFIRMED
                )[0]
            )
        ).toEqual({ registrationId: 21, tabId: 7, windowId: 1 });
    });

    test('disconnect cleanup makes later selection delivery inert', async () => {
        const port = createPort();
        await connectAndBind(service, events, port, {
            registrationId: 30,
            tabId: 7,
            windowId: 1,
        });
        port.postMessage.mockClear();

        port.emitDisconnect();
        expect(
            service.acceptSelectionSnapshot(createIdentity(), createSnapshot())
        ).toBe(true);

        expect(port.postMessage).not.toHaveBeenCalled();
    });

    test('tab activation clears the old binding and asks the panel to rebind', async () => {
        const port = createPort();
        const oldBinding = {
            registrationId: 40,
            tabId: 7,
            windowId: 1,
        };
        await connectAndBind(service, events, port, oldBinding);
        expect(
            service.acceptSelectionSnapshot(createIdentity(), createSnapshot())
        ).toBe(true);
        port.postMessage.mockClear();

        events.onActivated.emit({ tabId: 8, windowId: 1 });
        await flushAsync();

        expect(port.postMessage).toHaveBeenCalledTimes(1);
        expect(
            parseSidePanelTabActivatedMessage(port.postMessage.mock.calls[0][0])
        ).toEqual({ tabId: 8, windowId: 1 });
        expect(
            service.acceptSelectionSnapshot(
                createIdentity(),
                createSnapshot({
                    selectionRevision: 2,
                })
            )
        ).toBe(false);

        const newIdentity = createIdentity({
            tabId: 8,
            documentId: 'document-8-a',
        });
        expect(
            service.acceptSelectionSnapshot(newIdentity, createSnapshot())
        ).toBe(true);
        emitRegistration(port, {
            registrationId: 41,
            tabId: 8,
            windowId: 1,
        });
        await flushAsync();

        const selection = latestSelection(port, {
            registrationId: 41,
            tabId: 8,
            windowId: 1,
        });
        expect(selection.selection.entries).toEqual([
            { wordIndex: 1, word: 'very' },
            { wordIndex: 3, word: 'good' },
        ]);
    });

    test('navigation revokes the outgoing document while retaining the binding', async () => {
        const port = createPort();
        const binding = { registrationId: 50, tabId: 7, windowId: 1 };
        await connectAndBind(service, events, port, binding);
        service.acceptSelectionSnapshot(createIdentity(), createSnapshot());
        port.postMessage.mockClear();

        events.onUpdated.emit(7, { status: 'loading' }, {});

        expect(port.postMessage).toHaveBeenCalledTimes(1);
        expect(latestSelection(port, binding)).toEqual({
            binding,
            selection: null,
        });
        expect(port.disconnect).not.toHaveBeenCalled();

        expect(
            service.acceptSelectionSnapshot(
                createIdentity(),
                createSnapshot({ selectionRevision: 2 })
            )
        ).toBe(false);
        expect(port.postMessage).toHaveBeenCalledTimes(1);

        events.onActivated.emit({ tabId: 8, windowId: 1 });
        await flushAsync();
        events.onActivated.emit({ tabId: 7, windowId: 1 });
        await flushAsync();
        expect(
            service.acceptSelectionSnapshot(
                createIdentity(),
                createSnapshot({ selectionRevision: 3 })
            )
        ).toBe(false);

        const reconnect = createPort();
        const reconnectBinding = {
            registrationId: 51,
            tabId: 7,
            windowId: 1,
        };
        events.onConnect.emit(reconnect);
        emitRegistration(reconnect, reconnectBinding);
        await flushAsync();

        expect(
            latestSelection(reconnect, reconnectBinding).selection
        ).toBeNull();
        expect(chrome.tabs.sendMessage).toHaveBeenLastCalledWith(
            7,
            expect.objectContaining({
                action: MessageActions.SIDEPANEL_GET_STATE,
            }),
            { frameId: 0 }
        );

        expect(
            service.acceptSelectionSnapshot(
                createIdentity({ documentId: 'document-7-b' }),
                createSnapshot()
            )
        ).toBe(true);
        expect(
            latestSelection(reconnect, reconnectBinding).selection
        ).not.toBeNull();

        reconnect.postMessage.mockClear();
        events.onUpdated.emit(7, { status: 'loading' }, {});
        expect(
            service.acceptSelectionSnapshot(
                createIdentity({ documentId: 'document-7-b' }),
                createSnapshot({ selectionRevision: 2 })
            )
        ).toBe(false);
        expect(reconnect.postMessage).toHaveBeenCalledTimes(1);
        expect(
            service.acceptSelectionSnapshot(
                createIdentity(),
                createSnapshot({ selectionRevision: 4 })
            )
        ).toBe(true);
    });

    test('revalidates the original document after an aborted navigation', async () => {
        const port = createPort();
        const binding = { registrationId: 52, tabId: 7, windowId: 1 };
        await connectAndBind(service, events, port, binding);
        service.acceptSelectionSnapshot(createIdentity(), createSnapshot());
        port.postMessage.mockClear();
        chrome.tabs.sendMessage.mockClear();
        let requestCount = 0;
        chrome.tabs.sendMessage.mockImplementation(
            async (_tabId, request, target) => {
                if (target?.documentId === 'document-7-a') {
                    requestCount += 1;
                    if (requestCount === 1) return { success: true };
                    expect(
                        service.acceptSelectionSnapshot(
                            createIdentity(),
                            createSnapshot({ selectionRevision: 2 })
                        )
                    ).toBe(true);
                    return { requestId: request.data.requestId };
                }
                return { success: true };
            }
        );

        events.onUpdated.emit(7, { status: 'loading' }, {});
        events.onUpdated.emit(7, { status: 'complete' }, {});
        await flushAsync();

        expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
            7,
            expect.objectContaining({
                action: MessageActions.SIDEPANEL_GET_STATE,
            }),
            { documentId: 'document-7-a', frameId: 0 }
        );
        expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(2);
        expect(
            chrome.tabs.sendMessage.mock.calls[1][1].data.requestId
        ).not.toBe(chrome.tabs.sendMessage.mock.calls[0][1].data.requestId);
        expect(
            service.acceptSelectionSnapshot(
                createIdentity(),
                createSnapshot({ selectionRevision: 3 })
            )
        ).toBe(true);
        expect(latestSelection(port, binding).selection).not.toBeNull();
    });

    test('does not reauthorize a stale snapshot while its probe is pending', async () => {
        const port = createPort();
        const binding = { registrationId: 53, tabId: 7, windowId: 1 };
        await connectAndBind(service, events, port, binding);
        service.acceptSelectionSnapshot(createIdentity(), createSnapshot());
        const probe = deferred();
        chrome.tabs.sendMessage.mockClear();
        chrome.tabs.sendMessage.mockImplementation(() => probe.promise);

        events.onUpdated.emit(7, { status: 'loading' }, {});
        events.onUpdated.emit(7, { status: 'complete' }, {});
        await flushAsync();

        expect(
            service.acceptSelectionSnapshot(
                createIdentity(),
                createSnapshot({ selectionRevision: 2 })
            )
        ).toBe(false);
        probe.reject(new Error('document is gone'));
        await flushAsync();
        expect(
            service.acceptSelectionSnapshot(
                createIdentity(),
                createSnapshot({ selectionRevision: 3 })
            )
        ).toBe(false);
        expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1);
    });

    test('tab removal disconnects the panel and drops its prior snapshot', async () => {
        const first = createPort();
        await connectAndBind(service, events, first, {
            registrationId: 60,
            tabId: 7,
            windowId: 1,
        });
        service.acceptSelectionSnapshot(createIdentity(), createSnapshot());

        events.onRemoved.emit(7);
        expect(first.disconnect).toHaveBeenCalledTimes(1);

        const replacement = createPort();
        events.onConnect.emit(replacement);
        emitRegistration(replacement, {
            registrationId: 61,
            tabId: 7,
            windowId: 1,
        });
        await flushAsync();

        expect(
            latestSelection(replacement, {
                registrationId: 61,
                tabId: 7,
                windowId: 1,
            }).selection
        ).toBeNull();
    });
});

describe('SidePanelService selection snapshots', () => {
    let events;
    let service;
    let port;
    const binding = { registrationId: 70, tabId: 7, windowId: 1 };

    beforeEach(async () => {
        events = setupChrome();
        service = new SidePanelService();
        port = createPort();
        await connectAndBind(service, events, port, binding);
        port.postMessage.mockClear();
    });

    afterEach(() => {
        service.destroy();
    });

    test('publishes the current snapshot and restores it on reconnect', async () => {
        expect(
            service.acceptSelectionSnapshot(createIdentity(), createSnapshot())
        ).toBe(true);
        const published = latestSelection(port, binding);
        expect(published.selection).toEqual({
            selectionOwnerGeneration: 1,
            selectionRevision: 1,
            renderRevision: 4,
            reason: 'add',
            entries: [
                { wordIndex: 1, word: 'very' },
                { wordIndex: 3, word: 'good' },
            ],
        });

        const reconnect = createPort();
        events.onConnect.emit(reconnect);
        const reconnectBinding = {
            registrationId: 71,
            tabId: 7,
            windowId: 1,
        };
        emitRegistration(reconnect, reconnectBinding);
        await flushAsync();

        expect(port.disconnect).toHaveBeenCalledTimes(1);
        expect(latestSelection(reconnect, reconnectBinding).selection).toEqual(
            published.selection
        );
        expect(chrome.tabs.sendMessage).toHaveBeenLastCalledWith(
            7,
            expect.objectContaining({
                action: MessageActions.SIDEPANEL_GET_STATE,
            }),
            { documentId: 'document-7-a', frameId: 0 }
        );
    });

    test('accepts idempotent replay and suppresses stale or conflicting revisions', () => {
        const identity = createIdentity();
        const current = createSnapshot({ selectionRevision: 3 });
        expect(service.acceptSelectionSnapshot(identity, current)).toBe(true);
        port.postMessage.mockClear();

        expect(service.acceptSelectionSnapshot(identity, current)).toBe(true);
        expect(
            service.acceptSelectionSnapshot(
                identity,
                createSnapshot({ selectionRevision: 2 })
            )
        ).toBe(false);
        expect(
            service.acceptSelectionSnapshot(
                identity,
                createSnapshot({
                    selectionRevision: 3,
                    reason: 'toggle',
                })
            )
        ).toBe(false);
        expect(
            service.acceptSelectionSnapshot(
                identity,
                createSnapshot({
                    selectionRevision: 4,
                    renderRevision: 3,
                })
            )
        ).toBe(false);

        expect(port.postMessage).not.toHaveBeenCalled();
    });

    test('mints a new owner generation for a new lifecycle or confirmed document', () => {
        const identity = createIdentity();
        service.acceptSelectionSnapshot(identity, createSnapshot());
        port.postMessage.mockClear();

        expect(
            service.acceptSelectionSnapshot(
                identity,
                createSnapshot({
                    lifecycleGeneration: 2,
                    selectionRevision: 1,
                })
            )
        ).toBe(true);
        expect(
            latestSelection(port, binding).selection.selectionOwnerGeneration
        ).toBe(2);

        events.onUpdated.emit(7, { status: 'loading' }, {});
        port.postMessage.mockClear();
        expect(
            service.acceptSelectionSnapshot(
                createIdentity({ documentId: 'document-7-b' }),
                createSnapshot({ lifecycleGeneration: 1 })
            )
        ).toBe(true);
        expect(
            latestSelection(port, binding).selection.selectionOwnerGeneration
        ).toBe(3);
    });

    test('rejects stale lifecycle and inactive-window snapshots', async () => {
        const identity = createIdentity();
        service.acceptSelectionSnapshot(
            identity,
            createSnapshot({ lifecycleGeneration: 2 })
        );
        port.postMessage.mockClear();

        expect(
            service.acceptSelectionSnapshot(
                identity,
                createSnapshot({
                    lifecycleGeneration: 1,
                    selectionRevision: 2,
                })
            )
        ).toBe(false);

        events.onActivated.emit({ tabId: 8, windowId: 1 });
        await flushAsync();
        port.postMessage.mockClear();
        expect(
            service.acceptSelectionSnapshot(
                identity,
                createSnapshot({
                    lifecycleGeneration: 3,
                    selectionRevision: 1,
                })
            )
        ).toBe(false);
        expect(port.postMessage).not.toHaveBeenCalled();
    });

    test.each([
        [
            'wrong sender role',
            createIdentity({ role: MessageSenderRoles.SIDEPANEL }),
        ],
        ['subframe', createIdentity({ frameId: 1 })],
        ['inactive document', createIdentity({ documentLifecycle: 'cached' })],
    ])('rejects a %s without exposing selection state', (_name, identity) => {
        expect(
            service.acceptSelectionSnapshot(identity, createSnapshot())
        ).toBe(false);
        expect(port.postMessage).not.toHaveBeenCalled();
    });
});

describe('SidePanelService selection removal', () => {
    let events;
    let service;
    let port;
    const binding = { registrationId: 80, tabId: 7, windowId: 1 };

    beforeEach(async () => {
        events = setupChrome();
        service = new SidePanelService();
        port = createPort();
        await connectAndBind(service, events, port, binding);
        service.acceptSelectionSnapshot(createIdentity(), createSnapshot());
        port.postMessage.mockClear();
        chrome.tabs.sendMessage.mockClear();
    });

    afterEach(() => {
        service.destroy();
    });

    function removalMessage(overrides = {}) {
        return buildSidePanelSelectionRemovalRequestMessage({
            binding,
            requestId: 1,
            selectionOwnerGeneration: 1,
            selectionRevision: 1,
            renderRevision: 4,
            wordIndex: 1,
            ...overrides,
        });
    }

    test('acknowledges removal only after the authoritative successor arrives', async () => {
        chrome.tabs.sendMessage.mockImplementation(async (_tabId, message) => {
            const command =
                parseSidePanelSelectionRemovalCommandMessage(message);
            if (!command) return { success: true };
            expect(
                service.acceptSelectionSnapshot(
                    createIdentity(),
                    createSnapshot({
                        selectionRevision: 2,
                        reason: 'remove',
                        entries: Object.freeze([
                            Object.freeze({
                                wordIndex: 3,
                                word: 'good',
                            }),
                        ]),
                    })
                )
            ).toBe(true);
            return { success: true };
        });

        const request = removalMessage();
        port.emit(request);
        await flushAsync();

        expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
            7,
            {
                action: MessageActions.SIDEPANEL_UPDATE_STATE,
                data: {
                    requestId: 1,
                    lifecycleGeneration: 1,
                    selectionRevision: 1,
                    renderRevision: 4,
                    wordIndex: 1,
                },
            },
            { documentId: 'document-7-a', frameId: 0 }
        );
        expect(
            messagesFor(port, MessageActions.SIDEPANEL_SELECTION_SYNC)
        ).toHaveLength(1);
        const resultMessages = messagesFor(
            port,
            MessageActions.SIDEPANEL_UPDATE_STATE
        );
        expect(resultMessages).toHaveLength(1);
        expect(
            parseSidePanelSelectionRemovalResultMessage(
                resultMessages[0],
                request.data
            )
        ).toEqual({
            binding,
            requestId: 1,
            selectionOwnerGeneration: 1,
            status: 'applied',
        });
        expect(port.postMessage.mock.invocationCallOrder[0]).toBeLessThan(
            port.postMessage.mock.invocationCallOrder[1]
        );
    });

    test.each([
        ['content rejection', async () => ({ success: false })],
        ['missing successor', async () => ({ success: true })],
        [
            'delivery failure',
            async () => {
                throw new Error('content unavailable');
            },
        ],
    ])('returns a fixed rejection for %s', async (_name, sendMessage) => {
        chrome.tabs.sendMessage.mockImplementation(sendMessage);
        const request = removalMessage();

        port.emit(request);
        await flushAsync();

        const result = messagesFor(port, MessageActions.SIDEPANEL_UPDATE_STATE);
        expect(result).toHaveLength(1);
        expect(
            parseSidePanelSelectionRemovalResultMessage(result[0], request.data)
                ?.status
        ).toBe('rejected');
    });

    test('rejects a stale selection request without contacting content', async () => {
        const request = removalMessage({ selectionRevision: 2 });

        port.emit(request);
        await flushAsync();

        expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
        expect(
            parseSidePanelSelectionRemovalResultMessage(
                messagesFor(port, MessageActions.SIDEPANEL_UPDATE_STATE)[0],
                request.data
            )?.status
        ).toBe('rejected');
    });

    test('does not publish a terminal result after disconnect', async () => {
        const pending = deferred();
        chrome.tabs.sendMessage.mockImplementation(() => pending.promise);
        port.emit(removalMessage());
        await flushAsync();
        expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1);

        port.emitDisconnect();
        pending.resolve({ success: true });
        await flushAsync();

        expect(port.postMessage).not.toHaveBeenCalled();
    });

    test('rejects a second distinct removal while one is pending', async () => {
        const pending = deferred();
        chrome.tabs.sendMessage.mockImplementation(() => pending.promise);
        port.emit(removalMessage());
        await flushAsync();

        const second = removalMessage({ requestId: 2, wordIndex: 3 });
        port.emit(second);
        await flushAsync();

        const interim = messagesFor(
            port,
            MessageActions.SIDEPANEL_UPDATE_STATE
        );
        expect(interim).toHaveLength(1);
        expect(
            parseSidePanelSelectionRemovalResultMessage(interim[0], second.data)
                ?.status
        ).toBe('rejected');

        pending.resolve({ success: false });
        await flushAsync();
        expect(
            messagesFor(port, MessageActions.SIDEPANEL_UPDATE_STATE)
        ).toHaveLength(2);
    });
});

describe('SidePanelService browser behavior', () => {
    let events;
    let service;

    beforeEach(() => {
        events = setupChrome();
        service = new SidePanelService();
    });

    afterEach(() => {
        service.destroy();
    });

    test('initializes from config and unsubscribes on destroy', async () => {
        const unsubscribe = jest.fn();
        jest.spyOn(configService, 'getMultiple').mockResolvedValue({
            sidePanelUseSidePanel: true,
            sidePanelAutoOpen: false,
            sidePanelAutoPauseVideo: false,
        });
        jest.spyOn(configService, 'onChanged').mockReturnValue(unsubscribe);

        await service.initialize();
        expect(configService.getMultiple).toHaveBeenCalledWith([
            'sidePanelUseSidePanel',
            'sidePanelAutoOpen',
            'sidePanelAutoPauseVideo',
        ]);

        service.destroy();
        expect(unsubscribe).toHaveBeenCalledTimes(1);
        expect(events.onConnect.removeListener).toHaveBeenCalledTimes(1);
    });

    test('opens, force-binds the same window, and reports pause outcome', async () => {
        const port = createPort();
        await connectAndBind(service, events, port, {
            registrationId: 90,
            tabId: 7,
            windowId: 1,
        });
        port.postMessage.mockClear();
        chrome.tabs.get.mockResolvedValue({ active: true, id: 8, windowId: 1 });
        chrome.tabs.sendMessage.mockResolvedValue({ success: true });
        service.applyBehaviorConfig({
            sidePanelUseSidePanel: true,
            sidePanelAutoOpen: true,
            sidePanelAutoPauseVideo: true,
        });

        await expect(
            service.openSidePanelImmediate(8, { force: true })
        ).resolves.toEqual({
            success: true,
            pauseRequested: true,
            pauseSucceeded: true,
        });

        expect(chrome.sidePanel.open).toHaveBeenCalledWith({ tabId: 8 });
        expect(
            parseSidePanelForceBindTabMessage(port.postMessage.mock.calls[0][0])
        ).toEqual({ tabId: 8, windowId: 1 });
        expect(chrome.tabs.sendMessage).toHaveBeenLastCalledWith(8, {
            action: MessageActions.SIDEPANEL_PAUSE_VIDEO,
        });
    });

    test('retains the route when auto-open is disabled', async () => {
        service.applyBehaviorConfig({
            sidePanelUseSidePanel: true,
            sidePanelAutoOpen: false,
            sidePanelAutoPauseVideo: false,
        });

        await expect(service.openSidePanelImmediate(7)).resolves.toEqual({
            success: true,
            pauseRequested: false,
            pauseSucceeded: null,
        });
        expect(chrome.sidePanel.open).not.toHaveBeenCalled();
        expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    });

    test.each([
        [
            'disabled',
            { sidePanelUseSidePanel: false, sidePanelAutoOpen: true },
            { success: false, reason: 'disabled' },
        ],
        [
            'missing API',
            { sidePanelUseSidePanel: true, sidePanelAutoOpen: true },
            { success: false, reason: 'api-unavailable' },
        ],
    ])(
        'returns a stable failure when %s',
        async (scenario, config, expected) => {
            service.applyBehaviorConfig(config);
            if (scenario === 'missing API') delete chrome.sidePanel;

            await expect(service.openSidePanelImmediate(7)).resolves.toEqual(
                expected
            );
        }
    );

    test('does not expose a browser error when opening fails', async () => {
        chrome.sidePanel.open.mockRejectedValue(
            new Error('private browser failure details')
        );
        service.applyBehaviorConfig({
            sidePanelUseSidePanel: true,
            sidePanelAutoOpen: true,
        });

        await expect(service.openSidePanelImmediate(7)).resolves.toEqual({
            success: false,
            reason: 'open-failed',
        });
    });

    test('pauseVideo accepts only the canonical control response', async () => {
        chrome.tabs.sendMessage
            .mockResolvedValueOnce({ success: true })
            .mockResolvedValueOnce({ success: true, extra: 'not canonical' })
            .mockRejectedValueOnce(new Error('unavailable'));

        await expect(service.pauseVideo(7)).resolves.toBe(true);
        await expect(service.pauseVideo(7)).resolves.toBe(false);
        await expect(service.pauseVideo(7)).resolves.toBe(false);
    });

    test('reports Side Panel API support without initializing', () => {
        expect(service.isSidePanelSupported()).toBe(true);
        delete chrome.sidePanel;
        expect(service.isSidePanelSupported()).toBe(false);
    });
});
