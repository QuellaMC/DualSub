import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SelectionState } from '@/messaging/contracts/selection';
import {
    advanceSelectionCursor,
    PanelConnection,
    type PanelConnectionDeps,
    type TabBinding,
} from './panelConnection';

type Frame = { action: string; data: Record<string, unknown> };

function fakePort() {
    const messageListeners = new Set<(message: unknown) => void>();
    const disconnectListeners = new Set<() => void>();
    const posted: Frame[] = [];
    const port = {
        postMessage: (message: unknown) => {
            posted.push(message as Frame);
        },
        disconnect: vi.fn(),
        onMessage: {
            addListener: (listener: (message: unknown) => void) => {
                messageListeners.add(listener);
            },
        },
        onDisconnect: {
            addListener: (listener: () => void) => {
                disconnectListeners.add(listener);
            },
        },
    };
    return {
        port,
        posted,
        emit(message: unknown) {
            for (const listener of messageListeners) {
                listener(message);
            }
        },
        emitDisconnect() {
            for (const listener of disconnectListeners) {
                listener();
            }
        },
    };
}

const BINDING = { registrationId: 1, tabId: 12, windowId: 3 };

function selection(overrides: Partial<SelectionState> = {}): SelectionState {
    return {
        selectionOwnerGeneration: 1,
        selectionRevision: 3,
        renderRevision: 1,
        reason: 'toggle',
        entries: [
            { wordIndex: 0, word: 'hola' },
            { wordIndex: 2, word: 'amigo' },
        ],
        ...overrides,
    };
}

function harness(
    activeTab: { tabId: number; windowId: number } | null = {
        tabId: 12,
        windowId: 3,
    }
) {
    const ports: ReturnType<typeof fakePort>[] = [];
    const selections: [number, SelectionState | null][] = [];
    const deps: PanelConnectionDeps = {
        connect: () => {
            const fake = fakePort();
            ports.push(fake);
            return fake.port;
        },
        queryActiveTab: vi.fn(() => Promise.resolve(activeTab)),
        onSelection: (tabId, state) => selections.push([tabId, state]),
        onBindTab: vi.fn((binding: TabBinding) => {
            connection.registerTab(binding.tabId, binding.windowId);
        }),
        onRegister: vi.fn(),
        onConnected: vi.fn(),
        now: () => 5,
    };
    const connection = new PanelConnection(deps);
    return { connection, deps, ports, selections };
}

async function flush(): Promise<void> {
    await vi.advanceTimersByTimeAsync(0);
}

async function connected() {
    const h = harness();
    h.connection.start();
    await flush();
    const port = h.ports[0]!;
    port.emit({ action: 'sidePanelBindingConfirmed', data: BINDING });
    return { ...h, port };
}

describe('advanceSelectionCursor', () => {
    it('orders by owner generation, then selection revision, then render revision', () => {
        const base = selection();
        expect(advanceSelectionCursor(null, base)).toEqual({
            accepted: true,
            cursor: base,
        });
        expect(advanceSelectionCursor(base, null)).toEqual({
            accepted: true,
            cursor: base,
        });
        expect(
            advanceSelectionCursor(
                base,
                selection({ selectionOwnerGeneration: 0 })
            ).accepted
        ).toBe(false);
        const newer = selection({
            selectionOwnerGeneration: 2,
            selectionRevision: 1,
        });
        expect(advanceSelectionCursor(base, newer)).toEqual({
            accepted: true,
            cursor: newer,
        });
        expect(
            advanceSelectionCursor(base, selection({ selectionRevision: 2 }))
                .accepted
        ).toBe(false);
        expect(advanceSelectionCursor(base, selection())).toEqual({
            accepted: true,
            cursor: base,
        });
        expect(
            advanceSelectionCursor(base, selection({ entries: [] })).accepted
        ).toBe(false);
        expect(
            advanceSelectionCursor(
                base,
                selection({ selectionRevision: 4, renderRevision: 0 })
            ).accepted
        ).toBe(false);
        expect(
            advanceSelectionCursor(
                base,
                selection({ selectionRevision: 4, renderRevision: 2 })
            ).accepted
        ).toBe(true);
    });
});

