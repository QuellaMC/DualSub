import { defineContentScript } from 'wxt/utils/define-content-script';

export default defineContentScript({
    matches: ['https://*.disneyplus.com/*'],
    runAt: 'document_start',
    main() {
        console.debug(
            '[DualSub:disneyplus] isolated content script started',
            `readyState=${document.readyState}`
        );
    },
});
