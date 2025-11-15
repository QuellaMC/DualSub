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
        setSelectedWords,
        setSourceLanguage,
        setTargetLanguage,
        sourceLanguage,
        targetLanguage,
    } = useSidePanelContext();

    const { onMessage, sendToBoundTab, sendMessage, postMessage, getActiveTab, getBinding } =
        useSidePanelCommunication();

    useEffect(() => {
        const unsubscribe = onMessage(
            'sidePanelSelectionSync',
            (payload) => {
                // Filter out selection updates that don't match the currently bound tab (if provided)
                try {
                    const { boundTabId } = getBinding();
                    if (payload && typeof payload.tabId === 'number' && boundTabId && payload.tabId !== boundTabId) {
                        return;
                    }
                } catch (_) {}
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

                setSelectedWords(normalized);
            }
        );

        return unsubscribe;
    }, [onMessage, setSelectedWords]);

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
                const response = await sendToBoundTab('sidePanelGetState', {});
                const incoming = Array.isArray(response?.selectedWords)
                    ? response.selectedWords
                    : [];
                const normalized = incoming
                    .map((w) => (typeof w === 'string' ? w.trim() : ''))
                    .filter((w) => w.length > 0)
                    .reduce((acc, w) => (acc.includes(w) ? acc : acc.concat(w)), []);

                setSelectedWords(normalized);

                // Inform background so it stores the same canonical order
                try {
                    postMessage('sidePanelSelectionSync', {
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
        [setSelectedWords, setSourceLanguage, setTargetLanguage, sendToBoundTab, postMessage]
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
                await sendToBoundTab('sidePanelUpdateState', {
                    clearSelection: true,
                    selectedWords: next,
                });
            } catch (err) {
                console.error('Failed to sync toggle to content script:', err);
            }

            try {
                postMessage('sidePanelSelectionSync', {
                    selectedWords: next,
                    reason: 'panel-toggle',
                });
            } catch (err) {
                console.warn('Failed to sync toggle to background:', err);
            }
        },
        [selectedWords, addWord, removeWord, sendToBoundTab, postMessage]
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
            const response = await sendToBoundTab('sidePanelGetState', {});
            
            if (response && response.selectedWords) {
                // Replace current selection atomically
                setSelectedWords(response.selectedWords);
                
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
        sendToBoundTab,
        setSelectedWords,
        setSourceLanguage,
        setTargetLanguage,
    ]);

    /**
     * One-time lightweight hydrate after mount to align with current DOM state of bound tab.
     * Uses a small defer to avoid jank during panel open.
     */
    useEffect(() => {
        const timer = setTimeout(() => {
            syncWithContentScript().catch(() => {});
        }, 120);
        return () => clearTimeout(timer);
    }, [syncWithContentScript]);

    /**
     * Clear selection and notify content script
     */
    const clearSelection = useCallback(async () => {
        clearWords();
        
        try {
            await sendToBoundTab('sidePanelUpdateState', {
                selectedWords: [],
                clearSelection: true,
            });
        } catch (err) {
            console.error('Failed to notify content script of clear:', err);
        }

        try {
            postMessage('sidePanelSelectionSync', {
                selectedWords: [],
                reason: 'panel-clear',
            });
        } catch (err) {
            console.warn('Failed to sync clear to background:', err);
        }
    }, [clearWords, sendToBoundTab, postMessage]);

    /**
     * Load persisted selection suggestion on mount (do not auto-apply)
     */
    useEffect(() => {
        const loadPersistedSuggestion = async () => {
            try {
                const sync = await chrome.storage.sync.get(['sidePanelPersistAcrossTabs']);
                const local = await chrome.storage.local.get(['sidePanelSelectionBuckets']);
                if (sync.sidePanelPersistAcrossTabs) {
                    const buckets = local.sidePanelSelectionBuckets || {};
                    const suggestion = buckets['global:default'];
                    // Suggestion is intentionally not auto-applied to avoid cross-tab contamination
                    // In future UI, we can surface a "Restore" action from this suggestion.
                    if (suggestion && Array.isArray(suggestion.words)) {
                        // No-op: keep for future restore flow
                    }
                }
            } catch (err) {
                console.error('Failed to load persisted selection suggestion:', err);
            }
        };
        loadPersistedSuggestion();
    }, []);

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
                setSelectedWords(normalized);
            }
        );

        // Removed initial syncWithContentScript() here to avoid overwriting ordered selection after a click
        return unsubscribe;
    }, [onMessage, setSelectedWords]);

    /**
     * Listen for tab changes to update selection
     */
    useEffect(() => {
        let syncTimer = null;
        const lastUrlByTabRef = { current: new Map() };
        const debouncedSync = () => {
            if (syncTimer) clearTimeout(syncTimer);
            syncTimer = setTimeout(() => {
                syncWithContentScript().catch((e) =>
                    console.warn('Debounced sync failed:', e)
                );
            }, 200);
        };

        const handleTabUpdated = async (tabId, changeInfo, tab) => {
            try {
                const binding = getBinding();
                const boundTabId = binding?.boundTabId ?? null;
                if (!boundTabId || tabId !== boundTabId) {
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
            } catch (_) {}
        };

        chrome.tabs.onUpdated.addListener(handleTabUpdated);

        // Initialize last known URL for the bound tab
        try {
            const binding = getBinding();
            const boundTabId = binding?.boundTabId ?? null;
            if (boundTabId) {
                chrome.tabs.get(boundTabId, (t) => {
                    if (t && t.url) {
                        lastUrlByTabRef.current.set(boundTabId, t.url);
                    }
                });
            }
        } catch (_) {}

        return () => {
            if (syncTimer) clearTimeout(syncTimer);
            chrome.tabs.onUpdated.removeListener(handleTabUpdated);
        };
    }, [syncWithContentScript, getBinding]);

    return {
        selectedWords,
        addWord,
        removeWord,
        toggleWord,
        clearSelection,
        syncWithContentScript,
    };
}
