import { defineContentScript } from 'wxt/utils/define-content-script';

export default defineContentScript({
    matches: ['https://*.netflix.com/*'],
    runAt: 'document_start',
    main() {
        console.debug(
            '[DualSub:netflix] isolated content script started',
            `readyState=${document.readyState}`
        );
    },
});
