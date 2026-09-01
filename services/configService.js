import {
    configSchema,
    getKeysByScope,
    prepareSettingValue,
    getDefaultValue,
} from '../config/configSchema.js';
import {
    ConfigServiceErrorHandler,
    ConfigServiceReadError,
    requireConfigServiceRead,
} from './configServiceErrorHandler.js';
import Logger from '../utils/logger.js';

export { ConfigServiceReadError };

const STORED_BOOLEAN_UNAVAILABLE_MESSAGE =
    'Stored boolean configuration is unavailable';
const RESULT_READ_KEYS_MESSAGE =
    'ConfigService result reads require an array of string keys';
const MULTIPLE_READ_KEYS_MESSAGE =
    'ConfigService getMultiple requires an array of string keys';
const STORAGE_AREAS = ['sync', 'local'];
const CONFIG_KEYS = Object.keys(configSchema);

function isOwnConfigKey(key) {
    return typeof key === 'string' && Object.hasOwn(configSchema, key);
}

function snapshotStringKeys(keys, errorMessage) {
    if (!Array.isArray(keys) || keys.some((key) => typeof key !== 'string')) {
        throw new TypeError(errorMessage);
    }
    return [...keys];
}

function dedupeStringKeys(keys) {
    const uniqueKeys = [];
    const seen = new Set();
    for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index];
        if (!seen.has(key)) {
            seen.add(key);
            uniqueKeys.push(key);
        }
    }
    return uniqueKeys;
}

export function isSensitiveAccessExplicitlyEnabled(options) {
    return (
        options !== null &&
        (typeof options === 'object' || typeof options === 'function') &&
        Object.hasOwn(options, 'includeSensitive') &&
        options.includeSensitive === true
    );
}

function cloneConfigReadValue(value) {
    if (value === null || typeof value !== 'object') return value;

    return globalThis.structuredClone(value);
}

class ConfigService {
    constructor() {
        this.changeListeners = new Set();
        this.isInitialized = false;
        this.logger = Logger.create('ConfigService', this);
        this.initializeLogger();
    }

    /**
     * Initialize logger with logging level detection
     */
    async initializeLogger() {
        try {
            await this.logger.updateLevel();
        } catch (error) {
            // Logger initialization shouldn't block service initialization
            // Use console.warn here since logger may not be fully initialized
            console.warn(
                'ConfigService: Failed to initialize logger level:',
                error
            );
        }
    }

    async _updateLoggingLevelAfterPersistedWrite(level, method) {
        try {
            await this.logger.updateLevel(level);
            return true;
        } catch {
            try {
                this.logger.error(
                    'Failed to update logging level after persisted configuration write',
                    null,
                    {
                        method,
                        category: 'update-failed',
                    }
                );
            } catch {
                // Persisted configuration remains authoritative even if logging fails.
            }
            return false;
        }
    }

    /**
     * Sets default values on first install by reading from the schema.
     * This should be called from the background script.
     */
    initializeDefaults(beforeDefaults) {
        chrome.runtime.onInstalled.addListener(async (details) => {
            if (details.reason === 'install' || details.reason === 'update') {
                this.logger.info('Setting default configuration from schema', {
                    reason: details.reason,
                    method: 'initializeDefaults',
                });
                try {
                    await beforeDefaults?.();
                } catch (error) {
                    this.logger.warn(
                        'Pre-default configuration migration failed; continuing with schema defaults',
                        {
                            reason: details.reason,
                            errorName: error?.name,
                        }
                    );
                }
                await this.setDefaultsForMissingKeys();
            }
        });
    }

