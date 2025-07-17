/**
 * Integration tests for cross-context logging level synchronization
 * Tests the message passing system for broadcasting logging level changes
 */

import { jest } from '@jest/globals';
import Logger from './logger.js';

// Mock additional chrome APIs for testing (extending the global setup)
const mockChrome = {
    ...global.chrome,
    tabs: {
        query: jest.fn(),
        sendMessage: jest.fn(),
    },
};

// Mock ConfigService
const mockConfigService = {
    get: jest.fn(),
    onChanged: jest.fn(),
};

global.chrome = mockChrome;

describe('Cross-Context Logging Level Synchronization', () => {
    let backgroundLogger;
    let contentLogger;
    let popupLogger;
    let optionsLogger;

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();

        // Create logger instances for different contexts
        backgroundLogger = Logger.create('Background', mockConfigService);
        contentLogger = Logger.create('ContentScript');
        popupLogger = Logger.create('Popup', mockConfigService);
        optionsLogger = Logger.create('Options', mockConfigService);
    });

    describe('Background Script Broadcasting', () => {
        test('should broadcast logging level changes to all tabs', async () => {
            // Mock tabs query to return test tabs
            const mockTabs = [
                { id: 1, url: 'https://netflix.com/watch/123' },
                { id: 2, url: 'https://disneyplus.com/video/456' },
                { id: 3, url: 'https://example.com' }, // Should be ignored
            ];
            mockChrome.tabs.query.mockResolvedValue(mockTabs);
            mockChrome.tabs.sendMessage.mockResolvedValue({ success: true });

            // Simulate the broadcast function from background script
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
                                // Ignore errors for tabs without content scripts
                            });
                        messagePromises.push(messagePromise);
                    }
                }

                await Promise.allSettled(messagePromises);
            };

            // Test broadcasting
            await broadcastLoggingLevelChange(Logger.LEVELS.DEBUG);

            // Verify tabs.query was called
            expect(mockChrome.tabs.query).toHaveBeenCalledWith({});

            // Verify messages were sent to relevant tabs only
            expect(mockChrome.tabs.sendMessage).toHaveBeenCalledTimes(2);
            expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(1, {
                type: 'LOGGING_LEVEL_CHANGED',
                level: Logger.LEVELS.DEBUG,
            });
            expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(2, {
                type: 'LOGGING_LEVEL_CHANGED',
                level: Logger.LEVELS.DEBUG,
            });
        });

        test('should handle tab message failures gracefully', async () => {
            const mockTabs = [{ id: 1, url: 'https://netflix.com/watch/123' }];
            mockChrome.tabs.query.mockResolvedValue(mockTabs);
            mockChrome.tabs.sendMessage.mockRejectedValue(
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
                            });
                        messagePromises.push(messagePromise);
                    }
                }

                await Promise.allSettled(messagePromises);
            };

            // Should not throw despite tab message failure
            await expect(
                broadcastLoggingLevelChange(Logger.LEVELS.ERROR)
            ).resolves.toBeUndefined();
            expect(mockChrome.tabs.sendMessage).toHaveBeenCalledTimes(1);
        });
    });

    describe('Content Script Message Handling', () => {
        test('should update logging level when receiving message from background', () => {
            const initialLevel = Logger.LEVELS.INFO;
            const newLevel = Logger.LEVELS.DEBUG;

            contentLogger.updateLevel(initialLevel);
            expect(contentLogger.currentLevel).toBe(initialLevel);

            // Simulate message handler
            const handleMessage = (request, sender, sendResponse) => {
                if (request.type === 'LOGGING_LEVEL_CHANGED') {
                    contentLogger.updateLevel(request.level);
                    sendResponse({ success: true });
                    return false;
                }
            };

            const mockSendResponse = jest.fn();
            const result = handleMessage(
                {
                    type: 'LOGGING_LEVEL_CHANGED',
                    level: newLevel,
                },
                {},
                mockSendResponse
            );

            expect(contentLogger.currentLevel).toBe(newLevel);
            expect(mockSendResponse).toHaveBeenCalledWith({ success: true });
            expect(result).toBe(false);
        });

        test('should handle message even when logger not initialized', () => {
            let tempLogger = null;

            const handleMessage = (request, sender, sendResponse) => {
                if (request.type === 'LOGGING_LEVEL_CHANGED') {
                    if (tempLogger) {
                        tempLogger.updateLevel(request.level);
                    } else {
                        // Should log but not crash
                        console.log(
                            'Logging level change received but logger not initialized yet'
                        );
                    }
                    sendResponse({ success: true });
                    return false;
                }
            };

            const mockSendResponse = jest.fn();
            const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

            const result = handleMessage(
                {
                    type: 'LOGGING_LEVEL_CHANGED',
                    level: Logger.LEVELS.WARN,
                },
                {},
                mockSendResponse
            );

            expect(consoleSpy).toHaveBeenCalled();
            expect(mockSendResponse).toHaveBeenCalledWith({ success: true });
            expect(result).toBe(false);

            consoleSpy.mockRestore();
        });
    });

    describe('Popup and Options Context Synchronization', () => {
        test('should update logging level when configuration changes', async () => {
            const initialLevel = Logger.LEVELS.INFO;
            const newLevel = Logger.LEVELS.ERROR;

            // Mock config service to return initial level
            mockConfigService.get.mockResolvedValue(initialLevel);
            await popupLogger.updateLevel();
            expect(popupLogger.currentLevel).toBe(initialLevel);

            // Simulate configuration change
            let changeCallback;
            mockConfigService.onChanged.mockImplementation((callback) => {
                changeCallback = callback;
                return () => {}; // Return unsubscribe function
            });

            // Set up change listener (simulating popup initialization)
            mockConfigService.onChanged((changes) => {
                if ('loggingLevel' in changes) {
                    popupLogger.updateLevel(changes.loggingLevel);
                }
            });

            // Trigger change
            changeCallback({ loggingLevel: newLevel });

            expect(popupLogger.currentLevel).toBe(newLevel);
        });

        test('should initialize with fallback level when config fails', async () => {
            mockConfigService.get.mockRejectedValue(
                new Error('Config unavailable')
            );

            await popupLogger.updateLevel();

            // Should fallback to INFO level
            expect(popupLogger.currentLevel).toBe(Logger.LEVELS.INFO);
        });
    });

    describe('Level Filtering Behavior', () => {
        test('should filter messages correctly at different levels', () => {
            const consoleSpy = {
                debug: jest.spyOn(console, 'debug').mockImplementation(),
                info: jest.spyOn(console, 'info').mockImplementation(),
                warn: jest.spyOn(console, 'warn').mockImplementation(),
                error: jest.spyOn(console, 'error').mockImplementation(),
            };

            // Test DEBUG level (should show all)
            contentLogger.updateLevel(Logger.LEVELS.DEBUG);
            contentLogger.debug('Debug message');
            contentLogger.info('Info message');
            contentLogger.warn('Warn message');
            contentLogger.error('Error message');

            expect(consoleSpy.debug).toHaveBeenCalledTimes(1);
            expect(consoleSpy.info).toHaveBeenCalledTimes(1);
            expect(consoleSpy.warn).toHaveBeenCalledTimes(1);
            expect(consoleSpy.error).toHaveBeenCalledTimes(1);

            // Reset spies
            Object.values(consoleSpy).forEach((spy) => spy.mockClear());

            // Test WARN level (should show warn and error only)
            contentLogger.updateLevel(Logger.LEVELS.WARN);
            contentLogger.debug('Debug message');
            contentLogger.info('Info message');
            contentLogger.warn('Warn message');
            contentLogger.error('Error message');

            expect(consoleSpy.debug).toHaveBeenCalledTimes(0);
            expect(consoleSpy.info).toHaveBeenCalledTimes(0);
            expect(consoleSpy.warn).toHaveBeenCalledTimes(1);
            expect(consoleSpy.error).toHaveBeenCalledTimes(1);

            // Reset spies
            Object.values(consoleSpy).forEach((spy) => spy.mockClear());

            // Test OFF level (should show nothing)
            contentLogger.updateLevel(Logger.LEVELS.OFF);
            contentLogger.debug('Debug message');
            contentLogger.info('Info message');
            contentLogger.warn('Warn message');
            contentLogger.error('Error message');

            expect(consoleSpy.debug).toHaveBeenCalledTimes(0);
            expect(consoleSpy.info).toHaveBeenCalledTimes(0);
            expect(consoleSpy.warn).toHaveBeenCalledTimes(0);
            expect(consoleSpy.error).toHaveBeenCalledTimes(0);

            // Restore spies
            Object.values(consoleSpy).forEach((spy) => spy.mockRestore());
        });
    });

    describe('Real-time Synchronization', () => {
        test('should synchronize logging levels across all contexts in real-time', async () => {
            const newLevel = Logger.LEVELS.WARN;

            // Mock configuration service for contexts that use it
            mockConfigService.get.mockResolvedValue(Logger.LEVELS.INFO);

            // Initialize all loggers
            await backgroundLogger.updateLevel();
            await popupLogger.updateLevel();
            await optionsLogger.updateLevel();
            contentLogger.updateLevel(Logger.LEVELS.INFO);

            // Verify initial state
            expect(backgroundLogger.currentLevel).toBe(Logger.LEVELS.INFO);
            expect(popupLogger.currentLevel).toBe(Logger.LEVELS.INFO);
            expect(optionsLogger.currentLevel).toBe(Logger.LEVELS.INFO);
            expect(contentLogger.currentLevel).toBe(Logger.LEVELS.INFO);

            // Simulate configuration change (would happen when user changes setting)
            let configChangeCallback;
            mockConfigService.onChanged.mockImplementation((callback) => {
                configChangeCallback = callback;
                return () => {};
            });

            // Set up change listeners for popup and options
            mockConfigService.onChanged((changes) => {
                if ('loggingLevel' in changes) {
                    popupLogger.updateLevel(changes.loggingLevel);
                    optionsLogger.updateLevel(changes.loggingLevel);
                }
            });

            // Simulate content script message handler
            const handleContentMessage = (request) => {
                if (request.type === 'LOGGING_LEVEL_CHANGED') {
                    contentLogger.updateLevel(request.level);
                }
            };

            // Trigger configuration change
            configChangeCallback({ loggingLevel: newLevel });

            // Simulate background script broadcasting to content script
            handleContentMessage({
                type: 'LOGGING_LEVEL_CHANGED',
                level: newLevel,
            });

            // Verify all contexts are synchronized
            expect(popupLogger.currentLevel).toBe(newLevel);
            expect(optionsLogger.currentLevel).toBe(newLevel);
            expect(contentLogger.currentLevel).toBe(newLevel);
        });
    });

    describe('Error Handling and Resilience', () => {
        test('should continue working when some contexts fail to update', async () => {
            const newLevel = Logger.LEVELS.DEBUG;

            // Mock one context to fail
            const failingLogger = Logger.create('FailingContext', {
                get: jest
                    .fn()
                    .mockRejectedValue(new Error('Config service unavailable')),
                onChanged: jest.fn(),
            });

            // Should not throw when updating failing logger
            await expect(failingLogger.updateLevel()).resolves.toBeUndefined();

            // Should fallback to INFO level
            expect(failingLogger.currentLevel).toBe(Logger.LEVELS.INFO);

            // Other loggers should still work
            contentLogger.updateLevel(newLevel);
            expect(contentLogger.currentLevel).toBe(newLevel);
        });

        test('should handle malformed messages gracefully', () => {
            const handleMessage = (request, sender, sendResponse) => {
                if (request.type === 'LOGGING_LEVEL_CHANGED') {
                    // Should handle invalid level gracefully
                    const level =
                        typeof request.level === 'number'
                            ? request.level
                            : Logger.LEVELS.INFO;
                    contentLogger.updateLevel(level);
                    sendResponse({ success: true });
                    return false;
                }
            };

            const mockSendResponse = jest.fn();

            // Test with invalid level
            handleMessage(
                {
                    type: 'LOGGING_LEVEL_CHANGED',
                    level: 'invalid',
                },
                {},
                mockSendResponse
            );

            // Should fallback to INFO level
            expect(contentLogger.currentLevel).toBe(Logger.LEVELS.INFO);
            expect(mockSendResponse).toHaveBeenCalledWith({ success: true });
        });
    });
});
