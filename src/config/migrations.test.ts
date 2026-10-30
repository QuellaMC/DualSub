import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
    migrateLegacyConfiguration,
    resetConfigurationMigrationForTests,
} from './migrations';
import { keyEntry } from '@/shared/keyOrigins';
import { configService } from './service';

async function syncState(): Promise<Record<string, unknown>> {
    return fakeBrowser.storage.sync.get(null);
}
async function localState(): Promise<Record<string, unknown>> {
    return fakeBrowser.storage.local.get(null);
}

/** Make `edit` once the migration has found storage and before its turn,
 *  as a settings page could. */
function editOnceItLooks(edit: () => Promise<unknown>): void {
    const read = browser.storage.local.get.bind(browser.storage.local);
    let edited = false;
    vi.spyOn(browser.storage.local, 'get').mockImplementation(((
        keys: string[] | null
    ) =>
        read(keys).then(async (items) => {
            // Only the read that finds storage: the edit's own reads pass.
            if (
                !edited &&
                Array.isArray(keys) &&
                keys.includes('vertexServiceAccount')
            ) {
                edited = true;
                await edit();
            }
            return items;
        })) as never);
}

describe('migrateLegacyConfiguration', () => {
    beforeEach(async () => {
        await fakeBrowser.storage.sync.clear();
        await fakeBrowser.storage.local.clear();
        resetConfigurationMigrationForTests();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('relocates sync credentials to local and removes them from sync', async () => {
        await fakeBrowser.storage.sync.set({
            deeplApiKey: 'sync-key',
            openaiApiKey: '   ',
        });
        const summary = await migrateLegacyConfiguration();

        expect((await localState()).deeplApiKey).toBe('sync-key');
        const sync = await syncState();
        expect(sync).not.toHaveProperty('deeplApiKey');
        expect(sync).not.toHaveProperty('openaiApiKey');
        expect((await localState()).openaiApiKey).toBeUndefined();
        expect(summary.removed).toEqual(
            expect.arrayContaining(['sync.deeplApiKey', 'sync.openaiApiKey'])
        );
    });

    it('never overwrites an existing local credential', async () => {
        await fakeBrowser.storage.sync.set({ geminiApiKey: 'old-synced' });
        await fakeBrowser.storage.local.set({ geminiApiKey: 'device-key' });
        await migrateLegacyConfiguration();

        expect((await localState()).geminiApiKey).toBe('device-key');
        expect(await syncState()).not.toHaveProperty('geminiApiKey');
    });

    it('binds a stored key to the origin of the address set now, once', async () => {
        await fakeBrowser.storage.sync.set({
            openaiBaseUrl: 'https://proxy.example.com/v1',
        });
        await fakeBrowser.storage.local.set({
            openaiApiKey: 'sk-proxy',
            openaiCompatibleApiKey: 'AIza-key',
        });
        await migrateLegacyConfiguration();
        expect(await localState()).toMatchObject({
            openaiApiKeyOrigin: 'https://proxy.example.com',
            openaiCompatibleApiKeyOrigin:
                'https://generativelanguage.googleapis.com',
        });

        // Bound, a key stays with its origin when its address moves.
        await fakeBrowser.storage.sync.set({
            openaiBaseUrl: 'https://elsewhere.example.com/v1',
        });
        resetConfigurationMigrationForTests();
        const second = await migrateLegacyConfiguration();
        expect(second.localUpdates).toEqual([]);
        expect((await localState()).openaiApiKeyOrigin).toBe(
            'https://proxy.example.com'
        );
    });

    it('binds a key an older version stored after this one recorded no origin', async () => {
        await fakeBrowser.storage.sync.set({
            openaiBaseUrl: 'https://proxy.example.com/v1',
        });
        await fakeBrowser.storage.local.set({
            openaiApiKey: 'sk-older',
            openaiApiKeyOrigin: '',
        });
        await migrateLegacyConfiguration();
        expect((await localState()).openaiApiKeyOrigin).toBe(
            'https://proxy.example.com'
        );
    });

    it('binds a key to the address readers see, and binds no empty key', async () => {
        await fakeBrowser.storage.sync.set({
            openaiBaseUrl: 'http://insecure.example.com/v1',
        });
        await fakeBrowser.storage.local.set({
            openaiApiKey: 'sk',
            openaiCompatibleApiKey: '',
        });
        await migrateLegacyConfiguration();
        const local = await localState();
        expect(local.openaiApiKeyOrigin).toBe('https://api.openai.com');
        expect(local).not.toHaveProperty('openaiCompatibleApiKeyOrigin');
    });

    it('leaves a key entered while it runs, and its origin, as entered', async () => {
        await fakeBrowser.storage.sync.set({
            openaiBaseUrl: 'https://api.openai.com/v1',
            openaiCompatibleApiKey: 'oc-sync',
        });
        await fakeBrowser.storage.local.set({ openaiApiKey: 'sk-legacy' });
        const read = browser.storage.sync.get.bind(browser.storage.sync);
        // The settings page saves two keys right after the migration reads.
        vi.spyOn(browser.storage.sync, 'get').mockImplementationOnce(((
            keys: string[]
        ) =>
            read(keys).then(async (items) => {
                await fakeBrowser.storage.local.set({
                    openaiApiKey: 'sk-new',
                    openaiApiKeyOrigin: 'https://new.example.com',
                    openaiCompatibleApiKey: 'typed',
                    openaiCompatibleApiKeyOrigin: 'https://typed.example.com',
                });
                return items;
            })) as never);
        await migrateLegacyConfiguration();

        expect(await localState()).toMatchObject({
            openaiApiKey: 'sk-new',
            openaiApiKeyOrigin: 'https://new.example.com',
            openaiCompatibleApiKey: 'typed',
            openaiCompatibleApiKeyOrigin: 'https://typed.example.com',
        });
        expect(await syncState()).not.toHaveProperty('openaiCompatibleApiKey');
    });

    it('binds in turn with a key entry that arrives while it binds', async () => {
        await fakeBrowser.storage.sync.set({
            openaiBaseUrl: 'https://api.openai.com/v1',
        });
        await fakeBrowser.storage.local.set({ openaiApiKey: 'sk-legacy' });
        const read = browser.storage.local.get.bind(browser.storage.local);
        let entry: Promise<unknown> = Promise.resolve();
        let entered = false;
        // The settings page moves the address and enters a key for it while
        // the migration reads the credentials it binds; the entry may land
        // before the binding does.
        vi.spyOn(browser.storage.local, 'get').mockImplementation(((
            keys: string[] | null
        ) =>
            read(keys).then(async (items) => {
                // Only the migration's read: the entry reads what it replaces.
                if (
                    !entered &&
                    Array.isArray(keys) &&
                    keys.includes('openaiApiKeyOrigin')
                ) {
                    entered = true;
                    await fakeBrowser.storage.sync.set({
                        openaiBaseUrl: 'https://new.example.com/v1',
                    });
                    entry = configService.setMultiple(
                        keyEntry(
                            'openaiApiKey',
                            'sk-new',
                            'https://new.example.com/v1'
                        )
                    );
                    await Promise.race([
                        entry,
                        new Promise((resolve) => setTimeout(resolve, 20)),
                    ]);
                }
                return items;
            })) as never);
        await migrateLegacyConfiguration();
        await entry;

        expect(await localState()).toMatchObject({
            openaiApiKey: 'sk-new',
            openaiApiKeyOrigin: 'https://new.example.com',
        });
    });

    it('leaves a key cleared after it looks, though v2 synced one', async () => {
        await fakeBrowser.storage.sync.set({ openaiApiKey: 'sk-synced' });
        await fakeBrowser.storage.local.set({
            openaiApiKey: 'sk-mine',
            openaiApiKeyOrigin: 'https://api.openai.com',
        });
        editOnceItLooks(() =>
            configService.setMultiple(
                keyEntry('openaiApiKey', '', 'https://api.openai.com/v1')
            )
        );
        await migrateLegacyConfiguration();

        expect((await localState()).openaiApiKey).toBe('');
        expect(await syncState()).not.toHaveProperty('openaiApiKey');
    });

    it('binds a key to the address it found, not one stored after it looks', async () => {
        await fakeBrowser.storage.sync.set({
            openaiBaseUrl: 'https://api.openai.com/v1',
        });
        await fakeBrowser.storage.local.set({ openaiApiKey: 'sk-legacy' });
        editOnceItLooks(() =>
            configService.setMultiple({
                openaiBaseUrl: 'https://elsewhere.example.com/v1',
            })
        );
        await migrateLegacyConfiguration();

        expect(await localState()).toMatchObject({
            openaiApiKey: 'sk-legacy',
            openaiApiKeyOrigin: 'https://api.openai.com',
        });
        expect((await syncState()).openaiBaseUrl).toBe(
            'https://elsewhere.example.com/v1'
        );
    });

    it('binds a key moved from sync to the address set now', async () => {
        await fakeBrowser.storage.sync.set({
            openaiCompatibleApiKey: 'oc-sync',
            openaiCompatibleBaseUrl: 'https://api.openai.com/v1',
        });
        await fakeBrowser.storage.local.set({
            openaiCompatibleApiKey: '',
            openaiCompatibleApiKeyOrigin: '',
        });
        await migrateLegacyConfiguration();
        expect(await localState()).toMatchObject({
            openaiCompatibleApiKey: 'oc-sync',
            openaiCompatibleApiKeyOrigin: 'https://api.openai.com',
        });
    });

    it.each(['https://api.openai.com', 'https://api.openai.com/'])(
        'repairs openaiBaseUrl %s to the /v1 endpoint',
        async (stored) => {
            await fakeBrowser.storage.sync.set({ openaiBaseUrl: stored });
            await migrateLegacyConfiguration();
            expect((await syncState()).openaiBaseUrl).toBe(
                'https://api.openai.com/v1'
            );
        }
    );

    it('leaves a custom openaiBaseUrl alone', async () => {
        await fakeBrowser.storage.sync.set({
            openaiBaseUrl: 'https://proxy.example.com/v1',
        });
        await migrateLegacyConfiguration();
        expect((await syncState()).openaiBaseUrl).toBe(
            'https://proxy.example.com/v1'
        );
    });

    it('maps retired Gemini models and invalid vertex locations', async () => {
        await fakeBrowser.storage.sync.set({
            geminiModel: 'gemini-1.5-flash',
            vertexLocation: 'mars-central1',
        });
        await migrateLegacyConfiguration();
        const sync = await syncState();
        expect(sync.geminiModel).toBe('gemini-3.5-flash');
        expect(sync.vertexLocation).toBe('us-central1');
    });

    it('seeds subtitleFontScale from the legacy font size once, clamped to its bounds', async () => {
        await fakeBrowser.storage.sync.set({ subtitleFontSize: 2.2 });
        await migrateLegacyConfiguration();
        let sync = await syncState();
        expect(sync.subtitleFontScale).toBe(2);
        expect(sync).not.toHaveProperty('subtitleFontSize');

        // A device still on 3.0 writes the old key back: the scale wins.
        resetConfigurationMigrationForTests();
        await fakeBrowser.storage.sync.set({ subtitleFontSize: 1.1 });
        await migrateLegacyConfiguration();
        sync = await syncState();
        expect(sync.subtitleFontScale).toBe(2);
        expect(sync).not.toHaveProperty('subtitleFontSize');

        for (const [legacy, scale] of [
            [0.2, 0.5],
            [10, 3],
        ]) {
            await fakeBrowser.storage.sync.clear();
            resetConfigurationMigrationForTests();
            await fakeBrowser.storage.sync.set({ subtitleFontSize: legacy });
            await migrateLegacyConfiguration();
            expect((await syncState()).subtitleFontScale, `${legacy}`).toBe(
                scale
            );
        }
    });

    it('deletes vertexServiceAccount and retired keys, leaving unknown keys', async () => {
        await fakeBrowser.storage.sync.set({
            translationBatchSize: 5,
            sidePanelEnabled: true,
            somebodyElsesKey: 'kept',
        });
        await fakeBrowser.storage.local.set({
            vertexServiceAccount: '{"private_key":"..."}',
            aiContextDebugMode: true,
        });
        const summary = await migrateLegacyConfiguration();

        const sync = await syncState();
        expect(sync).not.toHaveProperty('translationBatchSize');
        expect(sync).not.toHaveProperty('sidePanelEnabled');
        expect(sync.somebodyElsesKey).toBe('kept');
        const local = await localState();
        expect(local).not.toHaveProperty('vertexServiceAccount');
        expect(local).not.toHaveProperty('aiContextDebugMode');
        expect(summary.removed).toContain('local.vertexServiceAccount');
    });

    it('seeds useOfficialTranslations from the legacy key only when unset', async () => {
        await fakeBrowser.storage.sync.set({ useNativeSubtitles: false });
        await migrateLegacyConfiguration();
        const sync = await syncState();
        expect(sync.useOfficialTranslations).toBe(false);
        expect(sync).not.toHaveProperty('useNativeSubtitles');
    });

    it('keeps the unified key authoritative when both exist', async () => {
        await fakeBrowser.storage.sync.set({
            useNativeSubtitles: false,
            useOfficialTranslations: true,
        });
        await migrateLegacyConfiguration();
        const sync = await syncState();
        expect(sync.useOfficialTranslations).toBe(true);
        expect(sync).not.toHaveProperty('useNativeSubtitles');
    });

    it('removes sidePanelUseSidePanel', async () => {
        await fakeBrowser.storage.sync.set({ sidePanelUseSidePanel: false });
        await migrateLegacyConfiguration();
        expect(await syncState()).not.toHaveProperty('sidePanelUseSidePanel');
    });

    it('retires the word explanations switch without touching word lookup', async () => {
        await fakeBrowser.storage.sync.set({ aiContextEnabled: false });
        await migrateLegacyConfiguration();
        const sync = await syncState();
        expect(sync).not.toHaveProperty('aiContextEnabled');
        expect(sync).not.toHaveProperty('wordLookupEnabled');
    });

    it('is idempotent, including after a v2 device re-pollutes sync', async () => {
        await fakeBrowser.storage.sync.set({ deeplApiKey: 'k1' });
        await migrateLegacyConfiguration();

        resetConfigurationMigrationForTests();
        const second = await migrateLegacyConfiguration();
        expect(second.localUpdates).toEqual([]);
        expect(second.syncUpdates).toEqual([]);
        expect(second.removed).toEqual([]);

        // A device still on v2 writes the credential into sync again.
        await fakeBrowser.storage.sync.set({ deeplApiKey: 'k2' });
        resetConfigurationMigrationForTests();
        await migrateLegacyConfiguration();
        expect(await syncState()).not.toHaveProperty('deeplApiKey');
        expect((await localState()).deeplApiKey).toBe('k1');
    });

    it('is single-flight per worker lifetime', async () => {
        const first = migrateLegacyConfiguration();
        const second = migrateLegacyConfiguration();
        expect(second).toBe(first);
        await first;
    });
});
