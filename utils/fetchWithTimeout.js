export const DEFAULT_FETCH_TIMEOUT_MS = 30_000;
const MAX_FETCH_TIMEOUT_MS = 2_147_483_647;
const CONTENT_LENGTH_HEADER = 'content-length';
const RESPONSE_TIMEOUT_CONTEXTS = new WeakMap();
const SAFE_INTERNAL_ERRORS = new WeakSet();
const RESPONSE_BODY_LIMIT_ERRORS = new WeakSet();
const BODY_READ_METHODS = new Set([
    'arrayBuffer',
    'blob',
    'bytes',
    'formData',
    'json',
    'text',
]);
const ABORT_SIGNAL_ABORTED_GETTER = Object.getOwnPropertyDescriptor(
    AbortSignal.prototype,
    'aborted'
)?.get;
const REQUEST_SIGNAL_GETTER = Object.getOwnPropertyDescriptor(
    globalThis.Request?.prototype || {},
    'signal'
)?.get;
const ADD_EVENT_LISTENER = EventTarget.prototype.addEventListener;
const REMOVE_EVENT_LISTENER = EventTarget.prototype.removeEventListener;

export class ResponseBodyLimitError extends Error {
    constructor(limitBytes, observedBytes) {
        super(`Response body exceeds the ${limitBytes} byte limit.`);
        this.name = 'ResponseBodyLimitError';
        this.code = 'ERR_RESPONSE_BODY_LIMIT';
        this.limitBytes = limitBytes;
        this.observedBytes = observedBytes;
    }
}

export function isResponseBodyLimitError(error) {
    return RESPONSE_BODY_LIMIT_ERRORS.has(error);
}

function markSafeInternalError(error) {
    SAFE_INTERNAL_ERRORS.add(error);
    return error;
}

function createResponseBodyLimitError(limitBytes, observedBytes) {
    const error = new ResponseBodyLimitError(limitBytes, observedBytes);
    RESPONSE_BODY_LIMIT_ERRORS.add(error);
    return markSafeInternalError(error);
}

function createFetchFailureError() {
    const error = new TypeError('Failed to fetch');
    error.code = 'ERR_FETCH_FAILED';
    error.retryable = true;
    return markSafeInternalError(error);
}

function createInvalidTimeoutError() {
    const error = new TypeError(
        'timeoutMs must be a positive safe integer no greater than 2147483647.'
    );
    error.code = 'ERR_FETCH_TIMEOUT_INVALID';
    return markSafeInternalError(error);
}

function createCallerAbortError() {
    const error = new Error('Request was aborted by the caller.');
    error.name = 'AbortError';
    error.code = 'ERR_FETCH_ABORTED';
    return markSafeInternalError(error);
}

function createResponseCancellationError() {
    const error = new Error('Response body consumption was cancelled.');
    error.name = 'AbortError';
    error.code = 'ERR_RESPONSE_BODY_CANCELLED';
    return markSafeInternalError(error);
}

function isErrorInstance(error, ErrorType) {
    try {
        return error instanceof ErrorType;
    } catch {
        return false;
    }
}

function createBodyReadFailureError(rawError) {
    if (isErrorInstance(rawError, SyntaxError)) {
        const error = new SyntaxError('Response body is not valid JSON.');
        error.code = 'ERR_RESPONSE_BODY_PARSE';
        error.retryable = false;
        return markSafeInternalError(error);
    }

    if (isErrorInstance(rawError, TypeError)) {
        const error = new TypeError('Failed to read response body.');
        error.code = 'ERR_RESPONSE_BODY_READ';
        error.retryable = true;
        return markSafeInternalError(error);
    }

    const error = new Error('Failed to read response body.');
    error.code = 'ERR_RESPONSE_BODY_READ';
    error.retryable = false;
    return markSafeInternalError(error);
}

function assertPositiveByteLimit(maxBytes) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
        throw new TypeError('maxBytes must be a positive safe integer.');
    }
}

