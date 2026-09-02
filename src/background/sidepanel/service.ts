import { browser } from 'wxt/browser';
import { createLogger } from '@/shared/logger';
import { MessageActions } from '@/messaging/actions';
import {
    MessagingError,
    MessagingFailureClass,
    sendToTab,
} from '@/messaging/client';
import { framePort, type FramedPort, type PortLike } from '@/messaging/port';
import { sidePanelPauseVideo } from '@/messaging/contracts/control';
import {
    selectionRemovalCommand,
    selectionRepublishRequest,
    type ContentSelectionSnapshot,
    type SelectionEntry,
    type SelectionState,
} from '@/messaging/contracts/selection';
import {
    backgroundToPanel,
    panelToBackground,
    type BackgroundToPanelFrame,
    type PanelToBackgroundFrame,
    type SidePanelBinding,
} from '@/messaging/contracts/sidepanelPort';
import type { ClassifiedContentSender } from '@/messaging/sender';

type RemovalRequest = Extract<
    PanelToBackgroundFrame,
    { action: typeof MessageActions.SIDEPANEL_UPDATE_STATE }
>['data'];

type RemovalStatus = 'applied' | 'rejected';

/** One panel port for its whole lifetime; revoked ports never come back. */
interface Connection {
    port: FramedPort<BackgroundToPanelFrame>;
    readonly connectionEpoch: number;
    revoked: boolean;
    queue: Promise<void>;
}

interface WindowActivation {
    readonly activationEpoch: number;
    readonly tabId: number;
    readonly windowId: number;
}

/** A panel's claim to a tab, recorded at receipt so later verification can
 *  tell whether anything superseded it meanwhile. */
interface RegistrationClaim {
    readonly activationEpoch: number;
    readonly activeTabId: number | null;
    readonly connection: Connection;
    readonly connectionEpoch: number;
    readonly registrationId: number;
    readonly registrationEpoch: number;
    readonly tabId: number;
    readonly tabLifecycleEpoch: number;
    readonly windowId: number;
}

interface Binding {
    readonly activationEpoch: number;
    confirmed: boolean;
    readonly connectionEpoch: number;
    readonly registrationId: number;
    readonly registrationEpoch: number;
    selectionSynchronizationPending: boolean;
    readonly tabId: number;
    readonly tabLifecycleEpoch: number;
    readonly windowId: number;
}

type Registration = Pick<
    Binding,
    | 'connectionEpoch'
    | 'registrationEpoch'
    | 'registrationId'
    | 'tabId'
    | 'windowId'
>;

/** The authoritative selection of one content document, as last accepted. */
interface SelectionOwner {
    readonly tabId: number;
    readonly windowId: number;
    readonly documentId: string;
    readonly lifecycleGeneration: number;
    readonly selectionOwnerGeneration: number;
    readonly selectionRevision: number;
    readonly renderRevision: number;
    readonly reason: SelectionState['reason'];
    readonly entries: readonly SelectionEntry[];
    readonly acceptedReceiptEpoch: number;
}

interface RemovalFlight {
    readonly removal: RemovalRequest;
}

export type RegistrationResult = 'invalid' | 'registered' | 'superseded';

export interface WordIntentOptions {
    readonly autoOpen: boolean;
    readonly pauseVideo: boolean;
}

export interface SidePanelServiceDeps {
    readonly tabs: {
        get(tabId: number): Promise<{
            id?: number;
            windowId?: number;
            active?: boolean;
        }>;
    };
    /** null when the browser has no programmatic side panel API. */
    readonly sidePanel: {
        open(options: { tabId: number }): Promise<void>;
    } | null;
    readonly sendToTab: typeof sendToTab;
}

export function browserSidePanelDeps(): SidePanelServiceDeps {
    const sidePanel = browser.sidePanel as
        { open?: (options: { tabId: number }) => Promise<void> } | undefined;
    return {
        tabs: { get: (tabId) => browser.tabs.get(tabId) },
        sidePanel:
            typeof sidePanel?.open === 'function'
                ? { open: (options) => browser.sidePanel.open(options) }
                : null,
        sendToTab,
    };
}

function entriesEqual(
    left: readonly SelectionEntry[],
    right: readonly SelectionEntry[]
): boolean {
    return (
        left.length === right.length &&
        left.every(
            (entry, index) =>
                entry.wordIndex === right[index]!.wordIndex &&
                entry.word === right[index]!.word
        )
    );
}

function projectOwner(owner: SelectionOwner): SelectionState {
    return {
        selectionOwnerGeneration: owner.selectionOwnerGeneration,
        selectionRevision: owner.selectionRevision,
        renderRevision: owner.renderRevision,
        reason: owner.reason,
        entries: [...owner.entries],
    };
}

/**
 * Background authority for side panels. A panel binds to exactly one tab
 * (verified active in its window), receives that tab's content selection
 * as the content script publishes it, and may ask for one occurrence to be
 * removed — which content applies and republishes before the panel hears
 * "applied". Every async step re-verifies the binding it started with, so
 * a superseded registration, a closed tab, or a navigated document can
 * never leak another tab's state into a panel.
 */
export class SidePanelService {
    private readonly logger = createLogger('SidePanelService');
    private readonly connections = new Set<Connection>();
    private readonly bindingByConnection = new Map<Connection, Binding>();
    private readonly connectionByTab = new Map<number, Connection>();
    private readonly connectionsByWindow = new Map<number, Set<Connection>>();
    private readonly claimsByTab = new Map<number, RegistrationClaim>();
    private readonly claimByConnection = new Map<
        Connection,
        RegistrationClaim
    >();
    private readonly activationByWindow = new Map<number, WindowActivation>();
    private readonly tabLifecycleEpochByTab = new Map<number, number>();
    private readonly selectionOwnersByTab = new Map<number, SelectionOwner>();
    private readonly selectionInvalidationEpochByTab = new Map<
        number,
        number
    >();
    private readonly removalFlights = new Map<Connection, RemovalFlight>();
    private authorizationEpoch = 0;
    private selectionOwnerGeneration = 0;
    private selectionReceiptEpoch = 0;
    private republishRequestId = 0;

