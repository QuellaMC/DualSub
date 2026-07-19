/**
 * The single source of truth for all extension settings.
 * - defaultValue: The value for a fresh installation.
 * - type: The expected data type (for validation).
 * - scope: 'sync' for settings that sync across devices, 'local' for device-specific settings.
 */

import {
    Providers,
    VERTEX_LOCATIONS,
} from '../content_scripts/shared/constants/providers.js';
import { CONTEXT_TYPES } from '../content_scripts/shared/constants/contextTypes.js';
import { toHostPermissionPattern } from '../utils/hostPermissions.js';

const DNS_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const VERTEX_PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const DANGEROUS_OBJECT_KEYS = new Set([
    '__proto__',
    'constructor',
    'prototype',
]);
const INVALID_SETTING_VALUE_MESSAGE = 'Invalid setting value.';
const hasOwnProperty = Object.prototype.hasOwnProperty;

function hasOwn(object, key) {
    return hasOwnProperty.call(object, key);
}

function isPlausibleLanguageTag(value) {
    if (!value || value.trim() !== value) {
        return false;
    }

    try {
        return Intl.getCanonicalLocales(value).length === 1;
    } catch {
        return false;
    }
}

function normalizeLanguageTag(value) {
    if (typeof value !== 'string' || value.trim() !== value) {
        throw new TypeError(INVALID_SETTING_VALUE_MESSAGE);
    }

    return Intl.getCanonicalLocales(value)[0];
}

function isNonblankString(value) {
    return value.trim().length > 0;
}

function hasValidVertexProjectId(value) {
    if (value === '') {
        return true;
    }

    const parts = value.split(':');
    if (parts.length === 1) {
        return VERTEX_PROJECT_ID_PATTERN.test(value);
    }
    if (parts.length !== 2) {
        return false;
    }

    const [domain, projectId] = parts;
    return (
        VERTEX_PROJECT_ID_PATTERN.test(projectId) &&
        domain.split('.').every((label) => DNS_LABEL_PATTERN.test(label))
    );
}

function isAllowedProviderBaseUrl(value) {
    try {
        toHostPermissionPattern(value);
        const url = new URL(value);
        return (
            value.trim() === value &&
            !url.search &&
            !url.hash &&
            !value.includes('?') &&
            !value.includes('#')
        );
    } catch {
        return false;
    }
}

function normalizeProviderBaseUrl(value) {
    if (!isAllowedProviderBaseUrl(value)) {
        throw new TypeError(INVALID_SETTING_VALUE_MESSAGE);
    }

    const url = new URL(value);
    const basePath = url.pathname.replace(/\/+$/, '');
    return `${url.origin}${basePath}`;
}

function isDenseUniqueStringArray(value, isAllowed) {
    try {
        if (Object.getPrototypeOf(value) !== Array.prototype) {
            return false;
        }

        const ownKeys = Reflect.ownKeys(value);
        const lengthDescriptor = Object.getOwnPropertyDescriptor(
            value,
            'length'
        );
        if (
            !lengthDescriptor ||
            !('value' in lengthDescriptor) ||
            lengthDescriptor.enumerable ||
            lengthDescriptor.configurable
        ) {
            return false;
        }

        const length = lengthDescriptor.value;
        if (!Number.isInteger(length) || ownKeys.length !== length + 1) {
            return false;
        }

        const seen = new Set();
        for (let index = 0; index < length; index += 1) {
            const itemDescriptor = Object.getOwnPropertyDescriptor(
                value,
                String(index)
            );
            if (
                !itemDescriptor ||
                !('value' in itemDescriptor) ||
                !itemDescriptor.enumerable
            ) {
                return false;
            }

            const item = itemDescriptor.value;
            if (
                typeof item !== 'string' ||
                seen.has(item) ||
                !isAllowed(item)
            ) {
                return false;
            }
            seen.add(item);
        }
        return true;
    } catch {
        return false;
    }
}

function tryStructuredClone(value) {
    try {
        const structuredClone = globalThis.structuredClone;
        if (typeof structuredClone !== 'function') {
            return { ok: false, value: undefined };
        }

        return { ok: true, value: structuredClone(value) };
    } catch {
        return { ok: false, value: undefined };
    }
}

function isStructuredCloneable(value) {
    return tryStructuredClone(value).ok;
}