function assertValidTimeout(timeoutMs) {
    if (
        !Number.isSafeInteger(timeoutMs) ||
        timeoutMs <= 0 ||
        timeoutMs > MAX_FETCH_TIMEOUT_MS
    ) {
        throw createInvalidTimeoutError();
    }
}

function parseContentLength(response) {
    const rawContentLength = response?.headers?.get?.(CONTENT_LENGTH_HEADER);
    if (!/^\d+$/.test(rawContentLength || '')) {
        return null;
    }

    const contentLength = Number(rawContentLength);
    return Number.isSafeInteger(contentLength) ? contentLength : null;
}

function startBestEffortCleanup(cleanup) {
    try {
        Promise.resolve(cleanup()).catch(() => {});
    } catch (_) {}
}

export function getUtf8ByteLength(value) {
    return new Blob([value]).size;
}

function createByteArray(value) {
    if (value instanceof Uint8Array) {
        return value;
    }
    if (value instanceof ArrayBuffer) {
        return new Uint8Array(value);
    }
    if (ArrayBuffer.isView(value)) {
        return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    throw new TypeError('Response body stream must yield byte chunks.');
}

async function decodeUtf8(byteChunks, totalBytes) {
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of byteChunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }

    if (typeof TextDecoder === 'function') {
        return new TextDecoder().decode(bytes);
    }
    return await new Blob([bytes]).text();
}

function createReaderCleanup(reader) {
    let canceled = false;
    let released = false;

    const release = () => {
        if (released) return;
        released = true;
        try {
            reader.releaseLock?.();
        } catch (_) {}
    };

    return {
        cancel(reason) {
            if (!canceled) {
                canceled = true;
                startBestEffortCleanup(() => reader.cancel?.(reason));
            }
            release();
        },
        release,
    };
}

async function readStreamWithLimit(response, maxBytes, reader, readerCleanup) {
    const chunks = [];
    let observedBytes = 0;

    try {
        while (true) {
            const terminalBeforeRead = getResponseTerminalError(response);
            if (terminalBeforeRead) throw terminalBeforeRead;

            const { done, value } = await reader.read();
            const terminalAfterRead = getResponseTerminalError(response);
            if (terminalAfterRead) throw terminalAfterRead;
            if (done) {
                return await decodeUtf8(chunks, observedBytes);
            }

            const chunk = createByteArray(value);
            observedBytes += chunk.byteLength;
            if (observedBytes > maxBytes) {
                const error = createResponseBodyLimitError(
                    maxBytes,
                    observedBytes
                );
                abortResponseContext(response, error);
                readerCleanup.cancel(error);
                throw error;
            }
            chunks.push(chunk);
        }
    } finally {
        readerCleanup.release();
    }
}

async function runStreamReadBeforeDeadline(response, operation, readerCleanup) {
    const timeoutContext = RESPONSE_TIMEOUT_CONTEXTS.get(response);
    try {
        if (!timeoutContext) return await operation();

        const unlinkAbort = linkAbortSignal(
            timeoutContext.callerSignal,
            timeoutContext
        );
        try {
            return await runBeforeDeadline(
                operation,
                timeoutContext,
                createBodyReadFailureError
            );
        } finally {
            unlinkAbort();
        }
    } catch (rawError) {
        const isCurrentTerminal = timeoutContext?.terminalError === rawError;
        const isInternalLimitError = isResponseBodyLimitError(rawError);
        let error =
            isCurrentTerminal || isInternalLimitError
                ? rawError
                : createBodyReadFailureError(rawError);
        if (timeoutContext && timeoutContext.terminalError !== error) {
            error = settleTerminal(timeoutContext, error);
        }
        readerCleanup.cancel(error);
        throw error;
    }
}

function abortResponseContext(response, reason) {
    const timeoutContext = RESPONSE_TIMEOUT_CONTEXTS.get(response);
    if (timeoutContext) settleTerminal(timeoutContext, reason);
}

function getResponseTerminalError(response) {
    return RESPONSE_TIMEOUT_CONTEXTS.get(response)?.terminalError || null;
}

