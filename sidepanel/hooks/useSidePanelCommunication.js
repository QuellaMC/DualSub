import { useState, useEffect, useCallback, useRef, useMemo } from 'react';

/**
 * Owns the side panel's single long-lived connection to the background worker.
 * Consumers receive this instance through SidePanelContext; mounting this hook in
 * individual feature hooks would create competing registrations for the same tab.
 */
export function useSidePanelCommunication() {
    const [isConnected, setIsConnected] = useState(false);
    const [error, setError] = useState(null);
    const messageListeners = useRef(new Map());
    const portRef = useRef(null);
    const reconnectTimerRef = useRef(null);
    const intentionalDisconnectRef = useRef(false);
    const bindingRef = useRef({
        panelInstanceId: null,
        boundTabId: null,
        boundWindowId: null,
    });
    const mountedRef = useRef(false);

    useEffect(() => {
        if (!bindingRef.current.panelInstanceId) {
            bindingRef.current.panelInstanceId = crypto.randomUUID();
        }
        mountedRef.current = true;

        return () => {
            mountedRef.current = false;
        };
    }, []);

    const getBinding = useCallback(() => ({ ...bindingRef.current }), []);

    const postMessage = useCallback((action, data = {}) => {
        if (!portRef.current) {
            console.warn('Cannot post side panel message while disconnected');
            return false;
        }

        try {
            portRef.current.postMessage({
                action,
                data,
                source: 'sidepanel',
                timestamp: Date.now(),
            });
            return true;
        } catch (err) {
            console.error(`postMessage failed (${action}):`, err);
            return false;
        }
    }, []);

    /**
     * Register this panel instance against a tab and update the local binding at
     * the same time. This keeps direct tab messages aligned after tab switches.
     */
    const registerTab = useCallback(
        (tabId, windowId = bindingRef.current.boundWindowId) => {
            if (typeof tabId !== 'number') {
                return false;
            }

            bindingRef.current.boundTabId = tabId;
            if (typeof windowId === 'number') {
                bindingRef.current.boundWindowId = windowId;
            }

            return postMessage('sidePanelRegister', {
                tabId,
                windowId: bindingRef.current.boundWindowId,
                panelInstanceId: bindingRef.current.panelInstanceId,
            });
        },
        [postMessage]
    );

    const getActiveTab = useCallback(async () => {
        try {
            const [tab] = await chrome.tabs.query({
                active: true,
                currentWindow: true,
            });
            return tab || null;
        } catch (err) {
            console.error('getActiveTab failed:', err);
            return null;
        }
    }, []);

    const registerWithActiveTab = useCallback(async () => {
        const tab = await getActiveTab();
        if (typeof tab?.id !== 'number') {
            return null;
        }

        registerTab(tab.id, tab.windowId);
        postMessage('sidePanelGetState');
        return tab;
    }, [getActiveTab, postMessage, registerTab]);

    const connectPort = useCallback(() => {
        if (portRef.current) {
            return;
        }

        try {
            intentionalDisconnectRef.current = false;
            const port = chrome.runtime.connect({ name: 'sidepanel' });
            portRef.current = port;
            setIsConnected(true);
            setError(null);

            port.onMessage.addListener((message) => {
                if (message?.action === 'bindingChanged' && message?.data) {
                    const { tabId, windowId } = message.data;
                    if (typeof tabId === 'number') {
                        bindingRef.current.boundTabId = tabId;
                    }
                    if (typeof windowId === 'number') {
                        bindingRef.current.boundWindowId = windowId;
                    }
                }

                const listeners = messageListeners.current.get(message?.action);
                listeners?.forEach((callback) => {
                    try {
                        callback(message.data);
                    } catch (listenerError) {
                        console.error(
                            `Error in listener for ${message.action}:`,
                            listenerError
                        );
                    }
                });
            });

            port.onDisconnect.addListener(() => {
                if (portRef.current !== port) {
                    return;
                }
                portRef.current = null;

                if (intentionalDisconnectRef.current || !mountedRef.current) {
                    return;
                }

                setIsConnected(false);

                reconnectTimerRef.current = setTimeout(connectPort, 1000);
            });

            void registerWithActiveTab();
        } catch (connectionError) {
            console.error('Side panel connection failed:', connectionError);
            setError(connectionError);
            setIsConnected(false);

            if (mountedRef.current) {
                reconnectTimerRef.current = setTimeout(connectPort, 2000);
            }
        }
    }, [registerWithActiveTab]);

    useEffect(() => {
        connectPort();

        return () => {
            intentionalDisconnectRef.current = true;
            if (reconnectTimerRef.current) {
                clearTimeout(reconnectTimerRef.current);
                reconnectTimerRef.current = null;
            }

            const port = portRef.current;
            portRef.current = null;
            if (port) {
                try {
                    port.disconnect();
                } catch {
                    // The worker may already have disconnected the port.
                }
            }
        };
    }, [connectPort]);

    const sendToTab = useCallback(async (tabId, action, data = {}) => {
        if (typeof tabId !== 'number') {
            throw new Error('No bound tab is available');
        }

        const response = await chrome.tabs.sendMessage(tabId, {
            action,
            data,
            source: 'sidepanel',
            timestamp: Date.now(),
        });

        if (response?.error) {
            throw new Error(response.error);
        }
        return response;
    }, []);

    const sendToBoundTab = useCallback(
        async (action, data = {}) => {
            let tabId = bindingRef.current.boundTabId;
            if (typeof tabId !== 'number') {
                const activeTab = await getActiveTab();
                tabId = activeTab?.id;
                if (typeof tabId === 'number') {
                    bindingRef.current.boundTabId = tabId;
                    bindingRef.current.boundWindowId = activeTab.windowId;
                }
            }

            return sendToTab(tabId, action, data);
        },
        [getActiveTab, sendToTab]
    );

    const onMessage = useCallback((action, callback) => {
        if (!messageListeners.current.has(action)) {
            messageListeners.current.set(action, new Set());
        }
        messageListeners.current.get(action).add(callback);

        return () => {
            const listeners = messageListeners.current.get(action);
            listeners?.delete(callback);
            if (listeners?.size === 0) {
                messageListeners.current.delete(action);
            }
        };
    }, []);

    return useMemo(
        () => ({
            isConnected,
            error,
            getActiveTab,
            getBinding,
            onMessage,
            postMessage,
            registerTab,
            sendToBoundTab,
            sendToTab,
        }),
        [
            error,
            getActiveTab,
            getBinding,
            isConnected,
            onMessage,
            postMessage,
            registerTab,
            sendToBoundTab,
            sendToTab,
        ]
    );
}
