import { jest } from '@jest/globals';
import { MessageHandler } from './messageHandler.js';
import { BackgroundServiceReadiness } from '../serviceReadiness.js';
import { MessageActions } from '../../content_scripts/shared/constants/messageActions.js';

const EXTENSION_ID = 'dualsub-test-extension';
const EXTENSION_ORIGIN = `chrome-extension://${EXTENSION_ID}`;
const TEST_MANIFEST = Object.freeze({
    action: Object.freeze({ default_popup: 'popup/popup.html' }),
    background: Object.freeze({ service_worker: 'background.js' }),
    options_ui: Object.freeze({ page: 'options/options.html' }),
    side_panel: Object.freeze({ default_path: 'sidepanel/sidepanel.html' }),
});

function setupChrome() {
    const listeners = [];
    global.chrome = {
        runtime: {
            id: EXTENSION_ID,
            getManifest: () => TEST_MANIFEST,
            getURL: (path = '') => `${EXTENSION_ORIGIN}/${path}`,
            onMessage: {
                addListener: jest.fn((listener) => listeners.push(listener)),
                removeListener: jest.fn(),
            },
        },
    };
    return listeners;
}

function createContentSender(overrides = {}) {
    return {
        documentId: 'selection-document-1',
        documentLifecycle: 'active',
        frameId: 0,
        id: EXTENSION_ID,
        origin: 'https://www.netflix.com',
        tab: {
            active: true,
            id: 7,
            url: 'https://www.netflix.com/watch/80123456?tab=1',
            windowId: 3,
        },
        url: 'https://www.netflix.com/watch/80123456?sender=1',
        ...overrides,
    };
}

function createSelectionMessage(overrides = {}) {
    return {
        action: MessageActions.SIDEPANEL_SELECTION_SYNC,
        data: {
            lifecycleGeneration: 3,
            selectionRevision: 5,
            renderRevision: 7,
            reason: 'toggle',
            entries: [{ wordIndex: 1, word: 'echo' }],
            ...overrides,
        },
    };
}

