import { useRef, useState } from 'react';
import {
    siteProfileOf,
    type SettingsValues,
    type SiteProfile,
    type SiteSettingKey,
} from '@/config/schema';
import { configService } from '@/config/service';
import {
    PLATFORM_HOSTS,
    PLATFORM_IDS,
    PLATFORM_NAMES,
    type PlatformId,
} from '@/shared/platforms';
import { Icon } from '../../design/Icon';
import { Switch } from '../../design/Switch';
import type { Translate } from '../../hooks/useI18n';
import { useSettings } from '../../hooks/useSettings';
import { feedbackSave, followAllSites, useFeedback } from '../shell/feedback';

type Rules = SettingsValues['subtitleBlacklist'];

/** Each own value's name in the summary; a key shares a name with its
 *  sibling when the page edits them together. */
const OWN_SETTING_LABELS: Record<SiteSettingKey, string> = {
    subtitlesEnabled: 'startEnabled',
    hideOfficialSubtitles: 'sitesHideTitle',
    originalLanguage: 'languagesTopTitle',
    useOfficialTranslations: 'languagesOfficialTitle',
    subtitleStyle: 'lookStyleTitle',
    subtitleCustomLook: 'lookStyleTitle',
    subtitleTranslationColor: 'lookTranslationColorTitle',
    subtitleFontScale: 'lookSizeTitle',
    subtitleGap: 'lookGapTitle',
    subtitleVerticalPosition: 'lookPositionTitle',
    subtitleLayoutOrder: 'lookOrderTitle',
    subtitleLayoutOrientation: 'lookArrangementTitle',
    subtitleTimeOffset: 'timingTitle',
};

/** The site settings a site holds its own values for. */
export function ownSettingKeys(profile: SiteProfile): SiteSettingKey[] {
    return Object.keys(profile) as SiteSettingKey[];
}

/** A card whose settings could not be read: its title, and that it shows
 *  nothing else until they are. */
function UnreadableCard({ t, title }: { t: Translate; title: string }) {
    return (
        <div className="card">
            <h2 className="label">{title}</h2>
            <p className="notice danger" role="alert">
                {t('settingsLoadFailed')}
            </p>
        </div>
    );
}

/** Track filters apply where the subtitle pipeline reads them. */
const FILTERED_SITES: readonly PlatformId[] = ['disneyplus'];

