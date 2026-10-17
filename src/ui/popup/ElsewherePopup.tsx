import { detectBrowserLanguage } from '@/config/schema';
import { PLATFORM_IDS, PLATFORM_NAMES } from '@/shared/platforms';
import { useI18n } from '../hooks/useI18n';
import { useSettings } from '../hooks/useSettings';
import { SiteLinks } from '../SiteLinks';
import { PopupShell, PopupUnavailable } from './PopupShell';

const ELSEWHERE_KEYS = ['uiLanguage'] as const;

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
            <div className="guide">
                <section className="card">
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
            </div>
        </PopupShell>
    );
}
