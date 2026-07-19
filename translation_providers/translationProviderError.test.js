import { describe, expect, it } from '@jest/globals';
import {
    getTrustedTranslationProviderErrorMetadata,
    TranslationProviderError,
} from './translationProviderError.js';

describe('TranslationProviderError trusted metadata', () => {
    it('snapshots a safe own HTTP status without retaining the metadata object', () => {
        const error = new TranslationProviderError(
            'Provider request failed.',
            'vertex_gemini',
            { status: 401 }
        );

        expect(error).toMatchObject({
            name: 'TranslationProviderError',
            provider: 'vertex_gemini',
            status: 401,
            retryable: false,
        });
        expect(Object.hasOwn(error, 'cause')).toBe(false);

        const trusted = getTrustedTranslationProviderErrorMetadata(error);
        expect(trusted).toEqual({
            provider: 'vertex_gemini',
            status: 401,
            retryable: false,
        });
        expect(Object.isFrozen(trusted)).toBe(true);
    });

    it.each([
        [403, false],
        [429, true],
        [456, false],
        [500, true],
        [599, true],
    ])('derives HTTP status %s as retryable=%s', (status, retryable) => {
        const error = new TranslationProviderError(
            'Provider request failed.',
            'vertex_gemini',
            { status }
        );

        expect(getTrustedTranslationProviderErrorMetadata(error)).toEqual({
            provider: 'vertex_gemini',
            status,
            retryable,
        });
    });

    it.each([
        [503, false, 'UPSTREAM_ERROR'],
        [401, true, 'AUTHENTICATION_ERROR'],
    ])(
        'honors explicit retryable metadata for status %s',
        (status, retryable, code) => {
            const error = new TranslationProviderError(
                'Provider request failed.',
                'vertex_gemini',
                { status, retryable, code }
            );

            expect(error).toMatchObject({ status, retryable, code });
            expect(getTrustedTranslationProviderErrorMetadata(error)).toEqual({
                provider: 'vertex_gemini',
                status,
                code,
                retryable,
            });
        }
    );

    it.each([
        [{ statusCode: 429 }, 429, true],
        [{ response: { status: 503 } }, 503, true],
        [
            { status: 401, statusCode: 429, response: { status: 503 } },
            401,
            false,
        ],
    ])(
        'reads status from allowlisted own metadata',
        (metadata, status, retryable) => {
            const error = new TranslationProviderError(
                'Provider request failed.',
                'vertex_gemini',
                metadata
            );

            expect(getTrustedTranslationProviderErrorMetadata(error)).toEqual({
                provider: 'vertex_gemini',
                status,
                retryable,
            });
        }
    );

    it('treats native and proxied TypeErrors as unknown without unsafe reads', () => {
        let privateDetailReads = 0;
        const networkCause = new TypeError('PRIVATE_NETWORK_DETAIL');
        for (const key of ['message', 'stack', Symbol.toStringTag]) {
            Object.defineProperty(networkCause, key, {
                configurable: true,
                get() {
                    privateDetailReads++;
                    throw new Error('PRIVATE_NETWORK_ACCESSOR');
                },
            });
        }
        let proxyPropertyReads = 0;
        const proxiedCause = new Proxy(
            new TypeError('PRIVATE_PROXIED_NETWORK_DETAIL'),
            {
                get() {
                    proxyPropertyReads++;
                    throw new Error('PRIVATE_PROXY_PROPERTY_READ');
                },
            }
        );
        const networkError = new TranslationProviderError(
            'Provider request failed.',
            'vertex_gemini',
            networkCause
        );
        const ordinaryError = new TranslationProviderError(
            'Provider request failed.',
            'vertex_gemini',
            new Error('offline')
        );
        const proxiedError = new TranslationProviderError(
            'Provider request failed.',
            'vertex_gemini',
            proxiedCause
        );

        expect(
            getTrustedTranslationProviderErrorMetadata(networkError)
        ).toEqual({
            provider: 'vertex_gemini',
            retryable: false,
        });
        expect(
            getTrustedTranslationProviderErrorMetadata(ordinaryError)
        ).toEqual({
            provider: 'vertex_gemini',
            retryable: false,
        });
        expect(
            getTrustedTranslationProviderErrorMetadata(proxiedError)
        ).toEqual({
            provider: 'vertex_gemini',
            retryable: false,
        });
        expect(networkError.message).toBe('Provider request failed.');
        expect(JSON.stringify(networkError)).not.toContain(
            'PRIVATE_NETWORK_DETAIL'
        );
        expect(privateDetailReads).toBe(0);
        expect(proxyPropertyReads).toBe(0);
    });

    it('ignores inherited and accessor metadata without invoking getters', () => {
        let getterReads = 0;
        const metadata = Object.create({
            status: 429,
            retryable: true,
            code: 'PRIVATE_INHERITED_CODE',
        });
        for (const key of ['statusCode', 'response', 'retryable', 'code']) {
            Object.defineProperty(metadata, key, {
                configurable: true,
                get() {
                    getterReads++;
                    throw new Error('PRIVATE_ACCESSOR_VALUE');
                },
            });
        }

        const error = new TranslationProviderError(
            'Provider request failed.',
            'vertex_gemini',
            metadata
        );

        expect(getterReads).toBe(0);
        expect(getTrustedTranslationProviderErrorMetadata(error)).toEqual({
            provider: 'vertex_gemini',
            retryable: false,
        });
    });

    it('fails closed for throwing, revoked, proxied, and forged network metadata', () => {
        const throwingProxy = new Proxy(
            {},
            {
                getOwnPropertyDescriptor() {
                    throw new Error('PRIVATE_PROXY_TRAP');
                },
                getPrototypeOf() {
                    throw new Error('PRIVATE_PROXY_PROTOTYPE');
                },
            }
        );
        const revocable = Proxy.revocable(new TypeError('PRIVATE_REVOKED'), {});
        revocable.revoke();
        const transparentProxy = new Proxy(
            new TypeError('PRIVATE_PROXIED_TYPE_ERROR'),
            {}
        );
        const forgedTypeError = Object.create(TypeError.prototype);

        for (const metadata of [
            throwingProxy,
            revocable.proxy,
            transparentProxy,
            forgedTypeError,
        ]) {
            const error = new TranslationProviderError(
                'Provider request failed.',
                'vertex_gemini',
                metadata
            );

            expect(getTrustedTranslationProviderErrorMetadata(error)).toEqual({
                provider: 'vertex_gemini',
                retryable: false,
            });
            expect(JSON.stringify(error)).not.toContain('PRIVATE_');
        }
    });

    it('discards all metadata after any descriptor trap throws', () => {
        const metadata = new Proxy(
            { retryable: true, code: 'PRIVATE_PROXY_CODE' },
            {
                getOwnPropertyDescriptor(target, key) {
                    if (key === 'status') {
                        throw new Error('PRIVATE_STATUS_TRAP');
                    }
                    return Reflect.getOwnPropertyDescriptor(target, key);
                },
            }
        );

        const error = new TranslationProviderError(
            'Provider request failed.',
            'vertex_gemini',
            metadata
        );

        expect(getTrustedTranslationProviderErrorMetadata(error)).toEqual({
            provider: 'vertex_gemini',
            retryable: false,
        });
        expect(Object.hasOwn(error, 'code')).toBe(false);
        expect(JSON.stringify(error)).not.toContain('PRIVATE_');
    });

    it('returns fresh immutable views only for the branded error identity', () => {
        const error = new TranslationProviderError(
            'Provider request failed.',
            'vertex_gemini',
            { status: 429, code: 'RATE_LIMIT_EXCEEDED' }
        );
        const expected = {
            provider: 'vertex_gemini',
            status: 429,
            code: 'RATE_LIMIT_EXCEEDED',
            retryable: true,
        };

        const firstView = getTrustedTranslationProviderErrorMetadata(error);
        const secondView = getTrustedTranslationProviderErrorMetadata(error);
        expect(firstView).toEqual(expected);
        expect(secondView).toEqual(expected);
        expect(firstView).not.toBe(secondView);
        expect(Object.isFrozen(firstView)).toBe(true);
        expect(Reflect.set(firstView, 'status', 200)).toBe(false);

        error.provider = 'mutated_provider';
        error.status = 200;
        error.code = 'MUTATED_CODE';
        error.retryable = false;
        expect(getTrustedTranslationProviderErrorMetadata(error)).toEqual(
            expected
        );

        const transparentProxy = new Proxy(error, {});
        const revoked = Proxy.revocable(error, {});
        revoked.revoke();
        const forged = Object.assign(
            Object.create(TranslationProviderError.prototype),
            error
        );
        const clone = structuredClone(error);

        for (const untrustedIdentity of [
            transparentProxy,
            revoked.proxy,
            forged,
            clone,
        ]) {
            expect(
                getTrustedTranslationProviderErrorMetadata(untrustedIdentity)
            ).toBeNull();
        }
    });

    it.each([
        99,
        600,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        429.5,
        Number.MAX_SAFE_INTEGER + 1,
        '429',
    ])('rejects unsafe HTTP status metadata: %s', (status) => {
        const error = new TranslationProviderError(
            'Provider request failed.',
            'vertex_gemini',
            { status }
        );

        expect(getTrustedTranslationProviderErrorMetadata(error)).toEqual({
            provider: 'vertex_gemini',
            retryable: false,
        });
        expect(Object.hasOwn(error, 'status')).toBe(false);
    });

    it('drops oversized provider and code strings instead of retaining them', () => {
        const privateProvider = `PRIVATE_PROVIDER_${'p'.repeat(1_000)}`;
        const privateCode = `PRIVATE_CODE_${'c'.repeat(1_000)}`;
        const error = new TranslationProviderError(
            'Provider request failed.',
            privateProvider,
            { code: privateCode }
        );

        expect(getTrustedTranslationProviderErrorMetadata(error)).toEqual({
            provider: 'unknown',
            retryable: false,
        });
        expect(Object.hasOwn(error, 'code')).toBe(false);
        expect(JSON.stringify(error)).not.toContain('PRIVATE_');
    });

    it('reads only allowlisted descriptors and retains no raw error details', () => {
        const metadata = new Error('PRIVATE_CAUSE_MESSAGE');
        metadata.stack = 'PRIVATE_CAUSE_STACK';
        metadata.status = 429;
        metadata.code = 'RATE_LIMIT_EXCEEDED';
        metadata.response = {
            body: 'PRIVATE_RESPONSE_BODY',
            headers: { authorization: 'PRIVATE_HEADER_TOKEN' },
        };
        Object.defineProperties(metadata, {
            body: {
                get() {
                    throw new Error('PRIVATE_BODY_GETTER');
                },
            },
            headers: {
                get() {
                    throw new Error('PRIVATE_HEADERS_GETTER');
                },
            },
        });
        const inspectedKeys = [];
        const metadataProxy = new Proxy(metadata, {
            getOwnPropertyDescriptor(target, key) {
                inspectedKeys.push(key);
                return Reflect.getOwnPropertyDescriptor(target, key);
            },
        });

        const error = new TranslationProviderError(
            'Provider request failed.',
            'vertex_gemini',
            metadataProxy
        );

        expect(inspectedKeys).toEqual(['status', 'code', 'retryable']);
        expect(Reflect.ownKeys(error)).not.toEqual(
            expect.arrayContaining([
                'cause',
                'response',
                'body',
                'headers',
                'token',
            ])
        );
        const exposed = JSON.stringify({
            error,
            ownKeys: Reflect.ownKeys(error),
            message: error.message,
            stack: error.stack,
            trusted: getTrustedTranslationProviderErrorMetadata(error),
        });
        for (const privateValue of [
            'PRIVATE_CAUSE_MESSAGE',
            'PRIVATE_CAUSE_STACK',
            'PRIVATE_RESPONSE_BODY',
            'PRIVATE_HEADER_TOKEN',
            'PRIVATE_BODY_GETTER',
            'PRIVATE_HEADERS_GETTER',
        ]) {
            expect(exposed).not.toContain(privateValue);
        }
    });

    it('reads only status from an own nested response object', () => {
        const inspectedNestedKeys = [];
        const response = new Proxy(
            {
                status: 503,
                body: 'PRIVATE_NESTED_BODY',
                headers: { authorization: 'PRIVATE_NESTED_HEADER' },
            },
            {
                getOwnPropertyDescriptor(target, key) {
                    inspectedNestedKeys.push(key);
                    return Reflect.getOwnPropertyDescriptor(target, key);
                },
            }
        );
        const error = new TranslationProviderError(
            'Provider request failed.',
            'vertex_gemini',
            { response }
        );

        expect(inspectedNestedKeys).toEqual(['status']);
        expect(getTrustedTranslationProviderErrorMetadata(error)).toEqual({
            provider: 'vertex_gemini',
            status: 503,
            retryable: true,
        });
        expect(JSON.stringify(error)).not.toContain('PRIVATE_NESTED');
    });

    it('ignores inherited and accessor status on a nested response', () => {
        let getterReads = 0;
        const inheritedResponse = Object.create({ status: 503 });
        const accessorResponse = {};
        Object.defineProperty(accessorResponse, 'status', {
            get() {
                getterReads++;
                throw new Error('PRIVATE_NESTED_STATUS');
            },
        });

        for (const response of [inheritedResponse, accessorResponse]) {
            const error = new TranslationProviderError(
                'Provider request failed.',
                'vertex_gemini',
                { response }
            );
            expect(getTrustedTranslationProviderErrorMetadata(error)).toEqual({
                provider: 'vertex_gemini',
                retryable: false,
            });
        }
        expect(getterReads).toBe(0);
    });

    it('ignores non-boolean retry overrides and non-string codes', () => {
        const error = new TranslationProviderError(
            'Provider request failed.',
            'vertex_gemini',
            { status: 503, retryable: 'false', code: 503 }
        );

        expect(getTrustedTranslationProviderErrorMetadata(error)).toEqual({
            provider: 'vertex_gemini',
            status: 503,
            retryable: true,
        });
        expect(Object.hasOwn(error, 'code')).toBe(false);
    });

    it.each([
        'PRIVATE_SECRET',
        'PRIVATE_short_secret',
        'lowercase',
        'AUTH-TOKEN',
        'AUTH\nTOKEN',
        '_LEADING_UNDERSCORE',
        'ÜNICODE_CODE',
    ])('rejects non-machine error code %s', (code) => {
        const error = new TranslationProviderError(
            'Provider request failed.',
            'vertex_gemini',
            { code }
        );

        expect(getTrustedTranslationProviderErrorMetadata(error)).toEqual({
            provider: 'vertex_gemini',
            retryable: false,
        });
        expect(Object.hasOwn(error, 'code')).toBe(false);
        expect(JSON.stringify(error)).not.toContain(code);
    });

    it.each([
        'private_provider',
        'PrivateProvider',
        'vertex-gemini',
        'vertex\nprovider',
        '_leading_provider',
        'vértéx',
    ])('rejects non-machine provider identifier %s', (provider) => {
        const error = new TranslationProviderError(
            'Provider request failed.',
            provider,
            null
        );

        expect(getTrustedTranslationProviderErrorMetadata(error)).toEqual({
            provider: 'unknown',
            retryable: false,
        });
        expect(error.provider).toBe('unknown');
        expect(JSON.stringify(error)).not.toContain(provider);
    });

    it('creates own public data fields without invoking subclass accessors', () => {
        let accessorCalls = 0;
        class ProviderErrorSubclass extends TranslationProviderError {}
        for (const key of ['name', 'provider', 'status', 'code', 'retryable']) {
            Object.defineProperty(ProviderErrorSubclass.prototype, key, {
                configurable: true,
                get() {
                    accessorCalls++;
                    return 'PRIVATE_SUBCLASS_GETTER';
                },
                set() {
                    accessorCalls++;
                },
            });
        }

        const error = new ProviderErrorSubclass(
            'Provider request failed.',
            'vertex_gemini',
            { status: 429, code: 'RATE_LIMIT_EXCEEDED' }
        );

        expect(accessorCalls).toBe(0);
        expect(getTrustedTranslationProviderErrorMetadata(error)).toEqual({
            provider: 'vertex_gemini',
            status: 429,
            code: 'RATE_LIMIT_EXCEEDED',
            retryable: true,
        });
        for (const key of ['name', 'provider', 'status', 'code', 'retryable']) {
            expect(Object.hasOwn(error, key)).toBe(true);
        }
    });
});
