// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { getDefaultValue, type SettingsValues } from '@/config/schema';
import { configService } from '@/config/service';
import type { PlatformId } from '@/shared/platforms';
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
            targetLanguage: getDefaultValue('targetLanguage'),
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

    it('keeps the newest save when an earlier one finishes after it', async () => {
        const { result } = renderHook(() => useSettings(KEYS));
        await waitFor(() => expect(result.current.status).toBe('ready'));
        const slow = Promise.withResolvers<Partial<SettingsValues>>();
        vi.spyOn(configService, 'setMultiple')
            .mockReturnValueOnce(slow.promise)
            .mockResolvedValueOnce({ targetLanguage: 'ko' });

        let earlier: Promise<void> = Promise.resolve();
        await act(async () => {
            earlier = result.current.save({ targetLanguage: 'ja' });
            await result.current.save({ targetLanguage: 'ko' });
        });
        await act(async () => {
            slow.resolve({ targetLanguage: 'ja' });
            await earlier;
        });
        expect(result.current.settings?.targetLanguage).toBe('ko');
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

    it('keeps a change that lands while the first read is in flight', async () => {
        const read = Promise.withResolvers<Record<string, unknown>>();
        vi.spyOn(browser.storage.sync, 'get').mockReturnValueOnce(
            read.promise as never
        );
        const { result } = renderHook(() => useSettings(KEYS));
        await fakeBrowser.storage.sync.set({ subtitleFontScale: 2 });
        read.resolve({});
        await waitFor(() => expect(result.current.status).toBe('ready'));
        expect(result.current.settings?.subtitleFontScale).toBe(2);
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

    it("shows a site's view and gives it its own values", async () => {
        await fakeBrowser.storage.sync.set({
            subtitleFontScale: 1.2,
            siteProfiles: { disneyplus: { subtitleFontScale: 1.5 } },
        });
        const { result } = renderHook(() =>
            useSettings(KEYS, { site: 'disneyplus', siteTarget: 'own' })
        );
        await waitFor(() => expect(result.current.status).toBe('ready'));
        expect(result.current.settings?.subtitleFontScale).toBe(1.5);

        await act(() =>
            result.current.save({
                subtitleFontScale: 1.7,
                subtitlesEnabled: false,
            })
        );
        expect(result.current.settings?.subtitleFontScale).toBe(1.7);
        expect(await fakeBrowser.storage.sync.get(null)).toMatchObject({
            subtitleFontScale: 1.2,
            siteProfiles: {
                disneyplus: {
                    subtitleFontScale: 1.7,
                    subtitlesEnabled: false,
                },
            },
        });
    });

    it('shows nothing of the previous site while the next one loads', async () => {
        await fakeBrowser.storage.sync.set({
            subtitleFontScale: 1.2,
            siteProfiles: { netflix: { subtitleFontScale: 1.6 } },
        });
        const { result, rerender } = renderHook(
            ({ site }: { site: PlatformId }) => useSettings(KEYS, { site }),
            { initialProps: { site: 'netflix' } }
        );
        await waitFor(() => expect(result.current.status).toBe('ready'));
        expect(result.current.settings?.subtitleFontScale).toBe(1.6);

        rerender({ site: 'disneyplus' });
        expect(result.current.status).toBe('loading');
        expect(result.current.settings).toBeNull();
        await waitFor(() => expect(result.current.status).toBe('ready'));
        expect(result.current.settings?.subtitleFontScale).toBe(1.2);
    });
});
