// services/configService.js
import { configSchema, getKeysByScope, validateSetting, getDefaultValue, getStorageScope } from '../config/configSchema.js';

class ConfigService {
    constructor() {
        this.changeListeners = new Set();
        this.isInitialized = false;
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
        const syncKeys = getKeysByScope('sync');
        const localKeys = getKeysByScope('local');

        // Get current values from storage
        const [syncItems, localItems] = await Promise.all([
            this.getFromStorage('sync', syncKeys),
            this.getFromStorage('local', localKeys)
        ]);

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

        // Apply defaults with error handling
        const errors = [];
        
        if (Object.keys(syncDefaults).length > 0) {
            try {
                await this.setToStorage('sync', syncDefaults);
                console.log('ConfigService: Successfully set sync defaults for keys:', Object.keys(syncDefaults));
            } catch (error) {
                console.error('ConfigService: Failed to set sync defaults in storage:', error);
                errors.push({ type: 'sync', error, keys: Object.keys(syncDefaults) });
            }
        }

        if (Object.keys(localDefaults).length > 0) {
            try {
                await this.setToStorage('local', localDefaults);
                console.log('ConfigService: Successfully set local defaults for keys:', Object.keys(localDefaults));
            } catch (error) {
                console.error('ConfigService: Failed to set local defaults in storage:', error);
                errors.push({ type: 'local', error, keys: Object.keys(localDefaults) });
            }
        }

        // Mark as initialized even if there were errors, but log them
        if (errors.length > 0) {
            console.warn('ConfigService: Initialization completed with errors:', errors);
        }
        
        this.isInitialized = true;
    }

