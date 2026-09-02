import { describe, expect, it, vi } from 'vitest';
import type { SettingsChanges } from '@/config/service';
import type { ContextProvider } from './provider';
import type { UsageStore } from './rateLimiter';
import { culturalSample } from './schemas.test';
import {
    AI_CONTEXT_DISABLED_MESSAGE,
    AI_CONTEXT_UNVERIFIED_MESSAGE,
    AiContextService,
    type AiContextServiceDeps,
} from './service';

const RUNTIME = {
    aiContextProvider: 'openai',
    aiContextCacheEnabled: true,
    aiContextCacheTTL: 3_600_000,
    aiContextMaxCacheSize: 200,
    aiContextRateLimit: 60,
    aiContextBurstLimit: 10,
    aiContextMandatoryDelay: 0,
    aiContextRetryAttempts: 3,
    aiContextRetryDelay: 2000,
};

const REQUEST_SETTINGS = {
    openaiApiKey: 'sk-test',
    openaiBaseUrl: 'https://api.openai.com/v1',
    openaiModel: 'gpt-5.6-luna',
    geminiApiKey: '',
    geminiModel: 'gemini-3.5-flash',
    aiContextTimeout: 30_000,
};

const REQUEST = {
    text: ' hola ',
    type: 'cultural',
    sourceLanguage: 'es',
    targetLanguage: 'en',
} as const;

/** The provider's response text is whatever JSON the fetch returned. */
const echoProvider: ContextProvider = {
    id: 'openai',
    identity: (settings) => `openai:${settings.openaiModel}`,
    buildRequest: () => ({ url: 'https://provider.test', init: {} }),
    readResponseText: (payload) => JSON.stringify(payload),
};

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status });
}

function harness(
    options: {
        runtime?: Partial<typeof RUNTIME>;
        enabled?: () => boolean | Promise<boolean>;
    } = {}
) {
    let listener: ((changes: SettingsChanges) => unknown) | null = null;
    const enabled = vi.fn(options.enabled ?? (() => true));
    const config = {
        getMultiple: vi.fn(() =>
            Promise.resolve({ ...RUNTIME, ...options.runtime })
        ),
        readMultipleResultStrict: vi.fn(() =>
            Promise.resolve({ values: { ...REQUEST_SETTINGS } })
        ),
        readStoredBooleanStrict: vi.fn(async () => enabled()),
        onChanged: vi.fn((callback: (changes: SettingsChanges) => unknown) => {
            listener = callback;
            return () => {
                listener = null;
            };
        }),
    };
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(() =>
        Promise.resolve(jsonResponse(culturalSample()))
    );
    const sleeps: number[] = [];
    let now = 1_000_000;
    let usage: readonly number[] = [];
    const store: UsageStore = {
        read: () => Promise.resolve(usage),
        write: (timestamps) => {
            usage = timestamps;
            return Promise.resolve();
        },
    };
    const service = new AiContextService({
        config: config as unknown as AiContextServiceDeps['config'],
        providers: [echoProvider],
        usageStore: () => store,
        fetch: fetchMock as unknown as typeof fetch,
        clock: {
            now: () => now,
            sleep: (ms) => {
                sleeps.push(ms);
                now += ms;
                return Promise.resolve();
            },
        },
    });
    return {
        service,
        config,
        enabled,
        fetchMock,
        sleeps,
        emit: (changes: SettingsChanges) => {
            if (!listener) {
                throw new Error('no listener');
            }
            listener(changes);
        },
    };
}

