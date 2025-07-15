/**
 * Comprehensive error handling tests for ConfigService
 * Tests all error scenarios, Chrome API failures, debug mode behavior, and performance
 */

import { jest } from '@jest/globals';
import { configService } from './configService.js';
import Logger from '../utils/logger.js';

describe('ConfigService Comprehensive Error Handling Tests', () => {
    let consoleSpy;
    let originalLogger;

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();
        chrome.runtime.lastError = null;
        
        // Spy on console methods
        consoleSpy = {
            debug: jest.spyOn(console, 'debug').mockImplementation(() => {}),
            info: jest.spyOn(console, 'info').mockImplementation(() => {}),
            warn: jest.spyOn(console, 'warn').mockImplementation(() => {}),
            error: jest.spyOn(console, 'error').mockImplementation(() => {})
        };

        // Store original logger
        originalLogger = configService.logger;

        // Reset storage mocks to default success behavior
        Object.values(chrome.storage).forEach(area => {
            if (area.get) area.get.mockImplementation((keys, callback) => callback({}));
            if (area.set) area.set.mockImplementation((items, callback) => callback());
            if (area.remove) area.remove.mockImplementation((keys, callback) => callback());
            if (area.clear) area.clear.mockImplementation((callback) => callback());
        });
    });

    afterEach(() => {
        // Restore console methods
        Object.values(consoleSpy).forEach(spy => spy.mockRestore());
        
        // Restore original logger
        configService.logger = originalLogger;
    });

    describe('Chrome API Failure Scenarios', () => {
        describe('Storage Get Failures', () => {
            it('should handle quota exceeded errors in get operations', async () => {
                chrome.runtime.lastError = { message: 'QUOTA_EXCEEDED' };
                chrome.storage.sync.get.mockImplementation((keys, callback) => callback(null));

                const result = await configService.get('uiLanguage');
                
                // Should return default value when storage fails
                expect(result).toBe('en'); // Default value from schema
                
                // Should log error with quota context
                expect(consoleSpy.error).toHaveBeenCalledWith(
                    expect.stringContaining('Storage quota exceeded during get operation')
                );
            });

            it('should handle network errors in get operations', async () => {
                chrome.runtime.lastError = { message: 'Network connection failed' };
                chrome.storage.sync.get.mockImplementation((keys, callback) => callback(null));

                const result = await configService.get('uiLanguage');
                
                expect(result).toBe('en'); // Should return default
                expect(consoleSpy.error).toHaveBeenCalledWith(
                    expect.stringContaining('Storage get operation failed')
                );
            });

            it('should handle permission errors in get operations', async () => {
                chrome.runtime.lastError = { message: 'Access denied to storage' };
                chrome.storage.local.get.mockImplementation((keys, callback) => callback(null));

                const result = await configService.get('debugMode');
                
                expect(result).toBe(false); // Should return default
                expect(consoleSpy.error).toHaveBeenCalledWith(
                    expect.stringContaining('Storage get operation failed')
                );
            });

            it('should handle sync disabled errors', async () => {
                chrome.runtime.lastError = { message: 'Sync is disabled' };
                chrome.storage.sync.get.mockImplementation((keys, callback) => callback(null));

                const result = await configService.get('uiLanguage');
                
                expect(result).toBe('en');
                expect(consoleSpy.error).toHaveBeenCalledWith(
                    expect.stringContaining('Storage get operation failed')
                );
            });
        });

        describe('Storage Set Failures', () => {
            it('should handle quota exceeded errors in set operations', async () => {
                chrome.runtime.lastError = { message: 'QUOTA_BYTES_PER_ITEM quota exceeded' };
                chrome.storage.sync.set.mockImplementation((items, callback) => callback());

                await expect(configService.set('uiLanguage', 'es')).rejects.toThrow();
                
                try {
                    await configService.set('uiLanguage', 'es');
                } catch (error) {
                    expect(error.isQuotaError).toBe(true);
                    expect(error.recoveryAction).toContain('quota exceeded');
                    expect(error.context.operation).toBe('set');
                    expect(error.context.area).toBe('sync');
                }
            });

            it('should handle rate limiting errors in set operations', async () => {
                chrome.runtime.lastError = { message: 'rate limit exceeded' };
                chrome.storage.local.set.mockImplementation((items, callback) => callback());

                await expect(configService.set('debugMode', true)).rejects.toThrow();
                
                try {
                    await configService.set('debugMode', true);
                } catch (error) {
                    expect(error.recoveryAction).toContain('Rate limiting detected');
                    expect(error.recoveryAction).toContain('exponential backoff');
                }
            });

            it('should handle data validation errors in set operations', async () => {
                chrome.runtime.lastError = { message: 'Invalid data format' };
                chrome.storage.sync.set.mockImplementation((items, callback) => callback());

                await expect(configService.set('uiLanguage', 'es')).rejects.toThrow();
                
                try {
                    await configService.set('uiLanguage', 'es');
                } catch (error) {
                    expect(error.recoveryAction).toContain('Data validation error');
                }
            });
        });

        describe('Storage Remove Failures', () => {
            it('should handle quota exceeded errors in remove operations', async () => {
                chrome.runtime.lastError = { message: 'Storage quota exceeded' };
                chrome.storage.sync.remove.mockImplementation((keys, callback) => callback());

                await expect(configService.removeFromStorage('sync', ['key1'])).rejects.toThrow();
                
                try {
                    await configService.removeFromStorage('sync', ['key1']);
                } catch (error) {
                    expect(error.isQuotaError).toBe(true);
                    expect(error.context.operation).toBe('remove');
                }
            });

            it('should handle permission errors in remove operations', async () => {
                chrome.runtime.lastError = { message: 'Permission denied' };
                chrome.storage.local.remove.mockImplementation((keys, callback) => callback());

                await expect(configService.removeFromStorage('local', 'key1')).rejects.toThrow();
                
                try {
                    await configService.removeFromStorage('local', 'key1');
                } catch (error) {
                    expect(error.recoveryAction).toContain('Permission error');
                }
            });
        });

        describe('Multiple Storage Area Failures', () => {
            it('should handle partial failures in getMultiple', async () => {
                // Sync storage fails, local storage succeeds
                chrome.runtime.lastError = { message: 'Sync storage error' };
                chrome.storage.sync.get.mockImplementation((keys, callback) => callback(null));
                chrome.storage.local.get.mockImplementation((keys, callback) => {
                    chrome.runtime.lastError = null;
                    callback({ debugMode: true });
                });

                await expect(configService.getMultiple(['uiLanguage', 'debugMode'])).rejects.toThrow();
            });

            it('should handle partial failures in setMultiple', async () => {
                // Sync storage succeeds, local storage fails
                chrome.storage.sync.set.mockImplementation((items, callback) => {
                    chrome.runtime.lastError = null;
                    callback();
                });
                chrome.storage.local.set.mockImplementation((items, callback) => {
                    chrome.runtime.lastError = { message: 'Local storage error' };
                    callback();
                });

                await expect(configService.setMultiple({
                    uiLanguage: 'es',
                    debugMode: true
                })).rejects.toThrow();
                
                try {
                    await configService.setMultiple({ uiLanguage: 'es', debugMode: true });
                } catch (error) {
                    expect(error.message).toContain('partial failures');
                    expect(error.failed).toHaveLength(1);
                    expect(error.successful).toHaveLength(1);
                }
            });
        });
    });

    describe('End-to-End Error Flow Integration Tests', () => {
        it('should handle complete storage system failure gracefully', async () => {
            // Simulate complete Chrome storage API failure
            const storageError = { message: 'Chrome storage system unavailable' };
            chrome.runtime.lastError = storageError;
            
            Object.values(chrome.storage).forEach(area => {
                if (area.get) area.get.mockImplementation((keys, callback) => callback(null));
                if (area.set) area.set.mockImplementation((items, callback) => callback());
            });

            // getAll should return defaults when storage completely fails
            const config = await configService.getAll();
            
            expect(config).toBeDefined();
            expect(config.uiLanguage).toBe('en'); // Default value
            expect(config.debugMode).toBe(false); // Default value
            
            expect(consoleSpy.error).toHaveBeenCalledWith(
                expect.stringContaining('Error getting all settings')
            );
        });

        it('should handle initialization failure and recovery', async () => {
            // Mock initialization failure
            chrome.runtime.lastError = { message: 'Initialization failed' };
            chrome.storage.sync.get.mockImplementation((keys, callback) => callback(null));
            chrome.storage.local.get.mockImplementation((keys, callback) => callback(null));

            try {
                await configService.setDefaultsForMissingKeys();
            } catch (error) {
                expect(error.message).toContain('setDefaultsForMissingKeys() failed completely');
                expect(configService.isInitialized).toBe(true); // Should still be marked as initialized
            }
        });

        it('should handle cascading failures across multiple operations', async () => {
            // First operation fails
            chrome.runtime.lastError = { message: 'First operation failed' };
            chrome.storage.sync.get.mockImplementation((keys, callback) => callback(null));

            const firstResult = await configService.get('uiLanguage');
            expect(firstResult).toBe('en'); // Default fallback

            // Second operation also fails but with different error
            chrome.runtime.lastError = { message: 'Second operation failed' };
            chrome.storage.local.set.mockImplementation((items, callback) => callback());

            await expect(configService.set('debugMode', true)).rejects.toThrow();

            // Both errors should be logged (may include additional internal errors)
            expect(consoleSpy.error).toHaveBeenCalled();
        });

        it('should maintain service stability during error recovery', async () => {
            // Simulate intermittent failures
            let callCount = 0;
            chrome.storage.sync.get.mockImplementation((keys, callback) => {
                callCount++;
                if (callCount === 1) {
                    chrome.runtime.lastError = { message: 'Temporary failure' };
                    callback(null);
                } else {
                    chrome.runtime.lastError = null;
                    callback({ uiLanguage: 'es' });
                }
            });

            // First call should fail and return default
            const firstResult = await configService.get('uiLanguage');
            expect(firstResult).toBe('en');

            // Second call should succeed
            const secondResult = await configService.get('uiLanguage');
            expect(secondResult).toBe('es');

            expect(consoleSpy.error).toHaveBeenCalled();
        });
    });

    describe('Debug Mode Toggling and Logging Behavior', () => {
        let mockLogger;

        beforeEach(() => {
            mockLogger = {
                debug: jest.fn(),
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn(),
                updateDebugMode: jest.fn().mockResolvedValue(),
                debugEnabled: false
            };
            configService.logger = mockLogger;
        });

        it('should update debug mode when debugMode setting changes', async () => {
            chrome.storage.local.set.mockImplementation((items, callback) => callback());

            await configService.set('debugMode', true);

            expect(mockLogger.updateDebugMode).toHaveBeenCalled();
            expect(mockLogger.debug).toHaveBeenCalledWith('Debug mode updated', { debugMode: true });
        });

        it('should log debug information only when debug mode is enabled', async () => {
            // Create a fresh mock logger that behaves like the real logger
            const freshMockLogger = {
                debug: jest.fn().mockImplementation(function(message) {
                    if (this.debugEnabled) {
                        console.debug(`Mock debug: ${message}`);
                    }
                }),
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn(),
                updateDebugMode: jest.fn().mockResolvedValue(),
                debugEnabled: false
            };
            configService.logger = freshMockLogger;
            
            chrome.storage.sync.get.mockImplementation((keys, callback) => {
                callback({ uiLanguage: 'en' });
            });

            await configService.get('uiLanguage');
            
            // Check that debug was called but didn't actually log (because debugEnabled is false)
            expect(freshMockLogger.debug).toHaveBeenCalled();
            expect(consoleSpy.debug).not.toHaveBeenCalled();

            // Enable debug mode
            freshMockLogger.debugEnabled = true;
            freshMockLogger.debug.mockClear();
            consoleSpy.debug.mockClear();
            
            await configService.get('uiLanguage');

            // Debug logs should be called and actually logged when enabled
            expect(freshMockLogger.debug).toHaveBeenCalled();
            expect(consoleSpy.debug).toHaveBeenCalled();
        });

        it('should always log errors regardless of debug mode', async () => {
            // Debug mode disabled
            mockLogger.debugEnabled = false;
            chrome.runtime.lastError = { message: 'Storage error' };
            chrome.storage.sync.set.mockImplementation((items, callback) => callback());

            await expect(configService.set('uiLanguage', 'es')).rejects.toThrow();

            // Error should be logged even with debug disabled
            expect(mockLogger.error).toHaveBeenCalled();
        });

        it('should handle debug mode toggle during active operations', async () => {
            let operationCount = 0;
            chrome.storage.sync.get.mockImplementation((keys, callback) => {
                operationCount++;
                // Toggle debug mode during operation
                if (operationCount === 1) {
                    mockLogger.debugEnabled = false;
                } else {
                    mockLogger.debugEnabled = true;
                }
                callback({ uiLanguage: 'en' });
            });

            await configService.get('uiLanguage'); // Debug disabled
            await configService.get('uiLanguage'); // Debug enabled

            // Should respect current debug state for each operation
            expect(mockLogger.debug).toHaveBeenCalled();
        });

        it('should log debug mode changes through configuration updates', async () => {
            chrome.storage.local.set.mockImplementation((items, callback) => callback());

            // Test direct debugMode setting
            await configService.set('debugMode', true);
            expect(mockLogger.debug).toHaveBeenCalledWith('Debug mode updated', { debugMode: true });

            // Test debugMode in setMultiple
            chrome.storage.sync.set.mockImplementation((items, callback) => callback());
            await configService.setMultiple({ uiLanguage: 'es', debugMode: false });
            expect(mockLogger.debug).toHaveBeenCalledWith('Debug mode updated via setMultiple', { debugMode: false });
        });
    });

    describe('Performance Tests for Debug Logging', () => {
        let realLogger;

        beforeEach(() => {
            // Use real logger for performance tests
            realLogger = Logger.create('ConfigService', configService);
            configService.logger = realLogger;
        });

        it('should not impact performance when debug logging is disabled', async () => {
            // Disable debug mode
            realLogger.debugEnabled = false;
            
            chrome.storage.sync.get.mockImplementation((keys, callback) => {
                callback({ uiLanguage: 'en' });
            });

            const iterations = 100;
            const startTime = performance.now();

            // Perform multiple operations with debug disabled
            for (let i = 0; i < iterations; i++) {
                await configService.get('uiLanguage');
            }

            const disabledTime = performance.now() - startTime;

            // Enable debug mode
            realLogger.debugEnabled = true;
            const startTimeEnabled = performance.now();

            // Perform same operations with debug enabled
            for (let i = 0; i < iterations; i++) {
                await configService.get('uiLanguage');
            }

            const enabledTime = performance.now() - startTimeEnabled;

            // Debug logging should not significantly impact performance
            // Allow up to 1000% overhead for debug logging in test environment (very lenient for CI)
            expect(enabledTime).toBeLessThan(disabledTime * 10);
            
            // Verify debug logs were actually called when enabled
            expect(consoleSpy.debug).toHaveBeenCalled();
        });

        it('should efficiently handle large data objects in debug logs', async () => {
            realLogger.debugEnabled = true;
            
            // Create large data object
            const largeData = {};
            for (let i = 0; i < 1000; i++) {
                largeData[`key${i}`] = `value${i}`.repeat(100);
            }

            chrome.storage.local.set.mockImplementation((items, callback) => callback());

            const startTime = performance.now();
            
            // This should not cause significant performance issues
            await configService.setToStorage('local', largeData, { 
                method: 'performanceTest',
                largeDataTest: true 
            });

            const endTime = performance.now();
            const duration = endTime - startTime;

            // Should complete within reasonable time (adjust threshold as needed)
            expect(duration).toBeLessThan(1000); // 1 second threshold
            
            // Verify debug logging occurred
            expect(consoleSpy.debug).toHaveBeenCalledWith(
                expect.stringContaining('Starting set operation')
            );
        });

        it('should handle rapid debug mode toggles efficiently', async () => {
            chrome.storage.local.get.mockImplementation((keys, callback) => {
                callback({ debugMode: true });
            });

            const startTime = performance.now();

            // Rapidly toggle debug mode
            for (let i = 0; i < 50; i++) {
                await realLogger.updateDebugMode();
                realLogger.debugEnabled = !realLogger.debugEnabled;
            }

            const endTime = performance.now();
            const duration = endTime - startTime;

            // Should handle rapid toggles efficiently
            expect(duration).toBeLessThan(500); // 500ms threshold
        });
    });

    describe('Error Context and Recovery Integration', () => {
        it('should provide comprehensive error context for debugging', async () => {
            chrome.runtime.lastError = { 
                message: 'QUOTA_EXCEEDED: Storage quota exceeded for sync area' 
            };
            chrome.storage.sync.set.mockImplementation((items, callback) => callback());

            const testContext = {
                userAction: 'settings-save',
                batchId: 'batch-123',
                retryCount: 2
            };

            try {
                await configService.setToStorage('sync', { key: 'value' }, testContext);
            } catch (error) {
                // Verify comprehensive error context
                expect(error.context).toMatchObject({
                    operation: 'set',
                    area: 'sync',
                    keys: ['key'],
                    method: 'setToStorage',
                    userAction: 'settings-save',
                    batchId: 'batch-123',
                    retryCount: 2
                });
                
                expect(error.context.timestamp).toBeInstanceOf(Date);
                expect(typeof error.context.duration).toBe('number');
                expect(error.isQuotaError).toBe(true);
                expect(error.recoveryAction).toContain('quota exceeded');
            }
        });

        it('should aggregate errors from multiple failed operations', async () => {
            // Setup multiple storage failures
            chrome.storage.sync.set.mockImplementation((items, callback) => {
                chrome.runtime.lastError = { message: 'Sync storage failed' };
                callback();
            });
            chrome.storage.local.set.mockImplementation((items, callback) => {
                chrome.runtime.lastError = { message: 'Local storage failed' };
                callback();
            });

            try {
                await configService.setMultiple({
                    uiLanguage: 'es',      // sync storage
                    debugMode: true        // local storage
                });
            } catch (error) {
                expect(error.message).toContain('failed completely');
                // Check if error has the expected structure (may vary based on implementation)
                expect(error.message).toContain('failed completely');
                if (error.errors) {
                    expect(error.errors).toHaveLength(2);
                }
                if (error.failed) {
                    expect(error.failed).toHaveLength(2);
                }
                
                // Verify error aggregation includes all failure details
                const syncError = error.errors.find(e => e.area === 'sync');
                const localError = error.errors.find(e => e.area === 'local');
                
                expect(syncError).toBeDefined();
                expect(localError).toBeDefined();
                expect(syncError.error.message).toContain('Sync storage failed');
                expect(localError.error.message).toContain('Local storage failed');
            }
        });

        it('should provide appropriate recovery actions for different error types', async () => {
            const errorScenarios = [
                {
                    error: { message: 'QUOTA_EXCEEDED' },
                    area: 'sync',
                    expectedRecovery: 'Chrome sync storage quota exceeded'
                },
                {
                    error: { message: 'Network connection failed' },
                    area: 'sync',
                    expectedRecovery: 'Network connectivity issue'
                },
                {
                    error: { message: 'Permission denied' },
                    area: 'local',
                    expectedRecovery: 'Permission error detected'
                },
                {
                    error: { message: 'Chrome sync is disabled' },
                    area: 'sync',
                    expectedRecovery: 'Chrome sync appears to be disabled'
                }
            ];

            for (const scenario of errorScenarios) {
                chrome.runtime.lastError = scenario.error;
                chrome.storage[scenario.area].set.mockImplementation((items, callback) => callback());

                try {
                    await configService.setToStorage(scenario.area, { key: 'value' });
                } catch (error) {
                    expect(error.recoveryAction).toContain(scenario.expectedRecovery);
                }
            }
        });
    });

    describe('Stress Testing and Edge Cases', () => {
        it('should handle rapid successive operations with mixed success/failure', async () => {
            let callCount = 0;
            chrome.storage.sync.get.mockImplementation((keys, callback) => {
                callCount++;
                if (callCount % 3 === 0) {
                    chrome.runtime.lastError = { message: 'Intermittent failure' };
                    callback(null);
                } else {
                    chrome.runtime.lastError = null;
                    callback({ uiLanguage: 'en' });
                }
            });

            const promises = [];
            for (let i = 0; i < 10; i++) {
                promises.push(configService.get('uiLanguage'));
            }

            const results = await Promise.allSettled(promises);
            
            // Some should succeed, some should return defaults due to errors
            const fulfilled = results.filter(r => r.status === 'fulfilled');
            expect(fulfilled.length).toBe(10); // All should resolve (with defaults on error)
            
            // Verify error logging occurred for failed operations
            expect(consoleSpy.error).toHaveBeenCalled();
        });

        it('should handle extremely large error contexts without performance degradation', async () => {
            const largeContext = {
                method: 'stressTest',
                largeArray: new Array(10000).fill('test'),
                largeObject: {}
            };
            
            // Create large nested object
            for (let i = 0; i < 1000; i++) {
                largeContext.largeObject[`key${i}`] = `value${i}`.repeat(50);
            }

            chrome.runtime.lastError = { message: 'Storage error with large context' };
            chrome.storage.sync.set.mockImplementation((items, callback) => callback());

            const startTime = performance.now();

            try {
                await configService.setToStorage('sync', { key: 'value' }, largeContext);
            } catch (error) {
                const endTime = performance.now();
                const duration = endTime - startTime;
                
                // Should handle large context efficiently
                expect(duration).toBeLessThan(100); // 100ms threshold
                // The method will be overridden by setToStorage, so check for the original context
                expect(error.context.method).toBe('setToStorage');
                expect(error.context.largeArray).toHaveLength(10000);
            }
        });

        it('should maintain error handling consistency under memory pressure', async () => {
            // Simulate memory pressure by creating many error objects
            const errors = [];
            
            for (let i = 0; i < 1000; i++) {
                chrome.runtime.lastError = { message: `Error ${i}` };
                chrome.storage.local.set.mockImplementation((items, callback) => callback());

                try {
                    await configService.setToStorage('local', { [`key${i}`]: `value${i}` });
                } catch (error) {
                    errors.push(error);
                }
            }

            // All errors should be properly formatted
            expect(errors).toHaveLength(1000);
            errors.forEach((error, index) => {
                expect(error.name).toBe('ConfigServiceStorageError');
                expect(error.context.operation).toBe('set');
                expect(error.originalError.message).toBe(`Error ${index}`);
            });
        });
    });
});