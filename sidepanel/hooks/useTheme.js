import { useState, useEffect } from 'react';

/**
 * Theme Management Hook
 * 
 * Handles dark mode detection and toggling.
 * Respects user settings and system preferences.
 */
export function useTheme() {
    const [theme, setTheme] = useState('light');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const initializeTheme = async () => {
            try {
                // Load theme preference from settings
                const result = await chrome.storage.sync.get(['sidePanelTheme']);
                const savedTheme = result.sidePanelTheme || 'auto';

                if (savedTheme === 'auto') {
                    // Detect system preference
                    const prefersDark = window.matchMedia(
                        '(prefers-color-scheme: dark)'
                    ).matches;
                    setTheme(prefersDark ? 'dark' : 'light');
                } else {
                    setTheme(savedTheme);
                }
            } catch (error) {
                console.error('Error loading theme:', error);
                // Fallback to system preference
                const prefersDark = window.matchMedia(
                    '(prefers-color-scheme: dark)'
                ).matches;
                setTheme(prefersDark ? 'dark' : 'light');
            } finally {
                setLoading(false);
            }
        };

        initializeTheme();

        // Listen for system theme changes
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        const handleChange = async (e) => {
            const result = await chrome.storage.sync.get(['sidePanelTheme']);
            const savedTheme = result.sidePanelTheme || 'auto';
            
            if (savedTheme === 'auto') {
                setTheme(e.matches ? 'dark' : 'light');
            }
        };

        mediaQuery.addEventListener('change', handleChange);
        return () => mediaQuery.removeEventListener('change', handleChange);
    }, []);

    const toggleTheme = async () => {
        const newTheme = theme === 'dark' ? 'light' : 'dark';
        setTheme(newTheme);
        
        try {
            await chrome.storage.sync.set({ sidePanelTheme: newTheme });
        } catch (error) {
            console.error('Error saving theme:', error);
        }
    };

    const setThemeMode = async (mode) => {
        if (mode === 'auto') {
            const prefersDark = window.matchMedia(
                '(prefers-color-scheme: dark)'
            ).matches;
            setTheme(prefersDark ? 'dark' : 'light');
        } else {
            setTheme(mode);
        }

        try {
            await chrome.storage.sync.set({ sidePanelTheme: mode });
        } catch (error) {
            console.error('Error saving theme:', error);
        }
    };

    return {
        theme,
        toggleTheme,
        setThemeMode,
        loading,
    };
}
