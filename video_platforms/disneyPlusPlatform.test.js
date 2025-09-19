import {
    describe,
    it,
    expect,
    beforeEach,
    afterEach,
    jest,
} from '@jest/globals';
import { DisneyPlusPlatform } from './disneyPlusPlatform.js';
import {
    mockWindowLocation,
    LocationMock,
} from '../test-utils/location-mock.js';
import { mockChromeApi, ChromeApiMock } from '../test-utils/chrome-api-mock.js';
import { createLoggerMock } from '../test-utils/logger-mock.js';
import Logger from '../utils/logger.js';
import { configService } from '../services/configService.js';
import flushPromises from '../test-utils/flush-promises.js';

describe('DisneyPlusPlatform Logging Integration', () => {
    let platform;
    let mockLogger;
    let chromeApiMock;
    let locationCleanup;

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();

        // Setup configService mock
        jest.spyOn(configService, 'getMultiple').mockResolvedValue({
            targetLanguage: 'zh-CN',
            originalLanguage: 'en',
        });
        jest.spyOn(configService, 'get').mockResolvedValue(true);

        // Setup Chrome API mock
        chromeApiMock = ChromeApiMock.create();
        global.chrome = chromeApiMock;

        // Create logger mock using centralized utility
        mockLogger = createLoggerMock();
        jest.spyOn(Logger, 'create').mockReturnValue(mockLogger);

        // Create platform instance
        platform = new DisneyPlusPlatform();

        // Mock platform detection methods to simulate Disney Plus environment
        jest.spyOn(platform, 'isPlatformActive').mockReturnValue(true);
        jest.spyOn(platform, 'isPlayerPageActive').mockReturnValue(true);

        locationCleanup = () => {
            // No cleanup needed for method mocks
        };
    });

    afterEach(() => {
        // Cleanup platform
        if (platform) {
            platform.cleanup();
        }

        // Restore location mock
        if (locationCleanup) {
            locationCleanup();
        }

        // Reset Chrome API mock
        if (chromeApiMock) {
            chromeApiMock.reset();
        }

        // Reset logger mock
        if (mockLogger) {
            mockLogger.reset();
        }

        // Clear all Jest mocks
        jest.clearAllMocks();
    });

    describe('Logger Initialization', () => {
        test('should create logger instance with correct component name', () => {
            expect(platform.logger).toBe(mockLogger);
        });
    });

    describe('Platform Detection Logging', () => {
        test('should log platform active detection', () => {
            const isActive = platform.isPlatformActive();
            expect(isActive).toBe(true);
        });

        test('should log player page detection', () => {
            const isPlayerActive = platform.isPlayerPageActive();
            expect(isPlayerActive).toBe(true);
        });
    });

    describe('Initialization Logging', () => {
        test('should log successful initialization', async () => {
            const mockOnSubtitleFound = jest.fn();
            const mockOnVideoIdChange = jest.fn();

            await platform.initialize(mockOnSubtitleFound, mockOnVideoIdChange);

            expect(mockLogger.info).toHaveBeenCalledWith(
                'Initialized and event listener added',
                expect.objectContaining({
                    selectors: expect.any(Array),
                })
            );
        });
    });

    describe('Subtitle URL Processing Logging', () => {
        test('should log inject script ready event', () => {
            const mockEvent = {
                detail: {
                    type: 'INJECT_SCRIPT_READY',
                },
            };

            platform._handleInjectorEvents(mockEvent);

            expect(mockLogger.info).toHaveBeenCalledWith(
                'Inject script is ready'
            );
        });

        test('should log subtitle URL found', () => {
            const mockEvent = {
                detail: {
                    type: 'SUBTITLE_URL_FOUND',
                    videoId: '12345',
                    url: 'http://example.com/master.m3u8',
                },
            };

            platform._handleInjectorEvents(mockEvent);

            expect(mockLogger.info).toHaveBeenCalledWith(
                'SUBTITLE_URL_FOUND for injectedVideoId',
                expect.objectContaining({
                    injectedVideoId: '12345',
                    url: 'http://example.com/master.m3u8',
                })
            );
        });

        test('should log error for missing videoId', () => {
            const mockEvent = {
                detail: {
                    type: 'SUBTITLE_URL_FOUND',
                    url: 'http://example.com/master.m3u8',
                },
            };

            platform._handleInjectorEvents(mockEvent);

            expect(mockLogger.error).toHaveBeenCalledWith(
                'SUBTITLE_URL_FOUND event without a videoId',
                null,
                expect.objectContaining({
                    url: 'http://example.com/master.m3u8',
                })
            );
        });
    });

    describe('Video Context Change Logging', () => {
        test('should log video context change', async () => {
            platform.currentVideoId = '11111';

            const mockEvent = {
                detail: {
                    type: 'SUBTITLE_URL_FOUND',
                    videoId: '12345',
                    url: 'http://example.com/master.m3u8',
                },
            };

            chromeApiMock.runtime.sendMessage.mockImplementation(
                (message, callback) => {
                    callback({
                        success: true,
                        videoId: '12345',
                    });
                }
            );

            platform._handleInjectorEvents(mockEvent);
            await flushPromises();

            expect(mockLogger.info).toHaveBeenCalledWith(
                'Video context changing',
                expect.objectContaining({
                    previousVideoId: '11111',
                    newVideoId: '12345',
                })
            );
        });

        test('should log already processed URL', () => {
            platform.currentVideoId = '12345';
            platform.lastKnownVttUrlForVideoId['12345'] =
                'http://example.com/master.m3u8';

            const mockEvent = {
                detail: {
                    type: 'SUBTITLE_URL_FOUND',
                    videoId: '12345',
                    url: 'http://example.com/master.m3u8',
                },
            };

            platform._handleInjectorEvents(mockEvent);

            expect(mockLogger.debug).toHaveBeenCalledWith(
                'VTT URL already processed or known',
                expect.objectContaining({
                    url: 'http://example.com/master.m3u8',
                    videoId: '12345',
                })
            );
        });
    });

    describe('Background Communication Logging', () => {
        test('should log VTT request to background', async () => {
            chromeApiMock.runtime.sendMessage.mockImplementation(
                (message, callback) => {
                    callback({
                        success: true,
                        videoId: '12345',
                    });
                }
            );

            const mockEvent = {
                detail: {
                    type: 'SUBTITLE_URL_FOUND',
                    videoId: '12345',
                    url: 'http://example.com/master.m3u8',
                },
            };

            platform._handleInjectorEvents(mockEvent);
            await flushPromises();

            expect(mockLogger.info).toHaveBeenCalledWith(
                'Requesting VTT from background',
                expect.objectContaining({
                    url: 'http://example.com/master.m3u8',
                    videoId: '12345',
                })
            );
        });

        test('should log successful VTT fetch', async () => {
            chromeApiMock.runtime.sendMessage.mockImplementation(
                (message, callback) => {
                    callback({
                        success: true,
                        videoId: '12345',
                        sourceLanguage: 'en',
                        targetLanguage: 'zh-CN',
                        url: 'http://example.com/subtitle.vtt',
                    });
                }
            );

            platform.currentVideoId = '12345';

            const mockEvent = {
                detail: {
                    type: 'SUBTITLE_URL_FOUND',
                    videoId: '12345',
                    url: 'http://example.com/master.m3u8',
                },
            };

            platform._handleInjectorEvents(mockEvent);
            await flushPromises();

            expect(mockLogger.info).toHaveBeenCalledWith(
                'VTT fetched successfully',
                expect.objectContaining({
                    videoId: '12345',
                    sourceLanguage: 'en',
                    targetLanguage: 'zh-CN',
                })
            );
        });

        test('should log background fetch errors', async () => {
            chromeApiMock.runtime.sendMessage.mockImplementation(
                (message, callback) => {
                    callback({
                        success: false,
                        error: 'Network error',
                        url: 'http://example.com/subtitle.vtt',
                    });
                }
            );

            platform.currentVideoId = '12345';

            const mockEvent = {
                detail: {
                    type: 'SUBTITLE_URL_FOUND',
                    videoId: '12345',
                    url: 'http://example.com/master.m3u8',
                },
            };

            platform._handleInjectorEvents(mockEvent);
            await flushPromises();

            expect(mockLogger.error).toHaveBeenCalledWith(
                'Background failed to fetch VTT',
                null,
                expect.objectContaining({
                    error: 'Network error',
                    url: 'http://example.com/subtitle.vtt',
                    videoId: '12345',
                })
            );
        });

        test('should log chrome runtime errors', async () => {
            chromeApiMock.runtime.lastError = {
                message: 'Extension context invalidated',
            };
            // Force dynamic import path to fail so the code takes the callback-based fallback path
            chromeApiMock.runtime.getURL = jest.fn(() => 'file:///non-existent-module.js');
            chromeApiMock.runtime.sendMessage.mockImplementation(
                (message, callback) => {
                    callback();
                }
            );

            const mockEvent = {
                detail: {
                    type: 'SUBTITLE_URL_FOUND',
                    videoId: '12345',
                    url: 'http://example.com/master.m3u8',
                },
            };

            platform._handleInjectorEvents(mockEvent);
            await flushPromises();

            expect(mockLogger.error).toHaveBeenCalledWith(
                'Error for VTT fetch',
                chromeApiMock.runtime.lastError,
                expect.objectContaining({
                    url: 'http://example.com/master.m3u8',
                    videoId: '12345',
                })
            );

            // Reset lastError
            chromeApiMock.runtime.lastError = null;
        });

        test('should log video context mismatch warnings', async () => {
            chromeApiMock.runtime.sendMessage.mockImplementation(
                (message, callback) => {
                    callback({
                        success: true,
                        videoId: '67890', // Different from current
                    });
                }
            );

            platform.currentVideoId = '12345';

            const mockEvent = {
                detail: {
                    type: 'SUBTITLE_URL_FOUND',
                    videoId: '12345',
                    url: 'http://example.com/master.m3u8',
                },
            };

            platform._handleInjectorEvents(mockEvent);
            await flushPromises();

            expect(mockLogger.warn).toHaveBeenCalledWith(
                'Received VTT for different video context - discarding',
                expect.objectContaining({
                    receivedVideoId: '67890',
                    currentVideoId: '12345',
                })
            );
        });
    });

    describe('Cleanup Logging', () => {
        test('should log successful cleanup', () => {
            platform.eventListener = jest.fn();
            platform.subtitleObserver = { disconnect: jest.fn() };

            platform.cleanup();

            expect(mockLogger.debug).toHaveBeenCalledWith(
                'Event listener removed'
            );
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'Subtitle mutation observer cleaned up'
            );
            expect(mockLogger.info).toHaveBeenCalledWith(
                'Platform cleaned up successfully'
            );
        });
    });
});
