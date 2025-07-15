import { describe, it, expect } from '@jest/globals';
import { 
    configSchema, 
    getKeysByScope, 
    validateSetting, 
    getDefaultValue, 
    getStorageScope 
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
            expect(localKeys).toEqual(expect.arrayContaining(['debugMode', 'appearanceAccordionOpen']));
            
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

    describe('existing schema integrity', () => {
        it('should maintain all existing settings', () => {
            const expectedSettings = [
                'uiLanguage',
                'hideOfficialSubtitles',
                'selectedProvider',
                'translationBatchSize',
                'translationDelay',
                'deeplApiKey',
                'deeplApiPlan',
                'subtitlesEnabled',
                'useNativeSubtitles',
                'targetLanguage',
                'originalLanguage',
                'subtitleTimeOffset',
                'subtitleLayoutOrder',
                'subtitleLayoutOrientation',
                'subtitleFontSize',
                'subtitleGap',
                'appearanceAccordionOpen',
                'debugMode'
            ];
            
            const actualSettings = Object.keys(configSchema);
            expect(actualSettings).toEqual(expect.arrayContaining(expectedSettings));
            expect(actualSettings.length).toBe(expectedSettings.length);
        });

        it('should have correct scope distribution', () => {
            const localKeys = getKeysByScope('local');
            const syncKeys = getKeysByScope('sync');
            
            // Local scope should contain UI state and debug settings
            expect(localKeys).toEqual(expect.arrayContaining(['appearanceAccordionOpen', 'debugMode']));
            expect(localKeys.length).toBe(2);
            
            // Sync scope should contain all other settings
            expect(syncKeys.length).toBeGreaterThan(10);
            expect(syncKeys).toContain('uiLanguage');
            expect(syncKeys).toContain('subtitlesEnabled');
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