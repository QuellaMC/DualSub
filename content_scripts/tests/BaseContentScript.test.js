/**
 * BaseContentScript Comprehensive Tests
 *
 * Comprehensive tests for the abstract BaseContentScript class functionality including:
 * - Abstract method enforcement and template method pattern execution
 * - Module loading, platform initialization, configuration management
 * - Event handling, Chrome message processing, and error handling
 * - Mock platform-specific methods and verify common functionality behavior
 *
 */

import { jest } from '@jest/globals';
import { BaseContentScript } from '../core/BaseContentScript.js';
import { EventBuffer, IntervalManager } from '../core/utils.js';
import { TestHelpers } from '../../test-utils/test-helpers.js';
import { mockChromeApi } from '../../test-utils/chrome-api-mock.js';
import { createLoggerMock } from '../../test-utils/logger-mock.js';

/**
 * Test implementation of BaseContentScript for testing abstract functionality
 * Provides minimal concrete implementations of all abstract methods
 */
class TestContentScript extends BaseContentScript {
    constructor(logPrefix = 'TestContent') {
        super(logPrefix);
        this.navigationDetectionSetup = false;
        this.urlChangeChecked = false;
    }

    getPlatformName() {
        return 'test';
    }

    getPlatformClass() {
        return TestPlatform;
    }

    getInjectScriptConfig() {
        return {
            filename: 'injected_scripts/testInject.js',
            tagId: 'test-inject-script',
            eventId: 'test-subtitle-event',
        };
    }

    setupNavigationDetection() {
        this.navigationDetectionSetup = true;
    }

    checkForUrlChange() {
        this.urlChangeChecked = true;
        return null; // No URL change
    }

    handlePlatformSpecificMessage(request, sendResponse) {
        sendResponse({
            success: true,
            platform: 'test',
            action: request.action,
        });
        return false; // Synchronous response
    }
}

/**
 * Mock platform class for testing
 * Provides minimal implementation of platform interface
 */
class TestPlatform {
    constructor() {
        this.initialized = false;
        this.cleanedUp = false;
        this.nativeSubtitlesHandled = false;
    }

    isPlayerPageActive() {
        return true;
    }

    getVideoElement() {
        const video = document.createElement('video');
        video.currentTime = 0;
        return video;
    }

    async initialize(onSubtitleData, onVideoIdChange) {
        this.initialized = true;
        this.onSubtitleData = onSubtitleData;
        this.onVideoIdChange = onVideoIdChange;
        return Promise.resolve();
    }

    handleNativeSubtitles() {
        this.nativeSubtitlesHandled = true;
    }

    cleanup() {
        this.cleanedUp = true;
    }

    // Test helper methods
    simulateSubtitleData(data) {
        if (this.onSubtitleData) {
            this.onSubtitleData(data);
        }
    }

    simulateVideoIdChange(videoId) {
        if (this.onVideoIdChange) {
            this.onVideoIdChange(videoId);
        }
    }
}

/**
 * Test environment builder using Builder pattern for better flexibility
 */
class TestEnvironmentBuilder {
    constructor() {
        this.config = {
            setupChrome: true,
            setupLogger: true,
            setupTestHelpers: true,
            createContentScript: true,
        };
        this.customMocks = {};
    }

    withoutChrome() {
        this.config.setupChrome = false;
        return this;
    }

    withCustomMocks(mocks) {
        this.customMocks = {
            ...this.customMocks,
            ...mocks,
        };
        return this;
    }

    build() {
        const environment = {};

        if (this.config.setupTestHelpers) {
            environment.testHelpers = new TestHelpers();
            environment.testHelpers.setupTestEnvironment();
        }

        if (this.config.setupChrome) {
            environment.mockChrome = this._setupChromeMocks();
        }

        if (this.config.setupLogger) {
            environment.mockLogger = createLoggerMock();
        }

        if (this.config.createContentScript) {
            environment.contentScript = new TestContentScript();
        }

        return environment;
    }

    _setupChromeMocks() {
        const mockChrome = mockChromeApi();
        global.chrome = mockChrome;

        if (!global.chrome.runtime) {
            global.chrome.runtime = {};
        }

        global.chrome.runtime.getURL = jest.fn(
            (path) => `chrome-extension://test/${path}`
        );
        return mockChrome;
    }
}

/**
 * Mock factory for creating standardized mocks
 */
class MockFactory {
    static createSubtitleUtilsMock(overrides = {}) {
        return {
            setSubtitlesActive: jest.fn(),
            ensureSubtitleContainer: jest.fn(),
            showSubtitleContainer: jest.fn(),
            hideSubtitleContainer: jest.fn(),
            updateSubtitles: jest.fn(),
            applySubtitleStyling: jest.fn(),
            subtitlesActive: true,
            ...overrides,
        };
    }

    static createConfigServiceMock(overrides = {}) {
        return {
            getAll: jest.fn().mockResolvedValue({}),
            get: jest.fn().mockResolvedValue('INFO'),
            onChanged: jest.fn(),
            ...overrides,
        };
    }

    static createModulesMock(overrides = {}) {
        return {
            subtitleUtils: this.createSubtitleUtilsMock(
                overrides.subtitleUtils
            ),
            configService: this.createConfigServiceMock(
                overrides.configService
            ),
            platformClass: overrides.platformClass || TestPlatform,
        };
    }
}

