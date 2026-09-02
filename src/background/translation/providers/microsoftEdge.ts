import {
    httpFailureFrom,
    isRecord,
    malformedResponse,
    providerFetch,
    readProviderJson,
    type TranslationProvider,
} from '../provider';

const PROVIDER = 'microsoft_edge';
/** Edge's own translation endpoint. It takes no token (the former auth
 *  endpoint was retired in July 2026) and a bare JSON string array. */
const TRANSLATE_URL = 'https://edge.microsoft.com/translate/translatetext';

/** The payload is `[{ translations: [{ text, to }], detectedLanguage? }]`. */
function readTranslatedText(data: unknown): string | null {
    if (!Array.isArray(data) || !isRecord(data[0])) {
        return null;
    }
    const translations = data[0]['translations'];
    if (!Array.isArray(translations) || !isRecord(translations[0])) {
        return null;
    }
    const text = translations[0]['text'];
    return typeof text === 'string' ? text : null;
}

export const microsoftEdgeProvider: TranslationProvider = {
    id: PROVIDER,
    pacing: {
        policy: { kind: 'characters', limit: 33_300, windowMs: 60_000 },
        minDelayMs: 800,
    },
    async translate(text, sourceLang, targetLang) {
        // An empty `from` asks the service to detect the language.
        const from = sourceLang.toLowerCase() === 'auto' ? '' : sourceLang;
        const url =
            `${TRANSLATE_URL}?from=${encodeURIComponent(from)}` +
            `&to=${encodeURIComponent(targetLang)}&isEnterpriseClient=false`;
        const response = await providerFetch(PROVIDER, url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify([text]),
        });
        if (!response.ok) {
            throw httpFailureFrom(PROVIDER, response);
        }
        const translated = readTranslatedText(
            await readProviderJson(PROVIDER, response)
        );
        if (translated === null) {
            throw malformedResponse(PROVIDER);
        }
        return translated;
    },
};
