import { describe, expect, it } from 'vitest';
import {
    TranslationProviderError,
    codeForHttpStatus,
    httpFailure,
} from './providerError';

describe('TranslationProviderError', () => {
    it.each([
        [401, 'AUTHENTICATION_ERROR', false],
        [403, 'AUTHENTICATION_ERROR', false],
        [429, 'RATE_LIMIT_EXCEEDED', true],
        [500, 'UPSTREAM_ERROR', true],
        [503, 'UPSTREAM_ERROR', true],
        [400, 'REQUEST_FAILED', false],
        [404, 'REQUEST_FAILED', false],
    ] as const)(
        'classifies HTTP %i as %s (retryable %s)',
        (status, code, retryable) => {
            const error = httpFailure('google', status);
            expect(codeForHttpStatus(status)).toBe(code);
            expect(error.code).toBe(code);
            expect(error.retryable).toBe(retryable);
            expect(error.status).toBe(status);
            expect(error.provider).toBe('google');
        }
    );

    it('lets an override change the class and retry stance but keeps the status', () => {
        const error = httpFailure('deepl', 456, {
            code: 'RATE_LIMIT_EXCEEDED',
            retryable: false,
        });
        expect(error.status).toBe(456);
        expect(error.code).toBe('RATE_LIMIT_EXCEEDED');
        expect(error.retryable).toBe(false);
    });

    it('derives retryability from the code unless told otherwise', () => {
        expect(
            new TranslationProviderError('google', 'x', {
                code: 'NETWORK_ERROR',
            }).retryable
        ).toBe(true);
        expect(
            new TranslationProviderError('google', 'x', {
                code: 'REQUEST_FAILED',
            }).retryable
        ).toBe(false);
        expect(
            new TranslationProviderError('google', 'x', {
                code: 'REQUEST_FAILED',
                retryable: true,
            }).retryable
        ).toBe(true);
    });

    it('drops a status outside the HTTP range', () => {
        const error = new TranslationProviderError('google', 'x', {
            code: 'REQUEST_FAILED',
            status: 999,
        });
        expect(error.status).toBeNull();
    });
});
