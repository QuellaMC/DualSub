export const ContextProviderErrorCode = {
    NOT_CONFIGURED: 'NOT_CONFIGURED',
    NETWORK_ERROR: 'NETWORK_ERROR',
    TIMEOUT: 'TIMEOUT',
    UPSTREAM_ERROR: 'UPSTREAM_ERROR',
    MALFORMED_RESPONSE: 'MALFORMED_RESPONSE',
    SAFETY_BLOCKED: 'SAFETY_BLOCKED',
} as const;

export type ContextProviderErrorCode =
    (typeof ContextProviderErrorCode)[keyof typeof ContextProviderErrorCode];

function isRetryableCode(code: ContextProviderErrorCode, status?: number) {
    switch (code) {
        case 'NETWORK_ERROR':
        case 'TIMEOUT':
        case 'MALFORMED_RESPONSE':
            return true;
        case 'UPSTREAM_ERROR':
            return status === 429 || (status !== undefined && status >= 500);
        case 'NOT_CONFIGURED':
        case 'SAFETY_BLOCKED':
            return false;
    }
}

/**
 * One taxonomy for every context-provider failure. Whether a failure is
 * worth another attempt is decided here, once, from its code: transient
 * transport trouble and unusable model output are; a missing key or a
 * safety refusal are not.
 */
export class ContextProviderError extends Error {
    override readonly name = 'ContextProviderError';
    readonly code: ContextProviderErrorCode;
    readonly status: number | undefined;
    readonly retryable: boolean;

    constructor(
        code: ContextProviderErrorCode,
        message: string,
        options: { status?: number; cause?: unknown } = {}
    ) {
        super(message, { cause: options.cause });
        this.code = code;
        this.status = options.status;
        this.retryable = isRetryableCode(code, options.status);
    }
}
