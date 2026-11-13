import { createLogger } from '@/shared/logger';
import {
    isSameLanguage,
    normalizeLanguageCode,
} from '@/shared/languageNormalization';
import { formatVtt, parseVtt, type VttCue } from '@/shared/vtt';
import {
    selectYouTubeOriginal,
    selectYouTubeTranslation,
} from '@/shared/youtubeTracks';
import { fetchAuthorizedSubtitleText } from '../fetch';
import type {
    SanitizedYouTubeTrack,
    YouTubeAuthorizedRequest,
} from '../policy';
import type { SubtitleProcessingResult } from '../service';
import { isCallerAbortError } from './netflix';

/** A ten-hour talk's speech-recognition track is about 5 MiB. */
export const MAX_YOUTUBE_VTT_BYTES = 8 * 1024 * 1024;

/** How long speech recognition shows a finished line on its own. */
const ASR_FLASH_MS = 10;

const logger = createLogger('YouTubeParser');

function toMilliseconds(seconds: number): number {
    return Math.round(seconds * 1000);
}

function collapseWhitespace(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

function foldsInto(flash: VttCue, next: VttCue): boolean {
    return (
        toMilliseconds(flash.end - flash.start) === ASR_FLASH_MS &&
        toMilliseconds(next.start) === toMilliseconds(flash.end) &&
        collapseWhitespace(next.text).startsWith(collapseWhitespace(flash.text))
    );
}

/**
 * Speech recognition rolls its captions: a finished line flashes alone for
 * 10 ms, then the next cue shows it again above the line that follows. A
 * flash that the next cue starts right after, and whose text the next cue's
 * text begins with, folds into that cue: it starts where the flash did and
 * keeps its own text. Every other cue stays as it is.
 */
export function consolidateAsrCues(cues: readonly VttCue[]): VttCue[] {
    const consolidated: VttCue[] = [];
    let carriedStart: number | null = null;
    cues.forEach((cue, index) => {
        const start = carriedStart ?? cue.start;
        carriedStart = null;
        const next = cues[index + 1];
        if (next && foldsInto(cue, next)) {
            carriedStart = start;
            return;
        }
        consolidated.push(start === cue.start ? cue : { ...cue, start });
    });
    return consolidated;
}

/** The track as WebVTT; YouTube answers an unusable request with an empty
 *  HTTP 200, so a body without cues fails. */
async function fetchTrackVtt(
    snapshot: YouTubeAuthorizedRequest,
    track: SanitizedYouTubeTrack,
    signal: AbortSignal | undefined
): Promise<string> {
    const { text } = await fetchAuthorizedSubtitleText(
        snapshot,
        track.downloadUrl,
        { stage: 'youtube-track', signal, maxBytes: MAX_YOUTUBE_VTT_BYTES }
    );
    const cues = parseVtt(text);
    if (cues.length === 0) {
        throw new Error('The YouTube caption track held no WebVTT cues');
    }
    return track.asr ? formatVtt(consolidateAsrCues(cues)) : text;
}

export async function processYouTubeSubtitles(
    snapshot: YouTubeAuthorizedRequest,
    options: { signal?: AbortSignal } = {}
): Promise<SubtitleProcessingResult> {
    const {
        tracks,
        targetLanguage,
        originalLanguage,
        useOfficialTranslations,
    } = snapshot;
    const signal = options.signal;

    const originalTrack = selectYouTubeOriginal(tracks, originalLanguage);
    if (!originalTrack) {
        throw new Error('No usable YouTube caption track was available');
    }
    if (!isSameLanguage(originalTrack.language, originalLanguage)) {
        logger.info(
            'Requested original language not found, using fallback track'
        );
    }

    const vttText = await fetchTrackVtt(snapshot, originalTrack, signal);
    const sourceLanguage = normalizeLanguageCode(originalTrack.language);

    let targetVttText: string | null = null;
    let useNativeTarget = false;
    const targetTrack =
        useOfficialTranslations &&
        !isSameLanguage(sourceLanguage, targetLanguage)
            ? selectYouTubeTranslation(tracks, targetLanguage)
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
                'Official YouTube target track failed; falling back to API translation',
                { stage: 'target-track' }
            );
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
