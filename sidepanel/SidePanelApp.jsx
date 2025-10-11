import React, { useState, useEffect } from 'react';
import { TabNavigator } from './components/TabNavigator.jsx';
import { AIAnalysisTab } from './components/tabs/AIAnalysisTab.jsx';
import { WordsListsTab } from './components/tabs/WordsListsTab.jsx';
import { useTheme } from './hooks/useTheme.js';
import { useSettings } from './hooks/useSettings.js';
import { SidePanelProvider } from './hooks/SidePanelContext.jsx';
import { useSidePanelCommunication } from './hooks/useSidePanelCommunication.js';

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
                    <div
                        style={{
                            width: '40px',
                            height: '40px',
                            border: '4px solid var(--color-border-light)',
                            borderTopColor: 'var(--color-primary)',
                            borderRadius: '50%',
                            animation: 'spin 1s linear infinite',
                            margin: '0 auto 1rem',
                        }}
                    />
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
                    onTabChange={setActiveTab}
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

                @keyframes spin {
                    to {
                        transform: rotate(360deg);
                    }
                }
            `}</style>
        </SidePanelProvider>
    );
}
