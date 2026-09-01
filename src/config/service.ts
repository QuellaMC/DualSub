import { browser } from 'wxt/browser';
import { createLogger, setLoggingLevel } from '@/shared/logger';
import {
    SETTINGS_KEYS,
    configSchema,
    getDefaultValue,
    getKeysByScope,
    isSettingsKey,
    prepareSettingValue,
    type SettingsKey,
    type SettingsValues,
} from './schema';
import {
    ConfigServiceReadError,
    ConfigStorageError,
    ConfigValidationError,
    ConfigWriteError,
    STORAGE_AREAS,
    type AreaResult,
    type StorageArea,
} from './errors';

export {
    ConfigServiceReadError,
    ConfigStorageError,
    ConfigValidationError,
    ConfigWriteError,
};

type ValueSource =
    'stored' | 'schema-default-invalid' | 'schema-default-missing';

type StoredResolution =
    | 'stored-exact'
    | 'stored-normalized'
    | 'default-invalid'
    | 'default-missing';

export interface ConfigReadResult {
    /** True when every storage area needed by readable requested keys succeeded. */
    ok: boolean;
    values: Partial<SettingsValues>;
    sources: Partial<
        Record<SettingsKey, { scope: StorageArea; source: ValueSource }>
    >;
    /** Non-sensitive schema defaults for keys whose storage area failed. */
    displayFallbacks: Partial<SettingsValues>;
    areas: Record<StorageArea, AreaResult>;
    degraded: boolean;
    failedAreas: StorageArea[];
    unknownKeys: string[];
    excludedSensitiveKeys: SettingsKey[];
}

export interface ReadOptions {
    includeSensitive?: boolean;
}

export type SettingsChanges = Partial<SettingsValues>;
export type ChangeListener = (changes: SettingsChanges) => unknown;

/**
 * Recognizes the explicit capability to include sensitive settings without
 * reading or traversing any unrelated option value. Throwing descriptor
 * proxies fail closed.
 */
export function isSensitiveAccessExplicitlyEnabled(options: unknown): boolean {
    if (
        options === null ||
        (typeof options !== 'object' && typeof options !== 'function')
    ) {
        return false;
    }
    try {
        const descriptor = Object.getOwnPropertyDescriptor(
            options,
            'includeSensitive'
        );
        return (
            descriptor !== undefined &&
            Object.hasOwn(descriptor, 'value') &&
            descriptor.value === true
        );
    } catch {
        return false;
    }
}

function detach<T>(value: T): T {
    return value !== null && typeof value === 'object'
        ? structuredClone(value)
        : value;
}

interface ResolvedStoredValue {
    value: unknown;
    usedDefault: boolean;
    invalidStoredValue: boolean;
    needsRepair: boolean;
    resolution: StoredResolution;
}

class ConfigService {
    private readonly logger = createLogger('ConfigService');
    private readonly changeListeners = new Set<{
        includeSensitive: boolean;
        callback: ChangeListener;
    }>();
    private changeListenerInitialized = false;

    // ------------------------------------------------------------------ storage

    private async getFromStorage(
        area: StorageArea,
        keys: readonly SettingsKey[],
        privacySafe: boolean
    ): Promise<Record<string, unknown>> {
        try {
            return await browser.storage[area].get([...keys]);
        } catch (cause) {
            const error = new ConfigStorageError('get', area, keys, cause);
            this.logger.error(
                error.isQuotaError
                    ? 'Storage quota exceeded during get operation'
                    : 'Storage get operation failed',
                privacySafe ? null : error,
                { area, keyCount: keys.length, quotaError: error.isQuotaError }
            );
            throw error;
        }
    }

    private async setToStorage(
        area: StorageArea,
        items: Partial<SettingsValues>
    ): Promise<void> {
        const keys = Object.keys(items);
        try {
            await browser.storage[area].set(items);
        } catch (cause) {
            const error = new ConfigStorageError('set', area, keys, cause);
            this.logger.error(
                error.isQuotaError
                    ? 'Storage quota exceeded during set operation'
                    : 'Storage set operation failed',
                error,
                { area, keys, quotaError: error.isQuotaError }
            );
            throw error;
        }
    }

