import { defineContentScript } from 'wxt/utils/define-content-script';
import { installInterceptor } from '@/content/bridge/main-world/interceptor-core';
import { netflixRecipe } from '@/content/bridge/main-world/netflix-recipe';

export default defineContentScript({
    matches: ['https://*.netflix.com/*'],
    runAt: 'document_start',
    world: 'MAIN',
    registration: 'manifest',
    noScriptStartedPostMessage: true,
    main() {
        installInterceptor(netflixRecipe);
    },
});
