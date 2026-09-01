import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
    ConfigServiceReadError,
    ConfigValidationError,
    ConfigWriteError,
    configService,
} from './service';
import { getKeysByScope } from './schema';

describe('configService', () => {
    beforeEach(async () => {
        await fakeBrowser.storage.sync.clear();
        await fakeBrowser.storage.local.clear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('get', () => {
        it('returns the stored value when valid', async () => {
            await fakeBrowser.storage.sync.set({ subtitleFontSize: 2.2 });
            await expect(configService.get('subtitleFontSize')).resolves.toBe(
                2.2
            );
        });

        it('falls back to the schema default when unset or invalid', async () => {
            await expect(configService.get('subtitleFontSize')).resolves.toBe(
                1.1
            );
            await fakeBrowser.storage.sync.set({ subtitleFontSize: 99 });
            await expect(configService.get('subtitleFontSize')).resolves.toBe(
                1.1
            );
        });

        it('resolves the default when storage fails (silent fallback)', async () => {
            vi.spyOn(browser.storage.sync, 'get').mockRejectedValueOnce(
                new Error('storage broken')
            );
            await expect(configService.get('subtitleFontSize')).resolves.toBe(
                1.1
            );
        });

        it('returns undefined for unknown keys', async () => {
            await expect(configService.get('nope')).resolves.toBeUndefined();
        });
    });

    describe('set', () => {
        it('persists the normalized canonical value and returns it detached', async () => {
            const returned = await configService.set('targetLanguage', 'zh-cn');
            expect(returned).toBe('zh-CN');
            expect(
                (await fakeBrowser.storage.sync.get('targetLanguage'))
                    .targetLanguage
            ).toBe('zh-CN');
        });

        it('rejects invalid values without writing', async () => {
            await expect(
                configService.set('subtitleFontSize', 99)
            ).rejects.toThrow('Invalid value');
            expect(
                await fakeBrowser.storage.sync.get('subtitleFontSize')
            ).toEqual({});
        });

        it('routes sensitive keys to local storage', async () => {
            await configService.set('deeplApiKey', 'secret');
            expect(
                (await fakeBrowser.storage.local.get('deeplApiKey')).deeplApiKey
            ).toBe('secret');
            expect(await fakeBrowser.storage.sync.get('deeplApiKey')).toEqual(
                {}
            );
        });
    });

    describe('read result bundles', () => {
        it('distinguishes stored, default-missing, and default-invalid sources', async () => {
            await fakeBrowser.storage.sync.set({
                subtitleFontSize: 2,
                subtitleGap: 'bogus',
            });
            const result = await configService.readMultipleResult([
                'subtitleFontSize',
                'subtitleGap',
                'subtitlesEnabled',
            ]);
            expect(result.ok).toBe(true);
            expect(result.sources.subtitleFontSize?.source).toBe('stored');
            expect(result.sources.subtitleGap?.source).toBe(
                'schema-default-invalid'
            );
            expect(result.sources.subtitlesEnabled?.source).toBe(
                'schema-default-missing'
            );
            expect(result.values.subtitleGap).toBe(0.3);
        });

        it('reports degraded areas with display fallbacks instead of fake success', async () => {
            vi.spyOn(browser.storage.sync, 'get').mockRejectedValueOnce(
                new Error('quota exceeded')
            );
            const result = await configService.readMultipleResult([
                'subtitleFontSize',
                'debugMode',
            ]);
            expect(result.ok).toBe(false);
            expect(result.degraded).toBe(true);
            expect(result.failedAreas).toEqual(['sync']);
            expect(result.areas.sync.status).toBe('error');
            expect(result.areas.local.status).toBe('ok');
            expect(result.values.subtitleFontSize).toBeUndefined();
            expect(result.displayFallbacks.subtitleFontSize).toBe(1.1);
        });

        it('treats unknown and sensitive-excluded keys as metadata, not failure', async () => {
            const result = await configService.readMultipleResult([
                'mysteryKey',
                'deeplApiKey',
                'subtitlesEnabled',
            ]);
            expect(result.ok).toBe(true);
            expect(result.unknownKeys).toEqual(['mysteryKey']);
            expect(result.excludedSensitiveKeys).toEqual(['deeplApiKey']);
            expect(result.values).not.toHaveProperty('deeplApiKey');
        });

        it('includes sensitive values only for an exact includeSensitive option', async () => {
            await fakeBrowser.storage.local.set({ deeplApiKey: 'secret' });
            const denied = await configService.readResult('deeplApiKey', {});
            expect(denied.values).not.toHaveProperty('deeplApiKey');

            const granted = await configService.readResult('deeplApiKey', {
                includeSensitive: true,
            });
            expect(granted.values.deeplApiKey).toBe('secret');
        });

        it('getAll throws ConfigServiceReadError when an area fails', async () => {
            vi.spyOn(browser.storage.local, 'get').mockRejectedValueOnce(
                new Error('broken')
            );
            await expect(configService.getAll()).rejects.toBeInstanceOf(
                ConfigServiceReadError
            );
        });
    });

    describe('readStoredBooleanStrict', () => {
        it('returns a genuinely stored boolean', async () => {
            await fakeBrowser.storage.sync.set({ aiContextEnabled: true });
            await expect(
                configService.readStoredBooleanStrict('aiContextEnabled')
            ).resolves.toBe(true);
        });

        it('fails closed for missing, invalid, or non-boolean keys', async () => {
            await expect(
                configService.readStoredBooleanStrict('aiContextEnabled')
            ).rejects.toThrow('unavailable');

            await fakeBrowser.storage.sync.set({ aiContextEnabled: 'yes' });
            await expect(
                configService.readStoredBooleanStrict('aiContextEnabled')
            ).rejects.toThrow('unavailable');

            await expect(
                configService.readStoredBooleanStrict('targetLanguage')
            ).rejects.toThrow('unavailable');
        });

        it('propagates storage failure as a read error, never a value', async () => {
            vi.spyOn(browser.storage.sync, 'get').mockRejectedValueOnce(
                new Error('broken')
            );
            await expect(
                configService.readStoredBooleanStrict('aiContextEnabled')
            ).rejects.toBeInstanceOf(ConfigServiceReadError);
        });
    });

    describe('setMultiple', () => {
        it('validates everything before writing anything', async () => {
            await expect(
                configService.setMultiple({
                    subtitlesEnabled: false,
                    subtitleFontSize: 99,
                })
            ).rejects.toBeInstanceOf(ConfigValidationError);
            expect(
                await fakeBrowser.storage.sync.get('subtitlesEnabled')
            ).toEqual({});
        });

        it('splits writes by scope and returns prepared values', async () => {
            const result = await configService.setMultiple({
                subtitlesEnabled: false,
                debugMode: true,
            });
            expect(result).toEqual({
                subtitlesEnabled: false,
                debugMode: true,
            });
            expect(
                (await fakeBrowser.storage.sync.get('subtitlesEnabled'))
                    .subtitlesEnabled
            ).toBe(false);
            expect(
                (await fakeBrowser.storage.local.get('debugMode')).debugMode
            ).toBe(true);
        });

        it('aggregates partial area failures', async () => {
            vi.spyOn(browser.storage.local, 'set').mockRejectedValueOnce(
                new Error('local broken')
            );
            await expect(
                configService.setMultiple({
                    subtitlesEnabled: false,
                    debugMode: true,
                })
            ).rejects.toMatchObject({
                name: 'ConfigWriteError',
                completeFailure: false,
                failedAreas: ['local'],
            });
            expect(
                (await fakeBrowser.storage.sync.get('subtitlesEnabled'))
                    .subtitlesEnabled
            ).toBe(false);
        });
    });

    describe('setDefaultsForMissingKeys', () => {
        it('repairs missing and invalid keys to canonical values', async () => {
            await fakeBrowser.storage.sync.set({ subtitleFontSize: 99 });
            await configService.setDefaultsForMissingKeys();

            const sync = await fakeBrowser.storage.sync.get(null);
            expect(Object.keys(sync).sort()).toEqual(
                getKeysByScope('sync').sort()
            );
            expect(sync.subtitleFontSize).toBe(1.1);
            const local = await fakeBrowser.storage.local.get(null);
            expect(Object.keys(local).sort()).toEqual(
                getKeysByScope('local').sort()
            );
        });

        it('leaves valid stored values untouched', async () => {
            await fakeBrowser.storage.sync.set({ subtitleFontSize: 2.5 });
            await configService.setDefaultsForMissingKeys();
            expect(
                (await fakeBrowser.storage.sync.get('subtitleFontSize'))
                    .subtitleFontSize
            ).toBe(2.5);
        });

        it('skips an unreadable area and repairs the other', async () => {
            vi.spyOn(browser.storage.sync, 'get').mockRejectedValueOnce(
                new Error('sync down')
            );
            await configService.setDefaultsForMissingKeys();
            expect(await fakeBrowser.storage.sync.get(null)).toEqual({});
            expect(
                Object.keys(await fakeBrowser.storage.local.get(null)).sort()
            ).toEqual(getKeysByScope('local').sort());
        });

        it('throws ConfigWriteError only when every repair write failed', async () => {
            vi.spyOn(browser.storage.sync, 'set').mockRejectedValue(
                new Error('sync down')
            );
            vi.spyOn(browser.storage.local, 'set').mockRejectedValue(
                new Error('local down')
            );
            await expect(
                configService.setDefaultsForMissingKeys()
            ).rejects.toBeInstanceOf(ConfigWriteError);
        });
    });

    describe('change broadcast', () => {
        it('projects changes through the schema and filters sensitive keys per listener', async () => {
            const plain = vi.fn();
            const privileged = vi.fn();
            const unsubscribePlain = configService.onChanged(plain);
            const unsubscribePrivileged = configService.onChanged(privileged, {
                includeSensitive: true,
            });

            await configService.set('deeplApiKey', 'secret');
            await configService.set('subtitleFontSize', 2);
            await vi.waitFor(() => {
                expect(privileged).toHaveBeenCalledWith({
                    deeplApiKey: 'secret',
                });
                expect(plain).toHaveBeenCalledWith({ subtitleFontSize: 2 });
            });
            expect(plain).not.toHaveBeenCalledWith({ deeplApiKey: 'secret' });

            unsubscribePlain();
            unsubscribePrivileged();
        });

        it('projects an invalid external write as the schema default', async () => {
            const listener = vi.fn();
            const unsubscribe = configService.onChanged(listener);
            await fakeBrowser.storage.sync.set({ subtitleFontSize: 99 });
            await vi.waitFor(() => {
                expect(listener).toHaveBeenCalledWith({
                    subtitleFontSize: 1.1,
                });
            });
            unsubscribe();
        });

        it('stops delivering after unsubscribe and isolates listener failures', async () => {
            const failing = vi.fn(() => {
                throw new Error('listener bug');
            });
            const healthy = vi.fn();
            configService.onChanged(failing)();
            const unsubscribe = configService.onChanged(healthy);

            await configService.set('subtitleGap', 0.5);
            await vi.waitFor(() => {
                expect(healthy).toHaveBeenCalledWith({ subtitleGap: 0.5 });
            });
            expect(failing).not.toHaveBeenCalled();
            unsubscribe();
        });
    });

    describe('detachment', () => {
        it('mutating a returned collection never affects later reads', async () => {
            const first = (await configService.get('subtitleBlacklist')) as {
                disneyplus: string[];
            };
            first.disneyplus.push('mutated');
            const second = (await configService.get('subtitleBlacklist')) as {
                disneyplus: string[];
            };
            expect(second.disneyplus).not.toContain('mutated');
        });
    });
});