    /**
     * Sets default values for any missing keys in storage.
     * This ensures backward compatibility when new settings are added.
     */
    async setDefaultsForMissingKeys() {
        this.logger.debug(`setDefaultsForMissingKeys() called`);

        const syncKeys = getKeysByScope('sync');
        const localKeys = getKeysByScope('local');

        this.logger.debug(`setDefaultsForMissingKeys() key breakdown`, {
            syncKeyCount: syncKeys.length,
            localKeyCount: localKeys.length,
            totalKeys: syncKeys.length + localKeys.length,
        });

        // Track results for detailed error reporting
        const results = {
            successful: [],
            failed: [],
            errors: [],
        };

        try {
            // Get current values from storage with individual error handling
            let syncItems = {};
            let localItems = {};
            let syncReadSucceeded = syncKeys.length === 0;
            let localReadSucceeded = localKeys.length === 0;

            // Get sync items with error handling
            if (syncKeys.length > 0) {
                try {
                    syncItems = await this.getFromStorage('sync', syncKeys, {
                        method: 'setDefaultsForMissingKeys',
                        operation: 'initialization-get-sync',
                    });
                    syncReadSucceeded = true;
                    this.logger.debug(
                        `setDefaultsForMissingKeys() sync items retrieved`,
                        {
                            requestedKeyCount: syncKeys.length,
                        }
                    );
                } catch (error) {
                    syncReadSucceeded = false;
                    this.logger.error(
                        'Failed to retrieve sync items during initialization',
                        error,
                        {
                            method: 'setDefaultsForMissingKeys',
                            operation: 'get-sync',
                            keyCount: syncKeys.length,
                        }
                    );
                    results.errors.push({
                        area: 'sync',
                        operation: 'get',
                        error,
                        keys: syncKeys,
                    });
                    syncItems = {};
                }
            }

            // Get local items with error handling
            if (localKeys.length > 0) {
                try {
                    localItems = await this.getFromStorage('local', localKeys, {
                        method: 'setDefaultsForMissingKeys',
                        operation: 'initialization-get-local',
                    });
                    localReadSucceeded = true;
                    this.logger.debug(
                        `setDefaultsForMissingKeys() local items retrieved`,
                        {
                            requestedKeyCount: localKeys.length,
                        }
                    );
                } catch (error) {
                    localReadSucceeded = false;
                    this.logger.error(
                        'Failed to retrieve local items during initialization',
                        error,
                        {
                            method: 'setDefaultsForMissingKeys',
                            operation: 'get-local',
                            keyCount: localKeys.length,
                        }
                    );
                    results.errors.push({
                        area: 'local',
                        operation: 'get',
                        error,
                        keys: localKeys,
                    });
                    localItems = {};
                }
            }

            // Determine which defaults need to be set
            const syncDefaults = {};
            const localDefaults = {};

            // Set missing sync defaults
            if (syncReadSucceeded) {
                for (const key of syncKeys) {
                    const resolved = this._resolveStoredValue(key, syncItems);
                    if (resolved.needsRepair) {
                        syncDefaults[key] = resolved.value;
                    }
                }
            }

            // Set missing local defaults
            if (localReadSucceeded) {
                for (const key of localKeys) {
                    const resolved = this._resolveStoredValue(key, localItems);
                    if (resolved.needsRepair) {
                        localDefaults[key] = resolved.value;
                    }
                }
            }

            this.logger.debug(`setDefaultsForMissingKeys() defaults to set`, {
                syncDefaultsCount: Object.keys(syncDefaults).length,
                localDefaultsCount: Object.keys(localDefaults).length,
                syncDefaultKeys: Object.keys(syncDefaults),
                localDefaultKeys: Object.keys(localDefaults),
            });

            // Apply defaults with enhanced error handling and aggregation
            if (Object.keys(syncDefaults).length > 0) {
                try {
                    await this.setToStorage('sync', syncDefaults, {
                        method: 'setDefaultsForMissingKeys',
                        operation: 'initialization-set-sync',
                    });
                    results.successful.push({
                        area: 'sync',
                        operation: 'set',
                        keys: Object.keys(syncDefaults),
                        count: Object.keys(syncDefaults).length,
                    });
                    this.logger.info('Successfully set sync defaults', {
                        keys: Object.keys(syncDefaults),
                        count: Object.keys(syncDefaults).length,
                    });
                } catch (error) {
                    results.failed.push({
                        area: 'sync',
                        operation: 'set',
                        keys: Object.keys(syncDefaults),
                        count: Object.keys(syncDefaults).length,
                    });
                    results.errors.push({
                        area: 'sync',
                        operation: 'set',
                        error,
                        keys: Object.keys(syncDefaults),
                    });
                    this.logger.error(
                        'Failed to set sync defaults in storage',
                        error,
                        {
                            method: 'setDefaultsForMissingKeys',
                            operation: 'set-sync',
                            keys: Object.keys(syncDefaults),
                            keyCount: Object.keys(syncDefaults).length,
                        }
                    );
                }
            }

            if (Object.keys(localDefaults).length > 0) {
                try {
                    await this.setToStorage('local', localDefaults, {
                        method: 'setDefaultsForMissingKeys',
                        operation: 'initialization-set-local',
                    });
                    results.successful.push({
                        area: 'local',
                        operation: 'set',
                        keys: Object.keys(localDefaults),
                        count: Object.keys(localDefaults).length,
                    });
                    this.logger.info('Successfully set local defaults', {
                        keys: Object.keys(localDefaults),
                        count: Object.keys(localDefaults).length,
                    });
                } catch (error) {
                    results.failed.push({
                        area: 'local',
                        operation: 'set',
                        keys: Object.keys(localDefaults),
                        count: Object.keys(localDefaults).length,
                    });
                    results.errors.push({
                        area: 'local',
                        operation: 'set',
                        error,
                        keys: Object.keys(localDefaults),
                    });
                    this.logger.error(
                        'Failed to set local defaults in storage',
                        error,
                        {
                            method: 'setDefaultsForMissingKeys',
                            operation: 'set-local',
                            keys: Object.keys(localDefaults),
                            keyCount: Object.keys(localDefaults).length,
                        }
                    );
                }
            }

            // Handle results and provide detailed error information
            const totalOperationsAttempted =
                (Object.keys(syncDefaults).length > 0 ? 1 : 0) +
                (Object.keys(localDefaults).length > 0 ? 1 : 0);
            const totalKeysAttempted =
                Object.keys(syncDefaults).length +
                Object.keys(localDefaults).length;
            const totalKeysSet = results.successful.reduce(
                (sum, result) => sum + result.count,
                0
            );
            const totalKeysFailed = results.failed.reduce(
                (sum, result) => sum + result.count,
                0
            );

            if (results.errors.length > 0) {
                // Filter out only 'set' operation errors for determining complete vs partial failure
                const setErrors = results.errors.filter(
                    (e) => e.operation === 'set'
                );
                const setSuccessful = results.successful.filter(
                    (s) => s.operation === 'set'
                );

                if (
                    setSuccessful.length === 0 &&
                    setErrors.length > 0 &&
                    totalKeysAttempted > 0
                ) {
                    // Complete failure for setting defaults (all set operations failed)
                    const errorMsg = `setDefaultsForMissingKeys() failed completely: ${setErrors.length} set operation(s) failed`;
                    const aggregatedError = new Error(errorMsg);
                    aggregatedError.completeFailure = true;
                    aggregatedError.failed = results.failed.filter(
                        (f) => f.operation === 'set'
                    );
                    aggregatedError.errors = setErrors;
                    aggregatedError.totalKeysAttempted = totalKeysAttempted;

                    this.logger.error(errorMsg, aggregatedError, {
                        method: 'setDefaultsForMissingKeys',
                        totalKeysAttempted,
                        totalOperationsAttempted,
                        failedOperations: results.failed
                            .filter((f) => f.operation === 'set')
                            .map((f) => `${f.area}-${f.operation}`),
                        errors: setErrors.map((e) => ({
                            area: e.area,
                            operation: e.operation,
                            message: e.error.message,
                        })),
                    });

                    // Still mark as initialized to prevent blocking, but throw error
                    this.isInitialized = true;
                    throw aggregatedError;
                } else if (setSuccessful.length > 0 && setErrors.length > 0) {
                    // Partial failure - some set operations succeeded, some failed
                    const errorMsg = `setDefaultsForMissingKeys() completed with partial failures: ${setSuccessful.length} set operation(s) succeeded, ${setErrors.length} set operation(s) failed`;

                    this.logger.warn(errorMsg, {
                        method: 'setDefaultsForMissingKeys',
                        totalKeysAttempted,
                        totalKeysSet,
                        totalKeysFailed,
                        totalOperationsAttempted,
                        successfulOperations: results.successful.map(
                            (s) => `${s.area}-${s.operation}`
                        ),
                        failedOperations: results.failed.map(
                            (f) => `${f.area}-${f.operation}`
                        ),
                        errors: results.errors.map((e) => ({
                            area: e.area,
                            operation: e.operation,
                            message: e.error.message,
                        })),
                    });
                } else if (
                    setErrors.length === 0 &&
                    results.errors.length > 0
                ) {
                    // Only retrieval errors, but no defaults to set
                    this.logger.warn(
                        'setDefaultsForMissingKeys() had retrieval errors but no defaults needed',
                        {
                            method: 'setDefaultsForMissingKeys',
                            retrievalErrors: results.errors.filter(
                                (e) => e.operation === 'get'
                            ).length,
                            errors: results.errors.map((e) => ({
                                area: e.area,
                                operation: e.operation,
                                message: e.error.message,
                            })),
                        }
                    );
                }
            } else {
                // Complete success
                this.logger.debug(
                    `setDefaultsForMissingKeys() completed successfully`,
                    {
                        totalKeysSet,
                        syncDefaultsSet: Object.keys(syncDefaults).length,
                        localDefaultsSet: Object.keys(localDefaults).length,
                        successfulOperations: results.successful.map(
                            (s) => `${s.area}-${s.operation}`
                        ),
                    }
                );
            }

            this.isInitialized = true;
        } catch (error) {
            // Catch any unexpected errors not handled above
            this.logger.error(
                'Unexpected error in setDefaultsForMissingKeys',
                error,
                {
                    method: 'setDefaultsForMissingKeys',
                    syncKeyCount: syncKeys.length,
                    localKeyCount: localKeys.length,
                    resultsState: {
                        successfulCount: results.successful.length,
                        failedCount: results.failed.length,
                        errorCount: results.errors.length,
                    },
                }
            );
            // Still mark as initialized to prevent blocking
            this.isInitialized = true;
            throw error;
        }
    }

