/**
 * BaseContentScript Tests
 * 
 * Tests for the abstract BaseContentScript class functionality including
 * module loading, platform initialization, configuration management,
 * event handling, and Chrome message processing.
 */

import { jest } from '@jest/globals';
import { BaseContentScript } from './BaseContentScript.js';
import { TestHelpers } from '../test-utils/test-helpers.js';
import { mockChromeApi } from '../test-utils/chrome-api-mock.js';
import { createLoggerMock } from '../test-utils/logger-mock.js';

// Mock concrete implementation for testing
class TestContentScript extends BaseContentScript {
    constructor(logPrefix = 'TestContent') {
        super(logPrefix);
    }

    getPlatformName() {
        return 'test';
    }

    getPlatformClass() {
        return class TestPlatform {
            isPlayerPageActive() { return true; }
            getVideoElement() { return document.createElement('video'); }
            initialize() { return Promise.resolve(); }
            handleNativeSubtitles() {}
            cleanup() {}
        };
    }

    getInjectScriptConfig() {
        return {
            filename: 'injected_scripts/testInject.js',
            tagId: 'test-inject-script',
            eventId: 'test-subtitle-event'
        };
    }

    setupNavigationDetection() {
        // Mock implementation
    }

    checkForUrlChange() {
        // Mock implementation
    }

    handlePlatformSpecificMessage(request, sendResponse) {
        sendResponse({ success: true, platform: 'test' });
        return false;
    }
}

