import { useCallback, useEffect, useRef } from 'react';
import { CONTEXT_TYPES, type ContextType } from '@/shared/contextTypes';
import { sendWithRetry } from '@/messaging/client';
import { analyzeContext } from '@/messaging/contracts/analyzeContext';
import { useSettings, type SettingsStatus } from '../hooks/useSettings';
import {
    sameWords,
    selectionWords,
    type AnalysisOutcome,
    type PanelHandle,
} from './usePanelConnection';

/** Everything that can change an answer: what is asked of the provider,
 *  and the provider identity the background caches by (its credentials
 *  aside, which no surface reads). */
export const ANALYSIS_SETTINGS_KEYS = [
    'aiContextEnabled',
    'aiContextTypes',
    'aiContextProvider',
    'openaiBaseUrl',
    'openaiModel',
    'geminiModel',
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
 * nor loses its outcome. It is dropped only when its tab's words change to
 * other words, its tab's document goes away, or the analysis settings
 * change underneath it. An outcome is shown only under the analysis
 * settings it was made with; changing them hides it and changing them
 * back shows it again.
 */
export function useAnalysis(panel: PanelHandle): {
    readonly settingsStatus: SettingsStatus;
    readonly enabled: boolean;
    readonly outcome: AnalysisOutcome | null;
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
        settings?.openaiBaseUrl,
        settings?.openaiModel,
        settings?.geminiModel,
        contextTypes,
        settings?.targetLanguage,
    ]);
    const selectedWordsKey = JSON.stringify(selectionWords(tab.selection));
    const selectionCleared = tab.selection === null;
    const outcome =
        tab.outcome !== null && tab.outcome.configuration === configurationKey
            ? tab.outcome
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
        const refuse = (key: string) =>
            updateTab(tabId, {
                outcome: {
                    words,
                    configuration: configurationKey,
                    answer: null,
                    error: { kind: 'key', key },
                },
            });
        if (words.length === 0) {
            refuse('sidepanelErrorNoWords');
            return;
        }
        if (!settings.aiContextEnabled) {
            refuse('sidepanelErrorDisabled');
            return;
        }
        if (contextTypes.length === 0) {
            refuse('sidepanelErrorNoContextTypes');
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
        updateTab(tabId, { outcome: null, analyzing: true });
        // Judged against the state React is about to commit, so a tab
        // cleared or reselected in the same tick wins over the outcome.
        const settle = (
            answer: AnalysisOutcome['answer'],
            error: AnalysisOutcome['error']
        ) =>
            updateTab(tabId, (current) => {
                const shown = selectionWords(current.selection);
                return current.selection === null ||
                    (shown.length > 0 && !sameWords(shown, words))
                    ? null
                    : {
                          outcome: {
                              words,
                              configuration: configurationKey,
                              answer,
                              error,
                          },
                      };
            });
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
            if (response.success) {
                settle(response.result.analysis, null);
            } else {
                settle(
                    null,
                    response.error
                        ? { kind: 'text', text: response.error }
                        : { kind: 'key', key: 'sidepanelErrorGeneric' }
                );
            }
        } catch {
            if (!request.cancelled) {
                settle(null, { kind: 'key', key: 'sidepanelErrorGeneric' });
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
        outcome,
        analyze,
    };
}
