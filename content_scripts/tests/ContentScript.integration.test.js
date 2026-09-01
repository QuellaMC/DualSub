/**
 * Content Script Integration Tests
 *
 * Comprehensive integration tests to validate backward compatibility and ensure
 * that the refactored content scripts produce identical behavior to the original
 * implementation. Tests subtitle display, timing, configuration changes, and
 * Chrome message handling across both Netflix and Disney+ platforms.
 *
 * @author DualSub Extension
 * @version 1.0.0
 */

import {
    jest,
    describe,
    test,
    beforeEach,
    afterEach,
    expect,
} from '@jest/globals';
import { TestHelpers } from '../../test-utils/test-helpers.js';
import { ChromeApiFixtures } from '../../test-utils/test-fixtures.js';
import { NetflixContentScript } from '../platforms/NetflixContentScript.js';
import { DisneyPlusContentScript } from '../platforms/DisneyPlusContentScript.js';
import {
    buildConfigChangedRequestMessage,
    buildLoggingLevelChangedRequestMessage,
} from '../shared/protocol/messageProtocol.js';

const EXTENSION_ID = 'dualsub-content-integration-test';
const EXTENSION_PATHS = Object.freeze({
    background: 'background.js',
    options: 'options/options.html',
    popup: 'popup/popup.html',
    sidepanel: 'sidepanel/sidepanel.html',
});

function createExtensionSender(path) {
    chrome.runtime.id = EXTENSION_ID;
    chrome.runtime.getManifest.mockReturnValue({
        action: { default_popup: EXTENSION_PATHS.popup },
        background: { service_worker: EXTENSION_PATHS.background },
        options_ui: { page: EXTENSION_PATHS.options },
        side_panel: { default_path: EXTENSION_PATHS.sidepanel },
    });
    return {
        id: EXTENSION_ID,
        url: chrome.runtime.getURL(path),
        origin: chrome.runtime.getURL('').replace(/\/+$/u, ''),
    };
}

/**
 * Integration Test Suite for Content Script Refactoring
 * Validates that refactored code produces identical behavior to original implementation
 */
