import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { TranslationProviderError } from '../providerError';
import { checkDeepLConnection, deeplProvider, toDeepLLanguage } from './deepl';
import {
    buildVertexEndpoint,
    checkVertexConnection,
    geminiVertexProvider,
} from './geminiVertex';
import { googleProvider } from './google';
import {
    createMicrosoftEdgeAuthProvider,
    readJwtExpiry,
} from './microsoftEdgeAuth';
import {
    fetchAvailableModels,
    normalizeModelName,
    openaiCompatibleProvider,
} from './openaiCompatible';

type FetchMock = ReturnType<
    typeof vi.fn<
        (input: string | URL | Request, init?: RequestInit) => Promise<Response>
    >
>;

let fetchMock: FetchMock;

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

function textResponse(
    body: string,
    status = 200,
    contentType = 'text/html'
): Response {
    return new Response(body, {
        status,
        headers: { 'content-type': contentType },
    });
}

function requestAt(index: number): { url: string; init: RequestInit } {
    const call = fetchMock.mock.calls[index];
    if (!call) {
        throw new Error(`no fetch call ${index}`);
    }
    const [input, init] = call;
    const url =
        typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
    return { url, init: init ?? {} };
}

function bodyText(init: RequestInit): string {
    if (typeof init.body !== 'string') {
        throw new Error('expected a string body');
    }
    return init.body;
}

function headersOf(init: RequestInit): Record<string, string> {
    return { ...(init.headers as Record<string, string>) };
}

async function failure(
    promise: Promise<unknown>
): Promise<TranslationProviderError> {
    try {
        await promise;
    } catch (error) {
        if (error instanceof TranslationProviderError) {
            return error;
        }
        throw error;
    }
    throw new Error('expected a provider error');
}

function jwtExpiringAt(epochSeconds: number): string {
    const payload = btoa(JSON.stringify({ exp: epochSeconds }))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    return `header.${payload}.signature`;
}

beforeEach(async () => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await fakeBrowser.storage.sync.clear();
    await fakeBrowser.storage.local.clear();
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('google provider', () => {
    it('requests the gtx endpoint and joins the sentence fragments', async () => {
        fetchMock.mockResolvedValueOnce(
            jsonResponse([
                [
                    ['Hola ', 'Hello ', null, null, 10],
                    ['mundo', 'world', null, null, 10],
                    [null, null, 'romanization'],
                ],
                null,
                'en',
            ])
        );
        await expect(
            googleProvider.translate('Hello world', 'auto', 'es')
        ).resolves.toBe('Hola mundo');
        const { url } = requestAt(0);
        expect(url).toBe(
            'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=es&dt=t&q=Hello%20world'
        );
    });

    it('classifies a CAPTCHA page as a non-retryable rate limit', async () => {
        fetchMock.mockResolvedValueOnce(
            textResponse(
                '<html><title>Google</title>Our systems have detected unusual traffic</html>'
            )
        );
        const error = await failure(
            googleProvider.translate('x', 'auto', 'es')
        );
        expect(error.code).toBe('RATE_LIMIT_EXCEEDED');
        expect(error.retryable).toBe(false);
    });

    it('treats any other non-JSON body as a request failure', async () => {
        fetchMock.mockResolvedValueOnce(
            textResponse('<html>maintenance</html>')
        );
        const error = await failure(
            googleProvider.translate('x', 'auto', 'es')
        );
        expect(error.code).toBe('REQUEST_FAILED');
    });

    it('maps HTTP 429 to a retryable rate limit', async () => {
        fetchMock.mockResolvedValueOnce(textResponse('slow down', 429));
        const error = await failure(
            googleProvider.translate('x', 'auto', 'es')
        );
        expect(error.code).toBe('RATE_LIMIT_EXCEEDED');
        expect(error.status).toBe(429);
        expect(error.retryable).toBe(true);
    });

    it('rejects a JSON payload without translations', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({ unexpected: true }));
        const error = await failure(
            googleProvider.translate('x', 'auto', 'es')
        );
        expect(error.code).toBe('REQUEST_FAILED');
    });

    it('reports a transport failure as a retryable network error', async () => {
        fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
        const error = await failure(
            googleProvider.translate('x', 'auto', 'es')
        );
        expect(error.code).toBe('NETWORK_ERROR');
        expect(error.retryable).toBe(true);
    });
});

