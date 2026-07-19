const SAFE_PROVIDERS = Object.freeze(new Set(['vertex_gemini']));
const SAFE_CODES = Object.freeze(
    new Set([
        'AUTHENTICATION_ERROR',
        'RATE_LIMIT_EXCEEDED',
        'UPSTREAM_ERROR',
        'REQUEST_FAILED',
        'NETWORK_ERROR',
    ])
);
const DESCRIPTOR_READ_FAILED = Symbol('descriptor-read-failed');
const trustedMetadata = new WeakMap();

function definePublicDataField(error, key, value) {
    Object.defineProperty(error, key, {
        value,
        writable: true,
        enumerable: true,
        configurable: true,
    });
}

function getSafeProvider(provider) {
    return typeof provider === 'string' && SAFE_PROVIDERS.has(provider)
        ? provider
        : 'unknown';
}

function getOwnDataValue(value, key) {
    if (
        value === null ||
        (typeof value !== 'object' && typeof value !== 'function')
    ) {
        return undefined;
    }

    try {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return descriptor && Object.hasOwn(descriptor, 'value')
            ? descriptor.value
            : undefined;
    } catch {
        return DESCRIPTOR_READ_FAILED;
    }
}

function isSafeHttpStatus(status) {
    return Number.isSafeInteger(status) && status >= 100 && status <= 599;
}

function getSafeHttpStatus(metadata) {
    for (const key of ['status', 'statusCode']) {
        const status = getOwnDataValue(metadata, key);
        if (status === DESCRIPTOR_READ_FAILED) {
            return DESCRIPTOR_READ_FAILED;
        }
        if (isSafeHttpStatus(status)) return status;
    }

    const response = getOwnDataValue(metadata, 'response');
    if (response === DESCRIPTOR_READ_FAILED) return DESCRIPTOR_READ_FAILED;
    const nestedStatus = getOwnDataValue(response, 'status');
    if (nestedStatus === DESCRIPTOR_READ_FAILED) {
        return DESCRIPTOR_READ_FAILED;
    }
    return isSafeHttpStatus(nestedStatus) ? nestedStatus : undefined;
}

function getStatusRetryable(status) {
    return status === 429 || (status !== undefined && status >= 500);
}

function getSafeCode(metadata) {
    const code = getOwnDataValue(metadata, 'code');
    if (code === DESCRIPTOR_READ_FAILED) return DESCRIPTOR_READ_FAILED;
    return typeof code === 'string' && SAFE_CODES.has(code) ? code : undefined;
}

function getSafeMetadata(metadataOrCause) {
    const status = getSafeHttpStatus(metadataOrCause);
    if (status === DESCRIPTOR_READ_FAILED) {
        return { status: undefined, code: undefined, retryable: false };
    }

    const code = getSafeCode(metadataOrCause);
    if (code === DESCRIPTOR_READ_FAILED) {
        return { status: undefined, code: undefined, retryable: false };
    }

    const explicitRetryable = getOwnDataValue(metadataOrCause, 'retryable');
    if (explicitRetryable === DESCRIPTOR_READ_FAILED) {
        return { status: undefined, code: undefined, retryable: false };
    }

    const retryable =
        typeof explicitRetryable === 'boolean'
            ? explicitRetryable
            : status !== undefined
              ? getStatusRetryable(status)
              : false;
    return { status, code, retryable };
}

export class TranslationProviderError extends Error {
    constructor(message, provider, metadataOrCause) {
        super(message);
        const safeProvider = getSafeProvider(provider);
        definePublicDataField(this, 'name', 'TranslationProviderError');
        definePublicDataField(this, 'provider', safeProvider);

        const { status, code, retryable } = getSafeMetadata(metadataOrCause);
        if (status !== undefined) {
            definePublicDataField(this, 'status', status);
        }
        if (code !== undefined) {
            definePublicDataField(this, 'code', code);
        }
        definePublicDataField(this, 'retryable', retryable);

        const snapshot = {
            provider: safeProvider,
            ...(status === undefined ? {} : { status }),
            ...(code === undefined ? {} : { code }),
            retryable,
        };
        trustedMetadata.set(this, Object.freeze(snapshot));
    }
}

export function getTrustedTranslationProviderErrorMetadata(error) {
    const snapshot = trustedMetadata.get(error);
    return snapshot ? Object.freeze({ ...snapshot }) : null;
}
