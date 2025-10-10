import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, cpSync } from 'fs';

export default defineConfig({
    plugins: [
        react(),
        {
            name: 'copy-extension-files',
            closeBundle() {
                const distDir = 'dist';
                mkdirSync(distDir, { recursive: true });
                
                // Copy manifest.json
                copyFileSync('manifest.json', `${distDir}/manifest.json`);
                
                // Copy all extension files that aren't built by Vite
                const filesToCopy = [
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
                
                filesToCopy.forEach((file) => {
                    try {
                        cpSync(file, `${distDir}/${file}`, { recursive: true });
                    } catch (err) {
                        console.warn(`Warning: Could not copy ${file}:`, err.message);
                    }
                });
            },
        },
    ],
    build: {
        rollupOptions: {
            input: {
                popup: resolve(__dirname, 'popup/popup.html'),
                options: resolve(__dirname, 'options/options.html'),
                sidepanel: resolve(__dirname, 'sidepanel/sidepanel.html'),
            },
            output: {
                entryFileNames: '[name]/[name].js',
                chunkFileNames: 'chunks/[name]-[hash].js',
                assetFileNames: (assetInfo) => {
                    if (assetInfo.name.endsWith('.css')) {
                        return '[name]/[name].css';
                    }
                    return 'assets/[name]-[hash][extname]';
                },
            },
        },
        outDir: 'dist',
        emptyOutDir: true,
    },
    resolve: {
        alias: {
            '@': resolve(__dirname, './'),
            '@popup': resolve(__dirname, './popup'),
            '@options': resolve(__dirname, './options'),
            '@sidepanel': resolve(__dirname, './sidepanel'),
            '@services': resolve(__dirname, './services'),
            '@utils': resolve(__dirname, './utils'),
        },
    },
});
