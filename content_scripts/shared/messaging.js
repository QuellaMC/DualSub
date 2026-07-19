/**
 * Messaging utilities with retry/wake-up for MV3 service worker
 *
 * Provides a resilient wrapper around chrome.runtime.sendMessage that retries
 * only when Chrome proves that no receiver accepted the message, such as:
 * - "Could not establish connection. Receiving end does not exist."
 * - "No matching service worker for this scope."
 */

// @ts-check

import { MessageActions } from './constants/messageActions.js';
import {
    buildBackgroundReadinessRequestMessage,
    parseBackgroundReadinessResponseMessage,
} from './protocol/messageProtocol.js';

/**
 * Helper to access the Chrome extension API dynamically so tests can swap mocks between cases.
 * This avoids capturing a stale reference across test suites.
 * @returns {any}
 */
function getChrome() {
    return /** @type {any} */ (globalThis).chrome;
}

export const MessagingFailureClass = Object.freeze({
    PROVEN_NON_DELIVERY: 'proven-non-delivery',
    AMBIGUOUS_ACCEPTANCE: 'ambiguous-acceptance',
    TERMINAL: 'terminal',
});

const trustedMessagingFailureClasses = new WeakMap();
const UNKNOWN_RUNTIME_ERROR_MESSAGE = 'Unknown runtime messaging error';
const DISPATCH_BLOCKED_ERROR_MESSAGE = 'Runtime message dispatch blocked';

function classifyTrustedRuntimeMessage(message) {
    const normalizedMessage = message.toLowerCase();

    if (
        normalizedMessage.includes('receiving end does not exist') ||
        normalizedMessage.includes('no matching service worker')
    ) {
        return MessagingFailureClass.PROVEN_NON_DELIVERY;
    }

    if (
        normalizedMessage.includes('message port closed') ||
        normalizedMessage.includes('message channel closed')
    ) {
        return MessagingFailureClass.AMBIGUOUS_ACCEPTANCE;
    }

    return MessagingFailureClass.TERMINAL;
}

function createBrandedRuntimeError(message, cause, failureClass) {
    const error = new Error(message, { cause });
    trustedMessagingFailureClasses.set(error, failureClass);
    return error;
}

function createTerminalRuntimeError(cause) {
    return createBrandedRuntimeError(
        UNKNOWN_RUNTIME_ERROR_MESSAGE,
        cause,
        MessagingFailureClass.TERMINAL
    );
}

function createDispatchBlockedError() {
    const error = new Error(DISPATCH_BLOCKED_ERROR_MESSAGE);
    error.name = 'MessagingDispatchBlockedError';
    trustedMessagingFailureClasses.set(error, MessagingFailureClass.TERMINAL);
    return error;
}

function normalizeTrustedRuntimeLastError(lastError) {
    const clone = globalThis.structuredClone;
    if (typeof clone !== 'function') {
        return createTerminalRuntimeError(lastError);
    }

    let snapshot;
    try {
        // runtime.lastError is browser-owned callback state. Snapshot it once
        // so later mutation cannot change retry ownership. structuredClone
        // rejects Proxy values without consulting their traps.
        snapshot = clone(lastError);
    } catch (_) {
        return createTerminalRuntimeError(lastError);
    }

    let descriptor;
    try {
        descriptor = Object.getOwnPropertyDescriptor(snapshot, 'message');
    } catch (_) {
        return createTerminalRuntimeError(lastError);
    }
    if (
        !descriptor ||
        !('value' in descriptor) ||
        typeof descriptor.value !== 'string' ||
        descriptor.value.trim() === ''
    ) {
        return createTerminalRuntimeError(lastError);
    }

    return createBrandedRuntimeError(
        descriptor.value,
        lastError,
        classifyTrustedRuntimeMessage(descriptor.value)
    );
}

/**
 * Classify whether Chrome proved a message was never accepted. Port/channel
 * closure is deliberately ambiguous because a receiver may have begun work.
 * Unknown and invalidated-context failures are terminal.
 * @param {unknown} error
 * @returns {string}
 */
export function classifyMessagingFailure(error) {
    if (
        (typeof error !== 'object' && typeof error !== 'function') ||
        error === null
    ) {
        return MessagingFailureClass.TERMINAL;
    }
    return (
        trustedMessagingFailureClasses.get(error) ??
        MessagingFailureClass.TERMINAL
    );
}

