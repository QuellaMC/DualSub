export default {
    testEnvironment: 'jsdom',
    transform: {
        '^.+\\.jsx$': [
            'babel-jest',
            {
                presets: [
                    [
                        '@babel/preset-react',
                        {
                            runtime: 'automatic',
                        },
                    ],
                ],
            },
        ],
    },
    extensionsToTreatAsEsm: ['.jsx'],
    moduleFileExtensions: ['js', 'jsx', 'json'],
    testMatch: ['**/tests/**/*.[jt]s?(x)', '**/?(*.)+(spec|test).[jt]s?(x)'],
    testPathIgnorePatterns: ['/node_modules/', '/dist/'],
    collectCoverageFrom: [
        'utils/**/*.js',
        'services/**/*.js',
        'config/**/*.js',
        'background/**/*.js',
        'context_providers/**/*.js',
        'video_platforms/**/*.js',
        'translation_providers/**/*.js',
        'content_scripts/**/*.js',
        'shared/**/*.{js,jsx}',
        'popup/**/*.{js,jsx}',
        'options/**/*.{js,jsx}',
        'sidepanel/**/*.{js,jsx}',
        '!**/*.test.{js,jsx}',
        '!**/*.spec.{js,jsx}',
        '!**/tests/**',
    ],
    coverageThreshold: {
        global: {
            branches: 29,
            functions: 40,
            lines: 40,
            statements: 40,
        },
    },
    setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/$1',
        '^@utils/(.*)$': '<rootDir>/utils/$1',
        '^@services/(.*)$': '<rootDir>/services/$1',
        '^@config/(.*)$': '<rootDir>/config/$1',
        '^@test-utils/(.*)$': '<rootDir>/test-utils/$1',
        '^@video_platforms/(.*)$': '<rootDir>/video_platforms/$1',
        '^@translation_providers/(.*)$': '<rootDir>/translation_providers/$1',
        '^@content_scripts/(.*)$': '<rootDir>/content_scripts/$1',
        '^@popup/(.*)$': '<rootDir>/popup/$1',
        '^@options/(.*)$': '<rootDir>/options/$1',
        '^@sidepanel/(.*)$': '<rootDir>/sidepanel/$1',
        '^@shared/(.*)$': '<rootDir>/shared/$1',
        '\\.(css)$': '<rootDir>/test-utils/style-mock.js',
    },
    testEnvironmentOptions: {
        url: 'http://localhost',
        userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
    },
    clearMocks: true,
    restoreMocks: true,
    verbose: false,
    testTimeout: 10000,
};
