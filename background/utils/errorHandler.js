import { loggingManager } from './loggingManager.js';
import {
    ServiceError,
    TranslationError,
    SubtitleProcessingError,
    RateLimitError,
} from '../services/serviceInterfaces.js';
import { getTrustedTranslationProviderErrorMetadata } from '../../translation_providers/translationProviderError.js';

export const ErrorSeverity = Object.freeze({
    MEDIUM: 'medium',
    HIGH: 'high',
    CRITICAL: 'critical',
});

export const ErrorCategory = Object.freeze({
    NETWORK: 'network',
    TRANSLATION: 'translation',
    SUBTITLE: 'subtitle',
    CONFIGURATION: 'configuration',
    RATE_LIMIT: 'rate_limit',
    VALIDATION: 'validation',
    SYSTEM: 'system',
});

const PROVIDER_ERROR_MESSAGE = 'Translation provider request failed.';
const SERVICE_ERROR_MESSAGE = 'Service request failed.';
const RECOVERY = {
    [ErrorCategory.NETWORK]: {
        maxRetries: 2,
        baseDelay: 1000,
        backoffMultiplier: 2,
        strategy: 'exponential_backoff',
    },
    [ErrorCategory.TRANSLATION]: {
        maxRetries: 2,
        baseDelay: 1000,
        strategy: 'fixed_delay',
    },
    [ErrorCategory.RATE_LIMIT]: {
        maxRetries: 1,
        baseDelay: 5000,
        backoffMultiplier: 2,
        strategy: 'exponential_backoff',
    },
    [ErrorCategory.SUBTITLE]: {
        maxRetries: 2,
        strategy: 'graceful_degradation',
    },
};
const USER_MESSAGES = {
    [ErrorCategory.NETWORK]:
        'Network connection issue. Please check your internet connection and try again.',
    [ErrorCategory.TRANSLATION]:
        'Translation provider temporarily unavailable.',
    [ErrorCategory.SUBTITLE]:
        'Subtitle processing failed. Some subtitles may not be available.',
    [ErrorCategory.RATE_LIMIT]:
        'Request rate limit reached. Please wait a moment before trying again.',
    [ErrorCategory.CONFIGURATION]:
        'Configuration error. Please check your provider settings.',
    [ErrorCategory.VALIDATION]:
        'Invalid data received. Please refresh the page and try again.',
    [ErrorCategory.SYSTEM]: 'System error occurred. Please try again later.',
};

function providerClassification(metadata) {
    if (metadata.status === 401 || metadata.status === 403) {
        return [
            ErrorCategory.CONFIGURATION,
            ErrorSeverity.CRITICAL,
            'AUTHENTICATION_ERROR',
        ];
    }
    if (metadata.status === 429) {
        return [
            ErrorCategory.RATE_LIMIT,
            ErrorSeverity.HIGH,
            'RATE_LIMIT_EXCEEDED',
        ];
    }
    if (metadata.status >= 500) {
        return [ErrorCategory.NETWORK, ErrorSeverity.HIGH, 'UPSTREAM_ERROR'];
    }

    switch (metadata.code) {
        case 'AUTHENTICATION_ERROR':
            return [
                ErrorCategory.CONFIGURATION,
                ErrorSeverity.CRITICAL,
                metadata.code,
            ];
        case 'RATE_LIMIT_EXCEEDED':
            return [
                ErrorCategory.RATE_LIMIT,
                ErrorSeverity.HIGH,
                metadata.code,
            ];
        case 'UPSTREAM_ERROR':
        case 'NETWORK_ERROR':
            return [ErrorCategory.NETWORK, ErrorSeverity.HIGH, metadata.code];
        default:
            return [
                ErrorCategory.TRANSLATION,
                ErrorSeverity.MEDIUM,
                'REQUEST_FAILED',
            ];
    }
}

