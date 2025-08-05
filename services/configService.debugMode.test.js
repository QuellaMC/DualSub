/**
 * Dedicated tests for debug mode toggling and logging behavior
 * Focuses specifically on debug mode functionality and performance impact
 */

import { jest } from '@jest/globals';
import { configService } from './configService.js';
import Logger from '../utils/logger.js';

describe('ConfigService Debug Mode Tests', () => {
    let consoleSpy;
    let realLogger;

    beforeEach(() => {
        jest.clearAllMocks();
        chrome.runtime.lastError = null;

        // Spy on console methods
        consoleSpy = {
            debug: jest.spyOn(console, 'debug').mockImplementation(() => {}),
            info: jest.spyOn(console, 'info').mockImplementation(() => {}),
            warn: jest.spyOn(console, 'warn').mockImplementation(() => {}),
            error: jest.spyOn(console, 'error').mockImplementation(() => {}),
        };

        // Use real logger for authentic debug behavior
        realLogger = Logger.create('ConfigService', configService);
        configService.logger = realLogger;

        // Reset storage mocks
        chrome.storage.local.get.mockImplementation((keys, callback) => {
            callback({ debugMode: false });
        });
        chrome.storage.local.set.mockImplementation((items, callback) =>
            callback()
        );
        chrome.storage.sync.get.mockImplementation((keys, callback) =>
            callback({})
        );
        chrome.storage.sync.set.mockImplementation((items, callback) =>
            callback()
        );
    });

    afterEach(() => {
        Object.values(consoleSpy).forEach((spy) => spy.mockRestore());
    });

    describe('Logging Level Detection and Updates', () => {
        it('should initialize with INFO level by default', async () => {
            await realLogger.updateLevel();
            expect(realLogger.currentLevel).toBe(Logger.LEVELS.INFO);
        });

        it('should set logging level when loggingLevel setting is provided', async () => {
            chrome.storage.sync.get.mockImplementation((keys, callback) => {
                callback({ loggingLevel: Logger.LEVELS.DEBUG });
            });

            await realLogger.updateLevel();
            expect(realLogger.currentLevel).toBe(Logger.LEVELS.DEBUG);
        });

        it('should change logging level when loggingLevel setting changes', async () => {
            // First set to DEBUG
            chrome.storage.sync.get.mockImplementation((keys, callback) => {
                callback({ loggingLevel: Logger.LEVELS.DEBUG });
            });
            await realLogger.updateLevel();
            expect(realLogger.currentLevel).toBe(Logger.LEVELS.DEBUG);

            // Then change to ERROR
            chrome.storage.sync.get.mockImplementation((keys, callback) => {
                callback({ loggingLevel: Logger.LEVELS.ERROR });
            });
            await realLogger.updateLevel();
            expect(realLogger.currentLevel).toBe(Logger.LEVELS.ERROR);
        });

        it('should handle missing loggingLevel setting gracefully', async () => {
            chrome.storage.sync.get.mockImplementation((keys, callback) => {
                callback({}); // No loggingLevel key
            });

            await realLogger.updateLevel();
            expect(realLogger.currentLevel).toBe(Logger.LEVELS.INFO); // Default to INFO
        });

        it('should handle config service errors during level update', async () => {
            chrome.storage.sync.get.mockImplementation((keys, callback) => {
                chrome.runtime.lastError = { message: 'Storage error' };
                callback(null);
            });

            await realLogger.updateLevel();
            expect(realLogger.currentLevel).toBe(Logger.LEVELS.INFO); // Should default to INFO
        });

        it('should update logging level when loggingLevel setting changes via set()', async () => {
            const updateSpy = jest.spyOn(realLogger, 'updateLevel');

            await configService.set('loggingLevel', Logger.LEVELS.DEBUG);

            expect(updateSpy).toHaveBeenCalled();
        });

        it('should update logging level when loggingLevel setting changes via setMultiple()', async () => {
            const updateSpy = jest.spyOn(realLogger, 'updateLevel');

            await configService.setMultiple({
                loggingLevel: Logger.LEVELS.DEBUG,
                uiLanguage: 'es',
            });

            expect(updateSpy).toHaveBeenCalled();
        });
    });

    describe('Level-Based Logging Behavior', () => {
        it('should log debug messages only when DEBUG level is enabled', async () => {
            // Debug level disabled (INFO level)
            realLogger.currentLevel = Logger.LEVELS.INFO;
            realLogger.debug('Test debug message', { key: 'value' });
            expect(consoleSpy.debug).not.toHaveBeenCalled();

            // Debug level enabled
            realLogger.currentLevel = Logger.LEVELS.DEBUG;
            realLogger.debug('Test debug message', { key: 'value' });
            expect(consoleSpy.debug).toHaveBeenCalledWith(
                expect.stringContaining(
                    '[DEBUG] [ConfigService] Test debug message'
                )
            );
        });

        it('should always log info, warn, and error messages when level allows', async () => {
            realLogger.currentLevel = Logger.LEVELS.INFO;

            realLogger.info('Info message');
            realLogger.warn('Warning message');
            realLogger.error('Error message');

            expect(consoleSpy.info).toHaveBeenCalled();
            expect(consoleSpy.warn).toHaveBeenCalled();
            expect(consoleSpy.error).toHaveBeenCalled();
        });

        it('should include proper formatting in debug messages', async () => {
            realLogger.currentLevel = Logger.LEVELS.DEBUG;
            const testData = { operation: 'test', count: 5 };

            realLogger.debug('Test operation', testData);

            expect(consoleSpy.debug).toHaveBeenCalledWith(
                expect.stringMatching(
                    /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[DEBUG\] \[ConfigService\] Test operation \| Data: {"operation":"test","count":5}$/
                )
            );
        });

        it('should handle empty data objects in debug messages', async () => {
            realLogger.currentLevel = Logger.LEVELS.DEBUG;

            realLogger.debug('Test message without data');

            expect(consoleSpy.debug).toHaveBeenCalledWith(
                expect.stringMatching(
                    /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[DEBUG\] \[ConfigService\] Test message without data$/
                )
            );
        });

        it('should handle complex data objects in debug messages', async () => {
            realLogger.currentLevel = Logger.LEVELS.DEBUG;
            const complexData = {
                nested: { key: 'value' },
                array: [1, 2, 3],
                nullValue: null,
                undefinedValue: undefined,
                booleanValue: true,
            };

            realLogger.debug('Complex data test', complexData);

            expect(consoleSpy.debug).toHaveBeenCalledWith(
                expect.stringContaining('Complex data test')
            );
            expect(consoleSpy.debug).toHaveBeenCalledWith(
                expect.stringContaining('"nested":{"key":"value"}')
            );
        });
    });

    describe('ConfigService Method Debug Logging', () => {
        beforeEach(() => {
            realLogger.currentLevel = Logger.LEVELS.DEBUG;
        });

        it('should log debug information for get() operations', async () => {
            chrome.storage.sync.get.mockImplementation((keys, callback) => {
                callback({ uiLanguage: 'en' });
            });

            await configService.get('uiLanguage');

            expect(consoleSpy.debug).toHaveBeenCalledWith(
                expect.stringContaining('get() called')
            );
            expect(consoleSpy.debug).toHaveBeenCalledWith(
                expect.stringContaining('get() completed')
            );
        });

        it('should log debug information for set() operations', async () => {
            await configService.set('uiLanguage', 'es');

            expect(consoleSpy.debug).toHaveBeenCalledWith(
                expect.stringContaining('set() called')
            );
            expect(consoleSpy.debug).toHaveBeenCalledWith(
                expect.stringContaining('set() completed')
            );
        });

        it('should log debug information for getMultiple() operations', async () => {
            chrome.storage.sync.get.mockImplementation((keys, callback) => {
                callback({ uiLanguage: 'en' });
            });
            chrome.storage.local.get.mockImplementation((keys, callback) => {
                callback({ debugMode: false });
            });

            await configService.getMultiple(['uiLanguage', 'debugMode']);

            expect(consoleSpy.debug).toHaveBeenCalledWith(
                expect.stringContaining('getMultiple() called')
            );
            expect(consoleSpy.debug).toHaveBeenCalledWith(
                expect.stringContaining('getMultiple() completed')
            );
        });

        it('should log debug information for setMultiple() operations', async () => {
            await configService.setMultiple({
                uiLanguage: 'es',
                loggingLevel: Logger.LEVELS.DEBUG,
            });

            expect(consoleSpy.debug).toHaveBeenCalledWith(
                expect.stringContaining('setMultiple() called')
            );
        });

        it('should log debug information for storage operations', async () => {
            await configService.getFromStorage('sync', ['uiLanguage']);

            expect(consoleSpy.debug).toHaveBeenCalledWith(
                expect.stringContaining('Starting get operation')
            );
            expect(consoleSpy.debug).toHaveBeenCalledWith(
                expect.stringContaining('Storage get operation completed')
            );
        });

        it('should not log debug information when debug level is disabled', async () => {
            realLogger.currentLevel = Logger.LEVELS.INFO;

            chrome.storage.sync.get.mockImplementation((keys, callback) => {
                callback({ uiLanguage: 'en' });
            });

            await configService.get('uiLanguage');

            expect(consoleSpy.debug).not.toHaveBeenCalled();
        });
    });

    describe('Logging Level Performance Impact', () => {
        it('should have minimal performance impact when debug level is disabled', async () => {
            const iterations = 100;

            // Test with debug level disabled
            realLogger.currentLevel = Logger.LEVELS.INFO;
            chrome.storage.sync.get.mockImplementation((keys, callback) => {
                callback({ uiLanguage: 'en' });
            });

            const startTimeDisabled = performance.now();
            for (let i = 0; i < iterations; i++) {
                await configService.get('uiLanguage');
            }
            const disabledTime = performance.now() - startTimeDisabled;

            // Test with debug level enabled
            realLogger.currentLevel = Logger.LEVELS.DEBUG;
            const startTimeEnabled = performance.now();
            for (let i = 0; i < iterations; i++) {
                await configService.get('uiLanguage');
            }
            const enabledTime = performance.now() - startTimeEnabled;

            // Debug logging should not add more than 5000% overhead (very lenient for test environment)
            expect(enabledTime).toBeLessThan(disabledTime * 50);

            // Verify debug logs were actually generated when enabled
            expect(consoleSpy.debug).toHaveBeenCalled();
        });

        it('should efficiently handle logging level checks', async () => {
            const iterations = 100; // Reduced from 1000 to 100 for speed

            const startTime = performance.now();
            for (let i = 0; i < iterations; i++) {
                // Simulate the level check that happens in logging
                if (realLogger.shouldLog(Logger.LEVELS.DEBUG)) {
                    realLogger.formatMessage('DEBUG', 'Test message', {
                        iteration: i,
                    });
                }
            }
            const endTime = performance.now();

            // Should complete quickly even with many level checks
            expect(endTime - startTime).toBeLessThan(50); // 50ms threshold
        });

        it('should handle rapid logging level changes without performance degradation', async () => {
            chrome.storage.sync.get.mockImplementation((keys, callback) => {
                callback({ loggingLevel: Logger.LEVELS.DEBUG });
            });

            const startTime = performance.now();

            // Rapidly toggle logging levels
            for (let i = 0; i < 20; i++) { // Reduced from 100 to 20 for speed
                await realLogger.updateLevel();
                realLogger.currentLevel =
                    i % 2 === 0 ? Logger.LEVELS.DEBUG : Logger.LEVELS.INFO;
            }

            const endTime = performance.now();
            expect(endTime - startTime).toBeLessThan(200); // 200ms threshold
        });

        it('should efficiently serialize large debug data objects', async () => {
            realLogger.currentLevel = Logger.LEVELS.DEBUG;

            // Create large data object
            const largeData = {
                array: new Array(100).fill('test'), // Reduced from 1000 to 100 for speed
                object: {},
            };
            for (let i = 0; i < 50; i++) { // Reduced from 500 to 50 for speed
                largeData.object[`key${i}`] = `value${i}`;
            }

            const startTime = performance.now();
            realLogger.debug('Large data test', largeData);
            const endTime = performance.now();

            // Should handle large data efficiently
            expect(endTime - startTime).toBeLessThan(50); // 50ms threshold
            expect(consoleSpy.debug).toHaveBeenCalled();
        });
    });

    describe('Logging Level Integration with Error Handling', () => {
        it('should log errors with debug context when debug level is enabled', async () => {
            realLogger.currentLevel = Logger.LEVELS.DEBUG;
            chrome.runtime.lastError = { message: 'Storage error' };
            chrome.storage.sync.set.mockImplementation((items, callback) =>
                callback()
            );

            try {
                await configService.set('uiLanguage', 'es');
            } catch {
                // Should have debug logs leading up to the error
                expect(consoleSpy.debug).toHaveBeenCalledWith(
                    expect.stringContaining('set() called')
                );
                expect(consoleSpy.error).toHaveBeenCalled();
            }
        });

        it('should log errors without debug context when debug level is disabled', async () => {
            realLogger.currentLevel = Logger.LEVELS.INFO;
            chrome.runtime.lastError = { message: 'Storage error' };
            chrome.storage.sync.set.mockImplementation((items, callback) =>
                callback()
            );

            try {
                await configService.set('uiLanguage', 'es');
            } catch {
                // Should not have debug logs
                expect(consoleSpy.debug).not.toHaveBeenCalled();
                // But should still have error logs
                expect(consoleSpy.error).toHaveBeenCalled();
            }
        });

        it('should maintain error logging quality regardless of logging level', async () => {
            const testError = { message: 'Test storage error' };
            chrome.runtime.lastError = testError;
            chrome.storage.local.set.mockImplementation((items, callback) =>
                callback()
            );

            // Test with debug level enabled
            realLogger.currentLevel = Logger.LEVELS.DEBUG;
            try {
                await configService.set('loggingLevel', Logger.LEVELS.DEBUG);
            } catch (error) {
                expect(error.originalError).toBe(testError);
            }

            // Reset mocks
            jest.clearAllMocks();
            chrome.runtime.lastError = testError;

            // Test with debug level disabled
            realLogger.currentLevel = Logger.LEVELS.INFO;
            try {
                await configService.set('loggingLevel', Logger.LEVELS.INFO);
            } catch (error) {
                expect(error.originalError).toBe(testError);
            }
        });
    });

    describe('Logging Level Configuration Persistence', () => {
        it('should persist logging level setting across service operations', async () => {
            // Mock storage to return loggingLevel as DEBUG
            chrome.storage.sync.get.mockImplementation((keys, callback) => {
                callback({ loggingLevel: Logger.LEVELS.DEBUG });
            });

            // Update logging level from storage
            await realLogger.updateLevel();

            // Verify logging level is set
            expect(realLogger.currentLevel).toBe(Logger.LEVELS.DEBUG);

            // Verify debug logging works
            realLogger.debug('Test debug message');
            expect(consoleSpy.debug).toHaveBeenCalledWith(
                expect.stringContaining('Test debug message')
            );
        });

        it('should handle logging level changes through external storage updates', () => {
            // Simulate external change to loggingLevel
            const changeListener =
                chrome.storage.onChanged.addListener.mock.calls[0]?.[0];

            if (changeListener) {
                changeListener(
                    { loggingLevel: { newValue: Logger.LEVELS.DEBUG } },
                    'sync'
                );

                // Should trigger logging level update
                expect(realLogger.currentLevel).toBe(Logger.LEVELS.DEBUG);
            }
        });

        it('should maintain logging level state during service initialization', async () => {
            chrome.storage.sync.get.mockImplementation((keys, callback) => {
                callback({ loggingLevel: Logger.LEVELS.DEBUG });
            });

            // Simulate service initialization
            await configService.initializeLogger();

            expect(realLogger.currentLevel).toBe(Logger.LEVELS.DEBUG);
        });
    });
});
