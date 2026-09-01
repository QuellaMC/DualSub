import { jest } from '@jest/globals';
import { configService } from '../services/configService.js';
import {
    analyzeContext as analyzeGeminiContext,
    getAvailableModels as getGeminiModels,
    getDefaultModel as getGeminiDefaultModel,
} from './geminiContextProvider.js';
import {
    analyzeContext as analyzeOpenAIContext,
    getAvailableModels as getOpenAIModels,
    getDefaultModel as getOpenAIDefaultModel,
} from './openaiContextProvider.js';

const OPENAI_CONFIG = {
    openaiApiKey: 'test-openai-key',
    openaiBaseUrl: 'https://api.openai.com/',
    openaiModel: 'gpt-5.6-terra',
    aiContextTimeout: 30_000,
};
const GEMINI_CONFIG = {
    geminiApiKey: 'test-gemini-key',
    geminiModel: 'gemini-3.5-flash',
    aiContextTimeout: 30_000,
};

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

function configResult(values) {
    return { values };
}

function openAIResponse(content = JSON.stringify(culturalAnalysis())) {
    return {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
            choices: [{ message: { content } }],
            usage: { total_tokens: 42 },
        }),
    };
}

function geminiResponse(text = JSON.stringify(culturalAnalysis())) {
    return {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({
            candidates: [
                {
                    finishReason: 'STOP',
                    content: { parts: [{ text }] },
                },
            ],
        }),
    };
}

function logs() {
    return ['debug', 'info', 'warn', 'error']
        .flatMap((level) => console[level].mock.calls.flat())
        .join('\n');
}

