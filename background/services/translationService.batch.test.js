import {
    afterEach,
    beforeEach,
    describe,
    expect,
    jest,
    test,
} from '@jest/globals';
import { translationProviders } from './translationService.js';
import { performanceMonitor } from '../utils/performanceMonitor.js';

describe('TranslationService multi-text requests', () => {
    let originalProviderId;
    let originalProviders;
    let originalLogger;
    let originalPerformanceMetrics;
    let originalCharacterTracker;
    let originalRateLimitTracker;
    let originalLastRequestTime;
    let originalProviderRequestSlotQueues;

    beforeEach(() => {
        originalProviderId = translationProviders.currentProviderId;
        originalProviders = translationProviders.providers;
        originalLogger = translationProviders.logger;
        originalPerformanceMetrics = translationProviders.performanceMetrics;
        originalCharacterTracker = translationProviders.characterTracker;
        originalRateLimitTracker = translationProviders.rateLimitTracker;
        originalLastRequestTime = translationProviders.lastRequestTime;
        originalProviderRequestSlotQueues =
            translationProviders.providerRequestSlotQueues;

        translationProviders.currentProviderId = 'test_batch_provider';
        translationProviders.logger = {
            debug: jest.fn(),
            error: jest.fn(),
            info: jest.fn(),
        };
        translationProviders.performanceMetrics = {
            totalTranslations: 0,
            successfulTranslations: 0,
            cacheHits: 0,
            averageResponseTime: 0,
            errors: 0,
            rateLimitHits: 0,
        };
        translationProviders.characterTracker = new Map();
        translationProviders.rateLimitTracker = new Map();
        translationProviders.lastRequestTime = new Map();
        translationProviders.providerRequestSlotQueues = new Map();
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
        translationProviders.translationCache.clear();
        translationProviders.currentProviderId = originalProviderId;
        translationProviders.providers = originalProviders;
        translationProviders.logger = originalLogger;
        translationProviders.performanceMetrics = originalPerformanceMetrics;
        translationProviders.characterTracker = originalCharacterTracker;
        translationProviders.rateLimitTracker = originalRateLimitTracker;
        translationProviders.lastRequestTime = originalLastRequestTime;
        translationProviders.providerRequestSlotQueues =
            originalProviderRequestSlotQueues;
    });

    test('chunks oversized input without dropping or reordering texts', async () => {
        const translateBatch = jest.fn(async (texts) =>
            texts.map((text) => `translated:${text}`)
        );
        translationProviders.providers = {
            test_batch_provider: {
                supportsBatch: true,
                translateBatch,
                batchOptimizations: {
                    maxBatchSize: 2,
                    delimiter: '|BREAK|',
                },
            },
        };

        const result = await translationProviders.translateBatch(
            ['one', 'two', 'three', 'four', 'five'],
            'en',
            'es',
            { skipRateLimit: true, allowFallback: false }
        );

        expect(translateBatch.mock.calls.map(([texts]) => texts)).toEqual([
            ['one', 'two'],
            ['three', 'four'],
            ['five'],
        ]);
        expect(result).toEqual([
            'translated:one',
            'translated:two',
            'translated:three',
            'translated:four',
            'translated:five',
        ]);
    });

    test('rejects a provider response that loses positional results', async () => {
        translationProviders.providers = {
            test_batch_provider: {
                supportsBatch: true,
                translateBatch: jest.fn().mockResolvedValue(['only-one']),
                batchOptimizations: { maxBatchSize: 2 },
            },
        };

        await expect(
            translationProviders.translateBatch(['one', 'two'], 'en', 'es', {
                skipRateLimit: true,
                allowFallback: false,
            })
        ).rejects.toThrow('returned 1 for 2 inputs');
    });

    test('ends timing when a single translation returns from cache', async () => {
        jest.spyOn(performanceMonitor, 'startTiming').mockReturnValue(
            'cached-translation'
        );
        const endTiming = jest
            .spyOn(performanceMonitor, 'endTiming')
            .mockReturnValue(1);
        translationProviders.setCacheItem(
            translationProviders.generateCacheKey('hello', 'en', 'es'),
            'hola'
        );

        await expect(
            translationProviders.translate('hello', 'en', 'es')
        ).resolves.toBe('hola');
        expect(endTiming).toHaveBeenCalledWith('cached-translation');
    });

    test('keeps known hash-collision texts in separate translation cache entries', () => {
        const firstKey = translationProviders.generateCacheKey(
            'Aa',
            'en',
            'es'
        );
        const secondKey = translationProviders.generateCacheKey(
            'BB',
            'en',
            'es'
        );

        translationProviders.setCacheItem(firstKey, 'first translation');

        expect(secondKey).not.toBe(firstKey);
        expect(translationProviders.getCacheItem(secondKey)).toBeUndefined();
    });

    test('ends batch timing before returning the individual fallback', async () => {
        jest.spyOn(performanceMonitor, 'startTiming').mockReturnValue(
            'batch-fallback'
        );
        const endTiming = jest
            .spyOn(performanceMonitor, 'endTiming')
            .mockReturnValue(1);
        translationProviders.providers = {
            test_batch_provider: {
                supportsBatch: false,
                rateLimit: { mandatoryDelay: 0 },
            },
        };
        jest.spyOn(
            translationProviders,
            'translateIndividually'
        ).mockResolvedValue(['uno', 'dos']);

        await expect(
            translationProviders.translateBatch(['one', 'two'], 'en', 'es')
        ).resolves.toEqual(['uno', 'dos']);
        expect(endTiming).toHaveBeenCalledWith('batch-fallback');
    });

    test('serializes request-slot acquisition while allowing provider responses to overlap', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(10_000);

        let resolveFirstRequest;
        const translate = jest.fn((text) => {
            if (text === 'first') {
                return new Promise((resolve) => {
                    resolveFirstRequest = resolve;
                });
            }
            return Promise.resolve(`translated:${text}`);
        });
        translationProviders.providers = {
            test_batch_provider: {
                translate,
                rateLimit: {
                    type: 'requests_per_minute',
                    requests: 10,
                    window: 60_000,
                    mandatoryDelay: 100,
                },
            },
        };

        const firstRequest = translationProviders.translate(
            'first',
            'en',
            'es',
            { skipCache: true, allowRetry: false }
        );
        const secondRequest = translationProviders.translate(
            'second',
            'en',
            'es',
            { skipCache: true, allowRetry: false }
        );

        await jest.advanceTimersByTimeAsync(0);
        expect(translate).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(99);
        expect(translate).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(1);
        expect(translate).toHaveBeenCalledTimes(2);
        expect(
            translationProviders.rateLimitTracker.get('test_batch_provider')
        ).toHaveLength(2);
        await expect(secondRequest).resolves.toBe('translated:second');

        resolveFirstRequest('translated:first');
        await expect(firstRequest).resolves.toBe('translated:first');
    });

    test('reserves rate-limit capacity before an in-flight provider response completes', async () => {
        let resolveFirstRequest;
        const translate = jest.fn((text) => {
            if (text === 'first') {
                return new Promise((resolve) => {
                    resolveFirstRequest = resolve;
                });
            }
            return Promise.resolve(`translated:${text}`);
        });
        translationProviders.providers = {
            test_batch_provider: {
                translate,
                rateLimit: {
                    type: 'requests_per_minute',
                    requests: 1,
                    window: 60_000,
                    mandatoryDelay: 0,
                },
            },
        };

        const firstRequest = translationProviders.translate(
            'first',
            'en',
            'es',
            { skipCache: true, allowRetry: false }
        );
        const secondRequest = translationProviders.translate(
            'second',
            'en',
            'es',
            { skipCache: true, allowRetry: false }
        );
        const secondExpectation =
            expect(secondRequest).rejects.toThrow(/rate limit/i);

        await secondExpectation;
        expect(translate).toHaveBeenCalledTimes(1);

        resolveFirstRequest('translated:first');
        await expect(firstRequest).resolves.toBe('translated:first');
    });

    test('shares provider request-slot reservations with batch calls', async () => {
        let resolveFirstRequest;
        const translate = jest.fn(
            () =>
                new Promise((resolve) => {
                    resolveFirstRequest = resolve;
                })
        );
        const translateBatch = jest
            .fn()
            .mockResolvedValue(['translated:second']);
        translationProviders.providers = {
            test_batch_provider: {
                translate,
                translateBatch,
                supportsBatch: true,
                rateLimit: {
                    type: 'requests_per_minute',
                    requests: 1,
                    window: 60_000,
                    mandatoryDelay: 0,
                },
                batchOptimizations: {
                    maxBatchSize: 10,
                    exponentialBackoff: false,
                },
            },
        };

        const firstRequest = translationProviders.translate(
            'first',
            'en',
            'es',
            { skipCache: true, allowRetry: false }
        );
        const batchRequest = translationProviders.translateBatch(
            ['second'],
            'en',
            'es',
            { allowFallback: false }
        );
        const batchExpectation =
            expect(batchRequest).rejects.toThrow(/rate limit/i);

        await batchExpectation;
        expect(translateBatch).not.toHaveBeenCalled();

        resolveFirstRequest('translated:first');
        await expect(firstRequest).resolves.toBe('translated:first');
    });

    test('uses all requests for rates and only successful provider responses for response time', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(1_000);

        const translate = jest.fn((text) => {
            if (text === 'first') {
                jest.setSystemTime(1_100);
                return Promise.resolve('translated:first');
            }
            if (text === 'failure') {
                jest.setSystemTime(1_200);
                return Promise.reject(new Error('authentication failed'));
            }

            jest.setSystemTime(1_500);
            return Promise.resolve('translated:third');
        });
        translationProviders.providers = {
            test_batch_provider: {
                translate,
                rateLimit: { mandatoryDelay: 0 },
            },
        };

        await translationProviders.translate('first', 'en', 'es', {
            skipCache: true,
            skipRateLimit: true,
            allowRetry: false,
        });
        await expect(
            translationProviders.translate('failure', 'en', 'es', {
                skipCache: true,
                skipRateLimit: true,
                allowRetry: false,
            })
        ).rejects.toThrow();
        await translationProviders.translate('third', 'en', 'es', {
            skipCache: true,
            skipRateLimit: true,
            allowRetry: false,
        });
        await translationProviders.translate('first', 'en', 'es');
        await translationProviders.translate('first', 'en', 'es');

        const metrics = translationProviders.getPerformanceMetrics();
        expect(metrics).toMatchObject({
            totalTranslations: 5,
            successfulTranslations: 2,
            cacheHits: 2,
            errors: 1,
            averageResponseTime: 200,
            errorRate: 20,
            cacheHitRate: 40,
        });
        expect(metrics.cacheHitRate).toBeLessThanOrEqual(100);
    });

    test('stops retrying after three total provider attempts', async () => {
        jest.useFakeTimers();
        jest.spyOn(performanceMonitor, 'startTiming').mockReturnValue(
            'retried-translation'
        );
        const endTiming = jest
            .spyOn(performanceMonitor, 'endTiming')
            .mockReturnValue(1);
        const translate = jest
            .fn()
            .mockRejectedValue(new Error('network unavailable'));
        translationProviders.providers = {
            test_batch_provider: {
                translate,
                rateLimit: { mandatoryDelay: 0 },
            },
        };

        const request = translationProviders.translate('hello', 'en', 'es', {
            skipCache: true,
            skipRateLimit: true,
        });
        const expectation = expect(request).rejects.toThrow();
        await jest.runAllTimersAsync();
        await expectation;

        expect(translate).toHaveBeenCalledTimes(3);
        expect(performanceMonitor.startTiming).toHaveBeenCalledTimes(1);
        expect(endTiming).toHaveBeenCalledTimes(1);
        expect(translationProviders.getPerformanceMetrics()).toMatchObject({
            totalTranslations: 1,
            successfulTranslations: 0,
            errors: 1,
            errorRate: 100,
            cacheHitRate: 0,
        });
    });

    test('records one successful request when an internal retry recovers', async () => {
        jest.useFakeTimers();
        const translate = jest
            .fn()
            .mockRejectedValueOnce(new Error('network unavailable'))
            .mockRejectedValueOnce(new Error('network unavailable'))
            .mockResolvedValue('translated:hello');
        translationProviders.providers = {
            test_batch_provider: {
                translate,
                rateLimit: { mandatoryDelay: 0 },
            },
        };

        const request = translationProviders.translate('hello', 'en', 'es', {
            skipCache: true,
            skipRateLimit: true,
        });
        await jest.runAllTimersAsync();
        await expect(request).resolves.toBe('translated:hello');

        expect(translate).toHaveBeenCalledTimes(3);
        expect(translationProviders.getPerformanceMetrics()).toMatchObject({
            totalTranslations: 1,
            successfulTranslations: 1,
            errors: 0,
            errorRate: 0,
            cacheHitRate: 0,
        });
    });

    test.each([
        ['openaiCompatibleModel', 'new-model'],
        ['openaiCompatibleBaseUrl', 'https://new.example.test/v1'],
    ])('invalidates cached translations when %s changes', (key, value) => {
        const cacheKey = translationProviders.generateCacheKey(
            'hello',
            'en',
            'es'
        );
        translationProviders.setCacheItem(cacheKey, 'hola');

        translationProviders.handleConfigurationChanges({ [key]: value });

        expect(translationProviders.getCacheItem(cacheKey)).toBeUndefined();
    });

    test('invalidates on credential rotation without logging the credential', () => {
        const cacheKey = translationProviders.generateCacheKey(
            'hello',
            'en',
            'es'
        );
        translationProviders.setCacheItem(cacheKey, 'hola');

        translationProviders.handleConfigurationChanges({
            openaiCompatibleApiKey: 'credential-must-not-be-logged',
        });

        expect(translationProviders.getCacheItem(cacheKey)).toBeUndefined();
        expect(
            JSON.stringify(translationProviders.logger.info.mock.calls)
        ).not.toContain('credential-must-not-be-logged');
        expect(
            JSON.stringify(translationProviders.logger.debug.mock.calls)
        ).not.toContain('credential-must-not-be-logged');
    });
});
