import { useEffect, useCallback } from 'react';
import { useSidePanelContext } from './SidePanelContext.jsx';
import { useSidePanelCommunication } from './useSidePanelCommunication.js';

/**
 * Word Selection Hook
 * 
 * Manages word selection from subtitle clicks and synchronization
 * with the side panel state.
 * 
 * Features:
 * - Actions for toggling/clearing words (using activeTabId from context)
 * - Persisting selection state
 */
export function useWordSelection() {
    const {
        selectedWords,
        addWord,
        removeWord,
        clearWords,
        setSelectedWords,
        setSourceLanguage,
        setTargetLanguage,
        sourceLanguage,
        targetLanguage,
        activeTabId
    } = useSidePanelContext();

    const { onMessage, postMessage } = useSidePanelCommunication();

    // Listen for selection clear events from the content script
    useEffect(() => {
        const unsubscribe = onMessage('sidePanelClearSelection', () => {
            clearWords();
        });
        return unsubscribe;
    }, [onMessage, clearWords]);

    /**
     * Toggle word selection
     */
    const toggleWord = useCallback(
        async (word) => {
            // Compute next selection locally to sync with content script reliably
            let next;
            if (selectedWords.includes(word)) {
                next = selectedWords.filter((w) => w !== word);
                removeWord(word);
            } else {
                next = [...selectedWords, word];
                addWord(word);
            }

            // Send to the currently active tab view
            if (activeTabId) {
                try {
                    await chrome.tabs.sendMessage(activeTabId, {
                        action: 'sidePanelUpdateState',
                        data: {
                            clearSelection: true,
                            selectedWords: next,
                        },
                        source: 'sidepanel'
                    });
                } catch (err) {
                    console.error('Failed to sync toggle to content script:', err);
                }
            }

            try {
                postMessage('sidePanelSelectionSync', {
                    selectedWords: next,
                    reason: 'panel-toggle',
                    tabId: activeTabId // Explicitly associate with current view
                });
            } catch (err) {
                console.warn('Failed to sync toggle to background:', err);
            }
        },
        [selectedWords, addWord, removeWord, activeTabId, postMessage]
    );

    /**
     * Clear selection and notify content script
     */
    const clearSelection = useCallback(async () => {
        clearWords();
        
        if (activeTabId) {
            try {
                await chrome.tabs.sendMessage(activeTabId, {
                    action: 'sidePanelUpdateState',
                    data: {
                        selectedWords: [],
                        clearSelection: true,
                    },
                    source: 'sidepanel'
                });
            } catch (err) {
                console.error('Failed to notify content script of clear:', err);
            }
        }

        try {
            postMessage('sidePanelSelectionSync', {
                selectedWords: [],
                reason: 'panel-clear',
                tabId: activeTabId
            });
        } catch (err) {
            console.warn('Failed to sync clear to background:', err);
        }
    }, [clearWords, activeTabId, postMessage]);

    /**
     * Persist selection suggestion on changes (global suggestion bucket)
     */
    useEffect(() => {
        const persistSuggestion = async () => {
            try {
                const result = await chrome.storage.sync.get(['sidePanelPersistAcrossTabs']);
                if (result.sidePanelPersistAcrossTabs) {
                    const local = await chrome.storage.local.get(['sidePanelSelectionBuckets']);
                    const buckets = local.sidePanelSelectionBuckets || {};
                    buckets['global:default'] = {
                        words: selectedWords,
                        sourceLanguage,
                        targetLanguage,
                        ts: Date.now(),
                    };
                    await chrome.storage.local.set({ sidePanelSelectionBuckets: buckets });
                }
            } catch (err) {
                console.error('Failed to persist selection suggestion:', err);
            }
        };
        if (selectedWords.length > 0) {
            persistSuggestion();
        }
    }, [selectedWords, sourceLanguage, targetLanguage]);

    return {
        selectedWords,
        addWord,
        removeWord,
        toggleWord,
        clearSelection,
        syncWithContentScript: async () => {} // No-op stub for compatibility if needed
    };
}
