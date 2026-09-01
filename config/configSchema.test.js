import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import {
    Providers,
    VERTEX_LOCATIONS,
} from '../content_scripts/shared/constants/providers.js';
import { CONTEXT_TYPES } from '../content_scripts/shared/constants/contextTypes.js';
import { CONTEXT_TYPES as PROVIDER_CONTEXT_TYPES } from '../context_providers/contextSchemas.js';
import {
    configSchema,
    getDefaultValue,
    getKeysByScope,
    getStorageScope,
    prepareSettingValue,
    validateSetting,
} from './configSchema.js';

const LOCAL_KEYS = [
    'deeplApiKey',
    'openaiCompatibleApiKey',
    'vertexAccessToken',
    'appearanceAccordionOpen',
    'openaiApiKey',
    'geminiApiKey',
    'debugMode',
];

const SENSITIVE_KEYS = [
    'deeplApiKey',
    'openaiCompatibleApiKey',
    'vertexAccessToken',
    'openaiApiKey',
    'geminiApiKey',
];

describe('config schema', () => {
    it('keeps the public catalog, scopes, and sensitive metadata compatible', () => {
        expect(getKeysByScope('local')).toEqual(LOCAL_KEYS);
        expect(getKeysByScope('sync')).toEqual(
            Object.keys(configSchema).filter((key) => !LOCAL_KEYS.includes(key))
        );

        expect(
            Object.keys(configSchema).filter(
                (key) => configSchema[key].sensitive === true
            )
        ).toEqual(SENSITIVE_KEYS);

        for (const key of SENSITIVE_KEYS) {
            expect(configSchema[key]).toMatchObject({
                defaultValue: '',
                scope: 'local',
                type: String,
            });
            expect(getStorageScope(key)).toBe('local');
        }
    });

    it('keeps every declared default valid and current provider defaults exact', () => {
        for (const [key, entry] of Object.entries(configSchema)) {
            expect(validateSetting(key, entry.defaultValue)).toBe(true);
            expect(validateSetting(key, getDefaultValue(key))).toBe(true);
            expect(['sync', 'local']).toContain(entry.scope);
        }

        expect(getDefaultValue('subtitleTimeOffset')).toBe(0);
        expect(getDefaultValue('openaiCompatibleBaseUrl')).toBe(
            'https://generativelanguage.googleapis.com/v1beta/openai'
        );
        expect(getDefaultValue('openaiCompatibleModel')).toBe(
            'gemini-2.5-flash'
        );
        expect(getDefaultValue('openaiBaseUrl')).toBe(
            'https://api.openai.com/v1'
        );
        expect(getDefaultValue('openaiModel')).toBe('gpt-5.6-luna');
        expect(getDefaultValue('geminiModel')).toBe('gemini-3.5-flash');
        expect(getDefaultValue('vertexLocation')).toBe('us-central1');
        expect(getDefaultValue('vertexModel')).toBe('gemini-2.5-flash');
    });

    it('returns independent values for collection defaults', () => {
        const contextTypes = getDefaultValue('aiContextTypes');
        const blacklist = getDefaultValue('subtitleBlacklist');

        expect(contextTypes).toEqual(CONTEXT_TYPES);
        expect(contextTypes).not.toBe(configSchema.aiContextTypes.defaultValue);
        expect(blacklist).toEqual(configSchema.subtitleBlacklist.defaultValue);
        expect(blacklist).not.toBe(configSchema.subtitleBlacklist.defaultValue);
        expect(blacklist.disneyplus).not.toBe(
            configSchema.subtitleBlacklist.defaultValue.disneyplus
        );

        contextTypes.push('caller-only');
        blacklist.netflix.push('caller-only');
        expect(configSchema.aiContextTypes.defaultValue).toEqual(CONTEXT_TYPES);
        expect(configSchema.subtitleBlacklist.defaultValue.netflix).toEqual([]);
    });

    it('fails closed for unknown keys and invalid values', () => {
        const sensitiveMarker = 'TOP_SECRET_INPUT_9f3a';
        const invalidInputs = [
            [`unknown-${sensitiveMarker}`, true],
            ['__proto__', true],
            ['debugMode', 'true'],
            ['translationDelay', Number.POSITIVE_INFINITY],
            ['deeplApiKey', { value: sensitiveMarker }],
            [
                'openaiBaseUrl',
                `https://user:${sensitiveMarker}@models.example.test/v1`,
            ],
            ['targetLanguage', sensitiveMarker],
        ];

        for (const [key, value] of invalidInputs) {
            expect(validateSetting(key, value)).toBe(false);

            let thrown;
            try {
                prepareSettingValue(key, value);
            } catch (error) {
                thrown = error;
            }
            expect(thrown).toBeInstanceOf(TypeError);
            expect(thrown.message).toBe('Invalid setting value.');
            expect(String(thrown)).not.toContain(sensitiveMarker);
        }

        expect(getDefaultValue('missingSetting')).toBeUndefined();
        expect(getStorageScope('missingSetting')).toBeUndefined();
    });

    it.each([
        ['uiLanguage', ['en', 'es', 'ja', 'ko', 'zh-CN', 'zh-TW']],
        ['selectedProvider', Object.values(Providers)],
        ['deeplApiPlan', ['free', 'pro']],
        ['vertexLocation', VERTEX_LOCATIONS],
        ['subtitleLayoutOrder', ['original_top', 'translation_top']],
        ['subtitleLayoutOrientation', ['column', 'row']],
        ['aiContextProvider', ['openai', 'gemini']],
        ['sidePanelTheme', ['auto', 'light', 'dark']],
    ])('enforces the canonical values for %s', (key, allowedValues) => {
        for (const value of allowedValues) {
            expect(prepareSettingValue(key, value)).toBe(value);
        }
        expect(validateSetting(key, '')).toBe(false);
        expect(validateSetting(key, 'unsupported-value')).toBe(false);
    });

    it.each([
        ['translationDelay', 0, 5_000, false],
        ['subtitleFontSize', 1, 3, false],
        ['subtitleGap', 0, 1, false],
        ['subtitleVerticalPosition', 0.1, 9.9, false],
        ['aiContextTimeout', 5_000, 30_000, true],
        ['aiContextCacheTTL', 1, 2_592_000_000, true],
        ['aiContextMaxCacheSize', 1, 1_000, true],
        ['aiContextRateLimit', 10, 300, true],
        ['aiContextBurstLimit', 1, 300, true],
        ['aiContextMandatoryDelay', 1, 30_000, true],
        ['aiContextRetryAttempts', 1, 5, true],
        ['aiContextRetryDelay', 1, 3_750, true],
        ['loggingLevel', 0, 4, true],
    ])(
        'enforces the numeric policy for %s',
        (key, minimum, maximum, integer) => {
            expect(validateSetting(key, minimum)).toBe(true);
            expect(validateSetting(key, maximum)).toBe(true);
            expect(validateSetting(key, configSchema[key].defaultValue)).toBe(
                true
            );

            for (const value of [
                minimum - 1,
                maximum + 1,
                NaN,
                Number.POSITIVE_INFINITY,
                Number.NEGATIVE_INFINITY,
            ]) {
                expect(validateSetting(key, value)).toBe(false);
            }
            if (integer) {
                expect(validateSetting(key, minimum + 0.5)).toBe(false);
            }
        }
    );

    it('allows any finite subtitle time offset', () => {
        for (const value of [
            -Number.MAX_VALUE,
            -0.25,
            0,
            0.25,
            Number.MAX_VALUE,
        ]) {
            expect(validateSetting('subtitleTimeOffset', value)).toBe(true);
        }
        for (const value of [NaN, Infinity, -Infinity]) {
            expect(validateSetting('subtitleTimeOffset', value)).toBe(false);
        }
    });

    it.each(['targetLanguage', 'originalLanguage'])(
        'validates and canonicalizes BCP-47 values for %s',
        (key) => {
            expect(prepareSettingValue(key, 'EN-us')).toBe('en-US');
            expect(prepareSettingValue(key, 'ZH-hant-tw')).toBe('zh-Hant-TW');
            expect(prepareSettingValue(key, 'es-419')).toBe('es-419');

            for (const value of [
                '',
                ' en-US',
                'en-US ',
                'en_US',
                'en--US',
                'not a language',
                'e',
            ]) {
                expect(validateSetting(key, value)).toBe(false);
            }
        }
    );

    it.each(['openaiCompatibleBaseUrl', 'openaiBaseUrl'])(
        'validates and canonicalizes provider URLs for %s',
        (key) => {
            expect(
                prepareSettingValue(
                    key,
                    'HTTPS://Models.Example.TEST:443/a/../custom/path///'
                )
            ).toBe('https://models.example.test/custom/path');
            expect(
                prepareSettingValue(key, 'http://LOCALHOST:80/a/../v1/')
            ).toBe('http://localhost/v1');
            expect(
                prepareSettingValue(
                    key,
                    'https://Models.Example.TEST/models/%3fopaque/%23part/'
                )
            ).toBe('https://models.example.test/models/%3fopaque/%23part');

            for (const value of [
                '',
                'not a URL',
                'http://models.example.test/v1',
                'http://localhost.example.test/v1',
                'http://127.0.0.2/v1',
                'http://[::1]/v1',
                'ftp://models.example.test/v1',
                'https://user:secret@models.example.test/v1',
                'https://models.example.test/v1?mode=custom',
                'https://models.example.test/v1#provider',
                ' https://models.example.test/v1',
                'https://models.example.test/v1 ',
            ]) {
                expect(validateSetting(key, value)).toBe(false);
            }
        }
    );

    it('accepts only modern Vertex project identifiers', () => {
        const valid = [
            '',
            'a12345',
            'my-project',
            `a${'1'.repeat(29)}`,
            'example.com:a12345',
            'sub-domain.example123:my-project',
        ];
        const invalid = [
            'abcde',
            `a${'1'.repeat(30)}`,
            '1abcde',
            'abcde-',
            'ABCDEF',
            'project with spaces',
            'example..com:a12345',
            '-example.com:a12345',
            'Example.com:a12345',
            'example.com:A12345',
            'example.com:a12345:extra',
        ];

        for (const value of valid) {
            expect(prepareSettingValue('vertexProjectId', value)).toBe(value);
        }
        for (const value of invalid) {
            expect(validateSetting('vertexProjectId', value)).toBe(false);
        }
    });

    it.each([
        'openaiCompatibleModel',
        'vertexModel',
        'openaiModel',
        'geminiModel',
    ])('keeps nonblank model identifiers opaque for %s', (key) => {
        const opaqueModel = '  custom/model:v2  ';
        expect(prepareSettingValue(key, opaqueModel)).toBe(opaqueModel);
        expect(validateSetting(key, '')).toBe(false);
        expect(validateSetting(key, ' \t\n ')).toBe(false);
    });

    it.each(SENSITIVE_KEYS)('keeps credential bytes opaque for %s', (key) => {
        const opaqueCredential = '  secret:opaque/value  ';
        expect(prepareSettingValue(key, opaqueCredential)).toBe(
            opaqueCredential
        );
        expect(validateSetting(key, null)).toBe(false);
    });

    it('validates AI context types as unique values from the shared contract', () => {
        expect(configSchema.aiContextTypes.defaultValue).toBe(CONTEXT_TYPES);
        expect(PROVIDER_CONTEXT_TYPES).toBe(CONTEXT_TYPES);
        expect(validateSetting('aiContextTypes', [])).toBe(true);
        expect(
            validateSetting('aiContextTypes', [
                'linguistic',
                'cultural',
                'historical',
            ])
        ).toBe(true);

        for (const value of [
            ['cultural', 'cultural'],
            ['cultural', 'unsupported'],
            ['cultural', 1],
            new Array(1),
            {},
            'cultural',
        ]) {
            expect(validateSetting('aiContextTypes', value)).toBe(false);
        }
    });

    it('validates subtitle blacklist rules without narrowing platform names', () => {
        const futurePlatforms = Object.create(null);
        futurePlatforms.futurePlatform = ['opaque rule', '  still opaque  '];
        expect(validateSetting('subtitleBlacklist', futurePlatforms)).toBe(
            true
        );
        expect(
            validateSetting('subtitleBlacklist', {
                netflix: [],
                futurePlatform: ['opaque rule'],
            })
        ).toBe(true);

        const reservedPlatform = Object.create(null);
        reservedPlatform.__proto__ = [];
        for (const value of [
            { netflix: 'rule' },
            { netflix: ['rule', 'rule'] },
            { netflix: ['rule', '   '] },
            { netflix: ['rule', 1] },
            { netflix: new Array(1) },
            reservedPlatform,
            [],
            new Date(),
            null,
        ]) {
            expect(validateSetting('subtitleBlacklist', value)).toBe(false);
        }
    });

    it('keeps the shared context contract reachable with the schema module', () => {
        const manifest = JSON.parse(
            readFileSync(new URL('../manifest.json', import.meta.url), 'utf8')
        );
        const groups = manifest.web_accessible_resources.filter(
            ({ resources }) => resources.includes('config/configSchema.js')
        );

        expect(groups.length).toBeGreaterThan(0);
        for (const { resources } of groups) {
            expect(resources).toContain(
                'content_scripts/shared/constants/contextTypes.js'
            );
            expect(resources).not.toContain(
                'context_providers/contextSchemas.js'
            );
        }
    });
});