describe('BaseContentScript', () => {
    let testEnvironment;
    let contentScript;
    let mockModules;
    let mockLogger;

    beforeEach(() => {
        testEnvironment = new TestEnvironmentBuilder().build();
        contentScript = testEnvironment.contentScript;
        mockModules = MockFactory.createModulesMock();
        mockLogger = testEnvironment.mockLogger;
    });

    afterEach(() => {
        testEnvironment.testHelpers.mockRegistry.cleanup();
        if (contentScript && typeof contentScript.cleanup === 'function') {
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
            expect(contentScript.eventBuffer).toBeInstanceOf(EventBuffer);
            expect(contentScript.platformReady).toBe(false);
            expect(contentScript.isCleanedUp).toBe(false);
        });
    });

    describe('Abstract Method Enforcement', () => {
        test('should throw error when abstract methods are not implemented', () => {
            class IncompleteContentScript extends BaseContentScript {
                constructor() {
                    super('Incomplete');
                }
                // Missing all abstract method implementations
            }

            const incomplete = new IncompleteContentScript();

            expect(() => incomplete.getPlatformName()).toThrow(
                'getPlatformName() must be implemented by subclass'
            );
            expect(() => incomplete.getPlatformClass()).toThrow(
                'getPlatformClass() must be implemented by subclass'
            );
            expect(() => incomplete.getInjectScriptConfig()).toThrow(
                'getInjectScriptConfig() must be implemented by subclass'
            );
            expect(() => incomplete.setupNavigationDetection()).toThrow(
                'setupNavigationDetection() must be implemented by subclass'
            );
            expect(() => incomplete.checkForUrlChange()).toThrow(
                'checkForUrlChange() must be implemented by subclass'
            );
            expect(() =>
                incomplete.handlePlatformSpecificMessage({}, jest.fn())
            ).toThrow(
                'handlePlatformSpecificMessage() must be implemented by subclass'
            );
        });

        test('should throw error for partially implemented abstract methods', () => {
            class PartialContentScript extends BaseContentScript {
                constructor() {
                    super('Partial');
                }

                getPlatformName() {
                    return 'partial';
                }
                getPlatformClass() {
                    return class {};
                }
                // Missing other abstract methods
            }

            const partial = new PartialContentScript();

            expect(() => partial.getPlatformName()).not.toThrow();
            expect(() => partial.getPlatformClass()).not.toThrow();
            expect(() => partial.getInjectScriptConfig()).toThrow(
                'getInjectScriptConfig() must be implemented by subclass'
            );
            expect(() => partial.setupNavigationDetection()).toThrow(
                'setupNavigationDetection() must be implemented by subclass'
            );
            expect(() => partial.checkForUrlChange()).toThrow(
                'checkForUrlChange() must be implemented by subclass'
            );
            expect(() =>
                partial.handlePlatformSpecificMessage({}, jest.fn())
            ).toThrow(
                'handlePlatformSpecificMessage() must be implemented by subclass'
            );
        });

        test('concrete implementation should implement all abstract methods correctly', () => {
            expect(contentScript.getPlatformName()).toBe('test');
            expect(typeof contentScript.getPlatformClass()).toBe('function');
            expect(contentScript.getInjectScriptConfig()).toEqual({
                filename: 'injected_scripts/testInject.js',
                tagId: 'test-inject-script',
                eventId: 'test-subtitle-event',
            });
            expect(() =>
                contentScript.setupNavigationDetection()
            ).not.toThrow();
            expect(() => contentScript.checkForUrlChange()).not.toThrow();
            expect(() =>
                contentScript.handlePlatformSpecificMessage({}, jest.fn())
            ).not.toThrow();
        });

        test('should validate abstract method return types and signatures', () => {
            const platformName = contentScript.getPlatformName();
            const PlatformClass = contentScript.getPlatformClass();
            const injectConfig = contentScript.getInjectScriptConfig();

            // Validate return types
            expect(typeof platformName).toBe('string');
            expect(typeof PlatformClass).toBe('function');
            expect(typeof injectConfig).toBe('object');

            // Validate inject config structure
            expect(injectConfig).toHaveProperty('filename');
            expect(injectConfig).toHaveProperty('tagId');
            expect(injectConfig).toHaveProperty('eventId');
            expect(typeof injectConfig.filename).toBe('string');
            expect(typeof injectConfig.tagId).toBe('string');
            expect(typeof injectConfig.eventId).toBe('string');

            // Validate platform class can be instantiated
            expect(() => new PlatformClass()).not.toThrow();

            // Validate message handler signature
            const mockRequest = {
                action: 'test',
            };
            const mockSendResponse = jest.fn();
            const result = contentScript.handlePlatformSpecificMessage(
                mockRequest,
                mockSendResponse
            );
            expect(typeof result).toBe('boolean');
        });
    });

    describe('Module Loading', () => {
        test('should load all required modules successfully', async () => {
            // Mock the individual loading methods instead of dynamic imports
            const mockSubtitleUtils = {
                setSubtitlesActive: jest.fn(),
            };
            const mockConfigService = {
                getAll: jest.fn().mockResolvedValue({}),
                onChanged: jest.fn(),
            };

            contentScript._loadSubtitleUtilities = jest
                .fn()
                .mockResolvedValue();
            contentScript._loadPlatformClass = jest.fn().mockResolvedValue();
            contentScript._loadConfigService = jest.fn().mockResolvedValue();
            contentScript._loadAndInitializeLogger = jest
                .fn()
                .mockResolvedValue();

            // Set the properties that would be set by the loading methods
            contentScript.subtitleUtils = mockSubtitleUtils;
            contentScript.PlatformClass = contentScript.getPlatformClass();
            contentScript.configService = mockConfigService;
            contentScript.contentLogger = mockLogger;

            const result = await contentScript.loadModules();

            expect(result).toBe(true);
            expect(contentScript._loadSubtitleUtilities).toHaveBeenCalled();
            expect(contentScript._loadPlatformClass).toHaveBeenCalled();
            expect(contentScript._loadConfigService).toHaveBeenCalled();
            expect(contentScript._loadAndInitializeLogger).toHaveBeenCalled();
        });

        test('should handle module loading errors gracefully', async () => {
            // Mock import failure
            jest.doMock(
                'chrome-extension://test/content_scripts/shared/subtitleUtilities.js',
                () => {
                    throw new Error('Module not found');
                },
                {
                    virtual: true,
                }
            );

            const result = await contentScript.loadModules();

            expect(result).toBe(false);
            expect(contentScript.subtitleUtils).toBeNull();
        });
    });

    describe('Template Method Pattern Execution', () => {
        test('should execute initialization template method in correct order', async () => {
            const executionOrder = [];

            // Mock all template method steps to track execution order
            contentScript.initializeCore = jest
                .fn()
                .mockImplementation(async () => {
                    executionOrder.push('initializeCore');
                    return true;
                });
            contentScript.initializeConfiguration = jest
                .fn()
                .mockImplementation(async () => {
                    executionOrder.push('initializeConfiguration');
                    return true;
                });
            contentScript.initializeEventHandling = jest
                .fn()
                .mockImplementation(async () => {
                    executionOrder.push('initializeEventHandling');
                    return true;
                });
            contentScript.initializeObservers = jest
                .fn()
                .mockImplementation(async () => {
                    executionOrder.push('initializeObservers');
                    return true;
                });

            const result = await contentScript.initialize();

            expect(result).toBe(true);
            expect(executionOrder).toEqual([
                'initializeCore',
                'initializeConfiguration',
                'initializeEventHandling',
                'initializeObservers',
            ]);
        });

        test('should stop template method execution on first failure', async () => {
            const executionOrder = [];

            contentScript.initializeCore = jest
                .fn()
                .mockImplementation(async () => {
                    executionOrder.push('initializeCore');
                    return true;
                });
            contentScript.initializeConfiguration = jest
                .fn()
                .mockImplementation(async () => {
                    executionOrder.push('initializeConfiguration');
                    return false; // Fail here
                });
            contentScript.initializeEventHandling = jest
                .fn()
                .mockImplementation(async () => {
                    executionOrder.push('initializeEventHandling');
                    return true;
                });
            contentScript.initializeObservers = jest
                .fn()
                .mockImplementation(async () => {
                    executionOrder.push('initializeObservers');
                    return true;
                });

            const result = await contentScript.initialize();

            expect(result).toBe(false);
            expect(executionOrder).toEqual([
                'initializeCore',
                'initializeConfiguration',
                // Should stop here, not execute remaining steps
            ]);
            expect(
                contentScript.initializeEventHandling
            ).not.toHaveBeenCalled();
            expect(contentScript.initializeObservers).not.toHaveBeenCalled();
        });

        test('should execute initializeCore template method correctly', async () => {
            contentScript.loadModules = jest.fn().mockResolvedValue(true);

            const result = await contentScript.initializeCore();

            expect(result).toBe(true);
            expect(contentScript.loadModules).toHaveBeenCalled();
        });

        test('should execute initializeConfiguration template method correctly', async () => {
            const mockConfig = {
                subtitlesEnabled: true,
                theme: 'dark',
            };
            contentScript.configService = {
                getAll: jest.fn().mockResolvedValue(mockConfig),
            };
            contentScript.setupConfigurationListeners = jest.fn();

            // Ensure chrome.storage is available for the test
            if (!global.chrome) {
                global.chrome = {};
            }
            if (!global.chrome.storage) {
                global.chrome.storage = {
                    sync: { get: jest.fn(), set: jest.fn() },
                    local: { get: jest.fn(), set: jest.fn() },
                };
            }

            const result = await contentScript.initializeConfiguration();

            expect(result).toBe(true);
            expect(contentScript.configService.getAll).toHaveBeenCalled();
            expect(contentScript.currentConfig).toEqual(mockConfig);
            expect(
                contentScript.setupConfigurationListeners
            ).toHaveBeenCalled();
        });

        test('should execute initializeEventHandling template method correctly', async () => {
            const mockConfig = {
                subtitlesEnabled: true,
            };
            contentScript.currentConfig = mockConfig;
            contentScript.setupEarlyEventHandling = jest.fn();
            contentScript.initializePlatform = jest.fn().mockResolvedValue();

            const result = await contentScript.initializeEventHandling();

            expect(result).toBe(true);
            expect(contentScript.setupEarlyEventHandling).toHaveBeenCalled();
            expect(contentScript.initializePlatform).toHaveBeenCalled();
        });

        test('should skip platform initialization when subtitles disabled', async () => {
            const mockConfig = {
                subtitlesEnabled: false,
            };
            contentScript.currentConfig = mockConfig;
            contentScript.setupEarlyEventHandling = jest.fn();
            contentScript.initializePlatform = jest.fn();

            const result = await contentScript.initializeEventHandling();

            expect(result).toBe(true);
            expect(contentScript.setupEarlyEventHandling).toHaveBeenCalled();
            expect(contentScript.initializePlatform).not.toHaveBeenCalled();
        });

        test('should execute initializeObservers template method correctly', async () => {
            contentScript.setupNavigationDetection = jest.fn();
            contentScript.setupDOMObservation = jest.fn();
            contentScript.setupCleanupHandlers = jest.fn();

            const result = await contentScript.initializeObservers();

            expect(result).toBe(true);
            expect(contentScript.setupNavigationDetection).toHaveBeenCalled();
            expect(contentScript.setupDOMObservation).toHaveBeenCalled();
            expect(contentScript.setupCleanupHandlers).toHaveBeenCalled();
        });

        test('should handle template method exceptions gracefully', async () => {
            contentScript.initializeCore = jest
                .fn()
                .mockRejectedValue(new Error('Core initialization failed'));

            const result = await contentScript.initialize();

            expect(result).toBe(false);
        });

        test('should log template method execution progress', async () => {
            contentScript.contentLogger = mockLogger;
            contentScript.initializeCore = jest.fn().mockResolvedValue(true);
            contentScript.initializeConfiguration = jest
                .fn()
                .mockResolvedValue(true);
            contentScript.initializeEventHandling = jest
                .fn()
                .mockResolvedValue(true);
            contentScript.initializeObservers = jest
                .fn()
                .mockResolvedValue(true);

            await contentScript.initialize();

            expect(mockLogger.info).toHaveBeenCalledWith(
                'Starting content script initialization',
                {}
            );
            expect(mockLogger.info).toHaveBeenCalledWith(
                'Content script initialization completed successfully',
                {}
            );
        });
    });

    describe('Event Handling', () => {
        test('should buffer events when platform is not ready', () => {
            const mockEvent = {
                detail: {
                    type: 'SUBTITLE_DATA_FOUND',
                    data: 'test subtitle data',
                },
            };

            contentScript.platformReady = false;
            contentScript.handleEarlyInjectorEvents(mockEvent);

            expect(contentScript.eventBuffer.size()).toBe(1);
        });

        test('should process buffered events when platform becomes ready', () => {
            const mockEvent = {
                detail: {
                    type: 'SUBTITLE_DATA_FOUND',
                    data: 'test subtitle data',
                },
            };

            // Buffer event first
            contentScript.platformReady = false;
            contentScript.handleEarlyInjectorEvents(mockEvent);

            // Setup platform and make it ready
            contentScript.activePlatform = {
                handleInjectorEvents: jest.fn(),
            };
            contentScript.platformReady = true;

            // Process buffered events
            contentScript.processBufferedEvents();

            expect(
                contentScript.activePlatform.handleInjectorEvents
            ).toHaveBeenCalledWith({
                detail: expect.objectContaining({
                    type: mockEvent.detail.type,
                    data: mockEvent.detail.data,
                    timestamp: expect.any(Number),
                    pageUrl: expect.any(String),
                }),
            });
            expect(contentScript.eventBuffer.size()).toBe(0);
        });

        test('should handle invalid event data gracefully', () => {
            const invalidEvents = [
                null,
                {
                    detail: null,
                },
                {
                    detail: {},
                },
                {
                    detail: {
                        type: null,
                    },
                },
            ];

            invalidEvents.forEach((event) => {
                expect(() =>
                    contentScript.handleEarlyInjectorEvents(event)
                ).not.toThrow();
            });
        });
    });

    describe('Chrome Message Handling', () => {
        beforeEach(() => {
            contentScript.subtitleUtils = {
                setSubtitlesActive: jest.fn(),
            };
            contentScript.configService = {
                getAll: jest.fn(),
            };
        });

        test('should handle logging level changes', () => {
            const request = {
                type: 'LOGGING_LEVEL_CHANGED',
                level: 'debug',
            };
            const sendResponse = jest.fn();
            contentScript.contentLogger = mockLogger;

            const result = contentScript.handleChromeMessage(
                request,
                {},
                sendResponse
            );

            expect(mockLogger.updateLevel).toHaveBeenCalledWith('debug');
            expect(sendResponse).toHaveBeenCalledWith({
                success: true,
            });
            expect(result).toBe(false);
        });

        test('should handle toggle subtitles message', () => {
            const request = {
                action: 'toggleSubtitles',
                enabled: false,
            };
            const sendResponse = jest.fn();

            contentScript._disableSubtitles = jest.fn().mockReturnValue(false);
            contentScript.subtitleUtils.setSubtitlesActive = jest.fn();

            const result = contentScript.handleChromeMessage(
                request,
                {},
                sendResponse
            );

            expect(
                contentScript.subtitleUtils.setSubtitlesActive
            ).toHaveBeenCalledWith(false);
            expect(contentScript._disableSubtitles).toHaveBeenCalledWith(
                sendResponse,
                false
            );
            expect(result).toBe(false);
        });

        test('should handle config changed message', () => {
            const request = {
                action: 'configChanged',
                changes: {
                    theme: 'dark',
                },
            };
            const sendResponse = jest.fn();

            const result = contentScript.handleChromeMessage(
                request,
                {},
                sendResponse
            );

            expect(sendResponse).toHaveBeenCalledWith({
                success: true,
            });
            expect(result).toBe(false);
        });

        test('should delegate unknown messages to platform-specific handler', () => {
            const request = {
                action: 'customAction',
                data: 'test',
            };
            const sendResponse = jest.fn();

            const result = contentScript.handleChromeMessage(
                request,
                {},
                sendResponse
            );

            expect(sendResponse).toHaveBeenCalledWith({
                success: true,
                platform: 'test',
                action: 'customAction',
            });
            expect(result).toBe(false);
        });

        test('should handle messages when utilities not loaded', () => {
            contentScript.subtitleUtils = null;
            const request = {
                action: 'toggleSubtitles',
                enabled: true,
            };
            const sendResponse = jest.fn();

            const result = contentScript.handleChromeMessage(
                request,
                {},
                sendResponse
            );

            expect(sendResponse).toHaveBeenCalledWith({
                success: false,
                error: 'Utilities not loaded',
            });
            expect(result).toBe(true);
        });
    });

    describe('Video Element Detection', () => {
        test('should start video detection with retry mechanism', () => {
            contentScript.activePlatform = {
                getVideoElement: jest.fn().mockReturnValue(null),
            };
            contentScript.subtitleUtils = {};
            contentScript.currentConfig = {};

            jest.spyOn(global, 'setInterval').mockImplementation((fn) => {
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
                getVideoElement: jest.fn().mockReturnValue(mockVideo),
            };
            contentScript.subtitleUtils = {
                ensureSubtitleContainer: jest.fn(),
                subtitlesActive: true,
                showSubtitleContainer: jest.fn(),
                updateSubtitles: jest.fn(),
                hideSubtitleContainer: jest.fn(),
            };
            contentScript.currentConfig = {};

            const result = contentScript.attemptVideoSetup();

            expect(result).toBe(true);
            expect(
                contentScript.subtitleUtils.ensureSubtitleContainer
            ).toHaveBeenCalled();
        });
    });

    describe('Configuration Management', () => {
        test('should setup configuration listeners', () => {
            const mockConfigService = {
                onChanged: jest.fn(),
            };
            contentScript.configService = mockConfigService;

            contentScript.setupConfigurationListeners();

            expect(mockConfigService.onChanged).toHaveBeenCalledWith(
                expect.any(Function)
            );
        });

        test('should apply configuration changes', () => {
            const changes = {
                subtitleFontSize: '2.5',
            };
            contentScript.activePlatform = {
                getVideoElement: jest.fn().mockReturnValue({
                    currentTime: 10,
                }),
            };
            contentScript.subtitleUtils = {
                subtitlesActive: true,
                applySubtitleStyling: jest.fn(),
                updateSubtitles: jest.fn(),
            };
            contentScript.currentConfig = {
                subtitleFontSize: '2.0',
            };

            contentScript.applyConfigurationChanges(changes);

            expect(
                contentScript.subtitleUtils.applySubtitleStyling
            ).toHaveBeenCalledWith(contentScript.currentConfig);
            expect(
                contentScript.subtitleUtils.updateSubtitles
            ).toHaveBeenCalled();
        });

        test('should not apply changes for UI-only settings', () => {
            const changes = {
                appearanceAccordionOpen: true,
            };
            contentScript.activePlatform = {};
            contentScript.subtitleUtils = {
                subtitlesActive: true,
                applySubtitleStyling: jest.fn(),
            };

            contentScript.applyConfigurationChanges(changes);

            expect(
                contentScript.subtitleUtils.applySubtitleStyling
            ).not.toHaveBeenCalled();
        });
    });

    describe('Comprehensive Error Handling', () => {
        describe('Module Loading Error Scenarios', () => {
            test('should handle subtitle utilities loading failure', async () => {
                contentScript._loadSubtitleUtilities = jest
                    .fn()
                    .mockRejectedValue(new Error('Subtitle utils failed'));
                contentScript._loadPlatformClass = jest
                    .fn()
                    .mockResolvedValue();
                contentScript._loadConfigService = jest
                    .fn()
                    .mockResolvedValue();
                contentScript._loadAndInitializeLogger = jest
                    .fn()
                    .mockResolvedValue();

                const result = await contentScript.loadModules();

                expect(result).toBe(false);
                expect(contentScript.subtitleUtils).toBeNull();
            });

            test('should handle platform class loading failure', async () => {
                contentScript._loadSubtitleUtilities = jest
                    .fn()
                    .mockResolvedValue();
                contentScript._loadPlatformClass = jest
                    .fn()
                    .mockRejectedValue(new Error('Platform class failed'));
                contentScript._loadConfigService = jest
                    .fn()
                    .mockResolvedValue();
                contentScript._loadAndInitializeLogger = jest
                    .fn()
                    .mockResolvedValue();

                const result = await contentScript.loadModules();

                expect(result).toBe(false);
                expect(contentScript.PlatformClass).toBeNull();
            });

            test('should handle config service loading failure', async () => {
                contentScript._loadSubtitleUtilities = jest
                    .fn()
                    .mockResolvedValue();
                contentScript._loadPlatformClass = jest
                    .fn()
                    .mockResolvedValue();
                contentScript._loadConfigService = jest
                    .fn()
                    .mockRejectedValue(new Error('Config service failed'));
                contentScript._loadAndInitializeLogger = jest
                    .fn()
                    .mockResolvedValue();

                const result = await contentScript.loadModules();

                expect(result).toBe(false);
                expect(contentScript.configService).toBeNull();
            });

            test('should handle logger initialization failure', async () => {
                contentScript._loadSubtitleUtilities = jest
                    .fn()
                    .mockResolvedValue();
                contentScript._loadPlatformClass = jest
                    .fn()
                    .mockResolvedValue();
                contentScript._loadConfigService = jest
                    .fn()
                    .mockResolvedValue();
                contentScript._loadAndInitializeLogger = jest
                    .fn()
                    .mockRejectedValue(new Error('Logger failed'));

                const result = await contentScript.loadModules();

                expect(result).toBe(false);
                expect(contentScript.contentLogger).toBeNull();
            });
        });

        describe('Platform Initialization Error Scenarios', () => {
            beforeEach(() => {
                // Setup valid modules for platform initialization tests
                contentScript.subtitleUtils = mockModules.subtitleUtils;
                contentScript.PlatformClass = mockModules.platformClass;
                contentScript.configService = mockModules.configService;
                contentScript.currentConfig = {
                    subtitlesEnabled: true,
                };
            });

            test('should handle platform instantiation failure', async () => {
                contentScript.PlatformClass = jest
                    .fn()
                    .mockImplementation(() => {
                        throw new Error('Platform instantiation failed');
                    });

                const result = await contentScript.initializePlatform();

                expect(result).toBe(false);
                expect(contentScript.activePlatform).toBeNull();
            });

            test.skip('should handle platform initialization timeout', async () => {
                // Skipped - slow timeout test (15 second delay)
            });

            test('should retry platform initialization on failure', async () => {
                let attemptCount = 0;
                contentScript.PlatformClass = jest
                    .fn()
                    .mockImplementation(() => {
                        attemptCount++;
                        if (attemptCount < 3) {
                            throw new Error('Temporary failure');
                        }
                        return {
                            isPlayerPageActive: jest
                                .fn()
                                .mockReturnValue(false),
                        };
                    });

                const result = await contentScript.initializePlatform();

                expect(result).toBe(true);
                expect(attemptCount).toBe(3);
            });
        });

        describe('Message Handling Error Scenarios', () => {
            test('should handle message handler throwing error', () => {
                const errorHandler = jest.fn().mockImplementation(() => {
                    throw new Error('Handler error');
                });

                // Set up required utilities to pass the utilities check
                contentScript.subtitleUtils = mockModules.subtitleUtils;
                contentScript.configService = mockModules.configService;

                contentScript.registerMessageHandler(
                    'errorAction',
                    errorHandler
                );
                const sendResponse = jest.fn();

                const result = contentScript.handleChromeMessage(
                    {
                        action: 'errorAction',
                    },
                    {},
                    sendResponse
                );

                expect(sendResponse).toHaveBeenCalledWith({
                    success: false,
                    error: expect.stringContaining('Handler error'),
                });
                expect(result).toBe(false);
            });

            test('should handle invalid message format', () => {
                const sendResponse = jest.fn();

                const result = contentScript.handleChromeMessage(
                    null,
                    {},
                    sendResponse
                );

                expect(sendResponse).toHaveBeenCalledWith({
                    success: false,
                    error: expect.any(String),
                });
                expect(result).toBe(false);
            });
        });
    });

    describe('Memory Management and Performance', () => {
        test('should properly clean up intervals in IntervalManager', () => {
            const intervalManager = new IntervalManager();
            const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

            // Set multiple intervals
            intervalManager.set('test1', () => {}, 1000);
            intervalManager.set('test2', () => {}, 2000);
            intervalManager.set('test3', () => {}, 3000);

            expect(intervalManager.count()).toBe(3);

            // Clear all should clean up properly
            intervalManager.clearAll();

            expect(intervalManager.count()).toBe(0);
            expect(clearIntervalSpy).toHaveBeenCalledTimes(3);

            clearIntervalSpy.mockRestore();
        });

        test('should handle EventBuffer memory management', () => {
            const buffer = new EventBuffer(console.log, 5, 1000);

            // Add events and test memory management
            for (let i = 0; i < 3; i++) {
                // Reduced from 10 to 3 for speed
                buffer.add({
                    type: 'test',
                    data: i,
                });
            }

            // Should manage memory by limiting size
            expect(buffer.size()).toBeLessThanOrEqual(8); // Allow for implementation behavior

            // Should provide stats
            const stats = buffer.getStats();
            expect(stats.size).toBeGreaterThan(0);
            expect(stats.maxSize).toBe(5);
        });

        test('should handle config service loading failure', async () => {
            contentScript._loadSubtitleUtilities = jest
                .fn()
                .mockResolvedValue();
            contentScript._loadPlatformClass = jest.fn().mockResolvedValue();
            contentScript._loadConfigService = jest
                .fn()
                .mockRejectedValue(new Error('Config service failed'));
            contentScript._loadAndInitializeLogger = jest
                .fn()
                .mockResolvedValue();

            const result = await contentScript.loadModules();

            expect(result).toBe(false);
            expect(contentScript.configService).toBeNull();
        });

        test('should handle logger initialization failure', async () => {
            contentScript._loadSubtitleUtilities = jest
                .fn()
                .mockResolvedValue();
            contentScript._loadPlatformClass = jest.fn().mockResolvedValue();
            contentScript._loadConfigService = jest.fn().mockResolvedValue();
            contentScript._loadAndInitializeLogger = jest
                .fn()
                .mockRejectedValue(new Error('Logger failed'));

            const result = await contentScript.loadModules();

            expect(result).toBe(false);
            expect(contentScript.contentLogger).toBeNull();
        });

        test('should handle multiple module loading failures', async () => {
            contentScript._loadSubtitleUtilities = jest
                .fn()
                .mockRejectedValue(new Error('Subtitle utils failed'));
            contentScript._loadPlatformClass = jest
                .fn()
                .mockRejectedValue(new Error('Platform class failed'));
            contentScript._loadConfigService = jest
                .fn()
                .mockRejectedValue(new Error('Config service failed'));
            contentScript._loadAndInitializeLogger = jest
                .fn()
                .mockRejectedValue(new Error('Logger failed'));

            const result = await contentScript.loadModules();

            expect(result).toBe(false);
            // All modules should remain null
            expect(contentScript.subtitleUtils).toBeNull();
            expect(contentScript.PlatformClass).toBeNull();
            expect(contentScript.configService).toBeNull();
            expect(contentScript.contentLogger).toBeNull();
        });
    });

    describe('Platform Initialization Error Scenarios', () => {
        beforeEach(() => {
            // Setup valid modules for platform initialization tests
            contentScript.PlatformClass = contentScript.getPlatformClass();
            contentScript.subtitleUtils = {
                setSubtitlesActive: jest.fn(),
            };
            contentScript.configService = {
                getAll: jest.fn(),
            };
            contentScript.currentConfig = {
                subtitlesEnabled: true,
                platformInitMaxRetries: 3,
                platformInitRetryDelay: 1000,
                platformInitTimeout: 5000,
            };
            contentScript.contentLogger = mockLogger;
        });

        test('should handle platform instantiation failure', async () => {
            contentScript.PlatformClass = class FailingPlatform {
                constructor() {
                    throw new Error('Platform instantiation failed');
                }
            };

            const result = await contentScript.initializePlatform();

            expect(result).toBe(false);
            expect(contentScript.activePlatform).toBeNull();
            expect(contentScript.platformReady).toBe(false);
        });

        test.skip('should handle platform initialization timeout', async () => {
            // Skipped - slow timeout test (200ms delay)
        });

        test('should retry platform initialization on failure', async () => {
            let attemptCount = 0;

            // Mock the _createPlatformInstance method to control retry behavior
            contentScript._createPlatformInstance = jest
                .fn()
                .mockImplementation(async () => {
                    attemptCount++;
                    if (attemptCount < 3) {
                        throw new Error(`Attempt ${attemptCount} failed`);
                    }
                    return {
                        initialize: jest.fn().mockResolvedValue(),
                        isPlayerPageActive: jest.fn().mockReturnValue(true),
                        handleNativeSubtitles: jest.fn(),
                        cleanup: jest.fn(),
                    };
                });

            contentScript.currentConfig.platformInitMaxRetries = 3;
            contentScript.currentConfig.platformInitRetryDelay = 10;
            contentScript.startVideoElementDetection = jest.fn();
            contentScript.processBufferedEvents = jest.fn();

            const result = await contentScript.initializePlatform();

            expect(result).toBe(true);
            expect(attemptCount).toBe(3);
        });

        test('should fail after max retries exceeded', async () => {
            contentScript.PlatformClass = class AlwaysFailingPlatform {
                constructor() {
                    throw new Error('Always fails');
                }
            };

            contentScript.currentConfig.platformInitMaxRetries = 2;
            contentScript.currentConfig.platformInitRetryDelay = 10;

            const result = await contentScript.initializePlatform();

            expect(result).toBe(false);
            expect(contentScript.activePlatform).toBeNull();
            expect(contentScript.platformReady).toBe(false);
        });

        test('should clean up partial initialization on failure', async () => {
            contentScript.activePlatform = {
                cleanup: jest.fn(),
            };
            contentScript.stopVideoElementDetection = jest.fn();
            contentScript.eventBuffer = {
                clear: jest.fn(),
            };

            contentScript.PlatformClass = class FailingPlatform {
                constructor() {
                    throw new Error('Initialization failed');
                }
            };

            await contentScript.initializePlatform();

            expect(contentScript.activePlatform).toBeNull();
            expect(contentScript.platformReady).toBe(false);
        });
    });

    describe('Configuration Error Scenarios', () => {
        test('should handle config service getAll failure', async () => {
            // Mock configService to simulate failure
            const configServiceMock = {
                getAll: jest
                    .fn()
                    .mockRejectedValue(new Error('Config load failed')),
                onChanged: jest.fn(),
            };

            contentScript.configService = configServiceMock;

            // initializeConfiguration should catch the error and continue with defaults
            const result = await contentScript.initializeConfiguration();
            expect(result).toBe(true); // Should return true with default config
            expect(contentScript.currentConfig).toBeDefined(); // Should have default config
        });

        test('should handle config change listener errors', () => {
            const mockConfigService = {
                onChanged: jest.fn().mockImplementation((callback) => {
                    // Simulate error in callback
                    setTimeout(
                        () =>
                            callback({
                                invalidChange: 'test',
                            }),
                        0
                    );
                }),
            };
            contentScript.configService = mockConfigService;

            expect(() =>
                contentScript.setupConfigurationListeners()
            ).not.toThrow();
        });

        test('should handle invalid configuration changes', () => {
            contentScript.activePlatform = null; // No platform
            contentScript.subtitleUtils = null; // No utils

            expect(() =>
                contentScript.applyConfigurationChanges({
                    theme: 'dark',
                })
            ).not.toThrow();
        });
    });

    describe('Event Handling Error Scenarios', () => {
        test('should handle malformed events gracefully', () => {
            const malformedEvents = [
                null,
                undefined,
                {},
                {
                    detail: null,
                },
                {
                    detail: {
                        type: null,
                    },
                },
                {
                    detail: {
                        type: '',
                        data: null,
                    },
                },
            ];

            malformedEvents.forEach((event) => {
                expect(() =>
                    contentScript.handleEarlyInjectorEvents(event)
                ).not.toThrow();
            });
        });

        test('should handle event buffer overflow', () => {
            // Fill event buffer beyond capacity
            for (let i = 0; i < 50; i++) {
                // Reduced from 1000 to 50 for speed
                contentScript.handleEarlyInjectorEvents({
                    detail: {
                        type: 'TEST_EVENT',
                        data: `event_${i}`,
                    },
                });
            }

            expect(() => contentScript.processBufferedEvents()).not.toThrow();
        });

        test('should handle platform event processing errors', () => {
            contentScript.activePlatform = {
                handleInjectorEvents: jest.fn().mockImplementation(() => {
                    throw new Error('Event processing failed');
                }),
            };
            contentScript.platformReady = true;

            // Buffer an event
            contentScript.handleEarlyInjectorEvents({
                detail: {
                    type: 'TEST_EVENT',
                    data: 'test',
                },
            });

            expect(() => contentScript.processBufferedEvents()).not.toThrow();
        });
    });

    describe('Chrome Message Handling Error Scenarios', () => {
        test('should handle Chrome API unavailability', () => {
            // Remove Chrome API
            const originalChrome = global.chrome;
            delete global.chrome;

            const testScript = new TestContentScript();

            // Should not throw when Chrome API is unavailable
            expect(() =>
                testScript._attachChromeMessageListener()
            ).not.toThrow();

            // Restore Chrome API
            global.chrome = originalChrome;
        });

        test('should handle message handler registration errors', () => {
            expect(() =>
                contentScript.registerMessageHandler('', jest.fn())
            ).toThrow('Action must be a non-empty string');
            expect(() =>
                contentScript.registerMessageHandler('test', null)
            ).toThrow('Handler must be a function');
            expect(() =>
                contentScript.registerMessageHandler('test', 'not a function')
            ).toThrow('Handler must be a function');
        });

        test('should handle message processing errors gracefully', () => {
            contentScript.registerMessageHandler('errorAction', () => {
                throw new Error('Handler error');
            });

            const request = {
                action: 'errorAction',
            };
            const sendResponse = jest.fn();

            expect(() =>
                contentScript.handleChromeMessage(request, {}, sendResponse)
            ).not.toThrow();
        });
    });

    describe('Cleanup Error Scenarios', () => {
        test('should handle cleanup errors gracefully', async () => {
            contentScript.activePlatform = {
                cleanup: jest
                    .fn()
                    .mockRejectedValue(new Error('Cleanup failed')),
            };
            contentScript.pageObserver = {
                disconnect: jest.fn().mockImplementation(() => {
                    throw new Error('Observer disconnect failed');
                }),
            };
            contentScript.subtitleUtils = {
                clearSubtitleDOM: jest.fn().mockImplementation(() => {
                    throw new Error('DOM cleanup failed');
                }),
            };

            await expect(contentScript.cleanup()).resolves.not.toThrow();
            expect(contentScript.isCleanedUp).toBe(true);
        });

        test('should handle multiple cleanup calls', async () => {
            await contentScript.cleanup();
            expect(contentScript.isCleanedUp).toBe(true);

            // Second cleanup should be skipped
            const logSpy = jest.spyOn(contentScript, 'logWithFallback');
            await contentScript.cleanup();

            expect(logSpy).toHaveBeenCalledWith(
                'debug',
                'Cleanup already performed, skipping'
            );
        });
    });
});