    /**
     * Checks if Chrome storage API is available for the specified area
     * @param {string} area - 'sync' or 'local'
     * @param {string} operation - The operation being performed (for error messages)
     * @param {object} logContext - Additional context for logging
     * @param {{privacySafeLogs?: boolean, keyCount?: number}} logOptions
     * @returns {boolean} True if available, false otherwise
     * @private
     */
    _checkChromeStorageAvailability(
        area,
        operation,
        logContext = {},
        logOptions = {}
    ) {
        const chromeAvailable = typeof chrome !== 'undefined';
        const storageAvailable = chromeAvailable && Boolean(chrome.storage);
        const areaAvailable = storageAvailable && Boolean(chrome.storage[area]);

        if (!areaAvailable) {
            const error = new Error(
                `Chrome storage API not available for ${operation} operation (area: ${area})`
            );
            if (logOptions?.privacySafeLogs === true) {
                this.logger.error(
                    `Chrome storage API unavailable for ${operation}`,
                    null,
                    {
                        operation,
                        area,
                        keyCount: logOptions.keyCount,
                        category: 'unavailable',
                    }
                );
            } else {
                this.logger.error(
                    `Chrome storage API unavailable for ${operation}`,
                    error,
                    {
                        area,
                        operation,
                        ...logContext,
                        chromeAvailable,
                        storageAvailable,
                        areaAvailable,
                    }
                );
            }
            return false;
        }
        return true;
    }

    /**
     * Internal method to get data from a specific storage area
     * @param {string} area - 'sync' or 'local'
     * @param {string[]} keys - Array of keys to retrieve
     * @param {object} context - Additional context for error handling
     * @param {{privacySafeLogs?: boolean}} logOptions - Redacts key names and
     * raw error details from this operation's logs when enabled.
     * @returns {Promise<object>}
     */
    async getFromStorage(area, keys, context = {}, logOptions = {}) {
        const normalizedKeys = Array.isArray(keys) ? keys : [keys];
        const startTime = Date.now();
        const privacySafeLogs = logOptions?.privacySafeLogs === true;
        const createPrivacySafeLogData = (category, details = {}) => ({
            operation: 'get',
            area,
            keyCount: normalizedKeys.length,
            ...details,
            category,
        });

        // Check if chrome.storage is available
        if (
            !this._checkChromeStorageAvailability(
                area,
                'get',
                {
                    keys: normalizedKeys,
                    context,
                },
                {
                    privacySafeLogs,
                    keyCount: normalizedKeys.length,
                }
            )
        ) {
            throw ConfigServiceErrorHandler.createStorageError(
                'get',
                area,
                normalizedKeys,
                new Error('Chrome storage API is unavailable'),
                {
                    ...context,
                    duration: Date.now() - startTime,
                    method: 'getFromStorage',
                    storageUnavailable: true,
                }
            );
        }

        this.logger.debug(
            `Starting get operation`,
            privacySafeLogs
                ? createPrivacySafeLogData('start')
                : {
                      area,
                      keys: normalizedKeys,
                      context,
                  }
        );

        return new Promise((resolve, reject) => {
            try {
                chrome.storage[area].get(keys, (items) => {
                    const duration = Date.now() - startTime;

                    if (chrome.runtime.lastError) {
                        const error =
                            ConfigServiceErrorHandler.createStorageError(
                                'get',
                                area,
                                normalizedKeys,
                                chrome.runtime.lastError,
                                {
                                    ...context,
                                    duration,
                                    method: 'getFromStorage',
                                }
                            );

                        // Special handling for quota exceeded errors
                        if (privacySafeLogs) {
                            this.logger.error(
                                error.isQuotaError
                                    ? `Storage quota exceeded during get operation`
                                    : `Storage get operation failed`,
                                null,
                                createPrivacySafeLogData(
                                    error.isQuotaError
                                        ? 'quota-error'
                                        : 'runtime-error',
                                    { duration }
                                )
                            );
                        } else if (error.isQuotaError) {
                            this.logger.error(
                                `Storage quota exceeded during get operation`,
                                error,
                                {
                                    area,
                                    keys: normalizedKeys,
                                    duration,
                                    context,
                                    quotaError: true,
                                    recoveryAction: error.recoveryAction,
                                }
                            );
                        } else {
                            this.logger.error(
                                `Storage get operation failed`,
                                error,
                                {
                                    area,
                                    keys: normalizedKeys,
                                    duration,
                                    context,
                                }
                            );
                        }

                        reject(error);
                    } else {
                        const resultKeys = normalizedKeys.filter((key) =>
                            Object.hasOwn(items ?? {}, key)
                        );
                        this.logger.debug(
                            `Storage get operation completed`,
                            privacySafeLogs
                                ? createPrivacySafeLogData('success', {
                                      resultCount: resultKeys.length,
                                      duration,
                                  })
                                : {
                                      area,
                                      keys: normalizedKeys,
                                      keyCount: normalizedKeys.length,
                                      duration,
                                      resultKeys,
                                  }
                        );

                        resolve(items);
                    }
                });
            } catch (error) {
                const duration = Date.now() - startTime;
                const storageError =
                    ConfigServiceErrorHandler.createStorageError(
                        'get',
                        area,
                        normalizedKeys,
                        error,
                        {
                            ...context,
                            duration,
                            method: 'getFromStorage',
                            synchronousFailure: true,
                        }
                    );
                if (privacySafeLogs) {
                    this.logger.error(
                        'Chrome storage access failed',
                        null,
                        createPrivacySafeLogData('synchronous-error', {
                            duration,
                        })
                    );
                } else {
                    this.logger.error(
                        'Chrome storage access failed',
                        storageError,
                        {
                            area,
                            keys: normalizedKeys,
                            context,
                        }
                    );
                }
                reject(storageError);
            }
        });
    }

