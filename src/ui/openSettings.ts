import { browser } from 'wxt/browser';

/** The settings page, opened at `section` when one is named. */
export function openSettings(section?: string): void {
    if (section) {
        void browser.tabs.create({
            url: `${browser.runtime.getURL('/options.html')}#${section}`,
        });
    } else {
        void browser.runtime.openOptionsPage();
    }
}
