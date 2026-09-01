import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    SENSITIVE_KEYS,
    SETTINGS_KEYS,
    configSchema,
    detectBrowserLanguage,
    getDefaultValue,
    getKeysByScope,
    getStorageScope,
    isSettingsKey,
    prepareSettingValue,
    validateSetting,
} from './schema';

describe('registry shape', () => {
    it('has exactly the 47 v3 keys', () => {
        expect(SETTINGS_KEYS).toHaveLength(47);
    });

    it('retired v2 keys are gone', () => {
        expect(isSettingsKey('useNativeSubtitles')).toBe(false);
        expect(isSettingsKey('sidePanelUseSidePanel')).toBe(false);
    });

    it('every sensitive key is device-local', () => {
        expect(SENSITIVE_KEYS).toEqual([
            'deeplApiKey',
            'openaiCompatibleApiKey',
            'vertexAccessToken',
            'openaiApiKey',
            'geminiApiKey',
        ]);
        for (const key of SENSITIVE_KEYS) {
            expect(getStorageScope(key), key).toBe('local');
        }
    });

    it('every default validates against its own schema', () => {
        for (const key of SETTINGS_KEYS) {
            expect(validateSetting(key, getDefaultValue(key)), key).toBe(true);
        }
    });

    it('scope partition covers all keys', () => {
        const sync = getKeysByScope('sync');
        const local = getKeysByScope('local');
        expect(sync.length + local.length).toBe(SETTINGS_KEYS.length);
        expect(local.sort()).toEqual(
            ['appearanceAccordionOpen', 'debugMode', ...SENSITIVE_KEYS].sort()
        );
    });
});

describe('language tags', () => {
    it('canonicalizes case', () => {
        expect(prepareSettingValue('targetLanguage', 'zh-cn')).toBe('zh-CN');
        expect(prepareSettingValue('originalLanguage', 'EN')).toBe('en');
    });

    it('rejects padded or malformed tags', () => {
        expect(validateSetting('targetLanguage', ' en')).toBe(false);
        expect(validateSetting('targetLanguage', 'not a tag!!')).toBe(false);
        expect(validateSetting('targetLanguage', '')).toBe(false);
        expect(validateSetting('targetLanguage', 42)).toBe(false);
    });
});

describe('provider base URLs', () => {
    it('strips trailing slashes but keeps the path', () => {
        expect(
            prepareSettingValue('openaiBaseUrl', 'https://api.openai.com/v1/')
        ).toBe('https://api.openai.com/v1');
    });

    it('allows loopback HTTP only', () => {
        expect(
            validateSetting(
                'openaiCompatibleBaseUrl',
                'http://localhost:1234/v1'
            )
        ).toBe(true);
        expect(
            validateSetting('openaiCompatibleBaseUrl', 'http://example.com/v1')
        ).toBe(false);
    });

    it('rejects query, hash, and embedded credentials', () => {
        expect(
            validateSetting('openaiBaseUrl', 'https://api.openai.com/v1?x=1')
        ).toBe(false);
        expect(
            validateSetting('openaiBaseUrl', 'https://api.openai.com/v1#frag')
        ).toBe(false);
        expect(
            validateSetting(
                'openaiBaseUrl',
                'https://user:pw@api.openai.com/v1'
            )
        ).toBe(false);
    });
});

describe('vertex project ids', () => {
    it.each(['', 'my-project-123', 'example.com:my-project-123'])(
        'accepts %j',
        (value) => {
            expect(validateSetting('vertexProjectId', value)).toBe(true);
        }
    );

    it.each(['Bad_Project', 'a:b:c', 'ab', '-starts-with-dash'])(
        'rejects %j',
        (value) => {
            expect(validateSetting('vertexProjectId', value)).toBe(false);
        }
    );
});

describe('subtitle blacklist', () => {
    it('accepts the default shape', () => {
        expect(
            validateSetting('subtitleBlacklist', {
                disneyplus: ['--forced--'],
                netflix: [],
            })
        ).toBe(true);
    });

    it('rejects dangerous platform keys', () => {
        const hostile = JSON.parse('{"__proto__": ["x"]}') as object;
        expect(validateSetting('subtitleBlacklist', hostile)).toBe(false);
        expect(
            validateSetting('subtitleBlacklist', { constructor: ['x'] })
        ).toBe(false);
    });

    it('rejects blank, duplicate, and non-array rules', () => {
        expect(validateSetting('subtitleBlacklist', { netflix: [' '] })).toBe(
            false
        );
        expect(
            validateSetting('subtitleBlacklist', { netflix: ['a', 'a'] })
        ).toBe(false);
        expect(validateSetting('subtitleBlacklist', { netflix: 'a' })).toBe(
            false
        );
    });
});

describe('AI context types', () => {
    it('accepts subsets including empty', () => {
        expect(validateSetting('aiContextTypes', [])).toBe(true);
        expect(validateSetting('aiContextTypes', ['cultural'])).toBe(true);
        expect(
            validateSetting('aiContextTypes', [
                'cultural',
                'historical',
                'linguistic',
            ])
        ).toBe(true);
    });

    it('rejects duplicates and unknown types', () => {
        expect(
            validateSetting('aiContextTypes', ['cultural', 'cultural'])
        ).toBe(false);
        expect(validateSetting('aiContextTypes', ['mystery'])).toBe(false);
    });
});

describe('numeric constraints', () => {
    it('enforces integers where required', () => {
        expect(validateSetting('loggingLevel', 2.5)).toBe(false);
        expect(validateSetting('loggingLevel', 4)).toBe(true);
    });

    it('enforces bounds and finiteness', () => {
        expect(validateSetting('subtitleFontSize', 0.5)).toBe(false);
        expect(validateSetting('subtitleFontSize', 3.5)).toBe(false);
        expect(validateSetting('subtitleTimeOffset', Number.NaN)).toBe(false);
        expect(validateSetting('subtitleTimeOffset', Infinity)).toBe(false);
        expect(validateSetting('subtitleTimeOffset', -2.75)).toBe(true);
    });
});

describe('prepareSettingValue detachment', () => {
    it('later caller mutation cannot reach the prepared value', () => {
        const input = { netflix: ['keep'] };
        const prepared = prepareSettingValue('subtitleBlacklist', input);
        input.netflix.push('sneaky');
        expect(prepared).toEqual({ netflix: ['keep'] });
    });

    it('uncloneable values are invalid, not stored', () => {
        expect(
            validateSetting('subtitleBlacklist', { netflix: () => [] })
        ).toBe(false);
    });

    it('unknown keys throw', () => {
        expect(() => prepareSettingValue('nope' as never, true)).toThrowError(
            TypeError
        );
    });
});

describe('default resolution', () => {
    it('object defaults are detached per call', () => {
        const first = getDefaultValue('subtitleBlacklist');
        first.disneyplus?.push('mutated');
        expect(getDefaultValue('subtitleBlacklist')).toEqual(
            configSchema.subtitleBlacklist.default
        );
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it.each([
        ['zh-TW', 'zh-TW'],
        ['zh-HK', 'zh-CN'],
        ['zh-cn', 'zh-CN'],
        ['es-MX', 'es'],
        ['ja', 'ja'],
        ['ko-KR', 'ko'],
        ['fr-FR', 'en'],
    ])('uiLanguage default for browser %s is %s', (browserLang, expected) => {
        vi.stubGlobal('navigator', { language: browserLang });
        expect(detectBrowserLanguage()).toBe(expected);
        expect(getDefaultValue('uiLanguage')).toBe(expected);
    });
});
