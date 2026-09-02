import { describe, expect, it, vi } from 'vitest';
import { MessagingError, MessagingFailureClass } from '@/messaging/client';
import type { ClassifiedContentSender } from '@/messaging/sender';
import type { ContentSelectionSnapshot } from '@/messaging/contracts/selection';
import {
    SidePanelService,
    type SidePanelServiceDeps,
    type WordIntentOptions,
} from './service';

type Posted = { action: string; data: Record<string, unknown> };

function fakePort() {
    const messageListeners = new Set<(message: unknown) => void>();
    const disconnectListeners = new Set<() => void>();
    const posted: Posted[] = [];
    let alive = true;
    const port = {
        postMessage: (message: unknown) => {
            if (!alive) {
                throw new Error('Attempting to use a disconnected port object');
            }
            posted.push(message as Posted);
        },
        disconnect: vi.fn(() => {
            alive = false;
        }),
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
        get alive() {
            return alive;
        },
        emit(message: unknown) {
            for (const listener of messageListeners) {
                listener(message);
            }
        },
        emitDisconnect() {
            alive = false;
            for (const listener of disconnectListeners) {
                listener();
            }
        },
        register(registrationId: number, tabId: number, windowId: number) {
            this.emit({
                action: 'sidePanelRegister',
                data: { registrationId, tabId, windowId },
                source: 'sidepanel',
                timestamp: 1,
            });
        },
    };
}

function contentSender(
    overrides: Partial<ClassifiedContentSender> = {}
): ClassifiedContentSender {
    return {
        role: 'content',
        platform: 'netflix',
        tabId: 12,
        windowId: 3,
        documentId: 'doc-1',
        documentLifecycle: 'active',
        origin: 'https://www.netflix.com',
        senderUrl: 'https://www.netflix.com/watch/1',
        tabUrl: 'https://www.netflix.com/watch/1',
        frameId: 0,
        ...overrides,
    };
}

function snapshot(
    overrides: Partial<ContentSelectionSnapshot> = {}
): ContentSelectionSnapshot {
    return {
        lifecycleGeneration: 1,
        selectionRevision: 1,
        renderRevision: 1,
        reason: 'toggle',
        entries: [{ wordIndex: 0, word: 'hola' }],
        ...overrides,
    };
}

type TabRecord = { id: number; windowId: number; active: boolean };

function harness(tabs: Record<number, TabRecord> = {}) {
    const tabTable: Record<number, TabRecord> = {
        12: { id: 12, windowId: 3, active: true },
        ...tabs,
    };
    const sendToTab = vi.fn<SidePanelServiceDeps['sendToTab']>();
    const sidePanel = { open: vi.fn(() => Promise.resolve()) };
    const tabsGet = vi.fn((tabId: number) => {
        const tab = tabTable[tabId];
        return tab ? Promise.resolve(tab) : Promise.reject(new Error('No tab'));
    });
    const service = new SidePanelService({
        tabs: { get: tabsGet },
        sidePanel,
        sendToTab: sendToTab as unknown as SidePanelServiceDeps['sendToTab'],
    });
    /** Content acknowledges republish requests without replaying. */
    sendToTab.mockImplementation((contract, _tabId, request) => {
        if (contract.action === 'sidePanelGetState') {
            const { data } = request as { data: { requestId: number } };
            return Promise.resolve({
                requestId: data.requestId,
                accepted: false,
            } as never);
        }
        return Promise.resolve({ success: true } as never);
    });
    return { service, sendToTab, sidePanel, tabsGet, tabTable };
}

async function settled(): Promise<void> {
    for (let index = 0; index < 8; index += 1) {
        await Promise.resolve();
    }
}

async function bound(
    service: SidePanelService,
    registrationId = 1,
    tabId = 12,
    windowId = 3
) {
    const panel = fakePort();
    service.handleConnect(panel.port);
    panel.register(registrationId, tabId, windowId);
    await vi.waitFor(() => expect(panel.posted).toHaveLength(3));
    return panel;
}

