import { jest } from '@jest/globals';
import { MessageHandler } from './messageHandler.js';
import { BackgroundServiceReadiness } from '../serviceReadiness.js';
import { MessageActions } from '../../content_scripts/shared/constants/messageActions.js';
import { buildSidePanelWordIntentMessage } from '../../content_scripts/shared/protocol/messageProtocol.js';

const EXTENSION_ID = 'dualsub-test-extension';
const EXTENSION_ORIGIN = `chrome-extension://${EXTENSION_ID}`;
const TEST_MANIFEST = Object.freeze({
    action: Object.freeze({ default_popup: 'popup/popup.html' }),
    background: Object.freeze({ service_worker: 'background.js' }),
    options_ui: Object.freeze({ page: 'options/options.html' }),
    side_panel: Object.freeze({ default_path: 'sidepanel/sidepanel.html' }),
});

function setupChrome({ sidePanel } = {}) {
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
        ...(sidePanel ? { sidePanel } : {}),
    };
    return listeners;
}

function createContentSender() {
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
    };
}

describe('MessageHandler service-worker lifecycle', () => {
    test('opens a word intent synchronously while unrelated services are cold', async () => {
        let gestureActive = true;
        const open = jest.fn(() => {
            expect(gestureActive).toBe(true);
            return Promise.resolve();
        });
        const listeners = setupChrome({ sidePanel: { open } });
        const openSidePanelImmediate = jest.fn((tabId, options) => {
            expect(options).toEqual({ autoOpen: true, pauseVideo: false });
            return chrome.sidePanel.open({ tabId }).then(() => ({
                success: true,
            }));
        });
        const handler = new MessageHandler();
        handler.setServices({ sidePanelService: { openSidePanelImmediate } });
        handler.initialize(new BackgroundServiceReadiness());
        const sendResponse = jest.fn();

        expect(
            listeners[0](
                buildSidePanelWordIntentMessage({
                    autoOpen: true,
                    pauseVideo: false,
                }),
                createContentSender(),
                sendResponse
            )
        ).toBe(true);
        gestureActive = false;

        expect(open).toHaveBeenCalledWith({ tabId: 42 });
        expect(openSidePanelImmediate).toHaveBeenCalledTimes(1);
        await Promise.resolve();
        await Promise.resolve();
        expect(sendResponse).toHaveBeenCalledWith({ success: true });
    });

    test('a saved listener cannot dispatch after destroy and reinitialize', () => {
        const listeners = setupChrome();
        const subtitleService = {
            processDisneyPlusSubtitles: jest.fn(),
        };
        const handler = new MessageHandler();
        handler.setServices({ subtitleService });
        handler.initialize();
        const staleListener = listeners[0];
        handler.destroy();
        handler.initialize();
        const sendResponse = jest.fn();

        expect(
            staleListener(
                { action: MessageActions.FETCH_VTT },
                createContentSender(),
                sendResponse
            )
        ).toBe(false);
        expect(
            subtitleService.processDisneyPlusSubtitles
        ).not.toHaveBeenCalled();
        expect(sendResponse).toHaveBeenCalledWith({
            success: false,
            error: 'Subtitle request rejected',
        });
    });
});
