import { useState } from 'react';
import type { Translate } from '../hooks/useI18n';
import { AnalysisResults } from './AnalysisResults';
import { useAnalysis } from './useAnalysis';
import { usePanelConnection, type PanelError } from './usePanelConnection';

function errorText(error: PanelError, t: Translate): string {
    return error.kind === 'key' ? t(error.key) : error.text;
}

/** Selected words, one analyze action, and the answer for the bound tab. */
export function AnalysisPanel({ t }: { t: Translate }) {
    const panel = usePanelConnection();
    const { settingsStatus, enabled, outcome, analyze } = useAnalysis(panel);
    const [removing, setRemoving] = useState(false);
    const { selection, analyzing } = panel.tab;
    const error = outcome?.error ?? null;
    const words = selection?.entries.map((entry) => entry.word) ?? [];
    const locked = analyzing || removing || !panel.bound;
    const canAnalyze =
        words.length > 0 &&
        !analyzing &&
        panel.bound &&
        settingsStatus === 'ready' &&
        enabled;

    const removeAt = async (index: number): Promise<void> => {
        const entry = selection?.entries[index];
        if (!selection || !entry || removing) {
            return;
        }
        setRemoving(true);
        try {
            await panel.requestRemoval(selection, entry.wordIndex);
        } finally {
            setRemoving(false);
        }
    };

    return (
        <div className="ai-analysis-tab" aria-busy={analyzing}>
            <div className="tab-header">
                <h1 className="tab-title">{t('sidepanelTabAIAnalysis')}</h1>
                <button
                    className="analyze-button"
                    type="button"
                    onClick={() => void analyze()}
                    disabled={!canAnalyze}
                >
                    <span className="action-icon" aria-hidden="true">
                        ✦
                    </span>
                    <span>
                        {analyzing
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
                    <div className="word-tags" role="list" aria-busy={removing}>
                        {words.map((word, index) => (
                            <span
                                key={`${index}-${word}`}
                                className="word-tag"
                                role="listitem"
                            >
                                {word}
                                <button
                                    className="word-tag-remove"
                                    type="button"
                                    onClick={() => void removeAt(index)}
                                    disabled={locked}
                                    aria-label={t(
                                        'sidepanelRemoveWordLabel',
                                        word,
                                        index + 1
                                    )}
                                >
                                    <span aria-hidden="true">×</span>
                                </button>
                            </span>
                        ))}
                        {words.length === 0 && (
                            <span className="placeholder-text">
                                {t('sidepanelWordInputPlaceholder')}
                            </span>
                        )}
                    </div>
                </div>
            </section>

            {analyzing && (
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
                        <p>{errorText(error, t)}</p>
                        <button
                            className="error-retry"
                            type="button"
                            onClick={() => void analyze()}
                            disabled={!canAnalyze}
                        >
                            {t('sidepanelErrorRetry')}
                        </button>
                    </div>
                </div>
            )}

            {outcome?.answer && !analyzing && (
                <AnalysisResults
                    analysis={outcome.answer}
                    words={outcome.words}
                    t={t}
                />
            )}
        </div>
    );
}
