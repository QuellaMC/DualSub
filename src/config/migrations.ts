import { browser } from 'wxt/browser';
import { VERTEX_LOCATIONS } from '@/shared/providers';

const RETIRED_GEMINI_MODELS = new Set(['gemini-1.5-flash', 'gemini-1.5-pro']);

const DEVICE_LOCAL_CREDENTIAL_KEYS = [
    'deeplApiKey',
    'openaiCompatibleApiKey',
    'vertexAccessToken',
    'openaiApiKey',
    'geminiApiKey',
] as const;

const ALLOWED_VERTEX_LOCATIONS = new Set<string>(VERTEX_LOCATIONS);

// Grows monotonically; it is the durable record of deliberately dropped
// features. v2 batching + old side-panel/modal surface, plus the v3
// retirements: the modal-vs-panel toggle and the legacy half of the
// useNativeSubtitles/useOfficialTranslations dual key.
const RETIRED_SYNC_KEYS = [
    'translationBatchSize',
    'maxConcurrentBatches',
    'smartBatching',
    'batchProcessingDelay',
    'globalBatchSize',
    'batchingEnabled',
    'useProviderDefaults',
    'openaieBatchSize',
    'googleBatchSize',
    'deeplBatchSize',
    'microsoftBatchSize',
    'openaieDelay',
    'googleDelay',
    'deeplDelay',
    'deeplFreeDelay',
    'microsoftDelay',
    'sidePanelEnabled',
    'sidePanelDefaultTab',
    'sidePanelWordsListsEnabled',
    'sidePanelPersistAcrossTabs',
    'sidePanelAutoResumeVideo',
    'sidePanelFollowActiveTabInWindow',
    'sidePanelScopePolicyAIAnalysisTab',
    'sidePanelScopePolicyWordsListsTab',
    'sidePanelWordLists',
    'contextModalPosition',
    'contextModalSize',
    'contextAutoClose',
    'contextAutoCloseDelay',
    'sidePanelUseSidePanel',
    'useNativeSubtitles',
];

const RETIRED_LOCAL_KEYS = [
    'sidePanelLastTabState',
    'sidePanelSelectionBuckets',
    'aiContextDebugMode',
];

export interface MigrationSummary {
    localUpdates: string[];
    syncUpdates: string[];
    removed: string[];
}

let migrationPromise: Promise<MigrationSummary> | undefined;

/**
 * Migrate settings whose storage location or provider contract changed.
 *
 * Deliberately marker-less and idempotent, re-run on every worker cold start
 * (single-flight per worker lifetime): storage.sync is shared across the
 * user's devices, so a device still on v2 can re-write retired keys or sync
 * credentials at any time after this device migrated. Failed attempts clear
 * the single-flight slot so a later caller can retry.
 */
export function migrateLegacyConfiguration(): Promise<MigrationSummary> {
    if (!migrationPromise) {
        const attempt = runMigration().catch((error: unknown) => {
            if (migrationPromise === attempt) {
                migrationPromise = undefined;
            }
            throw error;
        });
        migrationPromise = attempt;
    }
    return migrationPromise;
}

async function runMigration(): Promise<MigrationSummary> {
    const [syncItems, localItems] = await Promise.all([
        browser.storage.sync.get([
            ...DEVICE_LOCAL_CREDENTIAL_KEYS,
            'openaiBaseUrl',
            'geminiModel',
            'vertexLocation',
            'useOfficialTranslations',
            ...RETIRED_SYNC_KEYS,
        ]),
        browser.storage.local.get([
            ...DEVICE_LOCAL_CREDENTIAL_KEYS,
            'vertexServiceAccount',
            ...RETIRED_LOCAL_KEYS,
        ]),
    ]);

    const localUpdates: Record<string, unknown> = {};
    const syncUpdates: Record<string, unknown> = {};
    const removed: string[] = [];

    // Presence is value-based: chrome.storage never holds undefined, and some
    // storage fakes echo requested-but-absent keys back as undefined.
    const syncedCredentialKeys = DEVICE_LOCAL_CREDENTIAL_KEYS.filter(
        (key) => syncItems[key] !== undefined
    );
    for (const key of syncedCredentialKeys) {
        const value: unknown = syncItems[key];
        if (typeof value === 'string' && value.trim() && !localItems[key]) {
            localUpdates[key] = value;
        }
    }

    if (
        syncItems.openaiBaseUrl === 'https://api.openai.com' ||
        syncItems.openaiBaseUrl === 'https://api.openai.com/'
    ) {
        syncUpdates.openaiBaseUrl = 'https://api.openai.com/v1';
    }

    if (RETIRED_GEMINI_MODELS.has(syncItems.geminiModel as string)) {
        syncUpdates.geminiModel = 'gemini-3.5-flash';
    }

    if (
        typeof syncItems.vertexLocation === 'string' &&
        !ALLOWED_VERTEX_LOCATIONS.has(syncItems.vertexLocation)
    ) {
        syncUpdates.vertexLocation = 'us-central1';
    }

    // The unified key wins wherever it exists; the legacy boolean only seeds
    // it when a device never wrote the unified key at all.
    if (
        typeof syncItems.useNativeSubtitles === 'boolean' &&
        syncItems.useOfficialTranslations === undefined
    ) {
        syncUpdates.useOfficialTranslations = syncItems.useNativeSubtitles;
    }

    if (Object.keys(localUpdates).length > 0) {
        await browser.storage.local.set(localUpdates);
    }
    if (Object.keys(syncUpdates).length > 0) {
        await browser.storage.sync.set(syncUpdates);
    }

    if (syncedCredentialKeys.length > 0) {
        await browser.storage.sync.remove([...syncedCredentialKeys]);
        removed.push(...syncedCredentialKeys.map((key) => `sync.${key}`));
    }
    const retiredSyncKeys = RETIRED_SYNC_KEYS.filter(
        (key) => syncItems[key] !== undefined
    );
    if (retiredSyncKeys.length > 0) {
        await browser.storage.sync.remove(retiredSyncKeys);
        removed.push(...retiredSyncKeys.map((key) => `sync.${key}`));
    }
    if (localItems.vertexServiceAccount !== undefined) {
        await browser.storage.local.remove('vertexServiceAccount');
        removed.push('local.vertexServiceAccount');
    }
    const retiredLocalKeys = RETIRED_LOCAL_KEYS.filter(
        (key) => localItems[key] !== undefined
    );
    if (retiredLocalKeys.length > 0) {
        await browser.storage.local.remove(retiredLocalKeys);
        removed.push(...retiredLocalKeys.map((key) => `local.${key}`));
    }

    return {
        localUpdates: Object.keys(localUpdates),
        syncUpdates: Object.keys(syncUpdates),
        removed,
    };
}

/** Reset single-flight state for isolated tests. */
export function resetConfigurationMigrationForTests(): void {
    migrationPromise = undefined;
}
