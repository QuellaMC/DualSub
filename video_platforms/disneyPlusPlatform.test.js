import { describe, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { DisneyPlusPlatform } from './disneyPlusPlatform.js';
import { ChromeApiMock } from '../test-utils/chrome-api-mock.js';
import { createLoggerMock } from '../test-utils/logger-mock.js';
import Logger from '../utils/logger.js';
import { configService } from '../services/configService.js';
import flushPromises from '../test-utils/flush-promises.js';

function createVideo({
    currentTime = 0,
    readyState = 0,
    paused = true,
    ended = false,
    currentSrc = '',
    width = 0,
    height = 0,
} = {}) {
    const video = document.createElement('video');
    const state = { currentTime, readyState, paused, ended, currentSrc };

    Object.defineProperties(video, {
        currentTime: {
            configurable: true,
            get: () => state.currentTime,
        },
        readyState: {
            configurable: true,
            get: () => state.readyState,
        },
        paused: {
            configurable: true,
            get: () => state.paused,
        },
        ended: {
            configurable: true,
            get: () => state.ended,
        },
        currentSrc: {
            configurable: true,
            get: () => state.currentSrc,
        },
    });
    video.getBoundingClientRect = jest.fn(() => ({
        width,
        height,
        top: 0,
        right: width,
        bottom: height,
        left: 0,
    }));

    return { video, state };
}

function createDisneyTimeline(value, max = 1500) {
    const overlay = document.createElement('main-app-controls-overlay');
    const overlayRoot = overlay.attachShadow({ mode: 'open' });
    const progressBar = document.createElement('progress-bar');
    const progressRoot = progressBar.attachShadow({ mode: 'open' });
    const timeline = document.createElement('div');

    timeline.className = 'progress-bar__seekable-range';
    timeline.setAttribute('role', 'slider');
    timeline.setAttribute('aria-label', 'Timeline');
    timeline.setAttribute('aria-valuenow', String(value));
    timeline.setAttribute('aria-valuemax', String(max));
    progressRoot.appendChild(timeline);
    overlayRoot.appendChild(progressBar);
    document.body.appendChild(overlay);

    return { overlay, timeline };
}

describe('DisneyPlusPlatform Logging Integration', () => {
    let platform;
    let mockLogger;
    let chromeApiMock;
    let locationCleanup;

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();
        document.body.replaceChildren();

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
        document.body.replaceChildren();
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
                    urlLength: mockEvent.detail.url.length,
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
                    urlLength: mockEvent.detail.url.length,
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
                    urlLength: mockEvent.detail.url.length,
                    hasVideoId: true,
                })
            );
        });

        test('coalesces duplicate subtitle URL events while a fetch is in flight', async () => {
            const onSubtitleFound = jest.fn();
            const onVideoIdChange = jest.fn();
            await platform.initialize(onSubtitleFound, onVideoIdChange);

            let resolveRequest;
            jest.spyOn(platform, 'requestVttViaMessaging').mockImplementation(
                () =>
                    new Promise((resolve) => {
                        resolveRequest = resolve;
                    })
            );

            const event = {
                detail: {
                    type: 'SUBTITLE_URL_FOUND',
                    videoId: 'next-video-id',
                    url: 'https://example.com/subtitles/master.m3u8',
                },
            };

            platform._handleInjectorEvents(event);
            platform._handleInjectorEvents(event);
            await flushPromises();

            expect(platform.requestVttViaMessaging).toHaveBeenCalledTimes(1);

            resolveRequest({
                success: true,
                videoId: 'next-video-id',
                url: event.detail.url,
                vttText: 'WEBVTT',
            });
            await flushPromises();

            expect(onSubtitleFound).toHaveBeenCalledTimes(1);
        });

        test('keeps pending subtitle requests scoped to the video that emitted them', async () => {
            await platform.initialize(jest.fn(), jest.fn());
            jest.spyOn(platform, 'requestVttViaMessaging').mockImplementation(
                () => new Promise(() => {})
            );

            platform._handleInjectorEvents({
                detail: {
                    type: 'SUBTITLE_URL_FOUND',
                    videoId: 'video-a',
                    url: 'https://example.com/video-a.m3u8',
                },
            });
            platform._handleInjectorEvents({
                detail: {
                    type: 'SUBTITLE_URL_FOUND',
                    videoId: 'video-b',
                    url: 'https://example.com/video-b.m3u8',
                },
            });
            await flushPromises();

            expect(platform.requestVttViaMessaging).toHaveBeenNthCalledWith(
                1,
                'https://example.com/video-a.m3u8',
                'zh-CN',
                'en',
                'video-a'
            );
            expect(platform.requestVttViaMessaging).toHaveBeenNthCalledWith(
                2,
                'https://example.com/video-b.m3u8',
                'zh-CN',
                'en',
                'video-b'
            );
        });

        test('discards an older manifest response after a newer URL supersedes it', async () => {
            const onSubtitleFound = jest.fn();
            await platform.initialize(onSubtitleFound, jest.fn());

            const requestResolvers = new Map();
            jest.spyOn(platform, 'requestVttViaMessaging').mockImplementation(
                (url) =>
                    new Promise((resolve) => {
                        requestResolvers.set(url, resolve);
                    })
            );

            const firstUrl = 'https://example.com/manifest-old.m3u8';
            const latestUrl = 'https://example.com/manifest-latest.m3u8';
            for (const url of [firstUrl, latestUrl]) {
                platform._handleInjectorEvents({
                    detail: {
                        type: 'SUBTITLE_URL_FOUND',
                        videoId: 'same-video',
                        url,
                    },
                });
            }
            await flushPromises();

            requestResolvers.get(latestUrl)({
                success: true,
                videoId: 'same-video',
                url: latestUrl,
                vttText: 'WEBVTT latest',
            });
            await flushPromises();
            requestResolvers.get(firstUrl)({
                success: true,
                videoId: 'same-video',
                url: firstUrl,
                vttText: 'WEBVTT old',
            });
            await flushPromises();

            expect(onSubtitleFound).toHaveBeenCalledTimes(1);
            expect(onSubtitleFound).toHaveBeenCalledWith(
                expect.objectContaining({
                    url: latestUrl,
                    vttText: 'WEBVTT latest',
                })
            );
        });
    });

    describe('Playback clock', () => {
        test('selects the visible, ready video instead of a dormant first video', () => {
            const dormant = createVideo();
            const active = createVideo({
                currentTime: 430,
                readyState: 4,
                paused: false,
                currentSrc: 'blob:https://www.disneyplus.com/active-video',
                width: 1512,
                height: 708,
            });
            active.video.id = 'hivePlayer1';
            document.body.append(dormant.video, active.video);

            expect(platform.getVideoElement()).toBe(active.video);
        });

        test('finds the semantic timeline through nested open shadow roots', () => {
            const { timeline } = createDisneyTimeline(1063);

            expect(platform.getProgressBarElement()).toBe(timeline);
        });

        test('uses active video time continuously after timeline calibration', () => {
            const active = createVideo({
                currentTime: 400,
                readyState: 4,
                paused: false,
                currentSrc: 'blob:https://www.disneyplus.com/active-video',
                width: 1512,
                height: 708,
            });
            document.body.appendChild(active.video);
            const firstTimeline = createDisneyTimeline(1000);

            expect(platform.getPlaybackTime()).toBeCloseTo(1000);

            active.state.currentTime = 401;
            expect(platform.getPlaybackTime()).toBeCloseTo(1001);

            firstTimeline.overlay.remove();
            active.state.currentTime = 410;
            expect(platform.getPlaybackTime()).toBeCloseTo(1010);

            createDisneyTimeline(1020);
            active.state.currentTime = 411;
            expect(platform.getPlaybackTime()).toBeCloseTo(1020);

            active.state.currentTime = 412;
            expect(platform.getPlaybackTime()).toBeCloseTo(1021);
        });

        test('drops stale timeline calibration immediately when the video seeks', () => {
            const active = createVideo({
                currentTime: 400,
                readyState: 4,
                paused: false,
                currentSrc: 'blob:https://www.disneyplus.com/active-video',
                width: 1512,
                height: 708,
            });
            document.body.appendChild(active.video);
            const { timeline } = createDisneyTimeline(1000);

            expect(platform.getPlaybackTime()).toBeCloseTo(1000);

            active.state.currentTime = 900;
            expect(platform.getPlaybackTime()).toBeCloseTo(900);

            timeline.setAttribute('aria-valuenow', '900');
            expect(platform.getPlaybackTime()).toBeCloseTo(900);
        });

        test('does not turn a slider-leading-media seek into a persistent offset', () => {
            const active = createVideo({
                currentTime: 100,
                readyState: 4,
                paused: false,
                currentSrc: 'blob:https://www.disneyplus.com/active-video',
                width: 1512,
                height: 708,
            });
            document.body.appendChild(active.video);
            const { timeline } = createDisneyTimeline(100);

            expect(platform.getPlaybackTime()).toBeCloseTo(100);

            timeline.setAttribute('aria-valuenow', '500');
            expect(platform.getPlaybackTime()).toBeCloseTo(100);

            active.state.currentTime = 500;
            expect(platform.getPlaybackTime()).toBeCloseTo(500);

            timeline.setAttribute('aria-valuenow', '501');
            active.state.currentTime = 501;
            expect(platform.getPlaybackTime()).toBeCloseTo(501);
        });

        test('falls back immediately to active video time before calibration', () => {
            const active = createVideo({
                currentTime: 25,
                readyState: 4,
                paused: false,
                currentSrc: 'blob:https://www.disneyplus.com/active-video',
                width: 1512,
                height: 708,
            });
            document.body.appendChild(active.video);

            expect(platform.getPlaybackTime()).toBe(25);
        });

        test('does not enable the generic progress-bar observer', () => {
            expect(platform.supportsProgressBarTracking()).toBe(false);
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
                    urlLength: mockEvent.detail.url.length,
                    hasVideoId: true,
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
                    errorLength: 'Network error'.length,
                    hasResponseUrl: true,
                    hasVideoId: true,
                })
            );
        });

        test('should log chrome runtime errors', async () => {
            chromeApiMock.runtime.lastError = {
                message: 'Extension context invalidated',
            };
            // Force dynamic import path to fail so the code takes the callback-based fallback path
            chromeApiMock.runtime.getURL = jest.fn(
                () => 'file:///non-existent-module.js'
            );
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
                    urlLength: mockEvent.detail.url.length,
                    hasVideoId: true,
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
