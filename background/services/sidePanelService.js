/**
 * Owns the background half of the side-panel connection and selection channel.
 * Protocol parsing and normalization live in messageProtocol; this service only
 * coordinates browser state and the resulting trusted protocol values.
 */

import Logger from '../../utils/logger.js';
import { configService } from '../../services/configService.js';
import { getDefaultValue } from '../../config/configSchema.js';
import {
    MessageSenderRoles,
    buildSidePanelBindingConfirmationMessage,
    buildSidePanelForceBindTabMessage,
    buildSidePanelPauseVideoRequestMessage,
    buildSidePanelSelectionRemovalCommandMessage,
    buildSidePanelSelectionRemovalResultMessage,
    buildSidePanelSelectionRepublishRequestMessage,
    buildSidePanelSelectionStateMessage,
    buildSidePanelTabActivatedMessage,
    parseContentControlResponseMessage,
    parseSidePanelRegistrationMessage,
    parseSidePanelSelectionRemovalCommandResponse,
    parseSidePanelSelectionRemovalRequestMessage,
    parseSidePanelSelectionRepublishAck,
} from '../../content_scripts/shared/protocol/messageProtocol.js';

const BEHAVIOR_CONFIG_KEYS = [
    'sidePanelUseSidePanel',
    'sidePanelAutoOpen',
    'sidePanelAutoPauseVideo',
];

function bindingsEqual(left, right) {
    return Boolean(
        left &&
        right &&
        left.registrationId === right.registrationId &&
        left.tabId === right.tabId &&
        left.windowId === right.windowId
    );
}

function entriesEqual(left, right) {
    return (
        left.length === right.length &&
        left.every(
            (entry, index) =>
                entry.wordIndex === right[index].wordIndex &&
                entry.word === right[index].word
        )
    );
}

function snapshotsEqual(left, right) {
    return Boolean(
        left.selectionRevision === right.selectionRevision &&
        left.renderRevision === right.renderRevision &&
        left.reason === right.reason &&
        entriesEqual(left.entries, right.entries)
    );
}

function removalRequestsEqual(left, right) {
    return Boolean(
        left &&
        right &&
        bindingsEqual(left.binding, right.binding) &&
        left.requestId === right.requestId &&
        left.selectionOwnerGeneration === right.selectionOwnerGeneration &&
        left.selectionRevision === right.selectionRevision &&
        left.renderRevision === right.renderRevision &&
        left.wordIndex === right.wordIndex
    );
}

export class SidePanelService {
    constructor() {
        this.logger = Logger.create('SidePanelService', configService);
        this.initialized = false;

        // Every mutable fact about a port belongs to exactly one record.
        this.connections = new Map();
        this.connectionByTab = new Map();
        this.connectionsByWindow = new Map();
        this.activeTabByWindow = new Map();

        // A tab has at most one current, revisioned content selection.
        this.selectionByTab = new Map();
        this.selectionAuthorityByTab = new Map();
        this.connectionGeneration = 0;
        this.activationRevision = 0;
        this.selectionOwnerGeneration = 0;
        this.selectionRecordRevision = 0;
        this.selectionRepublishRequestId = 0;

        this.serviceReadiness = null;
        this.listenersRegistered = false;
        this.onConnectListener = null;
        this.onTabActivatedListener = null;
        this.onTabRemovedListener = null;
        this.onTabUpdatedListener = null;
        this.configUnsubscribe = null;

        this.defaultBehaviorConfig = Object.freeze(
            Object.fromEntries(
                BEHAVIOR_CONFIG_KEYS.map((key) => [key, getDefaultValue(key)])
            )
        );
        this.behaviorConfig = { ...this.defaultBehaviorConfig };
    }

    nextCounter(key) {
        const next = this[key] + 1;
        if (!Number.isSafeInteger(next)) return null;
        this[key] = next;
        return next;
    }

    isCurrentConnection(connection) {
        return Boolean(
            connection?.connected &&
            this.connections.get(connection.port) === connection
        );
    }

    isCurrentBinding(connection, binding, bindingGeneration) {
        const activeTab = binding
            ? this.activeTabByWindow.get(binding.windowId)
            : null;
        return Boolean(
            this.isCurrentConnection(connection) &&
            connection.bindingGeneration === bindingGeneration &&
            connection.binding === binding &&
            this.connectionByTab.get(binding.tabId) === connection &&
            (!activeTab || activeTab.tabId === binding.tabId)
        );
    }

