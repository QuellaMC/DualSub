import { detectBrowserLanguage } from '@/config/schema';
import { useI18n } from '../hooks/useI18n';
import { useSettings } from '../hooks/useSettings';
import { openSettings } from '../openSettings';
import { PopupShell, PopupUnavailable } from './PopupShell';

const ELSEWHERE_KEYS = ['uiLanguage'] as const;

/** The popup anywhere DualSub does not work: that it does not work here,
 *  and the way to the settings page's list of the sites it works on. One
 *  button stands for them all, so the popup never grows with the list. */
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
            <div className="guide">
                <section className="card">
                    <h1 className="title">{t('popupElsewhereTitle')}</h1>
                    <p className="help">{t('popupElsewhereHelp')}</p>
                    <button
                        type="button"
                        className="button big"
                        onClick={() => openSettings('sites')}
                    >
                        {t('popupSeeSites')}
                    </button>
                </section>
                <section className="card">
                    <h2 className="title small">{t('popupAlreadyTitle')}</h2>
                    <ol className="checklist">
                        <li>{t('popupAlreadyPlay')}</li>
                        <li>{t('popupAlreadyNone')}</li>
                    </ol>
                </section>
            </div>
        </PopupShell>
    );
}
