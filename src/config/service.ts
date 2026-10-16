import { browser } from 'wxt/browser';
import { createLogger, setLoggingLevel } from '@/shared/logger';
import type { PlatformId } from '@/shared/platforms';
import {
    SETTINGS_KEYS,
    configSchema,
    getDefaultValue,
    getKeysByScope,
    isSettingsKey,
    isSiteSettingKey,
    prepareSettingValue,
    sameSettingValue,
    siteProfileOf,
    type SettingsKey,
    type SettingsValues,
    type SiteProfile,
    type SiteSettingKey,
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
    /** Resolve site settings as this site sees them: its own values over
     *  the shared ones. */
    site?: PlatformId;
}

/** Where a write of site settings lands for one site. */
export interface SiteWrite {
    readonly site: PlatformId;
    /** `own` gives the site its own values; a value equal to the shared one
     *  drops the site's own instead. `source` changes each value where the
     *  site gets it from: its own value when it has one, which stays its own
     *  even when it comes to equal the shared one, else the shared one. */
    readonly target: 'own' | 'source';
}

export type SettingsChanges = Partial<SettingsValues>;
export type ChangeListener = (changes: SettingsChanges) => unknown;

/** The settings one site sees; content scripts read through this. */
export interface SiteConfig {
    get<K extends SettingsKey>(key: K): Promise<SettingsValues[K]>;
    getMultiple(keys: readonly string[]): Promise<Partial<SettingsValues>>;
    onChanged(callback: ChangeListener): () => void;
}

interface ChangeListenerRecord {
    readonly includeSensitive: boolean;
    readonly site: PlatformId | null;
    readonly callback: ChangeListener;
    /** Site projections read storage; they are delivered in event order. */
    delivery: Promise<void>;
    /** Site keys a failed read left unprojected; the next event reads them
     *  again and reports what the site sees. */
    readonly missed: Set<SiteSettingKey>;
}

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

