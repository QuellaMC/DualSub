import { afterEach, jest } from '@jest/globals';
import { configService } from '../services/configService.js';
import {
    analyzeContext as analyzeOpenAIContext,
    getAvailableModels as getOpenAIModels,
    getDefaultModel as getOpenAIDefaultModel,
} from './openaiContextProvider.js';
import {
    analyzeContext as analyzeGeminiContext,
    getAvailableModels as getGeminiModels,
    getDefaultModel as getGeminiDefaultModel,
} from './geminiContextProvider.js';

function culturalAnalysis() {
    return {
        definition: 'A definition',
        cultural_context: {
            origins: 'Origins',
            social_context: 'Social context',
            regional_variations: 'Regional variations',
        },
        usage: {
            examples: ['Example'],
            when_to_use: 'When to use',
            formality_level: 'Informal',
        },
        cultural_significance: 'Significance',
        learning_tips: 'Tips',
        related_expressions: ['Related'],
        sensitivities: 'None',
    };
}

function hasSchemaKeyword(value, keyword) {
    if (!value || typeof value !== 'object') return false;
    if (Object.hasOwn(value, keyword)) return true;
    return Object.values(value).some((child) =>
        hasSchemaKeyword(child, keyword)
    );
}

function createAuthoritativeConfigResult(values) {
    return {
        ok: true,
        values,
        degraded: false,
        failedAreas: [],
        areas: {
            sync: { status: 'ok' },
            local: { status: 'ok' },
        },
    };
}

