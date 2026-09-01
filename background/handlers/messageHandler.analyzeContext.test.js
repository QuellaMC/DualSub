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

function createContentSender() {
    return {
        documentId: 'document-1',
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
    };
}

function createContentRequest(overrides = {}) {
    return {
        action: MessageActions.ANALYZE_CONTEXT,
        text: 'hello',
        contextTypes: ['cultural'],
        language: 'en',
        targetLanguage: 'zh-CN',
        platform: 'netflix',
        requestId: 'content-request-1',
        ...overrides,
    };
}

function createSidePanelSender() {
    return {
        id: EXTENSION_ID,
        origin: EXTENSION_ORIGIN,
        url: `${EXTENSION_ORIGIN}/sidepanel/sidepanel.html`,
    };
}

function createSidePanelRequest(overrides = {}) {
    return {
        action: MessageActions.ANALYZE_CONTEXT,
        text: 'panel words',
        contextTypes: ['historical'],
        targetLanguage: 'es',
        requestId: 'sidepanel-request-1',
        ...overrides,
    };
}

function deferred() {
    let resolve;
    const promise = new Promise((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

async function flushPromises() {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

describe('MessageHandler ANALYZE_CONTEXT ingress', () => {
    test.each([
        {
            name: 'content',
            createRequest: createContentRequest,
            createSender: createContentSender,
            serviceCall: [
                'hello',
                'cultural',
                {
                    platform: 'netflix',
                    requestedContextTypes: ['cultural'],
                    sourceLanguage: 'en',
                    targetLanguage: 'zh-CN',
                },
            ],
            response: {
                success: true,
                result: {
                    analysis: { summary: 'analysis' },
                },
            },
        },
        {
            name: 'side panel',
            createRequest: createSidePanelRequest,
            createSender: createSidePanelSender,
            serviceCall: [
                'panel words',
                'historical',
                {
                    requestedContextTypes: ['historical'],
                    sourceLanguage: 'auto',
                    targetLanguage: 'es',
                },
            ],
            response: {
                success: true,
                result: {
                    analysis: { summary: 'analysis' },
                },
            },
        },
    ])('accepts a canonical $name request', async (scenario) => {
        const listeners = setupChrome();
        const analyzeContext = jest.fn().mockResolvedValue({
            success: true,
            analysis: { summary: 'analysis' },
            provider: 'must-not-leak',
        });
        const handler = new MessageHandler();
        handler.setServices({ aiContextService: { analyzeContext } });
        handler.initialize();
        const sendResponse = jest.fn();

        expect(
            listeners[0](
                scenario.createRequest(),
                scenario.createSender(),
                sendResponse
            )
        ).toBe(true);
        await flushPromises();

        expect(analyzeContext).toHaveBeenCalledWith(...scenario.serviceCall);
        expect(sendResponse).toHaveBeenCalledWith(scenario.response);
    });

    test('rejects a content platform that differs from the sender route', () => {
        const listeners = setupChrome();
        const analyzeContext = jest.fn();
        const handler = new MessageHandler();
        handler.setServices({ aiContextService: { analyzeContext } });
        handler.initialize();
        const sendResponse = jest.fn();

        expect(
            listeners[0](
                createContentRequest({ platform: 'disneyplus' }),
                createContentSender(),
                sendResponse
            )
        ).toBe(false);
        expect(analyzeContext).not.toHaveBeenCalled();
        expect(sendResponse).toHaveBeenCalledWith({
            success: false,
            error: 'Context analysis rejected',
            shouldRetry: false,
        });
    });

    test('detaches a cold request before dispatching it after readiness', async () => {
        const listeners = setupChrome();
        const readiness = new BackgroundServiceReadiness();
        const analyzeContext = jest.fn().mockResolvedValue({
            success: true,
            analysis: { summary: 'cold snapshot' },
        });
        const handler = new MessageHandler();
        handler.setServices({ aiContextService: { analyzeContext } });
        handler.initialize(readiness);
        const message = createContentRequest();
        const sender = createContentSender();
        const sendResponse = jest.fn();

        expect(listeners[0](message, sender, sendResponse)).toBe(true);
        message.text = 'mutated';
        message.contextTypes[0] = 'linguistic';
        sender.tab.id = 99;

        readiness.markReady();
        await readiness.waitUntilReady();
        await flushPromises();

        expect(analyzeContext).toHaveBeenCalledWith(
            'hello',
            'cultural',
            expect.objectContaining({ requestedContextTypes: ['cultural'] })
        );
        expect(sendResponse).toHaveBeenCalledWith({
            success: true,
            result: { analysis: { summary: 'cold snapshot' } },
        });
    });

    test('destroy settles cold work once and prevents later dispatch', async () => {
        const listeners = setupChrome();
        const readiness = new BackgroundServiceReadiness();
        const analyzeContext = jest.fn();
        const handler = new MessageHandler();
        handler.setServices({ aiContextService: { analyzeContext } });
        handler.initialize(readiness);
        const sendResponse = jest.fn();

        listeners[0](
            createContentRequest(),
            createContentSender(),
            sendResponse
        );
        handler.destroy();

        expect(sendResponse).toHaveBeenCalledWith({
            success: false,
            error: 'Context analysis unavailable',
            shouldRetry: false,
        });

        readiness.markReady();
        await readiness.waitUntilReady();
        await flushPromises();
        expect(analyzeContext).not.toHaveBeenCalled();
        expect(sendResponse).toHaveBeenCalledTimes(1);
    });

    test('destroy ignores a late in-flight analysis result', async () => {
        const listeners = setupChrome();
        const pending = deferred();
        const analyzeContext = jest.fn(() => pending.promise);
        const handler = new MessageHandler();
        handler.setServices({ aiContextService: { analyzeContext } });
        handler.initialize();
        const sendResponse = jest.fn();

        listeners[0](
            createContentRequest(),
            createContentSender(),
            sendResponse
        );
        handler.destroy();
        pending.resolve({
            success: true,
            analysis: { summary: 'late secret result' },
        });
        await pending.promise;
        await flushPromises();

        expect(sendResponse).toHaveBeenCalledTimes(1);
        expect(sendResponse).toHaveBeenCalledWith({
            success: false,
            error: 'Context analysis unavailable',
            shouldRetry: false,
        });
    });

    test.each([
        {
            name: 'service failure',
            result: {
                success: false,
                error: 'provider secret',
                shouldRetry: true,
            },
            expectedRetry: true,
        },
        {
            name: 'malformed success',
            result: { success: true, analysis: 'provider secret' },
            expectedRetry: false,
        },
    ])('returns a fixed response for a $name', async (scenario) => {
        const listeners = setupChrome();
        const analyzeContext = jest.fn().mockResolvedValue(scenario.result);
        const handler = new MessageHandler();
        handler.setServices({ aiContextService: { analyzeContext } });
        handler.initialize();
        const sendResponse = jest.fn();

        listeners[0](
            createContentRequest(),
            createContentSender(),
            sendResponse
        );
        await flushPromises();

        expect(sendResponse).toHaveBeenCalledWith({
            success: false,
            error: 'Context analysis failed',
            shouldRetry: scenario.expectedRetry,
        });
        expect(JSON.stringify(sendResponse.mock.calls)).not.toContain(
            'provider secret'
        );
    });

    test('returns a fixed unavailable response when the service is missing', () => {
        const listeners = setupChrome();
        const handler = new MessageHandler();
        handler.initialize();
        const sendResponse = jest.fn();

        expect(
            listeners[0](
                createContentRequest(),
                createContentSender(),
                sendResponse
            )
        ).toBe(true);
        expect(sendResponse).toHaveBeenCalledWith({
            success: false,
            error: 'Context analysis unavailable',
            shouldRetry: false,
        });
    });

    test('dispatches the canonical full set through one all-service call', async () => {
        const listeners = setupChrome();
        const analyzeContext = jest.fn().mockResolvedValue({
            success: true,
            analysis: { definition: 'full analysis' },
        });
        const handler = new MessageHandler();
        handler.setServices({ aiContextService: { analyzeContext } });
        handler.initialize();
        const sendResponse = jest.fn();

        listeners[0](
            createContentRequest({
                contextTypes: ['cultural', 'historical', 'linguistic'],
            }),
            createContentSender(),
            sendResponse
        );
        await flushPromises();

        expect(analyzeContext).toHaveBeenCalledTimes(1);
        expect(analyzeContext.mock.calls[0][1]).toBe('all');
        expect(sendResponse).toHaveBeenCalledWith({
            success: true,
            result: { analysis: { definition: 'full analysis' } },
        });
    });

    test('runs a two-type subset sequentially and combines the analysis', async () => {
        const listeners = setupChrome();
        const firstResult = deferred();
        const analyzeContext = jest.fn((_text, contextType) => {
            if (contextType === 'cultural') return firstResult.promise;
            return Promise.resolve({
                success: true,
                analysis: {
                    definition: 'historical definition',
                    detail: 'historical detail',
                },
            });
        });
        const handler = new MessageHandler();
        handler.setServices({ aiContextService: { analyzeContext } });
        handler.initialize();
        const sendResponse = jest.fn();

        listeners[0](
            createContentRequest({
                contextTypes: ['cultural', 'historical'],
            }),
            createContentSender(),
            sendResponse
        );
        expect(analyzeContext.mock.calls.map(([, type]) => type)).toEqual([
            'cultural',
        ]);

        firstResult.resolve({
            success: true,
            analysis: {
                definition: 'cultural definition',
                detail: 'cultural detail',
            },
        });
        await firstResult.promise;
        await flushPromises();

        expect(analyzeContext.mock.calls.map(([, type]) => type)).toEqual([
            'cultural',
            'historical',
        ]);
        expect(sendResponse).toHaveBeenCalledWith({
            success: true,
            result: {
                analysis: {
                    definition: 'cultural definition',
                    cultural_analysis: { detail: 'cultural detail' },
                    historical_analysis: { detail: 'historical detail' },
                },
            },
        });
    });
});
