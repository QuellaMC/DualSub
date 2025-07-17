/**
 * @jest-environment jsdom
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import Logger from '../utils/logger.js';

// Mock the configService
const mockConfigService = {
    get: jest.fn(),
    set: jest.fn(),
    getAll: jest.fn(),
    getMultiple: jest.fn(),
    onChanged: jest.fn(),
};

// Mock chrome APIs
global.chrome = {
    runtime: {
        getURL: jest.fn((path) => `chrome-extension://test/${path}`),
        getManifest: jest.fn(() => ({ version: '1.0.0' })),
    },
    tabs: {
        create: jest.fn(),
    },
};

// Mock fetch for translations
global.fetch = jest.fn();

// Mock DeepL API
global.window = {
    DeepLAPI: {
        testDeepLConnection: jest.fn(),
    },
};

describe('Options Logging Integration', () => {
    let optionsLogger;
    let consoleSpy;

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();
        
        // Create logger instance
        optionsLogger = Logger.create('Options', mockConfigService);
        
        // Spy on console methods
        consoleSpy = {
            debug: jest.spyOn(console, 'debug').mockImplementation(),
            info: jest.spyOn(console, 'info').mockImplementation(),
            warn: jest.spyOn(console, 'warn').mockImplementation(),
            error: jest.spyOn(console, 'error').mockImplementation(),
        };

        // Mock DOM
        document.body.innerHTML = `
            <nav>
                <a href="#general" class="active">General</a>
                <a href="#translation">Translation</a>
                <a href="#providers">Providers</a>
                <a href="#about">About</a>
            </nav>
            <section id="general">
                <select id="uiLanguage"></select>
                <input id="hideOfficialSubtitles" type="checkbox">
                <select id="loggingLevel"></select>
            </section>
            <section id="translation" class="hidden">
                <select id="translationProvider"></select>
                <input id="translationBatchSize" type="range">
                <span id="translationBatchSizeValue"></span>
                <input id="translationDelay" type="range">
                <span id="translationDelayValue"></span>
            </section>
            <section id="providers" class="hidden">
                <div id="googleProviderCard"></div>
                <div id="microsoftProviderCard"></div>
                <div id="deeplProviderCard">
                    <input id="deeplApiKey" type="password">
                    <select id="deeplApiPlan"></select>
                    <button id="testDeepLButton">Test</button>
                    <div id="deeplTestResult"></div>
                </div>
                <div id="deeplFreeProviderCard"></div>
            </section>
            <section id="about" class="hidden">
                <span id="extensionVersion"></span>
            </section>
        `;
    });

    afterEach(() => {
        // Restore console methods
        Object.values(consoleSpy).forEach(spy => spy.mockRestore());
    });

    describe('Logger Initialization', () => {
        test('should create logger with correct component name', () => {
            expect(optionsLogger.component).toBe('Options');
            expect(optionsLogger.configService).toBe(mockConfigService);
        });

        test('should initialize with INFO level by default', () => {
            expect(optionsLogger.currentLevel).toBe(Logger.LEVELS.INFO);
        });

        test('should update logging level from config', async () => {
            mockConfigService.get.mockResolvedValue(Logger.LEVELS.DEBUG);
            
            await optionsLogger.updateLevel();
            
            expect(mockConfigService.get).toHaveBeenCalledWith('loggingLevel');
            expect(optionsLogger.currentLevel).toBe(Logger.LEVELS.DEBUG);
        });

        test('should fallback to INFO level if config fails', async () => {
            mockConfigService.get.mockRejectedValue(new Error('Config error'));
            
            await optionsLogger.updateLevel();
            
            expect(optionsLogger.currentLevel).toBe(Logger.LEVELS.INFO);
        });
    });

    describe('Logging Level Synchronization', () => {
        test('should listen for logging level changes', () => {
            const changeHandler = jest.fn();
            mockConfigService.onChanged.mockImplementation(changeHandler);
            
            // Simulate the options initialization
            mockConfigService.onChanged((changes) => {
                if ('loggingLevel' in changes) {
                    optionsLogger.updateLevel(changes.loggingLevel);
                }
            });

            expect(mockConfigService.onChanged).toHaveBeenCalled();
        });

        test('should update logger when logging level changes', async () => {
            optionsLogger.updateLevel(Logger.LEVELS.WARN);
            
            expect(optionsLogger.currentLevel).toBe(Logger.LEVELS.WARN);
        });
    });

    describe('Settings Save Logging', () => {
        beforeEach(() => {
            optionsLogger.updateLevel(Logger.LEVELS.INFO);
            mockConfigService.set.mockResolvedValue();
        });

        test('should log successful setting saves', async () => {
            // Simulate saveSetting function
            const saveSetting = async (key, value) => {
                try {
                    await mockConfigService.set(key, value);
                    optionsLogger.info(`${key} saved`, { key, value, component: 'saveSetting' });
                } catch (error) {
                    optionsLogger.error(`Error saving ${key}`, error, { key, value, component: 'saveSetting' });
                }
            };

            await saveSetting('uiLanguage', 'es');
            
            expect(consoleSpy.info).toHaveBeenCalledWith(
                expect.stringContaining('[INFO] [Options] uiLanguage saved')
            );
            expect(consoleSpy.info).toHaveBeenCalledWith(
                expect.stringContaining('"key":"uiLanguage"')
            );
            expect(consoleSpy.info).toHaveBeenCalledWith(
                expect.stringContaining('"value":"es"')
            );
        });

        test('should log setting save errors', async () => {
            mockConfigService.set.mockRejectedValue(new Error('Storage quota exceeded'));
            
            // Simulate saveSetting function
            const saveSetting = async (key, value) => {
                try {
                    await mockConfigService.set(key, value);
                    optionsLogger.info(`${key} saved`, { key, value, component: 'saveSetting' });
                } catch (error) {
                    optionsLogger.error(`Error saving ${key}`, error, { key, value, component: 'saveSetting' });
                }
            };

            await saveSetting('loggingLevel', 4);
            
            expect(consoleSpy.error).toHaveBeenCalledWith(
                expect.stringContaining('[ERROR] [Options] Error saving loggingLevel')
            );
            expect(consoleSpy.error).toHaveBeenCalledWith(
                expect.stringContaining('Storage quota exceeded')
            );
        });
    });

    describe('Translation Loading Logging', () => {
        beforeEach(() => {
            optionsLogger.updateLevel(Logger.LEVELS.DEBUG);
        });

        test('should log translation loading errors', () => {
            const error = new Error('Network error');
            
            optionsLogger.error('Error fetching primary language es_ES', error, {
                normalizedLangCode: 'es_ES',
                component: 'loadTranslations'
            });
            
            expect(consoleSpy.error).toHaveBeenCalledWith(
                expect.stringContaining('[ERROR] [Options] Error fetching primary language es_ES')
            );
            expect(consoleSpy.error).toHaveBeenCalledWith(
                expect.stringContaining('"normalizedLangCode":"es_ES"')
            );
        });

        test('should log fatal translation loading errors', () => {
            const error = new Error('All translation sources failed');
            
            optionsLogger.error('Fatal: Failed to load any translations', error, {
                component: 'loadTranslations'
            });
            
            expect(consoleSpy.error).toHaveBeenCalledWith(
                expect.stringContaining('[ERROR] [Options] Fatal: Failed to load any translations')
            );
        });
    });

    describe('DeepL API Testing Logging', () => {
        beforeEach(() => {
            optionsLogger.updateLevel(Logger.LEVELS.DEBUG);
        });

        test('should log DeepL test errors with redacted API key', () => {
            const error = new Error('API connection failed');
            
            optionsLogger.error('DeepL test error', error, {
                apiKey: '[REDACTED]',
                apiPlan: 'free',
                component: 'testDeepLConnection'
            });
            
            expect(consoleSpy.error).toHaveBeenCalledWith(
                expect.stringContaining('[ERROR] [Options] DeepL test error')
            );
            expect(consoleSpy.error).toHaveBeenCalledWith(
                expect.stringContaining('"apiKey":"[REDACTED]"')
            );
            expect(consoleSpy.error).toHaveBeenCalledWith(
                expect.stringContaining('"apiPlan":"free"')
            );
        });

        test('should log DeepL API unavailability', () => {
            optionsLogger.error('DeepLAPI is not available. Disabling testDeepLButton.', null, {
                component: 'testDeepLButton'
            });
            
            expect(consoleSpy.error).toHaveBeenCalledWith(
                expect.stringContaining('[ERROR] [Options] DeepLAPI is not available')
            );
        });
    });

    describe('Configuration Change Logging', () => {
        beforeEach(() => {
            optionsLogger.updateLevel(Logger.LEVELS.INFO);
        });

        test('should log UI language changes', () => {
            optionsLogger.info('UI language changed to: es', {
                selectedLang: 'es',
                component: 'uiLanguageSelect'
            });
            
            expect(consoleSpy.info).toHaveBeenCalledWith(
                expect.stringContaining('[INFO] [Options] UI language changed to: es')
            );
            expect(consoleSpy.info).toHaveBeenCalledWith(
                expect.stringContaining('"selectedLang":"es"')
            );
        });

        test('should log hide official subtitles changes', () => {
            optionsLogger.info('Hide official subtitles changed to: true', {
                hideOfficialSubtitles: true,
                component: 'hideOfficialSubtitlesCheckbox'
            });
            
            expect(consoleSpy.info).toHaveBeenCalledWith(
                expect.stringContaining('[INFO] [Options] Hide official subtitles changed to: true')
            );
        });

        test('should log logging level changes', () => {
            optionsLogger.info('Logging level changed to: 4', {
                level: 4,
                component: 'loggingLevelSelect'
            });
            
            expect(consoleSpy.info).toHaveBeenCalledWith(
                expect.stringContaining('[INFO] [Options] Logging level changed to: 4')
            );
        });

        test('should log translation provider changes', () => {
            optionsLogger.info('Translation provider changed to: deepl', {
                selectedProvider: 'deepl',
                component: 'translationProviderSelect'
            });
            
            expect(consoleSpy.info).toHaveBeenCalledWith(
                expect.stringContaining('[INFO] [Options] Translation provider changed to: deepl')
            );
        });
    });

    describe('Settings Loading Logging', () => {
        test('should log settings loading errors', () => {
            const error = new Error('Storage access denied');
            
            optionsLogger.error('Error loading settings', error, {
                component: 'loadSettings'
            });
            
            expect(consoleSpy.error).toHaveBeenCalledWith(
                expect.stringContaining('[ERROR] [Options] Error loading settings')
            );
            expect(consoleSpy.error).toHaveBeenCalledWith(
                expect.stringContaining('Storage access denied')
            );
        });
    });

    describe('Logging Level Filtering', () => {
        test('should not log debug messages when level is INFO', () => {
            optionsLogger.updateLevel(Logger.LEVELS.INFO);
            
            optionsLogger.debug('Debug message', { test: true });
            
            expect(consoleSpy.debug).not.toHaveBeenCalled();
        });

        test('should log error messages when level is ERROR', () => {
            optionsLogger.updateLevel(Logger.LEVELS.ERROR);
            
            optionsLogger.error('Error message', null, { test: true });
            
            expect(consoleSpy.error).toHaveBeenCalled();
        });

        test('should not log any messages when level is OFF', () => {
            optionsLogger.updateLevel(Logger.LEVELS.OFF);
            
            optionsLogger.error('Error message');
            optionsLogger.warn('Warning message');
            optionsLogger.info('Info message');
            optionsLogger.debug('Debug message');
            
            expect(consoleSpy.error).not.toHaveBeenCalled();
            expect(consoleSpy.warn).not.toHaveBeenCalled();
            expect(consoleSpy.info).not.toHaveBeenCalled();
            expect(consoleSpy.debug).not.toHaveBeenCalled();
        });
    });

    describe('Component Naming', () => {
        test('should use consistent component names in log messages', () => {
            optionsLogger.info('Test message');
            
            expect(consoleSpy.info).toHaveBeenCalledWith(
                expect.stringContaining('[Options]')
            );
        });

        test('should include sub-component context in structured data', () => {
            optionsLogger.error('Provider error', null, { 
                component: 'translationProviderSelect',
                selectedProvider: 'google' 
            });
            
            expect(consoleSpy.error).toHaveBeenCalledWith(
                expect.stringContaining('"component":"translationProviderSelect"')
            );
        });
    });
});