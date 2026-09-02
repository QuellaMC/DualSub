import { browser } from 'wxt/browser';
import { sendToTab } from '@/messaging/client';
import { configChanged } from '@/messaging/contracts/control';
import { createLogger } from '@/shared/logger';
import type { ContentSettings } from '@/content/orchestrator/PlayerSession';

const logger = createLogger('LivePreview');
const generations = new Map<string, number>();

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
        const [tab] = await browser.tabs.query({
            active: true,
            currentWindow: true,
        });
        const current = Object.fromEntries(
            Object.entries(snapshot).filter(
                ([key]) => generations.get(key) === stamps.get(key)
            )
        );
        if (tab?.id === undefined || Object.keys(current).length === 0) {
            return;
        }
        const response = await sendToTab(configChanged, tab.id, {
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
