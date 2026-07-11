/**
 * Comprehensive Error Handling System
 *
 * Provides centralized error handling, classification, and recovery
 * mechanisms for the background services.
 *
 * @author DualSub Extension
 * @version 2.0.0
 */

import { loggingManager } from './loggingManager.js';
import {
    ServiceError,
    TranslationError,
    SubtitleProcessingError,
    RateLimitError,
} from '../services/serviceInterfaces.js';

/**
 * Error severity levels
 */
export const ErrorSeverity = {
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high',
    CRITICAL: 'critical',
};

/**
 * Error categories for classification
 */
export const ErrorCategory = {
    NETWORK: 'network',
    TRANSLATION: 'translation',
    SUBTITLE: 'subtitle',
    CONFIGURATION: 'configuration',
    RATE_LIMIT: 'rate_limit',
    VALIDATION: 'validation',
    SYSTEM: 'system',
};

/**
 * Time conversion constants
 */
const MILLISECONDS_TO_SECONDS = 1000;

/**
 * Comprehensive Error Handler
 */
class ErrorHandler {
    constructor() {
        this.logger = loggingManager.createLogger('ErrorHandler');
        this.errorStats = {
            total: 0,
            byCategory: {},
            bySeverity: {},
            recentErrors: [],
        };
        this.recoveryStrategies = new Map();
        this.setupRecoveryStrategies();
    }

    /**
     * Setup default recovery strategies
     */
    setupRecoveryStrategies() {
        // Network error recovery
        this.recoveryStrategies.set(ErrorCategory.NETWORK, {
            maxRetries: 3,
            backoffMultiplier: 2,
            baseDelay: 1000,
            strategy: 'exponential_backoff',
        });

        // Translation error recovery
        this.recoveryStrategies.set(ErrorCategory.TRANSLATION, {
            maxRetries: 2,
            baseDelay: 1000,
            strategy: 'fixed_delay',
        });

        // Rate limit error recovery
        this.recoveryStrategies.set(ErrorCategory.RATE_LIMIT, {
            maxRetries: 1,
            backoffMultiplier: 2,
            baseDelay: 5000,
            strategy: 'exponential_backoff',
        });

        // Subtitle processing error recovery
        this.recoveryStrategies.set(ErrorCategory.SUBTITLE, {
            maxRetries: 2,
            strategy: 'graceful_degradation',
        });
    }

    /**
     * Handle and classify errors
     * @param {Error} error - Error to handle
     * @param {Object} context - Error context
     * @returns {Object} Error handling result
     */
    handleError(error, context = {}) {
        const errorInfo = this.classifyError(error, context);
        this.updateErrorStats(errorInfo);
        this.logError(errorInfo);

        // Determine recovery strategy
        const recovery = this.determineRecoveryStrategy(errorInfo);

        return {
            ...errorInfo,
            recovery,
            userMessage: this.generateUserMessage(errorInfo),
            shouldRetry: recovery.shouldRetry,
            retryDelay: recovery.retryDelay,
        };
    }