/**
 * @param {unknown} error
 * @returns {boolean} Whether it is safe to send the same message again.
 */
export function isProvenMessagingNonDelivery(error) {
    return (
        classifyMessagingFailure(error) ===
        MessagingFailureClass.PROVEN_NON_DELIVERY
    );
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function rawSendMessage(message) {
    const chromeApi = getChrome();
    const runtime = chromeApi?.runtime;
    if (typeof runtime?.sendMessage !== 'function') {
        return Promise.reject(new Error('Messaging unavailable'));
    }

    const fn = runtime.sendMessage;
    return new Promise((resolve, reject) => {
        let settled = false;
        const settle = (handler, value) => {
            if (settled) return;
            settled = true;
            handler(value);
        };
        const onResponse = (response) => {
            if (settled) return;

            let lastError;
            try {
                lastError = runtime.lastError;
            } catch (error) {
                settle(reject, createTerminalRuntimeError(error));
                return;
            }

            if (lastError) {
                settle(reject, normalizeTrustedRuntimeLastError(lastError));
                return;
            }
            settle(resolve, response);
        };

        let maybePromise;
        try {
            maybePromise = fn.call(runtime, message, onResponse);
        } catch (error) {
            settle(reject, error);
            return;
        }

        let then;
        try {
            then = maybePromise ? /** @type {any} */ (maybePromise).then : null;
        } catch (error) {
            settle(reject, error);
            return;
        }

        if (typeof then === 'function') {
            try {
                then.call(
                    maybePromise,
                    (response) => settle(resolve, response),
                    (error) => settle(reject, error)
                );
            } catch (error) {
                settle(reject, error);
            }
        }
    });
}

async function sendBackgroundReadinessProbe(action) {
    const request = buildBackgroundReadinessRequestMessage(action);
    const response = await rawSendMessage(request);
    const parsed = parseBackgroundReadinessResponseMessage(response, request);
    if (!parsed) {
        throw new Error('Invalid background-readiness response');
    }
    return parsed;
}

function dispatchMainMessage(message, canDispatch) {
    if (canDispatch !== undefined) {
        let dispatchIsAllowed = false;
        try {
            dispatchIsAllowed =
                typeof canDispatch === 'function' && canDispatch();
        } catch (_) {
            throw createDispatchBlockedError();
        }
        if (dispatchIsAllowed !== true) {
            throw createDispatchBlockedError();
        }
    }

    return rawSendMessage(message);
}

/**
 * Send a runtime message with retries and optional wake-up pings.
 * @param {Object} message - Message payload
 * @param {Object} [options]
 * @param {number} [options.retries=3] - Retry attempts after proven non-delivery
 * @param {number} [options.baseDelayMs=100] - Initial backoff delay in ms
 * @param {number} [options.backoffFactor=2] - Multiplier for exponential backoff
 * @param {boolean} [options.pingBeforeRetry=true] - Send a ping/check to wake background before retry
 * @param {Function} [options.canDispatch] - Synchronous exact-true authorization checked immediately before each main dispatch
 * @returns {Promise<any>} Response
 */
export async function sendRuntimeMessageWithRetry(
    message,
    {
        retries = 3,
        baseDelayMs = 100,
        backoffFactor = 2,
        pingBeforeRetry = true,
        canDispatch,
    } = {}
) {
    if (!message || typeof message !== 'object' || !message.action) {
        throw new Error(
            'sendRuntimeMessageWithRetry: message.action is required'
        );
    }
    let attempt = 0;
    let delay = baseDelayMs;

    while (true) {
        try {
            return await dispatchMainMessage(message, canDispatch);
        } catch (error) {
            attempt++;
            if (!isProvenMessagingNonDelivery(error) || attempt > retries) {
                throw error;
            }

            // Try to wake service worker and verify readiness
            if (pingBeforeRetry) {
                try {
                    // Prefer readiness check to know when services are fully initialized
                    await sendBackgroundReadinessProbe(
                        MessageActions.CHECK_BACKGROUND_READY
                    );
                } catch (_) {
                    try {
                        await sendBackgroundReadinessProbe(MessageActions.PING);
                    } catch (_) {}
                }
            }

            await sleep(delay);
            delay = Math.min(2000, delay * backoffFactor);
        }
    }
}
