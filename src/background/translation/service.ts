import type { configService, SettingsChanges } from '@/config/service';
import { getDefaultValue, type SettingsKey } from '@/config/schema';
import { KEYLESS_PROVIDERS, type ProviderId } from '@/shared/providers';
import { createLogger, type Logger } from '@/shared/logger';
import {
    readTranslationHealth,
    writeTranslationHealth,
    type TranslationHealth,
} from '@/shared/translationHealth';
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
/** A provider that failed for good is skipped this long, then tried again. */
const FAILING_PROVIDER_PAUSE_MS = 10 * 60 * 1000;

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
    readonly health?: {
        readonly read: () => Promise<TranslationHealth | null>;
        readonly write: (health: TranslationHealth | null) => Promise<void>;
    };
    readonly logger?: Logger;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** What a final failure says about the provider: retrying later, with the
 *  same configuration, would fail the same way. */
function lastingProblem(error: unknown): TranslationHealth['problem'] | null {
    if (!(error instanceof TranslationProviderError)) {
        return null;
    }
    switch (error.code) {
        case 'AUTHENTICATION_ERROR':
            return 'credentials';
        case 'RATE_LIMIT_EXCEEDED':
            return error.retryable ? null : 'quota';
        case 'REQUEST_FAILED':
            return error.status === null ? null : 'rejected';
        default:
            return null;
    }
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
 *
 * When the selected provider fails, a keyless provider covers the request
 * unless the viewer turned fallback off. A lasting failure is recorded as
 * the translation health, which the settings pages show; while it stands,
 * requests go straight to the fallback until the provider's configuration
 * changes or the pause runs out.
 */
export class TranslationService {
    private readonly providers: ReadonlyMap<ProviderId, TranslationProvider>;
    private readonly pacers = new Map<ProviderId, RequestPacer>();
    private readonly cache = new TtlCache<string>(
        CACHE_MAX_ENTRIES,
        CACHE_TTL_MS
    );
    private readonly logger: Logger;
    private readonly healthStore: NonNullable<TranslationServiceDeps['health']>;
    private cacheGeneration = 0;
    private selectedProvider: ProviderId = getDefaultValue('selectedProvider');
    private configuredDelayMs: number = getDefaultValue('translationDelay');
    private fallbackEnabled: boolean = getDefaultValue('translationFallback');
    private health: TranslationHealth | null = null;
    private unsubscribe: (() => void) | null = null;

    constructor(private readonly deps: TranslationServiceDeps) {
        this.providers = new Map(
            deps.providers.map((provider) => [provider.id, provider])
        );
        this.logger = deps.logger ?? createLogger('TranslationService');
        this.healthStore = deps.health ?? {
            read: readTranslationHealth,
            write: writeTranslationHealth,
        };
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
            const [provider, delayMs, fallback] = await Promise.all([
                this.deps.config.get('selectedProvider'),
                this.deps.config.get('translationDelay'),
                this.deps.config.get('translationFallback'),
            ]);
            this.selectProvider(provider);
            this.configuredDelayMs = delayMs;
            this.fallbackEnabled = fallback;
        } catch (error) {
            this.logger.error('Failed to load translation settings', error);
        }
        try {
            const health = await this.healthStore.read();
            this.health =
                health?.provider === this.selectedProvider ? health : null;
        } catch (error) {
            this.logger.warn('Translation health unreadable', {
                reason: error instanceof Error ? error.name : 'unknown',
            });
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
        const selected = this.selectedProvider;
        let failure: unknown = null;
        for (const providerId of this.providerChain(selected)) {
            try {
                const outcome = await this.translateWith(
                    providerId,
                    text,
                    sourceLang,
                    targetLang,
                    generation
                );
                if (providerId === selected) {
                    this.recordHealth(null);
                }
                return outcome;
            } catch (error) {
                if (error instanceof TranslationConfigurationChangedError) {
                    throw error;
                }
                if (providerId === selected) {
                    this.recordFailure(selected, error);
                }
                failure = error;
            }
        }
        throw failure;
    }

    /** The selected provider unless a standing failure pauses it, then the
     *  keyless providers that may cover for it. */
    private providerChain(selected: ProviderId): ProviderId[] {
        const covered = this.fallbackEnabled
            ? KEYLESS_PROVIDERS.filter(
                  (id) => id !== selected && this.providers.has(id)
              )
            : [];
        const paused =
            covered.length > 0 &&
            this.health?.provider === selected &&
            Date.now() < this.health.since + FAILING_PROVIDER_PAUSE_MS;
        return paused ? covered : [selected, ...covered];
    }

    private recordFailure(provider: ProviderId, error: unknown): void {
        const problem = lastingProblem(error);
        if (problem === null) {
            return;
        }
        const fallback = this.fallbackEnabled
            ? (KEYLESS_PROVIDERS.find(
                  (id) => id !== provider && this.providers.has(id)
              ) ?? null)
            : null;
        this.logger.warn('Translation provider failing', {
            provider,
            problem,
            fallback,
        });
        this.recordHealth({ provider, problem, fallback, since: Date.now() });
    }

    private recordHealth(health: TranslationHealth | null): void {
        if (health === null && this.health === null) {
            return;
        }
        this.health = health;
        void this.healthStore.write(health).catch((error: unknown) => {
            this.logger.warn('Translation health not saved', {
                reason: error instanceof Error ? error.name : 'unknown',
            });
        });
    }

    private async translateWith(
        providerId: ProviderId,
        text: string,
        sourceLang: string,
        targetLang: string,
        generation: number
    ): Promise<TranslationOutcome> {
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
        if (changes.translationFallback !== undefined) {
            this.fallbackEnabled = changes.translationFallback;
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
        // A new provider, credential, or fallback choice deserves a fresh
        // try; the next lasting failure records itself again.
        if (
            invalidating.length > 0 ||
            changes.selectedProvider !== undefined ||
            changes.translationFallback !== undefined
        ) {
            this.recordHealth(null);
        }
    }
}
