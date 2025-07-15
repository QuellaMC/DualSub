// services/configService.js
import { configSchema, getKeysByScope, validateSetting, getDefaultValue, getStorageScope } from '../config/configSchema.js';
import { ConfigServiceErrorHandler } from './configServiceErrorHandler.js';
import Logger from '../utils/logger.js';

class ConfigService {
    constructor() {
        this.changeListeners = new Set();
        this.isInitialized = false;
        this.logger = Logger.create('ConfigService', this);
        this.initializeLogger();
    }

    /**
     * Initialize logger with debug mode detection
     */
    async initializeLogger() {
        try {
            await this.logger.updateDebugMode();
        } catch (error) {
            // Logger initialization shouldn't block service initialization
            console.warn('ConfigService: Failed to initialize logger debug mode:', error);
        }
    }

    /**
     * Sets default values on first install by reading from the schema.
     * This should be called from the background script.
     */
    initializeDefaults() {
        chrome.runtime.onInstalled.addListener(details => {
            if (details.reason === 'install' || details.reason === 'update') {
                console.log('DualSub ConfigService: Setting default configuration from schema.');
                this.setDefaultsForMissingKeys();
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
            totalKeys: syncKeys.length + localKeys.length
        });

        // Track results for detailed error reporting
        const results = {
            successful: [],
            failed: [],
            errors: []
        };

        try {
            // Get current values from storage with individual error handling
            let syncItems = {};
            let localItems = {};
            
            // Get sync items with error handling
            if (syncKeys.length > 0) {
                try {
                    syncItems = await this.getFromStorage('sync', syncKeys, { 
                        method: 'setDefaultsForMissingKeys', 
                        operation: 'initialization-get-sync' 
                    });
                    this.logger.debug(`setDefaultsForMissingKeys() sync items retrieved`, { 
                        syncItemsCount: Object.keys(syncItems).length,
                        syncKeys: Object.keys(syncItems)
                    });
                } catch (error) {
                    this.logger.error('Failed to retrieve sync items during initialization', error, { 
                        method: 'setDefaultsForMissingKeys',
                        operation: 'get-sync',
                        keyCount: syncKeys.length
                    });
                    results.errors.push({ 
                        area: 'sync', 
                        operation: 'get', 
                        error, 
                        keys: syncKeys 
                    });
                    // Continue with empty object to set all defaults
                    syncItems = {};
                }
            }

            // Get local items with error handling
            if (localKeys.length > 0) {
                try {
                    localItems = await this.getFromStorage('local', localKeys, { 
                        method: 'setDefaultsForMissingKeys', 
                        operation: 'initialization-get-local' 
                    });
                    this.logger.debug(`setDefaultsForMissingKeys() local items retrieved`, { 
                        localItemsCount: Object.keys(localItems).length,
                        localKeys: Object.keys(localItems)
                    });
                } catch (error) {
                    this.logger.error('Failed to retrieve local items during initialization', error, { 
                        method: 'setDefaultsForMissingKeys',
                        operation: 'get-local',
                        keyCount: localKeys.length
                    });
                    results.errors.push({ 
                        area: 'local', 
                        operation: 'get', 
                        error, 
                        keys: localKeys 
                    });
                    // Continue with empty object to set all defaults
                    localItems = {};
                }
            }

            // Determine which defaults need to be set
            const syncDefaults = {};
            const localDefaults = {};

            // Set missing sync defaults
            for (const key of syncKeys) {
                if (!(key in syncItems)) {
                    syncDefaults[key] = getDefaultValue(key);
                }
            }

            // Set missing local defaults
            for (const key of localKeys) {
                if (!(key in localItems)) {
                    localDefaults[key] = getDefaultValue(key);
                }
            }

            this.logger.debug(`setDefaultsForMissingKeys() defaults to set`, { 
                syncDefaultsCount: Object.keys(syncDefaults).length,
                localDefaultsCount: Object.keys(localDefaults).length,
                syncDefaultKeys: Object.keys(syncDefaults),
                localDefaultKeys: Object.keys(localDefaults)
            });

            // Apply defaults with enhanced error handling and aggregation
            if (Object.keys(syncDefaults).length > 0) {
                try {
                    await this.setToStorage('sync', syncDefaults, { 
                        method: 'setDefaultsForMissingKeys', 
                        operation: 'initialization-set-sync' 
                    });
                    results.successful.push({
                        area: 'sync',
                        operation: 'set',
                        keys: Object.keys(syncDefaults),
                        count: Object.keys(syncDefaults).length
                    });
                    this.logger.info('Successfully set sync defaults', { 
                        keys: Object.keys(syncDefaults),
                        count: Object.keys(syncDefaults).length
                    });
                } catch (error) {
                    results.failed.push({
                        area: 'sync',
                        operation: 'set',
                        keys: Object.keys(syncDefaults),
                        count: Object.keys(syncDefaults).length
                    });
                    results.errors.push({ 
                        area: 'sync', 
                        operation: 'set', 
                        error, 
                        keys: Object.keys(syncDefaults) 
                    });
                    this.logger.error('Failed to set sync defaults in storage', error, { 
                        method: 'setDefaultsForMissingKeys',
                        operation: 'set-sync',
                        keys: Object.keys(syncDefaults),
                        keyCount: Object.keys(syncDefaults).length
                    });
                }
            }

            if (Object.keys(localDefaults).length > 0) {
                try {
                    await this.setToStorage('local', localDefaults, { 
                        method: 'setDefaultsForMissingKeys', 
                        operation: 'initialization-set-local' 
                    });
                    results.successful.push({
                        area: 'local',
                        operation: 'set',
                        keys: Object.keys(localDefaults),
                        count: Object.keys(localDefaults).length
                    });
                    this.logger.info('Successfully set local defaults', { 
                        keys: Object.keys(localDefaults),
                        count: Object.keys(localDefaults).length
                    });
                } catch (error) {
                    results.failed.push({
                        area: 'local',
                        operation: 'set',
                        keys: Object.keys(localDefaults),
                        count: Object.keys(localDefaults).length
                    });
                    results.errors.push({ 
                        area: 'local', 
                        operation: 'set', 
                        error, 
                        keys: Object.keys(localDefaults) 
                    });
                    this.logger.error('Failed to set local defaults in storage', error, { 
                        method: 'setDefaultsForMissingKeys',
                        operation: 'set-local',
                        keys: Object.keys(localDefaults),
                        keyCount: Object.keys(localDefaults).length
                    });
                }
            }

            // Handle results and provide detailed error information
            const totalOperationsAttempted = (Object.keys(syncDefaults).length > 0 ? 1 : 0) + 
                                           (Object.keys(localDefaults).length > 0 ? 1 : 0);
            const totalKeysAttempted = Object.keys(syncDefaults).length + Object.keys(localDefaults).length;
            const totalKeysSet = results.successful.reduce((sum, result) => sum + result.count, 0);
            const totalKeysFailed = results.failed.reduce((sum, result) => sum + result.count, 0);

            if (results.errors.length > 0) {
                // Filter out only 'set' operation errors for determining complete vs partial failure
                const setErrors = results.errors.filter(e => e.operation === 'set');
                const setSuccessful = results.successful.filter(s => s.operation === 'set');
                
                if (setSuccessful.length === 0 && setErrors.length > 0 && totalKeysAttempted > 0) {
                    // Complete failure for setting defaults (all set operations failed)
                    const errorMsg = `setDefaultsForMissingKeys() failed completely: ${setErrors.length} set operation(s) failed`;
                    const aggregatedError = new Error(errorMsg);
                    aggregatedError.completeFailure = true;
                    aggregatedError.failed = results.failed.filter(f => f.operation === 'set');
                    aggregatedError.errors = setErrors;
                    aggregatedError.totalKeysAttempted = totalKeysAttempted;
                    
                    this.logger.error(errorMsg, aggregatedError, { 
                        method: 'setDefaultsForMissingKeys',
                        totalKeysAttempted,
                        totalOperationsAttempted,
                        failedOperations: results.failed.filter(f => f.operation === 'set').map(f => `${f.area}-${f.operation}`),
                        errors: setErrors.map(e => ({ 
                            area: e.area, 
                            operation: e.operation, 
                            message: e.error.message 
                        }))
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
                        successfulOperations: results.successful.map(s => `${s.area}-${s.operation}`),
                        failedOperations: results.failed.map(f => `${f.area}-${f.operation}`),
                        errors: results.errors.map(e => ({ 
                            area: e.area, 
                            operation: e.operation, 
                            message: e.error.message 
                        }))
                    });
                } else if (setErrors.length === 0 && results.errors.length > 0) {
                    // Only retrieval errors, but no defaults to set
                    this.logger.warn('setDefaultsForMissingKeys() had retrieval errors but no defaults needed', { 
                        method: 'setDefaultsForMissingKeys',
                        retrievalErrors: results.errors.filter(e => e.operation === 'get').length,
                        errors: results.errors.map(e => ({ 
                            area: e.area, 
                            operation: e.operation, 
                            message: e.error.message 
                        }))
                    });
                }
            } else {
                // Complete success
                this.logger.debug(`setDefaultsForMissingKeys() completed successfully`, { 
                    totalKeysSet,
                    syncDefaultsSet: Object.keys(syncDefaults).length,
                    localDefaultsSet: Object.keys(localDefaults).length,
                    successfulOperations: results.successful.map(s => `${s.area}-${s.operation}`)
                });
            }
            
            this.isInitialized = true;
        } catch (error) {
            // Catch any unexpected errors not handled above
            this.logger.error('Unexpected error in setDefaultsForMissingKeys', error, { 
                method: 'setDefaultsForMissingKeys',
                syncKeyCount: syncKeys.length,
                localKeyCount: localKeys.length,
                resultsState: {
                    successfulCount: results.successful.length,
                    failedCount: results.failed.length,
                    errorCount: results.errors.length
                }
            });
            // Still mark as initialized to prevent blocking
            this.isInitialized = true;
            throw error;
        }
    }

    /**
     * Internal method to get data from a specific storage area
     * @param {string} area - 'sync' or 'local'
     * @param {string[]} keys - Array of keys to retrieve
     * @param {object} context - Additional context for error handling
     * @returns {Promise<object>}
     */
    async getFromStorage(area, keys, context = {}) {
        const normalizedKeys = Array.isArray(keys) ? keys : [keys];
        const startTime = Date.now();
        
        this.logger.debug(`Starting get operation`, { 
            area, 
            keys: normalizedKeys, 
            context 
        });

        return new Promise((resolve, reject) => {
            chrome.storage[area].get(keys, items => {
                const duration = Date.now() - startTime;
                
                if (chrome.runtime.lastError) {
                    const error = ConfigServiceErrorHandler.createStorageError(
                        'get', 
                        area, 
                        normalizedKeys, 
                        chrome.runtime.lastError,
                        { ...context, duration, method: 'getFromStorage' }
                    );
                    
                    // Special handling for quota exceeded errors
                    if (error.isQuotaError) {
                        this.logger.error(`Storage quota exceeded during get operation`, error, {
                            area,
                            keys: normalizedKeys,
                            duration,
                            context,
                            quotaError: true,
                            recoveryAction: error.recoveryAction
                        });
                    } else {
                        this.logger.error(`Storage get operation failed`, error, {
                            area,
                            keys: normalizedKeys,
                            duration,
                            context
                        });
                    }
                    
                    reject(error);
                } else {
                    this.logger.debug(`Storage get operation completed`, { 
                        area, 
                        keys: normalizedKeys, 
                        duration,
                        resultKeys: Object.keys(items || {})
                    });
                    
                    resolve(items);
                }
            });
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
        
        this.logger.debug(`Starting set operation`, { 
            area, 
            keys, 
            itemCount: keys.length,
            context 
        });

        return new Promise((resolve, reject) => {
            chrome.storage[area].set(items, () => {
                const duration = Date.now() - startTime;
                
                if (chrome.runtime.lastError) {
                    const error = ConfigServiceErrorHandler.createStorageError(
                        'set', 
                        area, 
                        keys, 
                        chrome.runtime.lastError,
                        { ...context, duration, method: 'setToStorage', itemCount: keys.length }
                    );
                    
                    // Special handling for quota exceeded errors
                    if (error.isQuotaError) {
                        this.logger.error(`Storage quota exceeded during set operation`, error, {
                            area,
                            keys,
                            duration,
                            itemCount: keys.length,
                            context,
                            quotaError: true,
                            recoveryAction: error.recoveryAction
                        });
                    } else {
                        this.logger.error(`Storage set operation failed`, error, {
                            area,
                            keys,
                            duration,
                            itemCount: keys.length,
                            context
                        });
                    }
                    
                    reject(error);
                } else {
                    this.logger.debug(`Storage set operation completed`, { 
                        area, 
                        keys, 
                        duration,
                        itemCount: keys.length
                    });
                    
                    resolve();
                }
            });
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
        
        this.logger.debug(`Starting remove operation`, { 
            area, 
            keys: normalizedKeys, 
            keyCount: normalizedKeys.length,
            context 
        });

        return new Promise((resolve, reject) => {
            chrome.storage[area].remove(keys, () => {
                const duration = Date.now() - startTime;
                
                if (chrome.runtime.lastError) {
                    const error = ConfigServiceErrorHandler.createStorageError(
                        'remove', 
                        area, 
                        normalizedKeys, 
                        chrome.runtime.lastError,
                        { ...context, duration, method: 'removeFromStorage', keyCount: normalizedKeys.length }
                    );
                    
                    // Special handling for quota exceeded errors
                    if (error.isQuotaError) {
                        this.logger.error(`Storage quota exceeded during remove operation`, error, {
                            area,
                            keys: normalizedKeys,
                            duration,
                            keyCount: normalizedKeys.length,
                            context,
                            quotaError: true,
                            recoveryAction: error.recoveryAction
                        });
                    } else {
                        this.logger.error(`Storage remove operation failed`, error, {
                            area,
                            keys: normalizedKeys,
                            duration,
                            keyCount: normalizedKeys.length,
                            context
                        });
                    }
                    
                    reject(error);
                } else {
                    this.logger.debug(`Storage remove operation completed`, { 
                        area, 
                        keys: normalizedKeys, 
                        duration,
                        keyCount: normalizedKeys.length
                    });
                    
                    resolve();
                }
            });
        });
    }

    /**
     * Retrieves a single setting's value, falling back to the schema's default.
     * @param {string} key - The setting key to retrieve.
     * @returns {Promise<any>} A promise that resolves with the setting's value.
     */
    async get(key) {
        this.logger.debug(`get() called`, { key });
        
        const schemaEntry = configSchema[key];
        if (!schemaEntry) {
            const errorMsg = `Invalid key "${key}" requested`;
            this.logger.error(errorMsg, null, { method: 'get', requestedKey: key });
            return undefined;
        }

        try {
            const items = await this.getFromStorage(schemaEntry.scope, [key], { method: 'get', requestedKey: key });
            const value = Object.prototype.hasOwnProperty.call(items, key) ? items[key] : schemaEntry.defaultValue;
            const usedDefault = !Object.prototype.hasOwnProperty.call(items, key);
            
            this.logger.debug(`get() completed`, { 
                key, 
                value: typeof value, 
                usedDefault,
                scope: schemaEntry.scope 
            });
            
            return value;
        } catch (error) {
            this.logger.error(`Error getting key "${key}"`, error, { 
                method: 'get', 
                requestedKey: key,
                scope: schemaEntry.scope,
                fallbackValue: schemaEntry.defaultValue
            });
            return schemaEntry.defaultValue;
        }
    }

    /**
     * Retrieves multiple settings by their keys
     * @param {string[]} keys - Array of setting keys to retrieve
     * @returns {Promise<object>} A promise that resolves with an object containing the requested settings
     */
    async getMultiple(keys) {
        this.logger.debug(`getMultiple() called`, { keys, keyCount: keys.length });
        
        const syncKeys = keys.filter(key => getStorageScope(key) === 'sync');
        const localKeys = keys.filter(key => getStorageScope(key) === 'local');
        const invalidKeys = keys.filter(key => !configSchema[key]);

        if (invalidKeys.length > 0) {
            this.logger.error(`Invalid keys requested in getMultiple`, null, { 
                method: 'getMultiple', 
                invalidKeys,
                validKeys: keys.filter(key => configSchema[key])
            });
        }

        try {
            const [syncItems, localItems] = await Promise.all([
                syncKeys.length > 0 ? this.getFromStorage('sync', syncKeys, { method: 'getMultiple', requestedKeys: syncKeys }) : Promise.resolve({}),
                localKeys.length > 0 ? this.getFromStorage('local', localKeys, { method: 'getMultiple', requestedKeys: localKeys }) : Promise.resolve({})
            ]);

            const result = {};
            const defaultsUsed = [];
            
            keys.forEach(key => {
                const schemaEntry = configSchema[key];
                if (!schemaEntry) {
                    this.logger.error(`Invalid key "${key}" requested in getMultiple`, null, { method: 'getMultiple', invalidKey: key });
                    return;
                }

                const storedItems = schemaEntry.scope === 'sync' ? syncItems : localItems;
                const hasStoredValue = Object.prototype.hasOwnProperty.call(storedItems, key);
                result[key] = hasStoredValue ? storedItems[key] : schemaEntry.defaultValue;
                
                if (!hasStoredValue) {
                    defaultsUsed.push(key);
                }
            });

            this.logger.debug(`getMultiple() completed`, { 
                requestedKeys: keys,
                syncKeys,
                localKeys,
                defaultsUsed,
                resultCount: Object.keys(result).length
            });

            return result;
        } catch (error) {
            this.logger.error(`Error in getMultiple`, error, { 
                method: 'getMultiple', 
                requestedKeys: keys,
                syncKeys,
                localKeys
            });
            throw error;
        }
    }

    /**
     * Retrieves all settings, applying defaults for any unset values.
     * @returns {Promise<object>} A promise that resolves with an object of all settings.
     */
    async getAll() {
        this.logger.debug(`getAll() called`);
        
        const syncKeys = getKeysByScope('sync');
        const localKeys = getKeysByScope('local');

        this.logger.debug(`getAll() storage breakdown`, { 
            syncKeyCount: syncKeys.length, 
            localKeyCount: localKeys.length,
            totalKeys: syncKeys.length + localKeys.length
        });

        try {
            const [syncItems, localItems] = await Promise.all([
                this.getFromStorage('sync', syncKeys, { method: 'getAll', operation: 'bulk-retrieve' }),
                this.getFromStorage('local', localKeys, { method: 'getAll', operation: 'bulk-retrieve' })
            ]);

            const fullConfig = {};
            const defaultsUsed = [];
            
            for (const key in configSchema) {
                const entry = configSchema[key];
                const storedItems = entry.scope === 'sync' ? syncItems : localItems;
                const hasStoredValue = Object.prototype.hasOwnProperty.call(storedItems, key);
                fullConfig[key] = hasStoredValue ? storedItems[key] : entry.defaultValue;
                
                if (!hasStoredValue) {
                    defaultsUsed.push(key);
                }
            }

            this.logger.debug(`getAll() completed`, { 
                totalSettings: Object.keys(fullConfig).length,
                defaultsUsed,
                defaultsUsedCount: defaultsUsed.length,
                syncItemsRetrieved: Object.keys(syncItems).length,
                localItemsRetrieved: Object.keys(localItems).length
            });

            return fullConfig;
        } catch (error) {
            this.logger.error('Error getting all settings', error, { 
                method: 'getAll',
                syncKeyCount: syncKeys.length,
                localKeyCount: localKeys.length,
                fallbackToDefaults: true
            });
            
            // Return defaults if storage fails
            const defaults = {};
            for (const key in configSchema) {
                defaults[key] = configSchema[key].defaultValue;
            }
            
            this.logger.debug(`getAll() returning defaults due to error`, { 
                defaultCount: Object.keys(defaults).length 
            });
            
            return defaults;
        }
    }

    /**
     * Saves a single setting's value to the appropriate storage area.
     * @param {string} key - The setting key to save.
     * @param {any} value - The value to save.
     * @returns {Promise<void>}
     * @throws {Error} If the key is invalid or the value doesn't match the schema
     */
    async set(key, value) {
        this.logger.debug(`set() called`, { key, valueType: typeof value });
        
        const schemaEntry = configSchema[key];
        if (!schemaEntry) {
            const error = new Error(`Invalid key "${key}" provided for set`);
            this.logger.error(error.message, error, { method: 'set', requestedKey: key, providedValue: value });
            throw error;
        }

        // Validate the value
        if (!validateSetting(key, value)) {
            const error = new Error(`Invalid value for key "${key}": ${JSON.stringify(value)}. Expected type: ${schemaEntry.type.name}`);
            this.logger.error(error.message, error, { 
                method: 'set', 
                requestedKey: key, 
                providedValue: value,
                expectedType: schemaEntry.type.name,
                actualType: typeof value
            });
            throw error;
        }

        try {
            await this.setToStorage(schemaEntry.scope, { [key]: value }, { method: 'set', requestedKey: key });
            
            this.logger.debug(`set() completed`, { 
                key, 
                valueType: typeof value,
                scope: schemaEntry.scope
            });
            
            // Update debug mode if this was the debugMode setting
            if (key === 'debugMode') {
                await this.logger.updateDebugMode();
                this.logger.debug(`Debug mode updated`, { debugMode: value });
            }
        } catch (error) {
            this.logger.error(`Error setting key "${key}"`, error, { 
                method: 'set', 
                requestedKey: key,
                providedValue: value,
                scope: schemaEntry.scope
            });
            throw error;
        }
    }

    /**
     * Saves multiple settings at once
     * @param {object} settings - Object with key-value pairs to save
     * @returns {Promise<void>}
     * @throws {Error} If any key is invalid or any value doesn't match the schema
     */
    async setMultiple(settings) {
        const settingsKeys = Object.keys(settings);
        this.logger.debug(`setMultiple() called`, { 
            settingsKeys, 
            settingCount: settingsKeys.length 
        });
        
        const syncSettings = {};
        const localSettings = {};
        const validationErrors = [];

        // Validate and categorize settings
        for (const [key, value] of Object.entries(settings)) {
            const schemaEntry = configSchema[key];
            if (!schemaEntry) {
                const error = `Invalid key "${key}" provided for setMultiple`;
                this.logger.error(error, null, { 
                    method: 'setMultiple', 
                    invalidKey: key, 
                    providedValue: value 
                });
                validationErrors.push({ key, error, type: 'invalid_key' });
                continue;
            }

            if (!validateSetting(key, value)) {
                const error = `Invalid value for key "${key}": ${JSON.stringify(value)}. Expected type: ${schemaEntry.type.name}`;
                this.logger.error(error, null, { 
                    method: 'setMultiple', 
                    invalidKey: key, 
                    providedValue: value,
                    expectedType: schemaEntry.type.name,
                    actualType: typeof value
                });
                validationErrors.push({ key, error, type: 'invalid_value', expectedType: schemaEntry.type.name, actualType: typeof value });
                continue;
            }

            if (schemaEntry.scope === 'sync') {
                syncSettings[key] = value;
            } else {
                localSettings[key] = value;
            }
        }

        // If there were validation errors, throw them
        if (validationErrors.length > 0) {
            const errorMsg = `setMultiple failed with ${validationErrors.length} validation error(s): ${validationErrors.map(e => e.error).join('; ')}`;
            const aggregatedError = new Error(errorMsg);
            aggregatedError.validationErrors = validationErrors;
            aggregatedError.totalSettings = settingsKeys.length;
            aggregatedError.validSettings = settingsKeys.length - validationErrors.length;
            
            this.logger.error(errorMsg, aggregatedError, { 
                method: 'setMultiple', 
                validationErrors,
                totalSettings: settingsKeys.length,
                validSettings: settingsKeys.length - validationErrors.length
            });
            throw aggregatedError;
        }

        this.logger.debug(`setMultiple() validation completed`, { 
            syncSettingsCount: Object.keys(syncSettings).length,
            localSettingsCount: Object.keys(localSettings).length,
            syncKeys: Object.keys(syncSettings),
            localKeys: Object.keys(localSettings)
        });

        // Track results for detailed error reporting
        const results = {
            successful: [],
            failed: [],
            errors: []
        };

        // Save to appropriate storage areas with individual error handling
        const storageOperations = [];
        
        if (Object.keys(syncSettings).length > 0) {
            storageOperations.push({
                area: 'sync',
                settings: syncSettings,
                keys: Object.keys(syncSettings)
            });
        }
        
        if (Object.keys(localSettings).length > 0) {
            storageOperations.push({
                area: 'local',
                settings: localSettings,
                keys: Object.keys(localSettings)
            });
        }

        // Execute storage operations and collect results
        for (const operation of storageOperations) {
            try {
                await this.setToStorage(operation.area, operation.settings, { 
                    method: 'setMultiple', 
                    operation: 'bulk-set', 
                    settingKeys: operation.keys 
                });
                
                results.successful.push({
                    area: operation.area,
                    keys: operation.keys,
                    count: operation.keys.length
                });
                
                this.logger.debug(`setMultiple() ${operation.area} storage completed`, { 
                    area: operation.area,
                    keysSet: operation.keys.length,
                    keys: operation.keys
                });
            } catch (error) {
                results.failed.push({
                    area: operation.area,
                    keys: operation.keys,
                    count: operation.keys.length
                });
                results.errors.push({
                    area: operation.area,
                    error,
                    keys: operation.keys
                });
                
                this.logger.error(`setMultiple() ${operation.area} storage failed`, error, { 
                    method: 'setMultiple',
                    area: operation.area,
                    keyCount: operation.keys.length,
                    keys: operation.keys
                });
            }
        }

        // Handle results and provide detailed error information
        if (results.errors.length > 0) {
            const totalKeysAttempted = settingsKeys.length;
            const totalKeysSet = results.successful.reduce((sum, result) => sum + result.count, 0);
            const totalKeysFailed = results.failed.reduce((sum, result) => sum + result.count, 0);

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
                    failedAreas: results.failed.map(f => f.area),
                    errors: results.errors.map(e => ({ area: e.area, message: e.error.message }))
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
                    successfulAreas: results.successful.map(s => s.area),
                    failedAreas: results.failed.map(f => f.area),
                    errors: results.errors.map(e => ({ area: e.area, message: e.error.message }))
                });
                
                throw aggregatedError;
            }
        } else {
            // Complete success
            this.logger.debug(`setMultiple() completed successfully`, { 
                totalSettings: settingsKeys.length,
                syncSettingsSet: Object.keys(syncSettings).length,
                localSettingsSet: Object.keys(localSettings).length,
                successfulAreas: results.successful.map(s => s.area)
            });
            
            // Update debug mode if debugMode was changed
            if ('debugMode' in settings) {
                await this.logger.updateDebugMode();
                this.logger.debug(`Debug mode updated via setMultiple`, { debugMode: settings.debugMode });
            }
        }
    }

    /**
     * Listens for changes to any settings defined in the schema.
     * @param {function(object)} callback - The function to call with an object of the changed keys and their new values.
     * @returns {function} A function to remove the listener
     */
    onChanged(callback) {
        this.logger.debug(`onChanged() called`, { 
            currentListenerCount: this.changeListeners.size 
        });
        
        this.changeListeners.add(callback);

        this.logger.debug(`Change listener added`, { 
            totalListeners: this.changeListeners.size 
        });

        // Return a function to remove the listener
        return () => {
            this.changeListeners.delete(callback);
            this.logger.debug(`Change listener removed`, { 
                remainingListeners: this.changeListeners.size 
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
            const relevantChanges = {};
            let hasRelevantChanges = false;

            for (const key in changes) {
                if (configSchema[key] && configSchema[key].scope === areaName) {
                    relevantChanges[key] = changes[key].newValue;
                    hasRelevantChanges = true;
                }
            }

            if (hasRelevantChanges) {
                this.logger.debug(`Storage changes detected`, { 
                    areaName, 
                    changedKeys: Object.keys(relevantChanges),
                    listenerCount: this.changeListeners.size
                });

                this.changeListeners.forEach(callback => {
                    try {
                        callback(relevantChanges);
                    } catch (error) {
                        this.logger.error('Error in change listener callback', error, { 
                            areaName, 
                            changedKeys: Object.keys(relevantChanges)
                        });
                    }
                });

                // Update debug mode if debugMode changed
                if ('debugMode' in relevantChanges) {
                    this.logger.updateDebugMode().catch(error => {
                        this.logger.error('Failed to update debug mode after change', error);
                    });
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
            if (entry.scope === 'sync') {
                syncDefaults[key] = entry.defaultValue;
            } else {
                localDefaults[key] = entry.defaultValue;
            }
        }

        this.logger.debug(`resetToDefaults() prepared defaults`, { 
            syncDefaultsCount: Object.keys(syncDefaults).length,
            localDefaultsCount: Object.keys(localDefaults).length,
            syncKeys: Object.keys(syncDefaults),
            localKeys: Object.keys(localDefaults)
        });

        try {
            await Promise.all([
                this.setToStorage('sync', syncDefaults, { method: 'resetToDefaults', operation: 'reset-all' }),
                this.setToStorage('local', localDefaults, { method: 'resetToDefaults', operation: 'reset-all' })
            ]);
            
            this.logger.debug(`resetToDefaults() completed`, { 
                totalSettingsReset: Object.keys(syncDefaults).length + Object.keys(localDefaults).length
            });
            
            // Update debug mode after reset
            await this.logger.updateDebugMode();
            this.logger.debug(`Debug mode updated after reset`);
        } catch (error) {
            this.logger.error(`Error in resetToDefaults`, error, { 
                method: 'resetToDefaults',
                syncDefaultsCount: Object.keys(syncDefaults).length,
                localDefaultsCount: Object.keys(localDefaults).length
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
            totalKeys: syncKeys.length + localKeys.length
        });

        const results = {
            successful: [],
            failed: [],
            errors: []
        };

        // Clear sync storage
        if (syncKeys.length > 0) {
            try {
                await this.removeFromStorage('sync', syncKeys, { method: 'clearAll', operation: 'clear-all' });
                results.successful.push({ area: 'sync', keys: syncKeys, count: syncKeys.length });
                this.logger.debug(`clearAll() sync storage cleared successfully`, { 
                    syncKeysCleared: syncKeys.length 
                });
            } catch (error) {
                results.failed.push({ area: 'sync', keys: syncKeys, count: syncKeys.length });
                results.errors.push({ area: 'sync', error, keys: syncKeys });
                this.logger.error(`clearAll() failed to clear sync storage`, error, { 
                    method: 'clearAll',
                    area: 'sync',
                    keyCount: syncKeys.length,
                    keys: syncKeys
                });
            }
        }

        // Clear local storage
        if (localKeys.length > 0) {
            try {
                await this.removeFromStorage('local', localKeys, { method: 'clearAll', operation: 'clear-all' });
                results.successful.push({ area: 'local', keys: localKeys, count: localKeys.length });
                this.logger.debug(`clearAll() local storage cleared successfully`, { 
                    localKeysCleared: localKeys.length 
                });
            } catch (error) {
                results.failed.push({ area: 'local', keys: localKeys, count: localKeys.length });
                results.errors.push({ area: 'local', error, keys: localKeys });
                this.logger.error(`clearAll() failed to clear local storage`, error, { 
                    method: 'clearAll',
                    area: 'local',
                    keyCount: localKeys.length,
                    keys: localKeys
                });
            }
        }

        // Handle results and errors
        if (results.errors.length > 0) {
            const totalKeysAttempted = syncKeys.length + localKeys.length;
            const totalKeysCleared = results.successful.reduce((sum, result) => sum + result.count, 0);
            const totalKeysFailed = results.failed.reduce((sum, result) => sum + result.count, 0);

            if (results.successful.length === 0) {
                // Complete failure
                const errorMsg = `clearAll() failed completely: ${results.errors.length} storage area(s) failed`;
                this.logger.error(errorMsg, null, { 
                    method: 'clearAll',
                    totalKeysAttempted,
                    failedAreas: results.failed.map(f => f.area),
                    errors: results.errors.map(e => ({ area: e.area, message: e.error.message }))
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
                    successfulAreas: results.successful.map(s => s.area),
                    failedAreas: results.failed.map(f => f.area),
                    errors: results.errors.map(e => ({ area: e.area, message: e.error.message }))
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
                totalKeysCleared
            });
        }
    }
}

// Export a singleton instance
export const configService = new ConfigService();

// Initialize the change listener when the module is loaded
configService.initializeChangeListener(); 