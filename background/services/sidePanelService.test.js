import { jest } from '@jest/globals';
import { SidePanelService } from './sidePanelService.js';
import { BackgroundServiceReadiness } from '../serviceReadiness.js';
import { configService } from '../../services/configService.js';
import { MessageActions } from '../../content_scripts/shared/constants/messageActions.js';
import {
    MessageSenderRoles,
    buildSidePanelForceBindTabMessage,
    buildSidePanelSelectionRemovalCommandResponse,
    buildSidePanelSelectionRemovalRequestMessage,
    parseSidePanelSelectionRemovalCommandMessage,
    parseSidePanelSelectionRemovalResultMessage,
    parseSidePanelSelectionStateMessage,
    parseSidePanelForceBindTabMessage,
} from '../../content_scripts/shared/protocol/messageProtocol.js';

const EXTENSION_ID = 'dualsub-test-extension';
const EXTENSION_ORIGIN = `chrome-extension://${EXTENSION_ID}`;
const SIDE_PANEL_URL = `${EXTENSION_ORIGIN}/sidepanel/sidepanel.html`;
let nextTestRegistrationId = 100;

function createChromeEvent() {
    const listeners = [];
    return {
        addListener: jest.fn((listener) => listeners.push(listener)),
        removeListener: jest.fn((listener) => {
            const index = listeners.indexOf(listener);
            if (index >= 0) listeners.splice(index, 1);
        }),
        emit: (...args) => listeners.forEach((listener) => listener(...args)),
        listeners,
    };
}

function createPort(senderOverrides = { origin: EXTENSION_ORIGIN }) {
    const onMessage = createChromeEvent();
    const emitRawMessage = onMessage.emit;
    onMessage.emitRaw = emitRawMessage;
    onMessage.emit = (message) => {
        if (
            message?.action === MessageActions.SIDEPANEL_REGISTER &&
            message?.data &&
            typeof message.data === 'object' &&
            !Object.prototype.hasOwnProperty.call(
                message.data,
                'registrationId'
            )
        ) {
            const descriptors = Object.getOwnPropertyDescriptors(message.data);
            descriptors.registrationId = {
                configurable: true,
                enumerable: true,
                value: ++nextTestRegistrationId,
                writable: true,
            };
            message = {
                ...message,
                data: Object.create(
                    Object.getPrototypeOf(message.data),
                    descriptors
                ),
            };
        }
        if (message?.action === MessageActions.SIDEPANEL_REGISTER) {
            message = {
                source: 'sidepanel',
                timestamp: 1,
                ...message,
            };
        }
        emitRawMessage(message);
    };
    const onDisconnect = createChromeEvent();
    const port = {
        name: 'sidepanel',
        sender: {
            id: EXTENSION_ID,
            origin: EXTENSION_ORIGIN,
            url: SIDE_PANEL_URL,
            ...senderOverrides,
        },
        onMessage,
        onDisconnect,
        disconnect: jest.fn(),
        postMessage: jest.fn(),
    };
    if (senderOverrides.origin === undefined) {
        delete port.sender.origin;
    }
    return port;
}

function emitRawRegistration(port, data, timestamp = 1) {
    port.onMessage.emitRaw({
        action: MessageActions.SIDEPANEL_REGISTER,
        data,
        source: 'sidepanel',
        timestamp,
    });
}

function setupConnectionChrome({
    getTab = async (tabId) => ({ active: true, id: tabId, windowId: 1 }),
    sendMessage = async () => ({ success: true, selectedWords: [] }),
} = {}) {
    const onConnect = createChromeEvent();
    global.chrome = {
        runtime: {
            id: EXTENSION_ID,
            getURL: jest.fn((path = '') => `${EXTENSION_ORIGIN}/${path}`),
            onConnect,
        },
        tabs: {
            get: jest.fn(getTab),
            onActivated: createChromeEvent(),
            onRemoved: createChromeEvent(),
            onUpdated: createChromeEvent(),
            sendMessage: jest.fn(sendMessage),
        },
    };
    return onConnect;
}

