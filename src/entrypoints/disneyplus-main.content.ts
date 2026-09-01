import { defineContentScript } from 'wxt/utils/define-content-script';
import { installSpikeProbe } from '@/content/bridge/main-world/spikeProbe';

export default defineContentScript({
    matches: ['https://*.disneyplus.com/*'],
    runAt: 'document_start',
    world: 'MAIN',
    registration: 'manifest',
    noScriptStartedPostMessage: true,
    main() {
        installSpikeProbe('disneyplus');
    },
});