function normalizeResponseBodyError(response, rawError) {
    const timeoutContext = RESPONSE_TIMEOUT_CONTEXTS.get(response);
    if (timeoutContext?.terminalError) return timeoutContext.terminalError;

    const error = SAFE_INTERNAL_ERRORS.has(rawError)
        ? rawError
        : createBodyReadFailureError(rawError);
    return timeoutContext ? settleTerminal(timeoutContext, error) : error;
}

function acquireResponseStreamReader(response) {
    try {
        const body = response?.body;
        const getReader = body?.getReader;
        if (typeof getReader !== 'function') return null;

        const reader = getReader.call(body);
        if (
            !reader ||
            (typeof reader !== 'object' && typeof reader !== 'function')
        ) {
            throw new TypeError('Invalid response body reader.');
        }
        return reader;
    } catch (rawError) {
        throw normalizeResponseBodyError(response, rawError);
    }
}

function getResponseBodyMethod(response, methodName) {
    try {
        const method = response?.[methodName];
        return typeof method === 'function' ? method : null;
    } catch (rawError) {
        throw normalizeResponseBodyError(response, rawError);
    }
}

async function invokeResponseBodyMethod(response, method) {
    try {
        return await method.call(response);
    } catch (rawError) {
        throw normalizeResponseBodyError(response, rawError);
    }
}

export function cancelResponseBodySafely(response, reason) {
    const safeReason = SAFE_INTERNAL_ERRORS.has(reason)
        ? reason
        : createResponseCancellationError();
    abortResponseContext(response, safeReason);
    startBestEffortCleanup(() => response?.body?.cancel?.(safeReason));
}

function getCallerAbortError(response) {
    const timeoutContext = RESPONSE_TIMEOUT_CONTEXTS.get(response);
    if (!timeoutContext) return null;
    if (timeoutContext.terminalError) return timeoutContext.terminalError;
    if (!isCallerSignalAborted(timeoutContext.callerSignal)) return null;
    return settleTerminal(timeoutContext, createCallerAbortError());
}

/**
 * Read a response body as UTF-8 text while enforcing a byte limit.
 * Error messages deliberately omit the URL because subtitle URLs may be signed.
 */
export async function readResponseTextWithLimit(response, maxBytes) {
    assertPositiveByteLimit(maxBytes);

    // An abort already visible before body reading takes precedence. Once
    // resource validation begins, a discovered limit error remains authoritative.
    const callerAbortError = getCallerAbortError(response);
    if (callerAbortError) {
        cancelResponseBodySafely(response, callerAbortError);
        throw callerAbortError;
    }

    let contentLength;
    try {
        contentLength = parseContentLength(response);
    } catch (rawError) {
        throw normalizeResponseBodyError(response, rawError);
    }
    if (contentLength !== null && contentLength > maxBytes) {
        const error = createResponseBodyLimitError(maxBytes, contentLength);
        cancelResponseBodySafely(response, error);
        throw error;
    }

    const reader = acquireResponseStreamReader(response);
    if (reader) {
        const readerCleanup = createReaderCleanup(reader);
        return await runStreamReadBeforeDeadline(
            response,
            () =>
                readStreamWithLimit(response, maxBytes, reader, readerCleanup),
            readerCleanup
        );
    }

    const arrayBuffer = getResponseBodyMethod(response, 'arrayBuffer');
    if (arrayBuffer) {
        // Compatibility fallback only: the complete body is allocated before
        // this post-read cap can be enforced.
        try {
            const buffer = await invokeResponseBodyMethod(
                response,
                arrayBuffer
            );
            const bytes = createByteArray(buffer);
            if (bytes.byteLength > maxBytes) {
                const error = createResponseBodyLimitError(
                    maxBytes,
                    bytes.byteLength
                );
                cancelResponseBodySafely(response, error);
                throw error;
            }
            return await decodeUtf8([bytes], bytes.byteLength);
        } catch (rawError) {
            throw normalizeResponseBodyError(response, rawError);
        }
    }

    // Compatibility fallback only: the complete string is allocated before
    // this post-read cap can be enforced.
    const textMethod = getResponseBodyMethod(response, 'text');
    if (!textMethod) {
        throw normalizeResponseBodyError(response, new TypeError());
    }
    try {
        const text = await invokeResponseBodyMethod(response, textMethod);
        const observedBytes = getUtf8ByteLength(text);
        if (observedBytes > maxBytes) {
            const error = createResponseBodyLimitError(maxBytes, observedBytes);
            cancelResponseBodySafely(response, error);
            throw error;
        }

        return text;
    } catch (rawError) {
        throw normalizeResponseBodyError(response, rawError);
    }
}

