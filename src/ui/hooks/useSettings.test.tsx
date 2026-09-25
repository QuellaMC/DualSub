// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { useSettings } from './useSettings';

const KEYS = [
    'subtitlesEnabled',
    'subtitleFontScale',
    'targetLanguage',
] as const;

describe('useSettings', () => {
    beforeEach(async () => {
        await fakeBrowser.storage.sync.clear();
        await fakeBrowser.storage.local.clear();
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('loads the projection from storage with schema defaults filling gaps', async () => {
        await fakeBrowser.storage.sync.set({ subtitleFontScale: 2 });
        const { result } = renderHook(() => useSettings(KEYS));
        expect(result.current.status).toBe('loading');
        expect(result.current.settings).toBeNull();

        await waitFor(() => expect(result.current.status).toBe('ready'));
        expect(result.current.settings).toEqual({
            subtitlesEnabled: true,
            subtitleFontScale: 2,
            targetLanguage: 'zh-CN',
        });
    });

    it('writes through save and reflects the persisted values', async () => {
        const { result } = renderHook(() => useSettings(KEYS));
        await waitFor(() => expect(result.current.status).toBe('ready'));

        await act(() => result.current.save({ subtitleFontScale: 1.5 }));
        expect(result.current.settings?.subtitleFontScale).toBe(1.5);
        expect(await fakeBrowser.storage.sync.get('subtitleFontScale')).toEqual(
            {
                subtitleFontScale: 1.5,
            }
        );
    });

    it('rejects an invalid write and leaves the projection untouched', async () => {
        const { result } = renderHook(() => useSettings(KEYS));
        await waitFor(() => expect(result.current.status).toBe('ready'));

        await act(async () => {
            await expect(
                result.current.save({ subtitleFontScale: 99 })
            ).rejects.toThrow();
        });
        expect(result.current.settings?.subtitleFontScale).toBe(1);
        expect(await fakeBrowser.storage.sync.get('subtitleFontScale')).toEqual(
            {}
        );
    });

    it('follows storage changes made elsewhere', async () => {
        const { result } = renderHook(() => useSettings(KEYS));
        await waitFor(() => expect(result.current.status).toBe('ready'));

        await fakeBrowser.storage.sync.set({ targetLanguage: 'ja' });
        await waitFor(() =>
            expect(result.current.settings?.targetLanguage).toBe('ja')
        );
    });

    it('reports an unreadable store, then recovers on the next change', async () => {
        vi.spyOn(browser.storage.sync, 'get').mockRejectedValueOnce(
            new Error('storage broken')
        );
        const { result } = renderHook(() => useSettings(KEYS));
        await waitFor(() => expect(result.current.status).toBe('unavailable'));
        expect(result.current.settings).toBeNull();

        await fakeBrowser.storage.sync.set({ subtitleFontScale: 2 });
        await waitFor(() => expect(result.current.status).toBe('ready'));
        expect(result.current.settings?.subtitleFontScale).toBe(2);
    });
});
