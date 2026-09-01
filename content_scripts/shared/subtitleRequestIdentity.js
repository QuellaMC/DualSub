/**
 * Canonical player-route identity helpers. These helpers establish equality
 * between page events and the current route; they do not authorize URLs.
 */

const MAX_SUBTITLE_ROUTE_ID_BYTES = 256;

const MAX_ENCODED_ROUTE_ID_LENGTH = MAX_SUBTITLE_ROUTE_ID_BYTES * 3;
const DISNEY_PLAYER_PATH_PATTERN = /\/(?:video|play)\/([^/]+)\/?$/u;
const NETFLIX_PLAYER_PATH_PATTERN = /^\/watch\/(\d+)\/?$/u;
const RESIDUAL_PERCENT_ESCAPE_PATTERN = /%[0-9A-Fa-f]{2}/u;

export function readCustomEventDetail(event) {
    if (event === null || typeof event !== 'object') return undefined;
    try {
        return event.detail;
    } catch (_) {
        return undefined;
    }
}

export function readOwnDataProperty(value, property) {
    if (value === null || typeof value !== 'object') return undefined;
    try {
        return Object.hasOwn(value, property) ? value[property] : undefined;
    } catch (_) {
        return undefined;
    }
}

export function readOwnPrimitiveDataProperty(value, property) {
    const propertyValue = readOwnDataProperty(value, property);
    if (propertyValue === null) return null;
    return ['string', 'number', 'boolean'].includes(typeof propertyValue)
        ? propertyValue
        : undefined;
}

function isWithinRouteIdLimit(value) {
    if (value.length > MAX_SUBTITLE_ROUTE_ID_BYTES) return false;

    let byteLength = 0;
    for (const character of value) {
        const codePoint = character.codePointAt(0);
        if (codePoint <= 0x7f) byteLength += 1;
        else if (codePoint <= 0x7ff) byteLength += 2;
        else if (codePoint <= 0xffff) byteLength += 3;
        else byteLength += 4;
        if (byteLength > MAX_SUBTITLE_ROUTE_ID_BYTES) return false;
    }
    return true;
}

function hasDisallowedDisneyIdCharacter(value) {
    for (const character of value) {
        const codePoint = character.codePointAt(0);
        if (
            character === '/' ||
            character === '\\' ||
            codePoint <= 0x1f ||
            (codePoint >= 0x7f && codePoint <= 0x9f) ||
            (codePoint >= 0xd800 && codePoint <= 0xdfff)
        ) {
            return true;
        }
    }
    return false;
}

export function normalizeDisneyPlusVideoId(value) {
    if (
        typeof value !== 'string' ||
        value.length === 0 ||
        value.length > MAX_ENCODED_ROUTE_ID_LENGTH
    ) {
        return null;
    }

    let decodedValue;
    try {
        decodedValue = decodeURIComponent(value);
    } catch (_) {
        return null;
    }

    if (
        decodedValue.trim().length === 0 ||
        decodedValue.startsWith('unknown_video_') ||
        RESIDUAL_PERCENT_ESCAPE_PATTERN.test(decodedValue) ||
        hasDisallowedDisneyIdCharacter(decodedValue) ||
        !isWithinRouteIdLimit(decodedValue)
    ) {
        return null;
    }

    return decodedValue;
}

export function extractDisneyPlusVideoIdFromPathname(pathname) {
    if (typeof pathname !== 'string' || !pathname.startsWith('/')) return null;
    const routeMatch = DISNEY_PLAYER_PATH_PATTERN.exec(pathname);
    return routeMatch ? normalizeDisneyPlusVideoId(routeMatch[1]) : null;
}

export function extractDisneyPlusVideoIdFromUrl(url) {
    if (typeof url !== 'string') return null;
    try {
        return extractDisneyPlusVideoIdFromPathname(new URL(url).pathname);
    } catch (_) {
        return null;
    }
}

export function normalizeNetflixVideoId(value) {
    const normalizedValue =
        typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
            ? String(value)
            : value;

    return typeof normalizedValue === 'string' &&
        normalizedValue.length > 0 &&
        normalizedValue.length <= MAX_SUBTITLE_ROUTE_ID_BYTES &&
        /^\d+$/u.test(normalizedValue)
        ? normalizedValue
        : null;
}

export function extractNetflixVideoIdFromPathname(pathname) {
    if (
        typeof pathname !== 'string' ||
        pathname.length > '/watch/'.length + MAX_SUBTITLE_ROUTE_ID_BYTES + 1
    ) {
        return null;
    }
    const routeMatch = NETFLIX_PLAYER_PATH_PATTERN.exec(pathname);
    return routeMatch ? normalizeNetflixVideoId(routeMatch[1]) : null;
}

export function extractNetflixVideoIdFromUrl(url) {
    if (typeof url !== 'string') return null;
    try {
        return extractNetflixVideoIdFromPathname(new URL(url).pathname);
    } catch (_) {
        return null;
    }
}
