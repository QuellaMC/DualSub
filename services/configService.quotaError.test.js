// services/configService.quotaError.test.js
import { jest } from '@jest/globals';
import { configService } from './configService.js';
import { ConfigServiceErrorHandler } from './configServiceErrorHandler.js';

// Mock Chrome storage API
const mockChromeStorage = {
    sync: {
        get: jest.fn(),
        set: jest.fn(),
        remove: jest.fn()
    },
    local: {
        get: jest.fn(),
        set: jest.fn(),
        remove: jest.fn()
    }
};

const mockChromeRuntime = {
    lastError: null
};

global.chrome = {
    storage: mockChromeStorage,
    runtime: mockChromeRuntime
};

// Logger will be mocked through the configService instance

describe('ConfigService Quota Exceeded Error Handling', () => {
    let mockLogger;

    beforeEach(() => {
        jest.clearAllMocks();
        mockChromeRuntime.lastError = null;
        
        // Mock the logger methods
        mockLogger = {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            updateDebugMode: jest.fn().mockResolvedValue()
        };
        
        // Replace the logger in configService
        configService.logger = mockLogger;
    });

    describe('getFromStorage quota error handling', () => {
        it('should detect and handle quota exceeded errors during get operations', async () => {
            const quotaError = { message: 'QUOTA_EXCEEDED' };
            mockChromeRuntime.lastError = quotaError;
            
            mockChromeStorage.sync.get.mockImplementation((keys, callback) => {
                callback({});
            });

            await expect(configService.getFromStorage('sync', ['testKey'])).rejects.toThrow();
            
            // Verify quota-specific error logging was called
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Storage quota exceeded during get operation',
                expect.objectContaining({
                    isQuotaError: true,
                    recoveryAction: expect.stringContaining('Chrome sync storage quota exceeded')
                }),
                expect.objectContaining({
                    quotaError: true,
                    recoveryAction: expect.stringContaining('Chrome sync storage quota exceeded')
                })
            );
        });

        it('should handle non-quota errors normally during get operations', async () => {
            const networkError = { message: 'Network connection failed' };
            mockChromeRuntime.lastError = networkError;
            
            mockChromeStorage.local.get.mockImplementation((keys, callback) => {
                callback({});
            });

            await expect(configService.getFromStorage('local', ['testKey'])).rejects.toThrow();
            
            // Verify normal error logging was called (not quota-specific)
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Storage get operation failed',
                expect.objectContaining({
                    isQuotaError: false
                }),
                expect.not.objectContaining({
                    quotaError: true
                })
            );
        });

        it('should include recovery actions in quota error context', async () => {
            const quotaError = { message: 'Storage quota exceeded' };
            mockChromeRuntime.lastError = quotaError;
            
            mockChromeStorage.sync.get.mockImplementation((keys, callback) => {
                callback({});
            });

            try {
                await configService.getFromStorage('sync', ['testKey']);
            } catch (error) {
                expect(error.isQuotaError).toBe(true);
                expect(error.recoveryAction).toContain('Chrome sync storage quota exceeded');
                expect(error.recoveryAction).toContain('Moving non-essential settings to local storage');
            }
        });
    });

    describe('setToStorage quota error handling', () => {
        it('should detect and handle quota exceeded errors during set operations', async () => {
            const quotaError = { message: 'QUOTA_EXCEEDED_PER_ITEM' };
            mockChromeRuntime.lastError = quotaError;
            
            mockChromeStorage.local.set.mockImplementation((items, callback) => {
                callback();
            });

            await expect(configService.setToStorage('local', { testKey: 'value' })).rejects.toThrow();
            
            // Verify quota-specific error logging was called
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Storage quota exceeded during set operation',
                expect.objectContaining({
                    isQuotaError: true,
                    recoveryAction: expect.stringContaining('Local storage quota exceeded')
                }),
                expect.objectContaining({
                    quotaError: true,
                    recoveryAction: expect.stringContaining('Local storage quota exceeded')
                })
            );
        });

        it('should provide different recovery actions for sync vs local storage', async () => {
            // Test sync storage quota error
            const syncQuotaError = { message: 'quota exceeded' };
            mockChromeRuntime.lastError = syncQuotaError;
            
            mockChromeStorage.sync.set.mockImplementation((items, callback) => {
                callback();
            });

            try {
                await configService.setToStorage('sync', { testKey: 'value' });
            } catch (error) {
                expect(error.recoveryAction).toContain('Chrome sync storage quota exceeded');
                expect(error.recoveryAction).toContain('Moving non-essential settings to local storage');
            }

            // Reset and test local storage quota error
            jest.clearAllMocks();
            const localQuotaError = { message: 'storage quota' };
            mockChromeRuntime.lastError = localQuotaError;
            
            mockChromeStorage.local.set.mockImplementation((items, callback) => {
                callback();
            });

            try {
                await configService.setToStorage('local', { testKey: 'value' });
            } catch (error) {
                expect(error.recoveryAction).toContain('Local storage quota exceeded');
                expect(error.recoveryAction).toContain('Clearing browser data');
            }
        });

        it('should handle multiple keys in quota error context', async () => {
            const quotaError = { message: 'Maximum storage limit reached' };
            mockChromeRuntime.lastError = quotaError;
            
            mockChromeStorage.sync.set.mockImplementation((items, callback) => {
                callback();
            });

            const multipleItems = { key1: 'value1', key2: 'value2', key3: 'value3' };
            
            try {
                await configService.setToStorage('sync', multipleItems);
            } catch (error) {
                expect(error.context.keys).toEqual(['key1', 'key2', 'key3']);
                expect(error.context.itemCount).toBe(3);
                expect(error.isQuotaError).toBe(true);
            }
        });
    });

    describe('removeFromStorage quota error handling', () => {
        it('should detect and handle quota exceeded errors during remove operations', async () => {
            const quotaError = { message: 'quota_bytes_per_item exceeded' };
            mockChromeRuntime.lastError = quotaError;
            
            mockChromeStorage.sync.remove.mockImplementation((keys, callback) => {
                callback();
            });

            await expect(configService.removeFromStorage('sync', ['testKey'])).rejects.toThrow();
            
            // Verify quota-specific error logging was called
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Storage quota exceeded during remove operation',
                expect.objectContaining({
                    isQuotaError: true,
                    recoveryAction: expect.stringContaining('Chrome sync storage quota exceeded')
                }),
                expect.objectContaining({
                    quotaError: true,
                    recoveryAction: expect.stringContaining('Chrome sync storage quota exceeded')
                })
            );
        });

        it('should handle single key and array of keys for remove operations', async () => {
            const quotaError = { message: 'max_write_operations_per_minute' };
            mockChromeRuntime.lastError = quotaError;
            
            mockChromeStorage.local.remove.mockImplementation((keys, callback) => {
                callback();
            });

            // Test single key
            try {
                await configService.removeFromStorage('local', 'singleKey');
            } catch (error) {
                expect(error.context.keys).toEqual(['singleKey']);
                expect(error.isQuotaError).toBe(true);
            }

            // Reset and test multiple keys
            jest.clearAllMocks();
            mockChromeRuntime.lastError = quotaError;
            
            try {
                await configService.removeFromStorage('local', ['key1', 'key2']);
            } catch (error) {
                expect(error.context.keys).toEqual(['key1', 'key2']);
                expect(error.context.keyCount).toBe(2);
                expect(error.isQuotaError).toBe(true);
            }
        });
    });

    describe('quota error integration with ConfigServiceErrorHandler', () => {
        it('should properly integrate quota detection with error handler', () => {
            const quotaError = new Error('QUOTA_EXCEEDED');
            const enhancedError = ConfigServiceErrorHandler.createStorageError(
                'set',
                'sync',
                ['testKey'],
                quotaError
            );

            expect(enhancedError.isQuotaError).toBe(true);
            expect(enhancedError.recoveryAction).toContain('Chrome sync storage quota exceeded');
            expect(enhancedError.context.operation).toBe('set');
            expect(enhancedError.context.area).toBe('sync');
        });

        it('should detect various quota error message formats', () => {
            const quotaErrorFormats = [
                'QUOTA_EXCEEDED',
                'quota exceeded',
                'Storage quota has been exceeded',
                'maximum storage limit',
                'quota_bytes_per_item',
                'max_write_operations_per_hour'
            ];

            quotaErrorFormats.forEach(errorMessage => {
                const error = new Error(errorMessage);
                expect(ConfigServiceErrorHandler.isQuotaExceededError(error)).toBe(true);
            });
        });

        it('should provide appropriate recovery actions for different quota scenarios', () => {
            // Sync storage quota
            const syncError = {
                message: 'quota exceeded',
                context: { area: 'sync' }
            };
            const syncAction = ConfigServiceErrorHandler.getErrorRecoveryAction(syncError);
            expect(syncAction).toContain('Chrome sync storage quota exceeded');
            expect(syncAction).toContain('Moving non-essential settings to local storage');

            // Local storage quota
            const localError = {
                message: 'storage quota',
                context: { area: 'local' }
            };
            const localAction = ConfigServiceErrorHandler.getErrorRecoveryAction(localError);
            expect(localAction).toContain('Local storage quota exceeded');
            expect(localAction).toContain('Clearing browser data');
        });
    });

    describe('error logging context for quota errors', () => {
        it('should include comprehensive context in quota error logs', async () => {
            const quotaError = { message: 'Storage quota exceeded' };
            mockChromeRuntime.lastError = quotaError;
            
            mockChromeStorage.sync.set.mockImplementation((items, callback) => {
                setTimeout(callback, 10); // Simulate some duration
            });

            const testItems = { key1: 'value1', key2: 'value2' };
            const testContext = { method: 'testMethod', operation: 'test-operation' };

            try {
                await configService.setToStorage('sync', testItems, testContext);
            } catch {
                // Verify the error logging includes all expected context
                expect(mockLogger.error).toHaveBeenCalledWith(
                    'Storage quota exceeded during set operation',
                    expect.objectContaining({
                        isQuotaError: true,
                        recoveryAction: expect.any(String),
                        name: 'ConfigServiceStorageError'
                    }),
                    expect.objectContaining({
                        area: 'sync',
                        keys: ['key1', 'key2'],
                        duration: expect.any(Number),
                        itemCount: 2,
                        context: testContext,
                        quotaError: true,
                        recoveryAction: expect.any(String)
                    })
                );
            }
        });

        it('should differentiate quota error logs from regular error logs', async () => {
            // Test quota error
            const quotaError = { message: 'quota exceeded' };
            mockChromeRuntime.lastError = quotaError;
            
            mockChromeStorage.sync.get.mockImplementation((keys, callback) => {
                callback({});
            });

            try {
                await configService.getFromStorage('sync', ['testKey']);
            } catch {
                expect(mockLogger.error).toHaveBeenCalledWith(
                    'Storage quota exceeded during get operation',
                    expect.any(Object),
                    expect.objectContaining({ quotaError: true })
                );
            }

            // Reset and test regular error
            jest.clearAllMocks();
            const regularError = { message: 'Network error' };
            mockChromeRuntime.lastError = regularError;

            try {
                await configService.getFromStorage('sync', ['testKey']);
            } catch {
                expect(mockLogger.error).toHaveBeenCalledWith(
                    'Storage get operation failed',
                    expect.any(Object),
                    expect.not.objectContaining({ quotaError: true })
                );
            }
        });
    });

    describe('quota error message enhancement', () => {
        it('should enhance error messages with quota-specific guidance', async () => {
            const quotaError = { message: 'QUOTA_EXCEEDED' };
            mockChromeRuntime.lastError = quotaError;
            
            mockChromeStorage.sync.set.mockImplementation((items, callback) => {
                callback();
            });

            try {
                await configService.setToStorage('sync', { testKey: 'testValue' });
            } catch (error) {
                expect(error.message).toContain('set operation failed');
                expect(error.message).toContain('sync storage');
                expect(error.message).toContain('QUOTA_EXCEEDED');
                expect(error.isQuotaError).toBe(true);
                expect(error.recoveryAction).toContain('Chrome sync storage quota exceeded');
            }
        });

        it('should include quota-specific guidance in error messages', async () => {
            const quotaError = { message: 'Storage quota has been exceeded' };
            mockChromeRuntime.lastError = quotaError;
            
            mockChromeStorage.local.set.mockImplementation((items, callback) => {
                callback();
            });

            try {
                await configService.setToStorage('local', { largeData: 'x'.repeat(1000) });
            } catch (error) {
                expect(error.recoveryAction).toContain('Local storage quota exceeded');
                expect(error.recoveryAction).toContain('Clearing browser data');
                expect(error.recoveryAction).toContain('data cleanup routines');
            }
        });
    });
});