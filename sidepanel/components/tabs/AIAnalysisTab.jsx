import React from 'react';
import { useSidePanelContext } from '../../hooks/SidePanelContext.jsx';
import { useAIAnalysis } from '../../hooks/useAIAnalysis.js';
import { useWordSelection } from '../../hooks/useWordSelection.js';

/**
 * AI Analysis Tab
 * 
 * Main tab for AI context analysis functionality.
 * Displays word selection interface and analysis results.
 */
export function AIAnalysisTab() {
    const {
        selectedWords,
        analysisResult,
        isAnalyzing,
        error,
    } = useSidePanelContext();

    const { analyzeWords, retryAnalysis, settings } = useAIAnalysis();
    const { toggleWord, clearSelection } = useWordSelection();

    const handleAnalyze = () => {
        if (selectedWords.size > 0) {
            analyzeWords();
        }
    };

    const handleWordRemove = (word) => {
        toggleWord(word);
    };

    return (
        <>
            <div className="ai-analysis-tab">
                <div className="tab-header">
                    <h1 className="tab-title">AI Analysis</h1>
                    <button 
                        className="analyze-button"
                        onClick={handleAnalyze}
                        disabled={selectedWords.size === 0 || isAnalyzing || !settings?.aiContextEnabled}
                    >
                        <span className="material-symbols-outlined">
                            auto_awesome
                        </span>
                        <span>{isAnalyzing ? 'Analyzing...' : 'Analyze'}</span>
                    </button>
                </div>

                <div className="input-container">
                    <label className="input-label" htmlFor="word-input">
                        Words to Analyze
                    </label>
                    <div className="word-input-wrapper">
                        <div className="word-tags">
                            {Array.from(selectedWords).map((word) => (
                                <span key={word} className="word-tag">
                                    {word}
                                    <button
                                        className="word-tag-remove"
                                        onClick={() => handleWordRemove(word)}
                                        aria-label={`Remove ${word}`}
                                    >
                                        ×
                                    </button>
                                </span>
                            ))}
                            {selectedWords.size === 0 && (
                                <span className="placeholder-text">
                                    Click on subtitle words to add them for analysis...
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {isAnalyzing && (
                    <div className="loading-state">
                        <div className="spinner" />
                        <p>Analyzing...</p>
                    </div>
                )}

                {error && (
                    <div className="error-message">
                        <span className="material-symbols-outlined">error</span>
                        <div>
                            <p>{error}</p>
                            <button 
                                className="error-retry"
                                onClick={retryAnalysis}
                            >
                                Retry
                            </button>
                        </div>
                    </div>
                )}

                {analysisResult && !isAnalyzing && (
                    <div className="results-container">
                        <h2 className="results-title">
                            Results for "{Array.from(selectedWords).join('", "')}"
                        </h2>
                        <div className="results-sections">
                            {analysisResult.culturalContext && (
                                <div className="result-section">
                                    <h3 className="result-section-title">Cultural Context</h3>
                                    <p className="result-section-content">
                                        {analysisResult.culturalContext}
                                    </p>
                                </div>
                            )}
                            {analysisResult.historicalContext && (
                                <div className="result-section">
                                    <h3 className="result-section-title">Historical Context</h3>
                                    <p className="result-section-content">
                                        {analysisResult.historicalContext}
                                    </p>
                                </div>
                            )}
                            {analysisResult.linguisticAnalysis && (
                                <div className="result-section">
                                    <h3 className="result-section-title">Linguistic Analysis</h3>
                                    <p className="result-section-content">
                                        {analysisResult.linguisticAnalysis}
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            <style>{`
                .ai-analysis-tab {
                    padding: var(--spacing-4);
                    min-width: 360px;
                    max-width: 920px;
                    margin: 0 auto;
                }

                .tab-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: var(--spacing-4);
                }

                .tab-title {
                    font-size: var(--font-size-2xl);
                    font-weight: 700;
                    color: var(--color-foreground-light);
                    margin: 0;
                }

                body.dark .tab-title {
                    color: var(--color-foreground-dark);
                }

                .analyze-button {
                    display: flex;
                    align-items: center;
                    gap: var(--spacing-2);
                    background: var(--color-primary);
                    color: white;
                    padding: var(--spacing-2) var(--spacing-4);
                    border-radius: var(--radius-lg);
                    font-weight: 600;
                    font-size: var(--font-size-sm);
                    transition: all var(--transition-base);
                }

                .analyze-button:hover:not(:disabled) {
                    background: #1170d8;
                }

                .analyze-button:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }

                .analyze-button .material-symbols-outlined {
                    font-size: 18px;
                }

                .input-container {
                    background: var(--color-surface-light);
                    border: 1px solid var(--color-border-light);
                    border-radius: var(--radius-lg);
                    padding: var(--spacing-4);
                    margin-bottom: var(--spacing-6);
                }

                body.dark .input-container {
                    background: var(--color-surface-dark);
                    border-color: var(--color-border-dark);
                }

                .input-label {
                    display: block;
                    font-size: var(--font-size-sm);
                    font-weight: 500;
                    color: var(--color-foreground-light);
                    margin-bottom: var(--spacing-2);
                }

                body.dark .input-label {
                    color: var(--color-foreground-dark);
                }

                .word-input-wrapper {
                    background: var(--color-background-light);
                    border: 1px solid var(--color-border-light);
                    border-radius: var(--radius-lg);
                    padding: var(--spacing-3);
                }

                body.dark .word-input-wrapper {
                    background: var(--color-background-dark);
                    border-color: var(--color-border-dark);
                }

                .word-tags {
                    display: flex;
                    flex-wrap: wrap;
                    gap: var(--spacing-2);
                    min-height: 40px;
                    align-items: center;
                }

                .word-tag {
                    display: flex;
                    align-items: center;
                    gap: var(--spacing-1);
                    background: rgba(19, 127, 236, 0.1);
                    color: var(--color-primary);
                    font-size: var(--font-size-sm);
                    font-weight: 500;
                    padding: var(--spacing-1) var(--spacing-2);
                    border-radius: 6px;
                }

                .word-tag-remove {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 16px;
                    height: 16px;
                    margin-left: var(--spacing-1);
                    background: transparent;
                    color: var(--color-primary);
                    border: none;
                    border-radius: 50%;
                    font-size: 18px;
                    line-height: 1;
                    cursor: pointer;
                    transition: all var(--transition-fast);
                }

                .word-tag-remove:hover {
                    background: rgba(19, 127, 236, 0.2);
                    color: var(--color-error);
                }

                .placeholder-text {
                    color: var(--color-subtle-light);
                    font-size: var(--font-size-sm);
                }

                body.dark .placeholder-text {
                    color: var(--color-subtle-dark);
                }

                .loading-state {
                    text-align: center;
                    padding: var(--spacing-8);
                    color: var(--color-subtle-light);
                }

                body.dark .loading-state {
                    color: var(--color-subtle-dark);
                }

                .spinner {
                    width: 40px;
                    height: 40px;
                    border: 4px solid var(--color-border-light);
                    border-top-color: var(--color-primary);
                    border-radius: 50%;
                    animation: spin 1s linear infinite;
                    margin: 0 auto var(--spacing-4);
                }

                body.dark .spinner {
                    border-color: var(--color-border-dark);
                    border-top-color: var(--color-primary);
                }

                .error-message {
                    display: flex;
                    align-items: flex-start;
                    gap: var(--spacing-3);
                    background: rgba(239, 68, 68, 0.1);
                    color: var(--color-error);
                    padding: var(--spacing-4);
                    border-radius: var(--radius-lg);
                    border: 1px solid var(--color-error);
                    margin-bottom: var(--spacing-4);
                }

                .error-message p {
                    margin: 0 0 var(--spacing-2) 0;
                }

                .error-retry {
                    background: var(--color-error);
                    color: white;
                    padding: var(--spacing-1) var(--spacing-3);
                    border-radius: var(--radius-default);
                    font-size: var(--font-size-sm);
                    font-weight: 500;
                    transition: all var(--transition-fast);
                }

                .error-retry:hover {
                    background: #dc2626;
                }

                .results-container {
                    background: var(--color-surface-light);
                    border: 1px solid var(--color-border-light);
                    border-radius: var(--radius-lg);
                    padding: var(--spacing-4);
                }

                body.dark .results-container {
                    background: var(--color-surface-dark);
                    border-color: var(--color-border-dark);
                }

                .results-title {
                    font-size: var(--font-size-lg);
                    font-weight: 600;
                    color: var(--color-foreground-light);
                    margin-bottom: var(--spacing-4);
                }

                body.dark .results-title {
                    color: var(--color-foreground-dark);
                }

                .results-sections {
                    display: flex;
                    flex-direction: column;
                    gap: var(--spacing-4);
                }

                .result-section {
                    padding: 0;
                }

                .result-section-title {
                    font-size: var(--font-size-base);
                    font-weight: 600;
                    color: var(--color-primary);
                    margin: 0 0 var(--spacing-2) 0;
                }

                .result-section-content {
                    font-size: var(--font-size-sm);
                    line-height: 1.6;
                    color: var(--color-subtle-light);
                    margin: 0;
                }

                body.dark .result-section-content {
                    color: var(--color-subtle-dark);
                }

                @keyframes spin {
                    to {
                        transform: rotate(360deg);
                    }
                }
            `}</style>
        </>
    );
}