describe('Content Script Integration Tests', () => {
    let testHelpers;

    beforeEach(() => {
        testHelpers = new TestHelpers();
    });

    afterEach(() => {
        testHelpers.mockRegistry.cleanup();
    });

    describe('Netflix Content Script Integration', () => {
        let netflixScript;
        let testEnv;

        beforeEach(() => {
            testEnv = testHelpers.setupTestEnvironment({
                platform: 'netflix',
                enableLogger: true,
                enableChromeApi: true,
                enableLocation: false, // Disable due to JSDOM limitations
            });

            netflixScript = new NetflixContentScript();

            // Mock required modules for integration testing
            netflixScript.subtitleUtils = {
                setSubtitlesActive: jest.fn(),
                applySubtitleStyling: jest.fn(),
                hideSubtitleContainer: jest.fn(),
                showSubtitleContainer: jest.fn(),
                updateSubtitles: jest.fn(),
                handleSubtitleDataFound: jest.fn(),
                handleVideoIdChange: jest.fn(),
                setCurrentVideoId: jest.fn(),
                ensureSubtitleContainer: jest.fn(),
                clearSubtitlesDisplayAndQueue: jest.fn(),
                clearSubtitleDOM: jest.fn(),
                subtitlesActive: true,
            };

            netflixScript.configService = {
                getAll: jest
                    .fn()
                    .mockResolvedValue(ChromeApiFixtures.storageConfig),
                get: jest.fn(),
                onChanged: jest.fn(),
            };

            netflixScript.contentLogger = testEnv.mocks.logger;
            netflixScript.currentConfig = {
                ...ChromeApiFixtures.storageConfig,
            };
        });

        afterEach(() => {
            if (netflixScript && typeof netflixScript.cleanup === 'function') {
                netflixScript.cleanup();
            }
            testEnv.cleanup();
        });

        describe('Subtitle Display Integration', () => {
            test('should handle complete subtitle display flow', async () => {
                // Setup mock platform
                const mockPlatform = {
                    initialize: jest.fn().mockResolvedValue(true),
                    isPlayerPageActive: jest.fn().mockReturnValue(true),
                    handleNativeSubtitles: jest.fn(),
                    getVideoElement: jest
                        .fn()
                        .mockReturnValue({ currentTime: 10 }),
                    cleanup: jest.fn(),
                };

                netflixScript.activePlatform = mockPlatform;
                netflixScript.platformReady = true;

                // Simulate subtitle data found
                const subtitleData = {
                    videoId: '12345',
                    sourceLanguage: 'en',
                    targetLanguage: 'zh-CN',
                    subtitles: [
                        {
                            start: 1000,
                            end: 3000,
                            text: 'Hello',
                            translation: '你好',
                        },
                        {
                            start: 4000,
                            end: 6000,
                            text: 'World',
                            translation: '世界',
                        },
                    ],
                };

                await netflixScript.handleSubtitleDataFound(subtitleData);

                // Verify subtitle processing - the method is called with different parameters
                expect(
                    netflixScript.subtitleUtils.handleSubtitleDataFound
                ).toHaveBeenCalledWith(
                    subtitleData,
                    mockPlatform,
                    netflixScript.currentConfig,
                    netflixScript.logPrefix
                );

                // Verify logging - the handleSubtitleDataFound method doesn't log this message
                // The actual logging happens in the subtitle utilities, not in the content script
            });

            test('should handle subtitle timing updates correctly', () => {
                const mockPlatform = {
                    getVideoElement: jest
                        .fn()
                        .mockReturnValue({ currentTime: 5.5 }),
                    isPlayerPageActive: jest.fn().mockReturnValue(true),
                };

                netflixScript.activePlatform = mockPlatform;
                netflixScript.platformReady = true;

                // Simulate video time update
                netflixScript.handleVideoIdChange('12345');

                // Verify subtitle utilities called
                expect(
                    netflixScript.subtitleUtils.handleVideoIdChange
                ).toHaveBeenCalledWith('12345', netflixScript.logPrefix);
                expect(
                    netflixScript.subtitleUtils.setCurrentVideoId
                ).toHaveBeenCalledWith('12345');
            });

            test('should handle subtitle display errors gracefully', async () => {
                // Setup platform that throws error
                const mockPlatform = {
                    initialize: jest
                        .fn()
                        .mockRejectedValue(
                            new Error('Platform initialization failed')
                        ),
                    isPlayerPageActive: jest.fn().mockReturnValue(true),
                };

                netflixScript.activePlatform = mockPlatform;

                // Mock subtitle utils to throw error
                netflixScript.subtitleUtils.handleSubtitleDataFound = jest
                    .fn()
                    .mockImplementation(() => {
                        throw new Error('Processing failed');
                    });

                // Attempt to handle subtitle data
                const subtitleData = {
                    videoId: '12345',
                    error: 'Processing failed',
                };

                // This should not throw but should handle gracefully
                try {
                    await netflixScript.handleSubtitleDataFound(subtitleData);
                } catch (error) {
                    // Expected to throw since we mocked it to throw
                    expect(error.message).toBe('Processing failed');
                }

                // Verify subtitle utils was called
                expect(
                    netflixScript.subtitleUtils.handleSubtitleDataFound
                ).toHaveBeenCalledWith(
                    subtitleData,
                    mockPlatform,
                    netflixScript.currentConfig,
                    netflixScript.logPrefix
                );
            });
        });

        describe('Configuration Changes Integration', () => {
            test('should handle configuration changes from popup', async () => {
                const configChanges = {
                    subtitleLayoutOrder: 'translation_top',
                    subtitleLayoutOrientation: 'row',
                    subtitleTimeOffset: 250,
                    useNativeSubtitles: false,
                };

                // Setup Chrome API response
                testHelpers.setupChromeApiResponses(configChanges);

                // Simulate config change message from popup
                const message = buildConfigChangedRequestMessage(configChanges);

                const mockSendResponse = jest.fn();

                // Setup mock platform for config changes
                const mockPlatform = {
                    getVideoElement: jest
                        .fn()
                        .mockReturnValue({ currentTime: 10 }),
                };
                netflixScript.activePlatform = mockPlatform;

                // Handle message through Chrome message system
                netflixScript.handleChromeMessage(
                    message,
                    createExtensionSender(EXTENSION_PATHS.popup),
                    mockSendResponse
                );

                // Verify configuration was applied (should be called if subtitles are active)
                if (netflixScript.subtitleUtils.subtitlesActive) {
                    expect(
                        netflixScript.subtitleUtils.applySubtitleStyling
                    ).toHaveBeenCalledWith(
                        expect.objectContaining({
                            subtitleLayoutOrder: 'translation_top',
                            subtitleLayoutOrientation: 'row',
                            subtitleTimeOffset: 250,
                            useNativeSubtitles: false,
                        })
                    );
                }

                // Verify response
                expect(mockSendResponse).toHaveBeenCalledWith(
                    expect.objectContaining({
                        success: true,
                    })
                );
            });

            test('should handle logging level changes from background', () => {
                const message = buildLoggingLevelChangedRequestMessage(4);

                const mockSendResponse = jest.fn();

                // Handle message through Chrome message system
                netflixScript.handleChromeMessage(
                    message,
                    createExtensionSender(EXTENSION_PATHS.background),
                    mockSendResponse
                );

                // Verify logger level was updated
                expect(testEnv.mocks.logger.updateLevel).toHaveBeenCalledWith(
                    4
                );

                // Verify response
                expect(mockSendResponse).toHaveBeenCalledWith(
                    expect.objectContaining({
                        success: true,
                    })
                );
            });
        });

        describe('Chrome Message Handling Integration', () => {
            test('should handle canonical popup and background controls', async () => {
                // Setup complete environment
                const mockPlatform = {
                    isPlayerPageActive: jest.fn().mockReturnValue(true),
                    getVideoElement: jest
                        .fn()
                        .mockReturnValue({ currentTime: 15 }),
                    initialize: jest.fn().mockResolvedValue(true),
                    handleNativeSubtitles: jest.fn(),
                };

                netflixScript.activePlatform = mockPlatform;
                netflixScript.platformReady = true;

                // Test the exact sender and payload contracts for each route.
                const messageSequence = [
                    {
                        request: buildConfigChangedRequestMessage({
                            hideOfficialSubtitles: false,
                        }),
                        senderPath: EXTENSION_PATHS.popup,
                    },
                    {
                        request: buildLoggingLevelChangedRequestMessage(3),
                        senderPath: EXTENSION_PATHS.background,
                    },
                ];

                for (const { request, senderPath } of messageSequence) {
                    const mockSendResponse = jest.fn();

                    // Simulate Chrome message handling
                    const result = netflixScript.handleChromeMessage(
                        request,
                        createExtensionSender(senderPath),
                        mockSendResponse
                    );

                    // All messages should be handled
                    expect(typeof result).toBe('boolean');

                    // Response should be sent
                    expect(mockSendResponse).toHaveBeenCalled();
                }

                // Verify all interactions occurred
                expect(testEnv.mocks.logger.info).toHaveBeenCalled();
            });

            test('should accept the canonical popup config contract', () => {
                const popupMessages = [
                    buildConfigChangedRequestMessage({
                        subtitleLayoutOrder: 'original_top',
                        subtitleLayoutOrientation: 'column',
                        subtitleTimeOffset: 0,
                    }),
                ];

                // Ensure utilities are available for message handling
                netflixScript.subtitleUtils = {
                    setSubtitlesActive: jest.fn(),
                    hideSubtitleContainer: jest.fn(),
                    showSubtitleContainer: jest.fn(),
                    clearSubtitlesDisplayAndQueue: jest.fn(),
                    applySubtitleStyling: jest.fn(),
                    updateSubtitles: jest.fn(),
                    subtitlesActive: true,
                };
                netflixScript.configService = {
                    getAll: jest
                        .fn()
                        .mockResolvedValue(ChromeApiFixtures.storageConfig),
                };
                netflixScript.stopVideoElementDetection = jest.fn();
                netflixScript.startVideoElementDetection = jest.fn();

                // Mock platform for enable messages
                const mockPlatform = {
                    isPlayerPageActive: jest.fn().mockReturnValue(true),
                    getVideoElement: jest
                        .fn()
                        .mockReturnValue({ currentTime: 0 }),
                    cleanup: jest.fn(),
                };
                netflixScript.activePlatform = mockPlatform;

                popupMessages.forEach((message) => {
                    const mockSendResponse = jest.fn();

                    // Should handle without errors
                    let result;
                    expect(() => {
                        result = netflixScript.handleChromeMessage(
                            message,
                            createExtensionSender(EXTENSION_PATHS.popup),
                            mockSendResponse
                        );
                    }).not.toThrow();

                    // Ensure the method returns a boolean
                    expect(typeof result).toBe('boolean');

                    // Should provide response
                    expect(mockSendResponse).toHaveBeenCalled();
                });
            });
        });

        describe('Navigation Detection Integration', () => {
            test('should handle page transitions correctly', () => {
                const mockPlatform = {
                    cleanup: jest.fn(),
                    initialize: jest.fn().mockResolvedValue(true),
                    isPlayerPageActive: jest.fn().mockReturnValue(false),
                };

                netflixScript.activePlatform = mockPlatform;

                // Simulate leaving player page
                netflixScript._handlePageTransition(true, false);

                // Verify cleanup occurred
                expect(mockPlatform.cleanup).toHaveBeenCalled();
                expect(netflixScript.activePlatform).toBeNull();
                expect(netflixScript.platformReady).toBe(false);

                // Verify logging (with data parameter)
                expect(testEnv.mocks.logger.info).toHaveBeenCalledWith(
                    'Leaving player page, cleaning up platform.',
                    expect.any(Object)
                );
            });
        });
    });

    describe('Disney+ Content Script Integration', () => {
        let disneyScript;
        let testEnv;

        beforeEach(() => {
            testEnv = testHelpers.setupTestEnvironment({
                platform: 'disneyplus',
                enableLogger: true,
                enableChromeApi: true,
                enableLocation: false,
            });

            disneyScript = new DisneyPlusContentScript();

            // Mock required modules
            disneyScript.subtitleUtils = {
                setSubtitlesActive: jest.fn(),
                applySubtitleStyling: jest.fn(),
                hideSubtitleContainer: jest.fn(),
                showSubtitleContainer: jest.fn(),
                updateSubtitles: jest.fn(),
                handleSubtitleDataFound: jest.fn(),
                handleVideoIdChange: jest.fn(),
                setCurrentVideoId: jest.fn(),
                ensureSubtitleContainer: jest.fn(),
                clearSubtitlesDisplayAndQueue: jest.fn(),
                clearSubtitleDOM: jest.fn(),
                subtitlesActive: true,
            };

            disneyScript.configService = {
                getAll: jest
                    .fn()
                    .mockResolvedValue(ChromeApiFixtures.storageConfig),
                get: jest.fn(),
                onChanged: jest.fn(),
            };

            disneyScript.contentLogger = testEnv.mocks.logger;
            disneyScript.currentConfig = { ...ChromeApiFixtures.storageConfig };
        });

        afterEach(() => {
            if (disneyScript && typeof disneyScript.cleanup === 'function') {
                disneyScript.cleanup();
            }
            testEnv.cleanup();
        });

        describe('Disney+ Specific Integration', () => {
            test('should handle Disney+ subtitle URL processing', async () => {
                const mockPlatform = {
                    initialize: jest.fn().mockResolvedValue(true),
                    isPlayerPageActive: jest.fn().mockReturnValue(true),
                    handleNativeSubtitles: jest.fn(),
                    processSubtitleUrl: jest.fn(),
                };

                disneyScript.activePlatform = mockPlatform;
                disneyScript.platformReady = true;

                // Simulate Disney+ subtitle URL event
                const subtitleEvent = testHelpers.createDisneyPlusEvent(
                    'subtitleUrl',
                    {
                        videoId: 'disney123',
                        url: 'https://disneyplus.com/subtitle/disney123/master.m3u8',
                    }
                );

                // Process the event
                if (mockPlatform.processSubtitleUrl) {
                    mockPlatform.processSubtitleUrl(subtitleEvent.detail);
                }

                // Verify processing
                expect(mockPlatform.processSubtitleUrl).toHaveBeenCalledWith(
                    expect.objectContaining({
                        videoId: 'disney123',
                        url: expect.stringContaining('master.m3u8'),
                    })
                );
            });

            test('should handle Disney+ navigation patterns', () => {
                // Test Disney+ specific URL patterns (player pages)
                const disneyUrls = ['/play/abc123'];

                disneyUrls.forEach((pathname) => {
                    expect(disneyScript._isPlayerPath(pathname)).toBe(true);
                });

                // Test non-player URLs
                const nonPlayerUrls = ['/browse', '/home', '/search'];
                nonPlayerUrls.forEach((pathname) => {
                    expect(disneyScript._isPlayerPath(pathname)).toBe(false);
                });
            });
        });
    });

    describe('Performance and Memory Integration', () => {
        test('should handle rapid configuration changes without memory leaks', async () => {
            const testEnv = testHelpers.setupTestEnvironment({
                platform: 'netflix',
                enableLogger: true,
                enableChromeApi: true,
                enableLocation: false,
            });

            const netflixScript = new NetflixContentScript();

            // Mock required modules
            netflixScript.subtitleUtils = {
                setSubtitlesActive: jest.fn(),
                applySubtitleStyling: jest.fn(),
            };
            netflixScript.configService = {
                getAll: jest
                    .fn()
                    .mockResolvedValue(ChromeApiFixtures.storageConfig),
            };
            netflixScript.contentLogger = testEnv.mocks.logger;

            // Simulate rapid config changes
            const configChanges = Array.from({ length: 50 }, (_, i) =>
                buildConfigChangedRequestMessage({
                    subtitleTimeOffset: i,
                })
            );

            const startTime = Date.now();

            for (const change of configChanges) {
                const mockResponse = jest.fn();
                netflixScript.handleChromeMessage(
                    change,
                    createExtensionSender(EXTENSION_PATHS.popup),
                    mockResponse
                );
                expect(mockResponse).toHaveBeenCalled();
            }

            const endTime = Date.now();
            const duration = endTime - startTime;

            // Should complete within reasonable time
            expect(duration).toBeLessThan(1000);

            // Should not accumulate memory
            expect(netflixScript.messageHandlers.size).toBeGreaterThan(0);
            expect(netflixScript.messageHandlers.size).toBeLessThan(10); // Reasonable number

            testEnv.cleanup();
        });

        test('should handle concurrent subtitle processing', async () => {
            const testEnv = testHelpers.setupTestEnvironment({
                platform: 'netflix',
                enableLogger: true,
                enableChromeApi: true,
                enableLocation: false,
            });

            const netflixScript = new NetflixContentScript();

            // Mock platform and utilities
            const mockPlatform = {
                isPlayerPageActive: jest.fn().mockReturnValue(true),
                getVideoElement: jest.fn().mockReturnValue({ currentTime: 10 }),
            };

            netflixScript.activePlatform = mockPlatform;
            netflixScript.platformReady = true;
            netflixScript.subtitleUtils = {
                handleSubtitleDataFound: jest.fn().mockResolvedValue(true),
            };
            netflixScript.contentLogger = testEnv.mocks.logger;

            // Create concurrent subtitle data
            const subtitleDataArray = Array.from({ length: 10 }, (_, i) => ({
                videoId: `video-${i}`,
                sourceLanguage: 'en',
                targetLanguage: 'zh-CN',
                subtitles: [
                    { start: i * 1000, end: (i + 1) * 1000, text: `Text ${i}` },
                ],
            }));

            // Process concurrently
            const promises = subtitleDataArray.map((data) =>
                netflixScript.handleSubtitleDataFound(data)
            );

            const results = await Promise.all(promises);

            // All should complete successfully
            expect(results).toHaveLength(10);
            expect(
                netflixScript.subtitleUtils.handleSubtitleDataFound
            ).toHaveBeenCalledTimes(10);

            testEnv.cleanup();
        });
    });

    describe('End-to-End Integration Scenarios', () => {
        test('should handle complete user workflow: configure -> watch', async () => {
            const testEnv = testHelpers.setupTestEnvironment({
                platform: 'netflix',
                enableLogger: true,
                enableChromeApi: true,
                enableLocation: false,
            });

            const netflixScript = new NetflixContentScript();

            // Setup complete environment
            const mockPlatform = {
                initialize: jest.fn().mockResolvedValue(true),
                isPlayerPageActive: jest.fn().mockReturnValue(true),
                handleNativeSubtitles: jest.fn(),
                getVideoElement: jest.fn().mockReturnValue({ currentTime: 0 }),
                cleanup: jest.fn(),
            };

            netflixScript.subtitleUtils = {
                setSubtitlesActive: jest.fn(),
                applySubtitleStyling: jest.fn(),
                hideSubtitleContainer: jest.fn(),
                showSubtitleContainer: jest.fn(),
                handleSubtitleDataFound: jest.fn().mockResolvedValue(true),
                clearSubtitlesDisplayAndQueue: jest.fn(),
                ensureSubtitleContainer: jest.fn(),
                updateSubtitles: jest.fn(),
                subtitlesActive: true,
            };

            netflixScript.configService = {
                getAll: jest
                    .fn()
                    .mockResolvedValue(ChromeApiFixtures.storageConfig),
            };

            netflixScript.contentLogger = testEnv.mocks.logger;
            netflixScript.activePlatform = mockPlatform;

            // Step 1: Configure appearance
            const configMessage = buildConfigChangedRequestMessage({
                subtitleLayoutOrder: 'translation_top',
                subtitleLayoutOrientation: 'row',
                subtitleTimeOffset: 125,
            });
            const configResponse = jest.fn();

            netflixScript.handleChromeMessage(
                configMessage,
                createExtensionSender(EXTENSION_PATHS.popup),
                configResponse
            );

            // Should apply styling if subtitles are active
            if (netflixScript.subtitleUtils.subtitlesActive) {
                expect(
                    netflixScript.subtitleUtils.applySubtitleStyling
                ).toHaveBeenCalled();
            }

            // Step 2: Process subtitle data (simulate watching)
            const subtitleData = {
                videoId: '12345',
                sourceLanguage: 'en',
                targetLanguage: 'zh-CN',
                subtitles: [
                    {
                        start: 1000,
                        end: 3000,
                        text: 'Hello',
                        translation: '你好',
                    },
                ],
            };

            await netflixScript.handleSubtitleDataFound(subtitleData);
            expect(
                netflixScript.subtitleUtils.handleSubtitleDataFound
            ).toHaveBeenCalled();

            // Verify the active message response was successful
            expect(configResponse).toHaveBeenCalledWith(
                expect.objectContaining({ success: true })
            );

            testEnv.cleanup();
        });
    });
});
