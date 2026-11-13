import { describe, expect, it, vi } from 'vitest';
import type { SettingsChanges } from '@/config/service';
import type { ContextProvider } from './provider';
import type { UsageStore } from './rateLimiter';
import { answerSample } from './schemas.test';
import { AiContextService, type AiContextServiceDeps } from './service';

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
    openaiApiKeyOrigin: 'https://api.openai.com',
    openaiBaseUrl: 'https://api.openai.com/v1',
    openaiModel: 'gpt-5.6-luna',
    geminiApiKey: '',
    geminiModel: 'gemini-3.5-flash',
    aiContextTimeout: 30_000,
};

const REQUEST = {
    text: ' hola ',
    line: 'hola amigo',
    kinds: ['linguistic', 'cultural', 'historical'],
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
        /** Whether storage holds a usable key at each check. */
        keyed?: () => boolean | Promise<boolean>;
    } = {}
) {
    let listener: ((changes: SettingsChanges) => unknown) | null = null;
    const keyed = vi.fn(options.keyed ?? (() => true));
    const config = {
        getMultiple: vi.fn(() =>
            Promise.resolve({ ...RUNTIME, ...options.runtime })
        ),
        readMultipleResultStrict: vi.fn(async (keys: readonly string[]) =>
            keys.includes('aiContextTimeout')
                ? { values: { ...REQUEST_SETTINGS } }
                : {
                      values: {
                          ...REQUEST_SETTINGS,
                          openaiApiKey: (await keyed()) ? 'sk-test' : '',
                      },
                  }
        ),
        onChanged: vi.fn((callback: (changes: SettingsChanges) => unknown) => {
            listener = callback;
            return () => {
                listener = null;
            };
        }),
    };
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(() =>
        Promise.resolve(jsonResponse(answerSample()))
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
        keyed,
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
    it('does not read the key for an uninitialized service', async () => {
        const { service, config } = harness();
        await expect(service.analyze(REQUEST)).rejects.toThrow(
            'not initialized'
        );
        expect(config.readMultipleResultStrict).not.toHaveBeenCalled();
    });

    it('asks for setup, with no work done, while no key is stored', async () => {
        const { service, fetchMock, config } = harness({
            keyed: () => false,
        });
        await service.initialize();
        expect(await service.analyze(REQUEST)).toEqual({
            success: false,
            reason: 'setup',
        });
        expect(fetchMock).not.toHaveBeenCalled();
        expect(config.readMultipleResultStrict).toHaveBeenCalledTimes(1);
    });

    it('refuses when the key cannot be read, without leaking the error', async () => {
        const { service } = harness({
            keyed: () => Promise.reject(new Error('storage exploded')),
        });
        await service.initialize();
        expect(await service.analyze(REQUEST)).toEqual({
            success: false,
            reason: 'failed',
        });
    });

    it('analyzes trimmed text, caches the answer, and serves the repeat from cache', async () => {
        const { service, fetchMock } = harness();
        await service.initialize();
        const first = await service.analyze(REQUEST);
        expect(first).toEqual({
            success: true,
            answer: answerSample(),
            cached: false,
        });
        const second = await service.analyze({ ...REQUEST, text: 'hola' });
        expect(second).toMatchObject({ success: true, cached: true });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('re-proves the key before dispatch and before the answer is used', async () => {
        const answers = [true, true, false];
        const { service, fetchMock } = harness({
            keyed: () => answers.shift() ?? false,
        });
        await service.initialize();
        expect(await service.analyze(REQUEST)).toEqual({
            success: false,
            reason: 'setup',
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        // The suppressed answer was never cached.
        answers.push(true, true, true);
        await service.analyze(REQUEST);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('proves the key before returning an existing cached result', async () => {
        let stored = true;
        const { service, fetchMock } = harness({ keyed: () => stored });
        await service.initialize();
        await service.analyze(REQUEST);
        stored = false;
        expect(await service.analyze(REQUEST)).toEqual({
            success: false,
            reason: 'setup',
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('retries retryable provider failures with serialized backoff', async () => {
        const { service, fetchMock, sleeps, keyed } = harness();
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
        expect(keyed).toHaveBeenCalledTimes(1 + 3 * 2 + 2);
    });

    it('gives up after the configured attempts and reports retryability', async () => {
        const { service, fetchMock } = harness({
            runtime: { aiContextRetryAttempts: 2 },
        });
        fetchMock.mockResolvedValue(jsonResponse({}, 503));
        await service.initialize();
        expect(await service.analyze(REQUEST)).toEqual({
            success: false,
            reason: 'failed',
        });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('stops before a retry dispatch when the key is removed during backoff', async () => {
        const answers = [true, true, true, false];
        const { service, fetchMock } = harness({
            keyed: () => answers.shift() ?? false,
        });
        fetchMock.mockResolvedValueOnce(jsonResponse({}, 503));
        await service.initialize();
        expect(await service.analyze(REQUEST)).toEqual({
            success: false,
            reason: 'setup',
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('reports a refused key without retrying it', async () => {
        const { service, fetchMock, sleeps } = harness();
        fetchMock.mockResolvedValueOnce(jsonResponse({}, 401));
        await service.initialize();
        expect(await service.analyze(REQUEST)).toEqual({
            success: false,
            reason: 'auth',
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(sleeps).toEqual([]);
    });

    it.each([
        ['value', { openaiApiKey: 'sk-rotated' }],
        ['origin', { openaiApiKeyOrigin: 'https://proxy.example.com' }],
    ])(
        "does not cache an in-flight result once the key's %s changes",
        async (_, rotation) => {
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
            emit(rotation);
            release(jsonResponse(answerSample()));
            expect(await pending).toMatchObject({
                success: true,
                cached: false,
            });
            expect(await service.analyze(REQUEST)).toMatchObject({
                cached: false,
            });
            expect(fetchMock).toHaveBeenCalledTimes(2);
        }
    );

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

    it('separates identical text across languages, lines and kinds', async () => {
        const { service, fetchMock } = harness();
        await service.initialize();
        await service.analyze(REQUEST);
        await service.analyze({ ...REQUEST, targetLanguage: 'ja' });
        await service.analyze({ ...REQUEST, sourceLanguage: 'fr' });
        await service.analyze({ ...REQUEST, line: 'hola señor' });
        fetchMock.mockResolvedValueOnce(
            jsonResponse({ meaning: 'Hello.', register: 'everyday' })
        );
        expect(await service.analyze({ ...REQUEST, kinds: [] })).toEqual({
            success: true,
            answer: { meaning: 'Hello.', register: 'everyday' },
            cached: false,
        });
        expect(fetchMock).toHaveBeenCalledTimes(5);
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
            reason: 'failed',
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('rejects empty text and an unknown provider without dispatching', async () => {
        const { service, fetchMock, keyed } = harness({
            runtime: { aiContextProvider: 'gemini' },
        });
        await service.initialize();
        expect(await service.analyze({ ...REQUEST, text: '  ' })).toEqual({
            success: false,
            reason: 'failed',
        });
        expect(await service.analyze(REQUEST)).toEqual({
            success: false,
            reason: 'failed',
        });
        expect(keyed).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('fails without provider configuration when the strict read fails', async () => {
        const { service, config } = harness();
        await service.initialize();
        config.readMultipleResultStrict.mockImplementation(
            (keys: readonly string[]) =>
                keys.includes('aiContextTimeout')
                    ? Promise.reject(new Error('storage unavailable'))
                    : Promise.resolve({ values: { ...REQUEST_SETTINGS } })
        );
        expect(await service.analyze(REQUEST)).toEqual({
            success: false,
            reason: 'failed',
        });
    });
});
