import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Side Panel Communication Hook
 * 
 * Manages all messaging between the side panel and:
 * - Background service worker
 * - Content scripts
 * - Other extension components
 * 
 * Provides a robust messaging API with retry logic and error handling.
 */
export function useSidePanelCommunication() {
    const [isConnected, setIsConnected] = useState(false);
    const [error, setError] = useState(null);
    const messageListeners = useRef(new Map());
    const portRef = useRef(null);
    const reconnectTimerRef = useRef(null);
    const reconnectDelayRef = useRef(1000);
    const heartbeatTimerRef = useRef(null);
    const mountedRef = useRef(false);

    // Initialize long-lived connection to background with auto-reconnect and heartbeat
    useEffect(() => {
        mountedRef.current = true;

        const registerWithActiveTab = async () => {
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (tab && tab.id && portRef.current) {
                    try {
                        portRef.current.postMessage({
                            action: 'sidePanelRegister',
                            data: { tabId: tab.id },
                            source: 'sidepanel',
                            timestamp: Date.now(),
                        });
                        // Ask background for a fresh state snapshot for the current tab
                        portRef.current.postMessage({
                            action: 'sidePanelGetState',
                            data: {},
                            source: 'sidepanel',
                            timestamp: Date.now(),
                        });
                    } catch (e) {
                        console.warn('Failed to register side panel with background:', e);
                    }
                }
            } catch (e) {
                console.warn('Failed to query active tab for registration:', e);
            }
        };

        const clearReconnectTimer = () => {
            if (reconnectTimerRef.current) {
                clearTimeout(reconnectTimerRef.current);
                reconnectTimerRef.current = null;
            }
        };

        const startHeartbeat = () => {
            if (heartbeatTimerRef.current) return;
            heartbeatTimerRef.current = setInterval(async () => {
                try {
                    // Use runtime message for keep-alive; background handles MessageActions.PING
                    await chrome.runtime.sendMessage({ action: 'ping', source: 'sidepanel', timestamp: Date.now() });
                } catch (e) {
                    // Likely background asleep or reloading; will trigger reconnect via disconnect path
                }
            }, 25000);
        };

        const stopHeartbeat = () => {
            if (heartbeatTimerRef.current) {
                clearInterval(heartbeatTimerRef.current);
                heartbeatTimerRef.current = null;
            }
        };

        const connectPort = () => {
            try {
            const port = chrome.runtime.connect({ name: 'sidepanel' });
            portRef.current = port;

            port.onMessage.addListener((message) => {
                const listeners = messageListeners.current.get(message.action);
                if (listeners) {
                    listeners.forEach((callback) => callback(message.data));
                }
            });

            port.onDisconnect.addListener(() => {
                console.log('Side panel disconnected from background');
                setIsConnected(false);
                portRef.current = null;
                    stopHeartbeat();
                    // Exponential backoff reconnect
                    clearReconnectTimer();
                    const delay = Math.min(reconnectDelayRef.current, 30000);
                    reconnectTimerRef.current = setTimeout(() => {
                        if (!mountedRef.current) return;
                        connectPort();
                        reconnectDelayRef.current = Math.min(delay * 2, 30000);
                    }, delay);
            });

            setIsConnected(true);
                reconnectDelayRef.current = 1000;
                startHeartbeat();
                registerWithActiveTab();
        } catch (err) {
            console.error('Failed to connect to background:', err);
            setError(err);
            setIsConnected(false);
                // Schedule a reconnect attempt
                clearReconnectTimer();
                const delay = Math.min(reconnectDelayRef.current, 30000);
                reconnectTimerRef.current = setTimeout(() => {
                    if (!mountedRef.current) return;
                    connectPort();
                    reconnectDelayRef.current = Math.min(delay * 2, 30000);
                }, delay);
            }
        };

        connectPort();

        return () => {
            mountedRef.current = false;
            clearReconnectTimer();
            stopHeartbeat();
            if (portRef.current) {
                try { portRef.current.disconnect(); } catch (_) {}
                portRef.current = null;
            }
        };
    }, []);

    /**
     * Send a message to the background service worker
     */
    const sendMessage = useCallback(async (action, data = {}) => {
        try {
            const response = await chrome.runtime.sendMessage({
                action,
                data,
                source: 'sidepanel',
                timestamp: Date.now(),
            });

            if (response && response.error) {
                throw new Error(response.error);
            }

            return response;
        } catch (err) {
            console.error(`Failed to send message (${action}):`, err);
            setError(err);
            throw err;
        }
    }, []);

    /**
     * Send a message to the active tab's content script
     */
    const sendToActiveTab = useCallback(async (action, data = {}) => {
        try {
            const [tab] = await chrome.tabs.query({
                active: true,
                currentWindow: true,
            });

            if (!tab || !tab.id) {
                throw new Error('No active tab found');
            }

            const response = await chrome.tabs.sendMessage(tab.id, {
                action,
                data,
                source: 'sidepanel',
                timestamp: Date.now(),
            });

            if (response && response.error) {
                throw new Error(response.error);
            }

            return response;
        } catch (err) {
            console.error(`Failed to send message to tab (${action}):`, err);
            setError(err);
            throw err;
        }
    }, []);

    /**
     * Send a message via long-lived connection
     */
    const postMessage = useCallback((action, data = {}) => {
        if (!portRef.current) {
            console.error('No active connection to background');
            return;
        }

        try {
            portRef.current.postMessage({
                action,
                data,
                source: 'sidepanel',
                timestamp: Date.now(),
            });
        } catch (err) {
            console.error(`Failed to post message (${action}):`, err);
            setError(err);
        }
    }, []);

    /**
     * Subscribe to messages of a specific action type
     */
    const onMessage = useCallback((action, callback) => {
        if (!messageListeners.current.has(action)) {
            messageListeners.current.set(action, new Set());
        }
        messageListeners.current.get(action).add(callback);

        // Return unsubscribe function
        return () => {
            const listeners = messageListeners.current.get(action);
            if (listeners) {
                listeners.delete(callback);
                if (listeners.size === 0) {
                    messageListeners.current.delete(action);
                }
            }
        };
    }, []);

    /**
     * Get the current active tab
     */
    const getActiveTab = useCallback(async () => {
        try {
            const [tab] = await chrome.tabs.query({
                active: true,
                currentWindow: true,
            });
            return tab;
        } catch (err) {
            console.error('Failed to get active tab:', err);
            return null;
        }
    }, []);

    /**
     * Check if side panel is supported (Chrome 114+)
     */
    const isSidePanelSupported = useCallback(() => {
        return typeof chrome.sidePanel !== 'undefined';
    }, []);

    return {
        isConnected,
        error,
        sendMessage,
        sendToActiveTab,
        postMessage,
        onMessage,
        getActiveTab,
        isSidePanelSupported,
    };
}
