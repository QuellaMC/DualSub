import {
    selectYouTubeOriginal,
    selectYouTubeTranslation,
} from '@/shared/youtubeTracks';
import {
    YOUTUBE_PLAYER_SELECTOR,
    visibleVideoOf,
} from '../../platform/youtube/player';
import { isBridgeLanguage, type CapturedEvent } from '../protocol';
import type { InterceptorRecipe } from './interceptor-core';
import { callMethod, readPath, readProperty } from './pageRecord';
import { ResolutionSlot, ValueWatch, waitFor } from './waitFor';

// YouTube's player elements carry their own API: getPlayerResponse() names
// the video a player holds, and its audio track lists the caption tracks
// with their download URLs. The player lists each URL unsigned and adds a
// proof token (`pot`) about a second later, once YouTube's anti-bot check
// has run, with the viewer's own captions off. The route can name the next
// video before the player loads it, and a preload player can hold another,
// so only a player that holds the routed video and shows its picture
// answers. Only the tracks for the requested languages cross the bridge.

const PLAYER_POLL_INTERVAL_MS = 250;
const PLAYER_WAIT_TIMEOUT_MS = 60_000;
/** YouTube names, in a caption URL's own signed `exp` parameter, the
 *  experiments under which it serves the captions only with a proof token,
 *  and serves the others unsigned too; yt-dlp detects it the same way. */
const TOKEN_REQUIRED_EXPERIMENTS = new Set(['xpe', 'xpv']);
const SPOKEN_LANGUAGE_POLL_INTERVAL_MS = 1000;
const SPOKEN_LANGUAGE_UNKNOWN_AFTER_MS = 15_000;
/** The audio track id when the player does not know the language. */
const UNDETERMINED_AUDIO_ID = 'und';
const AUDIO_LANGUAGE_PATTERN = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u;

interface CaptionTrack {
    readonly language: string;
    readonly displayName: string;
    /** Speech recognition wrote it, in the language spoken. */
    readonly asr: boolean;
    readonly isDefault: boolean;
    readonly url: URL;
}

/** The player holding `videoId` with its picture on screen. */
function findActivePlayer(videoId: string): Element | null {
    for (const player of document.querySelectorAll(YOUTUBE_PLAYER_SELECTOR)) {
        const heldVideoId = readPath(
            callMethod(player, 'getPlayerResponse'),
            'videoDetails',
            'videoId'
        );
        if (heldVideoId === videoId && visibleVideoOf(player)) {
            return player;
        }
    }
    return null;
}

/** The player's caption tracks for `videoId`; a track whose URL names
 *  another video belongs to a player state that is already stale. */
function readCaptionTracks(player: Element, videoId: string): CaptionTrack[] {
    const list = readProperty(
        callMethod(player, 'getAudioTrack'),
        'captionTracks'
    );
    if (!Array.isArray(list)) {
        return [];
    }
    const tracks: CaptionTrack[] = [];
    for (const raw of list as unknown[]) {
        const language = readProperty(raw, 'languageCode');
        const rawUrl = readProperty(raw, 'url');
        if (!isBridgeLanguage(language) || typeof rawUrl !== 'string') {
            continue;
        }
        let url: URL;
        try {
            url = new URL(rawUrl);
        } catch {
            continue;
        }
        if (url.searchParams.get('v') !== videoId) {
            continue;
        }
        const displayName = readProperty(raw, 'displayName');
        tracks.push({
            language,
            displayName:
                typeof displayName === 'string' && displayName !== ''
                    ? displayName
                    : language,
            asr: readProperty(raw, 'kind') === 'asr',
            isDefault: readProperty(raw, 'isDefault') === true,
            url,
        });
    }
    return tracks;
}

/** Whether the video has captions at all, as its player response says. */
function listsCaptions(player: Element): boolean {
    const listed = readPath(
        callMethod(player, 'getPlayerResponse'),
        'captions',
        'playerCaptionsTracklistRenderer',
        'captionTracks'
    );
    return Array.isArray(listed) && listed.length > 0;
}

interface SelectedTracks {
    readonly original: CaptionTrack;
    /** One per requested translation that has a track of its own. */
    readonly translations: readonly CaptionTrack[];
}

/** The tracks for the requested languages, original first; null when the
 *  player lists none. */
function selectTracks(
    candidates: readonly CaptionTrack[],
    languages: readonly string[]
): SelectedTracks | null {
    const [originalLanguage = '', ...otherLanguages] = languages;
    const original = selectYouTubeOriginal(candidates, originalLanguage);
    if (!original) {
        return null;
    }
    const translations: CaptionTrack[] = [];
    for (const language of otherLanguages) {
        const track = selectYouTubeTranslation(candidates, language);
        if (track && track !== original && !translations.includes(track)) {
            translations.push(track);
        }
    }
    return { original, translations };
}

function readClientName(): string | null {
    const name = callMethod(
        readProperty(globalThis, 'ytcfg'),
        'get',
        'INNERTUBE_CLIENT_NAME'
    );
    return typeof name === 'string' && name !== '' ? name : null;
}

function isSigned(url: URL): boolean {
    return url.searchParams.has('pot');
}

function needsToken(url: URL): boolean {
    return url.searchParams
        .getAll('exp')
        .flatMap((value) => value.split(','))
        .some((experiment) => TOKEN_REQUIRED_EXPERIMENTS.has(experiment));
}

/** YouTube serves the track as the player holds it now. */
function isServable(track: CaptionTrack): boolean {
    return isSigned(track.url) || !needsToken(track.url);
}

