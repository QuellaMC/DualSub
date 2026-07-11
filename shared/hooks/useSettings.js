import { useState, useEffect, useCallback, useRef } from 'react';
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
    const writeQueueRef = useRef(Promise.resolve());
    const pendingValuesRef = useRef(new Map());
    const serializedKeys = JSON.stringify(keys ?? null);

    const enqueueWrite = useCallback((operation) => {
        const queuedWrite = writeQueueRef.current
            .catch(() => undefined)
            .then(operation);
        writeQueueRef.current = queuedWrite;
        return queuedWrite;
    }, []);

    const trackPendingValues = useCallback((updates) => {
        const token = Symbol('settings-write');
        for (const [key, value] of Object.entries(updates)) {
            pendingValuesRef.current.set(key, { token, value });
        }

        return () => {
            for (const key of Object.keys(updates)) {
                if (pendingValuesRef.current.get(key)?.token === token) {
                    pendingValuesRef.current.delete(key);
                }
            }
        };
    }, []);

    // Load initial settings
    useEffect(() => {
        let cancelled = false;
        const requestedKeys = JSON.parse(serializedKeys);

        const loadSettings = async () => {
            try {
                setLoading(true);
                let data;

                if (Array.isArray(requestedKeys)) {
                    data = await configService.getMultiple(requestedKeys);
                } else if (requestedKeys) {
                    const value = await configService.get(requestedKeys);
                    data = { [requestedKeys]: value };
                } else {
                    data = await configService.getAll();
                }

                if (!cancelled) {
                    setSettings(data);
                    setError(null);
                }
            } catch (err) {
                if (!cancelled) {
                    setError(err);
                }
                console.error('Error loading settings:', err);
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };

        loadSettings();
        return () => {
            cancelled = true;
        };
    }, [serializedKeys]);

    // Listen for setting changes
    useEffect(() => {
        const requestedKeys = JSON.parse(serializedKeys);
        const handleChange = (changes) => {
            const relevantChanges = {};
            let hasRelevantChange = false;
            const watchedKeys = requestedKeys
                ? Array.isArray(requestedKeys)
                    ? requestedKeys
                    : [requestedKeys]
                : null;
            for (const key in changes) {
                if (watchedKeys && !watchedKeys.includes(key)) {
                    continue;
                }

                const pendingValue = pendingValuesRef.current.get(key);
                if (
                    pendingValue &&
                    !Object.is(pendingValue.value, changes[key])
                ) {
                    continue;
                }

                relevantChanges[key] = changes[key];
                hasRelevantChange = true;
            }

            if (hasRelevantChange) {
                setSettings((prev) => ({ ...prev, ...relevantChanges }));
            }
        };

        const unsubscribe = configService.onChanged(handleChange);

        return () => {
            if (typeof unsubscribe === 'function') {
                unsubscribe();
            }
        };
    }, [serializedKeys]);

    // Update a setting
    const updateSetting = useCallback(
        async (key, value) => {
            const clearPending = trackPendingValues({ [key]: value });
            setSettings((prev) => ({ ...prev, [key]: value }));
            try {
                await enqueueWrite(() => configService.set(key, value));
                setError(null);
                return true;
            } catch (err) {
                setError(err);
                console.error(`Error updating setting ${key}:`, err);
                throw err;
            } finally {
                clearPending();
            }
        },
        [enqueueWrite, trackPendingValues]
    );

    // Update multiple settings at once
    const updateSettings = useCallback(
        async (updates) => {
            const clearPending = trackPendingValues(updates);
            setSettings((prev) => ({ ...prev, ...updates }));
            try {
                await enqueueWrite(() => configService.setMultiple(updates));
                setError(null);
                return true;
            } catch (err) {
                setError(err);
                console.error('Error updating settings:', err);
                throw err;
            } finally {
                clearPending();
            }
        },
        [enqueueWrite, trackPendingValues]
    );

    return {
        settings,
        updateSetting,
        updateSettings,
        loading,
        error,
    };
}
