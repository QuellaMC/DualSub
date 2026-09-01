import {
    assertAllowedSubtitleUrl,
    getDisneySubtitleCdnCounterpartUrl,
    isAuthorizedSubtitleRequestSnapshot,
    resolveAllowedSubtitleUrl,
} from './subtitleRequestPolicy.js';
import {
    cancelResponseBodySafely,
    DEFAULT_FETCH_TIMEOUT_MS,
    fetchWithTimeout,
    readResponseTextWithLimit,
} from '../../utils/fetchWithTimeout.js';
import { SubtitleRequestSources } from '../../content_scripts/shared/constants/messageActions.js';

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

function rejectResponse(response, code) {
    const error = new SubtitleFetchError(code);
    cancelResponseBodySafely(response, error);
    throw error;
}

export async function fetchAuthorizedSubtitleText(
    snapshot,
    reference,
    { baseUrl, stage, signal, maxBytes } = {}
) {
    if (!isAuthorizedSubtitleRequestSnapshot(snapshot)) {
        assertAllowedSubtitleUrl(snapshot, undefined, undefined);
    }

    assertValidByteLimit(maxBytes);
    const canonicalUrl =
        baseUrl === undefined
            ? assertAllowedSubtitleUrl(snapshot, reference, stage)
            : resolveAllowedSubtitleUrl(snapshot, reference, baseUrl, stage);
    const isDisneyRequest =
        snapshot.source === SubtitleRequestSources.DISNEY_PLUS;
    const candidateUrls = [canonicalUrl];
    if (isDisneyRequest) {
        const counterpartUrl = getDisneySubtitleCdnCounterpartUrl(
            snapshot,
            canonicalUrl,
            stage
        );
        if (counterpartUrl && counterpartUrl !== canonicalUrl) {
            candidateUrls.push(counterpartUrl);
        }
    }

    const deadline = Date.now() + DEFAULT_FETCH_TIMEOUT_MS;
    let acceptedCanonicalUrl = canonicalUrl;
    let response;

    for (let index = 0; index < candidateUrls.length; index += 1) {
        acceptedCanonicalUrl = candidateUrls[index];
        try {
            response = await fetchWithTimeout(
                acceptedCanonicalUrl,
                {
                    method: 'GET',
                    redirect: 'error',
                    credentials: 'omit',
                    signal,
                },
                Math.max(1, deadline - Date.now())
            );
            break;
        } catch (error) {
            const canTryCounterpart =
                error?.code === 'ERR_FETCH_FAILED' &&
                index + 1 < candidateUrls.length;
            if (!canTryCounterpart) throw error;
        }
    }

    if (response.redirected !== false) {
        rejectResponse(response, 'ERR_SUBTITLE_FETCH_REDIRECT');
    } else if (response.url !== acceptedCanonicalUrl) {
        rejectResponse(response, 'ERR_SUBTITLE_FETCH_FINAL_URL');
    }
    if (response.ok !== true) {
        rejectResponse(response, 'ERR_SUBTITLE_FETCH_HTTP');
    }
    const text = await readResponseTextWithLimit(response, maxBytes);
    return { text, canonicalUrl: acceptedCanonicalUrl };
}