    private async removeFromStorage(
        area: StorageArea,
        keys: readonly string[]
    ): Promise<void> {
        try {
            await browser.storage[area].remove([...keys]);
        } catch (cause) {
            const error = new ConfigStorageError('remove', area, keys, cause);
            this.logger.error('Storage remove operation failed', error, {
                area,
                keys,
            });
            throw error;
        }
    }

    // ---------------------------------------------------------------- resolve

    /**
     * Classify one stored value. `stored-exact` means the raw stored value is
     * valid and normalization would not change it; everything else marks the
     * key `needsRepair` so startup repair can persist the canonical value.
     * Object identity is preserved for the exactness check, so valid stored
     * collections are not rewritten on every boot.
     */
    private resolveStoredValue(
        key: SettingsKey,
        storedItems: Record<string, unknown>
    ): ResolvedStoredValue {
        const definition = configSchema[key];

        // chrome.storage can never hold undefined, so an undefined own
        // property (some fakes echo requested keys back) means absent too.
        const raw: unknown = storedItems[key];
        if (!Object.hasOwn(storedItems, key) || raw === undefined) {
            return {
                value: getDefaultValue(key),
                usedDefault: true,
                invalidStoredValue: false,
                needsRepair: true,
                resolution: 'default-missing',
            };
        }
        try {
            const normalized: unknown = definition.normalize
                ? definition.normalize(raw)
                : raw;
            if (!definition.schema.safeParse(normalized).success) {
                throw new TypeError('invalid');
            }
            const resolution: StoredResolution = Object.is(normalized, raw)
                ? 'stored-exact'
                : 'stored-normalized';
            return {
                value: normalized,
                usedDefault: false,
                invalidStoredValue: false,
                needsRepair: resolution !== 'stored-exact',
                resolution,
            };
        } catch {
            return {
                value: getDefaultValue(key),
                usedDefault: true,
                invalidStoredValue: true,
                needsRepair: true,
                resolution: 'default-invalid',
            };
        }
    }

    private tryPrepare(
        key: SettingsKey,
        value: unknown
    ): { ok: true; value: unknown } | { ok: false } {
        try {
            return { ok: true, value: prepareSettingValue(key, value) };
        } catch {
            return { ok: false };
        }
    }

    // ----------------------------------------------------------- read bundles

    private async readResultBundle(
        keys: readonly string[],
        options: ReadOptions
    ): Promise<ConfigReadResult> {
        const sensitiveAllowed = isSensitiveAccessExplicitlyEnabled(options);
        const requestedKeys = [...new Set(keys)].filter(
            (key): key is string => typeof key === 'string'
        );
        const unknownKeys = requestedKeys.filter((key) => !isSettingsKey(key));
        const knownKeys = requestedKeys.filter(isSettingsKey);
        const excludedSensitiveKeys = knownKeys.filter(
            (key) => configSchema[key].sensitive && !sensitiveAllowed
        );
        const readableKeys = knownKeys.filter(
            (key) => sensitiveAllowed || !configSchema[key].sensitive
        );
        const privacySafe = knownKeys.some(
            (key) => configSchema[key].sensitive
        );
        const keysByArea: Record<StorageArea, SettingsKey[]> = {
            sync: readableKeys.filter(
                (key) => configSchema[key].scope === 'sync'
            ),
            local: readableKeys.filter(
                (key) => configSchema[key].scope === 'local'
            ),
        };

        const result: ConfigReadResult = {
            ok: true,
            values: {},
            sources: {},
            displayFallbacks: {},
            areas: {
                sync: { status: 'not-requested' },
                local: { status: 'not-requested' },
            },
            degraded: false,
            failedAreas: [],
            unknownKeys,
            excludedSensitiveKeys,
        };

        const areaReads = await Promise.allSettled(
            STORAGE_AREAS.map((area) =>
                keysByArea[area].length > 0
                    ? this.getFromStorage(area, keysByArea[area], privacySafe)
                    : Promise.resolve({})
            )
        );

        STORAGE_AREAS.forEach((area, index) => {
            const areaKeys = keysByArea[area];
            if (areaKeys.length === 0) {
                return;
            }
            const areaRead = areaReads[index]!;

            if (areaRead.status === 'rejected') {
                result.areas[area] = {
                    status: 'error',
                    error: areaRead.reason,
                };
                result.ok = false;
                result.degraded = true;
                result.failedAreas.push(area);
                for (const key of areaKeys) {
                    if (!configSchema[key].sensitive) {
                        (result.displayFallbacks as Record<string, unknown>)[
                            key
                        ] = getDefaultValue(key);
                    }
                }
                return;
            }

            result.areas[area] = { status: 'ok' };
            for (const key of areaKeys) {
                const { value, usedDefault, invalidStoredValue } =
                    this.resolveStoredValue(key, areaRead.value);
                (result.values as Record<string, unknown>)[key] = detach(value);
                result.sources[key] = {
                    scope: area,
                    source: usedDefault
                        ? invalidStoredValue
                            ? 'schema-default-invalid'
                            : 'schema-default-missing'
                        : 'stored',
                };
            }
        });

        return result;
    }

