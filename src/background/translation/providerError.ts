import type { ProviderId } from '@/shared/providers';

export const PROVIDER_ERROR_CODES = [
    'AUTHENTICATION_ERROR',
    'RATE_LIMIT_EXCEEDED',
    'UPSTREAM_ERROR',
    'NETWORK_ERROR',
    'REQUEST_FAILED',
] as const;

export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[number];

const RETRYABLE_BY_DEFAULT: Record<ProviderErrorCode, boolean> = {
    AUTHENTICATION_ERROR: false,
    RATE_LIMIT_EXCEEDED: true,
    UPSTREAM_ERROR: true,
    NETWORK_ERROR: true,
    REQUEST_FAILED: false,
};

export interface ProviderErrorDetails {
    readonly code: ProviderErrorCode;
    /** HTTP status when the failure was a response rather than a transport error. */
    readonly status?: number;
    /** Overrides the code's default retry stance. */
    readonly retryable?: boolean;
}

function isHttpStatus(status: number | undefined): status is number {
    return (
        status !== undefined &&
        Number.isSafeInteger(status) &&
        status >= 100 &&
        status <= 599
    );
}

/**
 * The one failure shape every provider throws. `retryable` is the single
 * truth for retry decisions; `code` only selects the backoff and log label.
 * Messages describe the failure class and never carry response bodies.
 */
export class TranslationProviderError extends Error {
    override readonly name = 'TranslationProviderError';
    readonly provider: ProviderId;
    readonly code: ProviderErrorCode;
    readonly status: number | null;
    readonly retryable: boolean;

    constructor(
        provider: ProviderId,
        message: string,
        details: ProviderErrorDetails
    ) {
        super(message);
        this.provider = provider;
        this.code = details.code;
        this.status = isHttpStatus(details.status) ? details.status : null;
        this.retryable =
            details.retryable ?? RETRYABLE_BY_DEFAULT[details.code];
    }
}

export function codeForHttpStatus(status: number): ProviderErrorCode {
    if (status === 401 || status === 403) {
        return 'AUTHENTICATION_ERROR';
    }
    if (status === 429) {
        return 'RATE_LIMIT_EXCEEDED';
    }
    if (status >= 500) {
        return 'UPSTREAM_ERROR';
    }
    return 'REQUEST_FAILED';
}

/** A non-2xx response, classified by status unless the caller overrides. */
export function httpFailure(
    provider: ProviderId,
    status: number,
    overrides: Partial<ProviderErrorDetails> = {}
): TranslationProviderError {
    return new TranslationProviderError(provider, `HTTP ${status} response`, {
        code: codeForHttpStatus(status),
        status,
        ...overrides,
    });
}