async function flushPortMessages() {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
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

function bindAuthorizedPortForTest(service, port, tabId, windowId) {
    service.connectedPorts.add(port);
    const authority = service.recordWindowActivation({ tabId, windowId });
    if (!authority) throw new Error('Invalid test activation authority');
    const claim = service.recordRegistrationClaim(
        port,
        { registrationId: ++nextTestRegistrationId, tabId, windowId },
        service.nextAuthorizationEpoch()
    );
    if (!service.bindPort(port, claim)) {
        throw new Error('Failed to bind authorized test port');
    }
    service.bindingByPort.get(port).confirmed = true;
    return claim;
}

function createContentIdentity(overrides = {}) {
    return Object.freeze({
        role: MessageSenderRoles.CONTENT,
        tabId: 7,
        windowId: 1,
        frameId: 0,
        documentId: 'content-document-1',
        documentLifecycle: 'active',
        ...overrides,
    });
}

function createSelectionSnapshot(overrides = {}) {
    return Object.freeze({
        lifecycleGeneration: 1,
        selectionRevision: 1,
        renderRevision: 1,
        reason: 'add',
        entries: Object.freeze([
            Object.freeze({ wordIndex: 2, word: 'very' }),
            Object.freeze({ wordIndex: 5, word: 'very' }),
        ]),
        ...overrides,
    });
}

function createBoundRemovalHarness() {
    setupConnectionChrome();
    const service = new SidePanelService();
    const port = createPort();
    service.handleSidePanelConnection(port);
    const claim = bindAuthorizedPortForTest(service, port, 7, 1);
    const identity = createContentIdentity();
    const snapshot = createSelectionSnapshot();
    expect(service.acceptSelectionSnapshot(identity, snapshot)).toBe(true);
    port.postMessage.mockClear();
    chrome.tabs.sendMessage.mockClear();

    const owner = service.selectionOwnersByTab.get(7);
    const removal = Object.freeze({
        binding: Object.freeze({
            registrationId: claim.registrationId,
            tabId: 7,
            windowId: 1,
        }),
        requestId: 41,
        selectionOwnerGeneration: owner.selectionOwnerGeneration,
        selectionRevision: owner.selectionRevision,
        renderRevision: owner.renderRevision,
        wordIndex: 2,
    });
    return { identity, owner, port, removal, service, snapshot };
}

describe('SidePanelService connection ownership', () => {
    test('rejects a forged content-script port before it can disclose another tab state', async () => {
        const onConnect = createChromeEvent();
        global.chrome = {
            runtime: {
                id: EXTENSION_ID,
                getURL: jest.fn((path = '') => `${EXTENSION_ORIGIN}/${path}`),
                onConnect,
            },
            tabs: {
                get: jest.fn(),
                onActivated: createChromeEvent(),
                onRemoved: createChromeEvent(),
                sendMessage: jest.fn(),
            },
        };
        const service = new SidePanelService();
        service.registerListeners();
        const forgedPort = createPort();
        forgedPort.sender = {
            id: chrome.runtime.id,
            origin: 'https://victim.example',
            tab: { active: true, id: 7, windowId: 1 },
            url: 'https://victim.example/watch',
        };

        onConnect.emit(forgedPort);
        forgedPort.onMessage.emit({
            action: MessageActions.SIDEPANEL_GET_STATE,
            data: { tabId: 7, windowId: 1 },
        });
        await Promise.resolve();
        await Promise.resolve();

        expect(forgedPort.disconnect).toHaveBeenCalledTimes(1);
        expect(forgedPort.onMessage.listeners).toHaveLength(0);
        expect(forgedPort.onDisconnect.listeners).toHaveLength(0);
        expect(forgedPort.postMessage).not.toHaveBeenCalled();
        expect(service.bindingByPort).toHaveProperty('size', 0);
        expect(service.activeConnections).toHaveProperty('size', 0);
        expect(service.activeConnectionsByWindow).toHaveProperty('size', 0);
        expect(chrome.tabs.get).not.toHaveBeenCalled();
        expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    });

    test.each([
        ['wrong name', { name: 'popup' }],
        ['missing name', { name: undefined }],
        ['wrong extension id', { sender: { id: 'other-extension' } }],
        ['missing extension id', { sender: { id: undefined } }],
        ['wrong URL', { sender: { url: `${EXTENSION_ORIGIN}/popup.html` } }],
        ['missing URL', { sender: { url: undefined } }],
        [
            'popup URL',
            { sender: { url: `${EXTENSION_ORIGIN}/popup/popup.html` } },
        ],
        [
            'options URL',
            { sender: { url: `${EXTENSION_ORIGIN}/options/options.html` } },
        ],
        ['wrong origin', { sender: { origin: 'https://attacker.example' } }],
        ['content-script sender', { sender: { tab: { id: 7, windowId: 1 } } }],
    ])('rejects a side-panel port with %s', (_label, overrides) => {
        const onConnect = setupConnectionChrome();
        const service = new SidePanelService();
        service.registerListeners();
        const port = createPort({ origin: EXTENSION_ORIGIN });
        if (Object.prototype.hasOwnProperty.call(overrides, 'name')) {
            port.name = overrides.name;
        }
        Object.assign(port.sender, overrides.sender);

        onConnect.emit(port);

        expect(port.disconnect).toHaveBeenCalledTimes(1);
        expect(port.onMessage.listeners).toHaveLength(0);
        expect(port.onDisconnect.listeners).toHaveLength(0);
        expect(service.bindingByPort).toHaveProperty('size', 0);
        expect(service.activeConnections).toHaveProperty('size', 0);
        expect(service.activeConnectionsByWindow).toHaveProperty('size', 0);
        expect(chrome.tabs.get).not.toHaveBeenCalled();
        expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    });

    test.each([
        [
            'origin and document ID',
            { documentId: 'document-1', origin: EXTENSION_ORIGIN },
        ],
        ['origin without document ID', { origin: EXTENSION_ORIGIN }],
        ['document ID without origin', { documentId: 'document-1' }],
        ['neither optional field', {}],
        ['a frame ID', { frameId: 0, origin: EXTENSION_ORIGIN }],
        ['an explicit null tab', { origin: EXTENSION_ORIGIN, tab: null }],
    ])('accepts the exact side-panel sender with %s', (_label, sender) => {
        const onConnect = setupConnectionChrome();
        const service = new SidePanelService();
        service.registerListeners();
        const port = createPort(sender);

        onConnect.emit(port);

        expect(port.disconnect).not.toHaveBeenCalled();
        expect(port.onMessage.listeners).toHaveLength(1);
        expect(port.onDisconnect.listeners).toHaveLength(1);
        expect(service.bindingByPort).toHaveProperty('size', 0);
        expect(service.activeConnections).toHaveProperty('size', 0);
        expect(service.activeConnectionsByWindow).toHaveProperty('size', 0);
        expect(chrome.tabs.get).not.toHaveBeenCalled();
        expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    });

    test('rejects a registration envelope with an extra key before any authority transition', async () => {
        const onConnect = setupConnectionChrome();
        const service = new SidePanelService();
        service.registerListeners();
        const port = createPort();
        onConnect.emit(port);

        port.onMessage.emitRaw({
            action: MessageActions.SIDEPANEL_REGISTER,
            data: { registrationId: 40, tabId: 7, windowId: 1 },
            extra: true,
            source: 'sidepanel',
            timestamp: 41,
        });
        await flushPortMessages();

        expect(port.disconnect).toHaveBeenCalledTimes(1);
        expect(chrome.tabs.get).not.toHaveBeenCalled();
        expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
        expect(port.postMessage).not.toHaveBeenCalled();
        expect(service.bindingByPort).toHaveProperty('size', 0);
        expect(service.registrationClaimsByTab).toHaveProperty('size', 0);
        expect(service.registrationClaimByPort).toHaveProperty('size', 0);
    });

    test('rejects an inactive tab registration without disclosing state', async () => {
        const onConnect = setupConnectionChrome({
            getTab: async () => ({ active: false, id: 7, windowId: 1 }),
        });
        const service = new SidePanelService();
        service.registerListeners();
        const port = createPort({ origin: EXTENSION_ORIGIN });
        onConnect.emit(port);

        port.onMessage.emit({
            action: MessageActions.SIDEPANEL_REGISTER,
            data: { registrationId: 41, tabId: 7, windowId: 1 },
        });
        await flushPortMessages();

        expect(chrome.tabs.get).toHaveBeenCalledWith(7);
        expect(port.disconnect).toHaveBeenCalledTimes(1);
        expect(port.postMessage).not.toHaveBeenCalled();
        expect(service.activeConnections).toHaveProperty('size', 0);
        expect(service.activeConnectionsByWindow).toHaveProperty('size', 0);
        expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    });

    test('binds only after verifying the active tab and then publishes a bound null state', async () => {
        const onConnect = setupConnectionChrome();
        const service = new SidePanelService();
        service.registerListeners();
        const port = createPort();
        onConnect.emit(port);

        expect(port.sender.tab).toBeUndefined();
        expect(service.activeConnections).toHaveProperty('size', 0);
        port.onMessage.emit({
            action: MessageActions.SIDEPANEL_REGISTER,
            data: { registrationId: 41, tabId: 7, windowId: 1 },
        });
        await flushPortMessages();

        expect(chrome.tabs.get).toHaveBeenCalledWith(7);
        expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
            7,
            {
                action: MessageActions.SIDEPANEL_GET_STATE,
                data: { requestId: 1 },
            },
            { frameId: 0 }
        );
        expect(service.bindingByPort.get(port)).toMatchObject({
            registrationId: 41,
            tabId: 7,
            windowId: 1,
        });
        expect(service.activeConnections.get(7)).toBe(port);
        expect(service.activeConnectionsByWindow.get(1)).toEqual(
            new Set([port])
        );
        expect(port.postMessage).toHaveBeenNthCalledWith(1, {
            action: MessageActions.SIDEPANEL_BINDING_CONFIRMED,
            data: { registrationId: 41, tabId: 7, windowId: 1 },
        });
        expect(port.postMessage).toHaveBeenNthCalledWith(2, {
            action: MessageActions.SIDEPANEL_SELECTION_SYNC,
            data: {
                binding: { registrationId: 41, tabId: 7, windowId: 1 },
                selection: null,
            },
        });
        expect(chrome.tabs.get.mock.invocationCallOrder[0]).toBeLessThan(
            port.postMessage.mock.invocationCallOrder[0]
        );
        expect(port.postMessage.mock.invocationCallOrder[0]).toBeLessThan(
            port.postMessage.mock.invocationCallOrder[1]
        );
    });

    test('confirms before synchronizing an exact bound null selection', async () => {
        const onConnect = setupConnectionChrome();
        const service = new SidePanelService();
        service.registerListeners();
        const port = createPort();
        onConnect.emit(port);

        emitRawRegistration(port, {
            registrationId: 42,
            tabId: 7,
            windowId: 1,
        });
        await flushPortMessages();

        expect(port.postMessage).toHaveBeenNthCalledWith(1, {
            action: MessageActions.SIDEPANEL_BINDING_CONFIRMED,
            data: { registrationId: 42, tabId: 7, windowId: 1 },
        });
        expect(port.postMessage).toHaveBeenNthCalledWith(2, {
            action: MessageActions.SIDEPANEL_SELECTION_SYNC,
            data: {
                binding: { registrationId: 42, tabId: 7, windowId: 1 },
                selection: null,
            },
        });
        expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
            7,
            {
                action: MessageActions.SIDEPANEL_GET_STATE,
                data: { requestId: 1 },
            },
            { frameId: 0 }
        );
        expect(service.selectionOwnersByTab).toHaveProperty('size', 0);
        expect(service.selectionOwnerGeneration).toBe(0);
        expect(service.bindingByPort.get(port)).toMatchObject({
            confirmed: true,
            registrationId: 42,
        });
    });

    test.each([
        ['missing', { tabId: 7, windowId: 1 }],
        ['zero', { registrationId: 0, tabId: 7, windowId: 1 }],
        ['negative', { registrationId: -1, tabId: 7, windowId: 1 }],
        ['fractional', { registrationId: 1.5, tabId: 7, windowId: 1 }],
        [
            'unsafe',
            {
                registrationId: Number.MAX_SAFE_INTEGER + 1,
                tabId: 7,
                windowId: 1,
            },
        ],
        ['non-numeric', { registrationId: '1', tabId: 7, windowId: 1 }],
    ])(
        'rejects a registration with a %s registration ID',
        async (_label, data) => {
            const onConnect = setupConnectionChrome();
            const service = new SidePanelService();
            service.registerListeners();
            const port = createPort();
            onConnect.emit(port);

            emitRawRegistration(port, data);
            await flushPortMessages();

            expect(port.disconnect).toHaveBeenCalledTimes(1);
            expect(chrome.tabs.get).not.toHaveBeenCalled();
            expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
            expect(port.postMessage).not.toHaveBeenCalled();
            expect(service.bindingByPort).toHaveProperty('size', 0);
            expect(service.registrationClaimsByTab).toHaveProperty('size', 0);
            expect(service.registrationClaimByPort).toHaveProperty('size', 0);
        }
    );

    test('rejects hostile registration fields without invoking accessors', async () => {
        const onConnect = setupConnectionChrome();
        const service = new SidePanelService();
        service.registerListeners();
        const port = createPort();
        onConnect.emit(port);
        let registrationIdAccessCount = 0;
        const data = { tabId: 7, windowId: 1 };
        Object.defineProperty(data, 'registrationId', {
            enumerable: true,
            get() {
                registrationIdAccessCount++;
                throw new Error('hostile registration getter ran');
            },
        });

        emitRawRegistration(port, data);
        await flushPortMessages();

        expect(registrationIdAccessCount).toBe(0);
        expect(port.disconnect).toHaveBeenCalledTimes(1);
        expect(chrome.tabs.get).not.toHaveBeenCalled();
        expect(service.bindingByPort).toHaveProperty('size', 0);
    });

    test('preserves listener receipt order for back-to-back valid registrations', async () => {
        const onConnect = setupConnectionChrome();
        const service = new SidePanelService();
        service.registerListeners();
        const port = createPort();
        onConnect.emit(port);

        emitRawRegistration(port, {
            registrationId: 81,
            tabId: 7,
            windowId: 1,
        });
        emitRawRegistration(port, {
            registrationId: 82,
            tabId: 7,
            windowId: 1,
        });
        await flushPortMessages();
        await flushPortMessages();

        expect(service.bindingByPort.get(port)).toMatchObject({
            confirmed: true,
            registrationId: 82,
            tabId: 7,
            windowId: 1,
        });
        expect(service.registrationClaimByPort.get(port)).toMatchObject({
            registrationId: 82,
            tabId: 7,
        });
        expect(
            port.postMessage.mock.calls
                .map(([message]) => message)
                .filter(
                    (message) =>
                        message.action ===
                        MessageActions.SIDEPANEL_BINDING_CONFIRMED
                )
                .map((message) => message.data.registrationId)
        ).toEqual([82]);
        expect(port.postMessage).toHaveBeenLastCalledWith({
            action: MessageActions.SIDEPANEL_SELECTION_SYNC,
            data: {
                binding: { registrationId: 82, tabId: 7, windowId: 1 },
                selection: null,
            },
        });
    });

    test('does not disclose state to a nested registration behind an invalid receipt', async () => {
        const onConnect = setupConnectionChrome();
        const service = new SidePanelService();
        service.registerListeners();
        const port = createPort();
        onConnect.emit(port);
        const invalidOuterRegistration = new Proxy(
            {
                registrationId: 91,
                tabId: 7,
                unexpected: true,
                windowId: 1,
            },
            {
                getPrototypeOf(target) {
                    emitRawRegistration(port, {
                        registrationId: 92,
                        tabId: 7,
                        windowId: 1,
                    });
                    return Reflect.getPrototypeOf(target);
                },
            }
        );

        emitRawRegistration(port, invalidOuterRegistration);
        await flushPortMessages();
        await flushPortMessages();

        expect(port.disconnect).toHaveBeenCalledTimes(1);
        expect(port.postMessage).not.toHaveBeenCalled();
        expect(service.bindingByPort).toHaveProperty('size', 0);
        expect(service.activeConnections).toHaveProperty('size', 0);
        expect(service.registrationClaimsByTab).toHaveProperty('size', 0);
        expect(service.registrationClaimByPort).toHaveProperty('size', 0);
    });

    test('a proxied receipt cannot retain or reclaim same-port authority during reflection', async () => {
        const onConnect = setupConnectionChrome({
            getTab: async (tabId) => ({
                active: true,
                id: tabId,
                windowId: tabId === 7 ? 1 : 2,
            }),
        });
        const service = new SidePanelService();
        service.registerListeners();
        const reentrantPort = createPort();
        const competingPort = createPort();
        onConnect.emit(reentrantPort);
        onConnect.emit(competingPort);
        let prototypeChecks = 0;
        const staleOuterRegistration = new Proxy(
            { registrationId: 101, tabId: 7, windowId: 1 },
            {
                getPrototypeOf(target) {
                    prototypeChecks++;
                    emitRawRegistration(competingPort, {
                        registrationId: 201,
                        tabId: 7,
                        windowId: 1,
                    });
                    emitRawRegistration(reentrantPort, {
                        registrationId: 102,
                        tabId: 8,
                        windowId: 2,
                    });
                    return Reflect.getPrototypeOf(target);
                },
            }
        );

        emitRawRegistration(reentrantPort, staleOuterRegistration);
        await flushPortMessages();
        await flushPortMessages();

        expect(prototypeChecks).toBe(1);
        expect(reentrantPort.disconnect).toHaveBeenCalledTimes(1);
        expect(competingPort.disconnect).not.toHaveBeenCalled();
        expect(service.bindingByPort.has(reentrantPort)).toBe(false);
        expect(service.registrationClaimByPort.has(reentrantPort)).toBe(false);
        expect(service.registrationClaimsByTab.has(8)).toBe(false);
        expect(reentrantPort.postMessage).not.toHaveBeenCalled();
        expect(service.bindingByPort.get(competingPort)).toMatchObject({
            confirmed: true,
            registrationId: 201,
            tabId: 7,
            windowId: 1,
        });
        expect(
            competingPort.postMessage.mock.calls
                .map(([message]) => message)
                .filter(
                    (message) =>
                        message.action ===
                        MessageActions.SIDEPANEL_BINDING_CONFIRMED
                )
                .map((message) => message.data.registrationId)
        ).toEqual([201]);
    });

    test('a reentrant registration survives an older bound-null post failure', async () => {
        const onConnect = setupConnectionChrome();
        const service = new SidePanelService();
        service.registerListeners();
        const port = createPort();
        onConnect.emit(port);
        let injectedReplacement = false;
        port.postMessage.mockImplementation((message) => {
            if (
                !injectedReplacement &&
                message.action === MessageActions.SIDEPANEL_SELECTION_SYNC
            ) {
                injectedReplacement = true;
                emitRawRegistration(port, {
                    registrationId: 52,
                    tabId: 7,
                    windowId: 1,
                });
                throw new Error('old selection sync failed');
            }
        });

        emitRawRegistration(port, {
            registrationId: 51,
            tabId: 7,
            windowId: 1,
        });
        await flushPortMessages();
        await flushPortMessages();

        expect(service.bindingByPort.get(port)).toMatchObject({
            confirmed: true,
            registrationId: 52,
            tabId: 7,
            windowId: 1,
        });
        expect(service.registrationClaimByPort.get(port)).toMatchObject({
            registrationId: 52,
            tabId: 7,
        });
        expect(port.disconnect).not.toHaveBeenCalled();
        expect(port.postMessage).toHaveBeenLastCalledWith({
            action: MessageActions.SIDEPANEL_SELECTION_SYNC,
            data: {
                binding: { registrationId: 52, tabId: 7, windowId: 1 },
                selection: null,
            },
        });
    });

    test('a reentrant registration survives an older acknowledgement post failure', async () => {
        const onConnect = setupConnectionChrome();
        const service = new SidePanelService();
        service.registerListeners();
        const port = createPort();
        onConnect.emit(port);
        let injectedReplacement = false;
        port.postMessage.mockImplementation((message) => {
            if (
                !injectedReplacement &&
                message.action === MessageActions.SIDEPANEL_BINDING_CONFIRMED
            ) {
                injectedReplacement = true;
                emitRawRegistration(port, {
                    registrationId: 62,
                    tabId: 7,
                    windowId: 1,
                });
                throw new Error('old acknowledgement failed');
            }
        });

        emitRawRegistration(port, {
            registrationId: 61,
            tabId: 7,
            windowId: 1,
        });
        await flushPortMessages();
        await flushPortMessages();

        expect(service.bindingByPort.get(port)).toMatchObject({
            confirmed: true,
            registrationId: 62,
            tabId: 7,
            windowId: 1,
        });
        expect(service.registrationClaimByPort.get(port)).toMatchObject({
            registrationId: 62,
            tabId: 7,
        });
        expect(port.disconnect).not.toHaveBeenCalled();
        expect(port.postMessage).toHaveBeenLastCalledWith({
            action: MessageActions.SIDEPANEL_SELECTION_SYNC,
            data: {
                binding: { registrationId: 62, tabId: 7, windowId: 1 },
                selection: null,
            },
        });
    });

    test.each([
        ['selection synchronization', MessageActions.SIDEPANEL_SELECTION_SYNC],
        ['binding acknowledgement', MessageActions.SIDEPANEL_BINDING_CONFIRMED],
    ])(
        'cleans the exact registration when %s posting fails',
        async (_label, failingAction) => {
            const onConnect = setupConnectionChrome();
            const service = new SidePanelService();
            service.registerListeners();
            const port = createPort();
            onConnect.emit(port);
            port.postMessage.mockImplementation((message) => {
                if (message.action === failingAction) {
                    throw new Error('post failed');
                }
            });

            emitRawRegistration(port, {
                registrationId: 71,
                tabId: 7,
                windowId: 1,
            });
            await flushPortMessages();
            await flushPortMessages();

            expect(service.bindingByPort).toHaveProperty('size', 0);
            expect(service.activeConnections).toHaveProperty('size', 0);
            expect(service.activeConnectionsByWindow).toHaveProperty('size', 0);
            expect(service.registrationClaimsByTab).toHaveProperty('size', 0);
            expect(service.registrationClaimByPort).toHaveProperty('size', 0);
            if (failingAction === MessageActions.SIDEPANEL_SELECTION_SYNC) {
                expect(port.disconnect).toHaveBeenCalledTimes(1);
            } else {
                expect(port.disconnect).not.toHaveBeenCalled();
            }
        }
    );

    test('disconnects a valid but unregistered panel that sends another action', async () => {
        const onConnect = setupConnectionChrome();
        const service = new SidePanelService();
        service.registerListeners();
        const port = createPort({ origin: EXTENSION_ORIGIN });
        onConnect.emit(port);

        port.onMessage.emit({
            action: MessageActions.SIDEPANEL_UPDATE_STATE,
            data: { selectedWords: ['attacker-change'] },
        });
        await flushPortMessages();

        expect(port.disconnect).toHaveBeenCalledTimes(1);
        expect(service.bindingByPort).toHaveProperty('size', 0);
        expect(service.activeConnections).toHaveProperty('size', 0);
        expect(service.activeConnectionsByWindow).toHaveProperty('size', 0);
        expect(chrome.tabs.get).not.toHaveBeenCalled();
        expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
        expect(port.postMessage).not.toHaveBeenCalled();
    });

    test.each([
        ['negative tab ID', { tabId: -1, windowId: 1 }],
        ['fractional tab ID', { tabId: 1.5, windowId: 1 }],
        ['unsafe tab ID', { tabId: Number.MAX_SAFE_INTEGER + 1, windowId: 1 }],
        ['missing tab ID', { windowId: 1 }],
        ['negative window ID', { tabId: 7, windowId: -1 }],
        ['fractional window ID', { tabId: 7, windowId: 1.5 }],
        [
            'unsafe window ID',
            { tabId: 7, windowId: Number.MAX_SAFE_INTEGER + 1 },
        ],
        ['missing window ID', { tabId: 7 }],
    ])('rejects a registration with a %s', async (_label, data) => {
        const onConnect = setupConnectionChrome();
        const service = new SidePanelService();
        service.registerListeners();
        const port = createPort();
        onConnect.emit(port);

        port.onMessage.emit({
            action: MessageActions.SIDEPANEL_REGISTER,
            data,
        });
        await flushPortMessages();

        expect(port.disconnect).toHaveBeenCalledTimes(1);
        expect(service.bindingByPort).toHaveProperty('size', 0);
        expect(service.activeConnections).toHaveProperty('size', 0);
        expect(service.activeConnectionsByWindow).toHaveProperty('size', 0);
        expect(chrome.tabs.get).not.toHaveBeenCalled();
        expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
        expect(port.postMessage).not.toHaveBeenCalled();
    });

    test.each([
        [
            'cross-window tab',
            async () => ({ active: true, id: 7, windowId: 2 }),
        ],
        [
            'mismatched tab ID',
            async () => ({ active: true, id: 8, windowId: 1 }),
        ],
        ['missing tab', async () => undefined],
        [
            'tabs.get failure',
            async () => {
                throw new Error('tab closed');
            },
        ],
    ])('fails closed for a %s', async (_label, getTab) => {
        const onConnect = setupConnectionChrome({ getTab });
        const service = new SidePanelService();
        service.registerListeners();
        const port = createPort();
        onConnect.emit(port);

        port.onMessage.emit({
            action: MessageActions.SIDEPANEL_REGISTER,
            data: { tabId: 7, windowId: 1 },
        });
        await flushPortMessages();

        expect(port.disconnect).toHaveBeenCalledTimes(1);
        expect(service.bindingByPort).toHaveProperty('size', 0);
        expect(service.activeConnections).toHaveProperty('size', 0);
        expect(service.activeConnectionsByWindow).toHaveProperty('size', 0);
        expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
        expect(port.postMessage).not.toHaveBeenCalled();
    });

    test('does not bind when the port disconnects during tab verification', async () => {
        const pendingTab = deferred();
        const onConnect = setupConnectionChrome({
            getTab: () => pendingTab.promise,
        });
        const service = new SidePanelService();
        service.registerListeners();
        const port = createPort();
        onConnect.emit(port);
        port.onMessage.emit({
            action: MessageActions.SIDEPANEL_REGISTER,
            data: { tabId: 7, windowId: 1 },
        });
        await Promise.resolve();
        await Promise.resolve();
        expect(chrome.tabs.get).toHaveBeenCalledWith(7);

        port.onDisconnect.emit();
        pendingTab.resolve({ active: true, id: 7, windowId: 1 });
        await pendingTab.promise;
        await flushPortMessages();
        await flushPortMessages();

        expect(service.bindingByPort).toHaveProperty('size', 0);
        expect(service.activeConnections).toHaveProperty('size', 0);
        expect(service.activeConnectionsByWindow).toHaveProperty('size', 0);
        expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
        expect(port.postMessage).not.toHaveBeenCalled();
    });

    test('does not disclose fetched state after disconnect during synchronization', async () => {
        const pendingState = deferred();
        const onConnect = setupConnectionChrome({
            sendMessage: () => pendingState.promise,
        });
        const service = new SidePanelService();
        expect(
            service.acceptSelectionSnapshot(
                createContentIdentity(),
                createSelectionSnapshot()
            )
        ).toBe(true);
        service.registerListeners();
        const port = createPort();
        onConnect.emit(port);
        port.onMessage.emit({
            action: MessageActions.SIDEPANEL_REGISTER,
            data: { tabId: 7, windowId: 1 },
        });
        await flushPortMessages();
        expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1);
        expect(service.activeConnections.get(7)).toBe(port);
        expect(port.postMessage).toHaveBeenCalledTimes(2);
        const request = chrome.tabs.sendMessage.mock.calls[0][1];

        port.onDisconnect.emit();
        pendingState.resolve({ requestId: request.data.requestId });
        await pendingState.promise;
        await flushPortMessages();

        expect(service.bindingByPort).toHaveProperty('size', 0);
        expect(service.activeConnections).toHaveProperty('size', 0);
        expect(service.activeConnectionsByWindow).toHaveProperty('size', 0);
        expect(service.registrationClaimsByTab).toHaveProperty('size', 0);
        expect(service.registrationClaimByPort).toHaveProperty('size', 0);
        expect(service.selectionOwnersByTab).toHaveProperty('size', 1);
        expect(port.postMessage).toHaveBeenCalledTimes(2);
    });

    test('does not let an older verification replace a newer tab owner', async () => {
        const pendingOldTab = deferred();
        let getCall = 0;
        const onConnect = setupConnectionChrome({
            getTab: () => {
                getCall += 1;
                return getCall === 1
                    ? pendingOldTab.promise
                    : Promise.resolve({ active: true, id: 7, windowId: 1 });
            },
        });
        const service = new SidePanelService();
        service.registerListeners();
        const oldPort = createPort();
        const currentPort = createPort();
        onConnect.emit(oldPort);
        oldPort.onMessage.emit({
            action: MessageActions.SIDEPANEL_REGISTER,
            data: { tabId: 7, windowId: 1 },
        });
        await Promise.resolve();
        await Promise.resolve();

        onConnect.emit(currentPort);
        currentPort.onMessage.emit({
            action: MessageActions.SIDEPANEL_REGISTER,
            data: { tabId: 7, windowId: 1 },
        });
        await flushPortMessages();
        expect(service.activeConnections.get(7)).toBe(currentPort);

        pendingOldTab.resolve({ active: true, id: 7, windowId: 1 });
        await pendingOldTab.promise;
        await flushPortMessages();
        await flushPortMessages();

        expect(oldPort.disconnect).toHaveBeenCalledTimes(1);
        expect(oldPort.postMessage).not.toHaveBeenCalled();
        expect(service.activeConnections.get(7)).toBe(currentPort);
        expect(service.bindingByPort.has(oldPort)).toBe(false);
        expect(service.bindingByPort.get(currentPort)).toMatchObject({
            tabId: 7,
            windowId: 1,
        });
    });

    test('keeps the newest same-tab claim when the older verification resolves first', async () => {
        const oldTab = deferred();
        const freshTab = deferred();
        let getCall = 0;
        const onConnect = setupConnectionChrome({
            getTab: () => {
                getCall += 1;
                return getCall === 1 ? oldTab.promise : freshTab.promise;
            },
        });
        const service = new SidePanelService();
        service.registerListeners();
        const oldPort = createPort();
        const freshPort = createPort();
        onConnect.emit(oldPort);
        onConnect.emit(freshPort);
        oldPort.onMessage.emit({
            action: MessageActions.SIDEPANEL_REGISTER,
            data: { tabId: 7, windowId: 1 },
        });
        await Promise.resolve();
        await Promise.resolve();
        expect(chrome.tabs.get).toHaveBeenCalledTimes(1);
        freshPort.onMessage.emit({
            action: MessageActions.SIDEPANEL_REGISTER,
            data: { tabId: 7, windowId: 1 },
        });
        await Promise.resolve();
        await Promise.resolve();
        expect(chrome.tabs.get).toHaveBeenCalledTimes(2);

        oldTab.resolve({ active: true, id: 7, windowId: 1 });
        await oldTab.promise;
        await flushPortMessages();

        expect(oldPort.postMessage).not.toHaveBeenCalled();
        expect(service.activeConnections.get(7)).not.toBe(oldPort);

        freshTab.resolve({ active: true, id: 7, windowId: 1 });
        await freshTab.promise;
        await flushPortMessages();
        await flushPortMessages();

        expect(oldPort.disconnect).toHaveBeenCalledTimes(1);
        expect(freshPort.disconnect).not.toHaveBeenCalled();
        expect(service.activeConnections.get(7)).toBe(freshPort);
        expect(service.bindingByPort.has(oldPort)).toBe(false);
        expect(service.bindingByPort.get(freshPort)).toMatchObject({
            tabId: 7,
            windowId: 1,
        });
        expect(freshPort.postMessage).toHaveBeenCalledWith({
            action: MessageActions.SIDEPANEL_SELECTION_SYNC,
            data: {
                binding: {
                    registrationId:
                        service.bindingByPort.get(freshPort).registrationId,
                    tabId: 7,
                    windowId: 1,
                },
                selection: null,
            },
        });
    });

    test('invalidates pending selection freshness as soon as activation arrives behind readiness', async () => {
        const pendingAck = deferred();
        const onConnect = setupConnectionChrome({
            sendMessage: () => pendingAck.promise,
        });
        const service = new SidePanelService();
        expect(
            service.acceptSelectionSnapshot(
                createContentIdentity(),
                createSelectionSnapshot()
            )
        ).toBe(true);
        service.registerListeners();
        const port = createPort();
        onConnect.emit(port);
        port.onMessage.emit({
            action: MessageActions.SIDEPANEL_REGISTER,
            data: { tabId: 7, windowId: 1 },
        });
        await flushPortMessages();

        expect(service.bindingByPort.get(port)).toMatchObject({
            activationEpoch: 0,
            tabId: 7,
            windowId: 1,
        });
        expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1);
        expect(port.postMessage).toHaveBeenCalledTimes(2);
        const request = chrome.tabs.sendMessage.mock.calls[0][1];

        const readiness = new BackgroundServiceReadiness();
        service.serviceReadiness = readiness;
        chrome.tabs.onActivated.emit({ tabId: 8, windowId: 1 });
        expect(service.activeTabAuthorityByWindow.get(1)).toMatchObject({
            tabId: 8,
            windowId: 1,
        });
        expect(service.selectionOwnersByTab.has(7)).toBe(false);

        pendingAck.resolve({ requestId: request.data.requestId });
        await pendingAck.promise;
        await flushPortMessages();

        expect(port.disconnect).toHaveBeenCalledTimes(1);
        expect(port.postMessage).toHaveBeenCalledTimes(2);
        expect(service.bindingByPort.has(port)).toBe(false);

        readiness.markReady();
        await flushPortMessages();
        expect(port.postMessage).toHaveBeenCalledTimes(2);
    });

    test('supersedes an epoch-zero registration when the first activation races tabs.get', async () => {
        const pendingTab = deferred();
        let tabGetCalls = 0;
        const onConnect = setupConnectionChrome({
            getTab: async (tabId) => {
                tabGetCalls += 1;
                if (tabGetCalls === 1) return pendingTab.promise;
                return {
                    active: tabId === 8,
                    id: tabId,
                    windowId: 1,
                };
            },
            sendMessage: async () => ({
                success: true,
                selectedWords: ['TAB8_CURRENT'],
            }),
        });
        const service = new SidePanelService();
        service.registerListeners();
        const port = createPort();
        onConnect.emit(port);
        port.onMessage.emit({
            action: MessageActions.SIDEPANEL_REGISTER,
            data: { tabId: 7, windowId: 1 },
        });
        await Promise.resolve();
        await Promise.resolve();
        expect(chrome.tabs.get).toHaveBeenCalledTimes(1);
        expect(service.activeTabAuthorityByWindow.has(1)).toBe(false);

        chrome.tabs.onActivated.emit({ tabId: 8, windowId: 1 });
        const firstActivation = service.activeTabAuthorityByWindow.get(1);
        expect(firstActivation).toMatchObject({ tabId: 8, windowId: 1 });
        expect(firstActivation.activationEpoch).toBeGreaterThan(0);

        pendingTab.resolve({ active: true, id: 7, windowId: 1 });
        await pendingTab.promise;
        await flushPortMessages();

        expect(port.disconnect).not.toHaveBeenCalled();
        expect(port.postMessage).not.toHaveBeenCalled();
        expect(service.bindingByPort.has(port)).toBe(false);
        expect(service.activeConnections.has(7)).toBe(false);
        expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();

        port.onMessage.emit({
            action: MessageActions.SIDEPANEL_REGISTER,
            data: { tabId: 8, windowId: 1 },
        });
        await flushPortMessages();

        expect(service.bindingByPort.get(port)).toMatchObject({
            activationEpoch: firstActivation.activationEpoch,
            tabId: 8,
            windowId: 1,
        });
        expect(port.postMessage).toHaveBeenCalledWith({
            action: MessageActions.SIDEPANEL_SELECTION_SYNC,
            data: {
                binding: {
                    registrationId:
                        service.bindingByPort.get(port).registrationId,
                    tabId: 8,
                    windowId: 1,
                },
                selection: null,
            },
        });
    });

    test('does not reauthorize a stale binding when activation switches away and back', async () => {
        let activeTabId = 7;
        const onConnect = setupConnectionChrome({
            getTab: async (tabId) => ({
                active: tabId === activeTabId,
                id: tabId,
                windowId: 1,
            }),
        });
        const service = new SidePanelService();
        service.registerListeners();
        const port = createPort();
        onConnect.emit(port);
        port.onMessage.emit({
            action: MessageActions.SIDEPANEL_REGISTER,
            data: { tabId: 7, windowId: 1 },
        });
        await flushPortMessages();
        const initialBinding = service.bindingByPort.get(port);
        expect(initialBinding.activationEpoch).toBe(0);

        port.postMessage.mockClear();
        activeTabId = 8;
        chrome.tabs.onActivated.emit({ tabId: 8, windowId: 1 });
        await flushPortMessages();
        const awayEpoch =
            service.activeTabAuthorityByWindow.get(1).activationEpoch;

        activeTabId = 7;
        chrome.tabs.onActivated.emit({ tabId: 7, windowId: 1 });
        await flushPortMessages();
        const returnEpoch =
            service.activeTabAuthorityByWindow.get(1).activationEpoch;
        expect(returnEpoch).toBeGreaterThan(awayEpoch);
        expect(returnEpoch).not.toBe(initialBinding.activationEpoch);

        expect(port.disconnect).not.toHaveBeenCalled();

        port.onMessage.emit({
            action: MessageActions.SIDEPANEL_REGISTER,
            data: { tabId: 7, windowId: 1 },
        });
        await flushPortMessages();
        expect(service.bindingByPort.get(port)).toMatchObject({
            activationEpoch: returnEpoch,
            tabId: 7,
            windowId: 1,
        });
        expect(port.postMessage).toHaveBeenCalledWith({
            action: MessageActions.SIDEPANEL_SELECTION_SYNC,
            data: {
                binding: {
                    registrationId:
                        service.bindingByPort.get(port).registrationId,
                    tabId: 7,
                    windowId: 1,
                },
                selection: null,
            },
        });
    });

    test('ignores invalid activation payloads without revoking current authority', async () => {
        const onConnect = setupConnectionChrome();
        const service = new SidePanelService();
        service.registerListeners();
        const port = createPort();
        onConnect.emit(port);
        port.onMessage.emit({
            action: MessageActions.SIDEPANEL_REGISTER,
            data: { tabId: 7, windowId: 1 },
        });
        await flushPortMessages();
        const initialAuthority = {
            ...service.activeTabAuthorityByWindow.get(1),
        };
        port.postMessage.mockClear();

        chrome.tabs.onActivated.emit({ tabId: -1, windowId: 1 });
        chrome.tabs.onActivated.emit({ tabId: 8, windowId: Number.NaN });
        chrome.tabs.onActivated.emit({ tabId: 8.5, windowId: 1 });
        chrome.tabs.onActivated.emit(null);
        await flushPortMessages();

        expect(service.activeTabAuthorityByWindow.get(1)).toEqual(
            initialAuthority
        );
        expect(port.postMessage).not.toHaveBeenCalled();

        expect(service.bindingByPort.get(port)).toMatchObject({
            tabId: 7,
            windowId: 1,
        });
    });

    test('tombstones a removed tab before readiness can release stale private state', async () => {
        const pendingState = deferred();
        const onConnect = setupConnectionChrome({
            sendMessage: () => pendingState.promise,
        });
        const service = new SidePanelService();
        expect(
            service.acceptSelectionSnapshot(
                createContentIdentity(),
                createSelectionSnapshot()
            )
        ).toBe(true);
        service.registerListeners();
        const port = createPort();
        onConnect.emit(port);
        port.onMessage.emit({
            action: MessageActions.SIDEPANEL_REGISTER,
            data: { tabId: 7, windowId: 1 },
        });
        await flushPortMessages();
        expect(service.bindingByPort.get(port)).toMatchObject({
            tabId: 7,
            windowId: 1,
        });
        expect(port.postMessage).toHaveBeenCalledTimes(2);
        const request = chrome.tabs.sendMessage.mock.calls[0][1];

        const readiness = new BackgroundServiceReadiness();
        service.serviceReadiness = readiness;
        chrome.tabs.onRemoved.emit(7);
        expect(service.selectionOwnersByTab.has(7)).toBe(false);
        pendingState.resolve({ requestId: request.data.requestId });
        await pendingState.promise;
        await flushPortMessages();

        expect(port.postMessage).toHaveBeenCalledTimes(2);
        expect(service.selectionOwnersByTab.has(7)).toBe(false);

        readiness.markReady();
        await flushPortMessages();
        expect(port.disconnect).toHaveBeenCalledTimes(1);
        expect(service.bindingByPort.has(port)).toBe(false);
        expect(service.activeConnections.has(7)).toBe(false);
    });

    test('delayed removal cleanup preserves a fresh port for a reused tab id', async () => {
        const onConnect = setupConnectionChrome({
            sendMessage: async () => ({
                success: true,
                selectedWords: ['REUSED_TAB_CURRENT'],
            }),
        });
        const service = new SidePanelService();
        service.registerListeners();
        const oldPort = createPort();
        onConnect.emit(oldPort);
        oldPort.onMessage.emit({
            action: MessageActions.SIDEPANEL_REGISTER,
            data: { tabId: 7, windowId: 1 },
        });
        await flushPortMessages();
        oldPort.postMessage.mockClear();

        const readiness = new BackgroundServiceReadiness();
        service.serviceReadiness = readiness;
        chrome.tabs.onRemoved.emit(7);
        const removalEpoch = service.tabLifecycleEpochByTab.get(7);

        const freshPort = createPort();
        onConnect.emit(freshPort);
        freshPort.onMessage.emit({
            action: MessageActions.SIDEPANEL_REGISTER,
            data: { tabId: 7, windowId: 1 },
        });
        expect(service.registrationClaimsByTab.get(7)).toMatchObject({
            port: freshPort,
            tabLifecycleEpoch: removalEpoch,
        });

        readiness.markReady();
        await flushPortMessages();
        await flushPortMessages();

        expect(oldPort.disconnect).toHaveBeenCalledTimes(1);
        expect(freshPort.disconnect).not.toHaveBeenCalled();
        expect(service.bindingByPort.get(freshPort)).toMatchObject({
            tabId: 7,
            tabLifecycleEpoch: removalEpoch,
            windowId: 1,
        });
        expect(service.activeConnections.get(7)).toBe(freshPort);
        expect(freshPort.postMessage).toHaveBeenCalledWith({
            action: MessageActions.SIDEPANEL_SELECTION_SYNC,
            data: {
                binding: {
                    registrationId:
                        service.bindingByPort.get(freshPort).registrationId,
                    tabId: 7,
                    windowId: 1,
                },
                selection: null,
            },
        });
    });

    test('delayed removal cleanup preserves a newer cross-tab claim on the same port', async () => {
        const pendingNewTab = deferred();
        let tabGetCalls = 0;
        const onConnect = setupConnectionChrome({
            getTab: async (tabId) => {
                tabGetCalls += 1;
                if (tabGetCalls === 2) return pendingNewTab.promise;
                return { active: true, id: tabId, windowId: 1 };
            },
            sendMessage: async () => ({
                success: true,
                selectedWords: ['TAB8_CURRENT'],
            }),
        });
        const service = new SidePanelService();
        service.registerListeners();
        const port = createPort();
        onConnect.emit(port);
        port.onMessage.emit({
            action: MessageActions.SIDEPANEL_REGISTER,
            data: { tabId: 7, windowId: 1 },
        });
        await flushPortMessages();
        port.postMessage.mockClear();

        const readiness = new BackgroundServiceReadiness();
        service.serviceReadiness = readiness;
        chrome.tabs.onRemoved.emit(7);
        chrome.tabs.onActivated.emit({ tabId: 8, windowId: 1 });
        port.onMessage.emit({
            action: MessageActions.SIDEPANEL_REGISTER,
            data: { tabId: 8, windowId: 1 },
        });
        const newerClaim = service.registrationClaimsByTab.get(8);

        readiness.markReady();
        await flushPortMessages();
        expect(chrome.tabs.get).toHaveBeenCalledTimes(2);
        expect(port.disconnect).not.toHaveBeenCalled();
        expect(service.connectedPorts.has(port)).toBe(true);
        expect(service.registrationClaimByPort.get(port)).toBe(newerClaim);

        pendingNewTab.resolve({ active: true, id: 8, windowId: 1 });
        await pendingNewTab.promise;
        await flushPortMessages();
        await flushPortMessages();

        expect(port.disconnect).not.toHaveBeenCalled();
        expect(service.bindingByPort.get(port)).toMatchObject({
            tabId: 8,
            windowId: 1,
        });
        expect(service.activeConnections.get(8)).toBe(port);
        expect(port.postMessage).toHaveBeenCalledWith({
            action: MessageActions.SIDEPANEL_SELECTION_SYNC,
            data: {
                binding: {
                    registrationId:
                        service.bindingByPort.get(port).registrationId,
                    tabId: 8,
                    windowId: 1,
                },
                selection: null,
            },
        });
    });

    test('delayed removal preserves a cross-tab claim recorded before removal', async () => {
        const pendingNewTab = deferred();
        let tabGetCalls = 0;
        const onConnect = setupConnectionChrome({
            getTab: async (tabId) => {
                tabGetCalls += 1;
                if (tabGetCalls === 2) return pendingNewTab.promise;
                return { active: true, id: tabId, windowId: 1 };
            },
            sendMessage: async () => ({
                success: true,
                selectedWords: ['TAB8_CURRENT'],
            }),
        });
        const service = new SidePanelService();
        service.registerListeners();
        const port = createPort();
        onConnect.emit(port);
        port.onMessage.emit({
            action: MessageActions.SIDEPANEL_REGISTER,
            data: { tabId: 7, windowId: 1 },
        });
        await flushPortMessages();
        port.postMessage.mockClear();

        const readiness = new BackgroundServiceReadiness();
        service.serviceReadiness = readiness;
        chrome.tabs.onActivated.emit({ tabId: 8, windowId: 1 });
        port.onMessage.emit({
            action: MessageActions.SIDEPANEL_REGISTER,
            data: { tabId: 8, windowId: 1 },
        });
        const newerClaim = service.registrationClaimsByTab.get(8);
        chrome.tabs.onRemoved.emit(7);

        readiness.markReady();
        await flushPortMessages();
        expect(chrome.tabs.get).toHaveBeenCalledTimes(2);
        expect(port.disconnect).not.toHaveBeenCalled();
        expect(service.connectedPorts.has(port)).toBe(true);
        expect(service.registrationClaimByPort.get(port)).toBe(newerClaim);

        pendingNewTab.resolve({ active: true, id: 8, windowId: 1 });
        await pendingNewTab.promise;
        await flushPortMessages();
        await flushPortMessages();

        expect(port.disconnect).not.toHaveBeenCalled();
        expect(service.bindingByPort.get(port)).toMatchObject({
            tabId: 8,
            windowId: 1,
        });
        expect(service.activeConnections.get(8)).toBe(port);
    });

    test('invalidates pending sync when the same port claims a newer tab', async () => {
        const pendingOldState = deferred();
        let service;
        const onConnect = setupConnectionChrome({
            getTab: async (tabId) => ({
                active: true,
                id: tabId,
                windowId: tabId === 7 ? 1 : 2,
            }),
            sendMessage: (tabId, request) => {
                if (tabId === 7) return pendingOldState.promise;
                expect(
                    service.acceptSelectionSnapshot(
                        createContentIdentity({
                            tabId: 8,
                            windowId: 2,
                            documentId: 'content-document-8',
                        }),
                        createSelectionSnapshot()
                    )
                ).toBe(true);
                return Promise.resolve({ requestId: request.data.requestId });
            },
        });
        service = new SidePanelService();
        expect(
            service.acceptSelectionSnapshot(
                createContentIdentity(),
                createSelectionSnapshot()
            )
        ).toBe(true);
        expect(
            service.acceptSelectionSnapshot(
                createContentIdentity({
                    tabId: 8,
                    windowId: 2,
                    documentId: 'content-document-8',
                }),
                createSelectionSnapshot()
            )
        ).toBe(true);
        service.registerListeners();
        const port = createPort();
        onConnect.emit(port);
        port.onMessage.emit({
            action: MessageActions.SIDEPANEL_REGISTER,
            data: { tabId: 7, windowId: 1 },
        });
        await flushPortMessages();
        expect(service.bindingByPort.get(port)).toMatchObject({
            tabId: 7,
            windowId: 1,
        });

        port.onMessage.emit({
            action: MessageActions.SIDEPANEL_REGISTER,
            data: { tabId: 8, windowId: 2 },
        });
        const oldRequest = chrome.tabs.sendMessage.mock.calls[0][1];
        pendingOldState.resolve({ requestId: oldRequest.data.requestId });
        await pendingOldState.promise;
        await flushPortMessages();
        await flushPortMessages();

        expect(port.disconnect).not.toHaveBeenCalled();
        expect(
            port.postMessage.mock.calls.some(
                ([message]) =>
                    message.data?.selection?.entries?.[0]?.word === 'very' &&
                    message.data.binding.tabId === 7
            )
        ).toBe(false);
        expect(service.bindingByPort.get(port)).toMatchObject({
            tabId: 8,
            windowId: 2,
        });
        expect(port.postMessage).toHaveBeenCalledWith({
            action: MessageActions.SIDEPANEL_SELECTION_SYNC,
            data: {
                binding: {
                    registrationId:
                        service.bindingByPort.get(port).registrationId,
                    tabId: 8,
                    windowId: 2,
                },
                selection: {
                    selectionOwnerGeneration: 2,
                    selectionRevision: 1,
                    renderRevision: 1,
                    reason: 'add',
                    entries: [
                        { wordIndex: 2, word: 'very' },
                        { wordIndex: 5, word: 'very' },
                    ],
                },
            },
        });
    });

    test('prunes an unbound cross-tab claim before tab removal cleanup', async () => {
        const pendingFirstTab = deferred();
        let tabGetCalls = 0;
        const onConnect = setupConnectionChrome({
            getTab: async (tabId) => {
                tabGetCalls += 1;
                if (tabGetCalls === 1) return pendingFirstTab.promise;
                return { active: true, id: tabId, windowId: 2 };
            },
            sendMessage: async () => ({
                success: true,
                selectedWords: ['TAB8_CURRENT'],
            }),
        });
        const service = new SidePanelService();
        service.registerListeners();
        const port = createPort();
        onConnect.emit(port);
        port.onMessage.emit({
            action: MessageActions.SIDEPANEL_REGISTER,
            data: { tabId: 7, windowId: 1 },
        });
        await Promise.resolve();
        await Promise.resolve();
        expect(chrome.tabs.get).toHaveBeenCalledTimes(1);

        port.onMessage.emit({
            action: MessageActions.SIDEPANEL_REGISTER,
            data: { tabId: 8, windowId: 2 },
        });
        pendingFirstTab.resolve({ active: true, id: 7, windowId: 1 });
        await pendingFirstTab.promise;
        await flushPortMessages();
        await flushPortMessages();

        expect(service.bindingByPort.get(port)).toMatchObject({
            tabId: 8,
            windowId: 2,
        });
        expect(service.registrationClaimsByTab.has(7)).toBe(false);

        service.handleTabRemoved(7);

        expect(port.disconnect).not.toHaveBeenCalled();
        expect(service.bindingByPort.get(port)).toMatchObject({
            tabId: 8,
            windowId: 2,
        });
        expect(service.activeConnections.get(8)).toBe(port);
    });

    test('evicts a replaced same-tab port so it cannot receive or reclaim ownership', async () => {
        const onConnect = setupConnectionChrome();
        const service = new SidePanelService();
        service.registerListeners();
        const oldPort = createPort();
        const currentPort = createPort();
        onConnect.emit(oldPort);
        oldPort.onMessage.emit({
            action: MessageActions.SIDEPANEL_REGISTER,
            data: { tabId: 7, windowId: 1 },
        });
        await flushPortMessages();
        oldPort.postMessage.mockClear();

        onConnect.emit(currentPort);
        currentPort.onMessage.emit({
            action: MessageActions.SIDEPANEL_REGISTER,
            data: { tabId: 7, windowId: 1 },
        });
        await flushPortMessages();

        expect(oldPort.disconnect).toHaveBeenCalledTimes(1);
        expect(service.bindingByPort.has(oldPort)).toBe(false);
        expect(service.bindingByPort.get(currentPort)).toMatchObject({
            tabId: 7,
            windowId: 1,
        });
        expect(service.activeConnections).toEqual(new Map([[7, currentPort]]));
        expect(service.activeConnectionsByWindow).toEqual(
            new Map([[1, new Set([currentPort])]])
        );

        chrome.sidePanel = {
            open: jest.fn().mockResolvedValue(undefined),
        };
        service.behaviorConfig = {
            sidePanelAutoOpen: true,
            sidePanelAutoPauseVideo: false,
            sidePanelUseSidePanel: true,
        };
        await service.openSidePanelImmediate(7, {
            autoOpen: true,
            pauseVideo: false,
        });
        service.handleTabActivated({ tabId: 8, windowId: 1 });
        expect(oldPort.postMessage).not.toHaveBeenCalled();

        const tabGetCalls = chrome.tabs.get.mock.calls.length;
        oldPort.onMessage.emit({
            action: MessageActions.SIDEPANEL_REGISTER,
            data: { tabId: 7, windowId: 1 },
        });
        await flushPortMessages();
        await flushPortMessages();

        expect(chrome.tabs.get).toHaveBeenCalledTimes(tabGetCalls);
        expect(oldPort.postMessage).not.toHaveBeenCalled();
        expect(service.activeConnections.get(7)).toBe(currentPort);
        expect(service.bindingByPort.has(oldPort)).toBe(false);
    });

    test('evicts a removed-tab port while preserving other tab and window bindings', async () => {
        const onConnect = setupConnectionChrome({
            getTab: async (tabId) => ({
                active: true,
                id: tabId,
                windowId: tabId === 7 ? 1 : 2,
            }),
        });
        const service = new SidePanelService();
        service.registerListeners();
        const removedPort = createPort();
        const preservedPort = createPort();
        onConnect.emit(removedPort);
        removedPort.onMessage.emit({
            action: MessageActions.SIDEPANEL_REGISTER,
            data: { tabId: 7, windowId: 1 },
        });
        await flushPortMessages();
        onConnect.emit(preservedPort);
        preservedPort.onMessage.emit({
            action: MessageActions.SIDEPANEL_REGISTER,
            data: { tabId: 8, windowId: 2 },
        });
        await flushPortMessages();
        removedPort.postMessage.mockClear();
        preservedPort.postMessage.mockClear();

        service.handleTabRemoved(7);

        expect(removedPort.disconnect).toHaveBeenCalledTimes(1);
        expect(preservedPort.disconnect).not.toHaveBeenCalled();
        expect(service.bindingByPort).toHaveProperty('size', 1);
        expect(service.bindingByPort.get(preservedPort)).toMatchObject({
            tabId: 8,
            windowId: 2,
        });
        expect(service.activeConnections).toEqual(
            new Map([[8, preservedPort]])
        );
        expect(service.activeConnectionsByWindow).toEqual(
            new Map([[2, new Set([preservedPort])]])
        );

        service.handleTabActivated({ tabId: 9, windowId: 1 });
        expect(removedPort.postMessage).not.toHaveBeenCalled();
        const tabGetCalls = chrome.tabs.get.mock.calls.length;
        removedPort.onMessage.emit({
            action: MessageActions.SIDEPANEL_REGISTER,
            data: { tabId: 7, windowId: 1 },
        });
        await flushPortMessages();

        expect(chrome.tabs.get).toHaveBeenCalledTimes(tabGetCalls);
        expect(service.activeConnections.get(8)).toBe(preservedPort);
        expect(service.bindingByPort.has(removedPort)).toBe(false);
    });

    test('preserves distinct tab bindings that share one window', () => {
        const service = new SidePanelService();
        const firstPort = createPort();
        const secondPort = createPort();
        service.handleSidePanelConnection(firstPort);
        service.handleSidePanelConnection(secondPort);

        bindAuthorizedPortForTest(service, firstPort, 7, 1);
        bindAuthorizedPortForTest(service, secondPort, 8, 1);

        expect(firstPort.disconnect).not.toHaveBeenCalled();
        expect(secondPort.disconnect).not.toHaveBeenCalled();
        expect(service.bindingByPort).toHaveProperty('size', 2);
        expect(service.bindingByPort.get(firstPort)).toMatchObject({
            tabId: 7,
            windowId: 1,
        });
        expect(service.bindingByPort.get(secondPort)).toMatchObject({
            tabId: 8,
            windowId: 1,
        });
        expect(service.activeConnections).toEqual(
            new Map([
                [7, firstPort],
                [8, secondPort],
            ])
        );
        expect(service.activeConnectionsByWindow.get(1)).toEqual(
            new Set([firstPort, secondPort])
        );

        service.handleTabActivated({ tabId: 9, windowId: 1 });
        expect(firstPort.postMessage).toHaveBeenCalledWith({
            action: 'tabActivated',
            data: { tabId: 9, windowId: 1 },
        });
        expect(secondPort.postMessage).toHaveBeenCalledWith({
            action: 'tabActivated',
            data: { tabId: 9, windowId: 1 },
        });
    });

    test('rejects a malformed later message before queued registration work starts', async () => {
        const pendingTab = deferred();
        const onConnect = setupConnectionChrome({
            getTab: () => pendingTab.promise,
        });
        const service = new SidePanelService();
        service.registerListeners();
        const port = createPort();
        onConnect.emit(port);

        port.onMessage.emit({
            action: MessageActions.SIDEPANEL_REGISTER,
            data: { tabId: 7, windowId: 1 },
        });
        port.onMessage.emit({ action: MessageActions.SIDEPANEL_GET_STATE });
        await Promise.resolve();
        await Promise.resolve();

        expect(chrome.tabs.get).not.toHaveBeenCalled();
        expect(port.disconnect).toHaveBeenCalledTimes(1);
        await flushPortMessages();

        expect(port.postMessage).not.toHaveBeenCalled();
        expect(service.bindingByPort).toHaveProperty('size', 0);
        expect(service.activeConnections).toHaveProperty('size', 0);
        expect(service.activeConnectionsByWindow).toHaveProperty('size', 0);
    });

    test('re-registers one port without leaving its old tab or window binding', async () => {
        const onConnect = setupConnectionChrome({
            getTab: async (tabId) => ({
                active: true,
                id: tabId,
                windowId: tabId === 7 ? 1 : 2,
            }),
        });
        const service = new SidePanelService();
        service.registerListeners();
        const port = createPort();
        onConnect.emit(port);

        port.onMessage.emit({
            action: MessageActions.SIDEPANEL_REGISTER,
            data: { tabId: 7, windowId: 1 },
        });
        await flushPortMessages();
        port.onMessage.emit({
            action: MessageActions.SIDEPANEL_REGISTER,
            data: { tabId: 8, windowId: 2 },
        });
        await flushPortMessages();

        expect(service.bindingByPort).toHaveProperty('size', 1);
        expect(service.bindingByPort.get(port)).toMatchObject({
            tabId: 8,
            windowId: 2,
        });
        expect(service.activeConnections).toEqual(new Map([[8, port]]));
        expect(service.activeConnectionsByWindow).toEqual(
            new Map([[2, new Set([port])]])
        );
        expect(port.disconnect).not.toHaveBeenCalled();
    });

    test('destroy revokes a stable snapshot of active ports and stays idempotent', async () => {
        const onConnect = setupConnectionChrome({
            getTab: async (tabId) => ({
                active: true,
                id: tabId,
                windowId: tabId === 7 ? 1 : 2,
            }),
        });
        const service = new SidePanelService();
        service.registerListeners();
        const firstPort = createPort();
        const secondPort = createPort();
        onConnect.emit(firstPort);
        onConnect.emit(secondPort);
        firstPort.onMessage.emit({
            action: MessageActions.SIDEPANEL_REGISTER,
            data: { tabId: 7, windowId: 1 },
        });
        secondPort.onMessage.emit({
            action: MessageActions.SIDEPANEL_REGISTER,
            data: { tabId: 8, windowId: 2 },
        });
        await flushPortMessages();
        await flushPortMessages();
        firstPort.postMessage.mockClear();
        secondPort.postMessage.mockClear();

        service.destroy();
        service.destroy();

        expect(firstPort.disconnect).toHaveBeenCalledTimes(1);
        expect(secondPort.disconnect).toHaveBeenCalledTimes(1);
        expect(service.bindingByPort).toHaveProperty('size', 0);
        expect(service.activeConnections).toHaveProperty('size', 0);
        expect(service.activeConnectionsByWindow).toHaveProperty('size', 0);

        const tabGetCalls = chrome.tabs.get.mock.calls.length;
        firstPort.onMessage.emit({
            action: MessageActions.SIDEPANEL_REGISTER,
            data: { tabId: 7, windowId: 1 },
        });
        await flushPortMessages();

        expect(chrome.tabs.get).toHaveBeenCalledTimes(tabGetCalls);
        expect(firstPort.postMessage).not.toHaveBeenCalled();
        expect(service.bindingByPort).toHaveProperty('size', 0);
        expect(service.activeConnections).toHaveProperty('size', 0);
        expect(service.activeConnectionsByWindow).toHaveProperty('size', 0);
    });

    test('destroy revokes pending and pre-registration ports before they can bind', async () => {
        const pendingTab = deferred();
        const onConnect = setupConnectionChrome({
            getTab: () => pendingTab.promise,
        });
        const service = new SidePanelService();
        service.registerListeners();
        const pendingPort = createPort();
        const unregisteredPort = createPort();
        onConnect.emit(pendingPort);
        onConnect.emit(unregisteredPort);
        pendingPort.onMessage.emit({
            action: MessageActions.SIDEPANEL_REGISTER,
            data: { tabId: 7, windowId: 1 },
        });
        await Promise.resolve();
        await Promise.resolve();
        expect(chrome.tabs.get).toHaveBeenCalledTimes(1);

        service.destroy();

        expect(pendingPort.disconnect).toHaveBeenCalledTimes(1);
        expect(unregisteredPort.disconnect).toHaveBeenCalledTimes(1);
        expect(service.connectedPorts).toHaveProperty('size', 0);
        expect(service.bindingByPort).toHaveProperty('size', 0);
        expect(service.activeConnections).toHaveProperty('size', 0);
        expect(service.activeConnectionsByWindow).toHaveProperty('size', 0);

        pendingTab.resolve({ active: true, id: 7, windowId: 1 });
        await pendingTab.promise;
        unregisteredPort.onMessage.emit({
            action: MessageActions.SIDEPANEL_REGISTER,
            data: { tabId: 8, windowId: 1 },
        });
        await flushPortMessages();
        await flushPortMessages();

        expect(chrome.tabs.get).toHaveBeenCalledTimes(1);
        expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
        expect(pendingPort.postMessage).not.toHaveBeenCalled();
        expect(unregisteredPort.postMessage).not.toHaveBeenCalled();
        expect(service.connectedPorts).toHaveProperty('size', 0);
        expect(service.bindingByPort).toHaveProperty('size', 0);
        expect(service.activeConnections).toHaveProperty('size', 0);
        expect(service.activeConnectionsByWindow).toHaveProperty('size', 0);
    });

    test('accepts a fresh trusted port after destroy and reinitialize', async () => {
        const onConnect = setupConnectionChrome();
        chrome.sidePanel = {};
        jest.spyOn(configService, 'getMultiple').mockResolvedValue({
            sidePanelAutoOpen: true,
            sidePanelAutoPauseVideo: false,
            sidePanelUseSidePanel: true,
        });
        jest.spyOn(configService, 'onChanged').mockReturnValue(() => {});
        const service = new SidePanelService();
        await service.initialize();
        const oldPort = createPort();
        onConnect.emit(oldPort);

        service.destroy();
        await service.initialize();
        const freshPort = createPort();
        onConnect.emit(freshPort);
        freshPort.onMessage.emit({
            action: MessageActions.SIDEPANEL_REGISTER,
            data: { tabId: 7, windowId: 1 },
        });
        await flushPortMessages();

        expect(oldPort.disconnect).toHaveBeenCalledTimes(1);
        expect(freshPort.disconnect).not.toHaveBeenCalled();
        expect(service.initialized).toBe(true);
        expect(service.connectedPorts).toEqual(new Set([freshPort]));
        expect(service.bindingByPort.get(freshPort)).toMatchObject({
            tabId: 7,
            windowId: 1,
        });
        expect(service.activeConnections.get(7)).toBe(freshPort);
    });

    test('disconnect and destroy remove all exact port bindings', () => {
        const service = new SidePanelService();
        const firstPort = createPort();
        const secondPort = createPort();
        service.handleSidePanelConnection(firstPort);
        bindAuthorizedPortForTest(service, firstPort, 7, 1);

        firstPort.onDisconnect.emit();

        expect(service.bindingByPort).toHaveProperty('size', 0);
        expect(service.activeConnections).toHaveProperty('size', 0);
        expect(service.activeConnectionsByWindow).toHaveProperty('size', 0);

        expect(service.bindPort(firstPort, null)).toBe(false);
        bindAuthorizedPortForTest(service, secondPort, 8, 2);
        service.destroy();

        expect(service.bindingByPort).toHaveProperty('size', 0);
        expect(service.activeConnections).toHaveProperty('size', 0);
        expect(service.activeConnectionsByWindow).toHaveProperty('size', 0);
    });

    test('disconnecting a superseded port preserves the current tab mapping', () => {
        const service = new SidePanelService();
        const oldPort = createPort();
        const currentPort = createPort();

        service.handleSidePanelConnection(oldPort);
        service.handleSidePanelConnection(currentPort);
        bindAuthorizedPortForTest(service, oldPort, 7, 1);
        bindAuthorizedPortForTest(service, currentPort, 7, 1);
        oldPort.onDisconnect.emit();

        expect(service.activeConnections.get(7)).toBe(currentPort);
    });

    test('disconnecting an old port binding preserves its replacement', () => {
        const service = new SidePanelService();
        const oldPort = createPort();
        const currentPort = createPort();

        service.handleSidePanelConnection(oldPort);
        service.handleSidePanelConnection(currentPort);
        bindAuthorizedPortForTest(service, oldPort, 7, 1);
        bindAuthorizedPortForTest(service, currentPort, 7, 1);
        oldPort.onDisconnect.emit();

        expect(service.bindingByPort.get(currentPort)).toMatchObject({
            tabId: 7,
            windowId: 1,
        });
        expect(service.activeConnections.get(7)).toBe(currentPort);
        expect(service.activeConnectionsByWindow.get(1)).toEqual(
            new Set([currentPort])
        );
    });

    test('captures a side-panel connection before service readiness settles', () => {
        const onConnect = createChromeEvent();
        global.chrome = {
            runtime: {
                id: EXTENSION_ID,
                getURL: jest.fn((path = '') => `${EXTENSION_ORIGIN}/${path}`),
                onConnect,
            },
            tabs: {
                onActivated: createChromeEvent(),
                onRemoved: createChromeEvent(),
            },
            sidePanel: {},
        };

        const service = new SidePanelService();
        const readiness = new BackgroundServiceReadiness();
        service.registerListeners(readiness);

        const port = createPort({
            documentId: 'side-panel-document',
            origin: EXTENSION_ORIGIN,
        });
        onConnect.emit(port);

        expect(port.onMessage.listeners).toHaveLength(1);
    });

    test('accepts a first content owner and projects duplicate occurrences to its exact panel binding', () => {
        const service = new SidePanelService();
        const port = createPort();
        const claim = bindAuthorizedPortForTest(service, port, 7, 1);

        expect(
            service.acceptSelectionSnapshot(
                createContentIdentity(),
                createSelectionSnapshot()
            )
        ).toBe(true);

        expect(port.postMessage).toHaveBeenCalledTimes(1);
        expect(
            parseSidePanelSelectionStateMessage(
                port.postMessage.mock.calls[0][0],
                {
                    registrationId: claim.registrationId,
                    tabId: 7,
                    windowId: 1,
                }
            )
        ).toEqual({
            binding: {
                registrationId: claim.registrationId,
                tabId: 7,
                windowId: 1,
            },
            selection: {
                selectionOwnerGeneration: 1,
                selectionRevision: 1,
                renderRevision: 1,
                reason: 'add',
                entries: [
                    { wordIndex: 2, word: 'very' },
                    { wordIndex: 5, word: 'very' },
                ],
            },
        });
    });

    test('accepts a higher selection revision without changing the content owner generation', () => {
        const service = new SidePanelService();
        const port = createPort();
        bindAuthorizedPortForTest(service, port, 7, 1);

        expect(
            service.acceptSelectionSnapshot(
                createContentIdentity(),
                createSelectionSnapshot()
            )
        ).toBe(true);
        expect(
            service.acceptSelectionSnapshot(
                createContentIdentity(),
                createSelectionSnapshot({
                    selectionRevision: 2,
                    renderRevision: 2,
                    reason: 'toggle',
                    entries: Object.freeze([
                        Object.freeze({ wordIndex: 5, word: 'very' }),
                    ]),
                })
            )
        ).toBe(true);

        expect(port.postMessage).toHaveBeenCalledTimes(2);
        expect(port.postMessage.mock.calls[1][0].data.selection).toEqual({
            selectionOwnerGeneration: 1,
            selectionRevision: 2,
            renderRevision: 2,
            reason: 'toggle',
            entries: [{ wordIndex: 5, word: 'very' }],
        });
    });

    test('advances freshness for an exact replay without broadcasting it', () => {
        const service = new SidePanelService();
        const port = createPort();
        bindAuthorizedPortForTest(service, port, 7, 1);
        const identity = createContentIdentity();
        const snapshot = createSelectionSnapshot();

        expect(service.acceptSelectionSnapshot(identity, snapshot)).toBe(true);
        const firstReceipt =
            service.selectionOwnersByTab.get(7).acceptedReceiptEpoch;
        expect(service.acceptSelectionSnapshot(identity, snapshot)).toBe(true);

        expect(
            service.selectionOwnersByTab.get(7).acceptedReceiptEpoch
        ).toBeGreaterThan(firstReceipt);
        expect(port.postMessage).toHaveBeenCalledTimes(1);
    });

    test('rejects a same-revision mismatch without changing or projecting authority', () => {
        const service = new SidePanelService();
        const port = createPort();
        bindAuthorizedPortForTest(service, port, 7, 1);
        const identity = createContentIdentity();
        const snapshot = createSelectionSnapshot();
        expect(service.acceptSelectionSnapshot(identity, snapshot)).toBe(true);
        const acceptedOwner = service.selectionOwnersByTab.get(7);
        port.postMessage.mockClear();

        expect(
            service.acceptSelectionSnapshot(
                identity,
                createSelectionSnapshot({ reason: 'restore' })
            )
        ).toBe(false);

        expect(service.selectionOwnersByTab.get(7)).toBe(acceptedOwner);
        expect(port.postMessage).not.toHaveBeenCalled();
    });

    test.each([
        [
            'lower selection revision',
            { selectionRevision: 1, renderRevision: 3 },
        ],
        [
            'regressing render revision',
            { selectionRevision: 3, renderRevision: 1 },
        ],
    ])('rejects a %s for the same content owner', (_label, overrides) => {
        const service = new SidePanelService();
        const port = createPort();
        bindAuthorizedPortForTest(service, port, 7, 1);
        const identity = createContentIdentity();
        expect(
            service.acceptSelectionSnapshot(
                identity,
                createSelectionSnapshot({
                    selectionRevision: 2,
                    renderRevision: 2,
                })
            )
        ).toBe(true);
        const acceptedOwner = service.selectionOwnersByTab.get(7);
        port.postMessage.mockClear();

        expect(
            service.acceptSelectionSnapshot(
                identity,
                createSelectionSnapshot(overrides)
            )
        ).toBe(false);

        expect(service.selectionOwnersByTab.get(7)).toBe(acceptedOwner);
        expect(port.postMessage).not.toHaveBeenCalled();
    });

    test('mints generations for a changed document, higher lifecycle, and changed window', () => {
        const service = new SidePanelService();

        expect(
            service.acceptSelectionSnapshot(
                createContentIdentity(),
                createSelectionSnapshot()
            )
        ).toBe(true);
        expect(
            service.acceptSelectionSnapshot(
                createContentIdentity({ documentId: 'content-document-2' }),
                createSelectionSnapshot()
            )
        ).toBe(true);
        expect(
            service.acceptSelectionSnapshot(
                createContentIdentity({ documentId: 'content-document-2' }),
                createSelectionSnapshot({ lifecycleGeneration: 2 })
            )
        ).toBe(true);
        expect(
            service.acceptSelectionSnapshot(
                createContentIdentity({
                    documentId: 'content-document-2',
                    windowId: 2,
                }),
                createSelectionSnapshot({ lifecycleGeneration: 2 })
            )
        ).toBe(true);

        expect(
            service.selectionOwnersByTab.get(7).selectionOwnerGeneration
        ).toBe(4);
    });

    test('rejects an older lifecycle from the current document owner', () => {
        const service = new SidePanelService();
        const identity = createContentIdentity();
        expect(
            service.acceptSelectionSnapshot(
                identity,
                createSelectionSnapshot({ lifecycleGeneration: 2 })
            )
        ).toBe(true);
        const acceptedOwner = service.selectionOwnersByTab.get(7);

        expect(
            service.acceptSelectionSnapshot(identity, createSelectionSnapshot())
        ).toBe(false);
        expect(service.selectionOwnersByTab.get(7)).toBe(acceptedOwner);
    });

    test('clears selection owners on cross-tab activation, tab removal, and destroy without resetting generations', () => {
        const service = new SidePanelService();
        const identity = createContentIdentity();
        const snapshot = createSelectionSnapshot();
        service.recordWindowActivation({ tabId: 7, windowId: 1 });
        expect(service.acceptSelectionSnapshot(identity, snapshot)).toBe(true);

        service.recordWindowActivation({ tabId: 8, windowId: 1 });
        expect(service.selectionOwnersByTab.has(7)).toBe(false);
        expect(service.acceptSelectionSnapshot(identity, snapshot)).toBe(true);
        expect(
            service.selectionOwnersByTab.get(7).selectionOwnerGeneration
        ).toBe(2);

        service.recordTabRemoval(7);
        expect(service.selectionOwnersByTab.has(7)).toBe(false);
        expect(service.acceptSelectionSnapshot(identity, snapshot)).toBe(true);
        expect(
            service.selectionOwnersByTab.get(7).selectionOwnerGeneration
        ).toBe(3);

        service.destroy();
        expect(service.selectionOwnersByTab.has(7)).toBe(false);
        expect(service.acceptSelectionSnapshot(identity, snapshot)).toBe(true);
        expect(
            service.selectionOwnersByTab.get(7).selectionOwnerGeneration
        ).toBe(4);
    });

    test('revokes an activated tab owner that still belongs to its prior window', () => {
        const service = new SidePanelService();
        expect(
            service.acceptSelectionSnapshot(
                createContentIdentity(),
                createSelectionSnapshot()
            )
        ).toBe(true);

        service.recordWindowActivation({ tabId: 7, windowId: 2 });

        expect(service.selectionOwnersByTab.has(7)).toBe(false);
        expect(service.selectionOwnerGeneration).toBe(1);
    });

    test('confirms a binding before null state, freshness poke, replay receipt, and authoritative projection', async () => {
        let service;
        const ordering = [];
        const identity = createContentIdentity();
        const snapshot = createSelectionSnapshot();
        const onConnect = setupConnectionChrome({
            sendMessage: async (tabId, request, options) => {
                ordering.push('poke');
                expect(tabId).toBe(7);
                expect(request).toEqual({
                    action: MessageActions.SIDEPANEL_GET_STATE,
                    data: { requestId: expect.any(Number) },
                });
                expect(options).toEqual({
                    documentId: 'content-document-1',
                    frameId: 0,
                });
                expect(
                    service.acceptSelectionSnapshot(identity, snapshot)
                ).toBe(true);
                return { requestId: request.data.requestId };
            },
        });
        service = new SidePanelService();
        expect(service.acceptSelectionSnapshot(identity, snapshot)).toBe(true);
        service.registerListeners();
        const port = createPort();
        port.postMessage.mockImplementation((message) => {
            if (message.action === MessageActions.SIDEPANEL_BINDING_CONFIRMED) {
                ordering.push('confirmation');
            } else if (message.data.selection === null) {
                ordering.push('null');
            } else {
                ordering.push('projection');
            }
        });
        onConnect.emit(port);

        emitRawRegistration(port, {
            registrationId: 301,
            tabId: 7,
            windowId: 1,
        });
        await flushPortMessages();
        await flushPortMessages();

        expect(ordering).toEqual([
            'confirmation',
            'null',
            'poke',
            'projection',
        ]);
        expect(port.postMessage.mock.calls[1][0]).toEqual({
            action: MessageActions.SIDEPANEL_SELECTION_SYNC,
            data: {
                binding: { registrationId: 301, tabId: 7, windowId: 1 },
                selection: null,
            },
        });
        expect(port.postMessage.mock.calls[2][0].data.selection).toEqual({
            selectionOwnerGeneration: 1,
            selectionRevision: 1,
            renderRevision: 1,
            reason: 'add',
            entries: [
                { wordIndex: 2, word: 'very' },
                { wordIndex: 5, word: 'very' },
            ],
        });
        expect(port.disconnect).not.toHaveBeenCalled();
    });

    test('recovers a cold worker with no cached owner through one correlated top-frame republish', async () => {
        let service;
        const identity = createContentIdentity();
        const snapshot = createSelectionSnapshot();
        const onConnect = setupConnectionChrome({
            sendMessage: async (tabId, request, options) => {
                expect(tabId).toBe(7);
                expect(options).toEqual({ frameId: 0 });
                expect(service.selectionOwnersByTab.has(7)).toBe(false);
                expect(
                    service.acceptSelectionSnapshot(identity, snapshot)
                ).toBe(true);
                return { requestId: request.data.requestId };
            },
        });
        service = new SidePanelService();
        service.registerListeners();
        const port = createPort();
        onConnect.emit(port);

        emitRawRegistration(port, {
            registrationId: 305,
            tabId: 7,
            windowId: 1,
        });
        await flushPortMessages();
        await flushPortMessages();

        expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1);
        expect(port.postMessage).toHaveBeenCalledTimes(3);
        expect(port.postMessage.mock.calls[1][0].data.selection).toBeNull();
        expect(port.postMessage.mock.calls[2][0].data.selection).toEqual({
            selectionOwnerGeneration: 1,
            selectionRevision: 1,
            renderRevision: 1,
            reason: 'add',
            entries: [
                { wordIndex: 2, word: 'very' },
                { wordIndex: 5, word: 'very' },
            ],
        });
        expect(service.bindingByPort.get(port)).toMatchObject({
            confirmed: true,
            registrationId: 305,
            selectionSynchronizationPending: false,
        });
        expect(port.disconnect).not.toHaveBeenCalled();
    });

    test('keeps a no-owner registration bound to null when the active frame has no receiver', async () => {
        const onConnect = setupConnectionChrome({
            sendMessage: async () => {
                throw new Error('Receiving end does not exist');
            },
        });
        const service = new SidePanelService();
        service.registerListeners();
        const port = createPort();
        onConnect.emit(port);

        emitRawRegistration(port, {
            registrationId: 306,
            tabId: 7,
            windowId: 1,
        });
        await flushPortMessages();
        await flushPortMessages();

        expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
            7,
            expect.objectContaining({
                action: MessageActions.SIDEPANEL_GET_STATE,
            }),
            { frameId: 0 }
        );
        expect(port.postMessage).toHaveBeenCalledTimes(2);
        expect(port.postMessage.mock.calls[1][0].data.selection).toBeNull();
        expect(service.bindingByPort.get(port)).toMatchObject({
            confirmed: true,
            registrationId: 306,
            selectionSynchronizationPending: false,
        });
        expect(port.disconnect).not.toHaveBeenCalled();
    });

    test('full navigation invalidates the old owner and stalled refresh before replacement projection', async () => {
        const pendingAck = deferred();
        const onConnect = setupConnectionChrome({
            sendMessage: () => pendingAck.promise,
        });
        const service = new SidePanelService();
        expect(
            service.acceptSelectionSnapshot(
                createContentIdentity(),
                createSelectionSnapshot()
            )
        ).toBe(true);
        expect(
            service.acceptSelectionSnapshot(
                createContentIdentity({
                    documentId: 'other-window-document',
                    tabId: 8,
                    windowId: 2,
                }),
                createSelectionSnapshot()
            )
        ).toBe(true);
        const otherWindowOwner = service.selectionOwnersByTab.get(8);
        service.registerListeners();
        const port = createPort();
        onConnect.emit(port);

        emitRawRegistration(port, {
            registrationId: 307,
            tabId: 7,
            windowId: 1,
        });
        await flushPortMessages();
        const request = chrome.tabs.sendMessage.mock.calls[0][1];
        expect(port.postMessage).toHaveBeenCalledTimes(2);

        chrome.tabs.onUpdated.emit(7, { status: 'loading' }, {});

        expect(service.selectionOwnersByTab.has(7)).toBe(false);
        expect(service.selectionOwnersByTab.get(8)).toBe(otherWindowOwner);
        expect(port.postMessage).toHaveBeenCalledTimes(3);
        expect(port.postMessage.mock.calls[2][0].data.selection).toBeNull();
        expect(
            service.acceptSelectionSnapshot(
                createContentIdentity({
                    documentId: 'replacement-document',
                }),
                createSelectionSnapshot()
            )
        ).toBe(true);
        expect(
            service.selectionOwnersByTab.get(7).selectionOwnerGeneration
        ).toBe(3);
        expect(port.postMessage).toHaveBeenCalledTimes(3);

        pendingAck.resolve({ requestId: request.data.requestId });
        await pendingAck.promise;
        await flushPortMessages();

        expect(port.postMessage).toHaveBeenCalledTimes(3);
        expect(service.bindingByPort.get(port)).toMatchObject({
            confirmed: true,
            registrationId: 307,
            selectionSynchronizationPending: false,
        });
        expect(port.disconnect).not.toHaveBeenCalled();
    });

    test('suppresses concurrent projection but keeps the confirmed binding null when freshness ownership changes', async () => {
        const pendingAck = deferred();
        const identity = createContentIdentity();
        const snapshot = createSelectionSnapshot();
        const onConnect = setupConnectionChrome({
            sendMessage: () => pendingAck.promise,
        });
        const service = new SidePanelService();
        expect(service.acceptSelectionSnapshot(identity, snapshot)).toBe(true);
        service.registerListeners();
        const port = createPort();
        onConnect.emit(port);

        emitRawRegistration(port, {
            registrationId: 302,
            tabId: 7,
            windowId: 1,
        });
        await flushPortMessages();

        expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1);
        const request = chrome.tabs.sendMessage.mock.calls[0][1];
        expect(port.postMessage).toHaveBeenCalledTimes(2);
        expect(
            service.acceptSelectionSnapshot(
                createContentIdentity({ documentId: 'content-document-2' }),
                createSelectionSnapshot()
            )
        ).toBe(true);
        expect(port.postMessage).toHaveBeenCalledTimes(2);

        pendingAck.resolve({ requestId: request.data.requestId });
        await pendingAck.promise;
        await flushPortMessages();

        expect(port.postMessage).toHaveBeenCalledTimes(2);
        expect(port.disconnect).not.toHaveBeenCalled();
        expect(service.bindingByPort.get(port)).toMatchObject({
            confirmed: true,
            registrationId: 302,
            selectionSynchronizationPending: false,
        });
    });

    test('keeps a confirmed binding null when a matching ack lacks a newer accepted receipt', async () => {
        const onConnect = setupConnectionChrome({
            sendMessage: async (_tabId, request) => ({
                requestId: request.data.requestId,
            }),
        });
        const service = new SidePanelService();
        expect(
            service.acceptSelectionSnapshot(
                createContentIdentity(),
                createSelectionSnapshot()
            )
        ).toBe(true);
        const ownerBeforeRegistration = service.selectionOwnersByTab.get(7);
        service.registerListeners();
        const port = createPort();
        onConnect.emit(port);

        emitRawRegistration(port, {
            registrationId: 303,
            tabId: 7,
            windowId: 1,
        });
        await flushPortMessages();
        await flushPortMessages();

        expect(port.postMessage).toHaveBeenCalledTimes(2);
        expect(port.disconnect).not.toHaveBeenCalled();
        expect(service.bindingByPort.get(port)).toMatchObject({
            confirmed: true,
            registrationId: 303,
            selectionSynchronizationPending: false,
        });
        expect(service.selectionOwnersByTab.get(7)).toBe(
            ownerBeforeRegistration
        );
        expect(service.selectionOwnerGeneration).toBe(1);
    });

    test('returns a reentrant final-projection authority change to bound null', async () => {
        let service;
        const identity = createContentIdentity();
        const snapshot = createSelectionSnapshot();
        const onConnect = setupConnectionChrome({
            sendMessage: async (_tabId, request) => {
                expect(
                    service.acceptSelectionSnapshot(identity, snapshot)
                ).toBe(true);
                return { requestId: request.data.requestId };
            },
        });
        service = new SidePanelService();
        expect(service.acceptSelectionSnapshot(identity, snapshot)).toBe(true);
        service.registerListeners();
        const port = createPort();
        onConnect.emit(port);
        let changedDuringProjection = false;
        port.postMessage.mockImplementation((message) => {
            if (
                !changedDuringProjection &&
                message.data?.selection?.selectionRevision === 1
            ) {
                changedDuringProjection = true;
                expect(
                    service.acceptSelectionSnapshot(
                        identity,
                        createSelectionSnapshot({
                            selectionRevision: 2,
                            renderRevision: 2,
                        })
                    )
                ).toBe(true);
            }
        });

        emitRawRegistration(port, {
            registrationId: 304,
            tabId: 7,
            windowId: 1,
        });
        await flushPortMessages();
        await flushPortMessages();

        expect(changedDuringProjection).toBe(true);
        expect(port.disconnect).not.toHaveBeenCalled();
        expect(service.bindingByPort.get(port)).toMatchObject({
            confirmed: true,
            registrationId: 304,
            selectionSynchronizationPending: false,
        });
        expect(port.postMessage).toHaveBeenLastCalledWith({
            action: MessageActions.SIDEPANEL_SELECTION_SYNC,
            data: {
                binding: { registrationId: 304, tabId: 7, windowId: 1 },
                selection: null,
            },
        });
    });

    test('revokes the exact bound port when a new authoritative projection post fails', () => {
        const service = new SidePanelService();
        const port = createPort();
        bindAuthorizedPortForTest(service, port, 7, 1);
        port.postMessage.mockImplementation(() => {
            throw new Error('panel post failed');
        });

        expect(
            service.acceptSelectionSnapshot(
                createContentIdentity(),
                createSelectionSnapshot()
            )
        ).toBe(true);

        expect(port.disconnect).toHaveBeenCalledTimes(1);
        expect(service.bindingByPort.has(port)).toBe(false);
        expect(service.selectionOwnersByTab.has(7)).toBe(true);
    });

    test.each([
        ['wrong role', { role: MessageSenderRoles.SIDEPANEL }, {}],
        ['negative tab', { tabId: -1 }, {}],
        ['negative window', { windowId: -1 }, {}],
        ['subframe', { frameId: 1 }, {}],
        ['blank document', { documentId: '   ' }, {}],
        ['cached document', { documentLifecycle: 'cached' }, {}],
        ['zero lifecycle', {}, { lifecycleGeneration: 0 }],
        ['zero selection revision', {}, { selectionRevision: 0 }],
        ['zero render revision', {}, { renderRevision: 0 }],
        ['unknown reason', {}, { reason: 'unknown' }],
        ['extra snapshot key', {}, { extra: true }],
    ])(
        'rejects a locally invalid selection identity: %s',
        (_label, identityOverrides, snapshotOverrides) => {
            const service = new SidePanelService();

            expect(
                service.acceptSelectionSnapshot(
                    createContentIdentity(identityOverrides),
                    createSelectionSnapshot(snapshotOverrides)
                )
            ).toBe(false);
            expect(service.selectionOwnersByTab).toHaveProperty('size', 0);
        }
    );

    test('does not send another window activation to an existing panel', () => {
        const service = new SidePanelService();
        const firstWindowPort = createPort();
        bindAuthorizedPortForTest(service, firstWindowPort, 7, 1);

        service.handleTabActivated({ tabId: 22, windowId: 2 });

        expect(firstWindowPort.postMessage).not.toHaveBeenCalled();
        expect(service.bindingByPort.get(firstWindowPort)).toMatchObject({
            tabId: 7,
            windowId: 1,
        });
    });

    test('notifies only panels registered to the activated window', () => {
        const service = new SidePanelService();
        const firstWindowPort = createPort();
        const secondWindowPort = createPort();
        bindAuthorizedPortForTest(service, firstWindowPort, 7, 1);
        bindAuthorizedPortForTest(service, secondWindowPort, 21, 2);

        service.handleTabActivated({ tabId: 22, windowId: 2 });

        expect(firstWindowPort.postMessage).not.toHaveBeenCalled();
        expect(secondWindowPort.postMessage).toHaveBeenCalledWith({
            action: 'tabActivated',
            data: { tabId: 22, windowId: 2 },
        });
    });
});

