import {
    assertAllowedSubtitleUrl,
    isAuthorizedSubtitleRequestSnapshot,
    resolveAllowedSubtitleUrl,
} from './subtitleRequestPolicy.js';
import {
    cancelResponseBodySafely,
    fetchWithTimeout,
    readResponseTextWithLimit,
} from '../../utils/fetchWithTimeout.js';
import { SubtitleRequestSources } from '../../content_scripts/shared/constants/messageActions.js';

const SUBTITLE_FETCH_OPTION_KEYS = new Set([
    'baseUrl',
    'stage',
    'signal',
    'maxBytes',
]);
const EMPTY_SUBTITLE_FETCH_OPTIONS = Object.freeze(Object.create(null));

class SubtitleFetchError extends Error {
    constructor(code) {
        super('Subtitle response rejected.');
        this.name = 'SubtitleFetchError';
        this.code = code;
    }
}

function assertValidByteLimit(maxBytes) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
        const error = new TypeError('Subtitle response byte limit is invalid.');
        error.code = 'ERR_SUBTITLE_FETCH_LIMIT_INVALID';
        throw error;
    }
}

function createInvalidOptionsError() {
    const error = new TypeError('Subtitle fetch options are invalid.');
    error.code = 'ERR_SUBTITLE_FETCH_OPTIONS_INVALID';
    return error;
}

function readSubtitleFetchOptions(options) {
    if (options === undefined) return EMPTY_SUBTITLE_FETCH_OPTIONS;
    if (options === null || typeof options !== 'object') {
        throw createInvalidOptionsError();
    }

    try {
        if (Array.isArray(options)) throw new Error();
        const prototype = Object.getPrototypeOf(options);
        if (prototype !== Object.prototype && prototype !== null) {
            throw new Error();
        }

        const normalizedOptions = Object.create(null);
        for (const key of Reflect.ownKeys(options)) {
            if (
                typeof key !== 'string' ||
                !SUBTITLE_FETCH_OPTION_KEYS.has(key)
            ) {
                throw new Error();
            }

            const descriptor = Object.getOwnPropertyDescriptor(options, key);
            if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
                throw new Error();
            }
            normalizedOptions[key] = descriptor.value;
        }
        return Object.freeze(normalizedOptions);
    } catch (_) {
        throw createInvalidOptionsError();
    }
}

function rejectResponse(response, code) {
    const error = new SubtitleFetchError(code);
    cancelResponseBodySafely(response, error);
    throw error;
}

function canonicalizeDisneyRedirectUrl(
    snapshot,
    response,
    requestedCanonicalUrl,
    stage
) {
    let finalCanonicalUrl;
    try {
        finalCanonicalUrl = assertAllowedSubtitleUrl(
            snapshot,
            response.url,
            stage
        );
    } catch (_) {
        rejectResponse(response, 'ERR_SUBTITLE_FETCH_FINAL_URL');
    }

    const requestedUrl = new URL(requestedCanonicalUrl);
    const finalUrl = new URL(finalCanonicalUrl);
    if (
        finalUrl.pathname !== requestedUrl.pathname ||
        finalUrl.search !== requestedUrl.search
    ) {
        rejectResponse(response, 'ERR_SUBTITLE_FETCH_FINAL_URL');
    }

    return finalCanonicalUrl;
}

export async function fetchAuthorizedSubtitleText(
    snapshot,
    reference,
    options
) {
    if (!isAuthorizedSubtitleRequestSnapshot(snapshot)) {
        // Reuse the policy boundary's privacy-safe authorization error without
        // inspecting the caller's reference or options.
        assertAllowedSubtitleUrl(snapshot, undefined, undefined);
    }

    const { baseUrl, stage, signal, maxBytes } =
        readSubtitleFetchOptions(options);
    assertValidByteLimit(maxBytes);
    const canonicalUrl =
        baseUrl === undefined
            ? assertAllowedSubtitleUrl(snapshot, reference, stage)
            : resolveAllowedSubtitleUrl(snapshot, reference, baseUrl, stage);
    const allowDisneyRedirects =
        snapshot.source === SubtitleRequestSources.DISNEY_PLUS;
    // Fetch exposes only the final redirect destination. Disney follows are
    // therefore post-validated against the trusted CDN pair and immutable
    // canonical path/query below; every other platform stays fail-closed.
    const response = await fetchWithTimeout(canonicalUrl, {
        method: 'GET',
        redirect: allowDisneyRedirects ? 'follow' : 'error',
        credentials: 'omit',
        signal,
    });
    let acceptedCanonicalUrl = canonicalUrl;
    if (response.redirected === true) {
        if (!allowDisneyRedirects) {
            rejectResponse(response, 'ERR_SUBTITLE_FETCH_REDIRECT');
        }
        acceptedCanonicalUrl = canonicalizeDisneyRedirectUrl(
            snapshot,
            response,
            canonicalUrl,
            stage
        );
    } else if (response.redirected !== false) {
        rejectResponse(response, 'ERR_SUBTITLE_FETCH_REDIRECT');
    } else if (response.url !== canonicalUrl) {
        rejectResponse(response, 'ERR_SUBTITLE_FETCH_FINAL_URL');
    }
    if (response.ok !== true) {
        rejectResponse(response, 'ERR_SUBTITLE_FETCH_HTTP');
    }
    const text = await readResponseTextWithLimit(response, maxBytes);
    return { text, canonicalUrl: acceptedCanonicalUrl };
}
