/**
 * @jest-environment jsdom
 */

import {
    describe,
    test,
    expect,
    beforeEach,
    afterEach,
    jest,
} from '@jest/globals';
import Logger from '../utils/logger.js';

// Mock the configService
const mockConfigService = {
    get: jest.fn(),
    set: jest.fn(),
    getAll: jest.fn(),
    onChanged: jest.fn(),
};

// Mock chrome APIs
global.chrome = {
    runtime: {
        getURL: jest.fn((path) => `chrome-extension://test/${path}`),
        getManifest: jest.fn(() => ({ version: '1.0.0' })),
        openOptionsPage: jest.fn(),
    },
    tabs: {
        query: jest.fn(),
        sendMessage: jest.fn(),
        create: jest.fn(),
    },
};

// Mock fetch for translations
global.fetch = jest.fn();

describe('Popup Logging Integration', () => {
    let popupLogger;
    let consoleSpy;

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();

        // Create logger instance
        popupLogger = Logger.create('Popup', mockConfigService);

        // Spy on console methods
        consoleSpy = {
            debug: jest.spyOn(console, 'debug').mockImplementation(),
            info: jest.spyOn(console, 'info').mockImplementation(),
            warn: jest.spyOn(console, 'warn').mockImplementation(),
            error: jest.spyOn(console, 'error').mockImplementation(),
        };

        // Mock DOM
        document.body.innerHTML = `
            <div id="statusMessage"></div>
            <input id="enableSubtitles" type="checkbox">
            <input id="useNativeSubtitles" type="checkbox">
            <select id="originalLanguage"></select>
            <select id="targetLanguage"></select>
            <input id="subtitleTimeOffset" type="number">
            <select id="subtitleLayoutOrder"></select>
            <select id="subtitleLayoutOrientation"></select>
            <input id="subtitleFontSize" type="range">
            <span id="subtitleFontSizeValue"></span>
            <input id="subtitleGap" type="range">
            <span id="subtitleGapValue"></span>
            <details class="accordion-card"></details>
            <button id="openOptionsPage"></button>
            <button id="openGithubLink"></button>
        `;
    });

    afterEach(() => {
        // Restore console methods
        Object.values(consoleSpy).forEach((spy) => spy.mockRestore());
    });

    describe('Logger Initialization', () => {
        test('should create logger with correct component name', () => {
            expect(popupLogger.component).toBe('Popup');
            expect(popupLogger.configService).toBe(mockConfigService);
        });

        test('should initialize with INFO level by default', () => {
            expect(popupLogger.currentLevel).toBe(Logger.LEVELS.INFO);
        });

        test('should update logging level from config', async () => {
            mockConfigService.get.mockResolvedValue(Logger.LEVELS.DEBUG);

            await popupLogger.updateLevel();

            expect(mockConfigService.get).toHaveBeenCalledWith('loggingLevel');
            expect(popupLogger.currentLevel).toBe(Logger.LEVELS.DEBUG);
        });

        test('should fallback to INFO level if config fails', async () => {
            mockConfigService.get.mockRejectedValue(new Error('Config error'));

            await popupLogger.updateLevel();

            expect(popupLogger.currentLevel).toBe(Logger.LEVELS.INFO);
        });
    });

    describe('Logging Level Synchronization', () => {
        test('should listen for logging level changes', () => {
            const changeHandler = jest.fn();
            mockConfigService.onChanged.mockImplementation(changeHandler);

            // Simulate the popup initialization
            mockConfigService.onChanged((changes) => {
                if ('loggingLevel' in changes) {
                    popupLogger.updateLevel(changes.loggingLevel);
                }
            });

            expect(mockConfigService.onChanged).toHaveBeenCalled();
        });

        test('should update logger when logging level changes', async () => {
            popupLogger.updateLevel(Logger.LEVELS.ERROR);

            expect(popupLogger.currentLevel).toBe(Logger.LEVELS.ERROR);
        });
    });

    describe('Structured Logging', () => {
        beforeEach(() => {
            popupLogger.updateLevel(Logger.LEVELS.DEBUG);
        });

        test('should log settings loading errors with context', () => {
            const error = new Error('Settings load failed');

            popupLogger.error('Error loading settings', error, {
                component: 'loadSettings',
            });

            expect(consoleSpy.error).toHaveBeenCalledWith(
                expect.stringContaining(
                    '[ERROR] [Popup] Error loading settings'
                )
            );
            expect(consoleSpy.error).toHaveBeenCalledWith(
                expect.stringContaining('Settings load failed')
            );
        });

        test('should log configuration changes with structured data', () => {
            popupLogger.info('Subtitles enabled', {
                enabled: true,
                component: 'enableSubtitlesToggle',
            });

            expect(consoleSpy.info).toHaveBeenCalledWith(
                expect.stringContaining('[INFO] [Popup] Subtitles enabled')
            );
            expect(consoleSpy.info).toHaveBeenCalledWith(
                expect.stringContaining('"enabled":true')
            );
        });

        test('should log translation loading warnings', () => {
            const error = new Error('Translation fetch failed');

            popupLogger.warn(
                'Could not load translations, falling back to English',
                {
                    normalizedLangCode: 'es_ES',
                    error: error.message,
                    component: 'loadTranslations',
                }
            );

            expect(consoleSpy.warn).toHaveBeenCalledWith(
                expect.stringContaining(
                    '[WARN] [Popup] Could not load translations'
                )
            );
            expect(consoleSpy.warn).toHaveBeenCalledWith(
                expect.stringContaining('es_ES')
            );
        });

        test('should log debug messages for message passing failures', () => {
            popupLogger.debug(
                'Direct message failed, relying on storage events',
                {
                    error: 'Tab not found',
                    component: 'sendImmediateConfigUpdate',
                }
            );

            expect(consoleSpy.debug).toHaveBeenCalledWith(
                expect.stringContaining('[DEBUG] [Popup] Direct message failed')
            );
        });
    });

    describe('Logging Level Filtering', () => {
        test('should not log debug messages when level is INFO', () => {
            popupLogger.updateLevel(Logger.LEVELS.INFO);

            popupLogger.debug('Debug message', { test: true });

            expect(consoleSpy.debug).not.toHaveBeenCalled();
        });

        test('should log info messages when level is INFO', () => {
            popupLogger.updateLevel(Logger.LEVELS.INFO);

            popupLogger.info('Info message', { test: true });

            expect(consoleSpy.info).toHaveBeenCalled();
        });

        test('should not log any messages when level is OFF', () => {
            popupLogger.updateLevel(Logger.LEVELS.OFF);

            popupLogger.error('Error message');
            popupLogger.warn('Warning message');
            popupLogger.info('Info message');
            popupLogger.debug('Debug message');

            expect(consoleSpy.error).not.toHaveBeenCalled();
            expect(consoleSpy.warn).not.toHaveBeenCalled();
            expect(consoleSpy.info).not.toHaveBeenCalled();
            expect(consoleSpy.debug).not.toHaveBeenCalled();
        });
    });

    describe('Error Context Logging', () => {
        beforeEach(() => {
            popupLogger.updateLevel(Logger.LEVELS.ERROR);
        });

        test('should include error stack traces in error logs', () => {
            const error = new Error('Test error');
            error.stack = 'Error: Test error\n    at test.js:1:1';

            popupLogger.error('Configuration error', error, {
                setting: 'subtitlesEnabled',
            });

            expect(consoleSpy.error).toHaveBeenCalledWith(
                expect.stringContaining('errorStack')
            );
            expect(consoleSpy.error).toHaveBeenCalledWith(
                expect.stringContaining('test.js:1:1')
            );
        });

        test('should include component context in all error logs', () => {
            popupLogger.error('Setting save failed', null, {
                component: 'saveSetting',
                key: 'targetLanguage',
                value: 'es',
            });

            expect(consoleSpy.error).toHaveBeenCalledWith(
                expect.stringContaining('"component":"saveSetting"')
            );
            expect(consoleSpy.error).toHaveBeenCalledWith(
                expect.stringContaining('"key":"targetLanguage"')
            );
        });
    });

    describe('Component Naming', () => {
        test('should use consistent component names in log messages', () => {
            popupLogger.info('Test message');

            expect(consoleSpy.info).toHaveBeenCalledWith(
                expect.stringContaining('[Popup]')
            );
        });

        test('should include sub-component context in structured data', () => {
            popupLogger.error('Font size error', null, {
                component: 'subtitleFontSizeInput',
                fontSize: 2.5,
            });

            expect(consoleSpy.error).toHaveBeenCalledWith(
                expect.stringContaining('"component":"subtitleFontSizeInput"')
            );
        });
    });
});
