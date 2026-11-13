import type { MessageRouter } from '@/messaging/router';
import {
    lookupWords,
    type LookupResult,
} from '@/messaging/contracts/lookupWords';
import { whenServiceReady } from '../readiness';
import type { LookupService } from './service';

const NOTHING: LookupResult = { translation: null, entries: [], source: null };

export function registerLookupHandler(
    router: MessageRouter,
    service: Pick<LookupService, 'lookup'>
): void {
    router.handle(lookupWords, async (request, sender) => {
        if (sender.role !== 'sidepanel') {
            return NOTHING;
        }
        await whenServiceReady('translation');
        return service.lookup(
            request.text,
            request.language,
            request.targetLanguage
        );
    });
}
