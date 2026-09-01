import { defineContentScript } from 'wxt/utils/define-content-script';
import { installInterceptor } from '@/content/bridge/main-world/interceptor-core';
import { disneyRecipe } from '@/content/bridge/main-world/disney-recipe';

export default defineContentScript({
    matches: ['https://*.disneyplus.com/*'],
    runAt: 'document_start',
    world: 'MAIN',
    registration: 'manifest',
    noScriptStartedPostMessage: true,
    main() {
        installInterceptor(disneyRecipe);
    },
});
