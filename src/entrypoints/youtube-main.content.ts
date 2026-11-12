import { defineContentScript } from 'wxt/utils/define-content-script';
import { installInterceptor } from '@/content/bridge/main-world/interceptor-core';
import { youtubeRecipe } from '@/content/bridge/main-world/youtube-recipe';

export default defineContentScript({
    matches: ['https://www.youtube.com/*'],
    runAt: 'document_start',
    world: 'MAIN',
    registration: 'manifest',
    noScriptStartedPostMessage: true,
    main() {
        installInterceptor(youtubeRecipe);
    },
});
