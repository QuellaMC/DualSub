// Canonical player-route identity. These helpers identify the current route;
// they do not authenticate page-provided metadata or authorize any URL.

export const MAX_SUBTITLE_ROUTE_ID_BYTES = 256;

const MAX_PERCENT_ENCODED_ROUTE_ID_CODE_UNITS = MAX_SUBTITLE_ROUTE_ID_BYTES * 3;
const DISNEY_PLAYER_PATH_PATTERN = /\/(?:video|play)\/([^/]+)\/?$/u;
const NETFLIX_PLAYER_PATH_PATTERN = /^\/watch\/(\d+)\/?$/u;
// A residual escape triplet proves another decode could change identity.
const RESIDUAL_ASCII_PERCENT_ESCAPE_PATTERN = /%[0-9A-Fa-f]{2}/u;

function isWithinUtf8ByteCap(value: string): boolean {
    if (value.length > MAX_SUBTITLE_ROUTE_ID_BYTES) {
        return false;
    }
    let byteLength = 0;
    for (let index = 0; index < value.length; index += 1) {
        const codePoint = value.codePointAt(index)!;
        if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
            return false;
        }
        if (codePoint <= 0x7f) byteLength += 1;
        else if (codePoint <= 0x7ff) byteLength += 2;
        else if (codePoint <= 0xffff) byteLength += 3;
        else {
            byteLength += 4;
            index += 1;
        }
        if (byteLength > MAX_SUBTITLE_ROUTE_ID_BYTES) {
            return false;
        }
    }
    return true;
}

function hasDisallowedDisneyRouteIdCharacter(value: string): boolean {
    for (const character of value) {
        const codePoint = character.codePointAt(0)!;
        if (
            character === '/' ||
            character === '\\' ||
            codePoint <= 0x1f ||
            (codePoint >= 0x7f && codePoint <= 0x9f)
        ) {
            return true;
        }
    }
    return false;
}

/** Normalize one Disney+ opaque route segment; percent decoding happens once. */
export function normalizeDisneyPlusVideoId(value: unknown): string | null {
    if (
        typeof value !== 'string' ||
        value.length === 0 ||
        value.length > MAX_PERCENT_ENCODED_ROUTE_ID_CODE_UNITS
    ) {
        return null;
    }

    let decodedValue: string;
    try {
        decodedValue = decodeURIComponent(value);
    } catch {
        return null;
    }

    if (
        decodedValue.trim().length === 0 ||
        decodedValue.startsWith('unknown_video_') ||
        RESIDUAL_ASCII_PERCENT_ESCAPE_PATTERN.test(decodedValue) ||
        hasDisallowedDisneyRouteIdCharacter(decodedValue) ||
        !isWithinUtf8ByteCap(decodedValue)
    ) {
        return null;
    }
    return decodedValue;
}

export function extractDisneyPlusVideoIdFromPathname(
    pathname: unknown
): string | null {
    if (typeof pathname !== 'string' || !pathname.startsWith('/')) {
        return null;
    }
    const routeEnd = pathname.endsWith('/')
        ? pathname.length - 1
        : pathname.length;
    const videoIdSeparator = pathname.lastIndexOf('/', routeEnd - 1);
    const videoIdCodeUnits = routeEnd - videoIdSeparator - 1;
    if (
        videoIdSeparator < 0 ||
        videoIdCodeUnits <= 0 ||
        videoIdCodeUnits > MAX_PERCENT_ENCODED_ROUTE_ID_CODE_UNITS
    ) {
        return null;
    }
    const routeMatch = DISNEY_PLAYER_PATH_PATTERN.exec(pathname);
    return routeMatch ? normalizeDisneyPlusVideoId(routeMatch[1]) : null;
}

export function extractDisneyPlusVideoIdFromUrl(url: unknown): string | null {
    if (typeof url !== 'string') {
        return null;
    }
    try {
        return extractDisneyPlusVideoIdFromPathname(new URL(url).pathname);
    } catch {
        return null;
    }
}

/** Normalize the numeric identifier emitted in Netflix subtitle metadata. */
export function normalizeNetflixVideoId(value: unknown): string | null {
    let normalizedValue: string;
    if (typeof value === 'number') {
        if (!Number.isSafeInteger(value) || value < 0) {
            return null;
        }
        normalizedValue = String(value);
    } else if (typeof value === 'string') {
        normalizedValue = value;
    } else {
        return null;
    }

    if (
        normalizedValue.length === 0 ||
        normalizedValue.length > MAX_SUBTITLE_ROUTE_ID_BYTES ||
        !/^\d+$/u.test(normalizedValue)
    ) {
        return null;
    }
    return normalizedValue;
}

export function extractNetflixVideoIdFromPathname(
    pathname: unknown
): string | null {
    if (
        typeof pathname !== 'string' ||
        pathname.length > '/watch/'.length + MAX_SUBTITLE_ROUTE_ID_BYTES + 1
    ) {
        return null;
    }
    const routeMatch = NETFLIX_PLAYER_PATH_PATTERN.exec(pathname);
    return routeMatch ? normalizeNetflixVideoId(routeMatch[1]) : null;
}

export function extractNetflixVideoIdFromUrl(url: unknown): string | null {
    if (typeof url !== 'string') {
        return null;
    }
    try {
        return extractNetflixVideoIdFromPathname(new URL(url).pathname);
    } catch {
        return null;
    }
}
