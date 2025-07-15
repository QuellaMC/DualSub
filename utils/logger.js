/**
 * Global logging framework for the extension
 * Provides component-based logging with configurable debug mode
 */
class Logger {
    /**
     * Creates a new Logger instance
     * @param {string} component - The component name for this logger
     * @param {Object} configService - Optional ConfigService instance for debug mode detection
     */
    constructor(component, configService = null) {
        this.component = component;
        this.configService = configService;
        this.debugEnabled = false;
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
     * Updates debug mode from configuration
     * @returns {Promise<void>}
     */
    async updateDebugMode() {
        if (this.configService) {
            try {
                const debugMode = await this.configService.get('debugMode');
                this.debugEnabled = debugMode || false;
            } catch (error) {
                // Fallback to false if config can't be read
                this.debugEnabled = false;
            }
        }
    }

    /**
     * Logs debug information when debug mode is enabled
     * @param {string} message - The debug message
     * @param {Object} data - Additional data to log
     */
    debug(message, data = {}) {
        if (!this.debugEnabled) {
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
        const formattedMessage = this.formatMessage('INFO', message, data);
        console.info(formattedMessage);
    }

    /**
     * Logs warnings
     * @param {string} message - The warning message
     * @param {Object} data - Additional data to log
     */
    warn(message, data = {}) {
        const formattedMessage = this.formatMessage('WARN', message, data);
        console.warn(formattedMessage);
    }

    /**
     * Always logs errors with full context
     * @param {string} message - The error message
     * @param {Error} error - The error object (optional)
     * @param {Object} context - Additional context information
     */
    error(message, error = null, context = {}) {
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