function cloneTrustedDefaultCollection(value) {
    const activeNodes = new WeakSet();

    function cloneNode(node) {
        if (node === null || typeof node !== 'object') {
            return { ok: true, value: node };
        }
        if (activeNodes.has(node)) {
            return { ok: false, value: undefined };
        }

        activeNodes.add(node);
        try {
            const prototype = Object.getPrototypeOf(node);
            if (Array.isArray(node)) {
                if (prototype !== Array.prototype) {
                    return { ok: false, value: undefined };
                }

                const ownKeys = Reflect.ownKeys(node);
                const lengthDescriptor = Object.getOwnPropertyDescriptor(
                    node,
                    'length'
                );
                if (
                    !lengthDescriptor ||
                    !('value' in lengthDescriptor) ||
                    lengthDescriptor.enumerable ||
                    lengthDescriptor.configurable ||
                    !Number.isSafeInteger(lengthDescriptor.value) ||
                    lengthDescriptor.value < 0 ||
                    ownKeys.length !== lengthDescriptor.value + 1
                ) {
                    return { ok: false, value: undefined };
                }

                const clone = [];
                for (
                    let index = 0;
                    index < lengthDescriptor.value;
                    index += 1
                ) {
                    const itemDescriptor = Object.getOwnPropertyDescriptor(
                        node,
                        String(index)
                    );
                    if (
                        !itemDescriptor ||
                        !('value' in itemDescriptor) ||
                        !itemDescriptor.enumerable
                    ) {
                        return { ok: false, value: undefined };
                    }

                    const clonedItem = cloneNode(itemDescriptor.value);
                    if (!clonedItem.ok) {
                        return clonedItem;
                    }
                    Object.defineProperty(clone, String(index), {
                        configurable: true,
                        enumerable: true,
                        value: clonedItem.value,
                        writable: true,
                    });
                }
                return { ok: true, value: clone };
            }

            if (prototype !== Object.prototype && prototype !== null) {
                return { ok: false, value: undefined };
            }

            const clone = prototype === null ? Object.create(null) : {};
            for (const key of Reflect.ownKeys(node)) {
                if (typeof key !== 'string' || DANGEROUS_OBJECT_KEYS.has(key)) {
                    return { ok: false, value: undefined };
                }

                const propertyDescriptor = Object.getOwnPropertyDescriptor(
                    node,
                    key
                );
                if (
                    !propertyDescriptor ||
                    !('value' in propertyDescriptor) ||
                    !propertyDescriptor.enumerable
                ) {
                    return { ok: false, value: undefined };
                }

                const clonedProperty = cloneNode(propertyDescriptor.value);
                if (!clonedProperty.ok) {
                    return clonedProperty;
                }
                Object.defineProperty(clone, key, {
                    configurable: true,
                    enumerable: true,
                    value: clonedProperty.value,
                    writable: true,
                });
            }
            return { ok: true, value: clone };
        } catch {
            return { ok: false, value: undefined };
        } finally {
            activeNodes.delete(node);
        }
    }

    return cloneNode(value);
}

function hasAllowedAIContextTypes(value) {
    return (
        isDenseUniqueStringArray(value, (item) =>
            CONTEXT_TYPES.includes(item)
        ) && isStructuredCloneable(value)
    );
}

function hasValidSubtitleBlacklist(value) {
    try {
        for (const platform of Reflect.ownKeys(value)) {
            if (
                typeof platform !== 'string' ||
                DANGEROUS_OBJECT_KEYS.has(platform)
            ) {
                return false;
            }

            const rulesDescriptor = Object.getOwnPropertyDescriptor(
                value,
                platform
            );
            if (
                !rulesDescriptor ||
                !('value' in rulesDescriptor) ||
                !rulesDescriptor.enumerable ||
                !Array.isArray(rulesDescriptor.value) ||
                !isDenseUniqueStringArray(
                    rulesDescriptor.value,
                    isNonblankString
                )
            ) {
                return false;
            }
        }
        return isStructuredCloneable(value);
    } catch {
        return false;
    }
}

/**
 * Detect browser language for UI language default
 * @returns {string} Detected browser language code
 */
