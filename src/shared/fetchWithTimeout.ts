// Bounded fetch: one deadline covers the request AND the body read (the
// composed signal is tied to the Response, so body reads abort with it).
// Error messages deliberately omit URLs because subtitle URLs may be signed.

export const DEFAULT_FETCH_TIMEOUT_MS = 30_000;
const MAX_FETCH_TIMEOUT_MS = 2_147_483_647;

export class FetchTimeoutError extends Error {
    override readonly name = 'TimeoutError';
    readonly code = 'ERR_FETCH_TIMEOUT';
    readonly retryable = true;

    constructor(timeoutMs: number) {
        super(`Request timed out after ${timeoutMs}ms`);
    }
}

export class FetchAbortedError extends Error {
    override readonly name = 'AbortError';
    readonly code = 'ERR_FETCH_ABORTED';

    constructor() {
        super('Request was aborted by the caller.');
    }
}

export class FetchFailedError extends Error {
    override readonly name = 'TypeError';
    readonly code = 'ERR_FETCH_FAILED';
    readonly retryable = true;

    constructor() {
        super('Failed to fetch');
    }
}

export class ResponseBodyLimitError extends Error {
    override readonly name = 'ResponseBodyLimitError';
    readonly code = 'ERR_RESPONSE_BODY_LIMIT';
    readonly limitBytes: number;
    readonly observedBytes: number;

    constructor(limitBytes: number, observedBytes: number) {
        super(`Response body exceeds the ${limitBytes} byte limit.`);
        this.limitBytes = limitBytes;
        this.observedBytes = observedBytes;
    }
}

export function isResponseBodyLimitError(
    error: unknown
): error is ResponseBodyLimitError {
    return error instanceof ResponseBodyLimitError;
}

function classifyFetchRejection(
    cause: unknown,
    timeoutMs: number
): FetchTimeoutError | FetchAbortedError | FetchFailedError {
    if (cause instanceof DOMException || cause instanceof Error) {
        if (cause.name === 'TimeoutError') {
            return new FetchTimeoutError(timeoutMs);
        }
        if (cause.name === 'AbortError') {
            return new FetchAbortedError();
        }
    }
    return new FetchFailedError();
}

interface TimedFetchInit extends RequestInit {
    signal?: AbortSignal | null;
}

const RESPONSE_DEADLINES = new WeakMap<Response, number>();

/** Fetch with a bounded wait composed with an optional caller abort signal. */
export async function fetchWithTimeout(
    input: string | URL,
    init: TimedFetchInit = {},
    timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS
): Promise<Response> {
    if (
        !Number.isSafeInteger(timeoutMs) ||
        timeoutMs <= 0 ||
        timeoutMs > MAX_FETCH_TIMEOUT_MS
    ) {
        throw new TypeError(
            'timeoutMs must be a positive safe integer no greater than 2147483647.'
        );
    }

    const signals = [AbortSignal.timeout(timeoutMs)];
    if (init.signal) {
        signals.push(init.signal);
    }
    const signal = AbortSignal.any(signals);

    let response: Response;
    try {
        response = await fetch(input, { ...init, signal });
    } catch (cause) {
        throw classifyFetchRejection(
            signal.aborted ? signal.reason : cause,
            timeoutMs
        );
    }
    RESPONSE_DEADLINES.set(response, timeoutMs);
    return response;
}

/** Best-effort body cancellation for a response that will not be consumed. */
export function cancelResponseBodySafely(
    response: Response,
    reason?: unknown
): void {
    try {
        void response.body?.cancel(reason)?.catch(() => undefined);
    } catch {
        // Locked or already-consumed bodies have nothing left to cancel.
    }
}

/** Read a response body as UTF-8 text while enforcing a byte limit. */
export async function readResponseTextWithLimit(
    response: Response,
    maxBytes: number
): Promise<string> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
        throw new TypeError('maxBytes must be a positive safe integer.');
    }

    const rawContentLength = response.headers.get('content-length');
    if (rawContentLength !== null && /^\d+$/.test(rawContentLength)) {
        const contentLength = Number(rawContentLength);
        if (Number.isSafeInteger(contentLength) && contentLength > maxBytes) {
            const error = new ResponseBodyLimitError(maxBytes, contentLength);
            cancelResponseBodySafely(response, error);
            throw error;
        }
    }

    if (!response.body) {
        return '';
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let observedBytes = 0;
    try {
        for (;;) {
            let done: boolean;
            let value: Uint8Array | undefined;
            try {
                ({ done, value } = await reader.read());
            } catch (cause) {
                throw classifyFetchRejection(
                    cause,
                    RESPONSE_DEADLINES.get(response) ?? DEFAULT_FETCH_TIMEOUT_MS
                );
            }
            if (done) {
                break;
            }
            observedBytes += value!.byteLength;
            if (observedBytes > maxBytes) {
                const error = new ResponseBodyLimitError(
                    maxBytes,
                    observedBytes
                );
                void reader.cancel(error).catch(() => undefined);
                throw error;
            }
            chunks.push(value!);
        }
    } finally {
        try {
            reader.releaseLock();
        } catch {
            // The stream may already be closed or errored.
        }
    }

    const bytes = new Uint8Array(observedBytes);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
}
