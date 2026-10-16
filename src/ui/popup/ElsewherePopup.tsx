import { detectBrowserLanguage } from '@/config/schema';
import { useI18n } from '../hooks/useI18n';
import { useSettings } from '../hooks/useSettings';
import { SamplePreview, SAMPLE_SETTINGS_KEYS } from '../preview/SamplePreview';
import { SiteLinks } from '../SiteLinks';
import { PopupShell, PopupUnavailable } from './PopupShell';

const ELSEWHERE_KEYS = ['uiLanguage', ...SAMPLE_SETTINGS_KEYS] as const;

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

    return (
        <PopupShell t={t}>
            <section className="card">
                <SamplePreview t={t} settings={settings} />
                <h1 className="label">{t('popupElsewhereTitle')}</h1>
                <p className="help">{t('popupElsewhereHelp')}</p>
                <SiteLinks t={t} className="button big" />
            </section>
        </PopupShell>
    );
}
