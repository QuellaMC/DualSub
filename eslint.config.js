// eslint.config.js
import globals from 'globals';
import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';

export default [
    // Global recommended rules from ESLint
    js.configs.recommended,

    // Ignore third-party and temporary files
    {
        ignores: ['temp/**', 'node_modules/**', 'DualSub/**'],
    },

    // Configuration for all JavaScript files in the project
    {
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.browser,
                ...globals.webextensions,
                ...globals.node,
                gc: 'readonly',
            },
        },

        rules: {
            'no-unused-vars': 'off',
            'no-console': 'off',
            'no-empty': ['error', { allowEmptyCatch: true }],
        },
    },

    // Configuration for Jest test files
    {
        files: ['**/*.test.js', '**/*.spec.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.browser,
                ...globals.webextensions,
                ...globals.node,
                ...globals.jest,
                gc: 'readonly',
                // Additional Jest globals
                describe: 'readonly',
                it: 'readonly',
                expect: 'readonly',
                beforeEach: 'readonly',
                afterEach: 'readonly',
                beforeAll: 'readonly',
                afterAll: 'readonly',
                jest: 'readonly',
                test: 'readonly',
                fail: 'readonly',
            },
        },

        rules: {
            'no-unused-vars': 'off',
            'no-console': 'off',
            'no-empty': ['error', { allowEmptyCatch: true }],
        },
    },
    prettierConfig,
];
