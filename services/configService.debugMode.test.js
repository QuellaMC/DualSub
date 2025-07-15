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
            error: jest.spyOn(console, 'error').mockImplementation(() => {})
        };

        // Use real logger for authentic debug behavior
        realLogger = Logger.create('ConfigService', configService);
        configService.logger = realLogger;

        // Reset storage mocks
        chrome.storage.local.get.mockImplementation((keys, callback) => {
            callback({ debugMode: false });
        });
        chrome.storage.local.set.mockImplementation((items, callback) => callback());
        chrome.storage.sync.get.mockImplementation((keys, callback) => callback({}));
        chrome.storage.sync.set.mockImplementation((items, callback) => callback());
    });

    afterEach(() => {
        Object.values(consoleSpy).forEach(spy => spy.mockRestore());
    });

    describe('Debug Mode Detection and Updates', () => {
        it('should initialize with debug mode disabled by default', async () => {
            await realLogger.updateDebugMode();
            expect(realLogger.debugEnabled).toBe(false);
        });

        it('should enable debug mode when debugMode setting is true', async () => {
            chrome.storage.local.get.mockImplementation((keys, callback) => {
                callback({ debugMode: true });
            });

            await realLogger.updateDebugMode();
            expect(realLogger.debugEnabled).toBe(true);
        });

        it('should disable debug mode when debugMode setting is false', async () => {
            // First enable it
            chrome.storage.local.get.mockImplementation((keys, callback) => {
                callback({ debugMode: true });
            });
            await realLogger.updateDebugMode();
            expect(realLogger.debugEnabled).toBe(true);

            // Then disable it
            chrome.storage.local.get.mockImplementation((keys, callback) => {
                callback({ debugMode: false });
            });
            await realLogger.updateDebugMode();
            expect(realLogger.debugEnabled).toBe(false);
        });

        it('should handle missing debugMode setting gracefully', async () => {
            chrome.storage.local.get.mockImplementation((keys, callback) => {
                callback({}); // No debugMode key
            });

            await realLogger.updateDebugMode();
            expect(realLogger.debugEnabled).toBe(false);
        });

        it('should handle config service errors during debug mode update', async () => {
            chrome.storage.local.get.mockImplementation((keys, callback) => {
                chrome.runtime.lastError = { message: 'Storage error' };
                callback(null);
            });

            await realLogger.updateDebugMode();
            expect(realLogger.debugEnabled).toBe(false); // Should default to false
        });

        it('should update debug mode when debugMode setting changes via set()', async () => {
            const updateSpy = jest.spyOn(realLogger, 'updateDebugMode');

            await configService.set('debugMode', true);

            expect(updateSpy).toHaveBeenCalled();
        });

        it('should update debug mode when debugMode setting changes via setMultiple()', async () => {
            const updateSpy = jest.spyOn(realLogger, 'updateDebugMode');

            await configService.setMultiple({ 
                debugMode: true, 
                uiLanguage: 'es' 
            });

            expect(updateSpy).toHaveBeenCalled();
        });
    });

    describe('Debug Logging Behavior', () => {
        it('should log debug messages only when debug mode is enabled', async () => {
            // Debug disabled
            realLogger.debugEnabled = false;
            realLogger.debug('Test debug message', { key: 'value' });
            expect(consoleSpy.debug).not.toHaveBeenCalled();

            // Debug enabled
            realLogger.debugEnabled = true;
            realLogger.debug('Test debug message', { key: 'value' });
            expect(consoleSpy.debug).toHaveBeenCalledWith(
                expect.stringContaining('[DEBUG] [ConfigService] Test debug message')
            );
        });

        it('should always log info, warn, and error messages regardless of debug mode', async () => {
            realLogger.debugEnabled = false;

            realLogger.info('Info message');
            realLogger.warn('Warning message');
            realLogger.error('Error message');

            expect(consoleSpy.info).toHaveBeenCalled();
            expect(consoleSpy.warn).toHaveBeenCalled();
            expect(consoleSpy.error).toHaveBeenCalled();
        });

        it('should include proper formatting in debug messages', async () => {
            realLogger.debugEnabled = true;
            const testData = { operation: 'test', count: 5 };

            realLogger.debug('Test operation', testData);

            expect(consoleSpy.debug).toHaveBeenCalledWith(
                expect.stringMatching(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[DEBUG\] \[ConfigService\] Test operation \| Data: {"operation":"test","count":5}$/)
            );
        });

        it('should handle empty data objects in debug messages', async () => {
            realLogger.debugEnabled = true;

            realLogger.debug('Test message without data');

            expect(consoleSpy.debug).toHaveBeenCalledWith(
                expect.stringMatching(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[DEBUG\] \[ConfigService\] Test message without data$/)
            );
        });

        it('should handle complex data objects in debug messages', async () => {
            realLogger.debugEnabled = true;
            const complexData = {
                nested: { key: 'value' },
                array: [1, 2, 3],
                nullValue: null,
                undefinedValue: undefined,
                booleanValue: true
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
            realLogger.debugEnabled = true;
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
                debugMode: true 
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

        it('should not log debug information when debug mode is disabled', async () => {
            realLogger.debugEnabled = false;

            chrome.storage.sync.get.mockImplementation((keys, callback) => {
                callback({ uiLanguage: 'en' });
            });

            await configService.get('uiLanguage');

            expect(consoleSpy.debug).not.toHaveBeenCalled();
        });
    });

    describe('Debug Mode Performance Impact', () => {
        it('should have minimal performance impact when debug is disabled', async () => {
            const iterations = 100;
            
            // Test with debug disabled
            realLogger.debugEnabled = false;
            chrome.storage.sync.get.mockImplementation((keys, callback) => {
                callback({ uiLanguage: 'en' });
            });

            const startTimeDisabled = performance.now();
            for (let i = 0; i < iterations; i++) {
                await configService.get('uiLanguage');
            }
            const disabledTime = performance.now() - startTimeDisabled;

            // Test with debug enabled
            realLogger.debugEnabled = true;
            const startTimeEnabled = performance.now();
            for (let i = 0; i < iterations; i++) {
                await configService.get('uiLanguage');
            }
            const enabledTime = performance.now() - startTimeEnabled;

            // Debug logging should not add more than 1000% overhead (very lenient for test environment)
            expect(enabledTime).toBeLessThan(disabledTime * 10);
            
            // Verify debug logs were actually generated when enabled
            expect(consoleSpy.debug).toHaveBeenCalled();
        });

        it('should efficiently handle debug mode checks', async () => {
            const iterations = 1000;
            
            const startTime = performance.now();
            for (let i = 0; i < iterations; i++) {
                // Simulate the debug check that happens in logging
                if (realLogger.debugEnabled) {
                    realLogger.formatMessage('DEBUG', 'Test message', { iteration: i });
                }
            }
            const endTime = performance.now();

            // Should complete quickly even with many debug checks
            expect(endTime - startTime).toBeLessThan(50); // 50ms threshold
        });

        it('should handle rapid debug mode toggles without performance degradation', async () => {
            chrome.storage.local.get.mockImplementation((keys, callback) => {
                callback({ debugMode: true });
            });

            const startTime = performance.now();
            
            // Rapidly toggle debug mode
            for (let i = 0; i < 100; i++) {
                await realLogger.updateDebugMode();
                realLogger.debugEnabled = !realLogger.debugEnabled;
            }

            const endTime = performance.now();
            expect(endTime - startTime).toBeLessThan(200); // 200ms threshold
        });

        it('should efficiently serialize large debug data objects', async () => {
            realLogger.debugEnabled = true;
            
            // Create large data object
            const largeData = {
                array: new Array(1000).fill('test'),
                object: {}
            };
            for (let i = 0; i < 500; i++) {
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

    describe('Debug Mode Integration with Error Handling', () => {
        it('should log errors with debug context when debug mode is enabled', async () => {
            realLogger.debugEnabled = true;
            chrome.runtime.lastError = { message: 'Storage error' };
            chrome.storage.sync.set.mockImplementation((items, callback) => callback());

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

        it('should log errors without debug context when debug mode is disabled', async () => {
            realLogger.debugEnabled = false;
            chrome.runtime.lastError = { message: 'Storage error' };
            chrome.storage.sync.set.mockImplementation((items, callback) => callback());

            try {
                await configService.set('uiLanguage', 'es');
            } catch {
                // Should not have debug logs
                expect(consoleSpy.debug).not.toHaveBeenCalled();
                // But should still have error logs
                expect(consoleSpy.error).toHaveBeenCalled();
            }
        });

        it('should maintain error logging quality regardless of debug mode', async () => {
            const testError = { message: 'Test storage error' };
            chrome.runtime.lastError = testError;
            chrome.storage.local.set.mockImplementation((items, callback) => callback());

            // Test with debug enabled
            realLogger.debugEnabled = true;
            try {
                await configService.set('debugMode', true);
            } catch (error) {
                expect(error.originalError).toBe(testError);
            }

            // Reset mocks
            jest.clearAllMocks();
            chrome.runtime.lastError = testError;

            // Test with debug disabled
            realLogger.debugEnabled = false;
            try {
                await configService.set('debugMode', false);
            } catch (error) {
                expect(error.originalError).toBe(testError);
            }
        });
    });

    describe('Debug Mode Configuration Persistence', () => {
        it('should persist debug mode setting across service operations', async () => {
            // Mock storage to return debugMode as true
            chrome.storage.local.get.mockImplementation((keys, callback) => {
                callback({ debugMode: true });
            });
            
            // Update debug mode from storage
            await realLogger.updateDebugMode();
            
            // Verify debug mode is enabled
            expect(realLogger.debugEnabled).toBe(true);
            
            // Verify debug logging works
            realLogger.debug('Test debug message');
            expect(consoleSpy.debug).toHaveBeenCalledWith(
                expect.stringContaining('Test debug message')
            );
        });

        it('should handle debug mode changes through external storage updates', () => {
            // Simulate external change to debugMode
            const changeListener = chrome.storage.onChanged.addListener.mock.calls[0]?.[0];
            
            if (changeListener) {
                changeListener({ debugMode: { newValue: true } }, 'local');
                
                // Should trigger debug mode update
                expect(realLogger.debugEnabled).toBe(true);
            }
        });

        it('should maintain debug mode state during service initialization', async () => {
            chrome.storage.local.get.mockImplementation((keys, callback) => {
                callback({ debugMode: true });
            });

            // Simulate service initialization
            await configService.initializeLogger();
            
            expect(realLogger.debugEnabled).toBe(true);
        });
    });
});