    addConnectionToWindow(connection, windowId) {
        if (connection.windowId === windowId) return;
        if (connection.windowId !== null) {
            const previous = this.connectionsByWindow.get(connection.windowId);
            previous?.delete(connection);
            if (previous?.size === 0) {
                this.connectionsByWindow.delete(connection.windowId);
            }
        }

        connection.windowId = windowId;
        if (windowId === null) return;
        if (!this.connectionsByWindow.has(windowId)) {
            this.connectionsByWindow.set(windowId, new Set());
        }
        this.connectionsByWindow.get(windowId).add(connection);
    }

    detachBinding(
        connection,
        preserveWindow = false,
        advanceGeneration = true
    ) {
        const binding = connection.binding;
        if (binding && this.connectionByTab.get(binding.tabId) === connection) {
            this.connectionByTab.delete(binding.tabId);
        }
        connection.binding = null;
        connection.pendingRemoval = null;
        if (advanceGeneration) connection.bindingGeneration += 1;
        if (!preserveWindow) {
            this.addConnectionToWindow(connection, null);
        }
    }

    closeConnection(connection, disconnect = false) {
        if (!this.isCurrentConnection(connection)) return false;

        connection.connected = false;
        this.detachBinding(connection);
        this.connections.delete(connection.port);
        if (disconnect) {
            try {
                connection.port.disconnect?.();
            } catch (_) {}
        }
        return true;
    }

    postToConnection(connection, message) {
        if (!this.isCurrentConnection(connection)) return false;
        try {
            connection.port.postMessage(message);
            return this.isCurrentConnection(connection);
        } catch (_) {
            this.logger.warn('Side panel port delivery failed');
            this.closeConnection(connection, true);
            return false;
        }
    }

    noteActiveTab(activeInfo) {
        if (
            !Number.isSafeInteger(activeInfo?.tabId) ||
            activeInfo.tabId < 0 ||
            !Number.isSafeInteger(activeInfo?.windowId) ||
            activeInfo.windowId < 0
        ) {
            return null;
        }

        const current = this.activeTabByWindow.get(activeInfo.windowId);
        if (current?.tabId === activeInfo.tabId) return current;
        const revision = this.nextCounter('activationRevision');
        if (!revision) return null;
        const activation = Object.freeze({
            revision,
            tabId: activeInfo.tabId,
            windowId: activeInfo.windowId,
        });
        this.activeTabByWindow.set(activeInfo.windowId, activation);
        return activation;
    }

    isCurrentActivation(activation) {
        return Boolean(
            activation &&
            this.activeTabByWindow.get(activation.windowId) === activation
        );
    }

    clearSelectionsOutsideActiveTab(tabId, windowId) {
        for (const [ownedTabId, selection] of this.selectionByTab) {
            if (selection.windowId === windowId && ownedTabId !== tabId) {
                this.selectionByTab.delete(ownedTabId);
            }
        }
    }

    selectionProjection(selection) {
        return Object.freeze({
            selectionOwnerGeneration: selection.ownerGeneration,
            selectionRevision: selection.snapshot.selectionRevision,
            renderRevision: selection.snapshot.renderRevision,
            reason: selection.snapshot.reason,
            entries: selection.snapshot.entries,
        });
    }

    postSelectionState(connection, selection) {
        const binding = connection.binding;
        if (!binding) return false;
        return this.postToConnection(
            connection,
            buildSidePanelSelectionStateMessage(
                binding,
                selection ? this.selectionProjection(selection) : null
            )
        );
    }

    broadcastSelection(selection) {
        const connection = this.connectionByTab.get(selection.tabId);
        if (
            !connection ||
            connection.binding?.windowId !== selection.windowId
        ) {
            return false;
        }
        return this.postSelectionState(connection, selection);
    }

    revokeSelectionAuthority(tabId, notify = true) {
        const selection = this.selectionByTab.get(tabId);
        const authority = this.selectionAuthorityByTab.get(tabId);
        const documentId = authority?.documentId ?? selection?.documentId;
        if (documentId || authority) {
            this.selectionAuthorityByTab.set(
                tabId,
                Object.freeze({
                    documentId: null,
                    revokedDocumentId:
                        documentId ?? authority.revokedDocumentId ?? null,
                })
            );
        }
        this.selectionByTab.delete(tabId);
        const connection = this.connectionByTab.get(tabId);
        if (connection) {
            connection.pendingRemoval = null;
            if (notify) this.postSelectionState(connection, null);
        }
    }

