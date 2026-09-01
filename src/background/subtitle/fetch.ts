import {
    cancelResponseBodySafely,
    fetchWithTimeout,
    readResponseTextWithLimit,
} from '@/shared/fetchWithTimeout';
import {
    assertAllowedSubtitleUrl,
    isAuthorizedSubtitleRequestSnapshot,
    resolveAllowedSubtitleUrl,
    SubtitleRequestPolicyError,
} from './policy';

export class SubtitleFetchError extends Error {
    override readonly name = 'SubtitleFetchError';
    readonly code: string;

    constructor(code: string) {
        super('Subtitle response rejected.');
        this.code = code;
    }
}

export interface SubtitleFetchOptions {
    /** Resolve the reference against this allowed base (playlist entries). */
    baseUrl?: string;
    stage?: string;
    signal?: AbortSignal;
    maxBytes: number;
}

function rejectResponse(response: Response, code: string): never {
    const error = new SubtitleFetchError(code);
    cancelResponseBodySafely(response, error);
    throw error;
}

function canonicalizeDisneyRedirectUrl(
    snapshot: unknown,
    response: Response,
    requestedCanonicalUrl: string,
    stage: string
): string {
    let finalCanonicalUrl: string;
    try {
        finalCanonicalUrl = assertAllowedSubtitleUrl(
            snapshot,
            response.url,
            stage
        );
    } catch {
        rejectResponse(response, 'ERR_SUBTITLE_FETCH_FINAL_URL');
    }

    // A follow may only move between the trusted CDN pair; path and query
    // stay byte-identical so a redirect cannot swap the resource.
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

/**
 * Fetch subtitle text for an authorized request only: the URL is canonical
 * per policy, credentials are never sent, redirects are forbidden except
 * Disney's CDN-pair follow, the final URL is re-verified, and the body is
 * byte-capped.
 */
export async function fetchAuthorizedSubtitleText(
    snapshot: unknown,
    reference: string,
    options: SubtitleFetchOptions
): Promise<{ text: string; canonicalUrl: string }> {
    if (!isAuthorizedSubtitleRequestSnapshot(snapshot)) {
        throw new SubtitleRequestPolicyError(
            'ERR_SUBTITLE_REQUEST_UNAUTHORIZED'
        );
    }

    const { baseUrl, signal, maxBytes } = options;
    const stage = options.stage ?? 'request';
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
        throw new TypeError('Subtitle response byte limit is invalid.');
    }

    const canonicalUrl =
        baseUrl === undefined
            ? assertAllowedSubtitleUrl(snapshot, reference, stage)
            : resolveAllowedSubtitleUrl(snapshot, reference, baseUrl, stage);
    const allowDisneyRedirects = snapshot.source === 'disneyplus';

    const response = await fetchWithTimeout(canonicalUrl, {
        method: 'GET',
        redirect: allowDisneyRedirects ? 'follow' : 'error',
        credentials: 'omit',
        signal,
    });

    let acceptedCanonicalUrl = canonicalUrl;
    if (response.redirected) {
        if (!allowDisneyRedirects) {
            rejectResponse(response, 'ERR_SUBTITLE_FETCH_REDIRECT');
        }
        acceptedCanonicalUrl = canonicalizeDisneyRedirectUrl(
            snapshot,
            response,
            canonicalUrl,
            stage
        );
    } else if (response.url !== canonicalUrl) {
        rejectResponse(response, 'ERR_SUBTITLE_FETCH_FINAL_URL');
    }
    if (!response.ok) {
        rejectResponse(response, 'ERR_SUBTITLE_FETCH_HTTP');
    }

    const text = await readResponseTextWithLimit(response, maxBytes);
    return { text, canonicalUrl: acceptedCanonicalUrl };
}
