import { z } from 'zod';
import { CONTEXT_TYPES } from '@/shared/contextTypes';
import { PROVIDER_IDS, VERTEX_LOCATIONS } from '@/shared/providers';
import { toHostPermissionPattern } from '@/shared/hostPermissions';

const DNS_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const VERTEX_PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const DANGEROUS_OBJECT_KEYS = new Set([
    '__proto__',
    'constructor',
    'prototype',
]);
const INVALID_SETTING_VALUE_MESSAGE = 'Invalid setting value.';

/** Numeric limits shared by the schema and the controls that edit them. */
export const SETTING_BOUNDS = {
    translationDelay: { min: 0, max: 5000 },
    aiContextTimeout: { min: 5000, max: 30000 },
    aiContextRateLimit: { min: 10, max: 300 },
    aiContextRetryAttempts: { min: 1, max: 5 },
} as const;

function isPlausibleLanguageTag(value: string): boolean {
    if (!value || value.trim() !== value) {
        return false;
    }
    try {
        return Intl.getCanonicalLocales(value).length === 1;
    } catch {
        return false;
    }
}

function normalizeLanguageTag(value: unknown): string {
    if (typeof value !== 'string' || value.trim() !== value) {
        throw new TypeError(INVALID_SETTING_VALUE_MESSAGE);
    }
    const canonical = Intl.getCanonicalLocales(value)[0];
    if (canonical === undefined) {
        throw new TypeError(INVALID_SETTING_VALUE_MESSAGE);
    }
    return canonical;
}

function isNonblankString(value: string): boolean {
    return value.trim().length > 0;
}

function hasValidVertexProjectId(value: string): boolean {
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
    const [domain, projectId] = parts as [string, string];
    return (
        VERTEX_PROJECT_ID_PATTERN.test(projectId) &&
        domain.split('.').every((label) => DNS_LABEL_PATTERN.test(label))
    );
}

function isAllowedProviderBaseUrl(value: string): boolean {
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

function normalizeProviderBaseUrl(value: unknown): string {
    if (typeof value !== 'string' || !isAllowedProviderBaseUrl(value)) {
        throw new TypeError(INVALID_SETTING_VALUE_MESSAGE);
    }
    const url = new URL(value);
    const basePath = url.pathname.replace(/\/+$/, '');
    return `${url.origin}${basePath}`;
}

function isPlainRecord(value: object): boolean {
    const prototype: unknown = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function hasUniqueItems(items: readonly string[]): boolean {
    return new Set(items).size === items.length;
}

/** Browser language → closest supported UI locale. */
export function detectBrowserLanguage(): UiLanguage {
    if (typeof navigator === 'undefined') {
        return 'en';
    }
    const lang = (navigator.language || 'en').toLowerCase();
    if (lang.startsWith('zh-tw')) return 'zh-TW';
    if (lang.startsWith('zh')) return 'zh-CN';
    if (lang.startsWith('es')) return 'es';
    if (lang.startsWith('ja')) return 'ja';
    if (lang.startsWith('ko')) return 'ko';
    return 'en';
}

const uiLanguageSchema = z.enum(['en', 'es', 'ja', 'ko', 'zh-CN', 'zh-TW']);
export type UiLanguage = z.infer<typeof uiLanguageSchema>;

const languageTag = z.string().refine(isPlausibleLanguageTag);
const nonblankString = z.string().refine(isNonblankString);
const providerBaseUrl = z.string().refine(isAllowedProviderBaseUrl);

// Hand-rolled: z.record silently strips a hostile own "__proto__" key, but a
// dangerous key is evidence of tampering and must fail the whole value.
// Descriptor reads keep the check honest even for getter-trapped inputs.
function isValidSubtitleBlacklist(
    value: unknown
): value is Record<string, string[]> {
    if (
        typeof value !== 'object' ||
        value === null ||
        Array.isArray(value) ||
        !isPlainRecord(value)
    ) {
        return false;
    }
    for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== 'string' || DANGEROUS_OBJECT_KEYS.has(key)) {
            return false;
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) {
            return false;
        }
        const rules: unknown = descriptor.value;
        if (!Array.isArray(rules)) {
            return false;
        }
        const seen = new Set<string>();
        for (const rule of rules) {
            if (
                typeof rule !== 'string' ||
                !isNonblankString(rule) ||
                seen.has(rule)
            ) {
                return false;
            }
            seen.add(rule);
        }
    }
    return true;
}

const subtitleBlacklistSchema = z.custom<Record<string, string[]>>(
    isValidSubtitleBlacklist
);

const contextTypesSchema = z
    .array(z.enum(CONTEXT_TYPES))
    .refine(hasUniqueItems);

interface SettingDefinition<S extends z.ZodType> {
    readonly schema: S;
    readonly default: z.infer<S>;
    readonly scope: 'sync' | 'local';
    /** Sensitive keys must be scope 'local'; a schema test enforces it. */
    readonly sensitive?: true;
    /** Applied before validation (may throw); legacy prepare order. */
    readonly normalize?: (value: unknown) => z.infer<S>;
    /** Overrides `default` at resolution time (e.g. browser language). */
    readonly dynamicDefault?: () => z.infer<S>;
}

