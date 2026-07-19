/**
 * Side Panel Service
 *
 * Manages Chrome Side Panel API integration for the AI Context feature.
 * Handles opening/closing the side panel, routing messages, and managing state.
 *
 * @author DualSub Extension
 * @version 2.5.0
 */

import Logger from '../../utils/logger.js';
import { configService } from '../../services/configService.js';
import { getDefaultValue } from '../../config/configSchema.js';
import { MessageActions } from '../../content_scripts/shared/constants/messageActions.js';
import {
    MessageSenderRoles,
    buildSidePanelPauseVideoRequestMessage,
    buildSidePanelBindingConfirmationMessage,
    buildSidePanelForceBindTabMessage,
    buildSidePanelSelectionRemovalCommandMessage,
    buildSidePanelSelectionRemovalResultMessage,
    buildSidePanelSelectionRepublishRequestMessage,
    buildSidePanelSelectionStateMessage,
    buildSidePanelTabActivatedMessage,
    parseSidePanelBindingTuple,
    parseSidePanelContentSelectionSnapshotMessage,
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

const REGISTRATION_RESULT = Object.freeze({
    INVALID: 'invalid',
    REGISTERED: 'registered',
    SUPERSEDED: 'superseded',
});

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

export class SidePanelService {
    constructor() {
        this.logger = Logger.create('SidePanelService', configService);
        this.initialized = false;
        this.activeConnections = new Map(); // Track connections from side panels
        this.bindingByPort = new Map(); // Map<port, binding authorization>
        this.activeConnectionsByWindow = new Map(); // Map<windowId, Set<port>>
        this.connectedPorts = new Set();
        this.revokedPorts = new WeakSet();
        this.registrationClaimsByTab = new Map();
        this.registrationClaimByPort = new Map();
        this.activeTabAuthorityByWindow = new Map();
        this.tabLifecycleEpochByTab = new Map();
        this.authorizationEpoch = 0;
        this.selectionOwnersByTab = new Map();
        this.selectionOwnerGeneration = 0;
        this.selectionReceiptEpoch = 0;
        this.selectionRepublishRequestId = 0;
        this.selectionInvalidationEpochByTab = new Map();
        this.selectionRemovalFlightsByPort = new Map();
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

    nextAuthorizationEpoch() {
        this.authorizationEpoch += 1;
        return this.authorizationEpoch;
    }

    nextSelectionOwnerGeneration() {
        if (this.selectionOwnerGeneration >= Number.MAX_SAFE_INTEGER) {
            return null;
        }
        this.selectionOwnerGeneration += 1;
        return this.selectionOwnerGeneration;
    }

    nextSelectionReceiptEpoch() {
        if (this.selectionReceiptEpoch >= Number.MAX_SAFE_INTEGER) return null;
        this.selectionReceiptEpoch += 1;
        return this.selectionReceiptEpoch;
    }

    nextSelectionRepublishRequestId() {
        if (this.selectionRepublishRequestId >= Number.MAX_SAFE_INTEGER) {
            return null;
        }
        this.selectionRepublishRequestId += 1;
        return this.selectionRepublishRequestId;
    }

    copyContentSelectionInput(senderIdentity, snapshot) {
        const normalizedSnapshot =
            parseSidePanelContentSelectionSnapshotMessage({
                action: MessageActions.SIDEPANEL_SELECTION_SYNC,
                data: snapshot,
            });
        const role = getOwnDataProperty(senderIdentity, 'role');
        const tabId = getOwnDataProperty(senderIdentity, 'tabId');
        const windowId = getOwnDataProperty(senderIdentity, 'windowId');
        const frameId = getOwnDataProperty(senderIdentity, 'frameId');
        const documentId = getOwnDataProperty(senderIdentity, 'documentId');
        const documentLifecycle = getOwnDataProperty(
            senderIdentity,
            'documentLifecycle'
        );
        const lifecycleGeneration = normalizedSnapshot?.lifecycleGeneration;
        const selectionRevision = normalizedSnapshot?.selectionRevision;
        const renderRevision = normalizedSnapshot?.renderRevision;
        const reason = normalizedSnapshot?.reason;
        const entries = normalizedSnapshot?.entries;

        if (
            role !== MessageSenderRoles.CONTENT ||
            !Number.isSafeInteger(tabId) ||
            tabId < 0 ||
            !Number.isSafeInteger(windowId) ||
            windowId < 0 ||
            frameId !== 0 ||
            typeof documentId !== 'string' ||
            documentId.trim().length === 0 ||
            documentLifecycle !== 'active' ||
            !Number.isSafeInteger(lifecycleGeneration) ||
            lifecycleGeneration <= 0 ||
            !Number.isSafeInteger(selectionRevision) ||
            selectionRevision <= 0 ||
            !Number.isSafeInteger(renderRevision) ||
            renderRevision <= 0 ||
            typeof reason !== 'string' ||
            !Array.isArray(entries)
        ) {
            return null;
        }

        const copiedEntries = [];
        let previousWordIndex = -1;
        for (const entry of entries) {
            const wordIndex = getOwnDataProperty(entry, 'wordIndex');
            const word = getOwnDataProperty(entry, 'word');
            if (
                !Number.isSafeInteger(wordIndex) ||
                wordIndex < 0 ||
                wordIndex <= previousWordIndex ||
                typeof word !== 'string'
            ) {
                return null;
            }
            copiedEntries.push(Object.freeze({ wordIndex, word }));
            previousWordIndex = wordIndex;
        }

        return Object.freeze({
            role,
            tabId,
            windowId,
            frameId,
            documentId,
            documentLifecycle,
            lifecycleGeneration,
            selectionRevision,
            renderRevision,
            reason,
            entries: Object.freeze(copiedEntries),
        });
    }

    projectSelectionOwner(owner) {
        return Object.freeze({
            selectionOwnerGeneration: owner.selectionOwnerGeneration,
            selectionRevision: owner.selectionRevision,
            renderRevision: owner.renderRevision,
            reason: owner.reason,
            entries: owner.entries,
        });
    }

    selectionEntriesEqual(left, right) {
        if (left.length !== right.length) return false;
        return left.every(
            (entry, index) =>
                entry.wordIndex === right[index].wordIndex &&
                entry.word === right[index].word
        );
    }

    selectionSnapshotEqualsOwner(owner, input) {
        return Boolean(
            owner.selectionRevision === input.selectionRevision &&
            owner.renderRevision === input.renderRevision &&
            owner.reason === input.reason &&
            this.selectionEntriesEqual(owner.entries, input.entries)
        );
    }

    createSelectionOwner(input, selectionOwnerGeneration) {
        const acceptedReceiptEpoch = this.nextSelectionReceiptEpoch();
        if (!acceptedReceiptEpoch) return null;
        return Object.freeze({
            tabId: input.tabId,
            windowId: input.windowId,
            documentId: input.documentId,
            lifecycleGeneration: input.lifecycleGeneration,
            selectionOwnerGeneration,
            selectionRevision: input.selectionRevision,
            renderRevision: input.renderRevision,
            reason: input.reason,
            entries: input.entries,
            acceptedReceiptEpoch,
        });
    }

    refreshSelectionOwnerReceipt(owner) {
        const acceptedReceiptEpoch = this.nextSelectionReceiptEpoch();
        if (!acceptedReceiptEpoch) return null;
        return Object.freeze({ ...owner, acceptedReceiptEpoch });
    }

    selectionOwnerIdentityEquals(left, right) {
        return Boolean(
            left &&
            right &&
            left.tabId === right.tabId &&
            left.windowId === right.windowId &&
            left.documentId === right.documentId &&
            left.lifecycleGeneration === right.lifecycleGeneration &&
            left.selectionOwnerGeneration === right.selectionOwnerGeneration
        );
    }

    selectionOwnerStateEquals(left, right) {
        return Boolean(
            this.selectionOwnerIdentityEquals(left, right) &&
            left.selectionRevision === right.selectionRevision &&
            left.renderRevision === right.renderRevision &&
            left.reason === right.reason &&
            this.selectionEntriesEqual(left.entries, right.entries)
        );
    }

    broadcastSelectionOwner(owner) {
        const port = this.activeConnections.get(owner.tabId);
        const binding = port ? this.bindingByPort.get(port) : null;
        if (
            !port ||
            !binding ||
            binding.windowId !== owner.windowId ||
            binding.selectionSynchronizationPending === true ||
            !this.isCurrentPortBinding(
                port,
                owner.tabId,
                owner.windowId,
                binding.registrationEpoch,
                binding.registrationId
            )
        ) {
            return;
        }

        const exactBinding = { ...binding };
        try {
            port.postMessage(
                buildSidePanelSelectionStateMessage(
                    {
                        registrationId: binding.registrationId,
                        tabId: owner.tabId,
                        windowId: owner.windowId,
                    },
                    this.projectSelectionOwner(owner)
                )
            );
        } catch (_) {
            this.revokeExactPortBinding(port, exactBinding);
        }
    }

    projectSelectionNull(tabId) {
        const port = this.activeConnections.get(tabId);
        const binding = port ? this.bindingByPort.get(port) : null;
        if (
            !port ||
            !binding ||
            !this.isCurrentPortBinding(
                port,
                binding.tabId,
                binding.windowId,
                binding.registrationEpoch,
                binding.registrationId
            )
        ) {
            return false;
        }

        const exactBinding = Object.freeze({ ...binding });
        try {
            port.postMessage(
                buildSidePanelSelectionStateMessage(
                    {
                        registrationId: binding.registrationId,
                        tabId: binding.tabId,
                        windowId: binding.windowId,
                    },
                    null
                )
            );
        } catch (_) {
            this.revokeExactPortBinding(port, exactBinding);
            return false;
        }
        return this.isSameRegistration(
            this.bindingByPort.get(port),
            exactBinding
        );
    }

    reserveSelectionRemovalFlight(port, removal) {
        const existing = this.selectionRemovalFlightsByPort.get(port);
        if (existing) {
            return Object.freeze({
                status: this.selectionRemovalRequestsEqual(
                    existing.removal,
                    removal
                )
                    ? 'duplicate'
                    : 'busy',
            });
        }

        const flight = Object.freeze({ removal });
        this.selectionRemovalFlightsByPort.set(port, flight);
        return Object.freeze({ flight, status: 'reserved' });
    }

    selectionRemovalRequestsEqual(left, right) {
        return Boolean(
            left &&
            right &&
            left.binding.registrationId === right.binding.registrationId &&
            left.binding.tabId === right.binding.tabId &&
            left.binding.windowId === right.binding.windowId &&
            left.requestId === right.requestId &&
            left.selectionOwnerGeneration === right.selectionOwnerGeneration &&
            left.selectionRevision === right.selectionRevision &&
            left.renderRevision === right.renderRevision &&
            left.wordIndex === right.wordIndex
        );
    }

    isCurrentSelectionRemovalFlight(port, flight) {
        return Boolean(
            flight && this.selectionRemovalFlightsByPort.get(port) === flight
        );
    }

    releaseSelectionRemovalFlight(port, flight) {
        if (this.selectionRemovalFlightsByPort.get(port) === flight) {
            this.selectionRemovalFlightsByPort.delete(port);
        }
    }

    bindingMatchesRemoval(binding, removal) {
        return Boolean(
            binding &&
            removal &&
            binding.registrationId === removal.binding.registrationId &&
            binding.tabId === removal.binding.tabId &&
            binding.windowId === removal.binding.windowId
        );
    }

    captureSelectionRemovalBinding(port, removal) {
        const binding = this.bindingByPort.get(port);
        if (
            !this.bindingMatchesRemoval(binding, removal) ||
            binding.selectionSynchronizationPending === true ||
            !this.isCurrentPortBinding(
                port,
                binding.tabId,
                binding.windowId,
                binding.registrationEpoch,
                binding.registrationId
            )
        ) {
            return null;
        }
        return Object.freeze({ ...binding });
    }

    ownsSelectionRemovalBinding(port, binding, removal) {
        const current = this.bindingByPort.get(port);
        return Boolean(
            this.isSameRegistration(current, binding) &&
            this.bindingMatchesRemoval(current, removal) &&
            current.selectionSynchronizationPending !== true &&
            this.isCurrentPortBinding(
                port,
                binding.tabId,
                binding.windowId,
                binding.registrationEpoch,
                binding.registrationId
            )
        );
    }

    captureSelectionRemovalOwner(removal) {
        const owner = this.selectionOwnersByTab.get(removal.binding.tabId);
        if (
            !owner ||
            owner.windowId !== removal.binding.windowId ||
            owner.selectionOwnerGeneration !==
                removal.selectionOwnerGeneration ||
            owner.selectionRevision !== removal.selectionRevision ||
            owner.renderRevision !== removal.renderRevision ||
            !owner.entries.some(
                (entry) => entry.wordIndex === removal.wordIndex
            )
        ) {
            return null;
        }
        return owner;
    }

    isAuthoritativeSelectionRemovalSuccess(current, previous, removal) {
        if (
            !this.selectionOwnerIdentityEquals(current, previous) ||
            current.acceptedReceiptEpoch <= previous.acceptedReceiptEpoch ||
            current.selectionRevision <= removal.selectionRevision ||
            current.renderRevision !== removal.renderRevision ||
            current.reason !== 'remove'
        ) {
            return false;
        }

        const expectedEntries = previous.entries.filter(
            (entry) => entry.wordIndex !== removal.wordIndex
        );
        return this.selectionEntriesEqual(current.entries, expectedEntries);
    }

    postSelectionRemovalResult(port, binding, removal, status) {
        if (!this.ownsSelectionRemovalBinding(port, binding, removal)) {
            return false;
        }
        try {
            port.postMessage(
                buildSidePanelSelectionRemovalResultMessage(removal, status)
            );
        } catch (_) {
            this.revokeExactPortBinding(port, binding);
            return false;
        }
        return this.ownsSelectionRemovalBinding(port, binding, removal);
    }

    async handleSelectionRemoval(port, isDisconnected, flight) {
        const { removal } = flight;
        const binding = this.captureSelectionRemovalBinding(port, removal);
        if (!binding || !this.isCurrentSelectionRemovalFlight(port, flight)) {
            return false;
        }

        const owner = this.captureSelectionRemovalOwner(removal);
        if (!owner) {
            this.postSelectionRemovalResult(port, binding, removal, 'rejected');
            return false;
        }

        const command = buildSidePanelSelectionRemovalCommandMessage(
            removal,
            owner.lifecycleGeneration
        );
        let response;
        try {
            if (
                isDisconnected() ||
                !this.isCurrentSelectionRemovalFlight(port, flight) ||
                !this.ownsSelectionRemovalBinding(port, binding, removal) ||
                this.captureSelectionRemovalOwner(removal) !== owner
            ) {
                return false;
            }
            response = await chrome.tabs.sendMessage(
                removal.binding.tabId,
                command,
                { documentId: owner.documentId, frameId: 0 }
            );
        } catch (_) {
            if (
                !isDisconnected() &&
                this.isCurrentSelectionRemovalFlight(port, flight)
            ) {
                this.postSelectionRemovalResult(
                    port,
                    binding,
                    removal,
                    'rejected'
                );
            }
            return false;
        }

        if (
            isDisconnected() ||
            !this.isCurrentSelectionRemovalFlight(port, flight) ||
            !this.ownsSelectionRemovalBinding(port, binding, removal)
        ) {
            return false;
        }

        const commandResult = parseSidePanelSelectionRemovalCommandResponse(
            response,
            command.data
        );
        const currentOwner = this.selectionOwnersByTab.get(
            removal.binding.tabId
        );
        const status =
            commandResult?.status === 'applied' &&
            this.isAuthoritativeSelectionRemovalSuccess(
                currentOwner,
                owner,
                removal
            )
                ? 'applied'
                : 'rejected';
        this.postSelectionRemovalResult(port, binding, removal, status);
        return status === 'applied';
    }

    acceptSelectionSnapshot(senderIdentity, snapshot) {
        const input = this.copyContentSelectionInput(senderIdentity, snapshot);
        if (!input) return false;

        const current = this.selectionOwnersByTab.get(input.tabId);
        const changedDocument = Boolean(
            current &&
            (current.windowId !== input.windowId ||
                current.documentId !== input.documentId)
        );
        const higherLifecycle = Boolean(
            current &&
            !changedDocument &&
            input.lifecycleGeneration > current.lifecycleGeneration
        );
        const mintsOwner = !current || changedDocument || higherLifecycle;

        if (
            current &&
            !changedDocument &&
            input.lifecycleGeneration < current.lifecycleGeneration
        ) {
            return false;
        }

        if (current && !mintsOwner) {
            if (input.selectionRevision < current.selectionRevision) {
                return false;
            }
            if (input.selectionRevision === current.selectionRevision) {
                if (!this.selectionSnapshotEqualsOwner(current, input)) {
                    return false;
                }
                const replayedOwner =
                    this.refreshSelectionOwnerReceipt(current);
                if (!replayedOwner) return false;
                this.selectionOwnersByTab.set(input.tabId, replayedOwner);
                return true;
            }
            if (input.renderRevision < current.renderRevision) return false;
        }

        const selectionOwnerGeneration = mintsOwner
            ? this.nextSelectionOwnerGeneration()
            : current.selectionOwnerGeneration;
        if (!selectionOwnerGeneration) return false;
        const owner = this.createSelectionOwner(
            input,
            selectionOwnerGeneration
        );
        if (!owner) return false;
        this.selectionOwnersByTab.set(input.tabId, owner);
        this.broadcastSelectionOwner(owner);
        return true;
    }

    isValidRegistrationData(data) {
        return parseSidePanelBindingTuple(data) !== null;
    }

    isValidActiveTabInfo(activeInfo) {
        return Boolean(
            Number.isSafeInteger(activeInfo?.tabId) &&
            activeInfo.tabId >= 0 &&
            Number.isSafeInteger(activeInfo?.windowId) &&
            activeInfo.windowId >= 0
        );
    }

    recordTabRemoval(tabId) {
        if (!Number.isSafeInteger(tabId) || tabId < 0) return null;

        const removal = {
            tabId,
            tabLifecycleEpoch: this.nextAuthorizationEpoch(),
        };
        this.tabLifecycleEpochByTab.set(tabId, removal.tabLifecycleEpoch);
        this.selectionInvalidationEpochByTab.delete(tabId);
        this.selectionOwnersByTab.delete(tabId);
        for (const [windowId, authority] of this.activeTabAuthorityByWindow) {
            if (authority.tabId === tabId) {
                this.activeTabAuthorityByWindow.delete(windowId);
            }
        }
        return removal;
    }

    recordTabNavigation(tabId) {
        if (!Number.isSafeInteger(tabId) || tabId < 0) return null;

        const invalidation = Object.freeze({
            selectionInvalidationEpoch: this.nextAuthorizationEpoch(),
            tabId,
        });
        this.selectionInvalidationEpochByTab.set(
            tabId,
            invalidation.selectionInvalidationEpoch
        );
        this.selectionOwnersByTab.delete(tabId);

        const port = this.activeConnections.get(tabId);
        if (port) {
            this.selectionRemovalFlightsByPort.delete(port);
            this.projectSelectionNull(tabId);
        }
        return invalidation;
    }

    recordWindowActivation(activeInfo) {
        if (!this.isValidActiveTabInfo(activeInfo)) return null;

        const activatedOwner = this.selectionOwnersByTab.get(activeInfo.tabId);
        if (activatedOwner && activatedOwner.windowId !== activeInfo.windowId) {
            this.selectionOwnersByTab.delete(activeInfo.tabId);
        }
        for (const [ownedTabId, owner] of this.selectionOwnersByTab) {
            if (
                owner.windowId === activeInfo.windowId &&
                ownedTabId !== activeInfo.tabId
            ) {
                this.selectionOwnersByTab.delete(ownedTabId);
            }
        }

        const authority = {
            activationEpoch: this.nextAuthorizationEpoch(),
            tabId: activeInfo.tabId,
            windowId: activeInfo.windowId,
        };
        this.activeTabAuthorityByWindow.set(activeInfo.windowId, authority);
        return authority;
    }

    isCurrentWindowActivation(authority) {
        if (!authority) return false;
        const current = this.activeTabAuthorityByWindow.get(authority.windowId);
        return Boolean(
            current?.activationEpoch === authority.activationEpoch &&
            current?.tabId === authority.tabId
        );
    }

    recordRegistrationClaim(
        port,
        data,
        connectionEpoch,
        registrationEpoch = this.nextAuthorizationEpoch()
    ) {
        const registration = parseSidePanelBindingTuple(data);
        if (
            !registration ||
            !this.connectedPorts.has(port) ||
            this.revokedPorts.has(port)
        ) {
            return null;
        }

        const activeAuthority = this.activeTabAuthorityByWindow.get(
            registration.windowId
        );
        const claim = {
            activationEpoch: activeAuthority?.activationEpoch ?? 0,
            activeTabId: activeAuthority?.tabId ?? null,
            connectionEpoch,
            port,
            registrationId: registration.registrationId,
            registrationEpoch,
            tabId: registration.tabId,
            tabLifecycleEpoch:
                this.tabLifecycleEpochByTab.get(registration.tabId) ?? 0,
            windowId: registration.windowId,
        };

        const newerPortClaim = this.registrationClaimByPort.get(port);
        const newerTabClaim = this.registrationClaimsByTab.get(
            registration.tabId
        );
        if (
            newerPortClaim?.registrationEpoch > registrationEpoch ||
            newerTabClaim?.registrationEpoch > registrationEpoch
        ) {
            return claim;
        }

        for (const [claimedTabId, existingClaim] of this
            .registrationClaimsByTab) {
            if (existingClaim.port === port) {
                this.registrationClaimsByTab.delete(claimedTabId);
            }
        }
        this.registrationClaimsByTab.set(registration.tabId, claim);
        this.registrationClaimByPort.set(port, claim);
        return claim;
    }

    isRegistrationClaimActive(claim) {
        if (!claim) return false;
        const current = this.activeTabAuthorityByWindow.get(claim.windowId);
        if (!current) {
            return claim.activationEpoch === 0 && claim.activeTabId == null;
        }

        return Boolean(
            current.activationEpoch === claim.activationEpoch &&
            current.tabId === claim.tabId &&
            (claim.activeTabId == null || claim.activeTabId === claim.tabId)
        );
    }

    establishBaselineActiveTab(claim) {
        if (
            !claim ||
            claim.activationEpoch !== 0 ||
            claim.activeTabId != null
        ) {
            return;
        }
        if (!this.activeTabAuthorityByWindow.has(claim.windowId)) {
            this.activeTabAuthorityByWindow.set(claim.windowId, {
                activationEpoch: 0,
                tabId: claim.tabId,
                windowId: claim.windowId,
            });
        }
    }

    isCurrentRegistrationClaim(claim) {
        if (!claim || this.revokedPorts.has(claim.port)) return false;
        const current = this.registrationClaimsByTab.get(claim.tabId);
        const currentForPort = this.registrationClaimByPort.get(claim.port);
        return Boolean(
            current?.port === claim.port &&
            current?.connectionEpoch === claim.connectionEpoch &&
            current?.registrationId === claim.registrationId &&
            current?.registrationEpoch === claim.registrationEpoch &&
            current?.windowId === claim.windowId &&
            currentForPort?.registrationEpoch === claim.registrationEpoch &&
            currentForPort?.registrationId === claim.registrationId &&
            currentForPort?.tabId === claim.tabId &&
            (this.tabLifecycleEpochByTab.get(claim.tabId) ?? 0) ===
                claim.tabLifecycleEpoch
        );
    }

    /**
     * Register Chrome event listeners synchronously for Manifest V3 cold starts.
     * Message processing is deferred behind the shared service-readiness gate.
     */
    registerListeners(serviceReadiness = null) {
        if (serviceReadiness) {
            this.serviceReadiness = serviceReadiness;
        }
        if (this.listenersRegistered) return;

        this.onConnectListener = (port) => {
            if (
                this.revokedPorts.has(port) ||
                !this.isTrustedSidePanelPort(port)
            ) {
                this.logger.warn('Rejected unauthorized side panel port');
                try {
                    port?.disconnect?.();
                } catch (_) {}
                return;
            }
            this.handleSidePanelConnection(port);
        };
        this.onTabActivatedListener = (activeInfo) => {
            const authority = this.recordWindowActivation(activeInfo);
            if (!authority) return;
            const portsAtActivation = new Set(
                this.activeConnectionsByWindow.get(authority.windowId) ?? []
            );
            void this.runAfterReady(
                () =>
                    this.handleTabActivated(
                        activeInfo,
                        authority,
                        portsAtActivation
                    ),
                'tab activation'
            );
        };
        this.onTabRemovedListener = (tabId) => {
            const removal = this.recordTabRemoval(tabId);
            if (!removal) return;
            void this.runAfterReady(
                () => this.handleTabRemoved(tabId, removal),
                'tab removal'
            );
        };
        this.onTabUpdatedListener = (tabId, changeInfo) => {
            if (getOwnDataProperty(changeInfo, 'status') !== 'loading') return;
            this.recordTabNavigation(tabId);
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
            const extensionOrigin =
                typeof extensionRoot === 'string'
                    ? extensionRoot.replace(/\/+$/, '')
                    : null;

            return Boolean(
                port?.name === 'sidepanel' &&
                typeof extensionId === 'string' &&
                extensionId.length > 0 &&
                sender?.id === extensionId &&
                typeof sidePanelUrl === 'string' &&
                sender?.url === sidePanelUrl &&
                sender?.tab == null &&
                (sender?.origin == null ||
                    (extensionOrigin && sender.origin === extensionOrigin))
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
        } catch (error) {
            this.logger.error(`Side panel ${operation} failed`, error);
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

    bindPort(port, authorization) {
        if (
            !authorization ||
            authorization.port !== port ||
            !this.isCurrentRegistrationClaim(authorization) ||
            !this.isRegistrationClaimActive(authorization)
        ) {
            return false;
        }
        const { tabId, windowId } = authorization;

        this.unbindPort(port);
        const previousPort = this.activeConnections.get(tabId);
        if (previousPort && previousPort !== port) {
            this.revokePort(previousPort);
        }

        this.bindingByPort.set(port, {
            activationEpoch: authorization.activationEpoch,
            confirmed: false,
            connectionEpoch: authorization.connectionEpoch,
            registrationId: authorization.registrationId,
            registrationEpoch: authorization.registrationEpoch,
            selectionSynchronizationPending: false,
            tabId,
            tabLifecycleEpoch: authorization.tabLifecycleEpoch,
            windowId,
        });
        this.activeConnections.set(tabId, port);
        if (!this.activeConnectionsByWindow.has(windowId)) {
            this.activeConnectionsByWindow.set(windowId, new Set());
        }
        this.activeConnectionsByWindow.get(windowId).add(port);
        return true;
    }

    isSameRegistration(left, right) {
        return Boolean(
            left &&
            right &&
            left.connectionEpoch === right.connectionEpoch &&
            left.registrationEpoch === right.registrationEpoch &&
            left.registrationId === right.registrationId &&
            left.tabId === right.tabId &&
            left.windowId === right.windowId
        );
    }

    clearExactRegistration(port, registration) {
        const binding = this.bindingByPort.get(port);
        if (this.isSameRegistration(binding, registration)) {
            if (this.activeConnections.get(binding.tabId) === port) {
                this.activeConnections.delete(binding.tabId);
            }
            const windowPorts = this.activeConnectionsByWindow.get(
                binding.windowId
            );
            windowPorts?.delete(port);
            if (windowPorts?.size === 0) {
                this.activeConnectionsByWindow.delete(binding.windowId);
            }
            this.bindingByPort.delete(port);
            this.selectionRemovalFlightsByPort.delete(port);
        }

        const tabClaim = this.registrationClaimsByTab.get(registration?.tabId);
        if (this.isSameRegistration(tabClaim, registration)) {
            this.registrationClaimsByTab.delete(registration.tabId);
        }
        const portClaim = this.registrationClaimByPort.get(port);
        if (this.isSameRegistration(portClaim, registration)) {
            this.registrationClaimByPort.delete(port);
        }
    }

    clearPortRegistrationClaims(port) {
        for (const [tabId, claim] of this.registrationClaimsByTab) {
            if (claim.port === port) {
                this.registrationClaimsByTab.delete(tabId);
            }
        }
        this.registrationClaimByPort.delete(port);
    }

    revokeExactPortBinding(port, registration) {
        const binding = this.bindingByPort.get(port);
        if (!this.isSameRegistration(binding, registration)) return false;
        const portClaim = this.registrationClaimByPort.get(port);
        const tabClaim = this.registrationClaimsByTab.get(binding.tabId);
        if (
            !this.isSameRegistration(portClaim, registration) ||
            !this.isSameRegistration(tabClaim, registration)
        ) {
            this.clearExactRegistration(port, registration);
            return false;
        }
        this.revokePort(port);
        return true;
    }

    revokePort(port) {
        if (!port) return;
        this.revokedPorts.add(port);
        this.connectedPorts.delete(port);
        this.unbindPort(port);
        this.clearPortRegistrationClaims(port);
        try {
            port.disconnect?.();
        } catch (_) {}
    }

    unbindPort(port) {
        this.selectionRemovalFlightsByPort.delete(port);
        const binding = this.bindingByPort.get(port);
        if (binding) {
            if (this.activeConnections.get(binding.tabId) === port) {
                this.activeConnections.delete(binding.tabId);
            }
            const windowPorts = this.activeConnectionsByWindow.get(
                binding.windowId
            );
            windowPorts?.delete(port);
            if (windowPorts?.size === 0) {
                this.activeConnectionsByWindow.delete(binding.windowId);
            }
            const claim = this.registrationClaimsByTab.get(binding.tabId);
            if (
                claim?.port === port &&
                claim.registrationEpoch === binding.registrationEpoch &&
                claim.registrationId === binding.registrationId
            ) {
                this.registrationClaimsByTab.delete(binding.tabId);
            }
            const portClaim = this.registrationClaimByPort.get(port);
            if (
                portClaim?.registrationEpoch === binding.registrationEpoch &&
                portClaim?.registrationId === binding.registrationId
            ) {
                this.registrationClaimByPort.delete(port);
            }
            this.bindingByPort.delete(port);
        }

        for (const [tabId, mappedPort] of this.activeConnections) {
            if (mappedPort === port) {
                this.activeConnections.delete(tabId);
            }
        }
        for (const [windowId, ports] of this.activeConnectionsByWindow) {
            ports.delete(port);
            if (ports.size === 0) {
                this.activeConnectionsByWindow.delete(windowId);
            }
        }
    }

    /**
     * Initialize the side panel service
     */
    async initialize(serviceReadiness = null) {
        this.registerListeners(serviceReadiness);

        if (this.initialized) {
            return;
        }

        try {
            this.logger.info('Initializing Side Panel Service');

            // Check if Side Panel API is available (Chrome 116+ for programmatic open)
            if (typeof chrome.sidePanel === 'undefined') {
                this.logger.warn(
                    'Side Panel API not available (Chrome 116+ required)'
                );
                this.initialized = false;
                return;
            }

            try {
                await this.refreshBehaviorConfig();
            } catch (error) {
                this.logger.warn(
                    'Failed to load side panel behavior; using schema defaults',
                    { error: error.message }
                );
            }
            if (!this.configUnsubscribe) {
                this.configUnsubscribe = configService.onChanged((changes) => {
                    this.applyBehaviorConfig(changes);
                });
            }

            this.initialized = true;
            this.logger.info('Side Panel Service initialized successfully');
        } catch (error) {
            this.logger.error('Failed to initialize Side Panel Service', error);
            throw error;
        }
    }

    destroy() {
        this.removeListeners();
        if (this.configUnsubscribe) {
            this.configUnsubscribe();
            this.configUnsubscribe = null;
        }
        const portsToRevoke = new Set([
            ...this.connectedPorts,
            ...this.bindingByPort.keys(),
        ]);
        for (const port of portsToRevoke) {
            this.revokePort(port);
        }
        this.connectedPorts.clear();
        this.activeConnections.clear();
        this.activeConnectionsByWindow.clear();
        this.bindingByPort.clear();
        this.registrationClaimsByTab.clear();
        this.registrationClaimByPort.clear();
        this.activeTabAuthorityByWindow.clear();
        this.selectionOwnersByTab.clear();
        this.selectionInvalidationEpochByTab.clear();
        this.selectionRemovalFlightsByPort.clear();
        this.initialized = false;
    }

    /**
     * Handle new connection from side panel
     */
    handleSidePanelConnection(port) {
        let disconnected = false;
        let messageQueue = Promise.resolve();
        const connectionEpoch = this.nextAuthorizationEpoch();
        const isDisconnected = () =>
            disconnected || this.revokedPorts.has(port);

        this.connectedPorts.add(port);

        const rejectConnection = () => {
            if (isDisconnected()) return;
            disconnected = true;
            this.logger.warn('Rejected unauthorized side panel message');
            this.revokePort(port);
        };

        // Handle messages from side panel
        port.onMessage.addListener((message) => {
            const registrationReceiptEpoch = this.nextAuthorizationEpoch();
            const registration = parseSidePanelRegistrationMessage(message);
            const action = getOwnDataProperty(message, 'action');
            if (registration) {
                const claim = this.recordRegistrationClaim(
                    port,
                    registration,
                    connectionEpoch,
                    registrationReceiptEpoch
                );
                const precedingMessages = messageQueue;
                messageQueue = precedingMessages.then(() =>
                    this.runAfterReady(async () => {
                        if (isDisconnected()) return;
                        const result = await this.registerPort(
                            port,
                            isDisconnected,
                            claim
                        );
                        if (
                            result === REGISTRATION_RESULT.INVALID &&
                            !isDisconnected()
                        ) {
                            rejectConnection();
                        } else if (
                            result === REGISTRATION_RESULT.SUPERSEDED &&
                            !isDisconnected()
                        ) {
                            const latestPortClaim = claim
                                ? this.registrationClaimByPort.get(port)
                                : null;
                            const latestClaim = claim
                                ? this.registrationClaimsByTab.get(claim.tabId)
                                : null;
                            const portHasNewerClaim = Boolean(
                                latestPortClaim?.port === port &&
                                latestPortClaim?.connectionEpoch ===
                                    claim?.connectionEpoch &&
                                latestPortClaim?.registrationEpoch >
                                    claim?.registrationEpoch
                            );
                            if (
                                !portHasNewerClaim &&
                                latestClaim?.port !== port &&
                                latestClaim?.registrationEpoch >
                                    claim?.registrationEpoch
                            ) {
                                this.revokePort(port);
                            }
                        }
                    }, 'message handling')
                );
                return;
            }

            if (action !== MessageActions.SIDEPANEL_UPDATE_STATE) {
                rejectConnection();
                return;
            }

            const removal =
                parseSidePanelSelectionRemovalRequestMessage(message);
            if (!removal) {
                rejectConnection();
                return;
            }
            const reservation = this.reserveSelectionRemovalFlight(
                port,
                removal
            );
            if (reservation.status === 'duplicate') return;
            if (reservation.status === 'busy') {
                const binding = this.captureSelectionRemovalBinding(
                    port,
                    removal
                );
                if (
                    !binding ||
                    !this.postSelectionRemovalResult(
                        port,
                        binding,
                        removal,
                        'rejected'
                    )
                ) {
                    this.revokePort(port);
                }
                return;
            }

            const removalFlight = reservation.flight;
            const precedingMessages = messageQueue;
            messageQueue = precedingMessages.then(() =>
                this.runAfterReady(async () => {
                    if (isDisconnected()) return;
                    try {
                        await this.handleSelectionRemoval(
                            port,
                            isDisconnected,
                            removalFlight
                        );
                    } finally {
                        this.releaseSelectionRemovalFlight(port, removalFlight);
                    }
                }, 'message handling')
            );
        });

        // Handle disconnection
        port.onDisconnect.addListener(() => {
            disconnected = true;
            this.revokedPorts.add(port);
            this.connectedPorts.delete(port);
            this.unbindPort(port);
            this.clearPortRegistrationClaims(port);
            this.logger.info('Side panel disconnected');
        });
    }

    async registerPort(port, isDisconnected, claim) {
        if (!claim) {
            return REGISTRATION_RESULT.INVALID;
        }
        const { registrationId, tabId, windowId } = claim;

        if (
            isDisconnected() ||
            !this.isCurrentRegistrationClaim(claim) ||
            !this.isRegistrationClaimActive(claim)
        ) {
            return REGISTRATION_RESULT.SUPERSEDED;
        }

        let tab;
        try {
            tab = await chrome.tabs.get(tabId);
        } catch (_) {
            return isDisconnected() ||
                !this.isCurrentRegistrationClaim(claim) ||
                !this.isRegistrationClaimActive(claim)
                ? REGISTRATION_RESULT.SUPERSEDED
                : REGISTRATION_RESULT.INVALID;
        }

        if (
            isDisconnected() ||
            !this.isCurrentRegistrationClaim(claim) ||
            !this.isRegistrationClaimActive(claim)
        ) {
            return REGISTRATION_RESULT.SUPERSEDED;
        }
        if (
            tab?.id !== tabId ||
            tab?.windowId !== windowId ||
            tab?.active !== true
        ) {
            return REGISTRATION_RESULT.INVALID;
        }

        this.establishBaselineActiveTab(claim);
        if (
            isDisconnected() ||
            !this.isCurrentRegistrationClaim(claim) ||
            !this.isRegistrationClaimActive(claim)
        ) {
            return REGISTRATION_RESULT.SUPERSEDED;
        }

        if (!this.bindPort(port, claim)) {
            return REGISTRATION_RESULT.SUPERSEDED;
        }
        if (isDisconnected()) {
            this.unbindPort(port);
            return REGISTRATION_RESULT.SUPERSEDED;
        }

        if (
            !this.isCurrentPortBinding(
                port,
                tabId,
                windowId,
                claim.registrationEpoch,
                registrationId,
                false
            )
        ) {
            this.clearExactRegistration(port, claim);
            return REGISTRATION_RESULT.SUPERSEDED;
        }

        try {
            port.postMessage(
                buildSidePanelBindingConfirmationMessage({
                    registrationId,
                    tabId,
                    windowId,
                })
            );
        } catch (_) {
            this.logger.error('Failed to confirm side panel registration');
            this.clearExactRegistration(port, claim);
            return REGISTRATION_RESULT.SUPERSEDED;
        }

        if (
            !this.isCurrentPortBinding(
                port,
                tabId,
                windowId,
                claim.registrationEpoch,
                registrationId,
                false
            )
        ) {
            this.clearExactRegistration(port, claim);
            return REGISTRATION_RESULT.SUPERSEDED;
        }

        const binding = this.bindingByPort.get(port);
        if (!this.isSameRegistration(binding, claim)) {
            this.clearExactRegistration(port, claim);
            return REGISTRATION_RESULT.SUPERSEDED;
        }
        binding.confirmed = true;
        binding.selectionSynchronizationPending = true;
        if (
            !this.isCurrentPortBinding(
                port,
                tabId,
                windowId,
                claim.registrationEpoch,
                registrationId
            )
        ) {
            this.clearExactRegistration(port, claim);
            return REGISTRATION_RESULT.SUPERSEDED;
        }

        const synchronized = await this.synchronizeRegisteredPort(
            port,
            tabId,
            windowId,
            isDisconnected,
            claim
        );
        if (!synchronized) {
            this.revokeExactPortBinding(port, claim);
            return REGISTRATION_RESULT.SUPERSEDED;
        }

        const synchronizedBinding = this.bindingByPort.get(port);
        if (
            !this.isSameRegistration(synchronizedBinding, claim) ||
            !this.isCurrentPortBinding(
                port,
                tabId,
                windowId,
                claim.registrationEpoch,
                registrationId
            )
        ) {
            this.clearExactRegistration(port, claim);
            return REGISTRATION_RESULT.SUPERSEDED;
        }
        synchronizedBinding.selectionSynchronizationPending = false;

        return REGISTRATION_RESULT.REGISTERED;
    }

    isCurrentPortBinding(
        port,
        tabId,
        windowId,
        registrationEpoch = null,
        registrationId = null,
        requireConfirmed = true
    ) {
        const binding = this.bindingByPort.get(port);
        const claim = this.registrationClaimsByTab.get(tabId);
        const currentClaimForPort = this.registrationClaimByPort.get(port);
        const activeAuthority = this.activeTabAuthorityByWindow.get(windowId);
        const currentTabLifecycleEpoch =
            this.tabLifecycleEpochByTab.get(tabId) ?? 0;
        return Boolean(
            binding?.tabId === tabId &&
            binding?.windowId === windowId &&
            (!requireConfirmed || binding.confirmed === true) &&
            (registrationEpoch == null ||
                binding.registrationEpoch === registrationEpoch) &&
            (registrationId == null ||
                binding.registrationId === registrationId) &&
            claim?.port === port &&
            claim?.connectionEpoch === binding.connectionEpoch &&
            claim?.registrationId === binding.registrationId &&
            claim?.registrationEpoch === binding.registrationEpoch &&
            currentClaimForPort?.connectionEpoch === binding.connectionEpoch &&
            currentClaimForPort?.registrationId === binding.registrationId &&
            currentClaimForPort?.registrationEpoch ===
                binding.registrationEpoch &&
            currentClaimForPort?.tabId === tabId &&
            activeAuthority?.tabId === tabId &&
            activeAuthority?.activationEpoch === binding.activationEpoch &&
            binding.tabLifecycleEpoch === currentTabLifecycleEpoch &&
            claim?.tabLifecycleEpoch === currentTabLifecycleEpoch &&
            this.activeConnections.get(tabId) === port &&
            this.activeConnectionsByWindow.get(windowId)?.has(port) &&
            this.connectedPorts.has(port) &&
            !this.revokedPorts.has(port)
        );
    }

    async synchronizeRegisteredPort(
        port,
        tabId,
        windowId,
        isDisconnected,
        claim
    ) {
        const ownsBinding = () =>
            !isDisconnected() &&
            this.isCurrentPortBinding(
                port,
                tabId,
                windowId,
                claim.registrationEpoch,
                claim.registrationId
            );
        if (!ownsBinding()) return false;
        const binding = Object.freeze({
            registrationId: claim.registrationId,
            tabId,
            windowId,
        });
        try {
            port.postMessage(
                buildSidePanelSelectionStateMessage(binding, null)
            );
            if (!ownsBinding()) return false;
        } catch (_) {
            this.logger.error('Failed to synchronize registered side panel');
            return false;
        }

        if (!ownsBinding()) return false;
        const ownerAtRequest = this.selectionOwnersByTab.get(tabId);
        const capturedOwner =
            ownerAtRequest?.windowId === windowId ? ownerAtRequest : null;
        if (!ownsBinding()) return false;

        const requestId = this.nextSelectionRepublishRequestId();
        if (!requestId) return ownsBinding();
        const request =
            buildSidePanelSelectionRepublishRequestMessage(requestId);
        const capturedReceiptEpoch = this.selectionReceiptEpoch;
        const capturedInvalidationEpoch =
            this.selectionInvalidationEpochByTab.get(tabId) ?? 0;
        let response;
        try {
            if (!ownsBinding()) return false;
            const target = capturedOwner
                ? { documentId: capturedOwner.documentId, frameId: 0 }
                : { frameId: 0 };
            response = await chrome.tabs.sendMessage(tabId, request, target);
        } catch (_) {
            return ownsBinding();
        }

        if (!ownsBinding()) return false;
        if (!parseSidePanelSelectionRepublishAck(response, request.data)) {
            return ownsBinding();
        }
        const currentOwner = this.selectionOwnersByTab.get(tabId);
        if (!ownsBinding()) return false;
        if (
            !currentOwner ||
            currentOwner.tabId !== tabId ||
            currentOwner.windowId !== windowId ||
            currentOwner.acceptedReceiptEpoch <= capturedReceiptEpoch ||
            (this.selectionInvalidationEpochByTab.get(tabId) ?? 0) !==
                capturedInvalidationEpoch ||
            (capturedOwner &&
                !this.selectionOwnerIdentityEquals(currentOwner, capturedOwner))
        ) {
            return ownsBinding();
        }

        try {
            if (!ownsBinding()) return false;
            if (
                !this.selectionOwnerStateEquals(
                    this.selectionOwnersByTab.get(tabId),
                    currentOwner
                )
            ) {
                return ownsBinding();
            }
            port.postMessage(
                buildSidePanelSelectionStateMessage(
                    binding,
                    this.projectSelectionOwner(currentOwner)
                )
            );
            if (!ownsBinding()) return false;
            if (
                !this.selectionOwnerStateEquals(
                    this.selectionOwnersByTab.get(tabId),
                    currentOwner
                )
            ) {
                this.projectSelectionNull(tabId);
            }
        } catch (_) {
            return false;
        }

        return ownsBinding();
    }

    /**
     * Open side panel for a specific tab
     */
    async openSidePanel(tabId, options = {}) {
        try {
            await this.refreshBehaviorConfig();
            return await this.openSidePanelImmediate(tabId, options);
        } catch (error) {
            this.logger.error('Failed to open side panel', error, { tabId });
            return { success: false, error: error.message };
        }
    }

    /**
     * Open side panel immediately (attempt to preserve user gesture)
     */
    async openSidePanelImmediate(tabId, options = {}) {
        try {
            const config = this.behaviorConfig;
            if (!config.sidePanelUseSidePanel) {
                this.logger.debug('Side panel disabled in settings');
                return { success: false, reason: 'disabled' };
            }

            const shouldAutoOpen = options.autoOpen ?? config.sidePanelAutoOpen;
            const shouldOpen = shouldAutoOpen || options.force === true;
            if (shouldOpen) {
                // Check API availability only when this gesture is meant to open it.
                if (typeof chrome.sidePanel?.open !== 'function') {
                    this.logger.warn('Side Panel API not available');
                    return { success: false, reason: 'api-unavailable' };
                }

                // Attempt to open immediately without awaiting settings to preserve user gesture
                await chrome.sidePanel.open({ tabId });
                this.logger.info('Side panel opened (immediate)', { tabId });

                // Notify any existing side panel in the same window to switch binding
                // This ensures the UI updates to the target tab even if 'follow active tab' is disabled
                try {
                    const tab = await chrome.tabs.get(tabId);
                    const resolvedTabId = getOwnDataProperty(tab, 'id');
                    const windowId = getOwnDataProperty(tab, 'windowId');
                    const isActive = getOwnDataProperty(tab, 'active');
                    const authority =
                        this.activeTabAuthorityByWindow.get(windowId);
                    if (
                        resolvedTabId === tabId &&
                        isActive === true &&
                        Number.isSafeInteger(windowId) &&
                        windowId >= 0 &&
                        authority?.tabId === tabId &&
                        this.isCurrentWindowActivation(authority)
                    ) {
                        const winMap =
                            this.activeConnectionsByWindow.get(windowId);
                        if (winMap) {
                            for (const port of winMap.values()) {
                                if (
                                    !this.isCurrentWindowActivation(authority)
                                ) {
                                    break;
                                }
                                try {
                                    port.postMessage(
                                        buildSidePanelForceBindTabMessage({
                                            tabId,
                                            windowId,
                                        })
                                    );
                                } catch (_) {}
                            }
                        }
                    }
                } catch (bindingError) {
                    this.logger.warn('Failed to force bind side panel', {
                        error: bindingError.message,
                        tabId,
                    });
                }
            } else {
                this.logger.debug('Auto-open disabled; route retained');
            }

            // Apply requested options without config wait
            const shouldPause = Boolean(
                options.pauseVideo ?? config.sidePanelAutoPauseVideo
            );
            let pauseSucceeded = null;
            if (shouldPause) {
                try {
                    pauseSucceeded = (await this.pauseVideo(tabId)) === true;
                } catch (pauseError) {
                    pauseSucceeded = false;
                    this.logger.error(
                        'Unexpected video pause failure after word intent',
                        pauseError,
                        { tabId }
                    );
                }
            }

            return {
                success: true,
                pauseRequested: shouldPause,
                pauseSucceeded,
            };
        } catch (error) {
            this.logger.error('Failed to open side panel (immediate)', error, {
                tabId,
            });
            return { success: false, error: error.message };
        }
    }

    /**
     * Pause video in the tab
     */
    async pauseVideo(tabId) {
        try {
            const request = buildSidePanelPauseVideoRequestMessage();
            const response = await chrome.tabs.sendMessage(tabId, request);
            const parsedResponse = parseContentControlResponseMessage(
                response,
                request
            );

            const pauseSucceeded = parsedResponse?.success === true;
            this.logger.debug('Video pause command completed', {
                tabId,
                pauseSucceeded,
            });
            return pauseSucceeded;
        } catch (error) {
            this.logger.error('Failed to pause video', error, { tabId });
            return false;
        }
    }

    /**
     * Handle tab activation
     */
    handleTabActivated(
        activeInfo,
        recordedAuthority = null,
        portsAtActivation = new Set()
    ) {
        const authority =
            recordedAuthority ?? this.recordWindowActivation(activeInfo);
        if (!this.isCurrentWindowActivation(authority)) return;

        const { tabId, windowId } = authority;
        this.logger.debug('Tab activated', { tabId, windowId });

        // Side panels are window-scoped. A tab activation must never rebind a
        // panel that belongs to another browser window.
        if (typeof windowId === 'number') {
            const ports = new Set([
                ...(this.activeConnectionsByWindow.get(windowId) ?? []),
                ...portsAtActivation,
            ]);
            for (const port of ports) {
                if (!this.isCurrentWindowActivation(authority)) return;
                const currentPortWindow =
                    this.registrationClaimByPort.get(port)?.windowId ??
                    this.bindingByPort.get(port)?.windowId;
                if (
                    !this.connectedPorts.has(port) ||
                    this.revokedPorts.has(port) ||
                    (currentPortWindow != null &&
                        currentPortWindow !== windowId)
                ) {
                    continue;
                }
                try {
                    port.postMessage(
                        buildSidePanelTabActivatedMessage({ tabId, windowId })
                    );
                    if (!this.isCurrentWindowActivation(authority)) return;
                } catch (error) {
                    this.logger.warn(
                        'Failed to notify a side panel of tab activation',
                        {
                            error: error.message,
                        }
                    );
                }
            }
        }
    }

    /**
     * Handle tab removal
     */
    handleTabRemoved(tabId, recordedRemoval = null) {
        const removal = recordedRemoval ?? this.recordTabRemoval(tabId);
        if (!removal) return;

        this.logger.debug('Tab removed', { tabId });
        const predatesRemoval = (tabLifecycleEpoch) =>
            (tabLifecycleEpoch ?? 0) < removal.tabLifecycleEpoch;
        const portsToRevoke = new Set();
        const portsToUnbind = new Set();
        const registrationClaim = this.registrationClaimsByTab.get(tabId);
        if (
            registrationClaim?.port &&
            predatesRemoval(registrationClaim.tabLifecycleEpoch)
        ) {
            portsToRevoke.add(registrationClaim.port);
        }
        for (const [port, binding] of this.bindingByPort) {
            if (
                binding.tabId === tabId &&
                predatesRemoval(binding.tabLifecycleEpoch)
            ) {
                const latestClaim = this.registrationClaimByPort.get(port);
                const supersedesRemovedBinding = Boolean(
                    latestClaim?.registrationEpoch >
                        binding.registrationEpoch &&
                    (latestClaim.tabId !== tabId ||
                        !predatesRemoval(latestClaim.tabLifecycleEpoch))
                );
                if (supersedesRemovedBinding) {
                    portsToUnbind.add(port);
                } else {
                    portsToRevoke.add(port);
                }
            }
        }
        for (const port of portsToUnbind) {
            this.unbindPort(port);
        }
        for (const port of portsToRevoke) {
            this.revokePort(port);
        }
        const remainingClaim = this.registrationClaimsByTab.get(tabId);
        if (
            remainingClaim &&
            predatesRemoval(remainingClaim.tabLifecycleEpoch)
        ) {
            this.registrationClaimsByTab.delete(tabId);
        }
        const mappedPort = this.activeConnections.get(tabId);
        const mappedBinding = mappedPort
            ? this.bindingByPort.get(mappedPort)
            : null;
        if (
            !mappedBinding ||
            predatesRemoval(mappedBinding.tabLifecycleEpoch)
        ) {
            this.activeConnections.delete(tabId);
        }
    }

    /**
     * Check if side panel is supported
     */
    isSidePanelSupported() {
        return typeof chrome.sidePanel !== 'undefined';
    }
}

// Create and export singleton instance
export const sidePanelService = new SidePanelService();
