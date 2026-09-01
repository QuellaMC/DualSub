import { useCallback, useEffect, useRef, useState } from 'react';
import { useSidePanelContext } from './SidePanelContext.jsx';

export function useWordSelection() {
    const { communication, selection, selectedWords } = useSidePanelContext();
    const { requestSelectionRemoval } = communication;
    const [isUpdatingSelection, setIsUpdatingSelection] = useState(false);
    const pendingRef = useRef(null);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            pendingRef.current = null;
        };
    }, []);

    const removeWordAt = useCallback(
        async (index) => {
            if (
                pendingRef.current ||
                !selection ||
                !Number.isInteger(index) ||
                index < 0 ||
                index >= selection.entries.length
            ) {
                return false;
            }

            const occurrence = selection.entries[index];
            const pending = {};
            pendingRef.current = pending;
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
                if (pendingRef.current === pending) {
                    pendingRef.current = null;
                    if (mountedRef.current) setIsUpdatingSelection(false);
                }
            }
        },
        [requestSelectionRemoval, selection]
    );

    return {
        isUpdatingSelection,
        selectedWords,
        removeWordAt,
    };
}
