import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { MessageActions } from '../../content_scripts/shared/constants/messageActions.js';
import { useSidePanelCommunication } from './useSidePanelCommunication.js';

function createPanelState() {
    return {
        selection: null,
        analysisResult: null,
        isAnalyzing: false,
        error: null,
    };
}

const SidePanelContext = createContext(null);

export function SidePanelProvider({ children }) {
    const [activeTabId, setActiveTabId] = useState(null);
    const [panelState, setPanelState] = useState(createPanelState);
    const activeTabRef = useRef(null);
    const communication = useSidePanelCommunication();
    const { onMessage, onSelectionState, registerTab } = communication;

    const activateTab = useCallback((tabId) => {
        if (!Number.isSafeInteger(tabId) || tabId < 0) return false;
        if (activeTabRef.current !== tabId) {
            activeTabRef.current = tabId;
            setActiveTabId(tabId);
            setPanelState(createPanelState());
        }
        return true;
    }, []);

    const updateTabState = useCallback((tabId, updates) => {
        if (activeTabRef.current !== tabId) return;
        setPanelState((current) => {
            const nextUpdates =
                typeof updates === 'function' ? updates(current) : updates;
            if (!nextUpdates) return current;
            const changed = Object.entries(nextUpdates).some(
                ([key, value]) => current[key] !== value
            );
            return changed ? { ...current, ...nextUpdates } : current;
        });
    }, []);

    useEffect(() => {
        const bindToTab = ({ tabId, windowId } = {}) => {
            if (registerTab(tabId, windowId)) activateTab(tabId);
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
    }, [activateTab, onMessage, registerTab]);

    useEffect(
        () =>
            onSelectionState(({ tabId, selection }) => {
                if (!activateTab(tabId)) return;
                setPanelState((current) => {
                    return {
                        ...current,
                        selection,
                        analysisResult: null,
                        isAnalyzing: false,
                        error: null,
                    };
                });
            }),
        [activateTab, onSelectionState]
    );

    const value = useMemo(
        () => ({
            ...panelState,
            selectedWords: panelState.selection
                ? panelState.selection.entries.map(({ word }) => word)
                : [],
            activeTabId,
            communication,
            updateTabState,
        }),
        [activeTabId, communication, panelState, updateTabState]
    );

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
