import {
    getTrustedTranslationProviderErrorMetadata,
    TranslationProviderError,
} from './translationProviderError.js';

describe('TranslationProviderError', () => {
    test('keeps only safe provider metadata and never retains the cause', () => {
        const secret = 'PRIVATE_RESPONSE_BODY';
        const error = new TranslationProviderError(secret, 'vertex_gemini', {
            status: 503,
            code: 'UPSTREAM_ERROR',
            retryable: true,
            response: { body: secret },
        });

        expect(error).toMatchObject({
            name: 'TranslationProviderError',
            message: 'Translation provider request failed.',
            provider: 'vertex_gemini',
            status: 503,
            code: 'UPSTREAM_ERROR',
            retryable: true,
        });
        expect(error).not.toHaveProperty('cause');
        expect(JSON.stringify(error)).not.toContain(secret);
    });

    test.each([
        [429, true],
        [500, true],
        [599, true],
        [400, false],
        [401, false],
    ])('derives retryability from HTTP %s', (status, retryable) => {
        const error = new TranslationProviderError('ignored', 'vertex_gemini', {
            status,
        });

        expect(error).toMatchObject({ status, retryable });
    });

    test('honors an explicit retry decision', () => {
        const error = new TranslationProviderError('ignored', 'vertex_gemini', {
            status: 503,
            retryable: false,
        });

        expect(error.retryable).toBe(false);
    });

    test.each([
        [{ status: 99 }, 'status'],
        [{ status: '429' }, 'status'],
        [{ code: 'PRIVATE_CODE' }, 'code'],
    ])('drops invalid metadata %#', (metadata, key) => {
        const error = new TranslationProviderError(
            'ignored',
            'vertex_gemini',
            metadata
        );

        expect(error).not.toHaveProperty(key);
    });

    test('normalizes unknown providers', () => {
        const error = new TranslationProviderError(
            'ignored',
            'private-provider',
            {}
        );

        expect(error.provider).toBe('unknown');
    });

    test('exposes an immutable metadata snapshot for provider errors only', () => {
        const error = new TranslationProviderError('ignored', 'vertex_gemini', {
            status: 429,
            code: 'RATE_LIMIT_EXCEEDED',
        });
        const metadata = getTrustedTranslationProviderErrorMetadata(error);

        expect(metadata).toEqual({
            provider: 'vertex_gemini',
            status: 429,
            code: 'RATE_LIMIT_EXCEEDED',
            retryable: true,
        });
        expect(Object.isFrozen(error)).toBe(true);
        expect(Object.isFrozen(metadata)).toBe(true);
        expect(getTrustedTranslationProviderErrorMetadata(new Error())).toBe(
            null
        );
    });
});