function safeOperationalContext(context, provider) {
    const safe = {};
    const safeProvider = provider ?? context?.provider;
    if (
        typeof safeProvider === 'string' &&
        /^[a-z][a-z0-9_-]{0,63}$/.test(safeProvider)
    ) {
        safe.provider = safeProvider;
    }
    if (
        context?.operation === 'translate' ||
        context?.operation === 'analyzeContext'
    ) {
        safe.operation = context.operation;
    }
    if (Number.isSafeInteger(context?.textLength) && context.textLength >= 0) {
        safe.textLength = context.textLength;
    }
    if (Number.isSafeInteger(context?.retryCount) && context.retryCount >= 0) {
        safe.retryCount = context.retryCount;
    }
    if (typeof context?.hasUserImpact === 'boolean') {
        safe.hasUserImpact = context.hasUserImpact;
    }
    if (typeof context?.isCriticalPath === 'boolean') {
        safe.isCriticalPath = context.isCriticalPath;
    }
    return Object.freeze(safe);
}

function classifyProviderError(metadata, context) {
    const safeContext = safeOperationalContext(context, metadata.provider);
    const [category, mappedSeverity, errorCode] =
        providerClassification(metadata);
    const severity = safeContext.isCriticalPath
        ? ErrorSeverity.CRITICAL
        : safeContext.hasUserImpact && mappedSeverity === ErrorSeverity.MEDIUM
          ? ErrorSeverity.HIGH
          : mappedSeverity;

    return {
        originalError: null,
        message: PROVIDER_ERROR_MESSAGE,
        context: safeContext,
        provider: metadata.provider,
        category,
        severity,
        isRecoverable: metadata.retryable,
        errorCode,
        httpStatus: metadata.status ?? null,
    };
}

function collectErrorChain(error) {
    const chain = [];
    const seen = new Set();
    let current = error;
    while (current && typeof current === 'object' && !seen.has(current)) {
        chain.push(current);
        seen.add(current);
        current = current.cause;
    }
    return chain;
}

function classifyGenericError(error, context) {
    const safeContext = safeOperationalContext(context);
    const chain = collectErrorChain(error);
    const messages = chain
        .map((item) => item?.message)
        .filter((message) => typeof message === 'string')
        .join(' ')
        .toLowerCase();
    const httpStatus = chain
        .map((item) =>
            Number(item?.status ?? item?.statusCode ?? item?.response?.status)
        )
        .find(Number.isFinite);
    const retryable = chain
        .map((item) => item?.retryable ?? item?.shouldRetry)
        .find((value) => typeof value === 'boolean');
    const info = {
        originalError: null,
        message: SERVICE_ERROR_MESSAGE,
        context: safeContext,
        category: ErrorCategory.SYSTEM,
        severity: ErrorSeverity.MEDIUM,
        isRecoverable: retryable ?? true,
        errorCode: null,
        httpStatus,
    };

    if (error instanceof TranslationError) {
        Object.assign(info, {
            category: ErrorCategory.TRANSLATION,
            errorCode: 'TRANSLATION_FAILED',
        });
    } else if (error instanceof SubtitleProcessingError) {
        Object.assign(info, {
            category: ErrorCategory.SUBTITLE,
            errorCode: 'SUBTITLE_PROCESSING_FAILED',
        });
    } else if (error instanceof RateLimitError) {
        Object.assign(info, {
            category: ErrorCategory.RATE_LIMIT,
            severity: ErrorSeverity.HIGH,
            errorCode: 'RATE_LIMIT_EXCEEDED',
        });
    } else if (error instanceof ServiceError) {
        Object.assign(info, {
            severity: ErrorSeverity.HIGH,
            errorCode: 'SERVICE_ERROR',
        });
    }

    if (httpStatus === 401 || httpStatus === 403) {
        Object.assign(info, {
            category: ErrorCategory.CONFIGURATION,
            severity: ErrorSeverity.CRITICAL,
            isRecoverable: false,
            errorCode: 'AUTHENTICATION_ERROR',
        });
    } else if (httpStatus === 429) {
        Object.assign(info, {
            category: ErrorCategory.RATE_LIMIT,
            severity: ErrorSeverity.HIGH,
            errorCode: 'RATE_LIMIT_EXCEEDED',
        });
    } else if (httpStatus >= 500) {
        Object.assign(info, {
            category: ErrorCategory.NETWORK,
            severity: ErrorSeverity.HIGH,
            errorCode: 'UPSTREAM_ERROR',
        });
    } else if (
        chain.some((item) => item instanceof TypeError) ||
        /network|fetch|connection|offline/.test(messages)
    ) {
        Object.assign(info, {
            category: ErrorCategory.NETWORK,
            severity: ErrorSeverity.HIGH,
            errorCode: 'NETWORK_ERROR',
        });
    } else if (
        /api key|access token|authentication|not configured/.test(messages)
    ) {
        Object.assign(info, {
            category: ErrorCategory.CONFIGURATION,
            severity: ErrorSeverity.CRITICAL,
            isRecoverable: false,
            errorCode: 'AUTHENTICATION_ERROR',
        });
    } else if (/rate limit|quota/.test(messages)) {
        Object.assign(info, {
            category: ErrorCategory.RATE_LIMIT,
            severity: ErrorSeverity.HIGH,
            errorCode: 'RATE_LIMIT_EXCEEDED',
        });
    } else if (/validation|invalid/.test(messages)) {
        Object.assign(info, {
            category: ErrorCategory.VALIDATION,
            errorCode: 'VALIDATION_ERROR',
        });
    }

    if (safeContext.isCriticalPath) info.severity = ErrorSeverity.CRITICAL;
    else if (safeContext.hasUserImpact) info.severity = ErrorSeverity.HIGH;
    return info;
}

