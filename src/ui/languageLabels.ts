import { closestLanguage } from '@/shared/languageNormalization';
import {
    SUBTITLE_LANGUAGES,
    type SubtitleLanguage,
} from '@/shared/subtitleLanguages';
import type { Translate } from './hooks/useI18n';

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

/** The catalog key of a language's name. */
export function languageLabelKey(code: string): string {
    return `lang_${code.replace('-', '_')}`;
}

/** A language's name in the page's language; a tag DualSub does not offer
 *  shows as itself. */
export function languageName(t: Translate, code: string): string {
    const offered = closestLanguage(code, SUBTITLE_LANGUAGES);
    return offered ? t(languageLabelKey(offered)) : code;
}
