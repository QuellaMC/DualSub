import type { MessageRouter } from '@/messaging/router';
import { analyzeContext } from '@/messaging/contracts/analyzeContext';
import { whenServiceReady } from '../readiness';
import type { AiContextService } from './service';

export function registerAiContextHandler(
    router: MessageRouter,
    service: Pick<AiContextService, 'analyze'>
): void {
    router.handle(analyzeContext, async (request, sender) => {
        if (sender.role !== 'sidepanel') {
            return { success: false as const, reason: 'failed' as const };
        }
        await whenServiceReady('aiContextInitialized');
        const outcome = await service.analyze({
            text: request.text,
            line: request.line,
            kinds: request.contextTypes,
            sourceLanguage: request.language ?? 'auto',
            targetLanguage: request.targetLanguage,
        });
        return outcome.success
            ? { success: true as const, answer: outcome.answer }
            : { success: false as const, reason: outcome.reason };
    });
}
