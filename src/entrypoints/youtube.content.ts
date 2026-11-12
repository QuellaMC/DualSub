import { defineContentScript } from 'wxt/utils/define-content-script';
import { ContentOrchestrator } from '@/content/orchestrator/ContentOrchestrator';
import { youtubeDescriptor } from '@/content/platform/youtube/descriptor';

export default defineContentScript({
    matches: ['https://www.youtube.com/*'],
    runAt: 'document_start',
    main() {
        new ContentOrchestrator(youtubeDescriptor).start();
    },
});
