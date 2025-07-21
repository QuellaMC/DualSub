/**
 * Custom Error Classes and Error Handling Utilities
 */

/**
 * Base error class for content script errors
 */
export class ContentScriptError extends Error {
    constructor(message, code, context = {}) {
        super(message);
        this.name = this.constructor.name;
        this.code = code;
        this.context = context;
        this.timestamp = new Date().toISOString();
        
        // Maintain proper stack trace
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }

    toJSON() {
        return {
            name: this.name,
            message: this.message,
            code: this.code,
            context: this.context,
            timestamp: this.timestamp,
            stack: this.stack
        };
    }
}

/**
 * Platform initialization errors
 */
export class PlatformInitializationError extends ContentScriptError {
    constructor(message, context = {}) {
        super(message, 'PLATFORM_INIT_ERROR', context);
    }
}

/**
 * Module loading errors
 */
export class ModuleLoadingError extends ContentScriptError {
    constructor(message, moduleName, context = {}) {
        super(message, 'MODULE_LOADING_ERROR', { moduleName, ...context });
    }
}

/**
 * Configuration errors
 */
export class ConfigurationError extends ContentScriptError {
    constructor(message, configKey, context = {}) {
        super(message, 'CONFIGURATION_ERROR', { configKey, ...context });
    }
}

/**
 * Video detection errors
 */
export class VideoDetectionError extends ContentScriptError {
    constructor(message, context = {}) {
        super(message, 'VIDEO_DETECTION_ERROR', context);
    }
}

/**
 * Error handler utility class
 */
export class ErrorHandler {
    constructor(logger = console.error) {
        this.logger = logger;
        this.errorCounts = new Map();
    }

    /**
     * Handle and log error with context
     * @param {Error} error - Error to handle
     * @param {Object} context - Additional context
     * @param {boolean} shouldThrow - Whether to re-throw the error
     */
    handle(error, context = {}, shouldThrow = false) {
        const errorKey = `${error.name}:${error.message}`;
        const count = this.errorCounts.get(errorKey) || 0;
        this.errorCounts.set(errorKey, count + 1);

        const errorInfo = {
            error: error.message,
            type: error.name,
            code: error.code || 'UNKNOWN',
            context: { ...error.context, ...context },
            count: count + 1,
            stack: error.stack
        };

        this.logger('Error handled', errorInfo);

        if (shouldThrow) {
            throw error;
        }

        return errorInfo;
    }

    /**
     * Wrap async function with error handling
     * @param {Function} fn - Async function to wrap
     * @param {Object} defaultContext - Default context for errors
     * @returns {Function} Wrapped function
     */
    wrapAsync(fn, defaultContext = {}) {
        return async (...args) => {
            try {
                return await fn(...args);
            } catch (error) {
                this.handle(error, defaultContext);
                throw error;
            }
        };
    }

    /**
     * Create error with context
     * @param {string} message - Error message
     * @param {string} code - Error code
     * @param {Object} context - Error context
     * @returns {ContentScriptError}
     */
    createError(message, code, context = {}) {
        return new ContentScriptError(message, code, context);
    }

    /**
     * Get error statistics
     * @returns {Object} Error statistics
     */
    getStats() {
        const errors = Array.from(this.errorCounts.entries()).map(([key, count]) => {
            const [name, message] = key.split(':');
            return { name, message, count };
        });

        return {
            totalErrors: errors.reduce((sum, e) => sum + e.count, 0),
            uniqueErrors: errors.length,
            errors
        };
    }

    /**
     * Clear error statistics
     */
    clearStats() {
        this.errorCounts.clear();
    }
}

/**
 * Global error handler instance
 */
export const globalErrorHandler = new ErrorHandler();

/**
 * Utility function to safely execute async operations
 * @param {Function} operation - Async operation
 * @param {any} fallbackValue - Value to return on error
 * @param {Object} context - Error context
 * @returns {Promise<any>} Operation result or fallback value
 */
export async function safeAsync(operation, fallbackValue = null, context = {}) {
    try {
        return await operation();
    } catch (error) {
        globalErrorHandler.handle(error, context);
        return fallbackValue;
    }
}