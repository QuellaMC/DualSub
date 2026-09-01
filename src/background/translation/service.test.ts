import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SettingsChanges } from '@/config/service';
import type { ProviderId } from '@/shared/providers';
import type { ProviderPacing, TranslationProvider } from './provider';
import { TranslationProviderError } from './providerError';
import { RateLimitExhaustedError } from './rateLimiter';
import {
    TranslationConfigurationChangedError,
    TranslationService,
    type TranslationServiceDeps,
} from './service';

const NO_PACING: ProviderPacing = {
    policy: { kind: 'provider' },
    minDelayMs: 0,
};

function fakeProvider(
    id: ProviderId,
    pacing: ProviderPacing = NO_PACING
): TranslationProvider & { translate: ReturnType<typeof vi.fn> } {
    const translate = vi.fn((text: string, _source: string, target: string) =>
        Promise.resolve(`[${id}:${target}] ${text}`)
    );
    return { id, pacing, translate };
}

function fakeConfig(
    settings: { selectedProvider?: ProviderId; translationDelay?: number } = {}
) {
    let listener: ((changes: SettingsChanges) => unknown) | null = null;
    const config = {
        get: vi.fn((key: string) => {
            if (key === 'selectedProvider') {
                return Promise.resolve(settings.selectedProvider ?? 'google');
            }
            if (key === 'translationDelay') {
                return Promise.resolve(settings.translationDelay ?? 0);
            }
            return Promise.resolve(undefined);
        }),
        onChanged: vi.fn((callback: (changes: SettingsChanges) => unknown) => {
            listener = callback;
            return () => {
                listener = null;
            };
        }),
    };
    return {
        config: config as unknown as TranslationServiceDeps['config'],
        emit(changes: SettingsChanges): void {
            if (!listener) {
                throw new Error('no listener');
            }
            listener(changes);
        },
        get subscribed(): boolean {
            return listener !== null;
        },
    };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    throw new Error('expected rejection');
}

const silentLogger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
};

