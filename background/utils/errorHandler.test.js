import { jest } from '@jest/globals';
import { ErrorCategory, ErrorSeverity, errorHandler } from './errorHandler.js';
import { TranslationProviderError } from '../../translation_providers/translationProviderError.js';

const FIXED_PROVIDER_MESSAGE = 'Translation provider request failed.';

function createTrustedError(metadata) {
    return new TranslationProviderError(
        'PRIVATE_PROVIDER_ERROR_MESSAGE',
        'vertex_gemini',
        metadata
    );
}

function loggedOutput() {
    return ['debug', 'info', 'warn', 'error']
        .flatMap((level) => console[level].mock.calls.flat())
        .join('\n');
}

describe('ErrorHandler recovery contract', () => {
    beforeEach(() => {
        errorHandler.clearStats();
        jest.clearAllMocks();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('describes the same-provider retry that is actually implemented', () => {
        const recovery = errorHandler.determineRecoveryStrategy({
            category: ErrorCategory.TRANSLATION,
            isRecoverable: true,
            context: { retryCount: 0 },
        });
        const message = errorHandler.generateUserMessage({
            category: ErrorCategory.TRANSLATION,
            recovery,
        });

        expect(recovery).toMatchObject({
            shouldRetry: true,
            strategy: 'fixed_delay',
            retryDelay: 1000,
        });
        expect(recovery).not.toHaveProperty('fallbackOptions');
        expect(message).toContain('Retrying automatically');
        expect(message).not.toMatch(/alternative provider/i);
    });

    it.each([
        [
            'AUTHENTICATION_ERROR',
            true,
            ErrorCategory.CONFIGURATION,
            ErrorSeverity.CRITICAL,
            false,
        ],
        [
            'RATE_LIMIT_EXCEEDED',
            true,
            ErrorCategory.RATE_LIMIT,
            ErrorSeverity.HIGH,
            true,
        ],
        [
            'UPSTREAM_ERROR',
            true,
            ErrorCategory.NETWORK,
            ErrorSeverity.HIGH,
            true,
        ],
        [
            'NETWORK_ERROR',
            true,
            ErrorCategory.NETWORK,
            ErrorSeverity.HIGH,
            true,
        ],
        [
            'REQUEST_FAILED',
            true,
            ErrorCategory.TRANSLATION,
            ErrorSeverity.MEDIUM,
            true,
        ],
    ])(
        'classifies trusted code %s without generic error traversal',
        (code, retryable, category, severity, isRecoverable) => {
            const result = errorHandler.handleError(
                createTrustedError({ code, retryable }),
                { operation: 'translate', retryCount: 0 }
            );

            expect(result).toMatchObject({
                originalError: null,
                message: FIXED_PROVIDER_MESSAGE,
                provider: 'vertex_gemini',
                category,
                severity,
                isRecoverable,
                errorCode: code,
                httpStatus: null,
                context: {
                    operation: 'translate',
                    provider: 'vertex_gemini',
                    retryCount: 0,
                },
            });
            expect(result).not.toHaveProperty('stack');
        }
    );

    it.each([
        [
            401,
            true,
            false,
            'AUTHENTICATION_ERROR',
            ErrorCategory.CONFIGURATION,
            ErrorSeverity.CRITICAL,
        ],
        [
            403,
            true,
            false,
            'AUTHENTICATION_ERROR',
            ErrorCategory.CONFIGURATION,
            ErrorSeverity.CRITICAL,
        ],
        [
            429,
            false,
            false,
            'RATE_LIMIT_EXCEEDED',
            ErrorCategory.RATE_LIMIT,
            ErrorSeverity.HIGH,
        ],
        [
            500,
            false,
            false,
            'UPSTREAM_ERROR',
            ErrorCategory.NETWORK,
            ErrorSeverity.HIGH,
        ],
        [
            599,
            true,
            true,
            'UPSTREAM_ERROR',
            ErrorCategory.NETWORK,
            ErrorSeverity.HIGH,
        ],
        [
            400,
            false,
            false,
            'REQUEST_FAILED',
            ErrorCategory.TRANSLATION,
            ErrorSeverity.MEDIUM,
        ],
    ])(
        'classifies trusted HTTP status %s deterministically',
        (status, retryable, isRecoverable, errorCode, category, severity) => {
            const result = errorHandler.handleError(
                createTrustedError({ status, retryable }),
                { retryCount: 0 }
            );

            expect(result).toMatchObject({
                originalError: null,
                category,
                severity,
                isRecoverable,
                errorCode,
                httpStatus: status,
            });
        }
    );

    it.each([
        [
            401,
            'NETWORK_ERROR',
            false,
            'AUTHENTICATION_ERROR',
            ErrorCategory.CONFIGURATION,
            ErrorSeverity.CRITICAL,
        ],
        [
            429,
            'AUTHENTICATION_ERROR',
            false,
            'RATE_LIMIT_EXCEEDED',
            ErrorCategory.RATE_LIMIT,
            ErrorSeverity.HIGH,
        ],
        [
            503,
            'AUTHENTICATION_ERROR',
            false,
            'UPSTREAM_ERROR',
            ErrorCategory.NETWORK,
            ErrorSeverity.HIGH,
        ],
        [
            400,
            'NETWORK_ERROR',
            true,
            'NETWORK_ERROR',
            ErrorCategory.NETWORK,
            ErrorSeverity.HIGH,
        ],
    ])(
        'resolves status %s and conflicting trusted code %s consistently',
        (status, code, isRecoverable, errorCode, category, severity) => {
            const result = errorHandler.handleError(
                createTrustedError({
                    status,
                    code,
                    retryable: isRecoverable,
                }),
                { retryCount: 0 }
            );

            expect(result).toMatchObject({
                originalError: null,
                category,
                severity,
                isRecoverable,
                errorCode,
                httpStatus: status,
            });
        }
    );

    it('maps a trusted error without a code to retryable translation failure', () => {
        const result = errorHandler.handleError(
            createTrustedError({ retryable: true }),
            { retryCount: 0 }
        );

        expect(result).toMatchObject({
            category: ErrorCategory.TRANSLATION,
            severity: ErrorSeverity.MEDIUM,
            isRecoverable: true,
            errorCode: 'REQUEST_FAILED',
            shouldRetry: true,
        });
    });

    it.each([
        [
            'AUTHENTICATION_ERROR',
            { hasUserImpact: true },
            ErrorSeverity.CRITICAL,
        ],
        ['REQUEST_FAILED', { isCriticalPath: true }, ErrorSeverity.CRITICAL],
    ])(
        'applies context severity monotonically for trusted code %s',
        (code, context, severity) => {
            const result = errorHandler.handleError(
                createTrustedError({ code, retryable: false }),
                { ...context, retryCount: 0 }
            );

            expect(result.severity).toBe(severity);
        }
    );

    it.each([
        ['NETWORK_ERROR', true, 2, true],
        ['NETWORK_ERROR', false, 0, false],
        ['RATE_LIMIT_EXCEEDED', true, 1, false],
        ['REQUEST_FAILED', true, 2, false],
    ])(
        'applies category recovery for %s retryable=%s at retry %s',
        (code, retryable, retryCount, shouldRetry) => {
            const result = errorHandler.handleError(
                createTrustedError({ code, retryable }),
                { retryCount }
            );

            expect(result.shouldRetry).toBe(shouldRetry);
            expect(result.recovery.shouldRetry).toBe(shouldRetry);
        }
    );

    it('never reads or retains mutable public fields from an exact trusted error', () => {
        const privateMarker = 'PRIVATE_MUTATED_PROVIDER_FIELD';
        let publicReads = 0;
        const providerError = createTrustedError({
            status: 503,
            code: 'UPSTREAM_ERROR',
            retryable: true,
        });
        for (const key of [
            'name',
            'message',
            'stack',
            'cause',
            'provider',
            'status',
            'statusCode',
            'response',
            'code',
            'retryable',
            'shouldRetry',
            Symbol.toStringTag,
        ]) {
            Object.defineProperty(providerError, key, {
                configurable: true,
                get() {
                    publicReads++;
                    throw new Error(privateMarker);
                },
            });
        }

        const result = errorHandler.handleError(providerError, {
            operation: 'translate',
            retryCount: 0,
        });
        const stats = errorHandler.getErrorStats();

        expect(result).toMatchObject({
            originalError: null,
            message: FIXED_PROVIDER_MESSAGE,
            provider: 'vertex_gemini',
            category: ErrorCategory.NETWORK,
            severity: ErrorSeverity.HIGH,
            errorCode: 'UPSTREAM_ERROR',
            httpStatus: 503,
            isRecoverable: true,
        });
        expect(result).not.toHaveProperty('stack');
        expect(publicReads).toBe(0);
        expect(JSON.stringify(result)).not.toContain(privateMarker);
        expect(JSON.stringify(stats)).not.toContain(privateMarker);
        expect(loggedOutput()).not.toContain(privateMarker);
    });

    it('fails closed when hostile context descriptors cannot be read', () => {
        const privateMarker = 'PRIVATE_CONTEXT_DESCRIPTOR';
        const descriptorKeys = [];
        let getterReads = 0;
        let proxyGetReads = 0;
        const contextTarget = {};
        for (const key of [
            'operation',
            'textLength',
            'retryCount',
            'hasUserImpact',
            'isCriticalPath',
            'sourceLang',
            'targetLang',
        ]) {
            Object.defineProperty(contextTarget, key, {
                configurable: true,
                get() {
                    getterReads++;
                    throw new Error(privateMarker);
                },
            });
        }
        const context = new Proxy(contextTarget, {
            get() {
                proxyGetReads++;
                throw new Error(privateMarker);
            },
            getOwnPropertyDescriptor(_target, key) {
                descriptorKeys.push(key);
                throw new Error(privateMarker);
            },
        });

        const result = errorHandler.handleError(
            createTrustedError({ code: 'REQUEST_FAILED', retryable: false }),
            context
        );

        expect(descriptorKeys).toEqual([
            'operation',
            'textLength',
            'retryCount',
            'hasUserImpact',
            'isCriticalPath',
        ]);
        expect(result.context).toEqual({ provider: 'vertex_gemini' });
        expect(Object.isFrozen(result.context)).toBe(true);
        expect(getterReads).toBe(0);
        expect(proxyGetReads).toBe(0);
        expect(JSON.stringify(result)).not.toContain(privateMarker);
        expect(JSON.stringify(errorHandler.getErrorStats())).not.toContain(
            privateMarker
        );
        expect(loggedOutput()).not.toContain(privateMarker);
    });

    it('copies only descriptor-safe allowlisted context with trusted provider ownership', () => {
        const privateMarker = 'PRIVATE_HOSTILE_CONTEXT';
        let privateReads = 0;
        let proxyTrapReads = 0;
        const contextTarget = {
            operation: 'translate',
            textLength: 42,
            retryCount: 999,
            hasUserImpact: true,
            isCriticalPath: false,
        };
        for (const key of [
            'provider',
            'sourceLang',
            'targetLang',
            'unknownSecret',
        ]) {
            Object.defineProperty(contextTarget, key, {
                configurable: true,
                enumerable: true,
                get() {
                    privateReads++;
                    throw new Error(privateMarker);
                },
            });
        }
        const context = new Proxy(contextTarget, {
            get() {
                proxyTrapReads++;
                throw new Error(privateMarker);
            },
            ownKeys() {
                proxyTrapReads++;
                throw new Error(privateMarker);
            },
            getPrototypeOf() {
                proxyTrapReads++;
                throw new Error(privateMarker);
            },
        });

        const result = errorHandler.handleError(
            createTrustedError({ code: 'REQUEST_FAILED', retryable: false }),
            context
        );

        expect(result.context).toEqual({
            provider: 'vertex_gemini',
            operation: 'translate',
            textLength: 42,
            retryCount: 2,
            hasUserImpact: true,
            isCriticalPath: false,
        });
        expect(result.severity).toBe(ErrorSeverity.HIGH);
        expect(Object.isFrozen(result.context)).toBe(true);
        expect(privateReads).toBe(0);
        expect(proxyTrapReads).toBe(0);
        expect(JSON.stringify(result)).not.toContain(privateMarker);
        expect(loggedOutput()).not.toContain(privateMarker);
    });

    it('does not trust cloned, forged, or proxied provider errors', () => {
        const genuine = createTrustedError({
            code: 'NETWORK_ERROR',
            retryable: true,
        });
        const lookalikes = [
            structuredClone(genuine),
            Object.assign(Object.create(TranslationProviderError.prototype), {
                name: 'TranslationProviderError',
                message: 'Forged provider error',
                provider: 'vertex_gemini',
                code: 'NETWORK_ERROR',
                retryable: true,
            }),
            new Proxy(genuine, {}),
        ];

        for (const lookalike of lookalikes) {
            const result = errorHandler.classifyError(lookalike, {
                retryCount: 0,
            });
            expect(result.originalError).toBe(lookalike);
            expect(result.message).not.toBe(FIXED_PROVIDER_MESSAGE);
        }
    });

    it('retains existing generic error traversal and context behavior', () => {
        const cause = new TypeError('offline fetch');
        const genericError = new Error('generic wrapper', { cause });
        const context = {
            operation: 'legacy-operation',
            sourceLang: 'PRIVATE_GENERIC_SOURCE',
            retryCount: 0,
        };

        const result = errorHandler.handleError(genericError, context);

        expect(result).toMatchObject({
            originalError: genericError,
            message: 'generic wrapper',
            context,
            category: ErrorCategory.NETWORK,
            severity: ErrorSeverity.HIGH,
            errorCode: 'NETWORK_ERROR',
        });
        expect(result.stack).toBe(genericError.stack);
    });

    it('retains the legacy stack field in generic logging data', () => {
        const warn = jest
            .spyOn(errorHandler.logger, 'warn')
            .mockImplementation(() => {});
        const genericError = { message: 'generic object without a stack' };

        errorHandler.handleError(genericError, { retryCount: 0 });

        expect(warn).toHaveBeenCalledTimes(1);
        const logData = warn.mock.calls[0][1];
        expect(Object.hasOwn(logData, 'stack')).toBe(true);
        expect(logData.stack).toBeUndefined();
    });

    it('retains propagation of generic logger failures', () => {
        jest.spyOn(errorHandler.logger, 'warn').mockImplementation(() => {
            throw new Error('GENERIC_LOGGER_FAILURE');
        });

        expect(() =>
            errorHandler.handleError(
                { message: 'generic object without a stack' },
                { retryCount: 0 }
            )
        ).toThrow('GENERIC_LOGGER_FAILURE');
    });

    it('returns the trusted classification when branded-error logging throws', () => {
        const log = jest
            .spyOn(errorHandler.logger, 'error')
            .mockImplementation(() => {
                throw new Error('PRIVATE_LOGGER_FAILURE');
            });

        const result = errorHandler.handleError(
            createTrustedError({ code: 'NETWORK_ERROR', retryable: true }),
            { operation: 'translate', retryCount: 0 }
        );

        expect(result).toMatchObject({
            originalError: null,
            category: ErrorCategory.NETWORK,
            errorCode: 'NETWORK_ERROR',
            shouldRetry: true,
        });
        expect(log).toHaveBeenCalledTimes(1);
        expect(log.mock.calls[0][1]).toBeNull();
        expect(log.mock.calls[0][2]).not.toHaveProperty('stack');
        expect(errorHandler.getErrorStats().total).toBe(1);
        expect(JSON.stringify(result)).not.toContain('PRIVATE_LOGGER_FAILURE');
    });

    it('returns the trusted classification when branded warning logging throws', () => {
        const log = jest
            .spyOn(errorHandler.logger, 'warn')
            .mockImplementation(() => {
                throw new Error('PRIVATE_WARN_LOGGER_FAILURE');
            });

        const result = errorHandler.handleError(
            createTrustedError({ code: 'REQUEST_FAILED', retryable: false }),
            { operation: 'translate', retryCount: 0 }
        );

        expect(result).toMatchObject({
            originalError: null,
            category: ErrorCategory.TRANSLATION,
            severity: ErrorSeverity.MEDIUM,
            errorCode: 'REQUEST_FAILED',
            shouldRetry: false,
        });
        expect(log).toHaveBeenCalledTimes(1);
        expect(log.mock.calls[0][1]).not.toHaveProperty('stack');
        expect(errorHandler.getErrorStats().total).toBe(1);
        expect(JSON.stringify(result)).not.toContain(
            'PRIVATE_WARN_LOGGER_FAILURE'
        );
    });
});
