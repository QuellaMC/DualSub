import { beforeEach, describe, expect, it } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
    migrateLegacyConfiguration,
    resetConfigurationMigrationForTests,
} from './migrations';
import { configSchema, SENSITIVE_KEYS, SETTINGS_KEYS } from './schema';
import { configService } from './service';

type Area = Record<string, unknown>;

/** The worker's boot sequence: migrate, then repair to canonical values. */
async function boot(): Promise<void> {
    resetConfigurationMigrationForTests();
    await migrateLegacyConfiguration();
    await configService.setDefaultsForMissingKeys();
}

async function snapshot(): Promise<{ sync: Area; local: Area }> {
    return {
        sync: await browser.storage.sync.get(null),
        local: await browser.storage.local.get(null),
    };
}

function expectCanonical(storage: { sync: Area; local: Area }): void {
    for (const key of SETTINGS_KEYS) {
        const area = configSchema[key].scope === 'sync' ? 'sync' : 'local';
        expect(storage[area], `${area}.${key}`).toHaveProperty(key);
    }
    for (const key of SENSITIVE_KEYS) {
        expect(storage.sync, `sync.${key}`).not.toHaveProperty(key);
    }
}

/** A device that shipped 2.5.0: every key of its schema, credentials still
 *  in sync, both halves of the subtitle-mode key, and the modal toggle. */
const V25_SYNC = {
    uiLanguage: 'ja',
    hideOfficialSubtitles: true,
    selectedProvider: 'microsoft_edge_auth',
    translationDelay: 150,
    deeplApiKey: 'deepl-sync',
    deeplApiPlan: 'free',
    openaiCompatibleApiKey: 'oc-sync',
    openaiCompatibleBaseUrl:
        'https://generativelanguage.googleapis.com/v1beta/openai',
    openaiCompatibleModel: 'gemini-2.5-flash',
    vertexAccessToken: 'vt-sync',
    vertexProjectId: 'my-project',
    vertexLocation: 'us-central1',
    vertexModel: 'gemini-2.5-flash',
    subtitlesEnabled: true,
    useNativeSubtitles: false,
    useOfficialTranslations: true,
    targetLanguage: 'zh-CN',
    originalLanguage: 'en',
    subtitleTimeOffset: 0.3,
    subtitleLayoutOrder: 'original_top',
    subtitleLayoutOrientation: 'column',
    subtitleFontSize: 1.4,
    subtitleGap: 0.3,
    subtitleVerticalPosition: 3,
    subtitleBlacklist: [],
    appearanceAccordionOpen: false,
    aiContextEnabled: true,
    aiContextProvider: 'openai',
    aiContextTypes: ['cultural'],
    openaiApiKey: 'oa-sync',
    openaiBaseUrl: 'https://api.openai.com/v1',
    openaiModel: 'gpt-5.6-luna',
    geminiApiKey: 'gm-sync',
    geminiModel: 'gemini-2.5-flash',
    aiContextTimeout: 30_000,
    aiContextCacheEnabled: true,
    aiContextCacheTTL: 3_600_000,
    aiContextMaxCacheSize: 200,
    aiContextRateLimit: 60,
    aiContextBurstLimit: 10,
    aiContextMandatoryDelay: 1000,
    aiContextRetryAttempts: 3,
    aiContextRetryDelay: 2000,
    sidePanelUseSidePanel: true,
    sidePanelTheme: 'dark',
    sidePanelAutoPauseVideo: false,
    sidePanelAutoOpen: true,
    loggingLevel: 3,
};

/** A device that never left 2.3.2: batching and modal keys, a retired
 *  Gemini model, and only the legacy subtitle-mode key. */
const V23_SYNC = {
    uiLanguage: 'es',
    hideOfficialSubtitles: false,
    selectedProvider: 'google',
    translationBatchSize: 3,
    translationDelay: 200,
    maxConcurrentBatches: 2,
    smartBatching: true,
    batchProcessingDelay: 100,
    globalBatchSize: 5,
    batchingEnabled: true,
    useProviderDefaults: true,
    openaieBatchSize: 1,
    googleBatchSize: 1,
    deeplBatchSize: 1,
    microsoftBatchSize: 1,
    openaieDelay: 1000,
    googleDelay: 1000,
    deeplDelay: 1000,
    deeplFreeDelay: 1500,
    microsoftDelay: 1000,
    deeplApiKey: '',
    deeplApiPlan: 'free',
    openaiCompatibleApiKey: 'oc-old',
    openaiCompatibleBaseUrl: 'https://api.openai.com/v1',
    openaiCompatibleModel: 'gpt-4o-mini',
    subtitlesEnabled: true,
    useNativeSubtitles: false,
    targetLanguage: 'es',
    originalLanguage: 'en',
    subtitleTimeOffset: 0,
    subtitleLayoutOrder: 'translation_top',
    subtitleLayoutOrientation: 'row',
    subtitleFontSize: 1.1,
    subtitleGap: 0.3,
    subtitleVerticalPosition: 2.8,
    appearanceAccordionOpen: true,
    aiContextEnabled: false,
    aiContextProvider: 'gemini',
    aiContextTypes: ['cultural', 'historical', 'linguistic'],
    openaiApiKey: '',
    openaiBaseUrl: 'https://api.openai.com/v1',
    openaiModel: 'gpt-4o',
    geminiApiKey: 'gm-old',
    geminiModel: 'gemini-1.5-flash',
    aiContextTimeout: 20_000,
    aiContextCacheEnabled: true,
    aiContextCacheTTL: 3_600_000,
    aiContextMaxCacheSize: 200,
    aiContextRateLimit: 60,
    aiContextBurstLimit: 10,
    aiContextMandatoryDelay: 1000,
    contextModalPosition: { x: 10, y: 10 },
    contextModalSize: { width: 400, height: 300 },
    contextAutoClose: false,
    contextAutoCloseDelay: 5000,
    aiContextRetryAttempts: 3,
    aiContextRetryDelay: 2000,
    loggingLevel: 3,
};

