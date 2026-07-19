/** @jest-environment node */

import { jest } from '@jest/globals';
import {
    ResponseBodyLimitError,
    cancelResponseBodySafely,
    fetchWithTimeout,
    isResponseBodyLimitError,
    readResponseTextWithLimit,
} from './fetchWithTimeout.js';

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

describe('fetchWithTimeout', () => {
    test.each([
        ['zero', 0],
        ['negative', -1],
        ['fractional', 1.5],
        ['NaN', Number.NaN],
        ['positive infinity', Number.POSITIVE_INFINITY],
        ['negative infinity', Number.NEGATIVE_INFINITY],
        ['above the timer ceiling', 2_147_483_648],
        ['maximum safe integer', Number.MAX_SAFE_INTEGER],
        ['numeric string', '25'],
        ['null', null],
        ['bigint', 25n],
        ['symbol', Symbol('PRIVATE_TIMEOUT_SYMBOL')],
    ])(
        'rejects a %s timeout before starting any work',
        async (_name, timeoutMs) => {
            jest.useFakeTimers();
            const originalAbortController = global.AbortController;
            const originalFetch = global.fetch;
            const abortControllerConstructor = jest.fn(
                () => new originalAbortController()
            );
            global.AbortController = abortControllerConstructor;
            global.fetch = jest.fn();

            try {
                const error = await fetchWithTimeout(
                    'https://provider.example.test/request',
                    {},
                    timeoutMs
                ).catch((caughtError) => caughtError);

                expect(error).toBeInstanceOf(TypeError);
                expect(error).toMatchObject({
                    name: 'TypeError',
                    message:
                        'timeoutMs must be a positive safe integer no greater than 2147483647.',
                    code: 'ERR_FETCH_TIMEOUT_INVALID',
                });
                expectErrorToExclude(error, 'PRIVATE_TIMEOUT_SYMBOL');
                expect(abortControllerConstructor).not.toHaveBeenCalled();
                expect(global.fetch).not.toHaveBeenCalled();
                expect(jest.getTimerCount()).toBe(0);
            } finally {
                global.AbortController = originalAbortController;
                global.fetch = originalFetch;
                jest.useRealTimers();
            }
        }
    );

    test('does not coerce a hostile timeout before rejecting it', async () => {
        jest.useFakeTimers();
        const originalAbortController = global.AbortController;
        const originalFetch = global.fetch;
        const timeoutSecret = 'PRIVATE_TIMEOUT_COERCION_FAILURE';
        const coerceTimeout = jest.fn(() => {
            throw new Error(timeoutSecret);
        });
        const abortControllerConstructor = jest.fn(
            () => new originalAbortController()
        );
        global.AbortController = abortControllerConstructor;
        global.fetch = jest.fn();

        try {
            const error = await fetchWithTimeout(
                'https://provider.example.test/request',
                {},
                { [Symbol.toPrimitive]: coerceTimeout }
            ).catch((caughtError) => caughtError);

            expect(coerceTimeout).not.toHaveBeenCalled();
            expect(error).toMatchObject({
                name: 'TypeError',
                message:
                    'timeoutMs must be a positive safe integer no greater than 2147483647.',
                code: 'ERR_FETCH_TIMEOUT_INVALID',
            });
            expectErrorToExclude(error, timeoutSecret);
            expect(abortControllerConstructor).not.toHaveBeenCalled();
            expect(global.fetch).not.toHaveBeenCalled();
            expect(jest.getTimerCount()).toBe(0);
        } finally {
            global.AbortController = originalAbortController;
            global.fetch = originalFetch;
            jest.useRealTimers();
        }
    });

    test('accepts the maximum supported timeout', async () => {
        const originalFetch = global.fetch;
        const dateNow = jest
            .spyOn(Date, 'now')
            .mockReturnValueOnce(1_000)
            .mockReturnValue(900);
        const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
        global.fetch = jest.fn().mockResolvedValue({ ok: true });

        try {
            await expect(
                fetchWithTimeout(
                    'https://provider.example.test/request',
                    {},
                    2_147_483_647
                )
            ).resolves.toMatchObject({ ok: true });
            expect(global.fetch).toHaveBeenCalledTimes(1);
            expect(setTimeoutSpy).toHaveBeenCalledWith(
                expect.any(Function),
                2_147_483_647
            );
        } finally {
            setTimeoutSpy.mockRestore();
            dateNow.mockRestore();
            global.fetch = originalFetch;
        }
    });

    test('inherits a genuine Request input signal without reading an override', async () => {
        const originalFetch = global.fetch;
        const callerController = new AbortController();
        const request = new Request('https://provider.example.test/request', {
            signal: callerController.signal,
        });
        const requestSignalSecret = 'PRIVATE_REQUEST_SIGNAL_GETTER_FAILURE';
        const requestSignalGetter = jest.fn(() => {
            throw new Error(requestSignalSecret);
        });
        Object.defineProperty(request, 'signal', {
            configurable: true,
            enumerable: true,
            get: requestSignalGetter,
        });
        callerController.abort(new Error('PRIVATE_REQUEST_INPUT_ABORT_REASON'));
        global.fetch = jest.fn();

        try {
            const error = await fetchWithTimeout(request).catch(
                (caughtError) => caughtError
            );

            expect(requestSignalGetter).not.toHaveBeenCalled();
            expect(global.fetch.mock.calls).toHaveLength(0);
            expect(error).toMatchObject({
                name: 'AbortError',
                message: 'Request was aborted by the caller.',
                code: 'ERR_FETCH_ABORTED',
            });
            expectErrorToExclude(
                error,
                requestSignalSecret,
                'PRIVATE_REQUEST_INPUT_ABORT_REASON'
            );
        } finally {
            global.fetch = originalFetch;
        }
    });

    test('reads an enumerable caller signal once before invoking fetch', async () => {
        const originalFetch = global.fetch;
        const requestController = new AbortController();
        const request = new Request('https://provider.example.test/request', {
            signal: requestController.signal,
        });
        requestController.abort(
            new Error('PRIVATE_REQUEST_SIGNAL_SUPPRESSED_BY_NULL')
        );
        const signalSecret = 'PRIVATE_SECOND_SIGNAL_GETTER_FAILURE';
        const signalGetter = jest
            .fn()
            .mockReturnValueOnce(null)
            .mockImplementation(() => {
                throw new Error(signalSecret);
            });
        const init = {};
        Object.defineProperty(init, 'signal', {
            configurable: true,
            enumerable: true,
            get: signalGetter,
        });
        let internalSignal;
        global.fetch = jest.fn((_input, derivedInit) => {
            internalSignal = derivedInit.signal;
            return Promise.resolve({ ok: true });
        });

        try {
            const response = await fetchWithTimeout(request, init);

            expect(signalGetter).toHaveBeenCalledTimes(1);
            expect(global.fetch.mock.calls).toHaveLength(1);
            expect(internalSignal).toBeInstanceOf(AbortSignal);
            expect(internalSignal.aborted).toBe(false);
            expect(response).toMatchObject({ ok: true });
        } finally {
            global.fetch = originalFetch;
        }
    });

    test.each([
        ['false', false],
        ['zero', 0],
        ['empty string', ''],
        ['NaN', Number.NaN],
    ])('rejects a non-nullish falsy %s signal', async (_name, signal) => {
        const originalFetch = global.fetch;
        global.fetch = jest.fn().mockResolvedValue({ ok: true });

        try {
            const error = await fetchWithTimeout(
                'https://provider.example.test/request',
                { signal }
            ).catch((caughtError) => caughtError);

            expect(global.fetch.mock.calls).toHaveLength(0);
            expect(error).toMatchObject({
                name: 'TypeError',
                message: 'Failed to fetch',
                code: 'ERR_FETCH_FAILED',
                retryable: true,
            });
        } finally {
            global.fetch = originalFetch;
        }
    });

    test('does not inspect the signal descriptor after resolving a Proxy signal', async () => {
        const originalFetch = global.fetch;
        const descriptorSecret = 'PRIVATE_SIGNAL_DESCRIPTOR_FAILURE';
        const signalGetter = jest.fn(() => null);
        const signalDescriptorTrap = jest.fn(() => {
            throw new Error(descriptorSecret);
        });
        const target = {};
        Object.defineProperty(target, 'signal', {
            configurable: true,
            enumerable: true,
            get: signalGetter,
        });
        const init = new Proxy(target, {
            getOwnPropertyDescriptor(targetObject, property) {
                if (property === 'signal') return signalDescriptorTrap();
                return Reflect.getOwnPropertyDescriptor(targetObject, property);
            },
        });
        global.fetch = jest.fn().mockResolvedValue({ ok: true });

        try {
            await expect(
                fetchWithTimeout('https://provider.example.test/request', init)
            ).resolves.toMatchObject({ ok: true });

            expect(signalGetter).toHaveBeenCalledTimes(1);
            expect(signalDescriptorTrap).not.toHaveBeenCalled();
            expect(global.fetch).toHaveBeenCalledTimes(1);
        } finally {
            global.fetch = originalFetch;
        }
    });

    test('does not invoke fetch after a RequestInit getter aborts the caller', async () => {
        const originalFetch = global.fetch;
        const callerController = new AbortController();
        const abortSecret = 'PRIVATE_ABORT_FROM_INIT_GETTER';
        const methodGetter = jest.fn(() => {
            callerController.abort(new Error(abortSecret));
            return 'GET';
        });
        const init = { signal: callerController.signal };
        Object.defineProperty(init, 'method', {
            configurable: true,
            enumerable: true,
            get: methodGetter,
        });
        global.fetch = jest.fn().mockResolvedValue({ ok: true });

        try {
            const error = await fetchWithTimeout(
                'https://provider.example.test/request',
                init
            ).catch((caughtError) => caughtError);

            expect(methodGetter).toHaveBeenCalledTimes(1);
            expect(global.fetch.mock.calls).toHaveLength(0);
            expect(error).toMatchObject({
                name: 'AbortError',
                message: 'Request was aborted by the caller.',
                code: 'ERR_FETCH_ABORTED',
            });
            expectErrorToExclude(error, abortSecret);
        } finally {
            global.fetch = originalFetch;
        }
    });

    test('does not invoke fetch after RequestInit derivation reaches the deadline', async () => {
        const originalFetch = global.fetch;
        let now = 1_000;
        const dateNow = jest.spyOn(Date, 'now').mockImplementation(() => now);
        const methodGetter = jest.fn(() => {
            now = 1_025;
            return 'GET';
        });
        const init = {};
        Object.defineProperty(init, 'method', {
            configurable: true,
            enumerable: true,
            get: methodGetter,
        });
        global.fetch = jest.fn().mockResolvedValue({ ok: true });

        try {
            const error = await fetchWithTimeout(
                'https://provider.example.test/request',
                init,
                25
            ).catch((caughtError) => caughtError);

            expect(methodGetter).toHaveBeenCalledTimes(1);
            expect(global.fetch.mock.calls).toHaveLength(0);
            expect(error).toMatchObject({
                name: 'TimeoutError',
                message: 'Request timed out after 25ms',
                code: 'ERR_FETCH_TIMEOUT',
                retryable: true,
            });
        } finally {
            dateNow.mockRestore();
            global.fetch = originalFetch;
        }
    });

    test('keeps the deadline authoritative when RequestInit derivation throws late', async () => {
        const originalFetch = global.fetch;
        const getterSecret = 'PRIVATE_LATE_INIT_GETTER_FAILURE';
        let now = 1_000;
        const dateNow = jest.spyOn(Date, 'now').mockImplementation(() => now);
        const rawError = new TypeError(getterSecret, {
            cause: new Error(getterSecret),
        });
        const methodGetter = jest.fn(() => {
            now = 1_025;
            throw rawError;
        });
        const init = {};
        Object.defineProperty(init, 'method', {
            configurable: true,
            enumerable: true,
            get: methodGetter,
        });
        global.fetch = jest.fn();

        try {
            const error = await fetchWithTimeout(
                'https://provider.example.test/request',
                init,
                25
            ).catch((caughtError) => caughtError);

            expect(methodGetter).toHaveBeenCalledTimes(1);
            expect(global.fetch.mock.calls).toHaveLength(0);
            expect(error).not.toBe(rawError);
            expect(error).toMatchObject({
                name: 'TimeoutError',
                message: 'Request timed out after 25ms',
                code: 'ERR_FETCH_TIMEOUT',
                retryable: true,
            });
            expectErrorToExclude(error, getterSecret);
        } finally {
            dateNow.mockRestore();
            global.fetch = originalFetch;
        }
    });

    test('preserves inherited and non-enumerable RequestInit fields', async () => {
        const originalFetch = global.fetch;
        const initPrototype = { method: 'POST' };
        const init = Object.create(initPrototype);
        Object.defineProperty(init, 'credentials', {
            configurable: true,
            enumerable: false,
            value: 'omit',
            writable: true,
        });
        let visibleRequestInit;
        global.fetch = jest.fn((_input, derivedInit) => {
            visibleRequestInit = {
                credentials: derivedInit.credentials,
                method: derivedInit.method,
            };
            return Promise.resolve({ ok: true });
        });

        try {
            await expect(
                fetchWithTimeout('https://provider.example.test/request', init)
            ).resolves.toMatchObject({ ok: true });

            expect(visibleRequestInit).toEqual({
                credentials: 'omit',
                method: 'POST',
            });
        } finally {
            global.fetch = originalFetch;
        }
    });

    test.each([
        [
            'ownKeys trap',
            'PRIVATE_INIT_OWN_KEYS_FAILURE',
            (rawError, trap) =>
                new Proxy(
                    {},
                    {
                        ownKeys() {
                            trap();
                            throw rawError;
                        },
                    }
                ),
        ],
        [
            'property descriptor trap',
            'PRIVATE_INIT_DESCRIPTOR_FAILURE',
            (rawError, trap) =>
                new Proxy(
                    { method: 'POST' },
                    {
                        getOwnPropertyDescriptor(target, property) {
                            trap();
                            if (property === 'method') throw rawError;
                            return Reflect.getOwnPropertyDescriptor(
                                target,
                                property
                            );
                        },
                    }
                ),
        ],
        [
            'enumerable property getter',
            'PRIVATE_INIT_PROPERTY_GETTER_FAILURE',
            (rawError, trap) => {
                const init = {};
                Object.defineProperty(init, 'method', {
                    configurable: true,
                    enumerable: true,
                    get() {
                        trap();
                        throw rawError;
                    },
                });
                return init;
            },
        ],
    ])(
        'redacts a hostile RequestInit %s',
        async (_name, secret, createInit) => {
            const originalFetch = global.fetch;
            const trap = jest.fn();
            const rawError = new TypeError(`RequestInit failed: ${secret}`, {
                cause: new Error(secret),
            });
            const init = createInit(rawError, trap);
            global.fetch = jest.fn();

            try {
                const error = await fetchWithTimeout(
                    'https://provider.example.test/request',
                    init
                ).catch((caughtError) => caughtError);

                expect(trap).toHaveBeenCalledTimes(1);
                expect(global.fetch.mock.calls).toHaveLength(0);
                expect(error).not.toBe(rawError);
                expect(error).toMatchObject({
                    name: 'TypeError',
                    message: 'Failed to fetch',
                    code: 'ERR_FETCH_FAILED',
                    retryable: true,
                });
                expectErrorToExclude(error, secret);
            } finally {
                global.fetch = originalFetch;
            }
        }
    );

    test.each([
        ['null', null, []],
        ['number', 25, []],
        ['string', 'ab', ['0', '1']],
    ])(
        'preserves enumerable fields from a %s init value',
        async (_name, init, expectedKeys) => {
            const originalFetch = global.fetch;
            let visibleKeys;
            global.fetch = jest.fn((_input, derivedInit) => {
                visibleKeys = Object.keys(derivedInit).filter(
                    (key) => key !== 'signal'
                );
                return Promise.resolve({ ok: true });
            });

            try {
                await expect(
                    fetchWithTimeout(
                        'https://provider.example.test/request',
                        init
                    )
                ).resolves.toMatchObject({ ok: true });

                expect(visibleKeys).toEqual(expectedKeys);
            } finally {
                global.fetch = originalFetch;
            }
        }
    );

    test('redacts malformed signed URLs from native fetch failures', async () => {
        const originalFetch = global.fetch;
        const signedUrlSecret =
            'https://cdn.example.test/subtitle?token=PRIVATE_SIGNED_TOKEN';
        const rawCause = Object.assign(
            new Error(`invalid URL input: ${signedUrlSecret}`),
            { input: signedUrlSecret }
        );
        const rawError = new TypeError(
            `Failed to parse URL from ${signedUrlSecret}`,
            { cause: rawCause }
        );
        global.fetch = jest.fn().mockRejectedValue(rawError);

        try {
            let error;
            try {
                await fetchWithTimeout(signedUrlSecret);
            } catch (caughtError) {
                error = caughtError;
            }

            expect(error).toBeInstanceOf(TypeError);
            expect(error).not.toBe(rawError);
            expect(error).toMatchObject({
                name: 'TypeError',
                message: 'Failed to fetch',
                code: 'ERR_FETCH_FAILED',
                retryable: true,
            });
            expectErrorToExclude(
                error,
                signedUrlSecret,
                'PRIVATE_SIGNED_TOKEN'
            );
        } finally {
            global.fetch = originalFetch;
        }
    });

    test('normalizes a pre-aborted caller without reading its reason', async () => {
        const originalFetch = global.fetch;
        const callerController = new AbortController();
        const callerReason = new Error('PRIVATE_CALLER_ABORT_REASON');
        callerController.abort(callerReason);
        const reasonGetter = jest.fn(() => {
            throw new Error('PRIVATE_REASON_GETTER_FAILURE');
        });
        Object.defineProperty(callerController.signal, 'reason', {
            configurable: true,
            get: reasonGetter,
        });
        global.fetch = jest.fn();

        try {
            let error;
            try {
                await fetchWithTimeout(
                    'https://provider.example.test/request',
                    {
                        signal: callerController.signal,
                    }
                );
            } catch (caughtError) {
                error = caughtError;
            }

            expect(global.fetch).not.toHaveBeenCalled();
            expect(reasonGetter).not.toHaveBeenCalled();
            expect(error).not.toBe(callerReason);
            expect(error).toMatchObject({
                name: 'AbortError',
                message: 'Request was aborted by the caller.',
                code: 'ERR_FETCH_ABORTED',
            });
            expectErrorToExclude(
                error,
                'PRIVATE_CALLER_ABORT_REASON',
                'PRIVATE_REASON_GETTER_FAILURE'
            );
        } finally {
            global.fetch = originalFetch;
        }
    });

    test('normalizes a hostile caller signal property without invoking fetch', async () => {
        const originalFetch = global.fetch;
        const signalSecret = 'PRIVATE_SIGNAL_GETTER_FAILURE';
        const rawError = new TypeError(`signal getter failed: ${signalSecret}`);
        const init = {};
        Object.defineProperty(init, 'signal', {
            get() {
                throw rawError;
            },
        });
        global.fetch = jest.fn();

        try {
            const error = await fetchWithTimeout(
                'https://provider.example.test/request',
                init
            ).catch((caughtError) => caughtError);

            expect(global.fetch).not.toHaveBeenCalled();
            expect(error).toBeInstanceOf(TypeError);
            expect(error).not.toBe(rawError);
            expect(error).toMatchObject({
                name: 'TypeError',
                message: 'Failed to fetch',
                code: 'ERR_FETCH_FAILED',
                retryable: true,
            });
            expectErrorToExclude(error, signalSecret);
        } finally {
            global.fetch = originalFetch;
        }
    });

    test('aborts a stalled request with a retryable timeout error', async () => {
        jest.useFakeTimers();
        const originalFetch = global.fetch;
        global.fetch = jest.fn(
            (_input, { signal }) =>
                new Promise((_resolve, reject) => {
                    signal.addEventListener('abort', () => {
                        const error = new Error('PRIVATE_TIMEOUT_ABORT_CAUSE');
                        error.name = 'AbortError';
                        reject(error);
                    });
                })
        );

        try {
            const request = fetchWithTimeout(
                'https://provider.example.test/request',
                {},
                25
            );
            const result = request.catch((error) => error);
            await jest.advanceTimersByTimeAsync(25);

            const error = await result;
            expect(error).toMatchObject({
                name: 'TimeoutError',
                message: 'Request timed out after 25ms',
                code: 'ERR_FETCH_TIMEOUT',
                retryable: true,
            });
            expectErrorToExclude(error, 'PRIVATE_TIMEOUT_ABORT_CAUSE');
        } finally {
            global.fetch = originalFetch;
            jest.useRealTimers();
        }
    });

    test('keeps the deadline active while a response body is being read', async () => {
        jest.useFakeTimers();
        const originalFetch = global.fetch;
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: jest.fn(() => new Promise(() => {})),
        });

        try {
            const response = await fetchWithTimeout(
                'https://provider.example.test/request',
                {},
                25
            );
            const bodyRead = response.json();
            const expectation = expect(bodyRead).rejects.toMatchObject({
                name: 'TimeoutError',
                retryable: true,
            });

            await jest.advanceTimersByTimeAsync(25);

            await expectation;
        } finally {
            global.fetch = originalFetch;
            jest.useRealTimers();
        }
    });

    test('preserves response properties and successful body methods', async () => {
        const originalFetch = global.fetch;
        const json = jest.fn().mockResolvedValue({ translated: true });
        global.fetch = jest
            .fn()
            .mockResolvedValue({ ok: true, status: 200, json });

        try {
            const response = await fetchWithTimeout(
                'https://provider.example.test/request'
            );

            expect(response).toMatchObject({ ok: true, status: 200 });
            await expect(response.json()).resolves.toEqual({
                translated: true,
            });
            expect(json).toHaveBeenCalledTimes(1);
        } finally {
            global.fetch = originalFetch;
        }
    });

    test.each(['arrayBuffer', 'blob', 'bytes', 'formData', 'json', 'text'])(
        'does not invoke %s after caller abort',
        async (methodName) => {
            const originalFetch = global.fetch;
            const callerController = new AbortController();
            const bodyMethod = jest
                .fn()
                .mockResolvedValue({ mustNotResolve: true });
            global.fetch = jest
                .fn()
                .mockResolvedValue({ ok: true, [methodName]: bodyMethod });

            try {
                const response = await fetchWithTimeout(
                    'https://provider.example.test/request',
                    { signal: callerController.signal }
                );
                const callerReason = new Error('PRIVATE_BODY_ABORT_REASON');
                callerController.abort(callerReason);

                let error;
                try {
                    await response[methodName]();
                } catch (caughtError) {
                    error = caughtError;
                }

                expect(bodyMethod).not.toHaveBeenCalled();
                expect(error).not.toBe(callerReason);
                expect(error).toMatchObject({
                    name: 'AbortError',
                    message: 'Request was aborted by the caller.',
                    code: 'ERR_FETCH_ABORTED',
                });
                expectErrorToExclude(error, 'PRIVATE_BODY_ABORT_REASON');
            } finally {
                global.fetch = originalFetch;
            }
        }
    );

    test('settles a pending direct body method when the caller aborts', async () => {
        jest.useFakeTimers();
        const originalFetch = global.fetch;
        const callerController = new AbortController();
        const json = jest.fn(() => new Promise(() => {}));
        global.fetch = jest.fn().mockResolvedValue({ ok: true, json });
        let bodyResult;

        try {
            const response = await fetchWithTimeout(
                'https://provider.example.test/request',
                { signal: callerController.signal },
                25
            );
            bodyResult = response.json().catch((error) => error);
            await jest.advanceTimersByTimeAsync(0);
            expect(json).toHaveBeenCalledTimes(1);

            callerController.abort(
                new Error('PRIVATE_PENDING_BODY_ABORT_REASON')
            );
            const watchdog = new Promise((resolve) =>
                setTimeout(() => resolve('watchdog elapsed'), 1)
            );
            const outcome = Promise.race([bodyResult, watchdog]);
            await jest.advanceTimersByTimeAsync(1);

            await expect(outcome).resolves.toMatchObject({
                name: 'AbortError',
                message: 'Request was aborted by the caller.',
                code: 'ERR_FETCH_ABORTED',
            });
            const error = await bodyResult;
            expectErrorToExclude(error, 'PRIVATE_PENDING_BODY_ABORT_REASON');
        } finally {
            await jest.runOnlyPendingTimersAsync();
            await bodyResult;
            global.fetch = originalFetch;
            jest.useRealTimers();
        }
    });

    test('redacts native TypeErrors from direct body methods', async () => {
        const originalFetch = global.fetch;
        const bodySecret = 'PRIVATE_BODY_FAILURE_PAYLOAD';
        const rawError = new TypeError(`body read failed: ${bodySecret}`, {
            cause: Object.assign(new Error(bodySecret), {
                input: bodySecret,
            }),
        });
        const json = jest.fn().mockRejectedValue(rawError);
        global.fetch = jest.fn().mockResolvedValue({ ok: true, json });

        try {
            const response = await fetchWithTimeout(
                'https://provider.example.test/request'
            );
            let error;
            try {
                await response.json();
            } catch (caughtError) {
                error = caughtError;
            }

            expect(error).toBeInstanceOf(TypeError);
            expect(error).not.toBe(rawError);
            expect(error).toMatchObject({
                name: 'TypeError',
                message: 'Failed to read response body.',
                code: 'ERR_RESPONSE_BODY_READ',
                retryable: true,
            });
            expectErrorToExclude(error, bodySecret);
        } finally {
            global.fetch = originalFetch;
        }
    });

    test('redacts native SyntaxErrors from direct JSON reads', async () => {
        const originalFetch = global.fetch;
        const bodySecret = 'PRIVATE_JSON_PARSE_PAYLOAD';
        const rawError = new SyntaxError(`invalid JSON: ${bodySecret}`, {
            cause: new Error(bodySecret),
        });
        const json = jest.fn().mockRejectedValue(rawError);
        global.fetch = jest.fn().mockResolvedValue({ ok: true, json });

        try {
            const response = await fetchWithTimeout(
                'https://provider.example.test/request'
            );
            const error = await response
                .json()
                .catch((caughtError) => caughtError);

            expect(error).toBeInstanceOf(SyntaxError);
            expect(error).not.toBe(rawError);
            expect(error).toMatchObject({
                name: 'SyntaxError',
                message: 'Response body is not valid JSON.',
                code: 'ERR_RESPONSE_BODY_PARSE',
                retryable: false,
            });
            expectErrorToExclude(error, bodySecret);
        } finally {
            global.fetch = originalFetch;
        }
    });

    test('redacts unknown failures from direct body methods', async () => {
        const originalFetch = global.fetch;
        const bodySecret = 'PRIVATE_UNKNOWN_BODY_FAILURE';
        const rawError = Object.assign(
            new Error(`unknown body failure: ${bodySecret}`),
            { reason: bodySecret }
        );
        const text = jest.fn().mockRejectedValue(rawError);
        global.fetch = jest.fn().mockResolvedValue({ ok: true, text });

        try {
            const response = await fetchWithTimeout(
                'https://provider.example.test/request'
            );
            const error = await response
                .text()
                .catch((caughtError) => caughtError);

            expect(error).toBeInstanceOf(Error);
            expect(error).not.toBe(rawError);
            expect(error).toMatchObject({
                name: 'Error',
                message: 'Failed to read response body.',
                code: 'ERR_RESPONSE_BODY_READ',
                retryable: false,
            });
            expectErrorToExclude(error, bodySecret);
        } finally {
            global.fetch = originalFetch;
        }
    });

    test('redacts a hostile direct body method property', async () => {
        const originalFetch = global.fetch;
        const bodySecret = 'PRIVATE_DIRECT_BODY_GETTER_FAILURE';
        const rawError = new TypeError(`json getter failed: ${bodySecret}`, {
            cause: new Error(bodySecret),
        });
        const rawResponse = { ok: true };
        Object.defineProperty(rawResponse, 'json', {
            get() {
                throw rawError;
            },
        });
        let fetchSignal;
        global.fetch = jest.fn((_input, { signal }) => {
            fetchSignal = signal;
            return Promise.resolve(rawResponse);
        });

        try {
            const response = await fetchWithTimeout(
                'https://provider.example.test/request'
            );
            let error;
            try {
                void response.json;
            } catch (caughtError) {
                error = caughtError;
            }

            expect(error).toBeInstanceOf(TypeError);
            expect(error).not.toBe(rawError);
            expect(error).toMatchObject({
                name: 'TypeError',
                message: 'Failed to read response body.',
                code: 'ERR_RESPONSE_BODY_READ',
                retryable: true,
            });
            expectErrorToExclude(error, bodySecret);
            expect(fetchSignal.aborted).toBe(true);
            expect(fetchSignal.reason).toBe(error);
        } finally {
            global.fetch = originalFetch;
        }
    });

    test('does not retain raw reasons while canceling a response body', async () => {
        const originalFetch = global.fetch;
        let fetchSignal;
        const cancel = jest.fn().mockResolvedValue(undefined);
        global.fetch = jest.fn((_input, { signal }) => {
            fetchSignal = signal;
            return Promise.resolve({ ok: false, body: { cancel } });
        });
        const rawReason = Object.assign(
            new Error('PRIVATE_RAW_CANCELLATION_REASON'),
            { input: 'PRIVATE_RAW_CANCELLATION_INPUT' }
        );

        try {
            const response = await fetchWithTimeout(
                'https://provider.example.test/request'
            );
            cancelResponseBodySafely(response, rawReason);
            await Promise.resolve();

            expect(fetchSignal.aborted).toBe(true);
            expect(fetchSignal.reason).not.toBe(rawReason);
            expect(fetchSignal.reason).toMatchObject({
                name: 'AbortError',
                message: 'Response body consumption was cancelled.',
                code: 'ERR_RESPONSE_BODY_CANCELLED',
            });
            expect(cancel).toHaveBeenCalledTimes(1);
            const [cancelReason] = cancel.mock.calls[0];
            expect(cancelReason).toBe(fetchSignal.reason);
            expectErrorToExclude(
                cancelReason,
                'PRIVATE_RAW_CANCELLATION_REASON',
                'PRIVATE_RAW_CANCELLATION_INPUT'
            );
        } finally {
            global.fetch = originalFetch;
        }
    });
});

