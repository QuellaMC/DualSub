import type {
    SelectionEntry,
    SelectionLine,
} from '@/messaging/contracts/selection';
import { lineWords } from '@/shared/words';

/** The picked words as they read in their line: one stretch of the line
 *  when they stand side by side, so a phrase keeps its own spacing and
 *  apostrophes, otherwise the words in order. */
export function pickedText(
    line: SelectionLine,
    entries: readonly SelectionEntry[]
): string {
    const words = lineWords(line);
    const first = words[entries[0]?.wordIndex ?? -1];
    const last = words[entries.at(-1)?.wordIndex ?? -1];
    const sideBySide = entries.every(
        (entry, index) =>
            index === 0 || entry.wordIndex === entries[index - 1]!.wordIndex + 1
    );
    return first && last && sideBySide
        ? line.text.slice(first.start, last.end).replace(/\s+/g, ' ')
        : entries.map((entry) => entry.word).join(' ');
}

/** What a lookup or an explanation is about: these words of this line, in
 *  its language. A new translation of the line leaves it the same. */
export function pickedSubject(
    line: SelectionLine,
    entries: readonly SelectionEntry[]
): string {
    return JSON.stringify([
        line.text,
        line.language,
        entries.map((entry) => entry.wordIndex),
    ]);
}
