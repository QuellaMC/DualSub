const REDACTED_VALUE = '[REDACTED]';
const CIRCULAR_VALUE = '[Circular]';
const UNSERIALIZABLE_VALUE = '[Unserializable]';

const SENSITIVE_KEY_FRAGMENTS = [
    'apikey',
    'accesstoken',
    'privatekey',
    'authorization',
    'password',
    'secret',
    'credential',
    'serviceaccount',
];

function isSensitiveKey(key) {
    const normalizedKey = String(key)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');

    return SENSITIVE_KEY_FRAGMENTS.some((fragment) =>
        normalizedKey.includes(fragment)
    );
}

function redactUrlQueryDetails(value) {
    return value.replace(/\bhttps?:\/\/[^\s<>"']+/gi, (candidate) => {
        try {
            const url = new URL(candidate);
            if (!url.search && !url.hash) {
                return candidate;
            }
            return `${url.origin}${url.pathname}${url.search ? `?${REDACTED_VALUE}` : ''}${url.hash ? `#${REDACTED_VALUE}` : ''}`;
        } catch {
            return candidate;
        }
    });
}

function redactSensitiveText(value) {
    const redacted = String(value)
        .replace(
            /-----BEGIN(?: [A-Z]+)* PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z]+)* PRIVATE KEY-----/g,
            REDACTED_VALUE
        )
        .replace(/\bBearer\s+[^\s,;]+/gi, `Bearer ${REDACTED_VALUE}`)
        .replace(
            /([?&](?:api[_-]?key|access[_-]?token|authorization|password|secret|credential)=)[^&#\s]*/gi,
            `$1${REDACTED_VALUE}`
        )
        .replace(
            /(\b(?:api[_ -]?key|access[_ -]?token|private[_ -]?key|authorization|password|secret|credential|service[_ -]?account)\b\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi,
            `$1${REDACTED_VALUE}`
        );
    return redactUrlQueryDetails(redacted);
}

function redactSensitiveData(value, seen = new WeakSet()) {
    if (typeof value === 'string') {
        return redactSensitiveText(value);
    }

    if (
        value === null ||
        typeof value === 'number' ||
        typeof value === 'boolean'
    ) {
        return value;
    }

    if (typeof value === 'undefined') {
        return undefined;
    }

    if (typeof value === 'bigint' || typeof value === 'symbol') {
        return String(value);
    }

    if (typeof value === 'function') {
        return `[Function ${value.name || 'anonymous'}]`;
    }

    if (seen.has(value)) {
        return CIRCULAR_VALUE;
    }

    if (value instanceof Date) {
        return Number.isNaN(value.getTime())
            ? 'Invalid Date'
            : value.toISOString();
    }

    seen.add(value);

    try {
        if (value instanceof Error) {
            const redactedError = {
                name: redactSensitiveText(value.name),
                message: redactSensitiveText(value.message),
                ...(value.stack && {
                    stack: redactSensitiveText(value.stack),
                }),
            };

            for (const key of Object.keys(value)) {
                if (key in redactedError) {
                    continue;
                }
                redactedError[key] = isSensitiveKey(key)
                    ? REDACTED_VALUE
                    : redactSensitiveData(value[key], seen);
            }

            return redactedError;
        }

        if (Array.isArray(value)) {
            return value.map((item) => redactSensitiveData(item, seen));
        }

        const redactedObject = Object.create(null);
        for (const key of Object.keys(value)) {
            if (isSensitiveKey(key)) {
                redactedObject[key] = REDACTED_VALUE;
                continue;
            }

            try {
                redactedObject[key] = redactSensitiveData(value[key], seen);
            } catch {
                redactedObject[key] = UNSERIALIZABLE_VALUE;
            }
        }
        return redactedObject;
    } catch {
        return UNSERIALIZABLE_VALUE;
    } finally {
        seen.delete(value);
    }
}

function hasLogData(data) {
    if (data === null || typeof data === 'undefined') {
        return false;
    }

    if (Array.isArray(data)) {
        return data.length > 0;
    }

    return typeof data !== 'object' || Object.keys(data).length > 0;
}

function isErrorLike(value) {
    return (
        value instanceof Error ||
        (value !== null &&
            typeof value === 'object' &&
            typeof value.message === 'string' &&
            (typeof value.stack === 'string' ||
                String(value.name || '').endsWith('Error')))
    );
}

/**
 * Global logging framework for the extension
 * Provides component-based logging with configurable logging levels
 */
class Logger {
    /**
     * Logging level constants
     */
    static LEVELS = {
        OFF: 0,
        ERROR: 1,
        WARN: 2,
        INFO: 3,
        DEBUG: 4,
    };

    /**
     * Creates a new Logger instance
     * @param {string} component - The component name for this logger
     * @param {Object} configService - Optional ConfigService instance for logging level detection
     */
    constructor(component, configService = null) {
        this.component = component;
        this.configService = configService;
        this.currentLevel = Logger.LEVELS.INFO; // Default level
    }

    /**
     * Factory method to create logger instances
     * @param {string} component - The component name
     * @param {Object} configService - Optional ConfigService instance
     * @returns {Logger} New Logger instance
     */
    static create(component, configService = null) {
        return new Logger(component, configService);
    }

    /**
     * Updates logging level from configuration or direct value
     * @param {number} level - Optional direct level to set
     * @returns {Promise<void>}
     */
    async updateLevel(level = null) {
        if (level !== null) {
            // Direct level setting
            this.currentLevel = level;
            return;
        }

        if (this.configService) {
            try {
                const loggingLevel =
                    await this.configService.get('loggingLevel');
                this.currentLevel =
                    loggingLevel !== undefined
                        ? loggingLevel
                        : Logger.LEVELS.INFO;
            } catch (error) {
                // Fallback to INFO level if config can't be read
                this.currentLevel = Logger.LEVELS.INFO;
            }
        }
    }

    /**
     * Checks if a message should be logged based on current level
     * @param {number} level - The level to check
     * @returns {boolean} True if message should be logged
     */
    shouldLog(level) {
        return (
            this.currentLevel >= level && this.currentLevel > Logger.LEVELS.OFF
        );
    }

    /**
     * Logs debug information when debug level is enabled
     * @param {string} message - The debug message
     * @param {Object} data - Additional data to log
     */
    debug(message, data = {}) {
        if (!this.shouldLog(Logger.LEVELS.DEBUG)) {
            return;
        }
        const formattedMessage = this.formatMessage('DEBUG', message, data);
        console.debug(formattedMessage);
    }

    /**
     * Logs informational messages
     * @param {string} message - The info message
     * @param {Object} data - Additional data to log
     */
    info(message, data = {}) {
        if (!this.shouldLog(Logger.LEVELS.INFO)) {
            return;
        }
        const formattedMessage = this.formatMessage('INFO', message, data);
        console.info(formattedMessage);
    }

    /**
     * Logs warnings
     * @param {string} message - The warning message
     * @param {Object} data - Additional data to log
     */
    warn(message, data = {}) {
        if (!this.shouldLog(Logger.LEVELS.WARN)) {
            return;
        }
        const formattedMessage = this.formatMessage('WARN', message, data);
        console.warn(formattedMessage);
    }

    /**
     * Logs errors with full context
     * @param {string} message - The error message
     * @param {Error} error - The error object (optional)
     * @param {Object} context - Additional context information
     */
    error(message, error = null, context = {}) {
        if (!this.shouldLog(Logger.LEVELS.ERROR)) {
            return;
        }

        const actualError = isErrorLike(error) ? error : null;
        const actualContext =
            error !== null && typeof error === 'object' && !actualError
                ? { ...error, ...context }
                : context;
        const errorData = {
            ...actualContext,
            ...(actualError && {
                errorMessage: actualError.message,
                errorStack: actualError.stack,
                errorName: actualError.name,
            }),
        };

        const formattedMessage = this.formatMessage(
            'ERROR',
            message,
            errorData
        );
        console.error(formattedMessage);
    }

    /**
     * Formats log messages consistently
     * @param {string} level - The log level
     * @param {string} message - The message to format
     * @param {Object} data - Additional data to include
     * @returns {string} Formatted message
     */
    formatMessage(level, message, data) {
        const timestamp = new Date().toISOString();
        const safeMessage = redactSensitiveText(message);
        const baseMessage = `[${timestamp}] [${level}] [${this.component}] ${safeMessage}`;
        const safeData = redactSensitiveData(data);

        if (hasLogData(safeData)) {
            return `${baseMessage} | Data: ${JSON.stringify(safeData)}`;
        }

        return baseMessage;
    }
}

export default Logger;
