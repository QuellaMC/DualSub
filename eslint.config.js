import react from '@eslint-react/eslint-plugin';
import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier/flat';
import { defineConfig } from 'eslint/config';
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
        ignores: ['node_modules/**', 'coverage/**', '.wxt/**', 'dist/**'],
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
            '@typescript-eslint/consistent-type-imports': 'error',
            eqeqeq: ['error', 'always', { null: 'ignore' }],
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
        extends: [react.configs['recommended-type-checked']],
        rules: {
            // A ref is named for what it holds, like any other value.
            '@eslint-react/naming-convention-ref-name': 'off',
            // Index keys are kept for lists rendered whole from data that
            // never reorders, where equal items may repeat.
            '@eslint-react/no-array-index-key': 'off',
            // eslint-plugin-react-hooks owns the hook rules; these are this
            // plugin's own copies of them.
            '@eslint-react/error-boundaries': 'off',
            '@eslint-react/exhaustive-deps': 'off',
            '@eslint-react/purity': 'off',
            '@eslint-react/rules-of-hooks': 'off',
            '@eslint-react/set-state-in-effect': 'off',
            '@eslint-react/set-state-in-render': 'off',
            '@eslint-react/static-components': 'off',
            '@eslint-react/unsupported-syntax': 'off',
            '@eslint-react/use-memo': 'off',
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
