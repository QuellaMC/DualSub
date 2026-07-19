import {
    MessageActions,
    SubtitleRequestSources,
} from '../../content_scripts/shared/constants/messageActions.js';
import {
    extractDisneyPlusVideoIdFromUrl,
    extractNetflixVideoIdFromUrl,
} from '../../content_scripts/shared/subtitleRequestIdentity.js';

const POLICY_ERROR_MESSAGE = 'Subtitle request rejected by policy.';
const UNKNOWN_POLICY_VALUE = 'unknown';
const POLICY_STAGE_PATTERN = /^[a-z][a-z0-9-]{0,63}$/u;
const MAX_URL_BYTES = 16 * 1024;
const MAX_LANGUAGE_BYTES = 64;
const MAX_FORMAT_OR_TRACK_TYPE_BYTES = 64;
const MAX_DISPLAY_NAME_BYTES = 256;
const MAX_NETFLIX_TRACKS = 128;
const MAX_NETFLIX_FORMATS_PER_TRACK = 16;
const MAX_NETFLIX_URL_ENTRIES_PER_FORMAT = 8;
// The canonical union retains exactly one URL per track, so the independent
// limits derive an absolute 128 * 16 KiB = 2 MiB snapshot URL ceiling.
const DANGEROUS_RECORD_KEYS = new Set([
    '__proto__',
    'prototype',
    'constructor',
]);
const SUBTITLE_CDN_BASES = Object.freeze({
    [SubtitleRequestSources.DISNEY_PLUS]: 'media.dssott.com',
    [SubtitleRequestSources.NETFLIX]: 'nflxvideo.net',
});
const DISNEY_EDGE_CDN_BASE = 'dssedge.com';
const SUBTITLE_PAGE_BASES = Object.freeze({
    [SubtitleRequestSources.DISNEY_PLUS]: 'disneyplus.com',
    [SubtitleRequestSources.NETFLIX]: 'netflix.com',
});
const DISNEY_MESSAGE_KEYS = new Set([
    'action',
    'source',
    'url',
    'videoId',
    'targetLanguage',
    'originalLanguage',
]);
const NETFLIX_MESSAGE_KEYS = new Set([
    'action',
    'source',
    'data',
    'videoId',
    'targetLanguage',
    'originalLanguage',
    'useNativeSubtitles',
    'useOfficialTranslations',
]);
const NETFLIX_DATA_KEYS = new Set(['tracks']);
const ABSENT = Symbol('absent');
const INVALID_POLICY_INPUT = Object.freeze({});
const authorizedSubtitleRequestSnapshots = new WeakSet();

function rejectInput() {
    throw INVALID_POLICY_INPUT;
}

function normalizePlatform(platform) {
    if (
        platform === SubtitleRequestSources.DISNEY_PLUS ||
        platform === SubtitleRequestSources.NETFLIX
    ) {
        return platform;
    }
    return UNKNOWN_POLICY_VALUE;
}

function normalizeStage(stage) {
    return typeof stage === 'string' && POLICY_STAGE_PATTERN.test(stage)
        ? stage
        : UNKNOWN_POLICY_VALUE;
}

function utf8ByteLengthWithinCap(value, cap) {
    if (typeof value !== 'string' || value.length > cap) return null;

    let byteLength = 0;
    for (let index = 0; index < value.length; index += 1) {
        const codePoint = value.codePointAt(index);
        if (codePoint >= 0xd800 && codePoint <= 0xdfff) return null;

        if (codePoint <= 0x7f) byteLength += 1;
        else if (codePoint <= 0x7ff) byteLength += 2;
        else if (codePoint <= 0xffff) byteLength += 3;
        else {
            byteLength += 4;
            index += 1;
        }

        if (byteLength > cap) return null;
    }

    return byteLength;
}

function isBoundedNonemptyString(value, maxBytes) {
    return (
        typeof value === 'string' &&
        value.trim().length > 0 &&
        utf8ByteLengthWithinCap(value, maxBytes) !== null
    );
}

function inspectSafeRecord(value, allowedKeys = null) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        rejectInput();
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) rejectInput();

    // A behaviorally transparent Proxy is indistinguishable from its target
    // in JavaScript. Reflection failures reject; successful data descriptors
    // are copied once, and no raw record identity crosses this boundary.
    for (const key of Reflect.ownKeys(value)) {
        if (
            typeof key !== 'string' ||
            DANGEROUS_RECORD_KEYS.has(key) ||
            (allowedKeys && !allowedKeys.has(key))
        ) {
            rejectInput();
        }

        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) rejectInput();
    }

    return value;
}

