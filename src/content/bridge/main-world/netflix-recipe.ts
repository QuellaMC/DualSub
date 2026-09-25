import { normalizeLanguageCode } from '@/shared/languageNormalization';
import type { CapturedEvent } from '../protocol';
import type { InterceptorRecipe } from './interceptor-core';
import { ResolutionSlot, waitFor } from './waitFor';

// Netflix resolves its manifest inside the player core, so subtitle track
// URLs never pass through the page's JSON.parse. They are read instead from
// the page's player API: the track list from the active player session and
// the download URLs from that session's state. Netflix only fetches a URL
// for the text track that is switched on, so a requested language that has
// none yet is switched on briefly and switched back once its URL appears.
// The viewer's subtitle appearance settings come from the same page state.

const PLAYER_POLL_INTERVAL_MS = 500;
const PLAYER_WAIT_TIMEOUT_MS = 60_000;
const TRACK_URL_POLL_INTERVAL_MS = 500;
const TRACK_URL_TIMEOUT_MS = 10_000;
const APPEARANCE_POLL_INTERVAL_MS = 500;
const APPEARANCE_WAIT_TIMEOUT_MS = 30_000;
/** Timed-text objects sit about 12 levels below the session root. */
const STATE_WALK_MAX_DEPTH = 20;
const MAX_APPEARANCE_KEYS = 40;
const MAX_APPEARANCE_STRING_LENGTH = 512;

type PageRecord = Record<string, unknown>;

interface CandidateTrack {
    /** The player's own track object; setTimedTextTrack wants it verbatim. */
    readonly raw: PageRecord;
    readonly trackId: string;
    readonly language: string;
    readonly displayName: string;
    readonly trackType: string | null;
    readonly closedCaptions: boolean;
}

interface PlayerSession {
    readonly player: PageRecord;
    readonly stateRoot: unknown;
}

function isRecord(value: unknown): value is PageRecord {
    return value !== null && typeof value === 'object';
}

function readProperty(target: unknown, key: string): unknown {
    if (!isRecord(target)) {
        return undefined;
    }
    try {
        return target[key];
    } catch {
        return undefined;
    }
}

function readPath(target: unknown, ...keys: string[]): unknown {
    let current = target;
    for (const key of keys) {
        current = readProperty(current, key);
    }
    return current;
}

function callMethod(
    target: unknown,
    name: string,
    ...args: unknown[]
): unknown {
    const method = readProperty(target, name);
    if (typeof method !== 'function') {
        return undefined;
    }
    try {
        return (method as (...callArgs: unknown[]) => unknown).apply(
            target,
            args
        );
    } catch {
        return undefined;
    }
}

function readNetflixGlobal(): unknown {
    return (globalThis as { netflix?: unknown }).netflix;
}

function readPlayerApp(): unknown {
    return readPath(readNetflixGlobal(), 'appContext', 'state', 'playerApp');
}

function readNetflixApi(): {
    videoPlayer: PageRecord;
    playersById: unknown;
} | null {
    const playerApp = readPlayerApp();
    const videoPlayer = readProperty(
        callMethod(playerApp, 'getAPI'),
        'videoPlayer'
    );
    if (!isRecord(videoPlayer)) {
        return null;
    }
    const playersById = readPath(
        callMethod(playerApp, 'getState'),
        'videoPlayer',
        'cadmiumPlayerRepository',
        'playersById'
    );
    return { videoPlayer, playersById };
}

/** The newest player session playing `videoId` whose track list is loaded. */
function findReadyPlayerSession(videoId: string): PlayerSession | null {
    const api = readNetflixApi();
    if (!api) {
        return null;
    }
    const sessionIds = callMethod(api.videoPlayer, 'getAllPlayerSessionIds');
    if (!Array.isArray(sessionIds)) {
        return null;
    }
    for (let index = sessionIds.length - 1; index >= 0; index -= 1) {
        const sessionId: unknown = sessionIds[index];
        if (typeof sessionId !== 'string') {
            continue;
        }
        const player = callMethod(
            api.videoPlayer,
            'getVideoPlayerBySessionId',
            sessionId
        );
        const movieId = callMethod(player, 'getMovieId');
        if (
            !isRecord(player) ||
            (typeof movieId !== 'string' && typeof movieId !== 'number') ||
            String(movieId) !== videoId
        ) {
            continue;
        }
        const tracks = callMethod(player, 'getTimedTextTrackList');
        if (!Array.isArray(tracks) || tracks.length === 0) {
            continue;
        }
        return { player, stateRoot: readProperty(api.playersById, sessionId) };
    }
    return null;
}

