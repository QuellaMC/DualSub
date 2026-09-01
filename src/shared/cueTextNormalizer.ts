// Convert source-format cue markup into plain semantic text: line breaks
// preserved, markup stripped, entities decoded exactly once (double-decoding
// would let &amp;lt; become live markup downstream).

const TTML_BREAK_PATTERN = /<(?:[\w-]+:)?br\b[^>]*\/?\s*>/gi;
const RAW_XML_ELEMENT_PATTERN = /<[^>]*>/g;
const TTML_ENTITY_PATTERN =
    /&#x([0-9a-f]+);|&#(\d+);|&(amp|lt|gt|quot|apos);/gi;
const WEBVTT_ENTITY_PATTERN =
    /&#x([0-9a-f]+);|&#(\d+);|&(amp|lt|gt|quot|apos|nbsp|lrm|rlm);/gi;

const NAMED_ENTITY_VALUES: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lrm: '‎',
    lt: '<',
    nbsp: ' ',
    quot: '"',
    rlm: '‏',
};

export type CueSourceFormat = 'ttml' | 'webvtt';

export function normalizeCueLineEndings(
    rawText: string | null | undefined
): string {
    return (rawText ?? '').replace(/\r\n?/g, '\n');
}

function decodeNumericEntity(
    match: string,
    digits: string,
    radix: number
): string {
    const codePoint = Number.parseInt(digits, radix);
    if (
        !Number.isInteger(codePoint) ||
        codePoint < 0 ||
        codePoint > 0x10ffff ||
        (codePoint >= 0xd800 && codePoint <= 0xdfff)
    ) {
        return match;
    }
    return String.fromCodePoint(codePoint);
}

function decodeEntitiesOnce(
    text: string,
    sourceFormat: CueSourceFormat
): string {
    const entityPattern =
        sourceFormat === 'webvtt' ? WEBVTT_ENTITY_PATTERN : TTML_ENTITY_PATTERN;
    return text.replace(
        entityPattern,
        (
            match,
            hex: string | undefined,
            decimal: string | undefined,
            named: string | undefined
        ) => {
            if (hex !== undefined) {
                return decodeNumericEntity(match, hex, 16);
            }
            if (decimal !== undefined) {
                return decodeNumericEntity(match, decimal, 10);
            }
            return NAMED_ENTITY_VALUES[named!.toLowerCase()]!;
        }
    );
}

export function normalizeCueText(
    rawText: string | null | undefined,
    sourceFormat: CueSourceFormat
): string {
    const sourceText = normalizeCueLineEndings(rawText);
    let semanticText: string;

    if (sourceFormat === 'ttml') {
        semanticText = sourceText
            .split(TTML_BREAK_PATTERN)
            .map((line) =>
                line
                    .replace(RAW_XML_ELEMENT_PATTERN, '')
                    .replace(/\r?\n/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim()
            )
            .join('\n');
    } else {
        const textWithoutVttMarkup = sourceText
            .replace(/<br\b[^>]*\/?\s*>/gi, '\n')
            .replace(/<\/?(?:b|i|u|ruby|rt)\b[^>]*>/gi, '')
            .replace(/<c(?:\.[^>\s]+)*>|<\/c>/gi, '')
            .replace(/<v(?:\s+[^>]*)?>|<\/v>/gi, '')
            .replace(/<lang(?:\s+[^>]*)?>|<\/lang>/gi, '')
            .replace(/<\d{2,}:\d{2}(?::\d{2})?\.\d{3}>/g, '');

        semanticText = textWithoutVttMarkup
            .split('\n')
            .map((line) => line.replace(/[\t\f\v ]+/g, ' ').trim())
            .join('\n')
            .trim();
    }

    return decodeEntitiesOnce(semanticText, sourceFormat);
}
