import {
    Providers,
    VERTEX_LOCATIONS,
} from '../content_scripts/shared/constants/providers.js';
import { CONTEXT_TYPES } from '../content_scripts/shared/constants/contextTypes.js';
import { toHostPermissionPattern } from '../utils/hostPermissions.js';

const DNS_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const VERTEX_PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const RESERVED_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const INVALID_SETTING_VALUE_MESSAGE = 'Invalid setting value.';

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
    const url = new URL(value);
    const basePath = url.pathname.replace(/\/+$/, '');
    return `${url.origin}${basePath}`;
}

function hasUniqueStrings(value, isAllowed) {
    if (!Array.isArray(value)) {
        return false;
    }

    const seen = new Set();
    for (const item of value) {
        if (typeof item !== 'string' || seen.has(item) || !isAllowed(item)) {
            return false;
        }
        seen.add(item);
    }
    return true;
}

function hasAllowedAIContextTypes(value) {
    return hasUniqueStrings(value, (item) => CONTEXT_TYPES.includes(item));
}

function hasValidSubtitleBlacklist(value) {
    return Object.entries(value).every(
        ([platform, rules]) =>
            !RESERVED_OBJECT_KEYS.has(platform) &&
            hasUniqueStrings(rules, isNonblankString)
    );
}

function detectBrowserLanguage() {
    if (typeof navigator === 'undefined') {
        return 'en';
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
    // General
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

    // Translation and providers
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

    // Subtitles
    subtitlesEnabled: { defaultValue: true, type: Boolean, scope: 'sync' },
    useNativeSubtitles: { defaultValue: true, type: Boolean, scope: 'sync' },
    useOfficialTranslations: {
        defaultValue: true,
        type: Boolean,
        scope: 'sync',
    },
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

    // UI state
    appearanceAccordionOpen: {
        defaultValue: false,
        type: Boolean,
        scope: 'local',
    },

    // AI context
    aiContextEnabled: { defaultValue: false, type: Boolean, scope: 'sync' },

    aiContextProvider: {
        defaultValue: 'openai',
        type: String,
        scope: 'sync',
        allowedValues: ['openai', 'gemini'],
    },

    aiContextTypes: {
        defaultValue: CONTEXT_TYPES,
        type: Array,
        scope: 'sync',
        validate: hasAllowedAIContextTypes,
    },

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

    aiContextTimeout: {
        defaultValue: 30000,
        type: Number,
        scope: 'sync',
        integer: true,
        min: 5000,
        max: 30000,
    },
    aiContextCacheEnabled: { defaultValue: true, type: Boolean, scope: 'sync' },
    aiContextCacheTTL: {
        defaultValue: 3600000,
        type: Number,
        scope: 'sync',
        integer: true,
        min: 1,
        max: 2_592_000_000,
    },
    aiContextMaxCacheSize: {
        defaultValue: 200,
        type: Number,
        scope: 'sync',
        integer: true,
        min: 1,
        max: 1_000,
    },

    aiContextRateLimit: {
        defaultValue: 60,
        type: Number,
        scope: 'sync',
        integer: true,
        min: 10,
        max: 300,
    },
    aiContextBurstLimit: {
        defaultValue: 10,
        type: Number,
        scope: 'sync',
        integer: true,
        min: 1,
        max: 300,
    },
    aiContextMandatoryDelay: {
        defaultValue: 1000,
        type: Number,
        scope: 'sync',
        integer: true,
        min: 1,
        max: 30_000,
    },

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

    // Side panel
    sidePanelUseSidePanel: { defaultValue: true, type: Boolean, scope: 'sync' },

    sidePanelTheme: {
        defaultValue: 'auto',
        type: String,
        scope: 'sync',
        allowedValues: ['auto', 'light', 'dark'],
    },

    sidePanelAutoPauseVideo: {
        defaultValue: true,
        type: Boolean,
        scope: 'sync',
    },
    sidePanelAutoOpen: { defaultValue: true, type: Boolean, scope: 'sync' },

    // Diagnostics
    debugMode: { defaultValue: false, type: Boolean, scope: 'local' },
    loggingLevel: {
        defaultValue: 3,
        type: Number,
        scope: 'sync',
        integer: true,
        min: 0,
        max: 4,
    },
};

export function getKeysByScope(scope) {
    return Object.keys(configSchema).filter(
        (key) => configSchema[key].scope === scope
    );
}

function hasExpectedType(schemaEntry, value) {
    if (schemaEntry.type === String) {
        return typeof value === 'string';
    }
    if (schemaEntry.type === Number) {
        return typeof value === 'number' && Number.isFinite(value);
    }
    if (schemaEntry.type === Boolean) {
        return typeof value === 'boolean';
    }
    if (schemaEntry.type === Array) {
        return Array.isArray(value);
    }
    if (schemaEntry.type === Object) {
        if (
            value === null ||
            typeof value !== 'object' ||
            Array.isArray(value)
        ) {
            return false;
        }
        const prototype = Object.getPrototypeOf(value);
        return (
            prototype === null ||
            (Object.getPrototypeOf(prototype) === null &&
                prototype.constructor?.name === 'Object')
        );
    }
    return false;
}

function isSettingValueValid(schemaEntry, value) {
    if (!hasExpectedType(schemaEntry, value)) {
        return false;
    }

    if (schemaEntry.allowedValues?.includes(value) === false) {
        return false;
    }
    if (schemaEntry.integer && !Number.isSafeInteger(value)) {
        return false;
    }
    if (schemaEntry.min !== undefined && value < schemaEntry.min) {
        return false;
    }
    if (schemaEntry.max !== undefined && value > schemaEntry.max) {
        return false;
    }
    return schemaEntry.validate ? schemaEntry.validate(value) : true;
}

export function prepareSettingValue(key, value) {
    try {
        if (!Object.hasOwn(configSchema, key)) {
            throw new TypeError(INVALID_SETTING_VALUE_MESSAGE);
        }

        const schemaEntry = configSchema[key];
        if (!isSettingValueValid(schemaEntry, value)) {
            throw new TypeError(INVALID_SETTING_VALUE_MESSAGE);
        }

        return schemaEntry.normalize ? schemaEntry.normalize(value) : value;
    } catch {
        throw new TypeError(INVALID_SETTING_VALUE_MESSAGE);
    }
}

export function validateSetting(key, value) {
    try {
        prepareSettingValue(key, value);
        return true;
    } catch {
        return false;
    }
}

export function getDefaultValue(key) {
    if (!Object.hasOwn(configSchema, key)) {
        return undefined;
    }

    if (key === 'uiLanguage') {
        return detectBrowserLanguage();
    }

    const defaultValue = configSchema[key].defaultValue;
    return defaultValue !== null && typeof defaultValue === 'object'
        ? structuredClone(defaultValue)
        : defaultValue;
}

export function getStorageScope(key) {
    return Object.hasOwn(configSchema, key)
        ? configSchema[key].scope
        : undefined;
}
