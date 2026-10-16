import { useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { detectBrowserLanguage } from '@/config/schema';
import { resolveLook } from '@/content/renderer/looks';
import { toDisplaySettings } from '@/content/renderer/styling';
import { PLATFORM_IDS, PLATFORM_NAMES, platformHome } from '@/shared/platforms';
import { browserTargetLanguage } from '@/shared/subtitleLanguages';
import { LanguageSelect } from '../design/LanguageSelect';
import { Switch } from '../design/Switch';
import { useI18n } from '../hooks/useI18n';
import { useSettings } from '../hooks/useSettings';
import { languageName } from '../languageLabels';
import { LookPreview } from '../preview/LookPreview';
import {
    sampleCaption,
    sampleSubtitles,
    sampleVideoLanguage,
} from '../preview/sample';
import { PLATFORM_PRESETS } from '../subtitleStyle';

const WELCOME_KEYS = [
    'uiLanguage',
    'subtitlesEnabled',
    'targetLanguage',
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
    'subtitleTimeOffset',
] as const;

/** The sample's text takes the size it would have on a picture this many
 *  pixels tall. */
const PICTURE_HEIGHT = 1100;

/** The page DualSub opens once, right after it is installed: what it
 *  picked, what the subtitles will look like, and how to start. */
export function WelcomeApp() {
    const { settings, status, save } = useSettings(WELCOME_KEYS);
    const { t, loadedLocale } = useI18n(
        settings?.uiLanguage ??
            (status === 'unavailable' ? detectBrowserLanguage() : null)
    );
    const [saveFailed, setSaveFailed] = useState(false);
    /** Only the latest pick's save may report how it went. */
    const latestPick = useRef(0);
    /** Dual subtitles were off, say from another computer, so the page
     *  offers the switch, and keeps it once switched. */
    const [offeredSwitch, setOfferedSwitch] = useState(false);
    if (settings && !settings.subtitlesEnabled && !offeredSwitch) {
        setOfferedSwitch(true);
    }

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

    const fromBrowser = settings.targetLanguage === browserTargetLanguage();
    const sample = sampleSubtitles(
        settings,
        sampleVideoLanguage(settings.targetLanguage)
    );
    const display = toDisplaySettings(settings);
    const pick = (changes: Parameters<typeof save>[0]): Promise<void> => {
        const made = ++latestPick.current;
        const report = (failed: boolean) => (): void => {
            if (made === latestPick.current) {
                setSaveFailed(failed);
            }
        };
        return save(changes).then(report(false), report(true));
    };

    return (
        <main className="welcome">
            <header className="welcome-hero">
                <img src="/icons/icon128.png" alt="" width="64" height="64" />
                <h1>
                    {t(
                        settings.subtitlesEnabled
                            ? 'welcomeTitle'
                            : 'welcomePageTitle'
                    )}
                </h1>
                <p className="lead">{t('welcomeLead')}</p>
            </header>

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
                                    settings.subtitlesEnabled
                                        ? 'startStatusOn'
                                        : 'startStatusOff'
                                )}
                            </h2>
                            <p className="help">
                                {t(
                                    settings.subtitlesEnabled
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
                                checked={settings.subtitlesEnabled}
                                labelledBy="welcome-enabled"
                                onChange={(subtitlesEnabled) =>
                                    pick({ subtitlesEnabled })
                                }
                            />
                        </div>
                    </div>
                </section>
            )}

            <section className="card" aria-labelledby="welcome-language">
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
                <p className="help">{sampleCaption(t, settings, sample)}</p>
                {sample.standIns.map((language) => (
                    <p key={language} className="help">
                        {t('previewStandIn', languageName(t, language))}
                    </p>
                ))}
                <div className="row">
                    <div className="grow">
                        <h2 className="label" id="welcome-language">
                            {t('welcomeLanguageTitle')}
                        </h2>
                        {fromBrowser && (
                            <p className="help">{t('welcomeLanguageHelp')}</p>
                        )}
                    </div>
                    <LanguageSelect
                        t={t}
                        id="welcome-target"
                        labelledBy="welcome-language"
                        value={settings.targetLanguage}
                        onChange={(targetLanguage) =>
                            void pick({ targetLanguage })
                        }
                    />
                </div>
            </section>

            <section className="card" aria-labelledby="welcome-steps">
                <h2 className="label" id="welcome-steps">
                    {t('welcomeStepsTitle')}
                </h2>
                <ol className="steps">
                    <li>
                        <div>
                            <div className="strong">{t('welcomePinTitle')}</div>
                            <p className="help">{t('welcomePinHelp')}</p>
                        </div>
                    </li>
                    <li>
                        <div>
                            <div className="strong">
                                {t('welcomeOpenTitle')}
                            </div>
                            <div className="inline wrap">
                                {PLATFORM_IDS.map((site) => (
                                    <a
                                        key={site}
                                        className="button"
                                        href={platformHome(site)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                    >
                                        {t(
                                            'startOpenSite',
                                            PLATFORM_NAMES[site]
                                        )}
                                    </a>
                                ))}
                            </div>
                        </div>
                    </li>
                    <li>
                        <div>
                            <div className="strong">
                                {t('welcomePlayTitle')}
                            </div>
                            <p className="help">{t('welcomePlayHelp')}</p>
                        </div>
                    </li>
                </ol>
            </section>

            <section className="card" aria-labelledby="welcome-settings">
                <div className="row">
                    <div className="grow">
                        <h2 className="label" id="welcome-settings">
                            {t('welcomeSettingsTitle')}
                        </h2>
                        <p className="help">{t('welcomeSettingsHelp')}</p>
                    </div>
                    <button
                        type="button"
                        className="button"
                        onClick={() => void browser.runtime.openOptionsPage()}
                    >
                        {t('welcomeOpenSettings')}
                    </button>
                </div>
            </section>

            <p className="help welcome-close">{t('welcomeClose')}</p>
        </main>
    );
}
