import { useEffect, useCallback, useRef } from 'react';
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
        sourceLanguage,
        targetLanguage,
    } = useSidePanelContext();

    const { onMessage, sendToActiveTab, getActiveTab } =
        useSidePanelCommunication();

    useEffect(() => {
        const unsubscribe = onMessage(
            'sidePanelSelectionSync',
            (payload) => {
                const incomingWords = Array.isArray(payload?.selectedWords)
                    ? payload.selectedWords
                    : [];
                const normalized = Array.from(
                    new Set(
                        incomingWords
                            .map((w) =>
                                typeof w === 'string' ? w.trim() : ''
                            )
                            .filter((w) => w.length > 0)
                    )
                );

                clearWords();
                normalized.forEach((w) => addWord(w));
            }
        );

        return unsubscribe;
    }, [onMessage, addWord, clearWords]);

    /**
     * Handle word selected event from content script
     */
    const handleWordSelected = useCallback(
        (data) => {
            if (!data || !data.word) {
                console.warn('Invalid word selection data:', data);
                return;
            }

            const { word, sourceLanguage, targetLanguage } = data;
            const selectionAction = data?.selectionAction ?? data?.action;
            const normalizedAction =
                selectionAction && selectionAction !== 'sidePanelWordSelected'
                    ? selectionAction
                    : 'toggle';

            if (normalizedAction === 'remove') {
                removeWord(word);
            } else if (normalizedAction === 'toggle') {
                if (selectedWords.has(word)) removeWord(word);
                else addWord(word);
            } else if (normalizedAction === 'replace') {
                clearWords();
                addWord(word);
            } else if (normalizedAction === 'add') {
                addWord(word);
            } else {
                addWord(word);
            }

            // Update language settings if provided
            if (sourceLanguage) {
                setSourceLanguage(sourceLanguage);
            }
            if (targetLanguage) {
                setTargetLanguage(targetLanguage);
            }
        },
        [addWord, removeWord, clearWords, selectedWords, setSourceLanguage, setTargetLanguage]
    );

    /**
     * Toggle word selection
     */
    const toggleWord = useCallback(
        async (word) => {
            // Compute next selection locally to sync with content script reliably
            const next = new Set(selectedWords);
            if (next.has(word)) {
                next.delete(word);
                removeWord(word);
            } else {
                next.add(word);
                addWord(word);
            }
            try {
                await sendToActiveTab('sidePanelUpdateState', {
                    clearSelection: true,
                    selectedWords: Array.from(next),
                });
            } catch (err) {
                console.error('Failed to sync toggle to content script:', err);
            }
        },
        [selectedWords, addWord, removeWord, sendToActiveTab]
    );

    /**
     * Request word selection state from content script
     */
    const inFlightRef = useRef(false);
    const lastSyncTsRef = useRef(0);
    const minSyncIntervalMs = 600;

    const syncWithContentScript = useCallback(async () => {
        const now = Date.now();
        if (inFlightRef.current) {
            return; // prevent parallel requests
        }
        if (now - lastSyncTsRef.current < minSyncIntervalMs) {
            return; // throttle repetitive syncs
        }
        inFlightRef.current = true;
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
        } finally {
            lastSyncTsRef.current = Date.now();
            inFlightRef.current = false;
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
                            sourceLanguage,
                            targetLanguage,
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
    }, [selectedWords, sourceLanguage, targetLanguage]);

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
        let syncTimer = null;
        const activeTabIdRef = { current: null };
        const lastUrlByTabRef = { current: new Map() };
        const debouncedSync = () => {
            if (syncTimer) clearTimeout(syncTimer);
            syncTimer = setTimeout(() => {
                syncWithContentScript().catch((e) =>
                    console.warn('Debounced sync failed:', e)
                );
            }, 200);
        };

        const handleTabActivated = async (activeInfo) => {
            activeTabIdRef.current = activeInfo?.tabId ?? activeTabIdRef.current;
            debouncedSync();
        };
        const handleTabUpdated = async (tabId, changeInfo, tab) => {
            // Only act on the currently active tab
            if (activeTabIdRef.current != null && tabId !== activeTabIdRef.current) {
                return;
            }
            const newUrl = changeInfo?.url || tab?.url || null;
            let shouldSync = false;
            if (newUrl) {
                const prevUrl = lastUrlByTabRef.current.get(tabId);
                if (prevUrl !== newUrl) {
                    lastUrlByTabRef.current.set(tabId, newUrl);
                    shouldSync = true;
                }
            }
            if (changeInfo?.status === 'complete') {
                shouldSync = true;
            }
            if (shouldSync) {
                debouncedSync();
            }
        };

        chrome.tabs.onActivated.addListener(handleTabActivated);
        chrome.tabs.onUpdated.addListener(handleTabUpdated);

        // Initialize active tab id
        chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
            if (tab && tab.id) {
                activeTabIdRef.current = tab.id;
                if (tab.url) lastUrlByTabRef.current.set(tab.id, tab.url);
            }
        }).catch(() => {});

        return () => {
            if (syncTimer) clearTimeout(syncTimer);
            chrome.tabs.onActivated.removeListener(handleTabActivated);
            chrome.tabs.onUpdated.removeListener(handleTabUpdated);
        };
    }, [syncWithContentScript]);

    return {
        selectedWords,
        addWord,
        removeWord,
        toggleWord,
        clearSelection,
        syncWithContentScript,
    };
}