describe('readResponseTextWithLimit', () => {
    test('identifies only internally created body-limit errors without reflection', async () => {
        const cancel = jest.fn().mockResolvedValue(undefined);
        const response = {
            headers: new Headers({ 'Content-Length': '11' }),
            body: { cancel },
        };
        const internalError = await readResponseTextWithLimit(
            response,
            10
        ).catch((error) => error);
        const forgedError = new ResponseBodyLimitError(10, 11);
        const getPrototypeOf = jest.fn(() => {
            throw new Error('PRIVATE_LIMIT_PREDICATE_PROXY_TRAP');
        });
        const hostileValue = new Proxy({}, { getPrototypeOf });

        expect(isResponseBodyLimitError(internalError)).toBe(true);
        expect(isResponseBodyLimitError(forgedError)).toBe(false);
        expect(isResponseBodyLimitError(hostileValue)).toBe(false);
        expect(getPrototypeOf).not.toHaveBeenCalled();
        expect(cancel).toHaveBeenCalledTimes(1);
    });

    test('rejects an oversized Content-Length before reading the body', async () => {
        const text = jest.fn();
        const cancel = jest.fn().mockResolvedValue(undefined);
        const response = {
            headers: new Headers({ 'Content-Length': '11' }),
            body: { cancel },
            text,
        };

        await expect(readResponseTextWithLimit(response, 10)).rejects.toEqual(
            expect.objectContaining({
                name: ResponseBodyLimitError.name,
                limitBytes: 10,
                observedBytes: 11,
            })
        );
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(text).not.toHaveBeenCalled();
    });

    test('does not wait for a hanging body cancellation before reporting the limit', async () => {
        jest.useFakeTimers();
        const originalFetch = global.fetch;
        const cancel = jest.fn(() => new Promise(() => {}));
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            headers: new Headers({ 'Content-Length': '11' }),
            body: { cancel },
        });

        try {
            const response = await fetchWithTimeout(
                'https://provider.example.test/request',
                {},
                10
            );
            const limitResult = readResponseTextWithLimit(response, 10).catch(
                (error) => error
            );
            const watchdogResult = new Promise((resolve) =>
                setTimeout(() => resolve('watchdog elapsed'), 11)
            );
            const outcome = Promise.race([limitResult, watchdogResult]);

            await jest.advanceTimersByTimeAsync(11);

            await expect(outcome).resolves.toMatchObject({
                name: ResponseBodyLimitError.name,
                limitBytes: 10,
                observedBytes: 11,
            });
            expect(cancel).toHaveBeenCalledTimes(1);
        } finally {
            global.fetch = originalFetch;
            jest.useRealTimers();
        }
    });

    test('normalizes a caller abort that happened before bounded reading', async () => {
        const originalFetch = global.fetch;
        const callerController = new AbortController();
        const callerAbort = new Error('PRIVATE_BOUNDED_READ_ABORT_REASON');
        callerAbort.name = 'AbortError';
        const cancel = jest.fn(() => new Promise(() => {}));
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            headers: new Headers({ 'Content-Length': '11' }),
            body: { cancel },
        });

        try {
            const response = await fetchWithTimeout(
                'https://provider.example.test/request',
                { signal: callerController.signal }
            );
            callerController.abort(callerAbort);

            const error = await readResponseTextWithLimit(response, 10).catch(
                (caughtError) => caughtError
            );

            expect(error).not.toBe(callerAbort);
            expect(error).toMatchObject({
                name: 'AbortError',
                message: 'Request was aborted by the caller.',
                code: 'ERR_FETCH_ABORTED',
            });
            expectErrorToExclude(error, 'PRIVATE_BOUNDED_READ_ABORT_REASON');
            expect(cancel).toHaveBeenCalledTimes(1);
        } finally {
            global.fetch = originalFetch;
        }
    });

    test.each(['arrayBuffer', 'text'])(
        'does not invoke the %s fallback after caller abort',
        async (methodName) => {
            const originalFetch = global.fetch;
            const callerController = new AbortController();
            const bodyMethod = jest.fn();
            const cancel = jest.fn().mockResolvedValue(undefined);
            global.fetch = jest.fn().mockResolvedValue({
                headers: new Headers(),
                body: { cancel },
                [methodName]: bodyMethod,
            });

            try {
                const response = await fetchWithTimeout(
                    'https://provider.example.test/request',
                    { signal: callerController.signal }
                );
                callerController.abort(
                    new Error('PRIVATE_FALLBACK_ABORT_REASON')
                );

                const error = await readResponseTextWithLimit(
                    response,
                    100
                ).catch((caughtError) => caughtError);

                expect(error).toMatchObject({
                    name: 'AbortError',
                    message: 'Request was aborted by the caller.',
                    code: 'ERR_FETCH_ABORTED',
                });
                expectErrorToExclude(error, 'PRIVATE_FALLBACK_ABORT_REASON');
                expect(bodyMethod).not.toHaveBeenCalled();
                expect(cancel).toHaveBeenCalledTimes(1);
            } finally {
                global.fetch = originalFetch;
            }
        }
    );

    test('preserves a resource limit discovered before cancellation triggers caller abort', async () => {
        const originalFetch = global.fetch;
        const callerController = new AbortController();
        const callerAbort = new Error('caller aborted during cancellation');
        callerAbort.name = 'AbortError';
        const cancel = jest.fn(() => {
            callerController.abort(callerAbort);
            return new Promise(() => {});
        });
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            headers: new Headers({ 'Content-Length': '11' }),
            body: { cancel },
        });

        try {
            const response = await fetchWithTimeout(
                'https://provider.example.test/request',
                { signal: callerController.signal }
            );

            await expect(
                readResponseTextWithLimit(response, 10)
            ).rejects.toMatchObject({
                name: ResponseBodyLimitError.name,
                limitBytes: 10,
                observedBytes: 11,
            });
            expect(callerController.signal.aborted).toBe(true);
            expect(cancel).toHaveBeenCalledTimes(1);
        } finally {
            global.fetch = originalFetch;
        }
    });

    test('cancels a streamed body as soon as its byte limit is exceeded', async () => {
        const reader = {
            read: jest
                .fn()
                .mockResolvedValueOnce({
                    done: false,
                    value: new Uint8Array([49, 50, 51, 52]),
                })
                .mockResolvedValueOnce({
                    done: false,
                    value: new Uint8Array([53, 54, 55, 56]),
                }),
            cancel: jest.fn().mockResolvedValue(undefined),
        };
        const text = jest.fn().mockResolvedValue('ignored');
        const response = {
            headers: new Headers(),
            body: { getReader: () => reader },
            text,
        };

        await expect(readResponseTextWithLimit(response, 6)).rejects.toEqual(
            expect.objectContaining({
                name: ResponseBodyLimitError.name,
                limitBytes: 6,
                observedBytes: 8,
            })
        );
        expect(reader.read).toHaveBeenCalledTimes(2);
        expect(reader.cancel).toHaveBeenCalledTimes(1);
        expect(text).not.toHaveBeenCalled();
    });

    test('aborts the fetch controller when a streamed body exceeds its limit', async () => {
        const originalFetch = global.fetch;
        let fetchSignal;
        const reader = {
            read: jest
                .fn()
                .mockResolvedValueOnce({
                    done: false,
                    value: new Uint8Array([49, 50, 51, 52]),
                })
                .mockResolvedValueOnce({
                    done: false,
                    value: new Uint8Array([53, 54, 55, 56]),
                }),
            cancel: jest.fn().mockResolvedValue(undefined),
            releaseLock: jest.fn(),
        };
        global.fetch = jest.fn((_input, { signal }) => {
            fetchSignal = signal;
            return Promise.resolve({
                headers: new Headers(),
                body: { getReader: () => reader },
            });
        });

        try {
            const response = await fetchWithTimeout(
                'https://provider.example.test/request'
            );

            await expect(
                readResponseTextWithLimit(response, 6)
            ).rejects.toMatchObject({
                name: 'ResponseBodyLimitError',
                code: 'ERR_RESPONSE_BODY_LIMIT',
                limitBytes: 6,
                observedBytes: 8,
            });
            await Promise.resolve();

            expect(fetchSignal.aborted).toBe(true);
            expect(reader.cancel).toHaveBeenCalledTimes(1);
            expect(reader.releaseLock).toHaveBeenCalledTimes(1);
        } finally {
            global.fetch = originalFetch;
        }
    });

    test('keeps a streamed limit authoritative when cleanup triggers caller abort', async () => {
        const originalFetch = global.fetch;
        const callerController = new AbortController();
        const reader = {
            read: jest
                .fn()
                .mockResolvedValueOnce({
                    done: false,
                    value: new Uint8Array([49, 50, 51, 52]),
                })
                .mockResolvedValueOnce({
                    done: false,
                    value: new Uint8Array([53, 54, 55, 56]),
                }),
            cancel: jest.fn(() => {
                callerController.abort(
                    new Error('PRIVATE_ABORT_DURING_STREAM_CLEANUP')
                );
                return Promise.resolve();
            }),
            releaseLock: jest.fn(),
        };
        global.fetch = jest.fn().mockResolvedValue({
            headers: new Headers(),
            body: { getReader: () => reader },
        });

        try {
            const response = await fetchWithTimeout(
                'https://provider.example.test/request',
                { signal: callerController.signal }
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
            expectErrorToExclude(error, 'PRIVATE_ABORT_DURING_STREAM_CLEANUP');
            expect(callerController.signal.aborted).toBe(true);
            expect(reader.cancel).toHaveBeenCalledTimes(1);
            expect(reader.releaseLock).toHaveBeenCalledTimes(1);
        } finally {
            global.fetch = originalFetch;
        }
    });

    test('redacts secret-bearing stream failures before terminal cleanup', async () => {
        const originalFetch = global.fetch;
        const callerController = new AbortController();
        const bodySecret = 'PRIVATE_STREAM_READ_FAILURE';
        const cleanupSecret = 'PRIVATE_ABORT_DURING_FAILED_STREAM_CLEANUP';
        const rawError = new TypeError(`stream read failed: ${bodySecret}`, {
            cause: Object.assign(new Error(bodySecret), {
                input: bodySecret,
            }),
        });
        let fetchSignal;
        const reader = {
            read: jest.fn().mockRejectedValue(rawError),
            cancel: jest.fn(() => {
                callerController.abort(new Error(cleanupSecret));
                return Promise.resolve();
            }),
            releaseLock: jest.fn(),
        };
        global.fetch = jest.fn((_input, { signal }) => {
            fetchSignal = signal;
            return Promise.resolve({
                headers: new Headers(),
                body: { getReader: () => reader },
            });
        });

        try {
            const response = await fetchWithTimeout(
                'https://provider.example.test/request',
                { signal: callerController.signal }
            );
            const error = await readResponseTextWithLimit(response, 100).catch(
                (caughtError) => caughtError
            );

            expect(error).toBeInstanceOf(TypeError);
            expect(error).not.toBe(rawError);
            expect(error).toMatchObject({
                name: 'TypeError',
                message: 'Failed to read response body.',
                code: 'ERR_RESPONSE_BODY_READ',
                retryable: true,
            });
            expectErrorToExclude(error, bodySecret, cleanupSecret);
            expect(fetchSignal.aborted).toBe(true);
            expect(fetchSignal.reason).toBe(error);
            expect(callerController.signal.aborted).toBe(true);
            expect(reader.cancel).toHaveBeenCalledTimes(1);
            expect(reader.cancel).toHaveBeenCalledWith(error);
            expect(reader.releaseLock).toHaveBeenCalledTimes(1);
        } finally {
            global.fetch = originalFetch;
        }
    });

    test('redacts a hostile getReader property failure before streaming', async () => {
        const originalFetch = global.fetch;
        const bodySecret = 'PRIVATE_GET_READER_GETTER_FAILURE';
        const rawError = new TypeError(`getReader failed: ${bodySecret}`, {
            cause: new Error(bodySecret),
        });
        const body = {};
        Object.defineProperty(body, 'getReader', {
            get() {
                throw rawError;
            },
        });
        let fetchSignal;
        global.fetch = jest.fn((_input, { signal }) => {
            fetchSignal = signal;
            return Promise.resolve({ headers: new Headers(), body });
        });

        try {
            const response = await fetchWithTimeout(
                'https://provider.example.test/request'
            );
            const error = await readResponseTextWithLimit(response, 100).catch(
                (caughtError) => caughtError
            );

            expect(error).toBeInstanceOf(TypeError);
            expect(error).not.toBe(rawError);
            expect(error).toMatchObject({
                name: 'TypeError',
                message: 'Failed to read response body.',
                code: 'ERR_RESPONSE_BODY_READ',
                retryable: true,
            });
            expectErrorToExclude(error, bodySecret);
            expect(fetchSignal.aborted).toBe(true);
            expect(fetchSignal.reason).toBe(error);
        } finally {
            global.fetch = originalFetch;
        }
    });

    test('redacts a hostile response body property before fallback selection', async () => {
        const originalFetch = global.fetch;
        const bodySecret = 'PRIVATE_RESPONSE_BODY_GETTER_FAILURE';
        const rawError = new TypeError(`body getter failed: ${bodySecret}`, {
            cause: new Error(bodySecret),
        });
        const rawResponse = { headers: new Headers() };
        Object.defineProperty(rawResponse, 'body', {
            get() {
                throw rawError;
            },
        });
        let fetchSignal;
        global.fetch = jest.fn((_input, { signal }) => {
            fetchSignal = signal;
            return Promise.resolve(rawResponse);
        });

        try {
            const response = await fetchWithTimeout(
                'https://provider.example.test/request'
            );
            const error = await readResponseTextWithLimit(response, 100).catch(
                (caughtError) => caughtError
            );

            expect(error).toBeInstanceOf(TypeError);
            expect(error).not.toBe(rawError);
            expect(error).toMatchObject({
                name: 'TypeError',
                message: 'Failed to read response body.',
                code: 'ERR_RESPONSE_BODY_READ',
                retryable: true,
            });
            expectErrorToExclude(error, bodySecret);
            expect(fetchSignal.aborted).toBe(true);
            expect(fetchSignal.reason).toBe(error);
        } finally {
            global.fetch = originalFetch;
        }
    });

    test('does not wait for hanging reader cancellation after a stream limit', async () => {
        jest.useFakeTimers();
        const reader = {
            read: jest
                .fn()
                .mockResolvedValueOnce({
                    done: false,
                    value: new Uint8Array([49, 50, 51, 52]),
                })
                .mockResolvedValueOnce({
                    done: false,
                    value: new Uint8Array([53, 54, 55, 56]),
                }),
            cancel: jest.fn(() => new Promise(() => {})),
            releaseLock: jest.fn(),
        };
        const response = {
            headers: new Headers(),
            body: { getReader: () => reader },
        };

        try {
            const limitResult = readResponseTextWithLimit(response, 6).catch(
                (error) => error
            );
            const watchdogResult = new Promise((resolve) =>
                setTimeout(() => resolve('watchdog elapsed'), 1)
            );
            const outcome = Promise.race([limitResult, watchdogResult]);

            await jest.advanceTimersByTimeAsync(1);

            await expect(outcome).resolves.toMatchObject({
                name: ResponseBodyLimitError.name,
                limitBytes: 6,
                observedBytes: 8,
            });
            expect(reader.cancel).toHaveBeenCalledTimes(1);
            expect(reader.releaseLock).toHaveBeenCalledTimes(1);
        } finally {
            jest.useRealTimers();
        }
    });

    test('uses UTF-8 bytes rather than JavaScript character count', async () => {
        const response = {
            text: jest.fn().mockResolvedValue('€'),
        };

        await expect(readResponseTextWithLimit(response, 2)).rejects.toEqual(
            expect.objectContaining({
                name: ResponseBodyLimitError.name,
                limitBytes: 2,
                observedBytes: 3,
            })
        );
    });

    test('redacts failures from a raw arrayBuffer fallback', async () => {
        const bodySecret = 'PRIVATE_ARRAY_BUFFER_FALLBACK_FAILURE';
        const rawError = new TypeError(
            `arrayBuffer read failed: ${bodySecret}`,
            { cause: new Error(bodySecret) }
        );
        const response = {
            headers: new Headers(),
            arrayBuffer: jest.fn().mockRejectedValue(rawError),
        };

        const error = await readResponseTextWithLimit(response, 100).catch(
            (caughtError) => caughtError
        );

        expect(error).toBeInstanceOf(TypeError);
        expect(error).not.toBe(rawError);
        expect(error).toMatchObject({
            name: 'TypeError',
            message: 'Failed to read response body.',
            code: 'ERR_RESPONSE_BODY_READ',
            retryable: true,
        });
        expectErrorToExclude(error, bodySecret);
    });

    test('aborts after post-allocation arrayBuffer fallback overflow', async () => {
        const originalFetch = global.fetch;
        let fetchSignal;
        let allocatedBytes = 0;
        const cancel = jest.fn().mockResolvedValue(undefined);
        const arrayBuffer = jest.fn(async () => {
            allocatedBytes = 1024;
            return new Uint8Array(allocatedBytes).buffer;
        });
        global.fetch = jest.fn((_input, { signal }) => {
            fetchSignal = signal;
            return Promise.resolve({
                headers: new Headers(),
                body: { cancel },
                arrayBuffer,
            });
        });

        try {
            const response = await fetchWithTimeout(
                'https://provider.example.test/request'
            );
            const error = await readResponseTextWithLimit(response, 8).catch(
                (caughtError) => caughtError
            );

            // Compatibility fallback: allocation necessarily precedes this cap.
            expect(allocatedBytes).toBe(1024);
            expect(arrayBuffer).toHaveBeenCalledTimes(1);
            expect(error).toMatchObject({
                name: 'ResponseBodyLimitError',
                code: 'ERR_RESPONSE_BODY_LIMIT',
                limitBytes: 8,
                observedBytes: 1024,
            });
            expect(fetchSignal.aborted).toBe(true);
            expect(cancel).toHaveBeenCalledTimes(1);
        } finally {
            global.fetch = originalFetch;
        }
    });

    test('aborts after post-allocation text fallback overflow', async () => {
        const originalFetch = global.fetch;
        let fetchSignal;
        let allocatedCharacters = 0;
        const cancel = jest.fn().mockResolvedValue(undefined);
        const text = jest.fn(async () => {
            const body = 'x'.repeat(1024);
            allocatedCharacters = body.length;
            return body;
        });
        global.fetch = jest.fn((_input, { signal }) => {
            fetchSignal = signal;
            return Promise.resolve({
                headers: new Headers(),
                body: { cancel },
                text,
            });
        });

        try {
            const response = await fetchWithTimeout(
                'https://provider.example.test/request'
            );
            const error = await readResponseTextWithLimit(response, 8).catch(
                (caughtError) => caughtError
            );

            // Compatibility fallback: allocation necessarily precedes this cap.
            expect(allocatedCharacters).toBe(1024);
            expect(text).toHaveBeenCalledTimes(1);
            expect(error).toMatchObject({
                name: 'ResponseBodyLimitError',
                code: 'ERR_RESPONSE_BODY_LIMIT',
                limitBytes: 8,
                observedBytes: 1024,
            });
            expect(fetchSignal.aborted).toBe(true);
            expect(cancel).toHaveBeenCalledTimes(1);
        } finally {
            global.fetch = originalFetch;
        }
    });

    test('keeps the original deadline active while streaming bounded text', async () => {
        jest.useFakeTimers();
        const originalFetch = global.fetch;
        let fetchSignal;
        const reader = {
            read: jest.fn(
                () =>
                    new Promise((_resolve, reject) => {
                        fetchSignal.addEventListener(
                            'abort',
                            () => {
                                const error = new Error('aborted');
                                error.name = 'AbortError';
                                reject(error);
                            },
                            { once: true }
                        );
                    })
            ),
            releaseLock: jest.fn(),
        };
        global.fetch = jest.fn((_input, { signal }) => {
            fetchSignal = signal;
            return Promise.resolve({
                ok: true,
                headers: new Headers(),
                body: { getReader: () => reader },
            });
        });

        try {
            const response = await fetchWithTimeout(
                'https://provider.example.test/request',
                {},
                25
            );
            const bodyRead = readResponseTextWithLimit(response, 100);
            const expectation = expect(bodyRead).rejects.toMatchObject({
                name: 'TimeoutError',
                retryable: true,
            });

            await jest.advanceTimersByTimeAsync(25);

            await expectation;
            expect(reader.releaseLock).toHaveBeenCalledTimes(1);
        } finally {
            global.fetch = originalFetch;
            jest.useRealTimers();
        }
    });

    test('cancels and releases a never-settling reader at the deadline', async () => {
        jest.useFakeTimers();
        const originalFetch = global.fetch;
        let fetchSignal;
        const reader = {
            read: jest.fn(() => new Promise(() => {})),
            cancel: jest.fn(() => new Promise(() => {})),
            releaseLock: jest.fn(),
        };
        global.fetch = jest.fn((_input, { signal }) => {
            fetchSignal = signal;
            return Promise.resolve({
                headers: new Headers(),
                body: { getReader: () => reader },
            });
        });

        try {
            const response = await fetchWithTimeout(
                'https://provider.example.test/request',
                {},
                25
            );
            const bodyResult = readResponseTextWithLimit(response, 100).catch(
                (error) => error
            );
            await jest.advanceTimersByTimeAsync(25);

            await expect(bodyResult).resolves.toMatchObject({
                name: 'TimeoutError',
                message: 'Request timed out after 25ms',
                code: 'ERR_FETCH_TIMEOUT',
                retryable: true,
            });
            expect(fetchSignal.aborted).toBe(true);
            expect(reader.cancel).toHaveBeenCalledTimes(1);
            expect(reader.releaseLock).toHaveBeenCalledTimes(1);
            expect(jest.getTimerCount()).toBe(0);
        } finally {
            global.fetch = originalFetch;
            jest.useRealTimers();
        }
    });

    test('cancels and releases a never-settling reader on caller abort', async () => {
        jest.useFakeTimers();
        const originalFetch = global.fetch;
        const callerController = new AbortController();
        const reader = {
            read: jest.fn(() => new Promise(() => {})),
            cancel: jest.fn(() => new Promise(() => {})),
            releaseLock: jest.fn(),
        };
        global.fetch = jest.fn().mockResolvedValue({
            headers: new Headers(),
            body: { getReader: () => reader },
        });

        try {
            const response = await fetchWithTimeout(
                'https://provider.example.test/request',
                { signal: callerController.signal },
                25
            );
            const bodyResult = readResponseTextWithLimit(response, 100).catch(
                (error) => error
            );
            await jest.advanceTimersByTimeAsync(0);
            callerController.abort(
                new Error('PRIVATE_STREAM_CALLER_ABORT_REASON')
            );

            await expect(bodyResult).resolves.toMatchObject({
                name: 'AbortError',
                message: 'Request was aborted by the caller.',
                code: 'ERR_FETCH_ABORTED',
            });
            expect(reader.cancel).toHaveBeenCalledTimes(1);
            expect(reader.releaseLock).toHaveBeenCalledTimes(1);
            expect(jest.getTimerCount()).toBe(0);
            expectErrorToExclude(
                await bodyResult,
                'PRIVATE_STREAM_CALLER_ABORT_REASON'
            );
        } finally {
            global.fetch = originalFetch;
            jest.useRealTimers();
        }
    });

    test('does not continue streaming after a timed-out read settles late', async () => {
        jest.useFakeTimers();
        const originalFetch = global.fetch;
        let resolveFirstRead;
        const reader = {
            read: jest
                .fn()
                .mockImplementationOnce(
                    () =>
                        new Promise((resolve) => {
                            resolveFirstRead = resolve;
                        })
                )
                .mockResolvedValue({ done: true }),
            cancel: jest.fn().mockResolvedValue(undefined),
            releaseLock: jest.fn(),
        };
        global.fetch = jest.fn().mockResolvedValue({
            headers: new Headers(),
            body: { getReader: () => reader },
        });

        try {
            const response = await fetchWithTimeout(
                'https://provider.example.test/request',
                {},
                25
            );
            const bodyResult = readResponseTextWithLimit(response, 100).catch(
                (error) => error
            );
            await jest.advanceTimersByTimeAsync(25);
            await expect(bodyResult).resolves.toMatchObject({
                name: 'TimeoutError',
                code: 'ERR_FETCH_TIMEOUT',
            });

            resolveFirstRead({
                done: false,
                value: new Uint8Array([49, 50, 51]),
            });
            await Promise.resolve();
            await Promise.resolve();

            expect(reader.read).toHaveBeenCalledTimes(1);
            expect(reader.cancel).toHaveBeenCalledTimes(1);
            expect(reader.releaseLock).toHaveBeenCalledTimes(1);
        } finally {
            global.fetch = originalFetch;
            jest.useRealTimers();
        }
    });
});