describe('microsoft edge auth provider', () => {
    const translation = [
        {
            detectedLanguage: { language: 'en', score: 1 },
            translations: [{ text: 'Hola', to: 'es' }],
        },
    ];

    it('fetches the anonymous token once and reuses it', async () => {
        const provider = createMicrosoftEdgeAuthProvider();
        const token = jwtExpiringAt(Math.floor(Date.now() / 1000) + 3600);
        fetchMock
            .mockResolvedValueOnce(textResponse(token, 200, 'text/plain'))
            .mockResolvedValueOnce(jsonResponse(translation))
            .mockResolvedValueOnce(jsonResponse(translation));

        await expect(provider.translate('Hello', 'auto', 'es')).resolves.toBe(
            'Hola'
        );
        await expect(provider.translate('Hello', 'en', 'es')).resolves.toBe(
            'Hola'
        );

        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(requestAt(0).url).toBe(
            'https://edge.microsoft.com/translate/auth'
        );
        const first = requestAt(1);
        expect(first.url).toBe(
            'https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&to=es'
        );
        expect(headersOf(first.init).Authorization).toBe(`Bearer ${token}`);
        expect(first.init.body).toBe(JSON.stringify([{ Text: 'Hello' }]));
        expect(requestAt(2).url).toContain('&from=en');
    });

    it('refreshes a token that is about to expire', async () => {
        const provider = createMicrosoftEdgeAuthProvider();
        const nowSeconds = Math.floor(Date.now() / 1000);
        fetchMock
            .mockResolvedValueOnce(
                textResponse(jwtExpiringAt(nowSeconds + 30), 200, 'text/plain')
            )
            .mockResolvedValueOnce(jsonResponse(translation))
            .mockResolvedValueOnce(
                textResponse(
                    jwtExpiringAt(nowSeconds + 3600),
                    200,
                    'text/plain'
                )
            )
            .mockResolvedValueOnce(jsonResponse(translation));

        await provider.translate('Hello', 'auto', 'es');
        await provider.translate('Hello', 'auto', 'es');
        expect(fetchMock).toHaveBeenCalledTimes(4);
        expect(requestAt(2).url).toBe(
            'https://edge.microsoft.com/translate/auth'
        );
    });

    it('drops the token after a 401 so the retry mints a new one', async () => {
        const provider = createMicrosoftEdgeAuthProvider();
        const token = jwtExpiringAt(Math.floor(Date.now() / 1000) + 3600);
        fetchMock
            .mockResolvedValueOnce(textResponse(token, 200, 'text/plain'))
            .mockResolvedValueOnce(textResponse('', 401))
            .mockResolvedValueOnce(textResponse(token, 200, 'text/plain'))
            .mockResolvedValueOnce(jsonResponse(translation));

        const error = await failure(provider.translate('Hello', 'auto', 'es'));
        expect(error.code).toBe('AUTHENTICATION_ERROR');
        expect(error.retryable).toBe(true);

        await expect(provider.translate('Hello', 'auto', 'es')).resolves.toBe(
            'Hola'
        );
        expect(requestAt(2).url).toBe(
            'https://edge.microsoft.com/translate/auth'
        );
    });

    it('rejects an auth body that is not a JWT with an expiry', async () => {
        const provider = createMicrosoftEdgeAuthProvider();
        fetchMock.mockResolvedValueOnce(
            textResponse('nope', 200, 'text/plain')
        );
        const error = await failure(provider.translate('Hello', 'auto', 'es'));
        expect(error.code).toBe('REQUEST_FAILED');
        expect(error.retryable).toBe(true);
        expect(readJwtExpiry('a.b.c')).toBeNull();
        expect(readJwtExpiry(jwtExpiringAt(1700))).toBe(1_700_000);
    });

    it('rejects a payload without a translation', async () => {
        const provider = createMicrosoftEdgeAuthProvider();
        fetchMock
            .mockResolvedValueOnce(
                textResponse(
                    jwtExpiringAt(Math.floor(Date.now() / 1000) + 3600),
                    200,
                    'text/plain'
                )
            )
            .mockResolvedValueOnce(jsonResponse([{ translations: [] }]));
        const error = await failure(provider.translate('Hello', 'auto', 'es'));
        expect(error.code).toBe('REQUEST_FAILED');
    });
});

