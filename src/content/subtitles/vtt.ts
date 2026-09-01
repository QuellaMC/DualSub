import {
    normalizeCueLineEndings,
    normalizeCueText,
} from '@/shared/cueTextNormalizer';

export interface VttCue {
    start: number;
    end: number;
    text: string;
}

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
        let timestampLine: string;
        let textLines: string[];
        if (lines[0]!.includes('-->')) {
            timestampLine = lines[0]!;
            textLines = lines.slice(1);
        } else if (lines.length > 1 && lines[1]!.includes('-->')) {
            timestampLine = lines[1]!;
            textLines = lines.slice(2);
        } else {
            continue;
        }

        const timeParts = timestampLine.trim().split(/[ \t]+-->[ \t]+/);
        if (timeParts.length !== 2) {
            continue;
        }
        const start = parseTimestampToSeconds(timeParts[0]!);
        const end = parseTimestampToSeconds(timeParts[1]!.split(/[ \t]+/)[0]!);
        const text = normalizeCueText(textLines.join('\n'), 'webvtt');

        if (text && start !== null && end !== null && end > start) {
            cues.push({ start, end, text });
        }
    }
    return cues;
}
