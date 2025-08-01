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
    hideOfficialSubtitles: {
        defaultValue: false,
        type: Boolean,
        scope: 'sync',
    },

    // --- Translation & Provider Settings (from background.js & options.js) ---
    selectedProvider: {
        defaultValue: 'deepl_free',
        type: String,
        scope: 'sync',
    },
    translationBatchSize: { defaultValue: 3, type: Number, scope: 'sync' },
    translationDelay: { defaultValue: 150, type: Number, scope: 'sync' },
    maxConcurrentBatches: { defaultValue: 2, type: Number, scope: 'sync' },
    smartBatching: { defaultValue: true, type: Boolean, scope: 'sync' },
    batchProcessingDelay: { defaultValue: 100, type: Number, scope: 'sync' },
    globalBatchSize: { defaultValue: 5, type: Number, scope: 'sync' },
    batchingEnabled: { defaultValue: true, type: Boolean, scope: 'sync' },
    useProviderDefaults: { defaultValue: true, type: Boolean, scope: 'sync' },

    // Provider-specific batch sizes
    openaieBatchSize: { defaultValue: 8, type: Number, scope: 'sync' },
    googleBatchSize: { defaultValue: 4, type: Number, scope: 'sync' },
    deeplBatchSize: { defaultValue: 3, type: Number, scope: 'sync' },
    microsoftBatchSize: { defaultValue: 4, type: Number, scope: 'sync' },

    // Provider-specific delay settings (in milliseconds)
    openaieDelay: { defaultValue: 100, type: Number, scope: 'sync' },
    googleDelay: { defaultValue: 1500, type: Number, scope: 'sync' },
    deeplDelay: { defaultValue: 500, type: Number, scope: 'sync' },
    deeplFreeDelay: { defaultValue: 2000, type: Number, scope: 'sync' },
    microsoftDelay: { defaultValue: 800, type: Number, scope: 'sync' },

    // DeepL API Settings
    deeplApiKey: { defaultValue: '', type: String, scope: 'sync' },
    deeplApiPlan: { defaultValue: 'free', type: String, scope: 'sync' },

    // OpenAI-compatible API Settings (for Gemini and other compatible endpoints)
    openaiCompatibleApiKey: { defaultValue: '', type: String, scope: 'sync' },
    openaiCompatibleBaseUrl: {
        defaultValue: 'https://generativelanguage.googleapis.com/v1beta/openai',
        type: String,
        scope: 'sync',
    },
    openaiCompatibleModel: {
        defaultValue: 'gemini-1.5-flash',
        type: String,
        scope: 'sync',
    },

    // --- Subtitle Settings (from popup.js & background.js defaults) ---
    subtitlesEnabled: { defaultValue: true, type: Boolean, scope: 'sync' },
    useNativeSubtitles: { defaultValue: true, type: Boolean, scope: 'sync' },
    useOfficialTranslations: {
        defaultValue: true,
        type: Boolean,
        scope: 'sync',
    }, // New unified setting
    targetLanguage: { defaultValue: 'zh-CN', type: String, scope: 'sync' },
    originalLanguage: { defaultValue: 'en', type: String, scope: 'sync' },
    subtitleTimeOffset: { defaultValue: 0.3, type: Number, scope: 'sync' },
    subtitleLayoutOrder: {
        defaultValue: 'original_top',
        type: String,
        scope: 'sync',
    },
    subtitleLayoutOrientation: {
        defaultValue: 'column',
        type: String,
        scope: 'sync',
    },
    subtitleFontSize: { defaultValue: 1.1, type: Number, scope: 'sync' },
    subtitleGap: { defaultValue: 0.3, type: Number, scope: 'sync' },

    // --- UI State Settings (local storage for better performance) ---
    appearanceAccordionOpen: {
        defaultValue: false,
        type: Boolean,
        scope: 'local',
    }, // UI state, doesn't need to sync

    // --- Debug Settings (local storage for immediate availability) ---
    debugMode: { defaultValue: false, type: Boolean, scope: 'local' }, // Debug logging mode
    loggingLevel: { defaultValue: 3, type: Number, scope: 'sync' }, // Logging level: 0=OFF, 1=ERROR, 2=WARN, 3=INFO, 4=DEBUG
};

/**
 * Helper function to get all keys for a specific storage scope
 * @param {string} scope - 'sync' or 'local'
 * @returns {string[]} Array of keys for the specified scope
 */
export function getKeysByScope(scope) {
    return Object.keys(configSchema).filter(
        (key) => configSchema[key].scope === scope
    );
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
        if (typeof value !== 'number' || isNaN(value)) {
            return false;
        }

        // Special validation for loggingLevel - must be integer between 0 and 4
        if (key === 'loggingLevel') {
            return Number.isInteger(value) && value >= 0 && value <= 4;
        }

        return true;
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
        getStorageScope,
    };
}
