import { afterEach, describe, expect, it, vi } from 'vitest';
import { browser, type Browser } from 'wxt/browser';
import { previewContentSettings } from './livePreview';

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
        await previewContentSettings({ subtitleFontSize: 1.5 });
        expect(send).toHaveBeenCalledWith(
            7,
            { action: 'configChanged', changes: { subtitleFontSize: 1.5 } },
            undefined
        );
    });

    it('does nothing without an active tab', async () => {
        const send = stubTabs([]);
        await previewContentSettings({ subtitleFontSize: 1.5 });
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
            subtitleFontSize: 1.4,
            subtitleGap: 0.5,
        });
        const second = previewContentSettings({ subtitleFontSize: 1.8 });
        lookups[1]!(activeTab(7));
        await second;
        lookups[0]!(activeTab(7));
        await first;

        expect(send.mock.calls.map((call) => call[1])).toEqual([
            { action: 'configChanged', changes: { subtitleFontSize: 1.8 } },
            { action: 'configChanged', changes: { subtitleGap: 0.5 } },
        ]);
    });

    it('swallows delivery failures and declined previews', async () => {
        const send = stubTabs(activeTab(7));
        send.mockRejectedValueOnce(new Error('Receiving end does not exist'));
        await expect(
            previewContentSettings({ subtitleFontSize: 1.5 })
        ).resolves.toBeUndefined();

        send.mockResolvedValueOnce({ success: false, error: 'nope' } as never);
        await expect(
            previewContentSettings({ subtitleFontSize: 1.5 })
        ).resolves.toBeUndefined();
    });
});
