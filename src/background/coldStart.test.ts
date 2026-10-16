import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { resetConfigurationMigrationForTests } from '@/config/migrations';
import { configService } from '@/config/service';
import {
    TEST_EXTENSION_ID,
    TEST_EXTENSION_ORIGIN,
    installExtensionRuntimeIdentity,
} from '@/test-utils/extensionRuntime';
import background from '@/entrypoints/background';

// A service worker woken by an event drops that event unless its listener
// exists by the time the entry module has run: every listener must be
// registered synchronously, before the first await of initialization.

const sidepanelSender = {
    id: TEST_EXTENSION_ID,
    url: `${TEST_EXTENSION_ORIGIN}/sidepanel.html`,
};

interface Readiness {
    ready: boolean;
    services: Record<string, boolean>;
}

/** fake-browser has no runtime.onConnect; this is the same in-memory shape. */
function connectEvent() {
    const listeners = new Set<(port: unknown) => void>();
    return {
        addListener: (listener: (port: unknown) => void) => {
            listeners.add(listener);
        },
        removeListener: (listener: (port: unknown) => void) => {
            listeners.delete(listener);
        },
        hasListener: (listener: (port: unknown) => void) =>
            listeners.has(listener),
        hasListeners: () => listeners.size > 0,
        trigger: (port: unknown) => {
            for (const listener of listeners) {
                listener(port);
            }
        },
    };
}

async function probe(): Promise<Readiness> {
    const responses: Readiness[] = [];
    // The listener answers through sendResponse; its own return value is
    // only the "keep the channel open" flag.
    void (await fakeBrowser.runtime.onMessage.trigger(
        { action: 'checkBackgroundReady' },
        sidepanelSender,
        (response: Readiness) => {
            responses.push(response);
        }
    ));
    await vi.waitFor(() => expect(responses).toHaveLength(1));
    return responses[0]!;
}

describe('background cold start', () => {
    beforeEach(() => {
        fakeBrowser.reset();
        installExtensionRuntimeIdentity();
    });

    it('registers every listener synchronously and parks requests until services are ready', async () => {
        const onConnect = connectEvent();
        (fakeBrowser.runtime as { onConnect: unknown }).onConnect = onConnect;
        background.main();

        expect(fakeBrowser.runtime.onMessage.hasListeners()).toBe(true);
        expect(onConnect.hasListeners()).toBe(true);
        expect(fakeBrowser.runtime.onInstalled.hasListeners()).toBe(true);
        expect(fakeBrowser.tabs.onActivated.hasListeners()).toBe(true);
        expect(fakeBrowser.tabs.onRemoved.hasListeners()).toBe(true);
        expect(fakeBrowser.tabs.onUpdated.hasListeners()).toBe(true);

        // The probe is answered from the synchronous part of startup: the
        // in-memory services are up, the ones that read storage are not yet.
        const cold = await probe();
        expect(cold).toEqual({
            ready: false,
            services: {
                subtitle: true,
                aiContext: true,
                translation: false,
                aiContextInitialized: false,
            },
        });

        await vi.waitFor(async () => {
            expect((await probe()).ready).toBe(true);
        });

        // An untrusted port is refused by the connect listener, which proves
        // the side panel path is wired without needing a real panel.
        const port = {
            name: 'sidepanel',
            sender: { id: 'someone-else', url: 'https://example.com' },
            disconnect: vi.fn(),
            postMessage: vi.fn(),
            onMessage: { addListener: vi.fn() },
            onDisconnect: { addListener: vi.fn() },
        };
        onConnect.trigger(port);
        expect(port.disconnect).toHaveBeenCalledOnce();
    });

    it('repairs the settings once on install, then opens the welcome page', async () => {
        const repair = vi.spyOn(configService, 'setDefaultsForMissingKeys');
        const openTab = vi.spyOn(fakeBrowser.tabs, 'create');
        background.main();
        await fakeBrowser.runtime.onInstalled.trigger({
            reason: 'install',
        } as never);
        await vi.waitFor(() => expect(openTab).toHaveBeenCalledOnce());
        expect(repair).toHaveBeenCalledOnce();
        expect(repair.mock.invocationCallOrder[0]).toBeLessThan(
            openTab.mock.invocationCallOrder[0]!
        );
    });

    it('writes no defaults when the migration fails, so old values can still seed them', async () => {
        resetConfigurationMigrationForTests();
        const repair = vi.spyOn(configService, 'setDefaultsForMissingKeys');
        const openTab = vi.spyOn(fakeBrowser.tabs, 'create');
        repair.mockClear();
        openTab.mockClear();
        vi.spyOn(fakeBrowser.storage.sync, 'get').mockRejectedValueOnce(
            new Error('sync unavailable')
        );
        background.main();
        await fakeBrowser.runtime.onInstalled.trigger({
            reason: 'install',
        } as never);
        await vi.waitFor(() => expect(openTab).toHaveBeenCalledOnce());
        expect(repair).not.toHaveBeenCalled();
    });
});