    async revalidateRevokedSelectionAuthority(tabId) {
        const authority = this.selectionAuthorityByTab.get(tabId);
        if (
            authority?.documentId ||
            !authority?.revokedDocumentId ||
            authority.revalidatingDocumentId
        ) {
            return false;
        }

        const requestId = this.nextCounter('selectionRepublishRequestId');
        if (!requestId) return false;
        const attempt = Object.freeze({
            ...authority,
            revalidatingDocumentId: authority.revokedDocumentId,
        });
        this.selectionAuthorityByTab.set(tabId, attempt);
        const probe = buildSidePanelSelectionRepublishRequestMessage(requestId);
        let response;
        try {
            response = await chrome.tabs.sendMessage(tabId, probe, {
                documentId: attempt.revokedDocumentId,
                frameId: 0,
            });
        } catch (_) {
            if (this.selectionAuthorityByTab.get(tabId) === attempt) {
                this.selectionAuthorityByTab.set(tabId, authority);
            }
            return false;
        }

        if (this.selectionAuthorityByTab.get(tabId) !== attempt) return false;
        if (!parseSidePanelSelectionRepublishAck(response, probe.data)) {
            this.selectionAuthorityByTab.set(tabId, authority);
            return false;
        }

        this.selectionAuthorityByTab.set(
            tabId,
            Object.freeze({
                documentId: attempt.revokedDocumentId,
                revokedDocumentId: null,
            })
        );
        const refreshRequestId = this.nextCounter(
            'selectionRepublishRequestId'
        );
        if (!refreshRequestId) return true;
        try {
            await chrome.tabs.sendMessage(
                tabId,
                buildSidePanelSelectionRepublishRequestMessage(
                    refreshRequestId
                ),
                { documentId: attempt.revokedDocumentId, frameId: 0 }
            );
        } catch (_) {}
        return true;
    }

    acceptSelectionSnapshot(senderIdentity, snapshot) {
        if (senderIdentity?.role !== MessageSenderRoles.CONTENT || !snapshot) {
            return false;
        }

        const { tabId, windowId, documentId, documentLifecycle, frameId } =
            senderIdentity;
        if (documentLifecycle !== 'active' || frameId !== 0) return false;

        const knownActiveTab = this.activeTabByWindow.get(windowId);
        if (knownActiveTab && knownActiveTab.tabId !== tabId) return false;
        if (!knownActiveTab) {
            this.noteActiveTab({ tabId, windowId });
        }
        this.clearSelectionsOutsideActiveTab(tabId, windowId);

        const authority = this.selectionAuthorityByTab.get(tabId);
        if (authority?.revokedDocumentId === documentId) {
            return false;
        }
        if (authority?.documentId && authority.documentId !== documentId) {
            return false;
        }

        const current = this.selectionByTab.get(tabId);
        const sameDocument = Boolean(
            current &&
            current.windowId === windowId &&
            current.documentId === documentId
        );
        const startsNewOwner = Boolean(
            !current ||
            !sameDocument ||
            snapshot.lifecycleGeneration > current.lifecycleGeneration
        );

        if (
            sameDocument &&
            snapshot.lifecycleGeneration < current.lifecycleGeneration
        ) {
            return false;
        }

        if (current && !startsNewOwner) {
            if (
                snapshot.selectionRevision < current.snapshot.selectionRevision
            ) {
                return false;
            }
            if (
                snapshot.selectionRevision ===
                current.snapshot.selectionRevision
            ) {
                return snapshotsEqual(current.snapshot, snapshot);
            }
            if (snapshot.renderRevision < current.snapshot.renderRevision) {
                return false;
            }
        }

        const ownerGeneration = startsNewOwner
            ? this.nextCounter('selectionOwnerGeneration')
            : current.ownerGeneration;
        const revision = this.nextCounter('selectionRecordRevision');
        if (!ownerGeneration || !revision) return false;

        const selection = Object.freeze({
            revision,
            ownerGeneration,
            tabId,
            windowId,
            documentId,
            lifecycleGeneration: snapshot.lifecycleGeneration,
            snapshot,
        });
        this.selectionAuthorityByTab.set(
            tabId,
            Object.freeze({
                documentId,
                revokedDocumentId: authority?.revokedDocumentId ?? null,
            })
        );
        this.selectionByTab.set(tabId, selection);
        this.broadcastSelection(selection);
        return true;
    }