describe('SidePanelService canonical occurrence removal', () => {
    test('routes one exact occurrence command and reports applied only after the authoritative successor', async () => {
        const { identity, port, removal, service } =
            createBoundRemovalHarness();
        chrome.tabs.sendMessage.mockImplementation(
            async (tabId, message, options) => {
                const command =
                    parseSidePanelSelectionRemovalCommandMessage(message);
                expect(tabId).toBe(7);
                expect(command).toEqual({
                    requestId: 41,
                    lifecycleGeneration: 1,
                    selectionRevision: 1,
                    renderRevision: 1,
                    wordIndex: 2,
                });
                expect(options).toEqual({
                    documentId: 'content-document-1',
                    frameId: 0,
                });
                expect(
                    service.acceptSelectionSnapshot(
                        identity,
                        createSelectionSnapshot({
                            selectionRevision: 2,
                            reason: 'remove',
                            entries: Object.freeze([
                                Object.freeze({
                                    wordIndex: 5,
                                    word: 'very',
                                }),
                            ]),
                        })
                    )
                ).toBe(true);
                return buildSidePanelSelectionRemovalCommandResponse(
                    command,
                    'applied'
                );
            }
        );

        port.onMessage.emit(
            buildSidePanelSelectionRemovalRequestMessage(removal)
        );
        await flushPortMessages();
        await flushPortMessages();

        expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1);
        expect(port.postMessage).toHaveBeenCalledTimes(2);
        expect(port.postMessage.mock.calls[0][0].data.selection).toEqual({
            selectionOwnerGeneration: 1,
            selectionRevision: 2,
            renderRevision: 1,
            reason: 'remove',
            entries: [{ wordIndex: 5, word: 'very' }],
        });
        expect(
            parseSidePanelSelectionRemovalResultMessage(
                port.postMessage.mock.calls[1][0],
                removal
            )
        ).toEqual({
            binding: removal.binding,
            requestId: 41,
            selectionOwnerGeneration: 1,
            status: 'applied',
        });
        expect(service.selectionRemovalFlightsByPort).toHaveProperty('size', 0);
    });

    test('reports a canonical content rejection without mutating authority', async () => {
        const { owner, port, removal, service } = createBoundRemovalHarness();
        chrome.tabs.sendMessage.mockImplementation(async (_tabId, message) => {
            const command =
                parseSidePanelSelectionRemovalCommandMessage(message);
            return buildSidePanelSelectionRemovalCommandResponse(
                command,
                'rejected'
            );
        });

        port.onMessage.emit(
            buildSidePanelSelectionRemovalRequestMessage(removal)
        );
        await flushPortMessages();
        await flushPortMessages();

        expect(service.selectionOwnersByTab.get(7)).toBe(owner);
        expect(
            parseSidePanelSelectionRemovalResultMessage(
                port.postMessage.mock.calls[0][0],
                removal
            )?.status
        ).toBe('rejected');
    });

    test.each([
        ['owner generation', { selectionOwnerGeneration: 2 }],
        ['selection revision', { selectionRevision: 2 }],
        ['render revision', { renderRevision: 2 }],
        ['unselected occurrence', { wordIndex: 3 }],
    ])(
        'rejects a request with stale %s before contacting content',
        async (_label, overrides) => {
            const { port, removal } = createBoundRemovalHarness();
            const staleRemoval = Object.freeze({
                ...removal,
                ...overrides,
            });

            port.onMessage.emit(
                buildSidePanelSelectionRemovalRequestMessage(staleRemoval)
            );
            await flushPortMessages();

            expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
            expect(
                parseSidePanelSelectionRemovalResultMessage(
                    port.postMessage.mock.calls[0][0],
                    staleRemoval
                )?.status
            ).toBe('rejected');
        }
    );

    test.each([
        ['missing successor', null],
        [
            'wrong occurrence removed',
            {
                reason: 'remove',
                entries: Object.freeze([
                    Object.freeze({ wordIndex: 2, word: 'very' }),
                ]),
            },
        ],
        [
            'wrong successor reason',
            {
                reason: 'toggle',
                entries: Object.freeze([
                    Object.freeze({ wordIndex: 5, word: 'very' }),
                ]),
            },
        ],
    ])(
        'rejects an applied response with %s',
        async (_label, successorOverrides) => {
            const { identity, port, removal, service } =
                createBoundRemovalHarness();
            chrome.tabs.sendMessage.mockImplementation(
                async (_tabId, message) => {
                    const command =
                        parseSidePanelSelectionRemovalCommandMessage(message);
                    if (successorOverrides) {
                        expect(
                            service.acceptSelectionSnapshot(
                                identity,
                                createSelectionSnapshot({
                                    selectionRevision: 2,
                                    ...successorOverrides,
                                })
                            )
                        ).toBe(true);
                    }
                    return buildSidePanelSelectionRemovalCommandResponse(
                        command,
                        'applied'
                    );
                }
            );

            port.onMessage.emit(
                buildSidePanelSelectionRemovalRequestMessage(removal)
            );
            await flushPortMessages();
            await flushPortMessages();

            const terminal = port.postMessage.mock.calls
                .map(([message]) =>
                    parseSidePanelSelectionRemovalResultMessage(
                        message,
                        removal
                    )
                )
                .find(Boolean);
            expect(terminal?.status).toBe('rejected');
        }
    );

    test.each([
        [
            'malformed response',
            () => ({ success: true, requestId: 41, extra: true }),
        ],
        ['transport failure', () => Promise.reject(new Error('tab closed'))],
    ])('reports rejected after a %s', async (_label, respond) => {
        const { owner, port, removal, service } = createBoundRemovalHarness();
        chrome.tabs.sendMessage.mockImplementation(respond);

        port.onMessage.emit(
            buildSidePanelSelectionRemovalRequestMessage(removal)
        );
        await flushPortMessages();
        await flushPortMessages();

        expect(service.selectionOwnersByTab.get(7)).toBe(owner);
        expect(
            parseSidePanelSelectionRemovalResultMessage(
                port.postMessage.mock.calls[0][0],
                removal
            )?.status
        ).toBe('rejected');
    });

    test('coalesces a duplicate request while its exact flight is pending', async () => {
        const pendingResponse = deferred();
        const { identity, port, removal, service } =
            createBoundRemovalHarness();
        chrome.tabs.sendMessage.mockReturnValue(pendingResponse.promise);
        const message = buildSidePanelSelectionRemovalRequestMessage(removal);

        port.onMessage.emit(message);
        port.onMessage.emit(message);
        await flushPortMessages();

        expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1);
        const command = parseSidePanelSelectionRemovalCommandMessage(
            chrome.tabs.sendMessage.mock.calls[0][1]
        );
        expect(
            service.acceptSelectionSnapshot(
                identity,
                createSelectionSnapshot({
                    selectionRevision: 2,
                    reason: 'remove',
                    entries: Object.freeze([
                        Object.freeze({ wordIndex: 5, word: 'very' }),
                    ]),
                })
            )
        ).toBe(true);
        pendingResponse.resolve(
            buildSidePanelSelectionRemovalCommandResponse(command, 'applied')
        );
        await pendingResponse.promise;
        await flushPortMessages();
        await flushPortMessages();

        expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1);
        const terminals = port.postMessage.mock.calls.filter(
            ([posted]) =>
                parseSidePanelSelectionRemovalResultMessage(posted, removal)
                    ?.status === 'applied'
        );
        expect(terminals).toHaveLength(1);
        expect(service.selectionRemovalFlightsByPort).toHaveProperty('size', 0);
    });

    test('admits one removal flight and synchronously rejects a flood of distinct requests behind it', async () => {
        const pendingResponse = deferred();
        const { port, removal, service } = createBoundRemovalHarness();
        chrome.tabs.sendMessage.mockReturnValue(pendingResponse.promise);
        const firstMessage =
            buildSidePanelSelectionRemovalRequestMessage(removal);

        port.onMessage.emit(firstMessage);
        await flushPortMessages();
        expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1);
        expect(service.selectionRemovalFlightsByPort).toHaveProperty('size', 1);

        for (let index = 0; index < 12; index += 1) {
            port.onMessage.emit(firstMessage);
        }
        expect(port.postMessage).not.toHaveBeenCalled();

        const distinctRemovals = Array.from({ length: 24 }, (_, index) =>
            Object.freeze({
                ...removal,
                requestId: removal.requestId + index + 1,
            })
        );
        for (const distinctRemoval of distinctRemovals) {
            port.onMessage.emit(
                buildSidePanelSelectionRemovalRequestMessage(distinctRemoval)
            );
        }

        expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1);
        expect(service.selectionRemovalFlightsByPort).toHaveProperty('size', 1);
        expect(port.postMessage).toHaveBeenCalledTimes(distinctRemovals.length);
        for (const [index, distinctRemoval] of distinctRemovals.entries()) {
            expect(
                parseSidePanelSelectionRemovalResultMessage(
                    port.postMessage.mock.calls[index][0],
                    distinctRemoval
                )?.status
            ).toBe('rejected');
        }

        pendingResponse.resolve({});
        await pendingResponse.promise;
        await flushPortMessages();
        await flushPortMessages();

        expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1);
        expect(service.selectionRemovalFlightsByPort).toHaveProperty('size', 0);
    });

    test('suppresses an old result and preserves a newer reentrant binding', async () => {
        const { port, removal, service } = createBoundRemovalHarness();
        let newerClaim;
        chrome.tabs.sendMessage.mockImplementation(async (_tabId, message) => {
            newerClaim = bindAuthorizedPortForTest(service, port, 8, 2);
            const command =
                parseSidePanelSelectionRemovalCommandMessage(message);
            return buildSidePanelSelectionRemovalCommandResponse(
                command,
                'rejected'
            );
        });

        port.onMessage.emit(
            buildSidePanelSelectionRemovalRequestMessage(removal)
        );
        await flushPortMessages();
        await flushPortMessages();

        expect(service.bindingByPort.get(port)).toMatchObject({
            registrationId: newerClaim.registrationId,
            tabId: 8,
            windowId: 2,
        });
        expect(port.disconnect).not.toHaveBeenCalled();
        expect(port.postMessage).not.toHaveBeenCalled();
    });

    test('rejects an old applied result while preserving a newer content owner', async () => {
        const { port, removal, service } = createBoundRemovalHarness();
        chrome.tabs.sendMessage.mockImplementation(async (_tabId, message) => {
            expect(
                service.acceptSelectionSnapshot(
                    createContentIdentity({
                        documentId: 'content-document-2',
                    }),
                    createSelectionSnapshot()
                )
            ).toBe(true);
            const command =
                parseSidePanelSelectionRemovalCommandMessage(message);
            return buildSidePanelSelectionRemovalCommandResponse(
                command,
                'applied'
            );
        });

        port.onMessage.emit(
            buildSidePanelSelectionRemovalRequestMessage(removal)
        );
        await flushPortMessages();
        await flushPortMessages();

        expect(
            service.selectionOwnersByTab.get(7).selectionOwnerGeneration
        ).toBe(2);
        const terminal = port.postMessage.mock.calls
            .map(([message]) =>
                parseSidePanelSelectionRemovalResultMessage(message, removal)
            )
            .find(Boolean);
        expect(terminal?.status).toBe('rejected');
        expect(port.disconnect).not.toHaveBeenCalled();
    });

    test('does not accept a removal request for another binding', async () => {
        const { port, removal } = createBoundRemovalHarness();
        const wrongBindingRemoval = Object.freeze({
            ...removal,
            binding: Object.freeze({
                ...removal.binding,
                registrationId: removal.binding.registrationId + 1,
            }),
        });

        port.onMessage.emit(
            buildSidePanelSelectionRemovalRequestMessage(wrongBindingRemoval)
        );
        await flushPortMessages();

        expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
        expect(port.postMessage).not.toHaveBeenCalled();
        expect(port.disconnect).not.toHaveBeenCalled();
    });

    test('revokes a port that sends a noncanonical update envelope', async () => {
        const { port, removal } = createBoundRemovalHarness();
        port.onMessage.emit({
            action: MessageActions.SIDEPANEL_UPDATE_STATE,
            data: { ...removal, selectedWords: ['forbidden'] },
        });
        await flushPortMessages();

        expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
        expect(port.disconnect).toHaveBeenCalledTimes(1);
    });

    test('preserves a newer binding installed reentrantly during terminal delivery', async () => {
        const { identity, port, removal, service } =
            createBoundRemovalHarness();
        let newerClaim;
        port.postMessage.mockImplementation((message) => {
            const terminal = parseSidePanelSelectionRemovalResultMessage(
                message,
                removal
            );
            if (terminal) {
                newerClaim = bindAuthorizedPortForTest(service, port, 8, 2);
            }
        });
        chrome.tabs.sendMessage.mockImplementation(async (_tabId, message) => {
            const command =
                parseSidePanelSelectionRemovalCommandMessage(message);
            expect(
                service.acceptSelectionSnapshot(
                    identity,
                    createSelectionSnapshot({
                        selectionRevision: 2,
                        reason: 'remove',
                        entries: Object.freeze([
                            Object.freeze({ wordIndex: 5, word: 'very' }),
                        ]),
                    })
                )
            ).toBe(true);
            return buildSidePanelSelectionRemovalCommandResponse(
                command,
                'applied'
            );
        });

        port.onMessage.emit(
            buildSidePanelSelectionRemovalRequestMessage(removal)
        );
        await flushPortMessages();
        await flushPortMessages();

        expect(newerClaim).toBeDefined();
        expect(service.bindingByPort.get(port)).toMatchObject({
            registrationId: newerClaim.registrationId,
            tabId: 8,
            windowId: 2,
        });
        expect(port.disconnect).not.toHaveBeenCalled();
    });
});

