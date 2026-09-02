import { MessageActions } from '@/messaging/actions';
import type { SelectionState } from '@/messaging/contracts/selection';
import {
    backgroundToPanel,
    panelToBackground,
    type BackgroundToPanelFrame,
    type PanelToBackgroundFrame,
    type SidePanelBinding,
} from '@/messaging/contracts/sidepanelPort';
import { framePort, type FramedPort, type PortLike } from '@/messaging/port';

const REGISTRATION_ACK_TIMEOUT_MS = 2000;
const RECONNECT_DELAY_MS = 1000;
const CONNECT_FAILURE_RETRY_MS = 2000;

export interface TabBinding {
    readonly tabId: number;
    readonly windowId: number;
}

export type RemovalStatus = 'applied' | 'rejected';

export interface PanelConnectionDeps {
    readonly connect: () => PortLike;
    readonly queryActiveTab: () => Promise<TabBinding | null>;
    /** The bound tab's selection changed; null clears it. */
    readonly onSelection: (
        tabId: number,
        selection: SelectionState | null
    ) => void;
    /** Background asks the panel to bind to this tab. */
    readonly onBindTab: (binding: TabBinding) => void;
    /** A registration for this tab was just posted. */
    readonly onRegister: (binding: TabBinding) => void;
    readonly onConnected: (connected: boolean) => void;
    readonly now?: () => number;
}

interface PendingRegistration {
    readonly registrationId: number;
    readonly tabId: number;
    readonly windowId: number;
    timer: ReturnType<typeof setTimeout> | null;
}

interface PendingRemoval {
    readonly requestId: number;
    readonly expected: {
        readonly selectionOwnerGeneration: number;
        readonly selectionRevision: number;
        readonly renderRevision: number;
        readonly wordIndex: number;
    };
    successorObserved: boolean;
    terminal: RemovalStatus | null;
    readonly resolve: (status: RemovalStatus) => void;
}

/** One connected port; everything here dies with it. */
interface Session {
    port: FramedPort<PanelToBackgroundFrame>;
    pendingRegistration: PendingRegistration | null;
    confirmed: SidePanelBinding | null;
    cursor: SelectionState | null;
    pendingRemoval: PendingRemoval | null;
}

function bindingEquals(left: SidePanelBinding, right: SidePanelBinding) {
    return (
        left.registrationId === right.registrationId &&
        left.tabId === right.tabId &&
        left.windowId === right.windowId
    );
}

function selectionStatesEqual(
    left: SelectionState,
    right: SelectionState
): boolean {
    return (
        left.selectionOwnerGeneration === right.selectionOwnerGeneration &&
        left.selectionRevision === right.selectionRevision &&
        left.renderRevision === right.renderRevision &&
        left.reason === right.reason &&
        left.entries.length === right.entries.length &&
        left.entries.every(
            (entry, index) =>
                entry.wordIndex === right.entries[index]!.wordIndex &&
                entry.word === right.entries[index]!.word
        )
    );
}

/**
 * Freshness cursor for projected selections: a newer owner generation
 * always wins; within one generation the selection revision must advance
 * (an exact replay is accepted without moving) and the render revision may
 * not go backwards. Null (a clear) is always accepted and keeps the cursor.
 */
export function advanceSelectionCursor(
    cursor: SelectionState | null,
    selection: SelectionState | null
): { accepted: boolean; cursor: SelectionState | null } {
    if (selection === null || cursor === null) {
        return { accepted: true, cursor: selection ?? cursor };
    }
    if (selection.selectionOwnerGeneration < cursor.selectionOwnerGeneration) {
        return { accepted: false, cursor };
    }
    if (selection.selectionOwnerGeneration > cursor.selectionOwnerGeneration) {
        return { accepted: true, cursor: selection };
    }
    if (selection.selectionRevision < cursor.selectionRevision) {
        return { accepted: false, cursor };
    }
    if (selection.selectionRevision === cursor.selectionRevision) {
        return { accepted: selectionStatesEqual(cursor, selection), cursor };
    }
    if (selection.renderRevision < cursor.renderRevision) {
        return { accepted: false, cursor };
    }
    return { accepted: true, cursor: selection };
}

/**
 * The panel's end of the side panel port. It keeps one port connected
 * (reconnecting after drops), registers for the active tab, accepts only
 * selection state for the binding the background confirmed, and requests
 * removals whose outcome is decided by the authoritative successor
 * snapshot, never optimistically.
 */
export class PanelConnection {
    private session: Session | null = null;
    private generation = 0;
    private bindingIntentEpoch = 0;
    private registrationCounter = 0;
    private removalCounter = 0;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private stopped = true;

    constructor(private readonly deps: PanelConnectionDeps) {}

    start(): void {
        this.stopped = false;
        this.connect();
    }

    stop(): void {
        this.stopped = true;
        if (this.reconnectTimer !== null) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        const session = this.session;
        if (session) {
            this.retire(session, { disconnect: true, reconnectDelay: null });
        }
    }

    /** The binding the background confirmed for the current port. */
    get binding(): SidePanelBinding | null {
        return this.session?.confirmed ?? null;
    }