describe('SidePanelService registration', () => {
    it('binds only after verifying the active tab, confirms, and reports the empty tab', async () => {
        const { service, tabsGet } = harness();
        const panel = fakePort();
        service.handleConnect(panel.port);
        panel.register(1, 12, 3);
        expect(panel.posted).toEqual([]);
        await vi.waitFor(() => expect(panel.posted).toHaveLength(3));
        expect(tabsGet).toHaveBeenCalledWith(12);
        const nullSync = {
            action: 'sidePanelSelectionSync',
            data: {
                binding: { registrationId: 1, tabId: 12, windowId: 3 },
                selection: null,
            },
        };
        expect(panel.posted).toEqual([
            {
                action: 'sidePanelBindingConfirmed',
                data: { registrationId: 1, tabId: 12, windowId: 3 },
            },
            nullSync,
            nullSync,
        ]);
        expect(panel.alive).toBe(true);
    });

    it('rejects an inactive tab registration without disclosing state', async () => {
        const { service } = harness({
            12: { id: 12, windowId: 3, active: false },
        });
        service.acceptSelectionSnapshot(contentSender(), snapshot());
        const panel = fakePort();
        service.handleConnect(panel.port);
        panel.register(1, 12, 3);
        await vi.waitFor(() =>
            expect(panel.port.disconnect).toHaveBeenCalled()
        );
        expect(panel.posted).toEqual([]);
    });

    it('rejects a registration whose window does not match the tab', async () => {
        const { service } = harness();
        const panel = fakePort();
        service.handleConnect(panel.port);
        panel.register(1, 12, 99);
        await vi.waitFor(() =>
            expect(panel.port.disconnect).toHaveBeenCalled()
        );
        expect(panel.posted).toEqual([]);
    });

    it('projects the content owner republished during synchronization', async () => {
        const { service, sendToTab } = harness();
        service.acceptSelectionSnapshot(contentSender(), snapshot());
        sendToTab.mockImplementation((contract, _tabId, request) => {
            if (contract.action === 'sidePanelGetState') {
                service.acceptSelectionSnapshot(contentSender(), snapshot());
                const { data } = request as { data: { requestId: number } };
                return Promise.resolve({
                    requestId: data.requestId,
                    accepted: true,
                } as never);
            }
            return Promise.resolve({ success: true } as never);
        });
        const panel = fakePort();
        service.handleConnect(panel.port);
        panel.register(1, 12, 3);
        await vi.waitFor(() => expect(panel.posted).toHaveLength(3));
        expect(panel.posted[2]).toEqual({
            action: 'sidePanelSelectionSync',
            data: {
                binding: { registrationId: 1, tabId: 12, windowId: 3 },
                selection: {
                    selectionOwnerGeneration: 1,
                    selectionRevision: 1,
                    renderRevision: 1,
                    reason: 'toggle',
                    entries: [{ wordIndex: 0, word: 'hola' }],
                },
            },
        });
        expect(sendToTab.mock.calls[0]![3]).toEqual({
            documentId: 'doc-1',
            frameId: 0,
        });
    });

    it('reports an empty tab with a second null when content has nothing to republish', async () => {
        const { service } = harness();
        const panel = await bound(service);
        await settled();
        expect(panel.posted).toHaveLength(3);
        expect(panel.posted[2]!.data.selection).toBeNull();
        expect(panel.alive).toBe(true);
    });

    it('projects a snapshot that arrived during synchronization over a negative ack', async () => {
        const { service, sendToTab } = harness();
        sendToTab.mockImplementation((contract, _tabId, request) => {
            if (contract.action === 'sidePanelGetState') {
                service.acceptSelectionSnapshot(contentSender(), snapshot());
                const { data } = request as { data: { requestId: number } };
                return Promise.resolve({
                    requestId: data.requestId,
                    accepted: false,
                } as never);
            }
            return Promise.resolve({ success: true } as never);
        });
        const panel = await bound(service);
        expect(panel.posted[2]!.data.selection).toMatchObject({
            selectionOwnerGeneration: 1,
            entries: [{ wordIndex: 0, word: 'hola' }],
        });
    });

    it('reports an empty tab when the tab provably has no content script', async () => {
        const { service, sendToTab } = harness();
        sendToTab.mockRejectedValue(
            new MessagingError(
                'no receiver',
                MessagingFailureClass.PROVEN_NON_DELIVERY,
                null
            )
        );
        const panel = await bound(service);
        expect(panel.posted[2]!.data.selection).toBeNull();
        expect(panel.alive).toBe(true);
    });

    it('projects the owner it holds when the republish failed ambiguously', async () => {
        const { service, sendToTab } = harness();
        service.acceptSelectionSnapshot(contentSender(), snapshot());
        sendToTab.mockRejectedValue(
            new MessagingError(
                'closed',
                MessagingFailureClass.AMBIGUOUS_ACCEPTANCE,
                null
            )
        );
        const panel = await bound(service);
        expect(panel.posted[2]!.data.selection).toMatchObject({
            selectionOwnerGeneration: 1,
            entries: [{ wordIndex: 0, word: 'hola' }],
        });
        expect(
            service.acceptSelectionSnapshot(
                contentSender(),
                snapshot({ selectionRevision: 2, entries: [] })
            )
        ).toBe(true);
        expect(panel.posted[3]!.data.selection).toMatchObject({
            selectionOwnerGeneration: 1,
            selectionRevision: 2,
        });
    });

    it('changes nothing when the republish failed ambiguously and nothing is known', async () => {
        const { service, sendToTab } = harness();
        sendToTab.mockRejectedValue(
            new MessagingError(
                'closed',
                MessagingFailureClass.AMBIGUOUS_ACCEPTANCE,
                null
            )
        );
        const panel = fakePort();
        service.handleConnect(panel.port);
        panel.register(1, 12, 3);
        await vi.waitFor(() => expect(panel.posted).toHaveLength(2));
        await settled();
        expect(panel.posted).toHaveLength(2);
        expect(panel.alive).toBe(true);
    });

    it('treats an uncorrelated acknowledgement as unknown, not as an empty tab', async () => {
        const { service, sendToTab } = harness();
        service.acceptSelectionSnapshot(contentSender(), snapshot());
        sendToTab.mockImplementation((contract, _tabId, request) => {
            if (contract.action === 'sidePanelGetState') {
                const { data } = request as { data: { requestId: number } };
                return Promise.resolve({
                    requestId: data.requestId + 1,
                    accepted: false,
                } as never);
            }
            return Promise.resolve({ success: true } as never);
        });
        const panel = await bound(service);
        expect(panel.posted[2]!.data.selection).toMatchObject({
            selectionOwnerGeneration: 1,
        });
    });

    it('projects a higher lifecycle of the same document accepted during synchronization', async () => {
        const { service, sendToTab } = harness();
        service.acceptSelectionSnapshot(contentSender(), snapshot());
        sendToTab.mockImplementation((contract, _tabId, request) => {
            if (contract.action === 'sidePanelGetState') {
                service.acceptSelectionSnapshot(
                    contentSender(),
                    snapshot({ lifecycleGeneration: 2, entries: [] })
                );
                const { data } = request as { data: { requestId: number } };
                return Promise.resolve({
                    requestId: data.requestId,
                    accepted: true,
                } as never);
            }
            return Promise.resolve({ success: true } as never);
        });
        const panel = await bound(service);
        expect(panel.posted[2]!.data.selection).toMatchObject({
            selectionOwnerGeneration: 2,
            entries: [],
        });
    });

    it('projects the owner a navigation during synchronization left behind', async () => {
        const { service, sendToTab } = harness();
        service.acceptSelectionSnapshot(contentSender(), snapshot());
        sendToTab.mockImplementation((contract, _tabId, request) => {
            if (contract.action === 'sidePanelGetState') {
                service.handleTabNavigation(12);
                service.acceptSelectionSnapshot(
                    contentSender({ documentId: 'doc-2' }),
                    snapshot()
                );
                const { data } = request as { data: { requestId: number } };
                return Promise.resolve({
                    requestId: data.requestId,
                    accepted: true,
                } as never);
            }
            return Promise.resolve({ success: true } as never);
        });
        const panel = fakePort();
        service.handleConnect(panel.port);
        panel.register(1, 12, 3);
        await vi.waitFor(() => expect(panel.posted).toHaveLength(4));
        expect(panel.posted[2]!.data.selection).toBeNull();
        expect(panel.posted[3]!.data.selection).toMatchObject({
            selectionOwnerGeneration: 2,
            entries: [{ wordIndex: 0, word: 'hola' }],
        });
    });

    it('ignores a removal request from an unregistered panel', async () => {
        const { service, sendToTab } = harness();
        const panel = fakePort();
        service.handleConnect(panel.port);
        panel.emit({
            action: 'sidePanelUpdateState',
            data: {
                binding: { registrationId: 1, tabId: 12, windowId: 3 },
                requestId: 1,
                selectionOwnerGeneration: 1,
                selectionRevision: 1,
                renderRevision: 1,
                wordIndex: 0,
            },
        });
        await settled();
        expect(panel.posted).toEqual([]);
        expect(sendToTab).not.toHaveBeenCalled();
        expect(panel.alive).toBe(true);
    });

    it('closes a panel that speaks outside the port contract', async () => {
        const { service } = harness();
        const panel = await bound(service);
        panel.emit({ action: 'sidePanelRegister', data: {} });
        expect(panel.port.disconnect).toHaveBeenCalled();
        service.acceptSelectionSnapshot(contentSender(), snapshot());
        expect(panel.posted).toHaveLength(3);
    });

    it('evicts a replaced same-tab panel so it cannot receive state', async () => {
        const { service } = harness();
        const first = await bound(service, 1);
        const second = await bound(service, 2);
        expect(first.port.disconnect).toHaveBeenCalled();
        service.acceptSelectionSnapshot(contentSender(), snapshot());
        expect(first.posted).toHaveLength(3);
        expect(second.posted).toHaveLength(4);
    });

    it('re-registers one panel to another tab without leaving its old binding', async () => {
        const { service } = harness({
            13: { id: 13, windowId: 3, active: true },
        });
        const panel = await bound(service, 1, 12, 3);
        service.handleTabActivated({ tabId: 13, windowId: 3 });
        panel.register(2, 13, 3);
        await vi.waitFor(() => expect(panel.posted).toHaveLength(7));
        service.acceptSelectionSnapshot(contentSender(), snapshot());
        expect(panel.posted).toHaveLength(7);
        service.acceptSelectionSnapshot(
            contentSender({ tabId: 13 }),
            snapshot()
        );
        expect(panel.posted).toHaveLength(8);
        expect(panel.posted[7]!.data.binding).toEqual({
            registrationId: 2,
            tabId: 13,
            windowId: 3,
        });
    });
});

