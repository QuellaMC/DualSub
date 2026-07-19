// Import jest for ES modules compatibility
import { jest, beforeEach, afterEach } from '@jest/globals';

// Import centralized mock utilities
import { ChromeApiMock } from './test-utils/chrome-api-mock.js';
import {
    LocationMock,
    mockWindowLocation,
} from './test-utils/location-mock.js';
import { LoggerMock } from './test-utils/logger-mock.js';

// Global mock instances for reuse across tests
global.mockInstances = {
    chromeApi: ChromeApiMock.create(),
    location: new LocationMock(),
    logger: new LoggerMock(),
};

// Setup Chrome API mock globally
global.chrome = global.mockInstances.chromeApi;

// Mock console methods to capture logs in tests while preserving original functionality
const originalConsole = { ...console };
global.console = {
    ...originalConsole,
    debug: jest.fn((...args) => {
        if (process.env.JEST_VERBOSE === 'true') {
            originalConsole.debug(...args);
        }
    }),
    info: jest.fn((...args) => {
        if (process.env.JEST_VERBOSE === 'true') {
            originalConsole.info(...args);
        }
    }),
    warn: jest.fn((...args) => {
        if (process.env.JEST_VERBOSE === 'true') {
            originalConsole.warn(...args);
        }
    }),
    error: jest.fn((...args) => {
        if (process.env.JEST_VERBOSE === 'true') {
            originalConsole.error(...args);
        }
    }),
};

// Global cleanup function for test isolation
global.resetAllMocks = () => {
    // Reset all centralized mocks
    global.mockInstances.chromeApi.reset();
    global.mockInstances.location.reset();
    global.mockInstances.logger.reset();

    // Clear all Jest mocks
    jest.clearAllMocks();

    // Reset console mocks
    global.console.debug.mockClear();
    global.console.info.mockClear();
    global.console.warn.mockClear();
    global.console.error.mockClear();
};

// Global test utilities
global.testUtils = {
    /**
     * Create a Netflix location mock
     * @param {string} movieId - Netflix movie ID
     */
    setupNetflixLocation: (movieId = '12345') => {
        const netflixLocation = LocationMock.createNetflixMock(movieId);
        if (global.window) {
            // Use property-level mocking to avoid redefining window.location
            try {
                mockWindowLocation(netflixLocation);
            } catch (_) {}
        }
        global.mockInstances.location = netflixLocation;
        return netflixLocation;
    },

    /**
     * Create a Disney Plus location mock
     * @param {string} contentId - Disney Plus content ID
     */
    setupDisneyPlusLocation: (contentId = 'abc123') => {
        const disneyLocation = LocationMock.createDisneyPlusMock(contentId);
        if (global.window) {
            // Use property-level mocking to avoid redefining window.location
            try {
                mockWindowLocation(disneyLocation);
            } catch (_) {}
        }
        global.mockInstances.location = disneyLocation;
        return disneyLocation;
    },

    /**
     * Setup Chrome storage with test data
     * @param {Object} data - Data to populate storage with
     */
    setupChromeStorage: (data = {}) => {
        global.mockInstances.chromeApi.storage.data.clear();
        Object.keys(data).forEach((key) => {
            global.mockInstances.chromeApi.storage.data.set(key, data[key]);
        });
    },

    /**
     * Get logged messages from logger mock
     * @param {string} level - Optional log level filter
     */
    getLoggedMessages: (level = null) => {
        return level
            ? global.mockInstances.logger.getLogsByLevel(level)
            : global.mockInstances.logger.getLogs();
    },
};

// Setup global beforeEach and afterEach for consistent test isolation
beforeEach(() => {
    // Reset all mocks before each test
    global.resetAllMocks();
});

afterEach(() => {
    // Additional cleanup after each test if needed
    // This ensures no test state leaks to the next test
    // Location mocking will be handled at the individual test level when needed
});
