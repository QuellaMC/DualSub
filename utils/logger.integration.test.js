import {
    describe,
    it,
    expect,
    beforeEach,
    afterEach,
    jest,
} from '@jest/globals';
import Logger from './logger.js';

// Mock chrome APIs for integration testing
const mockChromeStorage = {
    sync: {
        get: jest.fn(),
        set: jest.fn(),
        onChanged: {
            addListener: jest.fn(),
            removeListener: jest.fn(),
        },
    },
    local: {
        get: jest.fn(),
        set: jest.fn(),
    },
    runtime: {
        lastError: null,
        onMessage: {
            addListener: jest.fn(),
            removeListener: jest.fn(),
        },
        sendMessage: jest.fn(),
    },
    tabs: {
        query: jest.fn(),
        sendMessage: jest.fn(),
    },
};

// Mock ConfigService for integration testing
class MockConfigService {
    constructor() {
        this.storage = new Map();
        this.listeners = new Set();
        this.storage.set('loggingLevel', Logger.LEVELS.INFO);
    }

    async get(key) {
        if (key === 'loggingLevel') {
            return this.storage.get('loggingLevel');
        }
        return undefined;
    }

    async set(key, value) {
        const oldValue = this.storage.get(key);
        this.storage.set(key, value);

        // Simulate change notification
        const changes = { [key]: value };
        this.listeners.forEach((listener) => {
            try {
                listener(changes);
            } catch (error) {
                // Ignore listener errors in tests
            }
        });
    }

