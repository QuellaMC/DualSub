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

/** What one analysis produced for some words under some analysis settings
 *  (the configuration key of useAnalysis): an answer or an error. */
export interface AnalysisOutcome {
    readonly words: readonly string[];
    readonly configuration: string;
    readonly answer: Analysis | null;
    readonly error: PanelError | null;
}

export interface TabState {
    readonly selection: SelectionState | null;
    readonly outcome: AnalysisOutcome | null;
    readonly analyzing: boolean;
}

export const EMPTY_TAB_STATE: TabState = {
    selection: null,
    outcome: null,
    analyzing: false,
};

/** Fields to change, or a function of the state React is about to commit
 *  that returns them (null leaves the tab as it is). */
export type TabPatch =
    Partial<TabState> | ((current: TabState) => Partial<TabState> | null);

export interface PanelHandle {
    readonly connected: boolean;
    /** The bound tab's state is confirmed, not merely remembered. */
    readonly bound: boolean;
    readonly activeTabId: number | null;
    /** The bound tab's state. */
    readonly tab: TabState;
    readonly updateTab: (tabId: number, patch: TabPatch) => void;
    readonly requestRemoval: (
        selection: SelectionState,
        wordIndex: number
    ) => Promise<RemovalStatus>;
}

export function selectionWords(
    selection: SelectionState | null
): readonly string[] {
    return selection?.entries.map((entry) => entry.word) ?? [];
}

export function sameWords(
    left: readonly string[],
    right: readonly string[]
): boolean {
    return (
        left.length === right.length &&
        left.every((word, index) => word === right[index])
    );
}

/** The same content session: the background names it, so a worker
 *  restart (a new owner generation) keeps it and a new document or
 *  player session does not. */
function continues(
    previous: SelectionState | null,
    next: SelectionState
): boolean {
    return previous !== null && previous.session === next.session;
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
 * and back restores that tab's words and outcome; the bound tab is
 * whichever the connection registered last. An outcome is keyed by its
 * words: it stays while the tab shows those words, or none at all, in the
 * same document, and goes when the tab shows other words, another
 * document, or nothing at all.
 */
export function usePanelConnection(): PanelHandle {
    const [connected, setConnected] = useState(false);
    const [bound, setBound] = useState(false);
    const [activeTabId, setActiveTabId] = useState<number | null>(null);
    const [tabs, setTabs] = useState<Record<number, TabState>>({});
    const connectionRef = useRef<PanelConnection | null>(null);

    const updateTab = useCallback((tabId: number, patch: TabPatch) => {
        setTabs((previous) => {
            const current = previous[tabId] ?? EMPTY_TAB_STATE;
            const fields = typeof patch === 'function' ? patch(current) : patch;
            if (fields === null) {
                return previous;
            }
            const next = { ...current, ...fields };
            const changed = (Object.keys(fields) as (keyof TabState)[]).some(
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
            onBound: setBound,
            onRegister: ({ tabId }) => setActiveTabId(tabId),
            onBindTab: ({ tabId, windowId }) => {
                connection.registerTab(tabId, windowId);
            },
            onSelection: (tabId, selection) => {
                setTabs((previous) => {
                    if (selection === null) {
                        return { ...previous, [tabId]: EMPTY_TAB_STATE };
                    }
                    const current = previous[tabId] ?? EMPTY_TAB_STATE;
                    const words = selectionWords(selection);
                    const keepsOutcome =
                        current.outcome !== null &&
                        continues(current.selection, selection) &&
                        (words.length === 0 ||
                            sameWords(words, current.outcome.words));
                    return {
                        ...previous,
                        [tabId]: {
                            ...current,
                            selection,
                            outcome: keepsOutcome ? current.outcome : null,
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
        bound,
        activeTabId,
        tab:
            activeTabId === null
                ? EMPTY_TAB_STATE
                : (tabs[activeTabId] ?? EMPTY_TAB_STATE),
        updateTab,
        requestRemoval,
    };
}
