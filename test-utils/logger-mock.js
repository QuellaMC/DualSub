/**
 * Logger Mock Utility
 *
 * Provides consistent logger mocking utilities for testing.
 * This utility creates mock implementations of logger functionality.
 */

import { jest } from '@jest/globals';

class LoggerMock {
    constructor() {
        this.logs = [];
        this.debugMode = false;
    }

    debug = jest.fn((message, context = {}) => {
        const logEntry = {
            level: 'debug',
            message,
            context,
            timestamp: new Date().toISOString(),
        };
        this.logs.push(logEntry);
        if (this.debugMode) {
            console.log('[DEBUG]', message, context);
        }
    });

    info = jest.fn((message, context = {}) => {
        const logEntry = {
            level: 'info',
            message,
            context,
            timestamp: new Date().toISOString(),
        };
        this.logs.push(logEntry);
        if (this.debugMode) {
            console.log('[INFO]', message, context);
        }
    });

    warn = jest.fn((message, context = {}) => {
        const logEntry = {
            level: 'warn',
            message,
            context,
            timestamp: new Date().toISOString(),
        };
        this.logs.push(logEntry);
        if (this.debugMode) {
            console.warn('[WARN]', message, context);
        }
    });

    error = jest.fn((message, context = {}) => {
        const logEntry = {
            level: 'error',
            message,
            context,
            timestamp: new Date().toISOString(),
        };
        this.logs.push(logEntry);
        if (this.debugMode) {
            console.error('[ERROR]', message, context);
        }
    });

    /**
     * Get all logged messages
     * @returns {Array} Array of log entries
     */
    getLogs() {
        return [...this.logs];
    }

    /**
     * Get logs filtered by level
     * @param {string} level - Log level to filter by
     * @returns {Array} Filtered log entries
     */
    getLogsByLevel(level) {
        return this.logs.filter((log) => log.level === level);
    }

    /**
     * Get logs containing specific message text
     * @param {string} messageText - Text to search for in messages
     * @returns {Array} Matching log entries
     */
    getLogsByMessage(messageText) {
        return this.logs.filter(
            (log) => log.message && log.message.includes(messageText)
        );
    }

    /**
     * Check if a specific message was logged
     * @param {string} level - Log level
     * @param {string} message - Message to check for
     * @returns {boolean} True if message was logged
     */
    wasLogged(level, message) {
        return this.logs.some(
            (log) => log.level === level && log.message === message
        );
    }

    /**
     * Enable debug mode to see console output during tests
     * @param {boolean} enabled - Whether to enable debug mode
     */
    setDebugMode(enabled) {
        this.debugMode = enabled;
    }

    /**
     * Clear all logged messages
     */
    clearLogs() {
        this.logs = [];
    }

    /**
     * Reset logger mock to clean state
     */
    reset() {
        this.logs = [];
        this.debugMode = false;
        jest.clearAllMocks();
    }

    /**
     * Create assertion helpers for common test patterns
     */
    get assertions() {
        return {
            /**
             * Assert that a message was logged at a specific level
             * @param {string} level - Expected log level
             * @param {string} message - Expected message
             */
            toHaveLogged: (level, message) => {
                const found = this.wasLogged(level, message);
                return {
                    pass: found,
                    message: () =>
                        found
                            ? `Expected not to have logged ${level}: "${message}"`
                            : `Expected to have logged ${level}: "${message}"`,
                };
            },

            /**
             * Assert that a specific number of messages were logged
             * @param {number} count - Expected number of log messages
             */
            toHaveLoggedCount: (count) => {
                const actualCount = this.logs.length;
                return {
                    pass: actualCount === count,
                    message: () =>
                        `Expected ${count} log messages, but got ${actualCount}`,
                };
            },

            /**
             * Assert that no errors were logged
             */
            toHaveNoErrors: () => {
                const errors = this.getLogsByLevel('error');
                return {
                    pass: errors.length === 0,
                    message: () =>
                        `Expected no errors, but found ${errors.length}: ${JSON.stringify(errors)}`,
                };
            },
        };
    }
}

/**
 * Mock a logger module for tests
 * @param {string} modulePath - Path to the logger module to mock
 * @param {LoggerMock} loggerMock - Logger mock instance
 * @returns {Function} Cleanup function to restore original module
 */
function mockLogger(modulePath, loggerMock = new LoggerMock()) {
    jest.doMock(modulePath, () => loggerMock);

    // Return cleanup function
    return () => {
        jest.dontMock(modulePath);
    };
}

/**
 * Create a logger mock that matches the application's logger interface
 * @param {Object} options - Configuration options
 * @returns {LoggerMock} Configured logger mock
 */
function createLoggerMock(options = {}) {
    const mock = new LoggerMock();

    if (options.debugMode) {
        mock.setDebugMode(true);
    }

    return mock;
}

export { LoggerMock, mockLogger, createLoggerMock };
