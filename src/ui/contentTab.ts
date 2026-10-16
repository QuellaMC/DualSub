import { browser } from 'wxt/browser';
import { isProvenMessagingNonDelivery, sendToTab } from '@/messaging/client';
import { playerStatus } from '@/messaging/contracts/control';
import { createLogger } from '@/shared/logger';
import { platformFromUrl, type PlatformId } from '@/shared/platforms';

const logger = createLogger('ContentTab');

/** The active tab of the current window; where a popup's page lives. */
async function activeTab(): Promise<{
    id?: number;
    url?: string;
    pendingUrl?: string;
} | null> {
    const [tab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
    });
    return tab ?? null;
}

async function activeTabId(): Promise<number | null> {
    return (await activeTab())?.id ?? null;
}

/** The site of the active tab, or null when DualSub does not work there.
 *  Rejects when that is unknown, not none: the tab cannot be read, or it is
 *  on its way to another site than the one it shows. */
export async function activeTabPlatform(): Promise<PlatformId | null> {
    const tab = await activeTab();
    const site = platformFromUrl(tab?.url);
    if (tab?.pendingUrl && platformFromUrl(tab.pendingUrl) !== site) {
        throw new Error('The active tab is on its way to another site');
    }
    return site;
}

/**
 * What DualSub is doing in the active tab: serving a video player, waiting
 * on the page for one, or not running there because the page opened before
 * DualSub was installed or updated, so only a reload brings it in.
 */
export type TabStatus = 'player' | 'waiting' | 'notRunning';

export async function readTabStatus(): Promise<TabStatus> {
    try {
        const tabId = await activeTabId();
        if (tabId === null) {
            return 'waiting';
        }
        const status = await sendToTab(playerStatus, tabId, {
            action: playerStatus.action,
        });
        return status.onPlayer ? 'player' : 'waiting';
    } catch (error) {
        logger.debug('Player status not available', {
            reason: error instanceof Error ? error.name : 'unknown',
        });
        return isProvenMessagingNonDelivery(error) ? 'notRunning' : 'waiting';
    }
}

/** Reload the active tab, which brings DualSub into a page opened before
 *  it was installed or updated. */
export async function reloadActiveTab(): Promise<void> {
    const tabId = await activeTabId();
    if (tabId !== null) {
        await browser.tabs.reload(tabId);
    }
}
