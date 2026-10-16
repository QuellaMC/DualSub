import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
    prepareSettingValue,
    sameSettingValue,
    validateSetting,
} from './schema';
import { configService, type SettingsChanges } from './service';

async function stored(): Promise<unknown> {
    return (await fakeBrowser.storage.sync.get('siteProfiles')).siteProfiles;
}

describe('siteProfiles values', () => {
    it('keeps each site’s valid site settings, canonicalized', () => {
        expect(
            prepareSettingValue('siteProfiles', {
                netflix: { subtitleFontScale: 1.3, originalLanguage: 'KO' },
                disneyplus: { subtitlesEnabled: false },
            })
        ).toEqual({
            netflix: { subtitleFontScale: 1.3, originalLanguage: 'ko' },
            disneyplus: { subtitlesEnabled: false },
        });
    });

    it('drops what this version does not know or accept, keeping the rest', () => {
        expect(
            prepareSettingValue('siteProfiles', {
                netflix: {
                    subtitleFontScale: 99,
                    subtitleGap: 0.5,
                    futureSetting: true,
                    selectedProvider: 'deepl',
                },
                hulu: { subtitleGap: 0.1 },
                disneyplus: { subtitleFontScale: 'big' },
            })
        ).toEqual({ netflix: { subtitleGap: 0.5 } });
    });

    it('fails the whole value on signs of tampering', () => {
        const hostile = JSON.parse(
            '{"netflix":{"__proto__":{"subtitleGap":0.5}}}'
        ) as unknown;
        expect(validateSetting('siteProfiles', hostile)).toBe(false);
        expect(validateSetting('siteProfiles', [])).toBe(false);
        expect(validateSetting('siteProfiles', { netflix: [1] })).toBe(false);
    });

    it('compares setting values deeply, ignoring key order', () => {
        expect(sameSettingValue({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(
            true
        );
        expect(sameSettingValue({ a: 1 }, { a: 1, b: undefined })).toBe(false);
        expect(sameSettingValue([1, 2], [2, 1])).toBe(false);
    });
});

describe('configService for one site', () => {
    beforeEach(async () => {
        await fakeBrowser.storage.sync.clear();
        await fakeBrowser.storage.local.clear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("reads a site's own values over the shared ones", async () => {
        await fakeBrowser.storage.sync.set({
            subtitleFontScale: 1.2,
            subtitleGap: 0.4,
            siteProfiles: { netflix: { subtitleFontScale: 1.6 } },
        });
        const netflix = configService.forSite('netflix');
        await expect(netflix.get('subtitleFontScale')).resolves.toBe(1.6);
        await expect(
            netflix.getMultiple(['subtitleFontScale', 'subtitleGap'])
        ).resolves.toEqual({ subtitleFontScale: 1.6, subtitleGap: 0.4 });
        await expect(
            configService.forSite('disneyplus').get('subtitleFontScale')
        ).resolves.toBe(1.2);
        await expect(configService.get('subtitleFontScale')).resolves.toBe(1.2);

        const { values } = await configService.readMultipleResultStrict(
            ['subtitleFontScale'],
            { site: 'netflix' }
        );
        expect(values).toEqual({ subtitleFontScale: 1.6 });
    });

    it('gives a site its own values, and drops one equal to the shared value', async () => {
        await fakeBrowser.storage.sync.set({ subtitleFontScale: 1.2 });
        await configService.setMultiple(
            { subtitleFontScale: 1.6, uiLanguage: 'ja' },
            { site: 'netflix', target: 'own' }
        );
        expect(await stored()).toEqual({
            netflix: { subtitleFontScale: 1.6 },
        });
        expect(
            await fakeBrowser.storage.sync.get([
                'subtitleFontScale',
                'uiLanguage',
            ])
        ).toEqual({ subtitleFontScale: 1.2, uiLanguage: 'ja' });

        await configService.setMultiple(
            { subtitleFontScale: 1.2 },
            { site: 'netflix', target: 'own' }
        );
        expect(await stored()).toEqual({});
    });

    it('changes each value where the site gets it from', async () => {
        await fakeBrowser.storage.sync.set({
            subtitleFontScale: 1.2,
            subtitleGap: 0.3,
            siteProfiles: { netflix: { subtitleFontScale: 1.6 } },
        });
        await configService.setMultiple(
            { subtitleFontScale: 2, subtitleGap: 0.5 },
            { site: 'netflix', target: 'source' }
        );
        expect(await stored()).toEqual({ netflix: { subtitleFontScale: 2 } });
        expect(
            await fakeBrowser.storage.sync.get([
                'subtitleFontScale',
                'subtitleGap',
            ])
        ).toEqual({ subtitleFontScale: 1.2, subtitleGap: 0.5 });
    });

    it("keeps a site's own value its own when a source write makes it equal the shared one", async () => {
        await fakeBrowser.storage.sync.set({
            subtitleTimeOffset: 0,
            siteProfiles: { netflix: { subtitleTimeOffset: 0.5 } },
        });
        const netflix = { site: 'netflix', target: 'source' } as const;
        await configService.setMultiple({ subtitleTimeOffset: 0 }, netflix);
        expect(await stored()).toEqual({
            netflix: { subtitleTimeOffset: 0 },
        });
        await configService.setMultiple({ subtitleTimeOffset: 0.5 }, netflix);
        expect(await stored()).toEqual({
            netflix: { subtitleTimeOffset: 0.5 },
        });
        expect(
            (await fakeBrowser.storage.sync.get('subtitleTimeOffset'))
                .subtitleTimeOffset
        ).toBe(0);
    });

    it('lets a site follow the shared values again', async () => {
        await fakeBrowser.storage.sync.set({
            siteProfiles: {
                netflix: { subtitleFontScale: 1.6, subtitleGap: 0.5 },
                disneyplus: { subtitlesEnabled: false },
            },
        });
        await configService.removeSiteValues('netflix', ['subtitleFontScale']);
        expect(await stored()).toEqual({
            netflix: { subtitleGap: 0.5 },
            disneyplus: { subtitlesEnabled: false },
        });
        await configService.removeSiteValues('netflix', ['subtitleGap']);
        expect(await stored()).toEqual({
            disneyplus: { subtitlesEnabled: false },
        });
    });

    it('writes nothing when the profiles cannot be read', async () => {
        await fakeBrowser.storage.sync.set({
            siteProfiles: { netflix: { subtitleGap: 0.5 } },
        });
        vi.spyOn(fakeBrowser.storage.sync, 'get').mockRejectedValueOnce(
            new Error('storage broken')
        );
        await expect(
            configService.removeSiteValues('disneyplus', ['subtitleGap'])
        ).rejects.toThrow();
        expect(await stored()).toEqual({ netflix: { subtitleGap: 0.5 } });
    });

    it('leaves a canonical profile alone during startup repair', async () => {
        const profiles = { netflix: { subtitleGap: 0.5 } };
        await fakeBrowser.storage.sync.set({ siteProfiles: profiles });
        const set = vi.spyOn(fakeBrowser.storage.sync, 'set');
        await configService.setDefaultsForMissingKeys();
        const writes = set.mock.calls.map(([items]) => Object.keys(items));
        expect(writes.flat()).not.toContain('siteProfiles');
    });

    describe('change events', () => {
        function listen(): {
            changes: SettingsChanges[];
            stop: () => void;
        } {
            const changes: SettingsChanges[] = [];
            const stop = configService
                .forSite('netflix')
                .onChanged((change) => changes.push(change));
            return { changes, stop };
        }

        it('reports a shared change the site sees, and hides one it overrides', async () => {
            await fakeBrowser.storage.sync.set({
                siteProfiles: { netflix: { subtitleFontScale: 1.6 } },
            });
            const { changes, stop } = listen();
            await fakeBrowser.storage.sync.set({
                subtitleFontScale: 2,
                subtitleGap: 0.5,
                uiLanguage: 'ko',
            });
            await vi.waitFor(() => expect(changes).toHaveLength(1));
            expect(changes[0]).toEqual({ subtitleGap: 0.5, uiLanguage: 'ko' });
            stop();
        });

        it("reports the site's own values as they come and go", async () => {
            await fakeBrowser.storage.sync.set({ subtitleFontScale: 1.2 });
            const { changes, stop } = listen();

            await configService.setMultiple(
                { subtitleFontScale: 1.6 },
                { site: 'netflix', target: 'own' }
            );
            await vi.waitFor(() => expect(changes).toHaveLength(1));
            expect(changes[0]).toMatchObject({ subtitleFontScale: 1.6 });

            await configService.removeSiteValues('netflix', [
                'subtitleFontScale',
            ]);
            await vi.waitFor(() => expect(changes).toHaveLength(2));
            expect(changes[1]).toMatchObject({ subtitleFontScale: 1.2 });

            await configService.setMultiple(
                { subtitleGap: 0.6 },
                { site: 'disneyplus', target: 'own' }
            );
            await vi.waitFor(() => expect(changes).toHaveLength(3));
            expect(changes[2]).not.toHaveProperty('subtitleGap');
            stop();
        });
    });
});
