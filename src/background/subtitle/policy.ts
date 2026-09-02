import type { ClassifiedContentSender } from '@/messaging/sender';
import type { FetchVttRequest } from '@/messaging/contracts/fetchVtt';
import { utf8ByteLength } from '@/messaging/snapshot';
import {
    extractDisneyPlusVideoIdFromUrl,
    extractNetflixVideoIdFromUrl,
} from '@/shared/routeIdentity';

// The second authorization layer behind the message contract. It owns what
// the contract cannot: the request's videoId must match the sender tab's
// player route, every URL must canonicalize onto the platform CDN allowlist,
// and every Netflix track the page bridge resolved carries one vetted URL.
// Without this layer the background is an open proxy for the content script.

const POLICY_ERROR_MESSAGE = 'Subtitle request rejected by policy.';
const UNKNOWN_POLICY_VALUE = 'unknown';
const POLICY_STAGE_PATTERN = /^[a-z][a-z0-9-]{0,63}$/u;
const MAX_URL_BYTES = 16 * 1024;
const MAX_LANGUAGE_BYTES = 64;
const MAX_FORMAT_OR_TRACK_TYPE_BYTES = 64;
const MAX_DISPLAY_NAME_BYTES = 256;
const NETFLIX_TRACK_KEYS = new Set([
    'language',
    'displayName',
    'trackType',
    'url',
]);

export type SubtitleSource = 'netflix' | 'disneyplus';

const SUBTITLE_CDN_BASES: Record<SubtitleSource, string> = {
    disneyplus: 'media.dssott.com',
    netflix: 'nflxvideo.net',
};
const DISNEY_EDGE_CDN_BASE = 'dssedge.com';

export class SubtitleRequestPolicyError extends Error {
    override readonly name = 'SubtitleRequestPolicyError';
    readonly code: string;
    readonly platform: string;
    readonly stage: string;

    constructor(code: string, platform?: string, stage = 'request') {
        super(POLICY_ERROR_MESSAGE);
        this.code = code;
        this.platform =
            platform === 'netflix' || platform === 'disneyplus'
                ? platform
                : UNKNOWN_POLICY_VALUE;
        this.stage = POLICY_STAGE_PATTERN.test(stage)
            ? stage
            : UNKNOWN_POLICY_VALUE;
    }
}

export interface SanitizedNetflixTrack {
    readonly language: string;
    readonly displayName: string;
    readonly trackType?: string;
    readonly downloadUrl: string;
}

export interface DisneyAuthorizedRequest {
    readonly source: 'disneyplus';
    readonly tabId: number;
    readonly videoId: string;
    readonly url: string;
    readonly targetLanguage: string;
    readonly originalLanguage: string;
}

export interface NetflixAuthorizedRequest {
    readonly source: 'netflix';
    readonly tabId: number;
    readonly videoId: string;
    readonly targetLanguage: string;
    readonly originalLanguage: string;
    readonly useOfficialTranslations: boolean;
    readonly tracks: readonly SanitizedNetflixTrack[];
}

export type AuthorizedSubtitleRequest =
    DisneyAuthorizedRequest | NetflixAuthorizedRequest;

// Only snapshots minted here may drive fetches; downstream layers re-assert
// membership instead of trusting any object shaped like a request.
const authorizedSnapshots = new WeakSet<AuthorizedSubtitleRequest>();

export function isAuthorizedSubtitleRequestSnapshot(
    value: unknown
): value is AuthorizedSubtitleRequest {
    return (
        value !== null &&
        typeof value === 'object' &&
        authorizedSnapshots.has(value as AuthorizedSubtitleRequest)
    );
}

function isHostnameAtOrBelow(hostname: string, baseHostname: string): boolean {
    const normalizedHostname = hostname.toLowerCase();
    const normalizedBase = baseHostname.toLowerCase();
    return (
        normalizedHostname === normalizedBase ||
        normalizedHostname.endsWith(`.${normalizedBase}`)
    );
}

