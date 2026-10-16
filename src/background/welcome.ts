import { browser } from 'wxt/browser';

/** Open the welcome page once, right after DualSub is installed. */
export function registerWelcomePage(): void {
    browser.runtime.onInstalled.addListener(({ reason }) => {
        if (reason === 'install') {
            void browser.tabs.create({
                url: browser.runtime.getURL('/welcome.html'),
            });
        }
    });
}