    registerListeners(serviceReadiness = null) {
        if (serviceReadiness) this.serviceReadiness = serviceReadiness;
        if (this.listenersRegistered) return;

        this.onConnectListener = (port) => {
            if (!this.isTrustedSidePanelPort(port)) {
                this.logger.warn('Rejected unauthorized side panel port');
                try {
                    port?.disconnect?.();
                } catch (_) {}
                return;
            }
            this.handleSidePanelConnection(port);
        };
        this.onTabActivatedListener = (activeInfo) => {
            const activation = this.noteActiveTab(activeInfo);
            if (!activation) return;
            void this.runAfterReady(
                () => this.handleTabActivated(activeInfo, activation),
                'tab activation'
            );
        };
        this.onTabRemovedListener = (tabId) => {
            this.handleTabRemoved(tabId);
        };
        this.onTabUpdatedListener = (tabId, changeInfo) => {
            if (changeInfo?.status === 'loading') {
                this.revokeSelectionAuthority(tabId);
            } else if (changeInfo?.status === 'complete') {
                void this.revalidateRevokedSelectionAuthority(tabId);
            }
        };

        chrome.runtime?.onConnect?.addListener(this.onConnectListener);
        chrome.tabs?.onActivated?.addListener(this.onTabActivatedListener);
        chrome.tabs?.onRemoved?.addListener(this.onTabRemovedListener);
        chrome.tabs?.onUpdated?.addListener(this.onTabUpdatedListener);
        this.listenersRegistered = true;
    }

    isTrustedSidePanelPort(port) {
        try {
            const sender = port?.sender;
            const extensionId = chrome.runtime?.id;
            const extensionRoot = chrome.runtime?.getURL?.('');
            const sidePanelUrl = chrome.runtime?.getURL?.(
                'sidepanel/sidepanel.html'
            );
            const extensionOrigin = extensionRoot?.replace(/\/+$/u, '');
            return Boolean(
                port?.name === 'sidepanel' &&
                extensionId &&
                sender?.id === extensionId &&
                sender?.url === sidePanelUrl &&
                sender?.tab == null &&
                (sender?.origin == null || sender.origin === extensionOrigin)
            );
        } catch (_) {
            return false;
        }
    }

    removeListeners() {
        if (!this.listenersRegistered) return;
        chrome.runtime?.onConnect?.removeListener?.(this.onConnectListener);
        chrome.tabs?.onActivated?.removeListener?.(this.onTabActivatedListener);
        chrome.tabs?.onRemoved?.removeListener?.(this.onTabRemovedListener);
        chrome.tabs?.onUpdated?.removeListener?.(this.onTabUpdatedListener);
        this.onConnectListener = null;
        this.onTabActivatedListener = null;
        this.onTabRemovedListener = null;
        this.onTabUpdatedListener = null;
        this.listenersRegistered = false;
    }

    async runAfterReady(callback, operation) {
        try {
            if (this.serviceReadiness && !this.serviceReadiness.isReady()) {
                await this.serviceReadiness.waitUntilReady();
            }
            return await callback();
        } catch (_) {
            this.logger.error('Side panel ' + operation + ' failed');
            return undefined;
        }
    }

    applyBehaviorConfig(changes = {}) {
        for (const key of BEHAVIOR_CONFIG_KEYS) {
            if (Object.prototype.hasOwnProperty.call(changes, key)) {
                this.behaviorConfig[key] =
                    changes[key] ?? this.defaultBehaviorConfig[key];
            }
        }
    }

    async refreshBehaviorConfig() {
        const config = await configService.getMultiple(BEHAVIOR_CONFIG_KEYS);
        this.applyBehaviorConfig(config);
        return this.behaviorConfig;
    }

