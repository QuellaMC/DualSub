import { createLogger } from '@/shared/logger';
import { normalizeLanguageCode } from '@/shared/languageNormalization';
import { FetchAbortedError } from '@/shared/fetchWithTimeout';
import { fetchAuthorizedSubtitleText } from '../fetch';
import type {
    NetflixAuthorizedRequest,
    SanitizedNetflixTrack,
} from '../policy';
import { convertTtmlToVtt } from './ttml';
import type { SubtitleProcessingResult } from '../service';

// Provisional security ceiling only: no authoritative Netflix TTML body
// limit exists, and this value has not been validated against live
// long-form catalog telemetry.
export const MAX_NETFLIX_TTML_BYTES = 2 * 1024 * 1024;

const logger = createLogger('NetflixParser');

export function isCallerAbortError(error: unknown): boolean {
    return (
        error instanceof FetchAbortedError ||
        (error instanceof Error &&
            (error as { code?: unknown }).code === 'ERR_FETCH_ABORTED')
    );
}

/** PRIMARY beats ASSISTIVE beats first-listed, within a normalized language. */
function getBestTrackForLanguage(
    tracks: readonly SanitizedNetflixTrack[],
    languageCode: string
): SanitizedNetflixTrack | null {
    const normalizedRequested = normalizeLanguageCode(languageCode);
    const matching = tracks.filter(
        (track) => normalizeLanguageCode(track.language) === normalizedRequested
    );
    if (matching.length === 0) {
        return null;
    }
    return (
        matching.find((track) => track.trackType === 'PRIMARY') ??
        matching.find((track) => track.trackType === 'ASSISTIVE') ??
        matching[0]!
    );
}

async function fetchTrackVtt(
    snapshot: NetflixAuthorizedRequest,
    track: SanitizedNetflixTrack,
    signal: AbortSignal | undefined
): Promise<string> {
    const { text } = await fetchAuthorizedSubtitleText(
        snapshot,
        track.downloadUrl,
        { stage: 'netflix-track', signal, maxBytes: MAX_NETFLIX_TTML_BYTES }
    );
    return convertTtmlToVtt(text);
}

export async function processNetflixSubtitles(
    snapshot: NetflixAuthorizedRequest,
    options: { signal?: AbortSignal } = {}
): Promise<SubtitleProcessingResult> {
    const {
        tracks,
        targetLanguage,
        originalLanguage,
        useOfficialTranslations,
    } = snapshot;
    const signal = options.signal;

    // Fallback chain for the original track: requested language → English →
    // first available. Policy guarantees at least one track exists.
    let originalTrack = getBestTrackForLanguage(tracks, originalLanguage);
    if (!originalTrack) {
        originalTrack =
            tracks.find((track) =>
                normalizeLanguageCode(track.language).startsWith('en')
            ) ??
            tracks[0] ??
            null;
        if (originalTrack) {
            logger.info(
                'Requested original language not found, using fallback track'
            );
        }
    }
    if (!originalTrack) {
        throw new Error('No usable Netflix subtitle track was available');
    }

    const vttText = await fetchTrackVtt(snapshot, originalTrack, signal);
    const sourceLanguage = normalizeLanguageCode(originalTrack.language);

    // Default to API translation so an optional official target failure can
    // never discard the already-valid original subtitles.
    let targetVttText: string | null = null;
    let useNativeTarget = false;

    const targetTrack = useOfficialTranslations
        ? getBestTrackForLanguage(tracks, targetLanguage)
        : null;
    if (targetTrack) {
        try {
            targetVttText = await fetchTrackVtt(snapshot, targetTrack, signal);
            useNativeTarget = true;
        } catch (error) {
            if (isCallerAbortError(error)) {
                throw error;
            }
            logger.warn(
                'Official Netflix target track failed; falling back to API translation',
                { stage: 'target-track' }
            );
            targetVttText = null;
        }
    }

    return {
        vttText,
        targetVttText,
        sourceLanguage,
        targetLanguage: normalizeLanguageCode(targetLanguage),
        useNativeTarget,
        selectedLanguage: {
            normalizedCode: sourceLanguage,
            displayName: originalTrack.displayName,
        },
    };
}
