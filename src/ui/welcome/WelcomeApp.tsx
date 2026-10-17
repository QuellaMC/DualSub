import { useEffect, useRef, useState, type ReactNode } from 'react';
import { browser } from 'wxt/browser';
import {
    detectBrowserLanguage,
    siteProfileOf,
    type SiteSettingKey,
} from '@/config/schema';
import { configService } from '@/config/service';
import { resolveLook } from '@/content/renderer/looks';
import { toDisplaySettings } from '@/content/renderer/styling';
import { PLATFORM_IDS, PLATFORM_NAMES, platformHome } from '@/shared/platforms';
import { KEYLESS_PROVIDERS, type ProviderId } from '@/shared/providers';
import {
    AUTO_LANGUAGE,
    browserTargetLanguage,
} from '@/shared/subtitleLanguages';
import { Icon } from '../design/Icon';
import { LanguageSelect } from '../design/LanguageSelect';
import { Logo } from '../design/Logo';
import { Switch } from '../design/Switch';
import { useI18n, type Translate } from '../hooks/useI18n';
import {
    SERVICE_SETUP_KEYS,
    translationStopped,
    useServiceUnset,
} from '../hooks/useServiceUnset';
import {
    useSettings,
    type SettingsHandle,
    type SettingsProjection,
} from '../hooks/useSettings';
import {
    siteNames,
    sitesOn,
    sitesOnTitle,
    sitesTranslating,
} from '../hooks/useSitesOn';
import { languageName } from '../languageLabels';
import { LookPreview } from '../preview/LookPreview';
import { sampleSubtitles, sampleVideoLanguage } from '../preview/sample';
import { PROVIDER_NAME_KEYS } from '../providerNames';
import { PLATFORM_PRESETS } from '../subtitleStyle';

const WELCOME_KEYS = [
    'uiLanguage',
    'subtitlesEnabled',
    'targetLanguage',
    'originalLanguage',
    'useOfficialTranslations',
    'translationFallback',
    'siteProfiles',
    ...SERVICE_SETUP_KEYS,
    'subtitleStyle',
    'subtitleCustomLook',
    'subtitleTranslationColor',
    'subtitleFontScale',
    'subtitleGap',
    'subtitleVerticalPosition',
    'subtitleLayoutOrientation',
    'subtitleLayoutOrder',
    'subtitleTimeOffset',
] as const;

type WelcomeKey = (typeof WELCOME_KEYS)[number];

/** The page's controls that change settings. */
type PickedControl = 'switch' | 'language';

/** The sample's text takes the size it would have on a picture this many
 *  pixels tall. */
const PICTURE_HEIGHT = 1100;

/** The settings a site can keep of its own that change what this page
 *  shows and says about the subtitles. */
const DESCRIBED_SITE_KEYS: readonly string[] = [
    'originalLanguage',
    'useOfficialTranslations',
    'subtitleStyle',
    'subtitleCustomLook',
    'subtitleTranslationColor',
    'subtitleFontScale',
    'subtitleGap',
    'subtitleVerticalPosition',
    'subtitleLayoutOrientation',
    'subtitleLayoutOrder',
] satisfies readonly SiteSettingKey[];

/** How the lines sit, in the lead's words, as the saved settings put them:
 *  one line where nothing the page describes translates. */
function arrangementKey(
    translates: boolean,
    settings: Pick<
        SettingsProjection<WelcomeKey>,
        'subtitleLayoutOrder' | 'subtitleLayoutOrientation'
    >
): string {
    if (!translates) {
        return 'welcomeArrangeOneLine';
    }
    if (settings.subtitleLayoutOrientation === 'row') {
        return 'welcomeArrangeSideBySide';
    }
    return settings.subtitleLayoutOrder === 'translation_top'
        ? 'welcomeArrangeMineFirst'
        : 'welcomeArrangeVideoFirst';
}

/** What the lead says is left to do, for each state the page finds; one
 *  with DualSub off on some sites names them. */
const READINESS_KEYS = {
    ready: 'welcomeStateReady',
    partial: 'welcomeStatePartial',
    off: 'welcomeStateOff',
    stopped: 'welcomeStateSetUp',
} as const;

function isKeyless(provider: ProviderId): boolean {
    return (KEYLESS_PROVIDERS as readonly ProviderId[]).includes(provider);
}