function detectBrowserLanguage() {
    // Check if we're in a browser environment
    if (typeof navigator === 'undefined') {
        return 'en'; // Fallback for non-browser environments (like tests)
    }

    const lang = (
        navigator.language ||
        navigator.userLanguage ||
        'en'
    ).toLowerCase();

    if (lang.startsWith('zh-cn')) return 'zh-CN';
    if (lang.startsWith('zh-tw')) return 'zh-TW';
    if (lang.startsWith('zh')) return 'zh-CN';
    if (lang.startsWith('es')) return 'es';
    if (lang.startsWith('ja')) return 'ja';
    if (lang.startsWith('ko')) return 'ko';
    return 'en';
}
export const configSchema = {
    // --- General Settings (from options.js) ---
    uiLanguage: {
        defaultValue: 'en',
        type: String,
        scope: 'sync',
        allowedValues: ['en', 'es', 'ja', 'ko', 'zh-CN', 'zh-TW'],
    },
    hideOfficialSubtitles: {
        defaultValue: true,
        type: Boolean,
        scope: 'sync',
    },

    // --- Translation & Provider Settings (from background.js & options.js) ---
    selectedProvider: {
        defaultValue: 'microsoft_edge_auth',
        type: String,
        scope: 'sync',
        allowedValues: Object.values(Providers),
    },
    translationDelay: {
        defaultValue: 150,
        type: Number,
        scope: 'sync',
        min: 0,
        max: 5000,
    },

    // DeepL API Settings
    deeplApiKey: {
        defaultValue: '',
        type: String,
        scope: 'local',
        sensitive: true,
    },
    deeplApiPlan: {
        defaultValue: 'free',
        type: String,
        scope: 'sync',
        allowedValues: ['free', 'pro'],
    },

    // OpenAI-compatible API Settings (for Gemini and other compatible endpoints)
    openaiCompatibleApiKey: {
        defaultValue: '',
        type: String,
        scope: 'local',
        sensitive: true,
    },
    openaiCompatibleBaseUrl: {
        defaultValue: 'https://generativelanguage.googleapis.com/v1beta/openai',
        type: String,
        scope: 'sync',
        normalize: normalizeProviderBaseUrl,
        validate: isAllowedProviderBaseUrl,
    },
    openaiCompatibleModel: {
        defaultValue: 'gemini-2.5-flash',
        type: String,
        scope: 'sync',
        validate: isNonblankString,
    },

    // Vertex AI Gemini Translation Settings
    // Access tokens are short-lived device credentials and must not sync.
    vertexAccessToken: {
        defaultValue: '',
        type: String,
        scope: 'local',
        sensitive: true,
    },
    vertexProjectId: {
        defaultValue: '',
        type: String,
        scope: 'sync',
        validate: hasValidVertexProjectId,
    },
    vertexLocation: {
        defaultValue: 'us-central1',
        type: String,
        scope: 'sync',
        allowedValues: VERTEX_LOCATIONS,
    },
    vertexModel: {
        defaultValue: 'gemini-2.5-flash',
        type: String,
        scope: 'sync',
        validate: isNonblankString,
    },

    // --- Subtitle Settings (from popup.js & background.js defaults) ---
    subtitlesEnabled: { defaultValue: true, type: Boolean, scope: 'sync' },
    useNativeSubtitles: { defaultValue: true, type: Boolean, scope: 'sync' },
    useOfficialTranslations: {
        defaultValue: true,
        type: Boolean,
        scope: 'sync',
    }, // New unified setting
    targetLanguage: {
        defaultValue: 'zh-CN',
        type: String,
        scope: 'sync',
        normalize: normalizeLanguageTag,
        validate: isPlausibleLanguageTag,
    },
    originalLanguage: {
        defaultValue: 'en',
        type: String,
        scope: 'sync',
        normalize: normalizeLanguageTag,
        validate: isPlausibleLanguageTag,
    },
    subtitleTimeOffset: { defaultValue: 0, type: Number, scope: 'sync' },
    subtitleLayoutOrder: {
        defaultValue: 'original_top',
        type: String,
        scope: 'sync',
        allowedValues: ['original_top', 'translation_top'],
    },
    subtitleLayoutOrientation: {
        defaultValue: 'column',
        type: String,
        scope: 'sync',
        allowedValues: ['column', 'row'],
    },
    subtitleFontSize: {
        defaultValue: 1.1,
        type: Number,
        scope: 'sync',
        min: 1,
        max: 3,
    },
    subtitleGap: {
        defaultValue: 0.3,
        type: Number,
        scope: 'sync',
        min: 0,
        max: 1,
    },
    subtitleVerticalPosition: {
        defaultValue: 2.8,
        type: Number,
        scope: 'sync',
        min: 0.1,
        max: 9.9,
    },

    // Platform-specific subtitle blacklist
    subtitleBlacklist: {
        defaultValue: {
            disneyplus: ['--forced--', 'forced=yes'],
            netflix: [],
            generic: [],
        },
        type: Object,
        scope: 'sync',
        validate: hasValidSubtitleBlacklist,
    },

    // --- UI State Settings (local storage for better performance) ---
    appearanceAccordionOpen: {
        defaultValue: false,
        type: Boolean,
        scope: 'local',
    }, // UI state, doesn't need to sync

    // --- AI Context Settings ---
    // Feature toggle
    aiContextEnabled: { defaultValue: false, type: Boolean, scope: 'sync' },

    // Provider selection
    aiContextProvider: {
        defaultValue: 'openai',
        type: String,
        scope: 'sync',
        allowedValues: ['openai', 'gemini'],
    },

    // Context types to enable
    aiContextTypes: {
        defaultValue: CONTEXT_TYPES,
        type: Array,
        scope: 'sync',
        validate: hasAllowedAIContextTypes,
    },

    // OpenAI Context API Settings
    openaiApiKey: {
        defaultValue: '',
        type: String,
        scope: 'local',
        sensitive: true,
    },
    openaiBaseUrl: {
        defaultValue: 'https://api.openai.com/v1',
        type: String,
        scope: 'sync',
        normalize: normalizeProviderBaseUrl,
        validate: isAllowedProviderBaseUrl,
    },
    openaiModel: {
        defaultValue: 'gpt-5.6-luna',
        type: String,
        scope: 'sync',
        validate: isNonblankString,
    },

    // Google Gemini Context API Settings
    geminiApiKey: {
        defaultValue: '',
        type: String,
        scope: 'local',
        sensitive: true,
    },
    geminiModel: {
        defaultValue: 'gemini-3.5-flash',
        type: String,
        scope: 'sync',
        validate: isNonblankString,
    },

    // Context analysis settings
    aiContextTimeout: {
        defaultValue: 30000,
        type: Number,
        scope: 'sync',
        integer: true,
        min: 5000,
        max: 30000,
    }, // 30 seconds
    aiContextCacheEnabled: { defaultValue: true, type: Boolean, scope: 'sync' },
    aiContextCacheTTL: {
        defaultValue: 3600000,
        type: Number,
        scope: 'sync',
        integer: true,
        min: 1,
        max: 2_592_000_000,
    }, // 1 hour
    aiContextMaxCacheSize: {
        defaultValue: 200,
        type: Number,
        scope: 'sync',
        integer: true,
        min: 1,
        max: 1_000,
    },

    // Rate limiting settings
    aiContextRateLimit: {
        defaultValue: 60,
        type: Number,
        scope: 'sync',
        integer: true,
        min: 10,
        max: 300,
    }, // requests per minute
    aiContextBurstLimit: {
        defaultValue: 10,
        type: Number,
        scope: 'sync',
        integer: true,
        min: 1,
        max: 300,
    }, // burst protection
    aiContextMandatoryDelay: {
        defaultValue: 1000,
        type: Number,
        scope: 'sync',
        integer: true,
        min: 1,
        max: 30_000,
    }, // ms between requests

    // Advanced settings
    aiContextRetryAttempts: {
        defaultValue: 3,
        type: Number,
        scope: 'sync',
        integer: true,
        min: 1,
        max: 5,
    },
    aiContextRetryDelay: {
        defaultValue: 2000,
        type: Number,
        scope: 'sync',
        integer: true,
        min: 1,
        max: 3_750,
    },

    // --- Side Panel Settings ---
    // Core side panel toggles
    sidePanelUseSidePanel: { defaultValue: true, type: Boolean, scope: 'sync' }, // Use side panel instead of modal

    // UI preferences
    sidePanelTheme: {
        defaultValue: 'auto',
        type: String,
        scope: 'sync',
        allowedValues: ['auto', 'light', 'dark'],
    },

    // Advanced behavior settings
    sidePanelAutoPauseVideo: {
        defaultValue: true,
        type: Boolean,
        scope: 'sync',
    },
    sidePanelAutoOpen: { defaultValue: true, type: Boolean, scope: 'sync' }, // Auto-open on word click

    // --- Debug Settings (local storage for immediate availability) ---
    debugMode: { defaultValue: false, type: Boolean, scope: 'local' }, // Debug logging mode
    loggingLevel: {
        defaultValue: 3,
        type: Number,
        scope: 'sync',
        integer: true,
        min: 0,
        max: 4,
    }, // Logging level: 0=OFF, 1=ERROR, 2=WARN, 3=INFO, 4=DEBUG
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
 * Validate an already-normalized value against one schema entry.
 * @param {object} schemaEntry - The setting schema entry
 * @param {any} value - The normalized value
 * @returns {boolean} True if valid, false otherwise
 */
function isPreparedSettingValueValid(schemaEntry, value) {
    if (!hasOwn(schemaEntry, 'type')) {
        return false;
    }

    if (schemaEntry.type === String) {
        if (typeof value !== 'string') {
            return false;
        }
    } else if (schemaEntry.type === Number) {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            return false;
        }
    } else if (schemaEntry.type === Boolean) {
        if (typeof value !== 'boolean') {
            return false;
        }
    } else if (schemaEntry.type === Array) {
        if (!Array.isArray(value)) {
            return false;
        }
    } else if (schemaEntry.type === Object) {
        if (
            value === null ||
            typeof value !== 'object' ||
            Array.isArray(value)
        ) {
            return false;
        }
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
            return false;
        }
    } else {
        return false;
    }

    if (
        hasOwn(schemaEntry, 'allowedValues') &&
        !schemaEntry.allowedValues.includes(value)
    ) {
        return false;
    }

    if (
        hasOwn(schemaEntry, 'integer') &&
        schemaEntry.integer &&
        !Number.isSafeInteger(value)
    ) {
        return false;
    }
    if (hasOwn(schemaEntry, 'min') && value < schemaEntry.min) {
        return false;
    }
    if (hasOwn(schemaEntry, 'max') && value > schemaEntry.max) {
        return false;
    }
    if (hasOwn(schemaEntry, 'validate') && !schemaEntry.validate(value)) {
        return false;
    }

    return true;
}

