import { jest } from '@jest/globals';
import {
    ErrorCategory,
    ErrorSeverity,
    errorHandler,
    RateLimitError,
} from './errorHandler.js';
import { TranslationProviderError } from '../../translation_providers/translationProviderError.js';

function providerError(metadata) {
    return new TranslationProviderError(
        'PRIVATE_PROVIDER_DETAILS',
        'vertex_gemini',
        metadata
    );
}

describe('ErrorHandler', () => {
    beforeEach(() => {
        jest.spyOn(errorHandler.logger, 'error').mockImplementation(() => {});
        jest.spyOn(errorHandler.logger, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test.each([
        [
            { status: 401, retryable: false },
            ErrorCategory.CONFIGURATION,
            ErrorSeverity.CRITICAL,
            'AUTHENTICATION_ERROR',
            false,
        ],
        [
            { status: 429, retryable: true },
            ErrorCategory.RATE_LIMIT,
            ErrorSeverity.HIGH,
            'RATE_LIMIT_EXCEEDED',
            true,
        ],
        [
            { status: 503, retryable: true },
            ErrorCategory.NETWORK,
            ErrorSeverity.HIGH,
            'UPSTREAM_ERROR',
            true,
        ],
        [
            { status: 400, retryable: false },
            ErrorCategory.TRANSLATION,
            ErrorSeverity.MEDIUM,
            'REQUEST_FAILED',
            false,
        ],
    ])(
        'maps provider metadata %# to retry behavior',
        (metadata, category, severity, errorCode, shouldRetry) => {
            const result = errorHandler.handleError(providerError(metadata), {
                operation: 'translate',
                retryCount: 0,
            });

            expect(result).toMatchObject({
                originalError: null,
                message: 'Translation provider request failed.',
                category,
                severity,
                errorCode,
                shouldRetry,
            });
            expect(result).not.toHaveProperty('stack');
        }
    );

    test.each([
        ['AUTHENTICATION_ERROR', false, ErrorCategory.CONFIGURATION, false],
        ['NETWORK_ERROR', true, ErrorCategory.NETWORK, true],
        ['REQUEST_FAILED', false, ErrorCategory.TRANSLATION, false],
    ])('maps provider code %s', (code, retryable, category, shouldRetry) => {
        const result = errorHandler.handleError(
            providerError({ code, retryable }),
            { retryCount: 0 }
        );

        expect(result.category).toBe(category);
        expect(result.errorCode).toBe(code);
        expect(result.shouldRetry).toBe(shouldRetry);
    });

    test('returns only the provider context used for retry and severity', () => {
        const secret = 'PRIVATE_CONTEXT_VALUE';
        const result = errorHandler.handleError(
            providerError({ code: 'REQUEST_FAILED', retryable: true }),
            {
                operation: 'translate',
                textLength: 42,
                retryCount: 99,
                hasUserImpact: true,
                sourceLang: secret,
                token: secret,
            }
        );

        expect(result.context).toEqual({
            provider: 'vertex_gemini',
            operation: 'translate',
            textLength: 42,
            retryCount: 99,
            hasUserImpact: true,
        });
        expect(result.severity).toBe(ErrorSeverity.HIGH);
        expect(JSON.stringify(result)).not.toContain(secret);
    });

    test('classifies an ordinary network cause with safe operational context', () => {
        const cause = new TypeError('offline fetch');
        const error = new Error('translation failed', { cause });
        const context = {
            operation: 'analyzeContext',
            provider: 'openai',
            retryCount: 0,
            hasUserImpact: true,
            prompt: 'PRIVATE_PROMPT',
        };

        const result = errorHandler.handleError(error, context);

        expect(result).toMatchObject({
            originalError: null,
            message: 'Service request failed.',
            context: {
                operation: 'analyzeContext',
                provider: 'openai',
                retryCount: 0,
                hasUserImpact: true,
            },
            category: ErrorCategory.NETWORK,
            severity: ErrorSeverity.HIGH,
            errorCode: 'NETWORK_ERROR',
            shouldRetry: true,
        });
        expect(result).not.toHaveProperty('stack');
        expect(JSON.stringify(result.context)).not.toContain('PRIVATE_PROMPT');
    });

    test('stops network recovery at the caller retry limit', () => {
        const result = errorHandler.handleError(
            providerError({ code: 'NETWORK_ERROR', retryable: true }),
            { retryCount: 2 }
        );

        expect(result.context.retryCount).toBe(2);
        expect(result.shouldRetry).toBe(false);
        expect(result.retryDelay).toBe(0);
        expect(result.userMessage).not.toContain('Retrying automatically');
    });

    test('does not retain or log a plain provider response error', () => {
        const secret = 'PRIVATE_MALFORMED_PROVIDER_RESPONSE';
        const result = errorHandler.handleError(
            new SyntaxError(`Unexpected token in ${secret}`),
            {
                operation: 'analyzeContext',
                provider: 'openai',
                retryCount: 0,
                hasUserImpact: true,
            }
        );

        expect(result).toMatchObject({
            originalError: null,
            message: 'Service request failed.',
            category: ErrorCategory.SYSTEM,
        });
        expect(result).not.toHaveProperty('stack');
        expect(JSON.stringify(result)).not.toContain(secret);
        expect(
            JSON.stringify(errorHandler.logger.error.mock.calls)
        ).not.toContain(secret);
    });

    test('classifies the shared rate-limit error used by translation', () => {
        const result = errorHandler.handleError(
            new RateLimitError('Rate limit exceeded'),
            { retryCount: 0 }
        );

        expect(result).toMatchObject({
            category: ErrorCategory.RATE_LIMIT,
            errorCode: 'RATE_LIMIT_EXCEEDED',
            shouldRetry: true,
            retryDelay: 5000,
        });
    });

    test('describes the retry that translationService actually performs', () => {
        const result = errorHandler.handleError(
            providerError({ code: 'REQUEST_FAILED', retryable: true }),
            { retryCount: 0 }
        );

        expect(result.recovery).toMatchObject({
            strategy: 'fixed_delay',
            retryDelay: 1000,
            maxRetries: 2,
        });
        expect(result.userMessage).toContain('Retrying automatically');
        expect(result.userMessage).not.toMatch(/alternative provider/i);
    });

    test('does not let logging failures change recovery behavior', () => {
        errorHandler.logger.error.mockImplementation(() => {
            throw new Error('logger failed');
        });

        const result = errorHandler.handleError(
            providerError({ code: 'NETWORK_ERROR', retryable: true }),
            { retryCount: 0 }
        );

        expect(result).toMatchObject({
            category: ErrorCategory.NETWORK,
            shouldRetry: true,
        });
    });
});
