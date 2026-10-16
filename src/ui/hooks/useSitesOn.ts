import { siteProfileOf } from '@/config/schema';
import {
    PLATFORM_IDS,
    PLATFORM_NAMES,
    type PlatformId,
} from '@/shared/platforms';
import type { Translate } from './useI18n';
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

/** The sites named as a list in `language`: "Netflix and Disney+". */
export function siteNames(
    language: string,
    sites: readonly PlatformId[]
): string {
    return new Intl.ListFormat(language, { type: 'conjunction' }).format(
        sites.map((site) => PLATFORM_NAMES[site])
    );
}

/** Where dual subtitles are on and off, or the switch's own state while
 *  the sites are not read. */
export function sitesOnTitle(
    t: Translate,
    language: string,
    enabled: boolean,
    sites: SitesOn | null
): string {
    if (!sites) {
        return t(enabled ? 'startStatusOn' : 'startStatusOff');
    }
    if (sites.on.length === 0) {
        return t('startStatusOff');
    }
    return sites.off.length === 0
        ? t('startStatusWorking', siteNames(language, sites.on))
        : t(
              'startStatusWorkingSome',
              siteNames(language, sites.on),
              siteNames(language, sites.off)
          );
}