/**
 * Normalize and validate a setting value through its schema entry.
 * @param {string} key - The setting key
 * @param {any} value - The candidate value
 * @returns {any} The prepared value
 * @throws {TypeError} When the key or value is invalid
 */
export function prepareSettingValue(key, value) {
    try {
        if (!hasOwn(configSchema, key)) {
            throw new TypeError(INVALID_SETTING_VALUE_MESSAGE);
        }

        const schemaEntry = configSchema[key];
        const preparedValue = hasOwn(schemaEntry, 'normalize')
            ? schemaEntry.normalize(value)
            : value;

        if (!isPreparedSettingValueValid(schemaEntry, preparedValue)) {
            throw new TypeError(INVALID_SETTING_VALUE_MESSAGE);
        }

        return preparedValue;
    } catch {
        throw new TypeError(INVALID_SETTING_VALUE_MESSAGE);
    }
}

/**
 * Helper function to validate a setting value against its schema
 * @param {string} key - The setting key
 * @param {any} value - The value to validate
 * @returns {boolean} True if valid, false otherwise
 */
export function validateSetting(key, value) {
    try {
        prepareSettingValue(key, value);
        return true;
    } catch {
        return false;
    }
}

/**
 * Get the default value for a setting
 * @param {string} key - The setting key
 * @returns {any} The default value or undefined if key doesn't exist
 */
