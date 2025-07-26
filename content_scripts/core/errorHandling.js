/**
 * Provides custom error classes and centralized error handling utilities for the content script.
 */

/**
 * A base error class for all content script-related errors, providing consistent
 * error information including a code and additional context.
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

    /**
     * Converts the error to a JSON-serializable object.
     * @returns {Object} A plain object representing the error.
     */
    toJSON() {
        return {
            name: this.name,
            message: this.message,
            code: this.code,
            context: this.context,
            timestamp: this.timestamp,
            stack: this.stack,
        };
    }
}

/**
 * Represents an error that occurs during the initialization of a platform.
 */
export class PlatformInitializationError extends ContentScriptError {
    constructor(message, context = {}) {
        super(message, 'PLATFORM_INIT_ERROR', context);
    }
}

/**
 * Represents an error that occurs while loading a module.
 */
export class ModuleLoadingError extends ContentScriptError {
    constructor(message, moduleName, context = {}) {
        super(message, 'MODULE_LOADING_ERROR', { moduleName, ...context });
    }
}

/**
 * Represents an error related to configuration.
 */
export class ConfigurationError extends ContentScriptError {
    constructor(message, configKey, context = {}) {
        super(message, 'CONFIGURATION_ERROR', { configKey, ...context });
    }
}

/**
 * Represents an error that occurs during video element detection.
 */
export class VideoDetectionError extends ContentScriptError {
    constructor(message, context = {}) {
        super(message, 'VIDEO_DETECTION_ERROR', context);
    }
}

/**
 * A utility class for handling and tracking errors throughout the content script.
 */
export class ErrorHandler {
    /**
     * Creates a new `ErrorHandler` instance.
     * @param {Function} [logger=console.error] - The function to use for logging errors.
     */
    constructor(logger = console.error) {
        this.logger = logger;
        this.errorCounts = new Map();
    }

    /**
     * Handles and logs an error with additional context.
     * @param {Error} error - The error to handle.
     * @param {Object} [context={}] - Additional context to include with the error log.
     * @param {boolean} [shouldThrow=false] - Whether to re-throw the error after handling.
     * @returns {Object} An object containing detailed information about the handled error.
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
            stack: error.stack,
        };

        this.logger('Error handled', errorInfo);

        if (shouldThrow) {
            throw error;
        }

        return errorInfo;
    }

    /**
     * Wraps an async function with error handling.
     * @param {Function} fn - The async function to wrap.
     * @param {Object} [defaultContext={}] - Default context to apply if an error occurs.
     * @returns {Function} The wrapped async function.
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
     * Creates a `ContentScriptError` with the specified details.
     * @param {string} message - The error message.
     * @param {string} code - The error code.
     * @param {Object} [context={}] - Additional context for the error.
     * @returns {ContentScriptError} A new `ContentScriptError` instance.
     */
    createError(message, code, context = {}) {
        return new ContentScriptError(message, code, context);
    }

    /**
     * Gets statistics about the errors that have been handled.
     * @returns {Object} An object containing error statistics.
     */
    getStats() {
        const errors = Array.from(this.errorCounts.entries()).map(
            ([key, count]) => {
                const [name, message] = key.split(':');
                return { name, message, count };
            }
        );

        return {
            totalErrors: errors.reduce((sum, e) => sum + e.count, 0),
            uniqueErrors: errors.length,
            errors,
        };
    }

    /**
     * Clears all tracked error statistics.
     */
    clearStats() {
        this.errorCounts.clear();
    }
}

/**
 * A global instance of the `ErrorHandler` for convenience.
 */
export const globalErrorHandler = new ErrorHandler();

/**
 * Safely executes an async operation and returns a fallback value on error.
 * @param {Function} operation - The async operation to execute.
 * @param {*} [fallbackValue=null] - The value to return if the operation fails.
 * @param {Object} [context={}] - Additional context for error logging.
 * @returns {Promise<*>} A promise that resolves with the operation's result or the fallback value.
 */
export async function safeAsync(operation, fallbackValue = null, context = {}) {
    try {
        return await operation();
    } catch (error) {
        globalErrorHandler.handle(error, context);
        return fallbackValue;
    }
}
