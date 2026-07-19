import { useCallback, useEffect, useRef } from 'react';
import {
    buildAnalyzeContextRequestMessage,
    MessageSenderRoles,
    parseAnalyzeContextResponseMessage,
} from '../../content_scripts/shared/protocol/messageProtocol.js';
import { sendRuntimeMessageWithRetry } from '../../content_scripts/shared/messaging.js';
import { useSidePanelContext } from './SidePanelContext.jsx';
import { useSettings } from './useSettings.js';
import { CONTEXT_TYPES } from '../../context_providers/contextSchemas.js';

const AI_SETTINGS_KEYS = [
    'aiContextEnabled',
    'aiContextProvider',
    'aiContextTypes',
    'targetLanguage',
];

const ALLOWED_CONTEXT_TYPES = new Set(CONTEXT_TYPES);

function normalizeWords(words) {
    if (!words || typeof words === 'string') {
        return typeof words === 'string' && words.trim() ? [words.trim()] : [];
    }

    if (typeof words[Symbol.iterator] !== 'function') {
        return [];
    }

    return Array.from(words)
        .map((word) => (typeof word === 'string' ? word.trim() : ''))
        .filter(Boolean);
}

function normalizeContextTypes(contextTypes) {
    return Array.isArray(contextTypes)
        ? [
              ...new Set(
                  contextTypes.filter((type) => ALLOWED_CONTEXT_TYPES.has(type))
              ),
          ]
        : [];
}

function createSelectionAuthorityKey(selection) {
    return selection
        ? [
              selection.selectionOwnerGeneration,
              selection.selectionRevision,
              selection.renderRevision,
          ].join(':')
        : 'none';
}

function getMessage(key, fallback) {
    return chrome.i18n.getMessage(key) || fallback;
}

/**
 * Coordinates AI analysis for the currently bound browser tab. Chrome runtime
 * messages cannot be aborted, so requests are invalidated locally and stale
 * responses are ignored.
 */
