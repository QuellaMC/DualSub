import { copyFileSync, cpSync, existsSync, mkdirSync } from 'node:fs';
import { basename, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const distDir = resolve(rootDir, 'dist');

const productionPaths = [
    'background.js',
    'background',
    'services',
    'utils',
    'icons',
    '_locales',
    'config',
    'content_scripts',
    'injected_scripts',
    'video_platforms',
    'translation_providers',
    'context_providers',
];

function isDevelopmentArtifact(sourcePath) {
    const pathSegments = relative(rootDir, sourcePath).split(sep);
    const fileName = basename(sourcePath);

    return (
        pathSegments.includes('tests') ||
        pathSegments.includes('__tests__') ||
        /\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(fileName) ||
        /^test-.*\.[cm]?js$/i.test(fileName) ||
        /\.(?:md|map)$/i.test(fileName) ||
        fileName === '.DS_Store'
    );
}

function copyExtensionSources() {
    mkdirSync(distDir, { recursive: true });

    const manifestPath = resolve(rootDir, 'manifest.json');
    if (!existsSync(manifestPath)) {
        throw new Error(`Required extension file is missing: ${manifestPath}`);
    }
    copyFileSync(manifestPath, resolve(distDir, 'manifest.json'));

    for (const relativePath of productionPaths) {
        const sourcePath = resolve(rootDir, relativePath);
        if (!existsSync(sourcePath)) {
            throw new Error(
                `Required production path is missing: ${sourcePath}`
            );
        }

        cpSync(sourcePath, resolve(distDir, relativePath), {
            recursive: true,
            filter: (candidatePath) => !isDevelopmentArtifact(candidatePath),
        });
    }
}

export default defineConfig({
    plugins: [
        react(),
        {
            name: 'copy-extension-sources',
            closeBundle: copyExtensionSources,
        },
    ],
    build: {
        rollupOptions: {
            input: {
                popup: resolve(rootDir, 'popup/popup.html'),
                options: resolve(rootDir, 'options/options.html'),
                sidepanel: resolve(rootDir, 'sidepanel/sidepanel.html'),
            },
            output: {
                entryFileNames: '[name]/[name].js',
                chunkFileNames: 'chunks/[name]-[hash].js',
                assetFileNames: (assetInfo) => {
                    const assetName =
                        assetInfo.names?.[0] ??
                        assetInfo.originalFileNames?.[0] ??
                        'asset';
                    if (assetName.endsWith('.css')) {
                        return '[name]/[name].css';
                    }
                    return 'assets/[name]-[hash][extname]';
                },
            },
        },
        outDir: distDir,
        emptyOutDir: true,
    },
    resolve: {
        alias: {
            '@': rootDir,
            '@popup': resolve(rootDir, 'popup'),
            '@options': resolve(rootDir, 'options'),
            '@sidepanel': resolve(rootDir, 'sidepanel'),
            '@shared': resolve(rootDir, 'shared'),
            '@services': resolve(rootDir, 'services'),
            '@utils': resolve(rootDir, 'utils'),
        },
    },
});
