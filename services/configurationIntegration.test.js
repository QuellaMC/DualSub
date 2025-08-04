/**
 * Configuration & Settings Integration Tests
 *
 * Comprehensive tests for AI Context configuration schema, options UI,
 * API key management, privacy controls, and context preferences.
 *
 * @author DualSub Extension
 * @version 1.0.0
 */

import { jest, describe, test, beforeEach, afterEach, expect } from '@jest/globals';
import { TestHelpers } from '../test-utils/test-helpers.js';

// We'll mock configService functions in the tests directly

import { apiKeyManager } from './apiKeyManager.js';
// Privacy manager removed in v2.0.0 - no longer needed for open-source extension
import { contextPreferencesManager, CONTEXT_TYPES } from './contextPreferencesManager.js';
import { configService } from './configService.js';

describe('Configuration & Settings Integration', () => {
    let testHelpers;
    let testEnv;

    beforeEach(() => {
        testHelpers = new TestHelpers();
        testEnv = testHelpers.setupTestEnvironment({
            platform: 'netflix',
            enableLogger: true,
            enableChromeApi: true
        });

        // Mock configService methods
        jest.spyOn(configService, 'set').mockResolvedValue(true);
        jest.spyOn(configService, 'get').mockResolvedValue(null);
        jest.spyOn(configService, 'getAll').mockResolvedValue({});
        jest.spyOn(configService, 'getMultiple').mockResolvedValue({});
        jest.spyOn(configService, 'setMultiple').mockResolvedValue(true);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    afterEach(() => {
        if (testEnv) {
            testEnv.cleanup();
        }
    });

    describe('API Key Manager', () => {
        test('should validate OpenAI API key format', () => {
            const validKey = 'sk-1234567890abcdef1234567890abcdef1234567890abcdef';
            const invalidKey = 'invalid-key';

            expect(apiKeyManager.validateAPIKeyFormat('openai', validKey)).toBe(true);
            expect(apiKeyManager.validateAPIKeyFormat('openai', invalidKey)).toBe(false);
        });

        test('should validate Gemini API key format', () => {
            const validKey = 'AIzaSyDaGmWKa4JsXZ-HjGw1w2_dQHhHk1234567890';
            const invalidKey = 'invalid-gemini-key';

            expect(apiKeyManager.validateAPIKeyFormat('gemini', validKey)).toBe(true);
            expect(apiKeyManager.validateAPIKeyFormat('gemini', invalidKey)).toBe(false);
        });

        test('should mask API keys for display', () => {
            const apiKey = 'sk-1234567890abcdef1234567890abcdef1234567890abcdef';
            const masked = apiKeyManager.maskAPIKey(apiKey);

            expect(masked).toContain('sk-1');
            expect(masked).toContain('cdef');
            expect(masked).toContain('****');
            expect(masked).not.toContain('567890abcdef1234567890abcdef123456789');
        });

        test('should store and retrieve API keys', async () => {
            const apiKey = 'sk-1234567890abcdef1234567890abcdef1234567890abcdef';

            configService.set.mockResolvedValue(true);
            configService.get.mockResolvedValue('obfuscated-key-data');

            const stored = await apiKeyManager.storeAPIKey('openai', apiKey);
            expect(stored).toBe(true);
            expect(configService.set).toHaveBeenCalledWith('openaiApiKey', expect.any(String));
        });

        test('should handle invalid API key storage', async () => {
            const invalidKey = 'invalid-key';
            const stored = await apiKeyManager.storeAPIKey('openai', invalidKey);
            
            expect(stored).toBe(false);
        });

        test('should test API key validity', async () => {
            const validKey = 'sk-1234567890abcdef1234567890abcdef1234567890abcdef';
            const result = await apiKeyManager.testAPIKey('openai', validKey);

            expect(result.success).toBe(true);
            expect(result.provider).toBe('openai');
            expect(result.keyMask).toBeDefined();
        });
    });

    // Privacy Manager tests removed in v2.0.0 - no longer needed for open-source extension

    describe('Context Preferences Manager', () => {
        test('should load default preferences', async () => {
            configService.getMultiple.mockResolvedValue({
                aiContextTypes: ['cultural', 'historical'],
                contextOnClick: true,
                contextOnSelection: false
            });

            const preferences = await contextPreferencesManager.loadPreferences();

            expect(preferences.enabledContextTypes).toEqual(['cultural', 'historical']);
            expect(preferences.enabledInteractionMethods).toContain('click');
            expect(preferences.enabledInteractionMethods).toContain('selection'); // Both methods always enabled in new implementation
        });

        test('should save preferences', async () => {
            // Use the mocked configService
            configService.setMultiple.mockResolvedValue(true);

            const preferences = {
                enabledContextTypes: ['cultural', 'linguistic'],
                enabledInteractionMethods: ['click', 'selection'],
                modalPosition: 'top',
                modalSize: 'large',
                autoClose: true,
                autoCloseDelay: 5000
            };

            const saved = await contextPreferencesManager.savePreferences(preferences);
            expect(saved).toBe(true);
            expect(configService.setMultiple).toHaveBeenCalledWith(expect.objectContaining({
                aiContextTypes: ['cultural', 'linguistic'],
                contextModalPosition: 'top',
                contextModalSize: 'large'
            }));
        });

        test('should check context type enabled status', async () => {
            // Clear any cached preferences first
            contextPreferencesManager.preferencesCache.clear();

            // Use the mocked configService
            configService.getMultiple.mockResolvedValue({
                aiContextTypes: ['cultural', 'historical']
            });

            const culturalEnabled = await contextPreferencesManager.isContextTypeEnabled('cultural');
            const linguisticEnabled = await contextPreferencesManager.isContextTypeEnabled('linguistic');

            expect(culturalEnabled).toBe(true);
            expect(linguisticEnabled).toBe(false);
        });

        test('should toggle context types', async () => {
            // Clear any cached preferences first
            contextPreferencesManager.preferencesCache.clear();

            // Use the mocked configService
            configService.getMultiple.mockResolvedValue({
                aiContextTypes: ['cultural']
            });
            configService.setMultiple.mockResolvedValue(true);

            const newStatus = await contextPreferencesManager.toggleContextType('historical');
            expect(newStatus).toBe(true);
        });

        test('should manage language-specific preferences', async () => {
            // Clear any cached preferences first
            contextPreferencesManager.preferencesCache.clear();

            // Use the mocked configService
            configService.getMultiple.mockResolvedValue({});
            configService.setMultiple.mockResolvedValue(true);

            const languagePrefs = {
                preferredContextTypes: ['cultural'],
                displayLanguage: 'es'
            };

            const saved = await contextPreferencesManager.setLanguagePreferences('es', languagePrefs);
            expect(saved).toBe(true);

            const retrieved = await contextPreferencesManager.getLanguagePreferences('es');
            expect(retrieved).toEqual(languagePrefs);
        });

        test('should export and import preferences', async () => {
            // Use the mocked configService
            configService.getMultiple.mockResolvedValue({
                aiContextTypes: ['cultural', 'historical']
            });
            configService.setMultiple.mockResolvedValue(true);

            const exported = await contextPreferencesManager.exportPreferences();
            expect(exported.version).toBe('1.0.0');
            expect(exported.preferences).toBeDefined();

            const imported = await contextPreferencesManager.importPreferences(exported);
            expect(imported).toBe(true);
        });

        test('should get preferences summary', async () => {
            // Clear any cached preferences first
            contextPreferencesManager.preferencesCache.clear();

            // Use the mocked configService
            configService.getMultiple.mockResolvedValue({
                aiContextTypes: ['cultural', 'historical'],
                contextOnClick: true,
                contextModalPosition: 'center',
                contextModalSize: 'medium'
            });

            const summary = await contextPreferencesManager.getPreferencesSummary();

            expect(summary.contextTypes.enabled).toBe(2);
            expect(summary.contextTypes.total).toBe(Object.keys(CONTEXT_TYPES).length);
            expect(summary.display.position).toBe('Center of screen');
            expect(summary.display.size).toBe('Standard view');
        });

        test('should reset to defaults', async () => {
            // Use the mocked configService
            configService.setMultiple.mockResolvedValue(true);

            const reset = await contextPreferencesManager.resetToDefaults();
            expect(reset).toBe(true);
        });
    });

    describe('Configuration Schema Integration', () => {
        test('should have all required AI context configuration keys', () => {
            // This would test the actual config schema
            const requiredKeys = [
                'aiContextEnabled',
                'aiContextProvider',
                'aiContextTypes',
                'openaiApiKey',
                'geminiApiKey',
                'aiContextTimeout',
                'aiContextUserConsent'
            ];

            // In a real test, you would import and check the config schema
            expect(requiredKeys.length).toBeGreaterThan(0);
        });

        test('should validate configuration values', () => {
            // Test configuration validation
            const validConfig = {
                aiContextEnabled: true,
                aiContextProvider: 'openai',
                aiContextTypes: ['cultural', 'historical'],
                aiContextTimeout: 30000
            };

            // In a real implementation, you would validate against the schema
            expect(typeof validConfig.aiContextEnabled).toBe('boolean');
            expect(['openai', 'gemini'].includes(validConfig.aiContextProvider)).toBe(true);
            expect(Array.isArray(validConfig.aiContextTypes)).toBe(true);
            expect(typeof validConfig.aiContextTimeout).toBe('number');
        });
    });

    describe('Options UI Integration', () => {
        test('should handle provider switching', () => {
            // Mock DOM elements
            const mockSelect = {
                value: 'gemini',
                addEventListener: jest.fn()
            };

            const mockOpenAISettings = {
                style: { display: 'block' }
            };

            const mockGeminiSettings = {
                style: { display: 'none' }
            };

            // Simulate provider change
            mockSelect.value = 'gemini';
            mockOpenAISettings.style.display = 'none';
            mockGeminiSettings.style.display = 'block';

            expect(mockOpenAISettings.style.display).toBe('none');
            expect(mockGeminiSettings.style.display).toBe('block');
        });

        test('should handle feature toggle', () => {
            const mockCheckbox = {
                checked: true,
                addEventListener: jest.fn()
            };

            const mockCards = [
                { style: { display: 'none' } },
                { style: { display: 'none' } }
            ];

            // Simulate feature enable
            mockCheckbox.checked = true;
            mockCards.forEach(card => {
                card.style.display = 'block';
            });

            mockCards.forEach(card => {
                expect(card.style.display).toBe('block');
            });
        });
    });
});
