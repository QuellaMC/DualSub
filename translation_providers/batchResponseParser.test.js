import { parseTranslationArray } from './batchResponseParser.js';

describe('parseTranslationArray', () => {
    it('preserves an empty translation in the middle', () => {
        expect(parseTranslationArray('["Hola", "", "Mundo"]', 3)).toEqual([
            'Hola',
            '',
            'Mundo',
        ]);
    });

    it('preserves legacy delimiter text inside a translation', () => {
        expect(
            parseTranslationArray('["Hola |SUBTITLE_BREAK| amigo", "Mundo"]', 2)
        ).toEqual(['Hola |SUBTITLE_BREAK| amigo', 'Mundo']);
    });

    it('accepts a JSON array in a markdown code fence', () => {
        expect(
            parseTranslationArray('```json\n["Uno", "Dos"]\n```', 2)
        ).toEqual(['Uno', 'Dos']);
    });

    it.each([
        ['["one"]', 2, 'count mismatch'],
        ['["one", "two", "three"]', 2, 'count mismatch'],
        ['["one", 2]', 2, 'only string'],
        ['not-json', 1, 'valid JSON'],
    ])('rejects malformed contract %s', (response, count, message) => {
        expect(() => parseTranslationArray(response, count)).toThrow(message);
    });
});
