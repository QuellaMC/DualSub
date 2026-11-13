import type { SettingsValues } from '@/config/schema';
import type { configService, SettingsChanges } from '@/config/service';
import type {
    AiAnswer,
    AnswerFailure,
} from '@/messaging/contracts/analyzeContext';
import type { ContextType } from '@/shared/contextTypes';
import { createLogger } from '@/shared/logger';
import { AI_KEY_SETTINGS, aiKeyReady } from '@/shared/providers';
import { TtlCache } from '@/shared/ttlCache';
import { runProviderAnalysis } from './analysis';
import type { AnswerPromptInput } from './prompt';
import {
    PROVIDER_SETTINGS_KEYS,
    type AiContextProviderId,
    type ContextProvider,
    type ProviderSettings,
} from './provider';
import { ContextProviderError } from './providerError';
import {
    BURST_WINDOW_MS,
    ContextRateLimiter,
    ContextRateLimitError,
    sessionUsageStore,
    type RateLimitPolicy,
    type UsageStore,
} from './rateLimiter';

export const AI_CONTEXT_RUNTIME_KEYS = [
    'aiContextProvider',
    'aiContextCacheEnabled',
    'aiContextCacheTTL',
    'aiContextMaxCacheSize',
    'aiContextRateLimit',
    'aiContextBurstLimit',
    'aiContextMandatoryDelay',
    'aiContextRetryAttempts',
    'aiContextRetryDelay',
] as const;

type RuntimeConfig = Pick<
    SettingsValues,
    (typeof AI_CONTEXT_RUNTIME_KEYS)[number]
>;

const REQUEST_SETTINGS_KEYS = [
    ...PROVIDER_SETTINGS_KEYS,
    'aiContextTimeout',
] as const;

type RequestSettings = ProviderSettings &
    Pick<SettingsValues, 'aiContextTimeout'>;

const CREDENTIAL_KEYS = [
    'openaiApiKey',
    'openaiApiKeyOrigin',
    'geminiApiKey',
] as const;

/** A change to any of these can change an answer or its lifetime. */
const CACHE_IDENTITY_KEYS = [
    'aiContextProvider',
    'openaiBaseUrl',
    'openaiModel',
    'geminiModel',
    'openaiApiKey',
    'openaiApiKeyOrigin',
    'geminiApiKey',
    'aiContextCacheEnabled',
    'aiContextCacheTTL',
    'aiContextMaxCacheSize',
] as const;

const RATE_WINDOW_MS = 60_000;

export interface AnalysisRequest {
    readonly text: string;
    /** The subtitle line the words appear in. */
    readonly line: string;
    readonly kinds: readonly ContextType[];
    readonly sourceLanguage: string;
    readonly targetLanguage: string;
}

export type AnalysisOutcome =
    | {
          readonly success: true;
          readonly answer: AiAnswer;
          readonly cached: boolean;
      }
    | { readonly success: false; readonly reason: AnswerFailure };

export interface AiContextServiceDeps {
    readonly config: Pick<
        typeof configService,
        'getMultiple' | 'readMultipleResultStrict' | 'onChanged'
    >;
    readonly providers: readonly ContextProvider[];
    readonly usageStore?: (providerId: AiContextProviderId) => UsageStore;
    readonly fetch?: typeof fetch;
    readonly clock?: { now(): number; sleep(ms: number): Promise<void> };
}

function failure(reason: AnswerFailure): AnalysisOutcome {
    return { success: false, reason };
}

/** Thrown inside an attempt when no usable key is stored any more; carries
 *  the answer. */
class AnalysisGateClosed extends Error {
    override readonly name = 'AnalysisGateClosed';