    /**
     * Internal method to set data to a specific storage area
     * @param {string} area - 'sync' or 'local'
     * @param {object} items - Object with key-value pairs to set
     * @param {object} context - Additional context for error handling
     * @returns {Promise<void>}
     */
    async setToStorage(area, items, context = {}) {
        const keys = Object.keys(items);
        const startTime = Date.now();

        // Check if chrome.storage is available
        if (
            !this._checkChromeStorageAvailability(area, 'set', {
                keys,
                itemCount: keys.length,
                context,
            })
        ) {
            throw ConfigServiceErrorHandler.createStorageError(
                'set',
                area,
                keys,
                new Error('Chrome storage API is unavailable'),
                {
                    ...context,
                    duration: Date.now() - startTime,
                    method: 'setToStorage',
                    itemCount: keys.length,
                    storageUnavailable: true,
                }
            );
        }

        this.logger.debug(`Starting set operation`, {
            area,
            keys,
            itemCount: keys.length,
            context,
        });

        return new Promise((resolve, reject) => {
            try {
                chrome.storage[area].set(items, () => {
                    const duration = Date.now() - startTime;

                    if (chrome.runtime.lastError) {
                        const error =
                            ConfigServiceErrorHandler.createStorageError(
                                'set',
                                area,
                                keys,
                                chrome.runtime.lastError,
                                {
                                    ...context,
                                    duration,
                                    method: 'setToStorage',
                                    itemCount: keys.length,
                                }
                            );

                        // Special handling for quota exceeded errors
                        if (error.isQuotaError) {
                            this.logger.error(
                                `Storage quota exceeded during set operation`,
                                error,
                                {
                                    area,
                                    keys,
                                    duration,
                                    itemCount: keys.length,
                                    context,
                                    quotaError: true,
                                    recoveryAction: error.recoveryAction,
                                }
                            );
                        } else {
                            this.logger.error(
                                `Storage set operation failed`,
                                error,
                                {
                                    area,
                                    keys,
                                    duration,
                                    itemCount: keys.length,
                                    context,
                                }
                            );
                        }

                        reject(error);
                    } else {
                        this.logger.debug(`Storage set operation completed`, {
                            area,
                            keys,
                            duration,
                            itemCount: keys.length,
                        });

                        resolve();
                    }
                });
            } catch (error) {
                const storageError =
                    ConfigServiceErrorHandler.createStorageError(
                        'set',
                        area,
                        keys,
                        error,
                        {
                            ...context,
                            duration: Date.now() - startTime,
                            method: 'setToStorage',
                            itemCount: keys.length,
                            synchronousFailure: true,
                        }
                    );
                this.logger.error(
                    'Chrome storage set operation failed',
                    storageError,
                    {
                        area,
                        keys,
                        context,
                    }
                );
                reject(storageError);
            }
        });
    }

    /**
     * Internal method to remove data from a specific storage area
     * @param {string} area - 'sync' or 'local'
     * @param {string|string[]} keys - Key or array of keys to remove
     * @param {object} context - Additional context for error handling
     * @returns {Promise<void>}
     */
    async removeFromStorage(area, keys, context = {}) {
        const normalizedKeys = Array.isArray(keys) ? keys : [keys];
        const startTime = Date.now();

        // Check if chrome.storage is available
        if (
            !this._checkChromeStorageAvailability(area, 'remove', {
                keys: normalizedKeys,
                keyCount: normalizedKeys.length,
                context,
            })
        ) {
            throw ConfigServiceErrorHandler.createStorageError(
                'remove',
                area,
                normalizedKeys,
                new Error('Chrome storage API is unavailable'),
                {
                    ...context,
                    duration: Date.now() - startTime,
                    method: 'removeFromStorage',
                    keyCount: normalizedKeys.length,
                    storageUnavailable: true,
                }
            );
        }

        this.logger.debug(`Starting remove operation`, {
            area,
            keys: normalizedKeys,
            keyCount: normalizedKeys.length,
            context,
        });

        return new Promise((resolve, reject) => {
            try {
                chrome.storage[area].remove(keys, () => {
                    const duration = Date.now() - startTime;

                    if (chrome.runtime.lastError) {
                        const error =
                            ConfigServiceErrorHandler.createStorageError(
                                'remove',
                                area,
                                normalizedKeys,
                                chrome.runtime.lastError,
                                {
                                    ...context,
                                    duration,
                                    method: 'removeFromStorage',
                                    keyCount: normalizedKeys.length,
                                }
                            );

                        // Special handling for quota exceeded errors
                        if (error.isQuotaError) {
                            this.logger.error(
                                `Storage quota exceeded during remove operation`,
                                error,
                                {
                                    area,
                                    keys: normalizedKeys,
                                    duration,
                                    keyCount: normalizedKeys.length,
                                    context,
                                    quotaError: true,
                                    recoveryAction: error.recoveryAction,
                                }
                            );
                        } else {
                            this.logger.error(
                                `Storage remove operation failed`,
                                error,
                                {
                                    area,
                                    keys: normalizedKeys,
                                    duration,
                                    keyCount: normalizedKeys.length,
                                    context,
                                }
                            );
                        }

                        reject(error);
                    } else {
                        this.logger.debug(
                            `Storage remove operation completed`,
                            {
                                area,
                                keys: normalizedKeys,
                                duration,
                                keyCount: normalizedKeys.length,
                            }
                        );

                        resolve();
                    }
                });
            } catch (error) {
                const storageError =
                    ConfigServiceErrorHandler.createStorageError(
                        'remove',
                        area,
                        normalizedKeys,
                        error,
                        {
                            ...context,
                            duration: Date.now() - startTime,
                            method: 'removeFromStorage',
                            keyCount: normalizedKeys.length,
                            synchronousFailure: true,
                        }
                    );
                this.logger.error(
                    'Chrome storage remove operation failed',
                    storageError,
                    {
                        area,
                        keys: normalizedKeys,
                        context,
                    }
                );
                reject(storageError);
            }
        });
    }

    _resolveStoredValue(key, storedItems) {
        const schemaEntry = configSchema[key];
        const hasStoredValue = Object.hasOwn(storedItems, key);
        const storedValue = hasStoredValue ? storedItems[key] : undefined;
        const preparedValue = hasStoredValue
            ? this._prepareSettingValue(key, storedValue)
            : { ok: false };
        const resolution = preparedValue.ok
            ? Object.is(preparedValue.value, storedValue)
                ? 'stored-exact'
                : 'stored-normalized'
            : hasStoredValue
              ? 'default-invalid'
              : 'default-missing';
        const usedDefault = !preparedValue.ok;

        return {
            value: usedDefault ? getDefaultValue(key) : preparedValue.value,
            usedDefault,
            invalidStoredValue: resolution === 'default-invalid',
            needsRepair: resolution !== 'stored-exact',
            resolution,
            scope: schemaEntry?.scope,
        };
    }

    _prepareSettingValue(key, value, { detach = false } = {}) {
        try {
            const preparedValue = prepareSettingValue(key, value);
            const detachedValue =
                detach &&
                preparedValue !== null &&
                typeof preparedValue === 'object'
                    ? globalThis.structuredClone(preparedValue)
                    : preparedValue;
            return {
                ok: true,
                value: detachedValue,
            };
        } catch {
            return { ok: false };
        }
    }

    _projectStorageChanges(changes, areaName) {
        const projectedChanges = {};

        for (const [key, change] of Object.entries(changes)) {
            const schemaEntry = configSchema[key];
            if (!schemaEntry || schemaEntry.scope !== areaName) continue;

            const preparedValue = this._prepareSettingValue(
                key,
                change?.newValue,
                { detach: true }
            );

            projectedChanges[key] = preparedValue.ok
                ? preparedValue.value
                : getDefaultValue(key);
        }
        return projectedChanges;
    }