function isAllowedSubtitleCdnHostname(
    hostname: string,
    platform: SubtitleSource,
    allowDisneyEdge: boolean
): boolean {
    return (
        isHostnameAtOrBelow(hostname, SUBTITLE_CDN_BASES[platform]) ||
        (allowDisneyEdge &&
            platform === 'disneyplus' &&
            isHostnameAtOrBelow(hostname, DISNEY_EDGE_CDN_BASE))
    );
}

function isWithinUrlByteCap(value: string): boolean {
    return (
        value.length <= MAX_URL_BYTES &&
        value.isWellFormed() &&
        utf8ByteLength(value) <= MAX_URL_BYTES
    );
}

export function canonicalizeAllowedSubtitleUrl(
    rawUrl: unknown,
    platform: SubtitleSource,
    stage: string,
    allowDisneyEdge = false
): string {
    if (typeof rawUrl !== 'string' || !isWithinUrlByteCap(rawUrl)) {
        throw new SubtitleRequestPolicyError(
            'ERR_SUBTITLE_URL_INVALID',
            platform,
            stage
        );
    }

    let parsedUrl: URL;
    try {
        parsedUrl = new URL(rawUrl);
    } catch {
        throw new SubtitleRequestPolicyError(
            'ERR_SUBTITLE_URL_INVALID',
            platform,
            stage
        );
    }

    // Fragments are never sent in HTTP requests. Remove them before the
    // final cap so raw fragment variants share one canonical identity.
    parsedUrl.hash = '';

    if (
        parsedUrl.protocol !== 'https:' ||
        parsedUrl.username !== '' ||
        parsedUrl.password !== '' ||
        parsedUrl.port !== '' ||
        !isAllowedSubtitleCdnHostname(
            parsedUrl.hostname,
            platform,
            allowDisneyEdge
        ) ||
        !isWithinUrlByteCap(parsedUrl.href)
    ) {
        throw new SubtitleRequestPolicyError(
            'ERR_SUBTITLE_URL_NOT_ALLOWED',
            platform,
            stage
        );
    }
    return parsedUrl.href;
}

function requireAuthorizedSnapshot(snapshot: unknown): SubtitleSource {
    if (!isAuthorizedSubtitleRequestSnapshot(snapshot)) {
        throw new SubtitleRequestPolicyError(
            'ERR_SUBTITLE_REQUEST_UNAUTHORIZED'
        );
    }
    return snapshot.source;
}

/** Canonicalize a URL for an already-authorized request (redirects allowed
 *  onto the Disney edge CDN). */
export function assertAllowedSubtitleUrl(
    snapshot: unknown,
    rawUrl: unknown,
    stage: string
): string {
    const platform = requireAuthorizedSnapshot(snapshot);
    return canonicalizeAllowedSubtitleUrl(rawUrl, platform, stage, true);
}

