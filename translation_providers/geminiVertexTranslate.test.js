import { jest } from '@jest/globals';
import { configService } from '../services/configService.js';
import {
    ErrorCategory,
    errorHandler,
} from '../background/utils/errorHandler.js';
import { translate } from './geminiVertexTranslate.js';
import {
    getTrustedTranslationProviderErrorMetadata,
    TranslationProviderError,
} from './translationProviderError.js';

const REQUIRED_CONFIG_KEYS = Object.freeze([
    'vertexAccessToken',
    'vertexProjectId',
    'vertexLocation',
    'vertexModel',
]);
const VALID_CONFIG_VALUES = Object.freeze({
    vertexAccessToken: 'short-lived-token',
    vertexProjectId: 'project-id',
    vertexLocation: 'us-central1',
    vertexModel: 'gemini-2.5-flash',
});
const TRANSLATION_OPERATIONS = Object.freeze([
    ['single', () => translate('Hello', 'en', 'es')],
]);
const HTTP_STATUS_CASES = Object.freeze([
    [400, 'REQUEST_FAILED', false],
    [401, 'AUTHENTICATION_ERROR', false],
    [403, 'AUTHENTICATION_ERROR', false],
    [418, 'REQUEST_FAILED', false],
    [429, 'RATE_LIMIT_EXCEEDED', true],
    [499, 'REQUEST_FAILED', false],
    [500, 'UPSTREAM_ERROR', true],
    [599, 'UPSTREAM_ERROR', true],
]);

function loggedOutput() {
    return ['debug', 'info', 'warn', 'error']
        .flatMap((level) => console[level].mock.calls.flat())
        .join('\n');
}

async function captureError(operation) {
    try {
        await operation();
    } catch (error) {
        return error;
    }
    throw new Error('Expected operation to reject.');
}

function expectTrustedProviderError(error, metadata) {
    expect(getTrustedTranslationProviderErrorMetadata(error)).toEqual({
        provider: 'vertex_gemini',
        ...metadata,
    });
    expect(Object.hasOwn(error, 'cause')).toBe(false);
}

function createSuccessfulResponse(text) {
    return {
        ok: true,
        json: jest.fn().mockResolvedValue({
            candidates: [{ content: { parts: [{ text }] } }],
        }),
    };
}