function inspectDenseArray(value, maxLength) {
    if (
        !Array.isArray(value) ||
        Object.getPrototypeOf(value) !== Array.prototype
    ) {
        rejectInput();
    }

    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    if (
        !lengthDescriptor ||
        !Object.hasOwn(lengthDescriptor, 'value') ||
        !Number.isSafeInteger(lengthDescriptor.value) ||
        lengthDescriptor.value < 0 ||
        lengthDescriptor.value > maxLength
    ) {
        rejectInput();
    }

    const length = lengthDescriptor.value;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== length + 1) rejectInput();

    for (const key of keys) {
        if (key === 'length') continue;
        if (typeof key !== 'string' || DANGEROUS_RECORD_KEYS.has(key)) {
            rejectInput();
        }

        const index = Number(key);
        if (
            !Number.isSafeInteger(index) ||
            index < 0 ||
            index >= length ||
            String(index) !== key
        ) {
            rejectInput();
        }

        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) rejectInput();
    }

    return length;
}

function readOwnDataValue(record, key, required = true) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor) {
        if (required) rejectInput();
        return ABSENT;
    }
    if (!Object.hasOwn(descriptor, 'value')) rejectInput();
    return descriptor.value;
}

function readRequiredBoundedString(record, key, maxBytes) {
    const value = readOwnDataValue(record, key);
    if (!isBoundedNonemptyString(value, maxBytes)) rejectInput();
    return value;
}

function readOptionalBoundedString(record, key, maxBytes, fallback = ABSENT) {
    const value = readOwnDataValue(record, key, false);
    if (value === ABSENT) return fallback;
    if (!isBoundedNonemptyString(value, maxBytes)) rejectInput();
    return value;
}

function readRequiredBoolean(record, key) {
    const value = readOwnDataValue(record, key);
    if (typeof value !== 'boolean') rejectInput();
    return value;
}

function readOptionalBoolean(record, key) {
    const value = readOwnDataValue(record, key, false);
    if (value === ABSENT) return false;
    if (typeof value !== 'boolean') rejectInput();
    return value;
}

function enumerableOwnStringKeys(record) {
    const keys = [];
    for (const key of Reflect.ownKeys(record)) {
        if (typeof key !== 'string') rejectInput();
        const descriptor = Object.getOwnPropertyDescriptor(record, key);
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) rejectInput();
        if (descriptor.enumerable) keys.push(key);
    }
    return keys;
}

function parseSecurePlatformPageUrl(rawUrl, platform) {
    if (utf8ByteLengthWithinCap(rawUrl, MAX_URL_BYTES) === null) return null;

    let parsedUrl;
    try {
        parsedUrl = new URL(rawUrl);
    } catch (_) {
        return null;
    }

    const baseHostname = SUBTITLE_PAGE_BASES[platform];
    if (
        !baseHostname ||
        parsedUrl.protocol !== 'https:' ||
        parsedUrl.username !== '' ||
        parsedUrl.password !== '' ||
        parsedUrl.port !== '' ||
        !isHostnameAtOrBelow(parsedUrl.hostname, baseHostname) ||
        utf8ByteLengthWithinCap(parsedUrl.href, MAX_URL_BYTES) === null
    ) {
        return null;
    }

    return parsedUrl;
}

function readTrustedExtensionId() {
    const extensionId = globalThis.chrome?.runtime?.id;
    if (typeof extensionId !== 'string' || extensionId.length === 0) {
        rejectInput();
    }
    return extensionId;
}

function validateSender(sender, platform) {
    inspectSafeRecord(sender);
    const senderExtensionId = readOwnDataValue(sender, 'id');
    const tab = inspectSafeRecord(readOwnDataValue(sender, 'tab'));
    const tabId = readOwnDataValue(tab, 'id');
    const frameId = readOwnDataValue(sender, 'frameId');
    const senderUrlValue = readOwnDataValue(sender, 'url');
    const tabUrlValue = readOwnDataValue(tab, 'url');
    const origin = readOwnDataValue(sender, 'origin', false);

    if (
        typeof senderExtensionId !== 'string' ||
        senderExtensionId.length === 0 ||
        senderExtensionId !== readTrustedExtensionId() ||
        !Number.isSafeInteger(tabId) ||
        tabId < 0 ||
        typeof frameId !== 'number' ||
        frameId !== 0
    ) {
        rejectInput();
    }

    const senderUrl = parseSecurePlatformPageUrl(senderUrlValue, platform);
    const tabUrl = parseSecurePlatformPageUrl(tabUrlValue, platform);
    if (!senderUrl || !tabUrl || senderUrl.origin !== tabUrl.origin) {
        rejectInput();
    }

    if (
        origin !== ABSENT &&
        (typeof origin !== 'string' ||
            origin !== senderUrl.origin ||
            origin !== tabUrl.origin)
    ) {
        rejectInput();
    }

    return { tabId, senderUrl, tabUrl };
}