    private requireAuthoritative(result: ConfigReadResult): ConfigReadResult {
        if (!result.ok) {
            throw new ConfigServiceReadError(result.failedAreas, result.areas, {
                unknownKeyCount: result.unknownKeys.length,
                excludedSensitiveKeyCount: result.excludedSensitiveKeys.length,
            });
        }
        return result;
    }

    async readResult(key: string, options: ReadOptions = {}) {
        return this.readResultBundle([key], options);
    }

    async readMultipleResult(
        keys: readonly string[],
        options: ReadOptions = {}
    ) {
        return this.readResultBundle(keys, options);
    }

    async readAllResult(options: ReadOptions = {}) {
        return this.readResultBundle(SETTINGS_KEYS, options);
    }

    async readResultStrict(key: string, options: ReadOptions = {}) {
        return this.requireAuthoritative(await this.readResult(key, options));
    }

    async readMultipleResultStrict(
        keys: readonly string[],
        options: ReadOptions = {}
    ) {
        return this.requireAuthoritative(
            await this.readMultipleResult(keys, options)
        );
    }

    async readAllResultStrict(options: ReadOptions = {}) {
        return this.requireAuthoritative(await this.readAllResult(options));
    }

    /**
     * Fail-closed read of one boolean setting. Resolves only when storage was
     * authoritative AND the value was genuinely stored as a boolean — a
     * schema default (missing or invalid stored value) is NOT good enough.
     * Gates privacy-sensitive behavior like AI analysis enablement.
     */
    async readStoredBooleanStrict(key: string): Promise<boolean> {
        if (
            !isSettingsKey(key) ||
            typeof configSchema[key].default !== 'boolean'
        ) {
            throw new Error('Stored boolean configuration is unavailable');
        }
        let result: ConfigReadResult;
        try {
            result = await this.readResultStrict(key);
        } catch (error) {
            if (error instanceof ConfigServiceReadError) {
                throw error;
            }
            throw new Error('Stored boolean configuration is unavailable');
        }
        const value = result.values[key];
        if (
            result.sources[key]?.source !== 'stored' ||
            (value !== true && value !== false)
        ) {
            throw new Error('Stored boolean configuration is unavailable');
        }
        return value;
    }

    // -------------------------------------------------------- legacy getters

    /**
     * Single-value convenience read. Unknown keys resolve to undefined and a
     * storage failure silently resolves to the schema default — callers that
     * must distinguish those cases use the strict read APIs instead.
     */
    async get<K extends SettingsKey>(key: K): Promise<SettingsValues[K]>;
    async get(key: string): Promise<unknown>;
    async get(key: string): Promise<unknown> {
        if (!isSettingsKey(key)) {
            this.logger.error(`Invalid key "${key}" requested`, null, {
                method: 'get',
            });
            return undefined;
        }
        const scope = configSchema[key].scope;
        try {
            const items = await this.getFromStorage(
                scope,
                [key],
                configSchema[key].sensitive === true
            );
            const { value } = this.resolveStoredValue(key, items);
            return detach(value);
        } catch {
            return getDefaultValue(key);
        }
    }

