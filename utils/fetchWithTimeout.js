export const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

const MAX_FETCH_TIMEOUT_MS = 2_147_483_647;
const CONTENT_LENGTH_HEADER = 'content-length';
const RESPONSE_TIMEOUT_CONTEXTS = new WeakMap();
const BODY_READ_METHODS = [
    'arrayBuffer',
    'blob',
    'bytes',
    'formData',
    'json',
    'text',
];

class ResponseBodyLimitError extends Error {
    constructor(limitBytes, observedBytes) {
        super(`Response body exceeds the ${limitBytes} byte limit.`);
        this.name = 'ResponseBodyLimitError';
        this.code = 'ERR_RESPONSE_BODY_LIMIT';
        this.limitBytes = limitBytes;
        this.observedBytes = observedBytes;
    }
}

export function isResponseBodyLimitError(error) {
    return error instanceof ResponseBodyLimitError;
}

function createFetchFailureError() {
    const error = new TypeError('Failed to fetch');
    error.code = 'ERR_FETCH_FAILED';
    error.retryable = true;
    return error;
}

function createInvalidTimeoutError() {
    const error = new TypeError(
        'timeoutMs must be a positive safe integer no greater than 2147483647.'
    );
    error.code = 'ERR_FETCH_TIMEOUT_INVALID';
    return error;
}

function createTimeoutError(timeoutMs) {
    const error = new Error(`Request timed out after ${timeoutMs}ms`);
    error.name = 'TimeoutError';
    error.code = 'ERR_FETCH_TIMEOUT';
    error.retryable = true;
    return error;
}

function createCallerAbortError() {
    const error = new Error('Request was aborted by the caller.');
    error.name = 'AbortError';
    error.code = 'ERR_FETCH_ABORTED';
    return error;
}

function createResponseCancellationError() {
    const error = new Error('Response body consumption was cancelled.');
    error.name = 'AbortError';
    error.code = 'ERR_RESPONSE_BODY_CANCELLED';
    return error;
}

function createBodyReadFailureError(rawError) {
    if (rawError instanceof SyntaxError) {
        const error = new SyntaxError('Response body is not valid JSON.');
        error.code = 'ERR_RESPONSE_BODY_PARSE';
        error.retryable = false;
        return error;
    }

    const ErrorType = rawError instanceof TypeError ? TypeError : Error;
    const error = new ErrorType('Failed to read response body.');
    error.code = 'ERR_RESPONSE_BODY_READ';
    error.retryable = ErrorType === TypeError;
    return error;
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

function assertPositiveByteLimit(maxBytes) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
        throw new TypeError('maxBytes must be a positive safe integer.');
    }
}

function startBestEffortCleanup(cleanup) {
    try {
        Promise.resolve(cleanup()).catch(() => {});
    } catch {}
}

function abortContext(context, error) {
    if (context.terminalError) return context.terminalError;
    context.terminalError = error;
    finishDeadlineContext(context);
    context.controller.abort(error);
    return error;
}

function finishDeadlineContext(context) {
    const stopDeadlineGuard = context.stopDeadlineGuard;
    context.stopDeadlineGuard = null;
    stopDeadlineGuard?.();
}

function linkCallerSignal(context) {
    const { callerSignal } = context;
    if (callerSignal === null || callerSignal === undefined) {
        return () => {};
    }

    const forwardAbort = () => abortContext(context, createCallerAbortError());
    if (callerSignal.aborted) {
        forwardAbort();
        return () => {};
    }

    callerSignal.addEventListener('abort', forwardAbort, { once: true });
    return () => callerSignal.removeEventListener('abort', forwardAbort);
}

async function raceUntilAbort(context, operation) {
    let removeInternalAbort = () => {};

    try {
        if (context.terminalError) throw context.terminalError;

        const aborted = new Promise((_, reject) => {
            const rejectOnAbort = () => reject(context.terminalError);
            context.controller.signal.addEventListener('abort', rejectOnAbort, {
                once: true,
            });
            removeInternalAbort = () =>
                context.controller.signal.removeEventListener(
                    'abort',
                    rejectOnAbort
                );
        });
        const result = await Promise.race([
            Promise.resolve().then(operation),
            aborted,
        ]);
        if (Date.now() >= context.deadline) {
            throw abortContext(context, createTimeoutError(context.timeoutMs));
        }
        return result;
    } finally {
        removeInternalAbort();
    }
}

function startDeadlineGuard(context) {
    const unlinkCaller = linkCallerSignal(context);
    if (context.terminalError) {
        unlinkCaller();
        throw context.terminalError;
    }

    const remainingMs = context.deadline - Date.now();
    if (remainingMs <= 0) {
        unlinkCaller();
        throw abortContext(context, createTimeoutError(context.timeoutMs));
    }

    const timeoutId = setTimeout(() => {
        abortContext(context, createTimeoutError(context.timeoutMs));
    }, remainingMs);
    context.stopDeadlineGuard = () => {
        clearTimeout(timeoutId);
        unlinkCaller();
    };
}

function normalizeBodyReadError(context, rawError) {
    if (context?.terminalError) return context.terminalError;
    if (isResponseBodyLimitError(rawError)) return rawError;
    return createBodyReadFailureError(rawError);
}

