import {
    MessageActions,
    SubtitleRequestSources,
} from '../../content_scripts/shared/constants/messageActions.js';
import {
    extractDisneyPlusVideoIdFromPathname,
    extractNetflixVideoIdFromPathname,
} from '../../content_scripts/shared/subtitleRequestIdentity.js';

const POLICY_ERROR_MESSAGE = 'Subtitle request rejected by policy.';
const UNKNOWN_POLICY_VALUE = 'unknown';
const POLICY_STAGE_PATTERN = /^[a-z][a-z0-9-]{0,63}$/u;
const MAX_URL_LENGTH = 16 * 1024;
const MAX_LANGUAGE_LENGTH = 64;
const MAX_FORMAT_OR_TRACK_TYPE_LENGTH = 64;
const MAX_DISPLAY_NAME_LENGTH = 256;
const MAX_NETFLIX_TRACKS = 128;
const MAX_NETFLIX_FORMATS_PER_TRACK = 16;
const MAX_NETFLIX_URLS_PER_FORMAT = 8;

const SUBTITLE_CDN_BASES = Object.freeze({
    [SubtitleRequestSources.DISNEY_PLUS]: 'media.dssott.com',
    [SubtitleRequestSources.NETFLIX]: 'nflxvideo.net',
});
const DISNEY_EDGE_CDN_BASE = 'dssedge.com';
const SUBTITLE_PAGE_BASES = Object.freeze({
    [SubtitleRequestSources.DISNEY_PLUS]: 'disneyplus.com',
    [SubtitleRequestSources.NETFLIX]: 'netflix.com',
});

function rejectInput() {
    throw new TypeError(POLICY_ERROR_MESSAGE);
}

function normalizePlatform(platform) {
    return platform === SubtitleRequestSources.DISNEY_PLUS ||
        platform === SubtitleRequestSources.NETFLIX
        ? platform
        : UNKNOWN_POLICY_VALUE;
}

function normalizeStage(stage) {
    return typeof stage === 'string' && POLICY_STAGE_PATTERN.test(stage)
        ? stage
        : UNKNOWN_POLICY_VALUE;
}

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isBoundedNonemptyString(value, maxLength) {
    return (
        typeof value === 'string' &&
        value.length <= maxLength &&
        value.trim().length > 0
    );
}

function isHostnameAtOrBelow(hostname, baseHostname) {
    const normalizedHostname = hostname.toLowerCase();
    return (
        normalizedHostname === baseHostname ||
        normalizedHostname.endsWith(`.${baseHostname}`)
    );
}

function isAllowedSubtitleCdnHostname(hostname, platform, allowDisneyEdge) {
    const baseHostname = SUBTITLE_CDN_BASES[platform];
    return Boolean(
        (baseHostname && isHostnameAtOrBelow(hostname, baseHostname)) ||
        (allowDisneyEdge &&
            platform === SubtitleRequestSources.DISNEY_PLUS &&
            isHostnameAtOrBelow(hostname, DISNEY_EDGE_CDN_BASE))
    );
}

function parseSecurePlatformPageUrl(rawUrl, platform) {
    if (typeof rawUrl !== 'string' || rawUrl.length > MAX_URL_LENGTH) {
        return null;
    }

    let parsedUrl;
    try {
        parsedUrl = new URL(rawUrl);
    } catch (_) {
        return null;
    }

    const baseHostname = SUBTITLE_PAGE_BASES[platform];
    if (
        !baseHostname ||
        parsedUrl.href.length > MAX_URL_LENGTH ||
        parsedUrl.protocol !== 'https:' ||
        parsedUrl.username !== '' ||
        parsedUrl.password !== '' ||
        parsedUrl.port !== '' ||
        !isHostnameAtOrBelow(parsedUrl.hostname, baseHostname)
    ) {
        return null;
    }

    return parsedUrl;
}

