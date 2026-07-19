import { configSchema } from '../config/configSchema.js';
import * as settingsProjections from './settingsProjections.js';

const { OPTIONS_SETTINGS_KEYS, POPUP_SETTINGS_KEYS } = settingsProjections;

const EXPECTED_POPUP_SETTINGS_KEYS = [
    'uiLanguage',
    'subtitlesEnabled',
    'useOfficialTranslations',
    'useNativeSubtitles',
    'originalLanguage',
    'targetLanguage',
    'subtitleLayoutOrder',
    'subtitleLayoutOrientation',
    'subtitleFontSize',
    'subtitleGap',
    'subtitleVerticalPosition',
    'subtitleTimeOffset',
    'appearanceAccordionOpen',
];

const EXPECTED_OPTIONS_SETTINGS_KEYS = [
    'aiContextCacheEnabled',
    'aiContextEnabled',
    'aiContextProvider',
    'aiContextRateLimit',
    'aiContextRetryAttempts',
    'aiContextTimeout',
    'aiContextTypes',
    'deeplApiPlan',
    'geminiModel',
    'hideOfficialSubtitles',
    'loggingLevel',
    'openaiBaseUrl',
    'openaiCompatibleBaseUrl',
    'openaiCompatibleModel',
    'openaiModel',
    'selectedProvider',
    'sidePanelAutoOpen',
    'sidePanelAutoPauseVideo',
    'sidePanelTheme',
    'sidePanelUseSidePanel',
    'translationDelay',
    'uiLanguage',
    'vertexLocation',
    'vertexModel',
    'vertexProjectId',
    'deeplApiKey',
    'geminiApiKey',
    'openaiApiKey',
    'openaiCompatibleApiKey',
    'vertexAccessToken',
];

describe('settings projections', () => {
    test('exports only the two surface projections', () => {
        expect(Object.keys(settingsProjections).sort()).toEqual([
            'OPTIONS_SETTINGS_KEYS',
            'POPUP_SETTINGS_KEYS',
        ]);
    });

    test.each([
        {
            name: 'Popup',
            projection: POPUP_SETTINGS_KEYS,
            expected: EXPECTED_POPUP_SETTINGS_KEYS,
        },
        {
            name: 'Options',
            projection: OPTIONS_SETTINGS_KEYS,
            expected: EXPECTED_OPTIONS_SETTINGS_KEYS,
        },
    ])(
        '$name has one frozen exact schema projection',
        ({ projection, expected }) => {
            expect(projection).toEqual(expected);
            expect(Object.isFrozen(projection)).toBe(true);
            expect(new Set(projection).size).toBe(projection.length);
            expect(
                projection.every((key) => Object.hasOwn(configSchema, key))
            ).toBe(true);
        }
    );

    test('Popup excludes every sensitive schema key', () => {
        expect(POPUP_SETTINGS_KEYS).toHaveLength(13);
        expect(
            POPUP_SETTINGS_KEYS.filter((key) => configSchema[key].sensitive)
        ).toEqual([]);
    });

    test('Options explicitly includes every sensitive schema key', () => {
        const schemaSensitiveKeys = Object.keys(configSchema)
            .filter((key) => configSchema[key].sensitive)
            .sort();
        const projectedSensitiveKeys = OPTIONS_SETTINGS_KEYS.filter(
            (key) => configSchema[key].sensitive
        ).sort();

        expect(OPTIONS_SETTINGS_KEYS).toHaveLength(30);
        expect(projectedSensitiveKeys).toHaveLength(5);
        expect(projectedSensitiveKeys).toEqual(schemaSensitiveKeys);
    });
});
