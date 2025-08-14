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

async function rawSendMessage(message) {
    if (!globalThis.chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
        throw new Error('Messaging unavailable');
    }
    // Prefer promise form when available (MV3). If it throws, propagate.
    try {
        const response = await chrome.runtime.sendMessage(message);
        return response;
    } catch (err) {
        // Some environments only support callback form; fall back if needed.
        return await new Promise((resolve, reject) => {
            try {
                chrome.runtime.sendMessage(message, (response) => {
                    const lastErr = chrome.runtime.lastError;
                    if (lastErr) {
                        reject(
                            new Error(
                                lastErr.message || 'Unknown runtime error'
                            )
                        );
                        return;
                    }
                    resolve(response);
                });
            } catch (cbErr) {
                reject(cbErr);
            }
        });
    }
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
                    await rawSendMessage({ action: 'checkBackgroundReady' });
                } catch (_) {
                    try {
                        await rawSendMessage({
                            action: 'ping',
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
