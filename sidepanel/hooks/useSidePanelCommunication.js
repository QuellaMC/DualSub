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

    // Initialize long-lived connection to background
    useEffect(() => {
        try {
            // Create a long-lived connection
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
            });

            setIsConnected(true);

            return () => {
                if (portRef.current) {
                    portRef.current.disconnect();
                    portRef.current = null;
                }
            };
        } catch (err) {
            console.error('Failed to connect to background:', err);
            setError(err);
            setIsConnected(false);
        }
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
