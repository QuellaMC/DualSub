import { jest } from '@jest/globals';
import { configService } from '../services/configService.js';
import {
    ErrorCategory,
    errorHandler,
} from '../background/utils/errorHandler.js';
import { translate, translateBatch } from './geminiVertexTranslate.js';

describe('geminiVertexTranslate error contract', () => {
    let configSpy;

    beforeEach(() => {
        configSpy = jest.spyOn(configService, 'getMultiple').mockResolvedValue({
            vertexAccessToken: 'short-lived-token',
            vertexProjectId: 'project-id',
            vertexLocation: 'us-central1',
            vertexModel: 'gemini-2.5-flash',
        });
    });

    afterEach(() => {
        configSpy.mockRestore();
        delete global.fetch;
    });

    it('throws a provider error instead of returning the original text', async () => {
        global.fetch = jest.fn().mockRejectedValue(new TypeError('offline'));

        await expect(translate('Hello', 'en', 'es')).rejects.toMatchObject({
            name: 'TranslationProviderError',
            provider: 'vertex_gemini',
        });
    });

    it('throws on a batch cardinality mismatch instead of returning originals', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: jest.fn().mockResolvedValue({
                candidates: [
                    {
                        content: {
                            parts: [{ text: '["Hola"]' }],
                        },
                    },
                ],
            }),
        });

        await expect(
            translateBatch(['Hello', 'World'], 'en', 'es')
        ).rejects.toMatchObject({
            name: 'TranslationProviderError',
            provider: 'vertex_gemini',
        });
    });

    it.each([401, 403])(
        'classifies an expired or unauthorized token (%s) as non-retryable configuration',
        async (status) => {
            global.fetch = jest.fn().mockResolvedValue({
                ok: false,
                status,
                statusText: 'Unauthorized',
                headers: { get: jest.fn().mockReturnValue('application/json') },
            });

            let providerError;
            try {
                await translate('Hello', 'en', 'es');
            } catch (error) {
                providerError = error;
            }

            expect(providerError).toMatchObject({
                name: 'TranslationProviderError',
                provider: 'vertex_gemini',
                status,
                retryable: false,
            });
            expect(
                errorHandler.handleError(providerError, { retryCount: 0 })
            ).toMatchObject({
                category: ErrorCategory.CONFIGURATION,
                errorCode: 'AUTHENTICATION_ERROR',
                shouldRetry: false,
            });
        }
    );

    it.each([429, 503])(
        'preserves retryable Vertex HTTP semantics for status %s',
        async (status) => {
            global.fetch = jest.fn().mockResolvedValue({
                ok: false,
                status,
                statusText: 'Upstream failure',
                headers: { get: jest.fn().mockReturnValue('application/json') },
            });

            let providerError;
            try {
                await translate('Hello', 'en', 'es');
            } catch (error) {
                providerError = error;
            }

            expect(providerError).toMatchObject({
                status,
                retryable: true,
            });
            const classified = errorHandler.handleError(providerError, {
                retryCount: 0,
            });
            expect(classified.shouldRetry).toBe(true);
            expect(classified.category).toBe(
                status === 429
                    ? ErrorCategory.RATE_LIMIT
                    : ErrorCategory.NETWORK
            );
        }
    );

    it('classifies a network failure as retryable', async () => {
        global.fetch = jest.fn().mockRejectedValue(new TypeError('offline'));

        let providerError;
        try {
            await translate('Hello', 'en', 'es');
        } catch (error) {
            providerError = error;
        }

        expect(providerError).toMatchObject({ retryable: true });
        expect(
            errorHandler.handleError(providerError, { retryCount: 0 })
        ).toMatchObject({
            category: ErrorCategory.NETWORK,
            shouldRetry: true,
        });
    });
});
