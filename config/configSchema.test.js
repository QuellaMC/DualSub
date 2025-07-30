import { describe, it, expect } from '@jest/globals';
import {
    configSchema,
    getKeysByScope,
    validateSetting,
    getDefaultValue,
    getStorageScope,
} from './configSchema.js';

describe('configSchema', () => {
    describe('debugMode setting', () => {
        it('should have debugMode setting with correct properties', () => {
            expect(configSchema.debugMode).toBeDefined();
            expect(configSchema.debugMode.defaultValue).toBe(false);
            expect(configSchema.debugMode.type).toBe(Boolean);
            expect(configSchema.debugMode.scope).toBe('local');
        });

        it('should include debugMode in local scope keys', () => {
            const localKeys = getKeysByScope('local');
            expect(localKeys).toContain('debugMode');
        });

        it('should not include debugMode in sync scope keys', () => {
            const syncKeys = getKeysByScope('sync');
            expect(syncKeys).not.toContain('debugMode');
        });

        it('should validate debugMode boolean values correctly', () => {
            expect(validateSetting('debugMode', true)).toBe(true);
            expect(validateSetting('debugMode', false)).toBe(true);
            expect(validateSetting('debugMode', 'true')).toBe(false);
            expect(validateSetting('debugMode', 1)).toBe(false);
            expect(validateSetting('debugMode', null)).toBe(false);
            expect(validateSetting('debugMode', undefined)).toBe(false);
        });

        it('should return correct default value for debugMode', () => {
            expect(getDefaultValue('debugMode')).toBe(false);
        });

        it('should return correct storage scope for debugMode', () => {
            expect(getStorageScope('debugMode')).toBe('local');
        });
    });

    describe('schema helper functions with debugMode', () => {
        it('should handle debugMode in getKeysByScope', () => {
            const localKeys = getKeysByScope('local');
            expect(localKeys).toEqual(
                expect.arrayContaining(['debugMode', 'appearanceAccordionOpen'])
            );

            const syncKeys = getKeysByScope('sync');
            expect(syncKeys).not.toContain('debugMode');
            expect(syncKeys.length).toBeGreaterThan(0); // Should contain other sync settings
        });

        it('should validate debugMode setting correctly', () => {
            // Valid boolean values
            expect(validateSetting('debugMode', true)).toBe(true);
            expect(validateSetting('debugMode', false)).toBe(true);

            // Invalid values
            expect(validateSetting('debugMode', 'false')).toBe(false);
            expect(validateSetting('debugMode', 0)).toBe(false);
            expect(validateSetting('debugMode', 1)).toBe(false);
            expect(validateSetting('debugMode', [])).toBe(false);
            expect(validateSetting('debugMode', {})).toBe(false);
        });

        it('should return undefined for non-existent keys', () => {
            expect(getDefaultValue('nonExistentKey')).toBeUndefined();
            expect(getStorageScope('nonExistentKey')).toBeUndefined();
            expect(validateSetting('nonExistentKey', true)).toBe(false);
        });
    });

    describe('loggingLevel setting', () => {
        it('should have loggingLevel setting with correct properties', () => {
            expect(configSchema.loggingLevel).toBeDefined();
            expect(configSchema.loggingLevel.defaultValue).toBe(3);
            expect(configSchema.loggingLevel.type).toBe(Number);
            expect(configSchema.loggingLevel.scope).toBe('sync');
        });

        it('should include loggingLevel in sync scope keys', () => {
            const syncKeys = getKeysByScope('sync');
            expect(syncKeys).toContain('loggingLevel');
        });

        it('should not include loggingLevel in local scope keys', () => {
            const localKeys = getKeysByScope('local');
            expect(localKeys).not.toContain('loggingLevel');
        });

        it('should validate loggingLevel numeric values correctly', () => {
            // Valid logging levels (0-4)
            expect(validateSetting('loggingLevel', 0)).toBe(true); // OFF
            expect(validateSetting('loggingLevel', 1)).toBe(true); // ERROR
            expect(validateSetting('loggingLevel', 2)).toBe(true); // WARN
            expect(validateSetting('loggingLevel', 3)).toBe(true); // INFO
            expect(validateSetting('loggingLevel', 4)).toBe(true); // DEBUG

            // Invalid values - out of range
            expect(validateSetting('loggingLevel', -1)).toBe(false);
            expect(validateSetting('loggingLevel', 5)).toBe(false);
            expect(validateSetting('loggingLevel', 10)).toBe(false);

            // Invalid values - wrong type
            expect(validateSetting('loggingLevel', '3')).toBe(false);
            expect(validateSetting('loggingLevel', true)).toBe(false);
            expect(validateSetting('loggingLevel', null)).toBe(false);
            expect(validateSetting('loggingLevel', undefined)).toBe(false);
            expect(validateSetting('loggingLevel', [])).toBe(false);
            expect(validateSetting('loggingLevel', {})).toBe(false);

            // Invalid values - non-integer numbers
            expect(validateSetting('loggingLevel', 3.5)).toBe(false);
            expect(validateSetting('loggingLevel', 2.1)).toBe(false);
            expect(validateSetting('loggingLevel', NaN)).toBe(false);
            expect(validateSetting('loggingLevel', Infinity)).toBe(false);
        });

        it('should return correct default value for loggingLevel', () => {
            expect(getDefaultValue('loggingLevel')).toBe(3);
        });

        it('should return correct storage scope for loggingLevel', () => {
            expect(getStorageScope('loggingLevel')).toBe('sync');
        });
    });

    describe('existing schema integrity', () => {
        it('should maintain all existing settings', () => {
            const expectedSettings = [
                'uiLanguage',
                'hideOfficialSubtitles',
                'selectedProvider',
                'translationBatchSize',
                'translationDelay',
                'maxConcurrentBatches',
                'smartBatching',
                'batchProcessingDelay',
                'globalBatchSize',
                'batchingEnabled',
                'useProviderDefaults',
                // Provider-specific batch sizes
                'openaieBatchSize',
                'googleBatchSize',
                'deeplBatchSize',
                'microsoftBatchSize',
                // Provider-specific delay settings
                'openaieDelay',
                'googleDelay',
                'deeplDelay',
                'deeplFreeDelay',
                'microsoftDelay',
                'deeplApiKey',
                'deeplApiPlan',
                'openaiCompatibleApiKey',
                'openaiCompatibleBaseUrl',
                'openaiCompatibleModel',
                'subtitlesEnabled',
                'useNativeSubtitles',
                'useOfficialTranslations',
                'targetLanguage',
                'originalLanguage',
                'subtitleTimeOffset',
                'subtitleLayoutOrder',
                'subtitleLayoutOrientation',
                'subtitleFontSize',
                'subtitleGap',
                'appearanceAccordionOpen',
                'debugMode',
                'loggingLevel',
            ];

            const actualSettings = Object.keys(configSchema);
            expect(actualSettings).toEqual(
                expect.arrayContaining(expectedSettings)
            );
            expect(actualSettings.length).toBe(expectedSettings.length);
        });

        it('should have correct scope distribution', () => {
            const localKeys = getKeysByScope('local');
            const syncKeys = getKeysByScope('sync');

            // Local scope should contain UI state and debug settings
            expect(localKeys).toEqual(
                expect.arrayContaining(['appearanceAccordionOpen', 'debugMode'])
            );
            expect(localKeys.length).toBe(2);

            // Sync scope should contain all other settings including loggingLevel and OpenAI settings
            expect(syncKeys.length).toBeGreaterThan(10);
            expect(syncKeys).toContain('uiLanguage');
            expect(syncKeys).toContain('subtitlesEnabled');
            expect(syncKeys).toContain('loggingLevel');
            expect(syncKeys).toContain('openaiCompatibleApiKey');
            expect(syncKeys).toContain('openaiCompatibleBaseUrl');
            expect(syncKeys).toContain('openaiCompatibleModel');
        });
    });

    describe('type validation', () => {
        it('should validate different data types correctly', () => {
            // String validation
            expect(validateSetting('uiLanguage', 'en')).toBe(true);
            expect(validateSetting('uiLanguage', 123)).toBe(false);

            // Number validation
            expect(validateSetting('translationBatchSize', 3)).toBe(true);
            expect(validateSetting('translationBatchSize', '3')).toBe(false);
            expect(validateSetting('translationBatchSize', NaN)).toBe(false);

            // Boolean validation
            expect(validateSetting('subtitlesEnabled', true)).toBe(true);
            expect(validateSetting('subtitlesEnabled', 'true')).toBe(false);
            expect(validateSetting('debugMode', false)).toBe(true);
            expect(validateSetting('debugMode', 0)).toBe(false);
        });
    });
});
