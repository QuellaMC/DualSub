import type { ReactNode } from 'react';
import type {
    SelectionEntry,
    SelectionLine,
} from '@/messaging/contracts/selection';
import { lineWords, type WordSpan } from '@/shared/words';
import type { Translate } from '../hooks/useI18n';

/** A stretch of the line between spaces holding at most one word, with the
 *  punctuation around that word. */
interface Token {
    readonly from: number;
    readonly to: number;
    readonly word: number | null;
}

function tokensOf(text: string, words: readonly WordSpan[]): Token[] {
    const tokens: Token[] = [];
    for (const run of text.matchAll(/\S+/g)) {
        const end = run.index + run[0].length;
        let from = run.index;
        let word: number | null = null;
        for (const [index, span] of words.entries()) {
            if (span.start < run.index || span.end > end) {
                continue;
            }
            if (word !== null) {
                tokens.push({ from, to: span.start, word });
                from = span.start;
            }
            word = index;
        }
        tokens.push({ from, to: end, word });
    }
    return tokens;
}

/**
 * The subtitle line the words came from, each word a button that adds it
 * to the pick or takes it out, with the line's translation under it. Words
 * can be picked here only while the line is on screen; `onToggle` is null
 * otherwise. The spaces between tokens stay in the text, for reading and
 * copying, but the line lays them out of sight: the words' padding spaces
 * them, so picked words side by side join up.
 */
export function LineQuote({
    t,
    line,
    entries,
    onToggle,
}: {
    t: Translate;
    line: SelectionLine;
    entries: readonly SelectionEntry[];
    onToggle: ((wordIndex: number, picked: boolean) => void) | null;
}) {
    const picked = new Set(entries.map((entry) => entry.wordIndex));
    const words = lineWords(line);
    const parts: ReactNode[] = [];
    let cursor = 0;
    for (const { from, to, word } of tokensOf(line.text, words)) {
        parts.push(line.text.slice(cursor, from));
        cursor = to;
        if (word === null) {
            parts.push(
                <span key={from} className="token">
                    {line.text.slice(from, to)}
                </span>
            );
            continue;
        }
        const span = words[word]!;
        const on = picked.has(word);
        const lead = line.text.slice(from, span.start);
        const trail = line.text.slice(span.end, to);
        parts.push(
            <span key={from} className="token">
                {lead && <span className="lead">{lead}</span>}
                <button
                    type="button"
                    className="word"
                    aria-pressed={on}
                    disabled={onToggle === null}
                    title={
                        onToggle
                            ? t(on ? 'sidepanelRemoveWord' : 'sidepanelAddWord')
                            : undefined
                    }
                    onClick={() => onToggle?.(word, on)}
                >
                    {span.word}
                </button>
                {trail && <span className="trail">{trail}</span>}
            </span>
        );
    }
    parts.push(line.text.slice(cursor));
    return (
        <section className="quote" aria-label={t('sidepanelLineLabel')}>
            <p className="line" lang={line.language ?? undefined}>
                {parts}
            </p>
            {line.translation && (
                <p className="line-translation">{line.translation}</p>
            )}
        </section>
    );
}
