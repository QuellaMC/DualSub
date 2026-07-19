import { VERTEX_LOCATIONS } from '../content_scripts/shared/constants/providers.js';

const RETIRED_GEMINI_MODELS = new Set(['gemini-1.5-flash', 'gemini-1.5-pro']);

const DEVICE_LOCAL_CREDENTIAL_KEYS = [
    'deeplApiKey',
    'openaiCompatibleApiKey',
    'vertexAccessToken',
    'openaiApiKey',
    'geminiApiKey',
];

const ALLOWED_VERTEX_LOCATIONS = new Set(VERTEX_LOCATIONS);

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
];

const RETIRED_LOCAL_KEYS = [
    'sidePanelLastTabState',
    'sidePanelSelectionBuckets',
    'aiContextDebugMode',
];

let migrationPromise;

/**
 * Migrate settings whose storage location or provider contract changed.
 * The migration is idempotent and single-flight for a service-worker lifetime.
 * Failed attempts are cleared so a later caller can explicitly retry.
 *
 * @returns {Promise<{localUpdates: string[], syncUpdates: string[], removed: string[]}>}
 */
export function migrateLegacyConfiguration() {
    if (!migrationPromise) {
        const attempt = runMigration().catch((error) => {
            if (migrationPromise === attempt) {
                migrationPromise = undefined;
            }
            throw error;
        });
        migrationPromise = attempt;
    }

    return migrationPromise;
}

async function runMigration() {
    const [syncItems, localItems] = await Promise.all([
        chrome.storage.sync.get([
            ...DEVICE_LOCAL_CREDENTIAL_KEYS,
            'openaiBaseUrl',
            'openaiModel',
            'geminiModel',
            'vertexLocation',
            ...RETIRED_SYNC_KEYS,
        ]),
        chrome.storage.local.get([
            ...DEVICE_LOCAL_CREDENTIAL_KEYS,
            'vertexServiceAccount',
            ...RETIRED_LOCAL_KEYS,
        ]),
    ]);

    const localUpdates = {};
    const syncUpdates = {};
    const removed = [];

    const syncedCredentialKeys = DEVICE_LOCAL_CREDENTIAL_KEYS.filter((key) =>
        Object.prototype.hasOwnProperty.call(syncItems, key)
    );
    for (const key of syncedCredentialKeys) {
        if (
            typeof syncItems[key] === 'string' &&
            syncItems[key].trim() &&
            !localItems[key]
        ) {
            localUpdates[key] = syncItems[key];
        }
    }

    if (
        syncItems.openaiBaseUrl === 'https://api.openai.com' ||
        syncItems.openaiBaseUrl === 'https://api.openai.com/'
    ) {
        syncUpdates.openaiBaseUrl = 'https://api.openai.com/v1';
    }

    if (RETIRED_GEMINI_MODELS.has(syncItems.geminiModel)) {
        syncUpdates.geminiModel = 'gemini-3.5-flash';
    }

    if (
        typeof syncItems.vertexLocation === 'string' &&
        !ALLOWED_VERTEX_LOCATIONS.has(syncItems.vertexLocation)
    ) {
        syncUpdates.vertexLocation = 'us-central1';
    }

    if (Object.keys(localUpdates).length > 0) {
        await chrome.storage.local.set(localUpdates);
    }
    if (Object.keys(syncUpdates).length > 0) {
        await chrome.storage.sync.set(syncUpdates);
    }

    if (syncedCredentialKeys.length > 0) {
        await chrome.storage.sync.remove(syncedCredentialKeys);
        removed.push(...syncedCredentialKeys.map((key) => `sync.${key}`));
    }
    const retiredSyncKeys = RETIRED_SYNC_KEYS.filter((key) =>
        Object.prototype.hasOwnProperty.call(syncItems, key)
    );
    if (retiredSyncKeys.length > 0) {
        await chrome.storage.sync.remove(retiredSyncKeys);
        removed.push(...retiredSyncKeys.map((key) => `sync.${key}`));
    }
    if ('vertexServiceAccount' in localItems) {
        await chrome.storage.local.remove('vertexServiceAccount');
        removed.push('local.vertexServiceAccount');
    }
    const retiredLocalKeys = RETIRED_LOCAL_KEYS.filter((key) =>
        Object.prototype.hasOwnProperty.call(localItems, key)
    );
    if (retiredLocalKeys.length > 0) {
        await chrome.storage.local.remove(retiredLocalKeys);
        removed.push(...retiredLocalKeys.map((key) => `local.${key}`));
    }

    return {
        localUpdates: Object.keys(localUpdates),
        syncUpdates: Object.keys(syncUpdates),
        removed,
    };
}

/** Reset single-flight state for isolated tests. */
export function resetConfigurationMigrationForTests() {
    migrationPromise = undefined;
}
