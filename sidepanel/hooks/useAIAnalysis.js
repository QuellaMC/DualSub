import { useCallback, useEffect, useRef } from 'react';
import { useSidePanelContext } from './SidePanelContext.jsx';
import { useSettings } from './useSettings.js';
import { CONTEXT_TYPES } from '../../context_providers/contextSchemas.js';

const AI_SETTINGS_KEYS = [
    'aiContextEnabled',
    'aiContextProvider',
    'aiContextTypes',
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
        communication,
        error,
        isAnalyzing,
        selectedWords,
        targetLanguage,
        updateTabState,
    } = useSidePanelContext();
    const { sendToBoundTab, sendToTab } = communication;
    const {
        settings,
        loading: settingsLoading,
        error: settingsError,
    } = useSettings(AI_SETTINGS_KEYS);
    const activeRequestRef = useRef(null);
    const requestCounterRef = useRef(0);

    const notifyAnalyzingState = useCallback(
        async (tabId, nextIsAnalyzing) => {
            const data = { isAnalyzing: nextIsAnalyzing };
            if (typeof tabId === 'number') {
                return sendToTab(tabId, 'sidePanelSetAnalyzing', data);
            }
            return sendToBoundTab('sidePanelSetAnalyzing', data);
        },
        [sendToBoundTab, sendToTab]
    );

    const invalidateRequest = useCallback(
        (request) => {
            if (!request || request.cancelled) {
                return Promise.resolve();
            }

            request.cancelled = true;
            if (typeof request.tabId === 'number') {
                updateTabState(request.tabId, { isAnalyzing: false });
            }

            const notification = notifyAnalyzingState(
                request.tabId,
                false
            ).catch((notificationError) =>
                console.warn(
                    'Failed to clear analyzing state:',
                    notificationError
                )
            );

            if (activeRequestRef.current === request) {
                activeRequestRef.current = null;
            }

            return notification;
        },
        [notifyAnalyzingState, updateTabState]
    );

    const selectedWordsKey = normalizeWords(selectedWords).join('\u0000');
    const contextTypesKey = normalizeContextTypes(settings.aiContextTypes).join(
        ','
    );
    const requestConfigurationKey = [
        settings.aiContextEnabled,
        settings.aiContextProvider,
        contextTypesKey,
        targetLanguage,
    ].join('|');

    useEffect(() => {
        const request = activeRequestRef.current;
        if (
            request &&
            (request.tabId !== activeTabId ||
                request.wordsKey !== selectedWordsKey ||
                request.configurationKey !== requestConfigurationKey)
        ) {
            void invalidateRequest(request);
        }
    }, [
        activeTabId,
        invalidateRequest,
        requestConfigurationKey,
        selectedWordsKey,
    ]);

    useEffect(
        () => () => {
            void invalidateRequest(activeRequestRef.current);
        },
        [invalidateRequest]
    );

    const analyzeWords = useCallback(
        async (customWords = null) => {
            const wordsToAnalyze = normalizeWords(customWords ?? selectedWords);
            const requestTabId = activeTabId;

            if (wordsToAnalyze.length === 0) {
                if (typeof requestTabId === 'number') {
                    updateTabState(requestTabId, {
                        error: chrome.i18n.getMessage('sidepanelErrorNoWords'),
                    });
                }
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

            await invalidateRequest(activeRequestRef.current);

            const request = {
                cancelled: false,
                configurationKey: requestConfigurationKey,
                id: ++requestCounterRef.current,
                tabId: requestTabId,
                wordsKey: wordsToAnalyze.join('\u0000'),
            };
            activeRequestRef.current = request;

            updateTabState(requestTabId, {
                analysisResult: null,
                error: null,
                isAnalyzing: true,
            });

            try {
                await notifyAnalyzingState(requestTabId, true);
            } catch (notificationError) {
                console.warn(
                    'Failed to set analyzing state:',
                    notificationError
                );
            }

            if (request.cancelled || activeRequestRef.current !== request) {
                return null;
            }

            try {
                const message = {
                    action: 'analyzeContext',
                    text: wordsToAnalyze.join(' '),
                    contextTypes,
                    targetLanguage,
                    requestId: `sidepanel-${Date.now()}-${request.id}`,
                };
                if (contextTypes.length === 1) {
                    message.contextType = contextTypes[0];
                }
                const response = await chrome.runtime.sendMessage(message);

                if (request.cancelled || activeRequestRef.current !== request) {
                    return null;
                }

                if (!response?.success) {
                    updateTabState(requestTabId, {
                        error:
                            response?.error ||
                            chrome.i18n.getMessage('sidepanelErrorGeneric'),
                    });
                    return null;
                }

                const payload = response.result || response;
                const normalizedResult =
                    payload?.analysis || payload?.result || null;

                if (!normalizedResult) {
                    updateTabState(requestTabId, {
                        error: chrome.i18n.getMessage('sidepanelErrorGeneric'),
                    });
                    return null;
                }

                updateTabState(requestTabId, {
                    analysisResult: normalizedResult,
                    error: null,
                });
                return normalizedResult;
            } catch (requestError) {
                if (request.cancelled || activeRequestRef.current !== request) {
                    return null;
                }

                console.error('AI analysis error:', requestError);
                updateTabState(requestTabId, {
                    error:
                        requestError.message ||
                        chrome.i18n.getMessage('sidepanelErrorGeneric'),
                });
                return null;
            } finally {
                if (activeRequestRef.current === request) {
                    activeRequestRef.current = null;
                    updateTabState(requestTabId, { isAnalyzing: false });

                    try {
                        await notifyAnalyzingState(requestTabId, false);
                    } catch (notificationError) {
                        console.warn(
                            'Failed to clear analyzing state:',
                            notificationError
                        );
                    }
                }
            }
        },
        [
            activeTabId,
            invalidateRequest,
            notifyAnalyzingState,
            requestConfigurationKey,
            selectedWords,
            settings,
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
