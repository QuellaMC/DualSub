export interface WordSpan {
    readonly word: string;
    readonly start: number;
    readonly end: number;
}

const segmenters = new Map<string, Intl.Segmenter>();

function segmenterFor(language: string): Intl.Segmenter {
    let segmenter = segmenters.get(language);
    if (!segmenter) {
        try {
            segmenter = new Intl.Segmenter(language, { granularity: 'word' });
        } catch {
            segmenter = new Intl.Segmenter('und', { granularity: 'word' });
        }
        segmenters.set(language, segmenter);
    }
    return segmenter;
}

/**
 * Word boundaries by locale rules, so scripts without spaces (Chinese,
 * Japanese, Thai) split into dictionary words instead of whole runs.
 * Punctuation and whitespace are never words.
 */
export function segmentWords(
    text: string,
    language: string
): readonly WordSpan[] {
    const words: WordSpan[] = [];
    for (const segment of segmenterFor(language).segment(text)) {
        if (segment.isWordLike) {
            words.push({
                word: segment.segment,
                start: segment.index,
                end: segment.index + segment.segment.length,
            });
        }
    }
    return words;
}

/** A painted subtitle line: its text and the language it is split in. */
export interface WordLine {
    readonly text: string;
    readonly language: string | null;
}

/** The words of a painted line, numbered as the line is painted: a word's
 *  index is its position here, wherever the line is split. */
export function lineWords(line: WordLine): readonly WordSpan[] {
    return segmentWords(line.text, line.language ?? 'und');
}
