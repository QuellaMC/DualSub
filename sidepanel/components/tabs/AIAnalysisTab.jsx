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
        </>
    );
}
