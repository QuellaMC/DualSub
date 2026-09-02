import type { Translate } from '../hooks/useI18n';
import type { Analysis } from './usePanelConnection';

const SECTION_KEYS: Record<string, string> = {
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

function humanize(key: string): string {
    return key
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (character) => character.toUpperCase());
}

function isPresent(value: unknown): boolean {
    return value !== null && value !== undefined && value !== '';
}

function AnalysisValue({ value }: { value: unknown }) {
    if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
    ) {
        return value === '' ? null : <span>{String(value)}</span>;
    }
    if (Array.isArray(value)) {
        return (
            <ul className="result-value-list">
                {(value as unknown[]).map((item, index) => (
                    <li key={index}>
                        <AnalysisValue value={item} />
                    </li>
                ))}
            </ul>
        );
    }
    if (typeof value === 'object' && value !== null) {
        return (
            <dl className="result-value-object">
                {Object.entries(value as Record<string, unknown>).map(
                    ([key, nested]) => (
                        <div className="result-value-field" key={key}>
                            <dt>{humanize(key)}</dt>
                            <dd>
                                <AnalysisValue value={nested} />
                            </dd>
                        </div>
                    )
                )}
            </dl>
        );
    }
    return null;
}

export function AnalysisResults({
    analysis,
    words,
    t,
}: {
    analysis: Analysis;
    words: readonly string[];
    t: Translate;
}) {
    const sections = Object.entries(analysis).filter(([, value]) =>
        isPresent(value)
    );
    return (
        <section
            className="results-container"
            aria-labelledby="analysis-results-title"
            aria-live="polite"
        >
            <h2 className="results-title" id="analysis-results-title">
                {t('sidepanelResultsTitle', words.join(', '))}
            </h2>
            <div className="results-sections">
                {sections.map(([key, value]) => (
                    <section className="result-section" key={key}>
                        <h3 className="result-section-title">
                            {SECTION_KEYS[key]
                                ? t(SECTION_KEYS[key])
                                : humanize(key)}
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
