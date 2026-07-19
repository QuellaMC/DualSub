import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { useSidePanelCommunication } from './useSidePanelCommunication.js';

const DEFAULT_TARGET_LANGUAGE = 'zh-CN';

function createTabState(targetLanguage = DEFAULT_TARGET_LANGUAGE) {
    return {
        selectedWords: [],
        analysisResult: null,
        isAnalyzing: false,
        error: null,
        targetLanguage,
    };
}

function wordsEqual(left, right) {
    return (
        left.length === right.length &&
        left.every((word, index) => word === right[index])
    );
}

const SidePanelContext = createContext(null);

export function SidePanelProvider({ children }) {
    const [tabState, setTabState] = useState({});
    const [activeTabId, setActiveTabId] = useState(null);
    const communication = useSidePanelCommunication();
    const { getActiveTab, onMessage, registerTab } = communication;
    const globalTargetLanguageRef = useRef(DEFAULT_TARGET_LANGUAGE);

    const ensureTabState = useCallback((tabId) => {
        if (typeof tabId !== 'number') {
            return;
        }

        setTabState((previous) => {
            if (previous[tabId]) {
                return previous;
            }

            return {
                ...previous,
                [tabId]: createTabState(globalTargetLanguageRef.current),
            };
        });
    }, []);

    const activateTab = useCallback(
        (tabId) => {
            if (typeof tabId !== 'number') {
                return;
            }

            setActiveTabId((previous) =>
                previous === tabId ? previous : tabId
            );
            ensureTabState(tabId);
        },
        [ensureTabState]
    );

    const updateTabState = useCallback((tabId, updates) => {
        if (typeof tabId !== 'number') {
            return;
        }

        setTabState((previous) => {
            const current =
                previous[tabId] ||
                createTabState(globalTargetLanguageRef.current);
            const nextUpdates =
                typeof updates === 'function' ? updates(current) : updates;

            if (!nextUpdates) {
                return previous;
            }

            const hasChanges = Object.entries(nextUpdates).some(
                ([key, value]) => current[key] !== value
            );
            if (!hasChanges) {
                return previous;
            }

            return {
                ...previous,
                [tabId]: { ...current, ...nextUpdates },
            };
        });
    }, []);

    useEffect(() => {
        const updateTargetLanguage = (language) => {
            if (!language) {
                return;
            }

            globalTargetLanguageRef.current = language;
            setTabState((previous) => {
                let changed = false;
                const next = { ...previous };

                Object.entries(previous).forEach(([tabId, state]) => {
                    if (state.targetLanguage !== language) {
                        next[tabId] = {
                            ...state,
                            targetLanguage: language,
                            analysisResult: null,
                            error: null,
                        };
                        changed = true;
                    }
                });

                return changed ? next : previous;
            });
        };

        void chrome.storage.sync
            .get('targetLanguage')
            .then((items) => updateTargetLanguage(items.targetLanguage))
            .catch((storageError) =>
                console.error('Failed to load target language:', storageError)
            );

        const handleStorageChange = (changes, area) => {
            if (area === 'sync' && changes.targetLanguage) {
                updateTargetLanguage(changes.targetLanguage.newValue);
            }
        };

        chrome.storage.onChanged.addListener(handleStorageChange);
        return () =>
            chrome.storage.onChanged.removeListener(handleStorageChange);
    }, []);

    useEffect(() => {
        void getActiveTab()
            .then((tab) => {
                if (typeof tab?.id === 'number') {
                    activateTab(tab.id);
                }
            })
            .catch((tabError) =>
                console.error('Failed to get initial tab:', tabError)
            );

        const bindToTab = ({ tabId, windowId } = {}) => {
            if (typeof tabId !== 'number') {
                return;
            }

            activateTab(tabId);
            registerTab(tabId, windowId);
        };

        const unsubscribeActivated = onMessage('tabActivated', bindToTab);
        const unsubscribeForced = onMessage('sidePanelForceBindTab', bindToTab);

        return () => {
            unsubscribeActivated();
            unsubscribeForced();
        };
    }, [activateTab, getActiveTab, onMessage, registerTab]);

    useEffect(() => {
        return onMessage(
            'sidePanelSelectionSync',
            ({ selectedWords, tabId } = {}) => {
                const normalizedWords = Array.isArray(selectedWords)
                    ? selectedWords
                          .map((word) =>
                              typeof word === 'string' ? word.trim() : ''
                          )
                          .filter(Boolean)
                    : [];
                const targetTabId =
                    typeof tabId === 'number' ? tabId : activeTabId;

                if (typeof targetTabId !== 'number') {
                    return;
                }

                setTabState((previous) => {
                    const current =
                        previous[targetTabId] ||
                        createTabState(globalTargetLanguageRef.current);
                    const selectionChanged = !wordsEqual(
                        current.selectedWords,
                        normalizedWords
                    );
                    if (!selectionChanged) {
                        return previous;
                    }

                    return {
                        ...previous,
                        [targetTabId]: {
                            ...current,
                            selectedWords: normalizedWords,
                            analysisResult: null,
                            error: null,
                        },
                    };
                });
            }
        );
    }, [activeTabId, onMessage]);

    const value = useMemo(() => {
        const activeState =
            tabState[activeTabId] ||
            createTabState(globalTargetLanguageRef.current);

        return {
            ...activeState,
            activeTabId,
            communication,
            updateTabState,
        };
    }, [activeTabId, communication, tabState, updateTabState]);

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
