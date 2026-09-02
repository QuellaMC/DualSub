import { useCallback, useEffect, useRef } from 'react';
import { CONTEXT_TYPES, type ContextType } from '@/shared/contextTypes';
import { sendWithRetry } from '@/messaging/client';
import { analyzeContext } from '@/messaging/contracts/analyzeContext';
import { useSettings, type SettingsStatus } from '../hooks/useSettings';
import {
    sameWords,
    selectionWords,
    type AnalysisRecord,
    type PanelHandle,
} from './usePanelConnection';

export const ANALYSIS_SETTINGS_KEYS = [
    'aiContextEnabled',
    'aiContextTypes',
    'aiContextProvider',
    'targetLanguage',
] as const;

interface ActiveRequest {
    readonly tabId: number;
    readonly words: readonly string[];
    readonly configurationKey: string;
    cancelled: boolean;
}

function normalizeContextTypes(types: readonly string[]): ContextType[] {
    return [
        ...new Set(
            types.filter((type): type is ContextType =>
                (CONTEXT_TYPES as readonly string[]).includes(type)
            )
        ),
    ];
}

let requestCounter = 0;

/**
 * Runs one analysis per tab. A request belongs to its tab, not to the
 * panel's current view: switching tabs while it runs neither cancels it
 * nor loses its answer. It is dropped only when its tab's words change to
 * other words, its tab's document goes away, or the analysis settings
 * change underneath it. An answer is shown only in the target language it
 * was made for; changing the language hides it and changing back shows
 * it again.
 */
export function useAnalysis(panel: PanelHandle): {
    readonly settingsStatus: SettingsStatus;
    readonly enabled: boolean;
    readonly answer: AnalysisRecord | null;
    readonly analyze: () => Promise<void>;
} {
    const { settings, status } = useSettings(ANALYSIS_SETTINGS_KEYS);
    const { activeTabId, tab, updateTab } = panel;
    const requests = useRef(new Map<number, ActiveRequest>());

    const contextTypes = normalizeContextTypes(settings?.aiContextTypes ?? []);
    const configurationKey = JSON.stringify([
        status,
        settings?.aiContextEnabled,
        settings?.aiContextProvider,
        contextTypes,
        settings?.targetLanguage,
    ]);
    const selectedWordsKey = JSON.stringify(selectionWords(tab.selection));
    const selectionCleared = tab.selection === null;
    const answer =
        tab.analysis !== null &&
        tab.analysis.targetLanguage === settings?.targetLanguage
            ? tab.analysis
            : null;

    const invalidate = useCallback(
        (request: ActiveRequest) => {
            if (request.cancelled) {
                return;
            }
            request.cancelled = true;
            if (requests.current.get(request.tabId) === request) {
                requests.current.delete(request.tabId);
            }
            updateTab(request.tabId, { analyzing: false });
        },
        [updateTab]
    );

    // Settings changes end every flight; new words, or the tab's document
    // going away, end the active tab's. Other tabs cannot change their
    // words while inactive: the background accepts snapshots only from the
    // active tab.
    useEffect(() => {
        for (const request of requests.current.values()) {
            if (request.configurationKey !== configurationKey) {
                invalidate(request);
            }
        }
    }, [configurationKey, invalidate]);

    useEffect(() => {
        const request =
            activeTabId === null
                ? undefined
                : requests.current.get(activeTabId);
        if (!request) {
            return;
        }
        const words = JSON.parse(selectedWordsKey) as string[];
        if (
            selectionCleared ||
            (words.length > 0 && !sameWords(words, request.words))
        ) {
            invalidate(request);
        }
    }, [activeTabId, invalidate, selectedWordsKey, selectionCleared]);

    useEffect(
        () => () => {
            for (const request of requests.current.values()) {
                invalidate(request);
            }
        },
        [invalidate]
    );

    const analyze = useCallback(async () => {
        const tabId = activeTabId;
        if (tabId === null || !settings) {
            return;
        }
        const words = JSON.parse(selectedWordsKey) as string[];
        if (words.length === 0) {
            updateTab(tabId, {
                error: { kind: 'key', key: 'sidepanelErrorNoWords' },
            });
            return;
        }
        if (!settings.aiContextEnabled) {
            updateTab(tabId, {
                error: { kind: 'key', key: 'sidepanelErrorDisabled' },
            });
            return;
        }
        if (contextTypes.length === 0) {
            updateTab(tabId, {
                analysis: null,
                error: { kind: 'key', key: 'sidepanelErrorNoContextTypes' },
            });
            return;
        }

        const previous = requests.current.get(tabId);
        if (previous) {
            invalidate(previous);
        }
        const request: ActiveRequest = {
            tabId,
            words,
            configurationKey,
            cancelled: false,
        };
        requests.current.set(tabId, request);
        updateTab(tabId, { analysis: null, error: null, analyzing: true });
        requestCounter += 1;
        try {
            const response = await sendWithRetry(
                analyzeContext,
                {
                    action: 'analyzeContext',
                    text: words.join(' '),
                    contextTypes,
                    ...(contextTypes.length === 1
                        ? { contextType: contextTypes[0] }
                        : {}),
                    targetLanguage: settings.targetLanguage,
                    requestId: `sidepanel-${Date.now()}-${requestCounter}`,
                },
                {
                    retries: 0,
                    pingBeforeRetry: false,
                    canDispatch: () => !request.cancelled,
                }
            );
            if (request.cancelled) {
                return;
            }
            // Judged against the state React is about to commit, so a tab
            // cleared or reselected in the same tick wins over the answer.
            updateTab(tabId, (current) => {
                const shown = selectionWords(current.selection);
                if (
                    current.selection === null ||
                    (shown.length > 0 && !sameWords(shown, words))
                ) {
                    return null;
                }
                return response.success
                    ? {
                          analysis: {
                              words,
                              targetLanguage: settings.targetLanguage,
                              result: response.result.analysis,
                          },
                          error: null,
                      }
                    : {
                          error: response.error
                              ? { kind: 'text', text: response.error }
                              : { kind: 'key', key: 'sidepanelErrorGeneric' },
                      };
            });
        } catch {
            if (!request.cancelled) {
                updateTab(tabId, {
                    error: { kind: 'key', key: 'sidepanelErrorGeneric' },
                });
            }
        } finally {
            if (requests.current.get(tabId) === request) {
                requests.current.delete(tabId);
                updateTab(tabId, { analyzing: false });
            }
        }
    }, [
        activeTabId,
        configurationKey,
        contextTypes,
        invalidate,
        selectedWordsKey,
        settings,
        updateTab,
    ]);

    return {
        settingsStatus: status,
        enabled: settings?.aiContextEnabled === true,
        answer,
        analyze,
    };
}
