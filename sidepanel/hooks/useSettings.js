import { useState, useEffect } from 'react';

/**
 * Settings Management Hook
 * 
 * Provides access to Chrome storage settings with real-time updates.
 * Mirrors the pattern used in popup/options hooks.
 */
export function useSettings() {
    const [settings, setSettings] = useState({
        // Side Panel defaults
        sidePanelEnabled: true,
        sidePanelDefaultTab: 'ai-analysis',
        sidePanelTheme: 'auto',
        sidePanelWordsListsEnabled: false,
        sidePanelPersistAcrossTabs: true,
        sidePanelAutoPauseVideo: true,
        sidePanelAutoResumeVideo: false,
        
        // AI Context settings
        aiContextEnabled: false,
        aiContextProvider: 'openai',
        aiContextTypes: ['cultural', 'historical', 'linguistic'],
        aiContextTimeout: 30000,
        
        // Language settings
        originalLanguage: 'en',
        targetLanguage: 'zh-CN',
    });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const loadSettings = async () => {
            try {
                const result = await chrome.storage.sync.get(null);
                setSettings((prev) => ({ ...prev, ...result }));
            } catch (err) {
                console.error('Error loading settings:', err);
                setError(err);
            } finally {
                setLoading(false);
            }
        };

        loadSettings();

        // Listen for settings changes
        const handleStorageChange = (changes, areaName) => {
            if (areaName === 'sync') {
                const updates = {};
                for (const [key, { newValue }] of Object.entries(changes)) {
                    updates[key] = newValue;
                }
                setSettings((prev) => ({ ...prev, ...updates }));
            }
        };

        chrome.storage.onChanged.addListener(handleStorageChange);
        return () => chrome.storage.onChanged.removeListener(handleStorageChange);
    }, []);

    const updateSetting = async (key, value) => {
        try {
            await chrome.storage.sync.set({ [key]: value });
            setSettings((prev) => ({ ...prev, [key]: value }));
        } catch (err) {
            console.error('Error updating setting:', err);
            throw err;
        }
    };

    return {
        settings,
        updateSetting,
        loading,
        error,
    };
}
