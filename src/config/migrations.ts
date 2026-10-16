import { browser } from 'wxt/browser';
import { KEY_ORIGINS, originOf, type KeyBinding } from '@/shared/keyOrigins';
import { VERTEX_LOCATIONS } from '@/shared/providers';
import { getDefaultValue, prepareSettingValue, SETTING_BOUNDS } from './schema';
import { inTurn } from './service';

const RETIRED_GEMINI_MODELS = new Set(['gemini-1.5-flash', 'gemini-1.5-pro']);

const DEVICE_LOCAL_CREDENTIAL_KEYS = [
    'deeplApiKey',
    'openaiCompatibleApiKey',
    'vertexAccessToken',
    'openaiApiKey',
    'geminiApiKey',
] as const;

const KEY_BINDINGS = Object.entries(KEY_ORIGINS);

const ALLOWED_VERTEX_LOCATIONS = new Set<string>(VERTEX_LOCATIONS);

/** The pre-3.1 font size was a viewport-width percentage with this default. */
const LEGACY_DEFAULT_FONT_SIZE_VW = 1.1;

// Grows monotonically; it is the durable record of deliberately dropped
// features. v2 batching + old side-panel/modal surface, plus the v3
// retirements: the modal-vs-panel toggle, the legacy half of the
// useNativeSubtitles/useOfficialTranslations dual key, the
// viewport-relative font size that subtitleFontScale replaced in 3.1, the
// debug flag nothing read, and the popup's appearance fold-out.
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
    'subtitleFontSize',
    'appearanceAccordionOpen',
];

const RETIRED_LOCAL_KEYS = [
    'sidePanelLastTabState',
    'sidePanelSelectionBuckets',
    'aiContextDebugMode',
    'debugMode',
    'appearanceAccordionOpen',
];

/** Legacy sizes were viewport-width percentages and the new basis is the
 *  picture height, so no pixel equivalence exists; what carries over is the
 *  user's ratio to the old default. */
function legacyFontSizeToScale(fontSizeVw: number): number {
    const { min, max } = SETTING_BOUNDS.subtitleFontScale;
    const scale = Math.min(
        max,
        Math.max(min, fontSizeVw / LEGACY_DEFAULT_FONT_SIZE_VW)
    );
    return Math.round(scale * 100) / 100;
}

/** The address `stored` resolves to, as every reader resolves it: itself
 *  when valid, else the default. */
function resolvedAddress(key: KeyBinding['address'], stored: unknown): string {
    try {
        return prepareSettingValue(key, stored);
    } catch {
        return getDefaultValue(key);
    }
}

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
            ...KEY_BINDINGS.map(([, { address }]) => address),
            'geminiModel',
            'vertexLocation',
            'useOfficialTranslations',
            'subtitleFontScale',
            ...RETIRED_SYNC_KEYS,
        ]),
        browser.storage.local.get([
            'vertexServiceAccount',
            ...RETIRED_LOCAL_KEYS,
        ]),
    ]);

    const syncUpdates: Record<string, unknown> = {};
    const removed: string[] = [];

    // Presence is value-based: chrome.storage never holds undefined, and some
    // storage fakes echo requested-but-absent keys back as undefined.
    const syncedCredentialKeys = DEVICE_LOCAL_CREDENTIAL_KEYS.filter(
        (key) => syncItems[key] !== undefined
    );

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

    // Subtitles are sized against the video since 3.1; the old
    // width-relative value seeds the equivalent scale exactly once.
    if (
        typeof syncItems.subtitleFontSize === 'number' &&
        Number.isFinite(syncItems.subtitleFontSize) &&
        syncItems.subtitleFontScale === undefined
    ) {
        syncUpdates.subtitleFontScale = legacyFontSizeToScale(
            syncItems.subtitleFontSize
        );
    }

    const localUpdates = await inTurn(() =>
        settleCredentials(syncItems, syncUpdates)
    );
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

/**
 * Move credentials synced by v2 into empty local slots, and bind each key
 * without a recorded origin, from the local credentials stored by now. It
 * runs in turn with key entries, so a key entered meanwhile is neither
 * overwritten nor bound to another origin.
 */
async function settleCredentials(
    syncItems: Record<string, unknown>,
    syncUpdates: Record<string, unknown>
): Promise<Record<string, unknown>> {
    const stored = await browser.storage.local.get([
        ...DEVICE_LOCAL_CREDENTIAL_KEYS,
        ...KEY_BINDINGS.map(([, { origin }]) => origin),
    ]);
    const updates: Record<string, unknown> = {};
    for (const key of DEVICE_LOCAL_CREDENTIAL_KEYS) {
        const value: unknown = syncItems[key];
        if (typeof value === 'string' && value.trim() && !stored[key]) {
            updates[key] = value;
        }
    }
    // A key with no recorded origin, stored before keys recorded one or by
    // an older version since, or one moved here from sync just now, was
    // entered for the address set now.
    for (const [key, { address, origin }] of KEY_BINDINGS) {
        if (Object.hasOwn(updates, key) || (stored[key] && !stored[origin])) {
            updates[origin] =
                originOf(
                    resolvedAddress(
                        address,
                        syncUpdates[address] ?? syncItems[address]
                    )
                ) ?? '';
        }
    }
    if (Object.keys(updates).length > 0) {
        await browser.storage.local.set(updates);
    }
    return updates;
}

/** Reset single-flight state for isolated tests. */
export function resetConfigurationMigrationForTests(): void {
    migrationPromise = undefined;
}
