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
 * - Listen for word selection events from content scripts
 * - Sync selected words with side panel context
 * - Handle word addition/removal
 * - Manage selection state persistence
 */
export function useWordSelection() {
    const {
        selectedWords,
        addWord,
        removeWord,
        clearWords,
        setSourceLanguage,
        setTargetLanguage,
    } = useSidePanelContext();

    const { onMessage, sendToActiveTab, getActiveTab } =
        useSidePanelCommunication();

    /**
     * Handle word selected event from content script
     */
    const handleWordSelected = useCallback(
        (data) => {
            if (!data || !data.word) {
                console.warn('Invalid word selection data:', data);
                return;
            }

            const { word, sourceLanguage, targetLanguage, subtitleType } = data;

            console.log('Word selected:', {
                word,
                sourceLanguage,
                targetLanguage,
                subtitleType,
            });

            // Add word to selection
            addWord(word);

            // Update language settings if provided
            if (sourceLanguage) {
                setSourceLanguage(sourceLanguage);
            }
            if (targetLanguage) {
                setTargetLanguage(targetLanguage);
            }
        },
        [addWord, setSourceLanguage, setTargetLanguage]
    );

    /**
     * Toggle word selection
     */
    const toggleWord = useCallback(
        (word) => {
            if (selectedWords.has(word)) {
                removeWord(word);
            } else {
                addWord(word);
            }
        },
        [selectedWords, addWord, removeWord]
    );

    /**
     * Request word selection state from content script
     */
    const syncWithContentScript = useCallback(async () => {
        try {
            const response = await sendToActiveTab('sidePanelGetState', {});
            
            if (response && response.selectedWords) {
                // Clear current selection
                clearWords();
                
                // Add words from content script
                response.selectedWords.forEach((word) => addWord(word));
                
                // Update language settings
                if (response.sourceLanguage) {
                    setSourceLanguage(response.sourceLanguage);
                }
                if (response.targetLanguage) {
                    setTargetLanguage(response.targetLanguage);
                }
            }
        } catch (err) {
            console.error('Failed to sync with content script:', err);
        }
    }, [
        sendToActiveTab,
        clearWords,
        addWord,
        setSourceLanguage,
        setTargetLanguage,
    ]);

    /**
     * Clear selection and notify content script
     */
    const clearSelection = useCallback(async () => {
        clearWords();
        
        try {
            await sendToActiveTab('sidePanelUpdateState', {
                selectedWords: [],
                clearSelection: true,
            });
        } catch (err) {
            console.error('Failed to notify content script of clear:', err);
        }
    }, [clearWords, sendToActiveTab]);

    /**
     * Load persisted selection on mount
     */
    useEffect(() => {
        const loadPersistedSelection = async () => {
            try {
                const result = await chrome.storage.local.get([
                    'sidePanelLastSelection',
                    'sidePanelPersistAcrossTabs',
                ]);

                if (
                    result.sidePanelPersistAcrossTabs &&
                    result.sidePanelLastSelection
                ) {
                    const { words, sourceLanguage, targetLanguage, timestamp } =
                        result.sidePanelLastSelection;

                    // Only restore if less than 1 hour old
                    if (Date.now() - timestamp < 3600000) {
                        words?.forEach((word) => addWord(word));
                        if (sourceLanguage) setSourceLanguage(sourceLanguage);
                        if (targetLanguage) setTargetLanguage(targetLanguage);
                    }
                }
            } catch (err) {
                console.error('Failed to load persisted selection:', err);
            }
        };

        loadPersistedSelection();
    }, [addWord, setSourceLanguage, setTargetLanguage]);

    /**
     * Persist selection on changes
     */
    useEffect(() => {
        const persistSelection = async () => {
            try {
                const result = await chrome.storage.sync.get([
                    'sidePanelPersistAcrossTabs',
                ]);

                if (result.sidePanelPersistAcrossTabs) {
                    await chrome.storage.local.set({
                        sidePanelLastSelection: {
                            words: Array.from(selectedWords),
                            sourceLanguage:
                                useSidePanelContext().sourceLanguage,
                            targetLanguage:
                                useSidePanelContext().targetLanguage,
                            timestamp: Date.now(),
                        },
                    });
                }
            } catch (err) {
                console.error('Failed to persist selection:', err);
            }
        };

        if (selectedWords.size > 0) {
            persistSelection();
        }
    }, [selectedWords]);

    /**
     * Listen for word selection events
     */
    useEffect(() => {
        const unsubscribe = onMessage(
            'sidePanelWordSelected',
            handleWordSelected
        );

        // Sync with content script on mount
        syncWithContentScript();

        return unsubscribe;
    }, [onMessage, handleWordSelected, syncWithContentScript]);

    /**
     * Listen for tab changes to update selection
     */
    useEffect(() => {
        const handleTabChange = async () => {
            const tab = await getActiveTab();
            if (tab) {
                await syncWithContentScript();
            }
        };

        chrome.tabs.onActivated.addListener(handleTabChange);
        chrome.tabs.onUpdated.addListener(handleTabChange);

        return () => {
            chrome.tabs.onActivated.removeListener(handleTabChange);
            chrome.tabs.onUpdated.removeListener(handleTabChange);
        };
    }, [getActiveTab, syncWithContentScript]);

    return {
        selectedWords,
        addWord,
        removeWord,
        toggleWord,
        clearSelection,
        syncWithContentScript,
    };
}