const setting = <S extends z.ZodType>(
    definition: SettingDefinition<S>
): SettingDefinition<S> => definition;

export const configSchema = {
    uiLanguage: setting({
        schema: uiLanguageSchema,
        default: 'en',
        scope: 'sync',
        dynamicDefault: detectBrowserLanguage,
    }),
    hideOfficialSubtitles: setting({
        schema: z.boolean(),
        default: true,
        scope: 'sync',
    }),

    selectedProvider: setting({
        schema: z.enum(PROVIDER_IDS),
        default: 'microsoft_edge',
        scope: 'sync',
    }),
    translationDelay: setting({
        schema: z
            .number()
            .finite()
            .min(SETTING_BOUNDS.translationDelay.min)
            .max(SETTING_BOUNDS.translationDelay.max),
        default: 150,
        scope: 'sync',
    }),

    deeplApiKey: setting({
        schema: z.string(),
        default: '',
        scope: 'local',
        sensitive: true,
    }),
    deeplApiPlan: setting({
        schema: z.enum(['free', 'pro']),
        default: 'free',
        scope: 'sync',
    }),

    openaiCompatibleApiKey: setting({
        schema: z.string(),
        default: '',
        scope: 'local',
        sensitive: true,
    }),
    openaiCompatibleBaseUrl: setting({
        schema: providerBaseUrl,
        default: 'https://generativelanguage.googleapis.com/v1beta/openai',
        scope: 'sync',
        normalize: normalizeProviderBaseUrl,
    }),
    openaiCompatibleModel: setting({
        schema: nonblankString,
        default: 'gemini-2.5-flash',
        scope: 'sync',
    }),

    // Access tokens are short-lived device credentials and must not sync.
    vertexAccessToken: setting({
        schema: z.string(),
        default: '',
        scope: 'local',
        sensitive: true,
    }),
    vertexProjectId: setting({
        schema: z.string().refine(hasValidVertexProjectId),
        default: '',
        scope: 'sync',
    }),
    vertexLocation: setting({
        schema: z.enum(VERTEX_LOCATIONS),
        default: 'us-central1',
        scope: 'sync',
    }),
    vertexModel: setting({
        schema: nonblankString,
        default: 'gemini-2.5-flash',
        scope: 'sync',
    }),
    /** When an access token minted from an imported service account
     *  expires (epoch ms); 0 for a manually pasted token. */
    vertexTokenExpiresAt: setting({
        schema: z.number().int().nonnegative(),
        default: 0,
        scope: 'local',
    }),

    subtitlesEnabled: setting({
        schema: z.boolean(),
        default: true,
        scope: 'sync',
    }),
    useOfficialTranslations: setting({
        schema: z.boolean(),
        default: true,
        scope: 'sync',
    }),
    targetLanguage: setting({
        schema: languageTag,
        default: 'zh-CN',
        scope: 'sync',
        normalize: normalizeLanguageTag,
    }),
    originalLanguage: setting({
        schema: languageTag,
        default: 'en',
        scope: 'sync',
        normalize: normalizeLanguageTag,
    }),
    subtitleTimeOffset: setting({
        schema: z.number().finite(),
        default: 0,
        scope: 'sync',
    }),
    subtitleLayoutOrder: setting({
        schema: z.enum(['original_top', 'translation_top']),
        default: 'original_top',
        scope: 'sync',
    }),
    subtitleLayoutOrientation: setting({
        schema: z.enum(['column', 'row']),
        default: 'column',
        scope: 'sync',
    }),
    subtitleFontSize: setting({
        schema: z.number().finite().min(1).max(3),
        default: 1.1,
        scope: 'sync',
    }),
    subtitleGap: setting({
        schema: z.number().finite().min(0).max(1),
        default: 0.3,
        scope: 'sync',
    }),
    subtitleVerticalPosition: setting({
        schema: z.number().finite().min(0.1).max(9.9),
        default: 2.8,
        scope: 'sync',
    }),

    subtitleBlacklist: setting({
        schema: subtitleBlacklistSchema,
        default: {
            disneyplus: ['--forced--', 'forced=yes'],
            netflix: [],
            generic: [],
        },
        scope: 'sync',
    }),

    appearanceAccordionOpen: setting({
        schema: z.boolean(),
        default: false,
        scope: 'local',
    }),

    aiContextEnabled: setting({
        schema: z.boolean(),
        default: false,
        scope: 'sync',
    }),
    aiContextProvider: setting({
        schema: z.enum(['openai', 'gemini']),
        default: 'openai',
        scope: 'sync',
    }),
    aiContextTypes: setting({
        schema: contextTypesSchema,
        default: [...CONTEXT_TYPES],
        scope: 'sync',
    }),

    openaiApiKey: setting({
        schema: z.string(),
        default: '',
        scope: 'local',
        sensitive: true,
    }),
    openaiBaseUrl: setting({
        schema: providerBaseUrl,
        default: 'https://api.openai.com/v1',
        scope: 'sync',
        normalize: normalizeProviderBaseUrl,
    }),
    openaiModel: setting({
        schema: nonblankString,
        default: 'gpt-5.6-luna',
        scope: 'sync',
    }),

    geminiApiKey: setting({
        schema: z.string(),
        default: '',
        scope: 'local',
        sensitive: true,
    }),
    geminiModel: setting({
        schema: nonblankString,
        default: 'gemini-3.5-flash',
        scope: 'sync',
    }),

    aiContextTimeout: setting({
        schema: z
            .number()
            .int()
            .min(SETTING_BOUNDS.aiContextTimeout.min)
            .max(SETTING_BOUNDS.aiContextTimeout.max),
        default: 30000,
        scope: 'sync',
    }),
    aiContextCacheEnabled: setting({
        schema: z.boolean(),
        default: true,
        scope: 'sync',
    }),
    aiContextCacheTTL: setting({
        schema: z.number().int().min(1).max(2_592_000_000),
        default: 3_600_000,
        scope: 'sync',
    }),
    aiContextMaxCacheSize: setting({
        schema: z.number().int().min(1).max(1000),
        default: 200,
        scope: 'sync',
    }),

    aiContextRateLimit: setting({
        schema: z
            .number()
            .int()
            .min(SETTING_BOUNDS.aiContextRateLimit.min)
            .max(SETTING_BOUNDS.aiContextRateLimit.max),
        default: 60,
        scope: 'sync',
    }),
    aiContextBurstLimit: setting({
        schema: z.number().int().min(1).max(300),
        default: 10,
        scope: 'sync',
    }),
    aiContextMandatoryDelay: setting({
        schema: z.number().int().min(1).max(30_000),
        default: 1000,
        scope: 'sync',
    }),

    aiContextRetryAttempts: setting({
        schema: z
            .number()
            .int()
            .min(SETTING_BOUNDS.aiContextRetryAttempts.min)
            .max(SETTING_BOUNDS.aiContextRetryAttempts.max),
        default: 3,
        scope: 'sync',
    }),
    aiContextRetryDelay: setting({
        schema: z.number().int().min(1).max(3750),
        default: 2000,
        scope: 'sync',
    }),

    sidePanelTheme: setting({
        schema: z.enum(['auto', 'light', 'dark']),
        default: 'auto',
        scope: 'sync',
    }),
    sidePanelAutoPauseVideo: setting({
        schema: z.boolean(),
        default: true,
        scope: 'sync',
    }),
    sidePanelAutoOpen: setting({
        schema: z.boolean(),
        default: true,
        scope: 'sync',
    }),

    debugMode: setting({
        schema: z.boolean(),
        default: false,
        scope: 'local',
    }),
    loggingLevel: setting({
        schema: z.number().int().min(0).max(4),
        default: 3,
        scope: 'sync',
    }),
} satisfies Record<string, SettingDefinition<z.ZodType>>;

