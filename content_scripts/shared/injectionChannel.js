import {
    readCustomEventDetail,
    readOwnDataProperty,
    readOwnPrimitiveDataProperty,
} from './subtitleRequestIdentity.js';

// The capability binds one content-script lifecycle to its injected page
// script. It is observable by the host page, so route identity and the normal
// subtitle validation remain authoritative for what the extension accepts.

const CAPABILITY_BYTES = 32;
const CAPABILITY_PATTERN = /^[0-9a-f]{64}$/u;
const MAX_SCRIPT_URL_CODE_UNITS = 4096;
const CHANNEL_FRAGMENT_KEY = 'dualsub-channel';
const CHANNEL_DETAIL_KEY = 'dualsubChannel';
const SUPPORTED_PLATFORMS = new Set(['disneyplus', 'netflix']);

function mintCapability(cryptoSource) {
    try {
        if (typeof cryptoSource?.getRandomValues !== 'function') return null;

        const bytes = new Uint8Array(CAPABILITY_BYTES);
        if (cryptoSource.getRandomValues(bytes) !== bytes) return null;

        const capability = Array.from(bytes, (byte) =>
            byte.toString(16).padStart(2, '0')
        ).join('');
        return CAPABILITY_PATTERN.test(capability) ? capability : null;
    } catch (_) {
        return null;
    }
}

function acceptPageEvent(event, platform, capability) {
    try {
        const detail = readCustomEventDetail(event);
        if (!detail || typeof detail !== 'object' || Array.isArray(detail)) {
            return null;
        }

        const authority = readOwnDataProperty(detail, CHANNEL_DETAIL_KEY);
        if (
            readOwnPrimitiveDataProperty(authority, 'platform') !== platform ||
            readOwnPrimitiveDataProperty(authority, 'capability') !== capability
        ) {
            return null;
        }

        const accepted = { ...detail };
        delete accepted[CHANNEL_DETAIL_KEY];
        return Object.freeze(accepted);
    } catch (_) {
        return null;
    }
}

function createPageDetail(platform, capability, type, fields) {
    if (typeof type !== 'string' || type.length === 0 || type.length > 64) {
        return null;
    }

    return Object.freeze({
        ...(fields && typeof fields === 'object' ? fields : {}),
        type,
        [CHANNEL_DETAIL_KEY]: Object.freeze({ platform, capability }),
    });
}

function createScriptUrl(baseUrl, platform, capability) {
    if (
        typeof baseUrl !== 'string' ||
        baseUrl.length === 0 ||
        baseUrl.length > MAX_SCRIPT_URL_CODE_UNITS
    ) {
        return null;
    }

    try {
        const parsedUrl = new URL(baseUrl);
        if (
            parsedUrl.protocol !== 'chrome-extension:' ||
            parsedUrl.username ||
            parsedUrl.password ||
            parsedUrl.port
        ) {
            return null;
        }
        parsedUrl.hash = `${CHANNEL_FRAGMENT_KEY}=${platform}.${capability}`;
        return parsedUrl.href;
    } catch (_) {
        return null;
    }
}

export function createInjectionChannel(
    platform,
    cryptoSource = globalThis.crypto
) {
    if (!SUPPORTED_PLATFORMS.has(platform)) return null;

    const capability = mintCapability(cryptoSource);
    if (!capability) return null;

    let active = true;
    return Object.freeze({
        platform,
        accept(event) {
            return active ? acceptPageEvent(event, platform, capability) : null;
        },
        createEventDetail(type, fields) {
            return active
                ? createPageDetail(platform, capability, type, fields)
                : null;
        },
        createScriptUrl(baseUrl) {
            return active
                ? createScriptUrl(baseUrl, platform, capability)
                : null;
        },
        revoke() {
            active = false;
        },
    });
}
