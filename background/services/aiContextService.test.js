import { jest } from '@jest/globals';
import { configService } from '../../services/configService.js';
import { AIContextService } from './aiContextService.js';

function createService(analyzeContext = jest.fn()) {
    const service = new AIContextService();
    service.logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    };
    service.providers = {
        openai: {
            name: 'OpenAI',
            analyzeContext,
            rateLimit: {
                type: 'requests_per_minute',
                requests: 60,
                window: 60_000,
                mandatoryDelay: 1_000,
            },
        },
    };
    service.currentProviderId = 'openai';
    service.isInitialized = true;
    return service;
}

function observeAnalysisWork(service) {
    return {
        cacheKeyGeneration: jest.spyOn(service, 'generateCacheKey'),
        cacheGet: jest.spyOn(service.cache, 'get'),
        cacheSet: jest.spyOn(service.cache, 'set'),
        rateLimitCheck: jest.spyOn(service.rateLimiterManager, 'checkLimit'),
    };
}

function expectNoAnalysisWork(work, analyzeContext) {
    expect(work.cacheKeyGeneration).not.toHaveBeenCalled();
    expect(work.cacheGet).not.toHaveBeenCalled();
    expect(work.cacheSet).not.toHaveBeenCalled();
    expect(work.rateLimitCheck).not.toHaveBeenCalled();
    expect(analyzeContext).not.toHaveBeenCalled();
}