describe('SidePanelService selection ownership', () => {
    it('accepts a first owner and projects it to the exact bound panel', async () => {
        const { service } = harness();
        const panel = await bound(service);
        expect(
            service.acceptSelectionSnapshot(
                contentSender(),
                snapshot({
                    entries: [
                        { wordIndex: 0, word: 'hola' },
                        { wordIndex: 2, word: 'hola' },
                    ],
                })
            )
        ).toBe(true);
        expect(panel.posted[3]!.data.selection).toMatchObject({
            selectionOwnerGeneration: 1,
            entries: [
                { wordIndex: 0, word: 'hola' },
                { wordIndex: 2, word: 'hola' },
            ],
        });
    });

    it('accepts a higher selection revision without changing the owner generation', async () => {
        const { service } = harness();
        const panel = await bound(service);
        service.acceptSelectionSnapshot(contentSender(), snapshot());
        expect(
            service.acceptSelectionSnapshot(
                contentSender(),
                snapshot({ selectionRevision: 2, entries: [] })
            )
        ).toBe(true);
        expect(panel.posted[4]!.data.selection).toMatchObject({
            selectionOwnerGeneration: 1,
            selectionRevision: 2,
        });
    });

    it('advances freshness for an exact replay without broadcasting it', async () => {
        const { service } = harness();
        const panel = await bound(service);
        service.acceptSelectionSnapshot(contentSender(), snapshot());
        expect(
            service.acceptSelectionSnapshot(contentSender(), snapshot())
        ).toBe(true);
        expect(panel.posted).toHaveLength(4);
    });

    it('rejects a same-revision mismatch and older revisions without projecting', async () => {
        const { service } = harness();
        const panel = await bound(service);
        service.acceptSelectionSnapshot(
            contentSender(),
            snapshot({ selectionRevision: 3, renderRevision: 2 })
        );
        expect(
            service.acceptSelectionSnapshot(
                contentSender(),
                snapshot({
                    selectionRevision: 3,
                    renderRevision: 2,
                    entries: [],
                })
            )
        ).toBe(false);
        expect(
            service.acceptSelectionSnapshot(
                contentSender(),
                snapshot({ selectionRevision: 2, renderRevision: 2 })
            )
        ).toBe(false);
        expect(
            service.acceptSelectionSnapshot(
                contentSender(),
                snapshot({ selectionRevision: 4, renderRevision: 1 })
            )
        ).toBe(false);
        expect(panel.posted).toHaveLength(4);
    });

    it('mints generations for a changed document, higher lifecycle, and changed window', async () => {
        const { service } = harness();
        const panel = await bound(service);
        service.acceptSelectionSnapshot(contentSender(), snapshot());
        service.acceptSelectionSnapshot(
            contentSender(),
            snapshot({ lifecycleGeneration: 2 })
        );
        expect(panel.posted[4]!.data.selection).toMatchObject({
            selectionOwnerGeneration: 2,
        });
        service.acceptSelectionSnapshot(
            contentSender({ documentId: 'doc-2' }),
            snapshot()
        );
        expect(panel.posted[5]!.data.selection).toMatchObject({
            selectionOwnerGeneration: 3,
        });
        expect(
            service.acceptSelectionSnapshot(
                contentSender({ windowId: 4 }),
                snapshot()
            )
        ).toBe(true);
        // A window change mints an owner but the panel is bound elsewhere.
        expect(panel.posted).toHaveLength(6);
    });

    it('rejects an older lifecycle from the current document owner', async () => {
        const { service } = harness();
        await bound(service);
        service.acceptSelectionSnapshot(
            contentSender(),
            snapshot({ lifecycleGeneration: 2 })
        );
        expect(
            service.acceptSelectionSnapshot(
                contentSender(),
                snapshot({ lifecycleGeneration: 1, selectionRevision: 9 })
            )
        ).toBe(false);
    });

    it('keeps an owner across activation and drops it on navigation and tab removal', async () => {
        const { service, sendToTab } = harness({
            13: { id: 13, windowId: 3, active: true },
        });
        const panel = await bound(service);
        service.acceptSelectionSnapshot(contentSender(), snapshot());

        service.handleTabNavigation(12);
        expect(panel.posted[4]!.data.selection).toBeNull();
        expect(
            service.acceptSelectionSnapshot(contentSender(), snapshot())
        ).toBe(true);
        expect(panel.posted[5]!.data.selection).toMatchObject({
            selectionOwnerGeneration: 2,
        });

        service.handleTabActivated({ tabId: 13, windowId: 3 });
        expect(panel.posted[6]).toEqual({
            action: 'tabActivated',
            data: { tabId: 13, windowId: 3 },
        });
        service.handleTabActivated({ tabId: 12, windowId: 3 });
        sendToTab.mockImplementation((contract, _tabId, request) => {
            if (contract.action === 'sidePanelGetState') {
                service.acceptSelectionSnapshot(contentSender(), snapshot());
                const { data } = request as { data: { requestId: number } };
                return Promise.resolve({
                    requestId: data.requestId,
                    accepted: true,
                } as never);
            }
            return Promise.resolve({ success: true } as never);
        });
        panel.register(2, 12, 3);
        await vi.waitFor(() => expect(panel.posted).toHaveLength(11));
        // The owner survived the detour through tab 13: the replay is
        // projected under the generation minted before it.
        expect(panel.posted[10]!.data.selection).toMatchObject({
            selectionOwnerGeneration: 2,
        });

        service.handleTabRemoved(12);
        expect(panel.port.disconnect).toHaveBeenCalled();
    });

    it('notifies only panels registered to the activated window', async () => {
        const { service } = harness({
            20: { id: 20, windowId: 4, active: true },
        });
        const first = await bound(service, 1, 12, 3);
        const second = await bound(service, 2, 20, 4);
        service.handleTabActivated({ tabId: 21, windowId: 4 });
        expect(first.posted).toHaveLength(3);
        expect(second.posted[3]).toEqual({
            action: 'tabActivated',
            data: { tabId: 21, windowId: 4 },
        });
    });
});

