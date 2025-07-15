// services/configService.storage.test.js
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

// Setup Chrome API mocks
global.chrome = {
    storage: mockChromeStorage,
    runtime: mockChromeRuntime
};

describe('ConfigService Enhanced Storage Operations', () => {
    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();
        mockChromeRuntime.lastError = null;
        
        // Reset storage mocks to default success behavior
        Object.values(mockChromeStorage).forEach(area => {
            area.get.mockImplementation((keys, callback) => callback({}));
            area.set.mockImplementation((items, callback) => callback());
            area.remove.mockImplementation((keys, callback) => callback());
        });
    });

    describe('getFromStorage', () => {
        it('should successfully retrieve data from sync storage', async () => {
            const testData = { key1: 'value1', key2: 'value2' };
            mockChromeStorage.sync.get.mockImplementation((keys, callback) => {
                callback(testData);
            });

            const result = await configService.getFromStorage('sync', ['key1', 'key2']);
            
            expect(result).toEqual(testData);
            expect(mockChromeStorage.sync.get).toHaveBeenCalledWith(['key1', 'key2'], expect.any(Function));
        });

        it('should successfully retrieve data from local storage', async () => {
            const testData = { key1: 'value1' };
            mockChromeStorage.local.get.mockImplementation((keys, callback) => {
                callback(testData);
            });

            const result = await configService.getFromStorage('local', ['key1']);
            
            expect(result).toEqual(testData);
            expect(mockChromeStorage.local.get).toHaveBeenCalledWith(['key1'], expect.any(Function));
        });

        it('should handle single key as string parameter', async () => {
            const testData = { key1: 'value1' };
            mockChromeStorage.sync.get.mockImplementation((keys, callback) => {
                callback(testData);
            });

            const result = await configService.getFromStorage('sync', 'key1');
            
            expect(result).toEqual(testData);
            expect(mockChromeStorage.sync.get).toHaveBeenCalledWith('key1', expect.any(Function));
        });

        it('should reject with enhanced error when Chrome storage fails', async () => {
            const chromeError = { message: 'Storage quota exceeded' };
            mockChromeRuntime.lastError = chromeError;
            mockChromeStorage.sync.get.mockImplementation((keys, callback) => {
                callback(null);
            });

            await expect(configService.getFromStorage('sync', ['key1'])).rejects.toThrow();
            
            try {
                await configService.getFromStorage('sync', ['key1']);
            } catch (error) {
                expect(error.name).toBe('ConfigServiceStorageError');
                expect(error.context.operation).toBe('get');
                expect(error.context.area).toBe('sync');
                expect(error.context.keys).toEqual(['key1']);
                expect(error.originalError).toBe(chromeError);
                expect(error.isQuotaError).toBe(true);
            }
        });

        it('should include timing information in error context', async () => {
            const chromeError = { message: 'Network error' };
            mockChromeRuntime.lastError = chromeError;
            mockChromeStorage.local.get.mockImplementation((keys, callback) => {
                // Simulate delay
                setTimeout(() => callback(null), 10);
            });

            try {
                await configService.getFromStorage('local', ['key1']);
            } catch (error) {
                expect(error.context.duration).toBeGreaterThan(0);
                expect(error.context.method).toBe('getFromStorage');
            }
        });

        it('should include additional context when provided', async () => {
            const chromeError = { message: 'Access denied' };
            mockChromeRuntime.lastError = chromeError;
            mockChromeStorage.sync.get.mockImplementation((keys, callback) => {
                callback(null);
            });

            const additionalContext = { callingMethod: 'get', userId: 'test123' };

            try {
                await configService.getFromStorage('sync', ['key1'], additionalContext);
            } catch (error) {
                expect(error.context.callingMethod).toBe('get');
                expect(error.context.userId).toBe('test123');
            }
        });
    });

    describe('setToStorage', () => {
        it('should successfully set data to sync storage', async () => {
            const testData = { key1: 'value1', key2: 'value2' };
            
            await configService.setToStorage('sync', testData);
            
            expect(mockChromeStorage.sync.set).toHaveBeenCalledWith(testData, expect.any(Function));
        });

        it('should successfully set data to local storage', async () => {
            const testData = { key1: 'value1' };
            
            await configService.setToStorage('local', testData);
            
            expect(mockChromeStorage.local.set).toHaveBeenCalledWith(testData, expect.any(Function));
        });

        it('should reject with enhanced error when Chrome storage fails', async () => {
            const chromeError = { message: 'Storage quota exceeded' };
            mockChromeRuntime.lastError = chromeError;
            mockChromeStorage.sync.set.mockImplementation((items, callback) => {
                callback();
            });

            const testData = { key1: 'value1', key2: 'value2' };

            await expect(configService.setToStorage('sync', testData)).rejects.toThrow();
            
            try {
                await configService.setToStorage('sync', testData);
            } catch (error) {
                expect(error.name).toBe('ConfigServiceStorageError');
                expect(error.context.operation).toBe('set');
                expect(error.context.area).toBe('sync');
                expect(error.context.keys).toEqual(['key1', 'key2']);
                expect(error.context.itemCount).toBe(2);
                expect(error.originalError).toBe(chromeError);
                expect(error.isQuotaError).toBe(true);
            }
        });

        it('should include timing and item count in error context', async () => {
            const chromeError = { message: 'Network error' };
            mockChromeRuntime.lastError = chromeError;
            mockChromeStorage.local.set.mockImplementation((items, callback) => {
                setTimeout(() => callback(), 10);
            });

            const testData = { key1: 'value1', key2: 'value2', key3: 'value3' };

            try {
                await configService.setToStorage('local', testData);
            } catch (error) {
                expect(error.context.duration).toBeGreaterThan(0);
                expect(error.context.method).toBe('setToStorage');
                expect(error.context.itemCount).toBe(3);
            }
        });

        it('should handle quota exceeded errors specifically', async () => {
            const chromeError = { message: 'QUOTA_BYTES_PER_ITEM quota exceeded' };
            mockChromeRuntime.lastError = chromeError;
            mockChromeStorage.sync.set.mockImplementation((items, callback) => {
                callback();
            });

            try {
                await configService.setToStorage('sync', { key1: 'value1' });
            } catch (error) {
                expect(error.isQuotaError).toBe(true);
                expect(error.recoveryAction).toContain('quota exceeded');
                expect(error.recoveryAction).toContain('sync storage');
            }
        });
    });

    describe('removeFromStorage', () => {
        it('should successfully remove data from sync storage', async () => {
            const keysToRemove = ['key1', 'key2'];
            
            await configService.removeFromStorage('sync', keysToRemove);
            
            expect(mockChromeStorage.sync.remove).toHaveBeenCalledWith(keysToRemove, expect.any(Function));
        });

        it('should successfully remove data from local storage', async () => {
            const keyToRemove = 'key1';
            
            await configService.removeFromStorage('local', keyToRemove);
            
            expect(mockChromeStorage.local.remove).toHaveBeenCalledWith(keyToRemove, expect.any(Function));
        });

        it('should handle single key as string parameter', async () => {
            await configService.removeFromStorage('sync', 'key1');
            
            expect(mockChromeStorage.sync.remove).toHaveBeenCalledWith('key1', expect.any(Function));
        });

        it('should reject with enhanced error when Chrome storage fails', async () => {
            const chromeError = { message: 'Key not found' };
            mockChromeRuntime.lastError = chromeError;
            mockChromeStorage.sync.remove.mockImplementation((keys, callback) => {
                callback();
            });

            const keysToRemove = ['key1', 'key2'];

            await expect(configService.removeFromStorage('sync', keysToRemove)).rejects.toThrow();
            
            try {
                await configService.removeFromStorage('sync', keysToRemove);
            } catch (error) {
                expect(error.name).toBe('ConfigServiceStorageError');
                expect(error.context.operation).toBe('remove');
                expect(error.context.area).toBe('sync');
                expect(error.context.keys).toEqual(keysToRemove);
                expect(error.context.keyCount).toBe(2);
                expect(error.originalError).toBe(chromeError);
            }
        });

        it('should include timing and key count in error context', async () => {
            const chromeError = { message: 'Permission denied' };
            mockChromeRuntime.lastError = chromeError;
            mockChromeStorage.local.remove.mockImplementation((keys, callback) => {
                setTimeout(() => callback(), 10);
            });

            const keysToRemove = ['key1', 'key2', 'key3'];

            try {
                await configService.removeFromStorage('local', keysToRemove);
            } catch (error) {
                expect(error.context.duration).toBeGreaterThan(0);
                expect(error.context.method).toBe('removeFromStorage');
                expect(error.context.keyCount).toBe(3);
            }
        });

        it('should normalize single key to array in error context', async () => {
            const chromeError = { message: 'Storage error' };
            mockChromeRuntime.lastError = chromeError;
            mockChromeStorage.sync.remove.mockImplementation((keys, callback) => {
                callback();
            });

            try {
                await configService.removeFromStorage('sync', 'singleKey');
            } catch (error) {
                expect(error.context.keys).toEqual(['singleKey']);
                expect(error.context.keyCount).toBe(1);
            }
        });
    });

    describe('Error Recovery Actions', () => {
        it('should provide appropriate recovery actions for different error types', async () => {
            // Test quota error recovery
            mockChromeRuntime.lastError = { message: 'Storage quota exceeded' };
            mockChromeStorage.sync.set.mockImplementation((items, callback) => callback());

            try {
                await configService.setToStorage('sync', { key: 'value' });
            } catch (error) {
                expect(error.recoveryAction).toContain('quota exceeded');
                expect(error.recoveryAction).toContain('sync storage');
            }

            // Test network error recovery
            mockChromeRuntime.lastError = { message: 'Network connection failed' };
            
            try {
                await configService.getFromStorage('sync', ['key']);
            } catch (error) {
                expect(error.recoveryAction).toContain('Network connectivity');
            }

            // Test permission error recovery
            mockChromeRuntime.lastError = { message: 'Access denied' };
            
            try {
                await configService.removeFromStorage('local', ['key']);
            } catch (error) {
                expect(error.recoveryAction).toContain('Permission error');
            }
        });
    });

    describe('Performance and Timing', () => {
        it('should track operation timing for successful operations', async () => {
            const startTime = Date.now();
            
            // Mock a delay in the storage operation
            mockChromeStorage.sync.get.mockImplementation((keys, callback) => {
                setTimeout(() => callback({ key1: 'value1' }), 50);
            });

            const result = await configService.getFromStorage('sync', ['key1']);
            const endTime = Date.now();
            
            expect(result).toEqual({ key1: 'value1' });
            expect(endTime - startTime).toBeGreaterThanOrEqual(40);
        });

        it('should track operation timing for failed operations', async () => {
            mockChromeRuntime.lastError = { message: 'Test error' };
            mockChromeStorage.sync.set.mockImplementation((items, callback) => {
                setTimeout(() => callback(), 30);
            });

            const startTime = Date.now();
            
            try {
                await configService.setToStorage('sync', { key: 'value' });
            } catch (error) {
                const endTime = Date.now();
                expect(error.context.duration).toBeGreaterThanOrEqual(25);
                expect(endTime - startTime).toBeGreaterThanOrEqual(25);
            }
        });
    });

    describe('Context Preservation', () => {
        it('should preserve and enhance context through error handling chain', async () => {
            const originalContext = {
                callingMethod: 'setMultiple',
                batchId: 'batch123',
                userAction: 'settings-save'
            };

            mockChromeRuntime.lastError = { message: 'Storage error' };
            mockChromeStorage.local.set.mockImplementation((items, callback) => callback());

            try {
                await configService.setToStorage('local', { key1: 'value1' }, originalContext);
            } catch (error) {
                // Check that original context is preserved
                expect(error.context.callingMethod).toBe('setMultiple');
                expect(error.context.batchId).toBe('batch123');
                expect(error.context.userAction).toBe('settings-save');
                
                // Check that enhanced context is added
                expect(error.context.operation).toBe('set');
                expect(error.context.area).toBe('local');
                expect(error.context.method).toBe('setToStorage');
                expect(typeof error.context.duration).toBe('number');
                expect(error.context.timestamp).toBeInstanceOf(Date);
            }
        });
    });
});