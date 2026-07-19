import React from 'react';
import { useAIAnalysis } from '../../hooks/useAIAnalysis.js';
import { useTranslation } from '../../hooks/useTranslation.js';
import { useWordSelection } from '../../hooks/useWordSelection.js';

const SECTION_TRANSLATION_KEYS = {
    definition: 'sidepanelSectionDefinition',
    cultural_analysis: 'sidepanelSectionCultural',
    cultural_context: 'sidepanelSectionCultural',
    historical_analysis: 'sidepanelSectionHistorical',
    historical_context: 'sidepanelSectionHistorical',
    linguistic_analysis: 'sidepanelSectionLinguistic',
    key_insights: 'aiContextKeyInsights',
    learning_tips: 'aiContextLearningTips',
    practical_usage: 'aiContextUsage',
    related_expressions: 'aiContextRelatedExpressions',
};

function humanizeKey(key) {
    return key
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (character) => character.toUpperCase());
}

function AnalysisValue({ value }) {
    if (value == null || value === '') {
        return null;
    }

    if (Array.isArray(value)) {
        return (
            <ul className="result-value-list">
                {value.map((item, index) => (
                    <li key={`${String(item)}-${index}`}>
                        <AnalysisValue value={item} />
                    </li>
                ))}
            </ul>
        );
    }

    if (typeof value === 'object') {
        return (
            <dl className="result-value-object">
                {Object.entries(value).map(([key, nestedValue]) => (
                    <div className="result-value-field" key={key}>
                        <dt>{humanizeKey(key)}</dt>
                        <dd>
                            <AnalysisValue value={nestedValue} />
                        </dd>
                    </div>
                ))}
            </dl>
        );
    }

    return <span>{String(value)}</span>;
}

export function AnalysisResults({ result, selectedWords, t }) {
    const resultEntries =
        typeof result === 'object' && result !== null && !Array.isArray(result)
            ? Object.entries(result)
            : [['analysis', result]];
    const sections = resultEntries.filter(
        ([, value]) => value != null && value !== ''
    );

    return (
        <section
            className="results-container"
            aria-labelledby="analysis-results-title"
            aria-live="polite"
        >
            <h2 className="results-title" id="analysis-results-title">
                {t('sidepanelResultsTitle', selectedWords.join(', '))}
            </h2>
            <div className="results-sections">
                {sections.map(([key, value]) => (
                    <section className="result-section" key={key}>
                        <h3 className="result-section-title">
                            {SECTION_TRANSLATION_KEYS[key]
                                ? t(SECTION_TRANSLATION_KEYS[key])
                                : humanizeKey(key)}
                        </h3>
                        <div className="result-section-content">
                            <AnalysisValue value={value} />
                        </div>
                    </section>
                ))}
            </div>
        </section>
    );
}

/** Main UI for selecting subtitle words and displaying AI analysis. */
export function AIAnalysisTab() {
    const {
        analysisResult,
        analyzeWords,
        error,
        isAnalyzing,
        retryAnalysis,
        settings,
        settingsLoading,
    } = useAIAnalysis();
    const { isUpdatingSelection, removeWordAt, selectedWords } =
        useWordSelection();
    const { t } = useTranslation();
    const selectionLocked = isAnalyzing || isUpdatingSelection;

    return (
        <div className="ai-analysis-tab" aria-busy={isAnalyzing}>
            <div className="tab-header">
                <h1 className="tab-title">{t('sidepanelTabAIAnalysis')}</h1>
                <button
                    className="analyze-button"
                    type="button"
                    onClick={() => void analyzeWords()}
                    disabled={
                        selectedWords.length === 0 ||
                        isAnalyzing ||
                        settingsLoading ||
                        !settings?.aiContextEnabled
                    }
                >
                    <span className="action-icon" aria-hidden="true">
                        ✦
                    </span>
                    <span>
                        {isAnalyzing
                            ? t('sidepanelAnalyzing')
                            : t('sidepanelAnalyzeButton')}
                    </span>
                </button>
            </div>

            <section
                className="input-container"
                aria-labelledby="selected-words-label"
            >
                <h2 className="input-label" id="selected-words-label">
                    {t('sidepanelWordsToAnalyze')}
                </h2>
                <div className="word-input-wrapper">
                    <div
                        className="word-tags"
                        role="list"
                        aria-busy={isUpdatingSelection}
                    >
                        {selectedWords.map((word, index) => (
                            <span
                                key={`${index}-${word}`}
                                className="word-tag"
                                role="listitem"
                            >
                                {word}
                                <button
                                    className="word-tag-remove"
                                    type="button"
                                    onClick={() => void removeWordAt(index)}
                                    disabled={selectionLocked}
                                    aria-label={`Remove ${word} at position ${index + 1}`}
                                >
                                    <span aria-hidden="true">×</span>
                                </button>
                            </span>
                        ))}
                        {selectedWords.length === 0 && (
                            <span className="placeholder-text">
                                {t('sidepanelWordInputPlaceholder')}
                            </span>
                        )}
                    </div>
                </div>
            </section>

            {isAnalyzing && (
                <div className="loading-state" role="status" aria-live="polite">
                    <div className="spinner" aria-hidden="true" />
                    <p>{t('sidepanelAnalyzing')}</p>
                </div>
            )}

            {error && (
                <div className="error-message" role="alert">
                    <span className="error-icon" aria-hidden="true">
                        !
                    </span>
                    <div>
                        <p>{error}</p>
                        <button
                            className="error-retry"
                            type="button"
                            onClick={() => void retryAnalysis()}
                            disabled={
                                isAnalyzing ||
                                settingsLoading ||
                                !settings?.aiContextEnabled ||
                                selectedWords.length === 0
                            }
                        >
                            {t('sidepanelErrorRetry')}
                        </button>
                    </div>
                </div>
            )}

            {analysisResult && !isAnalyzing && (
                <AnalysisResults
                    result={analysisResult}
                    selectedWords={selectedWords}
                    t={t}
                />
            )}
        </div>
    );
}