describe('geminiVertexTranslate error contract', () => {
    let configSpy;

    beforeEach(() => {
        configSpy = jest
            .spyOn(configService, 'readMultipleResultStrict')
            .mockResolvedValue({
                values: { ...VALID_CONFIG_VALUES },
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

    it('reads the exact authoritative config projection with sensitive access', async () => {
        const values = Object.assign(Object.create(null), VALID_CONFIG_VALUES);
        const sources = Object.create(null);
        for (const key of REQUIRED_CONFIG_KEYS) {
            sources[key] = {
                scope: key === 'vertexAccessToken' ? 'local' : 'sync',
                source: 'stored',
            };
        }
        configSpy.mockResolvedValue({
            ok: true,
            values,
            sources,
            displayFallbacks: Object.create(null),
            areas: {
                sync: { status: 'ok' },
                local: { status: 'ok' },
            },
            degraded: false,
            failedAreas: [],
            unknownKeys: [],
            excludedSensitiveKeys: [],
        });
        global.fetch = jest
            .fn()
            .mockResolvedValue(createSuccessfulResponse('Hola'));

        await expect(translate('Hello', 'en', 'es')).resolves.toBe('Hola');

        expect(configSpy).toHaveBeenCalledTimes(1);
        expect(configSpy).toHaveBeenCalledWith(REQUIRED_CONFIG_KEYS, {
            includeSensitive: true,
        });
        expect(global.fetch).toHaveBeenCalledTimes(1);
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

            const providerError = await captureError(() =>
                translate('Hello', 'en', 'es')
            );

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

            const providerError = await captureError(() =>
                translate('Hello', 'en', 'es')
            );

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

        const providerError = await captureError(() =>
            translate('Hello', 'en', 'es')
        );

        expect(providerError).toMatchObject({ retryable: true });
        expect(
            errorHandler.handleError(providerError, { retryCount: 0 })
        ).toMatchObject({
            category: ErrorCategory.NETWORK,
            shouldRetry: true,
        });
    });

    it('maps an arbitrary fetch rejection to trusted network metadata without inspecting it', async () => {
        const privateMarker = 'PRIVATE_FETCH_REJECTION';
        let privateReads = 0;
        const rejection = {};
        for (const key of ['name', 'message', 'stack', Symbol.toStringTag]) {
            Object.defineProperty(rejection, key, {
                configurable: true,
                get() {
                    privateReads++;
                    throw new Error(privateMarker);
                },
            });
        }
        global.fetch = jest.fn().mockRejectedValue(rejection);

        const providerError = await captureError(() =>
            translate('Hello', 'en', 'es')
        );

        expectTrustedProviderError(providerError, {
            code: 'NETWORK_ERROR',
            retryable: true,
        });
        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(privateReads).toBe(0);
        expect(JSON.stringify(providerError)).not.toContain(privateMarker);
        expect(loggedOutput()).not.toContain(privateMarker);
    });

    it('maps a rejected config read to trusted authentication metadata', async () => {
        const privateMarker = 'PRIVATE_CONFIG_REJECTION';
        let privateReads = 0;
        const rejection = {};
        for (const key of ['name', 'message', 'stack', Symbol.toStringTag]) {
            Object.defineProperty(rejection, key, {
                configurable: true,
                get() {
                    privateReads++;
                    throw new Error(privateMarker);
                },
            });
        }
        configSpy.mockRejectedValue(rejection);
        global.fetch = jest.fn();

        const providerError = await captureError(() =>
            translate('Hello', 'en', 'es')
        );

        expectTrustedProviderError(providerError, {
            code: 'AUTHENTICATION_ERROR',
            retryable: false,
        });
        expect(global.fetch).not.toHaveBeenCalled();
        expect(privateReads).toBe(0);
        expect(JSON.stringify(providerError)).not.toContain(privateMarker);
        expect(loggedOutput()).not.toContain(privateMarker);
    });

    it.each(REQUIRED_CONFIG_KEYS)(
        'fails closed before fetch when strict config omits %s',
        async (missingKey) => {
            const values = { ...VALID_CONFIG_VALUES };
            delete values[missingKey];
            configSpy.mockResolvedValue({ values });
            global.fetch = jest.fn();

            const providerError = await captureError(() =>
                translate('Hello', 'en', 'es')
            );
            expectTrustedProviderError(providerError, {
                code: 'AUTHENTICATION_ERROR',
                retryable: false,
            });

            expect(global.fetch).not.toHaveBeenCalled();
            expect(loggedOutput()).not.toContain(
                VALID_CONFIG_VALUES.vertexAccessToken
            );
        }
    );

    it('rejects accessor, transparent-proxy, and revoked strict config values without property reads', async () => {
        const privateMarker = 'PRIVATE_CONFIG_VALUE';
        let privateReads = 0;
        const accessorValues = { ...VALID_CONFIG_VALUES };
        Object.defineProperty(accessorValues, 'vertexAccessToken', {
            enumerable: true,
            get() {
                privateReads++;
                throw new Error(privateMarker);
            },
        });
        const transparentProxy = new Proxy(
            { ...VALID_CONFIG_VALUES },
            {
                get() {
                    privateReads++;
                    throw new Error(privateMarker);
                },
            }
        );
        const revocable = Proxy.revocable({ ...VALID_CONFIG_VALUES }, {});
        revocable.revoke();
        global.fetch = jest.fn();

        for (const values of [
            accessorValues,
            transparentProxy,
            revocable.proxy,
        ]) {
            configSpy.mockResolvedValueOnce({ values });
            const providerError = await captureError(() =>
                translate('Hello', 'en', 'es')
            );
            expectTrustedProviderError(providerError, {
                code: 'AUTHENTICATION_ERROR',
                retryable: false,
            });
        }

        expect(global.fetch).not.toHaveBeenCalled();
        expect(privateReads).toBe(0);
        expect(loggedOutput()).not.toContain(privateMarker);
        expect(loggedOutput()).not.toContain(
            VALID_CONFIG_VALUES.vertexAccessToken
        );
    });

    it('rejects a strict result values accessor without invoking it', async () => {
        let accessorReads = 0;
        const result = {};
        Object.defineProperty(result, 'values', {
            get() {
                accessorReads++;
                throw new Error('PRIVATE_RESULT_VALUES');
            },
        });
        configSpy.mockResolvedValue(result);
        global.fetch = jest.fn();

        const providerError = await captureError(() =>
            translate('Hello', 'en', 'es')
        );

        expectTrustedProviderError(providerError, {
            code: 'AUTHENTICATION_ERROR',
            retryable: false,
        });
        expect(accessorReads).toBe(0);
        expect(global.fetch).not.toHaveBeenCalled();
        expect(loggedOutput()).not.toContain('PRIVATE_RESULT_VALUES');
    });

    it('ignores hostile large, cyclic, and accessor-bearing strict-result metadata', async () => {
        const privateMarker = 'PRIVATE_UNRELATED_CONFIG_METADATA';
        let accessorReads = 0;
        let proxyTrapReads = 0;
        const cycle = {};
        cycle.self = cycle;
        const unrelated = {
            large: Array.from({ length: 4096 }, (_, index) => ({ index })),
            cycle,
        };
        Object.defineProperty(unrelated, 'privateValue', {
            configurable: true,
            enumerable: true,
            get() {
                accessorReads++;
                return privateMarker;
            },
        });
        const hostileProxy = new Proxy(
            {},
            {
                getPrototypeOf() {
                    proxyTrapReads++;
                    throw new Error(privateMarker);
                },
                ownKeys() {
                    proxyTrapReads++;
                    throw new Error(privateMarker);
                },
                getOwnPropertyDescriptor() {
                    proxyTrapReads++;
                    throw new Error(privateMarker);
                },
                get() {
                    proxyTrapReads++;
                    throw new Error(privateMarker);
                },
            }
        );
        configSpy.mockResolvedValue({
            values: { ...VALID_CONFIG_VALUES },
            unrelated,
            hostileProxy,
        });
        global.fetch = jest
            .fn()
            .mockResolvedValue(createSuccessfulResponse('Hola'));

        await expect(translate('Hello', 'en', 'es')).resolves.toBe('Hola');

        expect(accessorReads).toBe(0);
        expect(proxyTrapReads).toBe(0);
        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(loggedOutput()).not.toContain(privateMarker);
    });

    it.each(REQUIRED_CONFIG_KEYS)(
        'rejects non-string strict config value %s',
        async (invalidKey) => {
            configSpy.mockResolvedValue({
                values: {
                    ...VALID_CONFIG_VALUES,
                    [invalidKey]: { privateValue: 'PRIVATE_CONFIG_OBJECT' },
                },
            });
            global.fetch = jest.fn();

            const providerError = await captureError(() =>
                translate('Hello', 'en', 'es')
            );

            expectTrustedProviderError(providerError, {
                code: 'AUTHENTICATION_ERROR',
                retryable: false,
            });
            expect(global.fetch).not.toHaveBeenCalled();
            expect(loggedOutput()).not.toContain('PRIVATE_CONFIG_OBJECT');
        }
    );

    it.each(REQUIRED_CONFIG_KEYS)(
        'rejects whitespace-only strict config value %s without fetch or log leakage',
        async (invalidKey) => {
            const values = {
                ...VALID_CONFIG_VALUES,
                vertexAccessToken: 'PRIVATE_CONFIG_TOKEN',
                vertexProjectId: 'PRIVATE_CONFIG_PROJECT',
                [invalidKey]: '   \n\t   ',
            };
            configSpy.mockResolvedValue({ values });
            global.fetch = jest.fn();

            const providerError = await captureError(() =>
                translate('Hello', 'en', 'es')
            );

            expectTrustedProviderError(providerError, {
                code: 'AUTHENTICATION_ERROR',
                retryable: false,
            });
            expect(global.fetch).not.toHaveBeenCalled();
            expect(loggedOutput()).not.toContain('PRIVATE_CONFIG');
        }
    );

    it('uses copied config primitives when the public strict result mutates before fetch', async () => {
        const values = { ...VALID_CONFIG_VALUES };
        configSpy.mockResolvedValue({ values });
        global.fetch = jest.fn((url, init) => {
            values.vertexAccessToken = 'PRIVATE_MUTATED_TOKEN';
            values.vertexProjectId = 'PRIVATE_MUTATED_PROJECT';
            expect(url).toContain('/projects/project-id/');
            expect(init.headers.Authorization).toBe('Bearer short-lived-token');
            expect(url).not.toContain('PRIVATE_MUTATED');
            expect(init.headers.Authorization).not.toContain('PRIVATE_MUTATED');
            expect(init.body).not.toContain('PRIVATE_MUTATED');
            return Promise.resolve(createSuccessfulResponse('Hola'));
        });

        await expect(translate('Hello', 'en', 'es')).resolves.toBe('Hola');

        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(loggedOutput()).not.toContain('PRIVATE_MUTATED');
    });

    it('normalizes a proxied branded request-serialization failure as non-retryable', async () => {
        const injected = new TranslationProviderError(
            'Injected request classification.',
            'vertex_gemini',
            { code: 'NETWORK_ERROR', retryable: true }
        );
        const proxied = new Proxy(injected, {});
        const originalStringify = JSON.stringify;
        const stringifySpy = jest
            .spyOn(JSON, 'stringify')
            .mockImplementation((value, ...args) => {
                if (
                    value !== null &&
                    typeof value === 'object' &&
                    Object.hasOwn(value, 'contents') &&
                    Object.hasOwn(value, 'generationConfig')
                ) {
                    throw proxied;
                }
                return originalStringify(value, ...args);
            });
        global.fetch = jest.fn();

        let providerError;
        try {
            await translate('Hello', 'en', 'es');
        } catch (error) {
            providerError = error;
        } finally {
            stringifySpy.mockRestore();
        }

        expectTrustedProviderError(providerError, {
            code: 'REQUEST_FAILED',
            retryable: false,
        });
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it.each([['single', () => translate('Hello', 'en', 'es')]])(
        'authoritatively remaps a branded %s JSON rejection as a request failure',
        async (_name, translation) => {
            const injected = new TranslationProviderError(
                'Injected response classification.',
                'vertex_gemini',
                { code: 'NETWORK_ERROR', retryable: true }
            );
            global.fetch = jest.fn().mockResolvedValue({
                ok: true,
                json: jest.fn().mockRejectedValue(injected),
            });

            const providerError = await captureError(translation);

            expectTrustedProviderError(providerError, {
                code: 'REQUEST_FAILED',
                retryable: false,
            });
            expect(global.fetch).toHaveBeenCalledTimes(1);
        }
    );

    it('normalizes a cloned provider error from response decoding', async () => {
        const clone = structuredClone(
            new TranslationProviderError(
                'Injected cloned classification.',
                'vertex_gemini',
                { code: 'NETWORK_ERROR', retryable: true }
            )
        );
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: jest.fn().mockRejectedValue(clone),
        });

        const providerError = await captureError(() =>
            translate('Hello', 'en', 'es')
        );

        expectTrustedProviderError(providerError, {
            code: 'REQUEST_FAILED',
            retryable: false,
        });
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['single', 'ok', () => translate('Hello', 'en', 'es')],
        ['single', 'status', () => translate('Hello', 'en', 'es')],
    ])(
        'normalizes a branded %s response.%s failure as a request failure',
        async (_name, property, translation) => {
            const injected = new TranslationProviderError(
                'Injected response descriptor classification.',
                'vertex_gemini',
                { code: 'NETWORK_ERROR', retryable: true }
            );
            const response = {};
            Object.defineProperty(response, 'ok', {
                configurable: true,
                enumerable: true,
                ...(property === 'ok'
                    ? {
                          get() {
                              throw injected;
                          },
                      }
                    : { value: false }),
            });
            Object.defineProperty(response, 'status', {
                configurable: true,
                enumerable: true,
                ...(property === 'status'
                    ? {
                          get() {
                              throw injected;
                          },
                      }
                    : { value: 500 }),
            });
            global.fetch = jest.fn().mockResolvedValue(response);

            const providerError = await captureError(translation);

            expectTrustedProviderError(providerError, {
                code: 'REQUEST_FAILED',
                retryable: false,
            });
            expect(global.fetch).toHaveBeenCalledTimes(1);
        }
    );

    it('preserves the network classification when failure logging throws', async () => {
        global.fetch = jest.fn().mockRejectedValue({});
        const consoleErrorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {
                throw new Error('PRIVATE_LOGGER_FAILURE');
            });

        let providerError;
        try {
            await translate('Hello', 'en', 'es');
        } catch (error) {
            providerError = error;
        } finally {
            consoleErrorSpy.mockRestore();
        }

        expectTrustedProviderError(providerError, {
            code: 'NETWORK_ERROR',
            retryable: true,
        });
        expect(JSON.stringify(providerError)).not.toContain(
            'PRIVATE_LOGGER_FAILURE'
        );
    });

    it('logs only the fixed failure event and safe stage context', async () => {
        const sourceText = 'PRIVATE_SOURCE_TEXT';
        const sourceLang = 'PRIVATE_SOURCE_LANGUAGE';
        const rejectionMarker = 'PRIVATE_FETCH_DETAIL';
        global.fetch = jest.fn().mockRejectedValue({
            message: rejectionMarker,
            stack: `${rejectionMarker}_STACK`,
        });

        await expect(
            translate(sourceText, sourceLang, 'es')
        ).rejects.toMatchObject({ retryable: true });

        const output = loggedOutput();
        expect(output).toContain(
            '[VertexGeminiTranslate] Vertex Gemini translation stage failed'
        );
        expect(output).toContain('"stage":"fetch"');
        expect(output).not.toContain('sourceLang');
        expect(output).not.toContain('targetLang');
        for (const privateValue of [
            sourceText,
            sourceLang,
            rejectionMarker,
            VALID_CONFIG_VALUES.vertexAccessToken,
            VALID_CONFIG_VALUES.vertexProjectId,
            VALID_CONFIG_VALUES.vertexLocation,
            VALID_CONFIG_VALUES.vertexModel,
        ]) {
            expect(output).not.toContain(privateValue);
        }
    });

    it.each(
        TRANSLATION_OPERATIONS.flatMap(([operation, translation]) =>
            HTTP_STATUS_CASES.map(([status, code, retryable]) => [
                operation,
                status,
                code,
                retryable,
                translation,
            ])
        )
    )(
        'maps %s HTTP %s to exact trusted metadata without reading response details',
        async (_operation, status, code, retryable, translation) => {
            const privateMarker = `PRIVATE_HTTP_${status}`;
            let privateReads = 0;
            const response = { ok: false, status };
            for (const key of ['statusText', 'headers', 'body']) {
                Object.defineProperty(response, key, {
                    configurable: true,
                    get() {
                        privateReads++;
                        throw new Error(privateMarker);
                    },
                });
            }
            global.fetch = jest.fn().mockResolvedValue(response);

            const providerError = await captureError(translation);

            expectTrustedProviderError(providerError, {
                status,
                code,
                retryable,
            });
            expect(global.fetch).toHaveBeenCalledTimes(1);
            expect(privateReads).toBe(0);
            expect(loggedOutput()).not.toContain(privateMarker);
        }
    );

    it.each(
        TRANSLATION_OPERATIONS.flatMap(([operation, translation]) =>
            [99, 600, 429.5, Number.NaN, '429'].map((status) => [
                operation,
                status,
                translation,
            ])
        )
    )(
        'rejects unsafe %s HTTP status %s as a request failure',
        async (_operation, status, translation) => {
            global.fetch = jest.fn().mockResolvedValue({
                ok: false,
                status,
            });

            const providerError = await captureError(translation);

            expectTrustedProviderError(providerError, {
                code: 'REQUEST_FAILED',
                retryable: false,
            });
            expect(global.fetch).toHaveBeenCalledTimes(1);
            expect(Object.hasOwn(providerError, 'status')).toBe(false);
        }
    );

    it.each(
        TRANSLATION_OPERATIONS.flatMap(([operation, translation]) =>
            ['arbitrary', 'proxy', 'revoked'].map((kind) => [
                operation,
                kind,
                translation,
            ])
        )
    )(
        'maps a %s %s fetch rejection without raw inspection',
        async (_operation, kind, translation) => {
            const privateMarker = `PRIVATE_${kind.toUpperCase()}_REJECTION`;
            let privateReads = 0;
            let rejection;
            if (kind === 'arbitrary') {
                rejection = {};
                for (const key of [
                    'name',
                    'message',
                    'stack',
                    Symbol.toStringTag,
                ]) {
                    Object.defineProperty(rejection, key, {
                        configurable: true,
                        get() {
                            privateReads++;
                            throw new Error(privateMarker);
                        },
                    });
                }
            } else if (kind === 'proxy') {
                rejection = new Proxy(
                    { privateMarker },
                    {
                        get() {
                            privateReads++;
                            throw new Error(privateMarker);
                        },
                    }
                );
            } else {
                const revocable = Proxy.revocable({ privateMarker }, {});
                revocable.revoke();
                rejection = revocable.proxy;
            }
            global.fetch = jest.fn().mockRejectedValue(rejection);

            const providerError = await captureError(translation);

            expectTrustedProviderError(providerError, {
                code: 'NETWORK_ERROR',
                retryable: true,
            });
            expect(global.fetch).toHaveBeenCalledTimes(1);
            expect(privateReads).toBe(0);
            expect(JSON.stringify(providerError)).not.toContain(privateMarker);
            expect(loggedOutput()).not.toContain(privateMarker);
        }
    );

    it('preserves blank single-input short-circuiting without config or fetch', async () => {
        global.fetch = jest.fn();

        await expect(translate('   ', 'en', 'es')).resolves.toBe('');

        expect(configSpy).not.toHaveBeenCalled();
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it.each(TRANSLATION_OPERATIONS)(
        'maps an empty %s model response to a request failure',
        async (_operation, translation) => {
            global.fetch = jest.fn().mockResolvedValue({
                ok: true,
                json: jest.fn().mockResolvedValue({ candidates: [] }),
            });

            const providerError = await captureError(translation);

            expectTrustedProviderError(providerError, {
                code: 'REQUEST_FAILED',
                retryable: false,
            });
            expect(global.fetch).toHaveBeenCalledTimes(1);
        }
    );

    it.each(TRANSLATION_OPERATIONS)(
        'maps a whitespace-only %s model response to a request failure',
        async (_operation, translation) => {
            global.fetch = jest
                .fn()
                .mockResolvedValue(createSuccessfulResponse('   \n\t   '));

            const providerError = await captureError(translation);

            expectTrustedProviderError(providerError, {
                code: 'REQUEST_FAILED',
                retryable: false,
            });
            expect(global.fetch).toHaveBeenCalledTimes(1);
        }
    );

    it.each([
        ['object', { translated: 'Hola' }],
        ['number', 42],
        ['array', ['Hola']],
    ])(
        'rejects a non-string %s model response as a non-retryable request failure',
        async (_kind, responseText) => {
            global.fetch = jest
                .fn()
                .mockResolvedValue(createSuccessfulResponse(responseText));

            const providerError = await captureError(() =>
                translate('Hello', 'en', 'es')
            );

            expectTrustedProviderError(providerError, {
                code: 'REQUEST_FAILED',
                retryable: false,
            });
            expect(global.fetch).toHaveBeenCalledTimes(1);
        }
    );

    it('returns trimmed model text', async () => {
        global.fetch = jest
            .fn()
            .mockResolvedValue(createSuccessfulResponse('  Hola \n'));

        await expect(translate('Hello', 'en', 'es')).resolves.toBe('Hola');
    });
});
