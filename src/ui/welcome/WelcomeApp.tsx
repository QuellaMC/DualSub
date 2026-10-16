import { useEffect, useRef, useState, type ReactNode } from 'react';
import { browser } from 'wxt/browser';
import { detectBrowserLanguage } from '@/config/schema';
import { configService } from '@/config/service';
import { PLATFORM_IDS } from '@/shared/platforms';
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
import { useSitesOn } from '../hooks/useSitesOn';
import { languageName } from '../languageLabels';
import { SamplePreview, SAMPLE_SETTINGS_KEYS } from '../preview/SamplePreview';
import { PROVIDER_NAME_KEYS } from '../providerNames';
import { SiteLinks } from '../SiteLinks';

const WELCOME_KEYS = [
    'uiLanguage',
    'subtitlesEnabled',
    'useOfficialTranslations',
    'translationFallback',
    ...SERVICE_SETUP_KEYS,
    ...SAMPLE_SETTINGS_KEYS,
] as const;

type WelcomeKey = (typeof WELCOME_KEYS)[number];

/** The sample's text takes the size it would have on a picture this many
 *  pixels tall. */
const PICTURE_HEIGHT = 1100;

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
    const [saveFailed, setSaveFailed] = useState(false);
    const [changingLanguage, setChangingLanguage] = useState(false);
    /** Only the latest pick's save may report how it went. */
    const latestPick = useRef(0);
    const { sites } = useSitesOn();
    const working = sites ? sites.on.length > 0 : settings.subtitlesEnabled;
    const unset = useServiceUnset(settings);
    const stopped = translationStopped(
        working,
        unset,
        settings.translationFallback
    );
    /** Dual subtitles were off everywhere, say from another computer, so
     *  the page offers the switch, and keeps it once switched. */
    const [offeredSwitch, setOfferedSwitch] = useState(false);
    if (!working && !offeredSwitch) {
        setOfferedSwitch(true);
    }

    const fromBrowser = settings.targetLanguage === browserTargetLanguage();
    const automaticTop = settings.originalLanguage === AUTO_LANGUAGE;
    const provider = settings.selectedProvider;
    const pick = (write: Promise<unknown>): Promise<void> => {
        const made = ++latestPick.current;
        const report = (failed: boolean) => (): void => {
            if (made === latestPick.current) {
                setSaveFailed(failed);
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
                                working && !stopped
                                    ? 'welcomeTitle'
                                    : 'welcomePageTitle'
                            )}
                        </h1>
                        <p className="lead">
                            {t(stopped ? 'welcomeLeadSetUp' : 'welcomeLead')}
                        </p>
                    </div>
                    <div className="welcome-frame">
                        <SamplePreview
                            t={t}
                            settings={settings}
                            pictureHeight={PICTURE_HEIGHT}
                            standIns
                        />
                    </div>
                </section>

                {saveFailed && (
                    <p role="alert" className="notice danger">
                        {t('settingsSaveFailed')}
                    </p>
                )}

                {offeredSwitch && (
                    <section className="card">
                        <div className="row">
                            <div className="grow">
                                <h2 className="label">
                                    {t(
                                        working
                                            ? 'startStatusOn'
                                            : 'startStatusOff'
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
                                    checked={working}
                                    labelledBy="welcome-enabled"
                                    onChange={(subtitlesEnabled) =>
                                        pick(
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
                                        void pick(save({ targetLanguage }))
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
                    {unset ? (
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
                            <SiteLinks t={t} className="button big" />
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
