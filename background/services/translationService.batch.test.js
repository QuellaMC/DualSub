import {
    afterEach,
    beforeEach,
    describe,
    expect,
    jest,
    test,
} from '@jest/globals';
import fs from 'node:fs';
import { TextEncoder as NodeTextEncoder } from 'node:util';
import { translationProviders } from './translationService.js';
import { performanceMonitor } from '../utils/performanceMonitor.js';
import { configService } from '../../services/configService.js';
import { getDefaultValue } from '../../config/configSchema.js';
import { Providers } from '../../content_scripts/shared/constants/providers.js';

const translationServiceSource = fs.readFileSync(
    new URL('./translationService.js', import.meta.url),
    'utf8'
);
const englishProviderDocs = fs.readFileSync(
    new URL('../../docs/en/providers.md', import.meta.url),
    'utf8'
);
const chineseProviderDocs = fs.readFileSync(
    new URL('../../docs/zh/providers.md', import.meta.url),
    'utf8'
);

describe('TranslationService', () => {
    let originalProviderId;
    let originalProviders;
    let originalLogger;
    let originalPerformanceMetrics;
    let originalCharacterTracker;
    let originalRateLimitTracker;
    let originalLastRequestTime;
    let originalProviderRequestSlotQueues;
    let originalCacheGeneration;
    let originalConfiguredRequestDelay;
    let originalIsInitialized;
    let originalTextEncoder;

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
        originalCacheGeneration = translationProviders.cacheGeneration;
        originalConfiguredRequestDelay =
            translationProviders.configuredRequestDelay;
        originalIsInitialized = translationProviders.isInitialized;
        originalTextEncoder = globalThis.TextEncoder;
        globalThis.TextEncoder = NodeTextEncoder;

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
        translationProviders.cacheGeneration = 0;
        translationProviders.configuredRequestDelay = 0;
        translationProviders.isInitialized = false;
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
        translationProviders.cacheGeneration = originalCacheGeneration;
        translationProviders.configuredRequestDelay =
            originalConfiguredRequestDelay;
        translationProviders.isInitialized = originalIsInitialized;
        globalThis.TextEncoder = originalTextEncoder;
    });

    test('reports no reset time for an empty active bytes bucket', () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-07-17T00:00:00.000Z'));
        translationProviders.providers = {
            bytes_provider: {
                rateLimit: {
                    type: 'bytes_per_window',
                    bytes: 100,
                    window: 6_500,
                    mandatoryDelay: 25,
                },
            },
        };

        expect(
            translationProviders.getRateLimitStatus('bytes_provider')
        ).toEqual({
            hasLimit: true,
            type: 'bytes',
            limit: 100,
            used: 0,
            remaining: 100,
            resetTime: null,
            mandatoryDelay: 25,
        });
    });

    test('describes default provider enforcement without claiming durable quota state', () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-07-17T00:00:00.000Z'));

        const microsoftRateLimit =
            originalProviders[Providers.MICROSOFT_EDGE_AUTH].rateLimit;
        const deeplRateLimit = originalProviders[Providers.DEEPL].rateLimit;

        expect(microsoftRateLimit).toEqual({
            type: 'characters_per_window',
            scope: 'worker_instance',
            characters: 33_300,
            window: 60_000,
            mandatoryDelay: 800,
        });
        expect(
            translationProviders.getRateLimitStatus(
                Providers.MICROSOFT_EDGE_AUTH
            )
        ).toEqual({
            hasLimit: true,
            type: 'characters_per_window',
            scope: 'worker_instance',
            limit: 33_300,
            used: 0,
            remaining: 33_300,
            resetTime: null,
            mandatoryDelay: 800,
        });

        expect(deeplRateLimit).toEqual({
            type: 'provider_response',
            mandatoryDelay: 500,
        });
        expect(
            translationProviders.getRateLimitStatus(Providers.DEEPL)
        ).toEqual({
            hasLimit: false,
            type: 'provider_response',
            mandatoryDelay: 500,
        });
    });

    test('keeps long-window quota enforcement and claims out of the worker', () => {
        expect(translationServiceSource).not.toContain('requests_per_hour');
        expect(translationServiceSource).not.toContain('characters_per_month');

        expect(englishProviderDocs).toContain(
            '- Microsoft (free): one-minute worker-local character guard with mandatory pacing; it is not a durable Microsoft account quota'
        );
        expect(englishProviderDocs).toContain(
            '- DeepL API: local request pacing only; quota truth comes from DeepL provider responses'
        );
        expect(englishProviderDocs).not.toMatch(
            /Microsoft[^\n]*(?:per[- ]hour|hourly)/i
        );
        expect(englishProviderDocs).not.toMatch(
            /DeepL[^\n]*(?:characters[- ]per[- ]month|monthly)/i
        );

        expect(chineseProviderDocs).toContain(
            '- Microsoft（免费）：仅当前后台工作进程的一分钟字符保护与强制延迟；不代表持久化的 Microsoft 账户配额'
        );
        expect(chineseProviderDocs).toContain(
            '- DeepL API：仅在本地执行请求间隔；配额以 DeepL 服务端响应为准'
        );
        expect(chineseProviderDocs).not.toMatch(/Microsoft[^\n]*每小时/);
        expect(chineseProviderDocs).not.toMatch(/DeepL[^\n]*(?:按月|月度)/);
    });

    test('does not reinterpret unknown long-window policies as minute limits', () => {
        const providerId = 'unknown_long_window_provider';
        translationProviders.providers = {
            [providerId]: {
                rateLimit: {
                    type: ['requests', 'per', 'hour'].join('_'),
                    requests: 1,
                    window: 3_600_000,
                    mandatoryDelay: 25,
                },
            },
        };
        translationProviders.rateLimitTracker.set(providerId, [Date.now()]);

        expect(translationProviders.checkRateLimit('', providerId)).toBe(true);
        expect(translationProviders.getRateLimitStatus(providerId)).toEqual({
            hasLimit: false,
            mandatoryDelay: 25,
        });

        const trackerBeforeUpdate = translationProviders.rateLimitTracker;
        const historyBeforeUpdate = trackerBeforeUpdate.get(providerId);
        const historySnapshot = [...historyBeforeUpdate];
        translationProviders.updateRateLimitTracker('', providerId);
        expect(translationProviders.rateLimitTracker).toBe(trackerBeforeUpdate);
        expect(translationProviders.rateLimitTracker.get(providerId)).toBe(
            historyBeforeUpdate
        );
        expect(historyBeforeUpdate).toHaveLength(historySnapshot.length);
        expect(historyBeforeUpdate).toEqual(historySnapshot);
    });

    test('keeps request and usage histories scoped to their enforcing policy', () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-07-17T00:00:00.000Z'));
        const now = Date.now();
        translationProviders.providers = {
            request_provider: {
                rateLimit: {
                    type: 'requests_per_minute',
                    requests: 5,
                    window: 60_000,
                    mandatoryDelay: 100,
                },
            },
            bytes_provider: {
                rateLimit: {
                    type: 'bytes_per_window',
                    bytes: 100,
                    window: 6_500,
                    mandatoryDelay: 25,
                },
            },
            character_provider: {
                rateLimit: {
                    type: 'characters_per_window',
                    scope: 'worker_instance',
                    characters: 100,
                    window: 60_000,
                    mandatoryDelay: 800,
                },
            },
            provider_response: {
                rateLimit: {
                    type: 'provider_response',
                    mandatoryDelay: 500,
                },
            },
        };

        translationProviders.updateRateLimitTracker(
            'request',
            'request_provider'
        );
        translationProviders.updateRateLimitTracker('bytes', 'bytes_provider');
        translationProviders.updateRateLimitTracker(
            'characters',
            'character_provider'
        );
        translationProviders.updateRateLimitTracker(
            'provider owned',
            'provider_response'
        );
        expect(
            translationProviders.checkRateLimit(
                'provider owned',
                'provider_response'
            )
        ).toBe(true);

        expect(translationProviders.rateLimitTracker).toEqual(
            new Map([['request_provider', [now]]])
        );
        expect(translationProviders.characterTracker).toEqual(
            new Map([
                [
                    'bytes_provider',
                    [{ timestamp: now, characters: 5, bytes: 5 }],
                ],
                [
                    'character_provider',
                    [{ timestamp: now, characters: 10, bytes: 10 }],
                ],
            ])
        );

        const rateHistory = translationProviders.rateLimitTracker;
        const characterHistory = translationProviders.characterTracker;
        expect(
            translationProviders.getRateLimitStatus('provider_response')
        ).toEqual({
            hasLimit: false,
            type: 'provider_response',
            mandatoryDelay: 500,
        });
        expect(translationProviders.rateLimitTracker).toBe(rateHistory);
        expect(translationProviders.characterTracker).toBe(characterHistory);
    });

    test('reports the oldest active byte reset without mutating tracker history', () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-07-17T00:00:00.000Z'));
        const now = Date.now();
        const window = 6_500;
        const records = [
            { timestamp: now - 1_000, bytes: 20, characters: 20 },
            { timestamp: now - 5_000, bytes: 30, characters: 30 },
            { timestamp: now - window, bytes: 90, characters: 90 },
            { timestamp: Number.NaN, bytes: 100, characters: 100 },
            {
                timestamp: Number.POSITIVE_INFINITY,
                bytes: 100,
                characters: 100,
            },
            { timestamp: now - 2_000, bytes: Number.NaN, characters: 10 },
        ];
        const originalRecords = records.map((record) => ({ ...record }));
        translationProviders.providers = {
            bytes_provider: {
                rateLimit: {
                    type: 'bytes_per_window',
                    bytes: 100,
                    window,
                    mandatoryDelay: 25,
                },
            },
        };
        translationProviders.characterTracker.set('bytes_provider', records);

        expect(
            translationProviders.getRateLimitStatus('bytes_provider')
        ).toEqual({
            hasLimit: true,
            type: 'bytes',
            limit: 100,
            used: 50,
            remaining: 50,
            resetTime: now - 5_000 + window,
            mandatoryDelay: 25,
        });
        expect(
            translationProviders.characterTracker.get('bytes_provider')
        ).toBe(records);
        expect(records).toEqual(originalRecords);

        jest.advanceTimersByTime(1_501);
        expect(
            translationProviders.getRateLimitStatus('bytes_provider')
        ).toMatchObject({
            used: 20,
            remaining: 80,
            resetTime: now - 1_000 + window,
        });

        jest.advanceTimersByTime(4_000);
        expect(
            translationProviders.getRateLimitStatus('bytes_provider')
        ).toMatchObject({
            used: 0,
            remaining: 100,
            resetTime: null,
        });
        expect(
            translationProviders.characterTracker.get('bytes_provider')
        ).toBe(records);
        expect(records).toEqual(originalRecords);
    });

    test('enforces a worker-local character window and forgets it on restart', () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-07-17T00:00:00.000Z'));
        const now = Date.now();
        const window = 60_000;
        translationProviders.providers = {
            character_provider: {
                rateLimit: {
                    type: 'characters_per_window',
                    scope: 'worker_instance',
                    characters: 100,
                    window,
                    mandatoryDelay: 800,
                },
            },
        };

        expect(
            translationProviders.checkRateLimit(
                'x'.repeat(100),
                'character_provider'
            )
        ).toBe(true);
        translationProviders.updateRateLimitTracker(
            'x'.repeat(100),
            'character_provider'
        );
        expect(
            translationProviders.getRateLimitStatus('character_provider')
        ).toEqual({
            hasLimit: true,
            type: 'characters_per_window',
            scope: 'worker_instance',
            limit: 100,
            used: 100,
            remaining: 0,
            resetTime: now + window,
            mandatoryDelay: 800,
        });
        expect(
            translationProviders.checkRateLimit('x', 'character_provider')
        ).toBe(false);

        const records =
            translationProviders.characterTracker.get('character_provider');
        records.push({ timestamp: now, characters: 20, bytes: 20 });
        records.push({ timestamp: now, characters: -1_000, bytes: 0 });
        const originalRecords = records.map((record) => ({ ...record }));
        expect(
            translationProviders.getRateLimitStatus('character_provider')
        ).toMatchObject({ used: 120, remaining: 0 });
        expect(records).toEqual(originalRecords);
        expect(
            translationProviders.checkRateLimit('x', 'character_provider')
        ).toBe(false);

        translationProviders.characterTracker = new Map();
        translationProviders.rateLimitTracker = new Map();
        expect(
            translationProviders.getRateLimitStatus('character_provider')
        ).toEqual({
            hasLimit: true,
            type: 'characters_per_window',
            scope: 'worker_instance',
            limit: 100,
            used: 0,
            remaining: 100,
            resetTime: null,
            mandatoryDelay: 800,
        });
        expect(
            translationProviders.checkRateLimit('x', 'character_provider')
        ).toBe(true);
    });

    test('reports request reset from the oldest finite active timestamp', () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-07-17T00:00:00.000Z'));
        const now = Date.now();
        const window = 60_000;
        const timestamps = [
            now - 10_000,
            now - 50_000,
            now - window,
            Number.NaN,
            Number.POSITIVE_INFINITY,
            String(now - 20_000),
        ];
        const originalTimestamps = [...timestamps];
        translationProviders.providers = {
            request_provider: {
                rateLimit: {
                    type: 'requests_per_minute',
                    requests: 5,
                    window,
                    mandatoryDelay: 100,
                },
            },
        };
        translationProviders.rateLimitTracker.set(
            'request_provider',
            timestamps
        );

        expect(
            translationProviders.getRateLimitStatus('request_provider')
        ).toEqual({
            hasLimit: true,
            type: 'requests',
            limit: 5,
            used: 2,
            remaining: 3,
            resetTime: now - 50_000 + window,
            mandatoryDelay: 100,
        });
        expect(
            translationProviders.rateLimitTracker.get('request_provider')
        ).toBe(timestamps);
        expect(timestamps).toEqual(originalTimestamps);

        jest.advanceTimersByTime(10_001);
        expect(
            translationProviders.getRateLimitStatus('request_provider')
        ).toMatchObject({
            used: 1,
            remaining: 4,
            resetTime: now - 10_000 + window,
        });

        jest.advanceTimersByTime(40_000);
        expect(
            translationProviders.getRateLimitStatus('request_provider')
        ).toMatchObject({ used: 0, remaining: 5, resetTime: null });
        expect(
            translationProviders.rateLimitTracker.get('request_provider')
        ).toBe(timestamps);
        expect(timestamps).toEqual(originalTimestamps);
    });

    test('keeps future tracker history inactive in status until enforcement normalizes it', () => {
        jest.useFakeTimers();
        jest.setSystemTime(100_000);
        const now = Date.now();
        const future = now + 86_400_000;
        const window = 1_000;
        const byteRecords = [{ timestamp: future, bytes: 5, characters: 5 }];
        const characterRecords = [
            { timestamp: future, bytes: 5, characters: 5 },
        ];
        const requestRecords = [future];
        translationProviders.providers = {
            bytes_provider: {
                rateLimit: {
                    type: 'bytes_per_window',
                    bytes: 5,
                    window,
                    mandatoryDelay: 0,
                },
            },
            character_provider: {
                rateLimit: {
                    type: 'characters_per_window',
                    scope: 'worker_instance',
                    characters: 5,
                    window,
                    mandatoryDelay: 0,
                },
            },
            request_provider: {
                rateLimit: {
                    type: 'requests_per_minute',
                    requests: 1,
                    window,
                    mandatoryDelay: 0,
                },
            },
        };
        translationProviders.characterTracker = new Map([
            ['bytes_provider', byteRecords],
            ['character_provider', characterRecords],
        ]);
        translationProviders.rateLimitTracker = new Map([
            ['request_provider', requestRecords],
        ]);

        expect(
            translationProviders.getRateLimitStatus('bytes_provider')
        ).toMatchObject({ used: 0, remaining: 5, resetTime: null });
        expect(
            translationProviders.getRateLimitStatus('character_provider')
        ).toMatchObject({ used: 0, remaining: 5, resetTime: null });
        expect(
            translationProviders.getRateLimitStatus('request_provider')
        ).toMatchObject({ used: 0, remaining: 1, resetTime: null });
        expect(
            translationProviders.characterTracker.get('bytes_provider')
        ).toBe(byteRecords);
        expect(
            translationProviders.characterTracker.get('character_provider')
        ).toBe(characterRecords);
        expect(
            translationProviders.rateLimitTracker.get('request_provider')
        ).toBe(requestRecords);
        expect(byteRecords[0].timestamp).toBe(future);
        expect(characterRecords[0].timestamp).toBe(future);
        expect(requestRecords[0]).toBe(future);

        jest.advanceTimersByTime(window + 1);
        expect(
            translationProviders.getRateLimitStatus('bytes_provider')
        ).toMatchObject({ used: 0, remaining: 5, resetTime: null });
        expect(
            translationProviders.getRateLimitStatus('character_provider')
        ).toMatchObject({ used: 0, remaining: 5, resetTime: null });
        expect(
            translationProviders.getRateLimitStatus('request_provider')
        ).toMatchObject({ used: 0, remaining: 1, resetTime: null });
        expect(
            translationProviders.characterTracker.get('bytes_provider')
        ).toBe(byteRecords);
        expect(
            translationProviders.characterTracker.get('character_provider')
        ).toBe(characterRecords);
        expect(
            translationProviders.rateLimitTracker.get('request_provider')
        ).toBe(requestRecords);
        expect(byteRecords[0].timestamp).toBe(future);
        expect(characterRecords[0].timestamp).toBe(future);
        expect(requestRecords[0]).toBe(future);

        const enforcementTime = Date.now();

        expect(translationProviders.checkRateLimit('x', 'bytes_provider')).toBe(
            false
        );
        expect(
            translationProviders.checkRateLimit('x', 'character_provider')
        ).toBe(false);
        expect(
            translationProviders.checkRateLimit('', 'request_provider')
        ).toBe(false);
        expect(
            translationProviders.characterTracker.get('bytes_provider')[0]
                .timestamp
        ).toBe(enforcementTime);
        expect(
            translationProviders.characterTracker.get('character_provider')[0]
                .timestamp
        ).toBe(enforcementTime);
        expect(
            translationProviders.rateLimitTracker.get('request_provider')[0]
        ).toBe(enforcementTime);
        expect(
            translationProviders.getRateLimitStatus('bytes_provider').resetTime
        ).toBe(enforcementTime + window);
        expect(
            translationProviders.getRateLimitStatus('character_provider')
                .resetTime
        ).toBe(enforcementTime + window);
        expect(
            translationProviders.getRateLimitStatus('request_provider')
                .resetTime
        ).toBe(enforcementTime + window);

        jest.advanceTimersByTime(window + 1);
        expect(translationProviders.checkRateLimit('x', 'bytes_provider')).toBe(
            true
        );
        expect(
            translationProviders.checkRateLimit('x', 'character_provider')
        ).toBe(true);
        expect(
            translationProviders.checkRateLimit('', 'request_provider')
        ).toBe(true);
        expect(
            translationProviders.getRateLimitStatus('bytes_provider')
        ).toMatchObject({ used: 0, remaining: 5, resetTime: null });
        expect(
            translationProviders.getRateLimitStatus('character_provider')
        ).toMatchObject({ used: 0, remaining: 5, resetTime: null });
        expect(
            translationProviders.getRateLimitStatus('request_provider')
        ).toMatchObject({ used: 0, remaining: 1, resetTime: null });
    });

    test('standalone translate suppresses an in-flight stale write after invalidation', async () => {
        let resolveTranslation;
        translationProviders.providers = {
            test_batch_provider: {
                translate: jest.fn(
                    () =>
                        new Promise((resolve) => {
                            resolveTranslation = resolve;
                        })
                ),
            },
        };

        const request = translationProviders.translate('one', 'en', 'es', {
            skipRateLimit: true,
            allowRetry: false,
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
        translationProviders.handleConfigurationChanges({
            openaiCompatibleModel: 'new-model',
        });
        resolveTranslation('old-model:one');

        await expect(request).rejects.toThrow(/configuration changed/i);
        expect(
            translationProviders.getCacheItem(
                translationProviders.generateCacheKey('one', 'en', 'es')
            )
        ).toBeUndefined();
    });

    test('does not cache malformed non-string Vertex model content', async () => {
        const originalFetch = globalThis.fetch;
        translationProviders.currentProviderId = Providers.VERTEX_GEMINI;
        translationProviders.providers = {
            [Providers.VERTEX_GEMINI]:
                originalProviders[Providers.VERTEX_GEMINI],
        };
        jest.spyOn(configService, 'readMultipleResultStrict').mockResolvedValue(
            {
                values: {
                    vertexAccessToken: 'short-lived-token',
                    vertexProjectId: 'project-id',
                    vertexLocation: 'us-central1',
                    vertexModel: 'gemini-2.5-flash',
                },
            }
        );
        globalThis.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: jest.fn().mockResolvedValue({
                candidates: [
                    {
                        content: {
                            parts: [{ text: { translated: 'Hola' } }],
                        },
                    },
                ],
            }),
        });
        const cacheKey = translationProviders.generateCacheKey(
            'Hello',
            'en',
            'es',
            Providers.VERTEX_GEMINI
        );

        try {
            await expect(
                translationProviders.translate('Hello', 'en', 'es', {
                    skipRateLimit: true,
                    allowRetry: false,
                })
            ).rejects.toMatchObject({
                details: {
                    errorCode: 'REQUEST_FAILED',
                    isRecoverable: false,
                },
            });
            expect(translationProviders.getCacheItem(cacheKey)).toBeUndefined();
            expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        } finally {
            globalThis.fetch = originalFetch;
        }
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

    test('ends single-translation timing when cache-key generation throws', async () => {
        jest.spyOn(performanceMonitor, 'startTiming').mockReturnValue(
            'single-cache-key-failure'
        );
        const endTiming = jest
            .spyOn(performanceMonitor, 'endTiming')
            .mockReturnValue(1);
        jest.spyOn(translationProviders, 'generateCacheKey').mockImplementation(
            () => {
                throw new Error('cache key unavailable');
            }
        );

        await expect(
            translationProviders.translate('hello', 'en', 'es')
        ).rejects.toThrow('cache key unavailable');
        expect(endTiming).toHaveBeenCalledTimes(1);
        expect(endTiming).toHaveBeenCalledWith('single-cache-key-failure');
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

    test.each([
        ['string', '1'],
        ['coercible object', { [Symbol.toPrimitive]: () => 'not-a-number' }],
        ['NaN', Number.NaN],
        ['Infinity', Number.POSITIVE_INFINITY],
        ['negative', -1],
        ['fractional', 1.5],
    ])(
        'normalizes malformed initial retryCount (%s) to a bounded retry budget',
        async (_label, retryCount) => {
            jest.useFakeTimers();
            const setTimeoutSpy = jest.spyOn(globalThis, 'setTimeout');
            const translate = jest
                .fn()
                .mockRejectedValueOnce(new Error('network unavailable'))
                .mockRejectedValueOnce(new Error('network unavailable'))
                .mockRejectedValueOnce(new Error('network unavailable'))
                .mockResolvedValue('must not reach a fourth attempt');
            translationProviders.providers = {
                test_batch_provider: {
                    translate,
                    rateLimit: { mandatoryDelay: 0 },
                },
            };

            const request = translationProviders.translate(
                'hello',
                'en',
                'es',
                {
                    skipCache: true,
                    skipRateLimit: true,
                    retryCount,
                }
            );
            const expectation = expect(request).rejects.toThrow();
            await jest.runAllTimersAsync();
            await expectation;

            expect(translate).toHaveBeenCalledTimes(3);
            expect(setTimeoutSpy).toHaveBeenCalledTimes(2);
            expect(jest.getTimerCount()).toBe(0);
        }
    );

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

    test('bounds mandatory pacing to one normal delay after clock rollback', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(10_000);
        const setTimeoutSpy = jest.spyOn(globalThis, 'setTimeout');
        translationProviders.configuredRequestDelay = 0;
        translationProviders.providers = {
            test_batch_provider: {
                rateLimit: { mandatoryDelay: 800 },
            },
        };
        translationProviders.lastRequestTime.set(
            'test_batch_provider',
            Date.now() + 86_400_000
        );

        const delayPromise = translationProviders.applyMandatoryDelay(
            'test_batch_provider'
        );
        expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
        expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 800);

        await jest.advanceTimersByTimeAsync(800);
        await delayPromise;
        expect(
            translationProviders.lastRequestTime.get('test_batch_provider')
        ).toBe(Date.now());

        await jest.advanceTimersByTimeAsync(800);
        await translationProviders.applyMandatoryDelay('test_batch_provider');
        expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
        expect(
            translationProviders.lastRequestTime.get('test_batch_provider')
        ).toBe(Date.now());
    });

    test.each([
        ['user delay wins', 450, 120, 450],
        ['provider delay wins', 125, 600, 600],
        ['both delays are zero', 0, 0, 0],
    ])(
        'spaces provider dispatches by the maximum configured interval when %s',
        async (_label, configuredDelay, providerDelay, expectedDelay) => {
            jest.useFakeTimers();
            jest.setSystemTime(10_000);
            const setTimeoutSpy = jest.spyOn(globalThis, 'setTimeout');
            translationProviders.configuredRequestDelay = configuredDelay;
            translationProviders.providers = {
                test_batch_provider: {
                    rateLimit: { mandatoryDelay: providerDelay },
                },
            };
            translationProviders.lastRequestTime.set(
                'test_batch_provider',
                Date.now()
            );

            const delayPromise = translationProviders.applyMandatoryDelay(
                'test_batch_provider'
            );
            if (expectedDelay === 0) {
                await delayPromise;
                expect(setTimeoutSpy).not.toHaveBeenCalled();
            } else {
                expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
                expect(setTimeoutSpy).toHaveBeenCalledWith(
                    expect.any(Function),
                    expectedDelay
                );
                await jest.advanceTimersByTimeAsync(expectedDelay);
                await delayPromise;
            }
            expect(
                translationProviders.lastRequestTime.get('test_batch_provider')
            ).toBe(Date.now());
        }
    );

    test('applies the maximum delay once inside a slot even when rate-limit checks are skipped', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(20_000);
        const setTimeoutSpy = jest.spyOn(globalThis, 'setTimeout');
        translationProviders.configuredRequestDelay = 400;
        translationProviders.providers = {
            test_batch_provider: {
                rateLimit: {
                    type: 'requests_per_minute',
                    requests: 10,
                    window: 60_000,
                    mandatoryDelay: 100,
                },
            },
        };
        translationProviders.lastRequestTime.set(
            'test_batch_provider',
            Date.now()
        );

        const slotPromise = translationProviders.acquireProviderRequestSlot(
            'hello',
            { providerId: 'test_batch_provider', skipRateLimit: true }
        );
        await jest.advanceTimersByTimeAsync(0);
        expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
        expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 400);
        await jest.advanceTimersByTimeAsync(400);
        await slotPromise;
        expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    });

    test('applies a valid live translationDelay change to the next dispatch interval', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(30_000);
        const setTimeoutSpy = jest.spyOn(globalThis, 'setTimeout');
        translationProviders.configuredRequestDelay = 100;
        translationProviders.providers = {
            test_batch_provider: {
                rateLimit: { mandatoryDelay: 250 },
            },
        };
        translationProviders.lastRequestTime.set(
            'test_batch_provider',
            Date.now()
        );

        translationProviders.handleConfigurationChanges({
            translationDelay: 700,
        });
        const delayPromise = translationProviders.applyMandatoryDelay(
            'test_batch_provider'
        );

        expect(translationProviders.configuredRequestDelay).toBe(700);
        expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
        expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 700);
        await jest.advanceTimersByTimeAsync(700);
        await delayPromise;
    });

    test('resets a deleted translationDelay to the schema default for the next central slot', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(35_000);
        const setTimeoutSpy = jest.spyOn(globalThis, 'setTimeout');
        const defaultDelay = getDefaultValue('translationDelay');
        const providerDelay = Math.max(0, defaultDelay - 50);
        translationProviders.configuredRequestDelay = defaultDelay + 700;
        translationProviders.providers = {
            test_batch_provider: {
                rateLimit: {
                    type: 'requests_per_minute',
                    requests: 10,
                    window: 60_000,
                    mandatoryDelay: providerDelay,
                },
            },
        };
        translationProviders.lastRequestTime.set(
            'test_batch_provider',
            Date.now()
        );

        translationProviders.handleConfigurationChanges({
            translationDelay: undefined,
        });
        const slotPromise = translationProviders.acquireProviderRequestSlot(
            'hello',
            { providerId: 'test_batch_provider', skipRateLimit: true }
        );
        await jest.advanceTimersByTimeAsync(0);

        expect(translationProviders.configuredRequestDelay).toBe(defaultDelay);
        expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
        expect(setTimeoutSpy).toHaveBeenCalledWith(
            expect.any(Function),
            Math.max(providerDelay, defaultDelay)
        );
        await jest.advanceTimersByTimeAsync(defaultDelay);
        await slotPromise;
        expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    });

    test('ignores invalid, inherited, and accessor translationDelay changes', () => {
        translationProviders.configuredRequestDelay = 275;

        translationProviders.handleConfigurationChanges({
            translationDelay: '900',
        });
        expect(translationProviders.configuredRequestDelay).toBe(275);

        const inheritedChange = Object.create({ translationDelay: 900 });
        translationProviders.handleConfigurationChanges(inheritedChange);
        expect(translationProviders.configuredRequestDelay).toBe(275);

        let accessorReads = 0;
        const accessorChange = {};
        Object.defineProperty(accessorChange, 'translationDelay', {
            enumerable: true,
            get() {
                accessorReads++;
                return 900;
            },
        });
        translationProviders.handleConfigurationChanges(accessorChange);
        expect(accessorReads).toBe(0);
        expect(translationProviders.configuredRequestDelay).toBe(275);
    });

    test('loads a valid stored translationDelay during initialization', async () => {
        const storedDelay = 325;
        translationProviders.providers = {
            test_batch_provider: { translate: jest.fn() },
        };
        jest.spyOn(configService, 'get').mockImplementation(async (key) => {
            if (key === 'selectedProvider') return 'test_batch_provider';
            if (key === 'translationDelay') return storedDelay;
            return undefined;
        });
        jest.spyOn(configService, 'onChanged').mockImplementation(() => {});
        jest.spyOn(translationProviders, 'validateProviders').mockResolvedValue(
            {}
        );

        await translationProviders.initialize();

        expect(configService.get).toHaveBeenCalledWith('translationDelay');
        expect(translationProviders.configuredRequestDelay).toBe(storedDelay);
    });

    test.each([
        ['invalid stored value', async () => 'invalid'],
        [
            'storage rejection',
            async () => {
                throw new Error('storage unavailable');
            },
        ],
    ])(
        'falls back to the schema translationDelay default after %s',
        async (_label, readDelay) => {
            translationProviders.configuredRequestDelay = 999;
            translationProviders.providers = {
                test_batch_provider: { translate: jest.fn() },
            };
            jest.spyOn(configService, 'get').mockImplementation(async (key) => {
                if (key === 'selectedProvider') return 'test_batch_provider';
                if (key === 'translationDelay') return readDelay();
                return undefined;
            });
            jest.spyOn(configService, 'onChanged').mockImplementation(() => {});
            jest.spyOn(
                translationProviders,
                'validateProviders'
            ).mockResolvedValue({});

            await translationProviders.initialize();

            expect(translationProviders.configuredRequestDelay).toBe(
                getDefaultValue('translationDelay')
            );
        }
    );

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

    test('opts into credential events and invalidates rotated credentials without logging them', async () => {
        translationProviders.providers = {
            test_batch_provider: { translate: jest.fn() },
        };
        jest.spyOn(configService, 'get').mockImplementation(async (key) => {
            if (key === 'selectedProvider') return 'test_batch_provider';
            if (key === 'translationDelay') return 0;
            return undefined;
        });
        let configListener;
        const onChanged = jest
            .spyOn(configService, 'onChanged')
            .mockImplementation((listener) => {
                configListener = listener;
                return () => {};
            });
        jest.spyOn(translationProviders, 'validateProviders').mockResolvedValue(
            {}
        );
        await translationProviders.initialize();
        const info = jest.spyOn(translationProviders.logger, 'info');
        const debug = jest.spyOn(translationProviders.logger, 'debug');
        const cacheKey = translationProviders.generateCacheKey(
            'hello',
            'en',
            'es'
        );
        translationProviders.setCacheItem(cacheKey, 'hola');

        expect(onChanged).toHaveBeenCalledWith(expect.any(Function), {
            includeSensitive: true,
        });
        configListener({
            openaiCompatibleApiKey: 'credential-must-not-be-logged',
        });

        expect(translationProviders.getCacheItem(cacheKey)).toBeUndefined();
        expect(JSON.stringify(info.mock.calls)).not.toContain(
            'credential-must-not-be-logged'
        );
        expect(JSON.stringify(debug.mock.calls)).not.toContain(
            'credential-must-not-be-logged'
        );
    });
});