function validateSender(sender, platform) {
    if (!isRecord(sender) || !isRecord(sender.tab)) rejectInput();

    const trustedExtensionId = globalThis.chrome?.runtime?.id;
    if (
        typeof trustedExtensionId !== 'string' ||
        trustedExtensionId.length === 0 ||
        sender.id !== trustedExtensionId ||
        !Number.isSafeInteger(sender.tab.id) ||
        sender.tab.id < 0 ||
        sender.frameId !== 0
    ) {
        rejectInput();
    }

    const senderUrl = parseSecurePlatformPageUrl(sender.url, platform);
    const tabUrl = parseSecurePlatformPageUrl(sender.tab.url, platform);
    if (!senderUrl || !tabUrl || senderUrl.origin !== tabUrl.origin) {
        rejectInput();
    }

    if (
        sender.origin !== undefined &&
        (sender.origin !== senderUrl.origin || sender.origin !== tabUrl.origin)
    ) {
        rejectInput();
    }

    return { tabId: sender.tab.id, tabUrl };
}

class SubtitleRequestPolicyError extends Error {
    constructor(code, platform = UNKNOWN_POLICY_VALUE, stage = 'request') {
        super(POLICY_ERROR_MESSAGE);
        this.name = 'SubtitleRequestPolicyError';
        this.code = code;
        this.platform = normalizePlatform(platform);
        this.stage = normalizeStage(stage);
    }
}

function canonicalizeAllowedSubtitleUrl(
    rawUrl,
    platform,
    stage,
    allowDisneyEdge = false
) {
    const normalizedPlatform = normalizePlatform(platform);
    if (typeof rawUrl !== 'string' || rawUrl.length > MAX_URL_LENGTH) {
        throw new SubtitleRequestPolicyError(
            'ERR_SUBTITLE_URL_INVALID',
            normalizedPlatform,
            stage
        );
    }

    let parsedUrl;
    try {
        parsedUrl = new URL(rawUrl);
    } catch (_) {
        throw new SubtitleRequestPolicyError(
            'ERR_SUBTITLE_URL_INVALID',
            normalizedPlatform,
            stage
        );
    }

    parsedUrl.hash = '';
    if (
        parsedUrl.href.length > MAX_URL_LENGTH ||
        parsedUrl.protocol !== 'https:' ||
        parsedUrl.username !== '' ||
        parsedUrl.password !== '' ||
        parsedUrl.port !== '' ||
        !isAllowedSubtitleCdnHostname(
            parsedUrl.hostname,
            normalizedPlatform,
            allowDisneyEdge
        )
    ) {
        throw new SubtitleRequestPolicyError(
            'ERR_SUBTITLE_URL_NOT_ALLOWED',
            normalizedPlatform,
            stage
        );
    }

    return parsedUrl.href;
}

function validateRequestHeader(message, source) {
    if (
        !isRecord(message) ||
        message.action !== MessageActions.FETCH_VTT ||
        message.source !== source
    ) {
        rejectInput();
    }
}

function validateLanguages(message) {
    if (
        !isBoundedNonemptyString(message.targetLanguage, MAX_LANGUAGE_LENGTH) ||
        !isBoundedNonemptyString(message.originalLanguage, MAX_LANGUAGE_LENGTH)
    ) {
        rejectInput();
    }

    return {
        originalLanguage: message.originalLanguage,
        targetLanguage: message.targetLanguage,
    };
}

function authorizeDisneyRequest(message, senderIdentity) {
    validateRequestHeader(message, SubtitleRequestSources.DISNEY_PLUS);

    const routeVideoId = extractDisneyPlusVideoIdFromPathname(
        senderIdentity.tabUrl.pathname
    );
    if (
        typeof message.videoId !== 'string' ||
        !routeVideoId ||
        message.videoId !== routeVideoId
    ) {
        rejectInput();
    }

    const languages = validateLanguages(message);
    return Object.freeze({
        action: MessageActions.FETCH_VTT,
        source: SubtitleRequestSources.DISNEY_PLUS,
        tabId: senderIdentity.tabId,
        videoId: routeVideoId,
        url: canonicalizeAllowedSubtitleUrl(
            message.url,
            SubtitleRequestSources.DISNEY_PLUS,
            'request'
        ),
        ...languages,
    });
}

function getNetflixDownloadables(track) {
    if (isRecord(track.ttDownloadables)) return track.ttDownloadables;
    return isRecord(track.rawTrack) && isRecord(track.rawTrack.ttDownloadables)
        ? track.rawTrack.ttDownloadables
        : null;
}