    _projectChangesForListener(changes, includeSensitive) {
        const listenerChanges = {};

        for (const [key, value] of Object.entries(changes)) {
            if (!includeSensitive && configSchema[key]?.sensitive) continue;
            listenerChanges[key] = cloneConfigReadValue(value);
        }

        return listenerChanges;
    }

    async _readResultBundle(keys, options = {}) {
        const keySnapshot = snapshotStringKeys(keys, RESULT_READ_KEYS_MESSAGE);
        const sensitiveAllowed = isSensitiveAccessExplicitlyEnabled(options);
        const requestedKeys = dedupeStringKeys(keySnapshot);
        const readableKeys = requestedKeys.filter(
            (key) =>
                isOwnConfigKey(key) &&
                (sensitiveAllowed || !configSchema[key].sensitive)
        );
        const privacySafeRead = requestedKeys.some(
            (key) => isOwnConfigKey(key) && configSchema[key].sensitive
        );
        const keysByArea = {
            sync: readableKeys.filter(
                (key) => configSchema[key].scope === 'sync'
            ),
            local: readableKeys.filter(
                (key) => configSchema[key].scope === 'local'
            ),
        };
        const result = {
            ok: true,
            values: {},
            sources: {},
            areas: {
                sync: { status: 'not-requested' },
                local: { status: 'not-requested' },
            },
            degraded: false,
            failedAreas: [],
        };
        const areaReads = await Promise.allSettled(
            STORAGE_AREAS.map((area) => {
                const areaKeys = keysByArea[area];
                return areaKeys.length > 0
                    ? this.getFromStorage(
                          area,
                          areaKeys,
                          privacySafeRead
                              ? { method: '_readResultBundle' }
                              : {
                                    method: '_readResultBundle',
                                    requestedKeys: areaKeys,
                                },
                          { privacySafeLogs: privacySafeRead }
                      )
                    : Promise.resolve({});
            })
        );

        for (const [index, area] of STORAGE_AREAS.entries()) {
            const areaKeys = keysByArea[area];
            if (areaKeys.length === 0) continue;

            const areaRead = areaReads[index];
            if (areaRead.status === 'rejected') {
                result.areas[area] = { status: 'error' };
                result.ok = false;
                result.degraded = true;
                result.failedAreas.push(area);
                continue;
            }

            const storedItems = areaRead.value;
            result.areas[area] = { status: 'ok' };

            for (const key of areaKeys) {
                const { value, usedDefault, invalidStoredValue } =
                    this._resolveStoredValue(key, storedItems);
                const source = usedDefault
                    ? invalidStoredValue
                        ? 'schema-default-invalid'
                        : 'schema-default-missing'
                    : 'stored';
                result.values[key] = cloneConfigReadValue(value);
                result.sources[key] = {
                    scope: area,
                    source,
                };
            }
        }
        return result;
    }

    async readResultStrict(key, options = {}) {
        return requireConfigServiceRead(
            await this._readResultBundle([key], options)
        );
    }

    async readStoredBooleanStrict(key) {
        if (!isOwnConfigKey(key) || configSchema[key].type !== Boolean) {
            throw new Error(STORED_BOOLEAN_UNAVAILABLE_MESSAGE);
        }

        const result = await this.readResultStrict(key);
        const value = result.values[key];
        if (
            (value !== true && value !== false) ||
            result.sources[key]?.source !== 'stored'
        ) {
            throw new Error(STORED_BOOLEAN_UNAVAILABLE_MESSAGE);
        }
        return value;
    }

    async readMultipleResultStrict(keys, options = {}) {
        return requireConfigServiceRead(
            await this._readResultBundle(keys, options)
        );
    }

    async readAllResultStrict(options = {}) {
        return requireConfigServiceRead(
            await this._readResultBundle(CONFIG_KEYS, options)
        );
    }

    /**
     * Retrieves a single setting's value, falling back to the schema's default.
     * @param {string} key - The setting key to retrieve.
     * @returns {Promise<any>} A promise that resolves with the setting's value.
     */
    async get(key) {
        if (!isOwnConfigKey(key)) {
            const keyType = typeof key;
            const errorMsg =
                keyType === 'string'
                    ? `Invalid key "${key}" requested`
                    : `Invalid key of type "${keyType}" requested`;
            const context = {
                method: 'get',
                ...(keyType === 'string'
                    ? { requestedKey: key }
                    : { requestedKeyType: keyType }),
            };
            this.logger.error(errorMsg, null, context);
            return undefined;
        }

        this.logger.debug(`get() called`, { key });

        const schemaEntry = configSchema[key];

        try {
            const items = await this.getFromStorage(schemaEntry.scope, [key], {
                method: 'get',
                requestedKey: key,
            });
            const { value, usedDefault, invalidStoredValue } =
                this._resolveStoredValue(key, items);

            this.logger.debug(`get() completed`, {
                key,
                value: typeof value,
                usedDefault,
                invalidStoredValue,
                scope: schemaEntry.scope,
            });

            return cloneConfigReadValue(value);
        } catch (error) {
            this.logger.error(`Error getting key "${key}"`, error, {
                method: 'get',
                requestedKey: key,
                scope: schemaEntry.scope,
                fallbackValue: getDefaultValue(key),
            });
            return getDefaultValue(key);
        }
    }

    /**
     * Retrieves multiple settings by their keys
     * @param {string[]} keys - Array of setting keys to retrieve
     * @returns {Promise<object>} A promise that resolves with an object containing the requested settings
     */
    async getMultiple(keys) {
        const keySnapshot = snapshotStringKeys(
            keys,
            MULTIPLE_READ_KEYS_MESSAGE
        );
        this.logger.debug(`getMultiple() called`, {
            keys: keySnapshot,
            keyCount: keySnapshot.length,
        });

        const validKeys = keySnapshot.filter((key) => isOwnConfigKey(key));
        const invalidKeys = keySnapshot.filter((key) => !isOwnConfigKey(key));
        const syncKeys = validKeys.filter(
            (key) => configSchema[key].scope === 'sync'
        );
        const localKeys = validKeys.filter(
            (key) => configSchema[key].scope === 'local'
        );

        if (invalidKeys.length > 0) {
            this.logger.error(`Invalid keys requested in getMultiple`, null, {
                method: 'getMultiple',
                invalidKeys,
                validKeys,
            });
        }

        try {
            const [syncItems, localItems] = await Promise.all([
                syncKeys.length > 0
                    ? this.getFromStorage('sync', syncKeys, {
                          method: 'getMultiple',
                          requestedKeys: syncKeys,
                      })
                    : Promise.resolve({}),
                localKeys.length > 0
                    ? this.getFromStorage('local', localKeys, {
                          method: 'getMultiple',
                          requestedKeys: localKeys,
                      })
                    : Promise.resolve({}),
            ]);

            const result = {};
            const defaultsUsed = [];

            validKeys.forEach((key) => {
                const schemaEntry = configSchema[key];
                const storedItems =
                    schemaEntry.scope === 'sync' ? syncItems : localItems;
                const { value, usedDefault } = this._resolveStoredValue(
                    key,
                    storedItems
                );
                result[key] = cloneConfigReadValue(value);

                if (usedDefault) {
                    defaultsUsed.push(key);
                }
            });

            this.logger.debug(`getMultiple() completed`, {
                requestedKeys: keySnapshot,
                syncKeys,
                localKeys,
                defaultsUsed,
                resultCount: Object.keys(result).length,
            });

            return result;
        } catch (error) {
            this.logger.error(`Error in getMultiple`, error, {
                method: 'getMultiple',
                requestedKeys: keySnapshot,
                syncKeys,
                localKeys,
            });
            throw error;
        }
    }

