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
    const bindingRef = useRef({ panelInstanceId: null, boundTabId: null, boundWindowId: null });
    const mountedRef = useRef(false);

    // Initialize instance ID once
    useEffect(() => {
        if (!bindingRef.current.panelInstanceId) {
            bindingRef.current.panelInstanceId = crypto.randomUUID();
        }
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    /**
     * Register the side panel with the active tab and background script.
     */
    const registerWithActiveTab = useCallback(async () => {
        if (!portRef.current) return;

        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab?.id) {
                const windowId = tab.windowId;
                bindingRef.current.boundTabId = tab.id;
                bindingRef.current.boundWindowId = windowId;

                portRef.current.postMessage({
                    action: 'sidePanelRegister',
                    data: { 
                        tabId: tab.id, 
                        windowId, 
                        panelInstanceId: bindingRef.current.panelInstanceId 
                    },
                    source: 'sidepanel',
                    timestamp: Date.now(),
                });

                // Request fresh state
                portRef.current.postMessage({
                    action: 'sidePanelGetState',
                    data: {},
                    source: 'sidepanel',
                    timestamp: Date.now(),
                });
            }
        } catch (e) {
            console.error('Failed to register side panel:', e);
        }
    }, []);

    /**
     * Establishes a long-lived connection to the background script.
     */
    const connectPort = useCallback(() => {
        if (portRef.current) return;

        try {
            const port = chrome.runtime.connect({ name: 'sidepanel' });
            portRef.current = port;
            setIsConnected(true);
            setError(null);

            port.onMessage.addListener((message) => {
                // Handle internal binding updates
                if (message?.action === 'bindingChanged' && message?.data) {
                    const { tabId, windowId } = message.data;
                    if (typeof tabId === 'number') bindingRef.current.boundTabId = tabId;
                    if (typeof windowId === 'number') bindingRef.current.boundWindowId = windowId;
                }

                // Dispatch to listeners
                const listeners = messageListeners.current.get(message.action);
                if (listeners) {
                    listeners.forEach((callback) => {
                        try {
                            callback(message.data);
                        } catch (err) {
                            console.error(`Error in listener for ${message.action}:`, err);
                        }
                    });
                }
            });

            port.onDisconnect.addListener(() => {
                console.log('Side panel disconnected');
                portRef.current = null;
                setIsConnected(false);
                
                // Attempt reconnect if still mounted
                if (mountedRef.current) {
                    reconnectTimerRef.current = setTimeout(connectPort, 1000);
                }
            });

            // Initial registration
            registerWithActiveTab();

        } catch (err) {
            console.error('Connection failed:', err);
            setError(err);
            setIsConnected(false);
            if (mountedRef.current) {
                reconnectTimerRef.current = setTimeout(connectPort, 2000);
            }
        }
    }, [registerWithActiveTab]);

    // Lifecycle management for connection
    useEffect(() => {
        connectPort();

        return () => {
            if (reconnectTimerRef.current) {
                clearTimeout(reconnectTimerRef.current);
            }
            if (portRef.current) {
                try {
                    portRef.current.disconnect();
                } catch (e) {
                    // Ignore disconnect errors
                }
                portRef.current = null;
            }
        };
    }, [connectPort]);

    /**
     * Send a one-off message to the background service worker.
     */
    const sendMessage = useCallback(async (action, data = {}) => {
        try {
            const response = await chrome.runtime.sendMessage({
                action,
                data,
                source: 'sidepanel',
                timestamp: Date.now(),
            });

            if (response?.error) {
                throw new Error(response.error);
            }
            return response;
        } catch (err) {
            console.error(`sendMessage failed (${action}):`, err);
            throw err;
        }
    }, []);

    /**
     * Send a message to the active tab's content script.
     */
    const sendToActiveTab = useCallback(async (action, data = {}) => {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab?.id) throw new Error('No active tab found');

            const response = await chrome.tabs.sendMessage(tab.id, {
                action,
                data,
                source: 'sidepanel',
                timestamp: Date.now(),
            });

            if (response?.error) throw new Error(response.error);
            return response;
        } catch (err) {
            console.error(`sendToActiveTab failed (${action}):`, err);
            throw err;
        }
    }, []);

    /**
     * Send a message to the currently bound tab's content script.
     */
    const sendToBoundTab = useCallback(async (action, data = {}) => {
        const tabId = bindingRef.current.boundTabId;
        if (!tabId) {
            return sendToActiveTab(action, data);
        }

        try {
            const response = await chrome.tabs.sendMessage(tabId, {
                action,
                data,
                source: 'sidepanel',
                timestamp: Date.now(),
            });

            if (response?.error) throw new Error(response.error);
            return response;
        } catch (err) {
            console.error(`sendToBoundTab failed (${action}):`, err);
            throw err;
        }
    }, [sendToActiveTab]);

    /**
     * Send a message via the long-lived port connection.
     */
    const postMessage = useCallback((action, data = {}) => {
        if (!portRef.current) {
            console.warn('Cannot post message: disconnected');
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
            console.error(`postMessage failed (${action}):`, err);
        }
    }, []);

    /**
     * Subscribe to messages of a specific action type.
     */
    const onMessage = useCallback((action, callback) => {
        if (!messageListeners.current.has(action)) {
            messageListeners.current.set(action, new Set());
        }
        messageListeners.current.get(action).add(callback);

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

    const getActiveTab = useCallback(async () => {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            return tab;
        } catch (err) {
            console.error('getActiveTab failed:', err);
            return null;
        }
    }, []);

    return {
        isConnected,
        error,
        sendMessage,
        sendToActiveTab,
        sendToBoundTab,
        postMessage,
        onMessage,
        getActiveTab,
        getBinding: () => ({ ...bindingRef.current }),
    };
}

