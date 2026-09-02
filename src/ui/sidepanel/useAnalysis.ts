import { useCallback, useEffect, useRef } from 'react';
import { CONTEXT_TYPES, type ContextType } from '@/shared/contextTypes';
import { sendWithRetry } from '@/messaging/client';
import { analyzeContext } from '@/messaging/contracts/analyzeContext';
import { useSettings, type SettingsStatus } from '../hooks/useSettings';
import type { PanelHandle } from './usePanelConnection';

export const ANALYSIS_SETTINGS_KEYS = [
    'aiContextEnabled',
    'aiContextTypes',
    'aiContextProvider',
    'targetLanguage',
] as const;

interface ActiveRequest {
    readonly tabId: number;
    readonly authorityKey: string;
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
 * Runs one analysis at a time for the bound tab. A request is only allowed
 * to publish its answer while the tab, the selection occurrence, and the
 * analysis settings it was made under are all still current; anything else
 * changing underneath it turns the answer into silence.
 */
export function useAnalysis(panel: PanelHandle): {
    readonly settingsStatus: SettingsStatus;
    readonly enabled: boolean;
    readonly analyze: () => Promise<void>;
} {
    const { settings, status } = useSettings(ANALYSIS_SETTINGS_KEYS);
    const { activeTabId, tab, updateTab } = panel;
    const activeRequest = useRef<ActiveRequest | null>(null);
    const lastTargetLanguage = useRef<string | null>(null);

    const selection = tab.selection;
    const contextTypes = normalizeContextTypes(settings?.aiContextTypes ?? []);
    const authorityKey = JSON.stringify([
        status,
        settings?.aiContextEnabled,
        settings?.aiContextProvider,
        contextTypes,
        settings?.targetLanguage,
        selection
            ? [
                  selection.selectionOwnerGeneration,
                  selection.selectionRevision,
                  selection.renderRevision,
                  selection.entries,
              ]
            : null,
    ]);
    const authority = useRef({ tabId: activeTabId, authorityKey });
    authority.current = { tabId: activeTabId, authorityKey };

    const hasAuthority = useCallback(
        (request: ActiveRequest) =>
            !request.cancelled &&
            activeRequest.current === request &&
            authority.current.tabId === request.tabId &&
            authority.current.authorityKey === request.authorityKey,
        []
    );

    const invalidate = useCallback(
        (request: ActiveRequest | null) => {
            if (!request || request.cancelled) {
                return;
            }
            request.cancelled = true;
            updateTab(request.tabId, { analyzing: false });
            if (activeRequest.current === request) {
                activeRequest.current = null;
            }
        },
        [updateTab]
    );

    useEffect(() => {
        const request = activeRequest.current;
        if (
            request &&
            (request.tabId !== activeTabId ||
                request.authorityKey !== authorityKey)
        ) {
            invalidate(request);
        }
    }, [activeTabId, authorityKey, invalidate]);

    // A new answer language makes every shown answer stale.
    useEffect(() => {
        const targetLanguage = settings?.targetLanguage ?? null;
        if (targetLanguage === null) {
            return;
        }
        const previous = lastTargetLanguage.current;
        lastTargetLanguage.current = targetLanguage;
        if (previous === null || previous === targetLanguage) {
            return;
        }
        invalidate(activeRequest.current);
        if (activeTabId !== null) {
            updateTab(activeTabId, { analysis: null, error: null });
        }
    }, [activeTabId, invalidate, settings?.targetLanguage, updateTab]);

    useEffect(() => () => invalidate(activeRequest.current), [invalidate]);

    const analyze = useCallback(async () => {
        const tabId = activeTabId;
        if (tabId === null || !settings) {
            return;
        }
        const words = selection?.entries.map((entry) => entry.word) ?? [];
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

        invalidate(activeRequest.current);
        const request: ActiveRequest = {
            tabId,
            authorityKey,
            cancelled: false,
        };
        activeRequest.current = request;
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
                    canDispatch: () => hasAuthority(request),
                }
            );
            if (!hasAuthority(request)) {
                return;
            }
            updateTab(
                tabId,
                response.success
                    ? { analysis: response.result.analysis, error: null }
                    : {
                          error: response.error
                              ? { kind: 'text', text: response.error }
                              : { kind: 'key', key: 'sidepanelErrorGeneric' },
                      }
            );
        } catch {
            if (hasAuthority(request)) {
                updateTab(tabId, {
                    error: { kind: 'key', key: 'sidepanelErrorGeneric' },
                });
            }
        } finally {
            if (activeRequest.current === request) {
                activeRequest.current = null;
                updateTab(tabId, { analyzing: false });
            }
        }
    }, [
        activeTabId,
        authorityKey,
        contextTypes,
        hasAuthority,
        invalidate,
        selection,
        settings,
        updateTab,
    ]);

    return {
        settingsStatus: status,
        enabled: settings?.aiContextEnabled === true,
        analyze,
    };
}