    /**
     * Retrieves all settings, applying defaults for any unset values.
     * Sensitive settings require an own, exact `includeSensitive: true` data
     * property; all other option shapes are treated as non-sensitive.
     * @param {{includeSensitive?: boolean}} options - Retrieval options.
     * @returns {Promise<object>} A promise that resolves with an object of all requested settings.
     * @throws {ConfigServiceReadError} If either required storage area cannot be read.
     */
    async getAll(options = {}) {
        this.logger.debug(`getAll() called`, { storageAuthoritative: true });

        const { values } = await this.readAllResultStrict(options);
        this.logger.debug(`getAll() completed`, {
            totalSettings: Object.keys(values).length,
        });
        return values;
    }

    /**
     * Saves a single setting's value to the appropriate storage area.
     * @param {string} key - The setting key to save.
     * @param {any} value - The value to save.
     * @returns {Promise<any>} The detached canonical value that was persisted.
     * @throws {Error} If the key is invalid or the value doesn't match the schema
     */
    async set(key, value) {
        if (!isOwnConfigKey(key)) {
            const keyDescription =
                typeof key === 'string'
                    ? `"${key}"`
                    : `of type "${typeof key}"`;
            const error = new Error(
                `Invalid key ${keyDescription} provided for set`
            );
            const context = {
                method: 'set',
                ...(typeof key === 'string'
                    ? { requestedKey: key }
                    : { requestedKeyType: typeof key }),
            };
            this.logger.error(error.message, error, context);
            throw error;
        }

        this.logger.debug(`set() called`, { key, valueType: typeof value });

        const schemaEntry = configSchema[key];

        const preparedValue = this._prepareSettingValue(key, value, {
            detach: true,
        });
        if (!preparedValue.ok) {
            const error = new Error(
                `Invalid value for key "${key}". Expected type: ${schemaEntry.type.name}`
            );
            this.logger.error(error.message, error, {
                method: 'set',
                requestedKey: key,
                expectedType: schemaEntry.type.name,
                actualType: typeof value,
            });
            throw error;
        }

        try {
            await this.setToStorage(
                schemaEntry.scope,
                { [key]: preparedValue.value },
                { method: 'set', requestedKey: key }
            );

            this.logger.debug(`set() completed`, {
                key,
                valueType: typeof preparedValue.value,
                scope: schemaEntry.scope,
            });

            // Update logging level if this was the loggingLevel setting
            if (key === 'loggingLevel') {
                const loggingLevelUpdated =
                    await this._updateLoggingLevelAfterPersistedWrite(
                        preparedValue.value,
                        'set'
                    );
                if (loggingLevelUpdated) {
                    this.logger.debug(`Logging level updated`, {
                        loggingLevel: preparedValue.value,
                    });
                }
            }

            return cloneConfigReadValue(preparedValue.value);
        } catch (error) {
            this.logger.error(`Error setting key "${key}"`, error, {
                method: 'set',
                requestedKey: key,
                scope: schemaEntry.scope,
            });
            throw error;
        }
    }