function deepFreeze(value) {
    for (const key of Reflect.ownKeys(value)) {
        const child = value[key];
        if (child !== null && typeof child === 'object') deepFreeze(child);
    }
    return Object.freeze(value);
}

function brandSnapshot(snapshot) {
    deepFreeze(snapshot);
    authorizedSubtitleRequestSnapshots.add(snapshot);
    return snapshot;
}

function authorizeDisneyRequest(message, senderIdentity) {
    inspectSafeRecord(message, DISNEY_MESSAGE_KEYS);
    if (
        readOwnDataValue(message, 'action') !== MessageActions.FETCH_VTT ||
        readOwnDataValue(message, 'source') !==
            SubtitleRequestSources.DISNEY_PLUS
    ) {
        rejectInput();
    }

    const messageVideoId = readOwnDataValue(message, 'videoId');
    const tabVideoId = extractDisneyPlusVideoIdFromUrl(
        senderIdentity.tabUrl.href
    );
    if (
        typeof messageVideoId !== 'string' ||
        messageVideoId.length === 0 ||
        !tabVideoId ||
        messageVideoId !== tabVideoId
    ) {
        rejectInput();
    }

    const url = canonicalizeAllowedSubtitleUrl(
        readOwnDataValue(message, 'url'),
        SubtitleRequestSources.DISNEY_PLUS,
        'request'
    );
    const targetLanguage = readRequiredBoundedString(
        message,
        'targetLanguage',
        MAX_LANGUAGE_BYTES
    );
    const originalLanguage = readRequiredBoundedString(
        message,
        'originalLanguage',
        MAX_LANGUAGE_BYTES
    );

    return brandSnapshot({
        action: MessageActions.FETCH_VTT,
        source: SubtitleRequestSources.DISNEY_PLUS,
        tabId: senderIdentity.tabId,
        videoId: messageVideoId,
        url,
        targetLanguage,
        originalLanguage,
    });
}

function readNetflixUrlCandidate(entry) {
    if (typeof entry === 'string') return entry.length > 0 ? entry : null;
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        return null;
    }

    inspectSafeRecord(entry);
    const url = readOwnDataValue(entry, 'url', false);
    return typeof url === 'string' && url.length > 0 ? url : null;
}

function selectNetflixDownloadables(track) {
    const direct = readOwnDataValue(track, 'ttDownloadables', false);
    if (
        direct !== ABSENT &&
        direct !== null &&
        typeof direct === 'object' &&
        !Array.isArray(direct)
    ) {
        return inspectSafeRecord(direct);
    }

    const rawTrack = readOwnDataValue(track, 'rawTrack', false);
    if (rawTrack === ABSENT || rawTrack === null) return null;
    if (typeof rawTrack !== 'object' || Array.isArray(rawTrack)) return null;

    inspectSafeRecord(rawTrack);
    const rawDownloadables = readOwnDataValue(
        rawTrack,
        'ttDownloadables',
        false
    );
    if (rawDownloadables === ABSENT || rawDownloadables === null) return null;
    return inspectSafeRecord(rawDownloadables);
}

