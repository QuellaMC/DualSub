import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { detectBrowserLanguage, getDefaultValue } from '@/config/schema';
import { resolveLook } from '@/content/renderer/looks';
import { toDisplaySettings } from '@/content/renderer/styling';
import { PLATFORM_IDS, PLATFORM_NAMES, platformHome } from '@/shared/platforms';
import { AUTO_LANGUAGE } from '@/shared/subtitleLanguages';
import { LanguageSelect } from '../design/LanguageSelect';
import { useI18n } from '../hooks/useI18n';
import { useSettings } from '../hooks/useSettings';
import { languageName } from '../languageLabels';
import { LookPreview } from '../preview/LookPreview';
import { sampleSubtitles, sampleVideoLanguage } from '../preview/sample';
import { PLATFORM_PRESETS } from '../subtitleStyle';

const WELCOME_KEYS = [
    'uiLanguage',
    'targetLanguage',
    'originalLanguage',
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

/** The page DualSub opens once, right after it is installed: what it
 *  picked, what the subtitles will look like, and how to start. */
export function WelcomeApp() {
    const { settings, status, save } = useSettings(WELCOME_KEYS);
    const { t, loadedLocale } = useI18n(
        settings?.uiLanguage ??
            (status === 'unavailable' ? detectBrowserLanguage() : null)
    );
    const [saveFailed, setSaveFailed] = useState(false);

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
            <main className="welcome">
                <p role="status">{t('commonLoading')}</p>
            </main>
        );
    }

    const fromBrowser =
        settings.targetLanguage === getDefaultValue('targetLanguage');
    const sample = sampleSubtitles(
        settings,
        sampleVideoLanguage(settings.targetLanguage)
    );
    const display = toDisplaySettings(settings);
    const pickLanguage = (targetLanguage: string): void => {
        save({ targetLanguage }).then(
            () => setSaveFailed(false),
            () => setSaveFailed(true)
        );
    };

    return (
        <main className="welcome">
            <header className="welcome-hero">
                <img src="/icons/icon128.png" alt="" width="64" height="64" />
                <h1>{t('welcomeTitle')}</h1>
                <p className="lead">{t('welcomeLead')}</p>
            </header>

            {saveFailed && (
                <p role="alert" className="notice danger">
                    {t('settingsSaveFailed')}
                </p>
            )}

            <section className="card" aria-labelledby="welcome-language">
                <LookPreview
                    display={display}
                    look={resolveLook(
                        display,
                        PLATFORM_PRESETS[PLATFORM_IDS[0]],
                        null
                    )}
                    originalText={sample.originalText}
                    translatedText={sample.translatedText}
                    label={t('previewLabel')}
                />
                <p className="help">
                    {t(
                        settings.originalLanguage === AUTO_LANGUAGE
                            ? 'previewCaptionAuto'
                            : 'previewCaptionFixed',
                        languageName(t, sample.originalLanguage),
                        languageName(t, sample.targetLanguage)
                    )}
                </p>
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
                        onChange={pickLanguage}
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