function SiteCard({
    t,
    site,
    advanced,
    onEdit,
}: {
    t: Translate;
    site: PlatformId;
    advanced: boolean;
    onEdit: (site: PlatformId) => void;
}) {
    const feedback = useFeedback();
    const handle = useSettings(
        [
            'subtitlesEnabled',
            'hideOfficialSubtitles',
            'siteProfiles',
            'subtitleBlacklist',
        ],
        { site, siteTarget: 'own' }
    );
    const [rule, setRule] = useState('');
    const useHere = useRef<HTMLButtonElement | null>(null);
    const { settings } = handle;
    const name = PLATFORM_NAMES[site];
    if (handle.status === 'unavailable') {
        return <UnreadableCard t={t} title={name} />;
    }
    if (!settings) {
        return null;
    }
    const save = feedbackSave(handle, site, feedback);
    const own = siteProfileOf(settings.siteProfiles, site);
    const ownKeys = ownSettingKeys(own);
    const ownNames = [
        ...new Set(ownKeys.map((key) => t(OWN_SETTING_LABELS[key]))),
    ];
    const rules = settings.subtitleBlacklist[site] ?? [];
    /** Change this site's rules from the stored list, so quick edits, and
     *  edits from another page, each build on the last; Undo puts back this
     *  site's list alone. */
    const editRules = (
        change: (current: readonly string[]) => string[],
        message: string
    ): void => {
        let previous: readonly string[] = [];
        const withRules = (next: readonly string[]) => (lists: Rules) => ({
            ...lists,
            [site]: [...next],
        });
        void feedback.apply(
            async () => {
                const before = await configService.updateSetting(
                    'subtitleBlacklist',
                    (lists) => withRules(change(lists[site] ?? []))(lists)
                );
                previous = before[site] ?? [];
            },
            message,
            () =>
                configService.updateSetting(
                    'subtitleBlacklist',
                    withRules(previous)
                )
        );
    };
    const removeOwn = (): void => {
        void followAllSites(
            feedback,
            site,
            ownKeys,
            t('toastSiteShared', name)
        ).then((removed) => {
            if (removed) {
                useHere.current?.focus();
            }
        });
    };

    return (
        <div className="card">
            <div className="row">
                <div className="inline">
                    <span className="site-badge" aria-hidden="true">
                        {name.slice(0, 1)}
                    </span>
                    <div>
                        <h2 className="label">{name}</h2>
                        <div className="help">{PLATFORM_HOSTS[site]}</div>
                    </div>
                    <span
                        className={`tag ${settings.subtitlesEnabled ? 'ok' : 'muted'}`}
                    >
                        {t(settings.subtitlesEnabled ? 'sitesOn' : 'sitesOff')}
                    </span>
                </div>
                <div className="inline">
                    <span className="strong" id={`${site}-enabled`}>
                        {t('sitesUseHere')}
                    </span>
                    <Switch
                        ref={useHere}
                        checked={settings.subtitlesEnabled}
                        labelledBy={`${site}-enabled`}
                        onChange={(enabled) =>
                            save(
                                { subtitlesEnabled: enabled },
                                {
                                    message: t(
                                        enabled
                                            ? 'toastSiteOn'
                                            : 'toastSiteOff',
                                        name
                                    ),
                                }
                            )
                        }
                    />
                </div>
            </div>
            <div className="row divided">
                <div className="grow">
                    <div className="strong" id={`${site}-hide`}>
                        {t('sitesHideOwn', name)}
                    </div>
                    <div className="help">{t('sitesHideHelp')}</div>
                </div>
                <Switch
                    checked={settings.hideOfficialSubtitles}
                    labelledBy={`${site}-hide`}
                    onChange={(hide) =>
                        save(
                            { hideOfficialSubtitles: hide },
                            {
                                message: t(
                                    hide ? 'toastSiteHide' : 'toastSiteShow',
                                    name
                                ),
                            }
                        )
                    }
                />
            </div>
            {(advanced || ownKeys.length > 0) && (
                <div className="profile">
                    <div className="grow">
                        <div className="strong">
                            {t(
                                ownKeys.length > 0
                                    ? 'sitesHasOwn'
                                    : 'sitesUsesShared'
                            )}
                        </div>
                        {ownKeys.length > 0 ? (
                            <ul className="chips">
                                {ownNames.map((ownName) => (
                                    <li key={ownName} className="tag site">
                                        {ownName}
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <div className="help">
                                {t('sitesUsesSharedHelp', name)}
                            </div>
                        )}
                    </div>
                    <div className="inline wrap">
                        <button
                            type="button"
                            className="button"
                            onClick={() => onEdit(site)}
                        >
                            {t(
                                ownKeys.length > 0
                                    ? 'sitesEditOwn'
                                    : 'sitesGiveOwn',
                                name
                            )}
                        </button>
                        {ownKeys.length > 0 && (
                            <button
                                type="button"
                                className="button quiet"
                                onClick={removeOwn}
                            >
                                {t('sitesRemoveOwn')}
                            </button>
                        )}
                    </div>
                </div>
            )}
            {advanced && FILTERED_SITES.includes(site) && (
                <div className="divided stack" id={`filters-${site}`}>
                    <div className="strong">
                        {t('sitesFiltersTitle')}{' '}
                        <span className="tag advanced">
                            {t('commonAdvanced')}
                        </span>
                    </div>
                    <p className="help">{t('sitesFiltersHelp')}</p>
                    <ul className="chips">
                        {rules.map((existing) => (
                            <li key={existing} className="chip mono">
                                {existing}
                                <button
                                    type="button"
                                    aria-label={t(
                                        'sitesFilterRemove',
                                        existing
                                    )}
                                    onClick={() =>
                                        editRules(
                                            (current) =>
                                                current.filter(
                                                    (candidate) =>
                                                        candidate !== existing
                                                ),
                                            t('toastFilterRemoved', existing)
                                        )
                                    }
                                >
                                    <Icon name="close" />
                                </button>
                            </li>
                        ))}
                    </ul>
                    <form
                        className="inline wrap"
                        onSubmit={(event) => {
                            event.preventDefault();
                            const next = rule.trim();
                            if (next !== '' && !rules.includes(next)) {
                                editRules(
                                    (current) =>
                                        current.includes(next)
                                            ? [...current]
                                            : [...current, next],
                                    t('toastFilterAdded', next)
                                );
                            }
                            setRule('');
                        }}
                    >
                        <label htmlFor={`${site}-rule`} className="sr-only">
                            {t('sitesFilterAdd')}
                        </label>
                        <input
                            id={`${site}-rule`}
                            className="field mono"
                            placeholder="forced=yes"
                            value={rule}
                            onChange={(event) => setRule(event.target.value)}
                        />
                        <button type="submit" className="button">
                            {t('sitesFilterAdd')}
                        </button>
                    </form>
                </div>
            )}
        </div>
    );
}

/** The site's own subtitles, hidden or shown on every site that keeps no
 *  choice of its own. */
function SharedHide({ t }: { t: Translate }) {
    const feedback = useFeedback();
    const handle = useSettings(['hideOfficialSubtitles', 'siteProfiles']);
    if (handle.status === 'unavailable') {
        return <UnreadableCard t={t} title={t('sitesHideTitle')} />;
    }
    if (!handle.settings) {
        return null;
    }
    const save = feedbackSave(handle, 'all', feedback);
    return (
        <div className="card" id="hide-all">
            <div className="row">
                <div className="grow">
                    <h2 className="label" id="hide-all-title">
                        {t('sitesHideTitle')}
                    </h2>
                    <p className="help">{t('sitesHideAllHelp')}</p>
                </div>
                <Switch
                    checked={handle.settings.hideOfficialSubtitles}
                    labelledBy="hide-all-title"
                    onChange={(hide) =>
                        save(
                            { hideOfficialSubtitles: hide },
                            {
                                message: t(
                                    hide ? 'toastSitesHide' : 'toastSitesShow'
                                ),
                            }
                        )
                    }
                />
            </div>
        </div>
    );
}

export function SitesSection({
    t,
    advanced,
    onEdit,
}: {
    t: Translate;
    advanced: boolean;
    onEdit: (site: PlatformId) => void;
}) {
    return (
        <section className="section" aria-labelledby="sites-title" id="sites">
            <h1 id="sites-title" tabIndex={-1}>
                {t('navSites')}
            </h1>
            <p className="lead">{t('sitesLead')}</p>
            <SharedHide t={t} />
            {PLATFORM_IDS.map((site) => (
                <SiteCard
                    key={site}
                    t={t}
                    site={site}
                    advanced={advanced}
                    onEdit={onEdit}
                />
            ))}
            <div className="card dashed">
                <h2 className="label">{t('sitesMoreTitle')}</h2>
                <p className="help">{t('sitesMoreHelp')}</p>
            </div>
        </section>
    );
}
