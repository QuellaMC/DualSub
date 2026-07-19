export const DEFAULT_FETCH_TIMEOUT_MS = 30_000;
const BODY_READ_METHODS = new Set([
    'arrayBuffer',
    'blob',
    'bytes',
    'formData',
    'json',
    'text',
]);

function createTimeoutError(timeoutMs, cause) {
    const error = new Error(`Request timed out after ${timeoutMs}ms`, {
        cause,
    });
    error.name = 'TimeoutError';
    error.retryable = true;
    return error;
}

function linkAbortSignal(callerSignal, controller) {
    if (!callerSignal) {
        return () => {};
    }

    const forwardAbort = () => controller.abort(callerSignal.reason);
    if (callerSignal.aborted) {
        forwardAbort();
        return () => {};
    }

    callerSignal.addEventListener('abort', forwardAbort, { once: true });
    return () => callerSignal.removeEventListener('abort', forwardAbort);
}

async function runBeforeDeadline(
    operation,
    { controller, deadline, timeoutMs }
) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
        controller.abort();
        throw createTimeoutError(timeoutMs);
    }

    let timedOut = false;
    let timeoutId;
    const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            timedOut = true;
            reject(createTimeoutError(timeoutMs));
            controller.abort();
        }, remainingMs);
    });

    try {
        return await Promise.race([Promise.resolve().then(operation), timeout]);
    } catch (error) {
        if (timedOut && error?.name !== 'TimeoutError') {
            throw createTimeoutError(timeoutMs, error);
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
}

function wrapResponseBody(response, timeoutContext, callerSignal) {
    return new Proxy(response, {
        get(target, property) {
            const value = Reflect.get(target, property, target);
            if (
                typeof property === 'string' &&
                BODY_READ_METHODS.has(property) &&
                typeof value === 'function'
            ) {
                return async (...args) => {
                    const unlinkAbort = linkAbortSignal(
                        callerSignal,
                        timeoutContext.controller
                    );
                    try {
                        return await runBeforeDeadline(
                            () => value.apply(target, args),
                            timeoutContext
                        );
                    } finally {
                        unlinkAbort();
                    }
                };
            }
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
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
    const controller = new AbortController();
    const callerSignal = init.signal;
    const timeoutContext = {
        controller,
        deadline: Date.now() + timeoutMs,
        timeoutMs,
    };
    const unlinkAbort = linkAbortSignal(callerSignal, controller);

    try {
        const response = await runBeforeDeadline(
            () => fetch(input, { ...init, signal: controller.signal }),
            timeoutContext
        );
        return wrapResponseBody(response, timeoutContext, callerSignal);
    } finally {
        unlinkAbort();
    }
}
