// services/configService.multiOperation.test.js
import { jest } from '@jest/globals';
import { configService } from './configService.js';
import { configSchema } from '../config/configSchema.js';

// Mock Chrome storage API
const mockChromeStorage = {
    sync: {
        get: jest.fn(),
        set: jest.fn(),
        remove: jest.fn(),
    },
    local: {
        get: jest.fn(),
        set: jest.fn(),
        remove: jest.fn(),
    },
    onChanged: {
        addListener: jest.fn(),
    },
};

const mockChromeRuntime = {
    lastError: null,
    onInstalled: {
        addListener: jest.fn(),
    },
};

// Setup global mocks
global.chrome = {
    storage: mockChromeStorage,
    runtime: mockChromeRuntime,
};

describe('ConfigService Multi-Operation Error Handling', () => {
    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();
        mockChromeRuntime.lastError = null;

        // Reset service state
        configService.isInitialized = false;
        configService.changeListeners.clear();
    });

    describe('setMultiple() error handling', () => {
        test('should handle validation errors with detailed information', async () => {
            const invalidSettings = {
                validKey1: 'validValue',
                invalidKey: 'someValue',
                validKey2: 123,
                anotherInvalidKey: 'anotherValue',
            };

            // Mock schema to have only validKey1 and validKey2
            const originalSchema = { ...configSchema };
            Object.keys(configSchema).forEach(
                (key) => delete configSchema[key]
            );
            configSchema.validKey1 = {
                defaultValue: 'default1',
                type: String,
                scope: 'sync',
            };
            configSchema.validKey2 = {
                defaultValue: 0,
                type: Number,
                scope: 'local',
            };

            try {
                await configService.setMultiple(invalidSettings);
                fail('Expected setMultiple to throw validation error');
            } catch (error) {
                expect(error.message).toContain('validation error(s)');
                expect(error.validationErrors).toHaveLength(2);
                expect(error.validationErrors[0].key).toBe('invalidKey');
                expect(error.validationErrors[0].type).toBe('invalid_key');
                expect(error.validationErrors[1].key).toBe('anotherInvalidKey');
                expect(error.validationErrors[1].type).toBe('invalid_key');
                expect(error.totalSettings).toBe(4);
                expect(error.validSettings).toBe(2);
            }

            // Restore original schema
            Object.keys(configSchema).forEach(
                (key) => delete configSchema[key]
            );
            Object.assign(configSchema, originalSchema);
        });

        test('should handle partial storage failures with detailed error aggregation', async () => {
            const settings = {
                syncKey1: 'value1',
                syncKey2: 'value2',
                localKey1: 'value3',
                localKey2: 'value4',
            };

            // Mock schema
            const originalSchema = { ...configSchema };
            Object.keys(configSchema).forEach(
                (key) => delete configSchema[key]
            );
            configSchema.syncKey1 = {
                defaultValue: 'default1',
                type: String,
                scope: 'sync',
            };
            configSchema.syncKey2 = {
                defaultValue: 'default2',
                type: String,
                scope: 'sync',
            };
            configSchema.localKey1 = {
                defaultValue: 'default3',
                type: String,
                scope: 'local',
            };
            configSchema.localKey2 = {
                defaultValue: 'default4',
                type: String,
                scope: 'local',
            };

            // Mock sync storage to succeed, local storage to fail
            mockChromeStorage.sync.set.mockImplementation((items, callback) => {
                callback();
            });

            mockChromeStorage.local.set.mockImplementation(
                (items, callback) => {
                    mockChromeRuntime.lastError = {
                        message: 'Local storage quota exceeded',
                    };
                    callback();
                }
            );

            try {
                await configService.setMultiple(settings);
                fail('Expected setMultiple to throw partial failure error');
            } catch (error) {
                expect(error.message).toContain('partial failures');
                expect(error.partialFailure).toBe(true);
                expect(error.successful).toHaveLength(1);
                expect(error.successful[0].area).toBe('sync');
                expect(error.successful[0].count).toBe(2);
                expect(error.failed).toHaveLength(1);
                expect(error.failed[0].area).toBe('local');
                expect(error.failed[0].count).toBe(2);
                expect(error.errors).toHaveLength(1);
                expect(error.totalKeysAttempted).toBe(4);
                expect(error.totalKeysSet).toBe(2);
                expect(error.totalKeysFailed).toBe(2);
            }

            // Restore original schema
            Object.keys(configSchema).forEach(
                (key) => delete configSchema[key]
            );
            Object.assign(configSchema, originalSchema);
        });

        test('should handle complete storage failures', async () => {
            const settings = {
                syncKey1: 'value1',
                localKey1: 'value2',
            };

            // Mock schema
            const originalSchema = { ...configSchema };
            Object.keys(configSchema).forEach(
                (key) => delete configSchema[key]
            );
            configSchema.syncKey1 = {
                defaultValue: 'default1',
                type: String,
                scope: 'sync',
            };
            configSchema.localKey1 = {
                defaultValue: 'default2',
                type: String,
                scope: 'local',
            };

            // Mock both storage areas to fail
            mockChromeStorage.sync.set.mockImplementation((items, callback) => {
                mockChromeRuntime.lastError = { message: 'Sync storage error' };
                callback();
            });

            mockChromeStorage.local.set.mockImplementation(
                (items, callback) => {
                    mockChromeRuntime.lastError = {
                        message: 'Local storage error',
                    };
                    callback();
                }
            );

            try {
                await configService.setMultiple(settings);
                fail('Expected setMultiple to throw complete failure error');
            } catch (error) {
                expect(error.message).toContain('failed completely');
                expect(error.completeFailure).toBe(true);
                expect(error.failed).toHaveLength(2);
                expect(error.errors).toHaveLength(2);
                expect(error.totalKeysAttempted).toBe(2);
            }

            // Restore original schema
            Object.keys(configSchema).forEach(
                (key) => delete configSchema[key]
            );
            Object.assign(configSchema, originalSchema);
        });

        test('should succeed with proper logging when all operations complete', async () => {
            const settings = {
                syncKey1: 'value1',
                localKey1: 'value2',
            };

            // Mock schema
            const originalSchema = { ...configSchema };
            Object.keys(configSchema).forEach(
                (key) => delete configSchema[key]
            );
            configSchema.syncKey1 = {
                defaultValue: 'default1',
                type: String,
                scope: 'sync',
            };
            configSchema.localKey1 = {
                defaultValue: 'default2',
                type: String,
                scope: 'local',
            };

            // Mock both storage areas to succeed
            mockChromeStorage.sync.set.mockImplementation((items, callback) => {
                callback();
            });

            mockChromeStorage.local.set.mockImplementation(
                (items, callback) => {
                    callback();
                }
            );

            await expect(
                configService.setMultiple(settings)
            ).resolves.toBeUndefined();

            expect(mockChromeStorage.sync.set).toHaveBeenCalledWith(
                { syncKey1: 'value1' },
                expect.any(Function)
            );
            expect(mockChromeStorage.local.set).toHaveBeenCalledWith(
                { localKey1: 'value2' },
                expect.any(Function)
            );

            // Restore original schema
            Object.keys(configSchema).forEach(
                (key) => delete configSchema[key]
            );
            Object.assign(configSchema, originalSchema);
        });
    });

    describe('setDefaultsForMissingKeys() error handling', () => {
        test('should handle retrieval errors and continue with setting defaults', async () => {
            // Mock schema
            const originalSchema = { ...configSchema };
            Object.keys(configSchema).forEach(
                (key) => delete configSchema[key]
            );
            configSchema.syncKey1 = {
                defaultValue: 'syncDefault1',
                type: String,
                scope: 'sync',
            };
            configSchema.localKey1 = {
                defaultValue: 'localDefault1',
                type: String,
                scope: 'local',
            };

            // Mock sync get to fail, local get to succeed but return empty
            mockChromeStorage.sync.get.mockImplementation((keys, callback) => {
                mockChromeRuntime.lastError = {
                    message: 'Sync storage retrieval failed',
                };
                callback({});
            });

            mockChromeStorage.local.get.mockImplementation((keys, callback) => {
                mockChromeRuntime.lastError = null; // Reset error for local get
                callback({}); // Empty, so defaults will be set
            });

            // Mock set operations to succeed
            mockChromeStorage.sync.set.mockImplementation((items, callback) => {
                mockChromeRuntime.lastError = null; // Reset error for sync set
                callback();
            });

            mockChromeStorage.local.set.mockImplementation(
                (items, callback) => {
                    mockChromeRuntime.lastError = null; // Reset error for local set
                    callback();
                }
            );

            await configService.setDefaultsForMissingKeys();

            expect(configService.isInitialized).toBe(true);
            expect(mockChromeStorage.sync.set).toHaveBeenCalledWith(
                { syncKey1: 'syncDefault1' },
                expect.any(Function)
            );
            expect(mockChromeStorage.local.set).toHaveBeenCalledWith(
                { localKey1: 'localDefault1' },
                expect.any(Function)
            );

            // Restore original schema
            Object.keys(configSchema).forEach(
                (key) => delete configSchema[key]
            );
            Object.assign(configSchema, originalSchema);
        });

        test('should handle partial failures in setting defaults', async () => {
            // Mock schema
            const originalSchema = { ...configSchema };
            Object.keys(configSchema).forEach(
                (key) => delete configSchema[key]
            );
            configSchema.syncKey1 = {
                defaultValue: 'syncDefault1',
                type: String,
                scope: 'sync',
            };
            configSchema.localKey1 = {
                defaultValue: 'localDefault1',
                type: String,
                scope: 'local',
            };

            // Mock get operations to return empty (need defaults)
            mockChromeStorage.sync.get.mockImplementation((keys, callback) => {
                callback({});
            });

            mockChromeStorage.local.get.mockImplementation((keys, callback) => {
                callback({});
            });

            // Mock sync set to succeed, local set to fail
            mockChromeStorage.sync.set.mockImplementation((items, callback) => {
                callback();
            });

            mockChromeStorage.local.set.mockImplementation(
                (items, callback) => {
                    mockChromeRuntime.lastError = {
                        message: 'Local storage quota exceeded',
                    };
                    callback();
                }
            );

            await configService.setDefaultsForMissingKeys();

            expect(configService.isInitialized).toBe(true);
            expect(mockChromeStorage.sync.set).toHaveBeenCalledWith(
                { syncKey1: 'syncDefault1' },
                expect.any(Function)
            );
            expect(mockChromeStorage.local.set).toHaveBeenCalledWith(
                { localKey1: 'localDefault1' },
                expect.any(Function)
            );

            // Restore original schema
            Object.keys(configSchema).forEach(
                (key) => delete configSchema[key]
            );
            Object.assign(configSchema, originalSchema);
        });

        test('should handle complete failure in setting defaults', async () => {
            // Mock schema
            const originalSchema = { ...configSchema };
            Object.keys(configSchema).forEach(
                (key) => delete configSchema[key]
            );
            configSchema.syncKey1 = {
                defaultValue: 'syncDefault1',
                type: String,
                scope: 'sync',
            };
            configSchema.localKey1 = {
                defaultValue: 'localDefault1',
                type: String,
                scope: 'local',
            };

            // Mock get operations to return empty (need defaults)
            mockChromeStorage.sync.get.mockImplementation((keys, callback) => {
                callback({});
            });

            mockChromeStorage.local.get.mockImplementation((keys, callback) => {
                callback({});
            });

            // Mock both set operations to fail
            mockChromeStorage.sync.set.mockImplementation((items, callback) => {
                mockChromeRuntime.lastError = { message: 'Sync storage error' };
                callback();
            });

            mockChromeStorage.local.set.mockImplementation(
                (items, callback) => {
                    mockChromeRuntime.lastError = {
                        message: 'Local storage error',
                    };
                    callback();
                }
            );

            try {
                await configService.setDefaultsForMissingKeys();
                fail(
                    'Expected setDefaultsForMissingKeys to throw complete failure error'
                );
            } catch (error) {
                expect(error.message).toContain('failed completely');
                expect(error.completeFailure).toBe(true);
                expect(error.failed).toHaveLength(2);
                expect(error.errors).toHaveLength(2);
                expect(error.totalKeysAttempted).toBe(2);
                expect(configService.isInitialized).toBe(true); // Should still be marked as initialized
            }

            // Restore original schema
            Object.keys(configSchema).forEach(
                (key) => delete configSchema[key]
            );
            Object.assign(configSchema, originalSchema);
        });

        test('should succeed when no defaults are needed', async () => {
            // Mock schema
            const originalSchema = { ...configSchema };
            Object.keys(configSchema).forEach(
                (key) => delete configSchema[key]
            );
            configSchema.syncKey1 = {
                defaultValue: 'syncDefault1',
                type: String,
                scope: 'sync',
            };
            configSchema.localKey1 = {
                defaultValue: 'localDefault1',
                type: String,
                scope: 'local',
            };

            // Mock get operations to return existing values (no defaults needed)
            mockChromeStorage.sync.get.mockImplementation((keys, callback) => {
                callback({ syncKey1: 'existingValue1' });
            });

            mockChromeStorage.local.get.mockImplementation((keys, callback) => {
                callback({ localKey1: 'existingValue2' });
            });

            await configService.setDefaultsForMissingKeys();

            expect(configService.isInitialized).toBe(true);
            expect(mockChromeStorage.sync.set).not.toHaveBeenCalled();
            expect(mockChromeStorage.local.set).not.toHaveBeenCalled();

            // Restore original schema
            Object.keys(configSchema).forEach(
                (key) => delete configSchema[key]
            );
            Object.assign(configSchema, originalSchema);
        });
    });

    describe('Error aggregation and reporting', () => {
        test('should provide detailed error context for debugging', async () => {
            const settings = {
                syncKey1: 'value1',
                localKey1: 'value2',
            };

            // Mock schema
            const originalSchema = { ...configSchema };
            Object.keys(configSchema).forEach(
                (key) => delete configSchema[key]
            );
            configSchema.syncKey1 = {
                defaultValue: 'default1',
                type: String,
                scope: 'sync',
            };
            configSchema.localKey1 = {
                defaultValue: 'default2',
                type: String,
                scope: 'local',
            };

            // Mock sync to succeed, local to fail with quota error
            mockChromeStorage.sync.set.mockImplementation((items, callback) => {
                callback();
            });

            mockChromeStorage.local.set.mockImplementation(
                (items, callback) => {
                    mockChromeRuntime.lastError = {
                        message: 'QUOTA_BYTES_PER_ITEM quota exceeded',
                    };
                    callback();
                }
            );

            try {
                await configService.setMultiple(settings);
                fail('Expected setMultiple to throw error');
            } catch (error) {
                expect(error.partialFailure).toBe(true);
                expect(error.successful).toEqual([
                    {
                        area: 'sync',
                        keys: ['syncKey1'],
                        count: 1,
                    },
                ]);
                expect(error.failed).toEqual([
                    {
                        area: 'local',
                        keys: ['localKey1'],
                        count: 1,
                    },
                ]);
                expect(error.errors).toHaveLength(1);
                expect(error.errors[0].area).toBe('local');
                expect(error.errors[0].keys).toEqual(['localKey1']);
                expect(error.errors[0].error.message).toContain(
                    'QUOTA_BYTES_PER_ITEM'
                );
            }

            // Restore original schema
            Object.keys(configSchema).forEach(
                (key) => delete configSchema[key]
            );
            Object.assign(configSchema, originalSchema);
        });

        test('should handle mixed validation and storage errors', async () => {
            const settings = {
                validSyncKey: 'value1',
                invalidKey: 'value2',
                validLocalKey: 'value3',
            };

            // Mock schema
            const originalSchema = { ...configSchema };
            Object.keys(configSchema).forEach(
                (key) => delete configSchema[key]
            );
            configSchema.validSyncKey = {
                defaultValue: 'default1',
                type: String,
                scope: 'sync',
            };
            configSchema.validLocalKey = {
                defaultValue: 'default2',
                type: String,
                scope: 'local',
            };

            try {
                await configService.setMultiple(settings);
                fail('Expected setMultiple to throw validation error');
            } catch (error) {
                expect(error.message).toContain('validation error(s)');
                expect(error.validationErrors).toHaveLength(1);
                expect(error.validationErrors[0].key).toBe('invalidKey');
                expect(error.validationErrors[0].type).toBe('invalid_key');
                expect(error.totalSettings).toBe(3);
                expect(error.validSettings).toBe(2);
            }

            // Restore original schema
            Object.keys(configSchema).forEach(
                (key) => delete configSchema[key]
            );
            Object.assign(configSchema, originalSchema);
        });
    });
});
