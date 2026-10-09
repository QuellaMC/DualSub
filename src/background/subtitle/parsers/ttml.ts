import {
    AUTO_PLACEMENT,
    formatCueSettings,
    type CuePlacement,
} from '@/shared/cuePlacement';
import { normalizeCueText } from '@/shared/cueTextNormalizer';

// Netflix TTML (legacy DFXP and IMSC 1.1) → WebVTT: tick timestamps resolve
// against the document's ttp:tickRate, ruby readings are dropped so furigana
// never inlines into the cue, and each paragraph's region becomes the cue's
// line setting, so a cue the platform raises over on-screen text keeps its
// place.

export class TTMLConversionError extends Error {
    override readonly name = 'TTMLConversionError';

    constructor(message = 'TTML conversion failed.') {
        super(message);
    }
}

/** Netflix's historical tick rate, used when the document declares none. */
export const DEFAULT_TICK_RATE = 10_000_000;

type Attributes = Record<string, string>;

interface IntermediateCue {
    startMs: number;
    endMs: number;
    placement: CuePlacement;
    text: string;
}

function parseAttributes(attributeText: string): Attributes {
    const attributes = Object.create(null) as Attributes;
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

/** Every style's own attributes, by id. */
function parseStyles(ttmlText: string): Map<string, Attributes> {
    const styles = new Map<string, Attributes>();
    const styleRegex = /<(?:[\w-]+:)?style\b([^>]*)\/?\s*>/gi;
    let styleMatch: RegExpExecArray | null;
    while ((styleMatch = styleRegex.exec(ttmlText)) !== null) {
        const attributes = parseAttributes(styleMatch[1]!);
        const styleId = attributes['xml:id'] || attributes.id;
        if (styleId) {
            styles.set(styleId, attributes);
        }
    }
    return styles;
}

/** An element's attributes over those of the styles it references, each
 *  style over the ones it references in turn; a style met twice is a cycle
 *  and is not followed again. */
function withReferencedStyles(
    attributes: Attributes,
    styles: ReadonlyMap<string, Attributes>,
    visited: ReadonlySet<string> = new Set()
): Attributes {
    const merged = Object.create(null) as Attributes;
    for (const styleId of (attributes.style ?? '').split(/\s+/)) {
        const referenced = styles.get(styleId);
        if (referenced && !visited.has(styleId)) {
            Object.assign(
                merged,
                withReferencedStyles(
                    referenced,
                    styles,
                    new Set([...visited, styleId])
                )
            );
        }
    }
    return Object.assign(merged, attributes);
}

/** A `tts:origin` or `tts:extent` pair in percentages of the root
 *  container; null for any other unit. */
function parsePercentPair(value: string): [number, number] | null {
    const parts = value.trim().split(/\s+/);
    const first = /^(-?\d+(?:\.\d+)?)%$/.exec(parts[0] ?? '');
    const second = /^(-?\d+(?:\.\d+)?)%$/.exec(parts[1] ?? '');
    return parts.length === 2 && first && second
        ? [Number(first[1]), Number(second[1])]
        : null;
}

/** A region's vertical anchor: the edge of its box that tts:displayAlign
 *  puts the text against. A region declaring no layout, or a length the
 *  model cannot read, leaves its cues at the automatic placement. */
function parseRegionPlacement(attributes: Attributes): CuePlacement {
    const originText = attributes['tts:origin'];
    const extentText = attributes['tts:extent'];
    const origin =
        originText === undefined ? undefined : parsePercentPair(originText);
    const extent =
        extentText === undefined ? undefined : parsePercentPair(extentText);
    const displayAlign = attributes['tts:displayalign'];
    if (
        origin === null ||
        extent === null ||
        (!origin && !extent && !displayAlign)
    ) {
        return AUTO_PLACEMENT;
    }
    const top = (origin?.[1] ?? 0) / 100;
    const bottom = extent ? top + extent[1] / 100 : 1;
    switch (displayAlign) {
        case 'after':
            return { line: bottom, lineAlign: 'end' };
        case 'center':
            return { line: (top + bottom) / 2, lineAlign: 'center' };
        default:
            return { line: top, lineAlign: 'start' };
    }
}

function parseRegionPlacements(
    ttmlText: string,
    styles: ReadonlyMap<string, Attributes>
): Map<string, CuePlacement> {
    const placements = new Map<string, CuePlacement>();
    const regionRegex = /<(?:[\w-]+:)?region\b([^>]*)\/?\s*>/gi;
    let regionMatch: RegExpExecArray | null;
    while ((regionMatch = regionRegex.exec(ttmlText)) !== null) {
        const attributes = parseAttributes(regionMatch[1]!);
        const regionId = attributes['xml:id'] || attributes.id;
        if (regionId) {
            placements.set(
                regionId,
                parseRegionPlacement(withReferencedStyles(attributes, styles))
            );
        }
    }
    return placements;
}

/** The region inherited at a document offset from the nearest enclosing
 *  div or body. Offsets must be asked in document order. */
function regionScopes(
    ttmlText: string
): (offset: number) => string | undefined {
    const events: {
        readonly index: number;
        readonly closing: boolean;
        readonly region: string | undefined;
    }[] = [];
    const tagRegex = /<(\/?)(?:[\w-]+:)?(?:body|div)\b([^>]*)>/gi;
    let match: RegExpExecArray | null;
    while ((match = tagRegex.exec(ttmlText)) !== null) {
        const closing = match[1] === '/';
        if (closing || !/\/\s*$/.test(match[2]!)) {
            events.push({
                index: match.index,
                closing,
                region: closing ? undefined : parseAttributes(match[2]!).region,
            });
        }
    }
    const stack: (string | undefined)[] = [];
    let next = 0;
    return (offset) => {
        for (
            ;
            next < events.length && events[next]!.index < offset;
            next += 1
        ) {
            const event = events[next]!;
            if (event.closing) {
                stack.pop();
            } else {
                stack.push(event.region ?? stack[stack.length - 1]);
            }
        }
        return stack[stack.length - 1];
    };
}

const RUBY_ANNOTATION_ROLES = new Set(['text', 'delimiter']);

/** Whether an element carries a ruby reading or its delimiter, inline or
 *  through its styles. */
function isRubyAnnotation(
    attributes: Attributes,
    styles: ReadonlyMap<string, Attributes>
): boolean {
    return RUBY_ANNOTATION_ROLES.has(
        withReferencedStyles(attributes, styles)['tts:ruby'] ?? ''
    );
}

/** Remove spans that carry a ruby reading. Such spans hold text only, so a
 *  non-nesting match is exact. */
function stripRubyAnnotations(
    paragraphText: string,
    styles: ReadonlyMap<string, Attributes>
): string {
    return paragraphText.replace(
        /<(?:[\w-]+:)?span\b([^>]*)>[^<]*<\/(?:[\w-]+:)?span>/gi,
        (match, attributeText: string) =>
            isRubyAnnotation(parseAttributes(attributeText), styles)
                ? ''
                : match
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
    styles: ReadonlyMap<string, Attributes>,
    regionPlacements: ReadonlyMap<string, CuePlacement>
): IntermediateCue[] {
    const intermediateCues: IntermediateCue[] = [];
    const regionAt = regionScopes(ttmlText);
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
        const region = attributes.region ?? regionAt(pMatch.index);
        intermediateCues.push({
            startMs,
            endMs,
            placement:
                (region === undefined
                    ? undefined
                    : regionPlacements.get(region)) ?? AUTO_PLACEMENT,
            text: normalizeCueText(
                stripRubyAnnotations(pMatch[2]!, styles),
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

    const styles = parseStyles(ttmlText);
    const cues = parsePElements(
        ttmlText,
        parseTickRate(ttmlText),
        styles,
        parseRegionPlacements(ttmlText, styles)
    );
    if (cues.length === 0) {
        throw new TTMLConversionError(
            'TTML conversion failed: No valid TTML subtitle entries found'
        );
    }
    cues.sort((a, b) => a.startMs - b.startMs);

    let vtt = 'WEBVTT\n\n';
    for (const cue of cues) {
        const settings = formatCueSettings(cue.placement);
        vtt += `${formatMillisecondsAsVtt(cue.startMs)} --> ${formatMillisecondsAsVtt(cue.endMs)}${settings === '' ? '' : ` ${settings}`}\n`;
        vtt += `${encodeVttText(cue.text)}\n\n`;
    }
    return vtt;
}
