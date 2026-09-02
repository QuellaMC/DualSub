import { normalizeCueText } from '@/shared/cueTextNormalizer';

// Netflix TTML (legacy DFXP and IMSC 1.1) → WebVTT: tick timestamps resolve
// against the document's ttp:tickRate, ruby readings are dropped so furigana
// never inlines into the cue, and region layouts give same-timestamp cues a
// stable top-to-bottom, left-to-right merge order.

export class TTMLConversionError extends Error {
    override readonly name = 'TTMLConversionError';

    constructor(message = 'TTML conversion failed.') {
        super(message);
    }
}

/** Netflix's historical tick rate, used when the document declares none. */
export const DEFAULT_TICK_RATE = 10_000_000;

interface RegionLayout {
    x: number;
    y: number;
}

interface IntermediateCue {
    startMs: number;
    endMs: number;
    region: string;
    text: string;
}

function parseAttributes(attributeText: string): Record<string, string> {
    const attributes = Object.create(null) as Record<string, string>;
    const attributeRegex = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let match: RegExpExecArray | null;
    while ((match = attributeRegex.exec(attributeText)) !== null) {
        attributes[match[1]!.toLowerCase()] = match[2] ?? match[3] ?? '';
    }
    return attributes;
}

function parseTickRate(ttmlText: string): number {
    const rootMatch = /<(?:[\w-]+:)?tt\b([^>]*)>/i.exec(ttmlText);
    if (!rootMatch) {
        return DEFAULT_TICK_RATE;
    }
    const declared = Number(parseAttributes(rootMatch[1]!)['ttp:tickrate']);
    return Number.isFinite(declared) && declared > 0
        ? declared
        : DEFAULT_TICK_RATE;
}

function parseRegionLayouts(ttmlText: string): Map<string, RegionLayout> {
    const regionLayouts = new Map<string, RegionLayout>();
    const regionRegex = /<(?:[\w-]+:)?region\b([^>]*)\/?\s*>/gi;
    let regionMatch: RegExpExecArray | null;

    while ((regionMatch = regionRegex.exec(ttmlText)) !== null) {
        const attributes = parseAttributes(regionMatch[1]!);
        const regionId = attributes['xml:id'] || attributes.id;
        const origin = String(attributes['tts:origin'] ?? '').split(/\s+/);
        if (origin.length === 2) {
            const x = parseFloat(origin[0]!);
            const y = parseFloat(origin[1]!);
            if (!regionId || !Number.isFinite(x) || !Number.isFinite(y)) {
                continue;
            }
            regionLayouts.set(regionId, { x, y });
        }
    }
    return regionLayouts;
}

const RUBY_ANNOTATION_ROLES = new Set(['text', 'delimiter']);

/** Style ids whose tts:ruby role is a reading or its delimiter. */
function parseRubyAnnotationStyles(ttmlText: string): Set<string> {
    const styles = new Set<string>();
    const styleRegex = /<(?:[\w-]+:)?style\b([^>]*)\/?\s*>/gi;
    let styleMatch: RegExpExecArray | null;
    while ((styleMatch = styleRegex.exec(ttmlText)) !== null) {
        const attributes = parseAttributes(styleMatch[1]!);
        const styleId = attributes['xml:id'] || attributes.id;
        if (
            styleId &&
            RUBY_ANNOTATION_ROLES.has(attributes['tts:ruby'] ?? '')
        ) {
            styles.add(styleId);
        }
    }
    return styles;
}

/** Remove spans that carry a ruby reading (inline role or via style). Such
 *  spans hold text only, so a non-nesting match is exact. */
function stripRubyAnnotations(
    paragraphText: string,
    annotationStyles: Set<string>
): string {
    return paragraphText.replace(
        /<(?:[\w-]+:)?span\b([^>]*)>[^<]*<\/(?:[\w-]+:)?span>/gi,
        (match, attributeText: string) => {
            const attributes = parseAttributes(attributeText);
            const styleIds = (attributes.style ?? '').split(/\s+/);
            return RUBY_ANNOTATION_ROLES.has(attributes['tts:ruby'] ?? '') ||
                styleIds.some((styleId) => annotationStyles.has(styleId))
                ? ''
                : match;
        }
    );
}

