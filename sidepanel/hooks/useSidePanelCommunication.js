import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MessageActions } from '../../content_scripts/shared/constants/messageActions.js';
import {
    buildSidePanelRegistrationMessage,
    buildSidePanelSelectionRemovalRequestMessage,
    parseSidePanelBindingConfirmationMessage,
    parseSidePanelForceBindTabMessage,
    parseSidePanelSelectionRemovalResultMessage,
    parseSidePanelSelectionStateMessage,
    parseSidePanelTabActivatedMessage,
} from '../../content_scripts/shared/protocol/messageProtocol.js';

const REGISTRATION_ACK_TIMEOUT_MS = 2000;

function isValidTabBinding(tabId, windowId) {
    return (
        Number.isSafeInteger(tabId) &&
        tabId >= 0 &&
        Number.isSafeInteger(windowId) &&
        windowId >= 0
    );
}

function selectionsEqual(left, right) {
    return Boolean(
        left &&
        right &&
        left.selectionOwnerGeneration === right.selectionOwnerGeneration &&
        left.selectionRevision === right.selectionRevision &&
        left.renderRevision === right.renderRevision &&
        left.reason === right.reason &&
        left.entries.length === right.entries.length &&
        left.entries.every(
            (entry, index) =>
                entry.wordIndex === right.entries[index].wordIndex &&
                entry.word === right.entries[index].word
        )
    );
}

function acceptSelection(cursor, selection) {
    if (selection === null) {
        return { accepted: true, changed: cursor !== null, cursor: null };
    }
    if (!cursor) {
        return { accepted: true, changed: true, cursor: selection };
    }
    if (
        selection.selectionOwnerGeneration < cursor.selectionOwnerGeneration ||
        (selection.selectionOwnerGeneration ===
            cursor.selectionOwnerGeneration &&
            selection.selectionRevision < cursor.selectionRevision) ||
        (selection.selectionOwnerGeneration ===
            cursor.selectionOwnerGeneration &&
            selection.selectionRevision > cursor.selectionRevision &&
            selection.renderRevision < cursor.renderRevision)
    ) {
        return { accepted: false, changed: false, cursor };
    }
    if (
        selection.selectionOwnerGeneration ===
            cursor.selectionOwnerGeneration &&
        selection.selectionRevision === cursor.selectionRevision
    ) {
        return {
            accepted: selectionsEqual(cursor, selection),
            changed: false,
            cursor,
        };
    }
    return { accepted: true, changed: true, cursor: selection };
}