function recoveryFor(errorInfo) {
    const strategy = RECOVERY[errorInfo.category] ?? {
        maxRetries: 1,
        strategy: 'none',
    };
    const retryCount = errorInfo.context?.retryCount ?? 0;
    const shouldRetry =
        errorInfo.isRecoverable && retryCount < strategy.maxRetries;
    let retryDelay = 0;
    if (shouldRetry) {
        retryDelay =
            strategy.strategy === 'exponential_backoff'
                ? strategy.baseDelay *
                  Math.pow(strategy.backoffMultiplier, retryCount)
                : (strategy.baseDelay ?? 1000);
    }
    return {
        shouldRetry,
        retryDelay,
        strategy: strategy.strategy,
        maxRetries: strategy.maxRetries,
    };
}

function userMessageFor(errorInfo, recovery) {
    let message = USER_MESSAGES[errorInfo.category];
    if (recovery.shouldRetry) {
        message += ` Retrying automatically in ${Math.ceil(recovery.retryDelay / 1000)} seconds.`;
    }
    return message;
}

class ErrorHandler {
    constructor() {
        this.logger = loggingManager.createLogger('ErrorHandler');
    }

    handleError(error, context = {}) {
        const metadata = getTrustedTranslationProviderErrorMetadata(error);
        const info = metadata
            ? classifyProviderError(metadata, context)
            : classifyGenericError(error, context);
        const recovery = recoveryFor(info);
        this.log(info);
        return {
            ...info,
            recovery,
            userMessage: userMessageFor(info, recovery),
            shouldRetry: recovery.shouldRetry,
            retryDelay: recovery.retryDelay,
        };
    }

    log(info) {
        const data = {
            category: info.category,
            severity: info.severity,
            errorCode: info.errorCode,
            isRecoverable: info.isRecoverable,
            context: info.context,
        };
        try {
            if (
                info.severity === ErrorSeverity.CRITICAL ||
                info.severity === ErrorSeverity.HIGH
            ) {
                this.logger.error(info.message, info.originalError, data);
            } else {
                this.logger.warn(info.message, data);
            }
        } catch {
            // Logging must not change retry or user-facing behavior.
        }
    }
}

export const errorHandler = new ErrorHandler();

export {
    ServiceError,
    TranslationError,
    SubtitleProcessingError,
    RateLimitError,
};
