/**
 * Messaging utilities with retry/wake-up for MV3 service worker
 *
 * Provides a resilient wrapper around chrome.runtime.sendMessage that retries
 * on transient connection errors like:
 * - "Could not establish connection. Receiving end does not exist."
 * - "The message port closed before a response was received."
 * - "No matching service worker for this scope."
 * - "Extension context invalidated."
 */

// @ts-check

/**
 * Helper to access the Chrome extension API dynamically so tests can swap mocks between cases.
 * This avoids capturing a stale reference across test suites.
 * @returns {any}
 */
function getChrome() {
    return /** @type {any} */ (globalThis).chrome;
}

function isTransientMessagingError(error) {
    if (!error) return false;
    const message = (
        typeof error === 'string' ? error : error.message || ''
    ).toLowerCase();
    return (
        message.includes('receiving end does not exist') ||
        message.includes('could not establish connection') ||
        message.includes(
            'message port closed before a response was received'
        ) ||
        message.includes('no matching service worker') ||
        message.includes('extension context invalidated')
    );
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

import { MessageActions } from './constants/messageActions.js';

export async function rawSendMessage(message) {
    const chromeApi = getChrome();
    if (!chromeApi || !chromeApi.runtime || !chromeApi.runtime.sendMessage) {
        throw new Error('Messaging unavailable');
    }

    const fn = chromeApi.runtime.sendMessage;
    const arity = typeof fn === 'function' ? fn.length : 0;

    // Prefer callback-style when available (typical in tests/mocks); otherwise use the promise API.
    if (arity >= 2) {
        try {
            return await new Promise((resolve, reject) => {
                let settled = false;
                try {
                    const maybePromise = /** @type {any} */ (
                        fn(message, (response) => {
                            if (settled) return;
                            const lastErr = getChrome()?.runtime?.lastError;
                            if (lastErr) {
                                settled = true;
                                reject(
                                    new Error(
                                        lastErr.message ||
                                            'Unknown runtime error'
                                    )
                                );
                                return;
                            }
                            settled = true;
                            resolve(response);
                        })
                    );
                    if (
                        maybePromise &&
                        typeof maybePromise.then === 'function'
                    ) {
                        maybePromise
                            .then((resp) => {
                                if (settled) return;
                                settled = true;
                                resolve(resp);
                            })
                            .catch((perr) => {
                                if (settled) return;
                                settled = true;
                                reject(perr);
                            });
                    }
                } catch (cbErr) {
                    if (!settled) reject(cbErr);
                }
            });
        } catch (err) {
            // If callback path failed, fall back to promise path
        }
    }

    // Promise-style path
    const result = fn(message);
    if (result && typeof result.then === 'function') {
        return await result;
    }
    return result;
}

/**
 * Send a runtime message with retries and optional wake-up pings.
 * @param {Object} message - Message payload
 * @param {Object} [options]
 * @param {number} [options.retries=3] - Number of retry attempts on transient errors
 * @param {number} [options.baseDelayMs=100] - Initial backoff delay in ms
 * @param {number} [options.backoffFactor=2] - Multiplier for exponential backoff
 * @param {boolean} [options.pingBeforeRetry=true] - Send a ping/check to wake background before retry
 * @returns {Promise<any>} Response
 */
export async function sendRuntimeMessageWithRetry(
    message,
    {
        retries = 3,
        baseDelayMs = 100,
        backoffFactor = 2,
        pingBeforeRetry = true,
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
            return await rawSendMessage(message);
        } catch (error) {
            attempt++;
            if (!isTransientMessagingError(error) || attempt > retries) {
                throw error;
            }

            // Try to wake service worker and verify readiness
            if (pingBeforeRetry) {
                try {
                    // Prefer readiness check to know when services are fully initialized
                    await rawSendMessage({
                        action: MessageActions.CHECK_BACKGROUND_READY,
                    });
                } catch (_) {
                    try {
                        await rawSendMessage({
                            action: MessageActions.PING,
                            source: 'content',
                        });
                    } catch (_) {}
                }
            }

            await sleep(delay);
            delay = Math.min(2000, delay * backoffFactor);
        }
    }
}