    constructor(readonly outcome: AnalysisOutcome) {
        super('AI context analysis gate closed');
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The paid, privacy-sensitive service. A saved key is what turns it on, so
 * a usable key is re-proven from storage before dispatch, after every
 * attempt, and across every backoff: removing the key stops work that is
 * already in flight, and storage that cannot be read refuses. Successful
 * answers are cached per provider identity and credential generation; a
 * credential change during a flight keeps that flight's answer out of the
 * cache.
 */
export class AiContextService {
    private readonly logger = createLogger('AiContextService');
    private readonly providers: ReadonlyMap<
        AiContextProviderId,
        ContextProvider
    >;
    private readonly limiters = new Map<
        AiContextProviderId,
        ContextRateLimiter
    >();
    private readonly clock: { now(): number; sleep(ms: number): Promise<void> };
    private runtime: RuntimeConfig | null = null;
    private cache: TtlCache<AiAnswer> | null = null;
    private credentialGeneration = 0;
    private unsubscribe: (() => void) | null = null;

    constructor(private readonly deps: AiContextServiceDeps) {
        this.providers = new Map(
            deps.providers.map((provider) => [provider.id, provider])
        );
        this.clock = deps.clock ?? { now: Date.now, sleep };
    }

    get initialized(): boolean {
        return this.runtime !== null;
    }

    async initialize(): Promise<void> {
        const values = await this.deps.config.getMultiple([
            ...AI_CONTEXT_RUNTIME_KEYS,
        ]);
        this.applyRuntime(values as RuntimeConfig);
        this.unsubscribe ??= this.deps.config.onChanged(
            (changes) => this.onConfigChanged(changes),
            { includeSensitive: true }
        );
        this.logger.info('AI context service initialized', {
            provider: this.runtime?.aiContextProvider,
        });
    }

    dispose(): void {
        this.unsubscribe?.();
        this.unsubscribe = null;
        this.cache?.clear();
        this.runtime = null;
    }

    async analyze(request: AnalysisRequest): Promise<AnalysisOutcome> {
        const runtime = this.runtime;
        if (!runtime) {
            throw new Error('AI context service not initialized');
        }
        const text = request.text.trim();
        const provider = this.providers.get(runtime.aiContextProvider);
        if (text === '' || !provider) {
            return failure('failed');
        }
        const gate = await this.keyFailure(provider.id);
        if (gate) {
            return gate;
        }

        let settings: RequestSettings;
        try {
            const { values } = await this.deps.config.readMultipleResultStrict(
                [...REQUEST_SETTINGS_KEYS],
                { includeSensitive: true }
            );
            settings = values as RequestSettings;
        } catch {
            return failure('failed');
        }

        const generation = this.credentialGeneration;
        const cacheKey = JSON.stringify([
            provider.identity(settings),
            generation,
            request.kinds,
            request.sourceLanguage,
            request.targetLanguage,
            text,
            request.line,
        ]);
        const cached = this.cache?.get(cacheKey);
        if (cached) {
            return { success: true, answer: cached, cached: true };
        }

        try {
            const answer = await this.analyzeWithRetry(
                provider,
                settings,
                {
                    text,
                    line: request.line,
                    kinds: request.kinds,
                    sourceLanguage: request.sourceLanguage,
                    targetLanguage: request.targetLanguage,
                },
                runtime
            );
            if (this.cache && generation === this.credentialGeneration) {
                this.cache.set(cacheKey, answer);
            }
            return { success: true, answer, cached: false };
        } catch (error) {
            if (error instanceof AnalysisGateClosed) {
                return error.outcome;
            }
            if (error instanceof ContextRateLimitError) {
                return failure('failed');
            }
            if (error instanceof ContextProviderError) {
                this.logger.error('Context analysis failed', null, {
                    provider: provider.id,
                    code: error.code,
                    status: error.status,
                    cause:
                        error.cause instanceof Error
                            ? `${error.cause.name}: ${error.cause.message}`
                            : undefined,
                });
                if (error.code === 'NOT_CONFIGURED') {
                    return failure('setup');
                }
                return failure(
                    error.code === 'KEY_REFUSED' ? 'auth' : 'failed'
                );
            }
            this.logger.error('Context analysis failed', error, {
                provider: provider.id,
            });
            return failure('failed');
        }
    }

    private async analyzeWithRetry(
        provider: ContextProvider,
        settings: RequestSettings,
        input: AnswerPromptInput,
        runtime: RuntimeConfig
    ): Promise<AiAnswer> {
        const limiter = this.limiterFor(provider.id, runtime);
        let lastError: unknown = null;
        for (
            let attempt = 1;
            attempt <= runtime.aiContextRetryAttempts;
            attempt += 1
        ) {
            await limiter.acquire();
            await this.assertKey(provider.id);
            let answer: AiAnswer | null = null;
            try {
                answer = await runProviderAnalysis(provider, settings, input, {
                    timeoutMs: settings.aiContextTimeout,
                    fetch: this.deps.fetch ?? fetch,
                });
            } catch (error) {
                lastError = error;
            }
            await this.assertKey(provider.id);
            if (answer) {
                return answer;
            }
            if (
                !(lastError instanceof ContextProviderError) ||
                !lastError.retryable
            ) {
                throw lastError;
            }
            if (attempt < runtime.aiContextRetryAttempts) {
                const delay = runtime.aiContextRetryDelay * 2 ** (attempt - 1);
                this.logger.warn('Retrying context analysis', {
                    provider: provider.id,
                    attempt: attempt + 1,
                    maxAttempts: runtime.aiContextRetryAttempts,
                    delay,
                });
                await this.clock.sleep(delay);
                await this.assertKey(provider.id);
            }
        }
        throw lastError;
    }

    /** Null while `providerId` has a usable key in storage; a read that
     *  fails refuses, as an unknown answer is not a yes. */
    private async keyFailure(
        providerId: AiContextProviderId
    ): Promise<AnalysisOutcome | null> {
        try {
            const { values } = await this.deps.config.readMultipleResultStrict(
                [...AI_KEY_SETTINGS],
                { includeSensitive: true }
            );
            return aiKeyReady(providerId, values) ? null : failure('setup');
        } catch {
            return failure('failed');
        }
    }

    private async assertKey(providerId: AiContextProviderId): Promise<void> {
        const gate = await this.keyFailure(providerId);
        if (gate) {
            throw new AnalysisGateClosed(gate);
        }
    }

    private limiterFor(
        providerId: AiContextProviderId,
        runtime: RuntimeConfig
    ): ContextRateLimiter {
        let limiter = this.limiters.get(providerId);
        if (!limiter) {
            const store =
                this.deps.usageStore?.(providerId) ??
                sessionUsageStore(`aiContext.rateLimiter.${providerId}`);
            limiter = new ContextRateLimiter(
                store,
                rateLimitPolicy(runtime),
                this.clock
            );
            this.limiters.set(providerId, limiter);
        }
        return limiter;
    }

    private applyRuntime(runtime: RuntimeConfig): void {
        const previous = this.runtime;
        this.runtime = runtime;
        for (const limiter of this.limiters.values()) {
            limiter.configure(rateLimitPolicy(runtime));
        }
        if (!runtime.aiContextCacheEnabled) {
            this.cache = null;
            return;
        }
        if (
            !this.cache ||
            previous?.aiContextCacheTTL !== runtime.aiContextCacheTTL ||
            previous.aiContextMaxCacheSize !== runtime.aiContextMaxCacheSize
        ) {
            this.cache = new TtlCache<AiAnswer>(
                runtime.aiContextMaxCacheSize,
                runtime.aiContextCacheTTL,
                () => this.clock.now()
            );
        }
    }

    private onConfigChanged(changes: SettingsChanges): void {
        const runtime = this.runtime;
        if (!runtime) {
            return;
        }
        if (AI_CONTEXT_RUNTIME_KEYS.some((key) => changes[key] !== undefined)) {
            const next: Record<string, unknown> = { ...runtime };
            for (const key of AI_CONTEXT_RUNTIME_KEYS) {
                if (changes[key] !== undefined) {
                    next[key] = changes[key];
                }
            }
            this.applyRuntime(next as RuntimeConfig);
        }
        if (CREDENTIAL_KEYS.some((key) => changes[key] !== undefined)) {
            this.credentialGeneration += 1;
        }
        if (CACHE_IDENTITY_KEYS.some((key) => changes[key] !== undefined)) {
            this.cache?.clear();
        }
    }
}

function rateLimitPolicy(runtime: RuntimeConfig): RateLimitPolicy {
    return {
        requestsPerWindow: runtime.aiContextRateLimit,
        windowMs: RATE_WINDOW_MS,
        burstLimit: runtime.aiContextBurstLimit,
        burstWindowMs: BURST_WINDOW_MS,
        mandatoryDelayMs: runtime.aiContextMandatoryDelay,
    };
}
