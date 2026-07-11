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

describe('AIContextService runtime configuration', () => {
    const services = [];

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
            jest.spyOn(configService, 'onChanged').mockImplementation(
                (listener) => {
                    configListener = listener;
                    return () => {};
                }
            );
            service._setupConfigurationListener();
            service.cache.set('cached-analysis', { summary: 'old account' });

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
        expect(
            service.rateLimiterManager.getLimiter('openai').requests
        ).toHaveLength(2);
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