export function getDefaultValue(key) {
    try {
        if (!hasOwn(configSchema, key)) {
            return undefined;
        }

        // Special case: automatically detect browser language for UI language.
        if (key === 'uiLanguage') {
            return detectBrowserLanguage();
        }

        const schemaEntry = configSchema[key];
        const defaultDescriptor = Object.getOwnPropertyDescriptor(
            schemaEntry,
            'defaultValue'
        );
        if (!defaultDescriptor || !('value' in defaultDescriptor)) {
            return undefined;
        }

        const defaultValue = defaultDescriptor.value;
        if (defaultValue === null || typeof defaultValue !== 'object') {
            return defaultValue;
        }

        const clonedDefault = cloneTrustedDefaultCollection(defaultValue);
        return clonedDefault.ok ? clonedDefault.value : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Get the storage scope for a setting
 * @param {string} key - The setting key
 * @returns {string} 'sync' or 'local', or undefined if key doesn't exist
 */
export function getStorageScope(key) {
    try {
        if (!hasOwn(configSchema, key)) {
            return undefined;
        }

        const schemaEntry = configSchema[key];
        const scopeDescriptor = Object.getOwnPropertyDescriptor(
            schemaEntry,
            'scope'
        );
        return scopeDescriptor && 'value' in scopeDescriptor
            ? scopeDescriptor.value
            : undefined;
    } catch {
        return undefined;
    }
}