describe('MessageHandler SIDEPANEL_SELECTION_SYNC ingress', () => {
    test('accepts one canonical content snapshot synchronously', () => {
        const listeners = setupChrome();
        const acceptSelectionSnapshot = jest.fn(() => true);
        const handler = new MessageHandler();
        handler.setServices({
            sidePanelService: { acceptSelectionSnapshot },
        });
        handler.initialize();
        const sendResponse = jest.fn();

        const keepsChannelOpen = listeners[0](
            createSelectionMessage(),
            createContentSender(),
            sendResponse
        );

        expect(keepsChannelOpen).toBe(false);
        expect(acceptSelectionSnapshot).toHaveBeenCalledTimes(1);
        expect(acceptSelectionSnapshot).toHaveBeenCalledWith(
            {
                role: 'content',
                platform: 'netflix',
                tabId: 7,
                windowId: 3,
                documentId: 'selection-document-1',
                documentLifecycle: 'active',
                frameId: 0,
            },
            {
                lifecycleGeneration: 3,
                selectionRevision: 5,
                renderRevision: 7,
                reason: 'toggle',
                entries: [{ wordIndex: 1, word: 'echo' }],
            }
        );
        expect(sendResponse).toHaveBeenCalledTimes(1);
        expect(sendResponse).toHaveBeenCalledWith({ success: true });
    });

    test('accepts synchronously while unrelated background services are cold', () => {
        const listeners = setupChrome();
        const readiness = new BackgroundServiceReadiness();
        const acceptSelectionSnapshot = jest.fn(() => true);
        const handler = new MessageHandler();
        handler.setServices({
            sidePanelService: { acceptSelectionSnapshot },
        });
        handler.initialize(readiness);
        const sendResponse = jest.fn();

        const keepsChannelOpen = listeners[0](
            createSelectionMessage(),
            createContentSender(),
            sendResponse
        );

        expect(keepsChannelOpen).toBe(false);
        expect(acceptSelectionSnapshot).toHaveBeenCalledTimes(1);
        expect(sendResponse).toHaveBeenCalledTimes(1);
        expect(sendResponse).toHaveBeenCalledWith({ success: true });
    });

    test('rejects a destroyed listener after a new lifecycle starts', () => {
        const listeners = setupChrome();
        const acceptSelectionSnapshot = jest.fn(() => true);
        const handler = new MessageHandler();
        handler.setServices({
            sidePanelService: { acceptSelectionSnapshot },
        });
        handler.initialize();
        const staleListener = listeners[0];
        handler.destroy();
        handler.initialize();
        const sendResponse = jest.fn();

        const keepsChannelOpen = staleListener(
            createSelectionMessage(),
            createContentSender(),
            sendResponse
        );

        expect(keepsChannelOpen).toBe(false);
        expect(acceptSelectionSnapshot).not.toHaveBeenCalled();
        expect(sendResponse).toHaveBeenCalledTimes(1);
        expect(sendResponse).toHaveBeenCalledWith({ success: false });
    });

    test.each([
        [
            'a hostile sender',
            () => createSelectionMessage(),
            () =>
                new Proxy(createContentSender(), {
                    getOwnPropertyDescriptor() {
                        throw new Error('hostile sender trap');
                    },
                }),
        ],
        [
            'a side-panel sender',
            () => createSelectionMessage(),
            () => ({
                id: EXTENSION_ID,
                origin: EXTENSION_ORIGIN,
                url: `${EXTENSION_ORIGIN}/sidepanel/sidepanel.html`,
            }),
        ],
        [
            'an inactive content tab',
            () => createSelectionMessage(),
            () => ({
                ...createContentSender(),
                tab: { ...createContentSender().tab, active: false },
            }),
        ],
        [
            'a non-top content frame',
            () => createSelectionMessage(),
            () => createContentSender({ frameId: 1 }),
        ],
        [
            'an inexact selection snapshot',
            () => createSelectionMessage({ unexpected: 'caller metadata' }),
            () => createContentSender(),
        ],
    ])('rejects %s without service dispatch', (_label, message, sender) => {
        const listeners = setupChrome();
        const acceptSelectionSnapshot = jest.fn(() => true);
        const handler = new MessageHandler();
        handler.setServices({
            sidePanelService: { acceptSelectionSnapshot },
        });
        handler.initialize();
        const sendResponse = jest.fn();

        const keepsChannelOpen = listeners[0](
            message(),
            sender(),
            sendResponse
        );

        expect(keepsChannelOpen).toBe(false);
        expect(acceptSelectionSnapshot).not.toHaveBeenCalled();
        expect(sendResponse).toHaveBeenCalledTimes(1);
        expect(sendResponse).toHaveBeenCalledWith({ success: false });
    });

    test.each([
        ['a missing service', null],
        [
            'a throwing service',
            jest.fn(() => {
                throw new Error('private service failure');
            }),
        ],
        ['an exact false service result', jest.fn(() => false)],
        ['a truthy non-boolean service result', jest.fn(() => 'true')],
        [
            'an asynchronous service result',
            jest.fn(() => Promise.resolve(true)),
        ],
    ])('rejects %s with one fixed receipt', (_label, serviceMethod) => {
        const listeners = setupChrome();
        const handler = new MessageHandler();
        if (serviceMethod) {
            handler.setServices({
                sidePanelService: {
                    acceptSelectionSnapshot: serviceMethod,
                },
            });
        }
        handler.initialize();
        const sendResponse = jest.fn();

        const keepsChannelOpen = listeners[0](
            createSelectionMessage(),
            createContentSender(),
            sendResponse
        );

        expect(keepsChannelOpen).toBe(false);
        if (serviceMethod) {
            expect(serviceMethod).toHaveBeenCalledTimes(1);
        }
        expect(sendResponse).toHaveBeenCalledTimes(1);
        expect(sendResponse).toHaveBeenCalledWith({ success: false });
    });

    test('passes only detached frozen sender and selection snapshots', () => {
        const listeners = setupChrome();
        const acceptSelectionSnapshot = jest.fn(() => true);
        const handler = new MessageHandler();
        handler.setServices({
            sidePanelService: { acceptSelectionSnapshot },
        });
        handler.initialize();
        const sendResponse = jest.fn();
        const messageTarget = createSelectionMessage();
        const senderTarget = createContentSender();
        const message = Proxy.revocable(messageTarget, {});
        const sender = Proxy.revocable(senderTarget, {});

        listeners[0](message.proxy, sender.proxy, sendResponse);
        const [receivedSender, receivedSnapshot] =
            acceptSelectionSnapshot.mock.calls[0];

        expect(receivedSender).not.toBe(senderTarget);
        expect(receivedSnapshot).not.toBe(messageTarget.data);
        expect(Object.keys(receivedSender)).toEqual([
            'role',
            'platform',
            'tabId',
            'windowId',
            'documentId',
            'documentLifecycle',
            'frameId',
        ]);
        for (const value of [
            receivedSender,
            receivedSnapshot,
            receivedSnapshot.entries,
            ...receivedSnapshot.entries,
        ]) {
            expect(Object.isFrozen(value)).toBe(true);
        }

        senderTarget.documentId = 'mutated-document';
        senderTarget.tab.id = 99;
        senderTarget.url = 'https://example.com/secret';
        messageTarget.data.selectionRevision = 99;
        messageTarget.data.entries[0].word = 'mutated';
        message.revoke();
        sender.revoke();

        expect(receivedSender).toEqual({
            role: 'content',
            platform: 'netflix',
            tabId: 7,
            windowId: 3,
            documentId: 'selection-document-1',
            documentLifecycle: 'active',
            frameId: 0,
        });
        expect(receivedSnapshot).toEqual({
            lifecycleGeneration: 3,
            selectionRevision: 5,
            renderRevision: 7,
            reason: 'toggle',
            entries: [{ wordIndex: 1, word: 'echo' }],
        });
    });

    test('attempts a throwing response callback exactly once', () => {
        const listeners = setupChrome();
        const acceptSelectionSnapshot = jest.fn(() => true);
        const handler = new MessageHandler();
        handler.setServices({
            sidePanelService: { acceptSelectionSnapshot },
        });
        handler.initialize();
        const sendResponse = jest.fn(() => {
            throw new Error('receiver disappeared');
        });

        expect(() =>
            listeners[0](
                createSelectionMessage(),
                createContentSender(),
                sendResponse
            )
        ).not.toThrow();
        expect(acceptSelectionSnapshot).toHaveBeenCalledTimes(1);
        expect(sendResponse).toHaveBeenCalledTimes(1);
        expect(sendResponse).toHaveBeenCalledWith({ success: true });
    });

    test('does not enter the generic dispatcher or readiness queue', () => {
        const listeners = setupChrome();
        const readiness = {
            isReady: jest.fn(() => true),
            waitUntilReady: jest.fn(),
        };
        const acceptSelectionSnapshot = jest.fn(() => true);
        const handler = new MessageHandler();
        handler.setServices({
            sidePanelService: { acceptSelectionSnapshot },
        });
        handler.initialize(readiness);
        handler.handleMessage = jest.fn(() => {
            throw new Error('generic dispatcher must not run');
        });
        const sendResponse = jest.fn();

        const keepsChannelOpen = listeners[0](
            createSelectionMessage(),
            createContentSender(),
            sendResponse
        );

        expect(keepsChannelOpen).toBe(false);
        expect(handler.handleMessage).not.toHaveBeenCalled();
        expect(readiness.isReady).not.toHaveBeenCalled();
        expect(readiness.waitUntilReady).not.toHaveBeenCalled();
        expect(acceptSelectionSnapshot).toHaveBeenCalledTimes(1);
        expect(sendResponse).toHaveBeenCalledWith({ success: true });
    });
});
