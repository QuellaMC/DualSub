import { useCallback, useEffect, useState } from 'react';

const translationsCache = new Map();

async function loadLocale(locale) {
    if (translationsCache.has(locale)) {
        return translationsCache.get(locale);
    }

    const response = await fetch(
        chrome.runtime.getURL(`_locales/${locale}/messages.json`)
    );
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const messages = await response.json();
    translationsCache.set(locale, messages);
    return messages;
}

export function useTranslation(locale) {
    const [translations, setTranslations] = useState({});
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let active = true;

        async function loadTranslations() {
            if (!locale) {
                setTranslations({});
                setLoading(false);
                return;
            }

            const normalizedLangCode = locale.replace('-', '_');
            setLoading(true);

            try {
                const messages = await loadLocale(normalizedLangCode);
                if (active) {
                    setTranslations(messages);
                }
            } catch (error) {
                if (!active) {
                    return;
                }
                console.warn(
                    `Could not load '${normalizedLangCode}' translations, falling back to English`,
                    error
                );

                try {
                    const fallbackMessages = await loadLocale('en');
                    if (active) {
                        setTranslations(fallbackMessages);
                    }
                } catch (fatalError) {
                    if (active) {
                        console.error(
                            'Fatal: Failed to load any translations',
                            fatalError
                        );
                        setTranslations({});
                    }
                }
            } finally {
                if (active) {
                    setLoading(false);
                }
            }
        }

        void loadTranslations();

        return () => {
            active = false;
        };
    }, [locale]);

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
