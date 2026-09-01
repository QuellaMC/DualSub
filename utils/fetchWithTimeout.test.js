/** @jest-environment node */

import { afterEach, describe, expect, jest, test } from '@jest/globals';
import {
    cancelResponseBodySafely,
    fetchWithTimeout,
    getUtf8ByteLength,
    isResponseBodyLimitError,
    readResponseTextWithLimit,
} from './fetchWithTimeout.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.useRealTimers();
    jest.restoreAllMocks();
});

function expectErrorToExclude(error, ...sensitiveValues) {
    const rendered = [
        error?.message,
        String(error),
        error?.stack,
        JSON.stringify(error),
    ].join('\n');

    for (const sensitiveValue of sensitiveValues) {
        expect(rendered).not.toContain(sensitiveValue);
    }
    for (const property of ['cause', 'input', 'url', 'reason']) {
        expect(Object.hasOwn(error, property)).toBe(false);
    }
}

function setResponseNavigationMetadata(response, url, redirected) {
    Object.defineProperties(response, {
        redirected: { configurable: true, value: redirected },
        url: { configurable: true, value: url },
    });
    return response;
}

function createAbortAwareResponse(signal, source = {}) {
    return new Response(
        new ReadableStream({
            ...source,
            start(controller) {
                source.start?.(controller);
                signal.addEventListener(
                    'abort',
                    () => controller.error(signal.reason),
                    { once: true }
                );
            },
        })
    );
}

