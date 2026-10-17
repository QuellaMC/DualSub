import { describe, expect, it } from 'vitest';
import {
    closestLanguage,
    isSameLanguage,
    normalizeLanguageCode,
} from './languageNormalization';

describe('normalizeLanguageCode', () => {
    it.each([
        ['cmn', 'zh-CN'],
        ['cmn-Hans', 'zh-CN'],
        ['cmn-TW', 'zh-TW'],
        ['cmn-Hant', 'zh-TW'],
        ['yue', 'zh-TW'],
        ['yue-HK', 'zh-TW'],
        ['zh-Hant-HK', 'zh-TW'],
        ['es-419', 'es'],
        ['pt_BR', 'pt'],
    ])('maps %s to %s', (code, expected) => {
        expect(normalizeLanguageCode(code)).toBe(expected);
    });
});

describe('language comparison', () => {
    it('treats regional and script variants of one language as the same', () => {
        expect(isSameLanguage('en-US', 'en')).toBe(true);
        expect(isSameLanguage('zh-Hans', 'zh-CN')).toBe(true);
        expect(isSameLanguage('zh-Hant', 'zh-CN')).toBe(false);
        expect(isSameLanguage('ko', 'ja')).toBe(false);
    });

    it('finds the offered entry for a tag, or nothing', () => {
        const offered = ['en', 'zh-CN', 'zh-TW'] as const;
        expect(closestLanguage('zh-HK', offered)).toBe('zh-TW');
        expect(closestLanguage('en-AU', offered)).toBe('en');
        expect(closestLanguage('ko', offered)).toBeNull();
    });
});
