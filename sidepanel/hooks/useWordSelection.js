import { useCallback, useEffect, useRef, useState } from 'react';
import { useSidePanelContext } from './SidePanelContext.jsx';

function selectionKey(words) {
    return words.join('\u0000');
}

/**
 * Requests selection changes from the content script. The content script owns
 * the authoritative highlighted-word state and confirms it through
 * sidePanelSelectionSync; this hook deliberately avoids optimistic mutations.
 */
export function useWordSelection() {
    const { activeTabId, communication, selectedWords } = useSidePanelContext();
    const { sendToTab } = communication;
    const [isUpdatingSelection, setIsUpdatingSelection] = useState(false);
    const pendingSelectionRef = useRef(null);
    const fallbackTimerRef = useRef(null);
    const currentSelectionKey = selectionKey(selectedWords);

    const clearPendingSelection = useCallback(() => {
        pendingSelectionRef.current = null;
        setIsUpdatingSelection(false);
        if (fallbackTimerRef.current) {
            clearTimeout(fallbackTimerRef.current);
            fallbackTimerRef.current = null;
        }
    }, []);

    useEffect(() => {
        if (pendingSelectionRef.current === currentSelectionKey) {
            clearPendingSelection();
        }
    }, [clearPendingSelection, currentSelectionKey]);

    useEffect(
        () => () => {
            if (fallbackTimerRef.current) {
                clearTimeout(fallbackTimerRef.current);
            }
        },
        []
    );

    const removeWordAt = useCallback(
        async (index) => {
            if (
                isUpdatingSelection ||
                typeof activeTabId !== 'number' ||
                !Number.isInteger(index) ||
                index < 0 ||
                index >= selectedWords.length
            ) {
                return false;
            }

            const nextSelection = selectedWords.filter(
                (_selectedWord, selectedIndex) => selectedIndex !== index
            );
            pendingSelectionRef.current = selectionKey(nextSelection);
            setIsUpdatingSelection(true);

            try {
                await sendToTab(activeTabId, 'sidePanelUpdateState', {
                    removeSelectionIndex: index,
                    selectedWords: nextSelection,
                });

                // The authoritative sync normally arrives immediately. Avoid
                // leaving controls locked if a page unloads before broadcasting.
                if (pendingSelectionRef.current !== null) {
                    fallbackTimerRef.current = setTimeout(
                        clearPendingSelection,
                        1500
                    );
                }
                return true;
            } catch (selectionError) {
                console.error(
                    'Failed to update content-script selection:',
                    selectionError
                );
                clearPendingSelection();
                return false;
            }
        },
        [
            activeTabId,
            clearPendingSelection,
            isUpdatingSelection,
            selectedWords,
            sendToTab,
        ]
    );

    return {
        isUpdatingSelection,
        selectedWords,
        removeWordAt,
    };
}