    async initialize(serviceReadiness = null) {
        this.registerListeners(serviceReadiness);
        if (this.initialized) return;

        if (typeof chrome.sidePanel === 'undefined') {
            this.logger.warn('Side Panel API not available');
            return;
        }

        try {
            await this.refreshBehaviorConfig();
        } catch (_) {
            this.logger.warn(
                'Failed to load side panel behavior; using schema defaults'
            );
        }
        if (!this.configUnsubscribe) {
            this.configUnsubscribe = configService.onChanged((changes) => {
                this.applyBehaviorConfig(changes);
            });
        }
        this.initialized = true;
        this.logger.info('Side Panel Service initialized');
    }

    destroy() {
        this.removeListeners();
        if (this.configUnsubscribe) {
            try {
                this.configUnsubscribe();
            } catch (_) {}
            this.configUnsubscribe = null;
        }
        for (const connection of [...this.connections.values()]) {
            this.closeConnection(connection, true);
        }
        this.connectionByTab.clear();
        this.connectionsByWindow.clear();
        this.activeTabByWindow.clear();
        this.selectionByTab.clear();
        this.selectionAuthorityByTab.clear();
        this.initialized = false;
    }

    handleSidePanelConnection(port) {
        if (this.connections.has(port)) return;
        const generation = this.nextCounter('connectionGeneration');
        if (!generation) {
            try {
                port.disconnect?.();
            } catch (_) {}
            return;
        }

        const connection = {
            binding: null,
            bindingGeneration: 0,
            connected: true,
            generation,
            pendingRemoval: null,
            port,
            windowId: null,
        };
        this.connections.set(port, connection);

        port.onMessage.addListener((message) => {
            if (!this.isCurrentConnection(connection)) return;

            const registration = parseSidePanelRegistrationMessage(message);
            if (registration) {
                connection.bindingGeneration += 1;
                const bindingGeneration = connection.bindingGeneration;
                void this.runAfterReady(
                    () =>
                        this.registerConnection(
                            connection,
                            registration,
                            bindingGeneration
                        ),
                    'registration'
                );
                return;
            }

            const removal =
                parseSidePanelSelectionRemovalRequestMessage(message);
            if (removal) {
                this.beginSelectionRemoval(connection, removal);
                return;
            }

            this.logger.warn('Rejected invalid side panel message');
            this.closeConnection(connection, true);
        });

        port.onDisconnect.addListener(() => {
            if (this.closeConnection(connection)) {
                this.logger.info('Side panel disconnected');
            }
        });
    }

    async registerConnection(connection, binding, bindingGeneration) {
        if (
            !this.isCurrentConnection(connection) ||
            connection.bindingGeneration !== bindingGeneration
        ) {
            return false;
        }

        let tab;
        try {
            tab = await chrome.tabs.get(binding.tabId);
        } catch (_) {
            if (
                this.isCurrentConnection(connection) &&
                connection.bindingGeneration === bindingGeneration
            ) {
                this.closeConnection(connection, true);
            }
            return false;
        }

        if (
            !this.isCurrentConnection(connection) ||
            connection.bindingGeneration !== bindingGeneration
        ) {
            return false;
        }

        const activeTab = this.activeTabByWindow.get(binding.windowId);
        if (
            tab?.id !== binding.tabId ||
            tab?.windowId !== binding.windowId ||
            tab?.active !== true ||
            (activeTab && activeTab.tabId !== binding.tabId)
        ) {
            this.closeConnection(connection, true);
            return false;
        }

        if (!activeTab) {
            this.noteActiveTab(binding);
        }

        this.detachBinding(connection, false, false);

        const replaced = this.connectionByTab.get(binding.tabId);
        if (replaced && replaced !== connection) {
            this.closeConnection(replaced, true);
        }

        connection.binding = binding;
        this.connectionByTab.set(binding.tabId, connection);
        this.addConnectionToWindow(connection, binding.windowId);

        if (
            !this.postToConnection(
                connection,
                buildSidePanelBindingConfirmationMessage(binding)
            ) ||
            !this.isCurrentBinding(connection, binding, bindingGeneration)
        ) {
            return false;
        }

        const selection = this.selectionByTab.get(binding.tabId);
        if (
            !this.postSelectionState(
                connection,
                selection?.windowId === binding.windowId ? selection : null
            )
        ) {
            return false;
        }

        void this.requestSelectionRepublish(
            connection,
            binding,
            bindingGeneration
        );
        return true;
    }