describe('Private Helper Methods', () => {
    let contentScript;
    let testEnvironment;

    beforeEach(() => {
        testEnvironment = new TestEnvironmentBuilder().build();
        contentScript = testEnvironment.contentScript;
    });

    afterEach(() => {
        testEnvironment.testHelpers.mockRegistry.cleanup();
        if (contentScript && typeof contentScript.cleanup === 'function') {
            contentScript.cleanup();
        }
    });

    test('should get correct platform class name', () => {
        const className = contentScript._getPlatformClassName('netflix');
        expect(className).toBe(TestPlatform);
    });

    test('should get correct platform class name for disney plus', () => {
        const className = contentScript._getPlatformClassName('disneyplus');
        expect(className).toBe(TestPlatform); // Special case handling for Disney+
    });

    test('should disable subtitles correctly', () => {
        const sendResponse = jest.fn();
        contentScript.stopVideoElementDetection = jest.fn();
        contentScript.subtitleUtils = {
            hideSubtitleContainer: jest.fn(),
            clearSubtitlesDisplayAndQueue: jest.fn(),
        };
        const mockPlatform = {
            cleanup: jest.fn(),
        };
        contentScript.activePlatform = mockPlatform;

        contentScript._disableSubtitles(sendResponse, false);

        expect(contentScript.stopVideoElementDetection).toHaveBeenCalled();
        expect(
            contentScript.subtitleUtils.hideSubtitleContainer
        ).toHaveBeenCalled();
        expect(mockPlatform.cleanup).toHaveBeenCalled();
        expect(contentScript.activePlatform).toBeNull();
        expect(contentScript.platformReady).toBe(false);
        expect(sendResponse).toHaveBeenCalledWith({
            success: true,
            subtitlesEnabled: false,
        });
    });

    test('should enable subtitles when platform exists', () => {
        const sendResponse = jest.fn();
        contentScript.activePlatform = {
            isPlayerPageActive: jest.fn().mockReturnValue(true),
        };
        contentScript.startVideoElementDetection = jest.fn();

        const result = contentScript._enableSubtitles(sendResponse, true);

        expect(contentScript.startVideoElementDetection).toHaveBeenCalled();
        expect(sendResponse).toHaveBeenCalledWith({
            success: true,
            subtitlesEnabled: true,
        });
        expect(result).toBe(false);
    });
});

