import { jest } from '@jest/globals';
import {
    getTrustedTranslationFailureMetadata,
    RateLimitError,
    TranslationError,
} from '../services/serviceInterfaces.js';
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

function createHandler(translationService = null) {
    const handler = new MessageHandler();
    handler.logger = {
        debug: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
    };
    if (translationService) {
        handler.setServices({ translationService });
    }
    return handler;
}

async function dispatchTranslate(handler, overrides = {}) {
    const sendResponse = jest.fn();
    const responsePromise = new Promise((resolve) => {
        sendResponse.mockImplementation(resolve);
    });
    const keepsChannelOpen = handler.handleMessage(
        {
            action: MessageActions.TRANSLATE,
            text: 'hello',
            targetLang: 'es',
            cueStart: 20,
            cueVideoId: 'video-shared',
            ...overrides,
        },
        {},
        sendResponse
    );
    const response = await responsePromise;
    await Promise.resolve();
    return { keepsChannelOpen, response, sendResponse };
}

async function flushPromiseCallbacks() {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

describe('MessageHandler translate protocol', () => {
    test('rejects a background-page translation before service access', () => {
        const listeners = installRuntimeHarness();
        const translate = jest.fn().mockResolvedValue('hola');
        const handler = new MessageHandler();
        handler.setServices({ translationService: { translate } });
        handler.initialize();
        const sendResponse = jest.fn();

        expect(
            listeners[0](
                createTranslationRequest(),
                {
                    id: EXTENSION_ID,
                    url: `${EXTENSION_ROOT}background.js`,
                    origin: EXTENSION_ROOT.slice(0, -1),
                },
                sendResponse
            )
        ).toBe(false);
        expect(translate).not.toHaveBeenCalled();
        expect(sendResponse).toHaveBeenCalledTimes(1);
        expect(sendResponse).toHaveBeenCalledWith({
            error: 'Translation failed',
            errorType: 'TranslationError',
            retryable: false,
            retryAfter: null,
            cueStart: 12.5,
            cueVideoId: 'video-1',
        });
        expect(Object.isFrozen(sendResponse.mock.calls[0][0])).toBe(true);
    });

    test.each([
        ['Netflix', createContentSender],
        ['Disney+', createDisneyContentSender],
    ])(
        'accepts an active top-frame %s content translation through the runtime listener',
        async (_platform, createSender) => {
            const listeners = installRuntimeHarness();
            const translate = jest.fn().mockResolvedValue('hola');
            const handler = new MessageHandler();
            handler.setServices({ translationService: { translate } });
            handler.initialize();
            const sendResponse = jest.fn();
            const responsePromise = new Promise((resolve) => {
                sendResponse.mockImplementation(resolve);
            });

            expect(
                listeners[0](
                    createTranslationRequest(),
                    createSender(),
                    sendResponse
                )
            ).toBe(true);
            await expect(responsePromise).resolves.toEqual({
                translatedText: 'hola',
                originalText: 'hello',
                sourceLanguage: 'auto',
                targetLanguage: 'es',
                cached: false,
                processingTime: expect.any(Number),
                cueStart: 12.5,
                cueVideoId: 'video-1',
            });
            expect(translate).toHaveBeenCalledWith(
                'hello',
                'auto',
                'es',
                expect.objectContaining({ _onCacheHit: expect.any(Function) })
            );
            expect(sendResponse).toHaveBeenCalledTimes(1);
            expect(Object.isFrozen(sendResponse.mock.calls[0][0])).toBe(true);
        }
    );

    test('detaches a cold admitted request and sender before readiness', async () => {
        const listeners = installRuntimeHarness();
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
        const handler = new MessageHandler();
        handler.setServices({ translationService: { translate } });
        handler.initialize(readiness);
        const message = createTranslationRequest();
        const sender = createContentSender();
        const messageTrap = jest.fn(() => {
            throw new Error('retained raw message');
        });
        const senderTrap = jest.fn(() => {
            throw new Error('retained raw sender');
        });
        const sendResponse = jest.fn();
        const responsePromise = new Promise((resolve) => {
            sendResponse.mockImplementation(resolve);
        });

        expect(listeners[0](message, sender, sendResponse)).toBe(true);
        Object.defineProperty(message, 'text', { get: messageTrap });
        Object.defineProperty(message, 'cueStart', { get: messageTrap });
        Object.defineProperty(sender, 'id', { get: senderTrap });
        Object.defineProperty(sender, 'url', { get: senderTrap });
        Object.defineProperty(sender, 'documentLifecycle', {
            get: senderTrap,
        });
        Object.defineProperty(sender, 'tab', { get: senderTrap });

        resolveReadiness();
        await expect(responsePromise).resolves.toEqual({
            translatedText: 'hola',
            originalText: 'hello',
            sourceLanguage: 'auto',
            targetLanguage: 'es',
            cached: false,
            processingTime: expect.any(Number),
            cueStart: 12.5,
            cueVideoId: 'video-1',
        });
        expect(translate).toHaveBeenCalledWith(
            'hello',
            'auto',
            'es',
            expect.objectContaining({ _onCacheHit: expect.any(Function) })
        );
        expect(messageTrap).not.toHaveBeenCalled();
        expect(senderTrap).not.toHaveBeenCalled();
        expect(sendResponse).toHaveBeenCalledTimes(1);
    });

    test('destroy settles a cold admitted request once without service work', async () => {
        const listeners = installRuntimeHarness();
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
        const handler = new MessageHandler();
        handler.setServices({ translationService: { translate } });
        handler.initialize(readiness);
        const sendResponse = jest.fn();

        expect(
            listeners[0](
                createTranslationRequest(),
                createContentSender(),
                sendResponse
            )
        ).toBe(true);
        handler.destroy();

        expect(sendResponse).toHaveBeenCalledTimes(1);
        expect(sendResponse).toHaveBeenCalledWith({
            error: 'Translation failed',
            errorType: 'TranslationError',
            retryable: false,
            retryAfter: null,
            cueStart: 12.5,
            cueVideoId: 'video-1',
        });
        expect(Object.isFrozen(sendResponse.mock.calls[0][0])).toBe(true);

        resolveReadiness();
        await flushPromiseCallbacks();
        expect(translate).not.toHaveBeenCalled();
        expect(sendResponse).toHaveBeenCalledTimes(1);
    });

    test('rejects a cold flight whose captured lifecycle epoch is stale', async () => {
        const listeners = installRuntimeHarness();
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
        const handler = new MessageHandler();
        handler.setServices({ translationService: { translate } });
        handler.initialize(readiness);
        const sendResponse = jest.fn();
        const responsePromise = new Promise((resolve) => {
            sendResponse.mockImplementation(resolve);
        });

        expect(
            listeners[0](
                createTranslationRequest(),
                createContentSender(),
                sendResponse
            )
        ).toBe(true);
        handler.lifecycleEpoch += 1;
        resolveReadiness();

        await expect(responsePromise).resolves.toEqual({
            error: 'Translation failed',
            errorType: 'TranslationError',
            retryable: false,
            retryAfter: null,
            cueStart: 12.5,
            cueVideoId: 'video-1',
        });
        expect(translate).not.toHaveBeenCalled();
        expect(sendResponse).toHaveBeenCalledTimes(1);
    });

    test('cold readiness rejection returns one fixed redacted failure', async () => {
        const listeners = installRuntimeHarness();
        const rawError = new Error('initialization SECRET');
        rawError.stack = 'initialization stack SECRET';
        const readiness = {
            isReady: jest.fn(() => false),
            waitUntilReady: jest.fn(() => Promise.reject(rawError)),
        };
        const translate = jest.fn();
        const handler = new MessageHandler();
        handler.setServices({ translationService: { translate } });
        handler.initialize(readiness);
        handler.logger = {
            debug: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
        };
        const sendResponse = jest.fn();
        const responsePromise = new Promise((resolve) => {
            sendResponse.mockImplementation(resolve);
        });

        expect(
            listeners[0](
                createTranslationRequest(),
                createContentSender(),
                sendResponse
            )
        ).toBe(true);
        const response = await responsePromise;

        expect(response).toEqual({
            error: 'Translation failed',
            errorType: 'TranslationError',
            retryable: false,
            retryAfter: null,
            cueStart: 12.5,
            cueVideoId: 'video-1',
        });
        expect(Object.isFrozen(response)).toBe(true);
        expect(translate).not.toHaveBeenCalled();
        expect(sendResponse).toHaveBeenCalledTimes(1);
        expect(handler.logger.error).toHaveBeenCalledWith(
            'Background services unavailable before translation handling',
            { action: MessageActions.TRANSLATE }
        );
        expect(JSON.stringify(handler.logger.error.mock.calls)).not.toContain(
            'SECRET'
        );
        expect(handler.logger.error.mock.calls.flat()).not.toContain(rawError);
    });

    test.each([
        [
            'background role',
            () => ({
                id: EXTENSION_ID,
                url: `${EXTENSION_ROOT}background.js`,
                origin: EXTENSION_ROOT.slice(0, -1),
            }),
        ],
        [
            'options role',
            () => ({
                id: EXTENSION_ID,
                url: `${EXTENSION_ROOT}options/options.html`,
                origin: EXTENSION_ROOT.slice(0, -1),
            }),
        ],
        [
            'popup role',
            () => ({
                id: EXTENSION_ID,
                url: `${EXTENSION_ROOT}popup/popup.html`,
                origin: EXTENSION_ROOT.slice(0, -1),
            }),
        ],
        [
            'side-panel role',
            () => ({
                id: EXTENSION_ID,
                url: `${EXTENSION_ROOT}sidepanel/sidepanel.html`,
                origin: EXTENSION_ROOT.slice(0, -1),
            }),
        ],
        ['invalid sender', () => ({})],
        ['content subframe', () => createContentSender({ frameId: 1 })],
        [
            'inactive content tab',
            () =>
                createContentSender({
                    tab: {
                        id: 42,
                        windowId: 7,
                        active: false,
                        url: 'https://www.netflix.com/watch/80100172',
                    },
                }),
        ],
    ])('rejects a %s translation before readiness', (_label, createSender) => {
        const listeners = installRuntimeHarness();
        const readiness = {
            isReady: jest.fn(() => false),
            waitUntilReady: jest.fn(),
        };
        const translate = jest.fn();
        const handler = new MessageHandler();
        handler.setServices({ translationService: { translate } });
        handler.initialize(readiness);
        const sendResponse = jest.fn();

        expect(
            listeners[0](
                createTranslationRequest(),
                createSender(),
                sendResponse
            )
        ).toBe(false);
        expect(readiness.isReady).not.toHaveBeenCalled();
        expect(readiness.waitUntilReady).not.toHaveBeenCalled();
        expect(translate).not.toHaveBeenCalled();
        expect(sendResponse).toHaveBeenCalledTimes(1);
        expect(sendResponse).toHaveBeenCalledWith({
            error: 'Translation failed',
            errorType: 'TranslationError',
            retryable: false,
            retryAfter: null,
            cueStart: 12.5,
            cueVideoId: 'video-1',
        });
        expect(Object.isFrozen(sendResponse.mock.calls[0][0])).toBe(true);
    });

    test.each([
        [
            'missing key',
            (message) => {
                delete message.cueVideoId;
            },
        ],
        [
            'extra key',
            (message) => {
                message.extra = true;
            },
        ],
        [
            'symbol key',
            (message) => {
                message[Symbol('extra')] = true;
            },
        ],
        [
            'accessor field',
            (message, getter) => {
                Object.defineProperty(message, 'text', {
                    enumerable: true,
                    get: getter,
                });
            },
        ],
        [
            'nonplain prototype',
            (message) => Object.assign(Object.create({}), message),
        ],
    ])(
        'rejects an invalid runtime translation with a %s before service work',
        (_label, transform) => {
            const listeners = installRuntimeHarness();
            const translate = jest.fn();
            const handler = new MessageHandler();
            handler.setServices({ translationService: { translate } });
            handler.initialize();
            const sendResponse = jest.fn();
            const getter = jest.fn(() => 'hello');
            const original = createTranslationRequest();
            const message = transform(original, getter) ?? original;

            expect(
                listeners[0](message, createContentSender(), sendResponse)
            ).toBe(false);
            expect(getter).not.toHaveBeenCalled();
            expect(translate).not.toHaveBeenCalled();
            expect(sendResponse).toHaveBeenCalledTimes(1);
            expect(sendResponse).toHaveBeenCalledWith({
                success: false,
                error: 'Invalid message',
            });
            expect(Object.isFrozen(sendResponse.mock.calls[0][0])).toBe(true);
        }
    );

    test('returns one fixed failure envelope when the translation service is missing', () => {
        const handler = new MessageHandler();
        handler.logger = {
            debug: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
        };
        const sendResponse = jest.fn();

        expect(
            handler.handleMessage(
                {
                    action: MessageActions.TRANSLATE,
                    text: 'raw source SECRET',
                    targetLang: 'es',
                    cueStart: 0,
                    cueVideoId: 'video-1',
                },
                {},
                sendResponse
            )
        ).toBe(true);
        expect(sendResponse).toHaveBeenCalledTimes(1);
        expect(sendResponse).toHaveBeenCalledWith({
            error: 'Translation failed',
            errorType: 'TranslationError',
            retryable: false,
            retryAfter: null,
            cueStart: 0,
            cueVideoId: 'video-1',
        });
    });

    test('preserves the exact successful translation envelope and cue echo', async () => {
        const handler = new MessageHandler();
        handler.logger = {
            debug: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
        };
        handler.setServices({
            translationService: {
                translate: jest.fn().mockResolvedValue('hola'),
            },
        });
        const sendResponse = jest.fn();
        const responsePromise = new Promise((resolve) => {
            sendResponse.mockImplementation(resolve);
        });

        expect(
            handler.handleMessage(
                {
                    action: MessageActions.TRANSLATE,
                    text: 'hello',
                    targetLang: 'es',
                    cueStart: 12.5,
                    cueVideoId: 'video-2',
                },
                {},
                sendResponse
            )
        ).toBe(true);
        await expect(responsePromise).resolves.toEqual({
            translatedText: 'hola',
            originalText: 'hello',
            sourceLanguage: 'auto',
            targetLanguage: 'es',
            cached: false,
            processingTime: expect.any(Number),
            cueStart: 12.5,
            cueVideoId: 'video-2',
        });
        expect(sendResponse).toHaveBeenCalledTimes(1);
        expect(Object.isFrozen(sendResponse.mock.calls[0][0])).toBe(true);
        expect(Object.keys(sendResponse.mock.calls[0][0])).toEqual([
            'translatedText',
            'originalText',
            'sourceLanguage',
            'targetLanguage',
            'cached',
            'processingTime',
            'cueStart',
            'cueVideoId',
        ]);
    });

    test('reports a translation-service cache callback as cached', async () => {
        const translate = jest.fn((_text, _source, _target, options) => {
            options._onCacheHit();
            return Promise.resolve('hola');
        });
        const handler = createHandler({ translate });

        const { response, sendResponse } = await dispatchTranslate(handler);

        expect(response).toEqual({
            translatedText: 'hola',
            originalText: 'hello',
            sourceLanguage: 'auto',
            targetLanguage: 'es',
            cached: true,
            processingTime: expect.any(Number),
            cueStart: 20,
            cueVideoId: 'video-shared',
        });
        expect(Object.isFrozen(response)).toBe(true);
        expect(sendResponse).toHaveBeenCalledTimes(1);
    });

    test('clamps processing time to zero when the wall clock rolls back', async () => {
        const handler = createHandler({
            translate: jest.fn().mockResolvedValue('hola'),
        });
        const dateNowSpy = jest
            .spyOn(Date, 'now')
            .mockReturnValueOnce(10_000)
            .mockReturnValueOnce(9_999);

        try {
            const { response } = await dispatchTranslate(handler);

            expect(response).toMatchObject({ processingTime: 0 });
            expect(Object.isFrozen(response)).toBe(true);
        } finally {
            dateNowSpy.mockRestore();
        }
    });

    test.each(['', '   ', null, { translatedText: 'hola' }])(
        'projects an invalid translated service result %p onto one fixed failure',
        async (translatedText) => {
            const handler = createHandler({
                translate: jest.fn().mockResolvedValue(translatedText),
            });

            const { response, sendResponse } = await dispatchTranslate(handler);

            expect(response).toEqual({
                error: 'Translation failed',
                errorType: 'TranslationError',
                retryable: false,
                retryAfter: null,
                cueStart: 20,
                cueVideoId: 'video-shared',
            });
            expect(Object.isFrozen(response)).toBe(true);
            expect(sendResponse).toHaveBeenCalledTimes(1);
        }
    );

    test('projects a generic service rejection onto one fixed failure envelope', async () => {
        const rawError = new Error('raw provider SECRET');
        rawError.stack = 'provider stack SECRET';
        const getCurrentProvider = jest.fn(() => ({
            id: 'secret-provider',
            name: 'Secret Provider',
        }));
        const handler = new MessageHandler();
        handler.logger = {
            debug: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
        };
        handler.setServices({
            translationService: {
                translate: jest.fn().mockRejectedValue(rawError),
                getCurrentProvider,
            },
        });
        const sendResponse = jest.fn();
        const responsePromise = new Promise((resolve) => {
            sendResponse.mockImplementation(resolve);
        });

        expect(
            handler.handleMessage(
                {
                    action: MessageActions.TRANSLATE,
                    text: 'raw source SECRET',
                    targetLang: 'es',
                    cueStart: 4,
                    cueVideoId: 'video-3',
                },
                {},
                sendResponse
            )
        ).toBe(true);
        const response = await responsePromise;

        expect(response).toEqual({
            error: 'Translation failed',
            errorType: 'TranslationError',
            retryable: false,
            retryAfter: null,
            cueStart: 4,
            cueVideoId: 'video-3',
        });
        expect(sendResponse).toHaveBeenCalledTimes(1);
        expect(getCurrentProvider).not.toHaveBeenCalled();
        expect(handler.logger.error).toHaveBeenCalledTimes(1);
        expect(handler.logger.error).toHaveBeenCalledWith(
            'Translation failed',
            {
                textLength: 'raw source SECRET'.length,
                targetLang: 'es',
                retryable: false,
                retryAfter: null,
            }
        );
        expect(handler.logger.error.mock.calls[0]).not.toContain(rawError);
        expect(Object.isFrozen(response)).toBe(true);
        expect(Object.keys(response)).toEqual([
            'error',
            'errorType',
            'retryable',
            'retryAfter',
            'cueStart',
            'cueVideoId',
        ]);
        const serializedResponse = JSON.stringify(response);
        for (const forbiddenValue of [
            'SECRET',
            'raw',
            'provider',
            'stack',
            'originalText',
            'targetLanguage',
            'targetLang',
        ]) {
            expect(serializedResponse).not.toContain(forbiddenValue);
        }
    });

    test('marks a trusted recoverable TranslationError as informationally retryable', async () => {
        const handler = new MessageHandler();
        handler.logger = {
            debug: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
        };
        handler.setServices({
            translationService: {
                translate: jest.fn().mockRejectedValue(
                    new TranslationError('raw provider SECRET', {
                        isRecoverable: true,
                        provider: 'secret-provider',
                    })
                ),
            },
        });
        const sendResponse = jest.fn();
        const responsePromise = new Promise((resolve) => {
            sendResponse.mockImplementation(resolve);
        });

        expect(
            handler.handleMessage(
                {
                    action: MessageActions.TRANSLATE,
                    text: 'hello',
                    targetLang: 'es',
                    cueStart: 9,
                    cueVideoId: 'video-4',
                },
                {},
                sendResponse
            )
        ).toBe(true);
        await expect(responsePromise).resolves.toEqual({
            error: 'Translation failed',
            errorType: 'TranslationError',
            retryable: true,
            retryAfter: null,
            cueStart: 9,
            cueVideoId: 'video-4',
        });
        expect(sendResponse).toHaveBeenCalledTimes(1);
    });

    test('keeps a trusted nonrecoverable TranslationError nonretryable', async () => {
        const handler = new MessageHandler();
        handler.logger = {
            debug: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
        };
        handler.setServices({
            translationService: {
                translate: jest.fn().mockRejectedValue(
                    new TranslationError('raw provider SECRET', {
                        isRecoverable: false,
                    })
                ),
            },
        });
        const sendResponse = jest.fn();
        const responsePromise = new Promise((resolve) => {
            sendResponse.mockImplementation(resolve);
        });

        expect(
            handler.handleMessage(
                {
                    action: MessageActions.TRANSLATE,
                    text: 'hello',
                    targetLang: 'es',
                    cueStart: 10,
                    cueVideoId: 'video-5',
                },
                {},
                sendResponse
            )
        ).toBe(true);
        await expect(responsePromise).resolves.toEqual({
            error: 'Translation failed',
            errorType: 'TranslationError',
            retryable: false,
            retryAfter: null,
            cueStart: 10,
            cueVideoId: 'video-5',
        });
        expect(sendResponse).toHaveBeenCalledTimes(1);
    });

    test('uses the construction-time TranslationError recoverability snapshot', async () => {
        const details = { isRecoverable: true };
        const error = new TranslationError('raw provider SECRET', details);
        details.isRecoverable = false;
        const handler = createHandler({
            translate: jest.fn().mockRejectedValue(error),
        });

        const { response, sendResponse } = await dispatchTranslate(handler);

        expect(response).toEqual({
            error: 'Translation failed',
            errorType: 'TranslationError',
            retryable: true,
            retryAfter: null,
            cueStart: 20,
            cueVideoId: 'video-shared',
        });
        expect(sendResponse).toHaveBeenCalledTimes(1);
    });

    test('does not let replacement proxied TranslationError details elevate retryability', async () => {
        const error = new TranslationError('raw provider SECRET', {
            isRecoverable: false,
        });
        const descriptorTrap = jest.fn(Reflect.getOwnPropertyDescriptor);
        error.details = new Proxy(
            { isRecoverable: true },
            { getOwnPropertyDescriptor: descriptorTrap }
        );
        const handler = createHandler({
            translate: jest.fn().mockRejectedValue(error),
        });

        const { response, sendResponse } = await dispatchTranslate(handler);

        expect(response).toEqual({
            error: 'Translation failed',
            errorType: 'TranslationError',
            retryable: false,
            retryAfter: null,
            cueStart: 20,
            cueVideoId: 'video-shared',
        });
        expect(descriptorTrap).not.toHaveBeenCalled();
        expect(sendResponse).toHaveBeenCalledTimes(1);
    });

    test('snapshots accessor-backed TranslationError recoverability as false without invoking it', async () => {
        const recoverabilityGetter = jest.fn(() => true);
        const details = {};
        Object.defineProperty(details, 'isRecoverable', {
            configurable: true,
            get: recoverabilityGetter,
        });
        const handler = createHandler({
            translate: jest
                .fn()
                .mockRejectedValue(
                    new TranslationError('raw provider SECRET', details)
                ),
        });

        const { response } = await dispatchTranslate(handler);

        expect(response).toMatchObject({ retryable: false, retryAfter: null });
        expect(recoverabilityGetter).not.toHaveBeenCalled();
    });

    test('snapshots throwing TranslationError metadata as false at construction', async () => {
        const descriptorTrap = jest.fn(() => {
            throw new Error('construction metadata trap SECRET');
        });
        const error = new TranslationError(
            'raw provider SECRET',
            new Proxy({}, { getOwnPropertyDescriptor: descriptorTrap })
        );
        expect(descriptorTrap).toHaveBeenCalledTimes(1);
        const handler = createHandler({
            translate: jest.fn().mockRejectedValue(error),
        });

        const { response } = await dispatchTranslate(handler);

        expect(response).toMatchObject({ retryable: false, retryAfter: null });
        expect(descriptorTrap).toHaveBeenCalledTimes(1);
    });

    test('returns fresh frozen retry metadata views without exposing snapshot state', () => {
        const error = new RateLimitError('raw rate-limit SECRET', {
            rateLimitStatus: { resetTime: 1_800_000_001_000 },
        });

        const first = getTrustedTranslationFailureMetadata(error);
        const second = getTrustedTranslationFailureMetadata(error);

        expect(first).toEqual({
            retryable: true,
            resetTimes: [1_800_000_001_000],
        });
        expect(second).toEqual(first);
        expect(second).not.toBe(first);
        expect(second.resetTimes).not.toBe(first.resetTimes);
        expect(Object.isFrozen(first)).toBe(true);
        expect(Object.isFrozen(first.resetTimes)).toBe(true);
    });

    test('derives retry milliseconds from a trusted direct rate-limit reset', async () => {
        const now = 1_800_000_000_000;
        const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
        const handler = new MessageHandler();
        handler.logger = {
            debug: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
        };
        handler.setServices({
            translationService: {
                translate: jest.fn().mockRejectedValue(
                    new RateLimitError('raw rate-limit SECRET', {
                        provider: 'secret-provider',
                        rateLimitStatus: {
                            resetTime: now + 1_250,
                        },
                    })
                ),
            },
        });
        const sendResponse = jest.fn();
        const responsePromise = new Promise((resolve) => {
            sendResponse.mockImplementation(resolve);
        });

        try {
            expect(
                handler.handleMessage(
                    {
                        action: MessageActions.TRANSLATE,
                        text: 'hello',
                        targetLang: 'es',
                        cueStart: 11,
                        cueVideoId: 'video-6',
                    },
                    {},
                    sendResponse
                )
            ).toBe(true);
            await expect(responsePromise).resolves.toEqual({
                error: 'Translation failed',
                errorType: 'TranslationError',
                retryable: true,
                retryAfter: 1_250,
                cueStart: 11,
                cueVideoId: 'video-6',
            });
            expect(sendResponse).toHaveBeenCalledTimes(1);
        } finally {
            dateNowSpy.mockRestore();
        }
    });

    test('uses the latest trusted nested short and long rate-limit reset', async () => {
        const now = 1_800_000_000_000;
        const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
        const handler = new MessageHandler();
        handler.logger = {
            debug: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
        };
        handler.setServices({
            translationService: {
                translate: jest.fn().mockRejectedValue(
                    new RateLimitError('raw rate-limit SECRET', {
                        rateLimitStatus: {
                            shortWindow: { resetTime: now + 1_000 },
                            longWindow: { resetTime: now + 5_000 },
                        },
                    })
                ),
            },
        });
        const sendResponse = jest.fn();
        const responsePromise = new Promise((resolve) => {
            sendResponse.mockImplementation(resolve);
        });

        try {
            expect(
                handler.handleMessage(
                    {
                        action: MessageActions.TRANSLATE,
                        text: 'hello',
                        targetLang: 'es',
                        cueStart: 12,
                        cueVideoId: 'video-7',
                    },
                    {},
                    sendResponse
                )
            ).toBe(true);
            await expect(responsePromise).resolves.toEqual({
                error: 'Translation failed',
                errorType: 'TranslationError',
                retryable: true,
                retryAfter: 5_000,
                cueStart: 12,
                cueVideoId: 'video-7',
            });
            expect(sendResponse).toHaveBeenCalledTimes(1);
        } finally {
            dateNowSpy.mockRestore();
        }
    });

    test('does not shorten a nested long-window reset that exceeds the cap', async () => {
        const now = 1_800_000_000_000;
        const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
        const handler = createHandler({
            translate: jest.fn().mockRejectedValue(
                new RateLimitError('raw rate-limit SECRET', {
                    rateLimitStatus: {
                        shortWindow: { resetTime: now + 1_000 },
                        longWindow: {
                            resetTime: now + 30 * 24 * 60 * 60 * 1000 + 1,
                        },
                    },
                })
            ),
        });

        try {
            const { response, sendResponse } = await dispatchTranslate(handler);

            expect(response).toEqual({
                error: 'Translation failed',
                errorType: 'TranslationError',
                retryable: true,
                retryAfter: null,
                cueStart: 20,
                cueVideoId: 'video-shared',
            });
            expect(sendResponse).toHaveBeenCalledTimes(1);
        } finally {
            dateNowSpy.mockRestore();
        }
    });

    test('uses the construction-time RateLimitError reset snapshot after mutation and proxy replacement', async () => {
        const now = 1_800_000_000_000;
        const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
        const rateLimitStatus = { resetTime: now + 1_000 };
        const details = { rateLimitStatus };
        const error = new RateLimitError('raw rate-limit SECRET', details);
        rateLimitStatus.resetTime = now + 2_000;
        const descriptorTrap = jest.fn(Reflect.getOwnPropertyDescriptor);
        details.rateLimitStatus = new Proxy(
            { resetTime: now + 5_000 },
            { getOwnPropertyDescriptor: descriptorTrap }
        );
        const handler = createHandler({
            translate: jest.fn().mockRejectedValue(error),
        });

        try {
            const { response, sendResponse } = await dispatchTranslate(handler);

            expect(response).toEqual({
                error: 'Translation failed',
                errorType: 'TranslationError',
                retryable: true,
                retryAfter: 1_000,
                cueStart: 20,
                cueVideoId: 'video-shared',
            });
            expect(descriptorTrap).not.toHaveBeenCalled();
            expect(sendResponse).toHaveBeenCalledTimes(1);
        } finally {
            dateNowSpy.mockRestore();
        }
    });

    test('ignores throwing replacement details on a genuine RateLimitError', async () => {
        const now = 1_800_000_000_000;
        const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
        const error = new RateLimitError('raw rate-limit SECRET', {
            rateLimitStatus: { resetTime: now + 1_000 },
        });
        const descriptorTrap = jest.fn(() => {
            throw new Error('replacement details trap SECRET');
        });
        error.details = new Proxy(
            {},
            { getOwnPropertyDescriptor: descriptorTrap }
        );
        const handler = createHandler({
            translate: jest.fn().mockRejectedValue(error),
        });

        try {
            const { response } = await dispatchTranslate(handler);

            expect(response).toMatchObject({
                retryable: true,
                retryAfter: 1_000,
            });
            expect(descriptorTrap).not.toHaveBeenCalled();
        } finally {
            dateNowSpy.mockRestore();
        }
    });

    test('fails closed for a transparent proxy around a genuine RateLimitError', async () => {
        const now = 1_800_000_000_000;
        const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
        const proxiedError = new Proxy(
            new RateLimitError('raw rate-limit SECRET', {
                rateLimitStatus: { resetTime: now + 1_000 },
            }),
            {}
        );
        const handler = createHandler({
            translate: jest.fn().mockRejectedValue(proxiedError),
        });

        try {
            const { response } = await dispatchTranslate(handler);

            expect(response).toMatchObject({
                retryable: false,
                retryAfter: null,
            });
        } finally {
            dateNowSpy.mockRestore();
        }
    });

    test('fails closed for a prototype-forged RateLimitError-looking object', async () => {
        const now = 1_800_000_000_000;
        const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
        const forgedError = Object.assign(
            Object.create(RateLimitError.prototype),
            {
                details: {
                    rateLimitStatus: { resetTime: now + 1_000 },
                },
            }
        );
        const handler = createHandler({
            translate: jest.fn().mockRejectedValue(forgedError),
        });

        try {
            const { response } = await dispatchTranslate(handler);

            expect(response).toMatchObject({
                retryable: false,
                retryAfter: null,
            });
        } finally {
            dateNowSpy.mockRestore();
        }
    });

    test.each([
        {
            name: 'past reset',
            getResetTime: (now) => now - 1,
            expectedRetryAfter: null,
        },
        {
            name: 'fractionally past reset',
            getResetTime: (now) => now - 0.1,
            expectedRetryAfter: null,
        },
        {
            name: 'NaN reset',
            getResetTime: () => Number.NaN,
            expectedRetryAfter: null,
        },
        {
            name: 'infinite reset',
            getResetTime: () => Number.POSITIVE_INFINITY,
            expectedRetryAfter: null,
        },
        {
            name: 'negative absolute reset',
            getResetTime: () => -1,
            expectedRetryAfter: null,
        },
        {
            name: 'exact 30-day reset',
            getResetTime: (now) => now + 30 * 24 * 60 * 60 * 1000,
            expectedRetryAfter: 30 * 24 * 60 * 60 * 1000,
        },
        {
            name: 'over-cap reset',
            getResetTime: (now) => now + 30 * 24 * 60 * 60 * 1000 + 1,
            expectedRetryAfter: null,
        },
    ])(
        'normalizes a trusted rate-limit $name',
        async ({ getResetTime, expectedRetryAfter }) => {
            const now = 1_800_000_000_000;
            const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
            const handler = createHandler({
                translate: jest.fn().mockRejectedValue(
                    new RateLimitError('raw rate-limit SECRET', {
                        rateLimitStatus: {
                            resetTime: getResetTime(now),
                        },
                    })
                ),
            });

            try {
                const { keepsChannelOpen, response, sendResponse } =
                    await dispatchTranslate(handler);

                expect(keepsChannelOpen).toBe(true);
                expect(response).toEqual({
                    error: 'Translation failed',
                    errorType: 'TranslationError',
                    retryable: true,
                    retryAfter: expectedRetryAfter,
                    cueStart: 20,
                    cueVideoId: 'video-shared',
                });
                expect(sendResponse).toHaveBeenCalledTimes(1);
            } finally {
                dateNowSpy.mockRestore();
            }
        }
    );

    test('keeps a genuine RateLimitError retryable without invoking accessor-backed status', async () => {
        const metadataGetter = jest.fn(() => {
            throw new Error('metadata getter SECRET');
        });
        const details = {};
        Object.defineProperty(details, 'rateLimitStatus', {
            configurable: true,
            get: metadataGetter,
        });
        const handler = createHandler({
            translate: jest
                .fn()
                .mockRejectedValue(
                    new RateLimitError('raw rate-limit SECRET', details)
                ),
        });

        const { keepsChannelOpen, response, sendResponse } =
            await dispatchTranslate(handler);

        expect(keepsChannelOpen).toBe(true);
        expect(response).toEqual({
            error: 'Translation failed',
            errorType: 'TranslationError',
            retryable: true,
            retryAfter: null,
            cueStart: 20,
            cueVideoId: 'video-shared',
        });
        expect(metadataGetter).not.toHaveBeenCalled();
        expect(sendResponse).toHaveBeenCalledTimes(1);
    });

    test('contains a hostile rejected-error proxy and responds exactly once', async () => {
        const prototypeTrap = jest.fn(() => {
            throw new Error('prototype trap SECRET');
        });
        const hostileError = new Proxy(
            new RateLimitError('raw rate-limit SECRET'),
            { getPrototypeOf: prototypeTrap }
        );
        const handler = createHandler({
            translate: jest.fn().mockRejectedValue(hostileError),
        });

        const { keepsChannelOpen, response, sendResponse } =
            await dispatchTranslate(handler);

        expect(keepsChannelOpen).toBe(true);
        expect(response).toEqual({
            error: 'Translation failed',
            errorType: 'TranslationError',
            retryable: false,
            retryAfter: null,
            cueStart: 20,
            cueVideoId: 'video-shared',
        });
        expect(prototypeTrap).not.toHaveBeenCalled();
        expect(sendResponse).toHaveBeenCalledTimes(1);
    });

    test('contains a synchronous translation-service throw as one fixed failure', async () => {
        const handler = createHandler({
            translate: jest.fn(() => {
                throw new Error('synchronous provider SECRET');
            }),
        });
        const sendResponse = jest.fn();
        const responsePromise = new Promise((resolve) => {
            sendResponse.mockImplementation(resolve);
        });
        let keepsChannelOpen;

        expect(() => {
            keepsChannelOpen = handler.handleMessage(
                {
                    action: MessageActions.TRANSLATE,
                    text: 'hello',
                    targetLang: 'es',
                    cueStart: 21,
                    cueVideoId: 'video-8',
                },
                {},
                sendResponse
            );
        }).not.toThrow();
        expect(keepsChannelOpen).toBe(true);
        await expect(responsePromise).resolves.toEqual({
            error: 'Translation failed',
            errorType: 'TranslationError',
            retryable: false,
            retryAfter: null,
            cueStart: 21,
            cueVideoId: 'video-8',
        });
        expect(sendResponse).toHaveBeenCalledTimes(1);
    });

    test('does not re-enter failure handling when a success callback throws', async () => {
        const handler = createHandler({
            translate: jest.fn().mockResolvedValue('hola'),
        });
        const sendResponse = jest.fn(() => {
            throw new Error('response channel closed');
        });

        expect(
            handler.handleMessage(
                {
                    action: MessageActions.TRANSLATE,
                    text: 'hello',
                    targetLang: 'es',
                    cueStart: 22,
                    cueVideoId: 'video-9',
                },
                {},
                sendResponse
            )
        ).toBe(true);
        await flushPromiseCallbacks();

        expect(sendResponse).toHaveBeenCalledTimes(1);
        expect(handler.logger.error).not.toHaveBeenCalled();
    });

    test('contains a throwing failure callback after exactly one attempt', async () => {
        const handler = createHandler({
            translate: jest
                .fn()
                .mockRejectedValue(new Error('raw provider SECRET')),
        });
        const sendResponse = jest.fn(() => {
            throw new Error('response channel closed');
        });

        expect(
            handler.handleMessage(
                {
                    action: MessageActions.TRANSLATE,
                    text: 'hello',
                    targetLang: 'es',
                    cueStart: 23,
                    cueVideoId: 'video-10',
                },
                {},
                sendResponse
            )
        ).toBe(true);
        await flushPromiseCallbacks();

        expect(sendResponse).toHaveBeenCalledTimes(1);
        expect(handler.logger.error).toHaveBeenCalledTimes(1);
    });

    test('contains a throwing missing-service callback after one attempt', () => {
        const handler = createHandler();
        const sendResponse = jest.fn(() => {
            throw new Error('response channel closed');
        });
        let keepsChannelOpen;

        expect(() => {
            keepsChannelOpen = handler.handleMessage(
                {
                    action: MessageActions.TRANSLATE,
                    text: 'hello',
                    targetLang: 'es',
                    cueStart: 24,
                    cueVideoId: 'video-11',
                },
                {},
                sendResponse
            );
        }).not.toThrow();
        expect(keepsChannelOpen).toBe(true);
        expect(sendResponse).toHaveBeenCalledTimes(1);
    });
});
