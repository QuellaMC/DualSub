import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
    plugins: [WxtVitest()],
    test: {
        include: ['src/**/*.test.{ts,tsx}'],
        environment: 'node',
        setupFiles: ['src/test-utils/setup.ts'],
        coverage: {
            provider: 'v8',
            include: ['src/**/*.{ts,tsx}'],
            exclude: [
                'src/**/*.test.{ts,tsx}',
                'src/test-utils/**',
                'src/entrypoints/*.content.ts',
                'src/entrypoints/*/main.tsx',
            ],
            thresholds: {
                lines: 78,
                statements: 78,
                functions: 78,
                branches: 72,
                'src/messaging/**': {
                    lines: 90,
                    statements: 90,
                    functions: 90,
                    branches: 85,
                },
                'src/config/**': {
                    lines: 80,
                    statements: 80,
                    functions: 80,
                    branches: 75,
                },
                'src/background/subtitle/policy.ts': {
                    lines: 90,
                    statements: 90,
                    functions: 90,
                    branches: 90,
                },
                'src/background/translation/**': {
                    lines: 90,
                    statements: 90,
                    functions: 90,
                    branches: 85,
                },
                'src/background/aicontext/**': {
                    lines: 90,
                    statements: 90,
                    functions: 80,
                    branches: 85,
                },
                'src/content/selection/**': {
                    lines: 90,
                    statements: 90,
                    functions: 90,
                    branches: 85,
                },
            },
        },
    },
});