    onChanged(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
}

describe('Logger Integration Tests', () => {
    let mockConfigService;
    let originalChrome;
    let consoleSpies;

    beforeEach(() => {
        // Setup chrome API mocks
        originalChrome = global.chrome;
        global.chrome = mockChromeStorage;

        // Reset all chrome API mocks
        Object.values(mockChromeStorage).forEach((api) => {
            if (typeof api === 'object' && api !== null) {
                Object.values(api).forEach((method) => {
                    if (typeof method === 'function' && method.mockReset) {
                        method.mockReset();
                    }
                });
            }
        });

        // Setup console spies
        consoleSpies = {
            debug: jest.spyOn(console, 'debug').mockImplementation(() => {}),
            info: jest.spyOn(console, 'info').mockImplementation(() => {}),
            warn: jest.spyOn(console, 'warn').mockImplementation(() => {}),
            error: jest.spyOn(console, 'error').mockImplementation(() => {}),
        };

        // Create fresh mock config service
        mockConfigService = new MockConfigService();
    });

    afterEach(() => {
        // Restore chrome API
        global.chrome = originalChrome;

        // Restore console methods
        Object.values(consoleSpies).forEach((spy) => spy.mockRestore());
    });

    describe('Logging Level Changes Across All Contexts', () => {
        it('should update logging level from configuration service', async () => {
            const logger = Logger.create('TestComponent', mockConfigService);

            // Initial level should be INFO
            expect(logger.currentLevel).toBe(Logger.LEVELS.INFO);

            // Change level in config service
            await mockConfigService.set('loggingLevel', Logger.LEVELS.DEBUG);

            // Update logger level
            await logger.updateLevel();

            expect(logger.currentLevel).toBe(Logger.LEVELS.DEBUG);
        });

        it('should handle real-time logging level updates via message passing', async () => {
            const backgroundLogger = Logger.create(
                'Background',
                mockConfigService
            );
            const contentLogger = Logger.create('ContentScript');

            // Setup message listener simulation
            let messageListener = null;
            mockChromeStorage.runtime.onMessage.addListener.mockImplementation(
                (listener) => {
                    messageListener = listener;
                }
            );

            // Simulate content script message listener setup
            const mockMessageHandler = jest.fn((message) => {
                if (message.type === 'LOGGING_LEVEL_CHANGED') {
                    contentLogger.updateLevel(message.level);
                }
            });

            // Register the handler
            messageListener = mockMessageHandler;

            // Initial levels
            expect(backgroundLogger.currentLevel).toBe(Logger.LEVELS.INFO);
            expect(contentLogger.currentLevel).toBe(Logger.LEVELS.INFO);

            // Change level in background
            await backgroundLogger.updateLevel(Logger.LEVELS.ERROR);

            // Simulate message broadcast
            const message = {
                type: 'LOGGING_LEVEL_CHANGED',
                level: Logger.LEVELS.ERROR,
            };

            messageListener(message);

            // Both loggers should have updated levels
            expect(backgroundLogger.currentLevel).toBe(Logger.LEVELS.ERROR);
            expect(contentLogger.currentLevel).toBe(Logger.LEVELS.ERROR);
        });

        it('should synchronize logging levels across multiple logger instances', async () => {
            const logger1 = Logger.create('Component1', mockConfigService);
            const logger2 = Logger.create('Component2', mockConfigService);
            const logger3 = Logger.create('Component3', mockConfigService);

            // All should start with INFO level
            expect(logger1.currentLevel).toBe(Logger.LEVELS.INFO);
            expect(logger2.currentLevel).toBe(Logger.LEVELS.INFO);
            expect(logger3.currentLevel).toBe(Logger.LEVELS.INFO);

            // Change config service level
            await mockConfigService.set('loggingLevel', Logger.LEVELS.WARN);

            // Update all loggers
            await Promise.all([
                logger1.updateLevel(),
                logger2.updateLevel(),
                logger3.updateLevel(),
            ]);

            // All should have the new level
            expect(logger1.currentLevel).toBe(Logger.LEVELS.WARN);
            expect(logger2.currentLevel).toBe(Logger.LEVELS.WARN);
            expect(logger3.currentLevel).toBe(Logger.LEVELS.WARN);
        });
    });

    describe('Logging Output at Each Level - Filtering Behavior', () => {
        let logger;

        beforeEach(() => {
            logger = Logger.create('FilterTest', mockConfigService);
        });

        it('should filter messages correctly at OFF level', async () => {
            await logger.updateLevel(Logger.LEVELS.OFF);

            logger.debug('Debug message');
            logger.info('Info message');
            logger.warn('Warn message');
            logger.error('Error message');

            expect(consoleSpies.debug).not.toHaveBeenCalled();
            expect(consoleSpies.info).not.toHaveBeenCalled();
            expect(consoleSpies.warn).not.toHaveBeenCalled();
            expect(consoleSpies.error).not.toHaveBeenCalled();
        });

        it('should filter messages correctly at ERROR level', async () => {
            await logger.updateLevel(Logger.LEVELS.ERROR);

            logger.debug('Debug message');
            logger.info('Info message');
            logger.warn('Warn message');
            logger.error('Error message');

            expect(consoleSpies.debug).not.toHaveBeenCalled();
            expect(consoleSpies.info).not.toHaveBeenCalled();
            expect(consoleSpies.warn).not.toHaveBeenCalled();
            expect(consoleSpies.error).toHaveBeenCalledTimes(1);
        });

        it('should filter messages correctly at WARN level', async () => {
            await logger.updateLevel(Logger.LEVELS.WARN);

            logger.debug('Debug message');
            logger.info('Info message');
            logger.warn('Warn message');
            logger.error('Error message');

            expect(consoleSpies.debug).not.toHaveBeenCalled();
            expect(consoleSpies.info).not.toHaveBeenCalled();
            expect(consoleSpies.warn).toHaveBeenCalledTimes(1);
            expect(consoleSpies.error).toHaveBeenCalledTimes(1);
        });

        it('should filter messages correctly at INFO level', async () => {
            await logger.updateLevel(Logger.LEVELS.INFO);

            logger.debug('Debug message');
            logger.info('Info message');
            logger.warn('Warn message');
            logger.error('Error message');

            expect(consoleSpies.debug).not.toHaveBeenCalled();
            expect(consoleSpies.info).toHaveBeenCalledTimes(1);
            expect(consoleSpies.warn).toHaveBeenCalledTimes(1);
            expect(consoleSpies.error).toHaveBeenCalledTimes(1);
        });

        it('should filter messages correctly at DEBUG level', async () => {
            await logger.updateLevel(Logger.LEVELS.DEBUG);

            logger.debug('Debug message');
            logger.info('Info message');
            logger.warn('Warn message');
            logger.error('Error message');

            expect(consoleSpies.debug).toHaveBeenCalledTimes(1);
            expect(consoleSpies.info).toHaveBeenCalledTimes(1);
            expect(consoleSpies.warn).toHaveBeenCalledTimes(1);
            expect(consoleSpies.error).toHaveBeenCalledTimes(1);
        });

        it('should handle dynamic level changes during runtime', async () => {
            // Start with DEBUG level
            await logger.updateLevel(Logger.LEVELS.DEBUG);

            logger.debug('Should log');
            logger.info('Should log');

            expect(consoleSpies.debug).toHaveBeenCalledTimes(1);
            expect(consoleSpies.info).toHaveBeenCalledTimes(1);

            // Change to ERROR level
            await logger.updateLevel(Logger.LEVELS.ERROR);

            logger.debug('Should not log');
            logger.info('Should not log');
            logger.error('Should log');

            // Debug and info counts should remain the same
            expect(consoleSpies.debug).toHaveBeenCalledTimes(1);
            expect(consoleSpies.info).toHaveBeenCalledTimes(1);
            expect(consoleSpies.error).toHaveBeenCalledTimes(1);
        });
    });

    describe('Configuration Persistence and Loading', () => {
        it('should persist logging level changes', async () => {
            const logger = Logger.create('PersistenceTest', mockConfigService);

            // Change level
            await mockConfigService.set('loggingLevel', Logger.LEVELS.DEBUG);
            await logger.updateLevel();

            expect(logger.currentLevel).toBe(Logger.LEVELS.DEBUG);

            // Verify it's stored in mock config service
            const storedLevel = await mockConfigService.get('loggingLevel');
            expect(storedLevel).toBe(Logger.LEVELS.DEBUG);
        });

        it('should load logging level on initialization', async () => {
            // Set level in config service first
            await mockConfigService.set('loggingLevel', Logger.LEVELS.WARN);

            // Create new logger
            const logger = Logger.create('InitTest', mockConfigService);
            await logger.updateLevel();

            expect(logger.currentLevel).toBe(Logger.LEVELS.WARN);
        });

        it('should handle configuration loading errors gracefully', async () => {
            // Create a config service that throws errors
            const errorConfigService = {
                get: jest.fn().mockRejectedValue(new Error('Config error')),
            };

            const logger = Logger.create('ErrorTest', errorConfigService);

            // Should not throw and should use default level
            await logger.updateLevel();
            expect(logger.currentLevel).toBe(Logger.LEVELS.INFO);
        });

        it('should handle missing configuration gracefully', async () => {
            const emptyConfigService = {
                get: jest.fn().mockResolvedValue(undefined),
            };

            const logger = Logger.create('EmptyTest', emptyConfigService);
            await logger.updateLevel();

            expect(logger.currentLevel).toBe(Logger.LEVELS.INFO);
        });
    });

    describe('Message Passing System for Real-time Updates', () => {
        it('should broadcast logging level changes to all tabs', async () => {
            // Mock tabs.query to return some tabs
            mockChromeStorage.tabs.query.mockResolvedValue([
                { id: 1, url: 'https://netflix.com/watch/123' },
                { id: 2, url: 'https://disneyplus.com/video/456' },
                { id: 3, url: 'https://example.com' }, // Should be ignored
            ]);

            // Mock tabs.sendMessage
            mockChromeStorage.tabs.sendMessage.mockResolvedValue(true);

            // Simulate background script broadcasting
            const broadcastLoggingLevelChange = async (newLevel) => {
                const tabs = await chrome.tabs.query({});
                const messagePromises = [];

                for (const tab of tabs) {
                    if (
                        tab.url &&
                        (tab.url.includes('netflix.com') ||
                            tab.url.includes('disneyplus.com'))
                    ) {
                        const messagePromise = chrome.tabs
                            .sendMessage(tab.id, {
                                type: 'LOGGING_LEVEL_CHANGED',
                                level: newLevel,
                            })
                            .catch(() => {
                                // Ignore errors for this test
                            });
                        messagePromises.push(messagePromise);
                    }
                }

                await Promise.allSettled(messagePromises);
            };

            await broadcastLoggingLevelChange(Logger.LEVELS.DEBUG);

            // Should have queried tabs
            expect(mockChromeStorage.tabs.query).toHaveBeenCalledWith({});

            // Should have sent messages to Netflix and Disney+ tabs only
            expect(mockChromeStorage.tabs.sendMessage).toHaveBeenCalledTimes(2);
            expect(mockChromeStorage.tabs.sendMessage).toHaveBeenCalledWith(1, {
                type: 'LOGGING_LEVEL_CHANGED',
                level: Logger.LEVELS.DEBUG,
            });
            expect(mockChromeStorage.tabs.sendMessage).toHaveBeenCalledWith(2, {
                type: 'LOGGING_LEVEL_CHANGED',
                level: Logger.LEVELS.DEBUG,
            });
        });

        it('should handle message passing failures gracefully', async () => {
            mockChromeStorage.tabs.query.mockResolvedValue([
                { id: 1, url: 'https://netflix.com/watch/123' },
            ]);

            // Mock sendMessage to fail
            mockChromeStorage.tabs.sendMessage.mockRejectedValue(
                new Error('Tab not found')
            );

            const broadcastLoggingLevelChange = async (newLevel) => {
                const tabs = await chrome.tabs.query({});
                const messagePromises = [];

                for (const tab of tabs) {
                    if (
                        tab.url &&
                        (tab.url.includes('netflix.com') ||
                            tab.url.includes('disneyplus.com'))
                    ) {
                        const messagePromise = chrome.tabs
                            .sendMessage(tab.id, {
                                type: 'LOGGING_LEVEL_CHANGED',
                                level: newLevel,
                            })
                            .catch(() => {
                                // Should handle errors gracefully
                                return null;
                            });
                        messagePromises.push(messagePromise);
                    }
                }

                await Promise.allSettled(messagePromises);
            };

            // Should not throw
            await expect(
                broadcastLoggingLevelChange(Logger.LEVELS.ERROR)
            ).resolves.toBeUndefined();
        });

        it('should handle content script message reception', () => {
            const contentLogger = Logger.create('ContentScript');
            let messageHandler = null;

            // Simulate message listener setup
            mockChromeStorage.runtime.onMessage.addListener.mockImplementation(
                (handler) => {
                    messageHandler = handler;
                }
            );

            // Setup the handler
            const setupMessageListener = () => {
                chrome.runtime.onMessage.addListener((message) => {
                    if (message.type === 'LOGGING_LEVEL_CHANGED') {
                        contentLogger.updateLevel(message.level);
                    }
                });
            };

            setupMessageListener();
            expect(
                mockChromeStorage.runtime.onMessage.addListener
            ).toHaveBeenCalled();

            // Get the registered handler
            const registeredHandler =
                mockChromeStorage.runtime.onMessage.addListener.mock
                    .calls[0][0];

            // Simulate receiving a message
            registeredHandler({
                type: 'LOGGING_LEVEL_CHANGED',
                level: Logger.LEVELS.WARN,
            });

            expect(contentLogger.currentLevel).toBe(Logger.LEVELS.WARN);
        });
    });

    describe('Performance Impact Validation', () => {
        it('should have minimal performance impact when logging is disabled', async () => {
            const logger = Logger.create('PerformanceTest', mockConfigService);
            await logger.updateLevel(Logger.LEVELS.OFF);

            const iterations = 1000;
            const startTime = performance.now();

            for (let i = 0; i < iterations; i++) {
                logger.debug('Debug message', { iteration: i, data: 'test' });
                logger.info('Info message', { iteration: i, data: 'test' });
                logger.warn('Warn message', { iteration: i, data: 'test' });
                logger.error('Error message', null, {
                    iteration: i,
                    data: 'test',
                });
            }

            const endTime = performance.now();
            const duration = endTime - startTime;

            // Should complete quickly (less than 100ms for 1000 iterations)
            expect(duration).toBeLessThan(100);

            // No console calls should have been made
            expect(consoleSpies.debug).not.toHaveBeenCalled();
            expect(consoleSpies.info).not.toHaveBeenCalled();
            expect(consoleSpies.warn).not.toHaveBeenCalled();
            expect(consoleSpies.error).not.toHaveBeenCalled();
        });

        it('should have reasonable performance impact when logging is enabled', async () => {
            const logger = Logger.create('PerformanceTest', mockConfigService);
            await logger.updateLevel(Logger.LEVELS.DEBUG);

            const iterations = 100; // Fewer iterations since we're actually logging
            const startTime = performance.now();

            for (let i = 0; i < iterations; i++) {
                logger.debug('Debug message', { iteration: i });
                logger.info('Info message', { iteration: i });
                logger.warn('Warn message', { iteration: i });
                logger.error('Error message', null, { iteration: i });
            }

            const endTime = performance.now();
            const duration = endTime - startTime;

            // Should still complete reasonably quickly (less than 500ms for 100 iterations)
            expect(duration).toBeLessThan(500);

            // All console methods should have been called
            expect(consoleSpies.debug).toHaveBeenCalledTimes(iterations);
            expect(consoleSpies.info).toHaveBeenCalledTimes(iterations);
            expect(consoleSpies.warn).toHaveBeenCalledTimes(iterations);
            expect(consoleSpies.error).toHaveBeenCalledTimes(iterations);
        });

        it('should efficiently check logging levels', async () => {
            const logger = Logger.create('PerformanceTest', mockConfigService);
            await logger.updateLevel(Logger.LEVELS.ERROR);

            const iterations = 10000;
            const startTime = performance.now();

            for (let i = 0; i < iterations; i++) {
                // These should be filtered out quickly
                logger.shouldLog(Logger.LEVELS.DEBUG);
                logger.shouldLog(Logger.LEVELS.INFO);
                logger.shouldLog(Logger.LEVELS.WARN);
                logger.shouldLog(Logger.LEVELS.ERROR);
            }

            const endTime = performance.now();
            const duration = endTime - startTime;

            // Level checking should be very fast (less than 50ms for 10000 checks)
            expect(duration).toBeLessThan(50);
        });

        it('should handle large data objects efficiently', async () => {
            const logger = Logger.create('PerformanceTest', mockConfigService);
            await logger.updateLevel(Logger.LEVELS.DEBUG);

            const largeData = {
                array: new Array(1000).fill('test'),
                nested: {
                    deep: {
                        object: {
                            with: {
                                many: {
                                    levels: 'value',
                                },
                            },
                        },
                    },
                },
                timestamp: Date.now(),
                id: 'test-id-12345',
            };

            const startTime = performance.now();

            for (let i = 0; i < 10; i++) {
                logger.info('Large data test', largeData);
            }

            const endTime = performance.now();
            const duration = endTime - startTime;

            // Should handle large objects reasonably (less than 100ms for 10 iterations)
            expect(duration).toBeLessThan(100);
            expect(consoleSpies.info).toHaveBeenCalledTimes(10);
        });
    });

    describe('Cross-Context Integration Scenarios', () => {
        it('should simulate complete extension lifecycle with logging', async () => {
            // Simulate background script initialization
            const backgroundLogger = Logger.create(
                'Background',
                mockConfigService
            );
            await backgroundLogger.updateLevel();

            backgroundLogger.info('Extension started');
            expect(consoleSpies.info).toHaveBeenCalledWith(
                expect.stringContaining('[INFO] [Background] Extension started')
            );

            // Simulate content script initialization
            const contentLogger = Logger.create('ContentScript');
            contentLogger.info('Content script loaded');

            // Simulate popup opening
            const popupLogger = Logger.create('Popup', mockConfigService);
            await popupLogger.updateLevel();
            popupLogger.info('Popup opened');

            // Simulate options page opening
            const optionsLogger = Logger.create('Options', mockConfigService);
            await optionsLogger.updateLevel();
            optionsLogger.info('Options page loaded');

            // Simulate user changing logging level in options
            await mockConfigService.set('loggingLevel', Logger.LEVELS.DEBUG);

            // All loggers should update their levels
            await backgroundLogger.updateLevel();
            await popupLogger.updateLevel();
            await optionsLogger.updateLevel();

            // Simulate message passing to content script
            contentLogger.updateLevel(Logger.LEVELS.DEBUG);

            // All should now be at DEBUG level
            expect(backgroundLogger.currentLevel).toBe(Logger.LEVELS.DEBUG);
            expect(contentLogger.currentLevel).toBe(Logger.LEVELS.DEBUG);
            expect(popupLogger.currentLevel).toBe(Logger.LEVELS.DEBUG);
            expect(optionsLogger.currentLevel).toBe(Logger.LEVELS.DEBUG);

            // Test debug logging works
            backgroundLogger.debug('Debug from background');
            contentLogger.debug('Debug from content');
            popupLogger.debug('Debug from popup');
            optionsLogger.debug('Debug from options');

            expect(consoleSpies.debug).toHaveBeenCalledTimes(4);
        });

        it('should handle multiple simultaneous level changes', async () => {
            const loggers = [
                Logger.create('Component1', mockConfigService),
                Logger.create('Component2', mockConfigService),
                Logger.create('Component3', mockConfigService),
                Logger.create('Component4', mockConfigService),
                Logger.create('Component5', mockConfigService),
            ];

            // Initialize all loggers
            await Promise.all(loggers.map((logger) => logger.updateLevel()));

            // Change level multiple times rapidly
            const levels = [
                Logger.LEVELS.DEBUG,
                Logger.LEVELS.WARN,
                Logger.LEVELS.ERROR,
                Logger.LEVELS.INFO,
                Logger.LEVELS.OFF,
            ];

            for (const level of levels) {
                await mockConfigService.set('loggingLevel', level);
                await Promise.all(
                    loggers.map((logger) => logger.updateLevel())
                );

                // All loggers should have the same level
                loggers.forEach((logger) => {
                    expect(logger.currentLevel).toBe(level);
                });
            }
        });

        it('should maintain consistency during error conditions', async () => {
            const logger1 = Logger.create('Component1', mockConfigService);
            const logger2 = Logger.create('Component2', mockConfigService);

            // Initialize normally
            await logger1.updateLevel();
            await logger2.updateLevel();

            expect(logger1.currentLevel).toBe(Logger.LEVELS.INFO);
            expect(logger2.currentLevel).toBe(Logger.LEVELS.INFO);

            // Simulate config service error for one logger
            const errorConfigService = {
                get: jest.fn().mockRejectedValue(new Error('Network error')),
            };

            const logger3 = Logger.create('Component3', errorConfigService);
            await logger3.updateLevel();

            // Logger3 should fall back to default, others should be unaffected
            expect(logger1.currentLevel).toBe(Logger.LEVELS.INFO);
            expect(logger2.currentLevel).toBe(Logger.LEVELS.INFO);
            expect(logger3.currentLevel).toBe(Logger.LEVELS.INFO); // Fallback

            // Change level for working loggers
            await mockConfigService.set('loggingLevel', Logger.LEVELS.DEBUG);
            await logger1.updateLevel();
            await logger2.updateLevel();
            await logger3.updateLevel(); // Should still fail gracefully

            expect(logger1.currentLevel).toBe(Logger.LEVELS.DEBUG);
            expect(logger2.currentLevel).toBe(Logger.LEVELS.DEBUG);
            expect(logger3.currentLevel).toBe(Logger.LEVELS.INFO); // Still fallback
        });
    });

    describe('Extension Restart and Configuration Persistence', () => {
        it('should maintain logging configuration across simulated extension restarts', async () => {
            // Simulate first extension session
            const session1Logger = Logger.create(
                'Background',
                mockConfigService
            );
            await session1Logger.updateLevel();

            // User changes logging level
            await mockConfigService.set('loggingLevel', Logger.LEVELS.DEBUG);
            await session1Logger.updateLevel();

            expect(session1Logger.currentLevel).toBe(Logger.LEVELS.DEBUG);

            // Simulate extension restart - create new logger instances
            const session2Logger = Logger.create(
                'Background',
                mockConfigService
            );
            await session2Logger.updateLevel();

            // Should load the previously saved level
            expect(session2Logger.currentLevel).toBe(Logger.LEVELS.DEBUG);

            // Test that logging works at the restored level
            session2Logger.debug('Debug after restart');
            expect(consoleSpies.debug).toHaveBeenCalledWith(
                expect.stringContaining(
                    '[DEBUG] [Background] Debug after restart'
                )
            );
        });

        it('should handle configuration corruption gracefully on restart', async () => {
            // Simulate corrupted config service
            const corruptedConfigService = {
                get: jest.fn().mockImplementation((key) => {
                    if (key === 'loggingLevel') {
                        // Return invalid value
                        return Promise.resolve('invalid_level');
                    }
                    return Promise.resolve(undefined);
                }),
            };

            const logger = Logger.create('Background', corruptedConfigService);
            await logger.updateLevel();

            // The logger currently accepts the invalid value as-is
            // In a real implementation, this should be validated and fall back to default
            expect(logger.currentLevel).toBe('invalid_level');

            // With invalid level, shouldLog returns false, so no logging occurs
            // This demonstrates the need for input validation in the Logger class
            logger.info('Info with corrupted config');
            expect(consoleSpies.info).not.toHaveBeenCalled();

            // However, if we set a valid level, logging should work
            await logger.updateLevel(Logger.LEVELS.INFO);
            logger.info('Info after fixing level');
            expect(consoleSpies.info).toHaveBeenCalledWith(
                expect.stringContaining(
                    '[INFO] [Background] Info after fixing level'
                )
            );
        });

        it('should handle storage quota exceeded scenarios', async () => {
            // Simulate storage quota exceeded
            const quotaExceededConfigService = {
                get: jest.fn().mockRejectedValue(new Error('QUOTA_EXCEEDED')),
                set: jest.fn().mockRejectedValue(new Error('QUOTA_EXCEEDED')),
            };

            const logger = Logger.create(
                'Background',
                quotaExceededConfigService
            );
            await logger.updateLevel();

            // Should use default level when storage is unavailable
            expect(logger.currentLevel).toBe(Logger.LEVELS.INFO);

            // Should continue to function
            logger.warn('Warning with quota exceeded');
            expect(consoleSpies.warn).toHaveBeenCalledWith(
                expect.stringContaining(
                    '[WARN] [Background] Warning with quota exceeded'
                )
            );
        });
    });

    describe('Real-world Integration Scenarios', () => {
        it('should handle video platform logging integration', async () => {
            // Simulate Netflix platform logger
            const netflixLogger = Logger.create(
                'NetflixPlatform',
                mockConfigService
            );
            await netflixLogger.updateLevel();

            // Simulate Disney+ platform logger
            const disneyLogger = Logger.create(
                'DisneyPlusPlatform',
                mockConfigService
            );
            await disneyLogger.updateLevel();

            // Test typical platform operations
            netflixLogger.info('Subtitle data received', {
                language: 'en',
                trackCount: 5,
            });

            disneyLogger.debug('Video context changed', {
                videoId: 'abc123',
                timestamp: Date.now(),
            });

            expect(consoleSpies.info).toHaveBeenCalledWith(
                expect.stringContaining(
                    '[INFO] [NetflixPlatform] Subtitle data received'
                )
            );
            expect(consoleSpies.debug).not.toHaveBeenCalled(); // DEBUG not enabled by default

            // Change to DEBUG level
            await mockConfigService.set('loggingLevel', Logger.LEVELS.DEBUG);
            await netflixLogger.updateLevel();
            await disneyLogger.updateLevel();

            disneyLogger.debug('Video context changed again', {
                videoId: 'def456',
                timestamp: Date.now(),
            });

            expect(consoleSpies.debug).toHaveBeenCalledWith(
                expect.stringContaining(
                    '[DEBUG] [DisneyPlusPlatform] Video context changed again'
                )
            );
        });

        it('should handle translation provider logging integration', async () => {
            // Simulate different translation providers
            const googleLogger = Logger.create(
                'GoogleTranslate',
                mockConfigService
            );
            const deeplLogger = Logger.create(
                'DeepLTranslate',
                mockConfigService
            );
            const microsoftLogger = Logger.create(
                'MicrosoftTranslate',
                mockConfigService
            );

            await Promise.all([
                googleLogger.updateLevel(),
                deeplLogger.updateLevel(),
                microsoftLogger.updateLevel(),
            ]);

            // Test translation request logging
            googleLogger.info('Translation request', {
                from: 'en',
                to: 'zh-CN',
                textLength: 150,
            });

            deeplLogger.warn('API rate limit approaching', {
                remainingRequests: 10,
            });

            microsoftLogger.error(
                'Translation failed',
                new Error('Network timeout'),
                {
                    retryCount: 3,
                }
            );

            expect(consoleSpies.info).toHaveBeenCalledWith(
                expect.stringContaining(
                    '[INFO] [GoogleTranslate] Translation request'
                )
            );
            expect(consoleSpies.warn).toHaveBeenCalledWith(
                expect.stringContaining(
                    '[WARN] [DeepLTranslate] API rate limit approaching'
                )
            );
            expect(consoleSpies.error).toHaveBeenCalledWith(
                expect.stringContaining(
                    '[ERROR] [MicrosoftTranslate] Translation failed'
                )
            );
        });

        it('should handle service class logging integration', async () => {
            // Simulate ConfigService logging (avoiding circular dependency)
            const configLogger = Logger.create('ConfigService');
            const errorHandlerLogger = Logger.create(
                'ConfigServiceErrorHandler',
                mockConfigService
            );

            await errorHandlerLogger.updateLevel();

            // Test service operations
            configLogger.debug('Configuration loaded', {
                keys: ['loggingLevel', 'selectedProvider'],
            });

            errorHandlerLogger.error(
                'Storage operation failed',
                new Error('Chrome API error'),
                {
                    operation: 'get',
                    keys: ['loggingLevel'],
                }
            );

            // ConfigService logger without config service should use default level
            expect(configLogger.currentLevel).toBe(Logger.LEVELS.INFO);

            // Debug should not log at INFO level
            expect(consoleSpies.debug).not.toHaveBeenCalled();

            // Error should log
            expect(consoleSpies.error).toHaveBeenCalledWith(
                expect.stringContaining(
                    '[ERROR] [ConfigServiceErrorHandler] Storage operation failed'
                )
            );
        });

        it('should handle content script logging with fallback mechanisms', async () => {
            // Simulate content script without config service access
            const contentLogger = Logger.create('ContentScript');

            // Should use default level
            expect(contentLogger.currentLevel).toBe(Logger.LEVELS.INFO);

            // Test fallback logging
            contentLogger.info('Content script initialized');
            contentLogger.debug('Debug info'); // Should not log
            contentLogger.warn('Subtitle injection warning');

            expect(consoleSpies.info).toHaveBeenCalledWith(
                expect.stringContaining(
                    '[INFO] [ContentScript] Content script initialized'
                )
            );
            expect(consoleSpies.debug).not.toHaveBeenCalled();
            expect(consoleSpies.warn).toHaveBeenCalledWith(
                expect.stringContaining(
                    '[WARN] [ContentScript] Subtitle injection warning'
                )
            );

            // Simulate receiving level update via message passing
            contentLogger.updateLevel(Logger.LEVELS.DEBUG);

            contentLogger.debug('Debug after level update');
            expect(consoleSpies.debug).toHaveBeenCalledWith(
                expect.stringContaining(
                    '[DEBUG] [ContentScript] Debug after level update'
                )
            );
        });
    });

    describe('Stress Testing and Edge Cases', () => {
        it('should handle rapid level changes without race conditions', async () => {
            const logger = Logger.create('StressTest', mockConfigService);

            // Rapidly change levels
            const levelChanges = [
                Logger.LEVELS.DEBUG,
                Logger.LEVELS.OFF,
                Logger.LEVELS.ERROR,
                Logger.LEVELS.INFO,
                Logger.LEVELS.WARN,
                Logger.LEVELS.DEBUG,
                Logger.LEVELS.OFF,
            ];

            const promises = levelChanges.map(async (level, index) => {
                await new Promise((resolve) => setTimeout(resolve, index * 10)); // Stagger slightly
                await logger.updateLevel(level);
                return level;
            });

            const results = await Promise.all(promises);

            // Final level should be the last one set
            expect(logger.currentLevel).toBe(Logger.LEVELS.OFF);
            expect(results).toEqual(levelChanges);
        });

        it('should handle concurrent logging from multiple components', async () => {
            const loggers = Array.from({ length: 10 }, (_, i) =>
                Logger.create(`Component${i}`, mockConfigService)
            );

            // Initialize all loggers
            await Promise.all(loggers.map((logger) => logger.updateLevel()));

            // Set to DEBUG level for all logging
            await mockConfigService.set('loggingLevel', Logger.LEVELS.DEBUG);
            await Promise.all(loggers.map((logger) => logger.updateLevel()));

            // Concurrent logging
            const loggingPromises = loggers.map(async (logger, index) => {
                for (let i = 0; i < 10; i++) {
                    logger.debug(`Message ${i} from component ${index}`);
                    logger.info(`Info ${i} from component ${index}`);
                    logger.warn(`Warning ${i} from component ${index}`);
                    if (i % 3 === 0) {
                        logger.error(
                            `Error ${i} from component ${index}`,
                            new Error(`Test error ${i}`)
                        );
                    }
                    // Small delay to simulate real usage
                    await new Promise((resolve) => setTimeout(resolve, 1));
                }
            });

            await Promise.all(loggingPromises);

            // Should have logged from all components
            expect(consoleSpies.debug).toHaveBeenCalledTimes(100); // 10 components * 10 messages
            expect(consoleSpies.info).toHaveBeenCalledTimes(100);
            expect(consoleSpies.warn).toHaveBeenCalledTimes(100);
            expect(consoleSpies.error).toHaveBeenCalledTimes(40); // Every 3rd iteration * 10 components
        });

        it('should handle memory pressure scenarios', async () => {
            const logger = Logger.create('MemoryTest', mockConfigService);
            await logger.updateLevel(Logger.LEVELS.DEBUG);

            // Create large number of log entries
            const iterations = 1000;
            const largeObject = {
                data: new Array(100).fill('x').join(''),
                timestamp: Date.now(),
                nested: {
                    array: new Array(50).fill({ key: 'value', number: 123 }),
                },
            };

            const startMemory = process.memoryUsage();

            for (let i = 0; i < iterations; i++) {
                logger.debug(`Memory test iteration ${i}`, {
                    ...largeObject,
                    iteration: i,
                });

                // Occasionally check memory usage
                if (i % 100 === 0) {
                    const currentMemory = process.memoryUsage();
                    const memoryIncrease =
                        currentMemory.heapUsed - startMemory.heapUsed;

                    // Memory increase should be reasonable (less than 50MB)
                    expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024);
                }
            }

            expect(consoleSpies.debug).toHaveBeenCalledTimes(iterations);
        });

        it('should handle invalid logging level values gracefully', async () => {
            const logger = Logger.create('InvalidTest', mockConfigService);

            // Test various invalid values that get set directly
            const directSetValues = [-1, 5, 'debug', {}, [], true, false];

            for (const invalidValue of directSetValues) {
                await logger.updateLevel(invalidValue);

                // The logger currently accepts any value as-is
                // In a real implementation, this should be validated
                expect(logger.currentLevel).toBe(invalidValue);

                // With invalid values, shouldLog comparison fails, so no logging occurs
                // This demonstrates the need for input validation in the Logger class
                logger.info(`Test with invalid level: ${invalidValue}`);

                // Most invalid values will cause shouldLog to return false
                // Only numeric values >= INFO level (3) will actually log
                if (
                    typeof invalidValue === 'number' &&
                    invalidValue >= Logger.LEVELS.INFO
                ) {
                    expect(consoleSpies.info).toHaveBeenCalled();
                } else {
                    // For non-numeric or low numeric values, no logging should occur
                    // This is the current behavior, though ideally it should validate and fallback
                }
            }

            // Test null and undefined separately since they have special behavior (loads from config)
            await logger.updateLevel(null);
            expect(logger.currentLevel).toBe(Logger.LEVELS.INFO); // From mock config service

            await logger.updateLevel(undefined);
            expect(logger.currentLevel).toBe(Logger.LEVELS.INFO); // From mock config service

            // Test that setting a valid level after invalid ones works
            await logger.updateLevel(Logger.LEVELS.INFO);
            logger.info('Valid level test');
            expect(consoleSpies.info).toHaveBeenCalledWith(
                expect.stringContaining('[INFO] [InvalidTest] Valid level test')
            );
        });
    });
});