describe('AIContextService runtime configuration', () => {
    const services = [];
    let strictEnablementRead;

    beforeEach(() => {
        strictEnablementRead = jest
            .spyOn(configService, 'readStoredBooleanStrict')
            .mockResolvedValue(true);
    });

    afterEach(() => {
        for (const service of services) {
            service.cache.destroy();
            service.rateLimiterManager.cleanup();
        }
        services.length = 0;
        jest.restoreAllMocks();
        jest.useRealTimers();
    });

    it('applies cache, rate-limit, and retry settings to live services', () => {
        const service = createService();
        services.push(service);

        service._applyRuntimeConfiguration({
            aiContextCacheEnabled: true,
            aiContextCacheTTL: 120_000,
            aiContextMaxCacheSize: 7,
            aiContextRateLimit: 25,
            aiContextBurstLimit: 3,
            aiContextMandatoryDelay: 50,
            aiContextRetryAttempts: 2,
            aiContextRetryDelay: 10,
        });

        expect(service.cache).toMatchObject({
            defaultTTL: 120_000,
            maxSize: 7,
        });
        expect(service.runtimeConfig).toMatchObject({
            cacheEnabled: true,
            rateLimit: 25,
            burstLimit: 3,
            mandatoryDelay: 50,
            retryAttempts: 2,
            retryDelay: 10,
        });
        expect(
            service.rateLimiterManager.getLimiter('openai').config
        ).toMatchObject({
            requests: 25,
            burstLimit: 3,
            mandatoryDelay: 50,
        });
    });

    it('includes provider model and endpoint in cache identity', () => {
        const service = createService();
        services.push(service);

        service._applyRuntimeConfiguration({
            openaiBaseUrl: 'https://api.openai.com/v1',
            openaiModel: 'gpt-5.6-luna',
        });
        const lunaKey = service.generateCacheKey('hello', 'cultural');

        service._applyRuntimeConfiguration({
            openaiModel: 'gpt-5.6-sol',
        });
        const solKey = service.generateCacheKey('hello', 'cultural');

        expect(solKey).not.toBe(lunaKey);
    });

    it('loads only the non-secret settings used by this service', async () => {
        const service = createService();
        services.push(service);
        const getMultiple = jest
            .spyOn(configService, 'getMultiple')
            .mockResolvedValue({
                aiContextProvider: 'openai',
                openaiModel: 'gpt-5.6-sol',
            });

        await service.reloadProviderConfig();

        const requestedKeys = getMultiple.mock.calls[0][0];
        expect(requestedKeys).toEqual(
            expect.arrayContaining(['aiContextProvider', 'openaiModel'])
        );
        expect(requestedKeys).not.toEqual(
            expect.arrayContaining(['openaiApiKey', 'geminiApiKey'])
        );
        expect(service.configSnapshot).not.toHaveProperty('openaiApiKey');
        expect(service.configSnapshot).not.toHaveProperty('geminiApiKey');
    });

    it.each(['openaiApiKey', 'geminiApiKey'])(
        'clears cached analysis when %s changes without retaining the secret',
        (key) => {
            const service = createService();
            services.push(service);
            let configListener;
            const onChanged = jest
                .spyOn(configService, 'onChanged')
                .mockImplementation((listener) => {
                    configListener = listener;
                    return () => {};
                });
            service._setupConfigurationListener();
            service.cache.set('cached-analysis', { summary: 'old account' });

            expect(onChanged).toHaveBeenCalledWith(expect.any(Function), {
                includeSensitive: true,
            });
            configListener({ [key]: 'new-secret' });

            expect(service.cache.cache.size).toBe(0);
            expect(service.configSnapshot).not.toHaveProperty(key);
        }
    );

    it('does not cache an in-flight result after credential rotation', async () => {
        let resolveFirstAnalysis;
        const analyzeContext = jest
            .fn()
            .mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        resolveFirstAnalysis = resolve;
                    })
            )
            .mockResolvedValueOnce({
                success: true,
                analysis: { summary: 'new account' },
                shouldCache: true,
            });
        const service = createService(analyzeContext);
        services.push(service);
        jest.spyOn(service, 'checkRateLimit').mockResolvedValue(true);
        service._applyRuntimeConfiguration({
            aiContextCacheEnabled: true,
            aiContextMandatoryDelay: 1,
        });
        let configListener;
        jest.spyOn(configService, 'onChanged').mockImplementation(
            (listener) => {
                configListener = listener;
                return () => {};
            }
        );
        service._setupConfigurationListener();

        const oldAccountRequest = service.analyzeContext('hello', 'cultural');
        for (let attempt = 0; attempt < 10; attempt++) {
            if (analyzeContext.mock.calls.length > 0) {
                break;
            }
            await Promise.resolve();
        }
        expect(analyzeContext).toHaveBeenCalledTimes(1);

        configListener({ openaiApiKey: 'rotated-secret' });
        resolveFirstAnalysis({
            success: true,
            analysis: { summary: 'old account' },
            shouldCache: true,
        });
        await oldAccountRequest;

        expect(service.cache.cache.size).toBe(0);
        await expect(
            service.analyzeContext('hello', 'cultural')
        ).resolves.toMatchObject({
            analysis: { summary: 'new account' },
        });
        expect(analyzeContext).toHaveBeenCalledTimes(2);
        expect(strictEnablementRead).toHaveBeenCalledTimes(6);
    });

    it('separates identical text used in different surrounding contexts', () => {
        const service = createService();
        services.push(service);

        const firstScene = service.generateCacheKey(
            'That is sick',
            'cultural',
            {
                sourceLanguage: 'en',
                targetLanguage: 'zh-CN',
                surroundingContext:
                    'The crowd cheers after a skateboard trick.',
            }
        );
        const secondScene = service.generateCacheKey(
            'That is sick',
            'cultural',
            {
                sourceLanguage: 'en',
                targetLanguage: 'zh-CN',
                surroundingContext: 'A doctor reviews a patient chart.',
            }
        );

        expect(secondScene).not.toBe(firstScene);
    });

    it('keeps known hash-collision texts in separate context cache entries', () => {
        const service = createService();
        services.push(service);
        const firstKey = service.generateCacheKey('Aa', 'cultural');
        const secondKey = service.generateCacheKey('BB', 'cultural');

        service.cache.set(firstKey, { analysis: 'first result' });

        expect(secondKey).not.toBe(firstKey);
        expect(service.cache.get(secondKey)).toBeNull();
    });

    it('does not read or write the cache when caching is disabled', async () => {
        const analyzeContext = jest.fn().mockResolvedValue({
            success: true,
            analysis: { summary: 'result' },
        });
        const service = createService(analyzeContext);
        services.push(service);
        service._applyRuntimeConfiguration({
            aiContextCacheEnabled: false,
            aiContextMandatoryDelay: 1,
        });

        await service.analyzeContext('hello', 'cultural');
        await service.analyzeContext('hello', 'cultural');

        expect(analyzeContext).toHaveBeenCalledTimes(2);
        expect(service.cache.cache.size).toBe(0);
    });

    it('revalidates enablement before dispatch and result publication', async () => {
        const analyzeContext = jest.fn().mockResolvedValue({
            success: true,
            analysis: { summary: 'result' },
        });
        const service = createService(analyzeContext);
        services.push(service);
        service._applyRuntimeConfiguration({
            aiContextCacheEnabled: false,
            aiContextMandatoryDelay: 1,
        });

        await expect(
            service.analyzeContext('hello', 'cultural')
        ).resolves.toMatchObject({ success: true });

        expect(strictEnablementRead).toHaveBeenCalledTimes(3);
        expect(
            strictEnablementRead.mock.calls.every(
                (call) => call.length === 1 && call[0] === 'aiContextEnabled'
            )
        ).toBe(true);
        expect(analyzeContext).toHaveBeenCalledTimes(1);
    });

    it('does not read enablement for an uninitialized service', async () => {
        const analyzeContext = jest.fn();
        const service = createService(analyzeContext);
        services.push(service);
        service.isInitialized = false;
        const work = observeAnalysisWork(service);

        await expect(
            service.analyzeContext('hello', 'cultural')
        ).rejects.toThrow('AI Context Service not initialized');

        expect(strictEnablementRead).not.toHaveBeenCalled();
        expectNoAnalysisWork(work, analyzeContext);
    });

    it('proves enablement before returning an existing cached result', async () => {
        const analyzeContext = jest.fn();
        const service = createService(analyzeContext);
        services.push(service);
        service._applyRuntimeConfiguration({
            aiContextCacheEnabled: true,
        });
        const cacheKey = service.generateCacheKey('hello', 'cultural');
        service.cache.set(cacheKey, {
            success: true,
            analysis: { summary: 'cached result' },
        });
        const cacheGet = jest.spyOn(service.cache, 'get');
        const rateLimitCheck = jest.spyOn(
            service.rateLimiterManager,
            'checkLimit'
        );

        await expect(
            service.analyzeContext('hello', 'cultural')
        ).resolves.toMatchObject({
            success: true,
            analysis: { summary: 'cached result' },
            cached: true,
        });

        expect(strictEnablementRead.mock.calls).toEqual([['aiContextEnabled']]);
        expect(cacheGet).toHaveBeenCalledTimes(1);
        expect(rateLimitCheck).not.toHaveBeenCalled();
        expect(analyzeContext).not.toHaveBeenCalled();
    });

    it.each([
        ['empty string', ''],
        ['blank string', '   '],
        ['non-string value', null],
    ])('does not read enablement for an invalid %s', async (_name, text) => {
        const analyzeContext = jest.fn();
        const service = createService(analyzeContext);
        services.push(service);
        const work = observeAnalysisWork(service);

        await expect(
            service.analyzeContext(text, 'cultural')
        ).resolves.toMatchObject({ success: false });

        expect(strictEnablementRead).not.toHaveBeenCalled();
        expectNoAnalysisWork(work, analyzeContext);
    });

    it('fails closed without analysis work when AI context is disabled', async () => {
        strictEnablementRead.mockResolvedValue(false);
        const analyzeContext = jest.fn();
        const service = createService(analyzeContext);
        services.push(service);
        const work = observeAnalysisWork(service);

        await expect(
            service.analyzeContext(' hello ', 'cultural', {
                targetLanguage: 'zh-CN',
            })
        ).resolves.toEqual({
            success: false,
            error: 'AI context analysis is disabled',
            contextType: 'cultural',
            originalText: 'hello',
            metadata: { targetLanguage: 'zh-CN' },
            shouldRetry: false,
            shouldCache: false,
        });

        expect(strictEnablementRead.mock.calls).toEqual([['aiContextEnabled']]);
        expectNoAnalysisWork(work, analyzeContext);
    });

    it('does not return a cached result when AI context is disabled', async () => {
        strictEnablementRead.mockResolvedValue(false);
        const analyzeContext = jest.fn();
        const service = createService(analyzeContext);
        services.push(service);
        const cacheKey = service.generateCacheKey('hello', 'cultural');
        service.cache.set(cacheKey, {
            success: true,
            analysis: { summary: 'must not be returned' },
        });
        const work = observeAnalysisWork(service);

        await expect(
            service.analyzeContext('hello', 'cultural')
        ).resolves.toMatchObject({
            success: false,
            error: 'AI context analysis is disabled',
            shouldRetry: false,
            shouldCache: false,
        });

        expect(strictEnablementRead.mock.calls).toEqual([['aiContextEnabled']]);
        expectNoAnalysisWork(work, analyzeContext);
        expect(service.cache.cache.size).toBe(1);
    });

    it('uses the real stored-boolean helper and refuses schema-default provenance', async () => {
        strictEnablementRead.mockRestore();
        chrome.runtime.lastError = null;
        chrome.storage.sync.get.mockImplementation((_keys, callback) => {
            callback({});
        });
        const actualStrictRead =
            configService.readResultStrict.bind(configService);
        const strictResultRead = jest
            .spyOn(configService, 'readResultStrict')
            .mockImplementation(actualStrictRead);
        const analyzeContext = jest.fn();
        const service = createService(analyzeContext);
        services.push(service);
        const work = observeAnalysisWork(service);

        await expect(
            service.analyzeContext('hello', 'cultural')
        ).resolves.toMatchObject({
            success: false,
            error: 'AI context availability could not be verified',
            shouldRetry: false,
            shouldCache: false,
        });
        expect(strictResultRead.mock.calls).toEqual([['aiContextEnabled']]);
        expect(chrome.storage.sync.get.mock.calls[0][0]).toEqual([
            'aiContextEnabled',
        ]);
        expectNoAnalysisWork(work, analyzeContext);
    });

    it('normalizes rejected enablement reads without leaking storage errors', async () => {
        const storageError = new Error(
            'sync storage failed with PRIVATE_ENABLEMENT_SECRET'
        );
        strictEnablementRead.mockRejectedValue(storageError);
        const analyzeContext = jest.fn();
        const service = createService(analyzeContext);
        services.push(service);
        const work = observeAnalysisWork(service);

        const result = await service.analyzeContext('hello', 'cultural');

        expect(result).toEqual({
            success: false,
            error: 'AI context availability could not be verified',
            contextType: 'cultural',
            originalText: 'hello',
            metadata: {},
            shouldRetry: false,
            shouldCache: false,
        });
        expect(JSON.stringify(result)).not.toContain(
            'PRIVATE_ENABLEMENT_SECRET'
        );
        for (const method of Object.values(service.logger)) {
            for (const call of method.mock.calls) {
                expect(call).not.toContain(storageError);
                expect(call.map(String).join('\n')).not.toContain(
                    'PRIVATE_ENABLEMENT_SECRET'
                );
            }
        }
        expectNoAnalysisWork(work, analyzeContext);
    });

    it('does not reuse a prior successful enablement proof', async () => {
        strictEnablementRead
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(true)
            .mockRejectedValueOnce(
                new Error('second read failed with PRIVATE_STALE_SECRET')
            );
        const analyzeContext = jest.fn().mockResolvedValue({
            success: true,
            analysis: { summary: 'first result' },
        });
        const service = createService(analyzeContext);
        services.push(service);
        service._applyRuntimeConfiguration({
            aiContextCacheEnabled: false,
            aiContextMandatoryDelay: 1,
        });

        await expect(
            service.analyzeContext('first', 'cultural')
        ).resolves.toMatchObject({ success: true });
        await expect(
            service.analyzeContext('second', 'cultural')
        ).resolves.toMatchObject({
            success: false,
            error: 'AI context availability could not be verified',
            shouldRetry: false,
            shouldCache: false,
        });

        expect(strictEnablementRead).toHaveBeenCalledTimes(4);
        expect(analyzeContext).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['undefined', undefined],
        ['ordinary object', { secret: 'PRIVATE_HELPER_OBJECT' }],
        [
            'transparent proxy',
            new Proxy({ secret: 'PRIVATE_HELPER_PROXY' }, {}),
        ],
    ])(
        'fails closed when the boolean helper returns %s',
        async (_name, value) => {
            strictEnablementRead.mockResolvedValue(value);
            const analyzeContext = jest.fn();
            const service = createService(analyzeContext);
            services.push(service);
            const work = observeAnalysisWork(service);

            const result = await service.analyzeContext('hello', 'cultural');

            expect(result).toMatchObject({
                success: false,
                error: 'AI context availability could not be verified',
                shouldRetry: false,
                shouldCache: false,
            });
            expect(JSON.stringify(result)).not.toContain('PRIVATE_');
            expect(strictEnablementRead.mock.calls).toEqual([
                ['aiContextEnabled'],
            ]);
            expectNoAnalysisWork(work, analyzeContext);
        }
    );

    it('retries retryable provider failures with serialized backoff', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(10_000);
        const analyzeContext = jest
            .fn()
            .mockResolvedValueOnce({
                success: false,
                shouldRetry: true,
                error: 'malformed response',
            })
            .mockResolvedValueOnce({
                success: true,
                analysis: { summary: 'recovered' },
            });
        const service = createService(analyzeContext);
        services.push(service);
        service._applyRuntimeConfiguration({
            aiContextCacheEnabled: false,
            aiContextMandatoryDelay: 1,
            aiContextRetryAttempts: 2,
            aiContextRetryDelay: 25,
        });

        const resultPromise = service.analyzeContext('hello', 'cultural');
        await jest.advanceTimersByTimeAsync(25);

        await expect(resultPromise).resolves.toMatchObject({
            success: true,
            analysis: { summary: 'recovered' },
        });
        expect(analyzeContext).toHaveBeenCalledTimes(2);
        expect(strictEnablementRead).toHaveBeenCalledTimes(6);
        expect(
            service.rateLimiterManager.getLimiter('openai').requests
        ).toHaveLength(2);
    });

    it('stops before a retry dispatch when enablement is revoked during backoff', async () => {
        jest.useFakeTimers();
        strictEnablementRead
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(false);
        const analyzeContext = jest.fn().mockResolvedValue({
            success: false,
            shouldRetry: true,
            error: 'retryable provider failure',
        });
        const service = createService(analyzeContext);
        services.push(service);
        service._applyRuntimeConfiguration({
            aiContextCacheEnabled: true,
            aiContextMandatoryDelay: 1,
            aiContextRetryAttempts: 2,
            aiContextRetryDelay: 25,
        });

        const resultPromise = service.analyzeContext('hello', 'cultural');
        await jest.advanceTimersByTimeAsync(25);

        await expect(resultPromise).resolves.toMatchObject({
            success: false,
            error: 'AI context analysis is disabled',
            shouldRetry: false,
            shouldCache: false,
        });
        expect(analyzeContext).toHaveBeenCalledTimes(1);
        expect(service.cache.cache.size).toBe(0);
    });

    it('suppresses an in-flight success after enablement is revoked', async () => {
        let resolveAnalysis;
        strictEnablementRead
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(false);
        const analyzeContext = jest.fn(
            () =>
                new Promise((resolve) => {
                    resolveAnalysis = resolve;
                })
        );
        const service = createService(analyzeContext);
        services.push(service);
        jest.spyOn(service, 'checkRateLimit').mockResolvedValue(true);
        service._applyRuntimeConfiguration({
            aiContextCacheEnabled: true,
            aiContextMandatoryDelay: 1,
        });

        const resultPromise = service.analyzeContext('hello', 'cultural');
        for (let attempt = 0; attempt < 10; attempt++) {
            if (analyzeContext.mock.calls.length > 0) break;
            await Promise.resolve();
        }
        expect(analyzeContext).toHaveBeenCalledTimes(1);

        resolveAnalysis({
            success: true,
            analysis: { summary: 'must be suppressed' },
            shouldCache: true,
        });

        await expect(resultPromise).resolves.toMatchObject({
            success: false,
            error: 'AI context analysis is disabled',
            shouldRetry: false,
            shouldCache: false,
        });
        expect(service.cache.cache.size).toBe(0);
    });

    it('does not retry a provider failure that requires user action', async () => {
        const analyzeContext = jest.fn().mockResolvedValue({
            success: false,
            error: 'API request failed: 401 Unauthorized',
            shouldRetry: false,
            shouldCache: false,
        });
        const service = createService(analyzeContext);
        services.push(service);
        service._applyRuntimeConfiguration({
            aiContextCacheEnabled: false,
            aiContextRetryAttempts: 3,
        });

        await expect(
            service.analyzeContext('hello', 'cultural')
        ).resolves.toMatchObject({
            success: false,
            shouldRetry: false,
        });
        expect(analyzeContext).toHaveBeenCalledTimes(1);
    });
});