export type SettingsKey = keyof typeof configSchema;
export type SettingsValues = {
    [K in SettingsKey]: z.infer<(typeof configSchema)[K]['schema']>;
};

export const SETTINGS_KEYS = Object.keys(configSchema) as SettingsKey[];

export const SENSITIVE_KEYS = SETTINGS_KEYS.filter(
    (key) => configSchema[key].sensitive === true
);

export function isSettingsKey(key: string): key is SettingsKey {
    return Object.prototype.hasOwnProperty.call(configSchema, key);
}

export function getKeysByScope(scope: 'sync' | 'local'): SettingsKey[] {
    return SETTINGS_KEYS.filter((key) => configSchema[key].scope === scope);
}

export function getStorageScope(key: SettingsKey): 'sync' | 'local' {
    return configSchema[key].scope;
}

/**
 * Normalize and validate a candidate value for one setting. The input is
 * detached with structuredClone first, so getter/proxy tricks on caller
 * objects are evaluated exactly once and never reach validation or storage.
 *
 * @throws {TypeError} for unknown keys and invalid values
 */
export function prepareSettingValue<K extends SettingsKey>(
    key: K,
    value: unknown
): SettingsValues[K] {
    try {
        const definition = configSchema[key];
        const detached: unknown = structuredClone(value);
        const normalized = definition.normalize
            ? definition.normalize(detached)
            : detached;
        return definition.schema.parse(normalized) as SettingsValues[K];
    } catch {
        throw new TypeError(INVALID_SETTING_VALUE_MESSAGE);
    }
}

export function validateSetting(key: string, value: unknown): boolean {
    if (!isSettingsKey(key)) {
        return false;
    }
    try {
        prepareSettingValue(key, value);
        return true;
    } catch {
        return false;
    }
}

export function getDefaultValue<K extends SettingsKey>(
    key: K
): SettingsValues[K] {
    const definition = configSchema[key];
    if (definition.dynamicDefault) {
        return definition.dynamicDefault() as SettingsValues[K];
    }
    return structuredClone(definition.default) as SettingsValues[K];
}
