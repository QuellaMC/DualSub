import React, { useEffect } from 'react';
import { AIAnalysisTab } from './components/tabs/AIAnalysisTab.jsx';
import { SidePanelProvider } from './hooks/SidePanelContext.jsx';
import { useTheme } from './hooks/useTheme.js';
import { useTranslation } from './hooks/useTranslation.js';

/**
 * Main side panel application. AI analysis is the panel's only shipped feature;
 * unfinished preview tabs belong in a separate, independently tested change.
 */
export function SidePanelApp() {
    const { loading: themeLoading, theme } = useTheme();
    const { t } = useTranslation();

    useEffect(() => {
        document.body.classList.toggle('dark', theme === 'dark');
    }, [theme]);

    if (themeLoading) {
        return (
            <div className="sidepanel-loading" role="status" aria-live="polite">
                <div className="spinner" aria-hidden="true" />
                <p>{t('sidepanelLoading')}</p>
            </div>
        );
    }

    return (
        <SidePanelProvider>
            <div className="sidepanel-container">
                <main className="sidepanel-content">
                    <AIAnalysisTab />
                </main>
            </div>
        </SidePanelProvider>
    );
}
