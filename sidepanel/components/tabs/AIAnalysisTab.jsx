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
        if (selectedWords.length > 0) {
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
                        disabled={selectedWords.length === 0 || isAnalyzing || !settings?.aiContextEnabled}
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
                        <div className="word-tags" style={{ pointerEvents: isAnalyzing ? 'none' : 'auto', opacity: isAnalyzing ? 0.85 : 1 }}>
                            {selectedWords.map((word) => (
                                <span key={word} className="word-tag">
                                    {word}
                                    <button
                                        className="word-tag-remove"
                                        onClick={() => handleWordRemove(word)}
                                        disabled={isAnalyzing}
                                        aria-label={`Remove ${word}`}
                                    >
                                        ×
                                    </button>
                                </span>
                            ))}
                            {selectedWords.length === 0 && (
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
                            Results for "{selectedWords.join('", "')}"
                        </h2>
                <div className="results-sections">
                    {/* Definition */}
                    {analysisResult?.definition && (
                        <div className="result-section">
                            <h3 className="result-section-title">Definition</h3>
                            <p className="result-section-content">
                                {analysisResult.definition}
                            </p>
                        </div>
                    )}

                    {/* Cultural */}
                    {(analysisResult?.cultural_analysis || analysisResult?.culturalContext) && (
                        <div className="result-section">
                            <h3 className="result-section-title">Cultural Context</h3>
                            <p className="result-section-content">
                                {analysisResult?.culturalContext || analysisResult?.cultural_analysis?.cultural_context || analysisResult?.cultural_analysis}
                            </p>
                        </div>
                    )}

                    {/* Historical */}
                    {(analysisResult?.historical_analysis || analysisResult?.historicalContext) && (
                        <div className="result-section">
                            <h3 className="result-section-title">Historical Context</h3>
                            <p className="result-section-content">
                                {analysisResult?.historicalContext || analysisResult?.historical_analysis?.historical_significance || analysisResult?.historical_analysis}
                            </p>
                        </div>
                    )}

                    {/* Linguistic */}
                    {(analysisResult?.linguistic_analysis || analysisResult?.linguisticAnalysis) && (
                        <div className="result-section">
                            <h3 className="result-section-title">Linguistic Analysis</h3>
                            <p className="result-section-content">
                                {analysisResult?.linguisticAnalysis || analysisResult?.linguistic_analysis?.translation_notes || analysisResult?.linguistic_analysis}
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
                    background: var(--color-primary);
                    color: white;
                    font-size: var(--font-size-sm);
                    font-weight: 600;
                    padding: var(--spacing-1) var(--spacing-2);
                    border-radius: 6px;
                }

                body.dark .word-tag {
                    background: #0f5fb8; /* slightly darker for dark mode */
                    color: white;
                }

.word-tag-remove {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 20px;
                    height: 20px;
                    margin-left: var(--spacing-1);
                    background: rgba(255, 255, 255, 0.25);
                    color: white;
                    border: 1px solid rgba(255, 255, 255, 0.3);
                    border-radius: 4px;
                    font-size: 16px;
                    font-weight: 700;
                    line-height: 1;
                    cursor: pointer;
                    transition: all 0.2s ease;
                    padding: 0;
                }

                .word-tag-remove:hover:not(:disabled) {
                    background: rgba(255, 255, 255, 0.4);
                    border-color: rgba(255, 255, 255, 0.5);
                    transform: scale(1.1);
                }

                .word-tag-remove:active:not(:disabled) {
                    transform: scale(0.95);
                }

                .word-tag-remove:disabled {
                    opacity: 0.4;
                    cursor: not-allowed;
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
            `}</style>
        </>
    );
}