    constructor(private readonly deps: SidePanelServiceDeps) {}

    // ------------------------------------------------------------ counters

    private nextAuthorizationEpoch(): number {
        this.authorizationEpoch += 1;
        return this.authorizationEpoch;
    }

    private nextSelectionOwnerGeneration(): number | null {
        if (this.selectionOwnerGeneration >= Number.MAX_SAFE_INTEGER) {
            return null;
        }
        this.selectionOwnerGeneration += 1;
        return this.selectionOwnerGeneration;
    }

    private nextSelectionReceiptEpoch(): number | null {
        if (this.selectionReceiptEpoch >= Number.MAX_SAFE_INTEGER) {
            return null;
        }
        this.selectionReceiptEpoch += 1;
        return this.selectionReceiptEpoch;
    }

    private nextRepublishRequestId(): number | null {
        if (this.republishRequestId >= Number.MAX_SAFE_INTEGER) {
            return null;
        }
        this.republishRequestId += 1;
        return this.republishRequestId;
    }

    // --------------------------------------------------------- connections

    /** Adopt a trusted side-panel port. Trust is the caller's job. */
    handleConnect(rawPort: PortLike): void {
        const connection: Connection = {
            port: null as unknown as FramedPort<BackgroundToPanelFrame>,
            connectionEpoch: this.nextAuthorizationEpoch(),
            revoked: false,
            queue: Promise.resolve(),
        };
        connection.port = framePort(rawPort, {
            inbound: panelToBackground,
            outbound: backgroundToPanel,
            onFrame: (frame) => this.onPanelFrame(connection, frame),
            onDisconnect: () => this.onPanelDisconnect(connection),
        });
        this.connections.add(connection);
    }

    private onPanelFrame(
        connection: Connection,
        frame: PanelToBackgroundFrame
    ): void {
        if (frame.action === MessageActions.SIDEPANEL_REGISTER) {
            const claim = this.recordRegistrationClaim(
                connection,
                frame.data,
                this.nextAuthorizationEpoch()
            );
            this.enqueue(connection, async () => {
                if (connection.revoked) {
                    return;
                }
                const result = await this.registerPort(connection, claim);
                if (result === 'invalid' && !connection.revoked) {
                    this.logger.warn(
                        'Rejected an invalid side panel registration'
                    );
                    this.revoke(connection);
                } else if (result === 'superseded' && !connection.revoked) {
                    this.dropSupersededConnection(connection, claim);
                }
            });
            return;
        }

        const removal = frame.data;
        const existing = this.removalFlights.get(connection);
        if (existing) {
            if (removalRequestsEqual(existing.removal, removal)) {
                return;
            }
            const binding = this.captureRemovalBinding(connection, removal);
            if (
                !binding ||
                !this.postRemovalResult(
                    connection,
                    binding,
                    removal,
                    'rejected'
                )
            ) {
                this.revoke(connection);
            }
            return;
        }
        const flight: RemovalFlight = { removal };
        this.removalFlights.set(connection, flight);
        this.enqueue(connection, async () => {
            if (connection.revoked) {
                return;
            }
            try {
                await this.handleRemoval(connection, flight);
            } finally {
                if (this.removalFlights.get(connection) === flight) {
                    this.removalFlights.delete(connection);
                }
            }
        });
    }

    /** Frames from one panel are handled strictly in order. */
    private enqueue(connection: Connection, work: () => Promise<void>): void {
        connection.queue = connection.queue.then(async () => {
            try {
                await work();
            } catch (error) {
                this.logger.error('Side panel message handling failed', error);
            }
        });
    }

    /** A claim lost the race to a newer one. It only costs the port its
     *  connection when another port now owns the tab. */
    private dropSupersededConnection(
        connection: Connection,
        claim: RegistrationClaim | null
    ): void {
        if (!claim) {
            return;
        }
        const latestForConnection = this.claimByConnection.get(connection);
        const latestForTab = this.claimsByTab.get(claim.tabId);
        const connectionHasNewerClaim = Boolean(
            latestForConnection &&
            latestForConnection.connectionEpoch === claim.connectionEpoch &&
            latestForConnection.registrationEpoch > claim.registrationEpoch
        );
        if (
            !connectionHasNewerClaim &&
            latestForTab &&
            latestForTab.connection !== connection &&
            latestForTab.registrationEpoch > claim.registrationEpoch
        ) {
            this.revoke(connection);
        }
    }

    private onPanelDisconnect(connection: Connection): void {
        connection.revoked = true;
        this.connections.delete(connection);
        this.unbind(connection);
        this.clearConnectionClaims(connection);
        this.logger.info('Side panel disconnected');
    }

    private revoke(connection: Connection): void {
        connection.revoked = true;
        this.connections.delete(connection);
        this.unbind(connection);
        this.clearConnectionClaims(connection);
        try {
            connection.port.disconnect();
        } catch {
            // The browser may already have retired the port.
        }
    }

    private post(
        connection: Connection,
        frame: BackgroundToPanelFrame
    ): boolean {
        try {
            connection.port.post(frame);
            return true;
        } catch {
            return false;
        }
    }

    // -------------------------------------------------------- registration

