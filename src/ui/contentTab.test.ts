import { afterEach, describe, expect, it, vi } from 'vitest';
import { browser, type Browser } from 'wxt/browser';
import { previewContentSettings, readPlatformLookStatus } from './contentTab';

function activeTab(id: number): Browser.tabs.Tab[] {
    return [{ id } as unknown as Browser.tabs.Tab];
}

function stubTabs(tabs: Browser.tabs.Tab[]) {
    vi.spyOn(browser.tabs, 'query').mockResolvedValue(tabs as never);
    return vi
        .spyOn(browser.tabs, 'sendMessage')
        .mockResolvedValue({ success: true } as never);
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('previewContentSettings', () => {
    it('sends the changes to the active tab as a configChanged request', async () => {
        const send = stubTabs(activeTab(7));
        await previewContentSettings({ subtitleFontScale: 1.5 });
        expect(send).toHaveBeenCalledWith(
            7,
            { action: 'configChanged', changes: { subtitleFontScale: 1.5 } },
            undefined
        );
    });

    it('does nothing without an active tab', async () => {
        const send = stubTabs([]);
        await previewContentSettings({ subtitleFontScale: 1.5 });
        expect(send).not.toHaveBeenCalled();
    });

    it('drops a stale same-key value when tab lookups resolve out of order', async () => {
        const lookups: ((tabs: Browser.tabs.Tab[]) => void)[] = [];
        const query = vi.spyOn(browser.tabs, 'query');
        for (let i = 0; i < 2; i += 1) {
            const { promise, resolve } =
                Promise.withResolvers<Browser.tabs.Tab[]>();
            lookups.push(resolve);
            query.mockReturnValueOnce(promise as never);
        }
        const send = vi
            .spyOn(browser.tabs, 'sendMessage')
            .mockResolvedValue({ success: true } as never);

        const first = previewContentSettings({
            subtitleFontScale: 1.4,
            subtitleGap: 0.5,
        });
        const second = previewContentSettings({ subtitleFontScale: 1.8 });
        lookups[1]!(activeTab(7));
        await second;
        lookups[0]!(activeTab(7));
        await first;

        expect(send.mock.calls.map((call) => call[1])).toEqual([
            { action: 'configChanged', changes: { subtitleFontScale: 1.8 } },
            { action: 'configChanged', changes: { subtitleGap: 0.5 } },
        ]);
    });

    it('swallows delivery failures and declined previews', async () => {
        const send = stubTabs(activeTab(7));
        send.mockRejectedValueOnce(new Error('Receiving end does not exist'));
        await expect(
            previewContentSettings({ subtitleFontScale: 1.5 })
        ).resolves.toBeUndefined();

        send.mockResolvedValueOnce({ success: false, error: 'nope' } as never);
        await expect(
            previewContentSettings({ subtitleFontScale: 1.5 })
        ).resolves.toBeUndefined();
    });
});

describe('readPlatformLookStatus', () => {
    it('asks the active tab what Match Platform draws from', async () => {
        const send = stubTabs(activeTab(7));
        send.mockResolvedValueOnce({
            onPlayer: true,
            platform: 'disneyplus',
            captured: true,
        } as never);
        await expect(readPlatformLookStatus()).resolves.toEqual({
            onPlayer: true,
            platform: 'disneyplus',
            captured: true,
        });
        expect(send).toHaveBeenCalledWith(
            7,
            { action: 'platformLookStatus' },
            undefined
        );
    });

    it('is null without an active tab, a content script, a player route, or a sound answer', async () => {
        stubTabs([]);
        await expect(readPlatformLookStatus()).resolves.toBeNull();

        stubTabs(activeTab(7)).mockResolvedValueOnce({
            onPlayer: false,
        } as never);
        await expect(readPlatformLookStatus()).resolves.toBeNull();

        const send = stubTabs(activeTab(7));
        send.mockRejectedValueOnce(new Error('Receiving end does not exist'));
        await expect(readPlatformLookStatus()).resolves.toBeNull();

        send.mockResolvedValueOnce({ platform: 'hulu', captured: 1 } as never);
        await expect(readPlatformLookStatus()).resolves.toBeNull();
    });
});
