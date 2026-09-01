import { defineConfig } from 'wxt';

// Permissions and hosts are pinned byte-identical to the shipped v2.5 manifest;
// src/build/manifestSnapshot.test.ts enforces it against the golden file.
export default defineConfig({
    srcDir: 'src',
    modules: ['@wxt-dev/module-react'],
    imports: false,
    manifest: {
        name: '__MSG_appName__',
        description: '__MSG_appDesc__',
        default_locale: 'en',
        minimum_chrome_version: '116',
        permissions: ['storage', 'activeTab', 'sidePanel'],
        host_permissions: [
            'https://*.disneyplus.com/*',
            'https://*.netflix.com/*',
            'https://*.media.dssott.com/*',
            'https://*.dssedge.com/*',
            'https://*.nflxvideo.net/*',
            'https://translate.googleapis.com/*',
            'https://api.cognitive.microsofttranslator.com/*',
            'https://edge.microsoft.com/*',
            'https://api-free.deepl.com/*',
            'https://api.deepl.com/*',
            'https://aiplatform.googleapis.com/*',
            'https://us-central1-aiplatform.googleapis.com/*',
            'https://us-east1-aiplatform.googleapis.com/*',
            'https://us-west1-aiplatform.googleapis.com/*',
            'https://europe-west1-aiplatform.googleapis.com/*',
            'https://europe-west4-aiplatform.googleapis.com/*',
            'https://asia-northeast1-aiplatform.googleapis.com/*',
            'https://asia-southeast1-aiplatform.googleapis.com/*',
            'https://oauth2.googleapis.com/*',
            'https://api.openai.com/*',
            'https://generativelanguage.googleapis.com/*',
        ],
        optional_host_permissions: [
            'https://*/*',
            'http://localhost/*',
            'http://127.0.0.1/*',
        ],
        icons: {
            16: 'icons/icon16.png',
            48: 'icons/icon48.png',
            128: 'icons/icon128.png',
        },
        action: {
            default_icon: {
                16: 'icons/icon16.png',
                48: 'icons/icon48.png',
                128: 'icons/icon128.png',
            },
        },
    },
});
