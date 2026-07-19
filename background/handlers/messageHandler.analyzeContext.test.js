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
        contextType: 'historical',
        ...overrides,
    };
}

async function flushPromises() {
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

describe('MessageHandler ANALYZE_CONTEXT ingress', () => {
    test('accepts an active top-frame content request and returns only the canonical response', async () => {
        const listeners = setupChrome();
        const analyzeContext = jest.fn().mockResolvedValue({
            success: true,
            analysis: { summary: 'trusted analysis' },
            contextType: 'linguistic',
            contextTypes: ['linguistic'],
            provider: 'must-not-leak',
            requestId: 'service-forged-request',
        });
        const handler = new MessageHandler();
        handler.setServices({ aiContextService: { analyzeContext } });
        handler.initialize();
        const sendResponse = jest.fn();

        const keepsChannelOpen = listeners[0](
            createContentRequest(),
            createContentSender(),
            sendResponse
        );
        await flushPromises();

        expect(keepsChannelOpen).toBe(true);
        expect(analyzeContext).toHaveBeenCalledWith('hello', 'cultural', {
            platform: 'netflix',
            requestedContextTypes: ['cultural'],
            sourceLanguage: 'en',
            targetLanguage: 'zh-CN',
        });
        expect(sendResponse).toHaveBeenCalledWith({
            success: true,
            result: {
                analysis: { summary: 'trusted analysis' },
                contextType: 'cultural',
                contextTypes: ['cultural'],
                isStructured: true,
            },
            requestId: 'content-request-1',
        });
        expect(Object.keys(sendResponse.mock.calls[0][0])).toEqual([
            'success',
            'result',
            'requestId',
        ]);
    });

    test('accepts the exact side-panel shape without inventing content metadata', async () => {
        const listeners = setupChrome();
        const analyzeContext = jest.fn().mockResolvedValue({
            success: true,
            analysis: { summary: 'panel analysis' },
        });
        const handler = new MessageHandler();
        handler.setServices({ aiContextService: { analyzeContext } });
        handler.initialize();
        const sendResponse = jest.fn();

        listeners[0](
            createSidePanelRequest(),
            createSidePanelSender(),
            sendResponse
        );
        await flushPromises();

        expect(analyzeContext).toHaveBeenCalledWith(
            'panel words',
            'historical',
            {
                requestedContextTypes: ['historical'],
                sourceLanguage: 'auto',
                targetLanguage: 'es',
            }
        );
        expect(sendResponse).toHaveBeenCalledWith({
            success: true,
            result: {
                analysis: { summary: 'panel analysis' },
                contextType: 'historical',
                contextTypes: ['historical'],
                isStructured: true,
            },
            requestId: 'sidepanel-request-1',
        });
    });

    test.each([
        [
            'a content shape from the side panel',
            () => createContentRequest(),
            () => createSidePanelSender(),
        ],
        [
            'a side-panel shape from content',
            () => createSidePanelRequest(),
            () => createContentSender(),
        ],
        [
            'a non-active content document lifecycle',
            () => createContentRequest(),
            () => ({
                ...createContentSender(),
                documentLifecycle: 'cached',
            }),
        ],
        [
            'an inactive content tab',
            () => createContentRequest(),
            () => ({
                ...createContentSender(),
                tab: { ...createContentSender().tab, active: false },
            }),
        ],
        [
            'a forged request source field',
            () => createContentRequest({ source: 'content_script' }),
            () => createContentSender(),
        ],
        [
            'an extension popup sender',
            () => createContentRequest(),
            () => ({
                id: EXTENSION_ID,
                origin: EXTENSION_ORIGIN,
                url: `${EXTENSION_ORIGIN}/popup/popup.html`,
            }),
        ],
    ])(
        'rejects %s before service dispatch',
        async (_label, message, sender) => {
            const listeners = setupChrome();
            const analyzeContext = jest.fn();
            const handler = new MessageHandler();
            handler.setServices({ aiContextService: { analyzeContext } });
            handler.initialize();
            const sendResponse = jest.fn();

            const keepsChannelOpen = listeners[0](
                message(),
                sender(),
                sendResponse
            );
            await flushPromises();

            expect(keepsChannelOpen).toBe(false);
            expect(analyzeContext).not.toHaveBeenCalled();
            expect(sendResponse).toHaveBeenCalledTimes(1);
            expect(sendResponse).toHaveBeenCalledWith({
                success: false,
                error: 'Invalid message',
            });
        }
    );

    test('rejects a content platform that differs from the classified document platform', async () => {
        const listeners = setupChrome();
        const analyzeContext = jest.fn();
        const handler = new MessageHandler();
        handler.setServices({ aiContextService: { analyzeContext } });
        handler.initialize();
        const sendResponse = jest.fn();

        const keepsChannelOpen = listeners[0](
            createContentRequest({ platform: 'disneyplus' }),
            createContentSender(),
            sendResponse
        );

        expect(keepsChannelOpen).toBe(false);
        expect(analyzeContext).not.toHaveBeenCalled();
        expect(sendResponse).toHaveBeenCalledTimes(1);
        expect(sendResponse).toHaveBeenCalledWith({
            success: false,
            error: 'Context analysis rejected',
            shouldRetry: false,
            requestId: 'content-request-1',
        });
    });

    test('snapshots a cold request and sender before readiness without retaining either raw object', async () => {
        const listeners = setupChrome();
        const readiness = new BackgroundServiceReadiness();
        const analyzeContext = jest.fn().mockResolvedValue({
            success: true,
            analysis: { summary: 'cold snapshot' },
        });
        const handler = new MessageHandler();
        handler.setServices({ aiContextService: { analyzeContext } });
        handler.initialize(readiness);
        const sendResponse = jest.fn();
        const messageTarget = createContentRequest();
        const senderTarget = createContentSender();
        const message = Proxy.revocable(messageTarget, {});
        const sender = Proxy.revocable(senderTarget, {});

        const keepsChannelOpen = listeners[0](
            message.proxy,
            sender.proxy,
            sendResponse
        );
        const [flight] = handler.analyzeContextFlights;
        expect(flight.request).not.toBe(messageTarget);
        expect(flight.sender).not.toBe(senderTarget);
        expect(Object.isFrozen(flight.request)).toBe(true);
        expect(Object.isFrozen(flight.sender)).toBe(true);

        messageTarget.text = 'mutated text';
        messageTarget.requestId = 'mutated-request';
        messageTarget.contextTypes[0] = 'linguistic';
        senderTarget.documentId = 'mutated-document';
        senderTarget.tab.id = 99;
        message.revoke();
        sender.revoke();

        expect(keepsChannelOpen).toBe(true);
        expect(analyzeContext).not.toHaveBeenCalled();
        expect(sendResponse).not.toHaveBeenCalled();

        readiness.markReady();
        await readiness.waitUntilReady();
        await flushPromises();

        expect(analyzeContext).toHaveBeenCalledWith(
            'hello',
            'cultural',
            expect.objectContaining({
                platform: 'netflix',
                requestedContextTypes: ['cultural'],
            })
        );
        expect(sendResponse).toHaveBeenCalledWith(
            expect.objectContaining({ requestId: 'content-request-1' })
        );
        expect(handler.analyzeContextFlights).toHaveProperty('size', 0);
    });

    test('settles a cold analysis exactly once when destroy advances the lifecycle', async () => {
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

        expect(analyzeContext).not.toHaveBeenCalled();
        expect(sendResponse).toHaveBeenCalledTimes(1);
        expect(sendResponse).toHaveBeenCalledWith({
            success: false,
            error: 'Context analysis unavailable',
            shouldRetry: false,
            requestId: 'content-request-1',
        });
        expect(handler.analyzeContextFlights).toHaveProperty('size', 0);

        readiness.markReady();
        await readiness.waitUntilReady();
        await flushPromises();

        expect(analyzeContext).not.toHaveBeenCalled();
        expect(sendResponse).toHaveBeenCalledTimes(1);
    });

    test('settles an in-flight analysis on destroy and ignores its late service result', async () => {
        const listeners = setupChrome();
        const pendingResult = deferred();
        const analyzeContext = jest.fn(() => pendingResult.promise);
        const handler = new MessageHandler();
        handler.setServices({ aiContextService: { analyzeContext } });
        handler.initialize();
        const sendResponse = jest.fn();

        listeners[0](
            createContentRequest(),
            createContentSender(),
            sendResponse
        );
        expect(analyzeContext).toHaveBeenCalledTimes(1);
        expect(sendResponse).not.toHaveBeenCalled();

        handler.destroy();
        expect(sendResponse).toHaveBeenCalledTimes(1);
        expect(sendResponse).toHaveBeenCalledWith({
            success: false,
            error: 'Context analysis unavailable',
            shouldRetry: false,
            requestId: 'content-request-1',
        });

        pendingResult.resolve({
            success: true,
            analysis: { summary: 'late secret result' },
        });
        await pendingResult.promise;
        await flushPromises();

        expect(sendResponse).toHaveBeenCalledTimes(1);
        expect(handler.analyzeContextFlights).toHaveProperty('size', 0);
    });

    test('rechecks the captured epoch before dispatching a cold analysis', async () => {
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
        handler.lifecycleEpoch += 1;
        readiness.markReady();
        await readiness.waitUntilReady();
        await flushPromises();

        expect(analyzeContext).not.toHaveBeenCalled();
        expect(sendResponse).toHaveBeenCalledWith({
            success: false,
            error: 'Context analysis unavailable',
            shouldRetry: false,
            requestId: 'content-request-1',
        });
    });

    test('rechecks the captured epoch before replying to an in-flight analysis', async () => {
        const listeners = setupChrome();
        const pendingResult = deferred();
        const analyzeContext = jest.fn(() => pendingResult.promise);
        const handler = new MessageHandler();
        handler.setServices({ aiContextService: { analyzeContext } });
        handler.initialize();
        const sendResponse = jest.fn();

        listeners[0](
            createContentRequest(),
            createContentSender(),
            sendResponse
        );
        handler.lifecycleEpoch += 1;
        pendingResult.resolve({
            success: true,
            analysis: { summary: 'stale epoch result' },
        });
        await pendingResult.promise;
        await flushPromises();

        expect(sendResponse).toHaveBeenCalledTimes(1);
        expect(sendResponse).toHaveBeenCalledWith({
            success: false,
            error: 'Context analysis unavailable',
            shouldRetry: false,
            requestId: 'content-request-1',
        });
    });

    test.each([
        ['an exact retry signal', true, true],
        ['a truthy non-boolean retry signal', 'true', false],
        ['a numeric retry signal', 1, false],
        ['a missing retry signal', undefined, false],
    ])(
        'normalizes %s without exposing the service error',
        async (_label, serviceRetry, expectedRetry) => {
            const listeners = setupChrome();
            const serviceResult = {
                success: false,
                error: 'provider credential and stack must not leak',
            };
            if (serviceRetry !== undefined) {
                serviceResult.shouldRetry = serviceRetry;
            }
            const analyzeContext = jest.fn().mockResolvedValue(serviceResult);
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

            expect(sendResponse).toHaveBeenCalledTimes(1);
            expect(sendResponse).toHaveBeenCalledWith({
                success: false,
                error: 'Context analysis failed',
                shouldRetry: expectedRetry,
                requestId: 'content-request-1',
            });
        }
    );

    test.each([
        ['a missing analysis', { success: true }],
        ['an array analysis', { success: true, analysis: [] }],
        ['a primitive analysis', { success: true, analysis: 'secret' }],
        [
            'an exotic analysis',
            { success: true, analysis: Object.create({ inherited: true }) },
        ],
    ])('rejects %s as a fixed canonical failure', async (_label, result) => {
        const listeners = setupChrome();
        const analyzeContext = jest.fn().mockResolvedValue(result);
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

        expect(sendResponse).toHaveBeenCalledTimes(1);
        expect(sendResponse).toHaveBeenCalledWith({
            success: false,
            error: 'Context analysis failed',
            shouldRetry: false,
            requestId: 'content-request-1',
        });
    });

    test('converts a rejected service promise into a fixed non-secret failure', async () => {
        const listeners = setupChrome();
        const analyzeContext = jest
            .fn()
            .mockRejectedValue(
                new Error('provider token and transport detail must not leak')
            );
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

        expect(sendResponse).toHaveBeenCalledTimes(1);
        expect(sendResponse).toHaveBeenCalledWith({
            success: false,
            error: 'Context analysis failed',
            shouldRetry: false,
            requestId: 'content-request-1',
        });
    });

    test('returns the canonical unavailable response when the service is missing', () => {
        const listeners = setupChrome();
        const handler = new MessageHandler();
        handler.initialize();
        const sendResponse = jest.fn();

        const keepsChannelOpen = listeners[0](
            createContentRequest(),
            createContentSender(),
            sendResponse
        );

        expect(keepsChannelOpen).toBe(true);
        expect(sendResponse).toHaveBeenCalledTimes(1);
        expect(sendResponse).toHaveBeenCalledWith({
            success: false,
            error: 'Context analysis unavailable',
            shouldRetry: false,
            requestId: 'content-request-1',
        });
        expect(handler.analyzeContextFlights).toHaveProperty('size', 0);
    });

    test('attempts a throwing response callback only once', async () => {
        const listeners = setupChrome();
        const analyzeContext = jest.fn().mockResolvedValue({
            success: true,
            analysis: { summary: 'callback result' },
        });
        const handler = new MessageHandler();
        handler.setServices({ aiContextService: { analyzeContext } });
        handler.initialize();
        const sendResponse = jest.fn(() => {
            throw new Error('receiver disappeared');
        });

        listeners[0](
            createContentRequest(),
            createContentSender(),
            sendResponse
        );
        await flushPromises();

        expect(sendResponse).toHaveBeenCalledTimes(1);
        expect(handler.analyzeContextFlights).toHaveProperty('size', 0);
    });

    test('dispatches the canonical three-type request through one all service call', async () => {
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
        expect(analyzeContext).toHaveBeenCalledWith('hello', 'all', {
            platform: 'netflix',
            requestedContextTypes: ['cultural', 'historical', 'linguistic'],
            sourceLanguage: 'en',
            targetLanguage: 'zh-CN',
        });
        expect(sendResponse).toHaveBeenCalledWith({
            success: true,
            result: {
                analysis: { definition: 'full analysis' },
                contextType: 'all',
                contextTypes: ['cultural', 'historical', 'linguistic'],
                isStructured: true,
            },
            requestId: 'content-request-1',
        });
    });

    test('runs a two-type subset sequentially and returns only the combined analysis', async () => {
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
        expect(analyzeContext).toHaveBeenCalledTimes(1);
        expect(analyzeContext.mock.calls[0][1]).toBe('cultural');

        firstResult.resolve({
            success: true,
            analysis: {
                definition: 'cultural definition',
                detail: 'cultural detail',
            },
        });
        await firstResult.promise;
        await flushPromises();

        expect(analyzeContext).toHaveBeenCalledTimes(2);
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
                contextType: 'combined',
                contextTypes: ['cultural', 'historical'],
                isStructured: true,
            },
            requestId: 'content-request-1',
        });
    });
});
