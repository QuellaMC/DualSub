import { useEffect } from 'react';
import { detectBrowserLanguage } from '@/config/schema';
import { useI18n } from '../hooks/useI18n';
import { useSettings } from '../hooks/useSettings';
import { WordPanel } from './WordPanel';

export const SIDEPANEL_SETTINGS_KEYS = [
    'uiLanguage',
    'sidePanelTheme',
] as const;

/** Keeps `body.dark` in step with the theme setting and the system theme. */
function useDarkTheme(mode: 'auto' | 'light' | 'dark' | undefined): void {
    useEffect(() => {
        const media = window.matchMedia('(prefers-color-scheme: dark)');
        const apply = () => {
            const dark = mode === 'dark' || (mode !== 'light' && media.matches);
            document.body.classList.toggle('dark', dark);
        };
        apply();
        media.addEventListener('change', apply);
        return () => media.removeEventListener('change', apply);
    }, [mode]);
}

export function SidePanelApp() {
    const { settings, status } = useSettings(SIDEPANEL_SETTINGS_KEYS);
    const { t, ready } = useI18n(
        settings?.uiLanguage ??
            (status === 'unavailable' ? detectBrowserLanguage() : null)
    );
    useDarkTheme(settings?.sidePanelTheme);

    if (!ready) {
        return (
            <div className="sidepanel-loading" role="status" aria-live="polite">
                <div className="spinner" aria-hidden="true" />
                <p>{t('sidepanelLoading')}</p>
            </div>
        );
    }
    return <WordPanel t={t} />;
}
