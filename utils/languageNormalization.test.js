import {
    clearCache,
    isLanguageSupported,
    normalizeLanguageCode,
} from './languageNormalization.js';

describe('languageNormalization', () => {
    beforeEach(() => {
        clearCache();
    });

    it.each(['en-GB', 'EN-gb', 'en_GB'])(
        'matches English variant %s by base language',
        (code) => {
            expect(normalizeLanguageCode(code)).toBe('en');
        }
    );

    it('preserves Simplified and Traditional Chinese distinctions', () => {
        expect(normalizeLanguageCode('zh-Hans-SG')).toBe('zh-CN');
        expect(normalizeLanguageCode('zh-Hant-HK')).toBe('zh-TW');
        expect(normalizeLanguageCode('zh-MO')).toBe('zh-TW');
    });

    it('normalizes unknown variants to a deterministic base language', () => {
        expect(normalizeLanguageCode('SR-Latn-RS')).toBe('sr');
        expect(normalizeLanguageCode('sr-Cyrl-RS')).toBe('sr');
    });

    it('recognizes supported base-language variants', () => {
        expect(isLanguageSupported('fr-BE')).toBe(true);
        expect(isLanguageSupported('EN-GB')).toBe(true);
        expect(isLanguageSupported('sr-Latn-RS')).toBe(false);
    });
});
