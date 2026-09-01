import { configService, type SettingsChanges } from '@/config/service';
import { getDefaultValue, type SettingsKey } from '@/config/schema';
import type { ProviderId } from '@/shared/providers';
import { createLogger, type Logger } from '@/shared/logger';
import { TtlCache } from '@/shared/ttlCache';
import type { TranslationProvider } from './provider';
import { TranslationProviderError } from './providerError';
import { RateLimitExhaustedError, RequestPacer } from './rateLimiter';

/** Provider configuration whose change makes every cached result stale. */
export const TRANSLATION_CACHE_CONFIGURATION_KEYS = [
    'deeplApiKey',
    'deeplApiPlan',
    'openaiCompatibleApiKey',
    'openaiCompatibleBaseUrl',
    'openaiCompatibleModel',
    'vertexAccessToken',
    'vertexProjectId',
    'vertexLocation',
    'vertexModel',
] as const satisfies readonly SettingsKey[];

const CACHE_MAX_ENTRIES = 1000;
const CACHE_TTL_MS = 5 * 60 * 1000;
/** Three attempts per request at most. */
const MAX_RETRIES = 2;
const RATE_LIMIT_RETRY_DELAY_MS = 5000;
const RETRY_BASE_DELAY_MS = 1000;

/** The request outlived a credential or provider change; its result is stale. */
export class TranslationConfigurationChangedError extends Error {
    override readonly name = 'TranslationConfigurationChangedError';

    constructor() {
        super('Translation configuration changed during the request');
    }
}

export interface TranslationOutcome {
    readonly translatedText: string;
    readonly cached: boolean;
}

export interface TranslationServiceDeps {
    readonly providers: readonly TranslationProvider[];
    readonly config: Pick<typeof configService, 'get' | 'onChanged'>;
    readonly logger?: Logger;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Delay before the next attempt, or null when the failure is final. */
function retryDelay(error: unknown, attempt: number): number | null {
    if (error instanceof RateLimitExhaustedError) {
        return attempt < 1 ? RATE_LIMIT_RETRY_DELAY_MS : null;
    }
    if (
        !(error instanceof TranslationProviderError) ||
        !error.retryable ||
        attempt >= MAX_RETRIES
    ) {
        return null;
    }
    switch (error.code) {
        case 'RATE_LIMIT_EXCEEDED':
            return attempt < 1 ? RATE_LIMIT_RETRY_DELAY_MS : null;
        case 'NETWORK_ERROR':
        case 'UPSTREAM_ERROR':
            return RETRY_BASE_DELAY_MS * 2 ** attempt;
        default:
            return RETRY_BASE_DELAY_MS;
    }
}

/**
 * Translates through the selected provider with a per-provider request
 * pacer, a short result cache, and bounded retries. Every provider
 * configuration change bumps a cache generation: an in-flight request that
 * started under the previous generation is thrown away rather than cached,
 * so a rotated credential can never serve or store a stale result.
 */
export class TranslationService {
    private readonly providers: ReadonlyMap<ProviderId, TranslationProvider>;
    private readonly pacers = new Map<ProviderId, RequestPacer>();
    private readonly cache = new TtlCache<string>(
        CACHE_MAX_ENTRIES,
        CACHE_TTL_MS
    );
    private readonly logger: Logger;
    private cacheGeneration = 0;
    private selectedProvider: ProviderId = getDefaultValue('selectedProvider');
    private configuredDelayMs: number = getDefaultValue('translationDelay');
    private unsubscribe: (() => void) | null = null;

    constructor(private readonly deps: TranslationServiceDeps) {
        this.providers = new Map(
            deps.providers.map((provider) => [provider.id, provider])
        );
        this.logger = deps.logger ?? createLogger('TranslationService');
    }

