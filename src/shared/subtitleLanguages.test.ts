import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    browserLanguage,
    browserTargetLanguage,
    SUBTITLE_LANGUAGES,
} from './subtitleLanguages';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('browserLanguage', () => {
    it("takes the first of the browser's preferences that DualSub offers", () => {
        vi.stubGlobal('navigator', {
            language: 'eo',
            languages: ['eo', 'ko-KR', 'en'],
        });
        expect(browserLanguage(SUBTITLE_LANGUAGES)).toBe('ko');
    });

    it('falls back to the single preferred language', () => {
        vi.stubGlobal('navigator', { language: 'de-AT' });
        expect(browserLanguage(SUBTITLE_LANGUAGES)).toBe('de');
    });

    it('offers nothing when no preference matches or no navigator exists', () => {
        vi.stubGlobal('navigator', { language: 'eo', languages: ['eo'] });
        expect(browserLanguage(SUBTITLE_LANGUAGES)).toBeNull();
        vi.stubGlobal('navigator', undefined);
        expect(browserLanguage(SUBTITLE_LANGUAGES)).toBeNull();
    });
});

describe('browserTargetLanguage', () => {
    it('picks a translation language from the browser, or none', () => {
        vi.stubGlobal('navigator', { language: 'nl', languages: ['nl', 'ja'] });
        expect(browserTargetLanguage()).toBe('ja');
        vi.stubGlobal('navigator', { language: 'nl', languages: ['nl'] });
        expect(browserTargetLanguage()).toBeNull();
    });
});