    /** Multi-value read; throws on storage failure, skips unknown keys. */
    async getMultiple(
        keys: readonly string[]
    ): Promise<Partial<SettingsValues>> {
        const validKeys = [...new Set(keys)].filter(isSettingsKey);
        const invalidKeys = keys.filter((key) => !isSettingsKey(key));
        if (invalidKeys.length > 0) {
            this.logger.error('Invalid keys requested in getMultiple', null, {
                invalidKeys,
            });
        }
        const keysByArea: Record<StorageArea, SettingsKey[]> = {
            sync: validKeys.filter((key) => configSchema[key].scope === 'sync'),
            local: validKeys.filter(
                (key) => configSchema[key].scope === 'local'
            ),
        };
        const privacySafe = validKeys.some(
            (key) => configSchema[key].sensitive === true
        );
        const [syncItems, localItems] = await Promise.all([
            keysByArea.sync.length > 0
                ? this.getFromStorage('sync', keysByArea.sync, privacySafe)
                : Promise.resolve({}),
            keysByArea.local.length > 0
                ? this.getFromStorage('local', keysByArea.local, privacySafe)
                : Promise.resolve({}),
        ]);

        const result: Record<string, unknown> = {};
        for (const key of validKeys) {
            const items =
                configSchema[key].scope === 'sync' ? syncItems : localItems;
            result[key] = detach(this.resolveStoredValue(key, items).value);
        }
        return result;
    }

    /** Full projection; throws ConfigServiceReadError if any area fails. */
    async getAll(options: ReadOptions = {}): Promise<Partial<SettingsValues>> {
        const { values } = await this.readAllResultStrict(options);
        return values;
    }

    // ---------------------------------------------------------------- writes

    async set<K extends SettingsKey>(
        key: K,
        value: unknown
    ): Promise<SettingsValues[K]> {
        if (!isSettingsKey(key)) {
            const error = new Error(
                `Invalid key "${String(key)}" provided for set`
            );
            this.logger.error(error.message, error, { method: 'set' });
            throw error;
        }
        const prepared = this.tryPrepare(key, value);
        if (!prepared.ok) {
            const error = new Error(`Invalid value for key "${key}"`);
            this.logger.error(error.message, error, {
                method: 'set',
                requestedKey: key,
                actualType: typeof value,
            });
            throw error;
        }

        await this.setToStorage(configSchema[key].scope, {
            [key]: prepared.value,
        });

        if (key === 'loggingLevel') {
            setLoggingLevel(prepared.value as number);
        }
        return detach(prepared.value) as SettingsValues[K];
    }

    /**
     * Multi-key write. Validates everything first (nothing is written when any
     * key/value is invalid), then writes each storage area independently and
     * aggregates area failures.
     */
    async setMultiple(
        settings: Partial<SettingsValues>
    ): Promise<Partial<SettingsValues>> {
        const invalidKeys: string[] = [];
        const byArea: Record<StorageArea, Record<string, unknown>> = {
            sync: {},
            local: {},
        };
        const preparedSettings: Record<string, unknown> = {};

        for (const key of Object.keys(settings)) {
            if (!isSettingsKey(key)) {
                invalidKeys.push(key);
                continue;
            }
            const prepared = this.tryPrepare(
                key,
                (settings as Record<string, unknown>)[key]
            );
            if (!prepared.ok) {
                invalidKeys.push(key);
                continue;
            }
            byArea[configSchema[key].scope][key] = prepared.value;
            preparedSettings[key] = prepared.value;
        }

        if (invalidKeys.length > 0) {
            const error = new ConfigValidationError(invalidKeys);
            this.logger.error(error.message, error, { invalidKeys });
            throw error;
        }

        const failures: { area: StorageArea; error: unknown }[] = [];
        let successes = 0;
        for (const area of STORAGE_AREAS) {
            if (Object.keys(byArea[area]).length === 0) {
                continue;
            }
            try {
                await this.setToStorage(area, byArea[area]);
                successes += 1;
            } catch (error) {
                failures.push({ area, error });
            }
        }

        if (
            Object.hasOwn(byArea.sync, 'loggingLevel') &&
            !failures.some((failure) => failure.area === 'sync')
        ) {
            setLoggingLevel(byArea.sync.loggingLevel as number);
        }

        if (failures.length > 0) {
            const completeFailure = successes === 0;
            throw new ConfigWriteError(
                completeFailure
                    ? `setMultiple() failed completely: ${failures.length} storage area(s) failed`
                    : `setMultiple() completed with partial failures: ${successes} area(s) succeeded, ${failures.length} area(s) failed`,
                { completeFailure, errors: failures }
            );
        }
        return detach(preparedSettings);
    }