function readCandidateTracks(player: PageRecord): CandidateTrack[] {
    const list = callMethod(player, 'getTimedTextTrackList');
    if (!Array.isArray(list)) {
        return [];
    }
    const candidates: CandidateTrack[] = [];
    for (const raw of list as unknown[]) {
        if (!isRecord(raw)) {
            continue;
        }
        const trackId = readProperty(raw, 'trackId');
        const language = readProperty(raw, 'bcp47');
        if (
            typeof trackId !== 'string' ||
            typeof language !== 'string' ||
            language === '' ||
            readProperty(raw, 'isNoneTrack') === true ||
            readProperty(raw, 'isForcedNarrative') === true ||
            readProperty(raw, 'isImageBased') === true
        ) {
            continue;
        }
        const displayName = readProperty(raw, 'displayName');
        const trackType = readProperty(raw, 'trackType');
        const rawTrackType = readProperty(raw, 'rawTrackType');
        candidates.push({
            raw,
            trackId,
            language,
            displayName:
                typeof displayName === 'string' && displayName !== ''
                    ? displayName
                    : language,
            trackType: typeof trackType === 'string' ? trackType : null,
            closedCaptions:
                (typeof rawTrackType === 'string' &&
                    rawTrackType.toUpperCase() === 'CLOSEDCAPTIONS') ||
                trackType === 'ASSISTIVE',
        });
    }
    return candidates;
}

/** Subtitles beat closed captions within one language, then list order. */
function selectTrack(
    candidates: readonly CandidateTrack[],
    language: string
): CandidateTrack | null {
    const wanted = normalizeLanguageCode(language);
    const matching = candidates.filter(
        (candidate) => normalizeLanguageCode(candidate.language) === wanted
    );
    return (
        matching.find((candidate) => !candidate.closedCaptions) ??
        matching[0] ??
        null
    );
}

/**
 * The tracks to load: one per requested language. The first language is
 * the original and always gets a track — English, then the first subtitle
 * track, when it is unavailable — so the background's own fallback order
 * sees the same choices it would have made from the full list.
 */
function selectTracks(
    candidates: readonly CandidateTrack[],
    languages: readonly string[]
): CandidateTrack[] {
    const selected: CandidateTrack[] = [];
    const add = (track: CandidateTrack | null): void => {
        if (
            track &&
            !selected.some((entry) => entry.trackId === track.trackId)
        ) {
            selected.push(track);
        }
    };
    const [originalLanguage, ...otherLanguages] = languages;
    add(
        selectTrack(candidates, originalLanguage ?? '') ??
            selectTrack(candidates, 'en') ??
            candidates.find((candidate) => !candidate.closedCaptions) ??
            candidates[0] ??
            null
    );
    for (const language of otherLanguages) {
        add(selectTrack(candidates, language));
    }
    return selected;
}

/** Walk the session state for `{ type: 'timedtext', trackId, urls }` nodes;
 *  matching by shape survives the player's minified property paths. */
function readTimedTextUrls(stateRoot: unknown): Map<string, string> {
    const urls = new Map<string, string>();
    const seen = new WeakSet<object>();
    const stack: { node: unknown; depth: number }[] = [
        { node: stateRoot, depth: 0 },
    ];
    while (stack.length > 0) {
        const { node, depth } = stack.pop()!;
        if (
            !isRecord(node) ||
            depth > STATE_WALK_MAX_DEPTH ||
            seen.has(node) ||
            node instanceof ArrayBuffer ||
            ArrayBuffer.isView(node)
        ) {
            continue;
        }
        seen.add(node);

        const trackId = readProperty(node, 'trackId');
        const urlList = readProperty(node, 'urls');
        if (
            readProperty(node, 'type') === 'timedtext' &&
            typeof trackId === 'string' &&
            Array.isArray(urlList) &&
            !urls.has(trackId)
        ) {
            const url = readProperty(urlList[0], 'url');
            if (typeof url === 'string' && url !== '') {
                urls.set(trackId, url);
            }
        }

        let keys: string[];
        try {
            keys = Array.isArray(node)
                ? node.map((_value, index) => String(index))
                : Object.keys(node);
        } catch {
            continue;
        }
        for (const key of keys) {
            const child = readProperty(node, key);
            if (isRecord(child)) {
                stack.push({ node: child, depth: depth + 1 });
            }
        }
    }
    return urls;
}

const trackResolution = new ResolutionSlot();
const appearanceResolution = new ResolutionSlot();

