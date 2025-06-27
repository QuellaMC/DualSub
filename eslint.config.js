// eslint.config.js
import globals from 'globals';
import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';

export default [
    // Global recommended rules from ESLint
    js.configs.recommended,

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
            'no-unused-vars': 'warn',
            'no-console': 'off',
        },
    },
    prettierConfig,
];
