import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
    // Relative asset URLs let the same build serve from any path, including
    // a GitHub Pages project site.
    base: './',
    // The extension's toolbar icons double as the site's logo and favicon.
    publicDir: '../public/icons',
    plugins: [react()],
});
