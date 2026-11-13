import { describe, expect, it } from 'vitest';
import type { AiAnswer } from '@/messaging/contracts/analyzeContext';
import { createAnswerPrompt } from './prompt';
import { answerJsonSchema, answerShape, parseAnswer } from './schemas';

/** An answer to every kind of explanation. */
export function answerSample(): Required<AiAnswer> {
    return {
        meaning: 'The rain outside is very heavy.',
        register: 'everyday',
        examples: [
            { text: 'Anoche llovió a cántaros.', translation: 'It poured.' },
        ],
        similar: ['llover a mares'],
        tip: 'Keep it with llover.',
        culture: 'Said everywhere Spanish is spoken.',
        history: 'A cántaro is a clay jug.',
    };
}

describe('answer shape', () => {
    it('asks for the meaning and register, plus what each kind adds', () => {
        expect(Object.keys(answerShape([]).shape)).toEqual([
            'meaning',
            'register',
        ]);
        expect(
            Object.keys(answerShape(['linguistic', 'historical']).shape)
        ).toEqual([
            'meaning',
            'register',
            'examples',
            'similar',
            'tip',
            'history',
        ]);
    });

    it('sends a strict schema with every field required and no array caps', () => {
        const schema = answerJsonSchema(['linguistic', 'cultural']);
        expect(schema).toMatchObject({
            type: 'object',
            additionalProperties: false,
            required: [
                'meaning',
                'register',
                'examples',
                'similar',
                'tip',
                'culture',
            ],
        });
        expect(JSON.stringify(schema)).not.toContain('maxItems');
        expect(schema).not.toHaveProperty('$schema');
    });

    it('keeps a matching answer, cut to the caps, and refuses anything else', () => {
        const sample = answerSample();
        const { culture: _culture, history: _history, ...asked } = sample;
        expect(parseAnswer(['linguistic'], asked)).toEqual(asked);
        expect(
            parseAnswer(['linguistic'], {
                ...asked,
                similar: Array.from({ length: 12 }, (_, index) => `s${index}`),
            })?.similar
        ).toHaveLength(8);
        expect(parseAnswer(['linguistic'], sample)).toBeNull();
        expect(parseAnswer(['cultural'], asked)).toBeNull();
        expect(parseAnswer([], { ...asked, register: 'rude' })).toBeNull();
        expect(parseAnswer([], 'not json')).toBeNull();
    });
});

describe('answer prompt', () => {
    it('gives the words with their line and asks only for the kinds wanted', () => {
        const prompt = createAnswerPrompt({
            text: 'a cántaros',
            line: 'Está lloviendo a cántaros, no salgas.',
            sourceLanguage: 'es',
            targetLanguage: 'zh-CN',
            kinds: ['historical'],
        });
        expect(prompt).toContain('Words: "a cántaros"');
        expect(prompt).toContain(
            'The line they appear in: "Está lloviendo a cántaros, no salgas."'
        );
        expect(prompt).toContain('Language of the line: Spanish');
        expect(prompt).toContain('Chinese (Simplified) (zh-CN)');
        expect(prompt).toContain('"history"');
        expect(prompt).not.toContain('"culture"');
        expect(prompt).not.toContain('"examples"');
    });

    it('lets the model tell an unknown language from the line', () => {
        expect(
            createAnswerPrompt({
                text: 'hola',
                line: 'hola amigo',
                sourceLanguage: 'auto',
                targetLanguage: 'en',
                kinds: [],
            })
        ).toContain('Language of the line: unknown; tell it from the line');
    });
});
