import { jest } from '@jest/globals';
import { MessageHandler } from './messageHandler.js';
import { BackgroundServiceReadiness } from '../serviceReadiness.js';
import { MessageActions } from '../../content_scripts/shared/constants/messageActions.js';
import {
    buildBackgroundReadinessRequestMessage,
    buildSidePanelWordIntentMessage,
} from '../../content_scripts/shared/protocol/messageProtocol.js';

const EXTENSION_ID = 'dualsub-test-extension';
const EXTENSION_ORIGIN = `chrome-extension://${EXTENSION_ID}`;
const TEST_MANIFEST = Object.freeze({
    action: Object.freeze({ default_popup: 'popup/popup.html' }),
    background: Object.freeze({ service_worker: 'background.js' }),
    options_ui: Object.freeze({ page: 'options/options.html' }),
    side_panel: Object.freeze({ default_path: 'sidepanel/sidepanel.html' }),
});

function createContentSender(overrides = {}) {
    return {
        documentId: 'word-intent-document',
        documentLifecycle: 'active',
        frameId: 0,
        id: EXTENSION_ID,
        origin: 'https://www.netflix.com',
        tab: {
            active: true,
            id: 42,
            url: 'https://www.netflix.com/watch/80123456?tab=1',
            windowId: 3,
        },
        url: 'https://www.netflix.com/watch/80123456?sender=1',
        ...overrides,
    };
}

describe('MessageHandler service-worker lifecycle', () => {
    test('reports exact cold service state without deferring the readiness probe', () => {
        const listeners = [];
        global.chrome = {
            runtime: {
                id: EXTENSION_ID,
                getManifest: () => TEST_MANIFEST,
                getURL: (path = '') => `${EXTENSION_ORIGIN}/${path}`,
                onMessage: {
                    addListener: jest.fn((listener) =>
                        listeners.push(listener)
                    ),
                    removeListener: jest.fn(),
                },
            },
        };

        const readiness = new BackgroundServiceReadiness();
        const handler = new MessageHandler();
        handler.initialize(readiness);

        expect(listeners).toHaveLength(1);

        const sendResponse = jest.fn();
        const keepsChannelOpen = listeners[0](
            buildBackgroundReadinessRequestMessage(MessageActions.PING),
            createContentSender(),
            sendResponse
        );

        expect(keepsChannelOpen).toBe(false);
        expect(sendResponse).toHaveBeenCalledWith({
            action: MessageActions.PING,
            ready: false,
            services: {
                translation: false,
                subtitle: false,
                aiContext: false,
                aiContextInitialized: false,
            },
        });
    });

    test('opens a canonical word intent synchronously while unrelated services are cold', async () => {
        const listeners = [];
        let originalGestureActive = true;
        global.chrome = {
            runtime: {
                id: EXTENSION_ID,
                getManifest: () => TEST_MANIFEST,
                getURL: (path = '') => `${EXTENSION_ORIGIN}/${path}`,
                onMessage: {
                    addListener: jest.fn((listener) =>
                        listeners.push(listener)
                    ),
                    removeListener: jest.fn(),
                },
            },
            sidePanel: {
                open: jest.fn(() => {
                    expect(originalGestureActive).toBe(true);
                    return Promise.resolve();
                }),
            },
        };
        const sidePanelService = {
            openSidePanelImmediate: jest.fn((tabId, options) => {
                expect(options).toEqual({
                    autoOpen: true,
                    pauseVideo: false,
                });
                const operation = chrome.sidePanel.open({ tabId });
                return operation.then(() => ({ success: true }));
            }),
        };
        const readiness = new BackgroundServiceReadiness();
        const handler = new MessageHandler();
        handler.setServices({ sidePanelService });
        handler.initialize(readiness);
        const sendResponse = jest.fn();

        const keepsChannelOpen = listeners[0](
            buildSidePanelWordIntentMessage({
                autoOpen: true,
                pauseVideo: false,
            }),
            createContentSender(),
            sendResponse
        );
        originalGestureActive = false;

        expect(keepsChannelOpen).toBe(true);
        expect(chrome.sidePanel.open).toHaveBeenCalledWith({ tabId: 42 });
        expect(sidePanelService.openSidePanelImmediate).toHaveBeenCalledWith(
            42,
            {
                autoOpen: true,
                pauseVideo: false,
            }
        );
        expect(sendResponse).not.toHaveBeenCalled();

        await Promise.resolve();
        await Promise.resolve();

        expect(sendResponse).toHaveBeenCalledWith({ success: true });
    });

    test.each([
        [
            'raw word metadata',
            {
                action: MessageActions.SIDEPANEL_WORD_SELECTED,
                options: { autoOpen: true, pauseVideo: false },
                word: 'private-word',
            },
            createContentSender(),
        ],
        [
            'an inactive content tab',
            buildSidePanelWordIntentMessage({
                autoOpen: true,
                pauseVideo: false,
            }),
            createContentSender({
                tab: { ...createContentSender().tab, active: false },
            }),
        ],
        [
            'a content subframe',
            buildSidePanelWordIntentMessage({
                autoOpen: true,
                pauseVideo: false,
            }),
            createContentSender({ frameId: 1 }),
        ],
    ])(
        'rejects %s before the gesture side effect',
        (_label, message, sender) => {
            const listeners = [];
            global.chrome = {
                runtime: {
                    id: EXTENSION_ID,
                    getManifest: () => TEST_MANIFEST,
                    getURL: (path = '') => `${EXTENSION_ORIGIN}/${path}`,
                    onMessage: {
                        addListener: jest.fn((listener) =>
                            listeners.push(listener)
                        ),
                        removeListener: jest.fn(),
                    },
                },
            };
            const openSidePanelImmediate = jest.fn();
            const handler = new MessageHandler();
            handler.setServices({
                sidePanelService: { openSidePanelImmediate },
            });
            handler.initialize(new BackgroundServiceReadiness());
            const sendResponse = jest.fn();

            const keepsChannelOpen = listeners[0](
                message,
                sender,
                sendResponse
            );

            expect(keepsChannelOpen).toBe(false);
            expect(openSidePanelImmediate).not.toHaveBeenCalled();
            expect(sendResponse).toHaveBeenCalledWith({ success: false });
        }
    );

    test('does not retain a generic ANALYZE_CONTEXT dispatch fallback', () => {
        global.chrome = {
            runtime: {
                onMessage: {
                    addListener: jest.fn(),
                    removeListener: jest.fn(),
                },
            },
        };
        const analyzeContext = jest.fn();
        const handler = new MessageHandler();
        handler.initialize();
        handler.setServices({
            aiContextService: { analyzeContext },
        });
        const sendResponse = jest.fn();

        const keepsChannelOpen = handler.handleMessage(
            { action: MessageActions.ANALYZE_CONTEXT },
            {},
            sendResponse,
            MessageActions.ANALYZE_CONTEXT
        );

        expect(keepsChannelOpen).toBe(false);
        expect(analyzeContext).not.toHaveBeenCalled();
        expect(sendResponse).not.toHaveBeenCalled();
    });
});
