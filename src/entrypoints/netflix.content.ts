import { defineContentScript } from 'wxt/utils/define-content-script';
import { ContentOrchestrator } from '@/content/orchestrator/ContentOrchestrator';
import { netflixDescriptor } from '@/content/platform/netflix/descriptor';

export default defineContentScript({
    matches: ['https://*.netflix.com/*'],
    runAt: 'document_start',
    main() {
        new ContentOrchestrator(netflixDescriptor).start();
    },
});
