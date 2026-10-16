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
/** Three attempts for the selected provider at most; a provider covering
 *  for it gets one, so a failing chain cannot multiply requests. */
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
    readonly config: Pick<
        typeof configService,
        'get' | 'onChanged' | 'readStoredBooleanStrict'
    >;
    readonly health?: {
        readonly read: () => Promise<TranslationHealth | null>;
        readonly write: (health: TranslationHealth | null) => Promise<void>;
    };
    readonly logger?: Logger;
}

function cacheKey(
    providerId: ProviderId,
    sourceLang: string,
    targetLang: string,
    text: string
): string {
    return JSON.stringify([providerId, sourceLang, targetLang, text]);
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
 * pacer, a short result cache, and bounded retries. Every credential change
 * and every switch of the selected provider bumps a generation: a request
 * that started under the previous one is thrown away rather than cached or
 * recorded, so a rotated credential can never serve or store a stale
 * result, and a provider switched away from has no say in the health of the
 * one selected now.
 *
 * When the selected provider fails, a keyless provider covers the request
 * unless the viewer turned fallback off. A lasting failure is recorded as
 * the translation health, which the settings pages show along with the
 * provider that covered last; while it stands, requests go straight to the
 * fallback until the provider's configuration changes or the pause runs out.
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
    private generation = 0;
    private selectedProvider: ProviderId = getDefaultValue('selectedProvider');
    private configuredDelayMs: number = getDefaultValue('translationDelay');
    /** Off until the stored choice is read: subtitle text reaches another
     *  provider only when the viewer's own setting says it may. */
    private fallbackEnabled = false;
    private health: TranslationHealth | null = null;
    /** The health in memory has not reached session storage yet. */
    private healthUnsaved = false;
    private healthSaving = false;
    /** Changes received while the first read is in flight; null after it. */
    private heldChanges: SettingsChanges[] | null = null;
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
        // Subscribe before the first read so no change can slip between. A
        // change that lands while the read is in flight is newer than what
        // the read returns, so it applies after it. Credential values are
        // observed only so their rotation can invalidate cached results; the
        // handler logs key names, not values.
        const heldChanges: SettingsChanges[] = [];
        this.heldChanges = heldChanges;
        this.unsubscribe ??= this.deps.config.onChanged(
            (changes) => {
                if (this.heldChanges) {
                    this.heldChanges.push(changes);
                } else {
                    this.onConfigChanged(changes);
                }
            },
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
        try {
            this.fallbackEnabled =
                await this.deps.config.readStoredBooleanStrict(
                    'translationFallback'
                );
        } catch (error) {
            this.logger.warn(
                'Fallback choice unreadable; translating with the selected provider only',
                { reason: error instanceof Error ? error.name : 'unknown' }
            );
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
        this.heldChanges = null;
        for (const changes of heldChanges) {
            this.onConfigChanged(changes);
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
        this.generation += 1;
        this.cache.clear();
    }

    async translate(
        text: string,
        sourceLang: string,
        targetLang: string
    ): Promise<TranslationOutcome> {
        const generation = this.generation;
        const selected = this.selectedProvider;
        // What the selected provider answered stands even while it is paused.
        const known = this.cache.get(
            cacheKey(selected, sourceLang, targetLang, text)
        );
        if (known !== undefined) {
            return { translatedText: known, cached: true };
        }
        let selectedFailed = false;
        let selectedFailure: unknown;
        let failure: unknown;
        for (const providerId of this.providerChain(selected)) {
            const covering = providerId !== selected;
            // The chain was decided when the request began; the viewer may
            // have turned fallback off since.
            if (covering && !this.fallbackEnabled) {
                throw selectedFailed
                    ? selectedFailure
                    : new TranslationConfigurationChangedError();
            }
            try {
                const outcome = await this.translateWith(
                    providerId,
                    text,
                    sourceLang,
                    targetLang,
                    generation,
                    covering ? 0 : MAX_RETRIES
                );
                if (covering) {
                    this.recordCover(selected, providerId);
                } else {
                    this.recordHealth(null);
                }
                return outcome;
            } catch (error) {
                if (error instanceof TranslationConfigurationChangedError) {
                    throw error;
                }
                if (!covering) {
                    this.recordFailure(selected, error);
                    selectedFailed = true;
                    selectedFailure = error;
                }
                failure = error;
            }
        }
        this.recordCover(selected, null);
        // The selected provider's failure says whether a later try can work.
        throw selectedFailed ? selectedFailure : failure;
    }

    /** The selected provider unless a standing failure pauses it, then the
     *  keyless providers that may cover for it. */
    private providerChain(selected: ProviderId): ProviderId[] {
        const covered = this.fallbackEnabled
            ? KEYLESS_PROVIDERS.filter(
                  (id) => id !== selected && this.providers.has(id)
              )
            : [];
        const paused = covered.length > 0 && this.isPaused(selected);
        return paused ? covered : [selected, ...covered];
    }

    private isPaused(provider: ProviderId): boolean {
        if (this.health?.provider !== provider) {
            return false;
        }
        // A record dated ahead of the clock (it was set back) has run out.
        const elapsed = Date.now() - this.health.since;
        return elapsed >= 0 && elapsed < FAILING_PROVIDER_PAUSE_MS;
    }

    private recordFailure(provider: ProviderId, error: unknown): void {
        const problem = lastingProblem(error);
        if (problem === null) {
            return;
        }
        this.logger.warn('Translation provider failing', { provider, problem });
        // The provider that covered last is still the one to name until a
        // cover answers or fails.
        const fallback =
            this.health?.provider === provider ? this.health.fallback : null;
        this.recordHealth({ provider, problem, fallback, since: Date.now() });
    }

    /** Names the provider that translated in place of the failing one, or
     *  null when every cover failed too. */
    private recordCover(failing: ProviderId, cover: ProviderId | null): void {
        const health = this.health;
        if (health?.provider === failing && health.fallback !== cover) {
            this.recordHealth({ ...health, fallback: cover });
        }
    }

    private recordHealth(health: TranslationHealth | null): void {
        if (health === null && this.health === null && !this.healthUnsaved) {
            return;
        }
        this.health = health;
        this.healthUnsaved = true;
        if (!this.healthSaving) {
            this.healthSaving = true;
            void this.saveHealth();
        }
    }

    /** One write at a time, each of the newest health, so a slow earlier
     *  write never lands after a newer one. */
    private async saveHealth(): Promise<void> {
        while (this.healthUnsaved) {
            const health = this.health;
            try {
                await this.healthStore.write(health);
                if (this.health === health) {
                    this.healthUnsaved = false;
                }
            } catch (error) {
                this.logger.warn('Translation health not saved', {
                    reason: error instanceof Error ? error.name : 'unknown',
                });
                // A newer health is written next; this one stays unsaved
                // until the next record.
                if (this.health === health) {
                    break;
                }
            }
        }
        this.healthSaving = false;
    }

    /** One provider's answer, with at most `retries` more attempts. */
    private async translateWith(
        providerId: ProviderId,
        text: string,
        sourceLang: string,
        targetLang: string,
        generation: number,
        retries: number
    ): Promise<TranslationOutcome> {
        const provider = this.providers.get(providerId);
        if (!provider) {
            throw new TranslationProviderError(
                providerId,
                'Provider is not available',
                { code: 'REQUEST_FAILED' }
            );
        }
        const key = cacheKey(providerId, sourceLang, targetLang, text);

        for (let attempt = 0; ; attempt += 1) {
            try {
                this.assertGeneration(generation);
                const cached = this.cache.get(key);
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
                this.cache.set(key, translatedText);
                return { translatedText, cached: false };
            } catch (error) {
                if (this.generation !== generation) {
                    throw new TranslationConfigurationChangedError();
                }
                const delayMs =
                    attempt < retries ? retryDelay(error, attempt) : null;
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
        if (this.generation !== generation) {
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
        if (!this.providers.has(id)) {
            this.logger.warn('Unknown translation provider selected', {
                requested: id,
                active: this.selectedProvider,
            });
            return;
        }
        if (id !== this.selectedProvider) {
            this.selectedProvider = id;
            this.generation += 1;
        }
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
