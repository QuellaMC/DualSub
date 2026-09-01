import { loggingManager } from '../utils/loggingManager.js';
import { normalizeCueText } from '../../utils/cueTextNormalizer.js';

const CONVERSION_ERRORS = {
    generic: 'TTML conversion failed.',
    noEntries: 'TTML conversion failed: No valid TTML subtitle entries found',
    unsupportedTimestamp: 'TTML conversion failed: Unsupported TTML timestamp',
    invalidCueRange: 'TTML conversion failed: Invalid TTML cue range',
};

class TTMLConversionError extends Error {
    constructor(message = CONVERSION_ERRORS.generic) {
        super(message);
        this.name = 'TTMLConversionError';
    }
}

function parseAttributes(attributeText) {
    const attributes = Object.create(null);
    const pattern = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let match;
    while ((match = pattern.exec(attributeText)) !== null) {
        attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? '';
    }
    return attributes;
}

function parseRegionLayouts(ttmlText) {
    const layouts = new Map();
    const pattern = /<(?:[\w-]+:)?region\b([^>]*)\/?\s*>/gi;
    let match;
    while ((match = pattern.exec(ttmlText)) !== null) {
        const attributes = parseAttributes(match[1]);
        const id = attributes['xml:id'] || attributes.id;
        const [rawX, rawY] = String(attributes['tts:origin'] || '').split(
            /\s+/
        );
        const x = Number.parseFloat(rawX);
        const y = Number.parseFloat(rawY);
        if (id && Number.isFinite(x) && Number.isFinite(y)) {
            layouts.set(id, { x, y });
        }
    }
    return layouts;
}

function parseCues(ttmlText) {
    const cues = [];
    const pattern = /<(?:[\w-]+:)?p\b([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?p>/gi;
    let match;
    while ((match = pattern.exec(ttmlText)) !== null) {
        const attributes = parseAttributes(match[1]);
        if (!attributes.begin || !attributes.end) continue;
        cues.push({
            begin: attributes.begin,
            end: attributes.end,
            region: attributes.region || '',
            text: normalizeCueText(match[2], 'ttml'),
        });
    }
    return cues;
}

function parseTime(value) {
    const time = String(value).trim().replace(',', '.');
    const tick = time.match(/^(\d+(?:\.\d+)?)t$/i);
    if (tick) return Number(tick[1]) / 10_000_000;

    const clock = time.match(/^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/);
    if (clock) {
        const minutes = Number(clock[2]);
        const seconds = Number(clock[3]);
        if (minutes >= 60 || seconds >= 60) return Number.NaN;
        return Number(clock[1]) * 3600 + minutes * 60 + seconds;
    }

    const offset = time.match(/^(\d+(?:\.\d+)?)(h|m|s|ms)$/i);
    if (!offset) return Number.NaN;
    const multiplier = { h: 3600, m: 60, s: 1, ms: 0.001 }[
        offset[2].toLowerCase()
    ];
    return Number(offset[1]) * multiplier;
}

function formatTime(totalMilliseconds) {
    const hours = Math.floor(totalMilliseconds / 3_600_000);
    const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
    const seconds = Math.floor((totalMilliseconds % 60_000) / 1000);
    const milliseconds = totalMilliseconds % 1000;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
}

function encodeVttText(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function mergeCues(cues, layouts) {
    const groups = new Map();
    for (const cue of cues) {
        const key = JSON.stringify([cue.begin, cue.end]);
        const group = groups.get(key) || [];
        group.push(cue);
        groups.set(key, group);
    }

    return Array.from(groups, ([key, group]) => {
        group.sort((left, right) => {
            const a = layouts.get(left.region) || { x: 999, y: 999 };
            const b = layouts.get(right.region) || { x: 999, y: 999 };
            return a.y - b.y || a.x - b.x;
        });
        const [begin, end] = JSON.parse(key);
        return {
            begin,
            end,
            text: group
                .map((cue) => cue.text)
                .join(' ')
                .trim(),
        };
    });
}

function buildVtt(cues) {
    cues.sort((a, b) => parseTime(a.begin) - parseTime(b.begin));
    let output = 'WEBVTT\n\n';
    for (const cue of cues) {
        const start = Math.round(parseTime(cue.begin) * 1000);
        const end = Math.round(parseTime(cue.end) * 1000);
        if (!Number.isFinite(start) || start < 0 || !Number.isFinite(end)) {
            throw new TTMLConversionError(
                CONVERSION_ERRORS.unsupportedTimestamp
            );
        }
        if (end <= start) {
            throw new TTMLConversionError(CONVERSION_ERRORS.invalidCueRange);
        }
        output += `${formatTime(start)} --> ${formatTime(end)}\n`;
        output += `${encodeVttText(cue.text)}\n\n`;
    }
    return output;
}

class TTMLParser {
    constructor() {
        this.logger = loggingManager.createLogger('TTMLParser');
    }

    convertTtmlToVtt(ttmlText) {
        if (typeof ttmlText !== 'string' || ttmlText.trim() === '') {
            throw new Error('TTML input must be a non-empty string');
        }

        try {
            const cues = parseCues(ttmlText);
            if (cues.length === 0) {
                throw new TTMLConversionError(CONVERSION_ERRORS.noEntries);
            }
            const vtt = buildVtt(mergeCues(cues, parseRegionLayouts(ttmlText)));
            this.logger.info('TTML to VTT conversion complete', {
                cueCount: cues.length,
                vttLength: vtt.length,
            });
            return vtt;
        } catch (error) {
            this.logger.error('TTML conversion failed', {
                inputLength: ttmlText.length,
            });
            if (error instanceof TTMLConversionError) throw error;
            throw new TTMLConversionError();
        }
    }
}

export const ttmlParser = new TTMLParser();
