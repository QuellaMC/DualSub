import { useCallback, useEffect, useRef, useState } from 'react';
import { useSidePanelContext } from './SidePanelContext.jsx';

/**
 * Requests selection changes from the content script. The content script owns
 * the authoritative highlighted-word state and confirms it through
 * sidePanelSelectionSync; this hook deliberately avoids optimistic mutations.
 */
export function useWordSelection() {
    const { communication, selection, selectedWords } = useSidePanelContext();
    const { requestSelectionRemoval } = communication;
    const [isUpdatingSelection, setIsUpdatingSelection] = useState(false);
    const pendingSelectionRef = useRef(null);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            pendingSelectionRef.current = null;
        };
    }, []);

    const clearPendingSelection = useCallback((pending) => {
        if (pendingSelectionRef.current !== pending) {
            return;
        }
        pendingSelectionRef.current = null;
        if (mountedRef.current) {
            setIsUpdatingSelection(false);
        }
    }, []);

    const removeWordAt = useCallback(
        async (index) => {
            if (
                pendingSelectionRef.current ||
                isUpdatingSelection ||
                !selection ||
                !Number.isInteger(index) ||
                index < 0 ||
                index >= selection.entries.length
            ) {
                return false;
            }

            const occurrence = selection.entries[index];
            const pending = {};
            pendingSelectionRef.current = pending;
            setIsUpdatingSelection(true);

            try {
                const status = await requestSelectionRemoval(
                    selection,
                    occurrence.wordIndex
                );
                return status === 'applied';
            } catch (_) {
                console.error('Failed to update content-script selection');
                return false;
            } finally {
                clearPendingSelection(pending);
            }
        },
        [
            clearPendingSelection,
            isUpdatingSelection,
            requestSelectionRemoval,
            selection,
        ]
    );

    return {
        isUpdatingSelection,
        selectedWords,
        removeWordAt,
    };
}