    // ------------------------------------------------------ change broadcast

    /**
     * Subscribe to schema-projected setting changes. Sensitive changes reach a
     * listener only when it registered with an own, exact
     * `includeSensitive: true` option. Returns an unsubscribe function.
     */
    onChanged(callback: ChangeListener, options: ReadOptions = {}): () => void {
        if (typeof callback !== 'function') {
            throw new TypeError(
                'ConfigService onChanged requires a callable callback'
            );
        }
        const record = {
            includeSensitive: isSensitiveAccessExplicitlyEnabled(options),
            callback,
        };
        this.changeListeners.add(record);
        return () => {
            this.changeListeners.delete(record);
        };
    }

    /**
     * Project raw storage changes through the schema: for each schema key of
     * the changed area, an invalid or absent newValue projects the fresh
     * default. Live projection is deliberately read-only — startup repair owns
     * canonical persistence, so storage changes cannot form repair loops.
     */
    private projectStorageChanges(
        changes: Record<string, { newValue?: unknown }>,
        areaName: string
    ): SettingsChanges {
        const projected: Record<string, unknown> = {};
        for (const key of SETTINGS_KEYS) {
            if (configSchema[key].scope !== areaName) {
                continue;
            }
            if (!Object.hasOwn(changes, key)) {
                continue;
            }
            const change = changes[key];
            const prepared =
                change !== null &&
                typeof change === 'object' &&
                Object.hasOwn(change, 'newValue')
                    ? this.tryPrepare(key, change.newValue)
                    : ({ ok: false } as const);
            projected[key] = prepared.ok
                ? prepared.value
                : getDefaultValue(key);
        }
        return projected;
    }

    private projectChangesForListener(
        changes: SettingsChanges,
        includeSensitive: boolean
    ): SettingsChanges {
        const listenerChanges: Record<string, unknown> = {};
        for (const key of Object.keys(changes)) {
            if (!isSettingsKey(key)) {
                continue;
            }
            if (!includeSensitive && configSchema[key].sensitive) {
                continue;
            }
            listenerChanges[key] = detach(
                (changes as Record<string, unknown>)[key]
            );
        }
        return listenerChanges;
    }

    /** Wire chrome.storage.onChanged into the schema-projected broadcast. */
    initializeChangeListener(): void {
        if (this.changeListenerInitialized) {
            return;
        }
        this.changeListenerInitialized = true;

        browser.storage.onChanged.addListener((changes, areaName) => {
            const relevantChanges = this.projectStorageChanges(
                changes,
                areaName
            );
            const changedKeys = Object.keys(relevantChanges);
            if (changedKeys.length === 0) {
                return;
            }

            // Subscription mutations made by callbacks take effect on the
            // next storage event, not midway through the current one.
            const listenerSnapshot = [...this.changeListeners];
            for (const record of listenerSnapshot) {
                const listenerChanges = this.projectChangesForListener(
                    relevantChanges,
                    record.includeSensitive
                );
                if (Object.keys(listenerChanges).length === 0) {
                    continue;
                }
                try {
                    void Promise.resolve(
                        record.callback(listenerChanges)
                    ).catch(() => {
                        this.logger.error(
                            'Error in change listener callback',
                            null,
                            { areaName, changedKeys }
                        );
                    });
                } catch {
                    this.logger.error(
                        'Error in change listener callback',
                        null,
                        {
                            areaName,
                            changedKeys,
                        }
                    );
                }
            }

            if (Object.hasOwn(relevantChanges, 'loggingLevel')) {
                setLoggingLevel(relevantChanges.loggingLevel as number);
            }
        });
    }

