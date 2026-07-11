import { useEffect, useRef, useState } from 'react';

function resolveTheme(mode, prefersDark) {
    if (mode === 'dark' || mode === 'light') {
        return mode;
    }
    return prefersDark ? 'dark' : 'light';
}

/** Keeps the side-panel theme synchronized with storage and system changes. */
export function useTheme() {
    const [theme, setTheme] = useState('light');
    const [loading, setLoading] = useState(true);
    const modeRef = useRef('auto');

    useEffect(() => {
        let mounted = true;
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

        const applyMode = (mode) => {
            modeRef.current = mode || 'auto';
            if (mounted) {
                setTheme(resolveTheme(modeRef.current, mediaQuery.matches));
            }
        };

        void chrome.storage.sync
            .get('sidePanelTheme')
            .then((result) => applyMode(result.sidePanelTheme || 'auto'))
            .catch((themeError) => {
                console.error('Error loading theme:', themeError);
                applyMode('auto');
            })
            .finally(() => {
                if (mounted) {
                    setLoading(false);
                }
            });

        const handleSystemThemeChange = (event) => {
            if (modeRef.current === 'auto' && mounted) {
                setTheme(event.matches ? 'dark' : 'light');
            }
        };
        const handleStorageChange = (changes, area) => {
            if (area === 'sync' && changes.sidePanelTheme) {
                applyMode(changes.sidePanelTheme.newValue || 'auto');
            }
        };

        mediaQuery.addEventListener('change', handleSystemThemeChange);
        chrome.storage.onChanged.addListener(handleStorageChange);

        return () => {
            mounted = false;
            mediaQuery.removeEventListener('change', handleSystemThemeChange);
            chrome.storage.onChanged.removeListener(handleStorageChange);
        };
    }, []);

    return { loading, theme };
}
