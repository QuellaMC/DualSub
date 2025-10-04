// eslint.config.js
import globals from 'globals';
import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
    // Global recommended rules from ESLint
    js.configs.recommended,

    // Ignore third-party and temporary files
    {
        ignores: ['temp/**', 'node_modules/**', 'DualSub/**', 'dist/**'],
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

    // Configuration for React/JSX files
    {
        files: ['**/*.jsx'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            parserOptions: {
                ecmaFeatures: {
                    jsx: true,
                },
            },
            globals: {
                ...globals.browser,
                ...globals.webextensions,
                chrome: 'readonly',
            },
        },
        plugins: {
            react,
            'react-hooks': reactHooks,
        },
        rules: {
            ...react.configs.recommended.rules,
            ...reactHooks.configs.recommended.rules,
            'react/react-in-jsx-scope': 'off', // Not needed in React 17+
            'react/prop-types': 'off', // We're not using PropTypes
            'no-unused-vars': 'off',
            'no-console': 'off',
        },
        settings: {
            react: {
                version: 'detect',
            },
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
