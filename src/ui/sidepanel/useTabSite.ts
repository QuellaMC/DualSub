import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { platformFromUrl, type PlatformId } from '@/shared/platforms';

/**
 * The site the bound tab shows: one DualSub works on, null for any other,
 * undefined until known. Chrome reveals a tab's address only on the sites
 * DualSub may read, so every other tab counts as another site.
 */
export function useTabSite(
    tabId: number | null
): PlatformId | null | undefined {
    const [known, setKnown] = useState<{
        readonly tabId: number;
        readonly site: PlatformId | null;
    } | null>(null);

    useEffect(() => {
        if (tabId === null) {
            return;
        }
        let active = true;
        const read = (): void => {
            browser.tabs.get(tabId).then(
                (tab) => {
                    if (active) {
                        setKnown({ tabId, site: platformFromUrl(tab.url) });
                    }
                },
                () => {
                    if (active) {
                        setKnown({ tabId, site: null });
                    }
                }
            );
        };
        const onUpdated = (
            updatedId: number,
            change: { url?: string; status?: string }
        ): void => {
            if (
                updatedId === tabId &&
                (change.url !== undefined || change.status === 'complete')
            ) {
                read();
            }
        };
        read();
        browser.tabs.onUpdated.addListener(onUpdated);
        return () => {
            active = false;
            browser.tabs.onUpdated.removeListener(onUpdated);
        };
    }, [tabId]);

    return known !== null && known.tabId === tabId ? known.site : undefined;
}
