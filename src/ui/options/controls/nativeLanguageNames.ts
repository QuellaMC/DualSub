import type { SubtitleLanguage } from '@/shared/subtitleLanguages';

/** Each language in its own words, so it is found in any page language. */
export const NATIVE_LANGUAGE_NAMES: Record<SubtitleLanguage, string> = {
    en: 'English',
    es: 'Español',
    fr: 'Français',
    de: 'Deutsch',
    it: 'Italiano',
    pt: 'Português',
    ja: '日本語',
    ko: '한국어',
    'zh-CN': '中文（简体）',
    'zh-TW': '中文（繁體）',
    ru: 'Русский',
    ar: 'العربية',
    hi: 'हिन्दी',
};