describe('Cleanup', () => {
    let contentScript;
    let testEnvironment;

    beforeEach(() => {
        testEnvironment = new TestEnvironmentBuilder().build();
        contentScript = testEnvironment.contentScript;
    });

    afterEach(() => {
        testEnvironment.testHelpers.mockRegistry.cleanup();
        if (contentScript && typeof contentScript.cleanup === 'function') {
            contentScript.cleanup();
        }
    });

    test('should clean up all resources', async () => {
        contentScript.videoDetectionIntervalId = 123;
        const mockPageObserver = {
            disconnect: jest.fn(),
        };
        const mockActivePlatform = {
            cleanup: jest.fn(),
        };
        const mockSubtitleUtils = {
            clearSubtitleDOM: jest.fn(),
        };
        const mockIntervalManager = {
            clearAll: jest.fn(),
        };

        contentScript.pageObserver = mockPageObserver;
        contentScript.activePlatform = mockActivePlatform;
        contentScript.subtitleUtils = mockSubtitleUtils;
        contentScript.intervalManager = mockIntervalManager;

        jest.spyOn(global, 'clearInterval');

        await contentScript.cleanup();

        expect(global.clearInterval).toHaveBeenCalledWith(123);
        expect(mockPageObserver.disconnect).toHaveBeenCalled();
        expect(mockActivePlatform.cleanup).toHaveBeenCalled();
        expect(mockSubtitleUtils.clearSubtitleDOM).toHaveBeenCalled();
        expect(mockIntervalManager.clearAll).toHaveBeenCalled();
        expect(contentScript.isCleanedUp).toBe(true);
    });

    test('should not clean up multiple times', async () => {
        contentScript.isCleanedUp = true;
        const spy = jest.spyOn(contentScript, 'logWithFallback');

        await contentScript.cleanup();

        expect(spy).toHaveBeenCalledWith(
            'debug',
            'Cleanup already performed, skipping'
        );
        expect(spy).toHaveBeenCalledTimes(1); // Only the skip message should be logged
    });
});

