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
        DEBUG: 4
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
                const loggingLevel = await this.configService.get('loggingLevel');
                this.currentLevel = loggingLevel !== undefined ? loggingLevel : Logger.LEVELS.INFO;
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
        return this.currentLevel >= level && this.currentLevel > Logger.LEVELS.OFF;
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
        
        const errorData = {
            ...context,
            ...(error && {
                errorMessage: error.message,
                errorStack: error.stack,
                errorName: error.name,
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
        const baseMessage = `[${timestamp}] [${level}] [${this.component}] ${message}`;

        if (Object.keys(data).length > 0) {
            return `${baseMessage} | Data: ${JSON.stringify(data)}`;
        }

        return baseMessage;
    }
}

// Export for both CommonJS and ES modules
export default Logger;

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Logger;
} else if (typeof window !== 'undefined') {
    window.Logger = Logger;
}
