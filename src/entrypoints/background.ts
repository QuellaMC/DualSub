import { defineBackground } from 'wxt/utils/define-background';
import { configService } from '@/config/service';
import { migrateLegacyConfiguration } from '@/config/migrations';
import { createLogger, setLoggingLevel } from '@/shared/logger';
import { MessageRouter } from '@/messaging/router';
import { checkBackgroundReady, ping } from '@/messaging/contracts';
import { readinessSnapshot } from '@/background/readiness';

export default defineBackground(() => {
    // Cold-start discipline: every listener must be registered synchronously
    // in this function, before any await — a worker woken by an event drops
    // it otherwise.
    const logger = createLogger('Background');
    const router = new MessageRouter();

    router.handle(ping, () => readinessSnapshot());
    router.handle(checkBackgroundReady, () => readinessSnapshot());
    router.listen();

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
        logger.info('Background service worker initialized');
    })();
});
