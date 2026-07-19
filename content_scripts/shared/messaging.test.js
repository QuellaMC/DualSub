import { jest } from '@jest/globals';
import { MessageActions } from './constants/messageActions.js';

import {
    classifyMessagingFailure,
    isProvenMessagingNonDelivery,
    MessagingFailureClass,
    rawSendMessage,
    sendRuntimeMessageWithRetry,
} from './messaging.js';

const nativeStructuredClone = globalThis.structuredClone;
const READY_SERVICES = Object.freeze({
    translation: true,
    subtitle: true,
    aiContext: true,
    aiContextInitialized: true,
});

function createReadinessResponse(action) {
    return {
        action,
        ready: true,
        services: READY_SERVICES,
    };
}

function restoreStructuredClone() {
    Object.defineProperty(globalThis, 'structuredClone', {
        configurable: true,
        writable: true,
        value: nativeStructuredClone,
    });
}

describe('rawSendMessage', () => {
    afterEach(() => {
        jest.useRealTimers();
        delete global.chrome;
        restoreStructuredClone();
    });

    test('dispatches once and normalizes a callback lastError', async () => {
        const lastError = {
            message:
                'Could not establish connection. Receiving end does not exist.',
        };
        const sendMessage = jest.fn((_message, callback) => {
            chrome.runtime.lastError = lastError;
            callback(undefined);
            delete chrome.runtime.lastError;
        });
        global.chrome = { runtime: { sendMessage } };

        let failure;
        try {
            await rawSendMessage({ action: 'translate' });
        } catch (error) {
            failure = error;
        }

        expect(failure).toBeInstanceOf(Error);
        expect(failure).not.toBe(lastError);
        expect(failure.message).toBe(lastError.message);
        expect(failure.cause).toBe(lastError);
        expect(
            Object.getOwnPropertyDescriptor(failure, 'cause')?.enumerable
        ).toBe(false);
        expect(classifyMessagingFailure(failure)).toBe(
            MessagingFailureClass.PROVEN_NON_DELIVERY
        );
        expect(sendMessage).toHaveBeenCalledTimes(1);
    });

    test('dispatches once for an ambiguous callback lastError', async () => {
        const lastError = {
            message: 'The message port closed before a response was received.',
        };
        const sendMessage = jest.fn((_message, callback) => {
            chrome.runtime.lastError = lastError;
            callback(undefined);
            delete chrome.runtime.lastError;
        });
        global.chrome = { runtime: { sendMessage } };

        const failure = await rawSendMessage({ action: 'translate' }).catch(
            (error) => error
        );

        expect(failure).toBeInstanceOf(Error);
        expect(failure).not.toBe(lastError);
        expect(failure.message).toBe(lastError.message);
        expect(failure.cause).toBe(lastError);
        expect(classifyMessagingFailure(failure)).toBe(
            MessagingFailureClass.AMBIGUOUS_ACCEPTANCE
        );
        expect(sendMessage).toHaveBeenCalledTimes(1);
    });

    test('brands callback no-matching-service-worker as proven non-delivery', async () => {
        const lastError = new Error(
            'No matching service worker for this scope.'
        );
        const sendMessage = jest.fn((_message, callback) => {
            chrome.runtime.lastError = lastError;
            callback(undefined);
            delete chrome.runtime.lastError;
        });
        global.chrome = { runtime: { sendMessage } };

        const failure = await rawSendMessage({ action: 'translate' }).catch(
            (error) => error
        );

        expect(failure).toBeInstanceOf(Error);
        expect(failure.cause).toBe(lastError);
        expect(classifyMessagingFailure(failure)).toBe(
            MessagingFailureClass.PROVEN_NON_DELIVERY
        );
        expect(sendMessage).toHaveBeenCalledTimes(1);
    });

    test('keeps callback classification stable after message mutation', async () => {
        const lastError = new Error(
            'Could not establish connection. Receiving end does not exist.'
        );
        const sendMessage = jest.fn((_message, callback) => {
            chrome.runtime.lastError = lastError;
            callback(undefined);
            delete chrome.runtime.lastError;
        });
        global.chrome = { runtime: { sendMessage } };

        const failure = await rawSendMessage({ action: 'translate' }).catch(
            (error) => error
        );
        expect(isProvenMessagingNonDelivery(failure)).toBe(true);

        failure.message = 'Extension context invalidated.';
        lastError.message = 'The message port closed.';

        expect(isProvenMessagingNonDelivery(failure)).toBe(true);
        expect(classifyMessagingFailure(failure)).toBe(
            MessagingFailureClass.PROVEN_NON_DELIVERY
        );
    });

    test('creates an independently branded wrapper when Chrome reuses a lastError object', async () => {
        const lastError = {
            message:
                'Could not establish connection. Receiving end does not exist.',
        };
        const sendMessage = jest.fn((_message, callback) => {
            chrome.runtime.lastError = lastError;
            callback(undefined);
            delete chrome.runtime.lastError;
        });
        global.chrome = { runtime: { sendMessage } };

        const firstFailure = await rawSendMessage({
            action: 'translate',
        }).catch((error) => error);
        lastError.message =
            'The message port closed before a response was received.';
        const secondFailure = await rawSendMessage({
            action: 'translate',
        }).catch((error) => error);

        expect(firstFailure).not.toBe(secondFailure);
        expect(firstFailure.cause).toBe(lastError);
        expect(secondFailure.cause).toBe(lastError);
        expect(classifyMessagingFailure(firstFailure)).toBe(
            MessagingFailureClass.PROVEN_NON_DELIVERY
        );
        expect(classifyMessagingFailure(secondFailure)).toBe(
            MessagingFailureClass.AMBIGUOUS_ACCEPTANCE
        );
        expect(sendMessage).toHaveBeenCalledTimes(2);
    });

    test('turns a hostile callback lastError Proxy into a fixed terminal error without traps', async () => {
        const traps = {
            get: jest.fn(() => {
                throw new Error('get trap must not run');
            }),
            getOwnPropertyDescriptor: jest.fn(() => {
                throw new Error('descriptor trap must not run');
            }),
            getPrototypeOf: jest.fn(() => {
                throw new Error('prototype trap must not run');
            }),
            ownKeys: jest.fn(() => {
                throw new Error('ownKeys trap must not run');
            }),
        };
        const lastError = new Proxy({}, traps);
        const sendMessage = jest.fn((_message, callback) => {
            chrome.runtime.lastError = lastError;
            callback(undefined);
            delete chrome.runtime.lastError;
        });
        global.chrome = { runtime: { sendMessage } };

        let caughtFailure;
        try {
            await rawSendMessage({ action: 'translate' });
        } catch (error) {
            caughtFailure = error;
        }

        expect(caughtFailure).toBeInstanceOf(Error);
        expect(caughtFailure).not.toBe(lastError);
        expect(caughtFailure.message).toBe('Unknown runtime messaging error');
        expect(caughtFailure.cause).toBe(lastError);
        expect(classifyMessagingFailure(caughtFailure)).toBe(
            MessagingFailureClass.TERMINAL
        );
        expect(
            Object.values(traps).every((trap) => trap.mock.calls.length === 0)
        ).toBe(true);
        expect(sendMessage).toHaveBeenCalledTimes(1);
    });

    test.each(['unavailable', 'throws'])(
        'fails closed when structuredClone is %s',
        async (cloneState) => {
            if (cloneState === 'unavailable') {
                globalThis.structuredClone = undefined;
            } else {
                globalThis.structuredClone = jest.fn(() => {
                    throw new Error('clone failed');
                });
            }
            const lastError = {
                message:
                    'Could not establish connection. Receiving end does not exist.',
            };
            const sendMessage = jest.fn((_message, callback) => {
                chrome.runtime.lastError = lastError;
                callback(undefined);
                delete chrome.runtime.lastError;
            });
            global.chrome = { runtime: { sendMessage } };

            const failure = await rawSendMessage({ action: 'translate' }).catch(
                (error) => error
            );

            expect(failure).toBeInstanceOf(Error);
            expect(failure).not.toBe(lastError);
            expect(failure.message).toBe('Unknown runtime messaging error');
            expect(failure.cause).toBe(lastError);
            expect(classifyMessagingFailure(failure)).toBe(
                MessagingFailureClass.TERMINAL
            );
            expect(isProvenMessagingNonDelivery(failure)).toBe(false);
            expect(sendMessage).toHaveBeenCalledTimes(1);
        }
    );

    test('wraps and terminally brands a lastError getter throw', async () => {
        const failure = new Error('lastError inspection failed');
        const runtime = {
            sendMessage: jest.fn((_message, callback) => callback(undefined)),
        };
        Object.defineProperty(runtime, 'lastError', {
            get() {
                throw failure;
            },
        });
        global.chrome = { runtime };

        const rejection = await rawSendMessage({ action: 'translate' }).catch(
            (error) => error
        );
        expect(rejection).toBeInstanceOf(Error);
        expect(rejection).not.toBe(failure);
        expect(rejection.message).toBe('Unknown runtime messaging error');
        expect(rejection.cause).toBe(failure);
        expect(classifyMessagingFailure(rejection)).toBe(
            MessagingFailureClass.TERMINAL
        );
        expect(runtime.sendMessage).toHaveBeenCalledTimes(1);
    });

    test('wraps a malformed callback lastError as terminal', async () => {
        const lastError = 42;
        const sendMessage = jest.fn((_message, callback) => {
            chrome.runtime.lastError = lastError;
            callback(undefined);
            delete chrome.runtime.lastError;
        });
        global.chrome = { runtime: { sendMessage } };

        const rejection = await rawSendMessage({ action: 'translate' }).catch(
            (error) => error
        );
        expect(rejection).toBeInstanceOf(Error);
        expect(rejection.message).toBe('Unknown runtime messaging error');
        expect(rejection.cause).toBe(lastError);
        expect(classifyMessagingFailure(rejection)).toBe(
            MessagingFailureClass.TERMINAL
        );
        expect(sendMessage).toHaveBeenCalledTimes(1);
    });

    test('resolves a callback-style response after one dispatch', async () => {
        const response = { success: true };
        const sendMessage = jest.fn((_message, callback) => {
            callback(response);
        });
        global.chrome = { runtime: { sendMessage } };

        await expect(rawSendMessage({ action: 'translate' })).resolves.toBe(
            response
        );
        expect(sendMessage).toHaveBeenCalledTimes(1);
    });

    test('resolves a promise-style response after one dispatch', async () => {
        const response = { success: true };
        const sendMessage = jest.fn(() => Promise.resolve(response));
        global.chrome = { runtime: { sendMessage } };

        await expect(rawSendMessage({ action: 'translate' })).resolves.toBe(
            response
        );
        expect(sendMessage).toHaveBeenCalledTimes(1);
    });

    test('settles once when callback-style also returns a promise', async () => {
        const callbackResponse = { source: 'callback' };
        const sendMessage = jest.fn((_message, callback) => {
            callback(callbackResponse);
            return Promise.reject(new Error('late promise rejection'));
        });
        global.chrome = { runtime: { sendMessage } };

        await expect(rawSendMessage({ action: 'translate' })).resolves.toBe(
            callbackResponse
        );
        expect(sendMessage).toHaveBeenCalledTimes(1);
        await Promise.resolve();
    });

    test('keeps the first promise settlement when a callback arrives later', async () => {
        const promiseResponse = { source: 'promise' };
        let releaseCallback;
        const sendMessage = jest.fn((_message, callback) => {
            releaseCallback = () => callback({ source: 'callback' });
            return Promise.resolve(promiseResponse);
        });
        global.chrome = { runtime: { sendMessage } };

        await expect(rawSendMessage({ action: 'translate' })).resolves.toBe(
            promiseResponse
        );
        releaseCallback();
        expect(sendMessage).toHaveBeenCalledTimes(1);
    });

    test('propagates the exact synchronous throw after one dispatch', async () => {
        const failure = new Error('synchronous send failure');
        const sendMessage = jest.fn(() => {
            throw failure;
        });
        global.chrome = { runtime: { sendMessage } };

        await expect(rawSendMessage({ action: 'translate' })).rejects.toBe(
            failure
        );
        expect(sendMessage).toHaveBeenCalledTimes(1);
    });

    test('propagates the exact promise rejection after one dispatch', async () => {
        const failure = new Error('promise send failure');
        const sendMessage = jest.fn(() => Promise.reject(failure));
        global.chrome = { runtime: { sendMessage } };

        await expect(rawSendMessage({ action: 'translate' })).rejects.toBe(
            failure
        );
        expect(sendMessage).toHaveBeenCalledTimes(1);
    });

    test('does not brand a promise rejection with no-receiver text', async () => {
        const failure = new Error(
            'Could not establish connection. Receiving end does not exist.'
        );
        const sendMessage = jest.fn(() => Promise.reject(failure));
        global.chrome = { runtime: { sendMessage } };

        await expect(rawSendMessage({ action: 'translate' })).rejects.toBe(
            failure
        );
        expect(classifyMessagingFailure(failure)).toBe(
            MessagingFailureClass.TERMINAL
        );
        expect(sendMessage).toHaveBeenCalledTimes(1);
    });
});

