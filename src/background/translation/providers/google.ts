import {
    httpFailureFrom,
    malformedResponse,
    providerFetch,
    readProviderJson,
    readProviderText,
    type TranslationProvider,
} from '../provider';
import { TranslationProviderError } from '../providerError';

const ENDPOINT = 'https://translate.googleapis.com/translate_a/single';

function isCaptchaPage(body: string): boolean {
    return (
        body.includes('<title>Google</title>') &&
        body.includes('unusual traffic')
    );
}

/** The gtx payload is `[[ [translated, original, ...], ... ], ...]`. */
function joinSentences(data: unknown): string | null {
    if (!Array.isArray(data) || !Array.isArray(data[0])) {
        return null;
    }
    const parts: string[] = [];
    for (const sentence of data[0] as unknown[]) {
        if (Array.isArray(sentence) && typeof sentence[0] === 'string') {
            parts.push(sentence[0]);
        }
    }
    return parts.length > 0 ? parts.join('') : null;
}

export const googleProvider: TranslationProvider = {
    id: 'google',
    pacing: {
        policy: { kind: 'bytes', limit: 4500, windowMs: 6500 },
        minDelayMs: 1500,
    },
    async translate(text, sourceLang, targetLang) {
        const url =
            `${ENDPOINT}?client=gtx&sl=${encodeURIComponent(sourceLang)}` +
            `&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(text)}`;
        const response = await providerFetch('google', url);
        if (!response.ok) {
            throw httpFailureFrom('google', response);
        }
        const contentType = response.headers.get('content-type') ?? '';
        if (!contentType.includes('application/json')) {
            const body = await readProviderText('google', response);
            if (isCaptchaPage(body)) {
                throw new TranslationProviderError(
                    'google',
                    'Google blocked the request as unusual traffic',
                    { code: 'RATE_LIMIT_EXCEEDED', retryable: false }
                );
            }
            throw malformedResponse('google');
        }
        const translated = joinSentences(
            await readProviderJson('google', response)
        );
        if (translated === null) {
            throw malformedResponse('google');
        }
        return translated;
    },
};
