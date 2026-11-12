import { normalizeLanguageCode } from './languageNormalization';

// Which YouTube caption track serves each line. The page bridge picks the
// tracks it sends with these rules and the background picks among those
// with the same ones, so a track the bridge leaves out is one the
// background would never have chosen.

export interface YouTubeTrackChoice {
    readonly language: string;
    /** Speech recognition wrote it, in the language spoken. */
    readonly asr: boolean;
}

/** Captions a person wrote beat speech recognition, then list order. */
function trackInLanguage<T extends YouTubeTrackChoice>(
    tracks: readonly T[],
    language: string
): T | null {
    const wanted = normalizeLanguageCode(language);
    const matching = tracks.filter(
        (track) => normalizeLanguageCode(track.language) === wanted
    );
    return matching.find((track) => !track.asr) ?? matching[0] ?? null;
}

/** The original line's track: the requested language's, else English's,
 *  else the first track. */
export function selectYouTubeOriginal<T extends YouTubeTrackChoice>(
    tracks: readonly T[],
    language: string
): T | null {
    return (
        trackInLanguage(tracks, language) ??
        trackInLanguage(tracks, 'en') ??
        tracks[0] ??
        null
    );
}

/** A translation's track: captions a person wrote in that language, since
 *  speech recognition only ever transcribes the language spoken. */
export function selectYouTubeTranslation<T extends YouTubeTrackChoice>(
    tracks: readonly T[],
    language: string
): T | null {
    return trackInLanguage(
        tracks.filter((track) => !track.asr),
        language
    );
}