/** `profiles` with `site`'s own values replaced; an empty profile goes. */
function withSiteProfile(
    profiles: SettingsValues['siteProfiles'],
    site: PlatformId,
    own: Record<string, unknown>
): SettingsValues['siteProfiles'] {
    const next = { ...profiles };
    if (Object.keys(own).length > 0) {
        next[site] = own;
    } else {
        delete next[site];
    }
    return next;
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
    private readonly changeListeners = new Set<ChangeListenerRecord>();
    private changeListenerInitialized = false;
    /** The latest rewrite of `siteProfiles` in this context, settled or not. */
    private profilesSettled: Promise<unknown> = Promise.resolve();

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

    /** `site`'s own values from the stored items of the sync area, which
     *  must include `siteProfiles`; empty without a site. */
    private siteProfileIn(
        site: PlatformId | undefined,
        syncItems: Record<string, unknown>
    ): SiteProfile {
        if (!site) {
            return {};
        }
        const { value } = this.resolveStoredValue('siteProfiles', syncItems);
        return siteProfileOf(value as SettingsValues['siteProfiles'], site);
    }

    /** One key's value as the site sees it. */
    private resolveForSite(
        key: SettingsKey,
        items: Record<string, unknown>,
        profile: SiteProfile
    ): unknown {
        return isSiteSettingKey(key) && Object.hasOwn(profile, key)
            ? profile[key]
            : this.resolveStoredValue(key, items).value;
    }

    /** The sync keys to read for `keys`: `siteProfiles` joins them when a
     *  site's own values may apply. */
    private syncReadKeys(
        keys: readonly SettingsKey[],
        site: PlatformId | undefined
    ): SettingsKey[] {
        return site &&
            keys.some(isSiteSettingKey) &&
            !keys.includes('siteProfiles')
            ? [...keys, 'siteProfiles']
            : [...keys];
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
                    ? this.getFromStorage(
                          area,
                          area === 'sync'
                              ? this.syncReadKeys(keysByArea.sync, options.site)
                              : keysByArea[area],
                          privacySafe
                      )
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
            const profile =
                area === 'sync'
                    ? this.siteProfileIn(options.site, areaRead.value)
                    : {};
            for (const key of areaKeys) {
                const { usedDefault, invalidStoredValue } =
                    this.resolveStoredValue(key, areaRead.value);
                (result.values as Record<string, unknown>)[key] = detach(
                    this.resolveForSite(key, areaRead.value, profile)
                );
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
    async get<K extends SettingsKey>(
        key: K,
        options?: Pick<ReadOptions, 'site'>
    ): Promise<SettingsValues[K]>;
    async get(
        key: string,
        options?: Pick<ReadOptions, 'site'>
    ): Promise<unknown>;
    async get(
        key: string,
        options: Pick<ReadOptions, 'site'> = {}
    ): Promise<unknown> {
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
                scope === 'sync'
                    ? this.syncReadKeys([key], options.site)
                    : [key],
                configSchema[key].sensitive === true
            );
            const profile =
                scope === 'sync' ? this.siteProfileIn(options.site, items) : {};
            return detach(this.resolveForSite(key, items, profile));
        } catch {
            return getDefaultValue(key);
        }
    }

    /** Multi-value read; throws on storage failure, skips unknown keys. */
    async getMultiple(
        keys: readonly string[],
        options: Pick<ReadOptions, 'site'> = {}
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
                ? this.getFromStorage(
                      'sync',
                      this.syncReadKeys(keysByArea.sync, options.site),
                      privacySafe
                  )
                : Promise.resolve({}),
            keysByArea.local.length > 0
                ? this.getFromStorage('local', keysByArea.local, privacySafe)
                : Promise.resolve({}),
        ]);

        const profile = this.siteProfileIn(options.site, syncItems);
        const result: Record<string, unknown> = {};
        for (const key of validKeys) {
            const items =
                configSchema[key].scope === 'sync' ? syncItems : localItems;
            result[key] = detach(this.resolveForSite(key, items, profile));
        }
        return result;
    }

    /** The settings `site` sees, for code that only ever reads one site. */
    forSite(site: PlatformId): SiteConfig {
        return {
            get: (key) => this.get(key, { site }),
            getMultiple: (keys) => this.getMultiple(keys, { site }),
            onChanged: (callback) => this.onChanged(callback, { site }),
        };
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
     * aggregates area failures. A write that rewrites `siteProfiles` waits for
     * the one before it, so it builds on the profiles that one left.
     */
    setMultiple(
        settings: Partial<SettingsValues>,
        siteWrite?: SiteWrite
    ): Promise<Partial<SettingsValues>> {
        return siteWrite || Object.hasOwn(settings, 'siteProfiles')
            ? this.afterProfiles(() => this.writeMultiple(settings, siteWrite))
            : this.writeMultiple(settings, siteWrite);
    }

    /** Run `change` once every earlier rewrite of `siteProfiles` in this
     *  context has settled; each reads the profiles and writes them whole. */
    private afterProfiles<T>(change: () => Promise<T>): Promise<T> {
        const result = this.profilesSettled.then(change);
        this.profilesSettled = result.catch(() => undefined);
        return result;
    }

    private async writeMultiple(
        settings: Partial<SettingsValues>,
        siteWrite?: SiteWrite
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
        if (siteWrite) {
            await this.routeSiteValues(siteWrite, byArea.sync);
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

    /**
     * Move the site settings among `syncWrites` into the site's own values
     * where `siteWrite` says they land. The shared values and `siteProfiles`
     * share the sync area, so the whole change is one storage write.
     */
    private async routeSiteValues(
        { site, target }: SiteWrite,
        syncWrites: Record<string, unknown>
    ): Promise<void> {
        const keys = Object.keys(syncWrites).filter(isSiteSettingKey);
        if (keys.length === 0) {
            return;
        }
        const items = await this.getFromStorage(
            'sync',
            [...keys, 'siteProfiles'],
            false
        );
        const profiles = this.resolveStoredValue('siteProfiles', items)
            .value as SettingsValues['siteProfiles'];
        // The stored entry, with what a newer version wrote, not just what
        // this one reads.
        const own: Record<string, unknown> = { ...profiles[site] };
        // A value this version cannot read leaves the site on the shared
        // one, so the shared one is the source.
        const readable = siteProfileOf(profiles, site);
        let routed = false;
        for (const key of keys) {
            if (target === 'source' && !Object.hasOwn(readable, key)) {
                continue;
            }
            routed = true;
            const value = syncWrites[key];
            delete syncWrites[key];
            if (
                target === 'own' &&
                sameSettingValue(
                    value,
                    this.resolveStoredValue(key, items).value
                )
            ) {
                delete own[key];
            } else {
                own[key] = value;
            }
        }
        if (routed) {
            syncWrites.siteProfiles = withSiteProfile(profiles, site, own);
        }
    }

    /**
     * `sites` follow the shared values of `keys` again, and `shared` is
     * written in the same storage write. Resolves to what the write
     * replaced, the profiles and the shared values, for `restoreSiteValues`.
     */
    removeSiteValues(
        sites: readonly PlatformId[],
        keys: readonly SiteSettingKey[],
        shared: Partial<Omit<SettingsValues, 'siteProfiles'>> = {}
    ): Promise<Partial<SettingsValues>> {
        return this.rewriteSiteValues(sites, keys, {}, shared);
    }

    /**
     * Put back what `before` holds: its shared values, and for each of
     * `sites` its own values for `keys` as `before.siteProfiles` had them,
     * none where it had none. Every other site and key stays as stored now.
     */
    async restoreSiteValues(
        before: Partial<SettingsValues>,
        sites: readonly PlatformId[],
        keys: readonly SiteSettingKey[]
    ): Promise<void> {
        const { siteProfiles = {}, ...shared } = before;
        await this.rewriteSiteValues(sites, keys, siteProfiles, shared);
    }

    /** Give `sites` the own values for `keys` that `source` holds, over the
     *  profiles stored now, with `shared` in the same write. Reads strictly:
     *  a profile read from a failed store would erase every site's. */
    private rewriteSiteValues(
        sites: readonly PlatformId[],
        keys: readonly SiteSettingKey[],
        source: SettingsValues['siteProfiles'],
        shared: Partial<SettingsValues>
    ): Promise<Partial<SettingsValues>> {
        return this.afterProfiles(async () => {
            const { values } = await this.readMultipleResultStrict([
                ...Object.keys(shared),
                'siteProfiles',
            ]);
            let profiles = values.siteProfiles ?? {};
            for (const site of sites) {
                const own: Record<string, unknown> = { ...profiles[site] };
                const held = source[site] ?? {};
                for (const key of keys) {
                    if (Object.hasOwn(held, key)) {
                        own[key] = held[key];
                    } else {
                        delete own[key];
                    }
                }
                profiles = withSiteProfile(profiles, site, own);
            }
            await this.writeMultiple({ ...shared, siteProfiles: profiles });
            return values;
        });
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
        const record: ChangeListenerRecord = {
            includeSensitive: isSensitiveAccessExplicitlyEnabled(options),
            site: options.site ?? null,
            callback,
            delivery: Promise.resolve(),
            missed: new Set(),
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

    /**
     * The changes as `site` sees them, read after the storage event: a
     * shared change the site's own value hides is dropped, and a site value
     * added, changed, or removed reports what the site sees now, as does a
     * key in `missed`. When the read fails, the site keys join `missed`.
     */
    private async projectForSite(
        site: PlatformId,
        changes: SettingsChanges,
        rawSiteProfiles: { oldValue?: unknown } | undefined,
        missed: Set<SiteSettingKey>
    ): Promise<SettingsChanges> {
        const projected: Record<string, unknown> = {};
        const recovering = new Set(missed);
        const touched = new Set(missed);
        for (const [key, value] of Object.entries(changes)) {
            if (isSiteSettingKey(key)) {
                touched.add(key);
            } else {
                projected[key] = value;
            }
        }
        const previous = rawSiteProfiles
            ? this.tryPrepare('siteProfiles', rawSiteProfiles.oldValue)
            : null;
        const before = previous
            ? siteProfileOf(
                  (previous.ok
                      ? previous.value
                      : {}) as SettingsValues['siteProfiles'],
                  site
              )
            : null;
        if (before) {
            const after = changes.siteProfiles
                ? siteProfileOf(changes.siteProfiles, site)
                : {};
            for (const key of new Set([
                ...Object.keys(before),
                ...Object.keys(after),
            ])) {
                if (
                    isSiteSettingKey(key) &&
                    !sameSettingValue(before[key], after[key])
                ) {
                    touched.add(key);
                }
            }
        }
        if (touched.size === 0) {
            return projected;
        }
        let items: Record<string, unknown>;
        try {
            items = await this.getFromStorage(
                'sync',
                [...touched, 'siteProfiles'],
                false
            );
        } catch (error) {
            for (const key of touched) {
                missed.add(key);
            }
            this.logger.warn('Site change projection deferred', {
                site,
                reason: error instanceof Error ? error.name : 'unknown',
            });
            return projected;
        }
        missed.clear();
        const profile = this.siteProfileIn(site, items);
        for (const key of touched) {
            const hiddenSharedChange =
                !recovering.has(key) &&
                Object.hasOwn(changes, key) &&
                Object.hasOwn(profile, key) &&
                (before === null ||
                    sameSettingValue(before[key], profile[key]));
            if (!hiddenSharedChange) {
                projected[key] = this.resolveForSite(key, items, profile);
            }
        }
        return projected;
    }

    private deliver(
        record: ChangeListenerRecord,
        changes: SettingsChanges,
        context: { areaName: string; changedKeys: string[] }
    ): void {
        const listenerChanges = this.projectChangesForListener(
            changes,
            record.includeSensitive
        );
        if (Object.keys(listenerChanges).length === 0) {
            return;
        }
        try {
            void Promise.resolve(record.callback(listenerChanges)).catch(() => {
                this.logger.error(
                    'Error in change listener callback',
                    null,
                    context
                );
            });
        } catch {
            this.logger.error(
                'Error in change listener callback',
                null,
                context
            );
        }
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
            const context = { areaName, changedKeys };
            const rawSiteProfiles = Object.hasOwn(changes, 'siteProfiles')
                ? (changes.siteProfiles as { oldValue?: unknown })
                : undefined;
            for (const record of [...this.changeListeners]) {
                const { site } = record;
                if (site === null) {
                    this.deliver(record, relevantChanges, context);
                    continue;
                }
                record.delivery = record.delivery
                    .then(async () => {
                        if (this.changeListeners.has(record)) {
                            this.deliver(
                                record,
                                await this.projectForSite(
                                    site,
                                    relevantChanges,
                                    rawSiteProfiles,
                                    record.missed
                                ),
                                context
                            );
                        }
                    })
                    .catch(() => {
                        this.logger.error(
                            'Site change projection failed',
                            null,
                            context
                        );
                    });
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
    /** Apply the stored logging level (schema default when unreadable). */
    async syncLoggingLevel(): Promise<void> {
        setLoggingLevel(await this.get('loggingLevel'));
    }

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
