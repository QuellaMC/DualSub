const TTML_BREAK_PATTERN = /<(?:[\w-]+:)?br\b[^>]*\/?\s*>/gi;
const RAW_XML_ELEMENT_PATTERN = /<[^>]*>/g;
const TTML_ENTITY_PATTERN =
    /&#x([0-9a-f]+);|&#(\d+);|&(amp|lt|gt|quot|apos);/gi;
const WEBVTT_ENTITY_PATTERN =
    /&#x([0-9a-f]+);|&#(\d+);|&(amp|lt|gt|quot|apos|nbsp|lrm|rlm);/gi;

const NAMED_ENTITY_VALUES = Object.freeze({
    amp: '&',
    apos: "'",
    gt: '>',
    lrm: '\u200e',
    lt: '<',
    nbsp: '\u00a0',
    quot: '"',
    rlm: '\u200f',
});

const UNSUPPORTED_SOURCE_FORMAT_MESSAGE = 'Unsupported cue text source format';

export function normalizeCueLineEndings(rawText) {
    return String(rawText ?? '').replace(/\r\n?/g, '\n');
}

function decodeNumericEntity(match, digits, radix) {
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

function decodeEntitiesOnce(text, sourceFormat) {
    const entityPattern =
        sourceFormat === 'webvtt' ? WEBVTT_ENTITY_PATTERN : TTML_ENTITY_PATTERN;

    return text.replace(entityPattern, (match, hex, decimal, namedEntity) => {
        if (hex !== undefined) {
            return decodeNumericEntity(match, hex, 16);
        }
        if (decimal !== undefined) {
            return decodeNumericEntity(match, decimal, 10);
        }
        return NAMED_ENTITY_VALUES[namedEntity.toLowerCase()];
    });
}

/**
 * Convert source-format cue text into plain semantic text.
 *
 * @param {string} rawText
 * @param {'ttml' | 'webvtt'} sourceFormat
 * @returns {string}
 */
export function normalizeCueText(rawText, sourceFormat) {
    if (sourceFormat !== 'ttml' && sourceFormat !== 'webvtt') {
        throw new TypeError(UNSUPPORTED_SOURCE_FORMAT_MESSAGE);
    }

    const sourceText = normalizeCueLineEndings(rawText);
    let semanticText;

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
