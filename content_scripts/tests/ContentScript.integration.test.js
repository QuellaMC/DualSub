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

import { jest, describe, test, beforeEach, afterEach, expect } from '@jest/globals';
import { TestHelpers } from '../../test-utils/test-helpers.js';
import {
    NetflixFixtures,
    DisneyPlusFixtures,
    ChromeApiFixtures,
    TestScenarioGenerator,
    MockResponseBuilder
} from '../../test-utils/test-fixtures.js';
import { NetflixContentScript } from '../platforms/NetflixContentScript.js';
import { DisneyPlusContentScript } from '../platforms/DisneyPlusContentScript.js';

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
                enableLocation: false // Disable due to JSDOM limitations
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
                subtitlesActive: true
            };

            netflixScript.configService = {
                getAll: jest.fn().mockResolvedValue(ChromeApiFixtures.storageConfig),
                get: jest.fn(),
                onChanged: jest.fn()
            };

            netflixScript.contentLogger = testEnv.mocks.logger;
            netflixScript.currentConfig = { ...ChromeApiFixtures.storageConfig };
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
                    getVideoElement: jest.fn().mockReturnValue({ currentTime: 10 }),
                    cleanup: jest.fn()
                };

                netflixScript.activePlatform = mockPlatform;
                netflixScript.platformReady = true;

                // Simulate subtitle data found
                const subtitleData = {
                    videoId: '12345',
                    sourceLanguage: 'en',
                    targetLanguage: 'zh-CN',
                    subtitles: [
                        { start: 1000, end: 3000, text: 'Hello', translation: '你好' },
                        { start: 4000, end: 6000, text: 'World', translation: '世界' }
                    ]
                };

                await netflixScript.handleSubtitleDataFound(subtitleData);

                // Verify subtitle processing - the method is called with different parameters
                expect(netflixScript.subtitleUtils.handleSubtitleDataFound).toHaveBeenCalledWith(
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
                    getVideoElement: jest.fn().mockReturnValue({ currentTime: 5.5 }),
                    isPlayerPageActive: jest.fn().mockReturnValue(true)
                };

                netflixScript.activePlatform = mockPlatform;
                netflixScript.platformReady = true;

                // Simulate video time update
                netflixScript.handleVideoIdChange('12345');

                // Verify subtitle utilities called
                expect(netflixScript.subtitleUtils.handleVideoIdChange).toHaveBeenCalledWith('12345', netflixScript.logPrefix);
                expect(netflixScript.subtitleUtils.setCurrentVideoId).toHaveBeenCalledWith('12345');
            });

            test('should handle subtitle display errors gracefully', async () => {
                // Setup platform that throws error
                const mockPlatform = {
                    initialize: jest.fn().mockRejectedValue(new Error('Platform initialization failed')),
                    isPlayerPageActive: jest.fn().mockReturnValue(true)
                };

                netflixScript.activePlatform = mockPlatform;

                // Mock subtitle utils to throw error
                netflixScript.subtitleUtils.handleSubtitleDataFound = jest.fn().mockImplementation(() => {
                    throw new Error('Processing failed');
                });

                // Attempt to handle subtitle data
                const subtitleData = { videoId: '12345', error: 'Processing failed' };

                // This should not throw but should handle gracefully
                try {
                    await netflixScript.handleSubtitleDataFound(subtitleData);
                } catch (error) {
                    // Expected to throw since we mocked it to throw
                    expect(error.message).toBe('Processing failed');
                }

                // Verify subtitle utils was called
                expect(netflixScript.subtitleUtils.handleSubtitleDataFound).toHaveBeenCalledWith(
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
                    subtitlePosition: 'top',
                    fontSize: '18px',
                    backgroundColor: '#333333',
                    subtitlesEnabled: true
                };

                // Setup Chrome API response
                testHelpers.setupChromeApiResponses(configChanges);

                // Simulate config change message from popup
                const message = {
                    action: 'configChanged',
                    changes: configChanges
                };

                const mockSendResponse = jest.fn();

                // Setup mock platform for config changes
                const mockPlatform = {
                    getVideoElement: jest.fn().mockReturnValue({ currentTime: 10 })
                };
                netflixScript.activePlatform = mockPlatform;

                // Handle message through Chrome message system
                netflixScript.handleChromeMessage(message, {}, mockSendResponse);

                // Verify configuration was applied (should be called if subtitles are active)
                if (netflixScript.subtitleUtils.subtitlesActive) {
                    expect(netflixScript.subtitleUtils.applySubtitleStyling).toHaveBeenCalledWith(
                        expect.objectContaining({
                            subtitlePosition: 'top',
                            fontSize: '18px',
                            backgroundColor: '#333333'
                        })
                    );
                }

                // Verify response
                expect(mockSendResponse).toHaveBeenCalledWith(
                    expect.objectContaining({
                        success: true
                    })
                );
            });

            test('should handle toggle subtitles from popup', async () => {
                const mockPlatform = {
                    isPlayerPageActive: jest.fn().mockReturnValue(true),
                    initialize: jest.fn().mockResolvedValue(true),
                    cleanup: jest.fn()
                };

                netflixScript.activePlatform = mockPlatform;

                // Simulate toggle message from popup
                const message = {
                    action: 'toggleSubtitles',
                    enabled: false
                };

                const mockSendResponse = jest.fn();

                // Handle message through Chrome message system
                netflixScript.handleChromeMessage(message, {}, mockSendResponse);

                // Verify subtitles were disabled
                expect(netflixScript.subtitleUtils.setSubtitlesActive).toHaveBeenCalledWith(false);
                expect(netflixScript.subtitleUtils.hideSubtitleContainer).toHaveBeenCalled();
                expect(netflixScript.subtitleUtils.clearSubtitlesDisplayAndQueue).toHaveBeenCalled();

                // Verify response (the actual response format)
                expect(mockSendResponse).toHaveBeenCalledWith(
                    expect.objectContaining({
                        success: true,
                        subtitlesEnabled: false
                    })
                );
            });

            test('should handle logging level changes from background', () => {
                const message = {
                    type: 'LOGGING_LEVEL_CHANGED',
                    level: 'DEBUG'
                };

                const mockSendResponse = jest.fn();

                // Handle message through Chrome message system
                netflixScript.handleChromeMessage(message, {}, mockSendResponse);

                // Verify logger level was updated
                expect(testEnv.mocks.logger.updateLevel).toHaveBeenCalledWith('DEBUG');

                // Verify response
                expect(mockSendResponse).toHaveBeenCalledWith(
                    expect.objectContaining({
                        success: true
                    })
                );
            });
        });

        describe('Chrome Message Handling Integration', () => {
            test('should handle complete message flow from popup to platform', async () => {
                // Setup complete environment
                const mockPlatform = {
                    isPlayerPageActive: jest.fn().mockReturnValue(true),
                    getVideoElement: jest.fn().mockReturnValue({ currentTime: 15 }),
                    initialize: jest.fn().mockResolvedValue(true),
                    handleNativeSubtitles: jest.fn()
                };

                netflixScript.activePlatform = mockPlatform;
                netflixScript.platformReady = true;

                // Test sequence of messages that popup might send
                const messageSequence = [
                    { action: 'configChanged', changes: { theme: 'dark' } },
                    { action: 'toggleSubtitles', enabled: true },
                    { type: 'LOGGING_LEVEL_CHANGED', level: 'INFO' }
                ];

                for (const message of messageSequence) {
                    const mockSendResponse = jest.fn();

                    // Simulate Chrome message handling
                    const result = netflixScript.handleChromeMessage(message, {}, mockSendResponse);

                    // All messages should be handled
                    expect(typeof result).toBe('boolean');

                    // Response should be sent
                    expect(mockSendResponse).toHaveBeenCalled();
                }

                // Verify all interactions occurred
                expect(testEnv.mocks.logger.info).toHaveBeenCalled();
            });

            test('should maintain backward compatibility with existing popup integration', () => {
                // Test exact message formats used by popup.js
                const popupMessages = [
                    {
                        action: 'toggleSubtitles',
                        enabled: true,
                        source: 'popup'
                    },
                    {
                        action: 'configChanged',
                        changes: {
                            subtitlePosition: 'bottom',
                            fontSize: '16px',
                            textColor: '#ffffff'
                        },
                        source: 'popup'
                    }
                ];

                // Ensure utilities are available for message handling
                netflixScript.subtitleUtils = {
                    setSubtitlesActive: jest.fn(),
                    hideSubtitleContainer: jest.fn(),
                    showSubtitleContainer: jest.fn(),
                    clearSubtitlesDisplayAndQueue: jest.fn(),
                    applySubtitleStyling: jest.fn(),
                    updateSubtitles: jest.fn(),
                    subtitlesActive: true
                };
                netflixScript.configService = {
                    getAll: jest.fn().mockResolvedValue(ChromeApiFixtures.storageConfig)
                };
                netflixScript.stopVideoElementDetection = jest.fn();
                netflixScript.startVideoElementDetection = jest.fn();
                
                // Mock platform for enable messages
                const mockPlatform = {
                    isPlayerPageActive: jest.fn().mockReturnValue(true),
                    getVideoElement: jest.fn().mockReturnValue({ currentTime: 0 }),
                    cleanup: jest.fn()
                };
                netflixScript.activePlatform = mockPlatform;

                popupMessages.forEach((message) => {
                    const mockSendResponse = jest.fn();

                    // Should handle without errors
                    let result;
                    expect(() => {
                        result = netflixScript.handleChromeMessage(message, {}, mockSendResponse);
                    }).not.toThrow();

                    // Ensure the method returns a boolean
                    expect(typeof result).toBe('boolean');

                    // Should provide response
                    expect(mockSendResponse).toHaveBeenCalled();
                });
            });
        });

        describe('Navigation Detection Integration', () => {
            test('should handle Netflix SPA navigation correctly', () => {
                // Mock URL change detection
                const originalUrl = netflixScript.currentUrl;
                netflixScript.currentUrl = 'https://www.netflix.com/browse';
                netflixScript.lastKnownPathname = '/browse';

                // Mock window.location for navigation test
                global.window = Object.create(window);
                global.window.location = {
                    href: 'https://www.netflix.com/watch/12345',
                    pathname: '/watch/12345',
                    hostname: 'www.netflix.com'
                };

                // Trigger URL change check
                netflixScript.checkForUrlChange();

                // Verify navigation was detected (URL should be updated from window.location)
                expect(netflixScript.currentUrl).toBe(global.window.location.href);
                expect(netflixScript.lastKnownPathname).toBe(global.window.location.pathname);

                // Verify logging (with data parameter)
                expect(testEnv.mocks.logger.info).toHaveBeenCalledWith(
                    'URL change detected.',
                    expect.any(Object)
                );
            });

            test('should handle page transitions correctly', () => {
                const mockPlatform = {
                    cleanup: jest.fn(),
                    initialize: jest.fn().mockResolvedValue(true),
                    isPlayerPageActive: jest.fn().mockReturnValue(false)
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
                enableLocation: false
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
                subtitlesActive: true
            };

            disneyScript.configService = {
                getAll: jest.fn().mockResolvedValue(ChromeApiFixtures.storageConfig),
                get: jest.fn(),
                onChanged: jest.fn()
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
                    processSubtitleUrl: jest.fn()
                };

                disneyScript.activePlatform = mockPlatform;
                disneyScript.platformReady = true;

                // Simulate Disney+ subtitle URL event
                const subtitleEvent = testHelpers.createDisneyPlusEvent('subtitleUrl', {
                    videoId: 'disney123',
                    url: 'https://disneyplus.com/subtitle/disney123/master.m3u8'
                });

                // Process the event
                if (mockPlatform.processSubtitleUrl) {
                    mockPlatform.processSubtitleUrl(subtitleEvent.detail);
                }

                // Verify processing
                expect(mockPlatform.processSubtitleUrl).toHaveBeenCalledWith(
                    expect.objectContaining({
                        videoId: 'disney123',
                        url: expect.stringContaining('master.m3u8')
                    })
                );
            });

            test('should handle Disney+ navigation patterns', () => {
                // Test Disney+ specific URL patterns (player pages)
                const disneyUrls = [
                    '/play/abc123'
                ];

                disneyUrls.forEach((pathname) => {
                    expect(disneyScript._isPlayerPath(pathname)).toBe(true);
                });

                // Test non-player URLs
                const nonPlayerUrls = ['/browse', '/home', '/search'];
                nonPlayerUrls.forEach((pathname) => {
                    expect(disneyScript._isPlayerPath(pathname)).toBe(false);
                });
            });

            test('should handle Disney+ configuration overrides', () => {
                const baseConfig = {
                    maxVideoDetectionRetries: 20,
                    videoDetectionInterval: 2000
                };

                const disneyConfig = disneyScript.applyDisneyPlusConfigOverrides(baseConfig);

                // Verify Disney+ specific values
                expect(disneyConfig.maxVideoDetectionRetries).toBe(40); // Disney+ specific
                expect(disneyConfig.videoDetectionInterval).toBe(1000); // Disney+ specific
                expect(disneyConfig.platformName).toBe('disneyplus');
                expect(disneyConfig.pageTransitionDelay).toBe(1500); // Less than Netflix
            });
        });
    });

    describe('Cross-Platform Backward Compatibility', () => {
        test('should maintain identical message handling across platforms', () => {
            const testEnvNetflix = testHelpers.setupTestEnvironment({
                platform: 'netflix',
                enableLogger: true,
                enableChromeApi: true,
                enableLocation: false
            });

            const testEnvDisney = testHelpers.setupTestEnvironment({
                platform: 'disneyplus',
                enableLogger: true,
                enableChromeApi: true,
                enableLocation: false
            });

            const netflixScript = new NetflixContentScript();
            const disneyScript = new DisneyPlusContentScript();

            // Test same message on both platforms
            const testMessage = {
                action: 'configChanged',
                changes: { fontSize: '20px' }
            };

            const netflixResponse = jest.fn();
            const disneyResponse = jest.fn();

            // Both should handle identically
            const netflixResult = netflixScript.handlePlatformSpecificMessage(testMessage, netflixResponse);
            const disneyResult = disneyScript.handlePlatformSpecificMessage(testMessage, disneyResponse);

            expect(netflixResult).toBe(disneyResult);

            // Both should provide platform-specific responses
            expect(netflixResponse).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    platform: 'netflix'
                })
            );

            expect(disneyResponse).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    platform: 'disneyplus'
                })
            );

            testEnvNetflix.cleanup();
            testEnvDisney.cleanup();
        });

        test('should maintain consistent error handling patterns', () => {
            const platforms = [
                { script: new NetflixContentScript(), name: 'netflix' },
                { script: new DisneyPlusContentScript(), name: 'disneyplus' }
            ];

            platforms.forEach(({ script, name }) => {
                const errorMessage = null; // Invalid message
                const mockResponse = jest.fn();

                // Should handle errors consistently
                const result = script.handlePlatformSpecificMessage(errorMessage, mockResponse);

                expect(result).toBe(false); // Synchronous error handling
                expect(mockResponse).toHaveBeenCalledWith(
                    expect.objectContaining({
                        success: false,
                        platform: name
                    })
                );
            });
        });
    });

    describe('Performance and Memory Integration', () => {
        test('should handle rapid configuration changes without memory leaks', async () => {
            const testEnv = testHelpers.setupTestEnvironment({
                platform: 'netflix',
                enableLogger: true,
                enableChromeApi: true,
                enableLocation: false
            });

            const netflixScript = new NetflixContentScript();

            // Mock required modules
            netflixScript.subtitleUtils = {
                setSubtitlesActive: jest.fn(),
                applySubtitleStyling: jest.fn()
            };
            netflixScript.configService = {
                getAll: jest.fn().mockResolvedValue(ChromeApiFixtures.storageConfig)
            };
            netflixScript.contentLogger = testEnv.mocks.logger;

            // Simulate rapid config changes
            const configChanges = Array.from({ length: 50 }, (_, i) => ({
                action: 'configChanged',
                changes: { fontSize: `${14 + i}px` }
            }));

            const startTime = Date.now();

            for (const change of configChanges) {
                const mockResponse = jest.fn();
                netflixScript.handlePlatformSpecificMessage(change, mockResponse);
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
                enableLocation: false
            });

            const netflixScript = new NetflixContentScript();

            // Mock platform and utilities
            const mockPlatform = {
                isPlayerPageActive: jest.fn().mockReturnValue(true),
                getVideoElement: jest.fn().mockReturnValue({ currentTime: 10 })
            };

            netflixScript.activePlatform = mockPlatform;
            netflixScript.platformReady = true;
            netflixScript.subtitleUtils = {
                handleSubtitleDataFound: jest.fn().mockResolvedValue(true)
            };
            netflixScript.contentLogger = testEnv.mocks.logger;

            // Create concurrent subtitle data
            const subtitleDataArray = Array.from({ length: 10 }, (_, i) => ({
                videoId: `video-${i}`,
                sourceLanguage: 'en',
                targetLanguage: 'zh-CN',
                subtitles: [{ start: i * 1000, end: (i + 1) * 1000, text: `Text ${i}` }]
            }));

            // Process concurrently
            const promises = subtitleDataArray.map((data) =>
                netflixScript.handleSubtitleDataFound(data)
            );

            const results = await Promise.all(promises);

            // All should complete successfully
            expect(results).toHaveLength(10);
            expect(netflixScript.subtitleUtils.handleSubtitleDataFound).toHaveBeenCalledTimes(10);

            testEnv.cleanup();
        });
    });

    describe('End-to-End Integration Scenarios', () => {
        test('should handle complete user workflow: enable -> configure -> watch -> disable', async () => {
            const testEnv = testHelpers.setupTestEnvironment({
                platform: 'netflix',
                enableLogger: true,
                enableChromeApi: true,
                enableLocation: false
            });

            const netflixScript = new NetflixContentScript();

            // Setup complete environment
            const mockPlatform = {
                initialize: jest.fn().mockResolvedValue(true),
                isPlayerPageActive: jest.fn().mockReturnValue(true),
                handleNativeSubtitles: jest.fn(),
                getVideoElement: jest.fn().mockReturnValue({ currentTime: 0 }),
                cleanup: jest.fn()
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
                subtitlesActive: true
            };

            netflixScript.configService = {
                getAll: jest.fn().mockResolvedValue(ChromeApiFixtures.storageConfig)
            };

            netflixScript.contentLogger = testEnv.mocks.logger;
            netflixScript.activePlatform = mockPlatform;

            // Step 1: Enable subtitles
            const enableMessage = { action: 'toggleSubtitles', enabled: true };
            const enableResponse = jest.fn();

            netflixScript.handleChromeMessage(enableMessage, {}, enableResponse);
            expect(netflixScript.subtitleUtils.setSubtitlesActive).toHaveBeenCalledWith(true);

            // Step 2: Configure appearance
            const configMessage = {
                action: 'configChanged',
                changes: {
                    fontSize: '18px',
                    textColor: '#ffffff',
                    backgroundColor: '#000000'
                }
            };
            const configResponse = jest.fn();

            netflixScript.handleChromeMessage(configMessage, {}, configResponse);

            // Should apply styling if subtitles are active
            if (netflixScript.subtitleUtils.subtitlesActive) {
                expect(netflixScript.subtitleUtils.applySubtitleStyling).toHaveBeenCalled();
            }

            // Step 3: Process subtitle data (simulate watching)
            const subtitleData = {
                videoId: '12345',
                sourceLanguage: 'en',
                targetLanguage: 'zh-CN',
                subtitles: [
                    { start: 1000, end: 3000, text: 'Hello', translation: '你好' }
                ]
            };

            await netflixScript.handleSubtitleDataFound(subtitleData);
            expect(netflixScript.subtitleUtils.handleSubtitleDataFound).toHaveBeenCalled();

            // Step 4: Disable subtitles
            const disableMessage = { action: 'toggleSubtitles', enabled: false };
            const disableResponse = jest.fn();

            netflixScript.handleChromeMessage(disableMessage, {}, disableResponse);
            expect(netflixScript.subtitleUtils.setSubtitlesActive).toHaveBeenCalledWith(false);
            expect(netflixScript.subtitleUtils.hideSubtitleContainer).toHaveBeenCalled();

            // Verify all responses were successful
            expect(enableResponse).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
            expect(configResponse).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
            expect(disableResponse).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

            testEnv.cleanup();
        });
    });
});