    /**
     * Classify error by type, severity, and category
     * @param {Error} error - Error to classify
     * @param {Object} context - Error context
     * @returns {Object} Error classification
     */
    classifyError(error, context) {
        const errorChain = [];
        const seenErrors = new Set();
        let currentError = error;
        while (
            currentError &&
            typeof currentError === 'object' &&
            !seenErrors.has(currentError)
        ) {
            errorChain.push(currentError);
            seenErrors.add(currentError);
            currentError = currentError.cause;
        }
        const messages = errorChain
            .map((entry) => entry?.message)
            .filter((message) => typeof message === 'string')
            .join(' ')
            .toLowerCase();
        const httpStatus = errorChain
            .map((entry) =>
                Number(
                    entry?.status ??
                        entry?.statusCode ??
                        entry?.response?.status
                )
            )
            .find((status) => Number.isFinite(status));
        const retryableHint = errorChain
            .map((entry) => entry?.retryable ?? entry?.shouldRetry)
            .find((value) => typeof value === 'boolean');

        const classification = {
            originalError: error,
            message: error.message,
            stack: error.stack,
            timestamp: Date.now(),
            context,
            category: ErrorCategory.SYSTEM,
            severity: ErrorSeverity.MEDIUM,
            isRecoverable: true,
            errorCode: null,
            httpStatus,
        };

        if (typeof retryableHint === 'boolean') {
            classification.isRecoverable = retryableHint;
        }

        // Classify by error type
        if (error instanceof TranslationError) {
            classification.category = ErrorCategory.TRANSLATION;
            classification.severity = ErrorSeverity.MEDIUM;
            classification.errorCode = 'TRANSLATION_FAILED';
        } else if (error instanceof SubtitleProcessingError) {
            classification.category = ErrorCategory.SUBTITLE;
            classification.severity = ErrorSeverity.MEDIUM;
            classification.errorCode = 'SUBTITLE_PROCESSING_FAILED';
        } else if (error instanceof RateLimitError) {
            classification.category = ErrorCategory.RATE_LIMIT;
            classification.severity = ErrorSeverity.HIGH;
            classification.errorCode = 'RATE_LIMIT_EXCEEDED';
        } else if (error instanceof ServiceError) {
            classification.category = ErrorCategory.SYSTEM;
            classification.severity = ErrorSeverity.HIGH;
            classification.errorCode = 'SERVICE_ERROR';
        }

        // HTTP semantics and nested provider causes take precedence over the
        // generic wrapper message.
        if (httpStatus === 401 || httpStatus === 403) {
            classification.category = ErrorCategory.CONFIGURATION;
            classification.severity = ErrorSeverity.CRITICAL;
            classification.isRecoverable = false;
            classification.errorCode = 'AUTHENTICATION_ERROR';
        } else if (httpStatus === 429) {
            classification.category = ErrorCategory.RATE_LIMIT;
            classification.severity = ErrorSeverity.HIGH;
            classification.isRecoverable = true;
            classification.errorCode = 'RATE_LIMIT_EXCEEDED';
        } else if (httpStatus >= 500) {
            classification.category = ErrorCategory.NETWORK;
            classification.severity = ErrorSeverity.HIGH;
            classification.isRecoverable = true;
            classification.errorCode = 'UPSTREAM_ERROR';
        } else if (
            errorChain.some((entry) => entry instanceof TypeError) ||
            messages.includes('network') ||
            messages.includes('fetch') ||
            messages.includes('connection') ||
            messages.includes('offline')
        ) {
            classification.category = ErrorCategory.NETWORK;
            classification.severity = ErrorSeverity.HIGH;
            classification.isRecoverable = retryableHint !== false;
            classification.errorCode = 'NETWORK_ERROR';
        } else if (
            messages.includes('api key') ||
            messages.includes('access token') ||
            messages.includes('authentication') ||
            messages.includes('not configured')
        ) {
            classification.category = ErrorCategory.CONFIGURATION;
            classification.severity = ErrorSeverity.CRITICAL;
            classification.isRecoverable = false;
            classification.errorCode = 'AUTHENTICATION_ERROR';
        } else if (
            messages.includes('rate limit') ||
            messages.includes('quota')
        ) {
            classification.category = ErrorCategory.RATE_LIMIT;
            classification.severity = ErrorSeverity.HIGH;
            classification.errorCode = 'RATE_LIMIT_EXCEEDED';
        } else if (
            messages.includes('validation') ||
            messages.includes('invalid')
        ) {
            classification.category = ErrorCategory.VALIDATION;
            classification.severity = ErrorSeverity.MEDIUM;
            classification.errorCode = 'VALIDATION_ERROR';
        }

        // Adjust severity based on context
        if (context.isCriticalPath) {
            classification.severity = ErrorSeverity.CRITICAL;
        } else if (context.hasUserImpact) {
            classification.severity = ErrorSeverity.HIGH;
        }

        return classification;
    }

    /**
     * Determine recovery strategy for error
     * @param {Object} errorInfo - Classified error information
     * @returns {Object} Recovery strategy
     */
    determineRecoveryStrategy(errorInfo) {
        const strategy = this.recoveryStrategies.get(errorInfo.category) || {
            maxRetries: 1,
            strategy: 'none',
        };

        const recovery = {
            shouldRetry:
                errorInfo.isRecoverable &&
                (errorInfo.context.retryCount || 0) < strategy.maxRetries,
            retryDelay: 0,
            strategy: strategy.strategy,
            maxRetries: strategy.maxRetries,
        };

        // Calculate retry delay
        if (recovery.shouldRetry) {
            const retryCount = errorInfo.context.retryCount || 0;

            switch (strategy.strategy) {
                case 'exponential_backoff':
                    recovery.retryDelay =
                        strategy.baseDelay *
                        Math.pow(strategy.backoffMultiplier, retryCount);
                    break;
                case 'linear_backoff':
                    recovery.retryDelay = strategy.baseDelay * (retryCount + 1);
                    break;
                case 'fixed_delay':
                    recovery.retryDelay = strategy.baseDelay;
                    break;
                default:
                    recovery.retryDelay = 1000; // Default 1 second
            }
        }

        return recovery;
    }

