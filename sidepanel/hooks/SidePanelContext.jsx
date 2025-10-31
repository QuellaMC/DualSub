import React, {
    createContext,
    useContext,
    useState,
    useEffect,
    useCallback,
} from 'react';
import { useSidePanelCommunication } from './useSidePanelCommunication';

/**
 * Side Panel Context
 * 
 * Provides global state management for:
 * - Selected words for AI analysis
 * - Analysis results
 * - Loading states
 * - Error handling
 */

const SidePanelContext = createContext(null);

export function SidePanelProvider({ children }) {
    const [tabState, setTabState] = useState({});
    const [activeTabId, setActiveTabId] = useState(null);
    const { onMessage, getActiveTab, postMessage } = useSidePanelCommunication();
    const pendingSelectionRef = React.useRef(null);

    // Effect to set the initial active tab and listen for changes
    useEffect(() => {
        const handleTabActivated = (tabId) => {
            setActiveTabId(tabId);
            setTabState((prev) => ({
                ...prev,
                [tabId]: prev[tabId] || {
                    selectedWords: [],
                    analysisResult: null,
                    isAnalyzing: false,
                    error: null,
                    sourceLanguage: 'en',
                    targetLanguage: 'zh-CN',
                },
            }));
        };

        // Get initial active tab
        getActiveTab()
            .then((tab) => {
                if (tab && tab.id) {
                    handleTabActivated(tab.id);
                    try {
                        postMessage('sidePanelRegister', { tabId: tab.id });
                    } catch (_) {}
                    // Apply any pending selection captured before tab ID was known
                    if (pendingSelectionRef.current) {
                        const normalized = pendingSelectionRef.current;
                        setTabState((prev) => ({
                            ...prev,
                            [tab.id]: {
                                ...(prev[tab.id] || {}),
                                selectedWords: normalized,
                            },
                        }));
                        pendingSelectionRef.current = null;
                    }
                }
            })
            .catch(() => {});

        // Listen for tab activation changes from the background script
        const unsubscribe = onMessage('tabActivated', ({ tabId }) => {
            handleTabActivated(tabId);
            // Re-register this side panel with the new active tab so background routes messages correctly
            try {
                postMessage('sidePanelRegister', { tabId });
            } catch (_) {}
            // Apply any pending selection for unknown tab now that we have an ID
            if (pendingSelectionRef.current) {
                const normalized = pendingSelectionRef.current;
                setTabState((prev) => ({
                    ...prev,
                    [tabId]: {
                        ...(prev[tabId] || {}),
                        selectedWords: normalized,
                    },
                }));
                pendingSelectionRef.current = null;
            }
        });

        return unsubscribe;
    }, [getActiveTab, onMessage, postMessage]);

    // Effect to handle authoritative selection sync from background (e.g., subtitle change clears selection)
    useEffect(() => {
        const unsubscribe = onMessage(
            'sidePanelSelectionSync',
            ({ selectedWords }) => {
                const normalized = Array.isArray(selectedWords)
                    ? Array.from(
                          new Set(
                              selectedWords
                                  .map((w) =>
                                      typeof w === 'string'
                                          ? w.trim()
                                          : ''
                                  )
                                  .filter(Boolean)
                          )
                      )
                    : [];
                // If we don't yet know the active tab, try to resolve and apply immediately; otherwise buffer
                if (!activeTabId) {
                    pendingSelectionRef.current = normalized;
                    getActiveTab()
                        .then((tab) => {
                            if (tab && tab.id) {
                                setActiveTabId(tab.id);
                                try {
                                    postMessage('sidePanelRegister', { tabId: tab.id });
                                } catch (_) {}
                                setTabState((prev) => ({
                                    ...prev,
                                    [tab.id]: {
                                        ...(prev[tab.id] || {}),
                                        selectedWords: normalized,
                                    },
                                }));
                                pendingSelectionRef.current = null;
                            }
                        })
                        .catch(() => {});
                    return;
                }
                setTabState((prev) => ({
                    ...prev,
                    [activeTabId]: {
                        ...(prev[activeTabId] || {}),
                        selectedWords: normalized,
                    },
                }));
            }
        );
        return unsubscribe;
    }, [onMessage, activeTabId, getActiveTab, postMessage]);

    // Note: We intentionally ignore 'wordSelectionUpdate' messages here.
    // The authoritative selection state is delivered via 'sidePanelSelectionSync',
    // which avoids race conditions between toggle and full-list updates.

    // Memoized context value
    const value = React.useMemo(() => {
        const activeState = tabState[activeTabId] || {
            selectedWords: [],
            analysisResult: null,
            isAnalyzing: false,
            error: null,
            sourceLanguage: 'en',
            targetLanguage: 'zh-CN',
        };

        const updateActiveTabState = (newState) => {
            if (activeTabId) {
                setTabState((prev) => ({
                    ...prev,
                    [activeTabId]: { ...prev[activeTabId], ...newState },
                }));
            }
        };

        return {
            ...activeState,
            activeTabId,
            setSelectedWords: (words) =>
                updateActiveTabState({ selectedWords: words }),
            setAnalysisResult: (result) =>
                updateActiveTabState({ analysisResult: result }),
            setIsAnalyzing: (isAnalyzing) =>
                updateActiveTabState({ isAnalyzing }),
            setError: (error) => updateActiveTabState({ error }),
            setSourceLanguage: (lang) =>
                updateActiveTabState({ sourceLanguage: lang }),
            setTargetLanguage: (lang) =>
                updateActiveTabState({ targetLanguage: lang }),
            clearAnalysis: () =>
                updateActiveTabState({ analysisResult: null, error: null }),
            clearWords: () => updateActiveTabState({ selectedWords: [] }),
            addWord: (word) =>
                updateActiveTabState({
                    selectedWords: [
                        ...new Set([...activeState.selectedWords, word]),
                    ],
                }),
            removeWord: (word) =>
                updateActiveTabState({
                    selectedWords: activeState.selectedWords.filter(
                        (w) => w !== word
                    ),
                }),
        };
    }, [tabState, activeTabId]);

    return (
        <SidePanelContext.Provider value={value}>
            {children}
        </SidePanelContext.Provider>
    );
}

export function useSidePanelContext() {
    const context = useContext(SidePanelContext);
    if (!context) {
        throw new Error(
            'useSidePanelContext must be used within SidePanelProvider'
        );
    }
    return context;
}