describe('SidePanelService word-click behavior', () => {
    test('force-binds only a still-active tab with current window authority', async () => {
        global.chrome = {
            tabs: {
                sendMessage: jest.fn(),
                get: jest
                    .fn()
                    .mockResolvedValue({ active: true, id: 23, windowId: 2 }),
            },
            sidePanel: {
                open: jest.fn().mockResolvedValue(),
            },
        };
        const service = new SidePanelService();
        const port = { postMessage: jest.fn() };
        service.activeConnectionsByWindow.set(2, new Set([port]));
        service.recordWindowActivation({ tabId: 23, windowId: 2 });

        await service.openSidePanelImmediate(23, {
            autoOpen: true,
            pauseVideo: false,
        });

        expect(port.postMessage).toHaveBeenCalledTimes(1);
        expect(
            parseSidePanelForceBindTabMessage(port.postMessage.mock.calls[0][0])
        ).toEqual({ tabId: 23, windowId: 2 });
        expect(port.postMessage).toHaveBeenCalledWith(
            buildSidePanelForceBindTabMessage({ tabId: 23, windowId: 2 })
        );
    });

    test('does not force-bind an inactive tab returned by tabs.get', async () => {
        global.chrome = {
            tabs: {
                sendMessage: jest.fn(),
                get: jest
                    .fn()
                    .mockResolvedValue({ active: false, id: 23, windowId: 2 }),
            },
            sidePanel: {
                open: jest.fn().mockResolvedValue(),
            },
        };
        const service = new SidePanelService();
        const port = { postMessage: jest.fn() };
        service.activeConnectionsByWindow.set(2, new Set([port]));
        service.recordWindowActivation({ tabId: 23, windowId: 2 });

        await service.openSidePanelImmediate(23, {
            autoOpen: true,
            pauseVideo: false,
        });

        expect(port.postMessage).not.toHaveBeenCalled();
    });

    test('does not let a stale force-bind completion overwrite a newer activation', async () => {
        const pendingTab = deferred();
        global.chrome = {
            tabs: {
                sendMessage: jest.fn(),
                get: jest.fn(() => pendingTab.promise),
            },
            sidePanel: {
                open: jest.fn().mockResolvedValue(),
            },
        };
        const service = new SidePanelService();
        const port = { postMessage: jest.fn() };
        service.activeConnectionsByWindow.set(2, new Set([port]));
        service.recordWindowActivation({ tabId: 23, windowId: 2 });

        const opening = service.openSidePanelImmediate(23, {
            autoOpen: true,
            pauseVideo: false,
        });
        await flushPortMessages();
        expect(chrome.tabs.get).toHaveBeenCalledWith(23);

        service.recordWindowActivation({ tabId: 24, windowId: 2 });
        pendingTab.resolve({ active: true, id: 23, windowId: 2 });
        await opening;

        expect(port.postMessage).not.toHaveBeenCalled();
    });

    test('honors gesture-time auto-open and auto-pause snapshots', async () => {
        global.chrome = {
            tabs: {
                sendMessage: jest.fn().mockResolvedValue({ success: true }),
                get: jest.fn().mockResolvedValue({ id: 23, windowId: 2 }),
            },
            sidePanel: {
                open: jest.fn().mockResolvedValue(),
            },
        };
        const service = new SidePanelService();

        const suppressed = await service.openSidePanelImmediate(23, {
            autoOpen: false,
            pauseVideo: false,
        });
        expect(suppressed).toEqual({
            success: true,
            pauseRequested: false,
            pauseSucceeded: null,
        });
        expect(chrome.sidePanel.open).not.toHaveBeenCalled();

        const openedWithoutPause = await service.openSidePanelImmediate(23, {
            autoOpen: true,
            pauseVideo: false,
        });
        expect(openedWithoutPause).toEqual({
            success: true,
            pauseRequested: false,
            pauseSucceeded: null,
        });
        expect(chrome.sidePanel.open).toHaveBeenCalledTimes(1);
        expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    });

    test('claims a non-opening side-panel route and still honors its pause snapshot', async () => {
        global.chrome = {
            tabs: {
                sendMessage: jest.fn().mockResolvedValue({
                    action: MessageActions.SIDEPANEL_PAUSE_VIDEO,
                    success: true,
                }),
                get: jest.fn(),
            },
            sidePanel: {
                open: jest.fn(),
            },
        };
        const service = new SidePanelService();

        await expect(
            service.openSidePanelImmediate(23, {
                autoOpen: false,
                pauseVideo: true,
            })
        ).resolves.toEqual({
            success: true,
            pauseRequested: true,
            pauseSucceeded: true,
        });
        expect(chrome.sidePanel.open).not.toHaveBeenCalled();
        expect(chrome.tabs.get).not.toHaveBeenCalled();
        expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(23, {
            action: MessageActions.SIDEPANEL_PAUSE_VIDEO,
        });
    });
});

