import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
} from 'react';
import { MessageActions } from '../../content_scripts/shared/constants/messageActions.js';
import { useSidePanelCommunication } from './useSidePanelCommunication.js';

function createTabState() {
    return {
        selection: null,
        analysisResult: null,
        isAnalyzing: false,
        error: null,
    };
}

function selectionsEqual(left, right) {
    if (left === right) {
        return true;
    }
    if (!left || !right) {
        return false;
    }

    return (
        left.selectionOwnerGeneration === right.selectionOwnerGeneration &&
        left.selectionRevision === right.selectionRevision &&
        left.renderRevision === right.renderRevision &&
        left.reason === right.reason &&
        left.entries.length === right.entries.length &&
        left.entries.every(
            (entry, index) =>
                entry.wordIndex === right.entries[index].wordIndex &&
                entry.word === right.entries[index].word
        )
    );
}

const SidePanelContext = createContext(null);

export function SidePanelProvider({ children }) {
    const [tabState, setTabState] = useState({});
    const [activeTabId, setActiveTabId] = useState(null);
    const communication = useSidePanelCommunication();
    const { getActiveTab, onMessage, onSelectionState, registerTab } =
        communication;

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
                [tabId]: createTabState(),
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
            const current = previous[tabId] || createTabState();
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

            try {
                if (registerTab(tabId, windowId) === true) {
                    activateTab(tabId);
                }
            } catch (_) {
                // A failed registration cannot own visible tab state.
            }
        };

        const unsubscribeActivated = onMessage(
            MessageActions.SIDEPANEL_TAB_ACTIVATED,
            bindToTab
        );
        const unsubscribeForced = onMessage(
            MessageActions.SIDEPANEL_FORCE_BIND_TAB,
            bindToTab
        );

        return () => {
            unsubscribeActivated();
            unsubscribeForced();
        };
    }, [activateTab, getActiveTab, onMessage, registerTab]);

    useEffect(() => {
        return onSelectionState(({ tabId, selection }) => {
            if (typeof tabId !== 'number') {
                return;
            }

            setTabState((previous) => {
                const current = previous[tabId] || createTabState();
                const selectionChanged = !selectionsEqual(
                    current.selection,
                    selection
                );
                const clearsAnalysis =
                    selection === null &&
                    (current.analysisResult !== null || current.error !== null);
                if (!selectionChanged && !clearsAnalysis) {
                    return previous;
                }

                return {
                    ...previous,
                    [tabId]: {
                        ...current,
                        selection,
                        analysisResult: null,
                        error: null,
                    },
                };
            });
        });
    }, [onSelectionState]);

    const value = useMemo(() => {
        const activeState = tabState[activeTabId] || createTabState();
        const selectedWords = activeState.selection
            ? activeState.selection.entries.map(({ word }) => word)
            : [];

        return {
            ...activeState,
            selectedWords,
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
