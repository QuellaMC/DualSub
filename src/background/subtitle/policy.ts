import type { ClassifiedContentSender } from '@/messaging/sender';
import type { FetchVttRequest } from '@/messaging/contracts/fetchVtt';
import { utf8ByteLength } from '@/messaging/snapshot';
import { isPlatformId, type PlatformId } from '@/shared/platforms';
import {
    extractDisneyPlusVideoIdFromUrl,
    extractNetflixVideoIdFromUrl,
    extractYouTubeVideoIdFromUrl,
} from '@/shared/routeIdentity';

// The second authorization layer behind the message contract. It owns what
// the contract cannot: the request's videoId must match the sender tab's
// player route, every URL must canonicalize onto the platform's allowlist,
// and every track the page bridge resolved carries one vetted URL, which on
// YouTube must also name the routed video. Without this layer the
// background is an open proxy for the content script.

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
const YOUTUBE_TRACK_KEYS = new Set(['language', 'displayName', 'asr', 'url']);

const NETFLIX_CDN_BASE = 'nflxvideo.net';
const DISNEY_CDN_BASE = 'media.dssott.com';
const DISNEY_EDGE_CDN_BASE = 'dssedge.com';
const YOUTUBE_CAPTION_HOST = 'www.youtube.com';
const YOUTUBE_CAPTION_PATH = '/api/timedtext';

const ROUTE_VIDEO_IDS: Record<PlatformId, (url: unknown) => string | null> = {
    netflix: extractNetflixVideoIdFromUrl,
    disneyplus: extractDisneyPlusVideoIdFromUrl,
    youtube: extractYouTubeVideoIdFromUrl,
};

export class SubtitleRequestPolicyError extends Error {
    override readonly name = 'SubtitleRequestPolicyError';
    readonly code: string;
    readonly platform: string;
    readonly stage: string;

