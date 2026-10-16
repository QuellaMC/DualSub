import { browser } from 'wxt/browser';
import { createLogger } from '@/shared/logger';

const logger = createLogger('Welcome');

/**
 * Open the welcome page once, right after DualSub is installed, and only
 * once `settingsReady` settles: the startup repair writes the defaults it
 * read before, which would overwrite a language picked on the page
 * meanwhile.
 */
export function registerWelcomePage(settingsReady: Promise<void>): void {
    browser.runtime.onInstalled.addListener(({ reason }) => {
        if (reason !== 'install') {
            return;
        }
        void settingsReady
            .then(() =>
                browser.tabs.create({
                    url: browser.runtime.getURL('/welcome.html'),
                })
            )
            .catch((error: unknown) => {
                // DualSub works without it; the page is a first-run aid.
                logger.warn('Welcome page could not open', {
                    errorName: error instanceof Error ? error.name : 'unknown',
                });
            });
    });
}
