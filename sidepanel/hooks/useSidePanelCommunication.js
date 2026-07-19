import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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
const REGISTRATION_NOT_CONFIRMED_ERROR =
    'Side panel registration was not confirmed';

function getOwnDataProperty(record, key) {
    if (!record || typeof record !== 'object') return undefined;
    try {
        const descriptor = Object.getOwnPropertyDescriptor(record, key);
        return descriptor &&
            Object.prototype.hasOwnProperty.call(descriptor, 'value')
            ? descriptor.value
            : undefined;
    } catch (_) {
        return undefined;
    }
}

function isValidTabBinding(tabId, windowId) {
    return Boolean(
        Number.isSafeInteger(tabId) &&
        tabId >= 0 &&
        Number.isSafeInteger(windowId) &&
        windowId >= 0
    );
}

function createSelectionStateProjection(tabId, selection) {
    return Object.freeze({ selection, tabId });
}

function selectionEntriesEqual(left, right) {
    return (
        left.length === right.length &&
        left.every(
            (entry, index) =>
                entry.wordIndex === right[index].wordIndex &&
                entry.word === right[index].word
        )
    );
}

function selectionStatesEqual(left, right) {
    return Boolean(
        left &&
        right &&
        left.selectionOwnerGeneration === right.selectionOwnerGeneration &&
        left.selectionRevision === right.selectionRevision &&
        left.renderRevision === right.renderRevision &&
        left.reason === right.reason &&
        selectionEntriesEqual(left.entries, right.entries)
    );
}

function advanceSelectionCursor(cursor, selection) {
    if (selection === null) {
        return Object.freeze({ accepted: true, cursor });
    }
    if (!cursor) {
        return Object.freeze({ accepted: true, cursor: selection });
    }
    if (selection.selectionOwnerGeneration < cursor.selectionOwnerGeneration) {
        return Object.freeze({ accepted: false, cursor });
    }
    if (selection.selectionOwnerGeneration > cursor.selectionOwnerGeneration) {
        return Object.freeze({ accepted: true, cursor: selection });
    }
    if (selection.selectionRevision < cursor.selectionRevision) {
        return Object.freeze({ accepted: false, cursor });
    }
    if (selection.selectionRevision === cursor.selectionRevision) {
        return Object.freeze({
            accepted: selectionStatesEqual(cursor, selection),
            cursor,
        });
    }
    if (selection.renderRevision < cursor.renderRevision) {
        return Object.freeze({ accepted: false, cursor });
    }
    return Object.freeze({ accepted: true, cursor: selection });
}

/**
 * Owns the side panel's single long-lived connection to the background worker.
 * Consumers receive this instance through SidePanelContext; mounting this hook in
 * individual feature hooks would create competing registrations for the same tab.
 */