    private recordRegistrationClaim(
        connection: Connection,
        registration: SidePanelBinding,
        registrationEpoch: number
    ): RegistrationClaim | null {
        if (!this.connections.has(connection) || connection.revoked) {
            return null;
        }
        const activation = this.activationByWindow.get(registration.windowId);
        const claim: RegistrationClaim = {
            activationEpoch: activation?.activationEpoch ?? 0,
            activeTabId: activation?.tabId ?? null,
            connection,
            connectionEpoch: connection.connectionEpoch,
            registrationId: registration.registrationId,
            registrationEpoch,
            tabId: registration.tabId,
            tabLifecycleEpoch:
                this.tabLifecycleEpochByTab.get(registration.tabId) ?? 0,
            windowId: registration.windowId,
        };

        const newerForConnection = this.claimByConnection.get(connection);
        const newerForTab = this.claimsByTab.get(registration.tabId);
        if (
            (newerForConnection &&
                newerForConnection.registrationEpoch > registrationEpoch) ||
            (newerForTab && newerForTab.registrationEpoch > registrationEpoch)
        ) {
            return claim;
        }
        for (const [claimedTabId, existing] of this.claimsByTab) {
            if (existing.connection === connection) {
                this.claimsByTab.delete(claimedTabId);
            }
        }
        this.claimsByTab.set(registration.tabId, claim);
        this.claimByConnection.set(connection, claim);
        return claim;
    }

    private isClaimActive(claim: RegistrationClaim): boolean {
        const current = this.activationByWindow.get(claim.windowId);
        if (!current) {
            return claim.activationEpoch === 0 && claim.activeTabId === null;
        }
        return (
            current.activationEpoch === claim.activationEpoch &&
            current.tabId === claim.tabId &&
            (claim.activeTabId === null || claim.activeTabId === claim.tabId)
        );
    }

    /** A window we have never seen activate: the verified tab becomes its
     *  baseline active tab so later checks have something to compare. */
    private establishBaselineActiveTab(claim: RegistrationClaim): void {
        if (claim.activationEpoch !== 0 || claim.activeTabId !== null) {
            return;
        }
        if (!this.activationByWindow.has(claim.windowId)) {
            this.activationByWindow.set(claim.windowId, {
                activationEpoch: 0,
                tabId: claim.tabId,
                windowId: claim.windowId,
            });
        }
    }

    private isCurrentClaim(claim: RegistrationClaim): boolean {
        if (claim.connection.revoked) {
            return false;
        }
        const current = this.claimsByTab.get(claim.tabId);
        const currentForConnection = this.claimByConnection.get(
            claim.connection
        );
        return Boolean(
            current &&
            current.connection === claim.connection &&
            current.connectionEpoch === claim.connectionEpoch &&
            current.registrationId === claim.registrationId &&
            current.registrationEpoch === claim.registrationEpoch &&
            current.windowId === claim.windowId &&
            currentForConnection &&
            currentForConnection.registrationEpoch ===
                claim.registrationEpoch &&
            currentForConnection.registrationId === claim.registrationId &&
            currentForConnection.tabId === claim.tabId &&
            (this.tabLifecycleEpochByTab.get(claim.tabId) ?? 0) ===
                claim.tabLifecycleEpoch
        );
    }

    private async registerPort(
        connection: Connection,
        claim: RegistrationClaim | null
    ): Promise<RegistrationResult> {
        if (!claim) {
            return 'invalid';
        }
        const { registrationId, tabId, windowId } = claim;
        const claimStands = () =>
            !connection.revoked &&
            this.isCurrentClaim(claim) &&
            this.isClaimActive(claim);
        if (!claimStands()) {
            return 'superseded';
        }

        let tab: { id?: number; windowId?: number; active?: boolean };
        try {
            tab = await this.deps.tabs.get(tabId);
        } catch {
            return claimStands() ? 'invalid' : 'superseded';
        }
        if (!claimStands()) {
            return 'superseded';
        }
        if (
            tab.id !== tabId ||
            tab.windowId !== windowId ||
            tab.active !== true
        ) {
            return 'invalid';
        }

        this.establishBaselineActiveTab(claim);
        if (!claimStands() || !this.bind(connection, claim)) {
            return 'superseded';
        }
        if (connection.revoked) {
            this.unbind(connection);
            return 'superseded';
        }
        const bindingStands = (requireConfirmed: boolean) =>
            this.isCurrentBinding(
                connection,
                tabId,
                windowId,
                claim.registrationEpoch,
                registrationId,
                requireConfirmed
            );
        if (!bindingStands(false)) {
            this.clearExactRegistration(connection, claim);
            return 'superseded';
        }

        if (
            !this.post(connection, {
                action: MessageActions.SIDEPANEL_BINDING_CONFIRMED,
                data: { registrationId, tabId, windowId },
            })
        ) {
            this.logger.error('Failed to confirm side panel registration');
            this.clearExactRegistration(connection, claim);
            return 'superseded';
        }
        if (!bindingStands(false)) {
            this.clearExactRegistration(connection, claim);
            return 'superseded';
        }

        const binding = this.bindingByConnection.get(connection);
        if (!binding || !sameRegistration(binding, claim)) {
            this.clearExactRegistration(connection, claim);
            return 'superseded';
        }
        binding.confirmed = true;
        binding.selectionSynchronizationPending = true;
        if (!bindingStands(true)) {
            this.clearExactRegistration(connection, claim);
            return 'superseded';
        }

        const synchronized = await this.synchronizeRegisteredPort(
            connection,
            claim
        );
        if (!synchronized) {
            this.revokeExactBinding(connection, claim);
            return 'superseded';
        }
        const synchronizedBinding = this.bindingByConnection.get(connection);
        if (
            !synchronizedBinding ||
            !sameRegistration(synchronizedBinding, claim) ||
            !bindingStands(true)
        ) {
            this.clearExactRegistration(connection, claim);
            return 'superseded';
        }
        synchronizedBinding.selectionSynchronizationPending = false;
        return 'registered';
    }

