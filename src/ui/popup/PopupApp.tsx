import { useEffect, useState } from 'react';
import { detectBrowserLanguage } from '@/config/schema';
import type { PlatformId } from '@/shared/platforms';
import {
    activeTabPlatform,
    readTabStatus,
    type TabStatus,
} from '../contentTab';
import { useI18n } from '../hooks/useI18n';
import { ElsewherePopup } from './ElsewherePopup';
import { PopupUnavailable } from './PopupShell';
import { SitePopup } from './SitePopup';

/** How soon the popup asks the tab again while it is open: a session can
 *  finish starting, a reloaded tab bring DualSub in, or a video go away. */
const STATUS_RECHECK_MS = 1000;

/** A remote control for the site in the active tab, or the way to one. */
export function PopupApp() {
    // 'unknown' while the active tab cannot be read.
    const [place, setPlace] = useState<
        { site: PlatformId | null; status: TabStatus } | 'unknown'
    >();

    useEffect(() => {
        let active = true;
        let recheck: ReturnType<typeof setTimeout> | undefined;
        const read = async (): Promise<void> => {
            let site: PlatformId | null;
            try {
                site = await activeTabPlatform();
            } catch {
                if (active) {
                    setPlace('unknown');
                    recheck = setTimeout(() => void read(), STATUS_RECHECK_MS);
                }
                return;
            }
            const status = site ? await readTabStatus() : 'waiting';
            if (!active) {
                return;
            }
            setPlace((previous) =>
                previous !== 'unknown' &&
                previous?.site === site &&
                previous.status === status
                    ? previous
                    : { site, status }
            );
            if (site) {
                recheck = setTimeout(() => void read(), STATUS_RECHECK_MS);
            }
        };
        void read();
        return () => {
            active = false;
            clearTimeout(recheck);
        };
    }, []);

    if (!place) {
        return <div className="popup" aria-busy="true" />;
    }
    if (place === 'unknown') {
        return <TabUnknown />;
    }
    return place.site ? (
        <SitePopup site={place.site} status={place.status} />
    ) : (
        <ElsewherePopup />
    );
}

/** The tab's site is unknown, so the popup edits nothing until it is. */
function TabUnknown() {
    const { t, loadedLocale } = useI18n(detectBrowserLanguage());
    return loadedLocale === null ? (
        <div className="popup" aria-busy="true" />
    ) : (
        <PopupUnavailable t={t} />
    );
}
