import { useCallback, useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import type { SelectionState } from '@/messaging/contracts/selection';
import { SIDEPANEL_PORT_NAME } from '@/messaging/contracts/sidepanelPort';
import {
    PanelConnection,
    type RemovalStatus,
    type TabBinding,
} from './panelConnection';

export type Analysis = Record<string, unknown>;

export type PanelError =
    | { readonly kind: 'key'; readonly key: string }
    | { readonly kind: 'text'; readonly text: string };

export interface TabState {
    readonly selection: SelectionState | null;
    readonly analysis: Analysis | null;
    readonly error: PanelError | null;
    readonly analyzing: boolean;
}

export const EMPTY_TAB_STATE: TabState = {
    selection: null,
    analysis: null,
    error: null,
    analyzing: false,
};

export interface PanelHandle {
    readonly connected: boolean;
    readonly activeTabId: number | null;
    readonly tab: TabState;
    readonly updateTab: (tabId: number, patch: Partial<TabState>) => void;
    readonly requestRemoval: (
        selection: SelectionState,
        wordIndex: number
    ) => Promise<RemovalStatus>;
}

function selectionsEqual(
    left: SelectionState | null,
    right: SelectionState | null
): boolean {
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
                entry.wordIndex === right.entries[index]!.wordIndex &&
                entry.word === right.entries[index]!.word
        )
    );
}

async function queryActiveTab(): Promise<TabBinding | null> {
    const [tab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
    });
    return tab?.id !== undefined && tab.windowId !== undefined
        ? { tabId: tab.id, windowId: tab.windowId }
        : null;
}

/**
 * React view of the panel's port. State is kept per tab so switching away
 * and back restores that tab's selection and analysis; the bound tab is
 * whichever the connection registered last.
 */
export function usePanelConnection(): PanelHandle {
    const [connected, setConnected] = useState(false);
    const [activeTabId, setActiveTabId] = useState<number | null>(null);
    const [tabs, setTabs] = useState<Record<number, TabState>>({});
    const connectionRef = useRef<PanelConnection | null>(null);

    const updateTab = useCallback((tabId: number, patch: Partial<TabState>) => {
        setTabs((previous) => {
            const current = previous[tabId] ?? EMPTY_TAB_STATE;
            const next = { ...current, ...patch };
            const changed = (Object.keys(patch) as (keyof TabState)[]).some(
                (key) => current[key] !== next[key]
            );
            return changed ? { ...previous, [tabId]: next } : previous;
        });
    }, []);

    useEffect(() => {
        const connection = new PanelConnection({
            connect: () =>
                browser.runtime.connect({ name: SIDEPANEL_PORT_NAME }),
            queryActiveTab,
            onConnected: setConnected,
            onRegister: ({ tabId }) => setActiveTabId(tabId),
            onBindTab: ({ tabId, windowId }) => {
                connection.registerTab(tabId, windowId);
            },
            onSelection: (tabId, selection) => {
                setTabs((previous) => {
                    const current = previous[tabId] ?? EMPTY_TAB_STATE;
                    const selectionChanged = !selectionsEqual(
                        current.selection,
                        selection
                    );
                    const clears =
                        selection === null &&
                        (current.analysis !== null || current.error !== null);
                    if (!selectionChanged && !clears) {
                        return previous;
                    }
                    return {
                        ...previous,
                        [tabId]: {
                            ...current,
                            selection,
                            analysis: null,
                            error: null,
                        },
                    };
                });
            },
        });
        connectionRef.current = connection;
        connection.start();
        return () => {
            connection.stop();
            if (connectionRef.current === connection) {
                connectionRef.current = null;
            }
        };
    }, []);

    const requestRemoval = useCallback(
        (selection: SelectionState, wordIndex: number) =>
            connectionRef.current?.requestRemoval(selection, wordIndex) ??
            Promise.resolve<RemovalStatus>('rejected'),
        []
    );

    return {
        connected,
        activeTabId,
        tab:
            activeTabId === null
                ? EMPTY_TAB_STATE
                : (tabs[activeTabId] ?? EMPTY_TAB_STATE),
        updateTab,
        requestRemoval,
    };
}
