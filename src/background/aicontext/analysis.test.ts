import { describe, expect, it, vi } from 'vitest';
import { runProviderAnalysis } from './analysis';
import type { ProviderSettings } from './provider';
import { ContextProviderError } from './providerError';
import { geminiContextProvider } from './providers/gemini';
import { openaiApiBase, openaiContextProvider } from './providers/openai';
import { culturalSample } from './schemas.test';

const SETTINGS: ProviderSettings = {
    openaiApiKey: 'sk-test',
    openaiBaseUrl: 'https://api.openai.com',
    openaiModel: 'gpt-5.6-luna',
    geminiApiKey: 'gm-test',
    geminiModel: 'gemini-3.5-flash',
};

const INPUT = { text: 'hola', type: 'cultural', targetLanguage: 'en' } as const;

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function fetchReturning(response: Response | Error) {
    return vi.fn(() =>
        response instanceof Error
            ? Promise.reject(response)
            : Promise.resolve(response)
    ) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

async function failure(
    promise: Promise<unknown>
): Promise<ContextProviderError> {
    try {
        await promise;
    } catch (error) {
        if (error instanceof ContextProviderError) {
            return error;
        }
        throw error;
    }
    throw new Error('expected a provider error');
}

function requestBody(
    fetchMock: ReturnType<typeof vi.fn>
): Record<string, unknown> {
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    return JSON.parse(init.body as string) as Record<string, unknown>;
}

describe('openai context provider', () => {
    it('ensures the /v1 prefix exactly once', () => {
        expect(openaiApiBase('https://api.openai.com')).toBe(
            'https://api.openai.com/v1'
        );
        expect(openaiApiBase('https://api.openai.com/v1/')).toBe(
            'https://api.openai.com/v1'
        );
        expect(openaiApiBase('https://host/api')).toBe('https://host/api/v1');
    });

    it('posts a strict json_schema chat completion and returns the analysis', async () => {
        const sample = culturalSample();
        const fetchMock = fetchReturning(
            jsonResponse({
                choices: [{ message: { content: JSON.stringify(sample) } }],
            })
        );
        const analysis = await runProviderAnalysis(
            openaiContextProvider,
            SETTINGS,
            INPUT,
            { timeoutMs: 1000, fetch: fetchMock }
        );
        expect(analysis).toEqual(sample);

        const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
        expect(url).toBe('https://api.openai.com/v1/chat/completions');
        expect(init.headers).toMatchObject({ Authorization: 'Bearer sk-test' });
        expect(init.credentials).toBe('omit');
        expect(init.signal).toBeInstanceOf(AbortSignal);
        const body = requestBody(fetchMock);
        expect(body.model).toBe('gpt-5.6-luna');
        expect(body.messages).toHaveLength(2);
        expect(body.response_format).toMatchObject({
            type: 'json_schema',
            json_schema: { name: 'context_analysis', strict: true },
        });
    });

    it('refuses to dispatch without an API key', async () => {
        const fetchMock = fetchReturning(jsonResponse({}));
        const error = await failure(
            runProviderAnalysis(
                openaiContextProvider,
                { ...SETTINGS, openaiApiKey: '  ' },
                INPUT,
                { timeoutMs: 1000, fetch: fetchMock }
            )
        );
        expect(error.code).toBe('NOT_CONFIGURED');
        expect(error.retryable).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('classifies upstream statuses by retryability', async () => {
        const unavailable = await failure(
            runProviderAnalysis(openaiContextProvider, SETTINGS, INPUT, {
                timeoutMs: 1000,
                fetch: fetchReturning(jsonResponse({}, 503)),
            })
        );
        expect(unavailable.code).toBe('UPSTREAM_ERROR');
        expect(unavailable.retryable).toBe(true);

        const unauthorized = await failure(
            runProviderAnalysis(openaiContextProvider, SETTINGS, INPUT, {
                timeoutMs: 1000,
                fetch: fetchReturning(jsonResponse({}, 401)),
            })
        );
        expect(unauthorized.retryable).toBe(false);
    });

    it('quotes the upstream error detail when the body offers one', async () => {
        const openaiStyle = await failure(
            runProviderAnalysis(openaiContextProvider, SETTINGS, INPUT, {
                timeoutMs: 1000,
                fetch: fetchReturning(
                    jsonResponse(
                        { error: { message: 'The model `x` does not exist' } },
                        404
                    )
                ),
            })
        );
        expect(openaiStyle.message).toBe(
            'API request failed: 404 (The model `x` does not exist)'
        );

        const plainText = await failure(
            runProviderAnalysis(openaiContextProvider, SETTINGS, INPUT, {
                timeoutMs: 1000,
                fetch: fetchReturning(
                    new Response('404 page not found\n', { status: 404 })
                ),
            })
        );
        expect(plainText.message).toBe(
            'API request failed: 404 (404 page not found)'
        );

        const longDetail = await failure(
            runProviderAnalysis(openaiContextProvider, SETTINGS, INPUT, {
                timeoutMs: 1000,
                fetch: fetchReturning(
                    jsonResponse({ detail: 'x'.repeat(400) }, 400)
                ),
            })
        );
        expect(longDetail.message.length).toBeLessThan(200);
        expect(longDetail.message.endsWith('…)')).toBe(true);
    });

    it('classifies transport failures', async () => {
        const network = await failure(
            runProviderAnalysis(openaiContextProvider, SETTINGS, INPUT, {
                timeoutMs: 1000,
                fetch: fetchReturning(new TypeError('Failed to fetch')),
            })
        );
        expect(network.code).toBe('NETWORK_ERROR');
        expect(network.retryable).toBe(true);

        const timeout = await failure(
            runProviderAnalysis(openaiContextProvider, SETTINGS, INPUT, {
                timeoutMs: 1000,
                fetch: fetchReturning(
                    new DOMException('timed out', 'TimeoutError')
                ),
            })
        );
        expect(timeout.code).toBe('TIMEOUT');
        expect(timeout.retryable).toBe(true);
    });

    it('rejects unusable model output as retryable', async () => {
        const notJson = await failure(
            runProviderAnalysis(openaiContextProvider, SETTINGS, INPUT, {
                timeoutMs: 1000,
                fetch: fetchReturning(
                    jsonResponse({
                        choices: [{ message: { content: 'not json' } }],
                    })
                ),
            })
        );
        expect(notJson.code).toBe('MALFORMED_RESPONSE');
        expect(notJson.retryable).toBe(true);

        const wrongShape = await failure(
            runProviderAnalysis(openaiContextProvider, SETTINGS, INPUT, {
                timeoutMs: 1000,
                fetch: fetchReturning(
                    jsonResponse({
                        choices: [
                            { message: { content: '{"definition":"x"}' } },
                        ],
                    })
                ),
            })
        );
        expect(wrongShape.message).toBe('Schema validation failed');

        const noChoices = await failure(
            runProviderAnalysis(openaiContextProvider, SETTINGS, INPUT, {
                timeoutMs: 1000,
                fetch: fetchReturning(jsonResponse({ choices: [] })),
            })
        );
        expect(noChoices.code).toBe('MALFORMED_RESPONSE');
    });
});

describe('analysis runner', () => {
    it('invokes fetch unbound, as the worker global requires', async () => {
        const sample = culturalSample();
        const strictFetch = vi.fn(function (this: unknown) {
            if (this !== undefined) {
                return Promise.reject(new TypeError('Illegal invocation'));
            }
            return Promise.resolve(
                jsonResponse({
                    choices: [{ message: { content: JSON.stringify(sample) } }],
                })
            );
        });
        await expect(
            runProviderAnalysis(openaiContextProvider, SETTINGS, INPUT, {
                timeoutMs: 1000,
                fetch: strictFetch,
            })
        ).resolves.toEqual(sample);
    });
});

describe('gemini context provider', () => {
    it('posts generateContent with the key in a header and a JSON response schema', async () => {
        const sample = culturalSample();
        const fetchMock = fetchReturning(
            jsonResponse({
                candidates: [
                    {
                        finishReason: 'STOP',
                        content: { parts: [{ text: JSON.stringify(sample) }] },
                    },
                ],
            })
        );
        const analysis = await runProviderAnalysis(
            geminiContextProvider,
            SETTINGS,
            INPUT,
            { timeoutMs: 1000, fetch: fetchMock }
        );
        expect(analysis).toEqual(sample);

        const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
        expect(url).toBe(
            'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent'
        );
        expect(init.headers).toMatchObject({ 'x-goog-api-key': 'gm-test' });
        const body = requestBody(fetchMock);
        expect(body.systemInstruction).toBeDefined();
        expect(body.generationConfig).toMatchObject({
            responseMimeType: 'application/json',
        });
        expect(
            (body.generationConfig as { responseJsonSchema: unknown })
                .responseJsonSchema
        ).toMatchObject({ type: 'object', additionalProperties: false });
    });

    it('treats a safety refusal as final', async () => {
        const error = await failure(
            runProviderAnalysis(geminiContextProvider, SETTINGS, INPUT, {
                timeoutMs: 1000,
                fetch: fetchReturning(
                    jsonResponse({ candidates: [{ finishReason: 'SAFETY' }] })
                ),
            })
        );
        expect(error.code).toBe('SAFETY_BLOCKED');
        expect(error.retryable).toBe(false);
    });

    it('requires a Gemini API key', async () => {
        const error = await failure(
            runProviderAnalysis(
                geminiContextProvider,
                { ...SETTINGS, geminiApiKey: '' },
                INPUT,
                { timeoutMs: 1000, fetch: fetchReturning(jsonResponse({})) }
            )
        );
        expect(error.code).toBe('NOT_CONFIGURED');
    });
});