    /**
     * Saves multiple settings at once
     * @param {object} settings - Object with key-value pairs to save
     * @returns {Promise<object>} Detached canonical values that were persisted.
     * @throws {Error} If any key is invalid or any value doesn't match the schema
     */
    async setMultiple(settings) {
        let settingsKeys;
        try {
            settingsKeys = Object.keys(settings);
        } catch {
            const error = new Error(
                'Invalid settings provided for setMultiple'
            );
            this.logger.error(error.message, error, {
                method: 'setMultiple',
            });
            throw error;
        }
        this.logger.debug(`setMultiple() called`, {
            settingsKeys,
            settingCount: settingsKeys.length,
        });

        const syncSettings = {};
        const localSettings = {};
        const preparedSettings = {};
        const validationErrors = [];

        // Validate and categorize settings
        for (const key of settingsKeys) {
            if (!isOwnConfigKey(key)) {
                const error = `Invalid key "${key}" provided for setMultiple`;
                this.logger.error(error, null, {
                    method: 'setMultiple',
                    invalidKey: key,
                });
                validationErrors.push({ key, error, type: 'invalid_key' });
                continue;
            }

            const schemaEntry = configSchema[key];
            const value = settings[key];
            const preparedValue = this._prepareSettingValue(key, value, {
                detach: true,
            });

            if (!preparedValue.ok) {
                const actualType = typeof value;
                const error = `Invalid value for key "${key}". Expected type: ${schemaEntry.type.name}`;
                this.logger.error(error, null, {
                    method: 'setMultiple',
                    invalidKey: key,
                    expectedType: schemaEntry.type.name,
                    actualType,
                });
                validationErrors.push({
                    key,
                    error,
                    type: 'invalid_value',
                    expectedType: schemaEntry.type.name,
                    actualType,
                });
                continue;
            }

            if (schemaEntry.scope === 'sync') {
                syncSettings[key] = preparedValue.value;
            } else {
                localSettings[key] = preparedValue.value;
            }
            preparedSettings[key] = preparedValue.value;
        }

        // If there were validation errors, throw them
        if (validationErrors.length > 0) {
            const errorMsg = `setMultiple failed with ${validationErrors.length} validation error(s): ${validationErrors.map((e) => e.error).join('; ')}`;
            const aggregatedError = new Error(errorMsg);
            aggregatedError.validationErrors = validationErrors;
            aggregatedError.totalSettings = settingsKeys.length;
            aggregatedError.validSettings =
                settingsKeys.length - validationErrors.length;

            this.logger.error(errorMsg, aggregatedError, {
                method: 'setMultiple',
                validationErrors,
                totalSettings: settingsKeys.length,
                validSettings: settingsKeys.length - validationErrors.length,
            });
            throw aggregatedError;
        }

        this.logger.debug(`setMultiple() validation completed`, {
            syncSettingsCount: Object.keys(syncSettings).length,
            localSettingsCount: Object.keys(localSettings).length,
            syncKeys: Object.keys(syncSettings),
            localKeys: Object.keys(localSettings),
        });

        // Track results for detailed error reporting
        const results = {
            successful: [],
            failed: [],
            errors: [],
        };

        // Save to appropriate storage areas with individual error handling
        const storageOperations = [];

        if (Object.keys(syncSettings).length > 0) {
            storageOperations.push({
                area: 'sync',
                settings: syncSettings,
                keys: Object.keys(syncSettings),
            });
        }

        if (Object.keys(localSettings).length > 0) {
            storageOperations.push({
                area: 'local',
                settings: localSettings,
                keys: Object.keys(localSettings),
            });
        }

        // Execute storage operations and collect results
        for (const operation of storageOperations) {
            try {
                await this.setToStorage(operation.area, operation.settings, {
                    method: 'setMultiple',
                    operation: 'bulk-set',
                    settingKeys: operation.keys,
                });

                results.successful.push({
                    area: operation.area,
                    keys: operation.keys,
                    count: operation.keys.length,
                });

                this.logger.debug(
                    `setMultiple() ${operation.area} storage completed`,
                    {
                        area: operation.area,
                        keysSet: operation.keys.length,
                        keys: operation.keys,
                    }
                );
            } catch (error) {
                results.failed.push({
                    area: operation.area,
                    keys: operation.keys,
                    count: operation.keys.length,
                });
                results.errors.push({
                    area: operation.area,
                    error,
                    keys: operation.keys,
                });

                this.logger.error(
                    `setMultiple() ${operation.area} storage failed`,
                    error,
                    {
                        method: 'setMultiple',
                        area: operation.area,
                        keyCount: operation.keys.length,
                        keys: operation.keys,
                    }
                );
            }
        }

        const loggingLevelPersisted =
            Object.hasOwn(syncSettings, 'loggingLevel') &&
            results.successful.some((result) => result.area === 'sync');
        if (loggingLevelPersisted) {
            const loggingLevelUpdated =
                await this._updateLoggingLevelAfterPersistedWrite(
                    syncSettings.loggingLevel,
                    'setMultiple'
                );
            if (loggingLevelUpdated) {
                this.logger.debug(`Logging level updated via setMultiple`, {
                    loggingLevel: syncSettings.loggingLevel,
                });
            }
        }

        // Handle results and provide detailed error information
        if (results.errors.length > 0) {
            const totalKeysAttempted = settingsKeys.length;
            const totalKeysSet = results.successful.reduce(
                (sum, result) => sum + result.count,
                0
            );
            const totalKeysFailed = results.failed.reduce(
                (sum, result) => sum + result.count,
                0
            );

            if (results.successful.length === 0) {
                // Complete failure
                const errorMsg = `setMultiple() failed completely: ${results.errors.length} storage area(s) failed`;
                const aggregatedError = new Error(errorMsg);
                aggregatedError.completeFailure = true;
                aggregatedError.failed = results.failed;
                aggregatedError.errors = results.errors;
                aggregatedError.totalKeysAttempted = totalKeysAttempted;

                this.logger.error(errorMsg, aggregatedError, {
                    method: 'setMultiple',
                    totalKeysAttempted,
                    failedAreas: results.failed.map((f) => f.area),
                    errors: results.errors.map((e) => ({
                        area: e.area,
                        message: e.error.message,
                    })),
                });

                throw aggregatedError;
            } else {
                // Partial failure
                const errorMsg = `setMultiple() completed with partial failures: ${results.successful.length} area(s) succeeded, ${results.failed.length} area(s) failed`;
                const aggregatedError = new Error(errorMsg);
                aggregatedError.partialFailure = true;
                aggregatedError.successful = results.successful;
                aggregatedError.failed = results.failed;
                aggregatedError.errors = results.errors;
                aggregatedError.totalKeysAttempted = totalKeysAttempted;
                aggregatedError.totalKeysSet = totalKeysSet;
                aggregatedError.totalKeysFailed = totalKeysFailed;

                this.logger.warn(errorMsg, {
                    method: 'setMultiple',
                    totalKeysAttempted,
                    totalKeysSet,
                    totalKeysFailed,
                    successfulAreas: results.successful.map((s) => s.area),
                    failedAreas: results.failed.map((f) => f.area),
                    errors: results.errors.map((e) => ({
                        area: e.area,
                        message: e.error.message,
                    })),
                });

                throw aggregatedError;
            }
        } else {
            // Complete success
            this.logger.debug(`setMultiple() completed successfully`, {
                totalSettings: settingsKeys.length,
                syncSettingsSet: Object.keys(syncSettings).length,
                localSettingsSet: Object.keys(localSettings).length,
                successfulAreas: results.successful.map((s) => s.area),
            });

            return cloneConfigReadValue(preparedSettings);
        }
    }

    /**
     * Listens for changes to any settings defined in the schema.
     * @param {function(object)} callback - The function to call with an object of the changed keys and their new values.
     * @param {{includeSensitive?: boolean}} options - Listener projection
     * options. Sensitive changes require an own, exact
     * `includeSensitive: true` data property.
     * @returns {function} A function to remove the listener
     */
    onChanged(callback, options = {}) {
        if (typeof callback !== 'function') {
            throw new TypeError(
                'ConfigService onChanged requires a callable callback'
            );
        }

        const includeSensitive = isSensitiveAccessExplicitlyEnabled(options);
        this.logger.debug(`onChanged() called`, {
            currentListenerCount: this.changeListeners.size,
        });

        const listener = { callback, includeSensitive };
        this.changeListeners.add(listener);

        this.logger.debug(`Change listener added`, {
            totalListeners: this.changeListeners.size,
        });

        // Return a function to remove the listener
        return () => {
            this.changeListeners.delete(listener);
            this.logger.debug(`Change listener removed`, {
                remainingListeners: this.changeListeners.size,
            });
        };
    }

    /**
     * Initializes the change listener if not already done
     */
    initializeChangeListener() {
        if (this.changeListenerInitialized) return;

        this.logger.debug(`Initializing change listener`);

        chrome.storage.onChanged.addListener((changes, areaName) => {
            const relevantChanges = this._projectStorageChanges(
                changes,
                areaName
            );
            const changedKeys = Object.keys(relevantChanges);

            if (changedKeys.length > 0) {
                this.logger.debug(`Storage changes detected`, {
                    areaName,
                    changedKeys,
                    listenerCount: this.changeListeners.size,
                });

                const listenerSnapshot = [...this.changeListeners];

                const logListenerFailure = () => {
                    try {
                        this.logger.error(
                            'Error in change listener callback',
                            null,
                            {
                                areaName,
                                changedKeys,
                                category: 'callback-error',
                            }
                        );
                    } catch {
                        // Listener isolation must not depend on logging health.
                    }
                };

                listenerSnapshot.forEach(({ callback, includeSensitive }) => {
                    const listenerChanges = this._projectChangesForListener(
                        relevantChanges,
                        includeSensitive
                    );
                    if (Object.keys(listenerChanges).length === 0) return;

                    let callbackResult;
                    try {
                        callbackResult = callback(listenerChanges);
                    } catch {
                        logListenerFailure();
                        return;
                    }

                    try {
                        Promise.resolve(callbackResult).catch(
                            logListenerFailure
                        );
                    } catch {
                        logListenerFailure();
                    }
                });

                // Update logging level if loggingLevel changed
                if (Object.hasOwn(relevantChanges, 'loggingLevel')) {
                    const logUpdateFailure = () => {
                        try {
                            this.logger.error(
                                'Failed to update logging level after change',
                                null,
                                {
                                    areaName,
                                    changedKey: 'loggingLevel',
                                    category: 'update-failed',
                                }
                            );
                        } catch {
                            // Live projection remains isolated if logging fails.
                        }
                    };

                    try {
                        const updateResult = this.logger.updateLevel(
                            relevantChanges.loggingLevel
                        );
                        Promise.resolve(updateResult).catch(logUpdateFailure);
                    } catch {
                        logUpdateFailure();
                    }
                }
            }
        });

        this.changeListenerInitialized = true;
        this.logger.debug(`Change listener initialized`);
    }