    /**
     * Confirmed panels start from a bound null state, then content is asked
     * to republish. The republished owner is projected only when it is a
     * fresher receipt than what was known when the request went out, for
     * the same document unless a navigation happened meanwhile, and only
     * while this exact binding still stands. When content has nothing to
     * republish, or the tab provably has no content script, and no
     * snapshot arrived meanwhile, the panel hears a second null: the tab
     * is empty. An ambiguous failure says nothing, and changes nothing.
     */
    private async synchronizeRegisteredPort(
        connection: Connection,
        claim: RegistrationClaim
    ): Promise<boolean> {
        const { tabId, windowId } = claim;
        const ownsBinding = () =>
            !connection.revoked &&
            this.isCurrentBinding(
                connection,
                tabId,
                windowId,
                claim.registrationEpoch,
                claim.registrationId
            );
        if (!ownsBinding()) {
            return false;
        }
        const binding: SidePanelBinding = {
            registrationId: claim.registrationId,
            tabId,
            windowId,
        };
        if (
            !this.post(connection, {
                action: MessageActions.SIDEPANEL_SELECTION_SYNC,
                data: { binding, selection: null },
            })
        ) {
            this.logger.error('Failed to synchronize registered side panel');
            return false;
        }
        if (!ownsBinding()) {
            return false;
        }

        const ownerAtRequest = this.selectionOwnersByTab.get(tabId);
        const capturedOwner =
            ownerAtRequest?.windowId === windowId ? ownerAtRequest : null;
        const requestId = this.nextRepublishRequestId();
        if (requestId === null) {
            return ownsBinding();
        }
        const capturedReceiptEpoch = this.selectionReceiptEpoch;
        const capturedInvalidationEpoch =
            this.selectionInvalidationEpochByTab.get(tabId) ?? 0;

        let accepted: boolean;
        try {
            const response = await this.deps.sendToTab(
                selectionRepublishRequest,
                tabId,
                {
                    action: MessageActions.SIDEPANEL_GET_STATE,
                    data: { requestId },
                },
                capturedOwner
                    ? { documentId: capturedOwner.documentId, frameId: 0 }
                    : { frameId: 0 }
            );
            accepted = response.requestId === requestId && response.accepted;
        } catch (error) {
            if (
                !(error instanceof MessagingError) ||
                error.failureClass !== MessagingFailureClass.PROVEN_NON_DELIVERY
            ) {
                return ownsBinding();
            }
            accepted = false;
        }
        if (!ownsBinding()) {
            return false;
        }

        const currentOwner = this.selectionOwnersByTab.get(tabId);
        const navigated =
            (this.selectionInvalidationEpochByTab.get(tabId) ?? 0) !==
            capturedInvalidationEpoch;
        const republished =
            currentOwner &&
            currentOwner.windowId === windowId &&
            currentOwner.acceptedReceiptEpoch > capturedReceiptEpoch &&
            (navigated ||
                !capturedOwner ||
                ownerIdentityEquals(currentOwner, capturedOwner))
                ? currentOwner
                : null;
        if (!republished) {
            // Acknowledged but not received yet: the replay's own broadcast
            // follows. Not acknowledged: the tab has nothing to show.
            return accepted ? ownsBinding() : this.projectSelectionNull(tabId);
        }
        if (
            !this.post(connection, {
                action: MessageActions.SIDEPANEL_SELECTION_SYNC,
                data: { binding, selection: projectOwner(republished) },
            })
        ) {
            return false;
        }
        if (!ownsBinding()) {
            return false;
        }
        const afterPost = this.selectionOwnersByTab.get(tabId);
        if (!afterPost || !ownerStateEquals(afterPost, republished)) {
            this.projectSelectionNull(tabId);
        }
        return ownsBinding();
    }

    private isCurrentBinding(
        connection: Connection,
        tabId: number,
        windowId: number,
        registrationEpoch: number | null = null,
        registrationId: number | null = null,
        requireConfirmed = true
    ): boolean {
        const binding = this.bindingByConnection.get(connection);
        const claim = this.claimsByTab.get(tabId);
        const claimForConnection = this.claimByConnection.get(connection);
        const activation = this.activationByWindow.get(windowId);
        const tabLifecycleEpoch = this.tabLifecycleEpochByTab.get(tabId) ?? 0;
        return Boolean(
            binding &&
            binding.tabId === tabId &&
            binding.windowId === windowId &&
            (!requireConfirmed || binding.confirmed) &&
            (registrationEpoch === null ||
                binding.registrationEpoch === registrationEpoch) &&
            (registrationId === null ||
                binding.registrationId === registrationId) &&
            claim &&
            claim.connection === connection &&
            claim.connectionEpoch === binding.connectionEpoch &&
            claim.registrationId === binding.registrationId &&
            claim.registrationEpoch === binding.registrationEpoch &&
            claimForConnection &&
            claimForConnection.connectionEpoch === binding.connectionEpoch &&
            claimForConnection.registrationId === binding.registrationId &&
            claimForConnection.registrationEpoch ===
                binding.registrationEpoch &&
            claimForConnection.tabId === tabId &&
            activation &&
            activation.tabId === tabId &&
            activation.activationEpoch === binding.activationEpoch &&
            binding.tabLifecycleEpoch === tabLifecycleEpoch &&
            claim.tabLifecycleEpoch === tabLifecycleEpoch &&
            this.connectionByTab.get(tabId) === connection &&
            this.connectionsByWindow.get(windowId)?.has(connection) &&
            this.connections.has(connection) &&
            !connection.revoked
        );
    }

