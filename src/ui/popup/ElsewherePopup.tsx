import { detectBrowserLanguage } from '@/config/schema';
import { PLATFORM_IDS, PLATFORM_NAMES } from '@/shared/platforms';
import { useI18n } from '../hooks/useI18n';
import { useSettings } from '../hooks/useSettings';
import { SamplePreview, SAMPLE_SETTINGS_KEYS } from '../preview/SamplePreview';
import { SiteLinks } from '../SiteLinks';
import { PopupShell, PopupUnavailable } from './PopupShell';

const ELSEWHERE_KEYS = ['uiLanguage', ...SAMPLE_SETTINGS_KEYS] as const;

/** The sample's text takes the size it would have on a picture this many
 *  pixels tall. */
const PICTURE_HEIGHT = 750;

/** The popup anywhere DualSub does not work: what it does, and the sites
 *  it works on. */
export function ElsewherePopup() {
    const { settings, status } = useSettings(ELSEWHERE_KEYS);
    const { t, loadedLocale } = useI18n(
        settings?.uiLanguage ??
            (status === 'unavailable' ? detectBrowserLanguage() : null)
    );

    if (loadedLocale !== null && status === 'unavailable') {
        return <PopupUnavailable t={t} />;
    }
    if (!settings || loadedLocale === null) {
        return <div className="popup" aria-busy="true" />;
    }

    const sites = (type: 'conjunction' | 'disjunction'): string =>
        new Intl.ListFormat(settings.uiLanguage, { type }).format(
            PLATFORM_IDS.map((site) => PLATFORM_NAMES[site])
        );
    return (
        <PopupShell t={t}>
            <section className="card">
                <div className="popup-sample">
                    <SamplePreview
                        t={t}
                        settings={settings}
                        pictureHeight={PICTURE_HEIGHT}
                    />
                </div>
                <h1 className="title">
                    {t('popupElsewhereTitle', sites('conjunction'))}
                </h1>
                <p className="help">{t('popupElsewhereHelp')}</p>
                <SiteLinks t={t} className="button big" />
            </section>
            <section className="card">
                <h2 className="title small">
                    {t('popupAlreadyTitle', sites('disjunction'))}
                </h2>
                <ol className="checklist">
                    <li>{t('popupAlreadyPlay')}</li>
                    <li>{t('popupAlreadyNone')}</li>
                </ol>
            </section>
        </PopupShell>
    );
}