describe('AI context provider request contracts', () => {
    let readConfig;

    beforeEach(() => {
        readConfig = jest.spyOn(configService, 'readMultipleResultStrict');
        global.fetch = jest.fn();
    });

    afterEach(() => {
        jest.restoreAllMocks();
        delete global.fetch;
    });

    it('sends an OpenAI JSON-schema request using the configured model', async () => {
        readConfig.mockResolvedValue(configResult(OPENAI_CONFIG));
        fetch.mockResolvedValue(openAIResponse());

        await expect(
            analyzeOpenAIContext('hello', 'cultural', {
                targetLanguage: 'en',
            })
        ).resolves.toMatchObject({
            success: true,
            analysis: culturalAnalysis(),
            shouldCache: true,
        });

        expect(readConfig).toHaveBeenCalledWith(
            [
                'openaiApiKey',
                'openaiBaseUrl',
                'openaiModel',
                'aiContextTimeout',
            ],
            { includeSensitive: true }
        );
        const [url, request] = fetch.mock.calls[0];
        const body = JSON.parse(request.body);
        expect(url).toBe('https://api.openai.com/v1/chat/completions');
        expect(request.headers.Authorization).toBe('Bearer test-openai-key');
        expect(body).toMatchObject({
            model: 'gpt-5.6-terra',
            response_format: {
                type: 'json_schema',
                json_schema: {
                    name: 'context_analysis',
                    strict: true,
                },
            },
        });
    });

    it('sends Gemini strict JSON Schema through responseJsonSchema', async () => {
        readConfig.mockResolvedValue(configResult(GEMINI_CONFIG));
        fetch.mockResolvedValue(geminiResponse());

        await expect(
            analyzeGeminiContext('hello', 'cultural', {
                targetLanguage: 'en',
            })
        ).resolves.toMatchObject({
            success: true,
            analysis: culturalAnalysis(),
            shouldCache: true,
        });

        expect(readConfig).toHaveBeenCalledWith(
            ['geminiApiKey', 'geminiModel', 'aiContextTimeout'],
            { includeSensitive: true }
        );
        const [url, request] = fetch.mock.calls[0];
        const { generationConfig } = JSON.parse(request.body);
        expect(url).toContain(
            '/v1beta/models/gemini-3.5-flash:generateContent'
        );
        expect(generationConfig).toMatchObject({
            maxOutputTokens: 8192,
            responseMimeType: 'application/json',
            responseJsonSchema: {
                type: 'object',
                additionalProperties: false,
            },
        });
        expect(generationConfig.responseSchema).toBeUndefined();
    });

    it('exposes only the supported model choices and defaults', () => {
        expect(getOpenAIModels().map(({ id }) => id)).toEqual([
            'gpt-5.6-luna',
            'gpt-5.6-terra',
            'gpt-5.6',
        ]);
        expect(getOpenAIDefaultModel()).toBe('gpt-5.6-luna');
        expect(getGeminiModels().map(({ id }) => id)).toEqual([
            'gemini-3.5-flash',
            'gemini-2.5-flash',
            'gemini-2.5-pro',
        ]);
        expect(getGeminiDefaultModel()).toBe('gemini-3.5-flash');
    });

    it.each([
        {
            name: 'OpenAI',
            analyze: analyzeOpenAIContext,
            values: { ...OPENAI_CONFIG, openaiApiKey: '' },
            error: 'OpenAI API key not configured',
        },
        {
            name: 'Gemini',
            analyze: analyzeGeminiContext,
            values: { ...GEMINI_CONFIG, geminiApiKey: '' },
            error: 'Gemini API key not configured',
        },
    ])('$name rejects invalid configuration before fetch', async (provider) => {
        readConfig.mockResolvedValue(configResult(provider.values));

        await expect(
            provider.analyze('hello', 'cultural', { targetLanguage: 'en' })
        ).resolves.toMatchObject({
            success: false,
            error: provider.error,
            shouldRetry: false,
            shouldCache: false,
        });
        expect(fetch).not.toHaveBeenCalled();
    });

    it.each([
        ['OpenAI', analyzeOpenAIContext],
        ['Gemini', analyzeGeminiContext],
    ])('%s hides strict-read failure details', async (_name, analyze) => {
        readConfig.mockRejectedValue(
            new Error('PRIVATE_STORAGE_FAILURE_WITH_SECRET')
        );

        await expect(
            analyze('hello', 'cultural', { targetLanguage: 'en' })
        ).resolves.toMatchObject({
            success: false,
            error: 'Required provider configuration is unavailable',
            shouldRetry: false,
            shouldCache: false,
        });
        expect(fetch).not.toHaveBeenCalled();
        expect(logs()).not.toContain('PRIVATE_STORAGE_FAILURE_WITH_SECRET');
    });

    it.each([
        ['OpenAI', analyzeOpenAIContext, OPENAI_CONFIG],
        ['Gemini', analyzeGeminiContext, GEMINI_CONFIG],
    ])(
        '%s treats authentication failures as non-retryable',
        async (_name, analyze, config) => {
            readConfig.mockResolvedValue(configResult(config));
            fetch.mockResolvedValue({ ok: false, status: 401 });

            await expect(
                analyze('hello', 'cultural', { targetLanguage: 'en' })
            ).resolves.toMatchObject({
                success: false,
                shouldRetry: false,
                shouldCache: false,
            });
        }
    );

    it.each([
        ['OpenAI', analyzeOpenAIContext, OPENAI_CONFIG],
        ['Gemini', analyzeGeminiContext, GEMINI_CONFIG],
    ])(
        '%s treats upstream failures as retryable',
        async (_name, analyze, config) => {
            readConfig.mockResolvedValue(configResult(config));
            fetch.mockResolvedValue({ ok: false, status: 503 });

            await expect(
                analyze('hello', 'cultural', { targetLanguage: 'en' })
            ).resolves.toMatchObject({
                success: false,
                shouldRetry: true,
                shouldCache: false,
            });
        }
    );

    it.each([
        [
            'OpenAI',
            analyzeOpenAIContext,
            OPENAI_CONFIG,
            () => openAIResponse('not json'),
        ],
        [
            'Gemini',
            analyzeGeminiContext,
            GEMINI_CONFIG,
            () => geminiResponse('not json'),
        ],
    ])(
        '%s rejects malformed model JSON',
        async (_name, analyze, config, response) => {
            readConfig.mockResolvedValue(configResult(config));
            fetch.mockResolvedValue(response());

            await expect(
                analyze('hello', 'cultural', { targetLanguage: 'en' })
            ).resolves.toMatchObject({
                success: false,
                error: 'Malformed JSON response',
                shouldRetry: true,
                shouldCache: false,
            });
        }
    );
});
