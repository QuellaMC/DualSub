import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { detectBrowserLanguage, getDefaultValue } from '@/config/schema';
import { LanguageSelect } from '../design/LanguageSelect';
import { useI18n } from '../hooks/useI18n';
import { useSettings } from '../hooks/useSettings';
import { SamplePreview, SAMPLE_SETTINGS_KEYS } from '../preview/SamplePreview';
import { SiteLinks } from '../SiteLinks';

const WELCOME_KEYS = ['uiLanguage', ...SAMPLE_SETTINGS_KEYS] as const;

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
                <SamplePreview t={t} settings={settings} caption />
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
                                <SiteLinks t={t} className="button" />
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
