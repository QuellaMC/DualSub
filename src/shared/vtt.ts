import {
    formatCueSettings,
    parseCueSettings,
    type CuePlacement,
} from '@/shared/cuePlacement';
import {
    normalizeCueLineEndings,
    normalizeCueText,
} from '@/shared/cueTextNormalizer';

export interface VttCue {
    start: number;
    end: number;
    text: string;
    placement: CuePlacement;
}

const TIMING_LINE_PATTERN = /^(\S+)[ \t]+-->[ \t]+(\S+)(?:[ \t]+(.*))?$/;

/** WebVTT cue-boundary timestamp forms: [HH:]MM:SS.mmm */
export function parseTimestampToSeconds(timestamp: string): number | null {
    const match = /^(?:(\d{2,}):)?(\d{2}):(\d{2})\.(\d{3})$/.exec(timestamp);
    if (!match) {
        return null;
    }
    const hours = match[1] === undefined ? 0 : Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    const milliseconds = Number(match[4]);
    if (minutes >= 60 || seconds >= 60) {
        return null;
    }
    const total = hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
    return Number.isFinite(total) ? total : null;
}

export function parseVtt(vttString: string): VttCue[] {
    const normalizedVtt = normalizeCueLineEndings(vttString);
    if (!normalizedVtt.trim().toUpperCase().startsWith('WEBVTT')) {
        return [];
    }

    const cues: VttCue[] = [];
    for (const block of normalizedVtt.split(/\n{2,}/)) {
        if (!block.includes('-->')) {
            continue;
        }
        const lines = block.split('\n');
        let timingLine: string;
        let textLines: string[];
        if (lines[0]!.includes('-->')) {
            timingLine = lines[0]!;
            textLines = lines.slice(1);
        } else if (lines.length > 1 && lines[1]!.includes('-->')) {
            timingLine = lines[1]!;
            textLines = lines.slice(2);
        } else {
            continue;
        }

        const timing = TIMING_LINE_PATTERN.exec(timingLine.trim());
        if (!timing) {
            continue;
        }
        const start = parseTimestampToSeconds(timing[1]!);
        const end = parseTimestampToSeconds(timing[2]!);
        const text = normalizeCueText(textLines.join('\n'), 'webvtt');

        if (text && start !== null && end !== null && end > start) {
            cues.push({
                start,
                end,
                text,
                placement: parseCueSettings(timing[3] ?? ''),
            });
        }
    }
    return cues;
}

function formatTimestamp(seconds: number): string {
    const totalMilliseconds = Math.round(seconds * 1000);
    const hours = Math.floor(totalMilliseconds / 3_600_000);
    const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
    const wholeSeconds = Math.floor((totalMilliseconds % 60_000) / 1000);
    const milliseconds = totalMilliseconds % 1000;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
}

/** Plain cue text as WebVTT carries it: markup characters escaped, so a
 *  literal `<tag>` never becomes markup, and no blank line, which would end
 *  the cue. */
function encodeCueText(text: string): string {
    return text
        .split('\n')
        .filter((line) => line !== '')
        .join('\n')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/** WebVTT for `cues`, which `parseVtt` reads back as written. */
export function formatVtt(cues: readonly VttCue[]): string {
    let vtt = 'WEBVTT\n\n';
    for (const cue of cues) {
        const settings = formatCueSettings(cue.placement);
        vtt += `${formatTimestamp(cue.start)} --> ${formatTimestamp(cue.end)}${settings === '' ? '' : ` ${settings}`}\n`;
        vtt += `${encodeCueText(cue.text)}\n\n`;
    }
    return vtt;
}
