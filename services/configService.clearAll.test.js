// services/configService.clearAll.test.js
import { jest } from '@jest/globals';
import { configService } from './configService.js';

describe('ConfigService clearAll method error handling', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        chrome.runtime.lastError = null;
    });

    describe('successful clearAll operations', () => {
        test('should successfully clear all storage areas', async () => {
            // Setup successful operations
            chrome.storage.sync.remove.mockImplementation((keys, callback) => {
                setTimeout(callback, 0);
            });
            chrome.storage.local.remove.mockImplementation((keys, callback) => {
                setTimeout(callback, 0);
            });

            await expect(configService.clearAll()).resolves.toBeUndefined();

            expect(chrome.storage.sync.remove).toHaveBeenCalled();
            expect(chrome.storage.local.remove).toHaveBeenCalled();
        });
    });

    describe('complete failure scenarios', () => {
        test('should throw error when both storage areas fail', async () => {
            const syncError = { message: 'Sync storage error' };
            const localError = { message: 'Local storage error' };

            chrome.storage.sync.remove.mockImplementation((keys, callback) => {
                chrome.runtime.lastError = syncError;
                setTimeout(callback, 0);
            });
            chrome.storage.local.remove.mockImplementation((keys, callback) => {
                chrome.runtime.lastError = localError;
                setTimeout(callback, 0);
            });

            await expect(configService.clearAll()).rejects.toThrow();

            expect(chrome.storage.sync.remove).toHaveBeenCalled();
            expect(chrome.storage.local.remove).toHaveBeenCalled();
        });

        test('should throw first error when both operations fail', async () => {
            const syncError = { message: 'Sync storage error' };
            const localError = { message: 'Local storage error' };

            chrome.storage.sync.remove.mockImplementation((keys, callback) => {
                chrome.runtime.lastError = syncError;
                setTimeout(callback, 0);
            });
            chrome.storage.local.remove.mockImplementation((keys, callback) => {
                chrome.runtime.lastError = localError;
                setTimeout(callback, 0);
            });

            try {
                await configService.clearAll();
                fail('Expected clearAll to throw an error');
            } catch (error) {
                expect(error.message).toContain('Sync storage error');
            }
        });
    });

    describe('partial failure scenarios', () => {
        test('should handle sync storage failure with local storage success', async () => {
            const syncError = { message: 'Sync storage quota exceeded' };

            chrome.storage.sync.remove.mockImplementation((keys, callback) => {
                chrome.runtime.lastError = syncError;
                setTimeout(callback, 0);
            });
            chrome.storage.local.remove.mockImplementation((keys, callback) => {
                chrome.runtime.lastError = null;
                setTimeout(callback, 0);
            });

            try {
                await configService.clearAll();
                fail('Expected clearAll to throw an error for partial failure');
            } catch (error) {
                expect(error.message).toContain('partial failures');
                expect(error.partialFailure).toBe(true);
                expect(error.successful).toHaveLength(1);
                expect(error.failed).toHaveLength(1);
                expect(error.errors).toHaveLength(1);
                expect(error.successful[0].area).toBe('local');
                expect(error.failed[0].area).toBe('sync');
            }
        });

        test('should handle local storage failure with sync storage success', async () => {
            const localError = { message: 'Local storage access denied' };

            chrome.storage.sync.remove.mockImplementation((keys, callback) => {
                chrome.runtime.lastError = null;
                setTimeout(callback, 0);
            });
            chrome.storage.local.remove.mockImplementation((keys, callback) => {
                chrome.runtime.lastError = localError;
                setTimeout(callback, 0);
            });

            try {
                await configService.clearAll();
                fail('Expected clearAll to throw an error for partial failure');
            } catch (error) {
                expect(error.message).toContain('partial failures');
                expect(error.partialFailure).toBe(true);
                expect(error.successful).toHaveLength(1);
                expect(error.failed).toHaveLength(1);
                expect(error.errors).toHaveLength(1);
                expect(error.successful[0].area).toBe('sync');
                expect(error.failed[0].area).toBe('local');
            }
        });

        test('should provide detailed error information for partial failures', async () => {
            const syncError = { message: 'Sync quota exceeded' };

            chrome.storage.sync.remove.mockImplementation((keys, callback) => {
                chrome.runtime.lastError = syncError;
                setTimeout(callback, 0);
            });
            chrome.storage.local.remove.mockImplementation((keys, callback) => {
                chrome.runtime.lastError = null;
                setTimeout(callback, 0);
            });

            try {
                await configService.clearAll();
                fail('Expected clearAll to throw an error for partial failure');
            } catch (error) {
                expect(error.partialFailure).toBe(true);
                expect(error.successful).toHaveLength(1);
                expect(error.failed).toHaveLength(1);
                expect(error.errors).toHaveLength(1);
                expect(error.successful[0].area).toBe('local');
                expect(error.failed[0].area).toBe('sync');
                expect(error.errors[0].area).toBe('sync');
                expect(error.errors[0].error.message).toContain(
                    'Sync quota exceeded'
                );
            }
        });
    });

    describe('error aggregation and reporting', () => {
        test('should aggregate errors with proper context', async () => {
            const syncError = { message: 'Sync storage error' };

            chrome.storage.sync.remove.mockImplementation((keys, callback) => {
                chrome.runtime.lastError = syncError;
                setTimeout(callback, 0);
            });
            chrome.storage.local.remove.mockImplementation((keys, callback) => {
                chrome.runtime.lastError = null;
                setTimeout(callback, 0);
            });

            try {
                await configService.clearAll();
                fail('Expected clearAll to throw an error');
            } catch (error) {
                expect(error.partialFailure).toBe(true);
                expect(error.successful).toHaveLength(1);
                expect(error.failed).toHaveLength(1);
                expect(error.errors).toHaveLength(1);

                // Check that error contains proper context
                const errorInfo = error.errors[0];
                expect(errorInfo.area).toBe('sync');
                expect(errorInfo.keys).toBeDefined();
                expect(errorInfo.error).toBeDefined();
            }
        });

        test('should handle single storage area scenarios', async () => {
            const syncError = { message: 'Sync storage error' };
            chrome.storage.sync.remove.mockImplementation((keys, callback) => {
                chrome.runtime.lastError = syncError;
                setTimeout(callback, 0);
            });
            chrome.storage.local.remove.mockImplementation((keys, callback) => {
                chrome.runtime.lastError = null;
                setTimeout(callback, 0);
            });

            try {
                await configService.clearAll();
                fail('Expected clearAll to throw an error');
            } catch (error) {
                expect(error.partialFailure).toBe(true);
                expect(error.successful).toHaveLength(1);
                expect(error.failed).toHaveLength(1);
            }
        });
    });

    describe('Chrome API error simulation', () => {
        test('should handle quota exceeded errors specifically', async () => {
            const quotaError = {
                message: 'QUOTA_BYTES_PER_ITEM quota exceeded',
            };

            chrome.storage.sync.remove.mockImplementation((keys, callback) => {
                chrome.runtime.lastError = quotaError;
                setTimeout(callback, 0);
            });
            chrome.storage.local.remove.mockImplementation((keys, callback) => {
                chrome.runtime.lastError = null;
                setTimeout(callback, 0);
            });

            try {
                await configService.clearAll();
                fail('Expected clearAll to throw an error');
            } catch (error) {
                expect(error.partialFailure).toBe(true);
                expect(error.errors[0].error.message).toContain(
                    'QUOTA_BYTES_PER_ITEM'
                );
            }
        });

        test('should handle network-related errors', async () => {
            const networkError = { message: 'Network error occurred' };

            chrome.storage.sync.remove.mockImplementation((keys, callback) => {
                chrome.runtime.lastError = networkError;
                setTimeout(callback, 0);
            });
            chrome.storage.local.remove.mockImplementation((keys, callback) => {
                chrome.runtime.lastError = null;
                setTimeout(callback, 0);
            });

            try {
                await configService.clearAll();
                fail('Expected clearAll to throw an error');
            } catch (error) {
                expect(error.partialFailure).toBe(true);
                expect(error.errors[0].error.message).toContain(
                    'Network error'
                );
            }
        });

        test('should handle permission denied errors', async () => {
            const permissionError = { message: 'Access denied' };

            chrome.storage.local.remove.mockImplementation((keys, callback) => {
                chrome.runtime.lastError = permissionError;
                setTimeout(callback, 0);
            });
            chrome.storage.sync.remove.mockImplementation((keys, callback) => {
                chrome.runtime.lastError = null;
                setTimeout(callback, 0);
            });

            try {
                await configService.clearAll();
                fail('Expected clearAll to throw an error');
            } catch (error) {
                expect(error.partialFailure).toBe(true);
                expect(error.errors[0].error.message).toContain(
                    'Access denied'
                );
            }
        });
    });

    describe('edge cases', () => {
        test('should handle undefined chrome.runtime.lastError properly', async () => {
            chrome.storage.sync.remove.mockImplementation((keys, callback) => {
                chrome.runtime.lastError = undefined;
                setTimeout(callback, 0);
            });
            chrome.storage.local.remove.mockImplementation((keys, callback) => {
                chrome.runtime.lastError = undefined;
                setTimeout(callback, 0);
            });

            await expect(configService.clearAll()).resolves.toBeUndefined();
        });

        test('should handle null chrome.runtime.lastError properly', async () => {
            chrome.storage.sync.remove.mockImplementation((keys, callback) => {
                chrome.runtime.lastError = null;
                setTimeout(callback, 0);
            });
            chrome.storage.local.remove.mockImplementation((keys, callback) => {
                chrome.runtime.lastError = null;
                setTimeout(callback, 0);
            });

            await expect(configService.clearAll()).resolves.toBeUndefined();
        });
    });

    describe('error message validation', () => {
        test('should provide descriptive error messages for complete failures', async () => {
            const syncError = { message: 'Sync error' };
            const localError = { message: 'Local error' };

            chrome.storage.sync.remove.mockImplementation((keys, callback) => {
                chrome.runtime.lastError = syncError;
                setTimeout(callback, 0);
            });
            chrome.storage.local.remove.mockImplementation((keys, callback) => {
                chrome.runtime.lastError = localError;
                setTimeout(callback, 0);
            });

            try {
                await configService.clearAll();
                fail('Expected clearAll to throw an error');
            } catch (error) {
                // The first error thrown should be from the sync storage operation
                expect(error.message).toContain('Sync error');
                expect(error.name).toBe('ConfigServiceStorageError');
            }
        });

        test('should provide descriptive error messages for partial failures', async () => {
            const syncError = { message: 'Sync error' };

            chrome.storage.sync.remove.mockImplementation((keys, callback) => {
                chrome.runtime.lastError = syncError;
                setTimeout(callback, 0);
            });
            chrome.storage.local.remove.mockImplementation((keys, callback) => {
                chrome.runtime.lastError = null;
                setTimeout(callback, 0);
            });

            try {
                await configService.clearAll();
                fail('Expected clearAll to throw an error');
            } catch (error) {
                expect(error.message).toContain(
                    'clearAll() completed with partial failures'
                );
                expect(error.message).toContain('1 area(s) succeeded');
                expect(error.message).toContain('1 area(s) failed');
            }
        });
    });
});
