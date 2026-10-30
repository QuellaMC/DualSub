import { useEffect } from 'react';
import { sendWithRetry } from '@/messaging/client';
import { lookupWords } from '@/messaging/contracts/lookupWords';
import { pickedSubject, pickedText } from './picked';
import type { Lookup, PanelHandle } from './usePanelConnection';

/** One lookup is the same as another for the same subject in the same
 *  target language. */
function sameLookup(left: Lookup, right: Omit<Lookup, 'result'>): boolean {
    return (
        left.targetLanguage === right.targetLanguage &&
        pickedSubject(left.line, left.entries) ===
            pickedSubject(right.line, right.entries)
    );
}

/**
 * Looks up the words picked in the bound tab, or, once their line has
 * gone, the words of the lookup kept from it: their translation and
 * dictionary entries in the current target language. A lookup belongs to
 * its tab and subject; an answer for words no longer picked is dropped.
 */
export function useLookup(
    panel: PanelHandle,
    targetLanguage: string | null
): void {
    const { activeTabId, tab, updateTab } = panel;
    const { selection, lookup: shown } = tab;

    useEffect(() => {
        const picked =
            selection?.line && selection.entries.length > 0
                ? { line: selection.line, entries: selection.entries }
                : shown;
        if (activeTabId === null || !picked || !targetLanguage) {
            return;
        }
        const { line, entries } = picked;
        const wanted = {
            entries,
            line,
            text: pickedText(line, entries),
            targetLanguage,
        };
        if (shown && sameLookup(shown, wanted)) {
            // Kept with the line's latest translation, for after it has gone.
            if (shown.line.translation !== line.translation) {
                updateTab(activeTabId, { lookup: { ...shown, line } });
            }
            return;
        }
        const lookup: Lookup = { ...wanted, result: null };
        updateTab(activeTabId, { lookup });
        const settle = (result: Lookup['result']) =>
            updateTab(activeTabId, (state) =>
                state.lookup && sameLookup(state.lookup, lookup)
                    ? { lookup: { ...state.lookup, result } }
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
