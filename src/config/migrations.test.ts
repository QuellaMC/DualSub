import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
    migrateLegacyConfiguration,
    resetConfigurationMigrationForTests,
} from './migrations';

async function syncState(): Promise<Record<string, unknown>> {
    return fakeBrowser.storage.sync.get(null);
}
async function localState(): Promise<Record<string, unknown>> {
    return fakeBrowser.storage.local.get(null);
}

describe('migrateLegacyConfiguration', () => {
    beforeEach(async () => {
        await fakeBrowser.storage.sync.clear();
        await fakeBrowser.storage.local.clear();
        resetConfigurationMigrationForTests();
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