    constructor(code: string, platform?: string, stage = 'request') {
        super(POLICY_ERROR_MESSAGE);
        this.code = code;
        this.platform = isPlatformId(platform)
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

export interface SanitizedYouTubeTrack {
    readonly language: string;
    readonly displayName: string;
    /** Speech recognition wrote it. */
    readonly asr: boolean;
    readonly downloadUrl: string;
}

export interface DisneyAuthorizedRequest {
    readonly source: 'disneyplus';
    readonly tabId: number;
    readonly videoId: string;
    readonly url: string;
    readonly targetLanguage: string;
    readonly originalLanguage: string;
    readonly useOfficialTranslations: boolean;
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

export interface YouTubeAuthorizedRequest {
    readonly source: 'youtube';
    readonly tabId: number;
    readonly videoId: string;
    readonly targetLanguage: string;
    readonly originalLanguage: string;
    readonly useOfficialTranslations: boolean;
    readonly tracks: readonly SanitizedYouTubeTrack[];
}

export type AuthorizedSubtitleRequest =
    | DisneyAuthorizedRequest
    | NetflixAuthorizedRequest
    | YouTubeAuthorizedRequest;

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

/** Where each platform's subtitle files may come from: its CDN, or
 *  YouTube's own caption endpoint. */
function isAllowedSubtitleLocation(
    url: URL,
    platform: PlatformId,
    allowDisneyEdge: boolean
): boolean {
    switch (platform) {
        case 'netflix':
            return isHostnameAtOrBelow(url.hostname, NETFLIX_CDN_BASE);
        case 'disneyplus':
            return (
                isHostnameAtOrBelow(url.hostname, DISNEY_CDN_BASE) ||
                (allowDisneyEdge &&
                    isHostnameAtOrBelow(url.hostname, DISNEY_EDGE_CDN_BASE))
            );
        case 'youtube':
            return (
                url.hostname === YOUTUBE_CAPTION_HOST &&
                url.pathname === YOUTUBE_CAPTION_PATH
            );
    }
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
    platform: PlatformId,
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
        !isAllowedSubtitleLocation(parsedUrl, platform, allowDisneyEdge) ||
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

function requireAuthorizedSnapshot(snapshot: unknown): PlatformId {
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

function unauthorized(platform: PlatformId): SubtitleRequestPolicyError {
    return new SubtitleRequestPolicyError(
        'ERR_SUBTITLE_REQUEST_UNAUTHORIZED',
        platform
    );
}

function readBoundedString(
    track: Record<string, unknown>,
    key: string,
    maxBytes: number,
    platform: PlatformId
): string | undefined {
    if (!Object.hasOwn(track, key)) {
        return undefined;
    }
    const value = track[key];
    if (!isBoundedNonemptyString(value, maxBytes)) {
        throw unauthorized(platform);
    }
    return value as string;
}

/** A resolved track's own record with exactly `keys` at most, and its
 *  language and display name. Any other shape is tampering, not a
 *  compatibility case. */
function readTrackRecord(
    track: unknown,
    keys: ReadonlySet<string>,
    platform: PlatformId
): {
    record: Record<string, unknown>;
    language: string;
    displayName: string;
} {
    if (
        !isPlainDataRecord(track) ||
        Object.keys(track).some((key) => !keys.has(key))
    ) {
        throw unauthorized(platform);
    }
    const language = readBoundedString(
        track,
        'language',
        MAX_LANGUAGE_BYTES,
        platform
    );
    if (language === undefined) {
        throw unauthorized(platform);
    }
    const displayName =
        readBoundedString(
            track,
            'displayName',
            MAX_DISPLAY_NAME_BYTES,
            platform
        ) ?? language;
    return { record: track, language, displayName };
}

/** The page bridge's resolved Netflix track: one CDN URL. */
function sanitizeNetflixTrack(track: unknown): SanitizedNetflixTrack {
    const { record, language, displayName } = readTrackRecord(
        track,
        NETFLIX_TRACK_KEYS,
        'netflix'
    );
    const trackType = readBoundedString(
        record,
        'trackType',
        MAX_FORMAT_OR_TRACK_TYPE_BYTES,
        'netflix'
    );
    const downloadUrl = canonicalizeAllowedSubtitleUrl(
        record.url,
        'netflix',
        'request'
    );
    return trackType === undefined
        ? { language, displayName, downloadUrl }
        : { language, displayName, trackType, downloadUrl };
}

/** The page bridge's resolved YouTube track: one caption URL, for the
 *  routed video and no other. */
function sanitizeYouTubeTrack(
    track: unknown,
    videoId: string
): SanitizedYouTubeTrack {
    const { record, language, displayName } = readTrackRecord(
        track,
        YOUTUBE_TRACK_KEYS,
        'youtube'
    );
    if (typeof record.asr !== 'boolean') {
        throw unauthorized('youtube');
    }
    const downloadUrl = canonicalizeAllowedSubtitleUrl(
        record.url,
        'youtube',
        'request'
    );
    const urlVideoIds = new URL(downloadUrl).searchParams.getAll('v');
    if (urlVideoIds.length !== 1 || urlVideoIds[0] !== videoId) {
        throw unauthorized('youtube');
    }
    return { language, displayName, asr: record.asr, downloadUrl };
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
    const routeVideoId = ROUTE_VIDEO_IDS[request.source](sender.tabUrl);
    if (
        sender.platform !== request.source ||
        !routeVideoId ||
        request.videoId !== routeVideoId
    ) {
        throw unauthorized(request.source);
    }

    const common = {
        tabId: sender.tabId,
        videoId: request.videoId,
        targetLanguage: request.targetLanguage,
        originalLanguage: request.originalLanguage,
        useOfficialTranslations: request.useOfficialTranslations,
    };
    switch (request.source) {
        case 'disneyplus':
            return brand({
                source: 'disneyplus',
                ...common,
                url: canonicalizeAllowedSubtitleUrl(
                    request.url,
                    'disneyplus',
                    'request'
                ),
            });
        case 'youtube':
            return brand({
                source: 'youtube',
                ...common,
                tracks: request.data.tracks.map((track) =>
                    sanitizeYouTubeTrack(track, routeVideoId)
                ),
            });
        case 'netflix':
            return brand({
                source: 'netflix',
                ...common,
                tracks: request.data.tracks.map(sanitizeNetflixTrack),
            });
    }
}