    /**
     * Generate user-friendly error message
     * @param {Object} errorInfo - Classified error information
     * @returns {string} User-friendly message
     */
    generateUserMessage(errorInfo) {
        const messages = {
            [ErrorCategory.NETWORK]:
                'Network connection issue. Please check your internet connection and try again.',
            [ErrorCategory.TRANSLATION]:
                'Translation service temporarily unavailable.',
            [ErrorCategory.SUBTITLE]:
                'Subtitle processing failed. Some subtitles may not be available.',
            [ErrorCategory.RATE_LIMIT]:
                'Translation rate limit reached. Please wait a moment before trying again.',
            [ErrorCategory.CONFIGURATION]:
                'Configuration error. Please check your API key settings.',
            [ErrorCategory.VALIDATION]:
                'Invalid data received. Please refresh the page and try again.',
            [ErrorCategory.SYSTEM]:
                'System error occurred. Please try again later.',
        };

        let message =
            messages[errorInfo.category] || 'An unexpected error occurred.';

        // Add recovery information
        if (errorInfo.recovery?.shouldRetry) {
            message += ` Retrying automatically in ${Math.ceil(errorInfo.recovery.retryDelay / MILLISECONDS_TO_SECONDS)} seconds.`;
        }

        return message;
    }

    /**
     * Log error with appropriate level
     * @param {Object} errorInfo - Classified error information
     */
    logError(errorInfo) {
        const logData = {
            category: errorInfo.category,
            severity: errorInfo.severity,
            errorCode: errorInfo.errorCode,
            isRecoverable: errorInfo.isRecoverable,
            context: errorInfo.context,
            stack: errorInfo.stack,
        };

        switch (errorInfo.severity) {
            case ErrorSeverity.CRITICAL:
                this.logger.error(
                    `CRITICAL ERROR: ${errorInfo.message}`,
                    errorInfo.originalError,
                    logData
                );
                break;
            case ErrorSeverity.HIGH:
                this.logger.error(
                    `HIGH SEVERITY: ${errorInfo.message}`,
                    errorInfo.originalError,
                    logData
                );
                break;
            case ErrorSeverity.MEDIUM:
                this.logger.warn(
                    `MEDIUM SEVERITY: ${errorInfo.message}`,
                    logData
                );
                break;
            case ErrorSeverity.LOW:
                this.logger.debug(
                    `LOW SEVERITY: ${errorInfo.message}`,
                    logData
                );
                break;
        }
    }

    /**
     * Update error statistics
     * @param {Object} errorInfo - Classified error information
     */
    updateErrorStats(errorInfo) {
        this.errorStats.total++;

        // Update category stats
        if (!this.errorStats.byCategory[errorInfo.category]) {
            this.errorStats.byCategory[errorInfo.category] = 0;
        }
        this.errorStats.byCategory[errorInfo.category]++;

        // Update severity stats
        if (!this.errorStats.bySeverity[errorInfo.severity]) {
            this.errorStats.bySeverity[errorInfo.severity] = 0;
        }
        this.errorStats.bySeverity[errorInfo.severity]++;

        // Keep recent errors (last 50)
        this.errorStats.recentErrors.push({
            timestamp: errorInfo.timestamp,
            category: errorInfo.category,
            severity: errorInfo.severity,
            message: errorInfo.message,
            errorCode: errorInfo.errorCode,
        });

        if (this.errorStats.recentErrors.length > 50) {
            this.errorStats.recentErrors.shift();
        }
    }

    /**
     * Get error statistics
     * @returns {Object} Error statistics
     */
    getErrorStats() {
        return {
            ...this.errorStats,
            errorRate: this.calculateErrorRate(),
            topCategories: this.getTopErrorCategories(),
            recentTrends: this.getRecentErrorTrends(),
        };
    }

    /**
     * Calculate error rate (errors per minute)
     * @returns {number} Error rate
     */
    calculateErrorRate() {
        const oneMinuteAgo = Date.now() - 60000;
        const recentErrors = this.errorStats.recentErrors.filter(
            (error) => error.timestamp > oneMinuteAgo
        );
        return recentErrors.length;
    }

    /**
     * Get top error categories
     * @returns {Array} Top error categories
     */
    getTopErrorCategories() {
        return Object.entries(this.errorStats.byCategory)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5)
            .map(([category, count]) => ({ category, count }));
    }

    /**
     * Get recent error trends
     * @returns {Object} Error trends
     */
    getRecentErrorTrends() {
        const fiveMinutesAgo = Date.now() - 300000;
        const recentErrors = this.errorStats.recentErrors.filter(
            (error) => error.timestamp > fiveMinutesAgo
        );

        const trends = {};
        recentErrors.forEach((error) => {
            if (!trends[error.category]) {
                trends[error.category] = 0;
            }
            trends[error.category]++;
        });

        return trends;
    }

    /**
     * Clear error statistics
     */
    clearStats() {
        this.errorStats = {
            total: 0,
            byCategory: {},
            bySeverity: {},
            recentErrors: [],
        };
        this.logger.debug('Error statistics cleared');
    }
}

// Export singleton instance
export const errorHandler = new ErrorHandler();

// Export error types for convenience
export {
    ServiceError,
    TranslationError,
    SubtitleProcessingError,
    RateLimitError,
};