    /**
     * Resets all settings to their default values
     * @returns {Promise<void>}
     */
    async resetToDefaults() {
        this.logger.debug(`resetToDefaults() called`);

        const syncDefaults = {};
        const localDefaults = {};

        for (const key in configSchema) {
            const entry = configSchema[key];
            const defaultValue = getDefaultValue(key);
            if (entry.scope === 'sync') {
                syncDefaults[key] = defaultValue;
            } else {
                localDefaults[key] = defaultValue;
            }
        }

        this.logger.debug(`resetToDefaults() prepared defaults`, {
            syncDefaultsCount: Object.keys(syncDefaults).length,
            localDefaultsCount: Object.keys(localDefaults).length,
            syncKeys: Object.keys(syncDefaults),
            localKeys: Object.keys(localDefaults),
        });

        try {
            await Promise.all([
                this.setToStorage('sync', syncDefaults, {
                    method: 'resetToDefaults',
                    operation: 'reset-all',
                }),
                this.setToStorage('local', localDefaults, {
                    method: 'resetToDefaults',
                    operation: 'reset-all',
                }),
            ]);

            this.logger.debug(`resetToDefaults() completed`, {
                totalSettingsReset:
                    Object.keys(syncDefaults).length +
                    Object.keys(localDefaults).length,
            });

            // Update logging level after reset
            await this.logger.updateLevel();
            this.logger.debug(`Logging level updated after reset`);
        } catch (error) {
            this.logger.error(`Error in resetToDefaults`, error, {
                method: 'resetToDefaults',
                syncDefaultsCount: Object.keys(syncDefaults).length,
                localDefaultsCount: Object.keys(localDefaults).length,
            });
            throw error;
        }
    }

    /**
     * Clears all extension settings
     * @returns {Promise<void>}
     */
    async clearAll() {
        this.logger.debug(`clearAll() called`);

        const syncKeys = getKeysByScope('sync');
        const localKeys = getKeysByScope('local');

        this.logger.debug(`clearAll() prepared keys`, {
            syncKeyCount: syncKeys.length,
            localKeyCount: localKeys.length,
            totalKeys: syncKeys.length + localKeys.length,
        });

        const results = {
            successful: [],
            failed: [],
            errors: [],
        };

        // Clear sync storage
        if (syncKeys.length > 0) {
            try {
                await this.removeFromStorage('sync', syncKeys, {
                    method: 'clearAll',
                    operation: 'clear-all',
                });
                results.successful.push({
                    area: 'sync',
                    keys: syncKeys,
                    count: syncKeys.length,
                });
                this.logger.debug(
                    `clearAll() sync storage cleared successfully`,
                    {
                        syncKeysCleared: syncKeys.length,
                    }
                );
            } catch (error) {
                results.failed.push({
                    area: 'sync',
                    keys: syncKeys,
                    count: syncKeys.length,
                });
                results.errors.push({ area: 'sync', error, keys: syncKeys });
                this.logger.error(
                    `clearAll() failed to clear sync storage`,
                    error,
                    {
                        method: 'clearAll',
                        area: 'sync',
                        keyCount: syncKeys.length,
                        keys: syncKeys,
                    }
                );
            }
        }

        // Clear local storage
        if (localKeys.length > 0) {
            try {
                await this.removeFromStorage('local', localKeys, {
                    method: 'clearAll',
                    operation: 'clear-all',
                });
                results.successful.push({
                    area: 'local',
                    keys: localKeys,
                    count: localKeys.length,
                });
                this.logger.debug(
                    `clearAll() local storage cleared successfully`,
                    {
                        localKeysCleared: localKeys.length,
                    }
                );
            } catch (error) {
                results.failed.push({
                    area: 'local',
                    keys: localKeys,
                    count: localKeys.length,
                });
                results.errors.push({ area: 'local', error, keys: localKeys });
                this.logger.error(
                    `clearAll() failed to clear local storage`,
                    error,
                    {
                        method: 'clearAll',
                        area: 'local',
                        keyCount: localKeys.length,
                        keys: localKeys,
                    }
                );
            }
        }

        // Handle results and errors
        if (results.errors.length > 0) {
            const totalKeysAttempted = syncKeys.length + localKeys.length;
            const totalKeysCleared = results.successful.reduce(
                (sum, result) => sum + result.count,
                0
            );
            const totalKeysFailed = results.failed.reduce(
                (sum, result) => sum + result.count,
                0
            );

            if (results.successful.length === 0) {
                // Complete failure
                const errorMsg = `clearAll() failed completely: ${results.errors.length} storage area(s) failed`;
                this.logger.error(errorMsg, null, {
                    method: 'clearAll',
                    totalKeysAttempted,
                    failedAreas: results.failed.map((f) => f.area),
                    errors: results.errors.map((e) => ({
                        area: e.area,
                        message: e.error.message,
                    })),
                });

                // Throw the first error for backward compatibility
                throw results.errors[0].error;
            } else {
                // Partial failure
                const errorMsg = `clearAll() completed with partial failures: ${results.successful.length} area(s) succeeded, ${results.failed.length} area(s) failed`;
                this.logger.warn(errorMsg, {
                    method: 'clearAll',
                    totalKeysAttempted,
                    totalKeysCleared,
                    totalKeysFailed,
                    successfulAreas: results.successful.map((s) => s.area),
                    failedAreas: results.failed.map((f) => f.area),
                    errors: results.errors.map((e) => ({
                        area: e.area,
                        message: e.error.message,
                    })),
                });

                // Create aggregated error for partial failures
                const aggregatedError = new Error(errorMsg);
                aggregatedError.partialFailure = true;
                aggregatedError.successful = results.successful;
                aggregatedError.failed = results.failed;
                aggregatedError.errors = results.errors;

                throw aggregatedError;
            }
        } else {
            // Complete success
            const totalKeysCleared = syncKeys.length + localKeys.length;
            this.logger.debug(`clearAll() completed successfully`, {
                syncKeysCleared: syncKeys.length,
                localKeysCleared: localKeys.length,
                totalKeysCleared,
            });
        }
    }
}

// Export a singleton instance
export const configService = new ConfigService();

// Initialize the change listener when the module is loaded
configService.initializeChangeListener();
