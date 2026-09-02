import { z } from 'zod';
import type { ContextType } from '@/shared/contextTypes';

/** What one provider call analyzes: a single context type, or all three
 *  in one combined shape. */
export type AnalysisType = ContextType | 'all';

export type Analysis = Record<string, unknown>;

const text = z.string();
const list = z.array(z.string());

const culturalAnalysis = z.strictObject({
    definition: text,
    cultural_context: z.strictObject({
        origins: text,
        social_context: text,
        regional_variations: text,
    }),
    usage: z.strictObject({
        examples: list,
        when_to_use: text,
        formality_level: text,
    }),
    cultural_significance: text,
    learning_tips: text,
    related_expressions: list,
    sensitivities: text,
});

const historicalAnalysis = z.strictObject({
    definition: text,
    historical_context: z.strictObject({
        time_period: text,
        historical_figures: text,
        events: text,
    }),
    evolution: z.strictObject({
        original_meaning: text,
        changes_over_time: text,
        modern_usage: text,
    }),
    historical_significance: text,
    examples: list,
    related_terms: list,
    learning_context: text,
});

const linguisticAnalysis = z.strictObject({
    definition: text,
    etymology: z.strictObject({
        word_origins: text,
        historical_development: text,
    }),
    grammar: z.strictObject({
        structure: text,
        usage_rules: text,
    }),
    semantics: z.strictObject({
        literal_meaning: text,
        connotations: text,
        register: text,
    }),
    translation_notes: text,
    examples: list,
    related_forms: list,
    learning_tips: text,
});

const allAnalysis = z.strictObject({
    definition: text,
    cultural_analysis: z.strictObject({
        cultural_context: text,
        social_usage: text,
        regional_notes: text,
    }),
    historical_analysis: z.strictObject({
        origins: text,
        evolution: text,
        historical_significance: text,
    }),
    linguistic_analysis: z.strictObject({
        etymology: text,
        grammar_notes: text,
        translation_notes: text,
    }),
    practical_usage: z.strictObject({
        examples: list,
        when_to_use: text,
        formality: text,
    }),
    learning_tips: text,
    related_expressions: list,
    key_insights: text,
});

const ANALYSIS_SCHEMAS: Record<AnalysisType, z.ZodType<Analysis>> = {
    cultural: culturalAnalysis,
    historical: historicalAnalysis,
    linguistic: linguisticAnalysis,
    all: allAnalysis,
};

export const ANALYSIS_SCHEMA_NAME = 'context_analysis';

/** The JSON Schema sent to the model as its response format. */
export function analysisJsonSchema(
    type: AnalysisType
): Record<string, unknown> {
    const { $schema: _draft, ...schema } = z.toJSONSchema(
        ANALYSIS_SCHEMAS[type]
    );
    return schema;
}

/** The model's parsed JSON, or null when it does not match the shape. */
export function parseAnalysis(
    type: AnalysisType,
    value: unknown
): Analysis | null {
    const parsed = ANALYSIS_SCHEMAS[type].safeParse(value);
    return parsed.success ? parsed.data : null;
}

const SECTION_KEYS: Record<ContextType, string> = {
    cultural: 'cultural_analysis',
    historical: 'historical_analysis',
    linguistic: 'linguistic_analysis',
};

/** Merge per-type analyses into one document: the first definition wins,
 *  and each type's remaining fields land under its section key. */
export function combineAnalyses(
    types: readonly ContextType[],
    byType: Partial<Record<ContextType, Analysis>>
): Analysis {
    const combined: Analysis = {};
    for (const type of types) {
        const analysis = byType[type];
        if (!analysis) {
            continue;
        }
        const { definition, ...details } = analysis;
        if (combined.definition === undefined && definition !== undefined) {
            combined.definition = definition;
        }
        combined[SECTION_KEYS[type]] = details;
    }
    return combined;
}
