import { afterEach, describe, expect, it, vi } from 'vitest';
import { browser, type Browser } from 'wxt/browser';
import {
    activeTabPlatform,
    readTabStatus,
    reloadActiveTab,
} from './contentTab';

function activeTab(
    id: number,
    url?: string,
    pendingUrl?: string
): Browser.tabs.Tab[] {
    return [{ id, url, pendingUrl } as unknown as Browser.tabs.Tab];
}

function stubTabs(tabs: Browser.tabs.Tab[]) {
    vi.spyOn(browser.tabs, 'query').mockResolvedValue(tabs as never);
    return vi
        .spyOn(browser.tabs, 'sendMessage')
        .mockResolvedValue({ onPlayer: true } as never);
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('activeTabPlatform', () => {
    it("names the active tab's site, or null off the supported sites", async () => {
        stubTabs(activeTab(7, 'https://www.netflix.com/watch/1'));
        await expect(activeTabPlatform()).resolves.toBe('netflix');

        stubTabs(activeTab(7, 'https://example.com/'));
        await expect(activeTabPlatform()).resolves.toBeNull();

        stubTabs([]);
        await expect(activeTabPlatform()).resolves.toBeNull();
    });

    it('names the site a tab navigating within it stays on', async () => {
        stubTabs(
            activeTab(
                7,
                'https://www.netflix.com/browse',
                'https://www.netflix.com/watch/81'
            )
        );
        await expect(activeTabPlatform()).resolves.toBe('netflix');
    });

    it('cannot tell the site while the tab is on its way to another', async () => {
        stubTabs(
            activeTab(
                7,
                'https://www.netflix.com/watch/81',
                'https://www.disneyplus.com/'
            )
        );
        await expect(activeTabPlatform()).rejects.toThrow();
        stubTabs(activeTab(7, undefined, 'https://www.netflix.com/'));
        await expect(activeTabPlatform()).rejects.toThrow();
    });
});

describe('readTabStatus', () => {
    it('tells a player from a page that waits for one', async () => {
        const send = stubTabs(activeTab(7));
        await expect(readTabStatus()).resolves.toBe('player');
        expect(send).toHaveBeenCalledWith(
            7,
            { action: 'playerStatus' },
            undefined
        );

        send.mockResolvedValueOnce({ onPlayer: false } as never);
        await expect(readTabStatus()).resolves.toBe('waiting');
    });

    it('knows when DualSub is not running in the page yet', async () => {
        stubTabs(activeTab(7)).mockRejectedValueOnce(
            new Error(
                'Could not establish connection. Receiving end does not exist.'
            )
        );
        await expect(readTabStatus()).resolves.toBe('notRunning');
    });

    it('claims nothing it cannot prove', async () => {
        stubTabs([]);
        await expect(readTabStatus()).resolves.toBe('waiting');

        const send = stubTabs(activeTab(7));
        send.mockResolvedValueOnce({ onPlayer: 'yes' } as never);
        await expect(readTabStatus()).resolves.toBe('waiting');
        send.mockRejectedValueOnce(new Error('The message port closed'));
        await expect(readTabStatus()).resolves.toBe('waiting');
    });
});

describe('reloadActiveTab', () => {
    it('reloads the active tab', async () => {
        stubTabs(activeTab(7));
        const reload = vi
            .spyOn(browser.tabs, 'reload')
            .mockResolvedValue(undefined);
        await reloadActiveTab();
        expect(reload).toHaveBeenCalledWith(7);
    });
});
