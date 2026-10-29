import { useEffect } from 'react';
import { sendWithRetry } from '@/messaging/client';
import { lookupWords } from '@/messaging/contracts/lookupWords';
import { pickedText } from './picked';
import type { Lookup, PanelHandle } from './usePanelConnection';

/** One lookup is the same as another for the same words of the same line
 *  in the same target language; a new translation of the line is not a
 *  new lookup. */
function sameLookup(left: Lookup, right: Omit<Lookup, 'result'>): boolean {
    return (
        left.text === right.text &&
        left.targetLanguage === right.targetLanguage &&
        left.line.text === right.line.text &&
        left.line.language === right.line.language &&
        left.entries.length === right.entries.length &&
        left.entries.every(
            (entry, index) =>
                entry.wordIndex === right.entries[index]!.wordIndex
        )
    );
}

/**
 * Looks up the words picked in the bound tab: their translation and
 * dictionary entries. A lookup belongs to its tab and words; an answer for
 * words no longer picked is dropped.
 */
export function useLookup(
    panel: PanelHandle,
    targetLanguage: string | null
): void {
    const { activeTabId, tab, updateTab } = panel;
    const { selection, lookup: shown } = tab;

    useEffect(() => {
        const line = selection?.line ?? null;
        const entries = selection?.entries ?? [];
        if (
            activeTabId === null ||
            !line ||
            entries.length === 0 ||
            !targetLanguage
        ) {
            return;
        }
        const wanted = {
            entries,
            line,
            text: pickedText(line, entries),
            targetLanguage,
        };
        if (shown && sameLookup(shown, wanted)) {
            return;
        }
        const lookup: Lookup = { ...wanted, result: null };
        updateTab(activeTabId, { lookup });
        const settle = (result: Lookup['result']) =>
            updateTab(activeTabId, (state) =>
                state.lookup === lookup
                    ? { lookup: { ...lookup, result } }
                    : null
            );
        void sendWithRetry(
            lookupWords,
            {
                action: 'lookupWords',
                text: lookup.text,
                language: line.language,
                targetLanguage,
            },
            { retries: 0, pingBeforeRetry: false }
        ).then(settle, () =>
            settle({ translation: null, entries: [], source: null })
        );
    }, [activeTabId, selection, shown, targetLanguage, updateTab]);
}
