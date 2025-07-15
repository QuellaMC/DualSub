// config/configSchema.js
/**
 * The single source of truth for all extension settings.
 * - defaultValue: The value for a fresh installation.
 * - type: The expected data type (for validation).
 * - scope: 'sync' for settings that sync across devices, 'local' for device-specific settings.
 */
export const configSchema = {
    // --- General Settings (from options.js) ---
    uiLanguage: { defaultValue: 'en', type: String, scope: 'sync' },
    hideOfficialSubtitles: { defaultValue: false, type: Boolean, scope: 'sync' },

    // --- Translation & Provider Settings (from background.js & options.js) ---
    selectedProvider: { defaultValue: 'deepl_free', type: String, scope: 'sync' },
    translationBatchSize: { defaultValue: 3, type: Number, scope: 'sync' },
    translationDelay: { defaultValue: 150, type: Number, scope: 'sync' },
    deeplApiKey: { defaultValue: '', type: String, scope: 'sync' },
    deeplApiPlan: { defaultValue: 'free', type: String, scope: 'sync' },

    // --- Subtitle Settings (from popup.js & background.js defaults) ---
    subtitlesEnabled: { defaultValue: true, type: Boolean, scope: 'sync' },
    useNativeSubtitles: { defaultValue: true, type: Boolean, scope: 'sync' },
    targetLanguage: { defaultValue: 'zh-CN', type: String, scope: 'sync' },
    originalLanguage: { defaultValue: 'en', type: String, scope: 'sync' },
    subtitleTimeOffset: { defaultValue: 0.3, type: Number, scope: 'sync' },
    subtitleLayoutOrder: { defaultValue: 'original_top', type: String, scope: 'sync' },
    subtitleLayoutOrientation: { defaultValue: 'column', type: String, scope: 'sync' },
    subtitleFontSize: { defaultValue: 1.1, type: Number, scope: 'sync' },
    subtitleGap: { defaultValue: 0.3, type: Number, scope: 'sync' },

    // --- UI State Settings (local storage for better performance) ---
    appearanceAccordionOpen: { defaultValue: false, type: Boolean, scope: 'local' }, // UI state, doesn't need to sync

    // --- Debug Settings (local storage for immediate availability) ---
    debugMode: { defaultValue: false, type: Boolean, scope: 'local' }, // Debug logging mode
};

/**
 * Helper function to get all keys for a specific storage scope
 * @param {string} scope - 'sync' or 'local'
 * @returns {string[]} Array of keys for the specified scope
 */
export function getKeysByScope(scope) {
    return Object.keys(configSchema).filter(key => configSchema[key].scope === scope);
}

/**
 * Helper function to validate a setting value against its schema
 * @param {string} key - The setting key
 * @param {any} value - The value to validate
 * @returns {boolean} True if valid, false otherwise
 */
export function validateSetting(key, value) {
    const schemaEntry = configSchema[key];
    if (!schemaEntry) {
        return false;
    }
    
    // Check type
    if (schemaEntry.type === String) {
        return typeof value === 'string';
    } else if (schemaEntry.type === Number) {
        return typeof value === 'number' && !isNaN(value);
    } else if (schemaEntry.type === Boolean) {
        return typeof value === 'boolean';
    }
    
    return false;
}

/**
 * Get the default value for a setting
 * @param {string} key - The setting key
 * @returns {any} The default value or undefined if key doesn't exist
 */
export function getDefaultValue(key) {
    return configSchema[key]?.defaultValue;
}

/**
 * Get the storage scope for a setting
 * @param {string} key - The setting key
 * @returns {string} 'sync' or 'local', or undefined if key doesn't exist
 */
export function getStorageScope(key) {
    return configSchema[key]?.scope;
}

// Export for both CommonJS and ES modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        configSchema,
        getKeysByScope,
        validateSetting,
        getDefaultValue,
        getStorageScope
    };
}