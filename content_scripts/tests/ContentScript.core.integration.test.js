/**
 * Core Content Script Integration Tests
 * 
 * Focused integration tests that validate the essential functionality
 * of the refactored content scripts and ensure backward compatibility
 * for the most critical features.
 * 
 * @author DualSub Extension
 * @version 1.0.0
 */

import { jest, describe, test, beforeEach, afterEach, expect } from '@jest/globals';
import { TestHelpers } from '../../test-utils/test-helpers.js';
import { ChromeApiFixtures } from '../../test-utils/test-fixtures.js';
import { NetflixContentScript } from '../platforms/NetflixContentScript.js';
import { DisneyPlusContentScript } from '../platforms/DisneyPlusContentScript.js';

/**
 * Core Integration Test Suite
 * Tests the most critical functionality to ensure refactoring maintains compatibility
 */
describe('Core Content Script Integration Tests', () => {
    let testHelpers;

    beforeEach(() => {
        testHelpers = new TestHelpers();
    });

    afterEach(() => {
        testHelpers.mockRegistry.cleanup();
    });

    describe('Netflix Content Script Core Integration', () => {
        let netflixScript;
        let testEnv;

        beforeEach(() => {
            testEnv = testHelpers.setupTestEnvironment({
                platform: 'netflix',
                enableLogger: true,
                enableChromeApi: true,
                enableLocation: false
            });

            netflixScript = new NetflixContentScript();
            netflixScript.contentLogger = testEnv.mocks.logger;
            netflixScript.currentConfig = { ...ChromeApiFixtures.storageConfig };
            
            // Mock essential subtitle utilities
            netflixScript.subtitleUtils = {
                setSubtitlesActive: jest.fn(),
                hideSubtitleContainer: jest.fn(),
                showSubtitleContainer: jest.fn(),
                clearSubtitlesDisplayAndQueue: jest.fn(),
                subtitlesActive: true
            };
            
            netflixScript.configService = {
                getAll: jest.fn().mockResolvedValue(ChromeApiFixtures.storageConfig)
            };
        });

        afterEach(() => {
            if (netflixScript && typeof netflixScript.cleanup === 'function') {
                netflixScript.cleanup();
            }
            testEnv.cleanup();
        });

        test('should handle toggle subtitles message correctly', () => {
            const message = { action: 'toggleSubtitles', enabled: false };
            const mockSendResponse = jest.fn();

            const result = netflixScript.handleChromeMessage(message, {}, mockSendResponse);

            // Should handle synchronously
            expect(typeof result).toBe('boolean');
            
            // Should call subtitle utilities
            expect(netflixScript.subtitleUtils.setSubtitlesActive).toHaveBeenCalledWith(false);
            expect(netflixScript.subtitleUtils.hideSubtitleContainer).toHaveBeenCalled();
            
            // Should provide response
            expect(mockSendResponse).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    subtitlesEnabled: false
                })
            );
        });

        test('should handle logging level change message correctly', () => {
            const message = { type: 'LOGGING_LEVEL_CHANGED', level: 'DEBUG' };
            const mockSendResponse = jest.fn();

            const result = netflixScript.handleChromeMessage(message, {}, mockSendResponse);

            // Should handle synchronously
            expect(typeof result).toBe('boolean');
            
            // Should update logger level
            expect(testEnv.mocks.logger.updateLevel).toHaveBeenCalledWith('DEBUG');
            
            // Should provide response
            expect(mockSendResponse).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true
                })
            );
        });

        test('should handle platform-specific messages gracefully', () => {
            const message = { action: 'netflix-custom-action', data: 'test' };
            const mockSendResponse = jest.fn();

            const result = netflixScript.handlePlatformSpecificMessage(message, mockSendResponse);

            // Should handle synchronously
            expect(result).toBe(false);
            
            // Should provide platform-specific response
            expect(mockSendResponse).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    handled: false,
                    platform: 'netflix'
                })
            );
        });

        test('should handle subtitle data processing', async () => {
            const mockPlatform = {
                isPlayerPageActive: jest.fn().mockReturnValue(true),
                getVideoElement: jest.fn().mockReturnValue({ currentTime: 10 })
            };
            
            netflixScript.activePlatform = mockPlatform;
            netflixScript.subtitleUtils.handleSubtitleDataFound = jest.fn();

            const subtitleData = {
                videoId: '12345',
                sourceLanguage: 'en',
                targetLanguage: 'zh-CN'
            };

            // Should not throw
            await netflixScript.handleSubtitleDataFound(subtitleData);

            // Should call subtitle utilities if available
            if (netflixScript.subtitleUtils.handleSubtitleDataFound) {
                expect(netflixScript.subtitleUtils.handleSubtitleDataFound).toHaveBeenCalledWith(
                    subtitleData,
                    mockPlatform,
                    netflixScript.currentConfig,
                    netflixScript.logPrefix
                );
            }
        });

        test('should handle video ID changes', () => {
            netflixScript.subtitleUtils.handleVideoIdChange = jest.fn();
            netflixScript.subtitleUtils.setCurrentVideoId = jest.fn();

            netflixScript.handleVideoIdChange('new-video-id');

            // Should call subtitle utilities
            expect(netflixScript.subtitleUtils.handleVideoIdChange).toHaveBeenCalledWith(
                'new-video-id',
                netflixScript.logPrefix
            );
            expect(netflixScript.subtitleUtils.setCurrentVideoId).toHaveBeenCalledWith('new-video-id');
        });

        test('should provide correct platform identification', () => {
            expect(netflixScript.getPlatformName()).toBe('netflix');
            expect(netflixScript.getPlatformClass()).toBe('NetflixPlatform');
            
            const injectConfig = netflixScript.getInjectScriptConfig();
            expect(injectConfig.filename).toBe('injected_scripts/netflixInject.js');
            expect(injectConfig.tagId).toBe('netflix-dualsub-injector-script-tag');
            expect(injectConfig.eventId).toBe('netflix-dualsub-injector-event');
        });

        test('should handle navigation detection setup', () => {
            // Mock the intervalManager since it's not fully initialized in test
            netflixScript.intervalManager = {
                set: jest.fn(),
                clearAll: jest.fn()
            };

            // Should not throw when setting up navigation
            expect(() => {
                netflixScript.setupNavigationDetection();
            }).not.toThrow();

            // Should log setup completion
            expect(testEnv.mocks.logger.info).toHaveBeenCalledWith(
                'Enhanced Netflix navigation detection set up',
                expect.any(Object)
            );
        });
    });

    describe('Disney+ Content Script Core Integration', () => {
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
            disneyScript.contentLogger = testEnv.mocks.logger;
            disneyScript.currentConfig = { ...ChromeApiFixtures.storageConfig };
            
            // Mock essential subtitle utilities
            disneyScript.subtitleUtils = {
                setSubtitlesActive: jest.fn(),
                hideSubtitleContainer: jest.fn(),
                showSubtitleContainer: jest.fn(),
                clearSubtitlesDisplayAndQueue: jest.fn(),
                subtitlesActive: true
            };
            
            disneyScript.configService = {
                getAll: jest.fn().mockResolvedValue(ChromeApiFixtures.storageConfig)
            };
        });

        afterEach(() => {
            if (disneyScript && typeof disneyScript.cleanup === 'function') {
                disneyScript.cleanup();
            }
            testEnv.cleanup();
        });

        test('should handle toggle subtitles message correctly', () => {
            const message = { action: 'toggleSubtitles', enabled: true };
            const mockSendResponse = jest.fn();

            // Mock platform for enable case
            const mockPlatform = {
                isPlayerPageActive: jest.fn().mockReturnValue(true),
                getVideoElement: jest.fn().mockReturnValue({ currentTime: 0 }),
                cleanup: jest.fn()
            };
            disneyScript.activePlatform = mockPlatform;
            
            // Mock video detection methods
            disneyScript.startVideoElementDetection = jest.fn();

            const result = disneyScript.handleChromeMessage(message, {}, mockSendResponse);

            // Should handle synchronously for existing platform
            expect(typeof result).toBe('boolean');
            
            // Should call subtitle utilities
            expect(disneyScript.subtitleUtils.setSubtitlesActive).toHaveBeenCalledWith(true);
            
            // Should provide response
            expect(mockSendResponse).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    subtitlesEnabled: true
                })
            );
        });

        test('should handle platform-specific messages gracefully', () => {
            const message = { action: 'disneyplus-custom-action', data: 'test' };
            const mockSendResponse = jest.fn();

            const result = disneyScript.handlePlatformSpecificMessage(message, mockSendResponse);

            // Should handle synchronously
            expect(result).toBe(false);
            
            // Should provide platform-specific response
            expect(mockSendResponse).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    handled: false,
                    platform: 'disneyplus'
                })
            );
        });

        test('should provide correct platform identification', () => {
            expect(disneyScript.getPlatformName()).toBe('disneyplus');
            expect(disneyScript.getPlatformClass()).toBe('DisneyPlusPlatform');
            
            const injectConfig = disneyScript.getInjectScriptConfig();
            expect(injectConfig.filename).toBe('injected_scripts/disneyPlusInject.js');
            expect(injectConfig.tagId).toBe('disneyplus-dualsub-injector-script-tag');
            expect(injectConfig.eventId).toBe('disneyplus-dualsub-injector-event');
        });

        test('should handle Disney+ specific URL patterns', () => {
            const playerUrls = ['/play/abc123'];
            const nonPlayerUrls = ['/browse', '/home', '/search'];

            playerUrls.forEach((pathname) => {
                expect(disneyScript._isPlayerPath(pathname)).toBe(true);
            });

            nonPlayerUrls.forEach((pathname) => {
                expect(disneyScript._isPlayerPath(pathname)).toBe(false);
            });
        });

        test('should handle navigation detection setup', () => {
            // Mock the intervalManager since it's not fully initialized in test
            disneyScript.intervalManager = {
                set: jest.fn(),
                clearAll: jest.fn()
            };

            // Should not throw when setting up navigation
            expect(() => {
                disneyScript.setupNavigationDetection();
            }).not.toThrow();

            // Should log setup completion
            expect(testEnv.mocks.logger.info).toHaveBeenCalledWith(
                'Enhanced Disney+ navigation detection set up',
                expect.any(Object)
            );
        });
    });

    describe('Cross-Platform Compatibility', () => {
        test('should handle identical messages consistently across platforms', () => {
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

            // Setup both scripts
            [netflixScript, disneyScript].forEach((script) => {
                script.contentLogger = script === netflixScript ? testEnvNetflix.mocks.logger : testEnvDisney.mocks.logger;
                script.subtitleUtils = {
                    setSubtitlesActive: jest.fn(),
                    hideSubtitleContainer: jest.fn(),
                    clearSubtitlesDisplayAndQueue: jest.fn(),
                    subtitlesActive: true
                };
                script.configService = {
                    getAll: jest.fn().mockResolvedValue(ChromeApiFixtures.storageConfig)
                };
                
                // Mock methods needed for message handling
                script.stopVideoElementDetection = jest.fn();
            });

            // Test same message on both platforms
            const message = { action: 'toggleSubtitles', enabled: false };
            const netflixResponse = jest.fn();
            const disneyResponse = jest.fn();

            const netflixResult = netflixScript.handleChromeMessage(message, {}, netflixResponse);
            const disneyResult = disneyScript.handleChromeMessage(message, {}, disneyResponse);

            // Both should handle synchronously
            expect(netflixResult).toBe(disneyResult);
            expect(typeof netflixResult).toBe('boolean');

            // Both should call utilities
            expect(netflixScript.subtitleUtils.setSubtitlesActive).toHaveBeenCalledWith(false);
            expect(disneyScript.subtitleUtils.setSubtitlesActive).toHaveBeenCalledWith(false);
            
            // Both should call hide container for disable
            expect(netflixScript.subtitleUtils.hideSubtitleContainer).toHaveBeenCalled();
            expect(disneyScript.subtitleUtils.hideSubtitleContainer).toHaveBeenCalled();

            // Both should provide successful responses
            expect(netflixResponse).toHaveBeenCalledWith(
                expect.objectContaining({ success: true, subtitlesEnabled: false })
            );
            expect(disneyResponse).toHaveBeenCalledWith(
                expect.objectContaining({ success: true, subtitlesEnabled: false })
            );

            testEnvNetflix.cleanup();
            testEnvDisney.cleanup();
        });

        test('should handle error cases consistently across platforms', () => {
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

            // Setup both scripts
            [netflixScript, disneyScript].forEach((script) => {
                script.contentLogger = script === netflixScript ? testEnvNetflix.mocks.logger : testEnvDisney.mocks.logger;
            });

            // Test error handling with invalid message
            const invalidMessage = null;
            const netflixResponse = jest.fn();
            const disneyResponse = jest.fn();

            const netflixResult = netflixScript.handlePlatformSpecificMessage(invalidMessage, netflixResponse);
            const disneyResult = disneyScript.handlePlatformSpecificMessage(invalidMessage, disneyResponse);

            // Both should handle errors synchronously
            expect(netflixResult).toBe(false);
            expect(disneyResult).toBe(false);

            // Both should provide error responses
            expect(netflixResponse).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: false,
                    platform: 'netflix'
                })
            );
            expect(disneyResponse).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: false,
                    platform: 'disneyplus'
                })
            );

            testEnvNetflix.cleanup();
            testEnvDisney.cleanup();
        });
    });

    describe('Message Handler Registry', () => {
        test('should register common message handlers correctly', () => {
            const testEnv = testHelpers.setupTestEnvironment({
                platform: 'netflix',
                enableLogger: true,
                enableChromeApi: true,
                enableLocation: false
            });

            const netflixScript = new NetflixContentScript();
            netflixScript.contentLogger = testEnv.mocks.logger;

            // Should have registered common handlers
            expect(netflixScript.hasMessageHandler('toggleSubtitles')).toBe(true);
            expect(netflixScript.hasMessageHandler('configChanged')).toBe(true);
            expect(netflixScript.hasMessageHandler('LOGGING_LEVEL_CHANGED')).toBe(true);

            // Should provide handler information
            const handlers = netflixScript.getRegisteredHandlers();
            expect(handlers.length).toBeGreaterThan(0);
            
            const toggleHandler = handlers.find(h => h.action === 'toggleSubtitles');
            expect(toggleHandler).toBeDefined();
            expect(toggleHandler.requiresUtilities).toBe(true);

            testEnv.cleanup();
        });

        test('should allow handler registration and unregistration', () => {
            const testEnv = testHelpers.setupTestEnvironment({
                platform: 'netflix',
                enableLogger: true,
                enableChromeApi: true,
                enableLocation: false
            });

            const netflixScript = new NetflixContentScript();
            netflixScript.contentLogger = testEnv.mocks.logger;

            // Register custom handler
            const customHandler = jest.fn();
            netflixScript.registerMessageHandler('customAction', customHandler, {
                requiresUtilities: false,
                description: 'Custom test handler'
            });

            expect(netflixScript.hasMessageHandler('customAction')).toBe(true);

            // Unregister handler
            const removed = netflixScript.unregisterMessageHandler('customAction');
            expect(removed).toBe(true);
            expect(netflixScript.hasMessageHandler('customAction')).toBe(false);

            testEnv.cleanup();
        });
    });

    describe('Performance and Reliability', () => {
        test('should handle rapid message processing without issues', () => {
            const testEnv = testHelpers.setupTestEnvironment({
                platform: 'netflix',
                enableLogger: true,
                enableChromeApi: true,
                enableLocation: false
            });

            const netflixScript = new NetflixContentScript();
            netflixScript.contentLogger = testEnv.mocks.logger;

            // Process many platform-specific messages rapidly (these don't require utilities)
            const messages = Array.from({ length: 50 }, (_, i) => ({
                action: `custom-action-${i}`,
                data: `test-data-${i}`
            }));

            const startTime = Date.now();

            messages.forEach((message) => {
                const mockResponse = jest.fn();
                const result = netflixScript.handlePlatformSpecificMessage(message, mockResponse);
                
                expect(typeof result).toBe('boolean');
                expect(mockResponse).toHaveBeenCalled();
            });

            const endTime = Date.now();
            const duration = endTime - startTime;

            // Should complete quickly
            expect(duration).toBeLessThan(1000);

            testEnv.cleanup();
        });

        test('should maintain state consistency during concurrent operations', async () => {
            const testEnv = testHelpers.setupTestEnvironment({
                platform: 'netflix',
                enableLogger: true,
                enableChromeApi: true,
                enableLocation: false
            });

            const netflixScript = new NetflixContentScript();
            netflixScript.contentLogger = testEnv.mocks.logger;
            netflixScript.subtitleUtils = {
                handleSubtitleDataFound: jest.fn().mockResolvedValue(true)
            };

            const mockPlatform = {
                isPlayerPageActive: jest.fn().mockReturnValue(true)
            };
            netflixScript.activePlatform = mockPlatform;

            // Process multiple subtitle data concurrently
            const subtitleDataArray = Array.from({ length: 5 }, (_, i) => ({
                videoId: `video-${i}`,
                sourceLanguage: 'en',
                targetLanguage: 'zh-CN'
            }));

            const promises = subtitleDataArray.map((data) =>
                netflixScript.handleSubtitleDataFound(data)
            );

            // Should all complete without errors
            const results = await Promise.all(promises);
            expect(results).toHaveLength(5);

            // Should have processed all data
            expect(netflixScript.subtitleUtils.handleSubtitleDataFound).toHaveBeenCalledTimes(5);

            testEnv.cleanup();
        });
    });
});