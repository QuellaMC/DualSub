import { jest } from '@jest/globals';
import { configService } from '../services/configService.js';
import { analyzeContext as analyzeGeminiContext } from '../context_providers/geminiContextProvider.js';
import { analyzeContext as analyzeOpenAIContext } from '../context_providers/openaiContextProvider.js';
import { translate as translateDeepL } from './deeplTranslate.js';
import { translate as translateVertex } from './geminiVertexTranslate.js';
import { translate as translateGoogle } from './googleTranslate.js';
import { translate as translateMicrosoft } from './microsoftTranslateEdgeAuth.js';
import { translate as translateOpenAI } from './openaiCompatibleTranslate.js';

function loggedOutput() {
    return ['debug', 'info', 'warn', 'error']
        .flatMap((level) => console[level].mock.calls.flat())
        .join('\n');
}

function expectLogsToExclude(...sensitiveValues) {
    const output = loggedOutput();
    for (const sensitiveValue of sensitiveValues) {
        expect(output).not.toContain(sensitiveValue);
    }
}

describe('provider logging privacy', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        jest.restoreAllMocks();
        global.fetch = originalFetch;
    });

    it('does not log source or translated subtitle content', async () => {
        const source = 'PRIVATE_SOURCE_SUBTITLE_ALPHA';
        const translation = 'PRIVATE_TRANSLATED_SUBTITLE_BETA';
        jest.spyOn(configService, 'getMultiple').mockResolvedValue({
            openaiCompatibleApiKey: 'test-key',
            openaiCompatibleBaseUrl: 'https://api.example.test/v1',
            openaiCompatibleModel: 'test-model',
        });
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: { get: jest.fn().mockReturnValue('application/json') },
            json: jest.fn().mockResolvedValue({
                choices: [{ message: { content: translation } }],
                usage: { total_tokens: 12 },
            }),
        });

        await expect(translateOpenAI(source, 'en', 'es')).resolves.toBe(
            translation
        );

        expectLogsToExclude(source, translation);
    });

    it('does not log DeepL or Google error response bodies', async () => {
        const deepLError = 'PRIVATE_DEEPL_ERROR_PAYLOAD';
        const googleError = 'PRIVATE_GOOGLE_ERROR_PAYLOAD';
        jest.spyOn(configService, 'getMultiple').mockResolvedValue({
            deeplApiKey: 'test-key',
            deeplApiPlan: 'free',
        });
        global.fetch = jest
            .fn()
            .mockResolvedValueOnce({
                ok: false,
                status: 500,
                statusText: 'Server Error',
                headers: { get: jest.fn() },
                json: jest.fn().mockResolvedValue({ message: deepLError }),
            })
            .mockResolvedValueOnce({
                ok: false,
                status: 500,
                statusText: 'Server Error',
                headers: { get: jest.fn() },
                text: jest.fn().mockResolvedValue(googleError),
            });

        await expect(translateDeepL('Hello', 'en', 'es')).rejects.toThrow();
        await expect(translateGoogle('Hello', 'en', 'es')).rejects.toThrow();

        expectLogsToExclude(deepLError, googleError);
    });

    it('does not log Microsoft error response bodies', async () => {
        const errorPayload = 'PRIVATE_MICROSOFT_ERROR_PAYLOAD';
        const authToken =
            'eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjk5OTk5OTk5OTl9.signature';
        global.fetch = jest
            .fn()
            .mockResolvedValueOnce({
                ok: true,
                text: jest.fn().mockResolvedValue(authToken),
            })
            .mockResolvedValueOnce({
                ok: false,
                status: 400,
                statusText: 'Bad Request',
                headers: { get: jest.fn().mockReturnValue('application/json') },
                json: jest.fn().mockResolvedValue({
                    error: { message: errorPayload },
                }),
            });

        await expect(translateMicrosoft('Hello', 'en', 'es')).rejects.toThrow();

        expectLogsToExclude(errorPayload, authToken);
    });

    it('does not log Vertex error response bodies', async () => {
        const source = 'PRIVATE_VERTEX_SOURCE';
        const token = 'PRIVATE_VERTEX_TOKEN';
        const project = 'PRIVATE_VERTEX_PROJECT';
        const model = 'PRIVATE_VERTEX_MODEL';
        const jsonMarker = 'PRIVATE_VERTEX_JSON_BODY';
        const textMarker = 'PRIVATE_VERTEX_TEXT_BODY';
        const configRead = jest
            .spyOn(configService, 'readMultipleResultStrict')
            .mockResolvedValue({
                values: {
                    vertexAccessToken: token,
                    vertexProjectId: project,
                    vertexLocation: 'us-central1',
                    vertexModel: model,
                },
            });
        const json = jest.fn().mockRejectedValue(new Error(jsonMarker));
        const text = jest.fn().mockRejectedValue(new Error(textMarker));
        global.fetch = jest.fn().mockResolvedValue({
            ok: false,
            status: 400,
            json,
            text,
        });

        let providerError;
        try {
            await translateVertex(source, 'en', 'es');
        } catch (error) {
            providerError = error;
        }

        expect(providerError).toMatchObject({
            provider: 'vertex_gemini',
            status: 400,
            code: 'REQUEST_FAILED',
            retryable: false,
        });
        expect(configRead).toHaveBeenCalledTimes(1);
        expect(configRead).toHaveBeenCalledWith(
            [
                'vertexAccessToken',
                'vertexProjectId',
                'vertexLocation',
                'vertexModel',
            ],
            { includeSensitive: true }
        );
        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(json).not.toHaveBeenCalled();
        expect(text).not.toHaveBeenCalled();
        expectLogsToExclude(
            source,
            token,
            project,
            model,
            jsonMarker,
            textMarker
        );
    });

    it('does not log malformed AI response content', async () => {
        const source = 'PRIVATE_AI_CONTEXT_INPUT';
        const openAIResponse = 'PRIVATE_OPENAI_AI_RESPONSE';
        const geminiResponse = 'PRIVATE_GEMINI_AI_RESPONSE';
        const openAIJson = jest.fn().mockResolvedValue({
            choices: [{ message: { content: openAIResponse } }],
        });
        const geminiJson = jest.fn().mockResolvedValue({
            candidates: [
                {
                    finishReason: 'STOP',
                    content: {
                        parts: [{ text: geminiResponse }],
                    },
                },
            ],
        });
        jest.spyOn(configService, 'readMultipleResultStrict').mockResolvedValue(
            {
                ok: true,
                values: {
                    openaiApiKey: 'openai-key',
                    openaiBaseUrl: 'https://api.openai.com/v1',
                    openaiModel: 'test-model',
                    geminiApiKey: 'gemini-key',
                    geminiModel: 'gemini-3.5-flash',
                    aiContextTimeout: 30000,
                },
                degraded: false,
                failedAreas: [],
                areas: {
                    sync: { status: 'ok' },
                    local: { status: 'ok' },
                },
            }
        );
        global.fetch = jest
            .fn()
            .mockResolvedValueOnce({
                ok: true,
                json: openAIJson,
            })
            .mockResolvedValueOnce({
                ok: true,
                json: geminiJson,
            });

        const openAIResult = await analyzeOpenAIContext(source, 'cultural', {
            targetLanguage: 'en',
        });
        const geminiResult = await analyzeGeminiContext(source, 'cultural', {
            targetLanguage: 'en',
        });

        expect(global.fetch).toHaveBeenCalledTimes(2);
        expect(openAIJson).toHaveBeenCalledTimes(1);
        expect(geminiJson).toHaveBeenCalledTimes(1);
        expect(openAIResult).toMatchObject({
            success: false,
            error: 'Malformed JSON response',
            shouldRetry: true,
            shouldCache: false,
        });
        expect(geminiResult).toMatchObject({
            success: false,
            error: 'Malformed JSON response',
            shouldRetry: true,
            shouldCache: false,
        });
        expectLogsToExclude(source, openAIResponse, geminiResponse);
    });
});
