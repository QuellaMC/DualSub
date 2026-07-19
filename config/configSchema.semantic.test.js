import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { Providers } from '../content_scripts/shared/constants/providers.js';
import { CONTEXT_TYPES as SHARED_CONTEXT_TYPES } from '../content_scripts/shared/constants/contextTypes.js';
import { CONTEXT_TYPES as PROVIDER_CONTEXT_TYPES } from '../context_providers/contextSchemas.js';
import {
    configSchema,
    getDefaultValue,
    getStorageScope,
    prepareSettingValue,
    validateSetting,
} from './configSchema.js';

describe('config schema semantic validation', () => {
    it('keeps default and scope lookups on own schema keys and metadata', () => {
        const inheritedKey = '__inheritedSchemaSettingProbe';
        const metadataProbe = '__inheritedSchemaMetadataProbe';

        Object.defineProperty(Object.prototype, inheritedKey, {
            configurable: true,
            value: { defaultValue: 'leaked', scope: 'sync' },
        });
        configSchema[metadataProbe] = Object.create({
            defaultValue: 'leaked',
            scope: 'sync',
        });

        try {
            for (const key of [
                '__proto__',
                'constructor',
                'toString',
                inheritedKey,
                metadataProbe,
            ]) {
                expect(getDefaultValue(key)).toBeUndefined();
                expect(getStorageScope(key)).toBeUndefined();
            }
        } finally {
            delete configSchema[metadataProbe];
            delete Object.prototype[inheritedKey];
        }
    });

    it('returns independent structural clones for collection defaults', () => {
        const canonicalContextTypes = configSchema.aiContextTypes.defaultValue;
        const firstContextTypes = getDefaultValue('aiContextTypes');
        const secondContextTypes = getDefaultValue('aiContextTypes');

        expect(firstContextTypes).toEqual(canonicalContextTypes);
        expect(firstContextTypes).not.toBe(canonicalContextTypes);
        expect(firstContextTypes).not.toBe(secondContextTypes);
        expect(validateSetting('aiContextTypes', firstContextTypes)).toBe(true);
        expect(validateSetting('aiContextTypes', secondContextTypes)).toBe(
            true
        );
        firstContextTypes.push('caller-mutation');
        expect(canonicalContextTypes).not.toContain('caller-mutation');
        expect(secondContextTypes).not.toContain('caller-mutation');

        const canonicalBlacklist = configSchema.subtitleBlacklist.defaultValue;
        const firstBlacklist = getDefaultValue('subtitleBlacklist');
        const secondBlacklist = getDefaultValue('subtitleBlacklist');

        expect(firstBlacklist).toEqual(canonicalBlacklist);
        expect(firstBlacklist).not.toBe(canonicalBlacklist);
        expect(firstBlacklist).not.toBe(secondBlacklist);
        expect(validateSetting('subtitleBlacklist', firstBlacklist)).toBe(true);
        expect(validateSetting('subtitleBlacklist', secondBlacklist)).toBe(
            true
        );
        for (const platform of Object.keys(canonicalBlacklist)) {
            expect(firstBlacklist[platform]).not.toBe(
                canonicalBlacklist[platform]
            );
            expect(firstBlacklist[platform]).not.toBe(
                secondBlacklist[platform]
            );
        }

        firstBlacklist.netflix.push('caller-mutation');
        firstBlacklist.disneyplus[0] = 'caller-mutation';
        firstBlacklist.extraPlatform = ['caller-mutation'];
        delete firstBlacklist.generic;

        expect(canonicalBlacklist.netflix).toEqual([]);
        expect(secondBlacklist.netflix).toEqual([]);
        expect(canonicalBlacklist.disneyplus[0]).toBe('--forced--');
        expect(secondBlacklist.disneyplus[0]).toBe('--forced--');
        expect(canonicalBlacklist).not.toHaveProperty('extraPlatform');
        expect(secondBlacklist).not.toHaveProperty('extraPlatform');
        expect(canonicalBlacklist).toHaveProperty('generic');
        expect(secondBlacklist).toHaveProperty('generic');

        expect(getDefaultValue('debugMode')).toBe(false);
        expect(getDefaultValue('openaiModel')).toBe('gpt-5.6-luna');
    });

    it('returns a locally valid default for every schema entry', () => {
        for (const key of Object.keys(configSchema)) {
            expect(validateSetting(key, getDefaultValue(key))).toBe(true);
        }
    });

    it('clones trusted defaults without accessors, hostile shapes, cycles, or aliases', () => {
        const prefix = '__defaultCloneProbe';
        const probeKeys = {
            accessorCollection: `${prefix}AccessorCollection`,
            accessorMetadata: `${prefix}AccessorMetadata`,
            aliased: `${prefix}Aliased`,
            cyclic: `${prefix}Cyclic`,
            inherited: `${prefix}Inherited`,
            sparse: `${prefix}Sparse`,
            unsupported: `${prefix}Unsupported`,
        };
        let accessorReads = 0;

        const accessorCollection = {};
        Object.defineProperty(accessorCollection, 'value', {
            enumerable: true,
            get() {
                accessorReads += 1;
                throw new Error('default accessor must not run');
            },
        });

        const accessorMetadata = { scope: 'sync', type: Object };
        Object.defineProperty(accessorMetadata, 'defaultValue', {
            enumerable: true,
            get() {
                accessorReads += 1;
                throw new Error('schema accessor must not run');
            },
        });

        const sharedNestedArray = ['value'];
        const cyclic = {};
        cyclic.self = cyclic;
        const inherited = Object.create({ inherited: ['value'] });
        inherited.own = ['value'];

        Object.assign(configSchema, {
            [probeKeys.accessorCollection]: {
                defaultValue: accessorCollection,
                scope: 'sync',
                type: Object,
            },
            [probeKeys.accessorMetadata]: accessorMetadata,
            [probeKeys.aliased]: {
                defaultValue: {
                    first: sharedNestedArray,
                    second: sharedNestedArray,
                },
                scope: 'sync',
                type: Object,
            },
            [probeKeys.cyclic]: {
                defaultValue: cyclic,
                scope: 'sync',
                type: Object,
            },
            [probeKeys.inherited]: {
                defaultValue: inherited,
                scope: 'sync',
                type: Object,
            },
            [probeKeys.sparse]: {
                defaultValue: new Array(1),
                scope: 'sync',
                type: Array,
            },
            [probeKeys.unsupported]: {
                defaultValue: new Date(0),
                scope: 'sync',
                type: Object,
            },
        });

        try {
            for (const key of [
                probeKeys.accessorCollection,
                probeKeys.accessorMetadata,
                probeKeys.cyclic,
                probeKeys.inherited,
                probeKeys.sparse,
                probeKeys.unsupported,
            ]) {
                expect(getDefaultValue(key)).toBeUndefined();
            }
            expect(accessorReads).toBe(0);

            const clonedAliases = getDefaultValue(probeKeys.aliased);
            expect(clonedAliases).toEqual({
                first: ['value'],
                second: ['value'],
            });
            expect(clonedAliases.first).not.toBe(sharedNestedArray);
            expect(clonedAliases.second).not.toBe(sharedNestedArray);
            expect(clonedAliases.first).not.toBe(clonedAliases.second);
        } finally {
            for (const key of Object.values(probeKeys)) {
                delete configSchema[key];
            }
        }
    });

    it('prepares an already-valid setting value through the public schema API', () => {
        expect(prepareSettingValue('debugMode', true)).toBe(true);
    });

    it('throws one fixed non-sensitive error for unknown or invalid prepared values', () => {
        const sensitiveMarker = 'TOP_SECRET_INPUT_9f3a';
        const invalidInputs = [
            [`unknown-${sensitiveMarker}`, true],
            ['deeplApiKey', { value: sensitiveMarker }],
            [
                'openaiBaseUrl',
                `https://user:${sensitiveMarker}@models.example.test/v1`,
            ],
            ['targetLanguage', sensitiveMarker],
        ];

        for (const [key, value] of invalidInputs) {
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
    });

    it('preserves bytes and identity for settings without a normalizer', () => {
        const opaqueString = '  opaque:model/credential:v2  ';
        for (const key of [
            'deeplApiKey',
            'openaiCompatibleApiKey',
            'vertexAccessToken',
            'openaiApiKey',
            'geminiApiKey',
            'openaiCompatibleModel',
            'vertexModel',
            'openaiModel',
            'geminiModel',
        ]) {
            expect(prepareSettingValue(key, opaqueString)).toBe(opaqueString);
        }

        const contextTypes = ['cultural', 'linguistic'];
        const blacklist = { netflix: ['  opaque rule bytes  '] };
        expect(prepareSettingValue('aiContextTypes', contextTypes)).toBe(
            contextTypes
        );
        expect(prepareSettingValue('subtitleBlacklist', blacklist)).toBe(
            blacklist
        );
        expect(blacklist.netflix[0]).toBe('  opaque rule bytes  ');
    });

    it('accepts every declared fresh-install default', () => {
        for (const [key, entry] of Object.entries(configSchema)) {
            expect(validateSetting(key, entry.defaultValue)).toBe(true);
        }
    });

    it('uses the frozen context contract as the exact AI context type source', () => {
        expect(Object.isFrozen(SHARED_CONTEXT_TYPES)).toBe(true);
        expect(PROVIDER_CONTEXT_TYPES).toBe(SHARED_CONTEXT_TYPES);
        expect(configSchema.aiContextTypes.defaultValue).toBe(
            SHARED_CONTEXT_TYPES
        );
        expect(getDefaultValue('aiContextTypes')).toEqual(SHARED_CONTEXT_TYPES);
        expect(getDefaultValue('aiContextTypes')).not.toBe(
            SHARED_CONTEXT_TYPES
        );

        for (const contextType of SHARED_CONTEXT_TYPES) {
            expect(validateSetting('aiContextTypes', [contextType])).toBe(true);
        }
        expect(
            validateSetting('aiContextTypes', ['not-in-context-contract'])
        ).toBe(false);

        const manifest = JSON.parse(
            readFileSync(new URL('../manifest.json', import.meta.url), 'utf8')
        );
        const configSchemaGroups = manifest.web_accessible_resources.filter(
            ({ resources }) => resources.includes('config/configSchema.js')
        );
        expect(configSchemaGroups.length).toBeGreaterThan(0);
        for (const { resources } of configSchemaGroups) {
            expect(resources).toContain(
                'content_scripts/shared/constants/contextTypes.js'
            );
            expect(resources).not.toContain(
                'context_providers/contextSchemas.js'
            );
        }
    });

    it('accepts only registered translation providers', () => {
        for (const provider of Object.values(Providers)) {
            expect(validateSetting('selectedProvider', provider)).toBe(true);
        }

        expect(validateSetting('selectedProvider', 'invented-provider')).toBe(
            false
        );
    });

    it.each([
        ['uiLanguage', ['en', 'es', 'ja', 'ko', 'zh-CN', 'zh-TW']],
        ['deeplApiPlan', ['free', 'pro']],
        [
            'vertexLocation',
            [
                'us-central1',
                'us-east1',
                'us-west1',
                'europe-west1',
                'europe-west4',
                'asia-northeast1',
                'asia-southeast1',
            ],
        ],
        ['subtitleLayoutOrder', ['original_top', 'translation_top']],
        ['subtitleLayoutOrientation', ['column', 'row']],
        ['sidePanelTheme', ['auto', 'light', 'dark']],
        ['aiContextProvider', ['openai', 'gemini']],
    ])('enforces the declared values for %s', (key, allowedValues) => {
        for (const value of allowedValues) {
            expect(validateSetting(key, value)).toBe(true);
        }

        expect(validateSetting(key, 'unsupported-value')).toBe(false);
        expect(validateSetting(key, '')).toBe(false);
    });

    it.each([
        ['translationDelay', [0, 125.5, 5000], [-0.01, 5000.01]],
        ['subtitleFontSize', [1, 1.25, 3], [0.99, 3.01]],
        ['subtitleGap', [0, 0.333, 1], [-0.01, 1.01]],
        ['subtitleVerticalPosition', [0.1, 2.85, 9.9], [0, 9.91]],
        ['loggingLevel', [0, 2, 4], [-1, 2.5, 5]],
        ['aiContextTimeout', [5000, 30000], [4999, 5000.5, 30001]],
        ['aiContextRateLimit', [10, 60, 300], [9, 10.5, 301]],
        ['aiContextRetryAttempts', [1, 3, 5], [0, 1.5, 6]],
    ])('enforces numeric boundaries for %s', (key, valid, invalid) => {
        for (const value of valid) {
            expect(validateSetting(key, value)).toBe(true);
        }
        for (const value of [...invalid, NaN, Infinity, -Infinity]) {
            expect(validateSetting(key, value)).toBe(false);
        }
    });

    it.each([
        ['aiContextCacheTTL', 2_592_000_000],
        ['aiContextMaxCacheSize', 1_000],
        ['aiContextBurstLimit', 300],
        ['aiContextMandatoryDelay', 30_000],
        ['aiContextRetryDelay', 3_750],
    ])('enforces the operational policy range for %s', (key, maximum) => {
        expect(validateSetting(key, 1)).toBe(true);
        expect(validateSetting(key, maximum)).toBe(true);

        for (const value of [0, -1, 1.5, maximum + 1, NaN, Infinity]) {
            expect(validateSetting(key, value)).toBe(false);
        }
    });

    it('requires safe integers for every integer schema entry', () => {
        const integerEntries = Object.entries(configSchema).filter(
            ([, entry]) => entry.integer === true
        );

        for (const [key, entry] of integerEntries) {
            expect(Number.isSafeInteger(entry.defaultValue)).toBe(true);
            expect(validateSetting(key, Number.MAX_SAFE_INTEGER + 1)).toBe(
                false
            );
        }

        const policyProbeKey = '__safeIntegerPolicyProbe';
        configSchema[policyProbeKey] = {
            defaultValue: 1,
            integer: true,
            scope: 'local',
            type: Number,
        };
        try {
            expect(
                validateSetting(policyProbeKey, Number.MAX_SAFE_INTEGER)
            ).toBe(true);
            expect(
                validateSetting(policyProbeKey, Number.MAX_SAFE_INTEGER + 1)
            ).toBe(false);
        } finally {
            delete configSchema[policyProbeKey];
        }
    });

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
        'accepts plausible BCP-47 values for %s without narrowing to the popup list',
        (key) => {
            for (const value of [
                'en',
                'pt-BR',
                'zh-Hant-TW',
                'es-419',
                'fil-PH',
                'sr-Latn-RS',
            ]) {
                expect(validateSetting(key, value)).toBe(true);
            }

            for (const value of [
                '',
                '   ',
                'en_US',
                'en--US',
                'not a language',
                'e',
            ]) {
                expect(validateSetting(key, value)).toBe(false);
            }
        }
    );

    it.each(['targetLanguage', 'originalLanguage'])(
        'canonicalizes valid BCP-47 values for %s',
        (key) => {
            expect(prepareSettingValue(key, 'EN-us')).toBe('en-US');
            expect(prepareSettingValue(key, 'ZH-hant-tw')).toBe('zh-Hant-TW');
            expect(prepareSettingValue(key, 'es-419')).toBe('es-419');

            for (const value of [' en-US', 'en-US ', 'en_US', 'en--US']) {
                expect(() => prepareSettingValue(key, value)).toThrow(
                    'Invalid setting value.'
                );
            }
        }
    );

    it.each([
        'openaiCompatibleModel',
        'vertexModel',
        'openaiModel',
        'geminiModel',
    ])('requires a nonblank but otherwise opaque model for %s', (key) => {
        expect(validateSetting(key, 'custom/model:v2')).toBe(true);
        expect(validateSetting(key, '  custom model  ')).toBe(true);
        expect(validateSetting(key, '')).toBe(false);
        expect(validateSetting(key, ' \t\n ')).toBe(false);
    });

    it('accepts only unset, modern, or strictly domain-scoped Vertex project IDs', () => {
        const thirtyCharacterProjectId = `a${'1'.repeat(29)}`;
        for (const value of [
            '',
            'a12345',
            'my-project',
            thirtyCharacterProjectId,
            'example.com:a12345',
            'sub-domain.example123:my-project',
        ]) {
            expect(validateSetting('vertexProjectId', value)).toBe(true);
            expect(prepareSettingValue('vertexProjectId', value)).toBe(value);
        }

        for (const value of [
            'abcde',
            `a${'1'.repeat(30)}`,
            '1abcde',
            'abcde-',
            'ABCDEF',
            'project with spaces',
            'project/name',
            'project?name',
            'project#name',
            ':a12345',
            '.example:a12345',
            'example.:a12345',
            'example..com:a12345',
            '-example.com:a12345',
            'example-.com:a12345',
            'Example.com:a12345',
            'example.com:A12345',
            'example.com:abcde',
            'example.com:a12345:extra',
        ]) {
            expect(validateSetting('vertexProjectId', value)).toBe(false);
        }
    });

    it.each([
        'deeplApiKey',
        'openaiCompatibleApiKey',
        'vertexAccessToken',
        'openaiApiKey',
        'geminiApiKey',
    ])('keeps credential strings opaque for %s', (key) => {
        expect(validateSetting(key, '')).toBe(true);
        expect(validateSetting(key, '   ')).toBe(true);
        expect(validateSetting(key, '  secret:opaque/value  ')).toBe(true);
        expect(validateSetting(key, null)).toBe(false);
    });

    it.each(['openaiCompatibleBaseUrl', 'openaiBaseUrl'])(
        'reuses the provider host policy for %s',
        (key) => {
            for (const value of [
                'https://models.example.test/v1',
                'https://models.example.test:8443/custom/path',
                'https://models.example.test/models/%3Fopaque/%23part',
                'https://models.example.test/models/%3fopaque/%23part',
                'http://localhost:11434/v1',
                'http://127.0.0.1:8080/v1',
            ]) {
                expect(validateSetting(key, value)).toBe(true);
            }

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
                'https://models.example.test/v1?',
                'https://models.example.test/v1#',
                ' https://models.example.test/v1',
                'https://models.example.test/v1 ',
            ]) {
                expect(validateSetting(key, value)).toBe(false);
            }
        }
    );

    it.each(['openaiCompatibleBaseUrl', 'openaiBaseUrl'])(
        'canonicalizes a validated provider base URL for %s',
        (key) => {
            expect(
                prepareSettingValue(
                    key,
                    'HTTPS://Models.Example.TEST:443/a/../custom/path///'
                )
            ).toBe('https://models.example.test/custom/path');
            expect(
                prepareSettingValue(
                    key,
                    'https://Models.Example.TEST:8443/custom/./path/'
                )
            ).toBe('https://models.example.test:8443/custom/path');
            expect(
                prepareSettingValue(key, 'http://LOCALHOST:80/a/../v1/')
            ).toBe('http://localhost/v1');
            expect(
                prepareSettingValue(key, 'https://MODELS.EXAMPLE.TEST:443/')
            ).toBe('https://models.example.test');
            expect(
                prepareSettingValue(
                    key,
                    'https://Models.Example.TEST/models/%3fopaque/%23part/'
                )
            ).toBe('https://models.example.test/models/%3fopaque/%23part');
        }
    );

    it('accepts only dense, unique AI context types from the supported set', () => {
        expect(validateSetting('aiContextTypes', [])).toBe(true);
        expect(
            validateSetting('aiContextTypes', [
                'linguistic',
                'cultural',
                'historical',
            ])
        ).toBe(true);

        const inheritedItem = new Array(1);
        Object.setPrototypeOf(inheritedItem, { 0: 'cultural' });

        const throwingAccessor = [];
        Object.defineProperty(throwingAccessor, '0', {
            get() {
                throw new Error('must not read array accessors');
            },
        });
        throwingAccessor.length = 1;

        const extraProperty = ['cultural'];
        extraProperty.extra = 'historical';

        const customPrototype = ['cultural'];
        Object.setPrototypeOf(customPrototype, {});

        const nullPrototype = ['cultural'];
        Object.setPrototypeOf(nullPrototype, null);

        const nonenumerableItem = [];
        Object.defineProperty(nonenumerableItem, '0', {
            configurable: true,
            value: 'cultural',
            writable: true,
        });

        const proxyItem = new Proxy(['cultural'], {
            get(target, property, receiver) {
                if (property === 'filter') {
                    throw new Error('consumer-visible proxy trap');
                }
                return Reflect.get(target, property, receiver);
            },
        });

        const revokedItem = Proxy.revocable(['cultural'], {});
        revokedItem.revoke();

        let statefulPrototypeReads = 0;
        const statefulItem = new Proxy(['cultural'], {
            getPrototypeOf(target) {
                statefulPrototypeReads += 1;
                if (statefulPrototypeReads > 1) {
                    throw new Error('state changed between validation reads');
                }
                return Reflect.getPrototypeOf(target);
            },
        });

        for (const value of [
            ['cultural', 'cultural'],
            ['cultural', 'unsupported'],
            ['cultural', 1],
            new Array(1),
            inheritedItem,
            throwingAccessor,
            extraProperty,
            customPrototype,
            nullPrototype,
            nonenumerableItem,
            proxyItem,
            revokedItem.proxy,
            statefulItem,
        ]) {
            expect(validateSetting('aiContextTypes', value)).toBe(false);
        }
    });

    it('validates every own subtitle blacklist entry as unique nonblank strings', () => {
        const nullPrototype = Object.create(null);
        nullPrototype.futurePlatform = ['opaque rule', '  still opaque  '];
        expect(validateSetting('subtitleBlacklist', nullPrototype)).toBe(true);
        expect(
            validateSetting('subtitleBlacklist', {
                netflix: [],
                futurePlatform: ['opaque rule'],
            })
        ).toBe(true);

        const inheritedPlatform = Object.create({ netflix: [] });

        const dangerousKey = Object.create(null);
        dangerousKey.__proto__ = [];

        const symbolKey = { netflix: [] };
        symbolKey[Symbol('platform')] = [];

        const throwingOuterAccessor = {};
        Object.defineProperty(throwingOuterAccessor, 'netflix', {
            get() {
                throw new Error('must not read object accessors');
            },
        });

        const nonenumerablePlatform = {};
        Object.defineProperty(nonenumerablePlatform, 'netflix', {
            value: ['rule'],
        });

        const throwingPrototype = new Proxy(
            {},
            {
                getPrototypeOf() {
                    throw new Error('hostile proxy');
                },
            }
        );

        const extraArrayProperty = ['rule'];
        extraArrayProperty.extra = 'rule';

        const customArrayPrototype = ['rule'];
        Object.setPrototypeOf(customArrayPrototype, {});

        const nullArrayPrototype = ['rule'];
        Object.setPrototypeOf(nullArrayPrototype, null);

        const nonenumerableRule = [];
        Object.defineProperty(nonenumerableRule, '0', {
            configurable: true,
            value: 'rule',
            writable: true,
        });

        const proxyRuleArray = new Proxy(['rule'], {
            get(target, property, receiver) {
                if (property === Symbol.iterator) {
                    throw new Error('consumer-visible proxy trap');
                }
                return Reflect.get(target, property, receiver);
            },
        });

        const proxyBlacklist = new Proxy(
            { netflix: ['rule'] },
            {
                get(target, property, receiver) {
                    if (property === 'netflix') {
                        throw new Error('consumer-visible proxy trap');
                    }
                    return Reflect.get(target, property, receiver);
                },
            }
        );

        const revokedBlacklist = Proxy.revocable({ netflix: ['rule'] }, {});
        revokedBlacklist.revoke();

        let statefulOwnKeyReads = 0;
        const statefulBlacklist = new Proxy(
            { netflix: ['rule'] },
            {
                ownKeys(target) {
                    statefulOwnKeyReads += 1;
                    if (statefulOwnKeyReads > 1) {
                        throw new Error(
                            'state changed between validation reads'
                        );
                    }
                    return Reflect.ownKeys(target);
                },
            }
        );

        for (const value of [
            { netflix: 'rule' },
            { netflix: ['rule', 'rule'] },
            { netflix: ['rule', '   '] },
            { netflix: ['rule', 1] },
            { netflix: new Array(1) },
            { netflix: extraArrayProperty },
            { netflix: customArrayPrototype },
            { netflix: nullArrayPrototype },
            { netflix: nonenumerableRule },
            { netflix: proxyRuleArray },
            inheritedPlatform,
            dangerousKey,
            symbolKey,
            throwingOuterAccessor,
            nonenumerablePlatform,
            throwingPrototype,
            proxyBlacklist,
            revokedBlacklist.proxy,
            statefulBlacklist,
        ]) {
            expect(validateSetting('subtitleBlacklist', value)).toBe(false);
        }
    });

    it('keeps strict collection validation native while default clones remain local', () => {
        const structuredCloneDescriptor = Object.getOwnPropertyDescriptor(
            globalThis,
            'structuredClone'
        );
        Object.defineProperty(globalThis, 'structuredClone', {
            configurable: true,
            value: undefined,
            writable: true,
        });

        try {
            expect(validateSetting('aiContextTypes', ['cultural'])).toBe(false);
            expect(
                validateSetting('subtitleBlacklist', { netflix: ['rule'] })
            ).toBe(false);
            expect(getDefaultValue('aiContextTypes')).toEqual(
                SHARED_CONTEXT_TYPES
            );
            expect(getDefaultValue('subtitleBlacklist')).toEqual(
                configSchema.subtitleBlacklist.defaultValue
            );
            expect(getDefaultValue('debugMode')).toBe(false);

            Object.defineProperty(globalThis, 'structuredClone', {
                configurable: true,
                value() {
                    throw new Error('host clone failure must not escape');
                },
                writable: true,
            });
            expect(getDefaultValue('aiContextTypes')).toEqual(
                SHARED_CONTEXT_TYPES
            );
            expect(getDefaultValue('subtitleBlacklist')).toEqual(
                configSchema.subtitleBlacklist.defaultValue
            );
        } finally {
            if (structuredCloneDescriptor) {
                Object.defineProperty(
                    globalThis,
                    'structuredClone',
                    structuredCloneDescriptor
                );
            } else {
                delete globalThis.structuredClone;
            }
        }
    });

    it('ignores inherited schema metadata and rejects prototype-chain keys', () => {
        Object.defineProperty(Object.prototype, 'validate', {
            configurable: true,
            value: () => false,
        });
        try {
            expect(validateSetting('debugMode', true)).toBe(true);
        } finally {
            delete Object.prototype.validate;
        }

        for (const key of [
            '__proto__',
            'prototype',
            'constructor',
            'toString',
        ]) {
            expect(validateSetting(key, true)).toBe(false);
        }
    });
});
