import React, { createContext, useContext, useState, useEffect } from 'react';

/**
 * Side Panel Context
 * 
 * Provides global state management for:
 * - Selected words for AI analysis
 * - Analysis results
 * - Loading states
 * - Error handling
 */

const SidePanelContext = createContext(null);

export function SidePanelProvider({ children }) {
    const [selectedWords, setSelectedWords] = useState(new Set());
    const [analysisResult, setAnalysisResult] = useState(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [error, setError] = useState(null);
    const [sourceLanguage, setSourceLanguage] = useState('en');
    const [targetLanguage, setTargetLanguage] = useState('zh-CN');

    // Clear error after 5 seconds
    useEffect(() => {
        if (error) {
            const timer = setTimeout(() => setError(null), 5000);
            return () => clearTimeout(timer);
        }
    }, [error]);

    const addWord = (word) => {
        setSelectedWords((prev) => new Set([...prev, word]));
    };

    const removeWord = (word) => {
        setSelectedWords((prev) => {
            const newSet = new Set(prev);
            newSet.delete(word);
            return newSet;
        });
    };

    const clearWords = () => {
        setSelectedWords(new Set());
    };

    const clearAnalysis = () => {
        setAnalysisResult(null);
        setError(null);
    };

    const value = {
        selectedWords,
        addWord,
        removeWord,
        clearWords,
        analysisResult,
        setAnalysisResult,
        isAnalyzing,
        setIsAnalyzing,
        error,
        setError,
        clearAnalysis,
        sourceLanguage,
        setSourceLanguage,
        targetLanguage,
        setTargetLanguage,
    };

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