describe('fetchWithTimeout', () => {
    test.each([0, 1.5, 2_147_483_648])(
        'rejects invalid timeout %p before fetching',
        async (timeoutMs) => {
            globalThis.fetch = jest.fn();

            await expect(
                fetchWithTimeout('https://provider.example.test', {}, timeoutMs)
            ).rejects.toMatchObject({
                name: 'TypeError',
                code: 'ERR_FETCH_TIMEOUT_INVALID',
            });
            expect(globalThis.fetch).not.toHaveBeenCalled();
        }
    );

    test('returns the original Response with final navigation metadata and working body methods', async () => {
        jest.useFakeTimers();
        const response = setResponseNavigationMetadata(
            new Response(JSON.stringify({ translated: true }), {
                headers: { 'content-type': 'application/json' },
                status: 200,
            }),
            'https://cdn.example.test/final',
            true
        );
        globalThis.fetch = jest.fn().mockResolvedValue(response);

        const result = await fetchWithTimeout(
            'https://provider.example.test/request'
        );

        expect(result).toBe(response);
        expect(result).toBeInstanceOf(Response);
        expect(result).toMatchObject({
            ok: true,
            redirected: true,
            status: 200,
            url: 'https://cdn.example.test/final',
        });
        await expect(result.json()).resolves.toEqual({ translated: true });
        expect(jest.getTimerCount()).toBe(0);
    });

    test('aborts a stalled fetch with a stable retryable timeout error', async () => {
        jest.useFakeTimers();
        let internalSignal;
        globalThis.fetch = jest.fn((_input, { signal }) => {
            internalSignal = signal;
            return new Promise((_resolve, reject) => {
                signal.addEventListener('abort', () => reject(signal.reason), {
                    once: true,
                });
            });
        });

        const request = fetchWithTimeout(
            'https://provider.example.test/request',
            {},
            25
        );
        const expectation = expect(request).rejects.toMatchObject({
            name: 'TimeoutError',
            message: 'Request timed out after 25ms',
            code: 'ERR_FETCH_TIMEOUT',
            retryable: true,
        });
        await jest.advanceTimersByTimeAsync(25);

        await expectation;
        expect(internalSignal.aborted).toBe(true);
        expect(jest.getTimerCount()).toBe(0);
    });

    test('propagates caller abort without retaining the caller reason', async () => {
        const callerController = new AbortController();
        let internalSignal;
        globalThis.fetch = jest.fn((_input, { signal }) => {
            internalSignal = signal;
            return new Promise((_resolve, reject) => {
                signal.addEventListener('abort', () => reject(signal.reason), {
                    once: true,
                });
            });
        });

        const request = fetchWithTimeout('https://provider.example.test', {
            signal: callerController.signal,
        });
        const expectation = expect(request).rejects.toMatchObject({
            name: 'AbortError',
            message: 'Request was aborted by the caller.',
            code: 'ERR_FETCH_ABORTED',
        });
        await Promise.resolve();
        callerController.abort(new Error('PRIVATE_CALLER_ABORT_REASON'));

        const error = await request.catch((caughtError) => caughtError);
        await expectation;
        expect(internalSignal.aborted).toBe(true);
        expectErrorToExclude(error, 'PRIVATE_CALLER_ABORT_REASON');
    });

    test('keeps one absolute deadline active through body consumption', async () => {
        jest.useFakeTimers();
        let internalSignal;
        globalThis.fetch = jest.fn((_input, { signal }) => {
            internalSignal = signal;
            return new Promise((resolve) => {
                setTimeout(() => resolve(createAbortAwareResponse(signal)), 10);
            });
        });

        const request = fetchWithTimeout(
            'https://provider.example.test/request',
            {},
            25
        );
        await jest.advanceTimersByTimeAsync(10);
        const response = await request;
        const bodyRead = response.text();
        let bodyError;
        void bodyRead.catch((error) => {
            bodyError = error;
        });

        await jest.advanceTimersByTimeAsync(14);
        expect(bodyError).toBeUndefined();
        await jest.advanceTimersByTimeAsync(1);

        expect(bodyError).toMatchObject({
            name: 'TimeoutError',
            code: 'ERR_FETCH_TIMEOUT',
            retryable: true,
        });
        expect(internalSignal.aborted).toBe(true);
        expect(jest.getTimerCount()).toBe(0);
    });

    test('keeps caller abort propagation active through body consumption', async () => {
        const callerController = new AbortController();
        let internalSignal;
        globalThis.fetch = jest.fn((_input, { signal }) => {
            internalSignal = signal;
            return Promise.resolve(createAbortAwareResponse(signal));
        });
        const response = await fetchWithTimeout(
            'https://provider.example.test/request',
            { signal: callerController.signal }
        );
        const bodyRead = response.text();

        callerController.abort(new Error('PRIVATE_BODY_ABORT_REASON'));
        const error = await bodyRead.catch((caughtError) => caughtError);

        expect(error).toMatchObject({
            name: 'AbortError',
            message: 'Request was aborted by the caller.',
            code: 'ERR_FETCH_ABORTED',
        });
        expect(internalSignal.aborted).toBe(true);
        expectErrorToExclude(error, 'PRIVATE_BODY_ABORT_REASON');
    });

    test('governs the underlying response body for direct stream readers', async () => {
        jest.useFakeTimers();
        let internalSignal;
        globalThis.fetch = jest.fn((_input, { signal }) => {
            internalSignal = signal;
            return Promise.resolve(createAbortAwareResponse(signal));
        });
        const response = await fetchWithTimeout(
            'https://provider.example.test/request',
            {},
            25
        );
        const reader = response.body.getReader();
        const reading = reader.read();
        const expectation = expect(reading).rejects.toMatchObject({
            name: 'TimeoutError',
            code: 'ERR_FETCH_TIMEOUT',
        });

        await jest.advanceTimersByTimeAsync(25);

        await expectation;
        expect(internalSignal.aborted).toBe(true);
        expect(jest.getTimerCount()).toBe(0);
        reader.releaseLock();
    });

    test('redacts signed URLs and native fetch failures', async () => {
        const signedUrl =
            'https://provider.example.test/request?token=PRIVATE_FETCH_TOKEN';
        const rawError = Object.assign(
            new TypeError(`Network failed for ${signedUrl}`, {
                cause: new Error('PRIVATE_FETCH_CAUSE'),
            }),
            { input: signedUrl, url: signedUrl }
        );
        globalThis.fetch = jest.fn().mockRejectedValue(rawError);

        const error = await fetchWithTimeout(signedUrl).catch(
            (caughtError) => caughtError
        );

        expect(error).not.toBe(rawError);
        expect(error).toMatchObject({
            name: 'TypeError',
            message: 'Failed to fetch',
            code: 'ERR_FETCH_FAILED',
            retryable: true,
        });
        expectErrorToExclude(
            error,
            signedUrl,
            'PRIVATE_FETCH_TOKEN',
            'PRIVATE_FETCH_CAUSE'
        );
    });

    test('redacts native response body failures', async () => {
        const secret = 'PRIVATE_BODY_READ_FAILURE';
        const response = new Response(
            new ReadableStream({
                start(controller) {
                    controller.error(
                        Object.assign(new TypeError(secret), {
                            url: `https://cdn.example.test/${secret}`,
                        })
                    );
                },
            })
        );
        globalThis.fetch = jest.fn().mockResolvedValue(response);

        const result = await fetchWithTimeout(
            'https://provider.example.test/request'
        );
        const error = await result.text().catch((caughtError) => caughtError);

        expect(error).toMatchObject({
            name: 'TypeError',
            message: 'Failed to read response body.',
            code: 'ERR_RESPONSE_BODY_READ',
            retryable: true,
        });
        expectErrorToExclude(error, secret);
    });
});

