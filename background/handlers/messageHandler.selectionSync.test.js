import { jest } from '@jest/globals';
import { MessageHandler } from './messageHandler.js';
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
    test('accepts a detached snapshot synchronously without readiness dispatch', () => {
        const listeners = setupChrome();
        const readiness = {
            isReady: jest.fn(() => false),
            waitUntilReady: jest.fn(),
        };
        const acceptSelectionSnapshot = jest.fn(() => true);
        const handler = new MessageHandler();
        handler.setServices({
            sidePanelService: { acceptSelectionSnapshot },
        });
        handler.initialize(readiness);
        const message = createSelectionMessage();
        const sender = createContentSender();
        const sendResponse = jest.fn();

        expect(listeners[0](message, sender, sendResponse)).toBe(false);
        expect(readiness.isReady).not.toHaveBeenCalled();
        expect(readiness.waitUntilReady).not.toHaveBeenCalled();
        expect(acceptSelectionSnapshot).toHaveBeenCalledTimes(1);

        const [receivedSender, receivedSnapshot] =
            acceptSelectionSnapshot.mock.calls[0];
        expect(receivedSender).toEqual({
            role: 'content',
            platform: 'netflix',
            tabId: 7,
            windowId: 3,
            documentId: 'selection-document-1',
            documentLifecycle: 'active',
            frameId: 0,
        });
        expect(receivedSnapshot).toEqual(message.data);
        expect(receivedSnapshot).not.toBe(message.data);
        expect(receivedSnapshot.entries).not.toBe(message.data.entries);
        expect(Object.isFrozen(receivedSender)).toBe(true);
        expect(Object.isFrozen(receivedSnapshot)).toBe(true);
        expect(Object.isFrozen(receivedSnapshot.entries)).toBe(true);
        expect(sendResponse).toHaveBeenCalledWith({ success: true });
    });

    test.each([
        {
            name: 'non-content sender',
            sender: {
                id: EXTENSION_ID,
                origin: EXTENSION_ORIGIN,
                url: `${EXTENSION_ORIGIN}/sidepanel/sidepanel.html`,
            },
            service: jest.fn(() => true),
        },
        {
            name: 'inexact snapshot',
            message: createSelectionMessage({ unexpected: true }),
            sender: createContentSender(),
            service: jest.fn(() => true),
        },
        {
            name: 'service rejection',
            sender: createContentSender(),
            service: jest.fn(() => false),
        },
        {
            name: 'service exception',
            sender: createContentSender(),
            service: jest.fn(() => {
                throw new Error('private service failure');
            }),
        },
    ])('returns one fixed rejection for a $name', (scenario) => {
        const listeners = setupChrome();
        const handler = new MessageHandler();
        handler.setServices({
            sidePanelService: {
                acceptSelectionSnapshot: scenario.service,
            },
        });
        handler.initialize();
        const sendResponse = jest.fn();

        expect(
            listeners[0](
                scenario.message ?? createSelectionMessage(),
                scenario.sender,
                sendResponse
            )
        ).toBe(false);
        expect(sendResponse).toHaveBeenCalledTimes(1);
        expect(sendResponse).toHaveBeenCalledWith({ success: false });
    });
});