function createTimeoutError(timeoutMs) {
    const error = new Error(`Request timed out after ${timeoutMs}ms`);
    error.name = 'TimeoutError';
    error.code = 'ERR_FETCH_TIMEOUT';
    error.retryable = true;
    return markSafeInternalError(error);
}

function isNullishCallerSignal(callerSignal) {
    return callerSignal === null || callerSignal === undefined;
}

function isCallerSignalAborted(callerSignal) {
    if (isNullishCallerSignal(callerSignal)) return false;
    try {
        if (typeof ABORT_SIGNAL_ABORTED_GETTER !== 'function') {
            throw new TypeError();
        }
        return ABORT_SIGNAL_ABORTED_GETTER.call(callerSignal);
    } catch {
        throw createFetchFailureError();
    }
}

function getRequestInputSignal(input) {
    if (typeof REQUEST_SIGNAL_GETTER !== 'function') return undefined;
    try {
        return REQUEST_SIGNAL_GETTER.call(input);
    } catch {
        return undefined;
    }
}

function getCallerSignal(input, init) {
    let callerSignal;
    try {
        callerSignal = init?.signal;
    } catch {
        throw createFetchFailureError();
    }
    return callerSignal === undefined
        ? getRequestInputSignal(input)
        : callerSignal;
}

function createDerivedRequestInit(init, internalSignal) {
    const isObjectInit =
        init !== null &&
        (typeof init === 'object' || typeof init === 'function');
    let derivedInit;
    if (isObjectInit) {
        derivedInit = Object.create(init);
        for (const property of Reflect.ownKeys(init)) {
            if (property === 'signal') continue;
            const descriptor = Object.getOwnPropertyDescriptor(init, property);
            if (!descriptor?.enumerable) continue;
            Object.defineProperty(derivedInit, property, {
                configurable: true,
                enumerable: true,
                value: Reflect.get(init, property, init),
                writable: true,
            });
        }
    } else {
        derivedInit = { ...init };
    }
    Object.defineProperty(derivedInit, 'signal', {
        configurable: true,
        enumerable: true,
        value: internalSignal,
        writable: true,
    });
    return derivedInit;
}

function settleTerminal(timeoutContext, error) {
    if (timeoutContext.terminalError) return timeoutContext.terminalError;
    const safeError = SAFE_INTERNAL_ERRORS.has(error)
        ? error
        : createResponseCancellationError();
    timeoutContext.terminalError = safeError;
    for (const rejectTerminal of timeoutContext.terminalWaiters) {
        rejectTerminal(safeError);
    }
    timeoutContext.terminalWaiters.clear();
    try {
        timeoutContext.controller.abort(safeError);
    } catch (_) {}
    return safeError;
}

function linkAbortSignal(callerSignal, timeoutContext) {
    if (isNullishCallerSignal(callerSignal)) {
        return () => {};
    }

    const forwardAbort = () =>
        settleTerminal(timeoutContext, createCallerAbortError());
    if (isCallerSignalAborted(callerSignal)) {
        forwardAbort();
        return () => {};
    }

    try {
        ADD_EVENT_LISTENER.call(callerSignal, 'abort', forwardAbort, {
            once: true,
        });
    } catch {
        throw createFetchFailureError();
    }
    return () => {
        try {
            REMOVE_EVENT_LISTENER.call(callerSignal, 'abort', forwardAbort);
        } catch (_) {}
    };
}

