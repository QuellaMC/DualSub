import {
    siteProfileOf,
    type SettingsValues,
    type SiteSettingKey,
} from '@/config/schema';
import { isSameLanguage } from '@/shared/languageNormalization';
import {
    PLATFORM_IDS,
    PLATFORM_NAMES,
    type PlatformId,
} from '@/shared/platforms';
import { AUTO_LANGUAGE } from '@/shared/subtitleLanguages';
import type { Translate } from './useI18n';
import { useSettings } from './useSettings';

/** The shared settings each site's switch and languages are read from. */
export const SITE_VIEW_KEYS = [
    'subtitlesEnabled',
    'originalLanguage',
    'targetLanguage',
    'siteProfiles',
] as const;

export type SiteViewSettings = Pick<
    SettingsValues,
    (typeof SITE_VIEW_KEYS)[number]
>;

/** A setting as `site` sees it: its own value, else the shared one. */
function siteSees<K extends SiteSettingKey>(
    settings: Pick<SettingsValues, K | 'siteProfiles'>,
    site: PlatformId,
    key: K
): SettingsValues[K] {
    return siteProfileOf(settings.siteProfiles, site)[key] ?? settings[key];
}

export interface SitesOn {
    readonly on: PlatformId[];
    readonly off: PlatformId[];
}

/** The sites DualSub runs on and those it is off on, each as the site sees
 *  the shared switch and its own. */
export function sitesOn(
    settings: Pick<SettingsValues, 'subtitlesEnabled' | 'siteProfiles'>
): SitesOn {
    const on = PLATFORM_IDS.filter((site) =>
        siteSees(settings, site, 'subtitlesEnabled')
    );
    return { on, off: PLATFORM_IDS.filter((site) => !on.includes(site)) };
}

/** The sites whose languages call on a translation service: the video's
 *  line automatic, or fixed to a language other than the viewer's. A site
 *  whose video line is the viewer's own language shows one line. */
export function sitesTranslating(
    settings: Pick<
        SettingsValues,
        'originalLanguage' | 'targetLanguage' | 'siteProfiles'
    >
): PlatformId[] {
    return PLATFORM_IDS.filter((site) => {
        const original = siteSees(settings, site, 'originalLanguage');
        return (
            original === AUTO_LANGUAGE ||
            !isSameLanguage(original, settings.targetLanguage)
        );
    });
}

/** Whether a site where DualSub runs calls on a translation service. */
export function callsForTranslation(settings: SiteViewSettings): boolean {
    const { on } = sitesOn(settings);
    return sitesTranslating(settings).some((site) => on.includes(site));
}

/** The shared view of every site's switch and languages, read for a page
 *  whose own settings show one site's view; null until it is read, or
 *  when it cannot be. */
export function useSiteViews(): {
    readonly settings: SiteViewSettings | null;
    readonly unreadable: boolean;
} {
    const { settings, status } = useSettings(SITE_VIEW_KEYS);
    return {
        settings: settings ?? null,
        unreadable: status === 'unavailable',
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
