import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier/flat';
import { defineConfig } from 'eslint/config';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const unusedVariablesRule = [
    'warn',
    {
        args: 'after-used',
        argsIgnorePattern: '^_',
        caughtErrors: 'none',
        destructuredArrayIgnorePattern: '^_',
        varsIgnorePattern: '^_',
    },
];

export default defineConfig([
    {
        ignores: [
            'node_modules/**',
            'coverage/**',
            '.wxt/**',
            '.output/**',
            'output/**',
        ],
    },
    {
        files: ['*.config.js', 'scripts/**/*.mjs'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: globals.node,
        },
        linterOptions: {
            reportUnusedDisableDirectives: 'warn',
        },
        rules: {
            ...js.configs.recommended.rules,
            'no-console': 'off',
            'no-unused-vars': unusedVariablesRule,
        },
    },
    {
        files: ['src/**/*.{ts,tsx}', 'wxt.config.ts', 'vitest.config.ts'],
        extends: [tseslint.configs.recommendedTypeChecked],
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
            globals: {
                ...globals.browser,
                ...globals.webextensions,
                ...globals.node,
            },
        },
        rules: {
            'no-console': 'off',
            '@typescript-eslint/no-unused-vars': unusedVariablesRule,
        },
    },
    {
        files: ['src/messaging/**/*.ts'],
        rules: {
            'no-restricted-syntax': [
                'error',
                {
                    selector:
                        "CallExpression[callee.object.name='z'][callee.property.name='any']",
                    message:
                        'z.any() bypasses the contract layer; model the shape.',
                },
                {
                    selector:
                        "CallExpression[callee.object.name='z'][callee.property.name='looseObject']",
                    message:
                        'Loose objects accept unknown keys; use z.strictObject.',
                },
                {
                    selector:
                        "CallExpression[callee.property.name='passthrough']",
                    message:
                        'passthrough() accepts unknown keys; use z.strictObject.',
                },
                {
                    selector: "CallExpression[callee.property.name='loose']",
                    message:
                        'loose() accepts unknown keys; use z.strictObject.',
                },
            ],
        },
    },
    {
        files: ['src/**/*.tsx'],
        plugins: {
            react,
        },
        rules: {
            ...react.configs.recommended.rules,
            'react/prop-types': 'off',
            'react/react-in-jsx-scope': 'off',
        },
        settings: {
            react: {
                version: 'detect',
            },
        },
    },
    {
        files: ['src/**/*.{ts,tsx}'],
        plugins: {
            'react-hooks': reactHooks,
        },
        rules: {
            'react-hooks/exhaustive-deps': 'warn',
            'react-hooks/rules-of-hooks': 'error',
        },
    },
    prettierConfig,
]);