export function useSidePanelCommunication() {
    const [isConnected, setIsConnected] = useState(false);
    const [error, setError] = useState(null);
    const messageListeners = useRef(new Map());
    const selectionStateListeners = useRef(new Set());
    const portRef = useRef(null);
    const connectPortRef = useRef(null);
    const connectionGenerationRef = useRef(0);
    const bindingIntentEpochRef = useRef(0);
    const authorityTransitionRef = useRef(null);
    const registrationCounterRef = useRef(0);
    const activeTabLookupRef = useRef(null);
    const pendingRegistrationRef = useRef(null);
    const pendingSelectionRemovalRef = useRef(null);
    const confirmedBindingRef = useRef(null);
    const selectionCursorRef = useRef(null);
    const selectionRemovalCounterRef = useRef(0);
    const reconnectTimerRef = useRef(null);
    const intentionalDisconnectRef = useRef(false);
    const bindingRef = useRef({
        boundTabId: null,
        boundWindowId: null,
    });
    const mountedRef = useRef(false);

    useEffect(() => {
        mountedRef.current = true;

        return () => {
            mountedRef.current = false;
        };
    }, []);

    const settlePendingSelectionRemoval = useCallback((pending, status) => {
        if (!pending || pendingSelectionRemovalRef.current !== pending) {
            return false;
        }

        pendingSelectionRemovalRef.current = null;
        pending.resolve(status);
        return true;
    }, []);

    const clearConfirmedBinding = useCallback(() => {
        settlePendingSelectionRemoval(
            pendingSelectionRemovalRef.current,
            'rejected'
        );
        confirmedBindingRef.current = null;
        selectionCursorRef.current = null;
        bindingRef.current = {
            boundTabId: null,
            boundWindowId: null,
        };
    }, [settlePendingSelectionRemoval]);

    const settlePendingRegistration = useCallback((pending, outcome, value) => {
        if (!pending || pendingRegistrationRef.current !== pending) {
            return false;
        }

        pendingRegistrationRef.current = null;
        const timeoutOwner = pending.timeoutOwner;
        pending.timeoutOwner = null;
        if (timeoutOwner?.id != null) {
            clearTimeout(timeoutOwner.id);
        }

        if (outcome === 'resolve') {
            pending.resolve(value);
        } else {
            pending.reject(new Error(value));
        }
        return true;
    }, []);

    const isCurrentPort = useCallback((port, generation) => {
        return Boolean(
            mountedRef.current &&
            !intentionalDisconnectRef.current &&
            port &&
            portRef.current === port &&
            connectionGenerationRef.current === generation
        );
    }, []);

    const isCurrentBindingIntent = useCallback(
        (port, generation, bindingIntentEpoch) => {
            return Boolean(
                isCurrentPort(port, generation) &&
                bindingIntentEpochRef.current === bindingIntentEpoch
            );
        },
        [isCurrentPort]
    );

    const isExactConfirmedBinding = useCallback(
        (binding) =>
            Boolean(
                binding &&
                confirmedBindingRef.current === binding &&
                isCurrentBindingIntent(
                    binding.port,
                    binding.generation,
                    binding.bindingIntentEpoch
                ) &&
                bindingRef.current.boundTabId === binding.tabId &&
                bindingRef.current.boundWindowId === binding.windowId
            ),
        [isCurrentBindingIntent]
    );

    const notifySelectionState = useCallback(
        (tabId, selection, canDeliver = () => true) => {
            const listeners = Array.from(selectionStateListeners.current);
            for (const callback of listeners) {
                if (!canDeliver()) {
                    return;
                }
                if (!selectionStateListeners.current.has(callback)) {
                    continue;
                }
                try {
                    callback(createSelectionStateProjection(tabId, selection));
                } catch (listenerError) {
                    console.error(
                        'Error in side panel selection listener:',
                        listenerError
                    );
                }
            }
        },
        []
    );

    const scheduleReconnect = useCallback((ownerGeneration, delay) => {
        if (
            !mountedRef.current ||
            intentionalDisconnectRef.current ||
            portRef.current ||
            connectionGenerationRef.current !== ownerGeneration
        ) {
            return;
        }

        const existingTimer = reconnectTimerRef.current;
        if (existingTimer) {
            clearTimeout(existingTimer.id);
        }

        const timerOwner = { id: null };
        reconnectTimerRef.current = timerOwner;
        timerOwner.id = setTimeout(() => {
            if (
                reconnectTimerRef.current !== timerOwner ||
                connectionGenerationRef.current !== ownerGeneration ||
                !mountedRef.current ||
                intentionalDisconnectRef.current ||
                portRef.current
            ) {
                return;
            }

            reconnectTimerRef.current = null;
            connectPortRef.current?.();
        }, delay);
    }, []);

    const retireCurrentPort = useCallback(
        (
            port,
            generation,
            { disconnect = false, reconnectDelay = 1000 } = {}
        ) => {
            const activeTransition = authorityTransitionRef.current;
            if (
                activeTransition?.kind === 'retire' &&
                activeTransition.port === port &&
                activeTransition.generation === generation
            ) {
                return false;
            }
            if (!isCurrentPort(port, generation)) {
                return false;
            }

            const transition = { generation, kind: 'retire', port };
            authorityTransitionRef.current = transition;
            try {
                const binding = confirmedBindingRef.current;
                if (isExactConfirmedBinding(binding)) {
                    notifySelectionState(binding.tabId, null, () =>
                        Boolean(
                            authorityTransitionRef.current === transition &&
                            confirmedBindingRef.current === binding
                        )
                    );
                }
                if (authorityTransitionRef.current !== transition) {
                    return false;
                }

                clearConfirmedBinding();
                settlePendingRegistration(
                    pendingRegistrationRef.current,
                    'reject',
                    REGISTRATION_NOT_CONFIRMED_ERROR
                );
                activeTabLookupRef.current = null;
                portRef.current = null;
                connectionGenerationRef.current += 1;
                const reconnectGeneration = connectionGenerationRef.current;
                setIsConnected(false);

                if (disconnect) {
                    try {
                        port.disconnect();
                    } catch {
                        // The browser may already have retired the port.
                    }
                }
                scheduleReconnect(reconnectGeneration, reconnectDelay);
                return true;
            } finally {
                if (authorityTransitionRef.current === transition) {
                    authorityTransitionRef.current = null;
                }
            }
        },
        [
            clearConfirmedBinding,
            isCurrentPort,
            isExactConfirmedBinding,
            notifySelectionState,
            scheduleReconnect,
            settlePendingRegistration,
        ]
    );

    const scheduleRegistrationTimeout = useCallback(
        (pending) => {
            if (pendingRegistrationRef.current !== pending) {
                return;
            }

            const timeoutOwner = { id: null };
            pending.timeoutOwner = timeoutOwner;
            const expireRegistration = () => {
                if (
                    pendingRegistrationRef.current !== pending ||
                    pending.timeoutOwner !== timeoutOwner
                ) {
                    return;
                }
                const expired = settlePendingRegistration(
                    pending,
                    'reject',
                    REGISTRATION_NOT_CONFIRMED_ERROR
                );
                if (expired) {
                    retireCurrentPort(pending.port, pending.generation, {
                        disconnect: true,
                    });
                }
            };
            try {
                timeoutOwner.id = setTimeout(
                    expireRegistration,
                    REGISTRATION_ACK_TIMEOUT_MS
                );
            } catch (_) {
                expireRegistration();
            }
        },
        [retireCurrentPort, settlePendingRegistration]
    );

    const postMessageEnvelopeToPort = useCallback(
        (port, generation, action, buildMessage) => {
            if (!isCurrentPort(port, generation)) {
                return false;
            }

            try {
                port.postMessage(buildMessage());
                return isCurrentPort(port, generation);
            } catch (err) {
                console.error(`postMessage failed (${action}):`, err);
                return false;
            }
        },
        [isCurrentPort]
    );

    const postRegistrationToPort = useCallback(
        (port, generation, binding) =>
            postMessageEnvelopeToPort(
                port,
                generation,
                MessageActions.SIDEPANEL_REGISTER,
                () => buildSidePanelRegistrationMessage(binding, Date.now())
            ),
        [postMessageEnvelopeToPort]
    );

    const requestSelectionRemoval = useCallback(
        (selection, wordIndex) => {
            const binding = confirmedBindingRef.current;
            if (
                pendingSelectionRemovalRef.current ||
                !isExactConfirmedBinding(binding)
            ) {
                return Promise.resolve('rejected');
            }

            const requestId = selectionRemovalCounterRef.current + 1;
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

            selectionRemovalCounterRef.current = requestId;
            let resolveRemoval;
            const promise = new Promise((resolve) => {
                resolveRemoval = resolve;
            });
            const pending = {
                authoritativeSuccessorObserved: false,
                binding,
                message,
                promise,
                resolve: resolveRemoval,
                terminalStatus: null,
            };
            pendingSelectionRemovalRef.current = pending;

            const posted = postMessageEnvelopeToPort(
                binding.port,
                binding.generation,
                MessageActions.SIDEPANEL_UPDATE_STATE,
                () => message
            );
            if (!posted) {
                settlePendingSelectionRemoval(pending, 'rejected');
            }
            return promise;
        },
        [
            isExactConfirmedBinding,
            postMessageEnvelopeToPort,
            settlePendingSelectionRemoval,
        ]
    );

    const registerTabOnPort = useCallback(
        (port, generation, tabId, windowId) => {
            if (
                !isValidTabBinding(tabId, windowId) ||
                !isCurrentPort(port, generation) ||
                authorityTransitionRef.current?.kind === 'retire'
            ) {
                return null;
            }

            const transition = { generation, kind: 'register', port };
            authorityTransitionRef.current = transition;
            try {
                const priorBinding = confirmedBindingRef.current;
                const hadExactBinding = isExactConfirmedBinding(priorBinding);
                const canNotify = () =>
                    Boolean(
                        authorityTransitionRef.current === transition &&
                        isCurrentPort(port, generation)
                    );
                if (hadExactBinding) {
                    notifySelectionState(priorBinding.tabId, null, canNotify);
                }
                if (!hadExactBinding || priorBinding.tabId !== tabId) {
                    notifySelectionState(tabId, null, canNotify);
                }
                if (!canNotify()) {
                    return null;
                }

                const priorPending = pendingRegistrationRef.current;
                const bindingIntentEpoch = bindingIntentEpochRef.current + 1;
                bindingIntentEpochRef.current = bindingIntentEpoch;
                activeTabLookupRef.current = null;
                clearConfirmedBinding();
                settlePendingRegistration(
                    priorPending,
                    'reject',
                    REGISTRATION_NOT_CONFIRMED_ERROR
                );

                const registrationId = registrationCounterRef.current + 1;
                if (!Number.isSafeInteger(registrationId)) {
                    return null;
                }
                registrationCounterRef.current = registrationId;

                let resolveRegistration;
                let rejectRegistration;
                const promise = new Promise((resolve, reject) => {
                    resolveRegistration = resolve;
                    rejectRegistration = reject;
                });
                void promise.catch(() => undefined);
                const pending = {
                    bindingIntentEpoch,
                    generation,
                    port,
                    promise,
                    registrationId,
                    reject: rejectRegistration,
                    resolve: resolveRegistration,
                    tabId,
                    timeoutOwner: null,
                    windowId,
                };
                pendingRegistrationRef.current = pending;

                const posted = postRegistrationToPort(port, generation, {
                    registrationId,
                    tabId,
                    windowId,
                });
                if (
                    authorityTransitionRef.current !== transition ||
                    !posted ||
                    !isCurrentBindingIntent(
                        port,
                        generation,
                        bindingIntentEpoch
                    )
                ) {
                    const confirmed = confirmedBindingRef.current;
                    if (
                        authorityTransitionRef.current === transition &&
                        confirmed?.port === pending.port &&
                        confirmed.generation === pending.generation &&
                        confirmed.bindingIntentEpoch ===
                            pending.bindingIntentEpoch &&
                        confirmed.registrationId === pending.registrationId &&
                        confirmed.tabId === pending.tabId &&
                        confirmed.windowId === pending.windowId
                    ) {
                        notifySelectionState(confirmed.tabId, null, () =>
                            Boolean(
                                authorityTransitionRef.current === transition &&
                                confirmedBindingRef.current === confirmed
                            )
                        );
                        if (confirmedBindingRef.current === confirmed) {
                            clearConfirmedBinding();
                        }
                    }
                    settlePendingRegistration(
                        pending,
                        'reject',
                        REGISTRATION_NOT_CONFIRMED_ERROR
                    );
                    return null;
                }

                scheduleRegistrationTimeout(pending);
                return pending;
            } finally {
                if (authorityTransitionRef.current === transition) {
                    authorityTransitionRef.current = null;
                }
            }
        },
        [
            clearConfirmedBinding,
            isCurrentBindingIntent,
            isCurrentPort,
            isExactConfirmedBinding,
            notifySelectionState,
            postRegistrationToPort,
            scheduleRegistrationTimeout,
            settlePendingRegistration,
        ]
    );

    /**
     * Register this panel against a tab and update the local binding only after
     * the current port accepts the registration message.
     */
    const registerTab = useCallback(
        (tabId, windowId = bindingRef.current.boundWindowId) => {
            if (!isValidTabBinding(tabId, windowId)) {
                return false;
            }
            const port = portRef.current;
            const generation = connectionGenerationRef.current;
            return Boolean(
                registerTabOnPort(port, generation, tabId, windowId)
            );
        },
        [registerTabOnPort]
    );

    const getActiveTab = useCallback(async () => {
        const port = portRef.current;
        const generation = connectionGenerationRef.current;
        const bindingIntentEpoch = bindingIntentEpochRef.current;
        let lookup = activeTabLookupRef.current;
        if (
            !lookup ||
            lookup.port !== port ||
            lookup.generation !== generation ||
            lookup.bindingIntentEpoch !== bindingIntentEpoch
        ) {
            lookup = {
                bindingIntentEpoch,
                generation,
                port,
                promise: null,
            };
            activeTabLookupRef.current = lookup;
            lookup.promise = (async () => {
                const [tab] = await chrome.tabs.query({
                    active: true,
                    currentWindow: true,
                });
                return tab || null;
            })().finally(() => {
                if (activeTabLookupRef.current === lookup) {
                    activeTabLookupRef.current = null;
                }
            });
        }

        try {
            const tab = await lookup.promise;
            if (!isCurrentBindingIntent(port, generation, bindingIntentEpoch)) {
                return null;
            }
            return tab;
        } catch (err) {
            if (isCurrentBindingIntent(port, generation, bindingIntentEpoch)) {
                console.error('getActiveTab failed:', err);
            }
            return null;
        }
    }, [isCurrentBindingIntent]);

    const registerWithActiveTab = useCallback(
        async (port, generation) => {
            const bindingIntentEpoch = bindingIntentEpochRef.current;
            const tab = await getActiveTab();
            if (!isCurrentBindingIntent(port, generation, bindingIntentEpoch)) {
                return null;
            }
            if (!registerTabOnPort(port, generation, tab?.id, tab?.windowId)) {
                return null;
            }

            return tab;
        },
        [getActiveTab, isCurrentBindingIntent, registerTabOnPort]
    );

    const connectPort = useCallback(() => {
        if (
            portRef.current ||
            !mountedRef.current ||
            intentionalDisconnectRef.current
        ) {
            return;
        }

        const generation = connectionGenerationRef.current + 1;
        connectionGenerationRef.current = generation;
        try {
            const port = chrome.runtime.connect({ name: 'sidepanel' });
            portRef.current = port;
            setIsConnected(true);
            setError(null);

            port.onMessage.addListener((message) => {
                if (!isCurrentPort(port, generation)) {
                    return;
                }
                const action = getOwnDataProperty(message, 'action');
                const isTabActivated =
                    action === MessageActions.SIDEPANEL_TAB_ACTIVATED;
                const isForceBind =
                    action === MessageActions.SIDEPANEL_FORCE_BIND_TAB;
                const tabBinding = isTabActivated
                    ? parseSidePanelTabActivatedMessage(message)
                    : isForceBind
                      ? parseSidePanelForceBindTabMessage(message)
                      : null;
                if ((isTabActivated || isForceBind) && !tabBinding) {
                    return;
                }
                if (action === MessageActions.SIDEPANEL_SELECTION_SYNC) {
                    const binding = confirmedBindingRef.current;
                    if (!isExactConfirmedBinding(binding)) {
                        return;
                    }
                    const expectedBinding = {
                        registrationId: binding.registrationId,
                        tabId: binding.tabId,
                        windowId: binding.windowId,
                    };
                    const parsedSelection = parseSidePanelSelectionStateMessage(
                        message,
                        expectedBinding
                    );
                    if (!parsedSelection || !isExactConfirmedBinding(binding)) {
                        return;
                    }
                    const cursorAdvance = advanceSelectionCursor(
                        selectionCursorRef.current,
                        parsedSelection.selection
                    );
                    if (!cursorAdvance.accepted) return;
                    selectionCursorRef.current = cursorAdvance.cursor;
                    notifySelectionState(
                        binding.tabId,
                        parsedSelection.selection,
                        () => isExactConfirmedBinding(binding)
                    );

                    const pendingRemoval = pendingSelectionRemovalRef.current;
                    if (
                        pendingRemoval?.binding === binding &&
                        isExactConfirmedBinding(binding)
                    ) {
                        const expected = pendingRemoval.message.data;
                        const selection = parsedSelection.selection;
                        const isAppliedSuccessor = Boolean(
                            selection &&
                            selection.selectionOwnerGeneration ===
                                expected.selectionOwnerGeneration &&
                            selection.renderRevision ===
                                expected.renderRevision &&
                            selection.selectionRevision >
                                expected.selectionRevision &&
                            selection.reason === 'remove' &&
                            !selection.entries.some(
                                ({ wordIndex }) =>
                                    wordIndex === expected.wordIndex
                            )
                        );
                        const invalidatesRemoval = Boolean(
                            selection === null ||
                            selection.selectionOwnerGeneration !==
                                expected.selectionOwnerGeneration ||
                            selection.renderRevision !==
                                expected.renderRevision ||
                            selection.selectionRevision >
                                expected.selectionRevision
                        );
                        if (isAppliedSuccessor) {
                            pendingRemoval.authoritativeSuccessorObserved = true;
                            if (pendingRemoval.terminalStatus === 'applied') {
                                settlePendingSelectionRemoval(
                                    pendingRemoval,
                                    'applied'
                                );
                            }
                        } else if (invalidatesRemoval) {
                            settlePendingSelectionRemoval(
                                pendingRemoval,
                                'rejected'
                            );
                        }
                    }
                    return;
                }
                if (action === MessageActions.SIDEPANEL_UPDATE_STATE) {
                    const pendingRemoval = pendingSelectionRemovalRef.current;
                    const binding = confirmedBindingRef.current;
                    if (
                        !pendingRemoval ||
                        pendingRemoval.binding !== binding ||
                        !isExactConfirmedBinding(binding)
                    ) {
                        return;
                    }
                    const result = parseSidePanelSelectionRemovalResultMessage(
                        message,
                        pendingRemoval.message.data
                    );
                    if (
                        !result ||
                        pendingSelectionRemovalRef.current !== pendingRemoval ||
                        !isExactConfirmedBinding(binding)
                    ) {
                        return;
                    }
                    pendingRemoval.terminalStatus = result.status;
                    if (result.status === 'rejected') {
                        settlePendingSelectionRemoval(
                            pendingRemoval,
                            'rejected'
                        );
                    } else if (pendingRemoval.authoritativeSuccessorObserved) {
                        settlePendingSelectionRemoval(
                            pendingRemoval,
                            'applied'
                        );
                    }
                    return;
                }
                const bindingConfirmation =
                    parseSidePanelBindingConfirmationMessage(message);
                if (bindingConfirmation) {
                    const pending = pendingRegistrationRef.current;
                    if (
                        pending &&
                        pendingRegistrationRef.current === pending &&
                        isCurrentPort(port, generation) &&
                        pending.port === port &&
                        pending.generation === generation &&
                        pending.bindingIntentEpoch ===
                            bindingIntentEpochRef.current &&
                        bindingConfirmation.registrationId ===
                            pending.registrationId &&
                        bindingConfirmation.tabId === pending.tabId &&
                        bindingConfirmation.windowId === pending.windowId
                    ) {
                        const confirmedBinding = {
                            bindingIntentEpoch: pending.bindingIntentEpoch,
                            generation,
                            port,
                            registrationId: pending.registrationId,
                            tabId: pending.tabId,
                            windowId: pending.windowId,
                        };
                        confirmedBindingRef.current = confirmedBinding;
                        bindingRef.current = {
                            boundTabId: pending.tabId,
                            boundWindowId: pending.windowId,
                        };
                        settlePendingRegistration(
                            pending,
                            'resolve',
                            confirmedBinding
                        );
                    }
                    return;
                }
                if (action === MessageActions.SIDEPANEL_BINDING_CONFIRMED) {
                    return;
                }
                const listeners = messageListeners.current.get(action);
                listeners?.forEach((callback) => {
                    try {
                        callback(
                            tabBinding ?? getOwnDataProperty(message, 'data')
                        );
                    } catch (listenerError) {
                        console.error(
                            `Error in listener for ${action}:`,
                            listenerError
                        );
                    }
                });
            });

            port.onDisconnect.addListener(() => {
                retireCurrentPort(port, generation);
            });

            void registerWithActiveTab(port, generation);
        } catch (connectionError) {
            if (
                mountedRef.current &&
                !intentionalDisconnectRef.current &&
                !portRef.current &&
                connectionGenerationRef.current === generation
            ) {
                console.error('Side panel connection failed:', connectionError);
                setError(connectionError);
                setIsConnected(false);
                scheduleReconnect(generation, 2000);
            }
        }
    }, [
        isCurrentPort,
        isExactConfirmedBinding,
        notifySelectionState,
        registerWithActiveTab,
        retireCurrentPort,
        scheduleReconnect,
        settlePendingSelectionRemoval,
        settlePendingRegistration,
    ]);

    connectPortRef.current = connectPort;

    useEffect(() => {
        intentionalDisconnectRef.current = false;
        connectPort();

        return () => {
            intentionalDisconnectRef.current = true;
            clearConfirmedBinding();
            settlePendingRegistration(
                pendingRegistrationRef.current,
                'reject',
                REGISTRATION_NOT_CONFIRMED_ERROR
            );
            activeTabLookupRef.current = null;
            connectionGenerationRef.current += 1;
            if (reconnectTimerRef.current) {
                clearTimeout(reconnectTimerRef.current.id);
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
    }, [clearConfirmedBinding, connectPort, settlePendingRegistration]);

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

    const onSelectionState = useCallback((callback) => {
        selectionStateListeners.current.add(callback);

        return () => {
            selectionStateListeners.current.delete(callback);
        };
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
