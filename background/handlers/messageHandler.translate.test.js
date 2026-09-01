import { jest } from '@jest/globals';
import { MessageActions } from '../../content_scripts/shared/constants/messageActions.js';
import { MessageHandler } from './messageHandler.js';

const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop';
const EXTENSION_ROOT = `chrome-extension://${EXTENSION_ID}/`;
const RUNTIME_MANIFEST = Object.freeze({
    background: { service_worker: 'background.js' },
    options_ui: { page: 'options/options.html' },
    action: { default_popup: 'popup/popup.html' },
    side_panel: { default_path: 'sidepanel/sidepanel.html' },
});

function installRuntimeHarness() {
    const listeners = [];
    global.chrome = {
        runtime: {
            id: EXTENSION_ID,
            getManifest: jest.fn(() => RUNTIME_MANIFEST),
            getURL: jest.fn((path) => `${EXTENSION_ROOT}${path}`),
            onMessage: {
                addListener: jest.fn((listener) => listeners.push(listener)),
                removeListener: jest.fn(),
            },
        },
    };
    return listeners;
}

function createTranslationRequest(overrides = {}) {
    return {
        action: MessageActions.TRANSLATE,
        text: 'hello',
        targetLang: 'es',
        cueStart: 12.5,
        cueVideoId: 'video-1',
        ...overrides,
    };
}

function createContentSender(overrides = {}) {
    return {
        id: EXTENSION_ID,
        url: 'https://www.netflix.com/watch/80100172',
        origin: 'https://www.netflix.com',
        documentId: 'document-1',
        documentLifecycle: 'active',
        frameId: 0,
        tab: {
            id: 42,
            windowId: 7,
            active: true,
            url: 'https://www.netflix.com/watch/80100172',
        },
        ...overrides,
    };
}

function createDisneyContentSender() {
    return {
        id: EXTENSION_ID,
        url: 'https://www.disneyplus.com/video/12345678',
        origin: 'https://www.disneyplus.com',
        documentId: 'document-2',
        documentLifecycle: 'active',
        frameId: 0,
        tab: {
            id: 43,
            windowId: 8,
            active: true,
            url: 'https://www.disneyplus.com/video/12345678',
        },
    };
}

function createHandler(translationService, readiness) {
    const listeners = installRuntimeHarness();
    const handler = new MessageHandler();
    if (translationService) {
        handler.setServices({ translationService });
    }
    handler.initialize(readiness);
    handler.logger = {
        debug: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
    };
    return { handler, listener: listeners[0] };
}

function dispatch(listener, { message, sender } = {}) {
    const sendResponse = jest.fn();
    const responsePromise = new Promise((resolve) => {
        sendResponse.mockImplementation(resolve);
    });
    const keepsChannelOpen = listener(
        message ?? createTranslationRequest(),
        sender ?? createContentSender(),
        sendResponse
    );
    return { keepsChannelOpen, responsePromise, sendResponse };
}

