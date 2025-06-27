// utils/languageNormalization.js
// Language normalization utility for consistent language code handling across the extension

const languageNormalizationCache = new Map();

const normalizedMap = {
    'en': 'en',
    'en-us': 'en',
    'es': 'es',
    'es-419': 'es', // Latin American Spanish
    'es-es': 'es', // European Spanish
    'fr': 'fr',
    'fr-ca': 'fr', // Canadian French
    'fr-fr': 'fr', // European French
    'de': 'de',
    'de-de': 'de',
    'it': 'it',
    'it-it': 'it',
    'pt': 'pt',
    'pt-br': 'pt', // Brazilian Portuguese
    'pt-pt': 'pt', // European Portuguese
    'ja': 'ja',
    'ja-jp': 'ja',
    'ko': 'ko',
    'ko-kr': 'ko',
    'zh': 'zh-CN',
    'zh-cn': 'zh-CN',
    'zh-hans': 'zh-CN', // Simplified Chinese
    'zh-tw': 'zh-TW',
    'zh-hant': 'zh-TW', // Traditional Chinese
    'ru': 'ru',
    'ru-ru': 'ru',
    'ar': 'ar',
    'hi': 'hi',
    'hi-in': 'hi'
};

/**
 * Normalizes platform-specific language codes to consistent internal codes
 * @param {string} platformLangCode - The language code from the platform (e.g., 'en-US', 'EN-us')
 * @returns {string} - Normalized language code (e.g., 'en', 'zh-CN')
 */
export function normalizeLanguageCode(platformLangCode) {
    if (!platformLangCode || typeof platformLangCode !== 'string') {
        console.warn('LanguageNormalization: Invalid language code provided:', platformLangCode);
        return 'en';
    }

    // Normalize to lowercase for case-insensitive caching and lookup
    const lowerCaseCode = platformLangCode.toLowerCase();

    if (languageNormalizationCache.has(lowerCaseCode)) {
        return languageNormalizationCache.get(lowerCaseCode);
    }

    const normalized = normalizedMap[lowerCaseCode] || platformLangCode;
    languageNormalizationCache.set(lowerCaseCode, normalized);
    return normalized;
}

/**
 * Gets all supported language codes
 * @returns {string[]} - Array of all supported language codes
 */
export function getSupportedLanguageCodes() {
    return [...new Set(Object.values(normalizedMap))];
}

/**
 * Checks if a language code is supported
 * @param {string} langCode - Language code to check
 * @returns {boolean} - True if supported
 */
export function isLanguageSupported(langCode) {
    if (!langCode) return false;
    const lowerCaseCode = langCode.toLowerCase();
    return Object.hasOwn(normalizedMap, lowerCaseCode);
}

/**
 * Clears the normalization cache (useful for testing)
 */
export function clearCache() {
    languageNormalizationCache.clear();
} 