function readNetflixUrlCandidate(entry) {
    if (typeof entry === 'string') return entry || null;
    return isRecord(entry) && typeof entry.url === 'string'
        ? entry.url || null
        : null;
}

function selectNetflixDownload(downloadables) {
    if (!downloadables) return null;

    const formats = Object.entries(downloadables);
    if (formats.length > MAX_NETFLIX_FORMATS_PER_TRACK) rejectInput();

    for (const [format, formatData] of formats) {
        if (
            !isBoundedNonemptyString(format, MAX_FORMAT_OR_TRACK_TYPE_LENGTH) ||
            !isRecord(formatData)
        ) {
            rejectInput();
        }

        const { urls, downloadUrls } = formatData;
        if (
            (urls !== undefined &&
                (!Array.isArray(urls) ||
                    urls.length > MAX_NETFLIX_URLS_PER_FORMAT)) ||
            (downloadUrls !== undefined &&
                (!Array.isArray(downloadUrls) ||
                    downloadUrls.length > MAX_NETFLIX_URLS_PER_FORMAT))
        ) {
            rejectInput();
        }

        const candidates = urls?.length ? urls : downloadUrls;
        if (!candidates?.length) continue;

        const rawUrl = readNetflixUrlCandidate(candidates[0]);
        if (!rawUrl) continue;

        return {
            format,
            url: canonicalizeAllowedSubtitleUrl(
                rawUrl,
                SubtitleRequestSources.NETFLIX,
                'request'
            ),
        };
    }

    return null;
}

function sanitizeNetflixTrack(track) {
    if (!isRecord(track)) rejectInput();
    if (
        (track.isNoneTrack !== undefined &&
            typeof track.isNoneTrack !== 'boolean') ||
        (track.isForcedNarrative !== undefined &&
            typeof track.isForcedNarrative !== 'boolean')
    ) {
        rejectInput();
    }
    if (track.isNoneTrack || track.isForcedNarrative) return null;

    if (
        !isBoundedNonemptyString(track.language, MAX_LANGUAGE_LENGTH) ||
        (track.displayName !== undefined &&
            !isBoundedNonemptyString(
                track.displayName,
                MAX_DISPLAY_NAME_LENGTH
            )) ||
        (track.trackType !== undefined &&
            !isBoundedNonemptyString(
                track.trackType,
                MAX_FORMAT_OR_TRACK_TYPE_LENGTH
            ))
    ) {
        rejectInput();
    }

    const selectedDownload = selectNetflixDownload(
        getNetflixDownloadables(track)
    );
    if (!selectedDownload) return null;

    const urls = Object.freeze([selectedDownload.url]);
    const formatData = Object.freeze({ urls });
    const ttDownloadables = Object.create(null);
    ttDownloadables[selectedDownload.format] = formatData;
    Object.freeze(ttDownloadables);

    const canonicalTrack = {
        language: track.language,
        displayName: track.displayName ?? track.language,
    };
    if (track.trackType !== undefined) {
        canonicalTrack.trackType = track.trackType;
    }
    canonicalTrack.isNoneTrack = false;
    canonicalTrack.isForcedNarrative = false;
    canonicalTrack.ttDownloadables = ttDownloadables;
    return Object.freeze(canonicalTrack);
}

function authorizeNetflixRequest(message, senderIdentity) {
    validateRequestHeader(message, SubtitleRequestSources.NETFLIX);

    const routeVideoId = extractNetflixVideoIdFromPathname(
        senderIdentity.tabUrl.pathname
    );
    if (
        typeof message.videoId !== 'string' ||
        !routeVideoId ||
        message.videoId !== routeVideoId ||
        typeof message.useNativeSubtitles !== 'boolean' ||
        typeof message.useOfficialTranslations !== 'boolean' ||
        !isRecord(message.data) ||
        !Array.isArray(message.data.tracks) ||
        message.data.tracks.length === 0 ||
        message.data.tracks.length > MAX_NETFLIX_TRACKS
    ) {
        rejectInput();
    }

    const languages = validateLanguages(message);
    const tracks = message.data.tracks
        .map(sanitizeNetflixTrack)
        .filter(Boolean);
    if (tracks.length === 0) rejectInput();

    return Object.freeze({
        action: MessageActions.FETCH_VTT,
        source: SubtitleRequestSources.NETFLIX,
        tabId: senderIdentity.tabId,
        videoId: routeVideoId,
        ...languages,
        useNativeSubtitles: message.useNativeSubtitles,
        useOfficialTranslations: message.useOfficialTranslations,
        data: Object.freeze({ tracks: Object.freeze(tracks) }),
    });
}