    private bind(connection: Connection, claim: RegistrationClaim): boolean {
        if (
            claim.connection !== connection ||
            !this.isCurrentClaim(claim) ||
            !this.isClaimActive(claim)
        ) {
            return false;
        }
        const { tabId, windowId } = claim;
        this.unbind(connection);
        const previous = this.connectionByTab.get(tabId);
        if (previous && previous !== connection) {
            this.revoke(previous);
        }
        this.bindingByConnection.set(connection, {
            activationEpoch: claim.activationEpoch,
            confirmed: false,
            connectionEpoch: claim.connectionEpoch,
            registrationId: claim.registrationId,
            registrationEpoch: claim.registrationEpoch,
            selectionSynchronizationPending: false,
            tabId,
            tabLifecycleEpoch: claim.tabLifecycleEpoch,
            windowId,
        });
        this.connectionByTab.set(tabId, connection);
        let windowConnections = this.connectionsByWindow.get(windowId);
        if (!windowConnections) {
            windowConnections = new Set();
            this.connectionsByWindow.set(windowId, windowConnections);
        }
        windowConnections.add(connection);
        return true;
    }

    private unbind(connection: Connection): void {
        this.removalFlights.delete(connection);
        const binding = this.bindingByConnection.get(connection);
        if (binding) {
            if (this.connectionByTab.get(binding.tabId) === connection) {
                this.connectionByTab.delete(binding.tabId);
            }
            this.forgetWindowConnection(binding.windowId, connection);
            const claim = this.claimsByTab.get(binding.tabId);
            if (
                claim &&
                claim.connection === connection &&
                claim.registrationEpoch === binding.registrationEpoch &&
                claim.registrationId === binding.registrationId
            ) {
                this.claimsByTab.delete(binding.tabId);
            }
            const claimForConnection = this.claimByConnection.get(connection);
            if (
                claimForConnection &&
                claimForConnection.registrationEpoch ===
                    binding.registrationEpoch &&
                claimForConnection.registrationId === binding.registrationId
            ) {
                this.claimByConnection.delete(connection);
            }
            this.bindingByConnection.delete(connection);
        }
        for (const [tabId, mapped] of this.connectionByTab) {
            if (mapped === connection) {
                this.connectionByTab.delete(tabId);
            }
        }
        for (const windowId of [...this.connectionsByWindow.keys()]) {
            this.forgetWindowConnection(windowId, connection);
        }
    }

    private forgetWindowConnection(
        windowId: number,
        connection: Connection
    ): void {
        const windowConnections = this.connectionsByWindow.get(windowId);
        if (!windowConnections) {
            return;
        }
        windowConnections.delete(connection);
        if (windowConnections.size === 0) {
            this.connectionsByWindow.delete(windowId);
        }
    }

    private clearConnectionClaims(connection: Connection): void {
        for (const [tabId, claim] of this.claimsByTab) {
            if (claim.connection === connection) {
                this.claimsByTab.delete(tabId);
            }
        }
        this.claimByConnection.delete(connection);
    }

    private clearExactRegistration(
        connection: Connection,
        registration: Registration
    ): void {
        const binding = this.bindingByConnection.get(connection);
        if (binding && sameRegistration(binding, registration)) {
            if (this.connectionByTab.get(binding.tabId) === connection) {
                this.connectionByTab.delete(binding.tabId);
            }
            this.forgetWindowConnection(binding.windowId, connection);
            this.bindingByConnection.delete(connection);
            this.removalFlights.delete(connection);
        }
        const tabClaim = this.claimsByTab.get(registration.tabId);
        if (tabClaim && sameRegistration(tabClaim, registration)) {
            this.claimsByTab.delete(registration.tabId);
        }
        const connectionClaim = this.claimByConnection.get(connection);
        if (
            connectionClaim &&
            sameRegistration(connectionClaim, registration)
        ) {
            this.claimByConnection.delete(connection);
        }
    }

    private revokeExactBinding(
        connection: Connection,
        registration: Registration
    ): boolean {
        const binding = this.bindingByConnection.get(connection);
        if (!binding || !sameRegistration(binding, registration)) {
            return false;
        }
        const connectionClaim = this.claimByConnection.get(connection);
        const tabClaim = this.claimsByTab.get(binding.tabId);
        if (
            !connectionClaim ||
            !sameRegistration(connectionClaim, registration) ||
            !tabClaim ||
            !sameRegistration(tabClaim, registration)
        ) {
            this.clearExactRegistration(connection, registration);
            return false;
        }
        this.revoke(connection);
        return true;
    }

    // ----------------------------------------------------------- selection

