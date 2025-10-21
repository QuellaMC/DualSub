import React, { useState, useEffect } from 'react';
import { TabNavigator } from './components/TabNavigator.jsx';
import { AIAnalysisTab } from './components/tabs/AIAnalysisTab.jsx';
import { WordsListsTab } from './components/tabs/WordsListsTab.jsx';
import { useTheme } from './hooks/useTheme.js';
import { useSettings } from './hooks/useSettings.js';
import { SidePanelProvider } from './hooks/SidePanelContext.jsx';
import { useSidePanelCommunication } from './hooks/useSidePanelCommunication.js';
import { useCallback } from 'react';

/**
 * Main Side Panel Application Component
 * 
 * Provides a tabbed interface for AI Context Analysis and Word Lists features.
 * Manages theme, settings, and global state for the side panel.
 */
export function SidePanelApp() {
    // Internal component to handle SIDEPANEL_UPDATE_STATE
    function SidePanelStateSync({ onRequestTabChange }) {
        const { onMessage } = useSidePanelCommunication();
        useEffect(() => {
            const unsubscribe = onMessage('sidePanelUpdateState', (data) => {
                if (data?.activeTab) {
                    onRequestTabChange(data.activeTab);
                }
            });
            return unsubscribe;
        }, [onMessage, onRequestTabChange]);
        return null;
    }
    const [activeTab, setActiveTab] = useState('ai-analysis');
    const { theme, toggleTheme } = useTheme();
    const { settings, loading: settingsLoading } = useSettings();
    const { postMessage } = useSidePanelCommunication();

    const handleTabChange = useCallback(
        (tabId) => {
            setActiveTab(tabId);
            postMessage('sidePanelUpdateState', { activeTab: tabId });
        },
        [postMessage]
    );

    // Apply theme class to body
    useEffect(() => {
        if (theme === 'dark') {
            document.body.classList.add('dark');
        } else {
            document.body.classList.remove('dark');
        }
    }, [theme]);

    // Load default tab from settings, but allow background to override via message
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
                        Loading...
                    </p>
                </div>
            </div>
        );
    }

    return (
        <SidePanelProvider>
            <SidePanelStateSync onRequestTabChange={(tab) => setActiveTab(tab)} />
            <div className="sidepanel-container">
                <TabNavigator
                    activeTab={activeTab}
                    onTabChange={handleTabChange}
                    settings={settings}
                />
                <main className="sidepanel-content">
                    {activeTab === 'ai-analysis' && <AIAnalysisTab />}
                    {activeTab === 'words-lists' && <WordsListsTab />}
                </main>
            </div>

            <style>{`
                .sidepanel-container {
                    display: flex;
                    flex-direction: column;
                    height: 100%;
                    width: 100%;
                    overflow: hidden;
                }

                .sidepanel-content {
                    flex: 1;
                    overflow-y: auto;
                    overflow-x: hidden;
                }
            `}</style>
        </SidePanelProvider>
    );
}