async function resolveSubtitleTracks(
    videoId: string,
    languages: readonly string[],
    emit: (event: CapturedEvent) => void
): Promise<void> {
    const token = trackResolution.begin();
    try {
        const session = await waitFor(
            () => findReadyPlayerSession(videoId),
            PLAYER_POLL_INTERVAL_MS,
            PLAYER_WAIT_TIMEOUT_MS,
            token
        );
        if (!session) {
            if (!token.cancelled) {
                emit({
                    t: 'subtitle-data',
                    platform: 'netflix',
                    movieId: videoId,
                    languages: [...languages],
                    tracks: [],
                });
            }
            return;
        }
        const selected = selectTracks(
            readCandidateTracks(session.player),
            languages
        );
        const urls = readTimedTextUrls(session.stateRoot);
        const previousTrack = callMethod(session.player, 'getTimedTextTrack');
        let switched = false;
        try {
            for (const track of selected) {
                if (urls.has(track.trackId)) {
                    continue;
                }
                await callMethod(
                    session.player,
                    'setTimedTextTrack',
                    track.raw
                );
                switched = true;
                const url = await waitFor(
                    () =>
                        readTimedTextUrls(session.stateRoot).get(
                            track.trackId
                        ) ?? null,
                    TRACK_URL_POLL_INTERVAL_MS,
                    TRACK_URL_TIMEOUT_MS,
                    token
                );
                if (token.cancelled) {
                    return;
                }
                if (url !== null) {
                    urls.set(track.trackId, url);
                }
            }
        } finally {
            if (switched && previousTrack !== undefined) {
                await callMethod(
                    session.player,
                    'setTimedTextTrack',
                    previousTrack
                );
            }
        }
        if (token.cancelled) {
            return;
        }
        const tracks = selected
            .filter((track) => urls.has(track.trackId))
            .map((track) => ({
                language: track.language,
                displayName: track.displayName,
                ...(track.trackType === null
                    ? {}
                    : { trackType: track.trackType }),
                url: urls.get(track.trackId)!,
            }));
        emit({
            t: 'subtitle-data',
            platform: 'netflix',
            movieId: videoId,
            languages: [...languages],
            tracks,
        });
    } catch {
        // A page API failure leaves the request unanswered; the next
        // request or navigation retries from scratch.
    } finally {
        trackResolution.release(token);
    }
}

/** The own string-or-null entries of a page record, as fresh plain data. */
function readStringRecord(
    source: unknown
): Record<string, string | null> | null {
    if (!isRecord(source)) {
        return null;
    }
    let keys: string[];
    try {
        keys = Object.keys(source).slice(0, MAX_APPEARANCE_KEYS);
    } catch {
        return null;
    }
    const record: Record<string, string | null> = {};
    for (const key of keys) {
        const value = readProperty(source, key);
        if (
            value === null ||
            (typeof value === 'string' &&
                value.length <= MAX_APPEARANCE_STRING_LENGTH)
        ) {
            record[key] = value;
        }
    }
    return record;
}

/** The profile's timed-text style (defaults and overrides) and the
 *  player's style-to-font mapping; null until the page holds all three. */
function readTimedTextAppearance(): Record<string, unknown> | null {
    const userInfo = readPath(
        readNetflixGlobal(),
        'reactContext',
        'models',
        'userInfo',
        'data'
    );
    const defaults = readStringRecord(
        readProperty(userInfo, 'timedTextStyleDefaults')
    );
    const overrides = readStringRecord(
        readProperty(userInfo, 'timedTextStyleOverrides')
    );
    const fontFamilyMapping = readStringRecord(
        readPath(
            callMethod(readPlayerApp(), 'getState'),
            'videoPlayer',
            'initParams',
            'timedTextFontFamilyMapping'
        )
    );
    return defaults && overrides && fontFamilyMapping
        ? { defaults, overrides, fontFamilyMapping }
        : null;
}

async function resolveSubtitleAppearance(
    emit: (event: CapturedEvent) => void
): Promise<void> {
    const token = appearanceResolution.begin();
    try {
        const appearance = await waitFor(
            readTimedTextAppearance,
            APPEARANCE_POLL_INTERVAL_MS,
            APPEARANCE_WAIT_TIMEOUT_MS,
            token
        );
        if (appearance && !token.cancelled) {
            emit({ t: 'subtitle-appearance', platform: 'netflix', appearance });
        }
    } finally {
        appearanceResolution.release(token);
    }
}

export const netflixRecipe: InterceptorRecipe = {
    platform: 'netflix',
    onControl(message, emit) {
        switch (message.t) {
            case 'request-subtitle-tracks':
                void resolveSubtitleTracks(
                    message.videoId,
                    message.languages,
                    emit
                );
                break;
            case 'cancel-subtitle-tracks':
                trackResolution.cancel();
                break;
            case 'request-subtitle-appearance':
                void resolveSubtitleAppearance(emit);
                break;
            default:
                break;
        }
    },
    onClose() {
        trackResolution.cancel();
        appearanceResolution.cancel();
    },
};