export function useSidePanelCommunication() {
    const [isConnected, setIsConnected] = useState(false);
    const [error, setError] = useState(null);
    const mountedRef = useRef(false);
    const connectionRef = useRef(null);
    const bindingIntentRef = useRef(0);
    const registrationCounterRef = useRef(0);
    const removalCounterRef = useRef(0);
    const pendingRegistrationRef = useRef(null);
    const bindingRef = useRef(null);
    const selectionCursorRef = useRef(null);
    const pendingRemovalRef = useRef(null);
    const reconnectTimerRef = useRef(null);
    const activeTabLookupRef = useRef(null);
    const connectRef = useRef(null);
    const messageListenersRef = useRef(new Map());
    const selectionListenersRef = useRef(new Set());

    const isCurrentConnection = useCallback(
        (connection) =>
            Boolean(
                mountedRef.current &&
                connection &&
                connectionRef.current === connection
            ),
        []
    );

    const isCurrentBinding = useCallback(
        (binding) =>
            Boolean(
                binding &&
                bindingRef.current === binding &&
                isCurrentConnection(binding.connection)
            ),
        [isCurrentConnection]
    );

    const notifySelection = useCallback((tabId, selection) => {
        for (const listener of [...selectionListenersRef.current]) {
            if (!selectionListenersRef.current.has(listener)) continue;
            try {
                listener(Object.freeze({ selection, tabId }));
            } catch (listenerError) {
                console.error(
                    'Error in side panel selection listener:',
                    listenerError
                );
            }
        }
    }, []);

    const settleRemoval = useCallback((pending, status) => {
        if (!pending || pendingRemovalRef.current !== pending) return false;
        pendingRemovalRef.current = null;
        pending.resolve(status);
        return true;
    }, []);

    const clearRegistration = useCallback(() => {
        const pending = pendingRegistrationRef.current;
        pendingRegistrationRef.current = null;
        if (pending?.timeoutId != null) clearTimeout(pending.timeoutId);
    }, []);

    const clearBinding = useCallback(
        (notify = true) => {
            const binding = bindingRef.current;
            bindingRef.current = null;
            selectionCursorRef.current = null;
            settleRemoval(pendingRemovalRef.current, 'rejected');
            if (notify && binding) notifySelection(binding.tabId, null);
        },
        [notifySelection, settleRemoval]
    );

    const scheduleReconnect = useCallback((delay) => {
        if (!mountedRef.current || connectionRef.current) return;
        if (reconnectTimerRef.current != null) {
            clearTimeout(reconnectTimerRef.current);
        }
        reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = null;
            connectRef.current?.();
        }, delay);
    }, []);

    const retireConnection = useCallback(
        (connection, { disconnect = false, reconnectDelay = 1000 } = {}) => {
            if (!isCurrentConnection(connection)) return false;
            connectionRef.current = null;
            bindingIntentRef.current += 1;
            activeTabLookupRef.current = null;
            clearRegistration();
            clearBinding();
            setIsConnected(false);
            if (disconnect) {
                try {
                    connection.port.disconnect();
                } catch (_) {}
            }
            scheduleReconnect(reconnectDelay);
            return true;
        },
        [
            clearBinding,
            clearRegistration,
            isCurrentConnection,
            scheduleReconnect,
        ]
    );

    const getActiveTab = useCallback(async () => {
        if (!activeTabLookupRef.current) {
            const lookup = Promise.resolve()
                .then(() =>
                    chrome.tabs.query({ active: true, currentWindow: true })
                )
                .then(([tab]) => tab || null)
                .catch((lookupError) => {
                    console.error('getActiveTab failed:', lookupError);
                    return null;
                })
                .finally(() => {
                    if (activeTabLookupRef.current === lookup) {
                        activeTabLookupRef.current = null;
                    }
                });
            activeTabLookupRef.current = lookup;
        }
        return activeTabLookupRef.current;
    }, []);

    const registerOnConnection = useCallback(
        (connection, tabId, windowId) => {
            if (
                !isCurrentConnection(connection) ||
                !isValidTabBinding(tabId, windowId)
            ) {
                return false;
            }

            const registrationId = registrationCounterRef.current + 1;
            if (!Number.isSafeInteger(registrationId)) return false;
            registrationCounterRef.current = registrationId;
            bindingIntentRef.current += 1;

            clearRegistration();
            const previousTabId = bindingRef.current?.tabId;
            clearBinding();
            if (previousTabId !== tabId) notifySelection(tabId, null);

            const pending = {
                connection,
                registrationId,
                tabId,
                timeoutId: null,
                windowId,
            };
            pendingRegistrationRef.current = pending;

            try {
                connection.port.postMessage(
                    buildSidePanelRegistrationMessage(
                        { registrationId, tabId, windowId },
                        Date.now()
                    )
                );
            } catch (postError) {
                console.error('Side panel registration failed:', postError);
                clearRegistration();
                retireConnection(connection, { disconnect: true });
                return false;
            }

            if (pendingRegistrationRef.current === pending) {
                pending.timeoutId = setTimeout(() => {
                    if (pendingRegistrationRef.current !== pending) return;
                    clearRegistration();
                    retireConnection(connection, { disconnect: true });
                }, REGISTRATION_ACK_TIMEOUT_MS);
            }
            return isCurrentConnection(connection);
        },
        [
            clearBinding,
            clearRegistration,
            isCurrentConnection,
            notifySelection,
            retireConnection,
        ]
    );

    const registerTab = useCallback(
        (tabId, windowId = bindingRef.current?.windowId) =>
            registerOnConnection(connectionRef.current, tabId, windowId),
        [registerOnConnection]
    );

    const registerActiveTab = useCallback(
        async (connection) => {
            const bindingIntent = bindingIntentRef.current;
            const tab = await getActiveTab();
            if (
                isCurrentConnection(connection) &&
                bindingIntentRef.current === bindingIntent
            ) {
                registerOnConnection(connection, tab?.id, tab?.windowId);
            }
        },
        [getActiveTab, isCurrentConnection, registerOnConnection]
    );

    const requestSelectionRemoval = useCallback(
        (selection, wordIndex) => {
            const binding = bindingRef.current;
            if (pendingRemovalRef.current || !isCurrentBinding(binding)) {
                return Promise.resolve('rejected');
            }

            const requestId = removalCounterRef.current + 1;
            if (!Number.isSafeInteger(requestId)) {
                return Promise.resolve('rejected');
            }

            let message;
            try {
                message = buildSidePanelSelectionRemovalRequestMessage({
                    binding: {
                        registrationId: binding.registrationId,
                        tabId: binding.tabId,
                        windowId: binding.windowId,
                    },
                    requestId,
                    selectionOwnerGeneration:
                        selection?.selectionOwnerGeneration,
                    selectionRevision: selection?.selectionRevision,
                    renderRevision: selection?.renderRevision,
                    wordIndex,
                });
            } catch (_) {
                return Promise.resolve('rejected');
            }

            removalCounterRef.current = requestId;
            let resolve;
            const promise = new Promise((settle) => {
                resolve = settle;
            });
            const pending = {
                binding,
                message,
                resolve,
                successorObserved: false,
            };
            pendingRemovalRef.current = pending;

            try {
                binding.connection.port.postMessage(message);
            } catch (_) {
                settleRemoval(pending, 'rejected');
            }
            return promise;
        },
        [isCurrentBinding, settleRemoval]
    );

    const handleSelection = useCallback(
        (message) => {
            const binding = bindingRef.current;
            if (!isCurrentBinding(binding)) return;
            const parsed = parseSidePanelSelectionStateMessage(message, {
                registrationId: binding.registrationId,
                tabId: binding.tabId,
                windowId: binding.windowId,
            });
            if (!parsed || !isCurrentBinding(binding)) return;

            const next = acceptSelection(
                selectionCursorRef.current,
                parsed.selection
            );
            if (!next.accepted) return;
            selectionCursorRef.current = next.cursor;
            if (next.changed) notifySelection(binding.tabId, parsed.selection);

            const pending = pendingRemovalRef.current;
            if (!pending || pending.binding !== binding) return;
            const expected = pending.message.data;
            const selection = parsed.selection;
            const isSuccessor = Boolean(
                selection &&
                selection.selectionOwnerGeneration ===
                    expected.selectionOwnerGeneration &&
                selection.selectionRevision > expected.selectionRevision &&
                selection.renderRevision === expected.renderRevision &&
                selection.reason === 'remove' &&
                !selection.entries.some(
                    (entry) => entry.wordIndex === expected.wordIndex
                )
            );
            if (isSuccessor) {
                pending.successorObserved = true;
            } else if (
                selection === null ||
                selection.selectionOwnerGeneration !==
                    expected.selectionOwnerGeneration ||
                selection.selectionRevision > expected.selectionRevision ||
                selection.renderRevision !== expected.renderRevision
            ) {
                settleRemoval(pending, 'rejected');
            }
        },
        [isCurrentBinding, notifySelection, settleRemoval]
    );

    const handleRemovalResult = useCallback(
        (message) => {
            const pending = pendingRemovalRef.current;
            if (!pending || !isCurrentBinding(pending.binding)) return;
            const result = parseSidePanelSelectionRemovalResultMessage(
                message,
                pending.message.data
            );
            if (!result) return;
            settleRemoval(
                pending,
                result.status === 'applied' && pending.successorObserved
                    ? 'applied'
                    : 'rejected'
            );
        },
        [isCurrentBinding, settleRemoval]
    );

    const handleMessage = useCallback(
        (connection, message) => {
            if (!isCurrentConnection(connection)) return;

            const confirmation =
                parseSidePanelBindingConfirmationMessage(message);
            if (confirmation) {
                const pending = pendingRegistrationRef.current;
                if (
                    pending?.connection === connection &&
                    confirmation.registrationId === pending.registrationId &&
                    confirmation.tabId === pending.tabId &&
                    confirmation.windowId === pending.windowId
                ) {
                    clearRegistration();
                    bindingRef.current = Object.freeze({
                        ...confirmation,
                        connection,
                    });
                }
                return;
            }

            if (message?.action === MessageActions.SIDEPANEL_SELECTION_SYNC) {
                handleSelection(message);
                return;
            }
            if (message?.action === MessageActions.SIDEPANEL_UPDATE_STATE) {
                handleRemovalResult(message);
                return;
            }

            const tabBinding =
                parseSidePanelTabActivatedMessage(message) ||
                parseSidePanelForceBindTabMessage(message);
            if (
                !tabBinding &&
                (message?.action === MessageActions.SIDEPANEL_TAB_ACTIVATED ||
                    message?.action === MessageActions.SIDEPANEL_FORCE_BIND_TAB)
            ) {
                return;
            }

            const listeners = messageListenersRef.current.get(message?.action);
            for (const listener of listeners ? [...listeners] : []) {
                if (!listeners.has(listener)) continue;
                try {
                    listener(tabBinding ?? message?.data);
                } catch (listenerError) {
                    console.error(
                        `Error in listener for ${message?.action}:`,
                        listenerError
                    );
                }
            }
        },
        [
            clearRegistration,
            handleRemovalResult,
            handleSelection,
            isCurrentConnection,
        ]
    );

    const connect = useCallback(() => {
        if (!mountedRef.current || connectionRef.current) return;
        try {
            const port = chrome.runtime.connect({ name: 'sidepanel' });
            const connection = { port };
            connectionRef.current = connection;
            setIsConnected(true);
            setError(null);

            port.onMessage.addListener((message) =>
                handleMessage(connection, message)
            );
            port.onDisconnect.addListener(() => retireConnection(connection));
            void registerActiveTab(connection);
        } catch (connectionError) {
            console.error('Side panel connection failed:', connectionError);
            setError(connectionError);
            setIsConnected(false);
            scheduleReconnect(2000);
        }
    }, [handleMessage, registerActiveTab, retireConnection, scheduleReconnect]);
    connectRef.current = connect;

    useEffect(() => {
        mountedRef.current = true;
        connect();
        return () => {
            mountedRef.current = false;
            if (reconnectTimerRef.current != null) {
                clearTimeout(reconnectTimerRef.current);
                reconnectTimerRef.current = null;
            }
            clearRegistration();
            clearBinding(false);
            activeTabLookupRef.current = null;
            const connection = connectionRef.current;
            connectionRef.current = null;
            if (connection) {
                try {
                    connection.port.disconnect();
                } catch (_) {}
            }
        };
    }, [clearBinding, clearRegistration, connect]);

    const onMessage = useCallback((action, listener) => {
        if (!messageListenersRef.current.has(action)) {
            messageListenersRef.current.set(action, new Set());
        }
        const listeners = messageListenersRef.current.get(action);
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
            if (listeners.size === 0)
                messageListenersRef.current.delete(action);
        };
    }, []);

    const onSelectionState = useCallback((listener) => {
        selectionListenersRef.current.add(listener);
        return () => selectionListenersRef.current.delete(listener);
    }, []);

    return useMemo(
        () => ({
            isConnected,
            error,
            getActiveTab,
            onMessage,
            onSelectionState,
            registerTab,
            requestSelectionRemoval,
        }),
        [
            error,
            getActiveTab,
            isConnected,
            onMessage,
            onSelectionState,
            registerTab,
            requestSelectionRemoval,
        ]
    );
}
