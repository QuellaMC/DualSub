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

/** The active tab and the site it shows, read together, so what is asked
 *  of the tab next is asked of the same page. */
export interface TabSite {
    /** null with no active tab. */
    readonly tabId: number | null;
    /** null where DualSub does not work. */
    readonly site: PlatformId | null;
}

/** The active tab and its site. Rejects when the site is unknown, not none:
 *  the tab cannot be read, or it is on its way to another site than the
 *  one it shows. */
export async function activeTabSite(): Promise<TabSite> {
    const tab = await activeTab();
    const site = platformFromUrl(tab?.url);
    if (tab?.pendingUrl && platformFromUrl(tab.pendingUrl) !== site) {
        throw new Error('The active tab is on its way to another site');
    }
    return { tabId: tab?.id ?? null, site };
}

/**
 * What DualSub is doing in the active tab: serving a video player, with the
 * language its original line shows once known, waiting on the page for one, or
 * not running there because the page opened before DualSub was installed
 * or updated, so only a reload brings it in.
 */
export type TabStatus =
    | { readonly kind: 'player'; readonly originalLanguage: string | null }
    | { readonly kind: 'waiting' }
    | { readonly kind: 'notRunning' };

export const WAITING: TabStatus = { kind: 'waiting' };

export function sameTabStatus(left: TabStatus, right: TabStatus): boolean {
    return (
        left.kind === right.kind &&
        (left.kind !== 'player' ||
            (right.kind === 'player' &&
                left.originalLanguage === right.originalLanguage))
    );
}

export async function readTabStatus(tabId: number | null): Promise<TabStatus> {
    if (tabId === null) {
        return WAITING;
    }
    try {
        const status = await sendToTab(playerStatus, tabId, {
            action: playerStatus.action,
        });
        return status.onPlayer
            ? { kind: 'player', originalLanguage: status.originalLanguage }
            : WAITING;
    } catch (error) {
        logger.debug('Player status not available', {
            reason: error instanceof Error ? error.name : 'unknown',
        });
        return isProvenMessagingNonDelivery(error)
            ? { kind: 'notRunning' }
            : WAITING;
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