describe('TranslationService', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('serves repeated text from the cache without touching the provider', async () => {
        const google = fakeProvider('google');
        const { config } = fakeConfig();
        const service = new TranslationService({
            providers: [google],
            config,
            logger: silentLogger,
        });
        await service.initialize();

        await expect(service.translate('Hello', 'auto', 'es')).resolves.toEqual(
            {
                translatedText: '[google:es] Hello',
                cached: false,
            }
        );
        await expect(service.translate('Hello', 'auto', 'es')).resolves.toEqual(
            {
                translatedText: '[google:es] Hello',
                cached: true,
            }
        );
        await service.translate('Hello', 'auto', 'de');
        expect(google.translate).toHaveBeenCalledTimes(2);
    });

    it('subscribes to changes before reading the stored selection', async () => {
        const fake = fakeConfig({
            selectedProvider: 'deepl',
            translationDelay: 250,
        });
        const service = new TranslationService({
            providers: [fakeProvider('google'), fakeProvider('deepl')],
            config: fake.config,
            logger: silentLogger,
        });
        const initialized = service.initialize();
        expect(fake.subscribed).toBe(true);
        await initialized;
        expect(service.activeProvider).toBe('deepl');
    });

    it('switches providers on a settings change and ignores unknown ones', async () => {
        const google = fakeProvider('google');
        const deepl = fakeProvider('deepl');
        const fake = fakeConfig();
        const service = new TranslationService({
            providers: [google, deepl],
            config: fake.config,
            logger: silentLogger,
        });
        await service.initialize();

        fake.emit({ selectedProvider: 'deepl' });
        await service.translate('Hello', 'auto', 'es');
        expect(deepl.translate).toHaveBeenCalledTimes(1);
        expect(google.translate).not.toHaveBeenCalled();

        fake.emit({ selectedProvider: 'vertex_gemini' });
        expect(service.activeProvider).toBe('deepl');
    });

    it('discards an in-flight result when a credential changes mid-request', async () => {
        const deepl = fakeProvider('deepl');
        const deferred = Promise.withResolvers<string>();
        deepl.translate.mockReturnValueOnce(deferred.promise);
        const fake = fakeConfig({ selectedProvider: 'deepl' });
        const service = new TranslationService({
            providers: [deepl],
            config: fake.config,
            logger: silentLogger,
        });
        await service.initialize();

        const pending = rejection(service.translate('Hello', 'auto', 'es'));
        await vi.advanceTimersByTimeAsync(0);
        fake.emit({ deeplApiKey: 'rotated' });
        deferred.resolve('stale');

        expect(await pending).toBeInstanceOf(
            TranslationConfigurationChangedError
        );
        await expect(service.translate('Hello', 'auto', 'es')).resolves.toEqual(
            {
                translatedText: '[deepl:es] Hello',
                cached: false,
            }
        );
        expect(deepl.translate).toHaveBeenCalledTimes(2);
    });

    it('retries a network failure with backoff and gives up after three attempts', async () => {
        const google = fakeProvider('google');
        const networkError = new TranslationProviderError('google', 'down', {
            code: 'NETWORK_ERROR',
        });
        google.translate.mockRejectedValue(networkError);
        const service = new TranslationService({
            providers: [google],
            config: fakeConfig().config,
            logger: silentLogger,
        });
        await service.initialize();

        const pending = rejection(service.translate('Hello', 'auto', 'es'));
        await vi.advanceTimersByTimeAsync(0);
        expect(google.translate).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(999);
        expect(google.translate).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(google.translate).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(2000);
        expect(google.translate).toHaveBeenCalledTimes(3);
        expect(await pending).toBe(networkError);
    });

    it('does not retry an authentication failure', async () => {
        const deepl = fakeProvider('deepl');
        deepl.translate.mockRejectedValue(
            new TranslationProviderError('deepl', 'no key', {
                code: 'AUTHENTICATION_ERROR',
            })
        );
        const service = new TranslationService({
            providers: [deepl],
            config: fakeConfig({ selectedProvider: 'deepl' }).config,
            logger: silentLogger,
        });
        await service.initialize();

        const error = await rejection(service.translate('Hello', 'auto', 'es'));
        expect(error).toBeInstanceOf(TranslationProviderError);
        expect(deepl.translate).toHaveBeenCalledTimes(1);
    });

    it('retries once after the local window is exhausted, then surfaces the reset time', async () => {
        vi.setSystemTime(100_000);
        const google = fakeProvider('google', {
            policy: { kind: 'bytes', limit: 5, windowMs: 60_000 },
            minDelayMs: 0,
        });
        const service = new TranslationService({
            providers: [google],
            config: fakeConfig().config,
            logger: silentLogger,
        });
        await service.initialize();
        await service.translate('12345', 'auto', 'es');

        const pending = rejection(service.translate('6', 'auto', 'es'));
        await vi.advanceTimersByTimeAsync(4999);
        expect(google.translate).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        const error = await pending;
        expect(error).toBeInstanceOf(RateLimitExhaustedError);
        expect((error as RateLimitExhaustedError).resetAt).toBe(160_000);
        expect(google.translate).toHaveBeenCalledTimes(1);
    });

    it('rejects blank provider output without caching it', async () => {
        const google = fakeProvider('google');
        google.translate.mockResolvedValueOnce('   ');
        const service = new TranslationService({
            providers: [google],
            config: fakeConfig().config,
            logger: silentLogger,
        });
        await service.initialize();

        const error = await rejection(service.translate('Hello', 'auto', 'es'));
        expect(error).toBeInstanceOf(TranslationProviderError);
        expect((error as TranslationProviderError).code).toBe('REQUEST_FAILED');
        await expect(service.translate('Hello', 'auto', 'es')).resolves.toEqual(
            {
                translatedText: '[google:es] Hello',
                cached: false,
            }
        );
    });

    it('applies a live translationDelay change to the next dispatch', async () => {
        vi.setSystemTime(0);
        const google = fakeProvider('google');
        const fake = fakeConfig();
        const service = new TranslationService({
            providers: [google],
            config: fake.config,
            logger: silentLogger,
        });
        await service.initialize();
        await service.translate('one', 'auto', 'es');

        fake.emit({ translationDelay: 300 });
        const pending = service.translate('two', 'auto', 'es');
        await vi.advanceTimersByTimeAsync(299);
        expect(google.translate).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        await pending;
        expect(google.translate).toHaveBeenCalledTimes(2);
    });

    it('fails when the selected provider is not registered', async () => {
        const service = new TranslationService({
            providers: [],
            config: fakeConfig().config,
            logger: silentLogger,
        });
        await service.initialize();
        const error = await rejection(service.translate('Hello', 'auto', 'es'));
        expect(error).toBeInstanceOf(TranslationProviderError);
    });

    it('stops following settings after dispose', async () => {
        const fake = fakeConfig();
        const service = new TranslationService({
            providers: [fakeProvider('google')],
            config: fake.config,
            logger: silentLogger,
        });
        await service.initialize();
        service.dispose();
        expect(fake.subscribed).toBe(false);
    });
});