describe('readResponseTextWithLimit', () => {
    test.each([0, -1, 1.5])(
        'rejects invalid byte limit %p',
        async (maxBytes) => {
            await expect(
                readResponseTextWithLimit(new Response('body'), maxBytes)
            ).rejects.toThrow('maxBytes must be a positive safe integer.');
        }
    );

    test('accepts a streamed UTF-8 body at the exact byte limit', async () => {
        const text = 'A€';
        const bytes = new TextEncoder().encode(text);
        const response = new Response(
            new ReadableStream({
                start(controller) {
                    controller.enqueue(bytes.slice(0, 2));
                    controller.enqueue(bytes.slice(2));
                    controller.close();
                },
            })
        );

        await expect(
            readResponseTextWithLimit(response, bytes.byteLength)
        ).resolves.toBe(text);
        expect(response.body.locked).toBe(false);
        expect(getUtf8ByteLength(text)).toBe(bytes.byteLength);
    });

    test('rejects oversized Content-Length before acquiring a reader', async () => {
        const cancel = jest.fn().mockResolvedValue(undefined);
        const getReader = jest.fn();
        const response = {
            body: { cancel, getReader },
            headers: new Headers({ 'content-length': '9' }),
        };

        const error = await readResponseTextWithLimit(response, 8).catch(
            (caughtError) => caughtError
        );

        expect(error).toMatchObject({
            name: 'ResponseBodyLimitError',
            code: 'ERR_RESPONSE_BODY_LIMIT',
            limitBytes: 8,
            observedBytes: 9,
        });
        expect(getReader).not.toHaveBeenCalled();
        expect(cancel).toHaveBeenCalledWith(error);
    });

    test('stops, cancels, and unlocks a stream as soon as its byte cap is exceeded', async () => {
        const cancel = jest.fn();
        const response = new Response(
            new ReadableStream({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode('1234'));
                    controller.enqueue(new TextEncoder().encode('5678'));
                },
                cancel,
            })
        );

        const error = await readResponseTextWithLimit(response, 6).catch(
            (caughtError) => caughtError
        );

        expect(error).toMatchObject({
            name: 'ResponseBodyLimitError',
            code: 'ERR_RESPONSE_BODY_LIMIT',
            limitBytes: 6,
            observedBytes: 8,
        });
        expect(cancel).toHaveBeenCalledWith(error);
        expect(response.body.locked).toBe(false);
        expect(isResponseBodyLimitError(error)).toBe(true);
    });

    test('keeps the fetch deadline active during bounded stream reading', async () => {
        jest.useFakeTimers();
        let internalSignal;
        globalThis.fetch = jest.fn((_input, { signal }) => {
            internalSignal = signal;
            return Promise.resolve(createAbortAwareResponse(signal));
        });
        const response = await fetchWithTimeout(
            'https://provider.example.test/subtitle',
            {},
            25
        );

        const bodyRead = readResponseTextWithLimit(response, 64);
        const expectation = expect(bodyRead).rejects.toMatchObject({
            name: 'TimeoutError',
            code: 'ERR_FETCH_TIMEOUT',
        });
        await jest.advanceTimersByTimeAsync(25);

        await expectation;
        expect(internalSignal.aborted).toBe(true);
        expect(response.body.locked).toBe(false);
        expect(jest.getTimerCount()).toBe(0);
    });

    test('reads an empty valid Response without a body stream', async () => {
        await expect(
            readResponseTextWithLimit(new Response(null, { status: 204 }), 1)
        ).resolves.toBe('');
    });
});

describe('cancelResponseBodySafely', () => {
    test('cancels without retaining an untrusted reason', async () => {
        const cancel = jest.fn().mockResolvedValue(undefined);
        const response = { body: { cancel } };

        cancelResponseBodySafely(
            response,
            new Error('PRIVATE_CANCELLATION_REASON')
        );
        await Promise.resolve();

        expect(cancel).toHaveBeenCalledTimes(1);
        const reason = cancel.mock.calls[0][0];
        expect(reason).toMatchObject({
            name: 'AbortError',
            message: 'Response body consumption was cancelled.',
            code: 'ERR_RESPONSE_BODY_CANCELLED',
        });
        expectErrorToExclude(reason, 'PRIVATE_CANCELLATION_REASON');
    });
});
