import { describe, expect, test } from '@jest/globals';
import {
    configSchema,
    getStorageScope,
    validateSetting,
} from '../config/configSchema.js';

describe('Configuration schema integration', () => {
    test('defines and validates every AI context setting used by the UI', () => {
        const requiredSettings = {
            aiContextEnabled: Boolean,
            aiContextProvider: String,
            aiContextTypes: Array,
            openaiApiKey: String,
            geminiApiKey: String,
            aiContextTimeout: Number,
        };

        for (const [key, type] of Object.entries(requiredSettings)) {
            expect(configSchema[key]).toMatchObject({ type });
            expect(validateSetting(key, configSchema[key].defaultValue)).toBe(
                true
            );
        }
    });

    test('keeps every sensitive credential in device-local storage', () => {
        const sensitiveSettings = Object.entries(configSchema).filter(
            ([, entry]) => entry.sensitive
        );

        expect(sensitiveSettings.length).toBeGreaterThan(0);
        for (const [key, entry] of sensitiveSettings) {
            expect(entry.type).toBe(String);
            expect(getStorageScope(key)).toBe('local');
        }
    });

    test('validates representative option values against their real schema', () => {
        expect(validateSetting('aiContextEnabled', true)).toBe(true);
        expect(validateSetting('aiContextEnabled', 'true')).toBe(false);

        expect(validateSetting('aiContextProvider', 'gemini')).toBe(true);
        expect(validateSetting('aiContextProvider', null)).toBe(false);

        expect(
            validateSetting('aiContextTypes', ['cultural', 'historical'])
        ).toBe(true);
        expect(validateSetting('aiContextTypes', { cultural: true })).toBe(
            false
        );

        expect(validateSetting('aiContextTimeout', 30_000)).toBe(true);
        expect(
            validateSetting('aiContextTimeout', Number.POSITIVE_INFINITY)
        ).toBe(false);
        expect(validateSetting('missingSetting', true)).toBe(false);
    });

    test('has valid defaults for every setting', () => {
        for (const [key, entry] of Object.entries(configSchema)) {
            expect(validateSetting(key, entry.defaultValue)).toBe(true);
            expect(['sync', 'local']).toContain(entry.scope);
        }
    });
});
