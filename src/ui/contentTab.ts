import { browser } from 'wxt/browser';
import { sendToTab } from '@/messaging/client';
import {
    configChanged,
    platformLookStatus,
} from '@/messaging/contracts/control';
import type { ResponseOf } from '@/messaging/registry';
import { createLogger } from '@/shared/logger';
import type { ContentSettings } from '@/content/orchestrator/PlayerSession';

const logger = createLogger('ContentTab');
const generations = new Map<string, number>();

/** The active tab of the current window; where a popup's page lives. */
async function activeTabId(): Promise<number | null> {
    const [tab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
    });
    return tab?.id ?? null;
}

/**
 * Paint un-persisted display values on the active tab right away, so a
 * slider drag is visible before its value is saved. Storage stays the
 * source of truth; delivery is best effort and never surfaces to the user.
 * Out-of-order tab lookups cannot resurrect an older value for a key.
 */
export async function previewContentSettings(
    changes: Partial<ContentSettings>
): Promise<void> {
    const snapshot: Record<string, unknown> = { ...changes };
    const stamps = new Map<string, number>();
    for (const key of Object.keys(snapshot)) {
        const generation = (generations.get(key) ?? 0) + 1;
        generations.set(key, generation);
        stamps.set(key, generation);
    }
    try {
        const tabId = await activeTabId();
        const current = Object.fromEntries(
            Object.entries(snapshot).filter(
                ([key]) => generations.get(key) === stamps.get(key)
            )
        );
        if (tabId === null || Object.keys(current).length === 0) {
            return;
        }
        const response = await sendToTab(configChanged, tabId, {
            action: configChanged.action,
            changes: current,
        });
        if (!response.success) {
            logger.debug('Live preview declined by the page', {
                error: response.error,
            });
        }
    } catch (error) {
        // No DualSub content script on the active tab; the persisted value
        // still arrives through the storage change.
        logger.debug('Live preview not delivered', {
            reason: error instanceof Error ? error.name : 'unknown',
        });
    }
}

export type PlatformLookStatus = ResponseOf<typeof platformLookStatus>;

/** What Match Platform draws from on the active tab; null off a player
 *  page. */
export async function readPlatformLookStatus(): Promise<PlatformLookStatus | null> {
    try {
        const tabId = await activeTabId();
        if (tabId === null) {
            return null;
        }
        return await sendToTab(platformLookStatus, tabId, {
            action: platformLookStatus.action,
        });
    } catch (error) {
        logger.debug('Platform look status not available', {
            reason: error instanceof Error ? error.name : 'unknown',
        });
        return null;
    }
}
