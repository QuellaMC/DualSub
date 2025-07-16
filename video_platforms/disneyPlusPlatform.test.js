import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Mock Logger module
const mockLoggerInstance = {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
};

jest.unstable_mockModule('../utils/logger.js', () => ({
    default: {
        create: jest.fn(() => mockLoggerInstance)
    }
}));

const { DisneyPlusPlatform } = await import('./disneyPlusPlatform.js');

// Mock Chrome APIs
global.chrome = {
    storage: {
        sync: {
            get: jest.fn(),
        },
        onChanged: {
            addListener: jest.fn(),
            removeListener: jest.fn(),
        },
    },
    runtime: {
        sendMessage: jest.fn(),
        lastError: null,
    },
};

// Mock DOM
Object.defineProperty(window, 'location', {
    value: {
        hostname: 'disneyplus.com',
        pathname: '/video/12345',
        href: 'https://disneyplus.com/video/12345',
    },
    writable: true,
});

describe('DisneyPlusPlatform Logging Integration', () => {
    let platform;

    beforeEach(() => {
        // Reset mocks
        jest.clearAllMocks();
        
        // Create platform instance
        platform = new DisneyPlusPlatform();
    });

    afterEach(() => {
        if (platform) {
            platform.cleanup();
        }
    });

    describe('Logger Initialization', () => {
        test('should create logger instance with correct component name', () => {
            expect(platform.logger).toBe(mockLoggerInstance);
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

            expect(mockLoggerInstance.info).toHaveBeenCalledWith(
                'Initialized and event listener added',
                expect.objectContaining({
                    selectors: expect.any(Array)
                })
            );
        });
    });

    describe('Subtitle URL Processing Logging', () => {
        test('should log inject script ready event', () => {
            const mockEvent = {
                detail: {
                    type: 'INJECT_SCRIPT_READY'
                }
            };

            platform._handleInjectorEvents(mockEvent);

            expect(mockLoggerInstance.info).toHaveBeenCalledWith('Inject script is ready');
        });

        test('should log subtitle URL found', () => {
            const mockEvent = {
                detail: {
                    type: 'SUBTITLE_URL_FOUND',
                    videoId: '12345',
                    url: 'http://example.com/master.m3u8'
                }
            };

            platform._handleInjectorEvents(mockEvent);

            expect(mockLoggerInstance.info).toHaveBeenCalledWith(
                'SUBTITLE_URL_FOUND for injectedVideoId',
                expect.objectContaining({
                    injectedVideoId: '12345',
                    url: 'http://example.com/master.m3u8'
                })
            );
        });

        test('should log error for missing videoId', () => {
            const mockEvent = {
                detail: {
                    type: 'SUBTITLE_URL_FOUND',
                    url: 'http://example.com/master.m3u8'
                }
            };

            platform._handleInjectorEvents(mockEvent);

            expect(mockLoggerInstance.error).toHaveBeenCalledWith(
                'SUBTITLE_URL_FOUND event without a videoId',
                null,
                expect.objectContaining({
                    url: 'http://example.com/master.m3u8'
                })
            );
        });
    });

    describe('Video Context Change Logging', () => {
        test('should log video context change', () => {
            platform.currentVideoId = '11111';
            
            const mockEvent = {
                detail: {
                    type: 'SUBTITLE_URL_FOUND',
                    videoId: '12345',
                    url: 'http://example.com/master.m3u8'
                }
            };

            chrome.storage.sync.get.mockImplementation((keys, callback) => {
                callback({
                    targetLanguage: 'zh-CN',
                    originalLanguage: 'en'
                });
            });

            chrome.runtime.sendMessage.mockImplementation((message, callback) => {
                callback({
                    success: true,
                    videoId: '12345'
                });
            });

            platform._handleInjectorEvents(mockEvent);

            expect(mockLoggerInstance.info).toHaveBeenCalledWith(
                'Video context changing',
                expect.objectContaining({
                    previousVideoId: '11111',
                    newVideoId: '12345'
                })
            );
        });

        test('should log already processed URL', () => {
            platform.currentVideoId = '12345';
            platform.lastKnownVttUrlForVideoId['12345'] = 'http://example.com/master.m3u8';
            
            const mockEvent = {
                detail: {
                    type: 'SUBTITLE_URL_FOUND',
                    videoId: '12345',
                    url: 'http://example.com/master.m3u8'
                }
            };

            platform._handleInjectorEvents(mockEvent);

            expect(mockLoggerInstance.debug).toHaveBeenCalledWith(
                'VTT URL already processed or known',
                expect.objectContaining({
                    url: 'http://example.com/master.m3u8',
                    videoId: '12345'
                })
            );
        });
    });

    describe('Background Communication Logging', () => {
        test('should log VTT request to background', () => {
            chrome.storage.sync.get.mockImplementation((keys, callback) => {
                callback({
                    targetLanguage: 'zh-CN',
                    originalLanguage: 'en'
                });
            });

            chrome.runtime.sendMessage.mockImplementation((message, callback) => {
                callback({
                    success: true,
                    videoId: '12345'
                });
            });

            const mockEvent = {
                detail: {
                    type: 'SUBTITLE_URL_FOUND',
                    videoId: '12345',
                    url: 'http://example.com/master.m3u8'
                }
            };

            platform._handleInjectorEvents(mockEvent);

            expect(mockLoggerInstance.info).toHaveBeenCalledWith(
                'Requesting VTT from background',
                expect.objectContaining({
                    url: 'http://example.com/master.m3u8',
                    videoId: '12345'
                })
            );
        });

        test('should log successful VTT fetch', () => {
            chrome.storage.sync.get.mockImplementation((keys, callback) => {
                callback({});
            });

            chrome.runtime.sendMessage.mockImplementation((message, callback) => {
                callback({
                    success: true,
                    videoId: '12345',
                    sourceLanguage: 'en',
                    targetLanguage: 'zh-CN',
                    url: 'http://example.com/subtitle.vtt'
                });
            });

            platform.currentVideoId = '12345';
            
            const mockEvent = {
                detail: {
                    type: 'SUBTITLE_URL_FOUND',
                    videoId: '12345',
                    url: 'http://example.com/master.m3u8'
                }
            };

            platform._handleInjectorEvents(mockEvent);

            expect(mockLoggerInstance.info).toHaveBeenCalledWith(
                'VTT fetched successfully',
                expect.objectContaining({
                    videoId: '12345',
                    sourceLanguage: 'en',
                    targetLanguage: 'zh-CN'
                })
            );
        });

        test('should log background fetch errors', () => {
            chrome.storage.sync.get.mockImplementation((keys, callback) => {
                callback({});
            });

            chrome.runtime.sendMessage.mockImplementation((message, callback) => {
                callback({
                    success: false,
                    error: 'Network error',
                    url: 'http://example.com/subtitle.vtt'
                });
            });

            platform.currentVideoId = '12345';
            
            const mockEvent = {
                detail: {
                    type: 'SUBTITLE_URL_FOUND',
                    videoId: '12345',
                    url: 'http://example.com/master.m3u8'
                }
            };

            platform._handleInjectorEvents(mockEvent);

            expect(mockLoggerInstance.error).toHaveBeenCalledWith(
                'Background failed to fetch VTT',
                null,
                expect.objectContaining({
                    error: 'Network error',
                    url: 'http://example.com/subtitle.vtt',
                    videoId: '12345'
                })
            );
        });

        test('should log chrome runtime errors', () => {
            chrome.storage.sync.get.mockImplementation((keys, callback) => {
                callback({});
            });

            chrome.runtime.lastError = { message: 'Extension context invalidated' };
            chrome.runtime.sendMessage.mockImplementation((message, callback) => {
                callback();
            });

            const mockEvent = {
                detail: {
                    type: 'SUBTITLE_URL_FOUND',
                    videoId: '12345',
                    url: 'http://example.com/master.m3u8'
                }
            };

            platform._handleInjectorEvents(mockEvent);

            expect(mockLoggerInstance.error).toHaveBeenCalledWith(
                'Error for VTT fetch',
                chrome.runtime.lastError,
                expect.objectContaining({
                    url: 'http://example.com/master.m3u8',
                    videoId: '12345'
                })
            );

            // Reset lastError
            chrome.runtime.lastError = null;
        });

        test('should log video context mismatch warnings', () => {
            chrome.storage.sync.get.mockImplementation((keys, callback) => {
                callback({});
            });

            chrome.runtime.sendMessage.mockImplementation((message, callback) => {
                callback({
                    success: true,
                    videoId: '67890' // Different from current
                });
            });

            platform.currentVideoId = '12345';
            
            const mockEvent = {
                detail: {
                    type: 'SUBTITLE_URL_FOUND',
                    videoId: '12345',
                    url: 'http://example.com/master.m3u8'
                }
            };

            platform._handleInjectorEvents(mockEvent);

            expect(mockLoggerInstance.warn).toHaveBeenCalledWith(
                'Received VTT for different video context - discarding',
                expect.objectContaining({
                    receivedVideoId: '67890',
                    currentVideoId: '12345'
                })
            );
        });
    });

    describe('Cleanup Logging', () => {
        test('should log successful cleanup', () => {
            platform.eventListener = jest.fn();
            platform.subtitleObserver = { disconnect: jest.fn() };
            
            platform.cleanup();

            expect(mockLoggerInstance.debug).toHaveBeenCalledWith('Event listener removed');
            expect(mockLoggerInstance.debug).toHaveBeenCalledWith('Subtitle mutation observer cleaned up');
            expect(mockLoggerInstance.info).toHaveBeenCalledWith('Platform cleaned up successfully');
        });
    });
});