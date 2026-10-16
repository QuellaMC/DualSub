import { useEffect, useState } from 'react';
import type { PlatformId } from '@/shared/platforms';
import {
    activeTabPlatform,
    readTabStatus,
    type TabStatus,
} from '../contentTab';
import { ElsewherePopup } from './ElsewherePopup';
import { SitePopup } from './SitePopup';

/** How soon the popup asks the tab again until a player shows: a session
 *  can finish starting, or a reloaded tab bring DualSub in, after it opens. */
const STATUS_RECHECK_MS = 1000;

/** A remote control for the site in the active tab, or the way to one. */
export function PopupApp() {
    const [place, setPlace] = useState<{
        site: PlatformId | null;
        status: TabStatus;
    }>();

    useEffect(() => {
        let active = true;
        let recheck: ReturnType<typeof setTimeout> | undefined;
        const read = async (): Promise<void> => {
            const site = await activeTabPlatform();
            const status = site ? await readTabStatus() : 'waiting';
            if (!active) {
                return;
            }
            setPlace((previous) =>
                previous?.site === site && previous.status === status
                    ? previous
                    : { site, status }
            );
            if (site && status !== 'player') {
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
    return place.site ? (
        <SitePopup site={place.site} status={place.status} />
    ) : (
        <ElsewherePopup />
    );
}
