import { useState, useEffect, useCallback } from 'react';
import { configService } from '../../services/configService.js';

/**
 * Hook for managing extension settings
 * @param {string|string[]} keys - Setting key(s) to watch
 * @returns {Object} Settings state and update function
 */
export function useSettings(keys) {
    const [settings, setSettings] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Load initial settings
    useEffect(() => {
        const loadSettings = async () => {
            try {
                setLoading(true);
                let data;

                if (Array.isArray(keys)) {
                    data = await configService.getMultiple(keys);
                } else if (keys) {
                    const value = await configService.get(keys);
                    data = { [keys]: value };
                } else {
                    data = await configService.getAll();
                }

                setSettings(data);
                setError(null);
            } catch (err) {
                setError(err);
                console.error('Error loading settings:', err);
            } finally {
                setLoading(false);
            }
        };

        loadSettings();
    }, [keys]);

    // Listen for setting changes
    useEffect(() => {
        const handleChange = (changes) => {
            setSettings((prev) => ({ ...prev, ...changes }));
        };

        const unsubscribe = configService.onChanged(handleChange);

        return () => {
            // Clean up listener
            if (typeof unsubscribe === 'function') {
                unsubscribe();
            }
        };
    }, []);

    // Update a setting
    const updateSetting = useCallback(async (key, value) => {
        try {
            await configService.set(key, value);
            setSettings((prev) => ({ ...prev, [key]: value }));
            return true;
        } catch (err) {
            setError(err);
            console.error(`Error updating setting ${key}:`, err);
            return false;
        }
    }, []);

    // Update multiple settings at once
    const updateSettings = useCallback(async (updates) => {
        try {
            await configService.setMultiple(updates);
            setSettings((prev) => ({ ...prev, ...updates }));
            return true;
        } catch (err) {
            setError(err);
            console.error('Error updating settings:', err);
            return false;
        }
    }, []);

    return {
        settings,
        updateSetting,
        updateSettings,
        loading,
        error,
    };
}