/** One choice DualSub made, ticked off, or flagged while it still needs
 *  something. */
function Picked({
    title,
    help,
    ready = true,
    children,
}: {
    title: string;
    help: string;
    ready?: boolean;
    children?: ReactNode;
}) {
    return (
        <div className="picked">
            <span
                className={`check-dot ${ready ? '' : 'off'}`}
                aria-hidden="true"
            >
                <Icon name={ready ? 'check' : 'alert'} />
            </span>
            <div className="picked-text">
                <div className="label">{title}</div>
                <div className="help">{help}</div>
            </div>
            {children}
        </div>
    );
}

/** The page DualSub opens once, right after it is installed: what it
 *  picked, what the subtitles will look like, and how to start. */
export function WelcomeApp() {
    const { settings, status, save } = useSettings(WELCOME_KEYS, {
        includeSensitive: true,
    });
    const { t, loadedLocale } = useI18n(
        settings?.uiLanguage ??
            (status === 'unavailable' ? detectBrowserLanguage() : null)
    );

    useEffect(() => {
        if (loadedLocale !== null) {
            document.title = t('welcomePageTitle');
        }
    }, [loadedLocale, t]);

    if (loadedLocale !== null && status === 'unavailable') {
        return (
            <main className="welcome">
                <p role="alert" className="notice danger">
                    {t('settingsLoadFailed')}
                </p>
            </main>
        );
    }
    if (!settings || loadedLocale === null) {
        return (
            <main className="welcome" aria-busy="true">
                {loadedLocale !== null && (
                    <p role="status">{t('commonLoading')}</p>
                )}
            </main>
        );
    }
    return <Welcome t={t} settings={settings} save={save} />;
}

