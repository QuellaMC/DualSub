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
// with signed download URLs. A URL is ready once the player adds its proof
// token (`pot`), which it does with the viewer's own captions off. The
// route can name the next video before the player loads it, and a preload
// player can hold another, so only a player that holds the routed video and
// shows its picture answers. Only the tracks for the requested languages
// cross the bridge.

const PLAYER_POLL_INTERVAL_MS = 250;
const PLAYER_WAIT_TIMEOUT_MS = 60_000;
/** The player signs its tracks together; a translation still unsigned this
 *  long after the original is left to the translation service. */
const TRANSLATION_SIGNING_GRACE_MS = 5000;
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

/** One track per requested language: the original first, then each
 *  translation that has one. */
function selectTracks(
    candidates: readonly CaptionTrack[],
    languages: readonly string[]
): CaptionTrack[] {
    const [originalLanguage = '', ...otherLanguages] = languages;
    const selected: CaptionTrack[] = [];
    for (const track of [
        selectYouTubeOriginal(candidates, originalLanguage),
        ...otherLanguages.map((language) =>
            selectYouTubeTranslation(candidates, language)
        ),
    ]) {
        if (track && !selected.includes(track)) {
            selected.push(track);
        }
    }
    return selected;
}

function readClientName(): string | null {
    const name = callMethod(
        readProperty(globalThis, 'ytcfg'),
        'get',
        'INNERTUBE_CLIENT_NAME'
    );
    return typeof name === 'string' && name !== '' ? name : null;
}

/** The track's WebVTT download once the player has signed its URL. */
function downloadUrl(track: CaptionTrack, clientName: string): string | null {
    if (!track.url.searchParams.has('pot')) {
        return null;
    }
    const url = new URL(track.url);
    url.searchParams.set('c', clientName);
    url.searchParams.set('fmt', 'vtt');
    return url.href;
}

interface SignedTracks {
    /** The original's track first, then each translation's that is signed. */
    readonly tracks: unknown[];
    /** Every selected track is signed. */
    readonly complete: boolean;
}

/** The requested languages' signed tracks once the routed video's player
 *  has signed the original's, none when the video has no captions, and
 *  null while either is still loading. */
function readSignedTracks(
    videoId: string,
    languages: readonly string[]
): SignedTracks | null {
    const player = findActivePlayer(videoId);
    if (!player) {
        return null;
    }
    const candidates = readCaptionTracks(player, videoId);
    if (candidates.length === 0) {
        return listsCaptions(player) ? null : { tracks: [], complete: true };
    }
    const clientName = readClientName();
    if (!clientName) {
        return null;
    }
    const [original, ...translations] = selectTracks(candidates, languages);
    const originalUrl = original ? downloadUrl(original, clientName) : null;
    if (!original || originalUrl === null) {
        return null;
    }
    const tracks = [sentTrack(original, originalUrl)];
    for (const translation of translations) {
        const url = downloadUrl(translation, clientName);
        if (url !== null) {
            tracks.push(sentTrack(translation, url));
        }
    }
    return { tracks, complete: tracks.length === translations.length + 1 };
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
    try {
        let partSignedSince: number | null = null;
        const tracks = await waitFor(
            () => {
                const signed = readSignedTracks(videoId, languages);
                if (!signed) {
                    return null;
                }
                if (signed.complete) {
                    return signed.tracks;
                }
                partSignedSince ??= Date.now();
                return Date.now() - partSignedSince >=
                    TRANSLATION_SIGNING_GRACE_MS
                    ? signed.tracks
                    : null;
            },
            PLAYER_POLL_INTERVAL_MS,
            PLAYER_WAIT_TIMEOUT_MS,
            token
        );
        if (!token.cancelled) {
            emit({
                t: 'subtitle-data',
                platform: 'youtube',
                videoId,
                languages: [...languages],
                tracks:
                    tracks ??
                    readSignedTracks(videoId, languages)?.tracks ??
                    [],
            });
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
