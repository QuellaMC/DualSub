import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
    TEST_EXTENSION_ORIGIN,
    installExtensionRuntimeIdentity,
} from '@/test-utils/extensionRuntime';
import { registerWelcomePage } from './welcome';

describe('welcome page', () => {
    beforeEach(() => {
        fakeBrowser.reset();
        installExtensionRuntimeIdentity();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('opens on install only, not when DualSub or the browser updates', async () => {
        const create = vi
            .spyOn(browser.tabs, 'create')
            .mockResolvedValue({} as never);
        registerWelcomePage(Promise.resolve());

        await fakeBrowser.runtime.onInstalled.trigger({
            reason: 'update',
            previousVersion: '3.0.2',
        });
        await fakeBrowser.runtime.onInstalled.trigger({
            reason: 'chrome_update',
        });
        await Promise.resolve();
        expect(create).not.toHaveBeenCalled();

        await fakeBrowser.runtime.onInstalled.trigger({ reason: 'install' });
        await vi.waitFor(() =>
            expect(create).toHaveBeenCalledExactlyOnceWith({
                url: `${TEST_EXTENSION_ORIGIN}/welcome.html`,
            })
        );
    });

    it('waits until the settings are repaired before it opens', async () => {
        const create = vi
            .spyOn(browser.tabs, 'create')
            .mockResolvedValue({} as never);
        const repaired = Promise.withResolvers<void>();
        registerWelcomePage(repaired.promise);

        await fakeBrowser.runtime.onInstalled.trigger({ reason: 'install' });
        await Promise.resolve();
        expect(create).not.toHaveBeenCalled();

        repaired.resolve();
        await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
    });

    it('lets a tab that cannot open pass without breaking the install', async () => {
        vi.spyOn(browser.tabs, 'create').mockRejectedValue(
            new Error('No window')
        );
        registerWelcomePage(Promise.resolve());
        await expect(
            fakeBrowser.runtime.onInstalled.trigger({ reason: 'install' })
        ).resolves.not.toThrow();
    });
});
