import { browser } from 'wxt/browser';

const REQUIRED_API_HOSTS = new Set([
    'https://api.openai.com/*',
    'https://generativelanguage.googleapis.com/*',
]);

/**
 * Convert a provider URL into the narrow origin pattern Chrome permissions
 * use. Remote custom endpoints must use HTTPS; loopback HTTP remains
 * available for local model servers.
 */
export function toHostPermissionPattern(baseUrl: string): string {
    let url: URL;
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

/** Check whether a provider origin is already available without prompting. */
export async function hasHostPermission(baseUrl: string): Promise<boolean> {
    const origin = toHostPermissionPattern(baseUrl);
    if (REQUIRED_API_HOSTS.has(origin)) {
        return true;
    }
    return browser.permissions.contains({ origins: [origin] });
}

/**
 * Request a custom provider origin. Call this directly from a user gesture —
 * awaiting anything else first would leave the gesture and Chrome would
 * reject the prompt.
 */
export function requestHostPermission(baseUrl: string): Promise<boolean> {
    const origin = toHostPermissionPattern(baseUrl);
    if (REQUIRED_API_HOSTS.has(origin)) {
        return Promise.resolve(true);
    }
    return browser.permissions.request({ origins: [origin] });
}
