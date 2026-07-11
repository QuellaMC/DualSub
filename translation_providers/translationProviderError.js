export class TranslationProviderError extends Error {
    constructor(message, provider, cause) {
        super(message, { cause });
        this.name = 'TranslationProviderError';
        this.provider = provider;

        const status = Number(
            cause?.status ?? cause?.statusCode ?? cause?.response?.status
        );
        if (Number.isFinite(status)) {
            this.status = status;
        }
        if (cause?.code !== undefined) {
            this.code = cause.code;
        }

        if (typeof cause?.retryable === 'boolean') {
            this.retryable = cause.retryable;
        } else if (Number.isFinite(status)) {
            this.retryable = status === 429 || status >= 500;
        } else if (cause instanceof TypeError) {
            this.retryable = true;
        } else if (/not configured/i.test(cause?.message || '')) {
            this.retryable = false;
        }
    }
}
