import { describe, expect, it } from 'vitest';
import { createContextPrompt, languageName } from './prompt';
import {
    analysisJsonSchema,
    combineAnalyses,
    parseAnalysis,
    type Analysis,
} from './schemas';

export function culturalSample(definition = 'A greeting'): Analysis {
    return {
        definition,
        cultural_context: {
            origins: 'origins',
            social_context: 'social',
            regional_variations: 'regional',
        },
        usage: {
            examples: ['one', 'two'],
            when_to_use: 'often',
            formality_level: 'casual',
        },
        cultural_significance: 'significant',
        learning_tips: 'tips',
        related_expressions: ['hi'],
        sensitivities: 'none',
    };
}

describe('analysis schemas', () => {
    it('emits the provider response schema with every field required and no extras', () => {
        expect(analysisJsonSchema('cultural')).toEqual({
            type: 'object',
            properties: {
                definition: { type: 'string' },
                cultural_context: {
                    type: 'object',
                    properties: {
                        origins: { type: 'string' },
                        social_context: { type: 'string' },
                        regional_variations: { type: 'string' },
                    },
                    required: [
                        'origins',
                        'social_context',
                        'regional_variations',
                    ],
                    additionalProperties: false,
                },
                usage: {
                    type: 'object',
                    properties: {
                        examples: { type: 'array', items: { type: 'string' } },
                        when_to_use: { type: 'string' },
                        formality_level: { type: 'string' },
                    },
                    required: ['examples', 'when_to_use', 'formality_level'],
                    additionalProperties: false,
                },
                cultural_significance: { type: 'string' },
                learning_tips: { type: 'string' },
                related_expressions: {
                    type: 'array',
                    items: { type: 'string' },
                },
                sensitivities: { type: 'string' },
            },
            required: [
                'definition',
                'cultural_context',
                'usage',
                'cultural_significance',
                'learning_tips',
                'related_expressions',
                'sensitivities',
            ],
            additionalProperties: false,
        });
    });

    it('accepts an exact analysis and rejects extra or missing fields', () => {
        const sample = culturalSample();
        expect(parseAnalysis('cultural', sample)).toEqual(sample);
        expect(parseAnalysis('cultural', { ...sample, extra: 1 })).toBeNull();
        const { sensitivities: _omitted, ...missing } = sample;
        expect(parseAnalysis('cultural', missing)).toBeNull();
        expect(parseAnalysis('historical', sample)).toBeNull();
        expect(parseAnalysis('all', [])).toBeNull();
    });

    it('combines per-type analyses under section keys with the first definition', () => {
        const cultural = culturalSample('first');
        const linguistic = { definition: 'second', etymology: { a: 'b' } };
        expect(
            combineAnalyses(['cultural', 'linguistic'], {
                cultural,
                linguistic,
            })
        ).toEqual({
            definition: 'first',
            cultural_analysis: {
                cultural_context: cultural.cultural_context,
                usage: cultural.usage,
                cultural_significance: 'significant',
                learning_tips: 'tips',
                related_expressions: ['hi'],
                sensitivities: 'none',
            },
            linguistic_analysis: { etymology: { a: 'b' } },
        });
        expect(combineAnalyses(['historical'], {})).toEqual({});
    });
});

describe('context prompt', () => {
    it('names the target language and embeds the requested JSON structure', () => {
        const prompt = createContextPrompt('¡Hola!', 'cultural', 'zh-CN');
        expect(prompt).toContain('Text to analyze: "¡Hola!"');
        expect(prompt).toContain(
            'Target language for response: zh-CN (Chinese (Simplified))'
        );
        expect(prompt).toContain('"cultural_context": {');
        expect(prompt).not.toContain('"historical_context"');
        expect(createContextPrompt('x', 'all', 'en')).toContain(
            '"key_insights"'
        );
    });

    it('falls back to the raw code for unknown languages', () => {
        expect(languageName('en')).toBe('English');
        expect(languageName('auto')).toBe('Unknown');
        expect(languageName('tlh')).toBe('tlh');
    });
});
