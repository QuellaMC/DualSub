import { afterEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import {
    DispatchBlockedError,
    MessagingError,
    MessagingFailureClass,
    ProtocolError,
    sendMessage,
    sendWithRetry,
} from './client';
import { translate } from './contracts/translate';

const validRequest = {
    action: 'translate' as const,
    text: 'Hello',
    targetLang: 'zh-CN',
    cueStart: 1,
    cueVideoId: 'v1',
};

const validResponse = {
    success: true,
    translatedText: '你好',
    cached: false,
    processingTime: 3,
};

const NON_DELIVERY = new Error(
    'Could not establish connection. Receiving end does not exist.'
);

function mockTransport(
    implementation: (message: { action: string }) => Promise<unknown>
) {
    return vi
        .spyOn(browser.runtime, 'sendMessage')
        .mockImplementation(implementation as never);
}

describe('sendMessage', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns the parsed typed response', async () => {
        mockTransport(() => Promise.resolve(validResponse));
        await expect(sendMessage(translate, validRequest)).resolves.toEqual(
            validResponse
        );
    });

    it('rejects invalid payloads before touching the transport', async () => {
        const transport = mockTransport(() => Promise.resolve(validResponse));
        await expect(
            sendMessage(translate, { ...validRequest, text: '   ' })
        ).rejects.toThrow();
        expect(transport).not.toHaveBeenCalled();
    });

    it('throws ProtocolError on missing or malformed responses', async () => {
        mockTransport(() => Promise.resolve(undefined));
        await expect(
            sendMessage(translate, validRequest)
        ).rejects.toBeInstanceOf(ProtocolError);

        mockTransport(() => Promise.resolve({ weird: true }));
        await expect(
            sendMessage(translate, validRequest)
        ).rejects.toBeInstanceOf(ProtocolError);
    });

    it('classifies transport failures', async () => {
        mockTransport(() => Promise.reject(NON_DELIVERY));
        await expect(
            sendMessage(translate, validRequest)
        ).rejects.toMatchObject({
            name: 'MessagingError',
            failureClass: MessagingFailureClass.PROVEN_NON_DELIVERY,
        });

        mockTransport(() =>
            Promise.reject(
                new Error(
                    'The message port closed before a response was received.'
                )
            )
        );
        await expect(
            sendMessage(translate, validRequest)
        ).rejects.toMatchObject({
            failureClass: MessagingFailureClass.AMBIGUOUS_ACCEPTANCE,
        });

        mockTransport(() =>
            Promise.reject(new Error('Extension context invalidated.'))
        );
        await expect(
            sendMessage(translate, validRequest)
        ).rejects.toMatchObject({
            failureClass: MessagingFailureClass.TERMINAL,
        });
    });

    it('sanitizes exotic rejection values', async () => {
        // A non-Error rejection is exactly what this test exercises.
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        mockTransport(() => Promise.reject('raw string rejection'));
        const error = await sendMessage(translate, validRequest).catch(
            (caught: unknown) => caught
        );
        expect(error).toBeInstanceOf(MessagingError);
        expect((error as MessagingError).message).toBe(
            'Unknown runtime messaging error'
        );
    });
});

describe('sendWithRetry', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('retries only after proven non-delivery, then succeeds', async () => {
        let mainAttempts = 0;
        let probes = 0;
        mockTransport((message) => {
            if (message.action !== 'translate') {
                probes += 1;
                return Promise.reject(NON_DELIVERY);
            }
            mainAttempts += 1;
            return mainAttempts <= 2
                ? Promise.reject(NON_DELIVERY)
                : Promise.resolve(validResponse);
        });

        await expect(
            sendWithRetry(translate, validRequest, { baseDelayMs: 1 })
        ).resolves.toEqual(validResponse);
        expect(mainAttempts).toBe(3);
        expect(probes).toBeGreaterThan(0);
    });

    it('gives up after the retry budget', async () => {
        let mainAttempts = 0;
        mockTransport((message) => {
            if (message.action === 'translate') {
                mainAttempts += 1;
            }
            return Promise.reject(NON_DELIVERY);
        });
        await expect(
            sendWithRetry(translate, validRequest, {
                retries: 2,
                baseDelayMs: 1,
                pingBeforeRetry: false,
            })
        ).rejects.toBeInstanceOf(MessagingError);
        expect(mainAttempts).toBe(3);
    });

    it.each([
        ['ambiguous channel closure', 'The message port closed early.'],
        ['terminal failure', 'Extension context invalidated.'],
    ])('never retries after %s', async (_label, message) => {
        let mainAttempts = 0;
        mockTransport(() => {
            mainAttempts += 1;
            return Promise.reject(new Error(message));
        });
        await expect(
            sendWithRetry(translate, validRequest, { baseDelayMs: 1 })
        ).rejects.toBeInstanceOf(MessagingError);
        expect(mainAttempts).toBe(1);
    });

    it('honors the canDispatch gate before every attempt', async () => {
        const transport = mockTransport(() => Promise.resolve(validResponse));
        await expect(
            sendWithRetry(translate, validRequest, {
                canDispatch: () => false,
            })
        ).rejects.toBeInstanceOf(DispatchBlockedError);
        expect(transport).not.toHaveBeenCalled();

        await expect(
            sendWithRetry(translate, validRequest, {
                canDispatch: () => {
                    throw new Error('gate exploded');
                },
            })
        ).rejects.toBeInstanceOf(DispatchBlockedError);
    });
});