    /** Ask to bind the current port to a tab. */
    registerTab(tabId: number, windowId: number): boolean {
        const session = this.session;
        return session ? this.registerOn(session, tabId, windowId) : false;
    }

    /** Ask content (through the background) to drop one occurrence. */
    requestRemoval(
        selection: SelectionState,
        wordIndex: number
    ): Promise<RemovalStatus> {
        const session = this.session;
        const confirmed = session?.confirmed;
        if (!session || !confirmed || session.pendingRemoval) {
            return Promise.resolve('rejected');
        }
        this.removalCounter += 1;
        const requestId = this.removalCounter;
        return new Promise<RemovalStatus>((resolve) => {
            const pending: PendingRemoval = {
                requestId,
                expected: {
                    selectionOwnerGeneration:
                        selection.selectionOwnerGeneration,
                    selectionRevision: selection.selectionRevision,
                    renderRevision: selection.renderRevision,
                    wordIndex,
                },
                successorObserved: false,
                terminal: null,
                resolve,
            };
            session.pendingRemoval = pending;
            try {
                session.port.post({
                    action: MessageActions.SIDEPANEL_UPDATE_STATE,
                    data: {
                        binding: confirmed,
                        requestId,
                        ...pending.expected,
                    },
                });
            } catch {
                this.settleRemoval(session, pending, 'rejected');
            }
        });
    }

    private isCurrent(session: Session): boolean {
        return this.session === session && !this.stopped;
    }

    private connect(): void {
        if (this.session || this.stopped) {
            return;
        }
        this.generation += 1;
        const generation = this.generation;
        let raw: PortLike;
        try {
            raw = this.deps.connect();
        } catch {
            this.deps.onConnected(false);
            this.scheduleReconnect(generation, CONNECT_FAILURE_RETRY_MS);
            return;
        }
        const session: Session = {
            port: null as unknown as FramedPort<PanelToBackgroundFrame>,
            pendingRegistration: null,
            confirmed: null,
            cursor: null,
            pendingRemoval: null,
        };
        session.port = framePort(raw, {
            inbound: backgroundToPanel,
            outbound: panelToBackground,
            onFrame: (frame) => this.onFrame(session, frame),
            onDisconnect: () =>
                this.retire(session, {
                    disconnect: false,
                    reconnectDelay: RECONNECT_DELAY_MS,
                }),
        });
        this.session = session;
        this.deps.onConnected(true);
        void this.registerWithActiveTab(session);
    }

    private async registerWithActiveTab(session: Session): Promise<void> {
        const epoch = this.bindingIntentEpoch;
        let tab: TabBinding | null;
        try {
            tab = await this.deps.queryActiveTab();
        } catch {
            tab = null;
        }
        if (
            !tab ||
            !this.isCurrent(session) ||
            epoch !== this.bindingIntentEpoch
        ) {
            return;
        }
        this.registerOn(session, tab.tabId, tab.windowId);
    }

    private registerOn(
        session: Session,
        tabId: number,
        windowId: number
    ): boolean {
        if (
            !this.isCurrent(session) ||
            !Number.isSafeInteger(tabId) ||
            tabId < 0 ||
            !Number.isSafeInteger(windowId) ||
            windowId < 0
        ) {
            return false;
        }
        // Nothing from the previous binding may survive the intent to
        // rebind, and the new tab starts visibly empty until confirmed.
        const prior = session.confirmed;
        if (prior) {
            this.deps.onSelection(prior.tabId, null);
        }
        if (!prior || prior.tabId !== tabId) {
            this.deps.onSelection(tabId, null);
        }
        if (!this.isCurrent(session)) {
            return false;
        }
        this.bindingIntentEpoch += 1;
        this.clearConfirmed(session);
        this.settleRegistration(session);

        this.registrationCounter += 1;
        const pending: PendingRegistration = {
            registrationId: this.registrationCounter,
            tabId,
            windowId,
            timer: null,
        };
        session.pendingRegistration = pending;
        try {
            session.port.post({
                action: MessageActions.SIDEPANEL_REGISTER,
                data: {
                    registrationId: pending.registrationId,
                    tabId,
                    windowId,
                },
                source: 'sidepanel',
                timestamp: (this.deps.now ?? Date.now)(),
            });
        } catch {
            this.settleRegistration(session);
            return false;
        }
        if (session.pendingRegistration !== pending) {
            return false;
        }
        this.deps.onRegister({ tabId, windowId });
        pending.timer = setTimeout(() => {
            if (session.pendingRegistration !== pending) {
                return;
            }
            this.settleRegistration(session);
            this.retire(session, {
                disconnect: true,
                reconnectDelay: RECONNECT_DELAY_MS,
            });
        }, REGISTRATION_ACK_TIMEOUT_MS);
        return true;
    }