/** Resolve a playlist reference against an allowed base, then re-canonicalize. */
export function resolveAllowedSubtitleUrl(
    snapshot: unknown,
    reference: unknown,
    baseUrl: string,
    stage: string
): string {
    const platform = requireAuthorizedSnapshot(snapshot);
    if (typeof reference !== 'string' || !isWithinUrlByteCap(reference)) {
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

    let resolvedUrl: string;
    try {
        resolvedUrl = new URL(reference, allowedBaseUrl).href;
    } catch {
        throw new SubtitleRequestPolicyError(
            'ERR_SUBTITLE_URL_INVALID',
            platform,
            stage
        );
    }
    return canonicalizeAllowedSubtitleUrl(resolvedUrl, platform, stage, true);
}

// ---------------------------------------------------------------- sanitizing
// Inputs below already passed the message snapshot (plain frozen data, no
// dangerous keys, dense arrays, budget-capped), so plain reads are safe; the
// checks here are structural selection with the policy's own caps.

function isPlainDataRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isBoundedNonemptyString(value: unknown, maxBytes: number): boolean {
    return (
        typeof value === 'string' &&
        value.trim().length > 0 &&
        value.isWellFormed() &&
        utf8ByteLength(value) <= maxBytes
    );
}

function readBoundedString(
    track: Record<string, unknown>,
    key: string,
    maxBytes: number
): string | undefined {
    if (!Object.hasOwn(track, key)) {
        return undefined;
    }
    const value = track[key];
    if (!isBoundedNonemptyString(value, maxBytes)) {
        throw new SubtitleRequestPolicyError(
            'ERR_SUBTITLE_REQUEST_UNAUTHORIZED',
            'netflix'
        );
    }
    return value as string;
}

/** The page bridge's resolved track: exactly these keys, one CDN URL. Any
 *  other shape is tampering, not a compatibility case. */
function sanitizeNetflixTrack(track: unknown): SanitizedNetflixTrack {
    if (
        !isPlainDataRecord(track) ||
        Object.keys(track).some((key) => !NETFLIX_TRACK_KEYS.has(key))
    ) {
        throw new SubtitleRequestPolicyError(
            'ERR_SUBTITLE_REQUEST_UNAUTHORIZED',
            'netflix'
        );
    }
    const language = readBoundedString(track, 'language', MAX_LANGUAGE_BYTES);
    if (language === undefined) {
        throw new SubtitleRequestPolicyError(
            'ERR_SUBTITLE_REQUEST_UNAUTHORIZED',
            'netflix'
        );
    }
    const displayName =
        readBoundedString(track, 'displayName', MAX_DISPLAY_NAME_BYTES) ??
        language;
    const trackType = readBoundedString(
        track,
        'trackType',
        MAX_FORMAT_OR_TRACK_TYPE_BYTES
    );
    const downloadUrl = canonicalizeAllowedSubtitleUrl(
        track.url,
        'netflix',
        'request'
    );
    return trackType === undefined
        ? { language, displayName, downloadUrl }
        : { language, displayName, trackType, downloadUrl };
}

function deepFreeze<T extends object>(value: T): T {
    for (const key of Reflect.ownKeys(value)) {
        const child = (value as Record<PropertyKey, unknown>)[key];
        if (child !== null && typeof child === 'object') {
            deepFreeze(child);
        }
    }
    return Object.freeze(value);
}

function brand<T extends AuthorizedSubtitleRequest>(snapshot: T): T {
    deepFreeze(snapshot);
    authorizedSnapshots.add(snapshot);
    return snapshot;
}

/**
 * Authorize a contract-parsed fetchVTT request against its classified
 * sender. Matching route identity narrows page confusion but does not
 * authenticate a forgeable page event.
 */
export function authorizeSubtitleRequest(
    request: FetchVttRequest,
    sender: ClassifiedContentSender
): AuthorizedSubtitleRequest {
    if (sender.platform !== request.source) {
        throw new SubtitleRequestPolicyError(
            'ERR_SUBTITLE_REQUEST_UNAUTHORIZED',
            request.source
        );
    }

    if (request.source === 'disneyplus') {
        const routeVideoId = extractDisneyPlusVideoIdFromUrl(sender.tabUrl);
        if (!routeVideoId || request.videoId !== routeVideoId) {
            throw new SubtitleRequestPolicyError(
                'ERR_SUBTITLE_REQUEST_UNAUTHORIZED',
                'disneyplus'
            );
        }
        return brand({
            source: 'disneyplus',
            tabId: sender.tabId,
            videoId: request.videoId,
            url: canonicalizeAllowedSubtitleUrl(
                request.url,
                'disneyplus',
                'request'
            ),
            targetLanguage: request.targetLanguage,
            originalLanguage: request.originalLanguage,
        });
    }

    const routeVideoId = extractNetflixVideoIdFromUrl(sender.tabUrl);
    if (!routeVideoId || request.videoId !== routeVideoId) {
        throw new SubtitleRequestPolicyError(
            'ERR_SUBTITLE_REQUEST_UNAUTHORIZED',
            'netflix'
        );
    }

    const tracks = request.data.tracks.map(sanitizeNetflixTrack);

    return brand({
        source: 'netflix',
        tabId: sender.tabId,
        videoId: request.videoId,
        targetLanguage: request.targetLanguage,
        originalLanguage: request.originalLanguage,
        useOfficialTranslations: request.useOfficialTranslations,
        tracks,
    });
}
