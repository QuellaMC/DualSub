import React, { useState, useEffect, useCallback } from 'react';
import { TabNavigator } from './components/TabNavigator.jsx';
import { AIAnalysisTab } from './components/tabs/AIAnalysisTab.jsx';
import { WordsListsTab } from './components/tabs/WordsListsTab.jsx';
import { useTheme } from './hooks/useTheme.js';
import { useSettings } from './hooks/useSettings.js';
import { SidePanelProvider } from './hooks/SidePanelContext.jsx';
import { useSidePanelCommunication } from './hooks/useSidePanelCommunication.js';
import { useTranslation } from './hooks/useTranslation.js';

/**
 * Main Side Panel Application Component
 * 
 * Provides a tabbed interface for AI Context Analysis and Word Lists features.
 * Manages theme, settings, and global state for the side panel.
 */
export function SidePanelApp() {
    const [activeTab, setActiveTab] = useState('ai-analysis');
    const { theme } = useTheme();
    const { settings, loading: settingsLoading } = useSettings([
        'sidePanelTheme',
        'sidePanelWordsListsEnabled',
        'uiLanguage',
    ]);
    const { t } = useTranslation();

    const handleTabChange = useCallback(
        (tabId) => {
            setActiveTab(tabId);
            postMessage('sidePanelUpdateState', { activeTab: tabId });
        },
        []
    );

    // Apply theme class to body
    useEffect(() => {
        if (theme === 'dark') {
            document.body.classList.add('dark');
        } else {
            document.body.classList.remove('dark');
        }
    }, [theme]);

    // Load default tab from settings
    useEffect(() => {
        if (settings.sidePanelDefaultTab && !settingsLoading) {
            setActiveTab((prev) => prev || settings.sidePanelDefaultTab);
        }
    }, [settings.sidePanelDefaultTab, settingsLoading]);

    // Show loading state while settings are loading
    if (settingsLoading) {
        return (
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '100%',
                    padding: '2rem',
                }}
            >
                <div style={{ textAlign: 'center' }}>
                    <div className="spinner" />
                    <p style={{ color: 'var(--color-subtle-light)' }}>
                        {t('sidepanelLoading')}
                    </p>
                </div>
            </div>
        );
    }

    return (
        <SidePanelProvider>
            <div className="sidepanel-container">
                <TabNavigator
                    activeTab={activeTab}
                    onTabChange={setActiveTab}
                    settings={settings}
                />
                <main className="sidepanel-content">
                    {activeTab === 'ai-analysis' && <AIAnalysisTab />}
                    {activeTab === 'words-lists' && <WordsListsTab />}
                </main>
            </div>
        </SidePanelProvider>
    );
}