    /** Follows the provider selection and pacing settings. Never throws. */
    async initialize(): Promise<void> {
        // Subscribe before the initial read so no change can slip between.
        // Credential values are observed only so their rotation can
        // invalidate cached results; the handler logs key names, not values.
        this.unsubscribe ??= this.deps.config.onChanged(
            (changes) => this.onConfigChanged(changes),
            { includeSensitive: true }
        );
        try {
            const [provider, delayMs] = await Promise.all([
                this.deps.config.get('selectedProvider'),
                this.deps.config.get('translationDelay'),
            ]);
            this.selectProvider(provider);
            this.configuredDelayMs = delayMs;
        } catch (error) {
            this.logger.error('Failed to load translation settings', error);
        }
        this.logger.info('Translation service initialized', {
            provider: this.selectedProvider,
            delayMs: this.configuredDelayMs,
        });
    }

    dispose(): void {
        this.unsubscribe?.();
        this.unsubscribe = null;
    }

    get activeProvider(): ProviderId {
        return this.selectedProvider;
    }

    clearCache(): void {
        this.cacheGeneration += 1;
        this.cache.clear();
    }

    async translate(
        text: string,
        sourceLang: string,
        targetLang: string
    ): Promise<TranslationOutcome> {
        const generation = this.cacheGeneration;
        const providerId = this.selectedProvider;
        const provider = this.providers.get(providerId);
        if (!provider) {
            throw new TranslationProviderError(
                providerId,
                'Provider is not available',
                { code: 'REQUEST_FAILED' }
            );
        }
        const cacheKey = JSON.stringify([
            providerId,
            sourceLang,
            targetLang,
            text,
        ]);

        for (let attempt = 0; ; attempt += 1) {
            try {
                this.assertGeneration(generation);
                const cached = this.cache.get(cacheKey);
                if (cached !== undefined) {
                    return { translatedText: cached, cached: true };
                }
                await this.pacerFor(provider).acquire(
                    text,
                    this.configuredDelayMs
                );
                this.assertGeneration(generation);
                const translatedText = await provider.translate(
                    text,
                    sourceLang,
                    targetLang
                );
                if (translatedText.trim() === '') {
                    throw new TranslationProviderError(
                        providerId,
                        'Provider returned no text',
                        { code: 'REQUEST_FAILED' }
                    );
                }
                this.assertGeneration(generation);
                this.cache.set(cacheKey, translatedText);
                return { translatedText, cached: false };
            } catch (error) {
                if (this.cacheGeneration !== generation) {
                    throw new TranslationConfigurationChangedError();
                }
                const delayMs = retryDelay(error, attempt);
                if (delayMs === null) {
                    throw error;
                }
                this.logger.info('Retrying translation', {
                    provider: providerId,
                    attempt: attempt + 1,
                    delayMs,
                });
                await sleep(delayMs);
            }
        }
    }

    private assertGeneration(generation: number): void {
        if (this.cacheGeneration !== generation) {
            throw new TranslationConfigurationChangedError();
        }
    }

    private pacerFor(provider: TranslationProvider): RequestPacer {
        let pacer = this.pacers.get(provider.id);
        if (!pacer) {
            pacer = new RequestPacer(provider.pacing);
            this.pacers.set(provider.id, pacer);
        }
        return pacer;
    }

    private selectProvider(id: ProviderId): void {
        if (this.providers.has(id)) {
            this.selectedProvider = id;
            return;
        }
        this.logger.warn('Unknown translation provider selected', {
            requested: id,
            active: this.selectedProvider,
        });
    }

    private onConfigChanged(changes: SettingsChanges): void {
        if (changes.translationDelay !== undefined) {
            this.configuredDelayMs = changes.translationDelay;
        }
        if (changes.selectedProvider !== undefined) {
            this.selectProvider(changes.selectedProvider);
        }
        const invalidating = TRANSLATION_CACHE_CONFIGURATION_KEYS.filter(
            (key) => changes[key] !== undefined
        );
        if (invalidating.length > 0) {
            this.clearCache();
            this.logger.info(
                'Translation cache invalidated after provider configuration change',
                { changedKeys: invalidating }
            );
        }
    }
}