    /**
     * Internal method to get data from a specific storage area
     * @param {string} area - 'sync' or 'local'
     * @param {string[]} keys - Array of keys to retrieve
     * @returns {Promise<object>}
     */
    async getFromStorage(area, keys) {
        return new Promise((resolve, reject) => {
            chrome.storage[area].get(keys, items => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve(items);
                }
            });
        });
    }

    /**
     * Internal method to set data to a specific storage area
     * @param {string} area - 'sync' or 'local'
     * @param {object} items - Object with key-value pairs to set
     * @returns {Promise<void>}
     */
    async setToStorage(area, items) {
        return new Promise((resolve, reject) => {
            chrome.storage[area].set(items, () => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
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
        const schemaEntry = configSchema[key];
        if (!schemaEntry) {
            console.error(`ConfigService: Invalid key "${key}" requested.`);
            return undefined;
        }

        try {
            const items = await this.getFromStorage(schemaEntry.scope, [key]);
            return items.hasOwnProperty(key) ? items[key] : schemaEntry.defaultValue;
        } catch (error) {
            console.error(`ConfigService: Error getting key "${key}":`, error);
            return schemaEntry.defaultValue;
        }
    }

    /**
     * Retrieves multiple settings by their keys
     * @param {string[]} keys - Array of setting keys to retrieve
     * @returns {Promise<object>} A promise that resolves with an object containing the requested settings
     */
    async getMultiple(keys) {
        const syncKeys = keys.filter(key => getStorageScope(key) === 'sync');
        const localKeys = keys.filter(key => getStorageScope(key) === 'local');

        const [syncItems, localItems] = await Promise.all([
            syncKeys.length > 0 ? this.getFromStorage('sync', syncKeys) : Promise.resolve({}),
            localKeys.length > 0 ? this.getFromStorage('local', localKeys) : Promise.resolve({})
        ]);

        const result = {};
        keys.forEach(key => {
            const schemaEntry = configSchema[key];
            if (!schemaEntry) {
                console.error(`ConfigService: Invalid key "${key}" requested.`);
                return;
            }

            const storedItems = schemaEntry.scope === 'sync' ? syncItems : localItems;
            result[key] = storedItems.hasOwnProperty(key) ? storedItems[key] : schemaEntry.defaultValue;
        });

        return result;
    }

    /**
     * Retrieves all settings, applying defaults for any unset values.
     * @returns {Promise<object>} A promise that resolves with an object of all settings.
     */
    async getAll() {
        const syncKeys = getKeysByScope('sync');
        const localKeys = getKeysByScope('local');

        try {
            const [syncItems, localItems] = await Promise.all([
                this.getFromStorage('sync', syncKeys),
                this.getFromStorage('local', localKeys)
            ]);

            const fullConfig = {};
            for (const key in configSchema) {
                const entry = configSchema[key];
                const storedItems = entry.scope === 'sync' ? syncItems : localItems;
                fullConfig[key] = storedItems.hasOwnProperty(key) ? storedItems[key] : entry.defaultValue;
            }

            return fullConfig;
        } catch (error) {
            console.error('ConfigService: Error getting all settings:', error);
            // Return defaults if storage fails
            const defaults = {};
            for (const key in configSchema) {
                defaults[key] = configSchema[key].defaultValue;
            }
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
        const schemaEntry = configSchema[key];
        if (!schemaEntry) {
            const error = new Error(`ConfigService: Invalid key "${key}" provided for set.`);
            console.error(error.message);
            throw error;
        }

        // Validate the value
        if (!validateSetting(key, value)) {
            const error = new Error(`ConfigService: Invalid value for key "${key}": ${JSON.stringify(value)}. Expected type: ${schemaEntry.type.name}`);
            console.error(error.message);
            throw error;
        }

        try {
            await this.setToStorage(schemaEntry.scope, { [key]: value });
        } catch (error) {
            console.error(`ConfigService: Error setting key "${key}":`, error);
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
        const syncSettings = {};
        const localSettings = {};
        const errors = [];

        // Validate and categorize settings
        for (const [key, value] of Object.entries(settings)) {
            const schemaEntry = configSchema[key];
            if (!schemaEntry) {
                const error = `Invalid key "${key}" provided for setMultiple.`;
                console.error(`ConfigService: ${error}`);
                errors.push(error);
                continue;
            }

            if (!validateSetting(key, value)) {
                const error = `Invalid value for key "${key}": ${JSON.stringify(value)}. Expected type: ${schemaEntry.type.name}`;
                console.error(`ConfigService: ${error}`);
                errors.push(error);
                continue;
            }

            if (schemaEntry.scope === 'sync') {
                syncSettings[key] = value;
            } else {
                localSettings[key] = value;
            }
        }

        // If there were validation errors, throw them
        if (errors.length > 0) {
            throw new Error(`ConfigService: setMultiple failed with ${errors.length} validation error(s): ${errors.join('; ')}`);
        }

        // Save to appropriate storage areas
        const promises = [];
        if (Object.keys(syncSettings).length > 0) {
            promises.push(this.setToStorage('sync', syncSettings));
        }
        if (Object.keys(localSettings).length > 0) {
            promises.push(this.setToStorage('local', localSettings));
        }

        await Promise.all(promises);
    }

    /**
     * Listens for changes to any settings defined in the schema.
     * @param {function(object)} callback - The function to call with an object of the changed keys and their new values.
     * @returns {function} A function to remove the listener
     */
    onChanged(callback) {
        this.changeListeners.add(callback);

        // Return a function to remove the listener
        return () => {
            this.changeListeners.delete(callback);
        };
    }

    /**
     * Initializes the change listener if not already done
     */
    initializeChangeListener() {
        if (this.changeListenerInitialized) return;

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
                this.changeListeners.forEach(callback => {
                    try {
                        callback(relevantChanges);
                    } catch (error) {
                        console.error('ConfigService: Error in change listener:', error);
                    }
                });
            }
        });

        this.changeListenerInitialized = true;
    }

    /**
     * Resets all settings to their default values
     * @returns {Promise<void>}
     */
    async resetToDefaults() {
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

        await Promise.all([
            this.setToStorage('sync', syncDefaults),
            this.setToStorage('local', localDefaults)
        ]);
    }

    /**
     * Clears all extension settings
     * @returns {Promise<void>}
     */
    async clearAll() {
        const syncKeys = getKeysByScope('sync');
        const localKeys = getKeysByScope('local');

        await Promise.all([
            new Promise(resolve => chrome.storage.sync.remove(syncKeys, resolve)),
            new Promise(resolve => chrome.storage.local.remove(localKeys, resolve))
        ]);
    }
}

// Export a singleton instance
export const configService = new ConfigService();

// Initialize the change listener when the module is loaded
configService.initializeChangeListener(); 