function getRemainingTime(timeoutContext) {
    const { deadline, timeoutMs } = timeoutContext;
    if (timeoutContext.terminalError) throw timeoutContext.terminalError;
    if (isCallerSignalAborted(timeoutContext.callerSignal)) {
        throw settleTerminal(timeoutContext, createCallerAbortError());
    }

    timeoutContext.lastObservedNow = Math.max(
        timeoutContext.lastObservedNow,
        Date.now()
    );
    const remainingMs = deadline - timeoutContext.lastObservedNow;
    if (remainingMs <= 0) {
        throw settleTerminal(timeoutContext, createTimeoutError(timeoutMs));
    }
    return remainingMs;
}

async function runBeforeDeadline(
    operation,
    timeoutContext,
    normalizeOperationError
) {
    const remainingMs = getRemainingTime(timeoutContext);

    let timedOut = false;
    let timeoutId;
    let rejectTerminal;
    const terminal = new Promise((_, reject) => {
        rejectTerminal = reject;
        timeoutContext.terminalWaiters.add(reject);
    });
    const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            timedOut = true;
            reject(
                settleTerminal(
                    timeoutContext,
                    createTimeoutError(timeoutContext.timeoutMs)
                )
            );
        }, remainingMs);
    });

    try {
        const result = await Promise.race([
            Promise.resolve().then(operation),
            timeout,
            terminal,
        ]);
        getRemainingTime(timeoutContext);
        return result;
    } catch (error) {
        if (timedOut || timeoutContext.terminalError) {
            throw timeoutContext.terminalError;
        }
        getRemainingTime(timeoutContext);
        throw normalizeOperationError ? normalizeOperationError(error) : error;
    } finally {
        clearTimeout(timeoutId);
        timeoutContext.terminalWaiters.delete(rejectTerminal);
    }
}

function wrapResponseBody(response, timeoutContext, callerSignal) {
    const wrappedResponse = new Proxy(response, {
        get(target, property) {
            try {
                const value = Reflect.get(target, property, target);
                if (
                    typeof property === 'string' &&
                    BODY_READ_METHODS.has(property) &&
                    typeof value === 'function'
                ) {
                    return async (...args) => {
                        const unlinkAbort = linkAbortSignal(
                            callerSignal,
                            timeoutContext
                        );
                        try {
                            return await runBeforeDeadline(
                                () => value.apply(target, args),
                                timeoutContext,
                                createBodyReadFailureError
                            );
                        } finally {
                            unlinkAbort();
                        }
                    };
                }
                return typeof value === 'function' ? value.bind(target) : value;
            } catch (rawError) {
                throw settleTerminal(
                    timeoutContext,
                    createBodyReadFailureError(rawError)
                );
            }
        },
    });
    RESPONSE_TIMEOUT_CONTEXTS.set(wrappedResponse, timeoutContext);
    return wrappedResponse;
}

/**
 * Fetch with a bounded wait while preserving an optional caller abort signal.
 * Error messages deliberately omit the URL because subtitle URLs may be signed.
 */
export async function fetchWithTimeout(
    input,
    init = {},
    timeoutMs = DEFAULT_FETCH_TIMEOUT_MS
) {
    assertValidTimeout(timeoutMs);
    const controller = new AbortController();
    const callerSignal = getCallerSignal(input, init);
    const startedAt = Date.now();
    const timeoutContext = {
        controller,
        callerSignal,
        deadline: startedAt + timeoutMs,
        lastObservedNow: startedAt,
        timeoutMs,
        terminalError: null,
        terminalWaiters: new Set(),
    };
    const unlinkAbort = linkAbortSignal(callerSignal, timeoutContext);

    try {
        const response = await runBeforeDeadline(
            () => {
                const requestInit = createDerivedRequestInit(
                    init,
                    controller.signal
                );
                getRemainingTime(timeoutContext);
                return fetch(input, requestInit);
            },
            timeoutContext,
            createFetchFailureError
        );
        return wrapResponseBody(response, timeoutContext, callerSignal);
    } finally {
        unlinkAbort();
    }
}