describe('messaging failure classification', () => {
    test.each([
        'Could not establish connection. Receiving end does not exist.',
        'No matching service worker for this scope.',
        'The message port closed before a response was received.',
        'Extension context invalidated.',
        'Unknown runtime failure.',
    ])('treats public Error and string input as terminal: %s', (message) => {
        expect(classifyMessagingFailure(new Error(message))).toBe(
            MessagingFailureClass.TERMINAL
        );
        expect(classifyMessagingFailure(message)).toBe(
            MessagingFailureClass.TERMINAL
        );
        expect(isProvenMessagingNonDelivery(new Error(message))).toBe(false);
    });

    test('does not inspect arbitrary objects, accessors, or proxies', () => {
        const inherited = Object.create({
            message: 'Receiving end does not exist.',
        });
        const accessor = {};
        const getter = jest.fn(() => {
            throw new Error('message getter should not run');
        });
        Object.defineProperty(accessor, 'message', {
            enumerable: true,
            get: getter,
        });
        const traps = {
            get: jest.fn(
                () =>
                    'Could not establish connection. Receiving end does not exist.'
            ),
            getOwnPropertyDescriptor: jest.fn(() => ({
                configurable: true,
                enumerable: true,
                writable: true,
                value: 'Could not establish connection. Receiving end does not exist.',
            })),
            getPrototypeOf: jest.fn(() => Object.prototype),
            ownKeys: jest.fn(() => ['message']),
        };
        const fabricated = new Proxy({}, traps);
        const revocable = Proxy.revocable({}, traps);
        revocable.revoke();

        expect(classifyMessagingFailure(inherited)).toBe(
            MessagingFailureClass.TERMINAL
        );
        expect(classifyMessagingFailure(accessor)).toBe(
            MessagingFailureClass.TERMINAL
        );
        expect(classifyMessagingFailure(fabricated)).toBe(
            MessagingFailureClass.TERMINAL
        );
        expect(isProvenMessagingNonDelivery(fabricated)).toBe(false);
        expect(classifyMessagingFailure(revocable.proxy)).toBe(
            MessagingFailureClass.TERMINAL
        );
        expect(isProvenMessagingNonDelivery(revocable.proxy)).toBe(false);
        expect(getter).not.toHaveBeenCalled();
        expect(
            Object.values(traps).every((trap) => trap.mock.calls.length === 0)
        ).toBe(true);
    });
});

