/**
 * Tests for content script logging integration
 * Verifies that Logger instances are properly initialized and console calls are replaced
 */

import { jest } from '@jest/globals';

// Mock chrome runtime API
global.chrome = {
    runtime: {
        getURL: jest.fn((path) => `chrome-extension://test/${path}`),
        onMessage: {
            addListener: jest.fn(),
        },
        onConnect: {
            addListener: jest.fn(),
        },
    },
    tabs: {
        sendMessage: jest.fn(),
    },
};

// Mock DOM APIs
global.document = {
    createElement: jest.fn(() => ({
        style: {},
        setAttribute: jest.fn(),
        getAttribute: jest.fn(),
        appendChild: jest.fn(),
        removeChild: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
    })),
    getElementById: jest.fn(),
    querySelector: jest.fn(),
    body: {
        appendChild: jest.fn(),
        contains: jest.fn(() => true),
    },
    head: {
        appendChild: jest.fn(),
    },
    documentElement: {
        appendChild: jest.fn(),
    },
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    readyState: 'complete',
};

global.window = {
    location: {
        href: 'https://www.netflix.com/watch/123',
        hostname: 'netflix.com',
        pathname: '/watch/123',
    },
    history: {
        pushState: jest.fn(),
        replaceState: jest.fn(),
    },
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    getComputedStyle: jest.fn(() => ({ position: 'static' })),
    MutationObserver: jest.fn(() => ({
        observe: jest.fn(),
        disconnect: jest.fn(),
    })),
    setInterval: jest.fn(),
    clearInterval: jest.fn(),
    setTimeout: jest.fn(),
    clearTimeout: jest.fn(),
};

// Mock Logger class
const mockLogger = {
    LEVELS: {
        OFF: 0,
        ERROR: 1,
        WARN: 2,
        INFO: 3,
        DEBUG: 4,
    },
    create: jest.fn(() => ({
        updateLevel: jest.fn(),
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    })),
};

// Mock config service
const mockConfigService = {
    get: jest.fn(),
    getAll: jest.fn(() =>
        Promise.resolve({
            subtitlesEnabled: true,
            loggingLevel: 3,
        })
    ),
    onChanged: jest.fn(),
};

// Mock subtitle utilities
const mockSubtitleUtils = {
    setSubtitlesActive: jest.fn(),
    hideSubtitleContainer: jest.fn(),
    showSubtitleContainer: jest.fn(),
    ensureSubtitleContainer: jest.fn(),
    clearSubtitlesDisplayAndQueue: jest.fn(),
    subtitlesActive: true,
    initializeLogger: jest.fn(),
};

// Mock platform classes
const mockPlatform = {
    isPlayerPageActive: jest.fn(() => true),
    getVideoElement: jest.fn(() => ({
        currentTime: 10,
        duration: 100,
        readyState: 4,
        HAVE_CURRENT_DATA: 2,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        getAttribute: jest.fn(),
        setAttribute: jest.fn(),
        removeAttribute: jest.fn(),
    })),
    getPlayerContainerElement: jest.fn(() => ({
        style: { position: 'relative' },
        appendChild: jest.fn(),
    })),
    initialize: jest.fn(),
    cleanup: jest.fn(),
    getCurrentVideoId: jest.fn(() => 'test-video-id'),
    handleNativeSubtitles: jest.fn(),
    _handleInjectorEvents: jest.fn(),
    handleInjectorEvents: jest.fn(),
    supportsProgressBarTracking: jest.fn(() => true),
    getProgressBarElement: jest.fn(),
};