async function readResponseBody(response, context, method, args) {
    try {
        const result = await raceUntilAbort(context, () =>
            method.apply(response, args)
        );
        finishDeadlineContext(context);
        return result;
    } catch (rawError) {
        const error = normalizeBodyReadError(context, rawError);
        abortContext(context, error);
        throw error;
    }
}

function installBodyMethodDeadlines(response, context) {
    RESPONSE_TIMEOUT_CONTEXTS.set(response, context);

    for (const methodName of BODY_READ_METHODS) {
        const method = response[methodName];
        if (typeof method !== 'function') continue;

        Object.defineProperty(response, methodName, {
            configurable: true,
            enumerable: false,
            value: (...args) =>
                readResponseBody(response, context, method, args),
            writable: true,
        });
    }

    return response;
}

function getCallerSignal(input, init) {
    if (init?.signal !== undefined) return init.signal;
    if (typeof Request === 'function' && input instanceof Request) {
        return input.signal;
    }
    return undefined;
}

function parseContentLength(response) {
    const rawContentLength = response.headers?.get(CONTENT_LENGTH_HEADER);
    if (!/^\d+$/.test(rawContentLength || '')) return null;

    const contentLength = Number(rawContentLength);
    return Number.isSafeInteger(contentLength) ? contentLength : null;
}

export function getUtf8ByteLength(value) {
    return new Blob([value]).size;
}

function createByteArray(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) {
        return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    throw new TypeError('Response body stream must yield byte chunks.');
}

function decodeUtf8(chunks, totalBytes) {
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
}

async function readStreamWithLimit(reader, maxBytes, context) {
    const chunks = [];
    let observedBytes = 0;

    while (true) {
        const { done, value } = await reader.read();
        if (context?.terminalError) throw context.terminalError;
        if (done) return decodeUtf8(chunks, observedBytes);

        const chunk = createByteArray(value);
        observedBytes += chunk.byteLength;
        if (observedBytes > maxBytes) {
            throw new ResponseBodyLimitError(maxBytes, observedBytes);
        }
        chunks.push(chunk);
    }
}

function cancelReaderSafely(reader, reason) {
    startBestEffortCleanup(() => reader.cancel(reason));
}

function releaseReaderSafely(reader) {
    try {
        reader.releaseLock();
    } catch {}
}

function getSafeCancellationReason(response, reason) {
    const context = RESPONSE_TIMEOUT_CONTEXTS.get(response);
    if (
        isResponseBodyLimitError(reason) ||
        (context?.terminalError && reason === context.terminalError)
    ) {
        return reason;
    }
    return createResponseCancellationError();
}

export function cancelResponseBodySafely(response, reason) {
    const safeReason = getSafeCancellationReason(response, reason);
    const context = RESPONSE_TIMEOUT_CONTEXTS.get(response);
    if (context) abortContext(context, safeReason);
    startBestEffortCleanup(() => response.body?.cancel(safeReason));
}

/**
 * Read a response body as UTF-8 text while enforcing a byte limit.
 * Error messages deliberately omit the URL because subtitle URLs may be signed.
 */
export async function readResponseTextWithLimit(response, maxBytes) {
    assertPositiveByteLimit(maxBytes);

    const context = RESPONSE_TIMEOUT_CONTEXTS.get(response);
    let reader;

    const read = async () => {
        const contentLength = parseContentLength(response);
        if (contentLength !== null && contentLength > maxBytes) {
            throw new ResponseBodyLimitError(maxBytes, contentLength);
        }

        if (response.body === null) return '';
        reader = response.body.getReader();
        return await readStreamWithLimit(reader, maxBytes, context);
    };

    try {
        const text = context
            ? await raceUntilAbort(context, read)
            : await read();
        if (context) finishDeadlineContext(context);
        return text;
    } catch (rawError) {
        const error = normalizeBodyReadError(context, rawError);
        if (context) abortContext(context, error);
        if (reader) {
            cancelReaderSafely(reader, error);
        } else {
            cancelResponseBodySafely(response, error);
        }
        throw error;
    } finally {
        if (reader) releaseReaderSafely(reader);
    }
}

/**
 * Fetch with one absolute deadline across headers and body consumption while
 * preserving an optional caller abort signal. Errors deliberately omit the
 * URL because subtitle URLs may be signed.
 */
export async function fetchWithTimeout(
    input,
    init = {},
    timeoutMs = DEFAULT_FETCH_TIMEOUT_MS
) {
    assertValidTimeout(timeoutMs);

    let context;
    try {
        const controller = new AbortController();
        context = {
            callerSignal: getCallerSignal(input, init),
            controller,
            deadline: Date.now() + timeoutMs,
            stopDeadlineGuard: null,
            terminalError: null,
            timeoutMs,
        };
        startDeadlineGuard(context);
        const response = await raceUntilAbort(context, () =>
            fetch(input, { ...init, signal: controller.signal })
        );
        return installBodyMethodDeadlines(response, context);
    } catch {
        if (context?.terminalError) throw context.terminalError;

        const error = createFetchFailureError();
        if (context) abortContext(context, error);
        throw error;
    }
}