describe('sendRuntimeMessageWithRetry', () => {
    afterEach(() => {
        jest.useRealTimers();
        delete global.chrome;
        restoreStructuredClone();
    });

    test.each([
        ['returns false', () => false],
        ['returns undefined', () => undefined],
        ['returns a non-boolean value', () => 1],
        ['returns a Promise', () => Promise.resolve(true)],
        [
            'throws',
            () => {
                throw new Error('untrusted dispatch guard failure');
            },
        ],
    ])(
        'blocks the initial main dispatch when canDispatch %s',
        async (_case, guardImplementation) => {
            const sendMessage = jest.fn(() =>
                Promise.resolve({ success: true })
            );
            const canDispatch = jest.fn(guardImplementation);
            global.chrome = { runtime: { sendMessage } };

            const failure = await sendRuntimeMessageWithRetry(
                { action: 'fetchVTT' },
                { canDispatch }
            ).catch((error) => error);

            expect(failure).toBeInstanceOf(Error);
            expect(failure).toEqual(
                expect.objectContaining({
                    name: 'MessagingDispatchBlockedError',
                    message: 'Runtime message dispatch blocked',
                })
            );
            expect(failure).not.toHaveProperty('cause');
            expect(classifyMessagingFailure(failure)).toBe(
                MessagingFailureClass.TERMINAL
            );
            expect(isProvenMessagingNonDelivery(failure)).toBe(false);
            expect(canDispatch).toHaveBeenCalledTimes(1);
            expect(sendMessage).not.toHaveBeenCalled();
        }
    );

    test('revalidates after wake-up and backoff before retrying the main message', async () => {
        jest.useFakeTimers();
        const mainMessage = { action: 'fetchVTT' };
        let routeIsCurrent = true;
        let mainDispatchCount = 0;
        const canDispatch = jest.fn(() => routeIsCurrent);
        const sendMessage = jest.fn((message, callback) => {
            if (message === mainMessage) {
                mainDispatchCount++;
                chrome.runtime.lastError = {
                    message:
                        'Could not establish connection. Receiving end does not exist.',
                };
                callback(undefined);
                delete chrome.runtime.lastError;
                return;
            }
            callback(createReadinessResponse(message.action));
        });
        global.chrome = { runtime: { sendMessage } };

        const result = sendRuntimeMessageWithRetry(mainMessage, {
            retries: 3,
            baseDelayMs: 10,
            pingBeforeRetry: true,
            canDispatch,
        }).catch((error) => error);
        await jest.advanceTimersByTimeAsync(0);

        expect(mainDispatchCount).toBe(1);
        expect(canDispatch).toHaveBeenCalledTimes(1);
        expect(sendMessage).toHaveBeenCalledTimes(2);

        routeIsCurrent = false;
        await jest.advanceTimersByTimeAsync(10);
        const failure = await result;

        expect(failure).toEqual(
            expect.objectContaining({
                name: 'MessagingDispatchBlockedError',
                message: 'Runtime message dispatch blocked',
            })
        );
        expect(classifyMessagingFailure(failure)).toBe(
            MessagingFailureClass.TERMINAL
        );
        expect(mainDispatchCount).toBe(1);
        expect(canDispatch).toHaveBeenCalledTimes(2);
        expect(sendMessage).toHaveBeenCalledTimes(2);
        expect(jest.getTimerCount()).toBe(0);
    });

    test('checks once per main dispatch while leaving readiness pings unguarded', async () => {
        jest.useFakeTimers();
        const mainMessage = { action: 'fetchVTT' };
        const response = { success: true };
        let mainDispatchCount = 0;
        let readinessPingCount = 0;
        const canDispatch = jest.fn(() => true);
        const sendMessage = jest.fn((message, callback) => {
            if (message === mainMessage) {
                mainDispatchCount++;
                if (mainDispatchCount === 1) {
                    chrome.runtime.lastError = {
                        message:
                            'Could not establish connection. Receiving end does not exist.',
                    };
                    callback(undefined);
                    delete chrome.runtime.lastError;
                    return;
                }
                callback(response);
                return;
            }
            readinessPingCount++;
            callback(createReadinessResponse(message.action));
        });
        global.chrome = { runtime: { sendMessage } };

        const result = sendRuntimeMessageWithRetry(mainMessage, {
            retries: 3,
            baseDelayMs: 10,
            pingBeforeRetry: true,
            canDispatch,
        });
        await jest.advanceTimersByTimeAsync(10);

        await expect(result).resolves.toBe(response);
        expect(mainDispatchCount).toBe(2);
        expect(readinessPingCount).toBe(1);
        expect(canDispatch).toHaveBeenCalledTimes(2);
        expect(sendMessage).toHaveBeenCalledTimes(3);
        expect(jest.getTimerCount()).toBe(0);
    });

    test('falls back to an exact ping when the readiness response is uncorrelated', async () => {
        jest.useFakeTimers();
        const mainMessage = { action: 'translate' };
        const response = { translatedText: 'ok' };
        let mainDispatchCount = 0;
        const sendMessage = jest.fn((message, callback) => {
            if (message === mainMessage) {
                mainDispatchCount += 1;
                if (mainDispatchCount === 1) {
                    chrome.runtime.lastError = {
                        message:
                            'Could not establish connection. Receiving end does not exist.',
                    };
                    callback(undefined);
                    delete chrome.runtime.lastError;
                    return;
                }
                callback(response);
                return;
            }
            if (message.action === MessageActions.CHECK_BACKGROUND_READY) {
                callback(createReadinessResponse(MessageActions.PING));
                return;
            }
            callback(createReadinessResponse(message.action));
        });
        global.chrome = { runtime: { sendMessage } };

        const result = sendRuntimeMessageWithRetry(mainMessage, {
            retries: 1,
            baseDelayMs: 10,
            pingBeforeRetry: true,
        });
        await jest.advanceTimersByTimeAsync(10);

        await expect(result).resolves.toBe(response);
        expect(sendMessage.mock.calls.map(([message]) => message)).toEqual([
            mainMessage,
            { action: MessageActions.CHECK_BACKGROUND_READY },
            { action: MessageActions.PING },
            mainMessage,
        ]);
    });

    test('preserves successful dispatch behavior when canDispatch is omitted', async () => {
        const response = { success: true };
        const sendMessage = jest.fn((_message, callback) => {
            callback(response);
        });
        global.chrome = { runtime: { sendMessage } };

        await expect(
            sendRuntimeMessageWithRetry(
                { action: 'translate' },
                { pingBeforeRetry: false }
            )
        ).resolves.toBe(response);
        expect(sendMessage).toHaveBeenCalledTimes(1);
    });

    test('retries once only after a callback-proven non-delivery failure', async () => {
        jest.useFakeTimers();
        const response = { success: true };
        let requestCount = 0;
        const sendMessage = jest.fn((_message, callback) => {
            requestCount++;
            if (requestCount === 1) {
                chrome.runtime.lastError = new Error(
                    'Could not establish connection. Receiving end does not exist.'
                );
                callback(undefined);
                delete chrome.runtime.lastError;
                return;
            }
            callback(response);
        });
        global.chrome = { runtime: { sendMessage } };

        const result = sendRuntimeMessageWithRetry(
            { action: 'translate' },
            {
                retries: 3,
                baseDelayMs: 10,
                backoffFactor: 2,
                pingBeforeRetry: false,
            }
        );
        await jest.advanceTimersByTimeAsync(10);

        await expect(result).resolves.toBe(response);
        expect(sendMessage).toHaveBeenCalledTimes(2);
        expect(jest.getTimerCount()).toBe(0);
    });

    test.each([
        'The message port closed before a response was received.',
        'Extension context invalidated.',
        'Could not establish connection.',
    ])('does not retry %s', async (message) => {
        const failure = new Error(message);
        const sendMessage = jest.fn().mockRejectedValue(failure);
        global.chrome = { runtime: { sendMessage } };

        await expect(
            sendRuntimeMessageWithRetry(
                { action: 'translate' },
                { retries: 3, baseDelayMs: 1, pingBeforeRetry: false }
            )
        ).rejects.toBe(failure);
        expect(sendMessage).toHaveBeenCalledTimes(1);
    });

    test('does not retry an ambiguous callback lastError', async () => {
        const failure = {
            message: 'The message port closed before a response was received.',
        };
        const sendMessage = jest.fn((_message, callback) => {
            chrome.runtime.lastError = failure;
            callback(undefined);
            delete chrome.runtime.lastError;
        });
        global.chrome = { runtime: { sendMessage } };

        const rejection = expect(
            sendRuntimeMessageWithRetry(
                { action: 'translate' },
                { retries: 3, baseDelayMs: 1, pingBeforeRetry: false }
            )
        ).rejects;
        await rejection.toHaveProperty('message', failure.message);
        expect(sendMessage).toHaveBeenCalledTimes(1);
    });

    test.each([
        'Extension context invalidated.',
        'Unknown runtime messaging failure.',
    ])('does not retry a terminal callback lastError: %s', async (message) => {
        jest.useFakeTimers();
        const sendMessage = jest.fn((_request, callback) => {
            chrome.runtime.lastError = { message };
            callback(undefined);
            delete chrome.runtime.lastError;
        });
        global.chrome = { runtime: { sendMessage } };

        await expect(
            sendRuntimeMessageWithRetry(
                { action: 'translate' },
                { retries: 3, baseDelayMs: 1, pingBeforeRetry: false }
            )
        ).rejects.toHaveProperty('message', message);
        expect(sendMessage).toHaveBeenCalledTimes(1);
        expect(jest.getTimerCount()).toBe(0);
    });

    test('does not retry a promise Error with identical no-receiver text', async () => {
        jest.useFakeTimers();
        const failure = new Error(
            'Could not establish connection. Receiving end does not exist.'
        );
        const sendMessage = jest.fn().mockRejectedValue(failure);
        global.chrome = { runtime: { sendMessage } };

        await expect(
            sendRuntimeMessageWithRetry(
                { action: 'translate' },
                { retries: 3, baseDelayMs: 1, pingBeforeRetry: false }
            )
        ).rejects.toBe(failure);
        expect(sendMessage).toHaveBeenCalledTimes(1);
        expect(jest.getTimerCount()).toBe(0);
    });
});
