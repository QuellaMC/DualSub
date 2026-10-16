import { closestLanguage } from '@/shared/languageNormalization';
import { SUBTITLE_LANGUAGES } from '@/shared/subtitleLanguages';
import type { Translate } from './hooks/useI18n';

/** The catalog key of a language's name; `auto` has one too. */
export function languageLabelKey(code: string): string {
    return `lang_${code.replace('-', '_')}`;
}

/** A language's name in the page's language; a tag DualSub does not offer
 *  shows as itself. */
export function languageName(t: Translate, code: string): string {
    const offered = closestLanguage(code, SUBTITLE_LANGUAGES);
    return offered ? t(languageLabelKey(offered)) : code;
}
