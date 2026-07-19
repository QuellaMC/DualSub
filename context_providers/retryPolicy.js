/**
 * Retry only failures that are plausibly transient. Authentication, request
 * validation, safety, and missing-configuration failures require user action.
 * @param {unknown} error
 * @returns {boolean}
 */
export function isRetryableContextError(error) {
    if (
        error?.name === 'AbortError' ||
        error?.name === 'TimeoutError' ||
        error instanceof TypeError
    ) {
        return true;
    }

    const message = String(error?.message || error).toLowerCase();
    return (
        /\b429\b/.test(message) ||
        /\b5\d\d\b/.test(message) ||
        message.includes('network') ||
        message.includes('timeout') ||
        message.includes('timed out') ||
        message.includes('temporarily unavailable')
    );
}