/** The track's WebVTT download. */
function downloadUrl(track: CaptionTrack, clientName: string): string {
    const url = new URL(track.url);
    url.searchParams.set('c', clientName);
    url.searchParams.set('fmt', 'vtt');
    return url.href;
}

interface ListedTracks {
    /** The original's track first, then each translation's that YouTube
     *  serves as it is now. */
    readonly tracks: unknown[];
    /** How many of those the player has signed. */
    readonly signedCount: number;
    /** YouTube serves the original's track as it is now. */
    readonly ready: boolean;
    /** The player has signed every selected track, so none is left out. */
    readonly signed: boolean;
}

/** The requested languages' tracks once the routed video's player lists
 *  them, none when the video has no captions, and null while either is
 *  still loading. */
function readListedTracks(
    videoId: string,
    languages: readonly string[]
): ListedTracks | null {
    const player = findActivePlayer(videoId);
    if (!player) {
        return null;
    }
    const selected = selectTracks(
        readCaptionTracks(player, videoId),
        languages
    );
    if (!selected) {
        return listsCaptions(player)
            ? null
            : { tracks: [], signedCount: 0, ready: true, signed: true };
    }
    const clientName = readClientName();
    if (!clientName) {
        return null;
    }
    const { original, translations } = selected;
    const sendable = [original, ...translations.filter(isServable)];
    return {
        tracks: sendable.map((track) =>
            sentTrack(track, downloadUrl(track, clientName))
        ),
        signedCount: sendable.filter((track) => isSigned(track.url)).length,
        ready: isServable(original),
        signed: [original, ...translations].every((track) =>
            isSigned(track.url)
        ),
    };
}

/** A selected track as it crosses the bridge. */
function sentTrack(track: CaptionTrack, url: string): unknown {
    return {
        language: track.language,
        displayName: track.displayName,
        asr: track.asr,
        url,
    };
}

const trackResolution = new ResolutionSlot();
const spokenLanguageWatch = new ValueWatch();

async function resolveSubtitleTracks(
    videoId: string,
    languages: readonly string[],
    emit: (event: CapturedEvent) => void
): Promise<void> {
    const token = trackResolution.begin();
    const deadline = Date.now() + PLAYER_WAIT_TIMEOUT_MS;
    const answer = (tracks: unknown[]): void =>
        emit({
            t: 'subtitle-data',
            platform: 'youtube',
            videoId,
            languages: [...languages],
            tracks,
        });
    /** More tracks to send, or more of them signed. */
    const progress = (listed: ListedTracks): number =>
        listed.tracks.length + listed.signedCount;
    const until = (
        wanted: (listed: ListedTracks) => boolean
    ): Promise<ListedTracks | null> =>
        waitFor(
            () => {
                const listed = readListedTracks(videoId, languages);
                return listed && wanted(listed) ? listed : null;
            },
            PLAYER_POLL_INTERVAL_MS,
            deadline - Date.now(),
            token
        );
    try {
        let last = await until((listed) => listed.ready);
        if (token.cancelled) {
            return;
        }
        answer(last?.tracks ?? []);
        // A translation left out or a track sent unsigned goes again each
        // time the player signs more of them: YouTube may hold a viewer to
        // the token without marking the URL (Premium does).
        while (last && !last.signed) {
            const reached = progress(last);
            const better = await until(
                (listed) => listed.ready && progress(listed) > reached
            );
            if (!better || token.cancelled) {
                return;
            }
            answer(better.tracks);
            last = better;
        }
    } catch {
        // A page API failure leaves the request unanswered; the next
        // request or navigation retries from scratch.
    } finally {
        trackResolution.release(token);
    }
}

/** The language spoken in `videoId`: the audio track's own when the player
 *  knows it, else that of the one speech-recognition track, else that of
 *  the caption track the video names its default. Once the player has
 *  loaded the video's captions, or found it has none, null says nothing
 *  names it; undefined is a player still loading. */
function readSpokenLanguage(videoId: string): string | null | undefined {
    const player = findActivePlayer(videoId);
    if (!player) {
        return undefined;
    }
    const audioId = readProperty(callMethod(player, 'getAudioTrack'), 'id');
    if (
        typeof audioId === 'string' &&
        audioId !== UNDETERMINED_AUDIO_ID &&
        AUDIO_LANGUAGE_PATTERN.test(audioId)
    ) {
        return audioId;
    }
    const tracks = readCaptionTracks(player, videoId);
    if (tracks.length === 0 && listsCaptions(player)) {
        return undefined;
    }
    const recognized = tracks.filter((track) => track.asr);
    if (recognized.length === 1) {
        return recognized[0]!.language;
    }
    return tracks.find((track) => track.isDefault)?.language ?? null;
}

function watchSpokenLanguage(
    videoId: string,
    emit: (event: CapturedEvent) => void
): void {
    spokenLanguageWatch.start(
        () => readSpokenLanguage(videoId),
        (language) =>
            emit({
                t: 'spoken-language',
                platform: 'youtube',
                videoId,
                language,
            }),
        SPOKEN_LANGUAGE_POLL_INTERVAL_MS,
        SPOKEN_LANGUAGE_UNKNOWN_AFTER_MS
    );
}

export const youtubeRecipe: InterceptorRecipe = {
    platform: 'youtube',
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
            case 'watch-spoken-language':
                watchSpokenLanguage(message.videoId, emit);
                break;
            case 'unwatch-spoken-language':
                spokenLanguageWatch.stop();
                break;
            default:
                break;
        }
    },
    onClose() {
        trackResolution.cancel();
        spokenLanguageWatch.stop();
    },
};
