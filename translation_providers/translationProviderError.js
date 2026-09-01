const PROVIDER_ERROR_MESSAGE = 'Translation provider request failed.';
const KNOWN_PROVIDERS = new Set(['vertex_gemini']);
const KNOWN_CODES = new Set([
    'AUTHENTICATION_ERROR',
    'RATE_LIMIT_EXCEEDED',
    'UPSTREAM_ERROR',
    'REQUEST_FAILED',
    'NETWORK_ERROR',
]);

function isHttpStatus(value) {
    return Number.isSafeInteger(value) && value >= 100 && value <= 599;
}

function retryableForStatus(status) {
    return status === 429 || status >= 500;
}

export class TranslationProviderError extends Error {
    constructor(_message, provider, metadata = {}) {
        super(PROVIDER_ERROR_MESSAGE);
        this.name = 'TranslationProviderError';
        this.provider = KNOWN_PROVIDERS.has(provider) ? provider : 'unknown';

        if (isHttpStatus(metadata.status)) {
            this.status = metadata.status;
        }
        if (KNOWN_CODES.has(metadata.code)) {
            this.code = metadata.code;
        }
        this.retryable =
            typeof metadata.retryable === 'boolean'
                ? metadata.retryable
                : this.status !== undefined && retryableForStatus(this.status);

        Object.freeze(this);
    }
}

export function getTrustedTranslationProviderErrorMetadata(error) {
    if (!(error instanceof TranslationProviderError)) return null;

    return Object.freeze({
        provider: error.provider,
        ...(error.status === undefined ? {} : { status: error.status }),
        ...(error.code === undefined ? {} : { code: error.code }),
        retryable: error.retryable,
    });
}
