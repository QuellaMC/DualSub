import { jest } from '@jest/globals';

import {
    isProvenMessagingNonDelivery,
    sendRuntimeMessageWithRetry,
} from './messaging.js';

const NO_RECEIVER_ERROR =
    'Could not establish connection. Receiving end does not exist.';
const NO_SERVICE_WORKER_ERROR = 'No matching service worker for this scope.';

function installSendMessage(implementation) {
    const sendMessage = jest.fn(implementation);
    global.chrome = { runtime: { sendMessage } };
    return sendMessage;
}

describe('isProvenMessagingNonDelivery', () => {
    test.each([NO_RECEIVER_ERROR, NO_SERVICE_WORKER_ERROR])(
        'recognizes a known Chrome non-delivery error: %s',
        (message) => {
            expect(isProvenMessagingNonDelivery(new Error(message))).toBe(true);
        }
    );

    test.each([
        'The message port closed before a response was received.',
        'The message channel closed before a response was received.',
        'Extension context invalidated.',
        'Could not establish connection.',
        'Unknown runtime failure.',
    ])('does not classify an ambiguous or terminal error: %s', (message) => {
        expect(isProvenMessagingNonDelivery(new Error(message))).toBe(false);
    });

    test('rejects values outside the public Error contract', () => {
        expect(isProvenMessagingNonDelivery(NO_RECEIVER_ERROR)).toBe(false);
        expect(isProvenMessagingNonDelivery(null)).toBe(false);
        expect(
            isProvenMessagingNonDelivery({ message: NO_RECEIVER_ERROR })
        ).toBe(false);
    });
});

