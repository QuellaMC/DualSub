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
    const { onMessage, getActiveTab, postMessage, getBinding } = useSidePanelCommunication();
    const pendingSelectionRef = React.useRef(null);

    // Effect to set the initial active tab and listen for changes
    useEffect(() => {
        let followActiveRef = { current: false };
        // Load follow-active-tab behavior
        chrome.storage.sync.get(['sidePanelFollowActiveTabInWindow']).then((res) => {
            followActiveRef.current = !!res.sidePanelFollowActiveTabInWindow;
        }).catch(() => {
            followActiveRef.current = false;
        });

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
                        const binding = getBinding();
                        postMessage('sidePanelRegister', { tabId: tab.id, windowId: tab.windowId, panelInstanceId: binding?.panelInstanceId });
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
        const unsubscribe = onMessage('tabActivated', ({ tabId, windowId }) => {
            // Always update the active tab ID to reflect the user's current view
            handleTabActivated(tabId);
            
            // Notify background that we are now "looking" at this tab
            // This triggers the background to send us the latest state for this tab
            try {
                const binding = getBinding();
                postMessage('sidePanelRegister', { tabId, windowId, panelInstanceId: binding?.panelInstanceId });
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

        // Listen for forced tab binding (triggered by explicit user interaction like clicking a word)
        const unsubscribeForce = onMessage('sidePanelForceBindTab', ({ tabId, windowId }) => {
            handleTabActivated(tabId);
            try {
                const binding = getBinding();
                postMessage('sidePanelRegister', { tabId, windowId, panelInstanceId: binding?.panelInstanceId });
            } catch (_) {}
        });

        return () => {
            unsubscribe();
            unsubscribeForce();
        };
    }, [getActiveTab, onMessage, postMessage]);

    // Effect to handle authoritative selection sync from background (e.g., subtitle change clears selection)
    useEffect(() => {
        const unsubscribe = onMessage(
            'sidePanelSelectionSync',
            ({ selectedWords, tabId }) => {
                // Always update the state for the specific tab provided in the message
                // This ensures we have the latest data cached even if we aren't looking at it right now
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
                
                if (typeof tabId === 'number') {
                    setTabState((prev) => ({
                        ...prev,
                        [tabId]: {
                            ...(prev[tabId] || {}),
                            selectedWords: normalized,
                        },
                    }));
                } else if (!activeTabId) {
                    // Fallback for initialization race conditions where tabId isn't known yet
                     pendingSelectionRef.current = normalized;
                     getActiveTab().then(tab => {
                         if (tab?.id) {
                             setActiveTabId(tab.id);
                             setTabState(prev => ({
                                 ...prev,
                                 [tab.id]: { ...(prev[tab.id] || {}), selectedWords: normalized }
                             }));
                             pendingSelectionRef.current = null;
                         }
                     }).catch(() => {});
                } else {
                    // Fallback: if no tabId in message, assume it's for the active tab
                    setTabState((prev) => ({
                        ...prev,
                        [activeTabId]: {
                            ...(prev[activeTabId] || {}),
                            selectedWords: normalized,
                        },
                    }));
                }
            }
        );
        return unsubscribe;
    }, [onMessage, activeTabId, getActiveTab]);

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