describe('SidePanelService removal', () => {
    const removal = {
        action: 'sidePanelUpdateState',
        data: {
            binding: { registrationId: 1, tabId: 12, windowId: 3 },
            requestId: 1,
            selectionOwnerGeneration: 1,
            selectionRevision: 1,
            renderRevision: 1,
            wordIndex: 2,
        },
    };
    const twoWords = snapshot({
        entries: [
            { wordIndex: 0, word: 'hola' },
            { wordIndex: 2, word: 'amigo' },
        ],
    });

    it('routes one exact occurrence command and reports applied only after the authoritative successor', async () => {
        const { service, sendToTab } = harness();
        const panel = await bound(service);
        service.acceptSelectionSnapshot(contentSender(), twoWords);
        sendToTab.mockImplementation((contract) => {
            if (contract.action === 'sidePanelUpdateState') {
                service.acceptSelectionSnapshot(
                    contentSender(),
                    snapshot({
                        selectionRevision: 2,
                        reason: 'remove',
                        entries: [{ wordIndex: 0, word: 'hola' }],
                    })
                );
                return Promise.resolve({
                    success: true,
                    requestId: 1,
                } as never);
            }
            return Promise.resolve({ success: true } as never);
        });
        panel.emit(removal);
        await vi.waitFor(() => expect(panel.posted).toHaveLength(6));
        expect(sendToTab).toHaveBeenLastCalledWith(
            expect.objectContaining({ action: 'sidePanelUpdateState' }),
            12,
            {
                action: 'sidePanelUpdateState',
                data: {
                    requestId: 1,
                    lifecycleGeneration: 1,
                    selectionRevision: 1,
                    renderRevision: 1,
                    wordIndex: 2,
                },
            },
            { documentId: 'doc-1', frameId: 0 }
        );
        expect(panel.posted[4]!.data.selection).toMatchObject({
            selectionRevision: 2,
            reason: 'remove',
        });
        expect(panel.posted[5]).toEqual({
            action: 'sidePanelUpdateState',
            data: {
                binding: { registrationId: 1, tabId: 12, windowId: 3 },
                requestId: 1,
                selectionOwnerGeneration: 1,
                status: 'applied',
            },
        });
    });

    it('reports rejected when content applied without publishing the successor', async () => {
        const { service, sendToTab } = harness();
        const panel = await bound(service);
        service.acceptSelectionSnapshot(contentSender(), twoWords);
        sendToTab.mockResolvedValue({ success: true, requestId: 1 });
        panel.emit(removal);
        await vi.waitFor(() => expect(panel.posted).toHaveLength(5));
        expect(panel.posted[4]!.data.status).toBe('rejected');
    });

    it('rejects a request that does not match the current owner without contacting content', async () => {
        const { service, sendToTab } = harness();
        const panel = await bound(service);
        service.acceptSelectionSnapshot(contentSender(), twoWords);
        sendToTab.mockClear();
        panel.emit({
            ...removal,
            data: { ...removal.data, selectionRevision: 7 },
        });
        await vi.waitFor(() => expect(panel.posted).toHaveLength(5));
        expect(panel.posted[4]!.data.status).toBe('rejected');
        expect(sendToTab).not.toHaveBeenCalled();
    });

    it('coalesces a duplicate request and synchronously rejects a distinct one behind it', async () => {
        const { service, sendToTab } = harness();
        const panel = await bound(service);
        service.acceptSelectionSnapshot(contentSender(), twoWords);
        let release: () => void = () => undefined;
        sendToTab.mockImplementation(
            () =>
                new Promise((resolve) => {
                    release = () => resolve({ success: false, requestId: 1 });
                })
        );
        panel.emit(removal);
        panel.emit(removal);
        panel.emit({
            ...removal,
            data: { ...removal.data, requestId: 2, wordIndex: 0 },
        });
        expect(panel.posted[4]).toEqual({
            action: 'sidePanelUpdateState',
            data: {
                binding: { registrationId: 1, tabId: 12, windowId: 3 },
                requestId: 2,
                selectionOwnerGeneration: 1,
                status: 'rejected',
            },
        });
        await vi.waitFor(() => expect(sendToTab).toHaveBeenCalledTimes(1));
        release();
        await vi.waitFor(() => expect(panel.posted).toHaveLength(6));
        expect(panel.posted[5]!.data).toMatchObject({
            requestId: 1,
            status: 'rejected',
        });
    });
});

