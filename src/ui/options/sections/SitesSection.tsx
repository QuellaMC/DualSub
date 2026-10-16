import { useRef, useState } from 'react';
import {
    siteProfileOf,
    type SiteProfile,
    type SiteSettingKey,
} from '@/config/schema';
import {
    PLATFORM_IDS,
    PLATFORM_NAMES,
    type PlatformId,
} from '@/shared/platforms';
import { Icon } from '../../design/Icon';
import { Switch } from '../../design/Switch';
import type { Translate } from '../../hooks/useI18n';
import { useSettings } from '../../hooks/useSettings';
import { feedbackSave, followAllSites, useFeedback } from '../shell/feedback';

const SITE_DOMAINS: Record<PlatformId, string> = {
    netflix: 'netflix.com',
    disneyplus: 'disneyplus.com',
};

/** Shown as switches on each site's card rather than counted as its own
 *  settings. */
const CARD_SWITCH_KEYS: readonly SiteSettingKey[] = [
    'subtitlesEnabled',
    'hideOfficialSubtitles',
];

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

/** The site settings a site holds its own values for, besides the switches
 *  on its card. */
export function ownSettingKeys(profile: SiteProfile): SiteSettingKey[] {
    return (Object.keys(profile) as SiteSettingKey[]).filter(
        (key) => !CARD_SWITCH_KEYS.includes(key)
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
    if (!settings) {
        return null;
    }
    const save = feedbackSave(handle, site, feedback);
    const name = PLATFORM_NAMES[site];
    const own = siteProfileOf(settings.siteProfiles, site);
    const ownKeys = ownSettingKeys(own);
    const ownNames = [
        ...new Set(ownKeys.map((key) => t(OWN_SETTING_LABELS[key]))),
    ];
    const rules = settings.subtitleBlacklist[site] ?? [];
    const saveRules = (next: string[], message: string): void =>
        void save(
            {
                subtitleBlacklist: {
                    ...settings.subtitleBlacklist,
                    [site]: next,
                },
            },
            { message }
        );
    const removeOwn = (): void => {
        void followAllSites(
            feedback,
            site,
            own,
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
                        <div className="help">{SITE_DOMAINS[site]}</div>
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
                            void save(
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
            <div className="row divided" id={`hide-${site}`}>
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
                        void save(
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
                                        saveRules(
                                            rules.filter(
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
                                saveRules(
                                    [...rules, next],
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
