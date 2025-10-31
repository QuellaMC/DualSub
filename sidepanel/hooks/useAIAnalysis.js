import { useState, useCallback, useRef, useEffect } from 'react';
import { useSidePanelContext } from './SidePanelContext.jsx';
import { useSidePanelCommunication } from './useSidePanelCommunication.js';

/**
 * AI Analysis Hook
 * 
 * Provides AI context analysis functionality for the side panel.
 * Integrates with the background service worker and existing AIContextProvider.
 * 
 * Features:
 * - Request AI analysis for selected words
 * - Handle loading states and errors
 * - Cache results for performance
 * - Support retry logic
 */
export function useAIAnalysis() {
    const {
        selectedWords,
        analysisResult,
        setAnalysisResult,
        isAnalyzing,
        setIsAnalyzing,
        error,
        setError,
        sourceLanguage,
        targetLanguage,
    } = useSidePanelContext();

    const [settings, setSettings] = useState(null);
    const cacheRef = useRef(new Map());
    const abortControllerRef = useRef(null);

    const { sendToActiveTab } = useSidePanelCommunication();

    // Load settings
    useEffect(() => {
        const loadSettings = async () => {
            try {
                const result = await chrome.storage.sync.get([
                    'aiContextEnabled',
                    'aiContextProvider',
                    'aiContextTypes',
                    'aiContextTimeout',
                    'aiContextCacheEnabled',
                ]);
                setSettings(result);
            } catch (err) {
                console.error('Failed to load AI settings:', err);
            }
        };
        loadSettings();
    }, []);

    /**
     * Generate cache key for analysis request
     */
    const getCacheKey = useCallback((words, contextTypes, language) => {
        const sortedWords = Array.from(words).sort().join(',');
        const sortedTypes = contextTypes.sort().join(',');
        return `${sortedWords}:${sortedTypes}:${language}`;
    }, []);

    /**
     * Check if result is in cache
     */
    const getCachedResult = useCallback(
        (words, contextTypes, language) => {
            if (!settings?.aiContextCacheEnabled) {
                return null;
            }

            const key = getCacheKey(words, contextTypes, language);
            const cached = cacheRef.current.get(key);

            if (cached && Date.now() - cached.timestamp < 3600000) {
                // 1 hour cache
                return cached.result;
            }

            return null;
        },
        [settings, getCacheKey]
    );

    /**
     * Store result in cache
     */
    const setCachedResult = useCallback(
        (words, contextTypes, language, result) => {
            if (!settings?.aiContextCacheEnabled) {
                return;
            }

            const key = getCacheKey(words, contextTypes, language);
            cacheRef.current.set(key, {
                result,
                timestamp: Date.now(),
            });

            // Clean up old cache entries (keep last 50)
            if (cacheRef.current.size > 50) {
                const oldestKey = cacheRef.current.keys().next().value;
                cacheRef.current.delete(oldestKey);
            }
        },
        [settings, getCacheKey]
    );

    /**
     * Request AI analysis for selected words
     */
    const analyzeWords = useCallback(
        async (customWords = null) => {
            const wordsToAnalyze = customWords || selectedWords;

            if (!wordsToAnalyze || wordsToAnalyze.size === 0) {
                setError('No words selected for analysis');
                return null;
            }

            if (!settings?.aiContextEnabled) {
                setError('AI Context analysis is disabled. Enable it in settings.');
                return null;
            }

            // Check cache first
            const contextTypes = settings?.aiContextTypes || [
                'cultural',
                'historical',
                'linguistic',
            ];
            const cachedResult = getCachedResult(
                wordsToAnalyze,
                contextTypes,
                sourceLanguage
            );

            if (cachedResult) {
                setAnalysisResult(cachedResult);
                return cachedResult;
            }

            // Cancel any existing request
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }

            abortControllerRef.current = new AbortController();

            setIsAnalyzing(true);
            setError(null);
            setAnalysisResult(null);

            // Notify content script (active tab) that analysis started (to block word clicks)
            try {
                await sendToActiveTab('sidePanelSetAnalyzing', { isAnalyzing: true });
            } catch (err) {
                console.warn('Failed to notify analyzing state:', err);
            }

            try {
                const text = Array.from(wordsToAnalyze).join(' ');

                // Send request to background service worker
                const response = await chrome.runtime.sendMessage({
                    action: 'analyzeContext',
                    text,
                    contextTypes,
                    language: sourceLanguage,
                    targetLanguage: targetLanguage,
                    requestId: `sidepanel-${Date.now()}`,
                });

                // Check if request was aborted
                if (abortControllerRef.current?.signal.aborted) {
                    return null;
                }

                if (response && response.success) {
                    const payload = response.result || response;
                    const normalized = payload?.analysis || payload?.result || null;

                    // Store in cache
                    if (normalized) {
                        setCachedResult(
                            wordsToAnalyze,
                            contextTypes,
                            sourceLanguage,
                            normalized
                        );
                    }

                    setAnalysisResult(normalized);
                    return normalized;
                } else {
                    const errorMsg =
                        response?.error || 'Analysis failed. Please try again.';
                    setError(errorMsg);
                    return null;
                }
            } catch (err) {
                // Check if error is due to abort
                if (err.name === 'AbortError') {
                    return null;
                }

                console.error('AI analysis error:', err);
                const errorMsg =
                    err.message || 'An error occurred during analysis.';
                setError(errorMsg);
                return null;
            } finally {
                setIsAnalyzing(false);
                abortControllerRef.current = null;

                // Notify content script (active tab) that analysis stopped
                try {
                    await sendToActiveTab('sidePanelSetAnalyzing', { isAnalyzing: false });
                } catch (err) {
                    console.warn('Failed to notify analyzing state:', err);
                }
            }
        },
        [
            selectedWords,
            settings,
            sourceLanguage,
            targetLanguage,
            setIsAnalyzing,
            setError,
            setAnalysisResult,
            getCachedResult,
            setCachedResult,
        ]
    );

    /**
     * Cancel ongoing analysis
     */
    const cancelAnalysis = useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
        setIsAnalyzing(false);
    }, [setIsAnalyzing]);

    /**
     * Clear cache
     */
    const clearCache = useCallback(() => {
        cacheRef.current.clear();
    }, []);

    /**
     * Retry last analysis
     */
    const retryAnalysis = useCallback(() => {
        return analyzeWords();
    }, [analyzeWords]);

    return {
        analyzeWords,
        cancelAnalysis,
        retryAnalysis,
        clearCache,
        isAnalyzing,
        analysisResult,
        error,
        settings,
    };
}
