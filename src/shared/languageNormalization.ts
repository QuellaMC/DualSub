// Platform language codes → consistent internal codes ('en-US' → 'en',
// 'zh-hant' → 'zh-TW'). Unknown BCP-47 tags keep base-language granularity.

const languageNormalizationCache = new Map<string, string>();

const NORMALIZED_MAP: Record<string, string> = {
    en: 'en',
    'en-us': 'en',
    es: 'es',
    'es-419': 'es',
    'es-es': 'es',
    fr: 'fr',
    'fr-ca': 'fr',
    'fr-fr': 'fr',
    de: 'de',
    'de-de': 'de',
    it: 'it',
    'it-it': 'it',
    pt: 'pt',
    'pt-br': 'pt',
    'pt-pt': 'pt',
    ja: 'ja',
    'ja-jp': 'ja',
    ko: 'ko',
    'ko-kr': 'ko',
    zh: 'zh-CN',
    'zh-cn': 'zh-CN',
    'zh-hans': 'zh-CN',
    'zh-tw': 'zh-TW',
    'zh-hant': 'zh-TW',
    'zh-hk': 'zh-TW',
    ru: 'ru',
    'ru-ru': 'ru',
    ar: 'ar',
    hi: 'hi',
    'hi-in': 'hi',
};

export function normalizeLanguageCode(platformLangCode: unknown): string {
    if (!platformLangCode || typeof platformLangCode !== 'string') {
        return 'en';
    }

    const lowerCaseCode = platformLangCode
        .trim()
        .toLowerCase()
        .replaceAll('_', '-');
    const cached = languageNormalizationCache.get(lowerCaseCode);
    if (cached !== undefined) {
        return cached;
    }

    const subtags = lowerCaseCode.split('-').filter(Boolean);
    const baseLanguage = subtags[0] ?? '';
    let normalized = NORMALIZED_MAP[lowerCaseCode];

    if (!normalized && baseLanguage === 'zh') {
        const traditional =
            subtags.includes('hant') ||
            subtags.some((subtag) => ['tw', 'hk', 'mo'].includes(subtag));
        normalized = traditional ? 'zh-TW' : 'zh-CN';
    }
    if (!normalized && Object.hasOwn(NORMALIZED_MAP, baseLanguage)) {
        normalized = NORMALIZED_MAP[baseLanguage];
    }

    normalized = normalized || baseLanguage || lowerCaseCode;
    languageNormalizationCache.set(lowerCaseCode, normalized);
    return normalized;
}
