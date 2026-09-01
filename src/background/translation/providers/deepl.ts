import {
    httpFailureFrom,
    isRecord,
    malformedResponse,
    missingCredential,
    providerFetch,
    readProviderJson,
    readProviderSettings,
    type TranslationProvider,
} from '../provider';
import type { ProviderErrorDetails } from '../providerError';

const PROVIDER = 'deepl';
const ENDPOINTS = {
    free: 'https://api-free.deepl.com/v2/translate',
    pro: 'https://api.deepl.com/v2/translate',
} as const;

const LANGUAGE_CODES: Record<string, string> = {
    'zh-cn': 'ZH-HANS',
    zh: 'ZH-HANS',
    'zh-tw': 'ZH-HANT',
    'zh-hk': 'ZH-HANT',
    en: 'EN',
    'en-us': 'EN-US',
    'en-gb': 'EN-GB',
    pt: 'PT-PT',
    'pt-br': 'PT-BR',
    'pt-pt': 'PT-PT',
    ja: 'JA',
    ko: 'KO',
    de: 'DE',
    fr: 'FR',
    es: 'ES',
    it: 'IT',
    ru: 'RU',
    ar: 'AR',
};

export function toDeepLLanguage(code: string): string {
    return (
        LANGUAGE_CODES[code.toLowerCase().replace('_', '-')] ??
        code.toUpperCase()
    );
}

function failureOverrides(status: number): Partial<ProviderErrorDetails> {
    // 456 is DeepL's "quota exceeded for the billing period": it will not
    // clear on retry, unlike a 429 burst limit.
    return status === 456
        ? { code: 'RATE_LIMIT_EXCEEDED', retryable: false }
        : {};
}

function readTranslatedText(data: unknown): string | null {
    if (!isRecord(data)) {
        return null;
    }
    const translations = data['translations'];
    if (!Array.isArray(translations) || !isRecord(translations[0])) {
        return null;
    }
    const text = translations[0]['text'];
    return typeof text === 'string' ? text : null;
}

export const deeplProvider: TranslationProvider = {
    id: PROVIDER,
    pacing: { policy: { kind: 'provider' }, minDelayMs: 500 },
    async translate(text, sourceLang, targetLang) {
        const { deeplApiKey, deeplApiPlan } = await readProviderSettings(
            PROVIDER,
            ['deeplApiKey', 'deeplApiPlan']
        );
        if (deeplApiKey.trim() === '') {
            throw missingCredential(PROVIDER, 'DeepL API key');
        }
        const body = [`text=${encodeURIComponent(text)}`];
        if (sourceLang !== 'auto') {
            body.push(
                `source_lang=${encodeURIComponent(toDeepLLanguage(sourceLang))}`
            );
        }
        body.push(
            `target_lang=${encodeURIComponent(toDeepLLanguage(targetLang))}`
        );
        const response = await providerFetch(
            PROVIDER,
            ENDPOINTS[deeplApiPlan],
            {
                method: 'POST',
                headers: {
                    Authorization: `DeepL-Auth-Key ${deeplApiKey}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: body.join('&'),
            }
        );
        if (!response.ok) {
            throw httpFailureFrom(
                PROVIDER,
                response,
                failureOverrides(response.status)
            );
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