    private onFrame(session: Session, frame: BackgroundToPanelFrame): void {
        if (!this.isCurrent(session)) {
            return;
        }
        switch (frame.action) {
            case MessageActions.SIDEPANEL_BINDING_CONFIRMED: {
                const pending = session.pendingRegistration;
                if (
                    pending &&
                    frame.data.registrationId === pending.registrationId &&
                    frame.data.tabId === pending.tabId &&
                    frame.data.windowId === pending.windowId
                ) {
                    this.settleRegistration(session);
                    session.confirmed = { ...frame.data };
                    session.cursor = null;
                }
                return;
            }
            case MessageActions.SIDEPANEL_SELECTION_SYNC: {
                const confirmed = session.confirmed;
                if (
                    !confirmed ||
                    !bindingEquals(frame.data.binding, confirmed)
                ) {
                    return;
                }
                const advance = advanceSelectionCursor(
                    session.cursor,
                    frame.data.selection
                );
                if (!advance.accepted) {
                    return;
                }
                session.cursor = advance.cursor;
                this.deps.onSelection(confirmed.tabId, frame.data.selection);
                if (
                    this.isCurrent(session) &&
                    session.confirmed === confirmed
                ) {
                    this.observeRemovalSuccessor(session, frame.data.selection);
                }
                return;
            }
            case MessageActions.SIDEPANEL_UPDATE_STATE: {
                const pending = session.pendingRemoval;
                const confirmed = session.confirmed;
                if (
                    !pending ||
                    !confirmed ||
                    !bindingEquals(frame.data.binding, confirmed) ||
                    frame.data.requestId !== pending.requestId ||
                    frame.data.selectionOwnerGeneration !==
                        pending.expected.selectionOwnerGeneration
                ) {
                    return;
                }
                pending.terminal = frame.data.status;
                if (frame.data.status === 'rejected') {
                    this.settleRemoval(session, pending, 'rejected');
                } else if (pending.successorObserved) {
                    this.settleRemoval(session, pending, 'applied');
                }
                return;
            }
            case MessageActions.SIDEPANEL_TAB_ACTIVATED:
            case MessageActions.SIDEPANEL_FORCE_BIND_TAB:
                this.deps.onBindTab(frame.data);
                return;
        }
    }

    /** A removal is applied only once the successor snapshot (same owner and
     *  render, higher revision, reason "remove", occurrence gone) arrives;
     *  any other movement of the selection invalidates the request. */
    private observeRemovalSuccessor(
        session: Session,
        selection: SelectionState | null
    ): void {
        const pending = session.pendingRemoval;
        if (!pending) {
            return;
        }
        const { expected } = pending;
        const isSuccessor =
            selection !== null &&
            selection.selectionOwnerGeneration ===
                expected.selectionOwnerGeneration &&
            selection.renderRevision === expected.renderRevision &&
            selection.selectionRevision > expected.selectionRevision &&
            selection.reason === 'remove' &&
            !selection.entries.some(
                ({ wordIndex }) => wordIndex === expected.wordIndex
            );
        const invalidates =
            selection === null ||
            selection.selectionOwnerGeneration !==
                expected.selectionOwnerGeneration ||
            selection.renderRevision !== expected.renderRevision ||
            selection.selectionRevision > expected.selectionRevision;
        if (isSuccessor) {
            pending.successorObserved = true;
            if (pending.terminal === 'applied') {
                this.settleRemoval(session, pending, 'applied');
            }
        } else if (invalidates) {
            this.settleRemoval(session, pending, 'rejected');
        }
    }

    private settleRemoval(
        session: Session,
        pending: PendingRemoval,
        status: RemovalStatus
    ): void {
        if (session.pendingRemoval !== pending) {
            return;
        }
        session.pendingRemoval = null;
        pending.resolve(status);
    }

    private settleRegistration(session: Session): void {
        const pending = session.pendingRegistration;
        if (!pending) {
            return;
        }
        session.pendingRegistration = null;
        if (pending.timer !== null) {
            clearTimeout(pending.timer);
        }
    }

    private clearConfirmed(session: Session): void {
        const pending = session.pendingRemoval;
        if (pending) {
            this.settleRemoval(session, pending, 'rejected');
        }
        session.confirmed = null;
        session.cursor = null;
    }

    private retire(
        session: Session,
        options: { disconnect: boolean; reconnectDelay: number | null }
    ): void {
        if (this.session !== session) {
            return;
        }
        const confirmed = session.confirmed;
        if (confirmed) {
            this.deps.onSelection(confirmed.tabId, null);
        }
        if (this.session !== session) {
            return;
        }
        this.clearConfirmed(session);
        this.settleRegistration(session);
        this.session = null;
        this.generation += 1;
        this.deps.onConnected(false);
        if (options.disconnect) {
            try {
                session.port.disconnect();
            } catch {
                // The browser may already have retired the port.
            }
        }
        if (options.reconnectDelay !== null && !this.stopped) {
            this.scheduleReconnect(this.generation, options.reconnectDelay);
        }
    }

    private scheduleReconnect(generation: number, delay: number): void {
        if (this.reconnectTimer !== null) {
            clearTimeout(this.reconnectTimer);
        }
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (
                this.generation === generation &&
                !this.session &&
                !this.stopped
            ) {
                this.connect();
            }
        }, delay);
    }
}
