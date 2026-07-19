/**
 * Canonical route identity helpers for subtitle requests.
 *
 * These helpers identify the current player route. They do not authenticate
 * page-provided subtitle metadata or authorize any subtitle URL.
 */

export const MAX_SUBTITLE_ROUTE_ID_BYTES = 256;

const MAX_PERCENT_ENCODED_ROUTE_ID_CODE_UNITS = MAX_SUBTITLE_ROUTE_ID_BYTES * 3;
const DISNEY_PLAYER_PATH_PATTERN = /\/(?:video|play)\/([^/]+)\/?$/u;
const NETFLIX_PLAYER_PATH_PATTERN = /^\/watch\/(\d+)\/?$/u;
const RESIDUAL_ASCII_PERCENT_ESCAPE_PATTERN = /%[0-9A-Fa-f]{2}/u;
const nativeCustomEventDetailGetter =
    typeof globalThis.CustomEvent === 'function'
        ? Object.getOwnPropertyDescriptor(
              globalThis.CustomEvent.prototype,
              'detail'
          )?.get
        : null;

/**
 * Read CustomEvent.detail through an own data property used by tests/internal
 * replay events, or through the captured native Web IDL getter. An attacker
 * supplied own accessor is never invoked.
 *
 * @param {*} event Native CustomEvent or an internal event-shaped object.
 * @returns {*} Event detail, or undefined when it cannot be read safely.
 */
export function readCustomEventDetail(event) {
    if (
        event === null ||
        (typeof event !== 'object' && typeof event !== 'function')
    ) {
        return undefined;
    }

    try {
        const descriptor = Object.getOwnPropertyDescriptor(event, 'detail');
        if (descriptor) {
            return Object.hasOwn(descriptor, 'value')
                ? descriptor.value
                : undefined;
        }
    } catch (_) {
        return undefined;
    }

    if (typeof nativeCustomEventDetailGetter !== 'function') return undefined;

    try {
        return nativeCustomEventDetailGetter.call(event);
    } catch (_) {
        return undefined;
    }
}

/**
 * Read an own data property without invoking a getter.
 *
 * @param {*} value Value supplied across an untrusted page event boundary.
 * @param {PropertyKey} property Property to inspect.
 * @returns {*} The data-property value, or undefined when it is absent/unsafe.
 */
export function readOwnDataProperty(value, property) {
    if (
        value === null ||
        (typeof value !== 'object' && typeof value !== 'function')
    ) {
        return undefined;
    }

    try {
        const descriptor = Object.getOwnPropertyDescriptor(value, property);
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
            return undefined;
        }
        return descriptor.value;
    } catch (_) {
        return undefined;
    }
}

/**
 * Read only a primitive own data property from an untrusted event object.
 *
 * @param {*} value Value supplied across an untrusted page event boundary.
 * @param {PropertyKey} property Property to inspect.
 * @returns {string|number|boolean|null|undefined} Primitive value or undefined.
 */
export function readOwnPrimitiveDataProperty(value, property) {
    const propertyValue = readOwnDataProperty(value, property);
    if (propertyValue === null) return null;

    return ['string', 'number', 'boolean'].includes(typeof propertyValue)
        ? propertyValue
        : undefined;
}

function isWithinUtf8ByteCap(value) {
    // Every UTF-16 code unit contributes at least one UTF-8 byte. This avoids
    // scanning the value when it is already certainly large.
    if (value.length > MAX_SUBTITLE_ROUTE_ID_BYTES) return false;

    let byteLength = 0;
    for (let index = 0; index < value.length; index += 1) {
        const codePoint = value.codePointAt(index);
        if (codePoint >= 0xd800 && codePoint <= 0xdfff) return false;

        if (codePoint <= 0x7f) byteLength += 1;
        else if (codePoint <= 0x7ff) byteLength += 2;
        else if (codePoint <= 0xffff) byteLength += 3;
        else {
            byteLength += 4;
            index += 1;
        }

        if (byteLength > MAX_SUBTITLE_ROUTE_ID_BYTES) return false;
    }

    return true;
}

function hasDisallowedDisneyRouteIdCharacter(value) {
    for (const character of value) {
        const codePoint = character.codePointAt(0);
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

/**
 * Normalize one Disney+ opaque route segment. Percent decoding happens once.
 *
 * @param {*} value Untrusted route/event identifier.
 * @returns {string|null} Canonical route identifier, or null when invalid.
 */
export function normalizeDisneyPlusVideoId(value) {
    if (
        typeof value !== 'string' ||
        value.length === 0 ||
        value.length > MAX_PERCENT_ENCODED_ROUTE_ID_CODE_UNITS
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
        decodedValue.length === 0 ||
        decodedValue.trim().length === 0 ||
        decodedValue.startsWith('unknown_video_') ||
        // A residual escape triplet proves another decode could change identity.
        RESIDUAL_ASCII_PERCENT_ESCAPE_PATTERN.test(decodedValue) ||
        hasDisallowedDisneyRouteIdCharacter(decodedValue) ||
        !isWithinUtf8ByteCap(decodedValue)
    ) {
        return null;
    }

    return decodedValue;
}

/**
 * Extract a canonical Disney+ player identity from a pathname.
 *
 * @param {*} pathname URL pathname, without query/hash components.
 * @returns {string|null} Canonical route identifier or null.
 */
export function extractDisneyPlusVideoIdFromPathname(pathname) {
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

/**
 * Parse a URL and extract its canonical Disney+ player identity.
 *
 * @param {*} url Absolute URL string.
 * @returns {string|null} Canonical route identifier or null.
 */
export function extractDisneyPlusVideoIdFromUrl(url) {
    if (typeof url !== 'string') return null;

    try {
        return extractDisneyPlusVideoIdFromPathname(new URL(url).pathname);
    } catch (_) {
        return null;
    }
}

/**
 * Normalize the numeric identifier emitted in Netflix subtitle metadata.
 *
 * @param {*} value Untrusted route/event identifier.
 * @returns {string|null} Canonical numeric identifier or null.
 */
export function normalizeNetflixVideoId(value) {
    let normalizedValue;
    if (typeof value === 'number') {
        if (!Number.isSafeInteger(value) || value < 0) return null;
        normalizedValue = String(value);
    } else if (typeof value === 'string') {
        normalizedValue = value;
    } else {
        return null;
    }

    if (
        normalizedValue.length === 0 ||
        normalizedValue.length > MAX_SUBTITLE_ROUTE_ID_BYTES ||
        !/^\d+$/u.test(normalizedValue) ||
        !isWithinUtf8ByteCap(normalizedValue)
    ) {
        return null;
    }

    return normalizedValue;
}

/**
 * Extract a canonical Netflix player identity from an exact watch pathname.
 *
 * @param {*} pathname URL pathname, without query/hash components.
 * @returns {string|null} Canonical numeric identifier or null.
 */
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

/**
 * Parse a URL and extract its canonical Netflix player identity.
 *
 * @param {*} url Absolute URL string.
 * @returns {string|null} Canonical numeric identifier or null.
 */
export function extractNetflixVideoIdFromUrl(url) {
    if (typeof url !== 'string') return null;

    try {
        return extractNetflixVideoIdFromPathname(new URL(url).pathname);
    } catch (_) {
        return null;
    }
}