/** The page, once its settings are read. */
function Welcome({
    t,
    settings,
    save,
}: {
    t: Translate;
    settings: SettingsProjection<WelcomeKey>;
    save: SettingsHandle<WelcomeKey>['save'];
}) {
    /** The controls whose latest change could not be saved. */
    const [failed, setFailed] = useState<ReadonlySet<PickedControl>>(new Set());
    const [changingLanguage, setChangingLanguage] = useState(false);
    /** Each control's latest change, the only one that may report how it
     *  was saved; a change to another control reports on its own. */
    const latestPicks = useRef(new Map<PickedControl, number>());
    const sites = sitesOn(settings);
    const working = sites.on.length > 0;
    const everywhere = sites.off.length === 0;
    // The page describes the sites DualSub runs on, or every site while it
    // runs on none, as its switch would turn them on.
    const described = working ? sites.on : PLATFORM_IDS;
    const translates = sitesTranslating(settings).some((site) =>
        described.includes(site)
    );
    const unset = useServiceUnset(settings);
    const stopped = translationStopped({
        translating: working && translates,
        unset,
        fallback: settings.translationFallback,
    });
    /** Dual subtitles were off on some site, say from another computer, so
     *  the page offers the switch, and keeps it once switched. */
    const [offeredSwitch, setOfferedSwitch] = useState(false);
    if (!everywhere && !offeredSwitch) {
        setOfferedSwitch(true);
    }
    const readiness = !working
        ? 'off'
        : stopped
          ? 'stopped'
          : everywhere
            ? 'ready'
            : 'partial';
    const ownSites = PLATFORM_IDS.filter((site) =>
        Object.keys(siteProfileOf(settings.siteProfiles, site)).some((key) =>
            DESCRIBED_SITE_KEYS.includes(key)
        )
    );

    const fromBrowser = settings.targetLanguage === browserTargetLanguage();
    const sample = sampleSubtitles(
        settings,
        sampleVideoLanguage(settings.targetLanguage)
    );
    const display = toDisplaySettings(settings);
    const automaticTop = settings.originalLanguage === AUTO_LANGUAGE;
    const provider = settings.selectedProvider;
    const pick = (
        control: PickedControl,
        write: Promise<unknown>
    ): Promise<void> => {
        const made = (latestPicks.current.get(control) ?? 0) + 1;
        latestPicks.current.set(control, made);
        const report = (saveFailed: boolean) => (): void => {
            if (latestPicks.current.get(control) === made) {
                setFailed((current) => {
                    const next = new Set(current);
                    if (saveFailed) {
                        next.add(control);
                    } else {
                        next.delete(control);
                    }
                    return next;
                });
            }
        };
        return write.then(report(false), report(true));
    };

    return (
        <>
            <header className="welcome-top">
                <div className="brand">
                    <Logo size={34} />
                    <span>DualSub</span>
                </div>
                <span className="tag ok">
                    <Icon name="check" />
                    {t('welcomeInstalled')}
                </span>
            </header>

            <main className="welcome">
                <section className="welcome-hero">
                    <div className="welcome-hero-text">
                        <h1>
                            {t(
                                readiness === 'ready'
                                    ? 'welcomeTitle'
                                    : 'welcomePageTitle'
                            )}
                        </h1>
                        <p className="lead">
                            {t(
                                'welcomeLeadFormat',
                                t(arrangementKey(translates, settings)),
                                t(
                                    READINESS_KEYS[readiness],
                                    siteNames(settings.uiLanguage, sites.off)
                                )
                            )}
                        </p>
                    </div>
                    <div className="welcome-frame">
                        <LookPreview
                            display={display}
                            look={resolveLook(
                                display,
                                PLATFORM_PRESETS[PLATFORM_IDS[0]],
                                null
                            )}
                            pictureHeight={PICTURE_HEIGHT}
                            originalText={sample.originalText}
                            translatedText={sample.translatedText}
                            label={t('previewLabel')}
                        />
                        {sample.standIns.map((language) => (
                            <p key={language} className="help">
                                {t('previewStandIn', languageName(t, language))}
                            </p>
                        ))}
                        {ownSites.length > 0 && (
                            <p className="help">
                                {t(
                                    'welcomeSitesOwn',
                                    siteNames(settings.uiLanguage, ownSites)
                                )}
                            </p>
                        )}
                    </div>
                </section>

                {failed.size > 0 && (
                    <p role="alert" className="notice danger">
                        {t('settingsSaveFailed')}
                    </p>
                )}

                {offeredSwitch && (
                    <section className="card">
                        <div className="row">
                            <div className="grow">
                                <h2 className="label">
                                    {sitesOnTitle(
                                        t,
                                        settings.uiLanguage,
                                        settings.subtitlesEnabled,
                                        sites
                                    )}
                                </h2>
                                <p className="help">
                                    {t(
                                        working
                                            ? 'startStatusReadyHelp'
                                            : 'startStatusOffHelp'
                                    )}
                                </p>
                            </div>
                            <div className="inline">
                                <span className="strong" id="welcome-enabled">
                                    {t('startEnabled')}
                                </span>
                                <Switch
                                    checked={everywhere}
                                    labelledBy="welcome-enabled"
                                    onChange={(subtitlesEnabled) =>
                                        pick(
                                            'switch',
                                            configService.removeSiteValues(
                                                PLATFORM_IDS,
                                                ['subtitlesEnabled'],
                                                { subtitlesEnabled }
                                            )
                                        )
                                    }
                                />
                            </div>
                        </div>
                    </section>
                )}

                <section className="card" aria-labelledby="welcome-picked">
                    <h2 id="welcome-picked">{t('welcomePickedTitle')}</h2>
                    <Picked
                        title={t(
                            'welcomeLanguage',
                            languageName(t, settings.targetLanguage)
                        )}
                        help={t(
                            fromBrowser
                                ? 'welcomeLanguageFromBrowser'
                                : 'welcomeLanguageHelp'
                        )}
                    >
                        {changingLanguage ? (
                            <div className="inline wrap">
                                <span className="sr-only" id="welcome-language">
                                    {t('welcomeLanguageLabel')}
                                </span>
                                <LanguageSelect
                                    t={t}
                                    id="welcome-target"
                                    labelledBy="welcome-language"
                                    value={settings.targetLanguage}
                                    onChange={(targetLanguage) =>
                                        void pick(
                                            'language',
                                            save({ targetLanguage })
                                        )
                                    }
                                />
                                <button
                                    type="button"
                                    className="button primary"
                                    onClick={() => setChangingLanguage(false)}
                                >
                                    {t('commonDone')}
                                </button>
                            </div>
                        ) : (
                            <button
                                type="button"
                                className="button"
                                onClick={() => setChangingLanguage(true)}
                            >
                                {t('commonChange')}
                            </button>
                        )}
                    </Picked>
                    <Picked
                        title={
                            automaticTop
                                ? t('welcomeTopAuto')
                                : t(
                                      'welcomeTopFixed',
                                      languageName(t, settings.originalLanguage)
                                  )
                        }
                        help={t(
                            automaticTop
                                ? 'welcomeTopAutoHelp'
                                : 'welcomeTopFixedHelp'
                        )}
                    />
                    {!translates ? (
                        <Picked
                            title={t('welcomeTranslationNone')}
                            help={t('welcomeTranslationNoneHelp')}
                        />
                    ) : unset ? (
                        <Picked
                            ready={false}
                            title={t(
                                'startNeedsSetupTitle',
                                t(PROVIDER_NAME_KEYS[provider])
                            )}
                            help={
                                settings.translationFallback
                                    ? t(
                                          'startNeedsSetupCovered',
                                          t(
                                              PROVIDER_NAME_KEYS[
                                                  KEYLESS_PROVIDERS[0]
                                              ]
                                          )
                                      )
                                    : t('startNeedsSetupStopped')
                            }
                        />
                    ) : (
                        <Picked
                            title={t(
                                'welcomeTranslation',
                                t(PROVIDER_NAME_KEYS[provider])
                            )}
                            help={[
                                t(
                                    isKeyless(provider)
                                        ? 'welcomeTranslationFree'
                                        : 'welcomeTranslationKeyed'
                                ),
                                ...(settings.useOfficialTranslations
                                    ? [t('welcomeTranslationOfficial')]
                                    : []),
                            ].join(' ')}
                        />
                    )}
                </section>

                <h2>{t('welcomeStepsTitle')}</h2>
                <ol className="welcome-steps">
                    <li className="card">
                        <span className="step-number" aria-hidden="true">
                            1
                        </span>
                        <div className="label">{t('welcomePinTitle')}</div>
                        <p className="help">{t('welcomePinHelp')}</p>
                        <div className="toolbar-art" aria-hidden="true">
                            <span className="address-art" />
                            <span className="toolbar-button ringed">
                                <Icon name="puzzle" />
                            </span>
                        </div>
                        <div className="menu-art" aria-hidden="true">
                            <span className="menu-name">
                                <Logo size={22} />
                                DualSub
                            </span>
                            <span className="toolbar-button ringed pin">
                                <Icon name="pin" />
                            </span>
                        </div>
                    </li>
                    <li className="card">
                        <span className="step-number" aria-hidden="true">
                            2
                        </span>
                        <div className="label">{t('welcomeOpenTitle')}</div>
                        <p className="help">{t('welcomeOpenHelp')}</p>
                        <div className="site-buttons">
                            {PLATFORM_IDS.map((site) => (
                                <a
                                    key={site}
                                    className="button big"
                                    href={platformHome(site)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    {t('startOpenSite', PLATFORM_NAMES[site])}
                                </a>
                            ))}
                        </div>
                    </li>
                    <li className="card">
                        <span className="step-number" aria-hidden="true">
                            3
                        </span>
                        <div className="label">{t('welcomePlayTitle')}</div>
                        <p className="help">{t('welcomePlayHelp')}</p>
                        <div className="popup-art" aria-hidden="true">
                            <div className="popup-art-row">
                                <span>{t('startEnabled')}</span>
                                <span className="switch-art" />
                            </div>
                            <div className="popup-art-row">
                                <span>{t('lookSizeTitle')}</span>
                                <span className="inline">
                                    <span className="key-art">A−</span>
                                    <span className="key-art">A+</span>
                                </span>
                            </div>
                            <div className="popup-art-row">
                                <span>{t('navTiming')}</span>
                                <span className="inline">
                                    <span className="key-art">
                                        {t('welcomeEarlier')}
                                    </span>
                                    <span className="key-art">
                                        {t('welcomeLater')}
                                    </span>
                                </span>
                            </div>
                        </div>
                    </li>
                </ol>

                <footer className="welcome-footer">
                    <p className="help">{t('welcomeClose')}</p>
                    <button
                        type="button"
                        className="button quiet"
                        onClick={() => void browser.runtime.openOptionsPage()}
                    >
                        {t('welcomeOpenSettings')}
                    </button>
                </footer>
            </main>
        </>
    );
}