describe('sendRuntimeMessageWithRetry', () => {
    afterEach(() => {
        jest.useRealTimers();
        delete global.chrome;
    });

    test('dispatches with the Promise API and returns the response', async () => {
        const message = { action: 'translate' };
        const response = { translatedText: 'ok' };
        const sendMessage = installSendMessage(() => Promise.resolve(response));

        await expect(sendRuntimeMessageWithRetry(message)).resolves.toBe(
            response
        );
        expect(sendMessage).toHaveBeenCalledTimes(1);
        expect(sendMessage).toHaveBeenCalledWith(message);
    });

    test('rejects an invalid message before authorization or dispatch', async () => {
        const canDispatch = jest.fn(() => true);
        const sendMessage = installSendMessage(() => Promise.resolve());

        await expect(
            sendRuntimeMessageWithRetry({}, { canDispatch })
        ).rejects.toThrow(
            'sendRuntimeMessageWithRetry: message.action is required'
        );
        expect(canDispatch).not.toHaveBeenCalled();
        expect(sendMessage).not.toHaveBeenCalled();
    });

    test('fails cleanly when runtime messaging is unavailable', async () => {
        await expect(
            sendRuntimeMessageWithRetry({ action: 'translate' })
        ).rejects.toThrow('Messaging unavailable');
    });

    test.each([
        ['returns false', () => false],
        ['returns undefined', () => undefined],
        ['returns a non-boolean value', () => 1],
        ['returns a Promise', () => Promise.resolve(true)],
        [
            'throws',
            () => {
                throw new Error('guard failure');
            },
        ],
    ])(
        'blocks dispatch when canDispatch %s',
        async (_case, guardImplementation) => {
            const sendMessage = installSendMessage(() =>
                Promise.resolve({ success: true })
            );
            const canDispatch = jest.fn(guardImplementation);

            await expect(
                sendRuntimeMessageWithRetry(
                    { action: 'fetchVTT' },
                    { canDispatch }
                )
            ).rejects.toEqual(
                expect.objectContaining({
                    name: 'MessagingDispatchBlockedError',
                    message: 'Runtime message dispatch blocked',
                })
            );
            expect(canDispatch).toHaveBeenCalledTimes(1);
            expect(sendMessage).not.toHaveBeenCalled();
        }
    );

    test('dispatches when canDispatch returns exactly true', async () => {
        const response = { success: true };
        const sendMessage = installSendMessage(() => Promise.resolve(response));
        const canDispatch = jest.fn(() => true);

        await expect(
            sendRuntimeMessageWithRetry({ action: 'fetchVTT' }, { canDispatch })
        ).resolves.toBe(response);
        expect(canDispatch).toHaveBeenCalledTimes(1);
        expect(sendMessage).toHaveBeenCalledTimes(1);
    });

    test.each([NO_RECEIVER_ERROR, NO_SERVICE_WORKER_ERROR])(
        'retries a known non-delivery without an extra readiness message: %s',
        async (messageText) => {
            jest.useFakeTimers();
            const message = { action: 'translate' };
            const response = { translatedText: 'ok' };
            const sendMessage = installSendMessage()
                .mockRejectedValueOnce(new Error(messageText))
                .mockResolvedValueOnce(response);

            const result = sendRuntimeMessageWithRetry(message, {
                retries: 1,
                baseDelayMs: 10,
            });
            await jest.advanceTimersByTimeAsync(10);

            await expect(result).resolves.toBe(response);
            expect(sendMessage).toHaveBeenCalledTimes(2);
            expect(sendMessage.mock.calls).toEqual([[message], [message]]);
            expect(jest.getTimerCount()).toBe(0);
        }
    );

    test('rechecks canDispatch immediately before a retry', async () => {
        jest.useFakeTimers();
        const message = { action: 'fetchVTT' };
        let isCurrent = true;
        const canDispatch = jest.fn(() => isCurrent);
        const sendMessage = installSendMessage(() =>
            Promise.reject(new Error(NO_RECEIVER_ERROR))
        );

        const result = sendRuntimeMessageWithRetry(message, {
            retries: 2,
            baseDelayMs: 10,
            canDispatch,
        });
        await jest.advanceTimersByTimeAsync(0);
        expect(sendMessage).toHaveBeenCalledTimes(1);

        isCurrent = false;
        const rejection = expect(result).rejects.toEqual(
            expect.objectContaining({
                name: 'MessagingDispatchBlockedError',
                message: 'Runtime message dispatch blocked',
            })
        );
        await jest.advanceTimersByTimeAsync(10);
        await rejection;

        expect(canDispatch).toHaveBeenCalledTimes(2);
        expect(sendMessage).toHaveBeenCalledTimes(1);
        expect(jest.getTimerCount()).toBe(0);
    });

    test('stops after the configured retry count', async () => {
        jest.useFakeTimers();
        const message = { action: 'translate' };
        const sendMessage = installSendMessage(() =>
            Promise.reject(new Error(NO_RECEIVER_ERROR))
        );

        const result = sendRuntimeMessageWithRetry(message, {
            retries: 2,
            baseDelayMs: 10,
            backoffFactor: 2,
        });
        const outcome = result.then(
            (value) => ({ value }),
            (error) => ({ error })
        );
        await jest.advanceTimersByTimeAsync(30);

        const { error: failure, value } = await outcome;
        expect(value).toBeUndefined();
        expect(failure).toBeInstanceOf(Error);
        expect(failure.message).toBe(NO_RECEIVER_ERROR);
        expect(isProvenMessagingNonDelivery(failure)).toBe(true);
        expect(sendMessage).toHaveBeenCalledTimes(3);
        expect(jest.getTimerCount()).toBe(0);
    });

    test.each([
        'The message port closed before a response was received.',
        'Extension context invalidated.',
        'Could not establish connection.',
    ])(
        'does not retry an ambiguous or terminal failure: %s',
        async (message) => {
            jest.useFakeTimers();
            const original = new Error(message);
            const sendMessage = installSendMessage(() =>
                Promise.reject(original)
            );

            const failure = await sendRuntimeMessageWithRetry(
                { action: 'translate' },
                { retries: 3, baseDelayMs: 1 }
            ).catch((error) => error);

            expect(failure).toBeInstanceOf(Error);
            expect(failure).not.toBe(original);
            expect(failure.message).toBe(message);
            expect(isProvenMessagingNonDelivery(failure)).toBe(false);
            expect(sendMessage).toHaveBeenCalledTimes(1);
            expect(jest.getTimerCount()).toBe(0);
        }
    );

    test.each([
        ['a non-Error rejection', { internal: 'details' }],
        ['an empty Error', new Error('')],
    ])('sanitizes %s', async (_case, rejection) => {
        const sendMessage = installSendMessage(() => Promise.reject(rejection));

        const failure = await sendRuntimeMessageWithRetry({
            action: 'translate',
        }).catch((error) => error);

        expect(failure).toBeInstanceOf(Error);
        expect(failure).not.toBe(rejection);
        expect(failure.message).toBe('Unknown runtime messaging error');
        expect(failure).not.toHaveProperty('cause');
        expect(sendMessage).toHaveBeenCalledTimes(1);
    });

    test('sanitizes a synchronous sendMessage throw', async () => {
        const original = new Error('Synchronous runtime failure');
        const sendMessage = installSendMessage(() => {
            throw original;
        });

        const failure = await sendRuntimeMessageWithRetry({
            action: 'translate',
        }).catch((error) => error);

        expect(failure).toBeInstanceOf(Error);
        expect(failure).not.toBe(original);
        expect(failure.message).toBe(original.message);
        expect(sendMessage).toHaveBeenCalledTimes(1);
    });
});