    async requestSelectionRepublish(connection, binding, bindingGeneration) {
        if (!this.isCurrentBinding(connection, binding, bindingGeneration)) {
            return;
        }
        const requestId = this.nextCounter('selectionRepublishRequestId');
        if (!requestId) return;
        const request =
            buildSidePanelSelectionRepublishRequestMessage(requestId);
        const selection = this.selectionByTab.get(binding.tabId);
        const target = selection
            ? { documentId: selection.documentId, frameId: 0 }
            : { frameId: 0 };

        try {
            const response = await chrome.tabs.sendMessage(
                binding.tabId,
                request,
                target
            );
            if (this.isCurrentBinding(connection, binding, bindingGeneration)) {
                parseSidePanelSelectionRepublishAck(response, request.data);
            }
        } catch (_) {
            // Unsupported pages simply have no selection to republish.
        }
    }

    beginSelectionRemoval(connection, removal) {
        if (!this.isCurrentConnection(connection)) return;
        if (connection.pendingRemoval) {
            if (
                !removalRequestsEqual(
                    connection.pendingRemoval.removal,
                    removal
                ) &&
                bindingsEqual(connection.binding, removal.binding)
            ) {
                this.postToConnection(
                    connection,
                    buildSidePanelSelectionRemovalResultMessage(
                        removal,
                        'rejected'
                    )
                );
            }
            return;
        }

        const operation = {
            binding: connection.binding,
            bindingGeneration: connection.bindingGeneration,
            removal,
        };
        connection.pendingRemoval = operation;
        void this.runAfterReady(
            () => this.processSelectionRemoval(connection, operation),
            'selection removal'
        ).finally(() => {
            if (connection.pendingRemoval === operation) {
                connection.pendingRemoval = null;
            }
        });
    }

    removalMatchesSelection(removal, selection) {
        return Boolean(
            selection &&
            removal.selectionOwnerGeneration === selection.ownerGeneration &&
            removal.selectionRevision ===
                selection.snapshot.selectionRevision &&
            removal.renderRevision === selection.snapshot.renderRevision &&
            selection.snapshot.entries.some(
                (entry) => entry.wordIndex === removal.wordIndex
            )
        );
    }

    isAuthoritativeRemovalSuccess(previous, current, removal) {
        if (
            !previous ||
            !current ||
            current.ownerGeneration !== previous.ownerGeneration ||
            current.windowId !== previous.windowId ||
            current.documentId !== previous.documentId ||
            current.lifecycleGeneration !== previous.lifecycleGeneration ||
            current.snapshot.selectionRevision <= removal.selectionRevision ||
            current.snapshot.renderRevision !== removal.renderRevision ||
            current.snapshot.reason !== 'remove'
        ) {
            return false;
        }

        const expected = previous.snapshot.entries.filter(
            (entry) => entry.wordIndex !== removal.wordIndex
        );
        return entriesEqual(current.snapshot.entries, expected);
    }

    postRemovalResult(connection, operation, status) {
        if (
            connection.pendingRemoval !== operation ||
            !this.isCurrentBinding(
                connection,
                operation.binding,
                operation.bindingGeneration
            )
        ) {
            return false;
        }
        return this.postToConnection(
            connection,
            buildSidePanelSelectionRemovalResultMessage(
                operation.removal,
                status
            )
        );
    }

    async processSelectionRemoval(connection, operation) {
        const { binding, bindingGeneration, removal } = operation;
        if (
            !bindingsEqual(binding, removal.binding) ||
            !this.isCurrentBinding(connection, binding, bindingGeneration)
        ) {
            return false;
        }

        const previous = this.selectionByTab.get(binding.tabId);
        if (!this.removalMatchesSelection(removal, previous)) {
            this.postRemovalResult(connection, operation, 'rejected');
            return false;
        }

        const command = buildSidePanelSelectionRemovalCommandMessage(
            removal,
            previous.lifecycleGeneration
        );
        let response;
        try {
            response = await chrome.tabs.sendMessage(binding.tabId, command, {
                documentId: previous.documentId,
                frameId: 0,
            });
        } catch (_) {
            this.postRemovalResult(connection, operation, 'rejected');
            return false;
        }

        if (
            connection.pendingRemoval !== operation ||
            !this.isCurrentBinding(connection, binding, bindingGeneration)
        ) {
            return false;
        }

        const result = parseSidePanelSelectionRemovalCommandResponse(
            response,
            command.data
        );
        const current = this.selectionByTab.get(binding.tabId);
        const status =
            result?.status === 'applied' &&
            this.isAuthoritativeRemovalSuccess(previous, current, removal)
                ? 'applied'
                : 'rejected';
        this.postRemovalResult(connection, operation, status);
        return status === 'applied';
    }

