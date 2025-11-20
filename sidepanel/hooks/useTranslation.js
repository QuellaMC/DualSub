import { useState, useEffect, useCallback } from 'react';
import { useSettings } from './useSettings.js';

/**
 * Custom hook for handling translations
 * Wraps chrome.i18n.getMessage but supports dynamic language switching via settings
 */
export function useTranslation() {
    const { settings } = useSettings(['uiLanguage']);
    const [messages, setMessages] = useState(null);
    const [currentLang, setCurrentLang] = useState(null);

    useEffect(() => {
        const loadMessages = async () => {
            // Default to 'en' if not set, or fallback to browser language if we could detect it easily mapping to our supported locales
            // For now, we rely on the setting. If not set, we might want to let chrome.i18n handle it (which uses browser locale)
            // But to ensure consistency if the user *explicitly* sets it, we load it.
            const lang = settings?.uiLanguage;

            if (!lang || lang === currentLang) return;

            try {
                // Chrome locales use underscores (e.g., zh_CN) but settings might use hyphens (e.g., zh-CN)
                const normalizedLang = lang.replace('-', '_');
                const url = chrome.runtime.getURL(`_locales/${normalizedLang}/messages.json`);
                const response = await fetch(url);
                const data = await response.json();
                setMessages(data);
                setCurrentLang(lang);
            } catch (error) {
                console.error(`Failed to load messages for ${lang}`, error);
                // Fallback to null so we use chrome.i18n
                setMessages(null);
                setCurrentLang(null);
            }
        };

        loadMessages();
    }, [settings?.uiLanguage, currentLang]);

    const t = useCallback((key, substitutions) => {
        // If we have loaded messages for the selected language, use them
        if (messages && messages[key]) {
            let message = messages[key].message;

            // Handle substitutions (simple %s replacement to match existing keys)
            if (substitutions) {
                const subs = Array.isArray(substitutions) ? substitutions : [substitutions];
                subs.forEach((sub) => {
                    message = message.replace('%s', sub);
                });
            }
            return message;
        }

        // Fallback to chrome.i18n (uses browser locale)
        // Note: chrome.i18n.getMessage does NOT automatically replace %s. 
        // It expects $PLACEHOLDERS$. If our keys use %s, we must handle it manually even for chrome.i18n result if we want it to work.
        // However, existing code might rely on chrome.i18n behavior. 
        // If we want to fix the %s issue globally, we should do it here too.
        let nativeMessage = chrome.i18n.getMessage(key, substitutions);

        // If chrome.i18n returned a message and we have substitutions, try %s replacement if it wasn't handled
        if (nativeMessage && substitutions) {
            const subs = Array.isArray(substitutions) ? substitutions : [substitutions];
            // Only replace if it looks like it needs it (contains %s)
            if (nativeMessage.includes('%s')) {
                subs.forEach((sub) => {
                    nativeMessage = nativeMessage.replace('%s', sub);
                });
            }
        }

        return nativeMessage || key;
    }, [messages]);

    return { t };
}