    /**
     * Accept a content-authored snapshot. A new owner generation is minted
     * for a new document, a higher content lifecycle, or a window change;
     * within one owner, revisions must advance (an exact replay refreshes
     * the receipt without broadcasting) and render revisions may not go
     * backwards.
     */
    acceptSelectionSnapshot(
        sender: ClassifiedContentSender,
        snapshot: ContentSelectionSnapshot
    ): boolean {
        const current = this.selectionOwnersByTab.get(sender.tabId);
        const changedDocument = Boolean(
            current &&
            (current.windowId !== sender.windowId ||
                current.documentId !== sender.documentId)
        );
        const higherLifecycle = Boolean(
            current &&
            !changedDocument &&
            snapshot.lifecycleGeneration > current.lifecycleGeneration
        );
        const mintsOwner = !current || changedDocument || higherLifecycle;

        if (
            current &&
            !changedDocument &&
            snapshot.lifecycleGeneration < current.lifecycleGeneration
        ) {
            return false;
        }
        if (current && !mintsOwner) {
            if (snapshot.selectionRevision < current.selectionRevision) {
                return false;
            }
            if (snapshot.selectionRevision === current.selectionRevision) {
                if (
                    current.renderRevision !== snapshot.renderRevision ||
                    current.reason !== snapshot.reason ||
                    !entriesEqual(current.entries, snapshot.entries)
                ) {
                    return false;
                }
                const receipt = this.nextSelectionReceiptEpoch();
                if (receipt === null) {
                    return false;
                }
                this.selectionOwnersByTab.set(sender.tabId, {
                    ...current,
                    acceptedReceiptEpoch: receipt,
                });
                return true;
            }
            if (snapshot.renderRevision < current.renderRevision) {
                return false;
            }
        }

        const generation = mintsOwner
            ? this.nextSelectionOwnerGeneration()
            : current.selectionOwnerGeneration;
        const receipt = this.nextSelectionReceiptEpoch();
        if (generation === null || receipt === null) {
            return false;
        }
        const owner: SelectionOwner = {
            tabId: sender.tabId,
            windowId: sender.windowId,
            documentId: sender.documentId,
            lifecycleGeneration: snapshot.lifecycleGeneration,
            selectionOwnerGeneration: generation,
            selectionRevision: snapshot.selectionRevision,
            renderRevision: snapshot.renderRevision,
            reason: snapshot.reason,
            entries: snapshot.entries.map((entry) => ({ ...entry })),
            acceptedReceiptEpoch: receipt,
        };
        this.selectionOwnersByTab.set(sender.tabId, owner);
        this.broadcastSelectionOwner(owner);
        return true;
    }

    private broadcastSelectionOwner(owner: SelectionOwner): void {
        const connection = this.connectionByTab.get(owner.tabId);
        const binding = connection
            ? this.bindingByConnection.get(connection)
            : undefined;
        if (
            !connection ||
            !binding ||
            binding.windowId !== owner.windowId ||
            binding.selectionSynchronizationPending ||
            !this.isCurrentBinding(
                connection,
                owner.tabId,
                owner.windowId,
                binding.registrationEpoch,
                binding.registrationId
            )
        ) {
            return;
        }
        const exact = { ...binding };
        if (
            !this.post(connection, {
                action: MessageActions.SIDEPANEL_SELECTION_SYNC,
                data: {
                    binding: {
                        registrationId: binding.registrationId,
                        tabId: owner.tabId,
                        windowId: owner.windowId,
                    },
                    selection: projectOwner(owner),
                },
            })
        ) {
            this.revokeExactBinding(connection, exact);
        }
    }

    private projectSelectionNull(tabId: number): boolean {
        const connection = this.connectionByTab.get(tabId);
        const binding = connection
            ? this.bindingByConnection.get(connection)
            : undefined;
        if (
            !connection ||
            !binding ||
            !this.isCurrentBinding(
                connection,
                binding.tabId,
                binding.windowId,
                binding.registrationEpoch,
                binding.registrationId
            )
        ) {
            return false;
        }
        const exact = { ...binding };
        if (
            !this.post(connection, {
                action: MessageActions.SIDEPANEL_SELECTION_SYNC,
                data: {
                    binding: {
                        registrationId: binding.registrationId,
                        tabId: binding.tabId,
                        windowId: binding.windowId,
                    },
                    selection: null,
                },
            })
        ) {
            this.revokeExactBinding(connection, exact);
            return false;
        }
        const after = this.bindingByConnection.get(connection);
        return Boolean(after && sameRegistration(after, exact));
    }

    // ------------------------------------------------------------- removal

    private captureRemovalBinding(
        connection: Connection,
        removal: RemovalRequest
    ): Binding | null {
        const binding = this.bindingByConnection.get(connection);
        if (
            !binding ||
            !bindingMatchesRemoval(binding, removal) ||
            binding.selectionSynchronizationPending ||
            !this.isCurrentBinding(
                connection,
                binding.tabId,
                binding.windowId,
                binding.registrationEpoch,
                binding.registrationId
            )
        ) {
            return null;
        }
        return { ...binding };
    }

    private ownsRemovalBinding(
        connection: Connection,
        binding: Binding,
        removal: RemovalRequest
    ): boolean {
        const current = this.bindingByConnection.get(connection);
        return Boolean(
            current &&
            sameRegistration(current, binding) &&
            bindingMatchesRemoval(current, removal) &&
            !current.selectionSynchronizationPending &&
            this.isCurrentBinding(
                connection,
                binding.tabId,
                binding.windowId,
                binding.registrationEpoch,
                binding.registrationId
            )
        );
    }