export function parseTtmlTimeToSeconds(
    ttmlTime: string,
    tickRate: number = DEFAULT_TICK_RATE
): number {
    const value = String(ttmlTime).trim().replace(',', '.');
    const tickMatch = /^(\d+(?:\.\d+)?)t$/i.exec(value);
    if (tickMatch) {
        return Number(tickMatch[1]) / tickRate;
    }

    const clockMatch = /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(value);
    if (clockMatch) {
        const minutes = Number(clockMatch[2]);
        const seconds = Number(clockMatch[3]);
        if (minutes >= 60 || seconds >= 60) {
            return Number.NaN;
        }
        return Number(clockMatch[1]) * 3600 + minutes * 60 + seconds;
    }

    const offsetMatch = /^(\d+(?:\.\d+)?)(h|m|s|ms)$/i.exec(value);
    if (!offsetMatch) {
        return Number.NaN;
    }
    const multipliers: Record<string, number> = {
        h: 3600,
        m: 60,
        s: 1,
        ms: 0.001,
    };
    return Number(offsetMatch[1]) * multipliers[offsetMatch[2]!.toLowerCase()]!;
}

function toMilliseconds(ttmlTime: string, tickRate: number): number {
    const milliseconds = Math.round(
        parseTtmlTimeToSeconds(ttmlTime, tickRate) * 1000
    );
    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
        throw new TTMLConversionError(
            'TTML conversion failed: Unsupported TTML timestamp'
        );
    }
    return milliseconds;
}

function parsePElements(
    ttmlText: string,
    tickRate: number,
    annotationStyles: Set<string>
): IntermediateCue[] {
    const intermediateCues: IntermediateCue[] = [];
    const pElementRegex =
        /<(?:[\w-]+:)?p\b([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?p>/gi;
    let pMatch: RegExpExecArray | null;

    while ((pMatch = pElementRegex.exec(ttmlText)) !== null) {
        const attributes = parseAttributes(pMatch[1]!);
        const { begin, end, dur } = attributes;
        if (!begin || (!end && !dur)) {
            continue;
        }
        const startMs = toMilliseconds(begin, tickRate);
        const endMs = end
            ? toMilliseconds(end, tickRate)
            : startMs + toMilliseconds(dur!, tickRate);
        if (endMs <= startMs) {
            throw new TTMLConversionError(
                'TTML conversion failed: Invalid TTML cue range'
            );
        }
        intermediateCues.push({
            startMs,
            endMs,
            region: attributes.region ?? '',
            text: normalizeCueText(
                stripRubyAnnotations(pMatch[2]!, annotationStyles),
                'ttml'
            ),
        });
    }
    return intermediateCues;
}

function formatMillisecondsAsVtt(totalMilliseconds: number): string {
    const hours = Math.floor(totalMilliseconds / 3_600_000);
    const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
    const wholeSeconds = Math.floor((totalMilliseconds % 60_000) / 1000);
    const milliseconds = totalMilliseconds % 1000;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
}

function encodeVttText(text: string): string {
    // Cue text is plain TTML semantic text. Encode it for the intermediate
    // VTT transport so decoded literals such as <tag> cannot become markup.
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

export function convertTtmlToVtt(ttmlText: string): string {
    if (typeof ttmlText !== 'string' || ttmlText.trim() === '') {
        throw new TTMLConversionError('TTML input must be a non-empty string');
    }

    const regionLayouts = parseRegionLayouts(ttmlText);
    const intermediateCues = parsePElements(
        ttmlText,
        parseTickRate(ttmlText),
        parseRubyAnnotationStyles(ttmlText)
    );
    if (intermediateCues.length === 0) {
        throw new TTMLConversionError(
            'TTML conversion failed: No valid TTML subtitle entries found'
        );
    }

    const groupedByTime = new Map<string, IntermediateCue[]>();
    for (const cue of intermediateCues) {
        const key = `${cue.startMs}-${cue.endMs}`;
        const group = groupedByTime.get(key);
        if (group) {
            group.push(cue);
        } else {
            groupedByTime.set(key, [cue]);
        }
    }

    const finalCues = [...groupedByTime.values()].map((group) => {
        group.sort((a, b) => {
            const regionA = regionLayouts.get(a.region) ?? { y: 999, x: 999 };
            const regionB = regionLayouts.get(b.region) ?? { y: 999, x: 999 };
            return regionA.y - regionB.y || regionA.x - regionB.x;
        });
        return {
            startMs: group[0]!.startMs,
            endMs: group[0]!.endMs,
            text: group
                .map((cue) => cue.text)
                .join(' ')
                .trim(),
        };
    });
    finalCues.sort((a, b) => a.startMs - b.startMs);

    let vtt = 'WEBVTT\n\n';
    for (const cue of finalCues) {
        vtt += `${formatMillisecondsAsVtt(cue.startMs)} --> ${formatMillisecondsAsVtt(cue.endMs)}\n`;
        vtt += `${encodeVttText(cue.text)}\n\n`;
    }
    return vtt;
}