    // ------------------------------------------------------------- lifecycle

    /**
     * Register the onInstalled defaults pass. The migration hook runs BEFORE
     * defaults are written — the reverse order would resurrect retired keys
     * and mis-scope credentials.
     */
    initializeDefaults(beforeDefaults?: () => Promise<void>): void {
        browser.runtime.onInstalled.addListener((details) => {
            if (details.reason !== 'install' && details.reason !== 'update') {
                return;
            }
            void (async () => {
                try {
                    await beforeDefaults?.();
                } catch (error) {
                    this.logger.warn(
                        'Pre-default configuration migration failed; continuing with schema defaults',
                        {
                            reason: details.reason,
                            errorName: (error as Error)?.name,
                        }
                    );
                }
                await this.setDefaultsForMissingKeys();
            })();
        });
    }

    /**
     * Repair pass: persist canonical values for every key whose stored value
     * is missing, invalid, or non-canonical. Tolerates per-area read failures
     * (that area is skipped); throws only when every attempted repair write
     * failed.
     */
    async setDefaultsForMissingKeys(): Promise<void> {
        const repairs: Record<StorageArea, Record<string, unknown>> = {
            sync: {},
            local: {},
        };

        for (const area of STORAGE_AREAS) {
            const areaKeys = getKeysByScope(area);
            let items: Record<string, unknown>;
            try {
                items = await this.getFromStorage(area, areaKeys, true);
            } catch {
                continue;
            }
            for (const key of areaKeys) {
                const resolved = this.resolveStoredValue(key, items);
                if (resolved.needsRepair) {
                    repairs[area][key] = resolved.value;
                }
            }
        }

        const failures: { area: StorageArea; error: unknown }[] = [];
        let attempted = 0;
        let succeeded = 0;
        for (const area of STORAGE_AREAS) {
            const areaRepairs = repairs[area];
            if (Object.keys(areaRepairs).length === 0) {
                continue;
            }
            attempted += 1;
            try {
                await this.setToStorage(area, areaRepairs);
                succeeded += 1;
                this.logger.info('Repaired configuration defaults', {
                    area,
                    keys: Object.keys(areaRepairs),
                });
            } catch (error) {
                failures.push({ area, error });
            }
        }

        if (attempted > 0 && succeeded === 0 && failures.length > 0) {
            throw new ConfigWriteError(
                `setDefaultsForMissingKeys() failed completely: ${failures.length} set operation(s) failed`,
                { completeFailure: true, errors: failures }
            );
        }
    }

    /** Write every schema default to storage. */
    async resetToDefaults(): Promise<void> {
        const defaults: Record<StorageArea, Record<string, unknown>> = {
            sync: {},
            local: {},
        };
        for (const key of SETTINGS_KEYS) {
            defaults[configSchema[key].scope][key] = getDefaultValue(key);
        }
        await Promise.all([
            this.setToStorage('sync', defaults.sync),
            this.setToStorage('local', defaults.local),
        ]);
        setLoggingLevel(defaults.sync.loggingLevel as number);
    }

    /** Remove every schema key from storage; aggregates area failures. */
    async clearAll(): Promise<void> {
        const failures: { area: StorageArea; error: unknown }[] = [];
        let successes = 0;
        for (const area of STORAGE_AREAS) {
            try {
                await this.removeFromStorage(area, getKeysByScope(area));
                successes += 1;
            } catch (error) {
                failures.push({ area, error });
            }
        }
        if (failures.length > 0) {
            if (successes === 0) {
                throw failures[0]!.error;
            }
            throw new ConfigWriteError(
                `clearAll() completed with partial failures: ${successes} area(s) succeeded, ${failures.length} area(s) failed`,
                { completeFailure: false, errors: failures }
            );
        }
    }
}

export const configService = new ConfigService();
configService.initializeChangeListener();
