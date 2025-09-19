export default {
    testEnvironment: 'jsdom',
    transform: {},
    moduleFileExtensions: ['js', 'json'],
    testMatch: [
        '**/tests/**/*.js',
        '**/?(*.)+(spec|test).js'
    ],
    collectCoverageFrom: [
        'utils/**/*.js',
        'services/**/*.js',
        'config/**/*.js',
        'video_platforms/**/*.js',
        'translation_providers/**/*.js',
        'content_scripts/**/*.js',
        'popup/**/*.js',
        'options/**/*.js',
        '!**/*.test.js',
        '!**/*.spec.js',
    ],
    setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],

    // Module name mapping for consistent imports
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/$1',
        '^@utils/(.*)$': '<rootDir>/utils/$1',
        '^@services/(.*)$': '<rootDir>/services/$1',
        '^@config/(.*)$': '<rootDir>/config/$1',
        '^@test-utils/(.*)$': '<rootDir>/test-utils/$1',
        '^@video_platforms/(.*)$': '<rootDir>/video_platforms/$1',
        '^@translation_providers/(.*)$': '<rootDir>/translation_providers/$1',
        '^@content_scripts/(.*)$': '<rootDir>/content_scripts/$1',
    },

    // Enhanced test environment settings
    testEnvironmentOptions: {
        url: 'http://localhost',
        userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    },

    // Clear mocks between tests for better isolation
    clearMocks: true,
    restoreMocks: true,

    // Verbose output for better debugging
    verbose: true,

    // Test timeout for async operations
    testTimeout: 10000,

    // Global setup for consistent test environment
    globals: {
        'process.env.NODE_ENV': 'test',
    },
};
