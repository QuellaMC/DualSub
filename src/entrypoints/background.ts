import { defineBackground } from 'wxt/utils/define-background';
import { configService } from '@/config/service';
import { migrateLegacyConfiguration } from '@/config/migrations';
import { createLogger, setLoggingLevel } from '@/shared/logger';
import { MessageRouter } from '@/messaging/router';
import { checkBackgroundReady, ping } from '@/messaging/contracts';
import { markServiceReady, readinessSnapshot } from '@/background/readiness';
import { registerAiContextHandler } from '@/background/aicontext/handler';
import { CONTEXT_PROVIDERS } from '@/background/aicontext/providers';
import { AiContextService } from '@/background/aicontext/service';
import { registerSidePanelHandlers } from '@/background/sidepanel/handler';
import {
    browserSidePanelDeps,
    SidePanelService,
} from '@/background/sidepanel/service';
import { registerSubtitleHandlers } from '@/background/subtitle/handler';
import { registerTranslationHandler } from '@/background/translation/handler';
import { TRANSLATION_PROVIDERS } from '@/background/translation/providers';
import { TranslationService } from '@/background/translation/service';

export default defineBackground(() => {
    // Cold-start discipline: every listener must be registered synchronously
    // in this function, before any await — a worker woken by an event drops
    // it otherwise.
    const logger = createLogger('Background');
    const router = new MessageRouter();
    const translationService = new TranslationService({
        providers: TRANSLATION_PROVIDERS,
        config: configService,
    });
    const aiContextService = new AiContextService({
        providers: CONTEXT_PROVIDERS,
        config: configService,
    });
    const sidePanelService = new SidePanelService(browserSidePanelDeps());

    router.handle(ping, () => readinessSnapshot());
    router.handle(checkBackgroundReady, () => readinessSnapshot());
    registerSubtitleHandlers(router);
    registerTranslationHandler(router, translationService);
    registerAiContextHandler(router, aiContextService);
    registerSidePanelHandlers(router, sidePanelService);
    router.listen();

    markServiceReady('subtitle');
    markServiceReady('aiContext');

    configService.initializeDefaults(async () => {
        await migrateLegacyConfiguration();
    });

    void (async () => {
        try {
            await migrateLegacyConfiguration();
        } catch (error) {
            logger.error('Legacy configuration migration failed', error);
        }
        try {
            setLoggingLevel(await configService.get('loggingLevel'));
        } catch (error) {
            logger.error('Failed to initialize logging level', error);
        }
        // Migration precedes initialization so a relocated provider setting
        // is what the service reads; readiness parks requests until then.
        await translationService.initialize();
        markServiceReady('translation');
        await aiContextService.initialize();
        markServiceReady('aiContextInitialized');
        logger.info('Background service worker initialized');
    })();
});