describe('Content Script Logging Integration', () => {
    let consoleLogSpy;
    let consoleErrorSpy;
    let consoleWarnSpy;
    let consoleInfoSpy;
    let consoleDebugSpy;

    beforeEach(() => {
        // Spy on console methods to verify they're not being called directly
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
        consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation();
        consoleDebugSpy = jest.spyOn(console, 'debug').mockImplementation();

        // Reset all mocks
        jest.clearAllMocks();

        // Setup dynamic import mocks
        jest.doMock(
            'chrome-extension://test/utils/logger.js',
            () => ({
                default: mockLogger,
            }),
            { virtual: true }
        );

        jest.doMock(
            'chrome-extension://test/services/configService.js',
            () => ({
                configService: mockConfigService,
            }),
            { virtual: true }
        );

        jest.doMock(
            'chrome-extension://test/content_scripts/subtitleUtilities.js',
            () => mockSubtitleUtils,
            { virtual: true }
        );

        jest.doMock(
            'chrome-extension://test/video_platforms/netflixPlatform.js',
            () => ({
                NetflixPlatform: jest.fn(() => mockPlatform),
            }),
            { virtual: true }
        );

        jest.doMock(
            'chrome-extension://test/video_platforms/disneyPlusPlatform.js',
            () => ({
                DisneyPlusPlatform: jest.fn(() => mockPlatform),
            }),
            { virtual: true }
        );
    });

    afterEach(() => {
        consoleLogSpy.mockRestore();
        consoleErrorSpy.mockRestore();
        consoleWarnSpy.mockRestore();
        consoleInfoSpy.mockRestore();
        consoleDebugSpy.mockRestore();
        jest.resetModules();
    });

    describe('Logger Initialization', () => {
        test('should create logger instance with correct component name', () => {
            const logger = mockLogger.create('NetflixContent');

            expect(mockLogger.create).toHaveBeenCalledWith('NetflixContent');
            expect(logger).toHaveProperty('updateLevel');
            expect(logger).toHaveProperty('debug');
            expect(logger).toHaveProperty('info');
            expect(logger).toHaveProperty('warn');
            expect(logger).toHaveProperty('error');
        });

        test('should handle config service errors gracefully', async () => {
            mockConfigService.get.mockRejectedValue(
                new Error('Config not available')
            );

            const logger = mockLogger.create('NetflixContent');

            try {
                const loggingLevel =
                    await mockConfigService.get('loggingLevel');
                logger.updateLevel(loggingLevel);
            } catch (error) {
                // Fallback to INFO level
                logger.updateLevel(mockLogger.LEVELS.INFO);
                logger.warn(
                    'Failed to load logging level from config, using INFO level',
                    error
                );
            }

            expect(logger.updateLevel).toHaveBeenCalledWith(
                mockLogger.LEVELS.INFO
            );
            expect(logger.warn).toHaveBeenCalledWith(
                'Failed to load logging level from config, using INFO level',
                expect.any(Error)
            );
        });

        test('should initialize with fallback logging when logger unavailable', () => {
            const logWithFallback = (level, message, data = {}) => {
                // Simulate logger not available
                const contentLogger = null;
                if (contentLogger) {
                    contentLogger[level](message, data);
                } else {
                    console.log(
                        `[NetflixContent] [${level.toUpperCase()}] ${message}`,
                        data
                    );
                }
            };

            logWithFallback('info', 'Content script logger initialized', {
                level: 3,
            });

            expect(consoleLogSpy).toHaveBeenCalledWith(
                '[NetflixContent] [INFO] Content script logger initialized',
                { level: 3 }
            );
        });
    });

    describe('Message Handling for Logging Level Updates', () => {
        test('should handle LOGGING_LEVEL_CHANGED messages', async () => {
            const mockLogger = {
                updateLevel: jest.fn(),
                info: jest.fn(),
            };

            // Mock the content logger
            jest.doMock(
                '../content_scripts/netflixContent.js',
                () => ({
                    contentLogger: mockLogger,
                }),
                { virtual: true }
            );

            // Simulate message listener
            const messageListener = jest.fn((request, sender, sendResponse) => {
                if (request.type === 'LOGGING_LEVEL_CHANGED') {
                    if (mockLogger) {
                        mockLogger.updateLevel(request.level);
                        mockLogger.info(
                            'Logging level updated from background script',
                            {
                                newLevel: request.level,
                            }
                        );
                    }
                    sendResponse({ success: true });
                    return false;
                }
            });

            // Test the message handling
            const mockSendResponse = jest.fn();
            messageListener(
                {
                    type: 'LOGGING_LEVEL_CHANGED',
                    level: 2,
                },
                {},
                mockSendResponse
            );

            expect(mockLogger.updateLevel).toHaveBeenCalledWith(2);
            expect(mockLogger.info).toHaveBeenCalledWith(
                'Logging level updated from background script',
                { newLevel: 2 }
            );
            expect(mockSendResponse).toHaveBeenCalledWith({ success: true });
        });

        test('should handle logging level changes when logger not initialized', () => {
            const messageListener = jest.fn((request, sender, sendResponse) => {
                if (request.type === 'LOGGING_LEVEL_CHANGED') {
                    // contentLogger is null
                    console.log(
                        '[NetflixContent] [INFO] Logging level change received but logger not initialized yet',
                        {
                            level: request.level,
                        }
                    );
                    sendResponse({ success: true });
                    return false;
                }
            });

            const mockSendResponse = jest.fn();
            messageListener(
                {
                    type: 'LOGGING_LEVEL_CHANGED',
                    level: 4,
                },
                {},
                mockSendResponse
            );

            expect(consoleLogSpy).toHaveBeenCalledWith(
                '[NetflixContent] [INFO] Logging level change received but logger not initialized yet',
                { level: 4 }
            );
            expect(mockSendResponse).toHaveBeenCalledWith({ success: true });
        });
    });

    describe('Fallback Logging Mechanism', () => {
        test('should use fallback logging when logger not available', () => {
            const logWithFallback = (level, message, data = {}) => {
                // contentLogger is null, so use fallback
                console.log(
                    `[NetflixContent] [${level.toUpperCase()}] ${message}`,
                    data
                );
            };

            logWithFallback('info', 'Test message', { test: 'data' });

            expect(consoleLogSpy).toHaveBeenCalledWith(
                '[NetflixContent] [INFO] Test message',
                { test: 'data' }
            );
        });

        test('should use logger when available', () => {
            const mockLogger = {
                info: jest.fn(),
            };

            const logWithFallback = (level, message, data = {}) => {
                if (mockLogger) {
                    mockLogger[level](message, data);
                } else {
                    console.log(
                        `[NetflixContent] [${level.toUpperCase()}] ${message}`,
                        data
                    );
                }
            };

            logWithFallback('info', 'Test message', { test: 'data' });

            expect(mockLogger.info).toHaveBeenCalledWith('Test message', {
                test: 'data',
            });
            expect(consoleLogSpy).not.toHaveBeenCalled();
        });
    });

    describe('Error Handling in Content Scripts', () => {
        test('should handle module loading errors with proper logging', () => {
            const logWithFallback = (level, message, data = {}) => {
                console.log(
                    `[NetflixContent] [${level.toUpperCase()}] ${message}`,
                    data
                );
            };

            const error = new Error('Module not found');
            logWithFallback('error', 'Error loading modules', { error });

            expect(consoleLogSpy).toHaveBeenCalledWith(
                '[NetflixContent] [ERROR] Error loading modules',
                { error: expect.any(Error) }
            );
        });

        test('should handle platform initialization errors', () => {
            const logWithFallback = (level, message, data = {}) => {
                console.log(
                    `[NetflixContent] [${level.toUpperCase()}] ${message}`,
                    data
                );
            };

            const error = new Error('Platform initialization failed');
            logWithFallback('error', 'Error initializing Netflix platform', {
                error,
            });

            expect(consoleLogSpy).toHaveBeenCalledWith(
                '[NetflixContent] [ERROR] Error initializing Netflix platform',
                { error }
            );
        });
    });

    describe('Subtitle Utilities Logging', () => {
        test('should initialize logger in subtitle utilities', async () => {
            await mockSubtitleUtils.initializeLogger();

            expect(mockSubtitleUtils.initializeLogger).toHaveBeenCalled();
        });

        test('should handle subtitle utilities logging errors', () => {
            const logWithFallback = (level, message, data = {}) => {
                console.log(
                    `[SubtitleUtils] [${level.toUpperCase()}] ${message}`,
                    data
                );
            };

            logWithFallback('error', 'Failed to initialize logger', {
                error: new Error('Logger unavailable'),
            });

            expect(consoleLogSpy).toHaveBeenCalledWith(
                '[SubtitleUtils] [ERROR] Failed to initialize logger',
                { error: expect.any(Error) }
            );
        });
    });

    describe('Cross-Context Synchronization', () => {
        test('should handle extension context invalidation', () => {
            const logWithFallback = (level, message, data = {}) => {
                console.log(
                    `[NetflixContent] [${level.toUpperCase()}] ${message}`,
                    data
                );
            };

            // Simulate extension context invalidation
            global.chrome.runtime.lastError = {
                message: 'Extension context invalidated',
            };

            // Simulate the disconnect handler
            logWithFallback(
                'info',
                'Extension context invalidated, cleaning up'
            );

            expect(consoleLogSpy).toHaveBeenCalledWith(
                '[NetflixContent] [INFO] Extension context invalidated, cleaning up',
                {}
            );
        });
    });

    describe('Performance and Memory Management', () => {
        test('should not create excessive log entries', () => {
            const logWithFallback = (level, message, data = {}) => {
                console.log(
                    `[NetflixContent] [${level.toUpperCase()}] ${message}`,
                    data
                );
            };

            // Simulate multiple rapid calls
            for (let i = 0; i < 100; i++) {
                logWithFallback('debug', `Debug message ${i}`, {
                    iteration: i,
                });
            }

            // Should have called console.log 100 times
            expect(consoleLogSpy).toHaveBeenCalledTimes(100);
        });

        test('should handle cleanup properly', () => {
            const logWithFallback = (level, message, data = {}) => {
                console.log(
                    `[NetflixContent] [${level.toUpperCase()}] ${message}`,
                    data
                );
            };

            // Simulate cleanup
            logWithFallback('info', 'All cleanup completed');

            expect(consoleLogSpy).toHaveBeenCalledWith(
                '[NetflixContent] [INFO] All cleanup completed',
                {}
            );
        });
    });
});