function selectNetflixTrackDownload(downloadables) {
    if (!downloadables) return null;

    const formats = enumerableOwnStringKeys(downloadables);
    if (formats.length > MAX_NETFLIX_FORMATS_PER_TRACK) rejectInput();
    let selectedDownload = null;

    for (const format of formats) {
        if (!isBoundedNonemptyString(format, MAX_FORMAT_OR_TRACK_TYPE_BYTES)) {
            rejectInput();
        }

        const formatData = inspectSafeRecord(
            readOwnDataValue(downloadables, format)
        );
        const urls = readOwnDataValue(formatData, 'urls', false);
        const downloadUrls = readOwnDataValue(
            formatData,
            'downloadUrls',
            false
        );

        let urlsLength = null;
        if (urls !== ABSENT) {
            urlsLength = inspectDenseArray(
                urls,
                MAX_NETFLIX_URL_ENTRIES_PER_FORMAT
            );
        }
        let downloadUrlsLength = null;
        if (downloadUrls !== ABSENT) {
            downloadUrlsLength = inspectDenseArray(
                downloadUrls,
                MAX_NETFLIX_URL_ENTRIES_PER_FORMAT
            );
        }
        if (selectedDownload !== null) continue;

        let selectedList = null;
        if (urlsLength !== null && urlsLength > 0) selectedList = urls;
        else if (downloadUrlsLength !== null && downloadUrlsLength > 0) {
            selectedList = downloadUrls;
        }
        if (selectedList === null) continue;

        const rawUrl = readNetflixUrlCandidate(
            readOwnDataValue(selectedList, '0')
        );
        if (!rawUrl) continue;

        selectedDownload = {
            format,
            url: canonicalizeAllowedSubtitleUrl(
                rawUrl,
                SubtitleRequestSources.NETFLIX,
                'request'
            ),
        };
    }

    return selectedDownload;
}

function sanitizeNetflixTrack(track) {
    inspectSafeRecord(track);

    const isNoneTrack = readOptionalBoolean(track, 'isNoneTrack');
    const isForcedNarrative = readOptionalBoolean(track, 'isForcedNarrative');
    if (isNoneTrack || isForcedNarrative) return null;

    const language = readRequiredBoundedString(
        track,
        'language',
        MAX_LANGUAGE_BYTES
    );
    const displayName = readOptionalBoundedString(
        track,
        'displayName',
        MAX_DISPLAY_NAME_BYTES,
        language
    );
    const trackType = readOptionalBoundedString(
        track,
        'trackType',
        MAX_FORMAT_OR_TRACK_TYPE_BYTES
    );
    const selectedDownload = selectNetflixTrackDownload(
        selectNetflixDownloadables(track)
    );
    if (!selectedDownload) return null;

    const formatData = { urls: [selectedDownload.url] };
    const ttDownloadables = Object.create(null);
    Object.defineProperty(ttDownloadables, selectedDownload.format, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: formatData,
    });

    const sanitizedTrack = { language, displayName };
    if (trackType !== ABSENT) sanitizedTrack.trackType = trackType;
    sanitizedTrack.isNoneTrack = false;
    sanitizedTrack.isForcedNarrative = false;
    sanitizedTrack.ttDownloadables = ttDownloadables;
    return sanitizedTrack;
}

