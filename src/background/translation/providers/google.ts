import { z } from 'zod';
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

/** One request to the keyless endpoint: its JSON payload, or the reason
 *  there is none. Google answers unusual traffic with an HTML page, which
 *  no retry gets past.
 *
 * @throws {TranslationProviderError}
 */
async function requestGtx(query: Record<string, string>): Promise<unknown> {
    const parameters = Object.entries({ client: 'gtx', ...query })
        .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
        .join('&');
    const response = await providerFetch('google', `${ENDPOINT}?${parameters}`);
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
    return readProviderJson('google', response);
}

export const googleProvider: TranslationProvider = {
    id: 'google',
    pacing: {
        policy: { kind: 'bytes', limit: 4500, windowMs: 6500 },
        minDelayMs: 1500,
    },
    async translate(text, sourceLang, targetLang) {
        const translated = joinSentences(
            await requestGtx({
                sl: sourceLang,
                tl: targetLang,
                dt: 't',
                q: text,
            })
        );
        if (translated === null) {
            throw malformedResponse('google');
        }
        return translated;
    },
};

/** One word type of a dictionary answer: the type as Google names it in
 *  English, the word it lists, and that word's translations. */
export interface GoogleDictionaryMeaning {
    readonly pos: string;
    readonly baseForm: string | null;
    readonly terms: readonly string[];
}

const dictionaryPayload = z.object({
    dict: z
        .array(
            z.object({
                pos: z.string(),
                terms: z.array(z.string()),
                base_form: z.string().optional(),
            })
        )
        .optional(),
});

/** Google's dictionary for `text`: its translations into `targetLang` by
 *  word type, each with the word it is listed under. Empty when Google
 *  lists nothing for it.
 *
 * @throws {TranslationProviderError}
 */
export async function lookupDictionary(
    text: string,
    sourceLang: string,
    targetLang: string
): Promise<GoogleDictionaryMeaning[]> {
    const parsed = dictionaryPayload.safeParse(
        await requestGtx({
            sl: sourceLang,
            tl: targetLang,
            hl: 'en',
            dt: 'bd',
            dj: '1',
            q: text,
        })
    );
    if (!parsed.success) {
        throw malformedResponse('google');
    }
    return (parsed.data.dict ?? [])
        .map((meaning) => ({
            pos: meaning.pos,
            baseForm: meaning.base_form?.trim() || null,
            terms: meaning.terms.filter((term) => term.trim() !== ''),
        }))
        .filter((meaning) => meaning.terms.length > 0);
}
