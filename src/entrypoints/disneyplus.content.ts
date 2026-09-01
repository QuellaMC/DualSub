import { defineContentScript } from 'wxt/utils/define-content-script';
import { ContentOrchestrator } from '@/content/orchestrator/ContentOrchestrator';
import { disneyPlusDescriptor } from '@/content/platform/disneyplus/descriptor';

export default defineContentScript({
    matches: ['https://*.disneyplus.com/*'],
    runAt: 'document_start',
    main() {
        new ContentOrchestrator(disneyPlusDescriptor).start();
    },
});
