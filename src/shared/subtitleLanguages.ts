import { closestLanguage } from './languageNormalization';

/** The languages DualSub offers for either subtitle line, in menu order. */
export const SUBTITLE_LANGUAGES = [
    'en',
    'es',
    'fr',
    'de',
    'it',
    'pt',
    'ja',
    'ko',
    'zh-CN',
    'zh-TW',
    'ru',
    'ar',
    'hi',
] as const;

export type SubtitleLanguage = (typeof SUBTITLE_LANGUAGES)[number];

/** The top line's language when it follows the language spoken in the
 *  video. */
export const AUTO_LANGUAGE = 'auto';

/** The translation language the browser's preferences pick, the one a
 *  fresh install starts with; null when DualSub offers none of them. */
export function browserTargetLanguage(): SubtitleLanguage | null {
    return browserLanguage(SUBTITLE_LANGUAGES);
}

/** The first of the browser's preferred languages that `supported` offers,
 *  or null. */
export function browserLanguage<T extends string>(
    supported: readonly T[]
): T | null {
    if (typeof navigator === 'undefined') {
        return null;
    }
    // Test doubles and some embedders expose only `navigator.language`.
    const languages = navigator.languages as readonly string[] | undefined;
    const preferred =
        languages && languages.length > 0 ? languages : [navigator.language];
    for (const tag of preferred) {
        const match =
            typeof tag === 'string' && tag !== ''
                ? closestLanguage(tag, supported)
                : null;
        if (match) {
            return match;
        }
    }
    return null;
}
