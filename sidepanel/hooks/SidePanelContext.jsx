import React, {
    createContext,
    useContext,
    useState,
    useEffect,
    useMemo,
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

    // Initial setup and tab activation listener
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
                if (tab?.id) {
                    handleTabActivated(tab.id);
                }
            })
            .catch((err) => console.error('Failed to get initial tab:', err));

        // Listen for tab activation changes from background
        const unsubscribe = onMessage('tabActivated', ({ tabId }) => {
            handleTabActivated(tabId);

            // Notify background to register this tab
            try {
                const binding = getBinding();
                postMessage('sidePanelRegister', {
                    tabId,
                    windowId: binding?.boundWindowId,
                    panelInstanceId: binding?.panelInstanceId
                });
            } catch (e) {
                console.error('Failed to register on tab switch:', e);
            }
        });

        // Listen for forced tab binding
        const unsubscribeForce = onMessage('sidePanelForceBindTab', ({ tabId }) => {
            handleTabActivated(tabId);
            try {
                const binding = getBinding();
                postMessage('sidePanelRegister', {
                    tabId,
                    windowId: binding?.boundWindowId,
                    panelInstanceId: binding?.panelInstanceId
                });
            } catch (e) {
                console.error('Failed to register on force bind:', e);
            }
        });

        return () => {
            unsubscribe();
            unsubscribeForce();
        };
    }, [getActiveTab, onMessage, postMessage, getBinding]);

    // Handle selection sync from background
    useEffect(() => {
        const unsubscribe = onMessage('sidePanelSelectionSync', ({ selectedWords, tabId }) => {
            const normalizedWords = Array.isArray(selectedWords)
                ? Array.from(new Set(selectedWords.map(w => w?.trim()).filter(Boolean)))
                : [];

            const targetTabId = tabId || activeTabId;

            if (targetTabId) {
                setTabState((prev) => ({
                    ...prev,
                    [targetTabId]: {
                        ...(prev[targetTabId] || {}),
                        selectedWords: normalizedWords,
                    },
                }));
            }
        });

        return unsubscribe;
    }, [onMessage, activeTabId]);

    // Memoized context value
    const value = useMemo(() => {
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
            setSelectedWords: (words) => updateActiveTabState({ selectedWords: words }),
            setAnalysisResult: (result) => updateActiveTabState({ analysisResult: result }),
            setIsAnalyzing: (isAnalyzing) => updateActiveTabState({ isAnalyzing }),
            setError: (error) => updateActiveTabState({ error }),
            setSourceLanguage: (lang) => updateActiveTabState({ sourceLanguage: lang }),
            setTargetLanguage: (lang) => updateActiveTabState({ targetLanguage: lang }),
            clearAnalysis: () => updateActiveTabState({ analysisResult: null, error: null }),
            clearWords: () => updateActiveTabState({ selectedWords: [] }),
            addWord: (word) => updateActiveTabState({
                selectedWords: [...new Set([...activeState.selectedWords, word])],
            }),
            removeWord: (word) => updateActiveTabState({
                selectedWords: activeState.selectedWords.filter((w) => w !== word),
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
        throw new Error('useSidePanelContext must be used within SidePanelProvider');
    }
    return context;
}