    private captureRemovalOwner(
        removal: RemovalRequest
    ): SelectionOwner | null {
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

    private postRemovalResult(
        connection: Connection,
        binding: Binding,
        removal: RemovalRequest,
        status: RemovalStatus
    ): boolean {
        if (!this.ownsRemovalBinding(connection, binding, removal)) {
            return false;
        }
        if (
            !this.post(connection, {
                action: MessageActions.SIDEPANEL_UPDATE_STATE,
                data: {
                    binding: removal.binding,
                    requestId: removal.requestId,
                    selectionOwnerGeneration: removal.selectionOwnerGeneration,
                    status,
                },
            })
        ) {
            this.revokeExactBinding(connection, binding);
            return false;
        }
        return this.ownsRemovalBinding(connection, binding, removal);
    }

    /**
     * Phase two of a panel-requested removal. Content applies the command
     * and republishes; "applied" is reported only once that authoritative
     * successor snapshot has been accepted here.
     */
    private async handleRemoval(
        connection: Connection,
        flight: RemovalFlight
    ): Promise<boolean> {
        const { removal } = flight;
        const isCurrentFlight = () =>
            this.removalFlights.get(connection) === flight;
        const binding = this.captureRemovalBinding(connection, removal);
        if (!binding || !isCurrentFlight()) {
            return false;
        }
        const owner = this.captureRemovalOwner(removal);
        if (!owner) {
            this.postRemovalResult(connection, binding, removal, 'rejected');
            return false;
        }

        let applied: boolean;
        try {
            if (
                connection.revoked ||
                !isCurrentFlight() ||
                !this.ownsRemovalBinding(connection, binding, removal) ||
                this.captureRemovalOwner(removal) !== owner
            ) {
                return false;
            }
            const response = await this.deps.sendToTab(
                selectionRemovalCommand,
                removal.binding.tabId,
                {
                    action: MessageActions.SIDEPANEL_UPDATE_STATE,
                    data: {
                        requestId: removal.requestId,
                        lifecycleGeneration: owner.lifecycleGeneration,
                        selectionRevision: removal.selectionRevision,
                        renderRevision: removal.renderRevision,
                        wordIndex: removal.wordIndex,
                    },
                },
                { documentId: owner.documentId, frameId: 0 }
            );
            applied =
                response.success && response.requestId === removal.requestId;
        } catch {
            if (!connection.revoked && isCurrentFlight()) {
                this.postRemovalResult(
                    connection,
                    binding,
                    removal,
                    'rejected'
                );
            }
            return false;
        }
        if (
            connection.revoked ||
            !isCurrentFlight() ||
            !this.ownsRemovalBinding(connection, binding, removal)
        ) {
            return false;
        }
        const successor = this.selectionOwnersByTab.get(removal.binding.tabId);
        const status: RemovalStatus =
            applied &&
            successor &&
            isAuthoritativeRemovalSuccess(successor, owner, removal)
                ? 'applied'
                : 'rejected';
        this.postRemovalResult(connection, binding, removal, status);
        return status === 'applied';
    }

    // -------------------------------------------------------- word intents

    /**
     * A word was clicked on a tab. Opening must be the first thing that
     * happens: the user gesture that permits sidePanel.open() does not
     * survive an await.
     */
    async handleWordIntent(
        tabId: number,
        options: WordIntentOptions
    ): Promise<boolean> {
        if (options.autoOpen) {
            const { sidePanel } = this.deps;
            if (!sidePanel) {
                this.logger.warn('Side Panel API not available');
                return false;
            }
            try {
                await sidePanel.open({ tabId });
            } catch (error) {
                this.logger.error('Failed to open side panel', error, {
                    tabId,
                });
                return false;
            }
            await this.forceBindActiveTab(tabId);
        }
        if (options.pauseVideo) {
            await this.pauseVideo(tabId);
        }
        return true;
    }

    /** Panels already open in the tab's window switch to it — but only if
     *  it is verifiably the active tab under the current activation. */
    private async forceBindActiveTab(tabId: number): Promise<void> {
        let tab: { id?: number; windowId?: number; active?: boolean };
        try {
            tab = await this.deps.tabs.get(tabId);
        } catch (error) {
            this.logger.warn('Failed to force bind side panel', {
                error: error instanceof Error ? error.message : 'unknown',
                tabId,
            });
            return;
        }
        const { windowId } = tab;
        if (tab.id !== tabId || tab.active !== true || windowId === undefined) {
            return;
        }
        const activation = this.activationByWindow.get(windowId);
        if (
            !activation ||
            activation.tabId !== tabId ||
            !this.isCurrentActivation(activation)
        ) {
            return;
        }
        for (const connection of this.connectionsByWindow.get(windowId) ?? []) {
            if (!this.isCurrentActivation(activation)) {
                break;
            }
            this.post(connection, {
                action: MessageActions.SIDEPANEL_FORCE_BIND_TAB,
                data: { tabId, windowId },
            });
        }
    }

    private async pauseVideo(tabId: number): Promise<boolean> {
        try {
            const response = await this.deps.sendToTab(
                sidePanelPauseVideo,
                tabId,
                { action: MessageActions.SIDEPANEL_PAUSE_VIDEO }
            );
            return response.success;
        } catch (error) {
            this.logger.warn('Failed to pause video', {
                error: error instanceof Error ? error.name : 'unknown',
                tabId,
            });
            return false;
        }
    }

    // ---------------------------------------------------------- tab events

    private isCurrentActivation(activation: WindowActivation): boolean {
        const current = this.activationByWindow.get(activation.windowId);
        return Boolean(
            current &&
            current.activationEpoch === activation.activationEpoch &&
            current.tabId === activation.tabId
        );
    }

    /** Every panel in the window is told to rebind. The window's other
     *  owners stay: an inactive tab cannot publish, so its owner is still
     *  true when the user returns, and a navigation meanwhile drops it
     *  through handleTabNavigation. Panels are window-scoped; other windows
     *  never hear about it. */
    handleTabActivated(info: { tabId: number; windowId: number }): void {
        const activatedOwner = this.selectionOwnersByTab.get(info.tabId);
        if (activatedOwner && activatedOwner.windowId !== info.windowId) {
            this.selectionOwnersByTab.delete(info.tabId);
        }
        const activation: WindowActivation = {
            activationEpoch: this.nextAuthorizationEpoch(),
            tabId: info.tabId,
            windowId: info.windowId,
        };
        this.activationByWindow.set(info.windowId, activation);

        for (const connection of [
            ...(this.connectionsByWindow.get(info.windowId) ?? []),
        ]) {
            if (!this.isCurrentActivation(activation)) {
                return;
            }
            const connectionWindow =
                this.claimByConnection.get(connection)?.windowId ??
                this.bindingByConnection.get(connection)?.windowId;
            if (
                !this.connections.has(connection) ||
                connection.revoked ||
                (connectionWindow !== undefined &&
                    connectionWindow !== info.windowId)
            ) {
                continue;
            }
            this.post(connection, {
                action: MessageActions.SIDEPANEL_TAB_ACTIVATED,
                data: { tabId: info.tabId, windowId: info.windowId },
            });
        }
    }

    /** A closed tab tombstones everything recorded for it, so a reused tab
     *  id starts from nothing. */
    handleTabRemoved(tabId: number): void {
        const removalEpoch = this.nextAuthorizationEpoch();
        this.tabLifecycleEpochByTab.set(tabId, removalEpoch);
        this.selectionInvalidationEpochByTab.delete(tabId);
        this.selectionOwnersByTab.delete(tabId);
        for (const [windowId, activation] of this.activationByWindow) {
            if (activation.tabId === tabId) {
                this.activationByWindow.delete(windowId);
            }
        }

        const predatesRemoval = (epoch: number) => epoch < removalEpoch;
        const toRevoke = new Set<Connection>();
        const toUnbind = new Set<Connection>();
        const claim = this.claimsByTab.get(tabId);
        if (claim && predatesRemoval(claim.tabLifecycleEpoch)) {
            toRevoke.add(claim.connection);
        }
        for (const [connection, binding] of this.bindingByConnection) {
            if (
                binding.tabId !== tabId ||
                !predatesRemoval(binding.tabLifecycleEpoch)
            ) {
                continue;
            }
            const latest = this.claimByConnection.get(connection);
            const supersedes = Boolean(
                latest &&
                latest.registrationEpoch > binding.registrationEpoch &&
                (latest.tabId !== tabId ||
                    !predatesRemoval(latest.tabLifecycleEpoch))
            );
            (supersedes ? toUnbind : toRevoke).add(connection);
        }
        for (const connection of toUnbind) {
            this.unbind(connection);
        }
        for (const connection of toRevoke) {
            this.revoke(connection);
        }
        const remaining = this.claimsByTab.get(tabId);
        if (remaining && predatesRemoval(remaining.tabLifecycleEpoch)) {
            this.claimsByTab.delete(tabId);
        }
        const mapped = this.connectionByTab.get(tabId);
        const mappedBinding = mapped
            ? this.bindingByConnection.get(mapped)
            : undefined;
        if (
            !mappedBinding ||
            predatesRemoval(mappedBinding.tabLifecycleEpoch)
        ) {
            this.connectionByTab.delete(tabId);
        }
        this.logger.debug('Tab removed', { tabId });
    }

    /** A navigation invalidates the tab's selection owner and any removal in
     *  flight; a bound panel sees null until the new document publishes. */
    handleTabNavigation(tabId: number): void {
        this.selectionInvalidationEpochByTab.set(
            tabId,
            this.nextAuthorizationEpoch()
        );
        this.selectionOwnersByTab.delete(tabId);
        const connection = this.connectionByTab.get(tabId);
        if (connection) {
            this.removalFlights.delete(connection);
            this.projectSelectionNull(tabId);
        }
    }

    destroy(): void {
        for (const connection of [
            ...this.connections,
            ...this.bindingByConnection.keys(),
        ]) {
            this.revoke(connection);
        }
        this.connections.clear();
        this.connectionByTab.clear();
        this.connectionsByWindow.clear();
        this.bindingByConnection.clear();
        this.claimsByTab.clear();
        this.claimByConnection.clear();
        this.activationByWindow.clear();
        this.selectionOwnersByTab.clear();
        this.selectionInvalidationEpochByTab.clear();
        this.removalFlights.clear();
    }
}

function sameRegistration(left: Registration, right: Registration): boolean {
    return (
        left.connectionEpoch === right.connectionEpoch &&
        left.registrationEpoch === right.registrationEpoch &&
        left.registrationId === right.registrationId &&
        left.tabId === right.tabId &&
        left.windowId === right.windowId
    );
}

function ownerIdentityEquals(
    left: SelectionOwner,
    right: SelectionOwner
): boolean {
    return (
        left.tabId === right.tabId &&
        left.windowId === right.windowId &&
        left.documentId === right.documentId &&
        left.lifecycleGeneration === right.lifecycleGeneration &&
        left.selectionOwnerGeneration === right.selectionOwnerGeneration
    );
}

function ownerStateEquals(
    left: SelectionOwner,
    right: SelectionOwner
): boolean {
    return (
        ownerIdentityEquals(left, right) &&
        left.selectionRevision === right.selectionRevision &&
        left.renderRevision === right.renderRevision &&
        left.reason === right.reason &&
        entriesEqual(left.entries, right.entries)
    );
}

function removalRequestsEqual(
    left: RemovalRequest,
    right: RemovalRequest
): boolean {
    return (
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

function bindingMatchesRemoval(
    binding: Binding,
    removal: RemovalRequest
): boolean {
    return (
        binding.registrationId === removal.binding.registrationId &&
        binding.tabId === removal.binding.tabId &&
        binding.windowId === removal.binding.windowId
    );
}

/** The successor must be the same owner, a fresher receipt, a higher
 *  selection revision at the same render, reason "remove", and exactly the
 *  previous entries minus the removed occurrence. */
function isAuthoritativeRemovalSuccess(
    current: SelectionOwner,
    previous: SelectionOwner,
    removal: RemovalRequest
): boolean {
    if (
        !ownerIdentityEquals(current, previous) ||
        current.acceptedReceiptEpoch <= previous.acceptedReceiptEpoch ||
        current.selectionRevision <= removal.selectionRevision ||
        current.renderRevision !== removal.renderRevision ||
        current.reason !== 'remove'
    ) {
        return false;
    }
    return entriesEqual(
        current.entries,
        previous.entries.filter(
            (entry) => entry.wordIndex !== removal.wordIndex
        )
    );
}
