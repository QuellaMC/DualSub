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
import { buildLoggingLevelChangedRequestMessage } from '../shared/protocol/messageProtocol.js';

const EXTENSION_ID = 'dualsub-content-core-test';
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
                enableLocation: false,
            });

            netflixScript = new NetflixContentScript();
            netflixScript.contentLogger = testEnv.mocks.logger;
            netflixScript.currentConfig = {
                ...ChromeApiFixtures.storageConfig,
            };

            // Mock essential subtitle utilities
            netflixScript.subtitleUtils = {
                setSubtitlesActive: jest.fn(),
                hideSubtitleContainer: jest.fn(),
                showSubtitleContainer: jest.fn(),
                clearSubtitlesDisplayAndQueue: jest.fn(),
                subtitlesActive: true,
            };

            netflixScript.configService = {
                getAll: jest
                    .fn()
                    .mockResolvedValue(ChromeApiFixtures.storageConfig),
            };
        });

        afterEach(() => {
            if (netflixScript && typeof netflixScript.cleanup === 'function') {
                netflixScript.cleanup();
            }
            testEnv.cleanup();
        });

        test('should handle logging level change message correctly', () => {
            const message = buildLoggingLevelChangedRequestMessage(4);
            const mockSendResponse = jest.fn();

            const result = netflixScript.handleChromeMessage(
                message,
                createExtensionSender(EXTENSION_PATHS.background),
                mockSendResponse
            );

            // Should handle synchronously
            expect(typeof result).toBe('boolean');

            // Should update logger level
            expect(testEnv.mocks.logger.updateLevel).toHaveBeenCalledWith(4);

            // Should provide response
            expect(mockSendResponse).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                })
            );
        });

        test('should handle subtitle data processing', async () => {
            const mockPlatform = {
                isPlayerPageActive: jest.fn().mockReturnValue(true),
                getVideoElement: jest.fn().mockReturnValue({ currentTime: 10 }),
            };

            netflixScript.activePlatform = mockPlatform;
            netflixScript.subtitleUtils.handleSubtitleDataFound = jest.fn();

            const subtitleData = {
                videoId: '12345',
                sourceLanguage: 'en',
                targetLanguage: 'zh-CN',
            };

            // Should not throw
            await netflixScript.handleSubtitleDataFound(subtitleData);

            // Should call subtitle utilities if available
            if (netflixScript.subtitleUtils.handleSubtitleDataFound) {
                expect(
                    netflixScript.subtitleUtils.handleSubtitleDataFound
                ).toHaveBeenCalledWith(
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
            expect(
                netflixScript.subtitleUtils.handleVideoIdChange
            ).toHaveBeenCalledWith('new-video-id', netflixScript.logPrefix);
            expect(
                netflixScript.subtitleUtils.setCurrentVideoId
            ).toHaveBeenCalledWith('new-video-id');
        });

        test('should provide correct platform identification', () => {
            expect(netflixScript.getPlatformName()).toBe('netflix');
            expect(netflixScript.getPlatformClass()).toBe('NetflixPlatform');

            const injectConfig = netflixScript.getInjectScriptConfig();
            expect(injectConfig.filename).toBe(
                'injected_scripts/netflixInject.js'
            );
            expect(injectConfig.tagId).toBe(
                'netflix-dualsub-injector-script-tag'
            );
            expect(injectConfig.eventId).toBe('netflix-dualsub-injector-event');
        });

        test('should handle navigation detection setup', () => {
            // Mock the intervalManager since it's not fully initialized in test
            netflixScript.intervalManager = {
                set: jest.fn(),
                clearAll: jest.fn(),
            };

            // Should not throw when setting up navigation
            expect(() => {
                netflixScript.setupNavigationDetection();
            }).not.toThrow();

            // Should log setup completion
            expect(testEnv.mocks.logger.info).toHaveBeenCalledWith(
                'Enhanced Netflix navigation detection is set up.',
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
                enableLocation: false,
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
                subtitlesActive: true,
            };

            disneyScript.configService = {
                getAll: jest
                    .fn()
                    .mockResolvedValue(ChromeApiFixtures.storageConfig),
            };
        });

        afterEach(() => {
            if (disneyScript && typeof disneyScript.cleanup === 'function') {
                disneyScript.cleanup();
            }
            testEnv.cleanup();
        });

        test('should provide correct platform identification', () => {
            expect(disneyScript.getPlatformName()).toBe('disneyplus');
            expect(disneyScript.getPlatformClass()).toBe('DisneyPlusPlatform');

            const injectConfig = disneyScript.getInjectScriptConfig();
            expect(injectConfig.filename).toBe(
                'injected_scripts/disneyPlusInject.js'
            );
            expect(injectConfig.tagId).toBe(
                'disneyplus-dualsub-injector-script-tag'
            );
            expect(injectConfig.eventId).toBe(
                'disneyplus-dualsub-injector-event'
            );
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
                clearAll: jest.fn(),
            };

            // Should not throw when setting up navigation
            expect(() => {
                disneyScript.setupNavigationDetection();
            }).not.toThrow();

            // Should log setup completion
            expect(testEnv.mocks.logger.info).toHaveBeenCalledWith(
                'Enhanced Disney+ navigation detection is set up.',
                expect.any(Object)
            );
        });
    });

    describe('Message Handler Registry', () => {
        test('should register common message handlers correctly', () => {
            const testEnv = testHelpers.setupTestEnvironment({
                platform: 'netflix',
                enableLogger: true,
                enableChromeApi: true,
                enableLocation: false,
            });

            const netflixScript = new NetflixContentScript();
            netflixScript.contentLogger = testEnv.mocks.logger;

            // Should have registered common handlers
            expect(netflixScript.hasMessageHandler('toggleSubtitles')).toBe(
                false
            );
            expect(netflixScript.hasMessageHandler('configChanged')).toBe(true);
            expect(
                netflixScript.hasMessageHandler('LOGGING_LEVEL_CHANGED')
            ).toBe(true);

            // Should provide handler information
            const handlers = netflixScript.getRegisteredHandlers();
            expect(handlers.length).toBeGreaterThan(0);

            const configHandler = handlers.find(
                (handler) => handler.action === 'configChanged'
            );
            expect(configHandler).toBeDefined();
            expect(configHandler.requiresUtilities).toBe(true);

            testEnv.cleanup();
        });

        test('should reject out-of-catalog handler registration', () => {
            const testEnv = testHelpers.setupTestEnvironment({
                platform: 'netflix',
                enableLogger: true,
                enableChromeApi: true,
                enableLocation: false,
            });

            const netflixScript = new NetflixContentScript();
            netflixScript.contentLogger = testEnv.mocks.logger;

            // Register custom handler
            const customHandler = jest.fn();
            expect(() =>
                netflixScript.registerMessageHandler(
                    'customAction',
                    customHandler,
                    {
                        requiresUtilities: false,
                        description: 'Custom test handler',
                    }
                )
            ).toThrow('Action must be present in MessageActions.');
            expect(netflixScript.hasMessageHandler('customAction')).toBe(false);

            testEnv.cleanup();
        });
    });

    describe('Performance and Reliability', () => {
        test('should maintain state consistency during concurrent operations', async () => {
            const testEnv = testHelpers.setupTestEnvironment({
                platform: 'netflix',
                enableLogger: true,
                enableChromeApi: true,
                enableLocation: false,
            });

            const netflixScript = new NetflixContentScript();
            netflixScript.contentLogger = testEnv.mocks.logger;
            netflixScript.subtitleUtils = {
                handleSubtitleDataFound: jest.fn().mockResolvedValue(true),
            };

            const mockPlatform = {
                isPlayerPageActive: jest.fn().mockReturnValue(true),
            };
            netflixScript.activePlatform = mockPlatform;

            // Process multiple subtitle data concurrently
            const subtitleDataArray = Array.from({ length: 5 }, (_, i) => ({
                videoId: `video-${i}`,
                sourceLanguage: 'en',
                targetLanguage: 'zh-CN',
            }));

            const promises = subtitleDataArray.map((data) =>
                netflixScript.handleSubtitleDataFound(data)
            );

            // Should all complete without errors
            const results = await Promise.all(promises);
            expect(results).toHaveLength(5);

            // Should have processed all data
            expect(
                netflixScript.subtitleUtils.handleSubtitleDataFound
            ).toHaveBeenCalledTimes(5);

            testEnv.cleanup();
        });
    });
});