describe('upgrade paths', () => {
    beforeEach(() => {
        fakeBrowser.reset();
    });

    it('fresh install: every key canonical in its area, credentials local only', async () => {
        await boot();
        const storage = await snapshot();
        expectCanonical(storage);
        expect(storage.sync.selectedProvider).toBe('microsoft_edge');
        expect(storage.sync.useOfficialTranslations).toBe(true);
        expect(storage.local.deeplApiKey).toBe('');
        expect(storage.local.vertexTokenExpiresAt).toBe(0);
    });

    it('2.5.0 → 3: credentials move, retired keys go, the provider id is repaired', async () => {
        await browser.storage.sync.set(V25_SYNC);
        await browser.storage.local.set({ debugMode: true });
        await boot();
        const storage = await snapshot();
        expectCanonical(storage);

        expect(storage.local).toMatchObject({
            deeplApiKey: 'deepl-sync',
            openaiCompatibleApiKey: 'oc-sync',
            vertexAccessToken: 'vt-sync',
            openaiApiKey: 'oa-sync',
            geminiApiKey: 'gm-sync',
            debugMode: true,
            vertexTokenExpiresAt: 0,
        });
        expect(storage.sync).toMatchObject({
            selectedProvider: 'microsoft_edge',
            useOfficialTranslations: true,
            uiLanguage: 'ja',
            subtitleFontSize: 1.4,
            sidePanelTheme: 'dark',
            geminiModel: 'gemini-2.5-flash',
        });
        expect(storage.sync).not.toHaveProperty('useNativeSubtitles');
        expect(storage.sync).not.toHaveProperty('sidePanelUseSidePanel');
    });

    it('2.3.2 → 3: batching and modal keys go, the legacy mode key seeds the unified one', async () => {
        await browser.storage.sync.set(V23_SYNC);
        await browser.storage.local.set({ aiContextDebugMode: true });
        await boot();
        const storage = await snapshot();
        expectCanonical(storage);

        expect(storage.sync).toMatchObject({
            selectedProvider: 'google',
            useOfficialTranslations: false,
            geminiModel: 'gemini-3.5-flash',
            openaiCompatibleBaseUrl: 'https://api.openai.com/v1',
            subtitleLayoutOrientation: 'row',
        });
        for (const retired of [
            'translationBatchSize',
            'batchingEnabled',
            'microsoftDelay',
            'contextModalPosition',
            'contextAutoCloseDelay',
            'useNativeSubtitles',
        ]) {
            expect(storage.sync, retired).not.toHaveProperty(retired);
        }
        expect(storage.local).not.toHaveProperty('aiContextDebugMode');
        expect(storage.local).toMatchObject({
            openaiCompatibleApiKey: 'oc-old',
            geminiApiKey: 'gm-old',
        });
    });

    it('a v2 device re-polluting sync after the upgrade cannot undo it', async () => {
        await browser.storage.sync.set(V25_SYNC);
        await boot();
        await browser.storage.local.set({ deeplApiKey: 'deepl-rotated' });

        // The other device is still on 2.5 and writes its world back.
        await browser.storage.sync.set({
            deeplApiKey: 'deepl-stale',
            useNativeSubtitles: true,
            sidePanelUseSidePanel: true,
            selectedProvider: 'microsoft_edge_auth',
        });
        await boot();
        const afterSecondBoot = await snapshot();
        expectCanonical(afterSecondBoot);
        expect(afterSecondBoot.local.deeplApiKey).toBe('deepl-rotated');
        expect(afterSecondBoot.sync).toMatchObject({
            selectedProvider: 'microsoft_edge',
            useOfficialTranslations: true,
        });
        expect(afterSecondBoot.sync).not.toHaveProperty('useNativeSubtitles');
        expect(afterSecondBoot.sync).not.toHaveProperty(
            'sidePanelUseSidePanel'
        );

        await boot();
        expect(await snapshot()).toEqual(afterSecondBoot);
    });
});