describe('AiContextService', () => {
    it('does not read enablement for an uninitialized service', async () => {
        const { service, config } = harness();
        await expect(service.analyze(REQUEST)).rejects.toThrow(
            'not initialized'
        );
        expect(config.readStoredBooleanStrict).not.toHaveBeenCalled();
    });

    it('fails closed without analysis work when AI context is disabled', async () => {
        const { service, fetchMock, config } = harness({
            enabled: () => false,
        });
        await service.initialize();
        expect(await service.analyze(REQUEST)).toEqual({
            success: false,
            error: AI_CONTEXT_DISABLED_MESSAGE,
            shouldRetry: false,
        });
        expect(fetchMock).not.toHaveBeenCalled();
        expect(config.readMultipleResultStrict).not.toHaveBeenCalled();
    });

    it('normalizes rejected enablement reads without leaking storage errors', async () => {
        const { service } = harness({
            enabled: () => Promise.reject(new Error('storage exploded')),
        });
        await service.initialize();
        expect(await service.analyze(REQUEST)).toEqual({
            success: false,
            error: AI_CONTEXT_UNVERIFIED_MESSAGE,
            shouldRetry: false,
        });
    });

    it('analyzes trimmed text, caches the answer, and serves the repeat from cache', async () => {
        const { service, fetchMock } = harness();
        await service.initialize();
        const first = await service.analyze(REQUEST);
        expect(first).toEqual({
            success: true,
            analysis: culturalSample(),
            cached: false,
        });
        const second = await service.analyze({ ...REQUEST, text: 'hola' });
        expect(second).toMatchObject({ success: true, cached: true });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('revalidates enablement before dispatch and result publication', async () => {
        const answers = [true, true, false];
        const { service, fetchMock } = harness({
            enabled: () => answers.shift() ?? false,
        });
        await service.initialize();
        expect(await service.analyze(REQUEST)).toMatchObject({
            success: false,
            error: AI_CONTEXT_DISABLED_MESSAGE,
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        // The suppressed answer was never cached.
        answers.push(true, true, true);
        await service.analyze(REQUEST);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('proves enablement before returning an existing cached result', async () => {
        let enabled = true;
        const { service, fetchMock } = harness({ enabled: () => enabled });
        await service.initialize();
        await service.analyze(REQUEST);
        enabled = false;
        expect(await service.analyze(REQUEST)).toMatchObject({
            success: false,
            error: AI_CONTEXT_DISABLED_MESSAGE,
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('retries retryable provider failures with serialized backoff', async () => {
        const { service, fetchMock, sleeps, enabled } = harness();
        fetchMock
            .mockResolvedValueOnce(jsonResponse({}, 503))
            .mockResolvedValueOnce(jsonResponse({}, 429));
        await service.initialize();
        expect(await service.analyze(REQUEST)).toMatchObject({
            success: true,
        });
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(sleeps).toEqual([2000, 4000]);
        // Before, after, and during backoff for each attempt, plus the gate.
        expect(enabled).toHaveBeenCalledTimes(1 + 3 * 2 + 2);
    });

    it('gives up after the configured attempts and reports retryability', async () => {
        const { service, fetchMock } = harness({
            runtime: { aiContextRetryAttempts: 2 },
        });
        fetchMock.mockResolvedValue(jsonResponse({}, 503));
        await service.initialize();
        expect(await service.analyze(REQUEST)).toEqual({
            success: false,
            error: 'API request failed: 503',
            shouldRetry: true,
        });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('stops before a retry dispatch when enablement is revoked during backoff', async () => {
        const answers = [true, true, true, false];
        const { service, fetchMock } = harness({
            enabled: () => answers.shift() ?? false,
        });
        fetchMock.mockResolvedValueOnce(jsonResponse({}, 503));
        await service.initialize();
        expect(await service.analyze(REQUEST)).toMatchObject({
            success: false,
            error: AI_CONTEXT_DISABLED_MESSAGE,
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('does not retry a provider failure that requires user action', async () => {
        const { service, fetchMock, sleeps } = harness();
        fetchMock.mockResolvedValueOnce(jsonResponse({}, 401));
        await service.initialize();
        expect(await service.analyze(REQUEST)).toEqual({
            success: false,
            error: 'API request failed: 401',
            shouldRetry: false,
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(sleeps).toEqual([]);
    });

    it('does not cache an in-flight result after credential rotation', async () => {
        const { service, fetchMock, emit } = harness();
        let release: (response: Response) => void = () => undefined;
        fetchMock.mockImplementationOnce(
            () =>
                new Promise<Response>((resolve) => {
                    release = resolve;
                })
        );
        await service.initialize();
        const pending = service.analyze(REQUEST);
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
        emit({ openaiApiKey: 'sk-rotated' });
        release(jsonResponse(culturalSample()));
        expect(await pending).toMatchObject({ success: true, cached: false });
        expect(await service.analyze(REQUEST)).toMatchObject({
            cached: false,
        });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('includes provider model and endpoint in cache identity', async () => {
        const { service, fetchMock, config } = harness();
        await service.initialize();
        await service.analyze(REQUEST);
        config.readMultipleResultStrict.mockResolvedValue({
            values: { ...REQUEST_SETTINGS, openaiModel: 'gpt-5.6' },
        });
        await service.analyze(REQUEST);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('separates identical text across languages', async () => {
        const { service, fetchMock } = harness();
        await service.initialize();
        await service.analyze(REQUEST);
        await service.analyze({ ...REQUEST, targetLanguage: 'ja' });
        await service.analyze({ ...REQUEST, sourceLanguage: 'fr' });
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('does not read or write the cache when caching is disabled', async () => {
        const { service, fetchMock } = harness({
            runtime: { aiContextCacheEnabled: false },
        });
        await service.initialize();
        await service.analyze(REQUEST);
        await service.analyze(REQUEST);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('clears the cache when cache or provider settings change', async () => {
        const { service, fetchMock, emit } = harness();
        await service.initialize();
        await service.analyze(REQUEST);
        emit({ aiContextCacheTTL: 60_000 });
        await service.analyze(REQUEST);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        emit({ aiContextCacheEnabled: false });
        await service.analyze(REQUEST);
        await service.analyze(REQUEST);
        expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    it('reports a rate limit as a final failure', async () => {
        const { service, fetchMock } = harness({
            runtime: { aiContextBurstLimit: 1 },
        });
        await service.initialize();
        await service.analyze(REQUEST);
        expect(await service.analyze({ ...REQUEST, text: 'adios' })).toEqual({
            success: false,
            error: 'Too many requests in a short time. Please slow down.',
            shouldRetry: false,
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('rejects empty text and an unknown provider without dispatching', async () => {
        const { service, fetchMock, config } = harness({
            runtime: { aiContextProvider: 'gemini' },
        });
        await service.initialize();
        expect(await service.analyze({ ...REQUEST, text: '  ' })).toEqual({
            success: false,
            error: 'Invalid or empty text provided for analysis',
            shouldRetry: false,
        });
        expect(config.readStoredBooleanStrict).not.toHaveBeenCalled();
        expect(await service.analyze(REQUEST)).toEqual({
            success: false,
            error: 'AI context provider unavailable',
            shouldRetry: false,
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('fails without provider configuration when the strict read fails', async () => {
        const { service, config } = harness();
        config.readMultipleResultStrict.mockRejectedValue(
            new Error('storage unavailable')
        );
        await service.initialize();
        expect(await service.analyze(REQUEST)).toEqual({
            success: false,
            error: 'Required provider configuration is unavailable',
            shouldRetry: false,
        });
    });
});
