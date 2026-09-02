import { configService } from '@/config/service';
import type { SettingsKey, SettingsValues } from '@/config/schema';
import type { ProviderId } from '@/shared/providers';
import {
    cancelResponseBodySafely,
    fetchWithTimeout,
    readResponseTextWithLimit,
} from '@/shared/fetchWithTimeout';
import {
    TranslationProviderError,
    httpFailure,
    type ProviderErrorDetails,
} from './providerError';

export type RateLimitPolicy =
    | {
          readonly kind: 'bytes' | 'characters' | 'requests';
          readonly limit: number;
          readonly windowMs: number;
      }
    /** The provider owns quota truth; only local spacing applies. */
    | { readonly kind: 'provider' };

export interface ProviderPacing {
    readonly policy: RateLimitPolicy;
    /** Minimum spacing between dispatches to this provider. */
    readonly minDelayMs: number;
}

export interface TranslationProvider {
    readonly id: ProviderId;
    readonly pacing: ProviderPacing;
    /** Resolves the translated text; rejects only with TranslationProviderError. */
    readonly translate: (
        text: string,
        sourceLang: string,
        targetLang: string
    ) => Promise<string>;
}

export const MAX_PROVIDER_RESPONSE_BYTES = 1024 * 1024;

/** Provider requests carry only what the provider config puts in them:
 *  the browser's cookies for the provider's domain stay out. */
export async function providerFetch(
    provider: ProviderId,
    url: string,
    init?: RequestInit
): Promise<Response> {
    try {
        return await fetchWithTimeout(url, { ...init, credentials: 'omit' });
    } catch {
        throw new TranslationProviderError(provider, 'Network request failed', {
            code: 'NETWORK_ERROR',
        });
    }
}

/** The classified failure for a non-OK response; the body is discarded. */
export function httpFailureFrom(
    provider: ProviderId,
    response: Response,
    overrides: Partial<ProviderErrorDetails> = {}
): TranslationProviderError {
    cancelResponseBodySafely(response);
    return httpFailure(provider, response.status, overrides);
}

export async function readProviderText(
    provider: ProviderId,
    response: Response
): Promise<string> {
    try {
        return await readResponseTextWithLimit(
            response,
            MAX_PROVIDER_RESPONSE_BYTES
        );
    } catch {
        throw new TranslationProviderError(
            provider,
            'Response body unreadable',
            {
                code: 'REQUEST_FAILED',
            }
        );
    }
}

export async function readProviderJson(
    provider: ProviderId,
    response: Response
): Promise<unknown> {
    const text = await readProviderText(provider, response);
    try {
        return JSON.parse(text) as unknown;
    } catch {
        throw new TranslationProviderError(provider, 'Response was not JSON', {
            code: 'REQUEST_FAILED',
        });
    }
}

export function malformedResponse(
    provider: ProviderId
): TranslationProviderError {
    return new TranslationProviderError(provider, 'Malformed response body', {
        code: 'REQUEST_FAILED',
    });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object';
}

/**
 * Authoritative read of a provider's settings, credentials included. A
 * storage failure is reported as a retryable request failure rather than as
 * "not configured", so a transient outage never masquerades as a bad key.
 */
export async function readProviderSettings<K extends SettingsKey>(
    provider: ProviderId,
    keys: readonly K[]
): Promise<Pick<SettingsValues, K>> {
    let values: Partial<SettingsValues>;
    try {
        ({ values } = await configService.readMultipleResultStrict(keys, {
            includeSensitive: true,
        }));
    } catch {
        throw new TranslationProviderError(
            provider,
            'Provider settings could not be read',
            { code: 'REQUEST_FAILED', retryable: true }
        );
    }
    if (keys.some((key) => !Object.hasOwn(values, key))) {
        throw new TranslationProviderError(
            provider,
            'Provider settings could not be read',
            { code: 'REQUEST_FAILED', retryable: true }
        );
    }
    return values as Pick<SettingsValues, K>;
}

export function missingCredential(
    provider: ProviderId,
    what: string
): TranslationProviderError {
    return new TranslationProviderError(provider, `${what} is not configured`, {
        code: 'AUTHENTICATION_ERROR',
    });
}
