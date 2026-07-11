const REQUIRED_API_HOSTS = new Set([
    'https://api.openai.com/*',
    'https://generativelanguage.googleapis.com/*',
]);

/**
 * Convert a provider URL into the narrow origin pattern Chrome permissions use.
 * Remote custom endpoints must use HTTPS; loopback HTTP remains available for
 * local model servers.
 *
 * @param {string} baseUrl
 * @returns {string}
 */
export function toHostPermissionPattern(baseUrl) {
    let url;
    try {
        url = new URL(baseUrl);
    } catch {
        throw new Error('Enter a valid provider URL before granting access.');
    }

    if (url.username || url.password) {
        throw new Error('Provider URLs must not contain embedded credentials.');
    }

    const isLoopback =
        url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (
        url.protocol !== 'https:' &&
        !(url.protocol === 'http:' && isLoopback)
    ) {
        throw new Error(
            'Custom providers must use HTTPS (HTTP is allowed only for localhost).'
        );
    }

    return `${url.protocol}//${url.hostname}/*`;
}

/**
 * Check whether a provider origin is already available without prompting.
 *
 * @param {string} baseUrl
 * @returns {Promise<boolean>}
 */
export async function hasHostPermission(baseUrl) {
    const origin = toHostPermissionPattern(baseUrl);
    if (REQUIRED_API_HOSTS.has(origin)) {
        return true;
    }
    const permissions = globalThis.chrome?.permissions;
    if (!permissions?.contains) {
        return false;
    }
    return permissions.contains({ origins: [origin] });
}

/**
 * Request a custom provider origin. Call this directly from a user gesture.
 * Required first-party API hosts are already granted by the manifest.
 *
 * @param {string} baseUrl
 * @returns {Promise<boolean>}
 */
export function requestHostPermission(baseUrl) {
    const origin = toHostPermissionPattern(baseUrl);
    if (REQUIRED_API_HOSTS.has(origin)) {
        return Promise.resolve(true);
    }
    const permissions = globalThis.chrome?.permissions;
    if (!permissions?.request) {
        return Promise.reject(
            new Error(
                'Chrome host permissions are unavailable in this context.'
            )
        );
    }

    // Do not await another API first: request() must remain in the user gesture.
    return permissions.request({ origins: [origin] });
}
