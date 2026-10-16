import { useEffect, useState } from 'react';
import type { PlatformId } from '@/shared/platforms';
import {
    activeTabPlatform,
    readTabStatus,
    type TabStatus,
} from '../contentTab';
import { ElsewherePopup } from './ElsewherePopup';
import { SitePopup } from './SitePopup';

/** A remote control for the site in the active tab, or the way to one. */
export function PopupApp() {
    const [place, setPlace] = useState<{
        site: PlatformId | null;
        status: TabStatus;
    }>();

    useEffect(() => {
        let active = true;
        void (async () => {
            const site = await activeTabPlatform();
            const status = site ? await readTabStatus() : 'waiting';
            if (active) {
                setPlace({ site, status });
            }
        })();
        return () => {
            active = false;
        };
    }, []);

    if (!place) {
        return <div className="popup" aria-busy="true" />;
    }
    return place.site ? (
        <SitePopup site={place.site} status={place.status} />
    ) : (
        <ElsewherePopup />
    );
}
