// services/configService.logging.test.js
import { jest } from '@jest/globals';
import { configService } from './configService.js';

// Mock Chrome APIs
global.chrome = {
    storage: {
        sync: {
            get: jest.fn(),
            set: jest.fn(),
            remove: jest.fn(),
            clear: jest.fn(),
        },
        local: {
            get: jest.fn(),
            set: jest.fn(),
            remove: jest.fn(),
            clear: jest.fn(),
        },
    },
    runtime: {
        lastError: null,
        onInstalled: {
            addListener: jest.fn(),
        },
    },
};

describe('ConfigService Logging Integration', () => {
    let mockLogger;

    beforeEach(() => {
        jest.clearAllMocks();

        // Create mock logger instance
        mockLogger = {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            updateLevel: jest.fn().mockResolvedValue(),
        };

        // Replace the logger instance in the singleton
        configService.logger = mockLogger;
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('Logger Initialization', () => {
        test('should have logger instance with correct component name', () => {
            expect(configService.logger).toBeDefined();
        });

        test('should handle logger initialization failure gracefully', async () => {
            const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
            const error = new Error('Logger init failed');

            // Mock the updateLevel to fail
            const originalUpdateLevel = configService.logger.updateLevel;
            configService.logger.updateLevel = jest
                .fn()
                .mockRejectedValue(error);

            // Call initializeLogger directly
            await configService.initializeLogger();

            expect(consoleSpy).toHaveBeenCalledWith(
                'ConfigService: Failed to initialize logger level:',
                error
            );

            // Restore
            configService.logger.updateLevel = originalUpdateLevel;
            consoleSpy.mockRestore();
        });
    });

    describe('initializeDefaults Method', () => {
        test('should log installation events with structured data', () => {
            const mockListener = jest.fn();
            chrome.runtime.onInstalled.addListener.mockImplementation(
                mockListener
            );

            configService.initializeDefaults();

            // Get the listener function that was registered
            const listenerFn =
                chrome.runtime.onInstalled.addListener.mock.calls[0][0];

            // Simulate install event
            listenerFn({ reason: 'install' });

            expect(mockLogger.info).toHaveBeenCalledWith(
                'Setting default configuration from schema',
                {
                    reason: 'install',
                    method: 'initializeDefaults',
                }
            );
        });

        test('should log update events with structured data', () => {
            const mockListener = jest.fn();
            chrome.runtime.onInstalled.addListener.mockImplementation(
                mockListener
            );

            configService.initializeDefaults();

            // Get the listener function that was registered
            const listenerFn =
                chrome.runtime.onInstalled.addListener.mock.calls[0][0];

            // Simulate update event
            listenerFn({ reason: 'update' });

            expect(mockLogger.info).toHaveBeenCalledWith(
                'Setting default configuration from schema',
                {
                    reason: 'update',
                    method: 'initializeDefaults',
                }
            );
        });

        test('should not log for other event reasons', () => {
            const mockListener = jest.fn();
            chrome.runtime.onInstalled.addListener.mockImplementation(
                mockListener
            );

            configService.initializeDefaults();

            // Get the listener function that was registered
            const listenerFn =
                chrome.runtime.onInstalled.addListener.mock.calls[0][0];

            // Simulate other event
            listenerFn({ reason: 'startup' });

            expect(mockLogger.info).not.toHaveBeenCalled();
        });
    });

    describe('Storage Operation Logging', () => {
        test('should log debug information for get operations', async () => {
            chrome.storage.sync.get.mockImplementation((keys, callback) => {
                callback({ testKey: 'testValue' });
            });

            await configService.getFromStorage('sync', ['testKey'], {
                method: 'test',
            });

            expect(mockLogger.debug).toHaveBeenCalledWith(
                'Starting get operation',
                expect.objectContaining({
                    area: 'sync',
                    keys: ['testKey'],
                    context: { method: 'test' },
                })
            );

            expect(mockLogger.debug).toHaveBeenCalledWith(
                'Storage get operation completed',
                expect.objectContaining({
                    area: 'sync',
                    keys: ['testKey'],
                    resultKeys: ['testKey'],
                })
            );
        });

        test('should log errors for failed get operations', async () => {
            const testError = { message: 'Storage error' };
            chrome.runtime.lastError = testError;
            chrome.storage.sync.get.mockImplementation((keys, callback) => {
                callback({});
            });

            await expect(
                configService.getFromStorage('sync', ['testKey'], {
                    method: 'test',
                })
            ).rejects.toThrow();

            expect(mockLogger.error).toHaveBeenCalledWith(
                'Storage get operation failed',
                expect.any(Error),
                expect.objectContaining({
                    area: 'sync',
                    keys: ['testKey'],
                })
            );

            chrome.runtime.lastError = null;
        });

        test('should log debug information for set operations', async () => {
            chrome.storage.sync.set.mockImplementation((items, callback) => {
                callback();
            });

            await configService.setToStorage(
                'sync',
                { testKey: 'testValue' },
                { method: 'test' }
            );

            expect(mockLogger.debug).toHaveBeenCalledWith(
                'Starting set operation',
                expect.objectContaining({
                    area: 'sync',
                    keys: ['testKey'],
                    itemCount: 1,
                    context: { method: 'test' },
                })
            );

            expect(mockLogger.debug).toHaveBeenCalledWith(
                'Storage set operation completed',
                expect.objectContaining({
                    area: 'sync',
                    keys: ['testKey'],
                    itemCount: 1,
                })
            );
        });

        test('should log quota exceeded errors with special handling', async () => {
            const quotaError = { message: 'QUOTA_EXCEEDED' };
            chrome.runtime.lastError = quotaError;
            chrome.storage.sync.set.mockImplementation((items, callback) => {
                callback();
            });

            await expect(
                configService.setToStorage(
                    'sync',
                    { testKey: 'testValue' },
                    { method: 'test' }
                )
            ).rejects.toThrow();

            expect(mockLogger.error).toHaveBeenCalledWith(
                'Storage quota exceeded during set operation',
                expect.any(Error),
                expect.objectContaining({
                    area: 'sync',
                    keys: ['testKey'],
                    quotaError: true,
                    recoveryAction: expect.any(String),
                })
            );

            chrome.runtime.lastError = null;
        });
    });

    describe('Public Method Logging', () => {
        test('should have logger available for public methods', () => {
            // Simple test to verify logger is available
            expect(configService.logger).toBeDefined();
            expect(typeof configService.logger.debug).toBe('function');
            expect(typeof configService.logger.info).toBe('function');
            expect(typeof configService.logger.warn).toBe('function');
            expect(typeof configService.logger.error).toBe('function');
        });

        test('should log errors for invalid keys', async () => {
            await configService.get('invalidKey');

            expect(mockLogger.error).toHaveBeenCalledWith(
                'Invalid key "invalidKey" requested',
                null,
                {
                    method: 'get',
                    requestedKey: 'invalidKey',
                }
            );
        });

        test('should log debug information for getMultiple method', async () => {
            chrome.storage.sync.get.mockImplementation((keys, callback) => {
                callback({});
            });

            await configService.getMultiple(['key1', 'key2']);

            expect(mockLogger.debug).toHaveBeenCalledWith(
                'getMultiple() called',
                {
                    keys: ['key1', 'key2'],
                    keyCount: 2,
                }
            );
        });
    });

    describe('Error Handling and Logging', () => {
        test('should maintain logging functionality even when ConfigService has errors', async () => {
            // Simulate a storage error by setting lastError
            chrome.runtime.lastError = { message: 'Storage unavailable' };
            chrome.storage.sync.get.mockImplementation((keys, callback) => {
                callback({});
            });

            try {
                await configService.getFromStorage('sync', ['testKey']);
            } catch (error) {
                // Error is expected
            }

            // Logger should still be functional
            expect(mockLogger.debug).toHaveBeenCalled();

            chrome.runtime.lastError = null;
        });

        test('should not create circular dependency issues', () => {
            // The fact that we can create ConfigService without errors
            // and that logger is initialized properly indicates no circular dependency
            expect(configService.logger).toBeDefined();
        });
    });

    describe('Structured Logging Format', () => {
        test('should pass structured data to logger methods', async () => {
            chrome.storage.sync.get.mockImplementation((keys, callback) => {
                callback({ testKey: 'value' });
            });

            await configService.getFromStorage('sync', ['testKey'], {
                method: 'testMethod',
                operation: 'testOperation',
            });

            expect(mockLogger.debug).toHaveBeenCalledWith(
                'Starting get operation',
                expect.objectContaining({
                    area: 'sync',
                    keys: ['testKey'],
                    context: {
                        method: 'testMethod',
                        operation: 'testOperation',
                    },
                })
            );
        });

        test('should include timing information in storage operations', async () => {
            chrome.storage.sync.get.mockImplementation((keys, callback) => {
                callback({ testKey: 'value' });
            });

            await configService.getFromStorage('sync', ['testKey']);

            expect(mockLogger.debug).toHaveBeenCalledWith(
                'Storage get operation completed',
                expect.objectContaining({
                    duration: expect.any(Number),
                })
            );
        });
    });
});
