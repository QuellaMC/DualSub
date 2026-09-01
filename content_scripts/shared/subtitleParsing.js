import {
    normalizeCueLineEndings,
    normalizeCueText,
} from '../../utils/cueTextNormalizer.js';

export function parseTimestampToSeconds(timestamp) {
    if (typeof timestamp !== 'string') return null;

    const match = timestamp.match(/^(?:(\d{2,}):)?(\d{2}):(\d{2})\.(\d{3})$/);
    if (!match) return null;

    const hours = match[1] === undefined ? 0 : Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    const milliseconds = Number(match[4]);
    if (minutes >= 60 || seconds >= 60) return null;

    const total = hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
    return Number.isFinite(total) ? total : null;
}

export function parseVTT(vttString) {
    const vtt =
        typeof vttString === 'string' ? normalizeCueLineEndings(vttString) : '';
    if (!vtt.trim().toUpperCase().startsWith('WEBVTT')) return [];

    const cues = [];
    for (const block of vtt.split(/\n{2,}/)) {
        const lines = block.split('\n');
        const timingIndex = lines.findIndex((line) => line.includes('-->'));
        if (timingIndex === -1) continue;

        const timingParts = lines[timingIndex].trim().split(/[ \t]+-->[ \t]+/);
        if (timingParts.length !== 2) continue;

        const start = parseTimestampToSeconds(timingParts[0]);
        const [endTimestamp] = timingParts[1].split(/[ \t]+/);
        const end = parseTimestampToSeconds(endTimestamp);
        const text = normalizeCueText(
            lines.slice(timingIndex + 1).join('\n'),
            'webvtt'
        );

        if (
            text &&
            Number.isFinite(start) &&
            Number.isFinite(end) &&
            end > start
        ) {
            cues.push({ start, end, text });
        }
    }

    return cues;
}
