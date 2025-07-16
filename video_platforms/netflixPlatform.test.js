import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { NetflixPlatform } from './netflixPlatform.js';
import Logger from '../utils/logger.js';

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
delete window.location;
window.location = {
    hostname: 'netflix.com',
    pathname: '/watch/12345',
    href: 'https://netflix.com/watch/12345',
};

describe('NetflixPlatform Logging Integration', () => {
    let platform;
    let mockLogger;

    beforeEach(() => {
        // Reset mocks
        jest.clearAllMocks();
        
        // Mock Logger.create to return a mock logger
        mockLogger = {
            info: jest.fn(),
            debug: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        };
        
        jest.spyOn(Logger, 'create').mockReturnValue(mockLogger);
        
        // Create platform instance
        platform = new NetflixPlatform();
    });

    afterEach(() => {
        if (platform) {
            platform.cleanup();
        }
    });

    describe('Logger Initialization', () => {
        test('should create logger instance with correct component name', () => {
            expect(Logger.create).toHaveBeenCalledWith('NetflixPlatform');
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
                    selectors: expect.any(Array)
                })
            );
        });
    });

    describe('Subtitle Data Processing Logging', () => {
        test('should log inject script ready event', () => {
            const mockEvent = {
                detail: {
                    type: 'INJECT_SCRIPT_READY'
                }
            };

            platform.handleInjectorEvents(mockEvent);

            expect(mockLogger.info).toHaveBeenCalledWith('Inject script is ready');
        });

        test('should log subtitle data received', () => {
            const mockEvent = {
                detail: {
                    type: 'SUBTITLE_DATA_FOUND',
                    payload: {
                        movieId: '12345',
                        timedtexttracks: [
                            { language: 'en', downloadables: {} }
                        ]
                    }
                }
            };

            platform.handleInjectorEvents(mockEvent);

            expect(mockLogger.debug).toHaveBeenCalledWith(
                'Raw subtitle data received',
                expect.objectContaining({
                    payload: mockEvent.detail.payload
                })
            );
        });

        test('should log error for missing movieId', () => {
            const mockEvent = {
                detail: {
                    type: 'SUBTITLE_DATA_FOUND',
                    payload: {
                        timedtexttracks: []
                    }
                }
            };

            platform.handleInjectorEvents(mockEvent);

            expect(mockLogger.error).toHaveBeenCalledWith(
                'SUBTITLE_DATA_FOUND event missing movieId',
                null,
                expect.objectContaining({
                    payload: mockEvent.detail.payload
                })
            );
        });

        test('should log error for missing timedtexttracks', () => {
            const mockEvent = {
                detail: {
                    type: 'SUBTITLE_DATA_FOUND',
                    payload: {
                        movieId: '12345'
                    }
                }
            };

            platform.handleInjectorEvents(mockEvent);

            expect(mockLogger.error).toHaveBeenCalledWith(
                'SUBTITLE_DATA_FOUND event missing timedtexttracks',
                null,
                expect.objectContaining({
                    payload: mockEvent.detail.payload
                })
            );
        });
    });

    describe('Video Context Change Logging', () => {
        test('should log video context change', () => {
            platform.currentVideoId = '11111';
            
            const mockEvent = {
                detail: {
                    type: 'SUBTITLE_DATA_FOUND',
                    payload: {
                        movieId: '12345',
                        timedtexttracks: [
                            { 
                                language: 'en',
                                ttDownloadables: {
                                    webvtt: {
                                        urls: [{ url: 'http://example.com/subtitle.vtt' }]
                                    }
                                }
                            }
                        ]
                    }
                }
            };

            platform.handleInjectorEvents(mockEvent);

            expect(mockLogger.info).toHaveBeenCalledWith(
                'Video context changing',
                expect.objectContaining({
                    previousVideoId: '11111',
                    newVideoId: '12345'
                })
            );
        });
    });

    describe('URL Extraction Logging', () => {
        test('should log successful movieId extraction', () => {
            const movieId = platform.extractMovieIdFromUrl();

            expect(movieId).toBe('12345');
            expect(mockLogger.debug).toHaveBeenCalledWith(
                'Extracted movieId from URL',
                expect.objectContaining({
                    extractedId: '12345',
                    url: window.location.href
                })
            );
        });

        test('should log warning for invalid URL format', () => {
            window.location.pathname = '/browse';
            
            const movieId = platform.extractMovieIdFromUrl();

            expect(movieId).toBeNull();
            expect(mockLogger.warn).toHaveBeenCalledWith(
                'Could not extract movieId from URL',
                expect.objectContaining({
                    url: expect.any(String),
                    pathname: '/browse'
                })
            );
        });

        test('should log error for URL extraction failure', () => {
            // Mock window.location to throw an error
            Object.defineProperty(window, 'location', {
                get: () => {
                    throw new Error('Location access error');
                }
            });

            const movieId = platform.extractMovieIdFromUrl();

            expect(movieId).toBeNull();
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Error extracting movieId from URL',
                expect.any(Error),
                expect.any(Object)
            );
        });
    });

    describe('Background Communication Logging', () => {
        test('should log VTT processing request', () => {
            chrome.storage.sync.get.mockImplementation((keys, callback) => {
                callback({
                    targetLanguage: 'zh-CN',
                    originalLanguage: 'en',
                    useNativeSubtitles: true
                });
            });

            chrome.runtime.sendMessage.mockImplementation((message, callback) => {
                callback({
                    success: true,
                    videoId: '12345',
                    vttText: 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nTest subtitle'
                });
            });

            const mockEvent = {
                detail: {
                    type: 'SUBTITLE_DATA_FOUND',
                    payload: {
                        movieId: '12345',
                        timedtexttracks: [
                            { 
                                language: 'en',
                                ttDownloadables: {
                                    webvtt: {
                                        urls: [{ url: 'http://example.com/subtitle.vtt' }]
                                    }
                                }
                            }
                        ]
                    }
                }
            };

            platform.handleInjectorEvents(mockEvent);

            expect(mockLogger.info).toHaveBeenCalledWith(
                'Requesting VTT processing from background',
                expect.objectContaining({
                    videoId: '12345',
                    primaryTrackUrl: 'http://example.com/subtitle.vtt'
                })
            );
        });

        test('should log successful VTT processing', () => {
            chrome.storage.sync.get.mockImplementation((keys, callback) => {
                callback({});
            });

            chrome.runtime.sendMessage.mockImplementation((message, callback) => {
                callback({
                    success: true,
                    videoId: '12345',
                    sourceLanguage: 'en',
                    targetLanguage: 'zh-CN'
                });
            });

            platform.currentVideoId = '12345';
            
            const mockEvent = {
                detail: {
                    type: 'SUBTITLE_DATA_FOUND',
                    payload: {
                        movieId: '12345',
                        timedtexttracks: [
                            { 
                                language: 'en',
                                ttDownloadables: {
                                    webvtt: {
                                        urls: [{ url: 'http://example.com/subtitle.vtt' }]
                                    }
                                }
                            }
                        ]
                    }
                }
            };

            platform.handleInjectorEvents(mockEvent);

            expect(mockLogger.info).toHaveBeenCalledWith(
                'VTT processed successfully',
                expect.objectContaining({
                    videoId: '12345',
                    sourceLanguage: 'en',
                    targetLanguage: 'zh-CN'
                })
            );
        });

        test('should log background processing errors', () => {
            chrome.storage.sync.get.mockImplementation((keys, callback) => {
                callback({});
            });

            chrome.runtime.sendMessage.mockImplementation((message, callback) => {
                callback({
                    success: false,
                    error: 'Translation failed'
                });
            });

            platform.currentVideoId = '12345';
            
            const mockEvent = {
                detail: {
                    type: 'SUBTITLE_DATA_FOUND',
                    payload: {
                        movieId: '12345',
                        timedtexttracks: [
                            { 
                                language: 'en',
                                ttDownloadables: {
                                    webvtt: {
                                        urls: [{ url: 'http://example.com/subtitle.vtt' }]
                                    }
                                }
                            }
                        ]
                    }
                }
            };

            platform.handleInjectorEvents(mockEvent);

            expect(mockLogger.error).toHaveBeenCalledWith(
                'Background failed to process VTT',
                null,
                expect.objectContaining({
                    error: 'Translation failed',
                    videoId: '12345'
                })
            );
        });
    });

    describe('Cleanup Logging', () => {
        test('should log successful cleanup', () => {
            platform.eventListener = jest.fn();
            platform.subtitleObserver = { disconnect: jest.fn() };
            
            platform.cleanup();

            expect(mockLogger.debug).toHaveBeenCalledWith('Event listener removed');
            expect(mockLogger.debug).toHaveBeenCalledWith('Subtitle mutation observer cleaned up');
            expect(mockLogger.info).toHaveBeenCalledWith('Platform cleaned up successfully');
        });
    });
});