describe('BaseContentScript', () => {
    let testHelpers;
    let mockChrome;
    let mockLogger;
    let contentScript;

    beforeEach(() => {
        testHelpers = new TestHelpers();
        testHelpers.setupTestEnvironment();
        mockChrome = mockChromeApi();
        mockLogger = createLoggerMock();
        
        // Setup global chrome object
        global.chrome = mockChrome;
        
        // Mock dynamic imports
        global.chrome.runtime.getURL = jest.fn((path) => `chrome-extension://test/${path}`);
        
        contentScript = new TestContentScript();
    });

    afterEach(() => {
        testHelpers.mockRegistry.cleanup();
        if (contentScript) {
            contentScript.cleanup();
        }
    });

    describe('Constructor', () => {
        test('should throw error when instantiated directly', () => {
            expect(() => new BaseContentScript('test')).toThrow(
                'BaseContentScript is abstract and cannot be instantiated directly'
            );
        });

        test('should initialize with correct default properties', () => {
            expect(contentScript.logPrefix).toBe('TestContent');
            expect(contentScript.contentLogger).toBeNull();
            expect(contentScript.activePlatform).toBeNull();
            expect(contentScript.currentConfig).toEqual({});
            expect(contentScript.eventBuffer).toEqual([]);
            expect(contentScript.platformReady).toBe(false);
            expect(contentScript.isCleanedUp).toBe(false);
        });
    });

    describe('Abstract Methods', () => {
        test('concrete implementation should implement all abstract methods', () => {
            expect(contentScript.getPlatformName()).toBe('test');
            expect(typeof contentScript.getPlatformClass()).toBe('function');
            expect(contentScript.getInjectScriptConfig()).toEqual({
                filename: 'injected_scripts/testInject.js',
                tagId: 'test-inject-script',
                eventId: 'test-subtitle-event'
            });
            expect(() => contentScript.setupNavigationDetection()).not.toThrow();
            expect(() => contentScript.checkForUrlChange()).not.toThrow();
            expect(() => contentScript.handlePlatformSpecificMessage({}, jest.fn())).not.toThrow();
        });
    });

    describe('Module Loading', () => {
        test('should load all required modules successfully', async () => {
            // Mock module imports
            const mockSubtitleUtils = { setSubtitlesActive: jest.fn() };
            const mockPlatformModule = { TestPlatform: contentScript.getPlatformClass() };
            const mockConfigService = { getAll: jest.fn().mockResolvedValue({}), onChanged: jest.fn() };
            const mockLoggerModule = { 
                default: { 
                    create: jest.fn().mockReturnValue(mockLogger),
                    LEVELS: { INFO: 'info' }
                }
            };

            // Mock dynamic imports
            jest.doMock('chrome-extension://test/content_scripts/subtitleUtilities.js', () => mockSubtitleUtils, { virtual: true });
            jest.doMock('chrome-extension://test/video_platforms/testPlatform.js', () => mockPlatformModule, { virtual: true });
            jest.doMock('chrome-extension://test/services/configService.js', () => ({ configService: mockConfigService }), { virtual: true });
            jest.doMock('chrome-extension://test/utils/logger.js', () => mockLoggerModule, { virtual: true });

            const result = await contentScript.loadModules();

            expect(result).toBe(true);
            expect(contentScript.subtitleUtils).toBe(mockSubtitleUtils);
            expect(contentScript.configService).toBe(mockConfigService);
            expect(contentScript.contentLogger).toBe(mockLogger);
        });

        test('should handle module loading errors gracefully', async () => {
            // Mock import failure
            jest.doMock('chrome-extension://test/content_scripts/subtitleUtilities.js', () => {
                throw new Error('Module not found');
            }, { virtual: true });

            const result = await contentScript.loadModules();

            expect(result).toBe(false);
            expect(contentScript.subtitleUtils).toBeNull();
        });
    });

    describe('Initialization Flow', () => {
        test('should complete full initialization successfully', async () => {
            // Setup mocks
            const mockConfig = { subtitlesEnabled: true };
            contentScript.loadModules = jest.fn().mockResolvedValue(true);
            contentScript.configService = { 
                getAll: jest.fn().mockResolvedValue(mockConfig),
                onChanged: jest.fn()
            };
            contentScript.setupConfigurationListeners = jest.fn();
            contentScript.setupEarlyEventHandling = jest.fn();
            contentScript.initializePlatform = jest.fn().mockResolvedValue();
            contentScript.setupNavigationDetection = jest.fn();
            contentScript.setupDOMObservation = jest.fn();
            contentScript.setupCleanupHandlers = jest.fn();

            const result = await contentScript.initialize();

            expect(result).toBe(true);
            expect(contentScript.currentConfig).toEqual(mockConfig);
            expect(contentScript.setupConfigurationListeners).toHaveBeenCalled();
            expect(contentScript.setupEarlyEventHandling).toHaveBeenCalled();
            expect(contentScript.initializePlatform).toHaveBeenCalled();
            expect(contentScript.setupNavigationDetection).toHaveBeenCalled();
            expect(contentScript.setupDOMObservation).toHaveBeenCalled();
            expect(contentScript.setupCleanupHandlers).toHaveBeenCalled();
        });

        test('should fail gracefully when module loading fails', async () => {
            contentScript.loadModules = jest.fn().mockResolvedValue(false);

            const result = await contentScript.initialize();

            expect(result).toBe(false);
        });

        test('should handle initialization errors', async () => {
            contentScript.loadModules = jest.fn().mockRejectedValue(new Error('Test error'));

            const result = await contentScript.initialize();

            expect(result).toBe(false);
        });
    });

    describe('Event Handling', () => {
        test('should buffer events when platform is not ready', () => {
            const mockEvent = {
                detail: {
                    type: 'SUBTITLE_DATA_FOUND',
                    data: 'test subtitle data'
                }
            };

            contentScript.platformReady = false;
            contentScript.handleEarlyInjectorEvents(mockEvent);

            expect(contentScript.eventBuffer).toHaveLength(1);
            expect(contentScript.eventBuffer[0]).toEqual(mockEvent.detail);
        });

        test('should process buffered events when platform becomes ready', () => {
            const mockEvent = {
                detail: {
                    type: 'SUBTITLE_DATA_FOUND',
                    data: 'test subtitle data'
                }
            };

            // Buffer event first
            contentScript.platformReady = false;
            contentScript.handleEarlyInjectorEvents(mockEvent);

            // Setup platform and make it ready
            contentScript.activePlatform = {
                handleInjectorEvents: jest.fn()
            };
            contentScript.platformReady = true;

            // Process buffered events
            contentScript.processBufferedEvents();

            expect(contentScript.activePlatform.handleInjectorEvents).toHaveBeenCalledWith({
                detail: mockEvent.detail
            });
            expect(contentScript.eventBuffer).toHaveLength(0);
        });

        test('should handle invalid event data gracefully', () => {
            const invalidEvents = [
                null,
                { detail: null },
                { detail: {} },
                { detail: { type: null } }
            ];

            invalidEvents.forEach(event => {
                expect(() => contentScript.handleEarlyInjectorEvents(event)).not.toThrow();
            });
        });
    });

    describe('Chrome Message Handling', () => {
        beforeEach(() => {
            contentScript.subtitleUtils = { setSubtitlesActive: jest.fn() };
            contentScript.configService = { getAll: jest.fn() };
        });

        test('should handle logging level changes', () => {
            const request = { type: 'LOGGING_LEVEL_CHANGED', level: 'debug' };
            const sendResponse = jest.fn();
            contentScript.contentLogger = mockLogger;

            const result = contentScript.handleChromeMessage(request, {}, sendResponse);

            expect(mockLogger.updateLevel).toHaveBeenCalledWith('debug');
            expect(sendResponse).toHaveBeenCalledWith({ success: true });
            expect(result).toBe(false);
        });

        test('should handle toggle subtitles message', () => {
            const request = { action: 'toggleSubtitles', enabled: false };
            const sendResponse = jest.fn();
            
            contentScript.stopVideoElementDetection = jest.fn();
            contentScript.subtitleUtils.hideSubtitleContainer = jest.fn();
            contentScript.subtitleUtils.clearSubtitlesDisplayAndQueue = jest.fn();

            const result = contentScript.handleChromeMessage(request, {}, sendResponse);

            expect(contentScript.subtitleUtils.setSubtitlesActive).toHaveBeenCalledWith(false);
            expect(sendResponse).toHaveBeenCalledWith({
                success: true,
                subtitlesEnabled: false
            });
            expect(result).toBe(false);
        });

        test('should handle config changed message', () => {
            const request = { action: 'configChanged', changes: { theme: 'dark' } };
            const sendResponse = jest.fn();

            const result = contentScript.handleChromeMessage(request, {}, sendResponse);

            expect(sendResponse).toHaveBeenCalledWith({ success: true });
            expect(result).toBe(false);
        });

        test('should delegate unknown messages to platform-specific handler', () => {
            const request = { action: 'customAction', data: 'test' };
            const sendResponse = jest.fn();

            const result = contentScript.handleChromeMessage(request, {}, sendResponse);

            expect(sendResponse).toHaveBeenCalledWith({ success: true, platform: 'test' });
            expect(result).toBe(false);
        });

        test('should handle messages when utilities not loaded', () => {
            contentScript.subtitleUtils = null;
            const request = { action: 'toggleSubtitles', enabled: true };
            const sendResponse = jest.fn();

            const result = contentScript.handleChromeMessage(request, {}, sendResponse);

            expect(sendResponse).toHaveBeenCalledWith({ 
                success: false, 
                error: 'Utilities not loaded' 
            });
            expect(result).toBe(true);
        });
    });

    describe('Video Element Detection', () => {
        test('should start video detection with retry mechanism', () => {
            contentScript.activePlatform = {
                getVideoElement: jest.fn().mockReturnValue(null)
            };
            contentScript.subtitleUtils = {};
            contentScript.currentConfig = {};

            jest.spyOn(global, 'setInterval').mockImplementation((fn, delay) => {
                // Simulate one retry attempt
                setTimeout(fn, 0);
                return 123;
            });

            contentScript.startVideoElementDetection();

            expect(contentScript.videoDetectionRetries).toBe(0);
            expect(global.setInterval).toHaveBeenCalled();
        });

        test('should stop detection when video element is found', () => {
            const mockVideo = document.createElement('video');
            contentScript.activePlatform = {
                getVideoElement: jest.fn().mockReturnValue(mockVideo)
            };
            contentScript.subtitleUtils = {
                ensureSubtitleContainer: jest.fn(),
                subtitlesActive: true,
                showSubtitleContainer: jest.fn(),
                updateSubtitles: jest.fn(),
                hideSubtitleContainer: jest.fn()
            };
            contentScript.currentConfig = {};

            const result = contentScript.attemptVideoSetup();

            expect(result).toBe(true);
            expect(contentScript.subtitleUtils.ensureSubtitleContainer).toHaveBeenCalled();
        });
    });

    describe('Configuration Management', () => {
        test('should setup configuration listeners', () => {
            const mockConfigService = {
                onChanged: jest.fn()
            };
            contentScript.configService = mockConfigService;

            contentScript.setupConfigurationListeners();

            expect(mockConfigService.onChanged).toHaveBeenCalledWith(expect.any(Function));
        });

        test('should apply configuration changes', () => {
            const changes = { subtitleFontSize: '2.5' };
            contentScript.activePlatform = {
                getVideoElement: jest.fn().mockReturnValue({ currentTime: 10 })
            };
            contentScript.subtitleUtils = {
                subtitlesActive: true,
                applySubtitleStyling: jest.fn(),
                updateSubtitles: jest.fn()
            };
            contentScript.currentConfig = { subtitleFontSize: '2.0' };

            contentScript.applyConfigurationChanges(changes);

            expect(contentScript.subtitleUtils.applySubtitleStyling).toHaveBeenCalledWith(
                contentScript.currentConfig
            );
            expect(contentScript.subtitleUtils.updateSubtitles).toHaveBeenCalled();
        });

        test('should not apply changes for UI-only settings', () => {
            const changes = { appearanceAccordionOpen: true };
            contentScript.activePlatform = {};
            contentScript.subtitleUtils = {
                subtitlesActive: true,
                applySubtitleStyling: jest.fn()
            };

            contentScript.applyConfigurationChanges(changes);

            expect(contentScript.subtitleUtils.applySubtitleStyling).not.toHaveBeenCalled();
        });
    });

    describe('Cleanup', () => {
        test('should clean up all resources', () => {
            contentScript.videoDetectionIntervalId = 123;
            contentScript.urlChangeCheckInterval = 456;
            contentScript.pageObserver = { disconnect: jest.fn() };
            contentScript.activePlatform = { cleanup: jest.fn() };
            contentScript.subtitleUtils = { clearSubtitleDOM: jest.fn() };

            jest.spyOn(global, 'clearInterval');

            contentScript.cleanup();

            expect(global.clearInterval).toHaveBeenCalledWith(123);
            expect(global.clearInterval).toHaveBeenCalledWith(456);
            expect(contentScript.pageObserver.disconnect).toHaveBeenCalled();
            expect(contentScript.activePlatform.cleanup).toHaveBeenCalled();
            expect(contentScript.subtitleUtils.clearSubtitleDOM).toHaveBeenCalled();
            expect(contentScript.isCleanedUp).toBe(true);
        });

        test('should not clean up multiple times', () => {
            contentScript.isCleanedUp = true;
            const spy = jest.spyOn(contentScript, 'logWithFallback');

            contentScript.cleanup();

            expect(spy).not.toHaveBeenCalled();
        });
    });

    describe('Logging', () => {
        test('should use logger when available', () => {
            contentScript.contentLogger = mockLogger;

            contentScript.logWithFallback('info', 'test message', { data: 'test' });

            expect(mockLogger.info).toHaveBeenCalledWith('test message', { data: 'test' });
        });

        test('should fallback to console when logger not available', () => {
            const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

            contentScript.logWithFallback('warn', 'test warning');

            expect(consoleSpy).toHaveBeenCalledWith(
                '[TestContent] [WARN] test warning',
                {}
            );

            consoleSpy.mockRestore();
        });
    });
});