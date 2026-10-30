import { useCallback, useEffect, useRef } from 'react';
import type { SettingsValues } from '@/config/schema';
import { sendWithRetry } from '@/messaging/client';
import {
    analyzeContext,
    type AiAnswer,
    type AnswerFailure,
} from '@/messaging/contracts/analyzeContext';
import { CONTEXT_TYPES, type ContextType } from '@/shared/contextTypes';
import type { SettingsStatus } from '../hooks/useSettings';
import { pickedSubject } from './picked';
import type { Explanation, Lookup, PanelHandle } from './usePanelConnection';

/** Everything that can change an answer: what is asked of the provider,
 *  and the provider identity the background caches by (its credentials
 *  aside, which the panel never reads). */
export const ANALYSIS_SETTINGS_KEYS = [
    'aiContextTypes',
    'aiContextProvider',
    'openaiBaseUrl',
    'openaiModel',
    'geminiModel',
    'targetLanguage',
] as const;

export type AnalysisSettings = Pick<
    SettingsValues,
    (typeof ANALYSIS_SETTINGS_KEYS)[number]
>;

/** A request belongs to the tab, the content session, and the subject it
 *  was started for, under the settings of that moment. */
interface ActiveRequest {
    readonly tabId: number;
    readonly session: string;
    readonly subject: string;
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

function lookupSubject(lookup: Lookup | null): string | null {
    return lookup && pickedSubject(lookup.line, lookup.entries);
}

/**
 * Explains the looked-up words of the bound tab, only when asked. A
 * request belongs to its tab, not to the panel's current view: switching
 * tabs while it runs neither cancels it nor loses its outcome. It is
 * dropped only when its tab looks up other words or the same words in
 * another line, its tab moves to another content session or has nothing
 * to show, or the AI settings
 * change underneath it. An explanation is shown only under the settings it
 * was made with; changing them hides it and changing them back shows it
 * again.
 */
export function useAnalysis(
    panel: PanelHandle,
    settings: AnalysisSettings | null,
    status: SettingsStatus
): {
    readonly explanation: Explanation | null;
    /** Open while the request for these words needed a key, whichever
     *  service the viewer then picks in it; `refused` holds only for the
     *  service whose key was turned down. */
    readonly guide: { readonly refused: boolean } | null;
    readonly explaining: boolean;
    readonly explain: () => Promise<void>;
    readonly dismiss: () => void;
} {
    const { activeTabId, tab, updateTab } = panel;
    const requests = useRef(new Map<number, ActiveRequest>());

    const contextTypes = normalizeContextTypes(settings?.aiContextTypes ?? []);
    const configurationKey = JSON.stringify([
        status,
        settings?.aiContextProvider,
        settings?.openaiBaseUrl,
        settings?.openaiModel,
        settings?.geminiModel,
        contextTypes,
        settings?.targetLanguage,
    ]);
    const subject = lookupSubject(tab.lookup);
    const session = tab.selection?.session ?? null;
    const forSubject =
        tab.explanation?.subject === subject ? tab.explanation : null;
    const explanation =
        forSubject?.configuration === configurationKey ? forSubject : null;
    const guide =
        forSubject?.failure === 'setup' || forSubject?.failure === 'auth'
            ? { refused: explanation?.failure === 'auth' }
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
            updateTab(request.tabId, { explaining: false });
        },
        [updateTab]
    );

    // Settings changes end every flight; another subject or another session
    // end the active tab's. Other tabs cannot change their words while
    // inactive: the background accepts snapshots only from the active tab.
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
        if (
            request &&
            (session !== request.session || subject !== request.subject)
        ) {
            invalidate(request);
        }
    }, [activeTabId, invalidate, session, subject]);

    useEffect(
        () => () => {
            for (const request of requests.current.values()) {
                invalidate(request);
            }
        },
        [invalidate]
    );

    const explain = useCallback(async () => {
        const tabId = activeTabId;
        const lookup = tab.lookup;
        if (tabId === null || !settings || !lookup || session === null) {
            return;
        }
        const previous = requests.current.get(tabId);
        if (previous) {
            invalidate(previous);
        }
        const request: ActiveRequest = {
            tabId,
            session,
            subject: pickedSubject(lookup.line, lookup.entries),
            configurationKey,
            cancelled: false,
        };
        requests.current.set(tabId, request);
        updateTab(tabId, { explanation: null, explaining: true });
        // Judged against the state React is about to commit, so a tab
        // cleared, moved to another session, or given another subject in
        // the same tick wins over the outcome.
        const settle = (
            answer: AiAnswer | null,
            failure: AnswerFailure | null
        ) =>
            updateTab(tabId, (current) =>
                current.selection === null ||
                current.selection.session !== request.session ||
                lookupSubject(current.lookup) !== request.subject
                    ? null
                    : {
                          explanation: {
                              subject: request.subject,
                              configuration: configurationKey,
                              answer,
                              failure,
                          },
                      }
            );
        try {
            const response = await sendWithRetry(
                analyzeContext,
                {
                    action: 'analyzeContext',
                    text: lookup.text,
                    line: lookup.line.text,
                    language: lookup.line.language,
                    contextTypes,
                    targetLanguage: settings.targetLanguage,
                },
                {
                    retries: 0,
                    pingBeforeRetry: false,
                    canDispatch: () => !request.cancelled,
                }
            );
            if (!request.cancelled) {
                if (response.success) {
                    settle(response.answer, null);
                } else {
                    settle(null, response.reason);
                }
            }
        } catch {
            if (!request.cancelled) {
                settle(null, 'failed');
            }
        } finally {
            if (requests.current.get(tabId) === request) {
                requests.current.delete(tabId);
                updateTab(tabId, { explaining: false });
            }
        }
    }, [
        activeTabId,
        configurationKey,
        contextTypes,
        invalidate,
        session,
        settings,
        tab.lookup,
        updateTab,
    ]);

    const dismiss = useCallback(() => {
        if (activeTabId !== null) {
            updateTab(activeTabId, { explanation: null });
        }
    }, [activeTabId, updateTab]);

    return {
        explanation,
        guide,
        explaining: tab.explaining,
        explain,
        dismiss,
    };
}