async function flushPromiseCallbacks() {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

const FAILURE_RESPONSE = Object.freeze({
    error: 'Translation failed',
});

describe('MessageHandler translate protocol', () => {
    test.each([
        ['Netflix', createContentSender],
        ['Disney+', createDisneyContentSender],
    ])(
        'accepts active top-frame %s content through the runtime listener',
        async (_platform, createSender) => {
            const translate = jest.fn().mockResolvedValue('hola');
            const { listener } = createHandler({ translate });
            const operation = dispatch(listener, { sender: createSender() });

            expect(operation.keepsChannelOpen).toBe(true);
            await expect(operation.responsePromise).resolves.toEqual({
                translatedText: 'hola',
            });
            expect(translate).toHaveBeenCalledWith('hello', 'auto', 'es');
        }
    );

    test('rejects a non-content translation before service access', async () => {
        const translate = jest.fn();
        const { listener } = createHandler({ translate });
        const operation = dispatch(listener, {
            sender: {
                id: EXTENSION_ID,
                url: `${EXTENSION_ROOT}background.js`,
                origin: EXTENSION_ROOT.slice(0, -1),
            },
        });

        expect(operation.keepsChannelOpen).toBe(false);
        await expect(operation.responsePromise).resolves.toEqual(
            FAILURE_RESPONSE
        );
        expect(translate).not.toHaveBeenCalled();
    });

    test('rejects an inexact translation request before service access', async () => {
        const translate = jest.fn();
        const { listener } = createHandler({ translate });
        const operation = dispatch(listener, {
            message: createTranslationRequest({ unexpected: true }),
        });

        expect(operation.keepsChannelOpen).toBe(false);
        await expect(operation.responsePromise).resolves.toEqual({
            success: false,
            error: 'Invalid message',
        });
        expect(translate).not.toHaveBeenCalled();
    });

    test('detaches a cold request and sender before readiness', async () => {
        let resolveReadiness;
        const readiness = {
            isReady: jest.fn(() => false),
            waitUntilReady: jest.fn(
                () =>
                    new Promise((resolve) => {
                        resolveReadiness = resolve;
                    })
            ),
        };
        const translate = jest.fn().mockResolvedValue('hola');
        const { listener } = createHandler({ translate }, readiness);
        const message = createTranslationRequest();
        const sender = createContentSender();
        const operation = dispatch(listener, { message, sender });
        message.text = 'mutated';
        sender.tab.id = 99;

        resolveReadiness();
        await expect(operation.responsePromise).resolves.toEqual({
            translatedText: 'hola',
        });
        expect(translate).toHaveBeenCalledWith('hello', 'auto', 'es');
    });

    test('destroy settles a cold request once without service work', async () => {
        let resolveReadiness;
        const readiness = {
            isReady: jest.fn(() => false),
            waitUntilReady: jest.fn(
                () =>
                    new Promise((resolve) => {
                        resolveReadiness = resolve;
                    })
            ),
        };
        const translate = jest.fn();
        const { handler, listener } = createHandler({ translate }, readiness);
        const operation = dispatch(listener);

        handler.destroy();
        await expect(operation.responsePromise).resolves.toEqual(
            FAILURE_RESPONSE
        );
        resolveReadiness();
        await flushPromiseCallbacks();
        expect(translate).not.toHaveBeenCalled();
        expect(operation.sendResponse).toHaveBeenCalledTimes(1);
    });

    test('redacts a cold readiness failure', async () => {
        const rawError = new Error('initialization SECRET');
        const readiness = {
            isReady: jest.fn(() => false),
            waitUntilReady: jest.fn(() => Promise.reject(rawError)),
        };
        const translate = jest.fn();
        const { handler, listener } = createHandler({ translate }, readiness);
        const operation = dispatch(listener);

        await expect(operation.responsePromise).resolves.toEqual(
            FAILURE_RESPONSE
        );
        expect(translate).not.toHaveBeenCalled();
        expect(JSON.stringify(handler.logger.error.mock.calls)).not.toContain(
            'SECRET'
        );
    });

    test.each(['', '   ', null, { translatedText: 'hola' }])(
        'projects invalid translated text %p onto one fixed failure',
        async (translatedText) => {
            const { listener } = createHandler({
                translate: jest.fn().mockResolvedValue(translatedText),
            });
            const operation = dispatch(listener);

            await expect(operation.responsePromise).resolves.toEqual(
                FAILURE_RESPONSE
            );
        }
    );

    test('returns one fixed failure when the service is missing', async () => {
        const { listener } = createHandler();
        const operation = dispatch(listener);

        expect(operation.keepsChannelOpen).toBe(true);
        await expect(operation.responsePromise).resolves.toEqual(
            FAILURE_RESPONSE
        );
    });

    test('redacts an asynchronous provider failure', async () => {
        const { handler, listener } = createHandler({
            translate: jest
                .fn()
                .mockRejectedValue(new Error('provider SECRET')),
        });
        const operation = dispatch(listener);

        await expect(operation.responsePromise).resolves.toEqual(
            FAILURE_RESPONSE
        );
        expect(JSON.stringify(handler.logger.error.mock.calls)).not.toContain(
            'SECRET'
        );
    });

    test('contains a synchronous service throw as one fixed failure', async () => {
        const { listener } = createHandler({
            translate: jest.fn(() => {
                throw new Error('synchronous provider SECRET');
            }),
        });
        const operation = dispatch(listener);

        await expect(operation.responsePromise).resolves.toEqual(
            FAILURE_RESPONSE
        );
        expect(operation.sendResponse).toHaveBeenCalledTimes(1);
    });
});
