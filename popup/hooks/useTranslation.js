import { useState, useEffect, useCallback } from 'react';

const translationsCache = {};

/**
 * Hook for managing i18n translations
 * @param {string} locale - Locale code (e.g., 'en', 'zh-CN')
 * @returns {Object} Translation function and loading state
 */
export function useTranslation(locale) {
    const [translations, setTranslations] = useState({});
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadTranslations = async () => {
            const normalizedLangCode = locale.replace('-', '_');

            // Check cache first
            if (translationsCache[normalizedLangCode]) {
                setTranslations(translationsCache[normalizedLangCode]);
                setLoading(false);
                return;
            }

            const translationsPath = chrome.runtime.getURL(
                `_locales/${normalizedLangCode}/messages.json`
            );

            try {
                setLoading(true);
                const response = await fetch(translationsPath);

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const data = await response.json();
                translationsCache[normalizedLangCode] = data;
                setTranslations(data);
            } catch (error) {
                console.warn(
                    `Could not load '${normalizedLangCode}' translations, falling back to English`,
                    error
                );

                // Fallback to English
                try {
                    const fallbackPath = chrome.runtime.getURL(
                        `_locales/en/messages.json`
                    );
                    const fallbackResponse = await fetch(fallbackPath);
                    const fallbackData = await fallbackResponse.json();
                    translationsCache['en'] = fallbackData;
                    setTranslations(fallbackData);
                } catch (fatalError) {
                    console.error(
                        'Fatal: Failed to load any translations',
                        fatalError
                    );
                    setTranslations({});
                }
            } finally {
                setLoading(false);
            }
        };

        if (locale) {
            loadTranslations();
        }
    }, [locale]);

    // Translation function
    const t = useCallback(
        (key, fallback = '', ...substitutions) => {
            let message = translations[key]?.message || fallback || key;

            // Replace %s and %d placeholders with substitutions
            if (substitutions.length > 0) {
                let substitutionIndex = 0;
                message = message.replace(/%[sd]/g, (match) => {
                    if (substitutionIndex < substitutions.length) {
                        return substitutions[substitutionIndex++];
                    }
                    return match;
                });
            }

            return message;
        },
        [translations]
    );

    return { t, loading, translations };
}
