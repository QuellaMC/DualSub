/**
 * Promise-based runtime messaging with bounded retries for proven non-delivery.
 */

// @ts-check

const UNKNOWN_RUNTIME_ERROR_MESSAGE = 'Unknown runtime messaging error';
const DISPATCH_BLOCKED_ERROR_MESSAGE = 'Runtime message dispatch blocked';
const PROVEN_NON_DELIVERY_PATTERN =
    /receiving end does not exist|no matching service worker/i;

/**
 * @param {unknown} error
 * @returns {string}
 */
function getRuntimeErrorMessage(error) {
    if (
        error instanceof Error &&
        typeof error.message === 'string' &&
        error.message.trim()
    ) {
        return error.message;
    }
    return UNKNOWN_RUNTIME_ERROR_MESSAGE;
}

/**
 * Do not expose browser-owned rejection objects to callers.
 * @param {unknown} error
 * @returns {Error}
 */
function sanitizeRuntimeError(error) {
    return new Error(getRuntimeErrorMessage(error));
}

function createDispatchBlockedError() {
    const error = new Error(DISPATCH_BLOCKED_ERROR_MESSAGE);
    error.name = 'MessagingDispatchBlockedError';
    return error;
}

/**
 * @param {unknown} error
 * @returns {boolean} Whether Chrome proved the message had no receiver.
 */
export function isProvenMessagingNonDelivery(error) {
    return (
        error instanceof Error &&
        PROVEN_NON_DELIVERY_PATTERN.test(error.message)
    );
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendRuntimeMessage(message) {
    const runtime = /** @type {any} */ (globalThis).chrome?.runtime;
    if (typeof runtime?.sendMessage !== 'function') {
        throw new Error('Messaging unavailable');
    }

    try {
        return await runtime.sendMessage(message);
    } catch (error) {
        throw sanitizeRuntimeError(error);
    }
}

function assertCanDispatch(canDispatch) {
    if (canDispatch === undefined) return;

    try {
        if (typeof canDispatch === 'function' && canDispatch() === true) return;
    } catch (_) {}

    throw createDispatchBlockedError();
}

/**
 * Send a runtime message, retrying only when Chrome proves non-delivery.
 * @param {Object} message - Message payload
 * @param {Object} [options]
 * @param {number} [options.retries=3] - Retry attempts after proven non-delivery
 * @param {number} [options.baseDelayMs=100] - Initial backoff delay in ms
 * @param {number} [options.backoffFactor=2] - Multiplier for exponential backoff
 * @param {Function} [options.canDispatch] - Synchronous exact-true authorization checked before each dispatch
 * @returns {Promise<any>} Response
 */
export async function sendRuntimeMessageWithRetry(
    message,
    { retries = 3, baseDelayMs = 100, backoffFactor = 2, canDispatch } = {}
) {
    if (!message || typeof message !== 'object' || !message.action) {
        throw new Error(
            'sendRuntimeMessageWithRetry: message.action is required'
        );
    }

    let delay = baseDelayMs;
    for (let attempt = 0; ; attempt++) {
        assertCanDispatch(canDispatch);

        try {
            return await sendRuntimeMessage(message);
        } catch (error) {
            if (!isProvenMessagingNonDelivery(error) || attempt >= retries) {
                throw error;
            }
        }

        await sleep(delay);
        delay = Math.min(2000, delay * backoffFactor);
    }
}