describe('deepl provider', () => {
    it('maps language codes to DeepL identifiers', () => {
        expect(toDeepLLanguage('zh-CN')).toBe('ZH-HANS');
        expect(toDeepLLanguage('zh_TW')).toBe('ZH-HANT');
        expect(toDeepLLanguage('pt')).toBe('PT-PT');
        expect(toDeepLLanguage('en-US')).toBe('EN-US');
        expect(toDeepLLanguage('uk')).toBe('UK');
    });

    it('fails closed without an API key and never calls the network', async () => {
        const error = await failure(
            deeplProvider.translate('Hi', 'auto', 'zh-CN')
        );
        expect(error.code).toBe('AUTHENTICATION_ERROR');
        expect(error.retryable).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('posts a form body to the plan endpoint with the device-local key', async () => {
        await fakeBrowser.storage.local.set({ deeplApiKey: 'secret-key' });
        await fakeBrowser.storage.sync.set({ deeplApiPlan: 'pro' });
        fetchMock.mockResolvedValueOnce(
            jsonResponse({
                translations: [
                    { detected_source_language: 'EN', text: '你好' },
                ],
            })
        );

        await expect(
            deeplProvider.translate('Hi', 'auto', 'zh-CN')
        ).resolves.toBe('你好');
        const { url, init } = requestAt(0);
        expect(url).toBe('https://api.deepl.com/v2/translate');
        expect(init.method).toBe('POST');
        expect(headersOf(init).Authorization).toBe('DeepL-Auth-Key secret-key');
        expect(init.body).toBe('text=Hi&target_lang=ZH-HANS');
    });

    it('uses the free endpoint by default and sends an explicit source', async () => {
        await fakeBrowser.storage.local.set({ deeplApiKey: 'k' });
        fetchMock.mockResolvedValueOnce(
            jsonResponse({ translations: [{ text: 'Hallo' }] })
        );
        await deeplProvider.translate('Hello', 'en', 'de');
        const { url, init } = requestAt(0);
        expect(url).toBe('https://api-free.deepl.com/v2/translate');
        expect(init.body).toBe('text=Hello&source_lang=EN&target_lang=DE');
    });

    it('treats 456 as an exhausted quota that must not be retried', async () => {
        await fakeBrowser.storage.local.set({ deeplApiKey: 'k' });
        fetchMock.mockResolvedValueOnce(textResponse('quota', 456));
        const error = await failure(
            deeplProvider.translate('Hi', 'auto', 'de')
        );
        expect(error.code).toBe('RATE_LIMIT_EXCEEDED');
        expect(error.retryable).toBe(false);
        expect(error.status).toBe(456);
    });

    it('treats 403 as an authentication failure', async () => {
        await fakeBrowser.storage.local.set({ deeplApiKey: 'k' });
        fetchMock.mockResolvedValueOnce(textResponse('forbidden', 403));
        const error = await failure(
            deeplProvider.translate('Hi', 'auto', 'de')
        );
        expect(error.code).toBe('AUTHENTICATION_ERROR');
    });

    it('reports a storage outage as a retryable request failure, not a missing key', async () => {
        vi.spyOn(browser.storage.local, 'get').mockRejectedValueOnce(
            new Error('storage broken')
        );
        const error = await failure(
            deeplProvider.translate('Hi', 'auto', 'de')
        );
        expect(error.code).toBe('REQUEST_FAILED');
        expect(error.retryable).toBe(true);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('openai-compatible provider', () => {
    it('strips the models/ prefix only for the Gemini endpoint', () => {
        expect(
            normalizeModelName(
                'models/gemini-2.5-flash',
                'https://generativelanguage.googleapis.com/v1beta/openai'
            )
        ).toBe('gemini-2.5-flash');
        expect(
            normalizeModelName('models/custom', 'https://api.openai.com/v1')
        ).toBe('models/custom');
    });

    it('fails closed without an API key', async () => {
        const error = await failure(
            openaiCompatibleProvider.translate('Hi', 'auto', 'fr')
        );
        expect(error.code).toBe('AUTHENTICATION_ERROR');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('posts a chat completion with the shared instruction', async () => {
        await fakeBrowser.storage.local.set({
            openaiCompatibleApiKey: 'sk-test',
        });
        await fakeBrowser.storage.sync.set({
            openaiCompatibleBaseUrl: 'https://api.openai.com/v1',
            openaiCompatibleModel: 'gpt-4o-mini',
        });
        fetchMock.mockResolvedValueOnce(
            jsonResponse({
                choices: [
                    { message: { role: 'assistant', content: '  Bonjour  ' } },
                ],
                usage: { total_tokens: 12 },
            })
        );

        await expect(
            openaiCompatibleProvider.translate('Hello', 'en', 'fr')
        ).resolves.toBe('Bonjour');
        const { url, init } = requestAt(0);
        expect(url).toBe('https://api.openai.com/v1/chat/completions');
        expect(headersOf(init).Authorization).toBe('Bearer sk-test');
        const body = JSON.parse(bodyText(init)) as {
            model: string;
            messages: { role: string; content: string }[];
            temperature: number;
        };
        expect(body.model).toBe('gpt-4o-mini');
        expect(body.temperature).toBe(0.1);
        expect(body.messages[0]?.role).toBe('system');
        expect(body.messages[0]?.content).toContain('from English to French');
        expect(body.messages[1]).toEqual({ role: 'user', content: 'Hello' });
    });

    it('normalizes the model for the default Gemini endpoint', async () => {
        await fakeBrowser.storage.local.set({ openaiCompatibleApiKey: 'key' });
        await fakeBrowser.storage.sync.set({
            openaiCompatibleModel: 'models/gemini-2.5-flash',
        });
        fetchMock.mockResolvedValueOnce(
            jsonResponse({ choices: [{ message: { content: 'Hola' } }] })
        );
        await openaiCompatibleProvider.translate('Hello', 'auto', 'es');
        const { url, init } = requestAt(0);
        expect(url).toBe(
            'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'
        );
        expect((JSON.parse(bodyText(init)) as { model: string }).model).toBe(
            'gemini-2.5-flash'
        );
    });

    it('accepts the Responses API output shape', async () => {
        await fakeBrowser.storage.local.set({ openaiCompatibleApiKey: 'key' });
        fetchMock.mockResolvedValueOnce(
            jsonResponse({
                output: [{ content: [{ type: 'output_text', text: 'Ciao' }] }],
            })
        );
        await expect(
            openaiCompatibleProvider.translate('Hello', 'auto', 'it')
        ).resolves.toBe('Ciao');
    });

    it('rejects an empty completion', async () => {
        await fakeBrowser.storage.local.set({ openaiCompatibleApiKey: 'key' });
        fetchMock.mockResolvedValueOnce(
            jsonResponse({ choices: [{ message: { content: '   ' } }] })
        );
        const error = await failure(
            openaiCompatibleProvider.translate('Hello', 'auto', 'it')
        );
        expect(error.code).toBe('REQUEST_FAILED');
    });

    it('maps 429 to a retryable rate limit', async () => {
        await fakeBrowser.storage.local.set({ openaiCompatibleApiKey: 'key' });
        fetchMock.mockResolvedValueOnce(textResponse('', 429));
        const error = await failure(
            openaiCompatibleProvider.translate('Hello', 'auto', 'it')
        );
        expect(error.code).toBe('RATE_LIMIT_EXCEEDED');
        expect(error.retryable).toBe(true);
    });
});

describe('vertex gemini provider', () => {
    const vertexSettings = {
        sync: {
            vertexProjectId: 'my-project-123',
            vertexLocation: 'europe-west4',
            vertexModel: 'publishers/google/models/gemini-2.5-flash',
        },
        local: { vertexAccessToken: 'ya29.token' },
    };

    it('builds the regional endpoint from the short model name', () => {
        expect(
            buildVertexEndpoint('p', 'us-central1', 'models/gemini-2.5-flash')
        ).toBe(
            'https://us-central1-aiplatform.googleapis.com/v1/projects/p/locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent'
        );
    });

    it('fails closed while any setting is blank', async () => {
        await fakeBrowser.storage.sync.set(vertexSettings.sync);
        const error = await failure(
            geminiVertexProvider.translate('Hello', 'auto', 'ja')
        );
        expect(error.code).toBe('AUTHENTICATION_ERROR');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('posts generateContent with the bearer token and returns trimmed text', async () => {
        await fakeBrowser.storage.sync.set(vertexSettings.sync);
        await fakeBrowser.storage.local.set(vertexSettings.local);
        fetchMock.mockResolvedValueOnce(
            jsonResponse({
                candidates: [
                    { content: { parts: [{ text: ' こんにちは \n' }] } },
                ],
            })
        );

        await expect(
            geminiVertexProvider.translate('Hello', 'en', 'ja')
        ).resolves.toBe('こんにちは');
        const { url, init } = requestAt(0);
        expect(url).toBe(
            'https://europe-west4-aiplatform.googleapis.com/v1/projects/my-project-123/locations/europe-west4/publishers/google/models/gemini-2.5-flash:generateContent'
        );
        expect(headersOf(init).Authorization).toBe('Bearer ya29.token');
        const body = JSON.parse(bodyText(init)) as {
            contents: { parts: { text: string }[] }[];
            generationConfig: { maxOutputTokens: number };
        };
        expect(body.contents[0]?.parts[0]?.text).toContain(
            'from English to Japanese'
        );
        expect(body.contents[0]?.parts[0]?.text.endsWith('\n\nHello')).toBe(
            true
        );
        expect(body.generationConfig.maxOutputTokens).toBe(256);
    });

    it('reports a transport failure as a retryable network error', async () => {
        await fakeBrowser.storage.sync.set(vertexSettings.sync);
        await fakeBrowser.storage.local.set(vertexSettings.local);
        fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
        const error = await failure(
            geminiVertexProvider.translate('Hello', 'en', 'ja')
        );
        expect(error.code).toBe('NETWORK_ERROR');
        expect(error.retryable).toBe(true);
    });

    it('rejects an empty candidate', async () => {
        await fakeBrowser.storage.sync.set(vertexSettings.sync);
        await fakeBrowser.storage.local.set(vertexSettings.local);
        fetchMock.mockResolvedValueOnce(
            jsonResponse({
                candidates: [{ content: { parts: [{ text: '' }] } }],
            })
        );
        const error = await failure(
            geminiVertexProvider.translate('Hello', 'en', 'ja')
        );
        expect(error.code).toBe('REQUEST_FAILED');
    });
});

describe('provider connection checks', () => {
    it('reports a working DeepL key after one small translation', async () => {
        fetchMock.mockResolvedValueOnce(
            jsonResponse({ translations: [{ text: '你好' }] })
        );
        await expect(
            checkDeepLConnection({ apiKey: 'k', plan: 'pro' })
        ).resolves.toEqual({ ok: true });
        const { url, init } = requestAt(0);
        expect(url).toBe('https://api.deepl.com/v2/translate');
        expect(headersOf(init).Authorization).toBe('DeepL-Auth-Key k');
        expect(init.body).toBe('text=Hello&target_lang=ZH-HANS');
        expect(await fakeBrowser.storage.local.get('deeplApiKey')).toEqual({});
    });

    it.each([
        [403, 'invalid-key'],
        [456, 'quota'],
        [500, 'http'],
    ] as const)('classifies a DeepL %i as %s', async (status, reason) => {
        fetchMock.mockResolvedValueOnce(textResponse('', status));
        await expect(
            checkDeepLConnection({ apiKey: 'k', plan: 'free' })
        ).resolves.toEqual({ ok: false, reason, status });
    });

    it('classifies DeepL transport and shape failures', async () => {
        fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
        await expect(
            checkDeepLConnection({ apiKey: 'k', plan: 'free' })
        ).resolves.toEqual({ ok: false, reason: 'network', status: null });

        fetchMock.mockResolvedValueOnce(jsonResponse({ translations: [] }));
        await expect(
            checkDeepLConnection({ apiKey: 'k', plan: 'free' })
        ).resolves.toEqual({ ok: false, reason: 'malformed', status: null });
    });

    it('lists OpenAI and Gemini model ids from the models endpoint', async () => {
        fetchMock.mockResolvedValueOnce(
            jsonResponse({
                data: [{ id: 'gpt-a' }, { id: 'gpt-b' }, { noId: 1 }],
            })
        );
        await expect(
            fetchAvailableModels('sk', 'https://api.openai.com/v1')
        ).resolves.toEqual(['gpt-a', 'gpt-b']);
        const { url, init } = requestAt(0);
        expect(url).toBe('https://api.openai.com/v1/models');
        expect(headersOf(init).Authorization).toBe('Bearer sk');

        fetchMock.mockResolvedValueOnce(
            jsonResponse({
                models: [
                    { name: 'models/gemini-2.5-flash' },
                    { name: 'models/text-bison' },
                ],
            })
        );
        await expect(
            fetchAvailableModels(
                'key',
                'https://generativelanguage.googleapis.com/v1beta/openai'
            )
        ).resolves.toEqual(['models/gemini-2.5-flash']);
    });

    it('rejects a model listing failure with the provider error', async () => {
        fetchMock.mockResolvedValueOnce(textResponse('', 401));
        const error = await failure(
            fetchAvailableModels('sk', 'https://api.openai.com/v1')
        );
        expect(error.code).toBe('AUTHENTICATION_ERROR');

        fetchMock.mockResolvedValueOnce(jsonResponse({ unexpected: true }));
        const malformed = await failure(
            fetchAvailableModels('sk', 'https://api.openai.com/v1')
        );
        expect(malformed.code).toBe('REQUEST_FAILED');
    });

    it('checks Vertex with the given credentials without touching storage', async () => {
        fetchMock.mockResolvedValueOnce(
            jsonResponse({
                candidates: [{ content: { parts: [{ text: 'pong' }] } }],
            })
        );
        await expect(
            checkVertexConnection({
                accessToken: 'tok',
                projectId: 'p',
                location: 'us-central1',
                model: 'gemini-2.5-flash',
            })
        ).resolves.toBeUndefined();
        const { url, init } = requestAt(0);
        expect(url).toContain('/projects/p/locations/us-central1/');
        expect(headersOf(init).Authorization).toBe('Bearer tok');

        fetchMock.mockResolvedValueOnce(textResponse('', 403));
        const error = await failure(
            checkVertexConnection({
                accessToken: 'tok',
                projectId: 'p',
                location: 'us-central1',
                model: 'gemini-2.5-flash',
            })
        );
        expect(error.code).toBe('AUTHENTICATION_ERROR');
    });
});