describe('AI context provider request contracts', () => {
    let strictConfigRead;

    afterEach(() => {
        strictConfigRead?.mockRestore();
        jest.useRealTimers();
    });

    beforeEach(() => {
        global.fetch = jest.fn();
        strictConfigRead = jest.spyOn(
            configService,
            'readMultipleResultStrict'
        );
    });

    test('OpenAI uses the v1 chat-completions URL and requested GPT-5.6 model', async () => {
        global.testUtils.setupChromeStorage({
            openaiApiKey: 'test-openai-key',
            openaiBaseUrl: 'https://api.openai.com/',
            openaiModel: 'gpt-5.6-terra',
            aiContextTimeout: 30000,
        });
        fetch.mockResolvedValue({
            ok: true,
            json: async () => ({
                choices: [
                    {
                        message: {
                            content: JSON.stringify(culturalAnalysis()),
                        },
                    },
                ],
                usage: { total_tokens: 42 },
            }),
        });

        const result = await analyzeOpenAIContext('hello', 'cultural', {
            targetLanguage: 'en',
        });

        expect(result.success).toBe(true);
        expect(strictConfigRead).toHaveBeenCalledTimes(1);
        expect(strictConfigRead).toHaveBeenCalledWith(
            [
                'openaiApiKey',
                'openaiBaseUrl',
                'openaiModel',
                'aiContextTimeout',
            ],
            { includeSensitive: true }
        );
        expect(fetch).toHaveBeenCalledTimes(1);
        const [url, request] = fetch.mock.calls[0];
        const body = JSON.parse(request.body);
        expect(url).toBe('https://api.openai.com/v1/chat/completions');
        expect(body).toEqual(
            expect.objectContaining({
                model: 'gpt-5.6-terra',
                messages: expect.any(Array),
                response_format: expect.objectContaining({
                    type: 'json_schema',
                }),
            })
        );
    });

    test('OpenAI model choices and default use only the requested GPT-5.6 tiers', () => {
        expect(getOpenAIModels().map(({ id }) => id)).toEqual([
            'gpt-5.6-luna',
            'gpt-5.6-terra',
            'gpt-5.6',
        ]);
        expect(getOpenAIDefaultModel()).toBe('gpt-5.6-luna');
    });

    test('OpenAI rejects an authoritative malformed base URL before fetch', async () => {
        strictConfigRead.mockResolvedValue(
            createAuthoritativeConfigResult({
                openaiApiKey: 'test-openai-key',
                openaiBaseUrl: 'not a provider URL',
                openaiModel: 'gpt-5.6-luna',
                aiContextTimeout: 30_000,
            })
        );

        await expect(
            analyzeOpenAIContext('hello', 'cultural', {
                targetLanguage: 'en',
            })
        ).resolves.toMatchObject({
            success: false,
            error: 'OpenAI provider configuration is invalid',
            shouldRetry: false,
            shouldCache: false,
        });
        expect(strictConfigRead).toHaveBeenCalledTimes(1);
        expect(fetch).not.toHaveBeenCalled();
    });

    test('Gemini uses 3.5 Flash and caps generated output at 8192 tokens', async () => {
        global.testUtils.setupChromeStorage({
            geminiApiKey: 'test-gemini-key',
            geminiModel: 'gemini-3.5-flash',
            aiContextTimeout: 30000,
        });
        fetch.mockResolvedValue({
            ok: true,
            json: async () => ({
                candidates: [
                    {
                        finishReason: 'STOP',
                        content: {
                            parts: [
                                {
                                    text: JSON.stringify(culturalAnalysis()),
                                },
                            ],
                        },
                    },
                ],
            }),
        });

        const result = await analyzeGeminiContext('hello', 'cultural', {
            targetLanguage: 'en',
        });

        expect(result.success).toBe(true);
        expect(strictConfigRead).toHaveBeenCalledTimes(1);
        expect(strictConfigRead).toHaveBeenCalledWith(
            ['geminiApiKey', 'geminiModel', 'aiContextTimeout'],
            { includeSensitive: true }
        );
        const [url, request] = fetch.mock.calls[0];
        const body = JSON.parse(request.body);
        expect(url).toContain(
            '/v1beta/models/gemini-3.5-flash:generateContent'
        );
        expect(body.generationConfig.maxOutputTokens).toBe(8192);
        expect(body.generationConfig.responseMimeType).toBe('application/json');
        expect(body.generationConfig.responseSchema).toBeUndefined();
        expect(body.generationConfig.responseJsonSchema).toEqual(
            expect.objectContaining({
                required: expect.arrayContaining([
                    'definition',
                    'cultural_context',
                    'usage',
                ]),
                additionalProperties: false,
                properties: expect.objectContaining({
                    cultural_context: expect.objectContaining({
                        type: 'object',
                        required: [
                            'origins',
                            'social_context',
                            'regional_variations',
                        ],
                        additionalProperties: false,
                    }),
                }),
            })
        );
    });

    test('Gemini sends strict JSON Schema through the JSON Schema request field', async () => {
        global.testUtils.setupChromeStorage({
            geminiApiKey: 'test-gemini-key',
            geminiModel: 'gemini-3.5-flash',
            aiContextTimeout: 30000,
        });

        const invalidSchemaResponse = {
            error: {
                code: 400,
                message:
                    'Invalid JSON payload received. Unknown name "additionalProperties" at \'generation_config.response_schema\': Cannot find field.',
                status: 'INVALID_ARGUMENT',
                details: [
                    {
                        '@type': 'type.googleapis.com/google.rpc.BadRequest',
                        fieldViolations: [
                            {
                                field: 'generation_config.response_schema',
                                description:
                                    'Invalid JSON payload received. Unknown name "additionalProperties" at \'generation_config.response_schema\': Cannot find field.',
                            },
                        ],
                    },
                ],
            },
        };

        fetch.mockImplementation(async (_url, request) => {
            const { generationConfig } = JSON.parse(request.body);
            if (
                hasSchemaKeyword(
                    generationConfig.responseSchema,
                    'additionalProperties'
                )
            ) {
                return {
                    ok: false,
                    status: 400,
                    headers: { get: () => 'application/json' },
                    json: async () => invalidSchemaResponse,
                };
            }

            return {
                ok: true,
                json: async () => ({
                    candidates: [
                        {
                            finishReason: 'STOP',
                            content: {
                                parts: [
                                    {
                                        text: JSON.stringify(
                                            culturalAnalysis()
                                        ),
                                    },
                                ],
                            },
                        },
                    ],
                }),
            };
        });

        await expect(
            analyzeGeminiContext('hello', 'cultural', {
                targetLanguage: 'en',
            })
        ).resolves.toMatchObject({ success: true });

        const [, request] = fetch.mock.calls[0];
        const { generationConfig } = JSON.parse(request.body);
        expect(generationConfig.responseSchema).toBeUndefined();
        expect(generationConfig.responseJsonSchema).toEqual(
            expect.objectContaining({
                type: 'object',
                additionalProperties: false,
            })
        );
    });

    test('Gemini model choices default to 3.5 Flash and exclude 1.5 models', () => {
        const modelIds = getGeminiModels().map(({ id }) => id);
        expect(modelIds[0]).toBe('gemini-3.5-flash');
        expect(modelIds).not.toEqual(
            expect.arrayContaining(['gemini-1.5-flash', 'gemini-1.5-pro'])
        );
        expect(getGeminiDefaultModel()).toBe('gemini-3.5-flash');
    });

    test('Gemini rejects an authoritative blank model before fetch', async () => {
        strictConfigRead.mockResolvedValue(
            createAuthoritativeConfigResult({
                geminiApiKey: 'test-gemini-key',
                geminiModel: '   ',
                aiContextTimeout: 30_000,
            })
        );

        await expect(
            analyzeGeminiContext('hello', 'cultural', {
                targetLanguage: 'en',
            })
        ).resolves.toMatchObject({
            success: false,
            error: 'Gemini provider configuration is invalid',
            shouldRetry: false,
            shouldCache: false,
        });
        expect(strictConfigRead).toHaveBeenCalledTimes(1);
        expect(fetch).not.toHaveBeenCalled();
    });

    test.each([
        {
            name: 'OpenAI local area',
            analyze: analyzeOpenAIContext,
            failedArea: 'local',
        },
        {
            name: 'Gemini sync area',
            analyze: analyzeGeminiContext,
            failedArea: 'sync',
        },
    ])(
        '$name fails closed when the strict cross-area read rejects',
        async ({ analyze, failedArea }) => {
            strictConfigRead.mockRejectedValue(
                Object.assign(
                    new Error(
                        `storage failure with provider-secret in ${failedArea}`
                    ),
                    { failedAreas: [failedArea] }
                )
            );

            await expect(
                analyze('hello', 'cultural', { targetLanguage: 'en' })
            ).resolves.toMatchObject({
                success: false,
                error: 'Required provider configuration is unavailable',
                shouldRetry: false,
                shouldCache: false,
            });
            expect(strictConfigRead).toHaveBeenCalledTimes(1);
            expect(fetch).not.toHaveBeenCalled();
        }
    );

    test.each([
        {
            name: 'OpenAI model',
            analyze: analyzeOpenAIContext,
            values: {
                openaiApiKey: 'test-openai-key',
                openaiBaseUrl: 'https://api.openai.com/v1',
                aiContextTimeout: 30_000,
            },
        },
        {
            name: 'Gemini credential',
            analyze: analyzeGeminiContext,
            values: {
                geminiModel: 'gemini-3.5-flash',
                aiContextTimeout: 30_000,
            },
        },
    ])(
        '$name fails closed when the authoritative result omits a required key',
        async ({ analyze, values }) => {
            strictConfigRead.mockResolvedValue(
                createAuthoritativeConfigResult(values)
            );

            await expect(
                analyze('hello', 'cultural', { targetLanguage: 'en' })
            ).resolves.toMatchObject({
                success: false,
                error: 'Required provider configuration is unavailable',
                shouldRetry: false,
                shouldCache: false,
            });
            expect(strictConfigRead).toHaveBeenCalledTimes(1);
            expect(fetch).not.toHaveBeenCalled();
        }
    );

    test.each([
        {
            name: 'OpenAI empty credential',
            analyze: analyzeOpenAIContext,
            values: {
                openaiApiKey: '',
                openaiBaseUrl: 'https://api.openai.com/v1',
                openaiModel: 'gpt-5.6-luna',
                aiContextTimeout: 30_000,
            },
            error: 'OpenAI API key not configured',
        },
        {
            name: 'OpenAI non-string credential',
            analyze: analyzeOpenAIContext,
            values: {
                openaiApiKey: 7,
                openaiBaseUrl: 'https://api.openai.com/v1',
                openaiModel: 'gpt-5.6-luna',
                aiContextTimeout: 30_000,
            },
            error: 'OpenAI API key not configured',
        },
        {
            name: 'OpenAI blank model',
            analyze: analyzeOpenAIContext,
            values: {
                openaiApiKey: 'test-openai-key',
                openaiBaseUrl: 'https://api.openai.com/v1',
                openaiModel: '   ',
                aiContextTimeout: 30_000,
            },
            error: 'OpenAI provider configuration is invalid',
        },
        {
            name: 'OpenAI out-of-range timeout',
            analyze: analyzeOpenAIContext,
            values: {
                openaiApiKey: 'test-openai-key',
                openaiBaseUrl: 'https://api.openai.com/v1',
                openaiModel: 'gpt-5.6-luna',
                aiContextTimeout: 100,
            },
            error: 'OpenAI provider configuration is invalid',
        },
        {
            name: 'Gemini empty credential',
            analyze: analyzeGeminiContext,
            values: {
                geminiApiKey: '',
                geminiModel: 'gemini-3.5-flash',
                aiContextTimeout: 30_000,
            },
            error: 'Gemini API key not configured',
        },
        {
            name: 'Gemini non-string credential',
            analyze: analyzeGeminiContext,
            values: {
                geminiApiKey: {},
                geminiModel: 'gemini-3.5-flash',
                aiContextTimeout: 30_000,
            },
            error: 'Gemini API key not configured',
        },
        {
            name: 'Gemini out-of-range timeout',
            analyze: analyzeGeminiContext,
            values: {
                geminiApiKey: 'test-gemini-key',
                geminiModel: 'gemini-3.5-flash',
                aiContextTimeout: 100,
            },
            error: 'Gemini provider configuration is invalid',
        },
    ])(
        '$name is rejected before network use',
        async ({ analyze, values, error }) => {
            strictConfigRead.mockResolvedValue(
                createAuthoritativeConfigResult(values)
            );

            await expect(
                analyze('hello', 'cultural', { targetLanguage: 'en' })
            ).resolves.toMatchObject({
                success: false,
                error,
                shouldRetry: false,
                shouldCache: false,
            });
            expect(strictConfigRead).toHaveBeenCalledTimes(1);
            expect(fetch).not.toHaveBeenCalled();
        }
    );

    test('OpenAI request materialization is isolated from fetch-side source mutation', async () => {
        const sourceValues = {
            openaiApiKey: 'initial-openai-key',
            openaiBaseUrl: 'https://initial.example/v1',
            openaiModel: 'gpt-5.6-terra',
            aiContextTimeout: 30_000,
        };
        strictConfigRead.mockResolvedValue(
            createAuthoritativeConfigResult(sourceValues)
        );
        fetch.mockImplementation(async () => {
            Object.assign(sourceValues, {
                openaiApiKey: 'mutated-openai-key',
                openaiBaseUrl: 'https://mutated.example/v1',
                openaiModel: 'mutated-model',
            });
            return {
                ok: true,
                json: async () => ({
                    choices: [
                        {
                            message: {
                                content: JSON.stringify(culturalAnalysis()),
                            },
                        },
                    ],
                }),
            };
        });

        await expect(
            analyzeOpenAIContext('hello', 'cultural', {
                targetLanguage: 'en',
            })
        ).resolves.toMatchObject({ success: true });

        const [url, request] = fetch.mock.calls[0];
        expect(url).toBe('https://initial.example/v1/chat/completions');
        expect(request.headers.Authorization).toBe('Bearer initial-openai-key');
        expect(JSON.parse(request.body).model).toBe('gpt-5.6-terra');
        expect(sourceValues.openaiApiKey).toBe('mutated-openai-key');
    });

    test.each([
        {
            name: 'OpenAI',
            analyze: analyzeOpenAIContext,
            config: {
                openaiApiKey: 'test-openai-key',
                openaiBaseUrl: 'https://api.openai.com/v1',
                openaiModel: 'gpt-5.6-luna',
                aiContextTimeout: 30_000,
            },
        },
        {
            name: 'Gemini',
            analyze: analyzeGeminiContext,
            config: {
                geminiApiKey: 'test-gemini-key',
                geminiModel: 'gemini-3.5-flash',
                aiContextTimeout: 30_000,
            },
        },
    ])(
        '$name clears its abort timer when fetch rejects',
        async ({ analyze, config }) => {
            jest.useFakeTimers();
            global.testUtils.setupChromeStorage(config);
            fetch.mockRejectedValue(new TypeError('network unavailable'));
            const timersBeforeRequest = jest.getTimerCount();

            await expect(
                analyze('hello', 'cultural', { targetLanguage: 'en' })
            ).resolves.toMatchObject({ success: false });

            expect(jest.getTimerCount()).toBe(timersBeforeRequest);
        }
    );

    test.each([
        {
            name: 'OpenAI',
            analyze: analyzeOpenAIContext,
            config: {
                openaiApiKey: 'test-openai-key',
                openaiBaseUrl: 'https://api.openai.com/v1',
                openaiModel: 'gpt-5.6-luna',
                aiContextTimeout: 5_000,
            },
        },
        {
            name: 'Gemini',
            analyze: analyzeGeminiContext,
            config: {
                geminiApiKey: 'test-gemini-key',
                geminiModel: 'gemini-3.5-flash',
                aiContextTimeout: 5_000,
            },
        },
    ])(
        '$name applies its request deadline while reading JSON',
        async ({ analyze, config }) => {
            jest.useFakeTimers();
            global.testUtils.setupChromeStorage(config);
            fetch.mockResolvedValue({
                ok: true,
                json: jest.fn(() => new Promise(() => {})),
            });

            const analysis = analyze('hello', 'cultural', {
                targetLanguage: 'en',
            });
            const expectation = expect(analysis).resolves.toMatchObject({
                success: false,
                shouldRetry: true,
                shouldCache: false,
                error: expect.stringContaining('timed out'),
            });
            await jest.advanceTimersByTimeAsync(0);
            expect(fetch).toHaveBeenCalledTimes(1);

            await jest.advanceTimersByTimeAsync(5_000);

            await expectation;
        }
    );

    test.each([
        {
            name: 'OpenAI',
            analyze: analyzeOpenAIContext,
            config: {
                openaiApiKey: 'invalid-openai-key',
                openaiBaseUrl: 'https://api.openai.com/v1',
                openaiModel: 'gpt-5.6-luna',
            },
        },
        {
            name: 'Gemini',
            analyze: analyzeGeminiContext,
            config: {
                geminiApiKey: 'invalid-gemini-key',
                geminiModel: 'gemini-3.5-flash',
            },
        },
    ])(
        '$name marks authentication failures as non-retryable',
        async ({ analyze, config }) => {
            global.testUtils.setupChromeStorage(config);
            fetch.mockResolvedValue({
                ok: false,
                status: 401,
                statusText: 'Unauthorized',
                text: jest.fn().mockResolvedValue('invalid credentials'),
            });

            await expect(
                analyze('hello', 'cultural', { targetLanguage: 'en' })
            ).resolves.toMatchObject({
                success: false,
                shouldRetry: false,
                shouldCache: false,
            });
            expect(fetch).toHaveBeenCalledTimes(1);
        }
    );
});