export function isAuthorizedSubtitleRequestSnapshot(value) {
    try {
        return Boolean(
            isRecord(value) &&
            Object.isFrozen(value) &&
            value.action === MessageActions.FETCH_VTT &&
            (value.source === SubtitleRequestSources.DISNEY_PLUS ||
                value.source === SubtitleRequestSources.NETFLIX)
        );
    } catch (_) {
        return false;
    }
}

function requireAuthorizedSnapshot(snapshot) {
    if (!isAuthorizedSubtitleRequestSnapshot(snapshot)) {
        throw new SubtitleRequestPolicyError(
            'ERR_SUBTITLE_REQUEST_UNAUTHORIZED',
            UNKNOWN_POLICY_VALUE,
            'request'
        );
    }
    return snapshot.source;
}

export function assertAllowedSubtitleUrl(snapshot, rawUrl, stage) {
    const platform = requireAuthorizedSnapshot(snapshot);
    return canonicalizeAllowedSubtitleUrl(rawUrl, platform, stage, true);
}

export function resolveAllowedSubtitleUrl(snapshot, reference, baseUrl, stage) {
    const platform = requireAuthorizedSnapshot(snapshot);
    if (typeof reference !== 'string' || reference.length > MAX_URL_LENGTH) {
        throw new SubtitleRequestPolicyError(
            'ERR_SUBTITLE_URL_INVALID',
            platform,
            stage
        );
    }

    let resolvedUrl;
    try {
        resolvedUrl = new URL(reference, baseUrl).href;
    } catch (_) {
        throw new SubtitleRequestPolicyError(
            'ERR_SUBTITLE_URL_INVALID',
            platform,
            stage
        );
    }
    return canonicalizeAllowedSubtitleUrl(resolvedUrl, platform, stage, true);
}

export function getDisneySubtitleCdnCounterpartUrl(
    snapshot,
    canonicalUrl,
    stage
) {
    const platform = requireAuthorizedSnapshot(snapshot);
    if (platform !== SubtitleRequestSources.DISNEY_PLUS) return null;

    const url = new URL(
        canonicalizeAllowedSubtitleUrl(canonicalUrl, platform, stage, true)
    );
    const primaryBase = SUBTITLE_CDN_BASES[platform];
    let sourceBase;
    let targetBase;

    if (isHostnameAtOrBelow(url.hostname, primaryBase)) {
        sourceBase = primaryBase;
        targetBase = DISNEY_EDGE_CDN_BASE;
    } else if (isHostnameAtOrBelow(url.hostname, DISNEY_EDGE_CDN_BASE)) {
        sourceBase = DISNEY_EDGE_CDN_BASE;
        targetBase = primaryBase;
    } else {
        return null;
    }

    const prefix = url.hostname.slice(0, -sourceBase.length);
    url.hostname = `${prefix}${targetBase}`;
    return canonicalizeAllowedSubtitleUrl(url.href, platform, stage, true);
}

/**
 * Validate one Chrome-serialized content-script request and return the detached,
 * immutable value used by background services.
 */
export function authorizeSubtitleRequest(message, sender) {
    let platform = UNKNOWN_POLICY_VALUE;
    try {
        if (!isRecord(message)) rejectInput();
        platform = normalizePlatform(message.source);
        const senderIdentity = validateSender(sender, platform);

        if (platform === SubtitleRequestSources.DISNEY_PLUS) {
            return authorizeDisneyRequest(message, senderIdentity);
        }
        if (platform === SubtitleRequestSources.NETFLIX) {
            return authorizeNetflixRequest(message, senderIdentity);
        }
    } catch (_) {
        // All ingress failures use one fixed error without attacker-controlled data.
    }

    throw new SubtitleRequestPolicyError(
        'ERR_SUBTITLE_REQUEST_UNAUTHORIZED',
        platform,
        'request'
    );
}