export function useAIAnalysis() {
    const {
        activeTabId,
        analysisResult,
        error,
        isAnalyzing,
        selection,
        selectedWords,
        updateTabState,
    } = useSidePanelContext();
    const {
        settings,
        loading: settingsLoading,
        error: settingsError,
    } = useSettings(AI_SETTINGS_KEYS);
    const targetLanguage = settings.targetLanguage;
    const settingsReady = !settingsLoading && !settingsError;
    const activeRequestRef = useRef(null);
    const confirmedTargetLanguageRef = useRef(null);
    const requestCounterRef = useRef(0);
    const requestAuthorityRef = useRef(null);

    const invalidateRequest = useCallback(
        (request) => {
            if (!request || request.cancelled) {
                return;
            }

            request.cancelled = true;
            if (typeof request.tabId === 'number') {
                updateTabState(request.tabId, { isAnalyzing: false });
            }

            if (activeRequestRef.current === request) {
                activeRequestRef.current = null;
            }
        },
        [updateTabState]
    );

    const selectedWordsKey = selectedWords.join('\u0000');
    const contextTypesKey = normalizeContextTypes(settings.aiContextTypes).join(
        ','
    );
    const requestConfigurationKey = [
        settingsReady,
        settings.aiContextEnabled,
        settings.aiContextProvider,
        contextTypesKey,
        targetLanguage,
    ].join('|');
    const selectionAuthorityKey = createSelectionAuthorityKey(selection);
    requestAuthorityRef.current = {
        configurationKey: requestConfigurationKey,
        selectionAuthorityKey,
        tabId: activeTabId,
    };

    const hasRequestAuthority = useCallback((request) => {
        const currentAuthority = requestAuthorityRef.current;
        return Boolean(
            request &&
            request.cancelled === false &&
            activeRequestRef.current === request &&
            currentAuthority?.tabId === request.tabId &&
            currentAuthority.configurationKey === request.configurationKey &&
            currentAuthority.selectionAuthorityKey ===
                request.selectionAuthorityKey
        );
    }, []);

    useEffect(() => {
        const request = activeRequestRef.current;
        if (
            request &&
            (request.tabId !== activeTabId ||
                request.wordsKey !== selectedWordsKey ||
                request.selectionAuthorityKey !== selectionAuthorityKey ||
                request.configurationKey !== requestConfigurationKey)
        ) {
            void invalidateRequest(request);
        }
    }, [
        activeTabId,
        invalidateRequest,
        requestConfigurationKey,
        selectionAuthorityKey,
        selectedWordsKey,
    ]);

    useEffect(() => {
        if (!settingsReady || typeof targetLanguage !== 'string') {
            return;
        }

        const previousTargetLanguage = confirmedTargetLanguageRef.current;
        confirmedTargetLanguageRef.current = targetLanguage;
        if (
            previousTargetLanguage === null ||
            previousTargetLanguage === targetLanguage
        ) {
            return;
        }

        invalidateRequest(activeRequestRef.current);
        if (typeof activeTabId === 'number') {
            updateTabState(activeTabId, {
                analysisResult: null,
                error: null,
            });
        }
    }, [
        activeTabId,
        invalidateRequest,
        settingsReady,
        targetLanguage,
        updateTabState,
    ]);

    useEffect(
        () => () => {
            void invalidateRequest(activeRequestRef.current);
        },
        [invalidateRequest]
    );

    const analyzeWords = useCallback(
        async (customWords = null) => {
            const wordsToAnalyze =
                customWords === null
                    ? [...selectedWords]
                    : normalizeWords(customWords);
            const requestTabId = activeTabId;

            if (wordsToAnalyze.length === 0) {
                if (typeof requestTabId === 'number') {
                    updateTabState(requestTabId, {
                        error: chrome.i18n.getMessage('sidepanelErrorNoWords'),
                    });
                }
                return null;
            }

            if (!settingsReady) {
                return null;
            }

            if (!settings?.aiContextEnabled) {
                updateTabState(requestTabId, {
                    error: chrome.i18n.getMessage('sidepanelErrorDisabled'),
                });
                return null;
            }

            const contextTypes = normalizeContextTypes(settings.aiContextTypes);
            if (contextTypes.length === 0) {
                updateTabState(requestTabId, {
                    analysisResult: null,
                    error: getMessage(
                        'sidepanelErrorNoContextTypes',
                        'Select at least one context type before analyzing'
                    ),
                });
                return null;
            }

            invalidateRequest(activeRequestRef.current);

            const request = {
                cancelled: false,
                configurationKey: requestConfigurationKey,
                id: ++requestCounterRef.current,
                selectionAuthorityKey,
                tabId: requestTabId,
                wordsKey: wordsToAnalyze.join('\u0000'),
            };
            activeRequestRef.current = request;

            updateTabState(requestTabId, {
                analysisResult: null,
                error: null,
                isAnalyzing: true,
            });

            if (!hasRequestAuthority(request)) {
                return null;
            }

            try {
                const message = buildAnalyzeContextRequestMessage(
                    MessageSenderRoles.SIDEPANEL,
                    {
                        text: wordsToAnalyze.join(' '),
                        contextTypes,
                        targetLanguage,
                        requestId: `sidepanel-${Date.now()}-${request.id}`,
                    }
                );
                const response = await sendRuntimeMessageWithRetry(message, {
                    retries: 0,
                    pingBeforeRetry: false,
                    canDispatch: () => hasRequestAuthority(request),
                });

                if (!hasRequestAuthority(request)) {
                    return null;
                }

                const parsedResponse = parseAnalyzeContextResponseMessage(
                    response,
                    message,
                    MessageSenderRoles.SIDEPANEL
                );
                if (parsedResponse?.status !== 'success') {
                    updateTabState(requestTabId, {
                        error: chrome.i18n.getMessage('sidepanelErrorGeneric'),
                    });
                    return null;
                }

                const normalizedResult = parsedResponse.result.analysis;

                updateTabState(requestTabId, {
                    analysisResult: normalizedResult,
                    error: null,
                });
                return normalizedResult;
            } catch (_) {
                if (!hasRequestAuthority(request)) {
                    return null;
                }

                console.error('AI analysis request failed');
                updateTabState(requestTabId, {
                    error: chrome.i18n.getMessage('sidepanelErrorGeneric'),
                });
                return null;
            } finally {
                if (activeRequestRef.current === request) {
                    activeRequestRef.current = null;
                    updateTabState(requestTabId, { isAnalyzing: false });
                }
            }
        },
        [
            activeTabId,
            hasRequestAuthority,
            invalidateRequest,
            requestConfigurationKey,
            selectionAuthorityKey,
            selectedWords,
            settings,
            settingsReady,
            targetLanguage,
            updateTabState,
        ]
    );

    const retryAnalysis = useCallback(() => analyzeWords(), [analyzeWords]);

    return {
        analysisResult,
        analyzeWords,
        error: error || settingsError?.message || null,
        isAnalyzing,
        retryAnalysis,
        settings,
        settingsLoading,
    };
}