describe('SidePanelService word intents', () => {
    const options: WordIntentOptions = { autoOpen: true, pauseVideo: true };

    it('opens the panel before anything else, force-binds the active tab, then pauses', async () => {
        const { service, sidePanel, sendToTab, tabsGet } = harness();
        const panel = await bound(service);
        service.handleTabActivated({ tabId: 12, windowId: 3 });
        tabsGet.mockClear();
        sendToTab.mockClear();
        const pending = service.handleWordIntent(12, options);
        expect(sidePanel.open).toHaveBeenCalledWith({ tabId: 12 });
        expect(tabsGet).not.toHaveBeenCalled();
        expect(await pending).toBe(true);
        expect(panel.posted.at(-1)).toEqual({
            action: 'sidePanelForceBindTab',
            data: { tabId: 12, windowId: 3 },
        });
        expect(sendToTab).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'sidePanelPauseVideo' }),
            12,
            { action: 'sidePanelPauseVideo' }
        );
    });

    it('does not force-bind an inactive tab and keeps the open successful when the pause fails', async () => {
        const { service, sendToTab, tabTable } = harness();
        const panel = await bound(service);
        tabTable[12] = { id: 12, windowId: 3, active: false };
        sendToTab.mockRejectedValue(new Error('no receiver'));
        expect(await service.handleWordIntent(12, options)).toBe(true);
        expect(
            panel.posted.some(
                (frame) => frame.action === 'sidePanelForceBindTab'
            )
        ).toBe(false);
    });

    it('honors gesture-time snapshots that skip opening or pausing', async () => {
        const { service, sidePanel, sendToTab } = harness();
        expect(
            await service.handleWordIntent(12, {
                autoOpen: false,
                pauseVideo: false,
            })
        ).toBe(true);
        expect(sidePanel.open).not.toHaveBeenCalled();
        expect(sendToTab).not.toHaveBeenCalled();
    });

    it('fails when opening is requested but the API is unavailable', async () => {
        const { service, sendToTab } = harness();
        const noApi = new SidePanelService({
            tabs: { get: () => Promise.reject(new Error('unused')) },
            sidePanel: null,
            sendToTab:
                sendToTab as unknown as SidePanelServiceDeps['sendToTab'],
        });
        void service;
        expect(await noApi.handleWordIntent(12, options)).toBe(false);
        expect(sendToTab).not.toHaveBeenCalled();
    });
});