    async openSidePanel(tabId, options = {}) {
        try {
            await this.refreshBehaviorConfig();
            return await this.openSidePanelImmediate(tabId, options);
        } catch (_) {
            this.logger.error('Failed to prepare side panel');
            return { success: false, reason: 'configuration-unavailable' };
        }
    }

    async openSidePanelImmediate(tabId, options = {}) {
        const config = this.behaviorConfig;
        if (!config.sidePanelUseSidePanel) {
            return { success: false, reason: 'disabled' };
        }

        const shouldOpen = Boolean(
            options.force === true ||
            (options.autoOpen ?? config.sidePanelAutoOpen)
        );
        if (shouldOpen) {
            if (typeof chrome.sidePanel?.open !== 'function') {
                return { success: false, reason: 'api-unavailable' };
            }
            try {
                await chrome.sidePanel.open({ tabId });
            } catch (_) {
                this.logger.error('Failed to open side panel');
                return { success: false, reason: 'open-failed' };
            }

            try {
                const tab = await chrome.tabs.get(tabId);
                if (
                    tab?.id === tabId &&
                    tab.active === true &&
                    Number.isSafeInteger(tab.windowId) &&
                    tab.windowId >= 0
                ) {
                    const activation = this.noteActiveTab({
                        tabId,
                        windowId: tab.windowId,
                    });
                    this.clearSelectionsOutsideActiveTab(tabId, tab.windowId);
                    if (this.isCurrentActivation(activation)) {
                        this.notifyWindowOfBinding(
                            tabId,
                            tab.windowId,
                            buildSidePanelForceBindTabMessage
                        );
                    }
                }
            } catch (_) {
                this.logger.warn('Failed to notify side panel binding');
            }
        }

        const pauseRequested = Boolean(
            options.pauseVideo ?? config.sidePanelAutoPauseVideo
        );
        const pauseSucceeded = pauseRequested
            ? await this.pauseVideo(tabId)
            : null;
        return { success: true, pauseRequested, pauseSucceeded };
    }

    async pauseVideo(tabId) {
        try {
            const request = buildSidePanelPauseVideoRequestMessage();
            const response = await chrome.tabs.sendMessage(tabId, request);
            return (
                parseContentControlResponseMessage(response, request)
                    ?.success === true
            );
        } catch (_) {
            this.logger.error('Failed to pause video', { tabId });
            return false;
        }
    }

    notifyWindowOfBinding(tabId, windowId, buildMessage) {
        const connections = [...(this.connectionsByWindow.get(windowId) ?? [])];
        for (const connection of connections) {
            if (!this.isCurrentConnection(connection)) continue;
            if (connection.binding && connection.binding.tabId !== tabId) {
                this.detachBinding(connection, true);
            }
            this.postToConnection(
                connection,
                buildMessage({ tabId, windowId })
            );
        }
    }

    handleTabActivated(activeInfo, recordedActivation = null) {
        const activation = recordedActivation ?? this.noteActiveTab(activeInfo);
        if (!this.isCurrentActivation(activation)) return;

        this.clearSelectionsOutsideActiveTab(
            activation.tabId,
            activation.windowId
        );
        this.notifyWindowOfBinding(
            activation.tabId,
            activation.windowId,
            buildSidePanelTabActivatedMessage
        );
    }

    handleTabRemoved(tabId) {
        if (!Number.isSafeInteger(tabId) || tabId < 0) return;
        this.selectionByTab.delete(tabId);
        this.selectionAuthorityByTab.delete(tabId);
        for (const [windowId, activeTab] of this.activeTabByWindow) {
            if (activeTab.tabId === tabId) {
                this.activeTabByWindow.delete(windowId);
            }
        }
        const connection = this.connectionByTab.get(tabId);
        if (connection) this.closeConnection(connection, true);
    }

    isSidePanelSupported() {
        return typeof chrome.sidePanel !== 'undefined';
    }
}

export const sidePanelService = new SidePanelService();
