import {
    httpFailureFrom,
    isRecord,
    malformedResponse,
    providerFetch,
    readProviderJson,
    readProviderText,
    type TranslationProvider,
} from '../provider';
import { TranslationProviderError } from '../providerError';

const PROVIDER = 'microsoft_edge_auth';
const AUTH_URL = 'https://edge.microsoft.com/translate/auth';
const TRANSLATE_URL = 'https://api.cognitive.microsofttranslator.com/translate';
/** Refresh while this much validity remains, so a request never sends a token
 *  that expires in flight. */
const TOKEN_REFRESH_MARGIN_MS = 60_000;

/** Expiry in epoch milliseconds from the JWT payload's `exp`, or null. */
export function readJwtExpiry(token: string): number | null {
    const payload = token.split('.')[1];
    if (!payload) {
        return null;
    }
    try {
        const decoded: unknown = JSON.parse(
            atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
        );
        const exp = isRecord(decoded) ? decoded['exp'] : undefined;
        return typeof exp === 'number' && Number.isFinite(exp)
            ? exp * 1000
            : null;
    } catch {
        return null;
    }
}

/** The anonymous Edge token, fetched once and refreshed single-flight. */
class EdgeAuthToken {
    private token: string | null = null;
    private expiresAt = 0;
    private refresh: Promise<string> | null = null;

    async get(): Promise<string> {
        if (
            this.token !== null &&
            this.expiresAt - Date.now() >= TOKEN_REFRESH_MARGIN_MS
        ) {
            return this.token;
        }
        this.refresh ??= this.fetchToken().finally(() => {
            this.refresh = null;
        });
        return this.refresh;
    }

    invalidate(): void {
        this.token = null;
        this.expiresAt = 0;
    }

    private async fetchToken(): Promise<string> {
        const response = await providerFetch(PROVIDER, AUTH_URL);
        if (!response.ok) {
            throw httpFailureFrom(PROVIDER, response);
        }
        const token = await readProviderText(PROVIDER, response);
        const expiresAt = readJwtExpiry(token);
        if (expiresAt === null) {
            throw new TranslationProviderError(
                PROVIDER,
                'Auth token is not a JWT with an expiry',
                { code: 'REQUEST_FAILED', retryable: true }
            );
        }
        this.token = token;
        this.expiresAt = expiresAt;
        return token;
    }
}

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

export function createMicrosoftEdgeAuthProvider(): TranslationProvider {
    const auth = new EdgeAuthToken();
    return {
        id: PROVIDER,
        pacing: {
            policy: { kind: 'characters', limit: 33_300, windowMs: 60_000 },
            minDelayMs: 800,
        },
        async translate(text, sourceLang, targetLang) {
            const token = await auth.get();
            const query = [
                'api-version=3.0',
                `to=${encodeURIComponent(targetLang)}`,
            ];
            if (sourceLang.toLowerCase() !== 'auto') {
                query.push(`from=${encodeURIComponent(sourceLang)}`);
            }
            const response = await providerFetch(
                PROVIDER,
                `${TRANSLATE_URL}?${query.join('&')}`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify([{ Text: text }]),
                }
            );
            if (!response.ok) {
                if (response.status === 401 || response.status === 403) {
                    // The anonymous token expired or was revoked; a retry
                    // mints a fresh one, so this is not a configuration fault.
                    auth.invalidate();
                    throw httpFailureFrom(PROVIDER, response, {
                        retryable: true,
                    });
                }
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
}

export const microsoftEdgeAuthProvider = createMicrosoftEdgeAuthProvider();
