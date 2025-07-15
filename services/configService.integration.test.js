/**
 * Integration tests for ConfigService logging behavior
 * Tests the complete logging integration including debug mode detection,
 * error logging with full context, and logger configuration updates
 */

import { jest } from '@jest/globals';
import { configService } from './configService.js';

describe('ConfigService Logger Integration', () => {
    let consoleSpy;
    let mockLogger;

    beforeEach(() => {
        // Reset Chrome API mocks
        jest.clearAllMocks();
        chrome.runtime.lastError = null;

        // Spy on console methods
        consoleSpy = {
            debug: jest.spyOn(console, 'debug').mockImplementation(() => {}),
            info: jest.spyOn(console, 'info').mockImplementation(() => {}),
            warn: jest.spyOn(console, 'warn').mockImplementation(() => {}),
            error: jest.spyOn(console, 'error').mockImplementation(() => {}),
        };

        // Create a fresh logger instance for testing
        mockLogger = {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            updateDebugMode: jest.fn().mockResolvedValue(),
        };

        // Replace the logger in configService
        configService.logger = mockLogger;
    });

    afterEach(() => {
        // Restore console methods
        Object.values(consoleSpy).forEach((spy) => spy.mockRestore());
    });

    describe('Debug Mode Detection and Updates', () => {
        test('should update debug mode when debugMode setting changes', async () => {
            // Mock successful storage operations
            chrome.storage.local.set.mockImplementation((items, callback) => {
                callback();
            });

            await configService.set('debugMode', true);

            expect(mockLogger.updateDebugMode).toHaveBeenCalled();
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'Debug mode updated',
                { debugMode: true }
            );
        });

        test('should update debug mode when setMultiple includes debugMode', async () => {
            chrome.storage.local.set.mockImplementation((items, callback) => {
                callback();
            });
            chrome.storage.sync.set.mockImplementation((items, callback) => {
                callback();
            });

            await configService.setMultiple({
                debugMode: false,
                uiLanguage: 'es',
            });

            expect(mockLogger.updateDebugMode).toHaveBeenCalled();
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'Debug mode updated via setMultiple',
                { debugMode: false }
            );
        });

        test('should update debug mode after resetToDefaults', async () => {
            chrome.storage.sync.set.mockImplementation((items, callback) =>
                callback()
            );
            chrome.storage.local.set.mockImplementation((items, callback) =>
                callback()
            );

            await configService.resetToDefaults();

            expect(mockLogger.updateDebugMode).toHaveBeenCalled();
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'Debug mode updated after reset'
            );
        });
    });

    describe('Public Method Debug Logging', () => {
        test('should log debug information for get() method', async () => {
            chrome.storage.sync.get.mockImplementation((keys, callback) => {
                callback({ uiLanguage: 'en' });
            });

            await configService.get('uiLanguage');

            expect(mockLogger.debug).toHaveBeenCalledWith('get() called', {
                key: 'uiLanguage',
            });
            expect(mockLogger.debug).toHaveBeenCalledWith('get() completed', {
                key: 'uiLanguage',
                value: 'string',
                usedDefault: false,
                scope: 'sync',
            });
        });

        test('should log debug information for getMultiple() method', async () => {
            chrome.storage.sync.get.mockImplementation((keys, callback) => {
                callback({ uiLanguage: 'en' });
            });
            chrome.storage.local.get.mockImplementation((keys, callback) => {
                callback({ debugMode: false });
            });

            await configService.getMultiple(['uiLanguage', 'debugMode']);

            expect(mockLogger.debug).toHaveBeenCalledWith(
                'getMultiple() called',
                {
                    keys: ['uiLanguage', 'debugMode'],
                    keyCount: 2,
                }
            );
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'getMultiple() completed',
                expect.objectContaining({
                    requestedKeys: ['uiLanguage', 'debugMode'],
                    resultCount: 2,
                })
            );
        });

        test('should log debug information for set() method', async () => {
            chrome.storage.sync.set.mockImplementation((items, callback) => {
                callback();
            });

            await configService.set('uiLanguage', 'es');

            expect(mockLogger.debug).toHaveBeenCalledWith('set() called', {
                key: 'uiLanguage',
                valueType: 'string',
            });
            expect(mockLogger.debug).toHaveBeenCalledWith('set() completed', {
                key: 'uiLanguage',
                valueType: 'string',
                scope: 'sync',
            });
        });

        test('should log debug information for setMultiple() method', async () => {
            chrome.storage.sync.set.mockImplementation((items, callback) =>
                callback()
            );
            chrome.storage.local.set.mockImplementation((items, callback) =>
                callback()
            );

            const settings = { uiLanguage: 'es', debugMode: true };
            await configService.setMultiple(settings);

            expect(mockLogger.debug).toHaveBeenCalledWith(
                'setMultiple() called',
                {
                    settingsKeys: ['uiLanguage', 'debugMode'],
                    settingCount: 2,
                }
            );
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'setMultiple() validation completed',
                expect.objectContaining({
                    syncSettingsCount: 1,
                    localSettingsCount: 1,
                })
            );
        });

        test('should log debug information for onChanged() method', () => {
            const callback = jest.fn();

            configService.onChanged(callback);

            expect(mockLogger.debug).toHaveBeenCalledWith(
                'onChanged() called',
                {
                    currentListenerCount: expect.any(Number),
                }
            );
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'Change listener added',
                {
                    totalListeners: expect.any(Number),
                }
            );
        });
    });

    describe('Error Logging with Full Context', () => {
        test('should log detailed error context for storage failures', async () => {
            chrome.runtime.lastError = { message: 'Storage quota exceeded' };
            chrome.storage.sync.get.mockImplementation((keys, callback) => {
                callback(null);
            });

            await configService.get('uiLanguage');

            expect(mockLogger.error).toHaveBeenCalledWith(
                'Storage quota exceeded during get operation',
                expect.any(Object),
                expect.objectContaining({
                    area: 'sync',
                    keys: ['uiLanguage'],
                    duration: expect.any(Number),
                    context: expect.objectContaining({
                        method: 'get',
                        requestedKey: 'uiLanguage',
                    }),
                    quotaError: true,
                    recoveryAction: expect.any(String),
                })
            );
        });

        test('should log validation errors with full context', async () => {
            try {
                await configService.set('uiLanguage', 123); // Invalid type
            } catch {
                // Expected to throw
            }

            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('Invalid value for key "uiLanguage"'),
                expect.any(Error),
                expect.objectContaining({
                    method: 'set',
                    requestedKey: 'uiLanguage',
                    providedValue: 123,
                    expectedType: 'String',
                    actualType: 'number',
                })
            );
        });

        test('should log invalid key errors with context', async () => {
            const result = await configService.get('invalidKey');

            expect(result).toBeUndefined();
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Invalid key "invalidKey" requested',
                null,
                expect.objectContaining({
                    method: 'get',
                    requestedKey: 'invalidKey',
                })
            );
        });

        test('should log partial failure errors in setMultiple', async () => {
            try {
                await configService.setMultiple({
                    uiLanguage: 'es',
                    invalidKey: 'value',
                    debugMode: 'invalid-type',
                });
            } catch {
                // Expected to throw
            }

            expect(mockLogger.error).toHaveBeenCalledWith(
                'Invalid key "invalidKey" provided for setMultiple',
                null,
                expect.objectContaining({
                    method: 'setMultiple',
                    invalidKey: 'invalidKey',
                    providedValue: 'value',
                })
            );

            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('Invalid value for key "debugMode"'),
                null,
                expect.objectContaining({
                    method: 'setMultiple',
                    invalidKey: 'debugMode',
                    providedValue: 'invalid-type',
                })
            );
        });
    });

    describe('Storage Operation Logging', () => {
        test('should log storage operation timing and context', async () => {
            chrome.storage.sync.get.mockImplementation((keys, callback) => {
                setTimeout(() => callback({ uiLanguage: 'en' }), 10);
            });

            await configService.get('uiLanguage');

            expect(mockLogger.debug).toHaveBeenCalledWith(
                'Starting get operation',
                expect.objectContaining({
                    area: 'sync',
                    keys: ['uiLanguage'],
                    context: expect.objectContaining({
                        method: 'get',
                        requestedKey: 'uiLanguage',
                    }),
                })
            );

            expect(mockLogger.debug).toHaveBeenCalledWith(
                'Storage get operation completed',
                expect.objectContaining({
                    area: 'sync',
                    keys: ['uiLanguage'],
                    duration: expect.any(Number),
                    resultKeys: ['uiLanguage'],
                })
            );
        });

        test('should log bulk operations with detailed metrics', async () => {
            chrome.storage.sync.get.mockImplementation((keys, callback) => {
                callback({ uiLanguage: 'en', selectedProvider: 'deepl_free' });
            });
            chrome.storage.local.get.mockImplementation((keys, callback) => {
                callback({ debugMode: false });
            });

            await configService.getAll();

            expect(mockLogger.debug).toHaveBeenCalledWith('getAll() called');
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'getAll() storage breakdown',
                expect.objectContaining({
                    syncKeyCount: expect.any(Number),
                    localKeyCount: expect.any(Number),
                    totalKeys: expect.any(Number),
                })
            );
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'getAll() completed',
                expect.objectContaining({
                    totalSettings: expect.any(Number),
                    defaultsUsed: expect.any(Array),
                    defaultsUsedCount: expect.any(Number),
                })
            );
        });
    });

    describe('Change Listener Integration', () => {
        test('should log storage changes and update debug mode', () => {
            // Reset the change listener initialization flag for this test
            configService.changeListenerInitialized = false;

            // Initialize change listener
            configService.initializeChangeListener();

            expect(mockLogger.debug).toHaveBeenCalledWith(
                'Initializing change listener'
            );
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'Change listener initialized'
            );

            // Simulate storage change
            const changeListener =
                chrome.storage.onChanged.addListener.mock.calls[0][0];
            changeListener({ debugMode: { newValue: true } }, 'local');

            expect(mockLogger.debug).toHaveBeenCalledWith(
                'Storage changes detected',
                expect.objectContaining({
                    areaName: 'local',
                    changedKeys: ['debugMode'],
                    listenerCount: expect.any(Number),
                })
            );
        });

        test('should log errors in change listener callbacks', () => {
            // Reset the change listener initialization flag for this test
            configService.changeListenerInitialized = false;
            configService.initializeChangeListener();

            const errorCallback = jest.fn().mockImplementation(() => {
                throw new Error('Callback error');
            });
            configService.onChanged(errorCallback);

            // Get the change listener that was registered
            const changeListener =
                chrome.storage.onChanged.addListener.mock.calls[0][0];
            changeListener({ uiLanguage: { newValue: 'es' } }, 'sync');

            expect(mockLogger.error).toHaveBeenCalledWith(
                'Error in change listener callback',
                expect.any(Error),
                expect.objectContaining({
                    areaName: 'sync',
                    changedKeys: ['uiLanguage'],
                })
            );
        });
    });

    describe('Initialization Logging', () => {
        test('should log setDefaultsForMissingKeys process', async () => {
            chrome.storage.sync.get.mockImplementation((keys, callback) => {
                callback({}); // No existing values
            });
            chrome.storage.local.get.mockImplementation((keys, callback) => {
                callback({}); // No existing values
            });
            chrome.storage.sync.set.mockImplementation((items, callback) =>
                callback()
            );
            chrome.storage.local.set.mockImplementation((items, callback) =>
                callback()
            );

            await configService.setDefaultsForMissingKeys();

            expect(mockLogger.debug).toHaveBeenCalledWith(
                'setDefaultsForMissingKeys() called'
            );
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'setDefaultsForMissingKeys() key breakdown',
                expect.objectContaining({
                    syncKeyCount: expect.any(Number),
                    localKeyCount: expect.any(Number),
                    totalKeys: expect.any(Number),
                })
            );
            expect(mockLogger.info).toHaveBeenCalledWith(
                'Successfully set sync defaults',
                expect.objectContaining({
                    keys: expect.any(Array),
                })
            );
        });

        test('should log initialization errors but continue', async () => {
            chrome.storage.sync.get.mockImplementation((keys, callback) => {
                callback({});
            });
            chrome.storage.local.get.mockImplementation((keys, callback) => {
                callback({});
            });

            // Mock storage set to fail with error
            chrome.storage.sync.set.mockImplementation((items, callback) => {
                chrome.runtime.lastError = { message: 'Storage error' };
                callback();
            });
            chrome.storage.local.set.mockImplementation((items, callback) => {
                chrome.runtime.lastError = null; // Ensure local succeeds
                callback();
            });

            await configService.setDefaultsForMissingKeys();

            expect(mockLogger.error).toHaveBeenCalledWith(
                'Failed to set sync defaults in storage',
                expect.any(Object),
                expect.objectContaining({
                    method: 'setDefaultsForMissingKeys',
                    keys: expect.any(Array),
                })
            );
            expect(mockLogger.warn).toHaveBeenCalledWith(
                expect.stringContaining(
                    'setDefaultsForMissingKeys() completed with partial failures'
                ),
                expect.objectContaining({
                    method: 'setDefaultsForMissingKeys',
                    errors: expect.any(Array),
                })
            );
        });
    });
});