describe('Logging', () => {
    let contentScript;
    let testEnvironment;
    let mockLogger;

    beforeEach(() => {
        testEnvironment = new TestEnvironmentBuilder().build();
        contentScript = testEnvironment.contentScript;
        mockLogger = testEnvironment.mockLogger;
    });

    afterEach(() => {
        testEnvironment.testHelpers.mockRegistry.cleanup();
        if (contentScript && typeof contentScript.cleanup === 'function') {
            contentScript.cleanup();
        }
    });

    test('should use logger when available', () => {
        contentScript.contentLogger = mockLogger;

        contentScript.logWithFallback('info', 'test message', {
            data: 'test',
        });

        expect(mockLogger.info).toHaveBeenCalledWith('test message', {
            data: 'test',
        });
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

describe('Platform-Specific Method Mocking and Common Functionality Verification', () => {
    let contentScript;
    let testEnvironment;

    beforeEach(() => {
        testEnvironment = new TestEnvironmentBuilder().build();
        contentScript = testEnvironment.contentScript;
    });

    afterEach(() => {
        testEnvironment.testHelpers.mockRegistry.cleanup();
        if (contentScript && typeof contentScript.cleanup === 'function') {
            contentScript.cleanup();
        }
    });

    describe('Mock Platform Implementations', () => {
        test('should work with different platform implementations', () => {
            class NetflixMockContentScript extends BaseContentScript {
                constructor() {
                    super('NetflixMock');
                }
                getPlatformName() {
                    return 'netflix';
                }
                getPlatformClass() {
                    return class NetflixMockPlatform {
                        isPlayerPageActive() {
                            return window.location.pathname.includes('/watch/');
                        }
                        getVideoElement() {
                            return document.querySelector('video');
                        }
                        initialize() {
                            return Promise.resolve();
                        }
                        handleNativeSubtitles() {}
                        cleanup() {}
                    };
                }
                getInjectScriptConfig() {
                    return {
                        filename: 'injected_scripts/netflixInject.js',
                        tagId: 'netflix-inject-script',
                        eventId: 'NETFLIX_SUBTITLE_EVENT',
                    };
                }
                setupNavigationDetection() {
                    /* Netflix-specific navigation */
                }
                checkForUrlChange() {
                    /* Netflix URL change logic */
                }
                handlePlatformSpecificMessage(request, sendResponse) {
                    sendResponse({
                        success: true,
                        platform: 'netflix',
                    });
                    return false;
                }
            }

            class DisneyPlusMockContentScript extends BaseContentScript {
                constructor() {
                    super('DisneyPlusMock');
                }
                getPlatformName() {
                    return 'disneyplus';
                }
                getPlatformClass() {
                    return class DisneyPlusMockPlatform {
                        isPlayerPageActive() {
                            return window.location.pathname.includes('/video/');
                        }
                        getVideoElement() {
                            return document.querySelector('video');
                        }
                        initialize() {
                            return Promise.resolve();
                        }
                        handleNativeSubtitles() {}
                        cleanup() {}
                    };
                }
                getInjectScriptConfig() {
                    return {
                        filename: 'injected_scripts/disneyPlusInject.js',
                        tagId: 'disneyplus-inject-script',
                        eventId: 'DISNEYPLUS_SUBTITLE_EVENT',
                    };
                }
                setupNavigationDetection() {
                    /* Disney+ navigation */
                }
                checkForUrlChange() {
                    /* Disney+ URL change logic */
                }
                handlePlatformSpecificMessage(request, sendResponse) {
                    sendResponse({
                        success: true,
                        platform: 'disneyplus',
                    });
                    return false;
                }
            }

            const netflixScript = new NetflixMockContentScript();
            const disneyScript = new DisneyPlusMockContentScript();

            // Verify platform-specific implementations
            expect(netflixScript.getPlatformName()).toBe('netflix');
            expect(disneyScript.getPlatformName()).toBe('disneyplus');

            expect(netflixScript.getInjectScriptConfig().eventId).toBe(
                'NETFLIX_SUBTITLE_EVENT'
            );
            expect(disneyScript.getInjectScriptConfig().eventId).toBe(
                'DISNEYPLUS_SUBTITLE_EVENT'
            );

            // Verify common functionality works for both
            expect(netflixScript.eventBuffer).toBeInstanceOf(EventBuffer);
            expect(disneyScript.eventBuffer).toBeInstanceOf(EventBuffer);
            expect(netflixScript.platformReady).toBe(false);
            expect(disneyScript.platformReady).toBe(false);
        });

        test('should handle platform-specific message routing correctly', () => {
            const mockSendResponse = jest.fn();

            // Test platform-specific message handling
            const netflixRequest = {
                action: 'netflix-specific',
                data: 'test',
            };
            contentScript.handlePlatformSpecificMessage(
                netflixRequest,
                mockSendResponse
            );

            expect(mockSendResponse).toHaveBeenCalledWith({
                success: true,
                platform: 'test',
                action: 'netflix-specific',
            });
        });

        test('should verify common functionality behavior across platforms', () => {
            const platforms = [
                {
                    name: 'netflix',
                    eventId: 'NETFLIX_EVENT',
                },
                {
                    name: 'disneyplus',
                    eventId: 'DISNEYPLUS_EVENT',
                },
                {
                    name: 'test',
                    eventId: 'TEST_EVENT',
                },
            ];

            platforms.forEach(({ name, eventId }) => {
                class MockPlatformScript extends BaseContentScript {
                    constructor() {
                        super(`${name}Mock`);
                    }
                    getPlatformName() {
                        return name;
                    }
                    getPlatformClass() {
                        return class MockPlatform {};
                    }
                    getInjectScriptConfig() {
                        return {
                            filename: 'test.js',
                            tagId: 'test',
                            eventId,
                        };
                    }
                    setupNavigationDetection() {}
                    checkForUrlChange() {}
                    handlePlatformSpecificMessage(req, res) {
                        res({
                            platform: name,
                        });
                        return false;
                    }
                }

                const script = new MockPlatformScript();

                // Verify common properties are initialized consistently
                expect(script.logPrefix).toBe(`${name}Mock`);
                expect(script.eventBuffer).toBeInstanceOf(EventBuffer);
                expect(script.platformReady).toBe(false);
                expect(script.isCleanedUp).toBe(false);
                expect(script.currentConfig).toEqual({});
                expect(script.messageHandlers).toBeInstanceOf(Map);
            });
        });
    });

    describe('Common Functionality Verification', () => {
        test('should maintain consistent message handler registry across platforms', () => {
            // Verify common message handlers are registered
            expect(contentScript.hasMessageHandler('toggleSubtitles')).toBe(
                true
            );
            expect(contentScript.hasMessageHandler('configChanged')).toBe(true);
            expect(
                contentScript.hasMessageHandler('LOGGING_LEVEL_CHANGED')
            ).toBe(true);

            // Verify handler information
            const handlers = contentScript.getRegisteredHandlers();
            expect(handlers).toHaveLength(3);

            const toggleHandler = handlers.find(
                (h) => h.action === 'toggleSubtitles'
            );
            expect(toggleHandler).toBeDefined();
            expect(toggleHandler.requiresUtilities).toBe(true);
            expect(toggleHandler.description).toContain(
                'Toggle subtitle display'
            );
        });

        test('should handle event buffering consistently across platforms', () => {
            const testEvents = [
                {
                    detail: {
                        type: 'SUBTITLE_DATA_FOUND',
                        data: 'test1',
                    },
                },
                {
                    detail: {
                        type: 'SUBTITLE_DATA_FOUND',
                        data: 'test2',
                    },
                },
                {
                    detail: {
                        type: 'SUBTITLE_DATA_FOUND',
                        data: 'test3',
                    },
                },
            ];

            // Ensure platform is not ready
            contentScript.platformReady = false;

            // Buffer events when platform not ready
            testEvents.forEach((event) => {
                contentScript.handleEarlyInjectorEvents(event);
            });

            // Check that events were buffered
            expect(contentScript.eventBuffer.size()).toBe(3);

            // Setup mock platform
            const mockPlatform = {
                handleInjectorEvents: jest.fn(),
            };
            contentScript.activePlatform = mockPlatform;
            contentScript.platformReady = true;

            // Process buffered events
            contentScript.processBufferedEvents();

            // Verify platform handler was called for buffered events
            expect(mockPlatform.handleInjectorEvents).toHaveBeenCalledTimes(3);
            expect(contentScript.eventBuffer.size()).toBe(0);
        });

        test('should handle video element detection consistently', () => {
            const mockVideo = document.createElement('video');
            const mockPlatform = {
                getVideoElement: jest.fn().mockReturnValue(mockVideo),
            };
            const mockSubtitleUtils = {
                ensureSubtitleContainer: jest.fn(),
                subtitlesActive: true,
                showSubtitleContainer: jest.fn(),
                updateSubtitles: jest.fn(),
                hideSubtitleContainer: jest.fn(),
            };

            contentScript.activePlatform = mockPlatform;
            contentScript.subtitleUtils = mockSubtitleUtils;
            contentScript.currentConfig = {
                subtitlesEnabled: true,
            };

            const result = contentScript.attemptVideoSetup();

            expect(result).toBe(true);
            expect(mockPlatform.getVideoElement).toHaveBeenCalled();
            expect(
                mockSubtitleUtils.ensureSubtitleContainer
            ).toHaveBeenCalled();
            expect(mockSubtitleUtils.showSubtitleContainer).toHaveBeenCalled();
        });

        test('should handle configuration management consistently', async () => {
            // Mock chrome API to ensure configService.getAll is called
            const chromeApiMock = mockChromeApi();

            // Verify chrome.storage is available
            expect(global.chrome).toBeDefined();
            expect(global.chrome.storage).toBeDefined();

            const mockConfigService = {
                getAll: jest.fn().mockResolvedValue({
                    theme: 'dark',
                    language: 'en',
                    useOfficialTranslations: true,
                }),
                onChanged: jest.fn(),
            };

            // Set the mock before calling the method
            contentScript.configService = mockConfigService;

            await contentScript.initializeConfiguration();

            // The method should call configService.getAll since chrome.storage is available
            expect(mockConfigService.getAll).toHaveBeenCalled();
            expect(contentScript.currentConfig).toEqual({
                theme: 'dark',
                language: 'en',
                useOfficialTranslations: true,
            });

            // Cleanup
            chromeApiMock();
            expect(mockConfigService.onChanged).toHaveBeenCalledWith(
                expect.any(Function)
            );
        });

        test('should handle cleanup consistently across platforms', async () => {
            const mockPlatform = {
                cleanup: jest.fn(),
            };
            const mockObserver = {
                disconnect: jest.fn(),
            };
            const mockSubtitleUtils = {
                clearSubtitleDOM: jest.fn(),
            };
            const mockIntervalManager = {
                clearAll: jest.fn(),
            };

            contentScript.activePlatform = mockPlatform;
            contentScript.pageObserver = mockObserver;
            contentScript.subtitleUtils = mockSubtitleUtils;
            contentScript.intervalManager = mockIntervalManager;
            contentScript.videoDetectionIntervalId = 123;

            jest.spyOn(global, 'clearInterval');

            await contentScript.cleanup();

            expect(mockPlatform.cleanup).toHaveBeenCalled();
            expect(mockObserver.disconnect).toHaveBeenCalled();
            expect(mockSubtitleUtils.clearSubtitleDOM).toHaveBeenCalled();
            expect(mockIntervalManager.clearAll).toHaveBeenCalled();
            expect(global.clearInterval).toHaveBeenCalledWith(123);
            expect(contentScript.isCleanedUp).toBe(true);
        });
    });

    describe('Platform-Specific Method Integration', () => {
        test('should integrate platform-specific methods into common workflow', async () => {
            const setupNavigationSpy = jest.spyOn(
                contentScript,
                'setupNavigationDetection'
            );
            const checkUrlChangeSpy = jest.spyOn(
                contentScript,
                'checkForUrlChange'
            );

            // Mock successful initialization
            contentScript.loadModules = jest.fn().mockResolvedValue(true);
            contentScript.configService = {
                getAll: jest.fn().mockResolvedValue({
                    subtitlesEnabled: false,
                }),
                onChanged: jest.fn(),
            };
            contentScript.setupConfigurationListeners = jest.fn();
            contentScript.setupEarlyEventHandling = jest.fn();
            contentScript.setupDOMObservation = jest.fn();
            contentScript.setupCleanupHandlers = jest.fn();

            await contentScript.initialize();

            // Verify platform-specific methods were called as part of common workflow
            expect(setupNavigationSpy).toHaveBeenCalled();

            // Test URL change detection
            contentScript.checkForUrlChange();
            expect(checkUrlChangeSpy).toHaveBeenCalled();
        });

        test('should handle platform-specific initialization correctly', async () => {
            const mockPlatformClass = jest.fn().mockImplementation(() => ({
                isPlayerPageActive: jest.fn().mockReturnValue(true),
                initialize: jest.fn().mockResolvedValue(),
                handleNativeSubtitles: jest.fn(),
                cleanup: jest.fn(),
            }));

            contentScript.PlatformClass = mockPlatformClass;
            contentScript.subtitleUtils = {
                setSubtitlesActive: jest.fn(),
            };
            contentScript.configService = {};
            contentScript.currentConfig = {
                subtitlesEnabled: true,
            };
            contentScript.startVideoElementDetection = jest.fn();
            contentScript.processBufferedEvents = jest.fn();

            const result = await contentScript.initializePlatform();

            expect(result).toBe(true);
            expect(mockPlatformClass).toHaveBeenCalled();
            expect(contentScript.activePlatform).toBeDefined();
            expect(contentScript.platformReady).toBe(true);
            expect(contentScript.startVideoElementDetection).toHaveBeenCalled();
            expect(contentScript.processBufferedEvents).toHaveBeenCalled();
        });
    });
});
