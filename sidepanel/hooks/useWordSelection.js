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

    const { onMessage, sendToActiveTab, sendMessage, getActiveTab } =
        useSidePanelCommunication();

    useEffect(() => {
        const unsubscribe = onMessage(
            'sidePanelSelectionSync',
            (payload) => {
                const incomingWords = Array.isArray(payload?.selectedWords)
                    ? payload.selectedWords
                    : [];
                const normalized = incomingWords
                    .map((w) => (typeof w === 'string' ? w.trim() : ''))
                    .filter((w) => w.length > 0)
                    .reduce((acc, word) => {
                        if (!acc.includes(word)) {
                            acc.push(word);
                        }
                        return acc;
                    }, []);

                clearWords();
                normalized.forEach((w) => addWord(w));
            }
        );

        return unsubscribe;
    }, [onMessage, addWord, clearWords]);

    // Drop non-authoritative word-selected events to prevent race overwrites
    useEffect(() => {
        const drop = onMessage('sidePanelWordSelected', () => {});
        return drop;
    }, [onMessage]);

    // Listen for selection clear events from the content script
    useEffect(() => {
        const unsubscribe = onMessage('sidePanelClearSelection', () => {
            console.log(
                'Side panel received clear selection event from content script'
            );
            clearWords();
        });

        return unsubscribe;
    }, [onMessage, clearWords]);

    /**
     * Handle word selected event from content script
     */
    const handleWordSelected = useCallback(
        async (data) => {
            if (!data || !data.word) {
                console.warn('Invalid word selection data:', data);
                return;
            }

            const { word, sourceLanguage, targetLanguage } = data;

            // Update language settings if provided
            if (sourceLanguage) {
                setSourceLanguage(sourceLanguage);
            }
            if (targetLanguage) {
                setTargetLanguage(targetLanguage);
            }

            // Fetch canonical selection from the content script (DOM order)
            try {
                const response = await sendToActiveTab('sidePanelGetState', {});
                const incoming = Array.isArray(response?.selectedWords)
                    ? response.selectedWords
                    : [];
                const normalized = incoming
                    .map((w) => (typeof w === 'string' ? w.trim() : ''))
                    .filter((w) => w.length > 0)
                    .reduce((acc, w) => (acc.includes(w) ? acc : acc.concat(w)), []);

                clearWords();
                normalized.forEach((w) => addWord(w));

                // Inform background so it stores the same canonical order
                try {
                    await sendMessage('sidePanelSelectionSync', {
                        selectedWords: normalized,
                        reason: 'word-click',
                    });
                } catch (e) {
                    console.warn('Failed to sync canonical order to background:', e);
                }
            } catch (err) {
                console.error('Failed to retrieve canonical selection from content script:', err);
            }
        },
        [addWord, clearWords, setSourceLanguage, setTargetLanguage, sendToActiveTab, sendMessage]
    );

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
            try {
                await sendToActiveTab('sidePanelUpdateState', {
                    clearSelection: true,
                    selectedWords: next,
                });
            } catch (err) {
                console.error('Failed to sync toggle to content script:', err);
            }

            try {
                await sendMessage('sidePanelSelectionSync', {
                    selectedWords: next,
                    reason: 'panel-toggle',
                });
            } catch (err) {
                console.warn('Failed to sync toggle to background:', err);
            }
        },
        [selectedWords, addWord, removeWord, sendToActiveTab, sendMessage]
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

        try {
            await sendMessage('sidePanelSelectionSync', {
                selectedWords: [],
                reason: 'panel-clear',
            });
        } catch (err) {
            console.warn('Failed to sync clear to background:', err);
        }
    }, [clearWords, sendToActiveTab, sendMessage]);

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
                            words: selectedWords,
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

        if (selectedWords.length > 0) {
            persistSelection();
        }
    }, [selectedWords, sourceLanguage, targetLanguage]);

    /**
     * Listen for word selection events
     */
    useEffect(() => {
        const unsubscribe = onMessage(
            'sidePanelSelectionSync',
            (payload) => {
                // already handled by the first effect; this keeps backward compatibility if hooks reinitialize
                const words = Array.isArray(payload?.selectedWords)
                    ? payload.selectedWords
                    : [];
                const normalized = words.reduce((acc, w) => {
                    const ww = typeof w === 'string' ? w.trim() : '';
                    if (ww && !acc.includes(ww)) acc.push(ww);
                    return acc;
                }, []);
                clearWords();
                normalized.forEach((w) => addWord(w));
            }
        );

        // Removed initial syncWithContentScript() here to avoid overwriting ordered selection after a click
        return unsubscribe;
    }, [onMessage, addWord, clearWords]);

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
