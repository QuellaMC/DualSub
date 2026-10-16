import { beforeEach, describe, expect, it, vi } from 'vitest';
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

    it('opens on install only, not when DualSub or the browser updates', async () => {
        const create = vi
            .spyOn(browser.tabs, 'create')
            .mockResolvedValue({} as never);
        registerWelcomePage();

        await fakeBrowser.runtime.onInstalled.trigger({
            reason: 'update',
            previousVersion: '3.0.2',
        });
        await fakeBrowser.runtime.onInstalled.trigger({
            reason: 'chrome_update',
        });
        expect(create).not.toHaveBeenCalled();

        await fakeBrowser.runtime.onInstalled.trigger({
            reason: 'install',
        });
        expect(create).toHaveBeenCalledExactlyOnceWith({
            url: `${TEST_EXTENSION_ORIGIN}/welcome.html`,
        });
    });
});