describe('PanelConnection', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('connects and registers for the active tab', async () => {
        const { connection, deps, ports } = harness();
        connection.start();
        await flush();
        expect(deps.onConnected).toHaveBeenCalledWith(true);
        expect(ports[0]!.posted).toEqual([
            {
                action: 'sidePanelRegister',
                data: BINDING,
                source: 'sidepanel',
                timestamp: 5,
            },
        ]);
        expect(deps.onRegister).toHaveBeenCalledWith({
            tabId: 12,
            windowId: 3,
        });
        expect(connection.binding).toBeNull();
    });

    it('confirms only the exact pending registration', async () => {
        const { connection, ports } = harness();
        connection.start();
        await flush();
        ports[0]!.emit({
            action: 'sidePanelBindingConfirmed',
            data: { ...BINDING, registrationId: 2 },
        });
        expect(connection.binding).toBeNull();
        ports[0]!.emit({ action: 'sidePanelBindingConfirmed', data: BINDING });
        expect(connection.binding).toEqual(BINDING);
    });

    it('retires an unconfirmed port after the acknowledgement timeout and reconnects', async () => {
        const { connection, deps, ports } = harness();
        connection.start();
        await flush();
        await vi.advanceTimersByTimeAsync(2000);
        expect(ports[0]!.port.disconnect).toHaveBeenCalled();
        expect(deps.onConnected).toHaveBeenLastCalledWith(false);
        await vi.advanceTimersByTimeAsync(1000);
        expect(ports).toHaveLength(2);
        expect(ports[1]!.posted[0]).toMatchObject({
            action: 'sidePanelRegister',
            data: { registrationId: 2, tabId: 12, windowId: 3 },
        });
        expect(connection.binding).toBeNull();
    });

    it('accepts selection state only for the confirmed binding and only forward', async () => {
        const { port, selections } = await connected();
        port.emit({
            action: 'sidePanelSelectionSync',
            data: {
                binding: { ...BINDING, registrationId: 9 },
                selection: selection(),
            },
        });
        expect(selections).toEqual([[12, null]]);
        port.emit({
            action: 'sidePanelSelectionSync',
            data: { binding: BINDING, selection: selection() },
        });
        port.emit({
            action: 'sidePanelSelectionSync',
            data: {
                binding: BINDING,
                selection: selection({ selectionRevision: 2 }),
            },
        });
        port.emit({
            action: 'sidePanelSelectionSync',
            data: { binding: BINDING, selection: null },
        });
        expect(selections).toEqual([
            [12, null],
            [12, selection()],
            [12, null],
        ]);
    });

    it('requests removal by occurrence and applies only after the authoritative successor', async () => {
        const { connection, port, selections } = await connected();
        port.emit({
            action: 'sidePanelSelectionSync',
            data: { binding: BINDING, selection: selection() },
        });
        const pending = connection.requestRemoval(selection(), 2);
        expect(port.posted.at(-1)).toEqual({
            action: 'sidePanelUpdateState',
            data: {
                binding: BINDING,
                requestId: 1,
                selectionOwnerGeneration: 1,
                selectionRevision: 3,
                renderRevision: 1,
                wordIndex: 2,
            },
        });
        port.emit({
            action: 'sidePanelUpdateState',
            data: {
                binding: BINDING,
                requestId: 1,
                selectionOwnerGeneration: 1,
                status: 'applied',
            },
        });
        let settled: string | null = null;
        void pending.then((status) => {
            settled = status;
        });
        await flush();
        expect(settled).toBeNull();
        const successor = selection({
            selectionRevision: 4,
            reason: 'remove',
            entries: [{ wordIndex: 0, word: 'hola' }],
        });
        port.emit({
            action: 'sidePanelSelectionSync',
            data: { binding: BINDING, selection: successor },
        });
        expect(await pending).toBe('applied');
        expect(selections.at(-1)).toEqual([12, successor]);
    });

    it('rejects a removal on a rejected terminal, an invalidating selection, or a rebind', async () => {
        const { connection, port, selections } = await connected();
        port.emit({
            action: 'sidePanelSelectionSync',
            data: { binding: BINDING, selection: selection() },
        });
        const first = connection.requestRemoval(selection(), 2);
        expect(await connection.requestRemoval(selection(), 0)).toBe(
            'rejected'
        );
        port.emit({
            action: 'sidePanelUpdateState',
            data: {
                binding: BINDING,
                requestId: 1,
                selectionOwnerGeneration: 1,
                status: 'rejected',
            },
        });
        expect(await first).toBe('rejected');

        const second = connection.requestRemoval(selection(), 2);
        port.emit({
            action: 'sidePanelSelectionSync',
            data: { binding: BINDING, selection: null },
        });
        expect(await second).toBe('rejected');

        port.emit({
            action: 'sidePanelSelectionSync',
            data: {
                binding: BINDING,
                selection: selection({ selectionRevision: 5 }),
            },
        });
        const third = connection.requestRemoval(
            selection({ selectionRevision: 5 }),
            2
        );
        expect(connection.registerTab(13, 3)).toBe(true);
        expect(await third).toBe('rejected');
        expect(selections.slice(-2)).toEqual([
            [12, null],
            [13, null],
        ]);
        expect(connection.binding).toBeNull();
    });

    it('rebinds when the background names a tab', async () => {
        const { connection, port, deps } = await connected();
        port.emit({ action: 'tabActivated', data: { tabId: 13, windowId: 3 } });
        expect(deps.onBindTab).toHaveBeenCalledWith({ tabId: 13, windowId: 3 });
        expect(port.posted.at(-1)).toMatchObject({
            action: 'sidePanelRegister',
            data: { registrationId: 2, tabId: 13, windowId: 3 },
        });
        expect(connection.binding).toBeNull();
        port.emit({
            action: 'sidePanelBindingConfirmed',
            data: { registrationId: 2, tabId: 13, windowId: 3 },
        });
        expect(connection.binding).toEqual({
            registrationId: 2,
            tabId: 13,
            windowId: 3,
        });
    });

    it('clears the bound selection on disconnect and reconnects', async () => {
        const { connection, port, ports, deps, selections } = await connected();
        port.emitDisconnect();
        expect(selections.at(-1)).toEqual([12, null]);
        expect(deps.onConnected).toHaveBeenLastCalledWith(false);
        expect(connection.binding).toBeNull();
        await vi.advanceTimersByTimeAsync(1000);
        expect(ports).toHaveLength(2);
        expect(ports[1]!.posted[0]).toMatchObject({
            action: 'sidePanelRegister',
        });
    });

    it('stops without reconnecting', async () => {
        const { connection, port, ports } = await connected();
        connection.stop();
        expect(port.port.disconnect).toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(5000);
        expect(ports).toHaveLength(1);
        expect(connection.registerTab(12, 3)).toBe(false);
    });

    it('closes a port that sends a frame outside the contract', async () => {
        const { port, ports } = await connected();
        port.emit({ action: 'sidePanelSelectionSync', data: { nope: true } });
        expect(port.port.disconnect).toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1000);
        expect(ports).toHaveLength(2);
    });
});
