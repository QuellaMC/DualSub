import { siteProfileOf } from '@/config/schema';
import { PLATFORM_IDS, type PlatformId } from '@/shared/platforms';
import { useSettings } from './useSettings';

export interface SitesOn {
    readonly on: PlatformId[];
    readonly off: PlatformId[];
}

/** The sites DualSub runs on and those it is off on, each as the site sees
 *  its settings; null until they are read, or when they cannot be. */
export function useSitesOn(): {
    readonly sites: SitesOn | null;
    readonly unreadable: boolean;
} {
    const { settings, status } = useSettings([
        'subtitlesEnabled',
        'siteProfiles',
    ]);
    if (!settings) {
        return { sites: null, unreadable: status === 'unavailable' };
    }
    const on = PLATFORM_IDS.filter(
        (site) =>
            siteProfileOf(settings.siteProfiles, site).subtitlesEnabled ??
            settings.subtitlesEnabled
    );
    return {
        sites: { on, off: PLATFORM_IDS.filter((site) => !on.includes(site)) },
        unreadable: false,
    };
}