describe('SidePanelService playback results', () => {
    test('returns false when the content script rejects the pause', async () => {
        global.chrome = {
            tabs: {
                sendMessage: jest.fn().mockResolvedValue({
                    action: MessageActions.SIDEPANEL_PAUSE_VIDEO,
                    success: false,
                    error: 'not paused',
                }),
            },
        };
        const service = new SidePanelService();

        await expect(service.pauseVideo(31)).resolves.toBe(false);
    });

    test('returns false for missing responses and rejected tab messages', async () => {
        global.chrome = {
            tabs: {
                sendMessage: jest.fn().mockResolvedValue(undefined),
            },
        };
        const service = new SidePanelService();

        await expect(service.pauseVideo(32)).resolves.toBe(false);

        chrome.tabs.sendMessage.mockRejectedValue(new Error('tab closed'));
        await expect(service.pauseVideo(32)).resolves.toBe(false);
    });

    test('returns true only for a verified successful content response', async () => {
        global.chrome = {
            tabs: {
                sendMessage: jest.fn().mockResolvedValue({
                    action: MessageActions.SIDEPANEL_PAUSE_VIDEO,
                    success: true,
                }),
            },
        };
        const service = new SidePanelService();

        await expect(service.pauseVideo(33)).resolves.toBe(true);
        expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(33, {
            action: MessageActions.SIDEPANEL_PAUSE_VIDEO,
        });
    });

    test('rejects a stale success response for another content-control action', async () => {
        global.chrome = {
            tabs: {
                sendMessage: jest.fn().mockResolvedValue({
                    action: MessageActions.CONFIG_CHANGED,
                    success: true,
                }),
            },
        };
        const service = new SidePanelService();

        await expect(service.pauseVideo(35)).resolves.toBe(false);
    });

    test('keeps panel opening successful when the requested pause fails', async () => {
        global.chrome = {
            tabs: {
                sendMessage: jest.fn().mockResolvedValue({ success: false }),
                get: jest.fn().mockResolvedValue({ id: 34, windowId: 2 }),
            },
            sidePanel: {
                open: jest.fn().mockResolvedValue(undefined),
            },
        };
        const service = new SidePanelService();
        service.behaviorConfig = {
            sidePanelUseSidePanel: true,
            sidePanelAutoOpen: true,
            sidePanelAutoPauseVideo: true,
        };

        await expect(
            service.openSidePanelImmediate(34, {
                autoOpen: true,
                pauseVideo: true,
            })
        ).resolves.toEqual({
            success: true,
            pauseRequested: true,
            pauseSucceeded: false,
        });
        expect(chrome.sidePanel.open).toHaveBeenCalledWith({ tabId: 34 });
    });
});