function authorizeNetflixRequest(message, senderIdentity) {
    inspectSafeRecord(message, NETFLIX_MESSAGE_KEYS);
    if (
        readOwnDataValue(message, 'action') !== MessageActions.FETCH_VTT ||
        readOwnDataValue(message, 'source') !== SubtitleRequestSources.NETFLIX
    ) {
        rejectInput();
    }

    const messageVideoId = readOwnDataValue(message, 'videoId');
    const tabVideoId = extractNetflixVideoIdFromUrl(senderIdentity.tabUrl.href);
    if (
        typeof messageVideoId !== 'string' ||
        !tabVideoId ||
        messageVideoId !== tabVideoId
    ) {
        rejectInput();
    }

    const targetLanguage = readRequiredBoundedString(
        message,
        'targetLanguage',
        MAX_LANGUAGE_BYTES
    );
    const originalLanguage = readRequiredBoundedString(
        message,
        'originalLanguage',
        MAX_LANGUAGE_BYTES
    );
    const useNativeSubtitles = readRequiredBoolean(
        message,
        'useNativeSubtitles'
    );
    const useOfficialTranslations = readRequiredBoolean(
        message,
        'useOfficialTranslations'
    );
    const data = inspectSafeRecord(
        readOwnDataValue(message, 'data'),
        NETFLIX_DATA_KEYS
    );
    const rawTracks = readOwnDataValue(data, 'tracks');
    const trackCount = inspectDenseArray(rawTracks, MAX_NETFLIX_TRACKS);
    if (trackCount === 0) rejectInput();

    const tracks = [];
    for (let index = 0; index < trackCount; index += 1) {
        const track = sanitizeNetflixTrack(
            readOwnDataValue(rawTracks, String(index))
        );
        if (track) tracks.push(track);
    }
    if (tracks.length === 0) rejectInput();

    return brandSnapshot({
        action: MessageActions.FETCH_VTT,
        source: SubtitleRequestSources.NETFLIX,
        tabId: senderIdentity.tabId,
        videoId: messageVideoId,
        targetLanguage,
        originalLanguage,
        useNativeSubtitles,
        useOfficialTranslations,
        data: { tracks },
    });
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

function isHostnameAtOrBelow(hostname, baseHostname) {
    if (
        typeof hostname !== 'string' ||
        typeof baseHostname !== 'string' ||
        hostname === '' ||
        baseHostname === ''
    ) {
        return false;
    }

    const normalizedHostname = hostname.toLowerCase();
    const normalizedBaseHostname = baseHostname.toLowerCase();
    return (
        normalizedHostname === normalizedBaseHostname ||
        normalizedHostname.endsWith(`.${normalizedBaseHostname}`)
    );
}

function isAllowedSubtitleCdnHostname(hostname, platform, allowDisneyEdge) {
    const baseHostname = SUBTITLE_CDN_BASES[platform];
    return (
        (baseHostname && isHostnameAtOrBelow(hostname, baseHostname)) ||
        (allowDisneyEdge &&
            platform === SubtitleRequestSources.DISNEY_PLUS &&
            isHostnameAtOrBelow(hostname, DISNEY_EDGE_CDN_BASE))
    );
}

function canonicalizeAllowedSubtitleUrl(
    rawUrl,
    platform,
    stage,
    allowDisneyEdge = false
) {
    const normalizedPlatform = normalizePlatform(platform);
    if (utf8ByteLengthWithinCap(rawUrl, MAX_URL_BYTES) === null) {
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

    // Fragments are never sent in HTTP requests. Remove them before the final
    // cap and snapshot so raw fragment variants share one canonical identity.
    parsedUrl.hash = '';

    if (
        parsedUrl.protocol !== 'https:' ||
        parsedUrl.username !== '' ||
        parsedUrl.password !== '' ||
        parsedUrl.port !== '' ||
        !isAllowedSubtitleCdnHostname(
            parsedUrl.hostname,
            normalizedPlatform,
            allowDisneyEdge
        ) ||
        utf8ByteLengthWithinCap(parsedUrl.href, MAX_URL_BYTES) === null
    ) {
        throw new SubtitleRequestPolicyError(
            'ERR_SUBTITLE_URL_NOT_ALLOWED',
            normalizedPlatform,
            stage
        );
    }

    return parsedUrl.href;
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
    if (utf8ByteLengthWithinCap(reference, MAX_URL_BYTES) === null) {
        throw new SubtitleRequestPolicyError(
            'ERR_SUBTITLE_URL_INVALID',
            platform,
            stage
        );
    }
    const allowedBaseUrl = canonicalizeAllowedSubtitleUrl(
        baseUrl,
        platform,
        stage,
        true
    );

    let resolvedUrl;
    try {
        resolvedUrl = new URL(reference, allowedBaseUrl).href;
    } catch (_) {
        throw new SubtitleRequestPolicyError(
            'ERR_SUBTITLE_URL_INVALID',
            platform,
            stage
        );
    }
    return canonicalizeAllowedSubtitleUrl(resolvedUrl, platform, stage, true);
}

export function isAuthorizedSubtitleRequestSnapshot(value) {
    return (
        value !== null &&
        typeof value === 'object' &&
        authorizedSubtitleRequestSnapshots.has(value)
    );
}

/**
 * Copies an authorized request into a fresh immutable snapshot. Matching route
 * identity narrows page confusion but does not authenticate a forgeable page
 * event or prove which main-world script created it.
 */
export function authorizeSubtitleRequest(message, sender) {
    let platform = UNKNOWN_POLICY_VALUE;
    try {
        const sourceDescriptor = Object.getOwnPropertyDescriptor(
            message,
            'source'
        );
        if (sourceDescriptor && Object.hasOwn(sourceDescriptor, 'value')) {
            platform = normalizePlatform(sourceDescriptor.value);
        }

        const senderIdentity = validateSender(sender, platform);
        if (platform === SubtitleRequestSources.DISNEY_PLUS) {
            return authorizeDisneyRequest(message, senderIdentity);
        }
        if (platform === SubtitleRequestSources.NETFLIX) {
            return authorizeNetflixRequest(message, senderIdentity);
        }
    } catch (_) {
        // All hostile accessors, proxy traps, and shape failures become the
        // same privacy-safe error without retaining attacker-controlled data.
    }

    throw new SubtitleRequestPolicyError(
        'ERR_SUBTITLE_REQUEST_UNAUTHORIZED',
        platform,
        'request'
    );
}
