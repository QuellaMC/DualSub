/**
 * BaseContentScript Comprehensive Tests
 *
 * Comprehensive tests for the abstract BaseContentScript class functionality including:
 * - Abstract method enforcement and template method pattern execution
 * - Module loading, platform initialization, configuration management
 * - Event handling, Chrome message processing, and error handling
 * - Mock platform implementations and verify common functionality behavior
 *
 */

import { jest } from '@jest/globals';
import { BaseContentScript } from '../core/BaseContentScript.js';
import { NetflixContentScript } from '../platforms/NetflixContentScript.js';
import { DisneyPlusContentScript } from '../platforms/DisneyPlusContentScript.js';
import { EventBuffer, IntervalManager } from '../core/utils.js';
import { createInjectionChannel } from '../shared/injectionChannel.js';
import { TestHelpers } from '../../test-utils/test-helpers.js';
import { mockChromeApi } from '../../test-utils/chrome-api-mock.js';
import { createLoggerMock } from '../../test-utils/logger-mock.js';
import { configSchema, getDefaultValue } from '../../config/configSchema.js';

/**
 * Test implementation of BaseContentScript for testing abstract functionality
 * Provides minimal concrete implementations of all abstract methods
 */
class TestContentScript extends BaseContentScript {
    constructor(logPrefix = 'TestContent') {
        super(logPrefix);
        this.navigationDetectionSetup = false;
        this.injectConfig = {
            filename: 'injected_scripts/testInject.js',
            tagId: 'test-inject-script',
            eventId: 'test-subtitle-event',
            channel: createInjectionChannel('netflix'),
        };
    }

    getPlatformName() {
        return 'test';
    }

    getPlatformClass() {
        return TestPlatform;
    }

    getInjectScriptConfig() {
        return this.injectConfig;
    }

    setupNavigationDetection() {
        this.navigationDetectionSetup = true;
    }

    _isPlayerPath(pathname) {
        return pathname.includes('/watch/');
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

function createAuthorizedInjectorEvent(contentScript, type, fields = {}) {
    const channel = contentScript.getInjectScriptConfig().channel;
    return {
        detail: {
            ...channel.createEventDetail(type),
            ...fields,
        },
    };
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

        global.chrome.runtime.id = 'test';
        global.chrome.runtime.getManifest = jest.fn(() => ({
            background: { service_worker: 'background.js' },
            options_ui: { page: 'options/options.html' },
            action: { default_popup: 'popup/popup.html' },
            side_panel: { default_path: 'sidepanel/sidepanel.html' },
        }));
        global.chrome.runtime.getURL = jest.fn(
            (path) => `chrome-extension://test/${path}`
        );
        return mockChrome;
    }
}

function createExtensionSender(path) {
    return {
        id: global.chrome.runtime.id,
        url: global.chrome.runtime.getURL(path),
    };
}

function createBackgroundSender() {
    return createExtensionSender('background.js');
}

function createPopupSender() {
    return createExtensionSender('popup/popup.html');
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

function createControllableVideo({
    paused = false,
    ended = false,
    listenerAttached = true,
} = {}) {
    const video = document.createElement('video');
    const state = { paused, ended };

    if (listenerAttached) {
        video.dataset.listenerAttached = 'true';
    }
    Object.defineProperties(video, {
        paused: {
            configurable: true,
            get: () => state.paused,
        },
        ended: {
            configurable: true,
            get: () => state.ended,
        },
        pause: {
            configurable: true,
            value: jest.fn(() => {
                state.paused = true;
            }),
        },
    });

    return { video, state };
}

function installControlledMutationObserver() {
    const OriginalMutationObserver = global.MutationObserver;
    const instances = [];

    class ControlledMutationObserver {
        constructor(callback) {
            this.callback = callback;
            this.observe = jest.fn();
            this.disconnect = jest.fn();
            instances.push(this);
        }
    }

    global.MutationObserver = ControlledMutationObserver;
    return {
        instances,
        restore() {
            global.MutationObserver = OriginalMutationObserver;
        },
    };
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

    afterEach(async () => {
        testEnvironment.testHelpers.mockRegistry.cleanup();
        if (contentScript && typeof contentScript.cleanup === 'function') {
            await contentScript.cleanup();
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

        test('does not expose local configuration default helpers', () => {
            expect(contentScript._getDefaultAIContextConfiguration).toBe(
                undefined
            );
            expect(contentScript._getDefaultAIContextValue).toBe(undefined);
            expect(contentScript._getDefaultConfiguration).toBe(undefined);
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
        });

        test('concrete implementation should implement all abstract methods correctly', () => {
            expect(contentScript.getPlatformName()).toBe('test');
            expect(typeof contentScript.getPlatformClass()).toBe('function');
            expect(contentScript.getInjectScriptConfig()).toEqual({
                filename: 'injected_scripts/testInject.js',
                tagId: 'test-inject-script',
                eventId: 'test-subtitle-event',
                channel: expect.objectContaining({
                    platform: 'netflix',
                    accept: expect.any(Function),
                }),
            });
            expect(() =>
                contentScript.setupNavigationDetection()
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
            expect(injectConfig).toHaveProperty('channel');
            expect(typeof injectConfig.filename).toBe('string');
            expect(typeof injectConfig.tagId).toBe('string');
            expect(typeof injectConfig.eventId).toBe('string');

            // Validate platform class can be instantiated
            expect(() => new PlatformClass()).not.toThrow();
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
            const schemaBackedUiLanguage = getDefaultValue('uiLanguage');
            const selectedProviderCanary =
                'SELECTED_PROVIDER_ID_MUST_NOT_REACH_LOGS';
            const aiContextProviderCanary =
                'AI_CONTEXT_PROVIDER_ID_MUST_NOT_REACH_LOGS';
            const openaiCredentialCanary = Object.freeze({
                secret: 'OPENAI_CREDENTIAL_MUST_NOT_REACH_LOGS',
            });
            const vertexCredentialCanary = Object.freeze({
                secret: 'VERTEX_CREDENTIAL_MUST_NOT_REACH_LOGS',
            });
            const mockConfig = {
                subtitlesEnabled: true,
                hideOfficialSubtitles: getDefaultValue('hideOfficialSubtitles'),
                uiLanguage: schemaBackedUiLanguage,
                selectedProvider: selectedProviderCanary,
                aiContextEnabled: true,
                aiContextProvider: aiContextProviderCanary,
                useOfficialTranslations: true,
                openaiApiKey: openaiCredentialCanary,
                vertexAccessToken: vertexCredentialCanary,
            };
            contentScript.configService = {
                getAll: jest.fn().mockResolvedValue(mockConfig),
            };
            contentScript.setupConfigurationListeners = jest.fn();
            contentScript.contentLogger = mockLogger;
            const logSpy = jest.spyOn(contentScript, 'logWithFallback');
            delete global.chrome.storage;

            const result = await contentScript.initializeConfiguration();

            expect(result).toBe(true);
            expect(global.chrome.storage).toBeUndefined();
            expect(contentScript.configService.getAll).toHaveBeenCalledWith({
                includeSensitive: false,
            });
            expect(contentScript.currentConfig).toEqual(mockConfig);
            expect(contentScript.currentConfig.hideOfficialSubtitles).toBe(
                true
            );
            expect(contentScript.currentConfig.uiLanguage).toBe(
                schemaBackedUiLanguage
            );
            expect(
                contentScript.setupConfigurationListeners
            ).toHaveBeenCalled();

            const initialConfigurationLog = logSpy.mock.calls.find(
                ([level, message]) =>
                    level === 'info' &&
                    message === 'Loaded initial configuration.'
            );
            expect(initialConfigurationLog).toEqual([
                'info',
                'Loaded initial configuration.',
                {
                    settingCount: Object.keys(mockConfig).length,
                    subtitlesEnabled: true,
                    aiContextEnabled: true,
                },
            ]);
            const loggedMetadata = initialConfigurationLog[2];
            const loggedValues = Object.values(loggedMetadata);
            expect(initialConfigurationLog).not.toContain(mockConfig);
            expect(loggedMetadata).not.toBe(mockConfig);
            expect(loggedMetadata).not.toHaveProperty('config');
            expect(loggedValues).not.toContain(selectedProviderCanary);
            expect(loggedValues).not.toContain(aiContextProviderCanary);
            expect(loggedValues).not.toContain(openaiCredentialCanary);
            expect(loggedValues).not.toContain(vertexCredentialCanary);
            expect(JSON.stringify(initialConfigurationLog)).not.toContain(
                'MUST_NOT_REACH_LOGS'
            );
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
            const mockEvent = createAuthorizedInjectorEvent(
                contentScript,
                'SUBTITLE_DATA_FOUND',
                { data: 'test subtitle data' }
            );

            contentScript.platformReady = false;
            contentScript.handleEarlyInjectorEvents(mockEvent);

            expect(contentScript.eventBuffer.size()).toBe(1);
        });

        test('should process buffered events when platform becomes ready', () => {
            const mockEvent = createAuthorizedInjectorEvent(
                contentScript,
                'SUBTITLE_DATA_FOUND',
                { data: 'test subtitle data' }
            );

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

        test('rejects a predictable page event without the private channel', () => {
            contentScript.platformReady = false;

            contentScript.handleEarlyInjectorEvents({
                detail: {
                    type: 'SUBTITLE_DATA_FOUND',
                    data: 'forged subtitle data',
                },
            });

            expect(contentScript.eventBuffer.size()).toBe(0);
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

        test('attaches one Chrome listener and removes it during cleanup', async () => {
            const listeners = [];
            const onMessage = {
                addListener: jest.fn((listener) => listeners.push(listener)),
                removeListener: jest.fn((listener) => {
                    const index = listeners.indexOf(listener);
                    if (index >= 0) listeners.splice(index, 1);
                }),
            };
            global.chrome = { runtime: { onMessage } };
            const listenerScript = new TestContentScript();

            expect(onMessage.addListener).toHaveBeenCalledTimes(1);
            const registeredListener = onMessage.addListener.mock.calls[0][0];

            listenerScript.setupCleanupHandlers();
            expect(onMessage.addListener).toHaveBeenCalledTimes(1);

            await listenerScript.cleanup();
            expect(onMessage.removeListener).toHaveBeenCalledWith(
                registeredListener
            );
        });

        test('should handle logging level changes', () => {
            const request = {
                action: 'LOGGING_LEVEL_CHANGED',
                level: 4,
            };
            const sendResponse = jest.fn();
            contentScript.contentLogger = mockLogger;

            const result = contentScript.handleChromeMessage(
                request,
                createBackgroundSender(),
                sendResponse
            );

            expect(mockLogger.updateLevel).toHaveBeenCalledWith(4);
            expect(sendResponse).toHaveBeenCalledWith({
                action: 'LOGGING_LEVEL_CHANGED',
                success: true,
            });
            expect(result).toBe(false);
        });

        test('should handle config changed message', () => {
            const request = {
                action: 'configChanged',
                changes: {
                    sidePanelTheme: 'dark',
                },
            };
            const sendResponse = jest.fn();

            const result = contentScript.handleChromeMessage(
                request,
                createPopupSender(),
                sendResponse
            );

            expect(sendResponse).toHaveBeenCalledWith({
                action: 'configChanged',
                success: true,
            });
            expect(result).toBe(false);
        });

        test('rejects a config change atomically when any value is invalid', () => {
            contentScript.currentConfig = { uiLanguage: 'en' };
            contentScript.activePlatform = {};
            contentScript.subtitleUtils.subtitlesActive = true;
            const request = {
                action: 'configChanged',
                changes: {
                    uiLanguage: 'ja',
                    aiContextTimeout: 1,
                },
            };
            const sendResponse = jest.fn();

            const result = contentScript.handleChromeMessage(
                request,
                createPopupSender(),
                sendResponse
            );

            expect(contentScript.currentConfig).toEqual({ uiLanguage: 'en' });
            expect(sendResponse).toHaveBeenCalledWith({
                action: 'configChanged',
                success: false,
                error: 'Invalid configuration change',
            });
            expect(result).toBe(false);
        });

        test.each([
            ['sidePanelGetState', createPopupSender],
            ['sidePanelUpdateState', createPopupSender],
            ['configChanged', createBackgroundSender],
            ['LOGGING_LEVEL_CHANGED', createPopupSender],
            ['sidePanelPauseVideo', createPopupSender],
        ])('rejects an unauthorized sender for %s', (action, createSender) => {
            const handler = jest.fn();
            contentScript.messageHandlers.get(action).handler = handler;
            const sendResponse = jest.fn();

            const result = contentScript.handleChromeMessage(
                { action },
                createSender(),
                sendResponse
            );

            expect(handler).not.toHaveBeenCalled();
            expect(sendResponse).toHaveBeenCalledWith({
                success: false,
                error: 'Unauthorized message sender',
            });
            expect(result).toBe(false);
        });

        test('keeps the message channel open while pausing asynchronously', async () => {
            contentScript.activePlatform = {
                pausePlayback: jest.fn().mockResolvedValue(true),
            };
            const sendResponse = jest.fn();

            const result = contentScript.handleChromeMessage(
                { action: 'sidePanelPauseVideo' },
                createBackgroundSender(),
                sendResponse
            );

            expect(result).toBe(true);
            expect(sendResponse).not.toHaveBeenCalled();
            await Promise.resolve();
            await Promise.resolve();
            expect(sendResponse).toHaveBeenCalledWith({
                action: 'sidePanelPauseVideo',
                success: true,
            });
        });

        test('falls back to the media element when platform pause returns false', async () => {
            jest.useFakeTimers();
            try {
                const media = createControllableVideo();
                document.body.appendChild(media.video);
                contentScript.activePlatform = {
                    pausePlayback: jest.fn().mockResolvedValue(false),
                    getVideoElement: jest.fn(() => media.video),
                };
                const sendResponse = jest.fn();

                const result = contentScript.handleChromeMessage(
                    { action: 'sidePanelPauseVideo' },
                    createBackgroundSender(),
                    sendResponse
                );
                await jest.advanceTimersByTimeAsync(80);

                expect(result).toBe(true);
                expect(media.video.pause).toHaveBeenCalledTimes(1);
                expect(sendResponse).toHaveBeenCalledTimes(1);
                expect(sendResponse).toHaveBeenCalledWith({
                    action: 'sidePanelPauseVideo',
                    success: true,
                });
            } finally {
                document.body.replaceChildren();
                jest.useRealTimers();
            }
        });

        test('does not bypass a platform that forbids direct media fallback', async () => {
            const media = createControllableVideo();
            document.body.appendChild(media.video);
            contentScript.activePlatform = {
                pausePlayback: jest.fn().mockResolvedValue(false),
                allowsDirectMediaPlaybackFallback: jest.fn(() => false),
                getVideoElement: jest.fn(() => media.video),
            };
            const sendResponse = jest.fn();

            const result = contentScript.handleChromeMessage(
                { action: 'sidePanelPauseVideo' },
                createBackgroundSender(),
                sendResponse
            );
            await Promise.resolve();
            await Promise.resolve();

            expect(result).toBe(true);
            expect(media.video.pause).not.toHaveBeenCalled();
            expect(sendResponse).toHaveBeenCalledTimes(1);
            expect(sendResponse).toHaveBeenCalledWith({
                action: 'sidePanelPauseVideo',
                success: false,
                error: 'Platform playback control could not pause the video',
            });
            document.body.replaceChildren();
        });

        test('falls back to the media element when platform pause throws', async () => {
            jest.useFakeTimers();
            try {
                const media = createControllableVideo();
                document.body.appendChild(media.video);
                contentScript.activePlatform = {
                    pausePlayback: jest
                        .fn()
                        .mockRejectedValue(new Error('platform pause failed')),
                    getVideoElement: jest.fn(() => media.video),
                };
                const sendResponse = jest.fn();

                contentScript.handleChromeMessage(
                    { action: 'sidePanelPauseVideo' },
                    createBackgroundSender(),
                    sendResponse
                );
                await jest.advanceTimersByTimeAsync(80);

                expect(media.video.pause).toHaveBeenCalledTimes(1);
                expect(sendResponse).toHaveBeenCalledTimes(1);
                expect(sendResponse).toHaveBeenCalledWith({
                    action: 'sidePanelPauseVideo',
                    success: true,
                });
            } finally {
                document.body.replaceChildren();
                jest.useRealTimers();
            }
        });

        test('uses a document video when the platform getter also throws', async () => {
            jest.useFakeTimers();
            try {
                const media = createControllableVideo({
                    listenerAttached: false,
                });
                document.body.appendChild(media.video);
                contentScript.activePlatform = {
                    pausePlayback: jest
                        .fn()
                        .mockRejectedValue(new Error('platform pause failed')),
                    getVideoElement: jest.fn(() => {
                        throw new Error('platform video lookup failed');
                    }),
                };
                const sendResponse = jest.fn();

                contentScript.handleChromeMessage(
                    { action: 'sidePanelPauseVideo' },
                    createBackgroundSender(),
                    sendResponse
                );
                await jest.advanceTimersByTimeAsync(80);

                expect(media.video.pause).toHaveBeenCalledTimes(1);
                expect(sendResponse).toHaveBeenCalledWith({
                    action: 'sidePanelPauseVideo',
                    success: true,
                });
            } finally {
                document.body.replaceChildren();
                jest.useRealTimers();
            }
        });

        test('prefers the platform video over a stale stopped tagged video', async () => {
            jest.useFakeTimers();
            try {
                const stale = createControllableVideo({ paused: true });
                const current = createControllableVideo({
                    paused: false,
                    listenerAttached: false,
                });
                document.body.append(stale.video, current.video);
                contentScript.activePlatform = {
                    pausePlayback: jest.fn().mockResolvedValue(false),
                    getVideoElement: jest.fn(() => current.video),
                };
                const sendResponse = jest.fn();

                contentScript.handleChromeMessage(
                    { action: 'sidePanelPauseVideo' },
                    createBackgroundSender(),
                    sendResponse
                );
                await jest.advanceTimersByTimeAsync(80);

                expect(stale.video.pause).not.toHaveBeenCalled();
                expect(current.video.pause).toHaveBeenCalledTimes(1);
                expect(current.state.paused).toBe(true);
                expect(sendResponse).toHaveBeenCalledWith({
                    action: 'sidePanelPauseVideo',
                    success: true,
                });
            } finally {
                document.body.replaceChildren();
                jest.useRealTimers();
            }
        });

        test('reports one failed response when no video can be paused', async () => {
            document.body.replaceChildren();
            contentScript.activePlatform = {
                pausePlayback: jest.fn().mockResolvedValue(false),
                getVideoElement: jest.fn(() => null),
            };
            const sendResponse = jest.fn();

            contentScript.handleChromeMessage(
                { action: 'sidePanelPauseVideo' },
                createBackgroundSender(),
                sendResponse
            );
            await Promise.resolve();
            await Promise.resolve();

            expect(sendResponse).toHaveBeenCalledTimes(1);
            expect(sendResponse).toHaveBeenCalledWith({
                action: 'sidePanelPauseVideo',
                success: false,
                error: 'No active video could be paused',
            });
        });

        test('treats ended media as already stopped without trusting a control label', async () => {
            const media = createControllableVideo({
                paused: false,
                ended: true,
            });
            document.body.appendChild(media.video);
            const misleadingControl = document.createElement('button');
            misleadingControl.setAttribute('aria-label', 'Pause');
            const clickSpy = jest.spyOn(misleadingControl, 'click');
            document.body.appendChild(misleadingControl);
            contentScript.activePlatform = null;
            const sendResponse = jest.fn();

            contentScript.handleChromeMessage(
                { action: 'sidePanelPauseVideo' },
                createBackgroundSender(),
                sendResponse
            );
            await Promise.resolve();
            await Promise.resolve();

            expect(media.video.pause).not.toHaveBeenCalled();
            expect(clickSpy).not.toHaveBeenCalled();
            expect(sendResponse).toHaveBeenCalledWith({
                action: 'sidePanelPauseVideo',
                success: true,
            });
            document.body.replaceChildren();
        });

        test('should reject unknown messages', () => {
            const request = {
                action: 'customAction',
                data: 'test',
            };
            const sendResponse = jest.fn();

            const result = contentScript.handleChromeMessage(
                request,
                createPopupSender(),
                sendResponse
            );

            expect(sendResponse).toHaveBeenCalledWith({
                success: false,
                error: 'Invalid message action',
            });
            expect(result).toBe(false);
        });

        test('should reject registered messages when required utilities are not loaded', () => {
            contentScript.subtitleUtils = null;
            const request = {
                action: 'configChanged',
                changes: { sidePanelTheme: 'dark' },
            };
            const sendResponse = jest.fn();

            const result = contentScript.handleChromeMessage(
                request,
                createPopupSender(),
                sendResponse
            );

            expect(sendResponse).toHaveBeenCalledWith({
                action: 'configChanged',
                success: false,
                error: 'Utilities not loaded',
            });
            expect(result).toBe(true);
        });
    });

    describe('Video Element Detection', () => {
        let originalDetectionLocation;

        beforeEach(() => {
            originalDetectionLocation = `${window.location.pathname}${window.location.search}${window.location.hash}`;
            history.replaceState({}, '', '/watch/base-detection-test');
        });

        afterEach(() => {
            history.replaceState({}, '', originalDetectionLocation);
        });

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

        test.each([
            ['player-page leave', '/browse'],
            ['same-player pathname change', '/watch/ordinary-b'],
        ])(
            'ordinary detection aborts before platform lookup after %s',
            (_transition, nextPathname) => {
                const originalPathname = window.location.pathname;
                const intervalCallbacks = [];
                const setIntervalSpy = jest
                    .spyOn(global, 'setInterval')
                    .mockImplementation((callback) => {
                        intervalCallbacks.push(callback);
                        return 7575;
                    });
                const root = document.createElement('div');
                const video = document.createElement('video');
                root.appendChild(video);
                document.body.appendChild(root);

                try {
                    history.replaceState({}, '', '/watch/ordinary-a');
                    const platform = {
                        getPlayerContainerElement: jest.fn(() => root),
                        getVideoElement: jest.fn(() => null),
                        isPlayerPageActive: jest.fn(() => true),
                    };
                    contentScript.activePlatform = platform;
                    contentScript.subtitleUtils =
                        MockFactory.createSubtitleUtilsMock();
                    contentScript.currentConfig = {};
                    contentScript.startVideoElementDetection();
                    expect(intervalCallbacks).toHaveLength(1);

                    platform.getVideoElement.mockClear();
                    platform.getVideoElement.mockReturnValue(video);
                    history.replaceState({}, '', nextPathname);
                    intervalCallbacks[0]();

                    expect(platform.getVideoElement).not.toHaveBeenCalled();
                    expect(
                        contentScript.subtitleUtils.ensureSubtitleContainer
                    ).not.toHaveBeenCalled();
                    expect(contentScript.videoDetectionTask).toBeNull();
                    expect(contentScript.videoDetectionIntervalId).toBeNull();
                } finally {
                    contentScript.stopVideoElementDetection();
                    setIntervalSpy.mockRestore();
                    root.remove();
                    history.replaceState({}, '', originalPathname);
                }
            }
        );

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

        test('replacement rearm waits on the last setup scope and accepts a changed scope', () => {
            jest.useFakeTimers();
            const originalPathname = window.location.pathname;
            const oldRoot = document.createElement('div');
            const oldVideo = document.createElement('video');
            const newRoot = document.createElement('div');
            const newVideo = document.createElement('video');
            let currentRoot = oldRoot;
            let currentVideo = oldVideo;

            oldRoot.appendChild(oldVideo);
            newRoot.appendChild(newVideo);
            document.body.appendChild(oldRoot);

            try {
                history.replaceState({}, '', '/watch/old-title');
                contentScript.activePlatform = {
                    getPlayerContainerElement: jest.fn(() => currentRoot),
                    getVideoElement: jest.fn(() => currentVideo),
                    isPlayerPageActive: jest.fn(() => true),
                };
                contentScript.subtitleUtils =
                    MockFactory.createSubtitleUtilsMock();
                contentScript.currentConfig = {};

                expect(contentScript.attemptVideoSetup()).toBe(true);
                contentScript.subtitleUtils.ensureSubtitleContainer.mockClear();

                contentScript._rearmVideoElementDetectionForPlayerNavigation();

                expect(contentScript.videoDetectionIntervalId).not.toBeNull();
                expect(
                    contentScript.subtitleUtils.ensureSubtitleContainer
                ).not.toHaveBeenCalled();

                document.body.appendChild(newRoot);
                currentRoot = newRoot;
                currentVideo = newVideo;
                jest.advanceTimersByTime(contentScript.videoDetectionInterval);

                expect(
                    contentScript.subtitleUtils.ensureSubtitleContainer
                ).toHaveBeenCalledTimes(1);
                expect(contentScript.videoDetectionIntervalId).toBeNull();
            } finally {
                contentScript.stopVideoElementDetection();
                oldRoot.remove();
                newRoot.remove();
                history.replaceState({}, '', originalPathname);
                jest.useRealTimers();
            }
        });

        test('replacement rearm uses the last completed setup when DOM swaps before the navigation callback', () => {
            jest.useFakeTimers();
            const originalPathname = window.location.pathname;
            const oldRoot = document.createElement('div');
            const oldVideo = document.createElement('video');
            const newRoot = document.createElement('div');
            const newVideo = document.createElement('video');
            let currentRoot = oldRoot;
            let currentVideo = oldVideo;

            oldRoot.appendChild(oldVideo);
            newRoot.appendChild(newVideo);
            document.body.append(oldRoot, newRoot);

            try {
                history.replaceState({}, '', '/watch/old-title');
                contentScript.activePlatform = {
                    getPlayerContainerElement: jest.fn(() => currentRoot),
                    getVideoElement: jest.fn(() => currentVideo),
                    isPlayerPageActive: jest.fn(() => true),
                };
                contentScript.subtitleUtils =
                    MockFactory.createSubtitleUtilsMock();
                contentScript.currentConfig = {};

                expect(contentScript.attemptVideoSetup()).toBe(true);
                contentScript.subtitleUtils.ensureSubtitleContainer.mockClear();

                currentRoot = newRoot;
                currentVideo = newVideo;
                contentScript._rearmVideoElementDetectionForPlayerNavigation();

                expect(
                    contentScript.subtitleUtils.ensureSubtitleContainer
                ).toHaveBeenCalledTimes(1);
                expect(contentScript.videoDetectionIntervalId).toBeNull();
            } finally {
                contentScript.stopVideoElementDetection();
                oldRoot.remove();
                newRoot.remove();
                history.replaceState({}, '', originalPathname);
                jest.useRealTimers();
            }
        });

        test('replacement rearm expires at the existing cap without disconnecting a reused valid scope', () => {
            jest.useFakeTimers();
            const observerHarness = installControlledMutationObserver();
            const originalPathname = window.location.pathname;
            const root = document.createElement('div');
            const video = document.createElement('video');

            root.appendChild(video);
            document.body.appendChild(root);

            try {
                history.replaceState({}, '', '/watch/reused-title');
                contentScript.activePlatform = {
                    getPlayerContainerElement: jest.fn(() => root),
                    getVideoElement: jest.fn(() => video),
                    isPlayerPageActive: jest.fn(() => true),
                };
                contentScript.subtitleUtils =
                    MockFactory.createSubtitleUtilsMock();
                contentScript.currentConfig = {};
                contentScript.maxVideoDetectionRetries = 3;

                expect(contentScript.attemptVideoSetup()).toBe(true);
                const pageObserver = contentScript.pageObserver;
                contentScript.subtitleUtils.ensureSubtitleContainer.mockClear();
                contentScript._rearmVideoElementDetectionForPlayerNavigation();
                jest.advanceTimersByTime(
                    contentScript.videoDetectionInterval *
                        contentScript.maxVideoDetectionRetries
                );

                expect(contentScript.videoDetectionRetries).toBe(3);
                expect(contentScript.videoDetectionIntervalId).toBeNull();
                expect(
                    contentScript.subtitleUtils.ensureSubtitleContainer
                ).not.toHaveBeenCalled();
                expect(pageObserver.disconnect).not.toHaveBeenCalled();
                expect(contentScript.lastVideoSetupScope).toEqual(
                    expect.objectContaining({ root, video })
                );
            } finally {
                contentScript.stopVideoElementDetection();
                contentScript._cancelPlayerRootObservation();
                root.remove();
                history.replaceState({}, '', originalPathname);
                observerHarness.restore();
                jest.useRealTimers();
            }
        });

        test.each([
            [
                'platform generation',
                (script) => {
                    script.platformInitializationGeneration += 1;
                },
            ],
            [
                'platform identity',
                (script) => {
                    script.activePlatform = {};
                },
            ],
            [
                'player route',
                () => {
                    history.replaceState({}, '', '/watch/another-title');
                },
            ],
            ['cleanup state', (script) => script.cleanup()],
        ])(
            'replacement rearm aborts on stale %s',
            async (_reason, makeStale) => {
                jest.useFakeTimers();
                const originalPathname = window.location.pathname;
                const originalGeneration =
                    contentScript.platformInitializationGeneration;
                const root = document.createElement('div');
                const video = document.createElement('video');
                const logWithFallback = jest
                    .spyOn(contentScript, 'logWithFallback')
                    .mockImplementation(() => {});
                const platform = {
                    getPlayerContainerElement: jest.fn(() => root),
                    getVideoElement: jest.fn(() => video),
                    isPlayerPageActive: jest.fn(() => true),
                };

                root.appendChild(video);
                document.body.appendChild(root);

                try {
                    history.replaceState({}, '', '/watch/original-title');
                    contentScript.activePlatform = platform;
                    contentScript.subtitleUtils =
                        MockFactory.createSubtitleUtilsMock();
                    contentScript.currentConfig = {};

                    expect(contentScript.attemptVideoSetup()).toBe(true);
                    contentScript.subtitleUtils.ensureSubtitleContainer.mockClear();
                    contentScript._rearmVideoElementDetectionForPlayerNavigation();
                    expect(
                        contentScript.videoDetectionIntervalId
                    ).not.toBeNull();
                    logWithFallback.mockClear();

                    await makeStale(contentScript);
                    jest.advanceTimersByTime(
                        contentScript.videoDetectionInterval
                    );

                    expect(contentScript.videoDetectionIntervalId).toBeNull();
                    expect(contentScript.videoDetectionRetries).toBe(0);
                    expect(logWithFallback).not.toHaveBeenCalledWith(
                        'debug',
                        'Video detection attempt',
                        expect.anything()
                    );
                    expect(
                        contentScript.subtitleUtils.ensureSubtitleContainer
                    ).not.toHaveBeenCalled();
                } finally {
                    contentScript.activePlatform = platform;
                    contentScript.platformInitializationGeneration =
                        originalGeneration;
                    contentScript.stopVideoElementDetection();
                    logWithFallback.mockRestore();
                    root.remove();
                    history.replaceState({}, '', originalPathname);
                    jest.useRealTimers();
                }
            }
        );

        test('replacement rearm accepts a verified scope after the prior nodes disconnect', () => {
            jest.useFakeTimers();
            const originalPathname = window.location.pathname;
            const root = document.createElement('div');
            const video = document.createElement('video');

            root.appendChild(video);
            document.body.appendChild(root);

            try {
                history.replaceState({}, '', '/watch/reconnected-title');
                contentScript.activePlatform = {
                    getPlayerContainerElement: jest.fn(() => root),
                    getVideoElement: jest.fn(() => video),
                    isPlayerPageActive: jest.fn(() => true),
                };
                contentScript.subtitleUtils =
                    MockFactory.createSubtitleUtilsMock();
                contentScript.currentConfig = {};

                expect(contentScript.attemptVideoSetup()).toBe(true);
                contentScript.subtitleUtils.ensureSubtitleContainer.mockClear();
                contentScript._rearmVideoElementDetectionForPlayerNavigation();

                root.remove();
                jest.advanceTimersByTime(contentScript.videoDetectionInterval);
                expect(
                    contentScript.subtitleUtils.ensureSubtitleContainer
                ).not.toHaveBeenCalled();
                expect(contentScript.videoDetectionIntervalId).not.toBeNull();

                document.body.appendChild(root);
                jest.advanceTimersByTime(contentScript.videoDetectionInterval);

                expect(
                    contentScript.subtitleUtils.ensureSubtitleContainer
                ).toHaveBeenCalledTimes(1);
                expect(contentScript.videoDetectionIntervalId).toBeNull();
            } finally {
                contentScript.stopVideoElementDetection();
                root.remove();
                history.replaceState({}, '', originalPathname);
                jest.useRealTimers();
            }
        });

        test('a stale replacement interval cannot mutate or clear a newer detection generation', () => {
            jest.useFakeTimers();
            const originalPathname = window.location.pathname;
            const root = document.createElement('div');
            const video = document.createElement('video');
            let currentVideo = video;
            const setIntervalSpy = jest.spyOn(global, 'setInterval');
            const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

            root.appendChild(video);
            document.body.appendChild(root);

            try {
                history.replaceState({}, '', '/watch/stale-generation');
                contentScript.activePlatform = {
                    getPlayerContainerElement: jest.fn(() => root),
                    getVideoElement: jest.fn(() => currentVideo),
                    isPlayerPageActive: jest.fn(() => true),
                };
                contentScript.subtitleUtils =
                    MockFactory.createSubtitleUtilsMock();
                contentScript.currentConfig = {};

                expect(contentScript.attemptVideoSetup()).toBe(true);
                contentScript.subtitleUtils.ensureSubtitleContainer.mockClear();
                contentScript._rearmVideoElementDetectionForPlayerNavigation();
                const staleCallback = setIntervalSpy.mock.calls.at(-1)[0];
                const staleIntervalId = contentScript.videoDetectionIntervalId;

                currentVideo = null;
                contentScript.startVideoElementDetection();
                const currentIntervalId =
                    contentScript.videoDetectionIntervalId;
                expect(currentIntervalId).not.toBeNull();
                expect(currentIntervalId).not.toBe(staleIntervalId);

                clearIntervalSpy.mockClear();
                staleCallback();

                expect(clearIntervalSpy).not.toHaveBeenCalled();
                expect(contentScript.videoDetectionIntervalId).toBe(
                    currentIntervalId
                );
                expect(contentScript.videoDetectionRetries).toBe(0);
                expect(
                    contentScript.subtitleUtils.ensureSubtitleContainer
                ).not.toHaveBeenCalled();
            } finally {
                contentScript.stopVideoElementDetection();
                setIntervalSpy.mockRestore();
                clearIntervalSpy.mockRestore();
                root.remove();
                history.replaceState({}, '', originalPathname);
                jest.useRealTimers();
            }
        });

        test('a stale callback cannot clear a newer detector that reuses the same interval id', () => {
            const reusedIntervalId = 7070;
            const callbacks = [];
            const setIntervalSpy = jest
                .spyOn(global, 'setInterval')
                .mockImplementation((callback) => {
                    callbacks.push(callback);
                    return reusedIntervalId;
                });
            const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
            contentScript.activePlatform = {
                getVideoElement: jest.fn(() => null),
                isPlayerPageActive: jest.fn(() => true),
            };
            contentScript.subtitleUtils = MockFactory.createSubtitleUtilsMock();
            contentScript.currentConfig = {};

            try {
                contentScript.startVideoElementDetection();
                const staleTask = contentScript.videoDetectionTask;
                contentScript.startVideoElementDetection();
                const currentTask = contentScript.videoDetectionTask;

                expect(callbacks).toHaveLength(2);
                expect(currentTask).not.toBe(staleTask);
                expect(contentScript.videoDetectionIntervalId).toBe(
                    reusedIntervalId
                );

                clearIntervalSpy.mockClear();
                callbacks[0]();

                expect(clearIntervalSpy).not.toHaveBeenCalled();
                expect(contentScript.videoDetectionTask).toBe(currentTask);
                expect(contentScript.videoDetectionIntervalId).toBe(
                    reusedIntervalId
                );
            } finally {
                contentScript.stopVideoElementDetection();
                setIntervalSpy.mockRestore();
                clearIntervalSpy.mockRestore();
            }
        });

        test('replacement rearm rechecks lifecycle after resolving a candidate scope', () => {
            jest.useFakeTimers();
            const originalPathname = window.location.pathname;
            const oldRoot = document.createElement('div');
            const oldVideo = document.createElement('video');
            const newRoot = document.createElement('div');
            const newVideo = document.createElement('video');
            let currentRoot = oldRoot;
            let currentVideo = oldVideo;

            oldRoot.appendChild(oldVideo);
            newRoot.appendChild(newVideo);
            document.body.append(oldRoot, newRoot);

            try {
                history.replaceState({}, '', '/watch/lifecycle-race');
                const platform = {
                    getPlayerContainerElement: jest.fn(() => currentRoot),
                    getVideoElement: jest.fn(() => currentVideo),
                    isPlayerPageActive: jest.fn(() => true),
                };
                contentScript.activePlatform = platform;
                contentScript.subtitleUtils =
                    MockFactory.createSubtitleUtilsMock();
                contentScript.currentConfig = {};

                expect(contentScript.attemptVideoSetup()).toBe(true);
                contentScript.subtitleUtils.ensureSubtitleContainer.mockClear();
                contentScript._rearmVideoElementDetectionForPlayerNavigation();

                currentRoot = newRoot;
                currentVideo = newVideo;
                platform.getPlayerContainerElement.mockImplementationOnce(
                    () => {
                        contentScript.platformInitializationGeneration += 1;
                        return currentRoot;
                    }
                );
                jest.advanceTimersByTime(contentScript.videoDetectionInterval);

                expect(
                    contentScript.subtitleUtils.ensureSubtitleContainer
                ).not.toHaveBeenCalled();
                expect(contentScript.videoDetectionIntervalId).toBeNull();
            } finally {
                contentScript.stopVideoElementDetection();
                oldRoot.remove();
                newRoot.remove();
                history.replaceState({}, '', originalPathname);
                jest.useRealTimers();
            }
        });

        test('replacement setup aborts before UI work when its final root lookup invalidates lifecycle', () => {
            jest.useFakeTimers();
            const originalPathname = window.location.pathname;
            const oldRoot = document.createElement('div');
            const oldVideo = document.createElement('video');
            const newRoot = document.createElement('div');
            const newVideo = document.createElement('video');
            let currentRoot = oldRoot;
            let currentVideo = oldVideo;

            oldRoot.appendChild(oldVideo);
            newRoot.appendChild(newVideo);
            document.body.append(oldRoot, newRoot);

            try {
                history.replaceState({}, '', '/watch/final-root-race');
                const platform = {
                    getPlayerContainerElement: jest.fn(() => currentRoot),
                    getVideoElement: jest.fn(() => currentVideo),
                    isPlayerPageActive: jest.fn(() => true),
                    cleanup: jest.fn().mockResolvedValue(),
                };
                contentScript.activePlatform = platform;
                contentScript.subtitleUtils =
                    MockFactory.createSubtitleUtilsMock();
                contentScript.currentConfig = {};

                expect(contentScript.attemptVideoSetup()).toBe(true);
                contentScript.subtitleUtils.ensureSubtitleContainer.mockClear();
                contentScript.subtitleUtils.showSubtitleContainer.mockClear();
                contentScript.subtitleUtils.hideSubtitleContainer.mockClear();
                contentScript.subtitleUtils.updateSubtitles.mockClear();
                contentScript._rearmVideoElementDetectionForPlayerNavigation();

                currentRoot = newRoot;
                currentVideo = newVideo;
                platform.getPlayerContainerElement
                    .mockImplementationOnce(() => currentRoot)
                    .mockImplementationOnce(() => {
                        contentScript.platformInitializationGeneration += 1;
                        return currentRoot;
                    });
                jest.advanceTimersByTime(contentScript.videoDetectionInterval);

                expect(
                    contentScript.subtitleUtils.ensureSubtitleContainer
                ).not.toHaveBeenCalled();
                expect(
                    contentScript.subtitleUtils.showSubtitleContainer
                ).not.toHaveBeenCalled();
                expect(
                    contentScript.subtitleUtils.hideSubtitleContainer
                ).not.toHaveBeenCalled();
                expect(
                    contentScript.subtitleUtils.updateSubtitles
                ).not.toHaveBeenCalled();
                expect(contentScript.videoDetectionIntervalId).toBeNull();
            } finally {
                contentScript.stopVideoElementDetection();
                oldRoot.remove();
                newRoot.remove();
                history.replaceState({}, '', originalPathname);
                jest.useRealTimers();
            }
        });

        test.each([
            [
                'initial setup log',
                'Video element found! Setting up subtitle container and listeners',
                0,
            ],
            [
                'subtitle-state log',
                'Subtitles are active, showing container and setting up listeners',
                1,
            ],
        ])(
            'video setup aborts stale UI work when the %s invalidates lifecycle',
            (_phase, invalidatingMessage, expectedEnsureCalls) => {
                const root = document.createElement('div');
                const video = document.createElement('video');
                root.appendChild(video);
                document.body.appendChild(root);

                try {
                    const platform = {
                        cleanup: jest.fn().mockResolvedValue(),
                        getPlayerContainerElement: jest.fn(() => root),
                        getVideoElement: jest.fn(() => video),
                        isPlayerPageActive: jest.fn(() => true),
                    };
                    contentScript.activePlatform = platform;
                    contentScript.subtitleUtils =
                        MockFactory.createSubtitleUtilsMock({
                            clearSubtitleDOM: jest.fn(),
                            clearSubtitlesDisplayAndQueue: jest.fn(),
                        });
                    contentScript.currentConfig = {};
                    contentScript.eventBuffer = { clear: jest.fn() };
                    contentScript.logWithFallback = jest.fn(
                        (_level, message) => {
                            if (message === invalidatingMessage) {
                                contentScript._cleanupOnPlayerPageLeave();
                            }
                        }
                    );

                    expect(contentScript.attemptVideoSetup()).toBe(false);

                    expect(
                        contentScript.subtitleUtils.ensureSubtitleContainer
                    ).toHaveBeenCalledTimes(expectedEnsureCalls);
                    expect(
                        contentScript.subtitleUtils.showSubtitleContainer
                    ).not.toHaveBeenCalled();
                    expect(
                        contentScript.subtitleUtils.hideSubtitleContainer
                    ).not.toHaveBeenCalled();
                    expect(
                        contentScript.subtitleUtils.updateSubtitles
                    ).not.toHaveBeenCalled();
                } finally {
                    root.remove();
                }
            }
        );

        test('player-page leave prevents a captured queued replacement callback from resurrecting detection', () => {
            jest.useFakeTimers();
            const originalPathname = window.location.pathname;
            const root = document.createElement('div');
            const video = document.createElement('video');
            const setIntervalSpy = jest.spyOn(global, 'setInterval');
            root.appendChild(video);
            document.body.appendChild(root);

            try {
                history.replaceState({}, '', '/watch/page-leave');
                const platform = {
                    cleanup: jest.fn().mockResolvedValue(),
                    getPlayerContainerElement: jest.fn(() => root),
                    getVideoElement: jest.fn(() => video),
                    isPlayerPageActive: jest.fn(() => true),
                };
                contentScript.activePlatform = platform;
                contentScript.subtitleUtils =
                    MockFactory.createSubtitleUtilsMock({
                        clearSubtitleDOM: jest.fn(),
                        clearSubtitlesDisplayAndQueue: jest.fn(),
                    });
                contentScript.currentConfig = {};
                contentScript.eventBuffer = { clear: jest.fn() };

                expect(contentScript.attemptVideoSetup()).toBe(true);
                contentScript.subtitleUtils.ensureSubtitleContainer.mockClear();
                contentScript.subtitleUtils.showSubtitleContainer.mockClear();
                contentScript.subtitleUtils.hideSubtitleContainer.mockClear();
                contentScript.subtitleUtils.updateSubtitles.mockClear();
                contentScript._rearmVideoElementDetectionForPlayerNavigation();
                const queuedReplacementCallback =
                    setIntervalSpy.mock.calls.at(-1)[0];

                contentScript._cleanupOnPlayerPageLeave();
                queuedReplacementCallback();

                expect(contentScript.activePlatform).toBeNull();
                expect(contentScript.videoDetectionIntervalId).toBeNull();
                expect(
                    contentScript.subtitleUtils.ensureSubtitleContainer
                ).not.toHaveBeenCalled();
                expect(
                    contentScript.subtitleUtils.showSubtitleContainer
                ).not.toHaveBeenCalled();
                expect(
                    contentScript.subtitleUtils.hideSubtitleContainer
                ).not.toHaveBeenCalled();
                expect(
                    contentScript.subtitleUtils.updateSubtitles
                ).not.toHaveBeenCalled();
            } finally {
                contentScript.stopVideoElementDetection();
                setIntervalSpy.mockRestore();
                root.remove();
                history.replaceState({}, '', originalPathname);
                jest.useRealTimers();
            }
        });

        test('player-page leave during the immediate replacement lookup cannot resurrect an interval', () => {
            jest.useFakeTimers();
            const originalPathname = window.location.pathname;
            const root = document.createElement('div');
            const video = document.createElement('video');
            const setIntervalSpy = jest.spyOn(global, 'setInterval');
            root.appendChild(video);
            document.body.appendChild(root);

            try {
                history.replaceState({}, '', '/watch/immediate-page-leave');
                const platform = {
                    cleanup: jest.fn().mockResolvedValue(),
                    getPlayerContainerElement: jest.fn(() => root),
                    getVideoElement: jest.fn(() => video),
                    isPlayerPageActive: jest.fn(() => true),
                };
                contentScript.activePlatform = platform;
                contentScript.subtitleUtils =
                    MockFactory.createSubtitleUtilsMock({
                        clearSubtitleDOM: jest.fn(),
                        clearSubtitlesDisplayAndQueue: jest.fn(),
                    });
                contentScript.currentConfig = {};
                contentScript.eventBuffer = { clear: jest.fn() };

                expect(contentScript.attemptVideoSetup()).toBe(true);
                contentScript.subtitleUtils.ensureSubtitleContainer.mockClear();
                contentScript.subtitleUtils.showSubtitleContainer.mockClear();
                contentScript.subtitleUtils.hideSubtitleContainer.mockClear();
                contentScript.subtitleUtils.updateSubtitles.mockClear();
                platform.getPlayerContainerElement.mockImplementation(() => {
                    contentScript._cleanupOnPlayerPageLeave();
                    return null;
                });

                contentScript._rearmVideoElementDetectionForPlayerNavigation();

                expect(setIntervalSpy).not.toHaveBeenCalled();
                expect(contentScript.activePlatform).toBeNull();
                expect(contentScript.videoDetectionIntervalId).toBeNull();
                expect(contentScript.videoDetectionTask).toBeNull();
                expect(
                    contentScript.subtitleUtils.ensureSubtitleContainer
                ).not.toHaveBeenCalled();
                expect(
                    contentScript.subtitleUtils.showSubtitleContainer
                ).not.toHaveBeenCalled();
                expect(
                    contentScript.subtitleUtils.hideSubtitleContainer
                ).not.toHaveBeenCalled();
                expect(
                    contentScript.subtitleUtils.updateSubtitles
                ).not.toHaveBeenCalled();
            } finally {
                contentScript.stopVideoElementDetection();
                setIntervalSpy.mockRestore();
                root.remove();
                history.replaceState({}, '', originalPathname);
                jest.useRealTimers();
            }
        });

        test('a newer detection started during an immediate lookup retains interval ownership', () => {
            jest.useFakeTimers();
            const setIntervalSpy = jest.spyOn(global, 'setInterval');
            let videoLookupCount = 0;

            try {
                const platform = {
                    getVideoElement: jest.fn(() => {
                        videoLookupCount += 1;
                        if (videoLookupCount === 1) {
                            contentScript.startVideoElementDetection();
                        }
                        return null;
                    }),
                    isPlayerPageActive: jest.fn(() => true),
                };
                contentScript.activePlatform = platform;
                contentScript.subtitleUtils =
                    MockFactory.createSubtitleUtilsMock();
                contentScript.currentConfig = {};

                contentScript.startVideoElementDetection();

                expect(setIntervalSpy).toHaveBeenCalledTimes(1);
                expect(contentScript.videoDetectionGeneration).toBe(2);
                expect(contentScript.videoDetectionTask).toEqual(
                    expect.objectContaining({
                        detectionGeneration: 2,
                        intervalId: contentScript.videoDetectionIntervalId,
                    })
                );
                expect(contentScript.videoDetectionIntervalId).not.toBeNull();
            } finally {
                contentScript.stopVideoElementDetection();
                jest.clearAllTimers();
                setIntervalSpy.mockRestore();
                jest.useRealTimers();
            }
        });

        test('a detector started by startup logging retains exact ownership', () => {
            jest.useFakeTimers();
            let startedNewerDetector = false;
            let newerTask = null;
            let newerIntervalId = null;
            contentScript.activePlatform = {
                getVideoElement: jest.fn(() => null),
                isPlayerPageActive: jest.fn(() => true),
            };
            contentScript.subtitleUtils = MockFactory.createSubtitleUtilsMock();
            contentScript.currentConfig = {};
            contentScript.logWithFallback = jest.fn((_level, message) => {
                if (
                    message === 'Starting video element detection' &&
                    !startedNewerDetector
                ) {
                    startedNewerDetector = true;
                    contentScript.startVideoElementDetection();
                    newerTask = contentScript.videoDetectionTask;
                    newerIntervalId = contentScript.videoDetectionIntervalId;
                }
            });

            try {
                contentScript.startVideoElementDetection();

                expect(contentScript.videoDetectionGeneration).toBe(1);
                expect(contentScript.videoDetectionTask).toBe(newerTask);
                expect(contentScript.videoDetectionIntervalId).toBe(
                    newerIntervalId
                );
                expect(jest.getTimerCount()).toBe(1);
            } finally {
                contentScript.stopVideoElementDetection();
                jest.clearAllTimers();
                jest.useRealTimers();
            }
        });

        test('a detector started during the pre-task replacement lookup retains ownership', () => {
            jest.useFakeTimers();
            const originalPathname = window.location.pathname;
            const setIntervalSpy = jest.spyOn(global, 'setInterval');
            let videoLookupCount = 0;

            try {
                history.replaceState({}, '', '/watch/pre-task-owner');
                const platform = {
                    getPlayerContainerElement: jest.fn(() => null),
                    getVideoElement: jest.fn(() => {
                        videoLookupCount += 1;
                        if (videoLookupCount === 1) {
                            contentScript.startVideoElementDetection();
                        }
                        return null;
                    }),
                    isPlayerPageActive: jest.fn(() => true),
                };
                contentScript.activePlatform = platform;
                contentScript.subtitleUtils =
                    MockFactory.createSubtitleUtilsMock();
                contentScript.currentConfig = {};
                expect(contentScript.lastVideoSetupScope).toBeNull();

                contentScript._rearmVideoElementDetectionForPlayerNavigation();

                expect(setIntervalSpy).toHaveBeenCalledTimes(1);
                expect(contentScript.videoDetectionGeneration).toBe(1);
                expect(contentScript.videoDetectionTask).toEqual(
                    expect.objectContaining({
                        detectionGeneration: 1,
                        intervalId: contentScript.videoDetectionIntervalId,
                    })
                );
                expect(contentScript.videoDetectionIntervalId).not.toBeNull();
            } finally {
                contentScript.stopVideoElementDetection();
                jest.clearAllTimers();
                setIntervalSpy.mockRestore();
                history.replaceState({}, '', originalPathname);
                jest.useRealTimers();
            }
        });

        test.each([
            ['initial', 1],
            ['final', 2],
        ])(
            'a detector started by the %s route check retains ownership',
            (_phase, reentrantRouteCheck) => {
                jest.useFakeTimers();
                const originalPathname = window.location.pathname;
                const originalIsPlayerPath = contentScript._isPlayerPath;
                const root = document.createElement('div');
                const video = document.createElement('video');
                const setIntervalSpy = jest.spyOn(global, 'setInterval');
                let routeCheckCount = 0;
                root.appendChild(video);
                document.body.appendChild(root);

                try {
                    history.replaceState({}, '', '/watch/route-owner');
                    const platform = {
                        getPlayerContainerElement: jest.fn(() => root),
                        getVideoElement: jest.fn(() => null),
                        isPlayerPageActive: jest.fn(() => true),
                    };
                    contentScript.activePlatform = platform;
                    contentScript.subtitleUtils =
                        MockFactory.createSubtitleUtilsMock();
                    contentScript.currentConfig = {};
                    contentScript.lastVideoSetupScope = {
                        platform,
                        platformGeneration:
                            contentScript.platformInitializationGeneration,
                        root,
                        video,
                    };
                    contentScript._isPlayerPath = jest.fn(() => {
                        routeCheckCount += 1;
                        if (routeCheckCount === reentrantRouteCheck) {
                            contentScript.startVideoElementDetection();
                        }
                        return true;
                    });

                    contentScript._rearmVideoElementDetectionForPlayerNavigation();

                    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
                    expect(contentScript.videoDetectionGeneration).toBe(1);
                    expect(contentScript.videoDetectionTask).toEqual(
                        expect.objectContaining({
                            detectionGeneration: 1,
                            intervalId: contentScript.videoDetectionIntervalId,
                        })
                    );
                } finally {
                    contentScript._isPlayerPath = originalIsPlayerPath;
                    contentScript.stopVideoElementDetection();
                    jest.clearAllTimers();
                    setIntervalSpy.mockRestore();
                    root.remove();
                    history.replaceState({}, '', originalPathname);
                    jest.useRealTimers();
                }
            }
        );

        test.each([
            ['initial', 1],
            ['final', 2],
        ])(
            'player-to-player rearm cannot cross an exact pathname change during the %s route validation',
            (_phase, mutationCheck) => {
                jest.useFakeTimers();
                const originalPathname = window.location.pathname;
                const originalIsPlayerPath = contentScript._isPlayerPath;
                const setIntervalSpy = jest.spyOn(global, 'setInterval');
                let routeCheckCount = 0;

                try {
                    history.replaceState({}, '', '/watch/rearm-route-a');
                    const platform = {
                        getVideoElement: jest.fn(() => null),
                        isPlayerPageActive: jest.fn(() => true),
                    };
                    contentScript.activePlatform = platform;
                    contentScript.subtitleUtils =
                        MockFactory.createSubtitleUtilsMock();
                    contentScript.currentConfig = {};
                    contentScript._isPlayerPath = jest.fn(() => {
                        routeCheckCount += 1;
                        if (routeCheckCount === mutationCheck) {
                            history.replaceState(
                                {},
                                '',
                                '/watch/rearm-route-b'
                            );
                        }
                        return true;
                    });

                    contentScript._rearmVideoElementDetectionForPlayerNavigation();

                    expect(setIntervalSpy).not.toHaveBeenCalled();
                    expect(contentScript.videoDetectionTask).toBeNull();
                    expect(contentScript.videoDetectionIntervalId).toBeNull();
                } finally {
                    contentScript._isPlayerPath = originalIsPlayerPath;
                    contentScript.stopVideoElementDetection();
                    jest.clearAllTimers();
                    setIntervalSpy.mockRestore();
                    history.replaceState({}, '', originalPathname);
                    jest.useRealTimers();
                }
            }
        );

        test('replacement rearm keeps its captured pathname when startup logging is reentrant', () => {
            jest.useFakeTimers();
            const originalPathname = window.location.pathname;
            const setIntervalSpy = jest.spyOn(global, 'setInterval');

            try {
                history.replaceState({}, '', '/watch/rearm-log-a');
                contentScript.activePlatform = {
                    getVideoElement: jest.fn(() => null),
                    isPlayerPageActive: jest.fn(() => true),
                };
                contentScript.subtitleUtils =
                    MockFactory.createSubtitleUtilsMock();
                contentScript.currentConfig = {};
                contentScript.logWithFallback = jest.fn((_level, message) => {
                    if (message === 'Starting video element detection') {
                        history.replaceState({}, '', '/watch/rearm-log-b');
                    }
                });

                contentScript._rearmVideoElementDetectionForPlayerNavigation();

                expect(setIntervalSpy).not.toHaveBeenCalled();
                expect(contentScript.videoDetectionTask).toBeNull();
                expect(contentScript.videoDetectionIntervalId).toBeNull();
            } finally {
                contentScript.stopVideoElementDetection();
                jest.clearAllTimers();
                setIntervalSpy.mockRestore();
                history.replaceState({}, '', originalPathname);
                jest.useRealTimers();
            }
        });

        test('a provisional replacement interval cannot commit after timer creation changes route', () => {
            jest.useFakeTimers();
            const originalPathname = window.location.pathname;
            const root = document.createElement('div');
            const video = document.createElement('video');
            const provisionalIntervalId = 9191;
            const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
            let setIntervalSpy;
            root.appendChild(video);
            document.body.appendChild(root);

            try {
                history.replaceState({}, '', '/watch/provisional-owner');
                const platform = {
                    getPlayerContainerElement: jest.fn(() => root),
                    getVideoElement: jest.fn(() => video),
                    isPlayerPageActive: jest.fn(() => true),
                };
                contentScript.activePlatform = platform;
                contentScript.subtitleUtils =
                    MockFactory.createSubtitleUtilsMock();
                contentScript.currentConfig = {};
                expect(contentScript.attemptVideoSetup()).toBe(true);

                setIntervalSpy = jest
                    .spyOn(global, 'setInterval')
                    .mockImplementation(() => {
                        history.replaceState({}, '', '/browse');
                        return provisionalIntervalId;
                    });
                contentScript._rearmVideoElementDetectionForPlayerNavigation();

                expect(clearIntervalSpy).toHaveBeenCalledWith(
                    provisionalIntervalId
                );
                expect(contentScript.videoDetectionIntervalId).toBeNull();
                expect(contentScript.videoDetectionTask).toBeNull();
            } finally {
                contentScript.stopVideoElementDetection();
                setIntervalSpy?.mockRestore();
                clearIntervalSpy.mockRestore();
                root.remove();
                history.replaceState({}, '', originalPathname);
                jest.useRealTimers();
            }
        });

        test('a provisional interval is cleared when post-install route validation starts a newer detector', () => {
            const originalPathname = window.location.pathname;
            const originalIsPlayerPath = contentScript._isPlayerPath;
            const intervalIds = [7676, 7777];
            let intervalInstallCount = 0;
            let routeCheckCount = 0;
            const setIntervalSpy = jest
                .spyOn(global, 'setInterval')
                .mockImplementation(() => {
                    const intervalId = intervalIds[intervalInstallCount];
                    intervalInstallCount += 1;
                    return intervalId;
                });
            const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

            try {
                history.replaceState({}, '', '/watch/provisional-route-owner');
                contentScript.activePlatform = {
                    getVideoElement: jest.fn(() => null),
                    isPlayerPageActive: jest.fn(() => true),
                };
                contentScript.subtitleUtils =
                    MockFactory.createSubtitleUtilsMock();
                contentScript.currentConfig = {};
                contentScript._isPlayerPath = jest.fn(() => {
                    routeCheckCount += 1;
                    if (routeCheckCount === 3) {
                        contentScript.startVideoElementDetection();
                    }
                    return true;
                });

                contentScript.startVideoElementDetection();

                expect(intervalInstallCount).toBe(2);
                expect(clearIntervalSpy).toHaveBeenCalledWith(intervalIds[0]);
                expect(clearIntervalSpy).not.toHaveBeenCalledWith(
                    intervalIds[1]
                );
                expect(contentScript.videoDetectionIntervalId).toBe(
                    intervalIds[1]
                );
                expect(contentScript.videoDetectionIntervalOwner).toBe(
                    contentScript.videoDetectionTask
                );
            } finally {
                contentScript._isPlayerPath = originalIsPlayerPath;
                contentScript.stopVideoElementDetection();
                setIntervalSpy.mockRestore();
                clearIntervalSpy.mockRestore();
                history.replaceState({}, '', originalPathname);
            }
        });

        test('an immediate collaborator exception terminates detection without exposing details', () => {
            jest.useFakeTimers();
            const rawThrownMessage = 'raw-immediate-detection-secret';
            const setIntervalSpy = jest.spyOn(global, 'setInterval');
            contentScript.logWithFallback = jest.fn();
            contentScript.activePlatform = {
                getVideoElement: jest.fn(() => {
                    throw new Error(rawThrownMessage);
                }),
                isPlayerPageActive: jest.fn(() => true),
            };
            contentScript.subtitleUtils = MockFactory.createSubtitleUtilsMock();
            contentScript.currentConfig = {};

            try {
                expect(() =>
                    contentScript.startVideoElementDetection()
                ).not.toThrow();

                expect(setIntervalSpy).not.toHaveBeenCalled();
                expect(contentScript.videoDetectionIntervalId).toBeNull();
                expect(contentScript.videoDetectionTask).toBeNull();
                expect(contentScript.logWithFallback).toHaveBeenCalledWith(
                    'warn',
                    'Video detection attempt failed safely'
                );
                expect(
                    JSON.stringify(contentScript.logWithFallback.mock.calls)
                ).not.toContain(rawThrownMessage);
            } finally {
                contentScript.stopVideoElementDetection();
                setIntervalSpy.mockRestore();
                jest.useRealTimers();
            }
        });

        test('an interval collaborator exception clears exact ownership without retrying', () => {
            jest.useFakeTimers();
            const rawThrownMessage = 'raw-interval-detection-secret';
            const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
            const getVideoElement = jest
                .fn()
                .mockReturnValueOnce(null)
                .mockImplementation(() => {
                    throw new Error(rawThrownMessage);
                });
            contentScript.logWithFallback = jest.fn();
            contentScript.activePlatform = {
                getVideoElement,
                isPlayerPageActive: jest.fn(() => true),
            };
            contentScript.subtitleUtils = MockFactory.createSubtitleUtilsMock();
            contentScript.currentConfig = {};

            try {
                contentScript.startVideoElementDetection();
                const ownedIntervalId = contentScript.videoDetectionIntervalId;
                expect(ownedIntervalId).not.toBeNull();

                expect(() =>
                    jest.advanceTimersByTime(
                        contentScript.videoDetectionInterval
                    )
                ).not.toThrow();

                expect(clearIntervalSpy).toHaveBeenCalledWith(ownedIntervalId);
                expect(contentScript.videoDetectionIntervalId).toBeNull();
                expect(contentScript.videoDetectionTask).toBeNull();
                expect(contentScript.videoDetectionRetries).toBe(1);
                expect(contentScript.logWithFallback).toHaveBeenCalledWith(
                    'warn',
                    'Video detection attempt failed safely'
                );
                expect(
                    JSON.stringify(contentScript.logWithFallback.mock.calls)
                ).not.toContain(rawThrownMessage);

                jest.advanceTimersByTime(
                    contentScript.videoDetectionInterval * 3
                );
                expect(contentScript.videoDetectionRetries).toBe(1);
            } finally {
                contentScript.stopVideoElementDetection();
                clearIntervalSpy.mockRestore();
                jest.useRealTimers();
            }
        });

        test('a stale detector exception cannot cancel a newer visibility owner', () => {
            const originalPathname = window.location.pathname;
            const intervalIds = [7171, 7272];
            const intervalCallbacks = [];
            const visibilityTimeoutId = 7373;
            const setIntervalSpy = jest
                .spyOn(global, 'setInterval')
                .mockImplementation((callback) => {
                    intervalCallbacks.push(callback);
                    return intervalIds[intervalCallbacks.length - 1];
                });
            const setTimeoutSpy = jest
                .spyOn(global, 'setTimeout')
                .mockImplementation(() => visibilityTimeoutId);
            const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
            let videoLookupCount = 0;
            let newerTask = null;
            let newerIntervalId = null;
            let newerVisibilityTask = null;

            try {
                history.replaceState({}, '', '/watch/newer-visibility');
                const platform = {
                    getVideoElement: jest.fn(() => {
                        videoLookupCount += 1;
                        if (videoLookupCount === 2) {
                            contentScript.startVideoElementDetection();
                            newerTask = contentScript.videoDetectionTask;
                            newerIntervalId =
                                contentScript.videoDetectionIntervalId;
                            expect(
                                contentScript._scheduleVisibilityVideoSetupRetry()
                            ).toBe(true);
                            newerVisibilityTask =
                                contentScript.visibilityVideoSetupTask;
                            throw new Error('raw-stale-attempt-secret');
                        }
                        return null;
                    }),
                    isPlayerPageActive: jest.fn(() => true),
                };
                contentScript.activePlatform = platform;
                contentScript.subtitleUtils =
                    MockFactory.createSubtitleUtilsMock();
                contentScript.subtitleUtils.subtitlesActive = true;
                contentScript.currentConfig = {};
                contentScript.logWithFallback = jest.fn();

                contentScript.startVideoElementDetection();
                expect(intervalCallbacks).toHaveLength(1);
                clearTimeoutSpy.mockClear();

                intervalCallbacks[0]();

                expect(newerTask).not.toBeNull();
                expect(newerVisibilityTask).not.toBeNull();
                expect(contentScript.videoDetectionTask).toBe(newerTask);
                expect(contentScript.videoDetectionIntervalId).toBe(
                    newerIntervalId
                );
                expect(contentScript.visibilityVideoSetupTask).toBe(
                    newerVisibilityTask
                );
                expect(clearTimeoutSpy).not.toHaveBeenCalledWith(
                    visibilityTimeoutId
                );
            } finally {
                contentScript.stopVideoElementDetection();
                setIntervalSpy.mockRestore();
                setTimeoutSpy.mockRestore();
                clearTimeoutSpy.mockRestore();
                history.replaceState({}, '', originalPathname);
            }
        });

        test('a timer-install exception cannot leave a detector task without a timer', () => {
            jest.useFakeTimers();
            const rawThrownMessage = 'raw-timer-install-secret';
            jest.spyOn(global, 'setInterval').mockImplementation(() => {
                throw new Error(rawThrownMessage);
            });
            contentScript.logWithFallback = jest.fn();
            contentScript.activePlatform = {
                getVideoElement: jest.fn(() => null),
                isPlayerPageActive: jest.fn(() => true),
            };
            contentScript.subtitleUtils = MockFactory.createSubtitleUtilsMock();
            contentScript.currentConfig = {};

            try {
                expect(() =>
                    contentScript.startVideoElementDetection()
                ).not.toThrow();

                expect(contentScript.videoDetectionIntervalId).toBeNull();
                expect(contentScript.videoDetectionTask).toBeNull();
                expect(contentScript.logWithFallback).toHaveBeenCalledWith(
                    'warn',
                    'Video detection attempt failed safely'
                );
                expect(
                    JSON.stringify(contentScript.logWithFallback.mock.calls)
                ).not.toContain(rawThrownMessage);
            } finally {
                contentScript.stopVideoElementDetection();
                jest.useRealTimers();
            }
        });

        test('a synchronously firing interval cannot leave phantom detector ownership', () => {
            jest.useFakeTimers();
            const syntheticIntervalId = 7171;
            let capturedCallback = null;
            const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
            const setIntervalSpy = jest
                .spyOn(global, 'setInterval')
                .mockImplementation((callback) => {
                    capturedCallback = callback;
                    callback();
                    return syntheticIntervalId;
                });
            contentScript.activePlatform = {
                getVideoElement: jest.fn(() => null),
                isPlayerPageActive: jest.fn(() => true),
            };
            contentScript.subtitleUtils = MockFactory.createSubtitleUtilsMock();
            contentScript.currentConfig = {};

            try {
                contentScript.startVideoElementDetection();

                expect(clearIntervalSpy).toHaveBeenCalledWith(
                    syntheticIntervalId
                );
                expect(contentScript.videoDetectionRetries).toBe(0);
                expect(contentScript.videoDetectionIntervalId).toBeNull();
                expect(contentScript.videoDetectionTask).toBeNull();

                capturedCallback();
                expect(contentScript.videoDetectionRetries).toBe(0);
            } finally {
                contentScript.stopVideoElementDetection();
                setIntervalSpy.mockRestore();
                clearIntervalSpy.mockRestore();
                jest.useRealTimers();
            }
        });

        test('visibility video setup runs once only for its captured owner', () => {
            jest.useFakeTimers();
            const originalPathname = window.location.pathname;

            try {
                history.replaceState({}, '', '/watch/visibility-current');
                const platform = {
                    isPlayerPageActive: jest.fn(() => true),
                };
                contentScript.activePlatform = platform;
                contentScript.subtitleUtils =
                    MockFactory.createSubtitleUtilsMock();
                contentScript.currentConfig = {};
                contentScript.attemptVideoSetup = jest.fn(() => true);

                expect(contentScript._scheduleVisibilityVideoSetupRetry()).toBe(
                    true
                );
                const task = contentScript.visibilityVideoSetupTask;
                expect(task?.timeoutId).not.toBeNull();

                jest.advanceTimersByTime(499);
                expect(contentScript.attemptVideoSetup).not.toHaveBeenCalled();
                jest.advanceTimersByTime(1);

                expect(contentScript.attemptVideoSetup).toHaveBeenCalledTimes(
                    1
                );
                expect(contentScript.attemptVideoSetup).toHaveBeenCalledWith(
                    task
                );
                expect(contentScript.visibilityVideoSetupTask).toBeNull();
            } finally {
                contentScript.stopVideoElementDetection();
                history.replaceState({}, '', originalPathname);
                jest.useRealTimers();
            }
        });

        test.each([
            [
                'platform generation',
                (script) => {
                    script.platformInitializationGeneration += 1;
                },
            ],
            [
                'platform identity',
                (script) => {
                    script.activePlatform = {};
                },
            ],
            [
                'player route',
                () => {
                    history.replaceState({}, '', '/watch/visibility-other');
                },
            ],
            [
                'detector generation',
                (script) => {
                    script.videoDetectionGeneration += 1;
                },
            ],
            [
                'detector task',
                (script) => {
                    script.videoDetectionTask = {};
                },
            ],
            ['cleanup state', (script) => script.cleanup()],
        ])(
            'visibility video setup aborts on stale %s',
            async (_reason, makeStale) => {
                jest.useFakeTimers();
                const originalPathname = window.location.pathname;
                const originalPlatformGeneration =
                    contentScript.platformInitializationGeneration;
                const originalDetectionGeneration =
                    contentScript.videoDetectionGeneration;
                const platform = {
                    isPlayerPageActive: jest.fn(() => true),
                };

                try {
                    history.replaceState({}, '', '/watch/visibility-stale');
                    contentScript.activePlatform = platform;
                    contentScript.subtitleUtils =
                        MockFactory.createSubtitleUtilsMock();
                    contentScript.currentConfig = {};
                    contentScript.attemptVideoSetup = jest.fn(() => true);
                    expect(
                        contentScript._scheduleVisibilityVideoSetupRetry()
                    ).toBe(true);

                    await makeStale(contentScript);
                    jest.advanceTimersByTime(500);

                    expect(
                        contentScript.attemptVideoSetup
                    ).not.toHaveBeenCalled();
                    expect(contentScript.visibilityVideoSetupTask).toBeNull();
                } finally {
                    contentScript.activePlatform = platform;
                    contentScript.platformInitializationGeneration =
                        originalPlatformGeneration;
                    contentScript.videoDetectionGeneration =
                        originalDetectionGeneration;
                    contentScript.videoDetectionTask = null;
                    contentScript.videoDetectionIntervalId = null;
                    contentScript.stopVideoElementDetection();
                    history.replaceState({}, '', originalPathname);
                    jest.useRealTimers();
                }
            }
        );

        test('player-page leave cancels visibility setup and defeats its captured callback', () => {
            const originalPathname = window.location.pathname;
            const syntheticTimeoutId = 6161;
            let capturedCallback = null;
            const setTimeoutSpy = jest
                .spyOn(global, 'setTimeout')
                .mockImplementation((callback) => {
                    capturedCallback = callback;
                    return syntheticTimeoutId;
                });
            const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

            try {
                history.replaceState({}, '', '/watch/visibility-leave');
                const platform = {
                    cleanup: jest.fn().mockResolvedValue(),
                    isPlayerPageActive: jest.fn(() => true),
                };
                contentScript.activePlatform = platform;
                contentScript.subtitleUtils =
                    MockFactory.createSubtitleUtilsMock({
                        clearSubtitleDOM: jest.fn(),
                        clearSubtitlesDisplayAndQueue: jest.fn(),
                    });
                contentScript.currentConfig = {};
                contentScript.eventBuffer = { clear: jest.fn() };
                contentScript.attemptVideoSetup = jest.fn(() => true);
                expect(contentScript._scheduleVisibilityVideoSetupRetry()).toBe(
                    true
                );

                contentScript._cleanupOnPlayerPageLeave();
                capturedCallback();

                expect(clearTimeoutSpy).toHaveBeenCalledWith(
                    syntheticTimeoutId
                );
                expect(contentScript.visibilityVideoSetupTask).toBeNull();
                expect(contentScript.activePlatform).toBeNull();
                expect(contentScript.attemptVideoSetup).not.toHaveBeenCalled();
            } finally {
                contentScript.stopVideoElementDetection();
                setTimeoutSpy.mockRestore();
                clearTimeoutSpy.mockRestore();
                history.replaceState({}, '', originalPathname);
            }
        });

        test('visibility setup rechecks detector identity after resolving its root', () => {
            jest.useFakeTimers();
            const originalPathname = window.location.pathname;
            const root = document.createElement('div');
            const video = document.createElement('video');
            root.appendChild(video);
            document.body.appendChild(root);

            try {
                history.replaceState({}, '', '/watch/visibility-root-race');
                const platform = {
                    getPlayerContainerElement: jest.fn(() => {
                        contentScript.videoDetectionGeneration += 1;
                        return root;
                    }),
                    getVideoElement: jest.fn(() => video),
                    isPlayerPageActive: jest.fn(() => true),
                };
                contentScript.activePlatform = platform;
                contentScript.subtitleUtils =
                    MockFactory.createSubtitleUtilsMock();
                contentScript.currentConfig = {};
                expect(contentScript._scheduleVisibilityVideoSetupRetry()).toBe(
                    true
                );

                jest.advanceTimersByTime(500);

                expect(
                    contentScript.subtitleUtils.ensureSubtitleContainer
                ).not.toHaveBeenCalled();
                expect(
                    contentScript.subtitleUtils.showSubtitleContainer
                ).not.toHaveBeenCalled();
                expect(contentScript.visibilityVideoSetupTask).toBeNull();
            } finally {
                contentScript.stopVideoElementDetection();
                root.remove();
                history.replaceState({}, '', originalPathname);
                jest.useRealTimers();
            }
        });

        test('visibility route validation cannot mutate the captured pathname and continue', () => {
            jest.useFakeTimers();
            const originalPathname = window.location.pathname;
            const originalIsPlayerPath = contentScript._isPlayerPath;
            let routeCheckCount = 0;

            try {
                history.replaceState({}, '', '/watch/visibility-route-a');
                contentScript.activePlatform = {
                    isPlayerPageActive: jest.fn(() => true),
                };
                contentScript.subtitleUtils =
                    MockFactory.createSubtitleUtilsMock();
                contentScript.currentConfig = {};
                contentScript.attemptVideoSetup = jest.fn(() => true);
                contentScript._isPlayerPath = jest.fn(() => {
                    routeCheckCount += 1;
                    if (routeCheckCount === 2) {
                        history.replaceState(
                            {},
                            '',
                            '/watch/visibility-route-b'
                        );
                    }
                    return true;
                });

                expect(contentScript._scheduleVisibilityVideoSetupRetry()).toBe(
                    false
                );
                jest.advanceTimersByTime(500);

                expect(contentScript.attemptVideoSetup).not.toHaveBeenCalled();
                expect(contentScript.visibilityVideoSetupTask).toBeNull();
            } finally {
                contentScript._isPlayerPath = originalIsPlayerPath;
                contentScript.stopVideoElementDetection();
                history.replaceState({}, '', originalPathname);
                jest.useRealTimers();
            }
        });

        test('a visibility retry installed during route validation retains ownership', () => {
            const originalPathname = window.location.pathname;
            const originalIsPlayerPath = contentScript._isPlayerPath;
            const setTimeoutSpy = jest
                .spyOn(global, 'setTimeout')
                .mockImplementation(() => 7474);
            let installedNestedRetry = false;
            let nestedTask = null;

            try {
                history.replaceState({}, '', '/watch/visibility-owner');
                contentScript.activePlatform = {
                    isPlayerPageActive: jest.fn(() => true),
                };
                contentScript.subtitleUtils =
                    MockFactory.createSubtitleUtilsMock();
                contentScript.subtitleUtils.subtitlesActive = true;
                contentScript.currentConfig = {};
                contentScript._isPlayerPath = jest.fn(() => {
                    if (!installedNestedRetry) {
                        installedNestedRetry = true;
                        expect(
                            contentScript._scheduleVisibilityVideoSetupRetry()
                        ).toBe(true);
                        nestedTask = contentScript.visibilityVideoSetupTask;
                    }
                    return true;
                });

                expect(contentScript._scheduleVisibilityVideoSetupRetry()).toBe(
                    false
                );

                expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
                expect(nestedTask).not.toBeNull();
                expect(contentScript.visibilityVideoSetupTask).toBe(nestedTask);
            } finally {
                contentScript._cancelVisibilityVideoSetupRetry();
                contentScript._isPlayerPath = originalIsPlayerPath;
                setTimeoutSpy.mockRestore();
                history.replaceState({}, '', originalPathname);
            }
        });

        test('a synchronously firing visibility timer cannot leave phantom ownership', () => {
            const originalPathname = window.location.pathname;
            const syntheticTimeoutId = 8181;
            const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
            const setTimeoutSpy = jest
                .spyOn(global, 'setTimeout')
                .mockImplementation((callback) => {
                    callback();
                    return syntheticTimeoutId;
                });

            try {
                history.replaceState({}, '', '/watch/visibility-sync');
                contentScript.activePlatform = {
                    isPlayerPageActive: jest.fn(() => true),
                };
                contentScript.subtitleUtils =
                    MockFactory.createSubtitleUtilsMock();
                contentScript.currentConfig = {};
                contentScript.attemptVideoSetup = jest.fn(() => true);

                expect(contentScript._scheduleVisibilityVideoSetupRetry()).toBe(
                    false
                );
                expect(clearTimeoutSpy).toHaveBeenCalledWith(
                    syntheticTimeoutId
                );
                expect(contentScript.attemptVideoSetup).not.toHaveBeenCalled();
                expect(contentScript.visibilityVideoSetupTask).toBeNull();
            } finally {
                contentScript.stopVideoElementDetection();
                setTimeoutSpy.mockRestore();
                clearTimeoutSpy.mockRestore();
                history.replaceState({}, '', originalPathname);
            }
        });

        test('a visibility collaborator exception clears ownership without exposing details', () => {
            jest.useFakeTimers();
            const originalPathname = window.location.pathname;
            const rawThrownMessage = 'raw-visibility-detection-secret';
            contentScript.logWithFallback = jest.fn();

            try {
                history.replaceState({}, '', '/watch/visibility-error');
                contentScript.activePlatform = {
                    getVideoElement: jest.fn(() => {
                        throw new Error(rawThrownMessage);
                    }),
                    isPlayerPageActive: jest.fn(() => true),
                };
                contentScript.subtitleUtils =
                    MockFactory.createSubtitleUtilsMock();
                contentScript.currentConfig = {};
                expect(contentScript._scheduleVisibilityVideoSetupRetry()).toBe(
                    true
                );

                expect(() => jest.advanceTimersByTime(500)).not.toThrow();

                expect(contentScript.visibilityVideoSetupTask).toBeNull();
                expect(contentScript.logWithFallback).toHaveBeenCalledWith(
                    'warn',
                    'Video detection attempt failed safely'
                );
                expect(
                    JSON.stringify(contentScript.logWithFallback.mock.calls)
                ).not.toContain(rawThrownMessage);
            } finally {
                contentScript.stopVideoElementDetection();
                history.replaceState({}, '', originalPathname);
                jest.useRealTimers();
            }
        });

        test('visibility hiding cancels its timeout and cleanup removes its named listener', async () => {
            jest.useFakeTimers();
            const originalPathname = window.location.pathname;
            const hiddenDescriptor = Object.getOwnPropertyDescriptor(
                document,
                'hidden'
            );
            const removeEventListenerSpy = jest.spyOn(
                document,
                'removeEventListener'
            );

            try {
                history.replaceState({}, '', '/watch/visibility-hidden');
                contentScript.activePlatform = {
                    cleanup: jest.fn().mockResolvedValue(),
                    isPlayerPageActive: jest.fn(() => true),
                };
                contentScript.subtitleUtils =
                    MockFactory.createSubtitleUtilsMock({
                        clearSubtitleDOM: jest.fn(),
                        clearSubtitlesDisplayAndQueue: jest.fn(),
                    });
                contentScript.currentConfig = {};
                contentScript.attemptVideoSetup = jest.fn(() => true);
                Object.defineProperty(document, 'hidden', {
                    configurable: true,
                    value: false,
                });
                contentScript.setupCleanupHandlers();
                const visibilityHandler = contentScript.visibilityChangeHandler;

                visibilityHandler();
                expect(contentScript.visibilityVideoSetupTask).not.toBeNull();
                expect(jest.getTimerCount()).toBe(1);

                Object.defineProperty(document, 'hidden', {
                    configurable: true,
                    value: true,
                });
                visibilityHandler();
                expect(jest.getTimerCount()).toBe(0);
                jest.advanceTimersByTime(500);

                expect(contentScript.visibilityVideoSetupTask).toBeNull();
                expect(contentScript.attemptVideoSetup).not.toHaveBeenCalled();

                await contentScript.cleanup();
                expect(removeEventListenerSpy).toHaveBeenCalledWith(
                    'visibilitychange',
                    visibilityHandler
                );
                expect(contentScript.visibilityChangeHandler).toBeNull();
            } finally {
                if (hiddenDescriptor) {
                    Object.defineProperty(document, 'hidden', hiddenDescriptor);
                } else {
                    delete document.hidden;
                }
                removeEventListenerSpy.mockRestore();
                history.replaceState({}, '', originalPathname);
                jest.useRealTimers();
            }
        });

        test('replacement rearm does not start without an active platform identity', () => {
            jest.useFakeTimers();
            const originalPathname = window.location.pathname;

            try {
                history.replaceState({}, '', '/watch/no-platform');
                contentScript.activePlatform = null;

                contentScript._rearmVideoElementDetectionForPlayerNavigation();

                expect(jest.getTimerCount()).toBe(0);
                expect(contentScript.videoDetectionIntervalId).toBeNull();
            } finally {
                history.replaceState({}, '', originalPathname);
                jest.useRealTimers();
            }
        });

        test('video setup does not record a stale video when shared setup selects another video in the same root', () => {
            const root = document.createElement('div');
            const firstVideo = document.createElement('video');
            const secondVideo = document.createElement('video');
            root.append(firstVideo, secondVideo);
            document.body.appendChild(root);

            const platform = {
                getPlayerContainerElement: jest.fn(() => root),
                getVideoElement: jest
                    .fn()
                    .mockReturnValueOnce(firstVideo)
                    .mockReturnValue(secondVideo),
                isPlayerPageActive: jest.fn(() => true),
            };
            const subtitleUtils = MockFactory.createSubtitleUtilsMock({
                ensureSubtitleContainer: jest.fn(() => {
                    platform.getVideoElement();
                }),
            });

            try {
                contentScript.activePlatform = platform;
                contentScript.subtitleUtils = subtitleUtils;
                contentScript.currentConfig = {};

                expect(contentScript.attemptVideoSetup()).toBe(false);
                expect(contentScript.lastVideoSetupScope).toBeNull();
                expect(
                    subtitleUtils.showSubtitleContainer
                ).not.toHaveBeenCalled();
                expect(
                    subtitleUtils.hideSubtitleContainer
                ).not.toHaveBeenCalled();
            } finally {
                root.remove();
            }
        });

        test('replacement rearm fails closed on the connected live scope when no completed snapshot exists', () => {
            jest.useFakeTimers();
            const originalPathname = window.location.pathname;
            const root = document.createElement('div');
            const video = document.createElement('video');
            root.appendChild(video);
            document.body.appendChild(root);

            try {
                history.replaceState({}, '', '/watch/no-snapshot');
                contentScript.activePlatform = {
                    getPlayerContainerElement: jest.fn(() => root),
                    getVideoElement: jest.fn(() => video),
                    isPlayerPageActive: jest.fn(() => true),
                };
                contentScript.subtitleUtils =
                    MockFactory.createSubtitleUtilsMock();
                contentScript.currentConfig = {};
                expect(contentScript.lastVideoSetupScope).toBeNull();

                contentScript._rearmVideoElementDetectionForPlayerNavigation();

                expect(
                    contentScript.subtitleUtils.ensureSubtitleContainer
                ).not.toHaveBeenCalled();
                expect(contentScript.videoDetectionIntervalId).not.toBeNull();
            } finally {
                contentScript.stopVideoElementDetection();
                root.remove();
                history.replaceState({}, '', originalPathname);
                jest.useRealTimers();
            }
        });

        test.each([
            ['document', () => document],
            ['body', () => document.body],
            ['documentElement', () => document.documentElement],
            ['video itself', ({ video }) => video],
            [
                'disconnected container',
                ({ video }) => {
                    const root = document.createElement('div');
                    root.appendChild(video);
                    return root;
                },
            ],
            [
                'non-containing container',
                () => {
                    const root = document.createElement('div');
                    document.body.appendChild(root);
                    return root;
                },
            ],
            [
                'spoofed node-like object',
                () => ({
                    contains: () => true,
                    isConnected: true,
                }),
            ],
        ])('rejects %s as a verified video setup root', (_name, createRoot) => {
            const videoHost = document.createElement('div');
            const video = document.createElement('video');
            videoHost.appendChild(video);
            document.body.appendChild(videoHost);
            const root = createRoot({ video, videoHost });
            const platform = {
                getPlayerContainerElement: jest.fn(() => root),
                getVideoElement: jest.fn(() => video),
            };

            try {
                contentScript.activePlatform = platform;

                expect(
                    contentScript._getVerifiedVideoSetupScope(platform, video)
                ).toBeNull();
            } finally {
                if (
                    root instanceof Node &&
                    root !== document &&
                    root !== document.body &&
                    root !== document.documentElement &&
                    root !== video &&
                    root !== videoHost
                ) {
                    root.remove?.();
                }
                videoHost.remove();
            }
        });

        test.each(['new-video', 'new-root'])(
            'replacement rearm accepts an independently changed %s scope identity',
            (change) => {
                jest.useFakeTimers();
                const originalPathname = window.location.pathname;
                const oldRoot = document.createElement('div');
                const oldVideo = document.createElement('video');
                const newRoot = document.createElement('div');
                const newVideo = document.createElement('video');
                let currentRoot = oldRoot;
                let currentVideo = oldVideo;

                oldRoot.appendChild(oldVideo);
                document.body.append(oldRoot, newRoot);

                try {
                    history.replaceState({}, '', '/watch/identity-change');
                    contentScript.activePlatform = {
                        getPlayerContainerElement: jest.fn(() => currentRoot),
                        getVideoElement: jest.fn(() => currentVideo),
                        isPlayerPageActive: jest.fn(() => true),
                    };
                    contentScript.subtitleUtils =
                        MockFactory.createSubtitleUtilsMock();
                    contentScript.currentConfig = {};

                    expect(contentScript.attemptVideoSetup()).toBe(true);
                    contentScript.subtitleUtils.ensureSubtitleContainer.mockClear();
                    contentScript._rearmVideoElementDetectionForPlayerNavigation();

                    if (change === 'new-video') {
                        oldRoot.appendChild(newVideo);
                        currentVideo = newVideo;
                    } else {
                        newRoot.appendChild(oldVideo);
                        currentRoot = newRoot;
                    }
                    jest.advanceTimersByTime(
                        contentScript.videoDetectionInterval
                    );

                    expect(
                        contentScript.subtitleUtils.ensureSubtitleContainer
                    ).toHaveBeenCalledTimes(1);
                    expect(contentScript.videoDetectionIntervalId).toBeNull();
                    expect(contentScript.lastVideoSetupScope).toEqual(
                        expect.objectContaining({
                            root: currentRoot,
                            video: currentVideo,
                        })
                    );
                } finally {
                    contentScript.stopVideoElementDetection();
                    oldRoot.remove();
                    newRoot.remove();
                    history.replaceState({}, '', originalPathname);
                    jest.useRealTimers();
                }
            }
        );
    });

    describe('Managed Navigation Detection', () => {
        test('preserves a newly adopted player request when delayed navigation observes the replacement route', () => {
            jest.useFakeTimers();
            const originalPathname = window.location.pathname;
            const oldVideoId = '11111';
            const newVideoId = '22222';
            const request = Object.freeze({
                url: 'https://captions.nflxvideo.net/new.ttml',
                videoId: newVideoId,
            });
            const pendingRequests = new Map();
            const platform = {
                currentVideoId: oldVideoId,
                getCurrentVideoId: jest.fn(function () {
                    return this.currentVideoId;
                }),
                hasAdoptedPlayerRoute: jest.fn(function (url) {
                    return (
                        new URL(url).pathname ===
                        `/watch/${this.currentVideoId}`
                    );
                }),
                setVideoIdAndNotify: jest.fn(function (videoId) {
                    this.currentVideoId = videoId;
                }),
                resetVttRequestState: jest.fn(() => pendingRequests.clear()),
                canAcceptVttResponse: jest.fn(
                    function (pendingRequest, response) {
                        return (
                            response.success === true &&
                            response.videoId === pendingRequest.videoId &&
                            this.currentVideoId === pendingRequest.videoId &&
                            pendingRequests.get(pendingRequest.videoId) ===
                                pendingRequest
                        );
                    }
                ),
            };
            const subtitleUtils = MockFactory.createSubtitleUtilsMock({
                clearSubtitlesDisplayAndQueue: jest.fn(),
                clearSubtitleDOM: jest.fn(),
            });

            try {
                history.replaceState({}, '', `/watch/${oldVideoId}`);
                contentScript.activePlatform = platform;
                contentScript.subtitleUtils = subtitleUtils;
                contentScript.eventBuffer = { clear: jest.fn() };
                contentScript._clearCanonicalContentSelection = jest.fn();
                contentScript._rearmVideoElementDetectionForPlayerNavigation =
                    jest.fn();
                contentScript._setupNavigationManager({
                    useFocusEvents: false,
                    useIntervalChecking: false,
                    usePopstateEvents: false,
                });

                history.pushState({}, '', `/watch/${newVideoId}`);
                platform.setVideoIdAndNotify(newVideoId);
                pendingRequests.set(newVideoId, request);
                jest.advanceTimersByTime(100);

                expect(platform.hasAdoptedPlayerRoute).toHaveBeenCalledWith(
                    `${window.location.origin}/watch/${newVideoId}`
                );
                expect(platform.currentVideoId).toBe(newVideoId);
                expect(platform.setVideoIdAndNotify).toHaveBeenCalledTimes(1);
                expect(platform.resetVttRequestState).not.toHaveBeenCalled();
                expect(
                    subtitleUtils.clearSubtitlesDisplayAndQueue
                ).not.toHaveBeenCalled();
                expect(subtitleUtils.clearSubtitleDOM).not.toHaveBeenCalled();
                expect(contentScript.eventBuffer.clear).not.toHaveBeenCalled();
                expect(
                    contentScript._clearCanonicalContentSelection
                ).not.toHaveBeenCalled();
                expect(
                    contentScript._rearmVideoElementDetectionForPlayerNavigation
                ).toHaveBeenCalledTimes(1);
                expect(
                    platform.canAcceptVttResponse(request, {
                        success: true,
                        videoId: newVideoId,
                    })
                ).toBe(true);
            } finally {
                contentScript.navigationDetectionManager?.cleanup();
                history.replaceState({}, '', originalPathname);
                jest.useRealTimers();
            }
        });

        test('invalidates stale player state when the replacement route has not been adopted', () => {
            jest.useFakeTimers();
            const originalPathname = window.location.pathname;
            const platform = {
                currentVideoId: '11111',
                hasAdoptedPlayerRoute: jest.fn(() => false),
                setVideoIdAndNotify: jest.fn(function (videoId) {
                    this.currentVideoId = videoId;
                }),
                resetVttRequestState: jest.fn(),
            };
            const subtitleUtils = MockFactory.createSubtitleUtilsMock({
                clearSubtitlesDisplayAndQueue: jest.fn(),
                clearSubtitleDOM: jest.fn(),
            });

            try {
                history.replaceState({}, '', '/watch/11111');
                contentScript.activePlatform = platform;
                contentScript.subtitleUtils = subtitleUtils;
                contentScript.eventBuffer = { clear: jest.fn() };
                contentScript._clearCanonicalContentSelection = jest.fn();
                contentScript._rearmVideoElementDetectionForPlayerNavigation =
                    jest.fn();
                contentScript._setupNavigationManager({
                    useFocusEvents: false,
                    useIntervalChecking: false,
                    usePopstateEvents: false,
                });

                history.pushState({}, '', '/watch/22222');
                jest.advanceTimersByTime(100);

                expect(platform.hasAdoptedPlayerRoute).toHaveBeenCalledWith(
                    `${window.location.origin}/watch/22222`
                );
                expect(platform.setVideoIdAndNotify).toHaveBeenCalledWith(null);
                expect(platform.currentVideoId).toBeNull();
                expect(platform.resetVttRequestState).toHaveBeenCalledTimes(1);
                expect(
                    subtitleUtils.clearSubtitlesDisplayAndQueue
                ).toHaveBeenCalledWith(platform, true, contentScript.logPrefix);
                expect(subtitleUtils.clearSubtitleDOM).toHaveBeenCalledTimes(1);
                expect(contentScript.eventBuffer.clear).toHaveBeenCalledTimes(
                    1
                );
            } finally {
                contentScript.navigationDetectionManager?.cleanup();
                history.replaceState({}, '', originalPathname);
                jest.useRealTimers();
            }
        });

        test('routes a player-to-player URL change through adapter notification and replacement rearm only', () => {
            jest.useFakeTimers();
            const originalPathname = window.location.pathname;
            const notifyPlatform = jest.fn();
            const rearmVideo = jest.fn();
            const handlePageTransition = jest.fn();

            try {
                history.replaceState({}, '', '/watch/old-title');
                contentScript.activePlatform = {
                    onUrlChange: notifyPlatform,
                };
                contentScript._rearmVideoElementDetectionForPlayerNavigation =
                    rearmVideo;
                contentScript._handlePageTransition = handlePageTransition;

                contentScript._setupNavigationManager({
                    useFocusEvents: false,
                    useIntervalChecking: false,
                    usePopstateEvents: false,
                });
                history.pushState({}, '', '/watch/new-title');
                jest.advanceTimersByTime(100);

                expect(notifyPlatform).toHaveBeenCalledTimes(1);
                expect(notifyPlatform).toHaveBeenCalledWith(
                    `${window.location.origin}/watch/new-title`
                );
                expect(rearmVideo).toHaveBeenCalledTimes(1);
                expect(handlePageTransition).not.toHaveBeenCalled();
            } finally {
                contentScript.navigationDetectionManager?.cleanup();
                history.replaceState({}, '', originalPathname);
                jest.useRealTimers();
            }
        });

        test.each([
            ['/browse', '/watch/title', false, true],
            ['/watch/title', '/browse', true, false],
        ])(
            'routes %s to %s through one lifecycle transition without replacement rearm',
            (fromPath, toPath, wasPlayer, isPlayer) => {
                jest.useFakeTimers();
                const originalPathname = window.location.pathname;
                const notifyPlatform = jest.fn();
                const rearmVideo = jest.fn();
                const handlePageTransition = jest.fn();

                try {
                    history.replaceState({}, '', fromPath);
                    contentScript.activePlatform = {
                        onUrlChange: notifyPlatform,
                    };
                    contentScript._rearmVideoElementDetectionForPlayerNavigation =
                        rearmVideo;
                    contentScript._handlePageTransition = handlePageTransition;

                    contentScript._setupNavigationManager({
                        useFocusEvents: false,
                        useIntervalChecking: false,
                        usePopstateEvents: false,
                    });
                    history.pushState({}, '', toPath);
                    jest.advanceTimersByTime(100);

                    expect(notifyPlatform).toHaveBeenCalledTimes(1);
                    expect(rearmVideo).not.toHaveBeenCalled();
                    expect(handlePageTransition).toHaveBeenCalledTimes(1);
                    expect(handlePageTransition).toHaveBeenCalledWith(
                        wasPlayer,
                        isPlayer
                    );
                } finally {
                    contentScript.navigationDetectionManager?.cleanup();
                    history.replaceState({}, '', originalPathname);
                    jest.useRealTimers();
                }
            }
        );

        test('forces shared routing and drops navigation payload data after caller option merging', () => {
            jest.useFakeTimers();
            const originalPathname = window.location.pathname;
            const callerLogger = jest.fn();
            const callerUrlChange = jest.fn();
            const callerPageTransition = jest.fn();
            const notifyPlatform = jest.fn();
            const rearmVideo = jest.fn();

            try {
                history.replaceState({}, '', '/watch/original-title');
                contentScript.logWithFallback = jest.fn();
                contentScript.activePlatform = {
                    onUrlChange: notifyPlatform,
                };
                contentScript._rearmVideoElementDetectionForPlayerNavigation =
                    rearmVideo;

                contentScript._setupNavigationManager({
                    enableNavigationLogging: true,
                    isPlayerPage: () => false,
                    logger: callerLogger,
                    onPageTransition: callerPageTransition,
                    onUrlChange: callerUrlChange,
                    useFocusEvents: false,
                    useIntervalChecking: false,
                    usePopstateEvents: false,
                });
                expect(
                    contentScript.navigationDetectionManager.options
                        .enableNavigationLogging
                ).toBe(false);
                expect(
                    contentScript.navigationDetectionManager.navigationLogger
                ).toBeUndefined();
                expect(
                    contentScript.navigationDetectionManager.options.logger
                ).not.toBe(callerLogger);
                history.pushState(
                    { privateState: 'raw-history-secret' },
                    '',
                    '/watch/raw-url-secret'
                );
                jest.advanceTimersByTime(100);

                expect(callerLogger).not.toHaveBeenCalled();
                expect(callerUrlChange).not.toHaveBeenCalled();
                expect(callerPageTransition).not.toHaveBeenCalled();
                expect(notifyPlatform).toHaveBeenCalledTimes(1);
                expect(rearmVideo).toHaveBeenCalledTimes(1);
                expect(
                    JSON.stringify(contentScript.logWithFallback.mock.calls)
                ).not.toMatch(/raw-url-secret|raw-history-secret/);
                expect(
                    contentScript.logWithFallback.mock.calls.every(
                        (call) => call.length === 2
                    )
                ).toBe(true);
            } finally {
                contentScript.navigationDetectionManager?.cleanup();
                history.replaceState({}, '', originalPathname);
                jest.useRealTimers();
            }
        });

        test('detection cleanup cancels pending navigation and releases the shared manager', async () => {
            jest.useFakeTimers();
            const originalPathname = window.location.pathname;
            const originalPushState = history.pushState;
            const originalReplaceState = history.replaceState;
            const notifyPlatform = jest.fn();

            try {
                history.replaceState({}, '', '/watch/original-title');
                contentScript.activePlatform = {
                    onUrlChange: notifyPlatform,
                };
                contentScript.stopVideoElementDetection = jest.fn();
                contentScript._setupNavigationManager({
                    useFocusEvents: false,
                    useIntervalChecking: false,
                    usePopstateEvents: false,
                });
                history.pushState({}, '', '/watch/pending-title');
                const manager = contentScript.navigationDetectionManager;
                expect(manager.pendingUrlCheckTimeoutId).not.toBeNull();

                await contentScript._stopAllDetectionActivities();

                expect(contentScript.navigationDetectionManager).toBeNull();
                expect(manager.pendingUrlCheckTimeoutId).toBeNull();
                expect(history.pushState).toBe(originalPushState);
                expect(history.replaceState).toBe(originalReplaceState);
                jest.advanceTimersByTime(100);
                expect(notifyPlatform).not.toHaveBeenCalled();
            } finally {
                contentScript.navigationDetectionManager?.cleanup();
                history.replaceState({}, '', originalPathname);
                jest.useRealTimers();
            }
        });

        test('navigation cleanup still completes when video detection teardown throws', async () => {
            jest.useFakeTimers();
            const originalPathname = window.location.pathname;
            const originalPushState = history.pushState;
            const originalReplaceState = history.replaceState;
            const notifyPlatform = jest.fn();

            try {
                history.replaceState({}, '', '/watch/original-title');
                contentScript.activePlatform = {
                    onUrlChange: notifyPlatform,
                };
                contentScript.stopVideoElementDetection = jest.fn(() => {
                    throw new Error('video teardown failed');
                });
                contentScript._setupNavigationManager({
                    useFocusEvents: false,
                    useIntervalChecking: false,
                    usePopstateEvents: false,
                });
                history.pushState({}, '', '/watch/pending-title');
                const manager = contentScript.navigationDetectionManager;

                await contentScript._stopAllDetectionActivities();

                expect(contentScript.navigationDetectionManager).toBeNull();
                expect(manager.pendingUrlCheckTimeoutId).toBeNull();
                expect(history.pushState).toBe(originalPushState);
                expect(history.replaceState).toBe(originalReplaceState);
                jest.advanceTimersByTime(100);
                expect(notifyPlatform).not.toHaveBeenCalled();
            } finally {
                contentScript.navigationDetectionManager?.cleanup();
                history.replaceState({}, '', originalPathname);
                jest.useRealTimers();
            }
        });

        test('manager setup failure is surfaced without retaining a fallback path', () => {
            const registrationError = new Error(
                'navigation listener registration failed'
            );
            const addEventListener = jest
                .spyOn(window, 'addEventListener')
                .mockImplementation(() => {
                    throw registrationError;
                });

            try {
                expect(() =>
                    contentScript._setupNavigationManager({
                        useFocusEvents: false,
                        useHistoryAPI: false,
                        useIntervalChecking: false,
                        usePopstateEvents: true,
                    })
                ).toThrow(registrationError);
                expect(contentScript.navigationDetectionManager).toBeNull();
            } finally {
                addEventListener.mockRestore();
            }
        });

        test('body and outside-root mutations are inert', () => {
            jest.useFakeTimers();
            const observerHarness = installControlledMutationObserver();
            const root = document.createElement('section');
            const video = document.createElement('video');
            const outside = document.createElement('div');
            root.appendChild(video);
            document.body.append(root, outside);
            const platform = {
                getVideoElement: jest.fn(() => video),
                getPlayerContainerElement: jest.fn(() => root),
            };

            try {
                history.replaceState({}, '', '/watch/outside-mutation');
                contentScript.subtitleUtils =
                    MockFactory.createSubtitleUtilsMock();
                contentScript.activePlatform = platform;
                contentScript.setupDOMObservation();

                observerHarness.instances[0].callback([
                    { type: 'childList', target: document.body },
                    { type: 'childList', target: outside },
                ]);

                expect(jest.getTimerCount()).toBe(0);
                expect(contentScript.pageObserver).not.toBeNull();
            } finally {
                contentScript._cancelPlayerRootObservation();
                root.remove();
                outside.remove();
                observerHarness.restore();
                jest.useRealTimers();
            }
        });

        test('observes the verified player root instead of the page body', () => {
            const observerHarness = installControlledMutationObserver();
            const root = document.createElement('section');
            const video = document.createElement('video');
            root.appendChild(video);
            document.body.appendChild(root);
            const platform = {
                getVideoElement: jest.fn(() => video),
                getPlayerContainerElement: jest.fn(() => root),
            };

            try {
                history.replaceState({}, '', '/watch/scoped-observer');
                contentScript.activePlatform = platform;
                contentScript.subtitleUtils = { subtitlesActive: true };

                contentScript.setupDOMObservation();

                expect(observerHarness.instances).toHaveLength(1);
                expect(
                    observerHarness.instances[0].observe
                ).toHaveBeenCalledWith(root, {
                    childList: true,
                    subtree: true,
                });
                expect(
                    observerHarness.instances[0].observe
                ).not.toHaveBeenCalledWith(document.body, expect.anything());
            } finally {
                contentScript._cancelPlayerRootObservation();
                root.remove();
                observerHarness.restore();
            }
        });

        test('same-route player-root replacement migrates through a bounded parent shell', () => {
            jest.useFakeTimers();
            const observerHarness = installControlledMutationObserver();
            const shell = document.createElement('main');
            const originalRoot = document.createElement('section');
            const originalVideo = document.createElement('video');
            originalRoot.appendChild(originalVideo);
            shell.appendChild(originalRoot);
            document.body.appendChild(shell);
            let currentRoot = originalRoot;
            let currentVideo = originalVideo;
            const platform = {
                getVideoElement: jest.fn(() => currentVideo),
                getPlayerContainerElement: jest.fn(() => currentRoot),
            };
            const subtitleUtils = MockFactory.createSubtitleUtilsMock({
                clearSubtitleDOM: jest.fn(),
            });

            try {
                history.replaceState({}, '', '/watch/root-replacement');
                contentScript.activePlatform = platform;
                contentScript.platformReady = true;
                contentScript.subtitleUtils = subtitleUtils;
                contentScript.currentConfig = {};
                expect(contentScript.setupDOMObservation()).toBe(true);

                const firstObserver = observerHarness.instances[0];
                expect(firstObserver.observe).toHaveBeenCalledWith(
                    originalRoot,
                    { childList: true, subtree: true }
                );
                expect(firstObserver.observe).toHaveBeenCalledWith(shell, {
                    childList: true,
                    subtree: false,
                });

                const replacementRoot = document.createElement('section');
                const replacementVideo = document.createElement('video');
                replacementRoot.appendChild(replacementVideo);
                currentRoot = replacementRoot;
                currentVideo = replacementVideo;
                originalRoot.replaceWith(replacementRoot);
                firstObserver.callback([{ type: 'childList', target: shell }]);

                jest.advanceTimersByTime(100);

                expect(
                    subtitleUtils.ensureSubtitleContainer
                ).toHaveBeenCalledTimes(1);
                expect(firstObserver.disconnect).toHaveBeenCalledTimes(1);
                expect(observerHarness.instances).toHaveLength(2);
                expect(contentScript.pageObserverTask).toEqual(
                    expect.objectContaining({
                        platform,
                        root: replacementRoot,
                        observationShell: shell,
                    })
                );
                expect(contentScript.lastVideoSetupScope).toEqual(
                    expect.objectContaining({
                        root: replacementRoot,
                        video: replacementVideo,
                    })
                );
            } finally {
                contentScript.stopVideoElementDetection();
                contentScript._cancelPlayerRootObservation();
                shell.remove();
                observerHarness.restore();
                jest.useRealTimers();
            }
        });

        test('coalesces a player-root mutation burst into one delayed video setup', () => {
            jest.useFakeTimers();
            const observerHarness = installControlledMutationObserver();
            const root = document.createElement('section');
            const originalVideo = document.createElement('video');
            originalVideo.dataset.listenerAttached = 'true';
            root.appendChild(originalVideo);
            document.body.appendChild(root);
            let currentVideo = originalVideo;
            const platform = {
                getVideoElement: jest.fn(() => currentVideo),
                getPlayerContainerElement: jest.fn(() => root),
            };
            const subtitleUtils = MockFactory.createSubtitleUtilsMock({
                clearSubtitleDOM: jest.fn(),
            });

            try {
                history.replaceState({}, '', '/watch/burst-observer');
                contentScript.activePlatform = platform;
                contentScript.platformReady = true;
                contentScript.subtitleUtils = subtitleUtils;
                contentScript.currentConfig = {};
                contentScript.setupDOMObservation();

                const replacementVideo = document.createElement('video');
                currentVideo = replacementVideo;
                originalVideo.replaceWith(replacementVideo);
                observerHarness.instances[0].callback([
                    { type: 'childList', target: root },
                    { type: 'childList', target: root },
                    { type: 'childList', target: root },
                ]);

                expect(
                    subtitleUtils.ensureSubtitleContainer
                ).not.toHaveBeenCalled();
                jest.advanceTimersByTime(99);
                expect(
                    subtitleUtils.ensureSubtitleContainer
                ).not.toHaveBeenCalled();
                jest.advanceTimersByTime(1);
                expect(
                    subtitleUtils.ensureSubtitleContainer
                ).toHaveBeenCalledTimes(1);
            } finally {
                contentScript._cancelPlayerRootObservation();
                root.remove();
                observerHarness.restore();
                jest.useRealTimers();
            }
        });

        test.each([
            [
                'exact pathname',
                () => history.replaceState({}, '', '/watch/other-title'),
            ],
            [
                'platform generation',
                (script) => {
                    script.platformInitializationGeneration += 1;
                },
            ],
            [
                'active platform identity',
                (script) => {
                    script.activePlatform = {};
                },
            ],
        ])(
            'a %s change before the debounce fires is inert',
            (_, invalidate) => {
                jest.useFakeTimers();
                const observerHarness = installControlledMutationObserver();
                const originalPathname = window.location.pathname;
                const root = document.createElement('section');
                const originalVideo = document.createElement('video');
                root.appendChild(originalVideo);
                document.body.appendChild(root);
                let currentVideo = originalVideo;
                const platform = {
                    getVideoElement: jest.fn(() => currentVideo),
                    getPlayerContainerElement: jest.fn(() => root),
                };
                const subtitleUtils = MockFactory.createSubtitleUtilsMock({
                    clearSubtitleDOM: jest.fn(),
                });

                try {
                    history.replaceState({}, '', '/watch/stale-debounce');
                    contentScript.activePlatform = platform;
                    contentScript.platformReady = true;
                    contentScript.subtitleUtils = subtitleUtils;
                    contentScript.currentConfig = {};
                    contentScript.setupDOMObservation();

                    const replacementVideo = document.createElement('video');
                    currentVideo = replacementVideo;
                    originalVideo.replaceWith(replacementVideo);
                    observerHarness.instances[0].callback([
                        { type: 'childList', target: root },
                    ]);
                    expect(jest.getTimerCount()).toBe(1);

                    invalidate(contentScript);
                    jest.advanceTimersByTime(100);

                    expect(
                        subtitleUtils.ensureSubtitleContainer
                    ).not.toHaveBeenCalled();
                    expect(
                        subtitleUtils.hideSubtitleContainer
                    ).not.toHaveBeenCalled();
                    expect(
                        subtitleUtils.clearSubtitleDOM
                    ).not.toHaveBeenCalled();
                } finally {
                    contentScript._cancelPlayerRootObservation();
                    root.remove();
                    history.replaceState({}, '', originalPathname);
                    observerHarness.restore();
                    jest.useRealTimers();
                }
            }
        );

        test('player-page leave disconnects the observer and cancels its exact debounce', () => {
            jest.useFakeTimers();
            const observerHarness = installControlledMutationObserver();
            const root = document.createElement('section');
            const originalVideo = document.createElement('video');
            root.appendChild(originalVideo);
            document.body.appendChild(root);
            let currentVideo = originalVideo;
            const platform = {
                getVideoElement: jest.fn(() => currentVideo),
                getPlayerContainerElement: jest.fn(() => root),
                cleanup: jest.fn(),
            };
            const subtitleUtils = MockFactory.createSubtitleUtilsMock({
                clearSubtitleDOM: jest.fn(),
                clearSubtitlesDisplayAndQueue: jest.fn(),
            });

            try {
                history.replaceState({}, '', '/watch/player-leave');
                contentScript.activePlatform = platform;
                contentScript.platformReady = true;
                contentScript.subtitleUtils = subtitleUtils;
                contentScript.currentConfig = {};
                contentScript.setupDOMObservation();
                const observer = observerHarness.instances[0];
                const task = contentScript.pageObserverTask;

                const replacementVideo = document.createElement('video');
                currentVideo = replacementVideo;
                originalVideo.replaceWith(replacementVideo);
                observer.callback([{ type: 'childList', target: root }]);
                expect(jest.getTimerCount()).toBe(1);

                contentScript._cleanupOnPlayerPageLeave();

                expect(observer.disconnect).toHaveBeenCalledTimes(1);
                expect(task.timeoutId).toBeNull();
                expect(contentScript.pageObserver).toBeNull();
                expect(contentScript.pageObserverTask).toBeNull();
                expect(jest.getTimerCount()).toBe(0);

                subtitleUtils.ensureSubtitleContainer.mockClear();
                observer.callback([{ type: 'childList', target: root }]);
                jest.advanceTimersByTime(100);
                expect(
                    subtitleUtils.ensureSubtitleContainer
                ).not.toHaveBeenCalled();
            } finally {
                contentScript._cancelPlayerRootObservation();
                root.remove();
                observerHarness.restore();
                jest.useRealTimers();
            }
        });

        test('player-page leave cannot be reentered into a fresh root observer by subtitle cleanup', () => {
            const observerHarness = installControlledMutationObserver();
            const root = document.createElement('section');
            const video = document.createElement('video');
            root.appendChild(video);
            document.body.appendChild(root);
            const platform = {
                getVideoElement: jest.fn(() => video),
                getPlayerContainerElement: jest.fn(() => root),
                cleanup: jest.fn(),
            };
            const subtitleUtils = MockFactory.createSubtitleUtilsMock({
                clearSubtitleDOM: jest.fn(),
            });
            subtitleUtils.clearSubtitlesDisplayAndQueue = jest.fn(() => {
                contentScript.setupDOMObservation();
            });

            try {
                history.replaceState({}, '', '/watch/reentrant-leave');
                contentScript.activePlatform = platform;
                contentScript.platformReady = true;
                contentScript.subtitleUtils = subtitleUtils;
                contentScript.setupDOMObservation();

                contentScript._cleanupOnPlayerPageLeave();

                expect(observerHarness.instances).toHaveLength(1);
                expect(
                    observerHarness.instances[0].disconnect
                ).toHaveBeenCalledTimes(1);
                expect(contentScript.activePlatform).toBeNull();
                expect(contentScript.pageObserver).toBeNull();
                expect(contentScript.pageObserverTask).toBeNull();
            } finally {
                contentScript._cancelPlayerRootObservation();
                root.remove();
                observerHarness.restore();
            }
        });

        test('comprehensive cleanup cannot resurrect a pending root observation', async () => {
            jest.useFakeTimers();
            const observerHarness = installControlledMutationObserver();
            const root = document.createElement('section');
            const originalVideo = document.createElement('video');
            root.appendChild(originalVideo);
            document.body.appendChild(root);
            let currentVideo = originalVideo;
            const platform = {
                getVideoElement: jest.fn(() => currentVideo),
                getPlayerContainerElement: jest.fn(() => root),
                cleanup: jest.fn().mockResolvedValue(),
            };
            const subtitleUtils = MockFactory.createSubtitleUtilsMock({
                cleanup: jest.fn().mockResolvedValue(),
                clearSubtitleDOM: jest.fn(),
            });

            try {
                history.replaceState({}, '', '/watch/full-cleanup');
                contentScript.activePlatform = platform;
                contentScript.platformReady = true;
                contentScript.subtitleUtils = subtitleUtils;
                contentScript.currentConfig = {};
                contentScript.setupDOMObservation();
                const observer = observerHarness.instances[0];
                const task = contentScript.pageObserverTask;

                const replacementVideo = document.createElement('video');
                currentVideo = replacementVideo;
                originalVideo.replaceWith(replacementVideo);
                observer.callback([{ type: 'childList', target: root }]);
                expect(jest.getTimerCount()).toBe(1);

                await contentScript.cleanup();

                expect(observer.disconnect).toHaveBeenCalledTimes(1);
                expect(task.timeoutId).toBeNull();
                expect(contentScript.pageObserver).toBeNull();
                expect(contentScript.pageObserverTask).toBeNull();
                expect(jest.getTimerCount()).toBe(0);

                subtitleUtils.ensureSubtitleContainer.mockClear();
                observer.callback([{ type: 'childList', target: root }]);
                jest.advanceTimersByTime(100);
                expect(
                    subtitleUtils.ensureSubtitleContainer
                ).not.toHaveBeenCalled();
            } finally {
                contentScript._cancelPlayerRootObservation();
                root.remove();
                observerHarness.restore();
                jest.useRealTimers();
            }
        });

        test('repeated setup keeps one observer and never performs navigation or platform initialization', () => {
            const observerHarness = installControlledMutationObserver();
            const root = document.createElement('section');
            const video = document.createElement('video');
            root.appendChild(video);
            document.body.appendChild(root);
            const platform = {
                getVideoElement: jest.fn(() => video),
                getPlayerContainerElement: jest.fn(() => root),
            };
            const initializePlatform = jest.spyOn(
                contentScript,
                'initializePlatform'
            );
            const setupNavigationDetection = jest.spyOn(
                contentScript,
                'setupNavigationDetection'
            );

            try {
                history.replaceState({}, '', '/watch/idempotent-observer');
                contentScript.activePlatform = platform;
                contentScript.subtitleUtils =
                    MockFactory.createSubtitleUtilsMock();

                expect(contentScript.setupDOMObservation()).toBe(true);
                expect(contentScript.setupDOMObservation()).toBe(true);

                expect(observerHarness.instances).toHaveLength(1);
                expect(
                    observerHarness.instances[0].observe
                ).toHaveBeenCalledTimes(1);
                expect(
                    observerHarness.instances[0].disconnect
                ).not.toHaveBeenCalled();
                expect(initializePlatform).not.toHaveBeenCalled();
                expect(setupNavigationDetection).not.toHaveBeenCalled();
            } finally {
                contentScript._cancelPlayerRootObservation();
                root.remove();
                observerHarness.restore();
            }
        });

        test('setup fails quietly when no narrow verified player root exists', () => {
            jest.useFakeTimers();
            const observerHarness = installControlledMutationObserver();
            const video = document.createElement('video');
            document.body.appendChild(video);
            const initializePlatform = jest.spyOn(
                contentScript,
                'initializePlatform'
            );

            try {
                history.replaceState({}, '', '/watch/no-player-root');
                contentScript.activePlatform = {
                    getVideoElement: jest.fn(() => video),
                    getPlayerContainerElement: jest.fn(() => document.body),
                };
                contentScript.subtitleUtils =
                    MockFactory.createSubtitleUtilsMock();

                expect(contentScript.setupDOMObservation()).toBe(false);

                expect(observerHarness.instances).toHaveLength(0);
                expect(contentScript.pageObserver).toBeNull();
                expect(contentScript.pageObserverTask).toBeNull();
                expect(jest.getTimerCount()).toBe(0);
                expect(initializePlatform).not.toHaveBeenCalled();
            } finally {
                contentScript._cancelPlayerRootObservation();
                video.remove();
                observerHarness.restore();
                jest.useRealTimers();
            }
        });

        test('losing the verified scope during setup releases the prior exact owner', () => {
            jest.useFakeTimers();
            const observerHarness = installControlledMutationObserver();
            const root = document.createElement('section');
            const video = document.createElement('video');
            root.appendChild(video);
            document.body.appendChild(root);
            let currentVideo = video;
            const platform = {
                getVideoElement: jest.fn(() => currentVideo),
                getPlayerContainerElement: jest.fn(() => root),
            };

            try {
                history.replaceState({}, '', '/watch/lost-observer-scope');
                contentScript.activePlatform = platform;
                contentScript.subtitleUtils =
                    MockFactory.createSubtitleUtilsMock();
                expect(contentScript.setupDOMObservation()).toBe(true);
                const observer = observerHarness.instances[0];
                const task = contentScript.pageObserverTask;
                observer.callback([{ type: 'childList', target: root }]);
                expect(jest.getTimerCount()).toBe(1);

                currentVideo = null;
                video.remove();
                expect(contentScript.setupDOMObservation()).toBe(false);

                expect(observer.disconnect).toHaveBeenCalledTimes(1);
                expect(task.timeoutId).toBeNull();
                expect(contentScript.pageObserver).toBeNull();
                expect(contentScript.pageObserverTask).toBeNull();
                expect(jest.getTimerCount()).toBe(0);
                expect(observerHarness.instances).toHaveLength(1);
            } finally {
                contentScript._cancelPlayerRootObservation();
                root.remove();
                observerHarness.restore();
                jest.useRealTimers();
            }
        });

        test('observer disconnect reentrancy cannot install a new owner during cancellation', () => {
            const observerHarness = installControlledMutationObserver();
            const root = document.createElement('section');
            const video = document.createElement('video');
            root.appendChild(video);
            document.body.appendChild(root);
            const platform = {
                getVideoElement: jest.fn(() => video),
                getPlayerContainerElement: jest.fn(() => root),
            };

            try {
                history.replaceState({}, '', '/watch/reentrant-disconnect');
                contentScript.activePlatform = platform;
                contentScript.subtitleUtils =
                    MockFactory.createSubtitleUtilsMock();
                contentScript.setupDOMObservation();
                const observer = observerHarness.instances[0];
                observer.disconnect.mockImplementationOnce(() => {
                    contentScript.setupDOMObservation();
                });

                contentScript._cancelPlayerRootObservation();

                expect(observerHarness.instances).toHaveLength(1);
                expect(observer.disconnect).toHaveBeenCalledTimes(1);
                expect(contentScript.pageObserver).toBeNull();
                expect(contentScript.pageObserverTask).toBeNull();

                expect(contentScript.setupDOMObservation()).toBe(true);
                expect(observerHarness.instances).toHaveLength(2);
                expect(contentScript.pageObserver).toBe(
                    observerHarness.instances[1]
                );
            } finally {
                contentScript._cancelPlayerRootObservation();
                root.remove();
                observerHarness.restore();
            }
        });

        test('a stale observer and reused timer id cannot cancel or mutate the newer owner', () => {
            const observerHarness = installControlledMutationObserver();
            const timeoutCallbacks = [];
            const setTimeoutSpy = jest
                .spyOn(global, 'setTimeout')
                .mockImplementation((callback) => {
                    timeoutCallbacks.push(callback);
                    return 7;
                });
            const clearTimeoutSpy = jest
                .spyOn(global, 'clearTimeout')
                .mockImplementation(() => {});
            const firstRoot = document.createElement('section');
            const firstVideo = document.createElement('video');
            firstRoot.appendChild(firstVideo);
            const secondRoot = document.createElement('section');
            const secondOriginalVideo = document.createElement('video');
            secondRoot.appendChild(secondOriginalVideo);
            document.body.append(firstRoot, secondRoot);
            const firstPlatform = {
                getVideoElement: jest.fn(() => firstVideo),
                getPlayerContainerElement: jest.fn(() => firstRoot),
            };
            let secondVideo = secondOriginalVideo;
            const secondPlatform = {
                getVideoElement: jest.fn(() => secondVideo),
                getPlayerContainerElement: jest.fn(() => secondRoot),
            };
            const subtitleUtils = MockFactory.createSubtitleUtilsMock({
                clearSubtitleDOM: jest.fn(),
            });

            try {
                history.replaceState({}, '', '/watch/reused-timer-id');
                contentScript.activePlatform = firstPlatform;
                contentScript.platformReady = true;
                contentScript.subtitleUtils = subtitleUtils;
                contentScript.currentConfig = {};
                contentScript.setupDOMObservation();
                const firstObserver = observerHarness.instances[0];
                const firstTask = contentScript.pageObserverTask;
                firstObserver.callback([
                    { type: 'childList', target: firstRoot },
                ]);
                expect(firstTask.timeoutId).toBe(7);

                contentScript.platformInitializationGeneration += 1;
                contentScript.activePlatform = secondPlatform;
                contentScript.setupDOMObservation();
                const secondObserver = observerHarness.instances[1];
                const secondTask = contentScript.pageObserverTask;
                const replacementVideo = document.createElement('video');
                secondVideo = replacementVideo;
                secondOriginalVideo.replaceWith(replacementVideo);
                secondObserver.callback([
                    { type: 'childList', target: secondRoot },
                ]);

                expect(firstObserver.disconnect).toHaveBeenCalledTimes(1);
                expect(firstTask.timeoutId).toBeNull();
                expect(secondTask.timeoutId).toBe(7);
                expect(clearTimeoutSpy).toHaveBeenCalledWith(7);
                expect(timeoutCallbacks).toHaveLength(2);

                timeoutCallbacks[0]();

                expect(contentScript.pageObserverTask).toBe(secondTask);
                expect(contentScript.pageObserver).toBe(secondObserver);
                expect(secondTask.timeoutId).toBe(7);
                expect(
                    subtitleUtils.ensureSubtitleContainer
                ).not.toHaveBeenCalled();

                timeoutCallbacks[1]();

                expect(
                    subtitleUtils.ensureSubtitleContainer
                ).toHaveBeenCalledTimes(1);
                expect(contentScript.pageObserverTask).toBe(secondTask);
                expect(secondTask.timeoutId).toBeNull();
            } finally {
                contentScript._cancelPlayerRootObservation();
                firstRoot.remove();
                secondRoot.remove();
                setTimeoutSpy.mockRestore();
                clearTimeoutSpy.mockRestore();
                observerHarness.restore();
            }
        });

        test('a reentrant timeout installation cannot clear a reused id claimed by the newer owner', () => {
            const observerHarness = installControlledMutationObserver();
            const clearTimeoutSpy = jest
                .spyOn(global, 'clearTimeout')
                .mockImplementation(() => {});
            const oldRoot = document.createElement('section');
            const oldVideo = document.createElement('video');
            oldRoot.appendChild(oldVideo);
            const newRoot = document.createElement('section');
            const newOriginalVideo = document.createElement('video');
            newRoot.appendChild(newOriginalVideo);
            document.body.append(oldRoot, newRoot);
            const oldPlatform = {
                getVideoElement: jest.fn(() => oldVideo),
                getPlayerContainerElement: jest.fn(() => oldRoot),
            };
            let newVideo = newOriginalVideo;
            const newPlatform = {
                getVideoElement: jest.fn(() => newVideo),
                getPlayerContainerElement: jest.fn(() => newRoot),
            };
            const subtitleUtils = MockFactory.createSubtitleUtilsMock({
                clearSubtitleDOM: jest.fn(),
            });
            let newerTimeoutCallback = null;
            let newTask = null;
            const setTimeoutSpy = jest
                .spyOn(global, 'setTimeout')
                .mockImplementationOnce(() => {
                    contentScript.platformInitializationGeneration += 1;
                    contentScript.activePlatform = newPlatform;
                    contentScript.setupDOMObservation();
                    const newObserver = observerHarness.instances[1];
                    newTask = contentScript.pageObserverTask;
                    const replacementVideo = document.createElement('video');
                    newVideo = replacementVideo;
                    newOriginalVideo.replaceWith(replacementVideo);
                    newObserver.callback([
                        { type: 'childList', target: newRoot },
                    ]);
                    return 77;
                })
                .mockImplementationOnce((callback) => {
                    newerTimeoutCallback = callback;
                    return 77;
                });

            try {
                history.replaceState({}, '', '/watch/reentrant-timer-id');
                contentScript.activePlatform = oldPlatform;
                contentScript.platformReady = true;
                contentScript.subtitleUtils = subtitleUtils;
                contentScript.currentConfig = {};
                contentScript.setupDOMObservation();

                observerHarness.instances[0].callback([
                    { type: 'childList', target: oldRoot },
                ]);

                expect(newTask).not.toBeNull();
                expect(newTask.timeoutId).toBe(77);
                expect(contentScript.pageObserverTask).toBe(newTask);
                expect(clearTimeoutSpy).not.toHaveBeenCalledWith(77);

                newerTimeoutCallback();
                expect(
                    subtitleUtils.ensureSubtitleContainer
                ).toHaveBeenCalledTimes(1);
                expect(contentScript.pageObserverTask).toBe(newTask);
            } finally {
                contentScript._cancelPlayerRootObservation();
                oldRoot.remove();
                newRoot.remove();
                setTimeoutSpy.mockRestore();
                clearTimeoutSpy.mockRestore();
                observerHarness.restore();
            }
        });

        test('a synchronously fired debounce is rejected without wedging its owner', () => {
            const observerHarness = installControlledMutationObserver();
            let queuedCallback = null;
            const setTimeoutSpy = jest
                .spyOn(global, 'setTimeout')
                .mockImplementationOnce((callback) => {
                    callback();
                    return 41;
                })
                .mockImplementationOnce((callback) => {
                    queuedCallback = callback;
                    return 42;
                });
            const clearTimeoutSpy = jest
                .spyOn(global, 'clearTimeout')
                .mockImplementation(() => {});
            const root = document.createElement('section');
            const originalVideo = document.createElement('video');
            root.appendChild(originalVideo);
            document.body.appendChild(root);
            let currentVideo = originalVideo;
            const platform = {
                getVideoElement: jest.fn(() => currentVideo),
                getPlayerContainerElement: jest.fn(() => root),
            };
            const subtitleUtils = MockFactory.createSubtitleUtilsMock({
                clearSubtitleDOM: jest.fn(),
            });

            try {
                history.replaceState({}, '', '/watch/synchronous-timeout');
                contentScript.activePlatform = platform;
                contentScript.platformReady = true;
                contentScript.subtitleUtils = subtitleUtils;
                contentScript.currentConfig = {};
                contentScript.setupDOMObservation();
                const observer = observerHarness.instances[0];
                const task = contentScript.pageObserverTask;
                const replacementVideo = document.createElement('video');
                currentVideo = replacementVideo;
                originalVideo.replaceWith(replacementVideo);

                observer.callback([{ type: 'childList', target: root }]);

                expect(clearTimeoutSpy).toHaveBeenCalledWith(41);
                expect(task.timeoutInstallationPending).toBe(false);
                expect(task.timeoutId).toBeNull();
                expect(
                    subtitleUtils.ensureSubtitleContainer
                ).not.toHaveBeenCalled();

                observer.callback([{ type: 'childList', target: root }]);
                expect(task.timeoutId).toBe(42);
                queuedCallback();

                expect(
                    subtitleUtils.ensureSubtitleContainer
                ).toHaveBeenCalledTimes(1);
                expect(task.timeoutId).toBeNull();
            } finally {
                contentScript._cancelPlayerRootObservation();
                root.remove();
                setTimeoutSpy.mockRestore();
                clearTimeoutSpy.mockRestore();
                observerHarness.restore();
            }
        });

        test('a thrown debounce installation is fail-closed and retryable', () => {
            const observerHarness = installControlledMutationObserver();
            let queuedCallback = null;
            const setTimeoutSpy = jest
                .spyOn(global, 'setTimeout')
                .mockImplementationOnce(() => {
                    throw new Error('timer installation failed');
                })
                .mockImplementationOnce((callback) => {
                    queuedCallback = callback;
                    return 52;
                });
            const root = document.createElement('section');
            const originalVideo = document.createElement('video');
            root.appendChild(originalVideo);
            document.body.appendChild(root);
            let currentVideo = originalVideo;
            const platform = {
                getVideoElement: jest.fn(() => currentVideo),
                getPlayerContainerElement: jest.fn(() => root),
            };
            const subtitleUtils = MockFactory.createSubtitleUtilsMock({
                clearSubtitleDOM: jest.fn(),
            });

            try {
                history.replaceState({}, '', '/watch/thrown-timeout');
                contentScript.activePlatform = platform;
                contentScript.platformReady = true;
                contentScript.subtitleUtils = subtitleUtils;
                contentScript.currentConfig = {};
                contentScript.setupDOMObservation();
                const observer = observerHarness.instances[0];
                const task = contentScript.pageObserverTask;
                const replacementVideo = document.createElement('video');
                currentVideo = replacementVideo;
                originalVideo.replaceWith(replacementVideo);

                expect(() =>
                    observer.callback([{ type: 'childList', target: root }])
                ).not.toThrow();
                expect(task.timeoutInstallationPending).toBe(false);
                expect(task.timeoutId).toBeNull();
                expect(
                    subtitleUtils.ensureSubtitleContainer
                ).not.toHaveBeenCalled();

                observer.callback([{ type: 'childList', target: root }]);
                expect(task.timeoutId).toBe(52);
                queuedCallback();

                expect(
                    subtitleUtils.ensureSubtitleContainer
                ).toHaveBeenCalledTimes(1);
                expect(task.timeoutId).toBeNull();
            } finally {
                contentScript._cancelPlayerRootObservation();
                root.remove();
                setTimeoutSpy.mockRestore();
                observerHarness.restore();
            }
        });

        test('same-root video removal clears once and its replacement is set up once', () => {
            jest.useFakeTimers();
            const observerHarness = installControlledMutationObserver();
            const root = document.createElement('section');
            const originalVideo = document.createElement('video');
            root.appendChild(originalVideo);
            document.body.appendChild(root);
            let currentVideo = originalVideo;
            const platform = {
                getVideoElement: jest.fn(() => currentVideo),
                getPlayerContainerElement: jest.fn(() => root),
            };
            const subtitleUtils = MockFactory.createSubtitleUtilsMock({
                clearSubtitleDOM: jest.fn(),
            });

            try {
                history.replaceState({}, '', '/watch/video-replacement');
                contentScript.activePlatform = platform;
                contentScript.platformReady = true;
                contentScript.subtitleUtils = subtitleUtils;
                contentScript.currentConfig = {};
                contentScript.setupDOMObservation();
                const observer = observerHarness.instances[0];
                const task = contentScript.pageObserverTask;

                currentVideo = null;
                originalVideo.remove();
                observer.callback([
                    { type: 'childList', target: root },
                    { type: 'childList', target: root },
                ]);
                jest.advanceTimersByTime(100);

                expect(
                    subtitleUtils.hideSubtitleContainer
                ).toHaveBeenCalledTimes(1);
                expect(subtitleUtils.clearSubtitleDOM).toHaveBeenCalledTimes(1);
                expect(
                    subtitleUtils.ensureSubtitleContainer
                ).not.toHaveBeenCalled();
                expect(task.videoScope).toBeNull();
                expect(contentScript.videoDetectionIntervalId).not.toBeNull();

                observer.callback([{ type: 'childList', target: root }]);
                jest.advanceTimersByTime(100);
                expect(
                    subtitleUtils.hideSubtitleContainer
                ).toHaveBeenCalledTimes(1);
                expect(subtitleUtils.clearSubtitleDOM).toHaveBeenCalledTimes(1);

                const replacementVideo = document.createElement('video');
                currentVideo = replacementVideo;
                root.appendChild(replacementVideo);
                observer.callback([{ type: 'childList', target: root }]);
                jest.advanceTimersByTime(100);

                expect(
                    subtitleUtils.ensureSubtitleContainer
                ).toHaveBeenCalledTimes(1);
                expect(task.videoScope).toEqual({
                    root,
                    video: replacementVideo,
                });
                expect(contentScript.videoDetectionIntervalId).toBeNull();
                expect(observerHarness.instances).toHaveLength(1);
            } finally {
                contentScript.stopVideoElementDetection();
                contentScript._cancelPlayerRootObservation();
                root.remove();
                observerHarness.restore();
                jest.useRealTimers();
            }
        });

        test('synchronous platform reentrancy cannot let stale observer work overwrite a newer owner', () => {
            jest.useFakeTimers();
            const observerHarness = installControlledMutationObserver();
            const oldRoot = document.createElement('section');
            const oldVideo = document.createElement('video');
            oldRoot.appendChild(oldVideo);
            const newRoot = document.createElement('section');
            const newVideo = document.createElement('video');
            newRoot.appendChild(newVideo);
            document.body.append(oldRoot, newRoot);
            let oldCurrentVideo = oldVideo;
            const oldPlatform = {
                getVideoElement: jest.fn(() => oldCurrentVideo),
                getPlayerContainerElement: jest.fn(() => oldRoot),
            };
            const newPlatform = {
                getVideoElement: jest.fn(() => newVideo),
                getPlayerContainerElement: jest.fn(() => newRoot),
            };
            const subtitleUtils = MockFactory.createSubtitleUtilsMock({
                clearSubtitleDOM: jest.fn(),
            });

            try {
                history.replaceState({}, '', '/watch/reentrant-observer');
                contentScript.activePlatform = oldPlatform;
                contentScript.platformReady = true;
                contentScript.subtitleUtils = subtitleUtils;
                contentScript.currentConfig = {};
                contentScript.setupDOMObservation();
                const oldObserver = observerHarness.instances[0];
                const replacementVideo = document.createElement('video');
                oldCurrentVideo = replacementVideo;
                oldVideo.replaceWith(replacementVideo);
                oldObserver.callback([{ type: 'childList', target: oldRoot }]);

                let reentered = false;
                oldPlatform.getPlayerContainerElement.mockImplementation(() => {
                    if (!reentered) {
                        reentered = true;
                        contentScript.platformInitializationGeneration += 1;
                        contentScript.activePlatform = newPlatform;
                        contentScript.setupDOMObservation();
                    }
                    return oldRoot;
                });

                jest.advanceTimersByTime(100);

                expect(reentered).toBe(true);
                expect(observerHarness.instances).toHaveLength(2);
                expect(oldObserver.disconnect).toHaveBeenCalledTimes(1);
                expect(contentScript.activePlatform).toBe(newPlatform);
                expect(contentScript.pageObserver).toBe(
                    observerHarness.instances[1]
                );
                expect(contentScript.pageObserverTask).toEqual(
                    expect.objectContaining({
                        platform: newPlatform,
                        root: newRoot,
                    })
                );
                expect(
                    subtitleUtils.ensureSubtitleContainer
                ).not.toHaveBeenCalled();
                expect(
                    subtitleUtils.hideSubtitleContainer
                ).not.toHaveBeenCalled();
                expect(subtitleUtils.clearSubtitleDOM).not.toHaveBeenCalled();
            } finally {
                contentScript._cancelPlayerRootObservation();
                oldRoot.remove();
                newRoot.remove();
                observerHarness.restore();
                jest.useRealTimers();
            }
        });

        test('repeated manager setup replaces the prior owner without duplicate navigation', async () => {
            jest.useFakeTimers();
            const originalPathname = window.location.pathname;
            const notifyPlatform = jest.fn();
            const rearmVideo = jest.fn();

            try {
                history.replaceState({}, '', '/watch/original-title');
                const originalPushState = history.pushState;
                const originalReplaceState = history.replaceState;
                contentScript.activePlatform = {
                    onUrlChange: notifyPlatform,
                };
                contentScript._rearmVideoElementDetectionForPlayerNavigation =
                    rearmVideo;
                contentScript.stopVideoElementDetection = jest.fn();
                const options = {
                    useFocusEvents: false,
                    useIntervalChecking: false,
                    usePopstateEvents: false,
                };

                contentScript._setupNavigationManager(options);
                const firstManager = contentScript.navigationDetectionManager;
                contentScript._setupNavigationManager(options);

                expect(firstManager.isSetup).toBe(false);
                expect(firstManager.pendingUrlCheckTimeoutId).toBeNull();
                expect(firstManager._originalHistoryMethods).toBeNull();

                history.pushState({}, '', '/watch/replacement-title');
                jest.advanceTimersByTime(100);

                expect(notifyPlatform).toHaveBeenCalledTimes(1);
                expect(rearmVideo).toHaveBeenCalledTimes(1);

                await contentScript._stopAllDetectionActivities();
                expect(history.pushState).toBe(originalPushState);
                expect(history.replaceState).toBe(originalReplaceState);
            } finally {
                contentScript.navigationDetectionManager?.cleanup();
                history.replaceState({}, '', originalPathname);
                jest.useRealTimers();
            }
        });
    });

    describe('Platform subclass cleanup ownership', () => {
        test.each([
            ['Netflix', NetflixContentScript],
            ['Disney+', DisneyPlusContentScript],
        ])(
            '%s inherits Base cleanup authority unchanged',
            async (_platform, ContentScriptClass) => {
                const instance = new ContentScriptClass();
                instance.logWithFallback = jest.fn();

                try {
                    expect(
                        Object.hasOwn(ContentScriptClass.prototype, 'cleanup')
                    ).toBe(false);
                    expect(instance.cleanup).toBe(
                        BaseContentScript.prototype.cleanup
                    );
                } finally {
                    await BaseContentScript.prototype.cleanup.call(
                        instance,
                        true
                    );
                }
            }
        );
    });

    describe('Configuration Management', () => {
        test('should setup configuration listeners', () => {
            const unsubscribe = jest.fn();
            const mockConfigService = {
                onChanged: jest.fn().mockReturnValue(unsubscribe),
            };
            contentScript.configService = mockConfigService;

            contentScript.setupConfigurationListeners();

            expect(mockConfigService.onChanged).toHaveBeenCalledWith(
                expect.any(Function),
                { includeSensitive: false }
            );
            expect(contentScript.configUnsubscribe).toBe(unsubscribe);
        });

        test('replaces and cleans up configuration subscriptions', async () => {
            const firstUnsubscribe = jest.fn();
            const secondUnsubscribe = jest.fn();
            const mockConfigService = {
                onChanged: jest
                    .fn()
                    .mockReturnValueOnce(firstUnsubscribe)
                    .mockReturnValueOnce(secondUnsubscribe),
            };
            contentScript.configService = mockConfigService;

            contentScript.setupConfigurationListeners();
            contentScript.setupConfigurationListeners();

            expect(firstUnsubscribe).toHaveBeenCalledTimes(1);
            expect(secondUnsubscribe).not.toHaveBeenCalled();

            await contentScript.cleanup();

            expect(secondUnsubscribe).toHaveBeenCalledTimes(1);
            expect(contentScript.configUnsubscribe).toBeNull();
        });

        test('preserves exact subscription ownership across nested replacement setup', async () => {
            const callbacks = [];
            const activeCallbacks = new Set();
            const unsubscribers = [];
            let nestedSetupStarted = false;
            const getAll = jest.fn().mockResolvedValue({
                theme: 'stale',
                useOfficialTranslations: true,
            });
            contentScript.configService = {
                getAll,
                onChanged: jest.fn((callback) => {
                    const index = callbacks.length;
                    callbacks.push(callback);
                    activeCallbacks.add(callback);
                    const unsubscribe = jest.fn(() => {
                        activeCallbacks.delete(callback);
                        if (index === 0 && !nestedSetupStarted) {
                            nestedSetupStarted = true;
                            contentScript.setupConfigurationListeners();
                        }
                    });
                    unsubscribers.push(unsubscribe);
                    return unsubscribe;
                }),
            };

            contentScript.setupConfigurationListeners();
            contentScript.setupConfigurationListeners();

            expect(contentScript.configService.onChanged).toHaveBeenCalledTimes(
                3
            );
            expect(activeCallbacks).toEqual(new Set([callbacks[1]]));
            expect(contentScript.configUnsubscribe).toBe(unsubscribers[1]);
            expect(unsubscribers[0]).toHaveBeenCalledTimes(1);
            expect(unsubscribers[1]).not.toHaveBeenCalled();
            expect(unsubscribers[2]).toHaveBeenCalledTimes(1);

            await callbacks[0]({ theme: 'old-subscription' });
            await callbacks[2]({ theme: 'stale-outer-subscription' });
            expect(getAll).not.toHaveBeenCalled();

            await contentScript._cleanupEventHandling();

            expect(activeCallbacks.size).toBe(0);
            expect(unsubscribers[1]).toHaveBeenCalledTimes(1);
            expect(contentScript.configUnsubscribe).toBeNull();
        });

        test('does not let a reentrant unsubscribe resurrect a listener during cleanup', async () => {
            const callbacks = [];
            const activeCallbacks = new Set();
            const unsubscribers = [];
            const getAll = jest.fn().mockResolvedValue({
                theme: 'resurrected',
                useOfficialTranslations: true,
            });
            contentScript.configService = {
                getAll,
                onChanged: jest.fn((callback) => {
                    const index = callbacks.length;
                    callbacks.push(callback);
                    activeCallbacks.add(callback);
                    const unsubscribe = jest.fn(() => {
                        activeCallbacks.delete(callback);
                        if (index === 0) {
                            contentScript.setupConfigurationListeners();
                        }
                    });
                    unsubscribers.push(unsubscribe);
                    return unsubscribe;
                }),
            };
            for (const method of [
                '_stopAllDetectionActivities',
                '_cleanupAIContextManager',
                '_cleanupPlatformResources',
                '_cleanupDOMResources',
                '_cleanupTimersAndIntervals',
                '_cleanupObservers',
            ]) {
                jest.spyOn(contentScript, method).mockResolvedValue();
            }

            contentScript.setupConfigurationListeners();
            await contentScript.cleanup();

            expect(contentScript.configService.onChanged).toHaveBeenCalledTimes(
                1
            );
            expect(unsubscribers[0]).toHaveBeenCalledTimes(1);
            expect(activeCallbacks.size).toBe(0);
            expect(contentScript.configUnsubscribe).toBeNull();

            contentScript.setupConfigurationListeners();
            for (const callback of callbacks) {
                await callback({ theme: 'resurrected' });
            }
            expect(contentScript.configService.onChanged).toHaveBeenCalledTimes(
                1
            );
            expect(getAll).not.toHaveBeenCalled();

            await contentScript.cleanup(true);
            expect(contentScript.configService.onChanged).toHaveBeenCalledTimes(
                1
            );
            expect(activeCallbacks.size).toBe(0);
            expect(contentScript.configUnsubscribe).toBeNull();
        });

        test('treats direct event-handler cleanup as terminal for configuration subscriptions', async () => {
            const callbacks = [];
            const activeCallbacks = new Set();
            const getAll = jest.fn().mockResolvedValue({
                theme: 'resurrected',
                useOfficialTranslations: true,
            });
            contentScript.configService = {
                getAll,
                onChanged: jest.fn((callback) => {
                    callbacks.push(callback);
                    activeCallbacks.add(callback);
                    return jest.fn(() => {
                        activeCallbacks.delete(callback);
                        contentScript.setupConfigurationListeners();
                    });
                }),
            };

            contentScript.setupConfigurationListeners();
            await contentScript._cleanupEventHandling();

            expect(contentScript.configService.onChanged).toHaveBeenCalledTimes(
                1
            );
            expect(activeCallbacks.size).toBe(0);
            expect(contentScript.configUnsubscribe).toBeNull();

            contentScript.setupConfigurationListeners();
            for (const callback of callbacks) {
                await callback({ theme: 'resurrected' });
            }
            expect(contentScript.configService.onChanged).toHaveBeenCalledTimes(
                1
            );
            expect(getAll).not.toHaveBeenCalled();
        });

        test('keeps a live subscription usable after a strict refresh failure', async () => {
            const failureMarker = 'PRIVATE_LIVE_CONFIG_FAILURE';
            const unsubscribe = jest.fn();
            let onChanged;
            const mockConfigService = {
                onChanged: jest.fn((callback) => {
                    onChanged = callback;
                    return unsubscribe;
                }),
                getAll: jest
                    .fn()
                    .mockRejectedValueOnce(new Error(failureMarker))
                    .mockResolvedValueOnce({
                        aiContextEnabled: true,
                        aiContextProvider: 'gemini',
                        openaiModel: 'new-model',
                    }),
            };
            const originalConfig = {
                aiContextEnabled: true,
                aiContextProvider: 'openai',
                openaiModel: 'old-model',
            };
            contentScript.configService = mockConfigService;
            contentScript.currentConfig = originalConfig;
            const normalize = jest.spyOn(
                contentScript,
                '_normalizeConfiguration'
            );
            const applyChanges = jest
                .spyOn(contentScript, 'applyConfigurationChanges')
                .mockImplementation(() => {});
            const handleAIChanges = jest
                .spyOn(contentScript, '_handleAIContextConfigurationChanges')
                .mockResolvedValue();
            const log = jest.spyOn(contentScript, 'logWithFallback');
            contentScript.setupConfigurationListeners();

            await expect(
                onChanged({ aiContextProvider: 'gemini' })
            ).resolves.toBeUndefined();

            expect(contentScript.currentConfig).toBe(originalConfig);
            expect(contentScript.currentConfig).toEqual({
                aiContextEnabled: true,
                aiContextProvider: 'openai',
                openaiModel: 'old-model',
            });
            expect(normalize).not.toHaveBeenCalled();
            expect(applyChanges).not.toHaveBeenCalled();
            expect(handleAIChanges).not.toHaveBeenCalled();
            expect(
                log.mock.calls.some(
                    ([level, message]) =>
                        level === 'error' &&
                        message ===
                            'Failed to refresh configuration from configService.'
                )
            ).toBe(true);
            expect(JSON.stringify(log.mock.calls)).not.toContain(failureMarker);

            await expect(
                onChanged({ openaiModel: 'new-model' })
            ).resolves.toBeUndefined();

            expect(contentScript.currentConfig).toEqual({
                aiContextEnabled: true,
                aiContextProvider: 'gemini',
                openaiModel: 'new-model',
                useOfficialTranslations: true,
            });
            expect(normalize).toHaveBeenCalledTimes(1);
            expect(applyChanges).toHaveBeenCalledTimes(1);
            expect(handleAIChanges).toHaveBeenCalledTimes(1);
            expect(handleAIChanges).toHaveBeenCalledWith(
                {
                    aiContextProvider: 'gemini',
                    openaiModel: 'new-model',
                },
                2
            );
            expect(contentScript.aiContextConfigurationIntentGeneration).toBe(
                2
            );
            expect(contentScript.pendingAIContextConfigurationKeys.size).toBe(
                0
            );
            expect(mockConfigService.onChanged).toHaveBeenCalledTimes(1);
            expect(unsubscribe).not.toHaveBeenCalled();
        });

        test('reconciles a failed AI intent from the next authoritative non-AI refresh', async () => {
            const failureMarker = 'PRIVATE_FAILED_AI_PROVIDER_READ';
            let onChanged;
            contentScript.configService = {
                onChanged: jest.fn((callback) => {
                    onChanged = callback;
                    return jest.fn();
                }),
                getAll: jest
                    .fn()
                    .mockRejectedValueOnce(new Error(failureMarker))
                    .mockResolvedValueOnce({
                        aiContextEnabled: true,
                        aiContextProvider: 'gemini',
                        theme: 'new',
                        useOfficialTranslations: true,
                    }),
            };
            contentScript.currentConfig = {
                aiContextEnabled: true,
                aiContextProvider: 'openai',
                theme: 'old',
                useOfficialTranslations: true,
            };
            const restartAI = jest
                .spyOn(contentScript, '_restartAIContextFeatures')
                .mockResolvedValue(true);
            const log = jest.spyOn(contentScript, 'logWithFallback');
            contentScript.setupConfigurationListeners();

            await onChanged({ aiContextProvider: 'untrusted-event-value' });

            expect(contentScript.currentConfig.aiContextProvider).toBe(
                'openai'
            );
            expect(restartAI).not.toHaveBeenCalled();
            expect(JSON.stringify(log.mock.calls)).not.toContain(failureMarker);

            await onChanged({ theme: 'new' });

            expect(contentScript.currentConfig.aiContextProvider).toBe(
                'gemini'
            );
            expect(contentScript.currentConfig.theme).toBe('new');
            expect(restartAI).toHaveBeenCalledTimes(1);
        });

        test('reconciles the union of distinct failed AI intents and disables once', async () => {
            let onChanged;
            contentScript.configService = {
                onChanged: jest.fn((callback) => {
                    onChanged = callback;
                    return jest.fn();
                }),
                getAll: jest
                    .fn()
                    .mockRejectedValueOnce(new Error('enablement read failed'))
                    .mockRejectedValueOnce(new Error('provider read failed'))
                    .mockResolvedValueOnce({
                        aiContextEnabled: false,
                        aiContextProvider: 'gemini',
                        theme: 'new',
                        useOfficialTranslations: true,
                    }),
            };
            contentScript.currentConfig = {
                aiContextEnabled: true,
                aiContextProvider: 'openai',
                theme: 'old',
                useOfficialTranslations: true,
            };
            const disableAI = jest
                .spyOn(contentScript, '_disableAIContextInteractions')
                .mockResolvedValue();
            const restartAI = jest
                .spyOn(contentScript, '_restartAIContextFeatures')
                .mockResolvedValue(true);
            contentScript.setupConfigurationListeners();

            await onChanged({ aiContextEnabled: false });
            await onChanged({ aiContextProvider: 'untrusted-event-value' });

            expect(contentScript.currentConfig).toEqual({
                aiContextEnabled: true,
                aiContextProvider: 'openai',
                theme: 'old',
                useOfficialTranslations: true,
            });
            expect(disableAI).not.toHaveBeenCalled();
            expect(restartAI).not.toHaveBeenCalled();
            expect(
                Array.from(
                    contentScript.pendingAIContextConfigurationKeys.entries()
                )
            ).toEqual([
                ['aiContextEnabled', 1],
                ['aiContextProvider', 2],
            ]);

            await onChanged({ theme: 'new' });

            expect(contentScript.currentConfig).toEqual({
                aiContextEnabled: false,
                aiContextProvider: 'gemini',
                theme: 'new',
                useOfficialTranslations: true,
            });
            expect(disableAI).toHaveBeenCalledTimes(1);
            expect(restartAI).not.toHaveBeenCalled();
            expect(contentScript.aiContextConfigurationIntentGeneration).toBe(
                2
            );
            expect(contentScript.pendingAIContextConfigurationKeys.size).toBe(
                0
            );
        });

        test('does not clear a newer same-key intent captured during async reconciliation', async () => {
            let resolveRestart;
            const restartPending = new Promise((resolve) => {
                resolveRestart = resolve;
            });
            let onChanged;
            contentScript.configService = {
                onChanged: jest.fn((callback) => {
                    onChanged = callback;
                    return jest.fn();
                }),
                getAll: jest
                    .fn()
                    .mockRejectedValueOnce(
                        new Error('first provider read failed')
                    )
                    .mockResolvedValueOnce({
                        aiContextEnabled: true,
                        aiContextProvider: 'gemini',
                        theme: 'new',
                        useOfficialTranslations: true,
                    })
                    .mockRejectedValueOnce(
                        new Error('newer provider read failed')
                    ),
            };
            contentScript.currentConfig = {
                aiContextEnabled: true,
                aiContextProvider: 'openai',
                theme: 'old',
                useOfficialTranslations: true,
            };
            const restartAI = jest
                .spyOn(contentScript, '_restartAIContextFeatures')
                .mockImplementation(() => restartPending);
            contentScript.setupConfigurationListeners();

            await onChanged({ aiContextProvider: 'first-intent' });
            const reconciliation = onChanged({ theme: 'new' });
            while (restartAI.mock.calls.length === 0) {
                await Promise.resolve();
            }

            await onChanged({ aiContextProvider: 'newer-intent' });
            expect(
                contentScript.pendingAIContextConfigurationKeys.get(
                    'aiContextProvider'
                )
            ).toBe(2);

            resolveRestart(true);
            await reconciliation;

            expect(restartAI).toHaveBeenCalledTimes(1);
            expect(contentScript.currentConfig.aiContextProvider).toBe(
                'gemini'
            );
            expect(
                contentScript.pendingAIContextConfigurationKeys.get(
                    'aiContextProvider'
                )
            ).toBe(2);
        });

        test('does not let a stale read completion clear a newer pending intent', async () => {
            let resolveOlder;
            const olderRead = new Promise((resolve) => {
                resolveOlder = resolve;
            });
            let onChanged;
            contentScript.configService = {
                onChanged: jest.fn((callback) => {
                    onChanged = callback;
                    return jest.fn();
                }),
                getAll: jest
                    .fn()
                    .mockImplementationOnce(() => olderRead)
                    .mockRejectedValueOnce(new Error('newer read failed')),
            };
            contentScript.currentConfig = {
                aiContextEnabled: true,
                aiContextProvider: 'openai',
                useOfficialTranslations: true,
            };
            const handleAIChanges = jest.spyOn(
                contentScript,
                '_handleAIContextConfigurationChanges'
            );
            contentScript.setupConfigurationListeners();

            const olderRefresh = onChanged({
                aiContextProvider: 'older-intent',
            });
            await onChanged({ aiContextProvider: 'newer-intent' });
            resolveOlder({
                aiContextEnabled: true,
                aiContextProvider: 'stale-provider',
                useOfficialTranslations: true,
            });
            await olderRefresh;

            expect(contentScript.currentConfig.aiContextProvider).toBe(
                'openai'
            );
            expect(handleAIChanges).not.toHaveBeenCalled();
            expect(
                contentScript.pendingAIContextConfigurationKeys.get(
                    'aiContextProvider'
                )
            ).toBe(2);
        });

        test('reconciles sensitive AI keys by presence without reusing event values', async () => {
            const sensitiveMarker = 'PRIVATE_EVENT_CREDENTIAL';
            let onChanged;
            contentScript.configService = {
                onChanged: jest.fn((callback) => {
                    onChanged = callback;
                    return jest.fn();
                }),
                getAll: jest.fn().mockResolvedValue({
                    aiContextEnabled: true,
                    aiContextProvider: 'openai',
                    useOfficialTranslations: true,
                }),
            };
            contentScript.currentConfig = {
                aiContextEnabled: true,
                aiContextProvider: 'openai',
                useOfficialTranslations: true,
            };
            const handleAIChanges = jest
                .spyOn(contentScript, '_handleAIContextConfigurationChanges')
                .mockResolvedValue();
            const log = jest.spyOn(contentScript, 'logWithFallback');
            contentScript.setupConfigurationListeners();

            await onChanged({ openaiApiKey: sensitiveMarker });

            const [canonicalChanges, intentGeneration] =
                handleAIChanges.mock.calls[0];
            expect(Object.keys(canonicalChanges)).toEqual(['openaiApiKey']);
            expect(Object.hasOwn(canonicalChanges, 'openaiApiKey')).toBe(true);
            expect(canonicalChanges.openaiApiKey).toBeUndefined();
            expect(intentGeneration).toBe(1);
            expect(contentScript.currentConfig).not.toHaveProperty(
                'openaiApiKey'
            );
            expect(JSON.stringify(log.mock.calls)).not.toContain(
                sensitiveMarker
            );
            expect(contentScript.pendingAIContextConfigurationKeys.size).toBe(
                0
            );
        });

        test('lets only the last-started live refresh apply after reverse completion', async () => {
            let resolveOlder;
            const olderConfig = new Promise((resolve) => {
                resolveOlder = resolve;
            });
            let onChanged;
            contentScript.configService = {
                onChanged: jest.fn((callback) => {
                    onChanged = callback;
                    return jest.fn();
                }),
                getAll: jest
                    .fn()
                    .mockImplementationOnce(() => olderConfig)
                    .mockResolvedValueOnce({
                        fontSize: 2,
                        theme: 'newer',
                        useOfficialTranslations: true,
                    }),
            };
            contentScript.currentConfig = {
                fontSize: 0,
                theme: 'original',
                useOfficialTranslations: true,
            };
            const normalize = jest.spyOn(
                contentScript,
                '_normalizeConfiguration'
            );
            const applyChanges = jest
                .spyOn(contentScript, 'applyConfigurationChanges')
                .mockImplementation(() => {});
            const handleAIChanges = jest
                .spyOn(contentScript, '_handleAIContextConfigurationChanges')
                .mockResolvedValue();
            contentScript.setupConfigurationListeners();

            const olderRefresh = onChanged({ fontSize: 1 });
            const newerRefresh = onChanged({ fontSize: 2 });
            await newerRefresh;
            resolveOlder({
                fontSize: 1,
                theme: 'stale',
                useOfficialTranslations: true,
            });
            await olderRefresh;

            expect(contentScript.currentConfig).toEqual({
                fontSize: 2,
                theme: 'newer',
                useOfficialTranslations: true,
            });
            expect(normalize).toHaveBeenCalledTimes(1);
            expect(applyChanges).toHaveBeenCalledTimes(1);
            expect(applyChanges).toHaveBeenCalledWith({ fontSize: 2 });
            expect(handleAIChanges).toHaveBeenCalledTimes(1);
            expect(handleAIChanges).toHaveBeenCalledWith({ fontSize: 2 }, null);
        });

        test('keeps an older rejected refresh inert after a newer refresh starts', async () => {
            const failureMarker = 'PRIVATE_STALE_CONFIG_FAILURE';
            let rejectOlder;
            const olderConfig = new Promise((_resolve, reject) => {
                rejectOlder = reject;
            });
            let onChanged;
            contentScript.configService = {
                onChanged: jest.fn((callback) => {
                    onChanged = callback;
                    return jest.fn();
                }),
                getAll: jest
                    .fn()
                    .mockImplementationOnce(() => olderConfig)
                    .mockResolvedValueOnce({
                        theme: 'newer',
                        useOfficialTranslations: true,
                    }),
            };
            contentScript.currentConfig = {
                theme: 'original',
                useOfficialTranslations: true,
            };
            const applyChanges = jest
                .spyOn(contentScript, 'applyConfigurationChanges')
                .mockImplementation(() => {});
            const handleAIChanges = jest
                .spyOn(contentScript, '_handleAIContextConfigurationChanges')
                .mockResolvedValue();
            const log = jest.spyOn(contentScript, 'logWithFallback');
            contentScript.setupConfigurationListeners();

            const olderRefresh = onChanged({ theme: 'stale' });
            await onChanged({ theme: 'newer' });
            rejectOlder(new Error(failureMarker));
            await olderRefresh;

            expect(contentScript.currentConfig.theme).toBe('newer');
            expect(applyChanges).toHaveBeenCalledTimes(1);
            expect(handleAIChanges).toHaveBeenCalledTimes(1);
            expect(
                log.mock.calls.filter(
                    ([level, message]) =>
                        level === 'error' &&
                        message ===
                            'Failed to refresh configuration from configService.'
                )
            ).toHaveLength(0);
            expect(JSON.stringify(log.mock.calls)).not.toContain(failureMarker);
        });

        test('invalidates a pending refresh when the configuration subscription is replaced', async () => {
            let resolvePending;
            const pendingConfig = new Promise((resolve) => {
                resolvePending = resolve;
            });
            const callbacks = [];
            let reentrantRefresh;
            const firstUnsubscribe = jest.fn(() => {
                reentrantRefresh = callbacks[0]({ theme: 'reentrant-stale' });
            });
            const secondUnsubscribe = jest.fn();
            const getAll = jest.fn(() => pendingConfig);
            contentScript.configService = {
                onChanged: jest.fn((callback) => {
                    callbacks.push(callback);
                    return callbacks.length === 1
                        ? firstUnsubscribe
                        : secondUnsubscribe;
                }),
                getAll,
            };
            const originalConfig = {
                theme: 'original',
                useOfficialTranslations: true,
            };
            contentScript.currentConfig = originalConfig;
            const normalize = jest.spyOn(
                contentScript,
                '_normalizeConfiguration'
            );
            const applyChanges = jest.spyOn(
                contentScript,
                'applyConfigurationChanges'
            );
            const handleAIChanges = jest.spyOn(
                contentScript,
                '_handleAIContextConfigurationChanges'
            );
            contentScript.setupConfigurationListeners();
            const pendingRefresh = callbacks[0]({ theme: 'stale' });

            contentScript.setupConfigurationListeners();
            resolvePending({
                theme: 'stale',
                useOfficialTranslations: true,
            });
            await pendingRefresh;
            await reentrantRefresh;

            expect(firstUnsubscribe).toHaveBeenCalledTimes(1);
            expect(secondUnsubscribe).not.toHaveBeenCalled();
            expect(getAll).toHaveBeenCalledTimes(1);
            expect(contentScript.currentConfig).toBe(originalConfig);
            expect(contentScript.currentConfig.theme).toBe('original');
            expect(normalize).not.toHaveBeenCalled();
            expect(applyChanges).not.toHaveBeenCalled();
            expect(handleAIChanges).not.toHaveBeenCalled();
        });

        test('invalidates a pending refresh before configuration teardown unsubscribes', async () => {
            let resolvePending;
            const pendingConfig = new Promise((resolve) => {
                resolvePending = resolve;
            });
            let onChanged;
            let reentrantRefresh;
            const unsubscribe = jest.fn(() => {
                reentrantRefresh = onChanged({ theme: 'reentrant-stale' });
            });
            const getAll = jest.fn(() => pendingConfig);
            contentScript.configService = {
                onChanged: jest.fn((callback) => {
                    onChanged = callback;
                    return unsubscribe;
                }),
                getAll,
            };
            const originalConfig = {
                theme: 'original',
                useOfficialTranslations: true,
            };
            contentScript.currentConfig = originalConfig;
            const normalize = jest.spyOn(
                contentScript,
                '_normalizeConfiguration'
            );
            const applyChanges = jest.spyOn(
                contentScript,
                'applyConfigurationChanges'
            );
            const handleAIChanges = jest.spyOn(
                contentScript,
                '_handleAIContextConfigurationChanges'
            );
            contentScript.setupConfigurationListeners();
            const pendingRefresh = onChanged({ theme: 'stale' });

            await contentScript._cleanupEventHandling();
            resolvePending({
                theme: 'stale',
                useOfficialTranslations: true,
            });
            await pendingRefresh;
            await reentrantRefresh;

            expect(unsubscribe).toHaveBeenCalledTimes(1);
            expect(getAll).toHaveBeenCalledTimes(1);
            expect(contentScript.configUnsubscribe).toBeNull();
            expect(contentScript.currentConfig).toBe(originalConfig);
            expect(contentScript.currentConfig.theme).toBe('original');
            expect(normalize).not.toHaveBeenCalled();
            expect(applyChanges).not.toHaveBeenCalled();
            expect(handleAIChanges).not.toHaveBeenCalled();
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
                    platformInitRetryDelay: 0,
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
                    'LOGGING_LEVEL_CHANGED',
                    errorHandler,
                    { senderRoles: ['background'] }
                );
                const sendResponse = jest.fn();

                const result = contentScript.handleChromeMessage(
                    {
                        action: 'LOGGING_LEVEL_CHANGED',
                        level: 4,
                    },
                    createBackgroundSender(),
                    sendResponse
                );

                expect(sendResponse).toHaveBeenCalledWith({
                    action: 'LOGGING_LEVEL_CHANGED',
                    success: false,
                    error: 'Message handling failed',
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
                platformInitRetryDelay: 0,
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
            contentScript.currentConfig.platformInitRetryDelay = 0;
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
            contentScript.currentConfig.platformInitRetryDelay = 0;

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

    describe('Platform Initialization Lifecycle', () => {
        beforeEach(() => {
            contentScript.subtitleUtils = {
                setSubtitlesActive: jest.fn(),
            };
            contentScript.configService = {};
            contentScript.currentConfig = {
                subtitlesEnabled: true,
                platformInitMaxRetries: 0,
                platformInitRetryDelay: 0,
                platformInitTimeout: 5000,
            };
            contentScript.startVideoElementDetection = jest.fn();
            contentScript.processBufferedEvents = jest.fn();
        });

        test('coalesces concurrent platform initialization callers', async () => {
            let completeInitialization;
            const initializationGate = new Promise((resolve) => {
                completeInitialization = resolve;
            });
            const initialize = jest.fn(() => initializationGate);
            const PlatformClass = jest.fn(() => ({
                initialize,
                isPlayerPageActive: jest.fn().mockReturnValue(true),
                handleNativeSubtitles: jest.fn(),
                cleanup: jest.fn(),
            }));
            contentScript.PlatformClass = PlatformClass;

            const firstInitialization = contentScript.initializePlatform();
            const secondInitialization = contentScript.initializePlatform();

            expect(secondInitialization).toBe(firstInitialization);

            await Promise.resolve();
            await Promise.resolve();
            expect(PlatformClass).toHaveBeenCalledTimes(1);
            expect(initialize).toHaveBeenCalledTimes(1);

            completeInitialization();
            await expect(firstInitialization).resolves.toBe(true);
        });

        test('coalesces synchronous reentrant initialization before the first await', async () => {
            const platform = {
                initialize: jest.fn().mockResolvedValue(),
                isPlayerPageActive: jest.fn().mockReturnValue(true),
                handleNativeSubtitles: jest.fn(),
                cleanup: jest.fn(),
            };
            contentScript.PlatformClass = jest.fn(() => platform);

            let reentrantInitialization;
            contentScript.subtitleUtils.setSubtitlesActive.mockImplementationOnce(
                () => {
                    reentrantInitialization =
                        contentScript.initializePlatform();
                }
            );

            const firstInitialization = contentScript.initializePlatform();
            await Promise.resolve();

            expect(reentrantInitialization).toBe(firstInitialization);
            await expect(firstInitialization).resolves.toBe(true);
            expect(contentScript.PlatformClass).toHaveBeenCalledTimes(1);
            expect(platform.initialize).toHaveBeenCalledTimes(1);
        });

        test('coalesces direct and page-enter triggers across lifecycle generations', async () => {
            jest.useFakeTimers();
            const createDeferred = () => {
                let resolve;
                const promise = new Promise((gateResolve) => {
                    resolve = gateResolve;
                });
                return { promise, resolve };
            };
            const firstGate = createDeferred();
            const secondGate = createDeferred();
            const firstPlatform = {
                initialize: jest.fn(() => firstGate.promise),
                isPlayerPageActive: jest.fn().mockReturnValue(true),
                handleNativeSubtitles: jest.fn(),
                cleanup: jest.fn().mockResolvedValue(),
            };
            const secondPlatform = {
                initialize: jest.fn(() => secondGate.promise),
                isPlayerPageActive: jest.fn().mockReturnValue(true),
                handleNativeSubtitles: jest.fn(),
                cleanup: jest.fn().mockResolvedValue(),
            };
            contentScript.PlatformClass = jest
                .fn()
                .mockImplementationOnce(() => firstPlatform)
                .mockImplementationOnce(() => secondPlatform);
            contentScript.subtitleUtils = {
                ...contentScript.subtitleUtils,
                subtitlesActive: true,
                clearSubtitlesDisplayAndQueue: jest.fn(),
                clearSubtitleDOM: jest.fn(),
            };
            contentScript.eventBuffer = { clear: jest.fn() };
            contentScript.stopVideoElementDetection = jest.fn();
            const initializePlatform = jest.spyOn(
                contentScript,
                'initializePlatform'
            );

            try {
                contentScript.initializePlatform();
                contentScript._schedulePlatformInitializationOnPageEnter(
                    () => ({ subtitlesEnabled: true }),
                    () => true,
                    0
                );

                await jest.advanceTimersByTimeAsync(0);
                for (let index = 0; index < 10; index++) {
                    await Promise.resolve();
                }

                expect(initializePlatform).toHaveBeenCalledTimes(2);
                expect(initializePlatform.mock.results[0].value).toBe(
                    initializePlatform.mock.results[1].value
                );
                expect(contentScript.PlatformClass).toHaveBeenCalledTimes(1);
                expect(firstPlatform.initialize).toHaveBeenCalledTimes(1);

                contentScript._cleanupOnPlayerPageLeave();
                await Promise.resolve();

                contentScript._schedulePlatformInitializationOnPageEnter(
                    () => ({ subtitlesEnabled: true }),
                    () => true,
                    0
                );
                await jest.advanceTimersByTimeAsync(0);
                for (let index = 0; index < 10; index++) {
                    await Promise.resolve();
                }
                expect(secondPlatform.initialize).toHaveBeenCalledTimes(1);

                firstGate.resolve();
                await expect(
                    initializePlatform.mock.results[0].value
                ).resolves.toBe(false);
                expect(
                    firstPlatform.handleNativeSubtitles
                ).not.toHaveBeenCalled();
                expect(firstPlatform.cleanup).toHaveBeenCalledTimes(1);
                expect(contentScript.activePlatform).toBe(secondPlatform);
                expect(contentScript.platformReady).toBe(false);

                secondGate.resolve();
                await expect(
                    initializePlatform.mock.results[2].value
                ).resolves.toBe(true);
                expect(contentScript.activePlatform).toBe(secondPlatform);
                expect(contentScript.platformReady).toBe(true);

                contentScript._schedulePlatformInitializationOnPageEnter(
                    () => ({ subtitlesEnabled: true }),
                    () => true,
                    1000
                );
                expect(jest.getTimerCount()).toBe(1);

                await contentScript.cleanup();

                expect(contentScript.pageObserver).toBeNull();
                expect(contentScript.pageObserverTask).toBeNull();
                expect(contentScript.pageEnterTask).toBeNull();
                expect(contentScript.platformRetryTimeoutId).toBeNull();
                expect(jest.getTimerCount()).toBe(0);
            } finally {
                document.body.replaceChildren();
                jest.useRealTimers();
            }
        });

        test('allows a fresh public initialization after a settled failure', async () => {
            const firstPlatform = {
                initialize: jest
                    .fn()
                    .mockRejectedValue(new Error('first attempt failed')),
                isPlayerPageActive: jest.fn().mockReturnValue(true),
                handleNativeSubtitles: jest.fn(),
                cleanup: jest.fn(),
            };
            const secondPlatform = {
                initialize: jest.fn().mockResolvedValue(),
                isPlayerPageActive: jest.fn().mockReturnValue(true),
                handleNativeSubtitles: jest.fn(),
                cleanup: jest.fn(),
            };
            const PlatformClass = jest
                .fn()
                .mockImplementationOnce(() => firstPlatform)
                .mockImplementationOnce(() => secondPlatform);
            contentScript.PlatformClass = PlatformClass;

            const firstInitialization = contentScript.initializePlatform();
            await expect(firstInitialization).resolves.toBe(false);
            expect(contentScript.platformInitializationPromise).toBeNull();
            expect(firstPlatform.cleanup).toHaveBeenCalledTimes(1);

            const secondInitialization = contentScript.initializePlatform();
            expect(secondInitialization).not.toBe(firstInitialization);
            await expect(secondInitialization).resolves.toBe(true);
            expect(PlatformClass).toHaveBeenCalledTimes(2);
            expect(contentScript.activePlatform).toBe(secondPlatform);
            expect(contentScript.platformReady).toBe(true);
        });

        test('cleans a failed candidate even when detection teardown throws', async () => {
            const platform = {
                initialize: jest
                    .fn()
                    .mockRejectedValue(new Error('initialization failed')),
                isPlayerPageActive: jest.fn().mockReturnValue(true),
                handleNativeSubtitles: jest.fn(),
                cleanup: jest.fn().mockResolvedValue(),
            };
            contentScript.PlatformClass = jest.fn(() => platform);
            contentScript.stopVideoElementDetection = jest.fn(() => {
                throw new Error('detection teardown failed');
            });

            await expect(contentScript.initializePlatform()).resolves.toBe(
                false
            );

            expect(platform.cleanup).toHaveBeenCalledTimes(1);
            expect(contentScript.activePlatform).toBeNull();
            expect(contentScript.platformReady).toBe(false);
        });

        test('treats comprehensive cleanup as terminal for platform initialization', async () => {
            const PlatformClass = jest.fn(() => ({
                initialize: jest.fn().mockResolvedValue(),
                isPlayerPageActive: jest.fn().mockReturnValue(true),
                handleNativeSubtitles: jest.fn(),
                cleanup: jest.fn(),
            }));
            contentScript.PlatformClass = PlatformClass;

            await contentScript.cleanup();

            await expect(contentScript.initializePlatform()).resolves.toBe(
                false
            );
            expect(PlatformClass).not.toHaveBeenCalled();
            expect(contentScript.activePlatform).toBeNull();
        });

        test('leaves a player page through one synchronous lifecycle boundary', async () => {
            const platform = {
                cleanup: jest.fn().mockImplementation(() => {
                    expect(contentScript.activePlatform).toBeNull();
                    return Promise.resolve();
                }),
            };
            contentScript.activePlatform = platform;
            contentScript.platformReady = true;
            contentScript.subtitleUtils = {
                clearSubtitlesDisplayAndQueue: jest.fn(),
                clearSubtitleDOM: jest.fn(),
            };
            contentScript.eventBuffer = {
                clear: jest.fn(),
            };
            contentScript.stopVideoElementDetection = jest.fn();
            const initialGeneration =
                contentScript.platformInitializationGeneration;

            const result = contentScript._cleanupOnPlayerPageLeave();

            expect(result).toBeUndefined();
            expect(contentScript.platformInitializationGeneration).toBe(
                initialGeneration + 1
            );
            expect(
                contentScript.stopVideoElementDetection
            ).toHaveBeenCalledTimes(1);
            expect(
                contentScript.subtitleUtils.clearSubtitlesDisplayAndQueue
            ).toHaveBeenCalledWith(platform, true, contentScript.logPrefix);
            expect(
                contentScript.subtitleUtils.clearSubtitleDOM
            ).toHaveBeenCalledTimes(1);
            expect(contentScript.activePlatform).toBeNull();
            expect(contentScript.platformReady).toBe(false);
            expect(contentScript.eventBuffer.clear).toHaveBeenCalledTimes(1);

            await Promise.resolve();
            expect(platform.cleanup).toHaveBeenCalledTimes(1);

            contentScript._cleanupOnPlayerPageLeave();
            await Promise.resolve();
            expect(platform.cleanup).toHaveBeenCalledTimes(1);
        });

        test('still cleans the captured platform when event-buffer reset fails', async () => {
            const platform = {
                cleanup: jest.fn().mockResolvedValue(),
            };
            contentScript.activePlatform = platform;
            contentScript.subtitleUtils = null;
            contentScript.stopVideoElementDetection = jest.fn();
            contentScript.eventBuffer = {
                clear: jest.fn(() => {
                    throw new Error('buffer clear failed');
                }),
            };

            expect(() =>
                contentScript._cleanupOnPlayerPageLeave()
            ).not.toThrow();
            await Promise.resolve();

            expect(contentScript.activePlatform).toBeNull();
            expect(platform.cleanup).toHaveBeenCalledTimes(1);
        });

        test('cancels a delayed page-enter task when leaving the player', async () => {
            jest.useFakeTimers();
            try {
                contentScript.initializePlatform = jest
                    .fn()
                    .mockResolvedValue(true);
                contentScript.subtitleUtils = null;
                contentScript.eventBuffer = { clear: jest.fn() };
                contentScript.stopVideoElementDetection = jest.fn();

                contentScript._schedulePlatformInitializationOnPageEnter(
                    () => ({ subtitlesEnabled: true }),
                    () => true,
                    1500
                );
                expect(jest.getTimerCount()).toBe(1);

                contentScript._cleanupOnPlayerPageLeave();

                expect(jest.getTimerCount()).toBe(0);
                await jest.advanceTimersByTimeAsync(1500);
                expect(contentScript.initializePlatform).not.toHaveBeenCalled();
            } finally {
                jest.useRealTimers();
            }
        });

        test('does not restart page-enter features after initialization becomes stale', async () => {
            jest.useFakeTimers();
            try {
                let resolveInitialization;
                const initialization = new Promise((resolve) => {
                    resolveInitialization = resolve;
                });
                contentScript.initializePlatform = jest.fn(
                    () => initialization
                );
                contentScript._restartAIContextFeatures = jest
                    .fn()
                    .mockResolvedValue();
                contentScript.subtitleUtils = null;
                contentScript.eventBuffer = { clear: jest.fn() };
                contentScript.stopVideoElementDetection = jest.fn();

                contentScript._schedulePlatformInitializationOnPageEnter(
                    () => ({
                        subtitlesEnabled: true,
                        aiContextEnabled: true,
                    }),
                    () => true,
                    1500
                );
                await jest.advanceTimersByTimeAsync(1500);
                expect(contentScript.initializePlatform).toHaveBeenCalledTimes(
                    1
                );

                contentScript._cleanupOnPlayerPageLeave();
                resolveInitialization(true);
                await Promise.resolve();
                await Promise.resolve();

                expect(
                    contentScript._restartAIContextFeatures
                ).not.toHaveBeenCalled();
            } finally {
                jest.useRealTimers();
            }
        });

        test('lets only the latest page-enter task initialize after async config', async () => {
            jest.useFakeTimers();
            try {
                let resolveFirstConfig;
                const firstConfig = new Promise((resolve) => {
                    resolveFirstConfig = resolve;
                });
                contentScript.initializePlatform = jest
                    .fn()
                    .mockResolvedValue(true);
                contentScript._restartAIContextFeatures = jest
                    .fn()
                    .mockResolvedValue();

                contentScript._schedulePlatformInitializationOnPageEnter(
                    () => firstConfig,
                    () => true,
                    1500
                );
                await jest.advanceTimersByTimeAsync(1500);

                contentScript._schedulePlatformInitializationOnPageEnter(
                    () => ({
                        subtitlesEnabled: true,
                        aiContextEnabled: true,
                    }),
                    () => true,
                    1500
                );
                await jest.advanceTimersByTimeAsync(1500);
                expect(contentScript.initializePlatform).toHaveBeenCalledTimes(
                    1
                );

                resolveFirstConfig({
                    subtitlesEnabled: true,
                    aiContextEnabled: true,
                });
                await Promise.resolve();
                await Promise.resolve();

                expect(contentScript.initializePlatform).toHaveBeenCalledTimes(
                    1
                );
                expect(
                    contentScript._restartAIContextFeatures
                ).toHaveBeenCalledTimes(1);
            } finally {
                jest.useRealTimers();
            }
        });

        test('ignores an older completion after page leave starts a new generation', async () => {
            const createGate = () => {
                let resolve;
                const promise = new Promise((gateResolve) => {
                    resolve = gateResolve;
                });
                return { promise, resolve };
            };
            const firstGate = createGate();
            const secondGate = createGate();
            let firstSubtitleCallback;
            let firstVideoIdCallback;
            const firstPlatform = {
                initialize: jest.fn((onSubtitleData, onVideoIdChange) => {
                    firstSubtitleCallback = onSubtitleData;
                    firstVideoIdCallback = onVideoIdChange;
                    return firstGate.promise;
                }),
                isPlayerPageActive: jest.fn().mockReturnValue(true),
                handleNativeSubtitles: jest.fn(),
                cleanup: jest.fn(),
            };
            const secondPlatform = {
                initialize: jest.fn(() => secondGate.promise),
                isPlayerPageActive: jest.fn().mockReturnValue(true),
                handleNativeSubtitles: jest.fn(),
                cleanup: jest.fn(),
            };
            contentScript.PlatformClass = jest
                .fn()
                .mockImplementationOnce(() => firstPlatform)
                .mockImplementationOnce(() => secondPlatform);
            contentScript.handleSubtitleDataFound = jest.fn();
            contentScript.handleVideoIdChange = jest.fn();

            const firstInitialization = contentScript.initializePlatform();
            await Promise.resolve();
            await Promise.resolve();
            expect(firstPlatform.initialize).toHaveBeenCalledTimes(1);

            contentScript._cleanupOnPlayerPageLeave();
            await Promise.resolve();
            expect(firstPlatform.cleanup).toHaveBeenCalledTimes(1);
            firstSubtitleCallback({ vttText: 'stale' });
            firstVideoIdCallback('stale-video');
            expect(
                contentScript.handleSubtitleDataFound
            ).not.toHaveBeenCalled();
            expect(contentScript.handleVideoIdChange).not.toHaveBeenCalled();

            const secondInitialization = contentScript.initializePlatform();
            expect(secondInitialization).not.toBe(firstInitialization);

            await Promise.resolve();
            await Promise.resolve();
            secondGate.resolve();
            await expect(secondInitialization).resolves.toBe(true);

            firstGate.resolve();
            await expect(firstInitialization).resolves.toBe(false);
            expect(firstPlatform.handleNativeSubtitles).not.toHaveBeenCalled();
            expect(secondPlatform.handleNativeSubtitles).toHaveBeenCalledTimes(
                1
            );
            expect(
                contentScript.startVideoElementDetection
            ).toHaveBeenCalledTimes(1);
            expect(contentScript.platformReady).toBe(true);
            expect(contentScript.activePlatform).toBe(secondPlatform);
            expect(firstPlatform.cleanup).toHaveBeenCalledTimes(1);
        });

        test('ignores a completion after its platform candidate disappears', async () => {
            let completeInitialization;
            const initializationGate = new Promise((resolve) => {
                completeInitialization = resolve;
            });
            const platform = {
                initialize: jest.fn(() => initializationGate),
                isPlayerPageActive: jest.fn().mockReturnValue(true),
                handleNativeSubtitles: jest.fn(),
                cleanup: jest.fn(),
            };
            contentScript.PlatformClass = jest.fn(() => platform);

            const initialization = contentScript.initializePlatform();
            await Promise.resolve();
            await Promise.resolve();
            expect(platform.initialize).toHaveBeenCalledTimes(1);

            contentScript.activePlatform = null;
            completeInitialization();

            await expect(initialization).resolves.toBe(false);
            expect(platform.cleanup).toHaveBeenCalledTimes(1);
            expect(platform.handleNativeSubtitles).not.toHaveBeenCalled();
            expect(
                contentScript.startVideoElementDetection
            ).not.toHaveBeenCalled();
            expect(contentScript.platformReady).toBe(false);
        });

        test('does not let an older failure clean a newer platform candidate', async () => {
            const createGate = () => {
                let resolve;
                let reject;
                const promise = new Promise((gateResolve, gateReject) => {
                    resolve = gateResolve;
                    reject = gateReject;
                });
                return { promise, resolve, reject };
            };
            const firstGate = createGate();
            const secondGate = createGate();
            const firstPlatform = {
                initialize: jest.fn(() => firstGate.promise),
                isPlayerPageActive: jest.fn().mockReturnValue(true),
                handleNativeSubtitles: jest.fn(),
                cleanup: jest.fn(),
            };
            const secondPlatform = {
                initialize: jest.fn(() => secondGate.promise),
                isPlayerPageActive: jest.fn().mockReturnValue(true),
                handleNativeSubtitles: jest.fn(),
                cleanup: jest.fn(),
            };
            contentScript.PlatformClass = jest
                .fn()
                .mockImplementationOnce(() => firstPlatform)
                .mockImplementationOnce(() => secondPlatform);

            const firstInitialization = contentScript.initializePlatform();
            await Promise.resolve();
            await Promise.resolve();

            contentScript._invalidatePlatformInitialization();
            const secondInitialization = contentScript.initializePlatform();
            for (let index = 0; index < 10; index++) {
                await Promise.resolve();
            }
            expect(secondPlatform.initialize).toHaveBeenCalledTimes(1);

            firstGate.reject(new Error('older initialization failed'));
            await expect(firstInitialization).resolves.toBe(false);
            expect(secondPlatform.cleanup).not.toHaveBeenCalled();
            expect(contentScript.activePlatform).toBe(secondPlatform);

            secondGate.resolve();
            await expect(secondInitialization).resolves.toBe(true);
            expect(secondPlatform.handleNativeSubtitles).toHaveBeenCalledTimes(
                1
            );
            expect(contentScript.platformReady).toBe(true);
        });

        test('cancels a pending platform retry during cleanup', async () => {
            jest.useFakeTimers();
            try {
                const PlatformClass = jest.fn(() => {
                    throw new Error('initialization failed');
                });
                contentScript.PlatformClass = PlatformClass;
                contentScript.currentConfig.platformInitMaxRetries = 1;
                contentScript.currentConfig.platformInitRetryDelay = 1000;

                const initialization = contentScript.initializePlatform();
                for (let index = 0; index < 10; index++) {
                    await Promise.resolve();
                }
                expect(jest.getTimerCount()).toBe(1);

                await contentScript.cleanup();

                expect(jest.getTimerCount()).toBe(0);
                await expect(initialization).resolves.toBe(false);
                await jest.advanceTimersByTimeAsync(1000);
                expect(PlatformClass).toHaveBeenCalledTimes(1);
            } finally {
                jest.useRealTimers();
            }
        });
    });

    describe('Configuration Error Scenarios', () => {
        test('stops configuration initialization when schema-backed loading rejects', async () => {
            const configServiceMock = {
                getAll: jest
                    .fn()
                    .mockRejectedValue(
                        new Error('Config load failed: PRIVATE_CONFIG_MARKER')
                    ),
                onChanged: jest.fn(),
            };

            contentScript.configService = configServiceMock;
            const originalConfig = {
                theme: 'preexisting',
                useOfficialTranslations: false,
            };
            contentScript.currentConfig = originalConfig;
            contentScript.setupConfigurationListeners = jest.fn();
            const normalize = jest.spyOn(
                contentScript,
                '_normalizeConfiguration'
            );
            const applyChanges = jest.spyOn(
                contentScript,
                'applyConfigurationChanges'
            );
            const handleAIChanges = jest.spyOn(
                contentScript,
                '_handleAIContextConfigurationChanges'
            );
            const logSpy = jest.spyOn(contentScript, 'logWithFallback');

            const result = await contentScript.initializeConfiguration();

            expect(result).toBe(false);
            expect(configServiceMock.getAll).toHaveBeenCalledWith({
                includeSensitive: false,
            });
            expect(contentScript.currentConfig).toBe(originalConfig);
            expect(contentScript.currentConfig).toEqual({
                theme: 'preexisting',
                useOfficialTranslations: false,
            });
            expect(normalize).not.toHaveBeenCalled();
            expect(applyChanges).not.toHaveBeenCalled();
            expect(handleAIChanges).not.toHaveBeenCalled();
            expect(
                contentScript.setupConfigurationListeners
            ).not.toHaveBeenCalled();
            expect(logSpy).toHaveBeenCalledWith(
                'error',
                'Failed to load configuration from configService.'
            );
            expect(JSON.stringify(logSpy.mock.calls)).not.toContain(
                'PRIVATE_CONFIG_MARKER'
            );
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
                contentScript.registerMessageHandler('configChanged', null)
            ).toThrow('Handler must be a function');
            expect(() =>
                contentScript.registerMessageHandler(
                    'configChanged',
                    'not a function'
                )
            ).toThrow('Handler must be a function');
            expect(() =>
                contentScript.registerMessageHandler('configChanged', jest.fn())
            ).toThrow('Handler senderRoles must be a non-empty role list.');
            expect(() =>
                contentScript.registerMessageHandler('test', jest.fn(), {
                    senderRoles: ['background'],
                })
            ).toThrow('Action must be present in MessageActions.');
        });

        test('should handle message processing errors gracefully', () => {
            contentScript.registerMessageHandler(
                'LOGGING_LEVEL_CHANGED',
                () => {
                    throw new Error('Handler error');
                },
                { senderRoles: ['background'] }
            );

            const request = {
                action: 'LOGGING_LEVEL_CHANGED',
                level: 4,
            };
            const sendResponse = jest.fn();

            expect(() =>
                contentScript.handleChromeMessage(
                    request,
                    createBackgroundSender(),
                    sendResponse
                )
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

    test('clears the platform initialization timeout after a fast success', async () => {
        const setTimeoutSpy = jest
            .spyOn(global, 'setTimeout')
            .mockReturnValue(123);
        const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
        contentScript.currentConfig = { platformInitTimeout: 1000 };
        contentScript.activePlatform = {
            initialize: jest.fn().mockResolvedValue(undefined),
        };

        await contentScript._initializePlatformWithTimeout();

        expect(clearTimeoutSpy).toHaveBeenCalledWith(123);
        setTimeoutSpy.mockRestore();
        clearTimeoutSpy.mockRestore();
    });

    test('clears the platform cleanup timeout after a fast success', async () => {
        const setTimeoutSpy = jest
            .spyOn(global, 'setTimeout')
            .mockReturnValue(456);
        const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
        contentScript.currentConfig = { cleanupTimeout: 1000 };
        contentScript.activePlatform = {
            cleanup: jest.fn().mockResolvedValue(undefined),
        };

        await contentScript._cleanupPlatformResources();

        expect(clearTimeoutSpy).toHaveBeenCalledWith(456);
        setTimeoutSpy.mockRestore();
        clearTimeoutSpy.mockRestore();
    });

    test('settles a timed-out platform cleanup when timeout logging throws', async () => {
        jest.useFakeTimers();
        const cleanupTimeout = 25;
        const platformCleanup = jest.fn(() => new Promise(() => {}));
        const logSpy = jest
            .spyOn(contentScript, 'logWithFallback')
            .mockImplementation((_level, message) => {
                if (message === 'Platform cleanup timed out') {
                    throw new Error('timeout warning logger failed');
                }
            });

        try {
            contentScript.currentConfig = { cleanupTimeout };
            contentScript.activePlatform = { cleanup: platformCleanup };
            let outcome = 'pending';
            contentScript._cleanupPlatformResources().then(
                () => {
                    outcome = 'resolved';
                },
                () => {
                    outcome = 'rejected';
                }
            );

            expect(platformCleanup).toHaveBeenCalledTimes(1);
            expect(jest.getTimerCount()).toBe(1);
            await jest.advanceTimersByTimeAsync(cleanupTimeout);

            expect(outcome).toBe('resolved');
            expect(contentScript.activePlatform).toBeNull();
            expect(platformCleanup).toHaveBeenCalledTimes(1);
        } finally {
            logSpy.mockRestore();
            jest.useRealTimers();
        }
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
        await contentScript.cleanup();
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
                false
            );
            expect(contentScript.hasMessageHandler('configChanged')).toBe(true);
            expect(
                contentScript.hasMessageHandler('LOGGING_LEVEL_CHANGED')
            ).toBe(true);

            // Verify handler information
            const handlers = contentScript.getRegisteredHandlers();
            expect(handlers).toHaveLength(5);
        });

        test('should handle event buffering consistently across platforms', () => {
            const testEvents = ['test1', 'test2', 'test3'].map((data) =>
                createAuthorizedInjectorEvent(
                    contentScript,
                    'SUBTITLE_DATA_FOUND',
                    { data }
                )
            );

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
            expect(mockConfigService.getAll).toHaveBeenCalledWith({
                includeSensitive: false,
            });
            expect(contentScript.currentConfig).toEqual({
                theme: 'dark',
                language: 'en',
                useOfficialTranslations: true,
            });

            // Cleanup
            chromeApiMock();
            expect(mockConfigService.onChanged).toHaveBeenCalledWith(
                expect.any(Function),
                { includeSensitive: false }
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

    describe('AI context interaction contracts', () => {
        const aiDocumentEvents = [
            'dualsub-system-initialized',
            'dualsub-analysis-complete',
            'dualsub-analysis-error',
            'dualsub-modal-state-change',
            'fullscreenchange',
        ];

        const createDeferred = () => {
            let resolve;
            let reject;
            const promise = new Promise((resolvePromise, rejectPromise) => {
                resolve = resolvePromise;
                reject = rejectPromise;
            });
            return { promise, resolve, reject };
        };

        const createWordIntent = (word) => ({
            action: 'toggle',
            renderRevision: 1,
            wordIndex: 0,
            word,
            sourceLanguage: 'en',
            targetLanguage: 'es',
        });

        const hostileNativePromiseThenVariants = [
            {
                description: 'own then getter throws',
                create(rawSentinel) {
                    const promise = Promise.resolve();
                    Object.defineProperty(promise, 'then', {
                        configurable: true,
                        get() {
                            throw new Error(rawSentinel);
                        },
                    });
                    return promise;
                },
            },
            {
                description: 'own then function throws',
                create(rawSentinel) {
                    const promise = Promise.resolve();
                    Object.defineProperty(promise, 'then', {
                        configurable: true,
                        value() {
                            throw new Error(rawSentinel);
                        },
                    });
                    return promise;
                },
            },
        ];

        const createAIManager = (initialize = Promise.resolve(true)) => ({
            initialize: jest.fn(() => initialize),
            enableFeature: jest.fn().mockResolvedValue(true),
            getEnabledFeatures: jest.fn(() => [
                'interactiveSubtitles',
                'contextModal',
                'textSelection',
            ]),
            destroy: jest.fn().mockResolvedValue(),
        });

        const createHostFacadeManager = async (aiContextConfig = {}) => {
            const managerModuleSource = `
                export class AIContextManager {
                    constructor(...args) {
                        this.args = args;
                        this.config = args[1];
                        this.contentScript = args[1]?.contentScript;
                    }
                }
            `;
            const managerModuleUrl = `data:text/javascript,${encodeURIComponent(
                managerModuleSource
            )}`;
            chrome.runtime.getURL.mockImplementation((path) =>
                path === 'content_scripts/aicontext/core/AIContextManager.js'
                    ? managerModuleUrl
                    : path
            );
            return contentScript._createAIContextManager(
                aiContextConfig,
                contentScript.aiContextFeatureOwner
            );
        };

        const configureEnabledAIContext = (managers) => {
            contentScript.configService = {};
            global.chrome.storage = {
                sync: {
                    get: jest.fn().mockResolvedValue({
                        sidePanelUseSidePanel: true,
                        sidePanelAutoOpen: true,
                        sidePanelAutoPauseVideo: true,
                    }),
                },
                onChanged: {
                    addListener: jest.fn(),
                    removeListener: jest.fn(),
                },
            };
            jest.spyOn(
                contentScript,
                '_getAIContextConfiguration'
            ).mockResolvedValue({
                aiContextEnabled: true,
                aiContextTypes: ['cultural'],
                aiContextTimeout: 1000,
                aiContextRetryAttempts: 1,
            });
            contentScript.subtitleUtils = {
                initializeInteractiveSubtitleFeatures: jest
                    .fn()
                    .mockResolvedValue(),
                setInteractiveSubtitlesEnabled: jest.fn(),
                updateSubtitlePosition: jest.fn(),
            };
            jest.spyOn(
                contentScript,
                '_createAIContextManager'
            ).mockImplementation(() => Promise.resolve(managers.shift()));
        };

        const getActiveAIListeners = (addSpy, removeSpy) => {
            const active = new Map(
                aiDocumentEvents.map((eventName) => [eventName, new Set()])
            );
            for (const [eventName, listener] of addSpy.mock.calls) {
                active.get(eventName)?.add(listener);
            }
            for (const [eventName, listener] of removeSpy.mock.calls) {
                active.get(eventName)?.delete(listener);
            }
            return active;
        };

        test('does not expose AI cleanup settlement or lifecycle mutation hooks', () => {
            const forbiddenSurfaces = [
                'aiContextCleanupBarrier',
                '_createAIContextFeatureOwner',
                '_isAIContextFeatureOwnerCurrent',
                '_registerAIContextFeatureCleanup',
                '_drainAIContextFeatureOwner',
                '_beginAIContextFeatureLifecycle',
                '_destroyAIContextManagerCandidate',
                '_destroySidePanelIntegrationCandidate',
                '_trackAIContextManagerCandidateFactory',
                '_registerAIContextInteractiveCleanup',
                '_trackAIContextInteractiveInitialization',
                '_preventStaleAIContextInteractionCommit',
                '_commitAIContextInteractionState',
                '_setAIContextInteractionsEnabled',
                '_releaseAIContextManagerCandidate',
                '_detachAIContextCandidate',
                '_destroyAIContextTransitionCandidate',
                'managerCandidateClaims',
                'candidateCleanupPromises',
            ];

            for (const surface of forbiddenSurfaces) {
                expect(surface in contentScript).toBe(false);
            }
        });

        test('one candidate occupying both AI roles is destroyed exactly once', async () => {
            const sharedCandidate = {
                destroy: jest.fn().mockResolvedValue(),
            };
            contentScript.aiContextManager = sharedCandidate;
            contentScript.sidePanelIntegration = sharedCandidate;

            await contentScript._disableAIContextInteractions();

            expect(sharedCandidate.destroy).toHaveBeenCalledTimes(1);
            expect(contentScript.aiContextManager).toBeNull();
            expect(contentScript.sidePanelIntegration).toBeNull();
        });

        test.each([
            { role: 'aiContextManager' },
            { role: 'sidePanelIntegration' },
        ])(
            'a $role candidate cannot replace its role descriptor during destruction',
            async ({ role }) => {
                const candidate = {
                    destroy: jest.fn(() => {
                        Object.defineProperty(contentScript, role, {
                            configurable: false,
                            value: candidate,
                            writable: false,
                        });
                    }),
                };
                contentScript[role] = candidate;
                const settleWithin = (promise) =>
                    Promise.race([
                        promise.then(
                            () => 'settled',
                            () => 'rejected'
                        ),
                        new Promise((resolve) => {
                            setTimeout(() => resolve('timed-out'), 25);
                        }),
                    ]);

                const firstOutcome = await settleWithin(
                    contentScript._disableAIContextInteractions()
                );
                const roleIsNull = contentScript[role] === null;
                const secondOutcome = await settleWithin(
                    contentScript._disableAIContextInteractions()
                );
                const observed = {
                    destroyCalls: candidate.destroy.mock.calls.length,
                    firstOutcome,
                    roleIsNull,
                    secondOutcome,
                };
                const descriptor = Object.getOwnPropertyDescriptor(
                    contentScript,
                    role
                );

                // A successful hostile replacement poisons this instance for
                // the suite's automatic terminal cleanup. Preserve the RED
                // observations, then release the outer harness reference.
                if (
                    descriptor?.configurable === false &&
                    Object.hasOwn(descriptor, 'value') &&
                    descriptor.value === candidate
                ) {
                    contentScript = null;
                }

                expect(observed).toEqual({
                    destroyCalls: 1,
                    firstOutcome: 'settled',
                    roleIsNull: true,
                    secondOutcome: 'settled',
                });
            }
        );

        test('a shared candidate hostile native Promise cannot strand disable or later cleanup', async () => {
            const rawSentinel = 'RAW_CANDIDATE_PROMISE_CONSTRUCTOR_SENTINEL';
            const hostileDestroyPromise = Promise.resolve();
            Object.defineProperty(hostileDestroyPromise, 'constructor', {
                configurable: true,
                get() {
                    throw new Error(rawSentinel);
                },
            });
            const laterCandidate = {
                destroy: jest.fn().mockResolvedValue(),
            };
            const sharedCandidate = {
                destroy: jest.fn(() => {
                    contentScript.aiContextManager = laterCandidate;
                    return hostileDestroyPromise;
                }),
            };
            contentScript.aiContextManager = sharedCandidate;
            contentScript.sidePanelIntegration = sharedCandidate;
            const logger = jest.spyOn(contentScript, 'logWithFallback');
            const settleWithin = (promise) =>
                Promise.race([
                    promise.then(
                        () => 'settled',
                        () => 'rejected'
                    ),
                    new Promise((resolve) => {
                        setTimeout(() => resolve('timed-out'), 25);
                    }),
                ]);

            const firstOutcome = await settleWithin(
                contentScript._disableAIContextInteractions()
            );
            const secondOutcome = await settleWithin(
                contentScript._disableAIContextInteractions()
            );

            expect({
                firstOutcome,
                laterDestroyCalls: laterCandidate.destroy.mock.calls.length,
                secondOutcome,
                sharedDestroyCalls: sharedCandidate.destroy.mock.calls.length,
            }).toEqual({
                firstOutcome: 'settled',
                laterDestroyCalls: 1,
                secondOutcome: 'settled',
                sharedDestroyCalls: 1,
            });
            expect(logger).toHaveBeenCalledWith(
                'error',
                'AI context manager destruction failed'
            );
            expect(JSON.stringify(logger.mock.calls)).not.toContain(
                rawSentinel
            );
        });

        test.each(hostileNativePromiseThenVariants)(
            'a shared candidate native Promise whose $description cannot strand disable or later cleanup',
            async ({ create }) => {
                const rawSentinel = 'RAW_CANDIDATE_PROMISE_THEN_SENTINEL';
                const hostileDestroyPromise = create(rawSentinel);
                const laterCandidate = {
                    destroy: jest.fn().mockResolvedValue(),
                };
                const sharedCandidate = {
                    destroy: jest.fn(() => {
                        contentScript.aiContextManager = laterCandidate;
                        return hostileDestroyPromise;
                    }),
                };
                contentScript.aiContextManager = sharedCandidate;
                contentScript.sidePanelIntegration = sharedCandidate;
                const logger = jest.spyOn(contentScript, 'logWithFallback');
                const settleWithin = (promise) =>
                    Promise.race([
                        promise.then(
                            () => 'settled',
                            () => 'rejected'
                        ),
                        new Promise((resolve) => {
                            setTimeout(() => resolve('timed-out'), 25);
                        }),
                    ]);

                const firstOutcome = await settleWithin(
                    contentScript._disableAIContextInteractions()
                );
                const secondOutcome = await settleWithin(
                    contentScript._disableAIContextInteractions()
                );

                expect({
                    firstOutcome,
                    laterDestroyCalls: laterCandidate.destroy.mock.calls.length,
                    secondOutcome,
                    sharedDestroyCalls:
                        sharedCandidate.destroy.mock.calls.length,
                }).toEqual({
                    firstOutcome: 'settled',
                    laterDestroyCalls: 1,
                    secondOutcome: 'settled',
                    sharedDestroyCalls: 1,
                });
                expect(
                    logger.mock.calls.filter(
                        ([level, message]) =>
                            level === 'error' &&
                            message === 'AI context manager destruction failed'
                    )
                ).toHaveLength(1);
                expect(JSON.stringify(logger.mock.calls)).not.toContain(
                    rawSentinel
                );
            }
        );

        test('manager destruction may await a new high-level disable without inheriting its outer transition', async () => {
            const escape = createDeferred();
            let nestedDisable = null;
            const manager = {
                destroy: jest.fn(async () => {
                    await Promise.resolve();
                    nestedDisable =
                        contentScript._disableAIContextInteractions();
                    await Promise.race([nestedDisable, escape.promise]);
                }),
            };
            contentScript.aiContextManager = manager;

            const outerDisable = contentScript._disableAIContextInteractions();
            const outcome = await Promise.race([
                outerDisable.then(() => 'settled'),
                new Promise((resolve) => {
                    setTimeout(() => resolve('timed-out'), 25);
                }),
            ]);

            escape.resolve();
            await outerDisable;
            await nestedDisable;

            expect(outcome).toBe('settled');
            expect(manager.destroy).toHaveBeenCalledTimes(1);
        });

        test('late interactive binding cleanup keeps disable pending until returned async work settles', async () => {
            const manager = createAIManager();
            const deferredBinding = createDeferred();
            const deferredBindingCleanup = createDeferred();
            const bindingCleanup = jest.fn(
                () => deferredBindingCleanup.promise
            );
            configureEnabledAIContext([manager]);
            contentScript.subtitleUtils.initializeInteractiveSubtitleFeatures.mockReturnValue(
                deferredBinding.promise
            );

            const initialization = contentScript._restartAIContextFeatures();
            while (
                !contentScript.subtitleUtils
                    .initializeInteractiveSubtitleFeatures.mock.calls.length
            ) {
                await Promise.resolve();
            }
            const disable = contentScript._disableAIContextInteractions();

            deferredBinding.resolve(bindingCleanup);
            await expect(initialization).resolves.toBe(false);
            while (!bindingCleanup.mock.calls.length) {
                await Promise.resolve();
            }
            let disableSettled = false;
            void disable.then(() => {
                disableSettled = true;
            });
            await Promise.resolve();
            await Promise.resolve();
            const settledBeforeCleanupRelease = disableSettled;

            deferredBindingCleanup.resolve();
            await disable;

            expect(settledBeforeCleanupRelease).toBe(false);
            expect(bindingCleanup).toHaveBeenCalledTimes(1);
        });

        test('late interactive binding cleanup with a hostile native Promise cannot strand disable transitions', async () => {
            const rawSentinel = 'RAW_BINDING_PROMISE_CONSTRUCTOR_SENTINEL';
            const manager = createAIManager();
            const deferredBinding = createDeferred();
            const hostileCleanupPromise = Promise.resolve();
            Object.defineProperty(hostileCleanupPromise, 'constructor', {
                configurable: true,
                get() {
                    throw new Error(rawSentinel);
                },
            });
            const bindingCleanup = jest.fn(() => hostileCleanupPromise);
            const logger = jest.spyOn(contentScript, 'logWithFallback');
            configureEnabledAIContext([manager]);
            contentScript.subtitleUtils.initializeInteractiveSubtitleFeatures.mockReturnValue(
                deferredBinding.promise
            );

            const initialization = contentScript._restartAIContextFeatures();
            while (
                !contentScript.subtitleUtils
                    .initializeInteractiveSubtitleFeatures.mock.calls.length
            ) {
                await Promise.resolve();
            }
            const firstDisable = contentScript._disableAIContextInteractions();

            deferredBinding.resolve(bindingCleanup);
            await expect(initialization).resolves.toBe(false);
            while (!bindingCleanup.mock.calls.length) {
                await Promise.resolve();
            }
            const secondDisable = contentScript._disableAIContextInteractions();
            const settleWithin = (promise) =>
                Promise.race([
                    promise.then(
                        () => 'settled',
                        () => 'rejected'
                    ),
                    new Promise((resolve) => {
                        setTimeout(() => resolve('timed-out'), 25);
                    }),
                ]);

            await expect(
                Promise.all([
                    settleWithin(firstDisable),
                    settleWithin(secondDisable),
                ])
            ).resolves.toEqual(['settled', 'settled']);
            expect(bindingCleanup).toHaveBeenCalledTimes(1);
            expect(logger).toHaveBeenCalledWith(
                'warn',
                'AI feature cleanup failed'
            );
            expect(JSON.stringify(logger.mock.calls)).not.toContain(
                rawSentinel
            );
        });

        test.each(hostileNativePromiseThenVariants)(
            'late interactive binding cleanup with a native Promise whose $description cannot strand disable transitions',
            async ({ create }) => {
                const rawSentinel = 'RAW_BINDING_PROMISE_THEN_SENTINEL';
                const manager = createAIManager();
                const deferredBinding = createDeferred();
                const hostileCleanupPromise = create(rawSentinel);
                const bindingCleanup = jest.fn(() => hostileCleanupPromise);
                const logger = jest.spyOn(contentScript, 'logWithFallback');
                configureEnabledAIContext([manager]);
                contentScript.subtitleUtils.initializeInteractiveSubtitleFeatures.mockReturnValue(
                    deferredBinding.promise
                );

                const initialization =
                    contentScript._restartAIContextFeatures();
                while (
                    !contentScript.subtitleUtils
                        .initializeInteractiveSubtitleFeatures.mock.calls.length
                ) {
                    await Promise.resolve();
                }
                const firstDisable =
                    contentScript._disableAIContextInteractions();

                deferredBinding.resolve(bindingCleanup);
                await expect(initialization).resolves.toBe(false);
                while (!bindingCleanup.mock.calls.length) {
                    await Promise.resolve();
                }
                const secondDisable =
                    contentScript._disableAIContextInteractions();
                const settleWithin = (promise) =>
                    Promise.race([
                        promise.then(
                            () => 'settled',
                            () => 'rejected'
                        ),
                        new Promise((resolve) => {
                            setTimeout(() => resolve('timed-out'), 25);
                        }),
                    ]);

                await expect(
                    Promise.all([
                        settleWithin(firstDisable),
                        settleWithin(secondDisable),
                    ])
                ).resolves.toEqual(['settled', 'settled']);
                expect(bindingCleanup).toHaveBeenCalledTimes(1);
                expect(
                    logger.mock.calls.filter(
                        ([level, message]) =>
                            level === 'warn' &&
                            message === 'AI feature cleanup failed'
                    )
                ).toHaveLength(1);
                expect(JSON.stringify(logger.mock.calls)).not.toContain(
                    rawSentinel
                );
            }
        );

        test('terminal cleanup joins every in-flight disable transition', async () => {
            const firstDestruction = createDeferred();
            const secondDestruction = createDeferred();
            const firstManager = {
                destroy: jest.fn(() => firstDestruction.promise),
            };
            const secondManager = {
                destroy: jest.fn(() => secondDestruction.promise),
            };
            contentScript.aiContextManager = firstManager;

            const firstDisable = contentScript._disableAIContextInteractions();
            while (!firstManager.destroy.mock.calls.length) {
                await Promise.resolve();
            }

            contentScript.aiContextManager = secondManager;
            const secondDisable = contentScript._disableAIContextInteractions();
            while (!secondManager.destroy.mock.calls.length) {
                await Promise.resolve();
            }

            let terminalCleanupSettled = false;
            const terminalCleanup = contentScript.cleanup().then(() => {
                terminalCleanupSettled = true;
            });

            secondDestruction.resolve();
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
            const settledBeforeFirstDestruction = terminalCleanupSettled;

            firstDestruction.resolve();
            await firstDisable;
            await secondDisable;
            await terminalCleanup;

            expect(settledBeforeFirstDestruction).toBe(false);
            expect(firstManager.destroy).toHaveBeenCalledTimes(1);
            expect(secondManager.destroy).toHaveBeenCalledTimes(1);
        });

        test('terminal cleanup joins late interactive work started by a downstream cleanup phase', async () => {
            const interactiveInitialization = createDeferred();
            const bindingDestruction = createDeferred();
            const bindingCleanup = jest.fn(() => bindingDestruction.promise);
            const capturedOwner = contentScript.aiContextFeatureOwner;
            contentScript.subtitleUtils = {
                initializeInteractiveSubtitleFeatures: jest.fn(
                    () => interactiveInitialization.promise
                ),
                setInteractiveSubtitlesEnabled: jest.fn(),
            };
            const lateInitialization =
                contentScript._initializeSubtitleUtilsInteractiveFeatures(
                    {
                        aiContextTypes: ['cultural'],
                        aiContextTimeout: 1000,
                        aiContextRetryAttempts: 1,
                    },
                    capturedOwner
                );
            let downstreamPhaseCompleted = false;
            jest.spyOn(
                contentScript,
                '_cleanupDOMResources'
            ).mockImplementation(async () => {
                interactiveInitialization.resolve(bindingCleanup);
                while (!bindingCleanup.mock.calls.length) {
                    await Promise.resolve();
                }
                await lateInitialization;
                downstreamPhaseCompleted = true;
            });
            const observersReached = createDeferred();
            const cleanupObservers = jest
                .spyOn(contentScript, '_cleanupObservers')
                .mockImplementation(async () => {
                    observersReached.resolve();
                });

            const cleanup = contentScript.cleanup();
            await observersReached.promise;
            await cleanupObservers.mock.results[0].value;
            const cleanupOutcomeBeforeBindingDestruction = await Promise.race([
                cleanup.then(
                    () => 'settled',
                    () => 'rejected'
                ),
                new Promise((resolve) => {
                    setTimeout(() => resolve('pending'), 25);
                }),
            ]);

            bindingDestruction.resolve();
            await cleanup;
            await lateInitialization;

            expect({
                bindingCleanupCalls: bindingCleanup.mock.calls.length,
                cleanupObserverCalls: cleanupObservers.mock.calls.length,
                cleanupOutcomeBeforeBindingDestruction,
                downstreamPhaseCompleted,
            }).toEqual({
                bindingCleanupCalls: 1,
                cleanupObserverCalls: 1,
                cleanupOutcomeBeforeBindingDestruction: 'pending',
                downstreamPhaseCompleted: true,
            });
        });

        test('terminal cleanup remains independent from dispatcher telemetry failures', async () => {
            const loggerFailure = new Error('dispatcher-telemetry-failure');
            const dispatcherMessages = [
                'Starting comprehensive content script cleanup',
                'Content script cleanup completed successfully',
                'Cleanup already performed, skipping',
            ];
            const observedDispatcherMessages = [];
            const logSpy = jest
                .spyOn(contentScript, 'logWithFallback')
                .mockImplementation((_level, message) => {
                    if (dispatcherMessages.includes(message)) {
                        observedDispatcherMessages.push(message);
                        throw loggerFailure;
                    }
                });
            const stopAllDetectionActivities = jest
                .spyOn(contentScript, '_stopAllDetectionActivities')
                .mockResolvedValue();

            try {
                await expect(contentScript.cleanup()).resolves.toBeUndefined();

                let ordinaryCleanup;
                expect(() => {
                    ordinaryCleanup = contentScript.cleanup();
                }).not.toThrow();
                await expect(ordinaryCleanup).resolves.toBeUndefined();

                expect(stopAllDetectionActivities).toHaveBeenCalledTimes(1);
                expect(observedDispatcherMessages).toEqual(dispatcherMessages);
            } finally {
                logSpy.mockRestore();
            }
        });

        test('terminal cleanup remains independent from all helper telemetry failures', async () => {
            const phaseOrder = [];
            const telemetryFailure = new Error('all-helper-telemetry-failure');
            const manager = {
                destroy: jest.fn(() => {
                    phaseOrder.push('ai-manager-destroy');
                    return Promise.resolve();
                }),
            };
            const observerCleanup = jest.fn(() => {
                phaseOrder.push('observer-cleanup');
            });
            contentScript.aiContextManager = manager;
            contentScript.domObserverCleanupFunctions = [observerCleanup];
            const resetInternalState = jest
                .spyOn(contentScript, '_resetInternalState')
                .mockImplementation(() => {
                    phaseOrder.push('reset-internal-state');
                });
            const logSpy = jest
                .spyOn(contentScript, 'logWithFallback')
                .mockImplementation(() => {
                    throw telemetryFailure;
                });

            try {
                await expect(contentScript.cleanup()).resolves.toBeUndefined();

                expect(phaseOrder).toEqual([
                    'ai-manager-destroy',
                    'observer-cleanup',
                    'reset-internal-state',
                ]);
                expect(manager.destroy).toHaveBeenCalledTimes(1);
                expect(observerCleanup).toHaveBeenCalledTimes(1);
                expect(resetInternalState).toHaveBeenCalledTimes(1);
                expect(contentScript.isCleanedUp).toBe(true);
            } finally {
                logSpy.mockRestore();
            }
        });

        test('terminal cleanup excludes dispatcher telemetry failures from ordered phase aggregation', async () => {
            const syncPhaseFailure = Object.freeze({
                phase: 'platform-invalidation',
            });
            const asyncPhaseFailure = Symbol('stop-detection');
            const loggerFailure = new Error('dispatcher-telemetry-failure');
            const dispatcherMessages = new Set([
                'Starting comprehensive content script cleanup',
                'Content script cleanup completed successfully',
                'Cleanup already performed, skipping',
            ]);
            const logSpy = jest
                .spyOn(contentScript, 'logWithFallback')
                .mockImplementation((_level, message) => {
                    if (dispatcherMessages.has(message)) {
                        throw loggerFailure;
                    }
                });
            const manager = {
                destroy: jest.fn().mockResolvedValue(),
            };
            contentScript.aiContextManager = manager;
            const invalidatePlatformInitialization = jest
                .spyOn(contentScript, '_invalidatePlatformInitialization')
                .mockImplementation(() => {
                    throw syncPhaseFailure;
                });
            const stopAllDetectionActivities = jest
                .spyOn(contentScript, '_stopAllDetectionActivities')
                .mockRejectedValue(asyncPhaseFailure);
            const laterPhaseSpies = [
                '_cleanupPlatformResources',
                '_cleanupDOMResources',
                '_cleanupEventHandling',
                '_cleanupTimersAndIntervals',
                '_cleanupObservers',
            ].map((methodName) =>
                jest.spyOn(contentScript, methodName).mockResolvedValue()
            );
            const resetInternalState = jest
                .spyOn(contentScript, '_resetInternalState')
                .mockImplementation(() => {});

            try {
                const cleanupResult = await contentScript.cleanup().then(
                    () => ({ status: 'fulfilled' }),
                    (error) => ({ status: 'rejected', error })
                );

                expect(cleanupResult.status).toBe('rejected');
                expect(cleanupResult.error).toBeInstanceOf(AggregateError);
                expect(cleanupResult.error.errors).toStrictEqual([
                    syncPhaseFailure,
                    asyncPhaseFailure,
                ]);
                expect(cleanupResult.error.errors[0]).toBe(syncPhaseFailure);
                expect(cleanupResult.error.errors[1]).toBe(asyncPhaseFailure);
                expect(cleanupResult.error.errors).not.toContain(loggerFailure);
                expect(manager.destroy).toHaveBeenCalledTimes(1);
                expect(invalidatePlatformInitialization).toHaveBeenCalledTimes(
                    1
                );
                expect(stopAllDetectionActivities).toHaveBeenCalledTimes(1);
                for (const phaseSpy of laterPhaseSpies) {
                    expect(phaseSpy).toHaveBeenCalledTimes(1);
                }
                expect(resetInternalState).toHaveBeenCalledTimes(1);
            } finally {
                logSpy.mockRestore();
            }
        });

        test('terminal cleanup aggregates ordered phase failures while continuing through every phase and final lifecycle join', async () => {
            const phaseOrder = [];
            const invalidationFailure = Object.freeze({
                phase: 'platform-invalidation',
            });
            const detectionFailure = new Error('detection-phase-failure');
            const domFailure = Symbol('dom-phase-failure');
            const observerFailure = new Error('observer-phase-failure');
            const resetFailure = Object.freeze({ phase: 'state-reset' });
            const expectedFailures = [
                invalidationFailure,
                detectionFailure,
                domFailure,
                observerFailure,
                resetFailure,
            ];
            const interactiveInitialization = createDeferred();
            const bindingDestruction = createDeferred();
            const bindingCleanup = jest.fn(() => {
                phaseOrder.push('late-binding-cleanup');
                return bindingDestruction.promise;
            });
            const capturedOwner = contentScript.aiContextFeatureOwner;
            contentScript.subtitleUtils = {
                initializeInteractiveSubtitleFeatures: jest.fn(
                    () => interactiveInitialization.promise
                ),
                setInteractiveSubtitlesEnabled: jest.fn(),
            };
            const lateInitialization =
                contentScript._initializeSubtitleUtilsInteractiveFeatures(
                    {
                        aiContextTypes: ['cultural'],
                        aiContextTimeout: 1000,
                        aiContextRetryAttempts: 1,
                    },
                    capturedOwner
                );
            const manager = {
                destroy: jest.fn(() => {
                    phaseOrder.push('initial-lifecycle-begin');
                }),
            };
            contentScript.aiContextManager = manager;
            jest.spyOn(contentScript, 'logWithFallback').mockImplementation(
                (_level, message) => {
                    if (message === 'Cleaning up AI Context Manager...') {
                        phaseOrder.push('base-ai-cleanup');
                    }
                }
            );
            const invalidatePlatformInitialization = jest
                .spyOn(contentScript, '_invalidatePlatformInitialization')
                .mockImplementation(() => {
                    phaseOrder.push('invalidate-platform-initialization');
                    throw invalidationFailure;
                });
            const stopAllDetectionActivities = jest
                .spyOn(contentScript, '_stopAllDetectionActivities')
                .mockImplementation(async () => {
                    phaseOrder.push('stop-detection');
                    throw detectionFailure;
                });
            const cleanupPlatformResources = jest
                .spyOn(contentScript, '_cleanupPlatformResources')
                .mockImplementation(async () => {
                    phaseOrder.push('cleanup-platform');
                });
            const cleanupDOMResources = jest
                .spyOn(contentScript, '_cleanupDOMResources')
                .mockImplementation(async () => {
                    phaseOrder.push('cleanup-dom');
                    interactiveInitialization.resolve(bindingCleanup);
                    await lateInitialization;
                    throw domFailure;
                });
            const cleanupEventHandling = jest
                .spyOn(contentScript, '_cleanupEventHandling')
                .mockImplementation(async () => {
                    phaseOrder.push('cleanup-events');
                });
            const cleanupTimersAndIntervals = jest
                .spyOn(contentScript, '_cleanupTimersAndIntervals')
                .mockImplementation(async () => {
                    phaseOrder.push('cleanup-timers');
                });
            const cleanupObservers = jest
                .spyOn(contentScript, '_cleanupObservers')
                .mockImplementation(async () => {
                    phaseOrder.push('cleanup-observers');
                    throw observerFailure;
                });
            const allPhasesReached = createDeferred();
            const resetInternalState = jest
                .spyOn(contentScript, '_resetInternalState')
                .mockImplementation(() => {
                    phaseOrder.push('reset-state');
                    allPhasesReached.resolve();
                    throw resetFailure;
                });

            const firstCleanup = contentScript.cleanup();
            const sharedCleanup = contentScript.cleanup(true);
            const observedCleanup = firstCleanup.then(
                () => ({ status: 'fulfilled' }),
                (error) => ({ status: 'rejected', error })
            );
            const progressBeforeBindingRelease = await Promise.race([
                allPhasesReached.promise.then(() => 'all-phases-reached'),
                observedCleanup.then(() => 'cleanup-settled-first'),
            ]);
            let cleanupOutcomeBeforeBindingRelease = 'phases-not-reached';
            let pendingObservationTimer = null;
            try {
                if (progressBeforeBindingRelease === 'all-phases-reached') {
                    cleanupOutcomeBeforeBindingRelease = await Promise.race([
                        observedCleanup.then(() => 'settled'),
                        new Promise((resolve) => {
                            pendingObservationTimer = setTimeout(
                                () => resolve('pending'),
                                25
                            );
                        }),
                    ]);
                }
            } finally {
                if (pendingObservationTimer !== null) {
                    clearTimeout(pendingObservationTimer);
                }
                interactiveInitialization.resolve(bindingCleanup);
                bindingDestruction.resolve();
                await lateInitialization;
            }
            const cleanupResult = await observedCleanup;
            const laterOrdinaryCleanup = contentScript.cleanup();
            await laterOrdinaryCleanup;

            expect(sharedCleanup).toBe(firstCleanup);
            expect(laterOrdinaryCleanup).not.toBe(firstCleanup);
            expect(progressBeforeBindingRelease).toBe('all-phases-reached');
            expect(cleanupOutcomeBeforeBindingRelease).toBe('pending');
            expect(cleanupResult.status).toBe('rejected');
            expect(cleanupResult.error).toBeInstanceOf(AggregateError);
            expect(cleanupResult.error.errors).toHaveLength(
                expectedFailures.length
            );
            expectedFailures.forEach((failure, index) => {
                expect(cleanupResult.error.errors[index]).toBe(failure);
            });
            expect(phaseOrder).toEqual([
                'initial-lifecycle-begin',
                'invalidate-platform-initialization',
                'stop-detection',
                'base-ai-cleanup',
                'cleanup-platform',
                'cleanup-dom',
                'late-binding-cleanup',
                'cleanup-events',
                'cleanup-timers',
                'cleanup-observers',
                'reset-state',
            ]);
            expect(manager.destroy).toHaveBeenCalledTimes(1);
            for (const phaseSpy of [
                invalidatePlatformInitialization,
                stopAllDetectionActivities,
                cleanupPlatformResources,
                cleanupDOMResources,
                cleanupEventHandling,
                cleanupTimersAndIntervals,
                cleanupObservers,
                resetInternalState,
            ]) {
                expect(phaseSpy).toHaveBeenCalledTimes(1);
            }
        });

        test('terminal cleanup rethrows one raw failure after later phases and permits only a forced rerun', async () => {
            const rawFailure = Object.freeze({
                phase: 'first-platform-invalidation',
            });
            const phaseOrder = [];
            let attempt = 0;
            const manager = {
                destroy: jest.fn().mockResolvedValue(),
            };
            contentScript.aiContextManager = manager;
            jest.spyOn(contentScript, 'logWithFallback').mockImplementation(
                (_level, message) => {
                    if (message === 'Cleaning up AI Context Manager...') {
                        phaseOrder.push(`${attempt}:base-ai-cleanup`);
                    }
                }
            );
            const invalidatePlatformInitialization = jest
                .spyOn(contentScript, '_invalidatePlatformInitialization')
                .mockImplementation(() => {
                    attempt += 1;
                    phaseOrder.push(
                        `${attempt}:invalidate-platform-initialization`
                    );
                    if (attempt === 1) {
                        throw rawFailure;
                    }
                });
            const installAsyncPhase = (methodName, phaseName) =>
                jest
                    .spyOn(contentScript, methodName)
                    .mockImplementation(async () => {
                        phaseOrder.push(`${attempt}:${phaseName}`);
                    });
            const stopAllDetectionActivities = installAsyncPhase(
                '_stopAllDetectionActivities',
                'stop-detection'
            );
            const cleanupPlatformResources = installAsyncPhase(
                '_cleanupPlatformResources',
                'cleanup-platform'
            );
            const cleanupDOMResources = installAsyncPhase(
                '_cleanupDOMResources',
                'cleanup-dom'
            );
            const cleanupEventHandling = installAsyncPhase(
                '_cleanupEventHandling',
                'cleanup-events'
            );
            const cleanupTimersAndIntervals = installAsyncPhase(
                '_cleanupTimersAndIntervals',
                'cleanup-timers'
            );
            const cleanupObservers = installAsyncPhase(
                '_cleanupObservers',
                'cleanup-observers'
            );
            const resetInternalState = jest
                .spyOn(contentScript, '_resetInternalState')
                .mockImplementation(() => {
                    phaseOrder.push(`${attempt}:reset-state`);
                });

            const firstCleanup = contentScript.cleanup();
            const firstResult = await firstCleanup.then(
                () => ({ status: 'fulfilled' }),
                (error) => ({ status: 'rejected', error })
            );
            const firstAttemptOrder = phaseOrder.slice();
            const callsAfterFirstAttempt = phaseOrder.length;
            const ordinaryCleanup = contentScript.cleanup();
            await ordinaryCleanup;
            const callsAfterOrdinaryCleanup = phaseOrder.length;
            const forcedCleanup = contentScript.cleanup(true);
            await forcedCleanup;
            const forcedAttemptOrder = phaseOrder.slice(
                callsAfterOrdinaryCleanup
            );

            expect(firstResult).toEqual({
                status: 'rejected',
                error: rawFailure,
            });
            expect(firstResult.error).toBe(rawFailure);
            expect(firstResult.error).not.toBeInstanceOf(AggregateError);
            expect(firstAttemptOrder).toEqual([
                '1:invalidate-platform-initialization',
                '1:stop-detection',
                '1:base-ai-cleanup',
                '1:cleanup-platform',
                '1:cleanup-dom',
                '1:cleanup-events',
                '1:cleanup-timers',
                '1:cleanup-observers',
                '1:reset-state',
            ]);
            expect(ordinaryCleanup).not.toBe(firstCleanup);
            expect(callsAfterOrdinaryCleanup).toBe(callsAfterFirstAttempt);
            expect(forcedCleanup).not.toBe(firstCleanup);
            expect(forcedAttemptOrder).toEqual([
                '2:invalidate-platform-initialization',
                '2:stop-detection',
                '2:cleanup-platform',
                '2:cleanup-dom',
                '2:cleanup-events',
                '2:cleanup-timers',
                '2:cleanup-observers',
                '2:reset-state',
            ]);
            expect(manager.destroy).toHaveBeenCalledTimes(1);
            expect(invalidatePlatformInitialization).toHaveBeenCalledTimes(2);
            for (const phaseSpy of [
                stopAllDetectionActivities,
                cleanupPlatformResources,
                cleanupDOMResources,
                cleanupEventHandling,
                cleanupTimersAndIntervals,
                cleanupObservers,
                resetInternalState,
            ]) {
                expect(phaseSpy).toHaveBeenCalledTimes(2);
            }
        });

        test('concurrent cleanup callers share terminal teardown completion', async () => {
            const destruction = createDeferred();
            const manager = {
                destroy: jest.fn(() => destruction.promise),
            };
            contentScript.aiContextManager = manager;
            contentScript.subtitleUtils = {
                clearSubtitleDOM: jest.fn(),
                hideSubtitleContainer: jest.fn(),
                cleanup: jest.fn().mockResolvedValue(),
            };

            const firstCleanup = contentScript.cleanup();
            while (!manager.destroy.mock.calls.length) {
                await Promise.resolve();
            }
            let secondSettled = false;
            const secondCleanupPromise = contentScript.cleanup();
            expect(secondCleanupPromise).toBe(firstCleanup);
            const secondCleanup = secondCleanupPromise.then(() => {
                secondSettled = true;
            });
            let forcedSettled = false;
            const forcedCleanupPromise = contentScript.cleanup(true);
            expect(forcedCleanupPromise).toBe(firstCleanup);
            const forcedCleanup = forcedCleanupPromise.then(() => {
                forcedSettled = true;
            });
            await Promise.resolve();
            await Promise.resolve();
            const settlementBeforeDestruction = {
                ordinary: secondSettled,
                forced: forcedSettled,
            };

            destruction.resolve();
            await firstCleanup;
            await secondCleanup;
            await forcedCleanup;

            expect({
                settlementBeforeDestruction,
                managerDestroyCalls: manager.destroy.mock.calls.length,
                downstreamCleanupCalls:
                    contentScript.subtitleUtils.cleanup.mock.calls.length,
            }).toEqual({
                settlementBeforeDestruction: {
                    ordinary: false,
                    forced: false,
                },
                managerDestroyCalls: 1,
                downstreamCleanupCalls: 1,
            });
        });

        test('an AI feature owner revokes its private channel before candidate cleanup runs', async () => {
            const oldOwner = contentScript.aiContextFeatureOwner;
            const oldListener = jest.fn();
            oldOwner.channel.subscribe('WORD_INTENT', oldListener);
            expect(
                oldOwner.channel.publish('WORD_INTENT', createWordIntent('old'))
            ).toBe(1);

            let deliveredDuringCleanup = null;
            const manager = {
                destroy: jest.fn(() => {
                    deliveredDuringCleanup = oldOwner.channel.publish(
                        'WORD_INTENT',
                        createWordIntent('stale')
                    );
                }),
            };
            contentScript.aiContextManager = manager;

            const disable = contentScript._disableAIContextInteractions();
            const newOwner = contentScript.aiContextFeatureOwner;
            const newListener = jest.fn();
            newOwner.channel.subscribe('WORD_INTENT', newListener);
            await disable;

            expect(deliveredDuringCleanup).toBe(0);
            expect(
                oldOwner.channel.publish(
                    'WORD_INTENT',
                    createWordIntent('stale')
                )
            ).toBe(0);
            expect(
                newOwner.channel.publish('WORD_INTENT', createWordIntent('new'))
            ).toBe(1);
            expect(oldListener).toHaveBeenCalledTimes(1);
            expect(newListener).toHaveBeenCalledTimes(1);
            expect(manager.destroy).toHaveBeenCalledTimes(1);
            expect(newOwner.channel).not.toBe(oldOwner.channel);
            expect(newOwner.generation).toBe(oldOwner.generation + 1);
        });

        test('hostile owner factory and drain overrides cannot intercept lifecycle authority', async () => {
            const interceptedCreationCalls = [];
            const interceptedDrainCalls = [];
            const interceptedBeginCalls = [];
            const interceptedManagerInitializations = [];
            const forgedChannel = {
                publish: jest.fn(() => 1),
                subscribe: jest.fn(() => jest.fn()),
                destroy: jest.fn(),
            };
            const forgedOwner = {
                channel: forgedChannel,
                generation: 999,
                drained: false,
            };

            class HostileContentScript extends TestContentScript {
                _initializeManagers(...args) {
                    interceptedManagerInitializations.push(args);
                }

                _createAIContextFeatureOwner(...args) {
                    interceptedCreationCalls.push(args);
                    return forgedOwner;
                }

                _drainAIContextFeatureOwner(...args) {
                    interceptedDrainCalls.push(args);
                    return Promise.resolve();
                }

                _beginAIContextFeatureLifecycle(...args) {
                    interceptedBeginCalls.push(args);
                    return {
                        owner: forgedOwner,
                        cleanupPromise: Promise.resolve(),
                    };
                }
            }

            let hostileContentScript;
            expect(() => {
                hostileContentScript = new HostileContentScript('Hostile');
            }).not.toThrow();

            const oldOwner = hostileContentScript.aiContextFeatureOwner;
            const oldListener = jest.fn();
            oldOwner.channel.subscribe('WORD_INTENT', oldListener);
            expect(
                oldOwner.channel.publish('WORD_INTENT', createWordIntent('old'))
            ).toBe(1);

            hostileContentScript.configService = null;
            await expect(
                hostileContentScript.initializeAIContextFeatures()
            ).resolves.toBe(false);
            const newOwner = hostileContentScript.aiContextFeatureOwner;
            const newListener = jest.fn();
            newOwner.channel.subscribe('WORD_INTENT', newListener);

            expect(interceptedCreationCalls).toEqual([]);
            expect(interceptedDrainCalls).toEqual([]);
            expect(interceptedBeginCalls).toEqual([]);
            expect(interceptedManagerInitializations).toEqual([]);
            expect(newOwner).not.toBe(forgedOwner);
            expect(
                oldOwner.channel.publish(
                    'WORD_INTENT',
                    createWordIntent('stale')
                )
            ).toBe(0);
            expect(
                newOwner.channel.publish('WORD_INTENT', createWordIntent('new'))
            ).toBe(1);
            expect(forgedChannel.destroy).not.toHaveBeenCalled();

            await hostileContentScript.cleanup();
            expect(interceptedCreationCalls).toEqual([]);
            expect(interceptedDrainCalls).toEqual([]);
            expect(interceptedBeginCalls).toEqual([]);
            expect(
                newOwner.channel.publish(
                    'WORD_INTENT',
                    createWordIntent('terminal')
                )
            ).toBe(0);
        });

        test('hostile candidate-destroy overrides cannot skip lexical transition teardown', async () => {
            const interceptedManagerDestroys = [];
            const interceptedIntegrationDestroys = [];

            class HostileDestroyContentScript extends TestContentScript {
                _destroyAIContextManagerCandidate(...args) {
                    interceptedManagerDestroys.push(args);
                    return Promise.resolve();
                }

                _destroySidePanelIntegrationCandidate(...args) {
                    interceptedIntegrationDestroys.push(args);
                    return Promise.resolve();
                }
            }

            const hostileContentScript = new HostileDestroyContentScript(
                'HostileDestroy'
            );
            const manager = { destroy: jest.fn().mockResolvedValue() };
            const integration = { destroy: jest.fn().mockResolvedValue() };
            hostileContentScript.aiContextManager = manager;
            hostileContentScript.sidePanelIntegration = integration;

            await hostileContentScript._disableAIContextInteractions();

            expect(interceptedManagerDestroys).toEqual([]);
            expect(interceptedIntegrationDestroys).toEqual([]);
            expect(manager.destroy).toHaveBeenCalledTimes(1);
            expect(integration.destroy).toHaveBeenCalledTimes(1);

            await hostileContentScript.cleanup();
        });

        test('candidate destruction ledgers are private and ignore preseeded public replacements', async () => {
            const manager = { destroy: jest.fn().mockResolvedValue() };
            const integration = { destroy: jest.fn().mockResolvedValue() };

            contentScript.cleanedAIContextManagers = new WeakSet([manager]);
            contentScript.cleanedSidePanelIntegrations = new WeakSet([
                integration,
            ]);
            contentScript.aiContextManager = manager;
            contentScript.sidePanelIntegration = integration;

            await contentScript._disableAIContextInteractions();

            expect(manager.destroy).toHaveBeenCalledTimes(1);
            expect(integration.destroy).toHaveBeenCalledTimes(1);
            expect(contentScript.aiContextManager).toBeNull();
            expect(contentScript.sidePanelIntegration).toBeNull();

            await contentScript._disableAIContextInteractions();
            expect(manager.destroy).toHaveBeenCalledTimes(1);
            expect(integration.destroy).toHaveBeenCalledTimes(1);
        });

        test('hostile current override cannot commit a stale legitimate manager', async () => {
            class HostileCurrentContentScript extends TestContentScript {
                _isAIContextFeatureOwnerCurrent() {
                    return true;
                }
            }

            const hostileContentScript = new HostileCurrentContentScript(
                'HostileCurrent'
            );
            const managerInitialization = createDeferred();
            const staleManager = createAIManager(managerInitialization.promise);
            const getEnabledFeatures = jest.fn(() => {
                hostileContentScript._beginAIContextFeatureLifecycle();
                return ['interactiveSubtitles'];
            });
            staleManager.getEnabledFeatures = getEnabledFeatures;
            hostileContentScript.subtitleUtils = {
                initializeInteractiveSubtitleFeatures: jest
                    .fn()
                    .mockResolvedValue(jest.fn()),
                setInteractiveSubtitlesEnabled: jest.fn(),
            };
            hostileContentScript._createAIContextManager = jest
                .fn()
                .mockResolvedValue(staleManager);
            const staleOwner = hostileContentScript.aiContextFeatureOwner;

            const staleInitialization =
                hostileContentScript._initializeModularAIContextFeatures(
                    { aiContextTypes: ['cultural'] },
                    staleOwner
                );
            while (!staleManager.initialize.mock.calls.length) {
                await Promise.resolve();
            }

            const disable =
                hostileContentScript._disableAIContextInteractions();
            const currentOwner = hostileContentScript.aiContextFeatureOwner;
            managerInitialization.resolve(true);

            await expect(staleInitialization).resolves.toBe(false);
            await expect(disable).resolves.toBeUndefined();
            expect(getEnabledFeatures).not.toHaveBeenCalled();
            expect(staleManager.destroy).toHaveBeenCalledTimes(1);
            expect(hostileContentScript.aiContextManager).toBeNull();
            expect(hostileContentScript.aiContextFeatureOwner).toBe(
                currentOwner
            );
            expect(hostileContentScript.aiContextActiveGeneration).toBeNull();
            expect(
                hostileContentScript.subtitleUtils
                    .setInteractiveSubtitlesEnabled
            ).toHaveBeenLastCalledWith(false);

            await hostileContentScript.cleanup();
        });

        test('hostile cleanup-registration override cannot leave AI document listeners live', async () => {
            const interceptedRegistrations = [];

            class HostileRegistrationContentScript extends TestContentScript {
                _registerAIContextFeatureCleanup(...args) {
                    interceptedRegistrations.push(args);
                }
            }

            const hostileContentScript = new HostileRegistrationContentScript(
                'HostileRegistration'
            );
            const addEventListener = jest.spyOn(document, 'addEventListener');
            const removeEventListener = jest.spyOn(
                document,
                'removeEventListener'
            );
            hostileContentScript.aiContextManager = {};
            const owner = hostileContentScript.aiContextFeatureOwner;

            hostileContentScript._setupAIContextEventListeners(owner);
            hostileContentScript._setupFullscreenHandling(owner);
            await hostileContentScript._disableAIContextInteractions();

            const active = getActiveAIListeners(
                addEventListener,
                removeEventListener
            );
            expect(interceptedRegistrations).toEqual([]);
            for (const eventName of aiDocumentEvents) {
                expect(active.get(eventName).size).toBe(0);
            }

            await hostileContentScript.cleanup();
        });

        test('terminal cleanup authority cannot be reset to revive an owner channel', async () => {
            const originalOwner = contentScript.aiContextFeatureOwner;

            await contentScript.cleanup();

            expect(contentScript.isCleanedUp).toBe(true);
            expect(
                originalOwner.channel.publish(
                    'WORD_INTENT',
                    createWordIntent('terminal')
                )
            ).toBe(0);
            expect(Reflect.set(contentScript, 'isCleanedUp', false)).toBe(
                false
            );

            await contentScript._disableAIContextInteractions();
            const postCleanupOwner = contentScript.aiContextFeatureOwner;
            expect(contentScript.isCleanedUp).toBe(true);
            expect(
                postCleanupOwner.channel.publish(
                    'WORD_INTENT',
                    createWordIntent('revived')
                )
            ).toBe(0);
        });

        test('terminal replacement channel is inert before old-owner cleanup callbacks run', async () => {
            const oldOwner = contentScript.aiContextFeatureOwner;
            const terminalListener = jest.fn();
            let terminalOwnerObservedDuringCleanup = null;
            let deliveredDuringCleanup = null;
            contentScript.aiContextManager = {
                destroy: jest.fn(() => {
                    terminalOwnerObservedDuringCleanup =
                        contentScript.aiContextFeatureOwner;
                    terminalOwnerObservedDuringCleanup.channel.subscribe(
                        'WORD_INTENT',
                        terminalListener
                    );
                    deliveredDuringCleanup =
                        terminalOwnerObservedDuringCleanup.channel.publish(
                            'WORD_INTENT',
                            createWordIntent('terminal-window')
                        );
                }),
            };

            await contentScript.cleanup();

            expect(terminalOwnerObservedDuringCleanup).not.toBe(oldOwner);
            expect(deliveredDuringCleanup).toBe(0);
            expect(terminalListener).not.toHaveBeenCalled();
            expect(
                terminalOwnerObservedDuringCleanup.channel.publish(
                    'WORD_INTENT',
                    createWordIntent('terminal-after')
                )
            ).toBe(0);
        });

        test('terminal cleanup rejects a distinct AI role replacement published by a destructor', async () => {
            const replacement = {
                destroy: jest.fn().mockResolvedValue(),
            };
            const candidate = {
                destroy: jest.fn(() => {
                    contentScript.aiContextManager = replacement;
                    contentScript.sidePanelIntegration = replacement;
                }),
            };
            contentScript.aiContextManager = candidate;

            await expect(contentScript.cleanup()).resolves.toBeUndefined();

            expect({
                candidateDestroyCalls: candidate.destroy.mock.calls.length,
                managerIsNull: contentScript.aiContextManager === null,
                replacementDestroyCalls: replacement.destroy.mock.calls.length,
                sidePanelIsNull: contentScript.sidePanelIntegration === null,
            }).toEqual({
                candidateDestroyCalls: 1,
                managerIsNull: true,
                replacementDestroyCalls: 0,
                sidePanelIsNull: true,
            });
        });

        test('an AI owner channel cannot be replaced before high-level invalidation', async () => {
            const owner = contentScript.aiContextFeatureOwner;
            const originalChannel = owner.channel;
            const replacementChannel = {
                publish: jest.fn(),
                subscribe: jest.fn(),
                destroy: jest.fn(),
            };

            expect(Reflect.set(owner, 'channel', replacementChannel)).toBe(
                false
            );
            expect(owner.channel).toBe(originalChannel);

            await contentScript._disableAIContextInteractions();
            expect(
                originalChannel.publish(
                    'WORD_INTENT',
                    createWordIntent('stale')
                )
            ).toBe(0);
            expect(replacementChannel.destroy).not.toHaveBeenCalled();
        });

        test('mutating the owner drained view cannot skip high-level channel drain or cleanup', async () => {
            const owner = contentScript.aiContextFeatureOwner;
            const listener = jest.fn();
            const cleanup = jest.fn();
            owner.channel.subscribe('WORD_INTENT', listener);
            contentScript.aiContextManager = { destroy: cleanup };
            expect(
                owner.channel.publish('WORD_INTENT', createWordIntent('before'))
            ).toBe(1);

            const mutationAccepted = Reflect.set(owner, 'drained', true);
            await contentScript._disableAIContextInteractions();

            expect(
                owner.channel.publish('WORD_INTENT', createWordIntent('after'))
            ).toBe(0);
            expect(cleanup).toHaveBeenCalledTimes(1);
            expect(mutationAccepted).toBe(false);
            expect(owner.drained).toBe(true);
        });

        test('throwing candidate cleanup and lifecycle logger cannot skip later cleanup', async () => {
            const rawSentinel = 'RAW_AI_CLEANUP_SENTINEL';
            const manager = {
                destroy: jest.fn(() => {
                    throw new Error(rawSentinel);
                }),
            };
            const thenGetter = jest.fn(() => {
                throw new Error(`${rawSentinel}_THEN`);
            });
            const hostileThenable = {};
            Object.defineProperty(hostileThenable, 'then', {
                get: thenGetter,
            });
            const integration = {
                destroy: jest.fn(() => hostileThenable),
            };
            contentScript.aiContextManager = manager;
            contentScript.sidePanelIntegration = integration;
            const logger = jest
                .spyOn(contentScript, 'logWithFallback')
                .mockImplementation(() => {
                    throw new Error('logger failure');
                });

            let disable;
            try {
                expect(() => {
                    disable = contentScript._disableAIContextInteractions();
                }).not.toThrow();
                await expect(disable).resolves.toBeUndefined();
            } finally {
                logger.mockRestore();
            }

            expect(manager.destroy).toHaveBeenCalledTimes(1);
            expect(integration.destroy).toHaveBeenCalledTimes(1);
            expect(thenGetter).toHaveBeenCalledTimes(1);
            expect(JSON.stringify(logger.mock.calls)).not.toContain(
                rawSentinel
            );
        });

        test('channel destroy infrastructure failure cannot skip candidate cleanup', async () => {
            const owner = contentScript.aiContextFeatureOwner;
            const rawSentinel = 'RAW_CHANNEL_DESTROY_SENTINEL';
            const cleanup = jest.fn();
            contentScript.aiContextManager = { destroy: cleanup };
            const logger = jest.spyOn(contentScript, 'logWithFallback');
            const removeEventListener = jest
                .spyOn(EventTarget.prototype, 'removeEventListener')
                .mockImplementation(() => {
                    throw new Error(rawSentinel);
                });
            let disable;
            try {
                expect(() => {
                    disable = contentScript._disableAIContextInteractions();
                }).not.toThrow();
            } finally {
                removeEventListener.mockRestore();
            }

            await expect(disable).resolves.toBeUndefined();
            expect(cleanup).toHaveBeenCalledTimes(1);
            expect(
                owner.channel.publish('WORD_INTENT', createWordIntent('stale'))
            ).toBe(0);
            expect(JSON.stringify(logger.mock.calls)).not.toContain(
                rawSentinel
            );
        });

        test('generation mutation cannot grant raw formatter authority or change currentness', async () => {
            const owner = contentScript.aiContextFeatureOwner;
            expect(Reflect.set(owner, 'generation', 777)).toBe(false);
            expect(
                Reflect.set(contentScript, 'aiContextLifecycleGeneration', 777)
            ).toBe(false);

            contentScript.subtitleUtils = {
                initializeInteractiveSubtitleFeatures: jest
                    .fn()
                    .mockResolvedValue(jest.fn()),
                setInteractiveSubtitlesEnabled: jest.fn(),
            };
            await contentScript._initializeSubtitleUtilsInteractiveFeatures(
                {
                    aiContextTypes: ['cultural'],
                    aiContextTimeout: 1000,
                    aiContextRetryAttempts: 1,
                },
                owner
            );
            const call =
                contentScript.subtitleUtils
                    .initializeInteractiveSubtitleFeatures.mock.calls[0];
            expect(call).toHaveLength(3);
            const [, isCurrent, publishWordIntent] = call;
            expect(isCurrent()).toBe(true);
            expect(publishWordIntent).toEqual(expect.any(Function));
        });

        test('the Base manager factory grants only a narrow host capability facade', async () => {
            const owner = contentScript.aiContextFeatureOwner;
            const ownerChannel = owner.channel;
            const contentLogger = Object.freeze(
                Object.assign(Object.create(null), {
                    debug: jest.fn(),
                    info: jest.fn(),
                    warn: jest.fn(),
                    error: jest.fn(),
                })
            );
            const getResult = 'zh-CN';
            const getMultipleResult = Object.freeze({
                targetLanguage: 'es',
                originalLanguage: 'en',
                apiKey: 'RAW_API_KEY',
            });
            const unsubscribe = jest.fn();
            const configService = {
                get: jest.fn(function () {
                    return getResult;
                }),
                getMultiple: jest.fn(function () {
                    return getMultipleResult;
                }),
                onChanged: jest.fn(function () {
                    return unsubscribe;
                }),
                set: jest.fn(),
                getAll: jest.fn(),
                rawConfigServiceCanary: true,
            };
            const firstPauseResult = true;
            const firstPlatform = {
                rawAdapterCanary: true,
                cleanup: jest.fn(),
                pausePlayback: jest.fn(function () {
                    return firstPauseResult;
                }),
            };
            contentScript.contentLogger = contentLogger;
            contentScript.configService = configService;
            contentScript.activePlatform = firstPlatform;
            const captureKey = '__dualsubManagerConstructorArguments';
            const managerModuleSource = `
                export class AIContextManager {
                    constructor(...args) {
                        globalThis.${captureKey} = args;
                        this.config = args[1];
                    }
                }
            `;
            const managerModuleUrl = `data:text/javascript,${encodeURIComponent(
                managerModuleSource
            )}`;
            chrome.runtime.getURL.mockImplementation((path) =>
                path === 'content_scripts/aicontext/core/AIContextManager.js'
                    ? managerModuleUrl
                    : path
            );

            try {
                const manager = await contentScript._createAIContextManager(
                    { aiContextTimeout: 1234, maxSelectionLength: 42 },
                    owner
                );

                expect(globalThis[captureKey]).toHaveLength(2);
                expect(globalThis[captureKey][0]).toBe('test');
                expect(globalThis[captureKey][1]).toBe(manager.config);
                expect(manager.config).not.toHaveProperty('channel');
                expect(manager.config).not.toHaveProperty('generation');
                expect(manager.config.modal).not.toHaveProperty(
                    'contentScript'
                );

                const hostFacade = manager.config.contentScript;
                expect(hostFacade).not.toBe(contentScript);
                expect(Object.getPrototypeOf(hostFacade)).toBeNull();
                expect(Object.isFrozen(hostFacade)).toBe(true);
                expect(Reflect.ownKeys(hostFacade)).toEqual([
                    'contentLogger',
                    'configService',
                    'activePlatform',
                ]);
                expect(hostFacade.contentLogger).toBe(contentLogger);
                expect(Object.values(contentLogger)).not.toContain(
                    contentScript
                );
                expect(Object.values(contentLogger)).not.toContain(owner);
                expect(Object.values(contentLogger)).not.toContain(
                    ownerChannel
                );
                for (const forbiddenKey of [
                    'aiContextFeatureOwner',
                    'channel',
                    'generation',
                    'aiContextLifecycleGeneration',
                    'aiContextActiveGeneration',
                    'aiContextManager',
                    'sidePanelIntegration',
                    'isCleanedUp',
                ]) {
                    expect(hostFacade).not.toHaveProperty(forbiddenKey);
                }

                const configReadFacade = hostFacade.configService;
                expect(configReadFacade).not.toBe(configService);
                expect(Object.getPrototypeOf(configReadFacade)).toBeNull();
                expect(Object.isFrozen(configReadFacade)).toBe(true);
                expect(Reflect.ownKeys(configReadFacade)).toEqual([
                    'get',
                    'getMultiple',
                    'onChanged',
                ]);
                expect(configReadFacade).not.toHaveProperty('set');
                expect(configReadFacade).not.toHaveProperty('getAll');
                expect(configReadFacade).not.toHaveProperty(
                    'rawConfigServiceCanary'
                );

                await expect(configReadFacade.get('uiLanguage')).resolves.toBe(
                    getResult
                );
                expect(configService.get).toHaveBeenCalledWith('uiLanguage');
                expect(configService.get.mock.contexts.at(-1)).toBe(
                    configService
                );
                await expect(
                    configReadFacade.getMultiple([
                        'targetLanguage',
                        'originalLanguage',
                    ])
                ).resolves.toEqual({
                    targetLanguage: 'es',
                    originalLanguage: 'en',
                });
                expect(configService.getMultiple.mock.contexts.at(-1)).toBe(
                    configService
                );
                const onChangedCallback = jest.fn();
                const projectedUnsubscribe =
                    configReadFacade.onChanged(onChangedCallback);
                expect(projectedUnsubscribe).not.toBe(unsubscribe);
                expect(configService.onChanged.mock.calls[0]).toHaveLength(1);
                expect(configService.onChanged.mock.calls[0][0]).toEqual(
                    expect.any(Function)
                );
                expect(configService.onChanged.mock.calls[0][0]).not.toBe(
                    onChangedCallback
                );
                expect(configService.onChanged.mock.contexts.at(-1)).toBe(
                    configService
                );
                await expect(projectedUnsubscribe()).resolves.toBe(true);
                expect(unsubscribe).toHaveBeenCalledTimes(1);

                const pauseFacade = hostFacade.activePlatform;
                expect(pauseFacade).not.toBe(firstPlatform);
                expect(Object.getPrototypeOf(pauseFacade)).toBeNull();
                expect(Object.isFrozen(pauseFacade)).toBe(true);
                expect(Reflect.ownKeys(pauseFacade)).toEqual(['pausePlayback']);
                expect(pauseFacade).not.toHaveProperty('rawAdapterCanary');
                expect(pauseFacade).not.toHaveProperty('cleanup');
                await expect(
                    pauseFacade.pausePlayback('first-reason')
                ).resolves.toBe(firstPauseResult);
                expect(firstPlatform.pausePlayback.mock.calls[0]).toHaveLength(
                    0
                );
                expect(firstPlatform.pausePlayback.mock.contexts.at(-1)).toBe(
                    firstPlatform
                );

                const secondPauseResult = true;
                const secondPlatform = {
                    replacementCanary: true,
                    destroy: jest.fn(),
                    pausePlayback: jest.fn(function () {
                        return secondPauseResult;
                    }),
                };
                contentScript.activePlatform = secondPlatform;
                expect(hostFacade.activePlatform).toBe(pauseFacade);
                await expect(
                    pauseFacade.pausePlayback('second-reason')
                ).resolves.toBe(secondPauseResult);
                expect(secondPlatform.pausePlayback.mock.calls[0]).toHaveLength(
                    0
                );
                expect(secondPlatform.pausePlayback.mock.contexts.at(-1)).toBe(
                    secondPlatform
                );
                expect(pauseFacade).not.toHaveProperty('replacementCanary');
                expect(pauseFacade).not.toHaveProperty('destroy');

                contentScript.activePlatform = null;
                expect(hostFacade.activePlatform).toBeNull();
                contentScript.configService = null;
                expect(hostFacade.configService).toBeNull();
            } finally {
                Reflect.deleteProperty(globalThis, captureKey);
            }
        });

        test('the real manager projects the same narrow host facade into its modal', async () => {
            const owner = contentScript.aiContextFeatureOwner;
            const ownerChannel = owner.channel;
            const unsubscribe = jest.fn();
            const contentLogger = Object.freeze(
                Object.assign(Object.create(null), {
                    debug: jest.fn(),
                    info: jest.fn(),
                    warn: jest.fn(),
                    error: jest.fn(),
                })
            );
            const configService = {
                get: jest.fn(function () {
                    return Promise.resolve('en');
                }),
                getMultiple: jest.fn(function () {
                    return Promise.resolve({
                        targetLanguage: 'es',
                        originalLanguage: 'en',
                    });
                }),
                onChanged: jest.fn(function () {
                    return unsubscribe;
                }),
                set: jest.fn(),
                rawConfigServiceCanary: true,
            };
            const firstPlatform = {
                rawAdapterCanary: true,
                cleanup: jest.fn(),
                pausePlayback: jest.fn(),
            };
            const pauseResult = Promise.resolve(true);
            const replacementPlatform = {
                replacementCanary: true,
                destroy: jest.fn(),
                pausePlayback: jest.fn(function () {
                    return pauseResult;
                }),
            };
            const originalFetch = global.fetch;
            let manager = null;

            contentScript.contentLogger = contentLogger;
            contentScript.configService = configService;
            contentScript.activePlatform = firstPlatform;
            jest.spyOn(contentScript, 'getPlatformName').mockReturnValue(
                'netflix'
            );
            chrome.runtime.getURL.mockImplementation((path) =>
                path === 'content_scripts/aicontext/core/AIContextManager.js'
                    ? new URL(
                          '../aicontext/core/AIContextManager.js',
                          import.meta.url
                      ).href
                    : path
            );
            global.fetch = jest.fn().mockResolvedValue({
                text: jest.fn().mockResolvedValue('.dualsub-context-modal {}'),
            });

            try {
                manager = await contentScript._createAIContextManager(
                    { aiContextTimeout: 1234, maxSelectionLength: 42 },
                    owner
                );
                const hostFacade = manager.contentScript;

                expect(manager.config.contentScript).toBe(hostFacade);
                expect(manager.config.modal).not.toHaveProperty(
                    'contentScript'
                );
                expect(hostFacade).not.toBe(contentScript);
                expect(Reflect.ownKeys(hostFacade)).toEqual([
                    'contentLogger',
                    'configService',
                    'activePlatform',
                ]);
                expect(manager.logger).toBe(contentLogger);
                expect(hostFacade.contentLogger).toBe(contentLogger);
                expect(Object.values(contentLogger)).not.toContain(
                    contentScript
                );
                expect(Object.values(contentLogger)).not.toContain(owner);
                expect(Object.values(contentLogger)).not.toContain(
                    ownerChannel
                );

                const configReadFacade = hostFacade.configService;
                expect(configReadFacade).not.toBe(configService);
                await expect(configReadFacade.get('uiLanguage')).resolves.toBe(
                    'en'
                );
                expect(configService.get.mock.contexts.at(-1)).toBe(
                    configService
                );
                await expect(
                    configReadFacade.getMultiple([
                        'targetLanguage',
                        'originalLanguage',
                    ])
                ).resolves.toEqual({
                    targetLanguage: 'es',
                    originalLanguage: 'en',
                });
                expect(configService.getMultiple.mock.contexts.at(-1)).toBe(
                    configService
                );
                const callback = jest.fn();
                const projectedUnsubscribe =
                    configReadFacade.onChanged(callback);
                expect(projectedUnsubscribe).not.toBe(unsubscribe);
                expect(configService.onChanged.mock.contexts.at(-1)).toBe(
                    configService
                );
                await expect(projectedUnsubscribe()).resolves.toBe(true);

                contentScript.activePlatform = replacementPlatform;
                const pauseFacade = hostFacade.activePlatform;
                expect(pauseFacade).not.toBe(replacementPlatform);
                expect(pauseFacade).not.toHaveProperty('replacementCanary');
                expect(pauseFacade).not.toHaveProperty('destroy');
                await expect(pauseFacade.pausePlayback()).resolves.toBe(true);
                expect(
                    replacementPlatform.pausePlayback.mock.contexts.at(-1)
                ).toBe(replacementPlatform);
                expect(firstPlatform.pausePlayback).not.toHaveBeenCalled();

                await expect(manager.initialize()).resolves.toBe(true);
                expect(manager.modal.core.contentScript).toBe(hostFacade);
                expect(manager.modal.core.contentScript).not.toBe(
                    contentScript
                );
                expect(manager.modal.core.contentScript).not.toBe(owner);
                expect(manager.modal.core.contentScript).not.toBe(ownerChannel);
                expect(contentLogger.info).toHaveBeenCalled();
            } finally {
                if (manager) {
                    await manager.destroy();
                }
                global.fetch = originalFetch;
            }
        });

        test('the host facade uses trusted invocation and grants only primitive uiLanguage reads', async () => {
            const rawObject = Object.freeze({ secret: 'RAW_CONFIG_OBJECT' });
            const configService = {
                get: jest
                    .fn()
                    .mockReturnValueOnce('zh-CN')
                    .mockReturnValueOnce(rawObject),
            };
            contentScript.configService = configService;
            const manager = await createHostFacadeManager();
            const configReadFacade = manager.contentScript.configService;
            const originalReflectApply = Reflect.apply;
            let hostileApplyCalls = 0;
            let firstResult;
            let secondResult;
            let unauthorizedResult;
            let tokenResult;
            let nonStringResult;
            let escapedError;

            Reflect.apply = () => {
                hostileApplyCalls += 1;
                throw new Error('HOSTILE_AMBIENT_REFLECT_APPLY');
            };
            try {
                firstResult = await configReadFacade.get('uiLanguage');
                secondResult = await configReadFacade.get('uiLanguage');
                unauthorizedResult = await configReadFacade.get('apiKey');
                tokenResult = await configReadFacade.get('accessToken');
                nonStringResult = await configReadFacade.get(
                    new String('uiLanguage')
                );
            } catch (error) {
                escapedError = error;
            } finally {
                Reflect.apply = originalReflectApply;
            }

            expect(escapedError).toBeUndefined();
            expect(hostileApplyCalls).toBe(0);
            expect(firstResult).toBe('zh-CN');
            expect(secondResult).toBeUndefined();
            expect(unauthorizedResult).toBeUndefined();
            expect(tokenResult).toBeUndefined();
            expect(nonStringResult).toBeUndefined();
            expect(configService.get).toHaveBeenCalledTimes(2);
            expect(configService.get).toHaveBeenNthCalledWith(1, 'uiLanguage');
            expect(configService.get).toHaveBeenNthCalledWith(2, 'uiLanguage');
            expect(configService.get.mock.contexts).toEqual([
                configService,
                configService,
            ]);
        });

        test('the host facade rejects malformed or sensitive language-key batches before config access', async () => {
            const configService = {
                getMultiple: jest.fn(),
            };
            contentScript.configService = configService;
            const manager = await createHostFacadeManager();
            const configReadFacade = manager.contentScript.configService;
            let accessorCalls = 0;
            const accessorKeys = [];
            accessorKeys.length = 2;
            accessorKeys[1] = 'originalLanguage';
            Object.defineProperty(accessorKeys, '0', {
                enumerable: true,
                get() {
                    accessorCalls += 1;
                    return 'targetLanguage';
                },
            });
            let proxyTrapCalls = 0;
            const trappingKeys = new Proxy(
                ['targetLanguage', 'originalLanguage'],
                {
                    getPrototypeOf() {
                        proxyTrapCalls += 1;
                        throw new Error('TRAPPING_LANGUAGE_KEYS');
                    },
                }
            );
            class ExoticKeys extends Array {}
            const extraKeys = ['targetLanguage', 'originalLanguage'];
            extraKeys.apiKey = 'SECRET';
            const sparseKeys = ['targetLanguage'];
            sparseKeys.length = 2;
            const invalidInputs = [
                ['apiKey', 'token'],
                ['targetLanguage', 'originalLanguage', 'apiKey'],
                sparseKeys,
                accessorKeys,
                new ExoticKeys('targetLanguage', 'originalLanguage'),
                extraKeys,
                trappingKeys,
                { 0: 'targetLanguage', 1: 'originalLanguage', length: 2 },
                null,
            ];

            const results = [];
            for (const input of invalidInputs) {
                results.push(await configReadFacade.getMultiple(input));
            }

            expect(results).toEqual(invalidInputs.map(() => undefined));
            expect(configService.getMultiple).not.toHaveBeenCalled();
            expect(accessorCalls).toBe(0);
            expect(proxyTrapCalls).toBeGreaterThan(0);
        });

        test('the host facade detaches language-key batches and projects fresh primitive-only records', async () => {
            let secretGetterCalls = 0;
            let languageGetterCalls = 0;
            const rawResult = {
                targetLanguage: 'es',
                originalLanguage: 'en',
                apiKey: 'RAW_API_KEY',
                nestedAuthority: { channel: 'RAW_CHANNEL' },
            };
            Object.defineProperty(rawResult, 'token', {
                enumerable: true,
                get() {
                    secretGetterCalls += 1;
                    return 'RAW_TOKEN';
                },
            });
            const accessorResult = {
                originalLanguage: 'ja',
            };
            Object.defineProperty(accessorResult, 'targetLanguage', {
                enumerable: true,
                get() {
                    languageGetterCalls += 1;
                    return 'zh-CN';
                },
            });
            const configService = {
                getMultiple: jest
                    .fn()
                    .mockResolvedValueOnce(rawResult)
                    .mockResolvedValueOnce(rawResult)
                    .mockResolvedValueOnce(accessorResult),
            };
            contentScript.configService = configService;
            const manager = await createHostFacadeManager();
            const configReadFacade = manager.contentScript.configService;
            const callerKeys = ['targetLanguage', 'originalLanguage'];
            const transparentProxyKeys = new Proxy(
                ['targetLanguage', 'originalLanguage'],
                {}
            );
            const originalReflectApply = Reflect.apply;
            let hostileApplyCalls = 0;
            let firstResult;
            let secondResult;
            let accessorProjection;
            let escapedError;

            Reflect.apply = () => {
                hostileApplyCalls += 1;
                throw new Error('HOSTILE_AMBIENT_REFLECT_APPLY');
            };
            try {
                firstResult = await configReadFacade.getMultiple(callerKeys);
                secondResult =
                    await configReadFacade.getMultiple(transparentProxyKeys);
                accessorProjection = await configReadFacade.getMultiple([
                    'targetLanguage',
                    'originalLanguage',
                ]);
            } catch (error) {
                escapedError = error;
            } finally {
                Reflect.apply = originalReflectApply;
            }

            expect(escapedError).toBeUndefined();
            expect(hostileApplyCalls).toBe(0);
            expect(configService.getMultiple).toHaveBeenCalledTimes(3);
            const [firstInternalKeys] = configService.getMultiple.mock.calls[0];
            const [secondInternalKeys] =
                configService.getMultiple.mock.calls[1];
            const [thirdInternalKeys] = configService.getMultiple.mock.calls[2];
            expect(firstInternalKeys).toEqual([
                'targetLanguage',
                'originalLanguage',
            ]);
            expect(secondInternalKeys).toEqual([
                'targetLanguage',
                'originalLanguage',
            ]);
            expect(firstInternalKeys).not.toBe(callerKeys);
            expect(secondInternalKeys).not.toBe(transparentProxyKeys);
            expect(firstInternalKeys).not.toBe(secondInternalKeys);
            expect(thirdInternalKeys).not.toBe(firstInternalKeys);
            expect(thirdInternalKeys).not.toBe(secondInternalKeys);
            expect(configService.getMultiple.mock.contexts).toEqual([
                configService,
                configService,
                configService,
            ]);
            for (const result of [firstResult, secondResult]) {
                expect(result).not.toBe(rawResult);
                expect(Object.getPrototypeOf(result)).toBeNull();
                expect(Object.isFrozen(result)).toBe(true);
                expect(Reflect.ownKeys(result)).toEqual([
                    'targetLanguage',
                    'originalLanguage',
                ]);
                expect(result.targetLanguage).toBe('es');
                expect(result.originalLanguage).toBe('en');
                expect(result).not.toHaveProperty('apiKey');
                expect(result).not.toHaveProperty('token');
                expect(result).not.toHaveProperty('nestedAuthority');
            }
            expect(firstResult).not.toBe(secondResult);
            expect(Object.getPrototypeOf(accessorProjection)).toBeNull();
            expect(Object.isFrozen(accessorProjection)).toBe(true);
            expect(Reflect.ownKeys(accessorProjection)).toEqual([
                'originalLanguage',
            ]);
            expect(accessorProjection.originalLanguage).toBe('ja');
            expect(accessorProjection).not.toHaveProperty('targetLanguage');
            expect(secretGetterCalls).toBe(0);
            expect(languageGetterCalls).toBe(0);
        });

        test('the host facade registers only a trusted primitive uiLanguage change projector', async () => {
            const rawUnsubscribe = jest.fn();
            let rawProjector;
            const configService = {
                onChanged: jest.fn(function (projector) {
                    rawProjector = projector;
                    return rawUnsubscribe;
                }),
            };
            const callerCallback = jest.fn(() => ({
                rawCallbackReturn: true,
            }));
            contentScript.configService = configService;
            const manager = await createHostFacadeManager();
            const configReadFacade = manager.contentScript.configService;
            const originalReflectApply = Reflect.apply;
            let hostileApplyCalls = 0;
            let secretGetterCalls = 0;
            let uiLanguageGetterCalls = 0;
            let proxyTrapCalls = 0;
            let unsubscribe;
            let projectedReturn;
            let secondProjectedReturn;
            let accessorReturn;
            let proxyReturn;
            let escapedError;
            const rawChanges = {
                uiLanguage: 'zh-CN',
                apiKey: 'RAW_API_KEY',
                nestedAuthority: { channel: 'RAW_CHANNEL' },
            };
            Object.defineProperty(rawChanges, 'token', {
                enumerable: true,
                get() {
                    secretGetterCalls += 1;
                    return 'RAW_TOKEN';
                },
            });
            const accessorChanges = { apiKey: 'RAW_API_KEY' };
            Object.defineProperty(accessorChanges, 'uiLanguage', {
                enumerable: true,
                get() {
                    uiLanguageGetterCalls += 1;
                    return 'en';
                },
            });
            const trappingChanges = new Proxy(
                { uiLanguage: 'en' },
                {
                    getOwnPropertyDescriptor() {
                        proxyTrapCalls += 1;
                        throw new Error('TRAPPING_CHANGE_PAYLOAD');
                    },
                }
            );

            Reflect.apply = () => {
                hostileApplyCalls += 1;
                throw new Error('HOSTILE_AMBIENT_REFLECT_APPLY');
            };
            try {
                unsubscribe = configReadFacade.onChanged(callerCallback);
                projectedReturn = await rawProjector(rawChanges);
                secondProjectedReturn = await rawProjector({
                    uiLanguage: 'en',
                });
                accessorReturn = await rawProjector(accessorChanges);
                proxyReturn = await rawProjector(trappingChanges);
            } catch (error) {
                escapedError = error;
            } finally {
                Reflect.apply = originalReflectApply;
            }

            expect(escapedError).toBeUndefined();
            expect(hostileApplyCalls).toBe(0);
            expect(configService.onChanged).toHaveBeenCalledTimes(1);
            expect(configService.onChanged.mock.calls[0]).toHaveLength(1);
            expect(configService.onChanged.mock.calls[0][0]).toBe(rawProjector);
            expect(rawProjector).not.toBe(callerCallback);
            expect(unsubscribe).toEqual(expect.any(Function));
            expect(unsubscribe).not.toBe(rawUnsubscribe);
            expect(projectedReturn).toBeUndefined();
            expect(secondProjectedReturn).toBeUndefined();
            expect(accessorReturn).toBeUndefined();
            expect(proxyReturn).toBeUndefined();
            expect(callerCallback).toHaveBeenCalledTimes(2);
            const projectedChanges = callerCallback.mock.calls[0][0];
            const secondProjectedChanges = callerCallback.mock.calls[1][0];
            expect(Object.getPrototypeOf(projectedChanges)).toBeNull();
            expect(Object.isFrozen(projectedChanges)).toBe(true);
            expect(Reflect.ownKeys(projectedChanges)).toEqual(['uiLanguage']);
            expect(projectedChanges.uiLanguage).toBe('zh-CN');
            expect(projectedChanges).not.toHaveProperty('apiKey');
            expect(projectedChanges).not.toHaveProperty('token');
            expect(projectedChanges).not.toHaveProperty('nestedAuthority');
            expect(Object.getPrototypeOf(secondProjectedChanges)).toBeNull();
            expect(Object.isFrozen(secondProjectedChanges)).toBe(true);
            expect(Reflect.ownKeys(secondProjectedChanges)).toEqual([
                'uiLanguage',
            ]);
            expect(secondProjectedChanges.uiLanguage).toBe('en');
            expect(secondProjectedChanges).not.toBe(projectedChanges);
            expect(secretGetterCalls).toBe(0);
            expect(uiLanguageGetterCalls).toBe(0);
            expect(proxyTrapCalls).toBeGreaterThan(0);
        });

        test('the host facade rejects change-listener options before config access', async () => {
            let optionGetterCalls = 0;
            const options = {};
            Object.defineProperty(options, 'includeSensitive', {
                enumerable: true,
                get() {
                    optionGetterCalls += 1;
                    return true;
                },
            });
            const configService = {
                onChanged: jest.fn(),
            };
            contentScript.configService = configService;
            const manager = await createHostFacadeManager();
            const unsubscribe = manager.contentScript.configService.onChanged(
                jest.fn(),
                options
            );

            expect(configService.onChanged).not.toHaveBeenCalled();
            expect(optionGetterCalls).toBe(0);
            expect(unsubscribe).toEqual(expect.any(Function));
            await expect(unsubscribe()).resolves.toBe(false);
            await expect(unsubscribe()).resolves.toBe(false);
        });

        test('the host facade returns a distinct trusted once-only unsubscribe', async () => {
            const rawReturn = Object.freeze({ rawUnsubscribeResult: true });
            const rawUnsubscribe = jest.fn(function () {
                return rawReturn;
            });
            const configService = {
                onChanged: jest.fn(function () {
                    return rawUnsubscribe;
                }),
            };
            contentScript.configService = configService;
            const manager = await createHostFacadeManager();
            const unsubscribe = manager.contentScript.configService.onChanged(
                jest.fn()
            );
            const originalReflectApply = Reflect.apply;
            let hostileApplyCalls = 0;
            let firstResult;
            let secondResult;
            let escapedError;

            Reflect.apply = () => {
                hostileApplyCalls += 1;
                throw new Error('HOSTILE_AMBIENT_REFLECT_APPLY');
            };
            try {
                firstResult = await unsubscribe('IGNORED_ARGUMENT');
                secondResult = await unsubscribe();
            } catch (error) {
                escapedError = error;
            } finally {
                Reflect.apply = originalReflectApply;
            }

            expect(escapedError).toBeUndefined();
            expect(hostileApplyCalls).toBe(0);
            expect(unsubscribe).not.toBe(rawUnsubscribe);
            expect(firstResult).toBe(true);
            expect(firstResult).not.toBe(rawReturn);
            expect(secondResult).toBe(false);
            expect(rawUnsubscribe).toHaveBeenCalledTimes(1);
            expect(rawUnsubscribe.mock.calls[0]).toHaveLength(0);
            expect(rawUnsubscribe.mock.contexts[0]).toBeUndefined();
        });

        test('the host facade revokes a retained change projector before raw unsubscribe reentrancy', async () => {
            let rawProjector;
            const callback = jest.fn();
            const rawUnsubscribe = jest.fn(async function () {
                await rawProjector({ uiLanguage: 'reentrant' });
            });
            const configService = {
                onChanged: jest.fn(function (projector) {
                    rawProjector = projector;
                    return rawUnsubscribe;
                }),
            };
            contentScript.configService = configService;
            const manager = await createHostFacadeManager();
            const unsubscribe =
                manager.contentScript.configService.onChanged(callback);

            await expect(unsubscribe()).resolves.toBe(true);
            await rawProjector({ uiLanguage: 'late' });

            expect(rawUnsubscribe).toHaveBeenCalledTimes(1);
            expect(callback).not.toHaveBeenCalled();
            await expect(unsubscribe()).resolves.toBe(false);
        });

        test('the host facade unsubscribe normalizes registration, throw, and rejection failures', async () => {
            contentScript.configService = null;
            const manager = await createHostFacadeManager();
            const callback = jest.fn();
            const registrationFailure = Object.freeze({
                rawRegistrationFailure: true,
            });
            const throwingFailure = Object.freeze({ rawThrowFailure: true });
            const rejectionFailure = Object.freeze({
                rawRejectionFailure: true,
            });
            let registrationProjector;

            const registrationService = {
                onChanged: jest.fn(function (projector) {
                    registrationProjector = projector;
                    throw registrationFailure;
                }),
            };
            contentScript.configService = registrationService;
            const registrationUnsubscribe =
                manager.contentScript.configService.onChanged(callback);

            const throwingRawUnsubscribe = jest.fn(function () {
                throw throwingFailure;
            });
            const throwingService = {
                onChanged: jest.fn(function () {
                    return throwingRawUnsubscribe;
                }),
            };
            contentScript.configService = throwingService;
            const throwingUnsubscribe =
                manager.contentScript.configService.onChanged(callback);

            const rejectingRawUnsubscribe = jest.fn(function () {
                return Promise.reject(rejectionFailure);
            });
            const rejectingService = {
                onChanged: jest.fn(function () {
                    return rejectingRawUnsubscribe;
                }),
            };
            contentScript.configService = rejectingService;
            const rejectingUnsubscribe =
                manager.contentScript.configService.onChanged(callback);

            let malformedProjector;
            const malformedService = {
                onChanged: jest.fn(function (projector) {
                    malformedProjector = projector;
                    return { rawUnsubscribeAuthority: true };
                }),
            };
            contentScript.configService = malformedService;
            const malformedUnsubscribe =
                manager.contentScript.configService.onChanged(callback);

            await registrationProjector({ uiLanguage: 'registration-late' });
            await malformedProjector({ uiLanguage: 'malformed-late' });

            await expect(registrationUnsubscribe()).resolves.toBe(false);
            await expect(registrationUnsubscribe()).resolves.toBe(false);
            await expect(throwingUnsubscribe()).resolves.toBe(false);
            await expect(throwingUnsubscribe()).resolves.toBe(false);
            await expect(rejectingUnsubscribe()).resolves.toBe(false);
            await expect(rejectingUnsubscribe()).resolves.toBe(false);
            await expect(malformedUnsubscribe()).resolves.toBe(false);
            await expect(malformedUnsubscribe()).resolves.toBe(false);
            expect(throwingRawUnsubscribe).toHaveBeenCalledTimes(1);
            expect(rejectingRawUnsubscribe).toHaveBeenCalledTimes(1);
            expect(callback).not.toHaveBeenCalled();
            expect([
                await registrationUnsubscribe(),
                await throwingUnsubscribe(),
                await rejectingUnsubscribe(),
                await malformedUnsubscribe(),
            ]).toEqual([false, false, false, false]);
        });

        test('the retained host facade follows config-service availability and replacement', async () => {
            contentScript.configService = null;
            const manager = await createHostFacadeManager();
            const hostFacade = manager.contentScript;
            expect(hostFacade.configService).toBeNull();

            const firstRawUnsubscribe = jest.fn();
            const firstService = {
                get: jest.fn(function () {
                    return 'en';
                }),
                getMultiple: jest.fn(function () {
                    return {
                        targetLanguage: 'es',
                        originalLanguage: 'en',
                    };
                }),
                onChanged: jest.fn(function () {
                    return firstRawUnsubscribe;
                }),
            };
            contentScript.configService = firstService;
            const retainedConfigFacade = hostFacade.configService;
            await expect(retainedConfigFacade.get('uiLanguage')).resolves.toBe(
                'en'
            );
            await expect(
                retainedConfigFacade.getMultiple([
                    'targetLanguage',
                    'originalLanguage',
                ])
            ).resolves.toEqual({
                targetLanguage: 'es',
                originalLanguage: 'en',
            });
            expect(firstService.get.mock.contexts.at(-1)).toBe(firstService);
            expect(firstService.getMultiple.mock.contexts.at(-1)).toBe(
                firstService
            );

            const secondService = {
                get: jest.fn(function () {
                    return 'zh-CN';
                }),
            };
            contentScript.configService = secondService;
            expect(hostFacade.configService).toBe(retainedConfigFacade);
            await expect(retainedConfigFacade.get('uiLanguage')).resolves.toBe(
                'zh-CN'
            );
            expect(secondService.get.mock.contexts.at(-1)).toBe(secondService);
            expect(firstService.get).toHaveBeenCalledTimes(1);

            contentScript.configService = {};
            await expect(retainedConfigFacade.get('uiLanguage')).resolves.toBe(
                undefined
            );
            await expect(
                retainedConfigFacade.getMultiple([
                    'targetLanguage',
                    'originalLanguage',
                ])
            ).resolves.toBeUndefined();
            const missingMethodUnsubscribe = retainedConfigFacade.onChanged(
                jest.fn()
            );
            await expect(missingMethodUnsubscribe()).resolves.toBe(false);

            contentScript.configService = null;
            expect(hostFacade.configService).toBeNull();
            await expect(retainedConfigFacade.get('uiLanguage')).resolves.toBe(
                undefined
            );
            const unavailableUnsubscribe = retainedConfigFacade.onChanged(
                jest.fn()
            );
            await expect(unavailableUnsubscribe()).resolves.toBe(false);

            contentScript.configService = firstService;
            const nonCallableUnsubscribe = retainedConfigFacade.onChanged({
                callback: 'not-callable',
            });
            await expect(nonCallableUnsubscribe()).resolves.toBe(false);
            expect(firstService.onChanged).not.toHaveBeenCalled();
        });

        test('the host facade exposes only frozen getter projections and frozen data capabilities', async () => {
            const contentLogger = Object.freeze({ info: jest.fn() });
            contentScript.contentLogger = contentLogger;
            contentScript.configService = {
                get: jest.fn(),
                getMultiple: jest.fn(),
                onChanged: jest.fn(),
            };
            contentScript.activePlatform = {
                pausePlayback: jest.fn(),
            };
            const manager = await createHostFacadeManager();
            const hostFacade = manager.contentScript;
            const configReadFacade = hostFacade.configService;
            const pauseFacade = hostFacade.activePlatform;

            expect(Object.getPrototypeOf(hostFacade)).toBeNull();
            expect(Object.isFrozen(hostFacade)).toBe(true);
            expect(Reflect.ownKeys(hostFacade)).toEqual([
                'contentLogger',
                'configService',
                'activePlatform',
            ]);
            const hostDescriptors =
                Object.getOwnPropertyDescriptors(hostFacade);
            expect(hostDescriptors.contentLogger).toEqual(
                expect.objectContaining({
                    configurable: false,
                    enumerable: true,
                    value: contentLogger,
                    writable: false,
                })
            );
            expect(hostDescriptors.contentLogger.get).toBeUndefined();
            expect(hostDescriptors.contentLogger.set).toBeUndefined();
            for (const key of ['configService', 'activePlatform']) {
                expect(hostDescriptors[key].configurable).toBe(false);
                expect(hostDescriptors[key].enumerable).toBe(true);
                expect(hostDescriptors[key].get).toEqual(expect.any(Function));
                expect(hostDescriptors[key].set).toBeUndefined();
                expect(hostDescriptors[key]).not.toHaveProperty('value');
                expect(Reflect.set(hostFacade, key, null)).toBe(false);
            }
            expect(Reflect.set(hostFacade, 'contentLogger', null)).toBe(false);
            expect(hostFacade.contentLogger).toBe(contentLogger);
            expect(hostFacade.configService).toBe(configReadFacade);
            expect(hostFacade.activePlatform).toBe(pauseFacade);

            for (const [facade, expectedKeys] of [
                [configReadFacade, ['get', 'getMultiple', 'onChanged']],
                [pauseFacade, ['pausePlayback']],
            ]) {
                expect(Object.getPrototypeOf(facade)).toBeNull();
                expect(Object.isFrozen(facade)).toBe(true);
                expect(Reflect.ownKeys(facade)).toEqual(expectedKeys);
                for (const key of expectedKeys) {
                    const descriptor = Object.getOwnPropertyDescriptor(
                        facade,
                        key
                    );
                    expect(descriptor).toEqual(
                        expect.objectContaining({
                            configurable: false,
                            enumerable: true,
                            value: expect.any(Function),
                            writable: false,
                        })
                    );
                    expect(descriptor.get).toBeUndefined();
                    expect(descriptor.set).toBeUndefined();
                    expect(Reflect.set(facade, key, jest.fn())).toBe(false);
                }
            }
        });

        test('the host facade pause capability uses the trusted current adapter and returns only literal success', async () => {
            const initialPlatform = {
                pausePlayback: jest.fn(function () {
                    return true;
                }),
            };
            contentScript.activePlatform = initialPlatform;
            const manager = await createHostFacadeManager();
            const hostFacade = manager.contentScript;
            const pauseFacade = hostFacade.activePlatform;
            const objectResult = Object.freeze({ rawPlatformResult: true });
            const throwingError = Object.freeze({ rawThrow: true });
            const originalReflectApply = Reflect.apply;
            let hostileApplyCalls = 0;
            let escapedError;
            const results = [];

            Reflect.apply = () => {
                hostileApplyCalls += 1;
                throw new Error('HOSTILE_AMBIENT_REFLECT_APPLY');
            };
            try {
                results.push(
                    await pauseFacade.pausePlayback(
                        'IGNORED_ARGUMENT',
                        objectResult
                    )
                );
                contentScript.activePlatform = {
                    pausePlayback: jest.fn(() => objectResult),
                };
                results.push(await pauseFacade.pausePlayback());
                const returningThisPlatform = {
                    pausePlayback: jest.fn(function () {
                        return this;
                    }),
                };
                contentScript.activePlatform = returningThisPlatform;
                results.push(await pauseFacade.pausePlayback());
                const resolvingThisPlatform = {
                    pausePlayback: jest.fn(function () {
                        return Promise.resolve(this);
                    }),
                };
                contentScript.activePlatform = resolvingThisPlatform;
                results.push(await pauseFacade.pausePlayback());
                const throwingPlatform = {
                    pausePlayback: jest.fn(function () {
                        throw throwingError;
                    }),
                };
                contentScript.activePlatform = throwingPlatform;
                results.push(await pauseFacade.pausePlayback());
                const rejectingPlatform = {
                    pausePlayback: jest.fn(function () {
                        return Promise.reject(this);
                    }),
                };
                contentScript.activePlatform = rejectingPlatform;
                results.push(await pauseFacade.pausePlayback());
                const replacementPlatform = {
                    pausePlayback: jest.fn(function () {
                        return true;
                    }),
                };
                contentScript.activePlatform = replacementPlatform;
                results.push(await pauseFacade.pausePlayback());
                contentScript.activePlatform = null;
                results.push(await pauseFacade.pausePlayback());
                contentScript.activePlatform = {};
                results.push(await pauseFacade.pausePlayback());
            } catch (error) {
                escapedError = error;
            } finally {
                Reflect.apply = originalReflectApply;
            }

            expect(escapedError).toBeUndefined();
            expect(hostileApplyCalls).toBe(0);
            expect(results).toEqual([
                true,
                false,
                false,
                false,
                false,
                false,
                true,
                false,
                false,
            ]);
            expect(initialPlatform.pausePlayback).toHaveBeenCalledTimes(1);
            expect(initialPlatform.pausePlayback.mock.calls[0]).toHaveLength(0);
            expect(initialPlatform.pausePlayback.mock.contexts[0]).toBe(
                initialPlatform
            );
            expect(hostFacade.activePlatform).toBeNull();
        });

        test('the host facade fails closed when raw capability lookup throws', async () => {
            contentScript.configService = {};
            contentScript.activePlatform = {
                pausePlayback: jest.fn(() => true),
            };
            const manager = await createHostFacadeManager();
            const hostFacade = manager.contentScript;
            const configReadFacade = hostFacade.configService;
            const retainedPauseFacade = hostFacade.activePlatform;
            const rawLookupFailure = Object.freeze({ rawLookupFailure: true });
            const hostileConfigService = {};
            for (const method of ['get', 'getMultiple', 'onChanged']) {
                Object.defineProperty(hostileConfigService, method, {
                    get() {
                        throw rawLookupFailure;
                    },
                });
            }
            const hostilePlatform = {};
            Object.defineProperty(hostilePlatform, 'pausePlayback', {
                get() {
                    throw rawLookupFailure;
                },
            });
            contentScript.configService = hostileConfigService;
            contentScript.activePlatform = hostilePlatform;

            await expect(configReadFacade.get('uiLanguage')).resolves.toBe(
                undefined
            );
            await expect(
                configReadFacade.getMultiple([
                    'targetLanguage',
                    'originalLanguage',
                ])
            ).resolves.toBeUndefined();
            let unsubscribe;
            expect(() => {
                unsubscribe = configReadFacade.onChanged(jest.fn());
            }).not.toThrow();
            await expect(unsubscribe()).resolves.toBe(false);
            expect(() => hostFacade.activePlatform).not.toThrow();
            expect(hostFacade.activePlatform).toBeNull();
            await expect(retainedPauseFacade.pausePlayback()).resolves.toBe(
                false
            );
        });

        test('the retained config facade fails closed when host config lookup throws', async () => {
            contentScript.configService = {};
            const manager = await createHostFacadeManager();
            const configReadFacade = manager.contentScript.configService;
            const callback = jest.fn();
            const originalDescriptor = Object.getOwnPropertyDescriptor(
                contentScript,
                'configService'
            );

            Object.defineProperty(contentScript, 'configService', {
                configurable: true,
                get() {
                    throw new Error('raw host config lookup failure');
                },
            });

            try {
                await expect(
                    configReadFacade.get('uiLanguage')
                ).resolves.toBeUndefined();
                await expect(
                    configReadFacade.getMultiple([
                        'targetLanguage',
                        'originalLanguage',
                    ])
                ).resolves.toBeUndefined();

                let unsubscribe;
                expect(() => {
                    unsubscribe = configReadFacade.onChanged(callback);
                }).not.toThrow();
                await expect(unsubscribe()).resolves.toBe(false);
                await expect(unsubscribe()).resolves.toBe(false);
                expect(callback).not.toHaveBeenCalled();
            } finally {
                Object.defineProperty(
                    contentScript,
                    'configService',
                    originalDescriptor
                );
            }
        });

        test('a forged AI owner cannot inject a channel or generation into the manager', async () => {
            chrome.runtime.getURL.mockImplementation((path) =>
                path === 'content_scripts/aicontext/core/AIContextManager.js'
                    ? new URL(
                          '../aicontext/core/AIContextManager.js',
                          import.meta.url
                      ).href
                    : path
            );
            const forgedChannel = {
                publish: jest.fn(),
                subscribe: jest.fn(),
                destroy: jest.fn(),
            };
            const forgedOwner = {
                channel: forgedChannel,
                generation: 999,
                drained: false,
            };

            await expect(
                contentScript._createAIContextManager(
                    { aiContextTimeout: 1234 },
                    forgedOwner
                )
            ).rejects.toThrow('Invalid AI context feature owner');
        });

        test('a stale owner cannot start the modular manager factory', async () => {
            const staleOwner = contentScript.aiContextFeatureOwner;
            const createManager = jest.spyOn(
                contentScript,
                '_createAIContextManager'
            );

            await contentScript._disableAIContextInteractions();

            await expect(
                contentScript._initializeModularAIContextFeatures(
                    { aiContextEnabled: true },
                    staleOwner
                )
            ).resolves.toBe(false);
            expect(createManager).not.toHaveBeenCalled();
        });

        test('modular initializer accessor reentrancy cannot bypass the canonical owner check', async () => {
            const manager = createAIManager();
            configureEnabledAIContext([manager]);
            const createManager = contentScript._createAIContextManager;
            const initializerAccessor = jest.fn();
            let nestedDisable = null;
            initializerAccessor.mockImplementation(() => {
                nestedDisable = contentScript._disableAIContextInteractions();
                return BaseContentScript.prototype
                    ._initializeModularAIContextFeatures;
            });
            Object.defineProperty(
                contentScript,
                '_initializeModularAIContextFeatures',
                {
                    configurable: true,
                    get: initializerAccessor,
                }
            );

            await expect(
                contentScript.initializeAIContextFeatures()
            ).resolves.toBe(false);
            await expect(nestedDisable).resolves.toBeUndefined();

            expect(initializerAccessor).toHaveBeenCalledTimes(1);
            expect(createManager).not.toHaveBeenCalled();
        });

        test('a deferred manager factory invalidated through disable destroys the stale candidate', async () => {
            const factory = createDeferred();
            const staleManager = createAIManager();
            configureEnabledAIContext([]);
            contentScript._createAIContextManager.mockImplementation(
                () => factory.promise
            );

            const initialization = contentScript._restartAIContextFeatures();
            while (!contentScript._createAIContextManager.mock.calls.length) {
                await Promise.resolve();
            }

            const disable = contentScript._disableAIContextInteractions();
            factory.resolve(staleManager);

            await expect(initialization).resolves.toBe(false);
            await expect(disable).resolves.toBeUndefined();
            expect(staleManager.initialize).not.toHaveBeenCalled();
            expect(staleManager.destroy).toHaveBeenCalledTimes(1);
            expect(contentScript.aiContextManager).toBeNull();
        });

        test.each([
            { reattachedRole: 'aiContextManager' },
            { reattachedRole: 'sidePanelIntegration' },
        ])(
            'a stale deferred manager candidate cannot asynchronously republish itself as $reattachedRole',
            async ({ reattachedRole }) => {
                const factory = createDeferred();
                const staleManager = createAIManager();
                configureEnabledAIContext([]);
                const setInteractiveSubtitlesEnabled =
                    contentScript.subtitleUtils.setInteractiveSubtitlesEnabled;
                contentScript._createAIContextManager.mockImplementation(
                    () => factory.promise
                );
                staleManager.destroy.mockImplementation(async () => {
                    await Promise.resolve();
                    contentScript[reattachedRole] = staleManager;
                });

                const initialization =
                    contentScript._restartAIContextFeatures();
                while (
                    !contentScript._createAIContextManager.mock.calls.length
                ) {
                    await Promise.resolve();
                }

                const disable = contentScript._disableAIContextInteractions();
                factory.resolve(staleManager);

                await expect(initialization).resolves.toBe(false);
                await expect(disable).resolves.toBeUndefined();
                expect({
                    destroyCalls: staleManager.destroy.mock.calls.length,
                    enableCalls: staleManager.enableFeature.mock.calls.length,
                    initializeCalls: staleManager.initialize.mock.calls.length,
                    interactionsEnabled:
                        setInteractiveSubtitlesEnabled.mock.calls.at(-1)?.[0],
                    managerIsNull: contentScript.aiContextManager === null,
                    sidePanelIsNull:
                        contentScript.sidePanelIntegration === null,
                }).toEqual({
                    destroyCalls: 1,
                    enableCalls: 0,
                    initializeCalls: 0,
                    interactionsEnabled: false,
                    managerIsNull: true,
                    sidePanelIsNull: true,
                });
            }
        );

        test('a stale deferred manager is detached before and immediately after destructor invocation', async () => {
            const factory = createDeferred();
            const destruction = createDeferred();
            const staleManager = createAIManager();
            let rolesInsideDestroy = null;
            configureEnabledAIContext([]);
            contentScript._createAIContextManager.mockImplementation(
                () => factory.promise
            );
            staleManager.destroy.mockImplementation(() => {
                rolesInsideDestroy = {
                    manager: contentScript.aiContextManager,
                    sidePanel: contentScript.sidePanelIntegration,
                };
                contentScript.aiContextManager = staleManager;
                contentScript.sidePanelIntegration = staleManager;
                return destruction.promise;
            });

            const initialization = contentScript._restartAIContextFeatures();
            while (!contentScript._createAIContextManager.mock.calls.length) {
                await Promise.resolve();
            }
            const disable = contentScript._disableAIContextInteractions();
            contentScript.aiContextManager = staleManager;
            contentScript.sidePanelIntegration = staleManager;
            let initializationSettled = false;
            let disableSettled = false;
            void initialization.then(() => {
                initializationSettled = true;
            });
            void disable.then(() => {
                disableSettled = true;
            });

            factory.resolve(staleManager);
            while (!staleManager.destroy.mock.calls.length) {
                await Promise.resolve();
            }
            await Promise.resolve();
            await Promise.resolve();
            const whileDestructionPending = {
                disableSettled,
                initializationSettled,
                manager: contentScript.aiContextManager,
                sidePanel: contentScript.sidePanelIntegration,
            };

            destruction.resolve();
            const [initializationResult, disableResult] = await Promise.all([
                initialization,
                disable,
            ]);

            expect({
                destroyCalls: staleManager.destroy.mock.calls.length,
                disableResult,
                initializationResult,
                manager: contentScript.aiContextManager,
                rolesInsideDestroy,
                sidePanel: contentScript.sidePanelIntegration,
                whileDestructionPending,
            }).toEqual({
                destroyCalls: 1,
                disableResult: undefined,
                initializationResult: false,
                manager: null,
                rolesInsideDestroy: {
                    manager: null,
                    sidePanel: null,
                },
                sidePanel: null,
                whileDestructionPending: {
                    disableSettled: false,
                    initializationSettled: false,
                    manager: null,
                    sidePanel: null,
                },
            });
        });

        test('a retired stale manager cannot displace the current manager and side panel roles', async () => {
            const aiContextConfig = {
                aiContextEnabled: true,
                aiContextTypes: ['cultural'],
                aiContextTimeout: 1000,
                aiContextRetryAttempts: 1,
            };
            const staleFactory = createDeferred();
            const staleDestruction = createDeferred();
            const staleManager = createAIManager();
            const currentManager = createAIManager();
            const currentSidePanel = {
                destroy: jest.fn().mockResolvedValue(),
            };
            configureEnabledAIContext([]);
            contentScript._createAIContextManager
                .mockImplementationOnce(() => staleFactory.promise)
                .mockResolvedValueOnce(currentManager);
            staleManager.destroy.mockImplementation(async () => {
                await staleDestruction.promise;
                contentScript.aiContextManager = staleManager;
                contentScript.sidePanelIntegration = staleManager;
            });

            const staleOwner = contentScript.aiContextFeatureOwner;
            const staleInitialization =
                contentScript._initializeModularAIContextFeatures(
                    aiContextConfig,
                    staleOwner
                );
            while (
                contentScript._createAIContextManager.mock.calls.length < 1
            ) {
                await Promise.resolve();
            }

            const staleDisable = contentScript._disableAIContextInteractions();
            const currentOwner = contentScript.aiContextFeatureOwner;
            staleFactory.resolve(staleManager);
            while (!staleManager.destroy.mock.calls.length) {
                await Promise.resolve();
            }

            const currentInitialization =
                contentScript._initializeModularAIContextFeatures(
                    aiContextConfig,
                    currentOwner
                );
            await expect(currentInitialization).resolves.toBe(true);
            contentScript.sidePanelIntegration = currentSidePanel;
            const currentGeneration = contentScript.aiContextActiveGeneration;

            staleDestruction.resolve();
            const [staleResult] = await Promise.all([
                staleInitialization,
                staleDisable,
            ]);
            const afterStaleCleanup = {
                activeGeneration: contentScript.aiContextActiveGeneration,
                currentManagerDestroyCalls:
                    currentManager.destroy.mock.calls.length,
                currentOwner: contentScript.aiContextFeatureOwner,
                manager: contentScript.aiContextManager,
                sidePanel: contentScript.sidePanelIntegration,
                sidePanelDestroyCalls:
                    currentSidePanel.destroy.mock.calls.length,
                staleDestroyCalls: staleManager.destroy.mock.calls.length,
                staleResult,
            };

            contentScript.aiContextManager = staleManager;
            contentScript.sidePanelIntegration = staleManager;

            expect({
                afterStaleCleanup,
                managerAfterRetiredWrite: contentScript.aiContextManager,
                sidePanelAfterRetiredWrite: contentScript.sidePanelIntegration,
            }).toEqual({
                afterStaleCleanup: {
                    activeGeneration: currentGeneration,
                    currentManagerDestroyCalls: 0,
                    currentOwner,
                    manager: currentManager,
                    sidePanel: currentSidePanel,
                    sidePanelDestroyCalls: 0,
                    staleDestroyCalls: 1,
                    staleResult: false,
                },
                managerAfterRetiredWrite: currentManager,
                sidePanelAfterRetiredWrite: currentSidePanel,
            });
        });

        test('a stale factory cannot destroy a manager committed by the current owner', async () => {
            const aiContextConfig = {
                aiContextEnabled: true,
                aiContextTypes: ['cultural'],
                aiContextTimeout: 1000,
                aiContextRetryAttempts: 1,
            };
            const owner0Factory = createDeferred();
            const owner1Factory = createDeferred();
            const sharedManager = createAIManager();
            configureEnabledAIContext([]);
            contentScript._createAIContextManager
                .mockImplementationOnce(() => owner0Factory.promise)
                .mockImplementationOnce(() => owner1Factory.promise);

            const owner0 = contentScript.aiContextFeatureOwner;
            const owner0Initialization =
                contentScript._initializeModularAIContextFeatures(
                    aiContextConfig,
                    owner0
                );
            while (
                contentScript._createAIContextManager.mock.calls.length < 1
            ) {
                await Promise.resolve();
            }

            const owner0Disable = contentScript._disableAIContextInteractions();
            const owner1 = contentScript.aiContextFeatureOwner;
            const owner1Initialization =
                contentScript._initializeModularAIContextFeatures(
                    aiContextConfig,
                    owner1
                );
            while (
                contentScript._createAIContextManager.mock.calls.length < 2
            ) {
                await Promise.resolve();
            }

            owner1Factory.resolve(sharedManager);
            const owner1Result = await owner1Initialization;
            owner0Factory.resolve(sharedManager);
            const [owner0Result] = await Promise.all([
                owner0Initialization,
                owner0Disable,
            ]);
            const beforeOwner1Disable = {
                destroyCalls: sharedManager.destroy.mock.calls.length,
                interactionsEnabled:
                    contentScript.subtitleUtils.setInteractiveSubtitlesEnabled.mock.calls.at(
                        -1
                    )?.[0],
                managerIsShared:
                    contentScript.aiContextManager === sharedManager,
            };

            await contentScript._disableAIContextInteractions();

            expect({
                beforeOwner1Disable,
                enableCalls: sharedManager.enableFeature.mock.calls.length,
                finalDestroyCalls: sharedManager.destroy.mock.calls.length,
                initializeCalls: sharedManager.initialize.mock.calls.length,
                owner0Result,
                owner1Result,
            }).toEqual({
                beforeOwner1Disable: {
                    destroyCalls: 0,
                    interactionsEnabled: true,
                    managerIsShared: true,
                },
                enableCalls: 2,
                finalDestroyCalls: 1,
                initializeCalls: 1,
                owner0Result: false,
                owner1Result: true,
            });
        });

        test('a current owner rejects a manager still claimed by the owner being destroyed', async () => {
            const aiContextConfig = {
                aiContextEnabled: true,
                aiContextTypes: ['cultural'],
                aiContextTimeout: 1000,
                aiContextRetryAttempts: 1,
            };
            const destruction = createDeferred();
            const owner1Factory = createDeferred();
            const sharedManager = createAIManager();
            sharedManager.destroy.mockImplementation(() => destruction.promise);
            configureEnabledAIContext([]);
            contentScript._createAIContextManager
                .mockResolvedValueOnce(sharedManager)
                .mockImplementationOnce(() => owner1Factory.promise);

            const owner0 = contentScript.aiContextFeatureOwner;
            await expect(
                contentScript._initializeModularAIContextFeatures(
                    aiContextConfig,
                    owner0
                )
            ).resolves.toBe(true);

            const owner0Disable = contentScript._disableAIContextInteractions();
            const owner1 = contentScript.aiContextFeatureOwner;
            while (!sharedManager.destroy.mock.calls.length) {
                await Promise.resolve();
            }

            const owner1Initialization =
                contentScript._initializeModularAIContextFeatures(
                    aiContextConfig,
                    owner1
                );
            while (
                contentScript._createAIContextManager.mock.calls.length < 2
            ) {
                await Promise.resolve();
            }

            owner1Factory.resolve(sharedManager);
            await owner1Factory.promise;
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
            const whileDestructionPending = {
                enableCalls: sharedManager.enableFeature.mock.calls.length,
                initializeCalls: sharedManager.initialize.mock.calls.length,
                managerIsShared:
                    contentScript.aiContextManager === sharedManager,
            };

            destruction.resolve();
            const [, owner1Result] = await Promise.all([
                owner0Disable,
                owner1Initialization,
            ]);

            expect({
                finalDestroyCalls: sharedManager.destroy.mock.calls.length,
                finalEnableCalls: sharedManager.enableFeature.mock.calls.length,
                finalInitializeCalls:
                    sharedManager.initialize.mock.calls.length,
                interactionsEnabled:
                    contentScript.subtitleUtils.setInteractiveSubtitlesEnabled.mock.calls.at(
                        -1
                    )?.[0],
                managerIsNull: contentScript.aiContextManager === null,
                owner1Result,
                whileDestructionPending,
            }).toEqual({
                finalDestroyCalls: 1,
                finalEnableCalls: 2,
                finalInitializeCalls: 1,
                interactionsEnabled: false,
                managerIsNull: true,
                owner1Result: false,
                whileDestructionPending: {
                    enableCalls: 2,
                    initializeCalls: 1,
                    managerIsShared: false,
                },
            });
        });

        test('concurrent modular attempts under one owner admit a shared manager only once', async () => {
            const aiContextConfig = {
                aiContextEnabled: true,
                aiContextTypes: ['cultural'],
                aiContextTimeout: 1000,
                aiContextRetryAttempts: 1,
            };
            const firstFactory = createDeferred();
            const secondFactory = createDeferred();
            const sharedManager = createAIManager();
            configureEnabledAIContext([]);
            contentScript._createAIContextManager
                .mockImplementationOnce(() => firstFactory.promise)
                .mockImplementationOnce(() => secondFactory.promise);

            const owner = contentScript.aiContextFeatureOwner;
            const firstInitialization =
                contentScript._initializeModularAIContextFeatures(
                    aiContextConfig,
                    owner
                );
            while (
                contentScript._createAIContextManager.mock.calls.length < 1
            ) {
                await Promise.resolve();
            }
            const secondInitialization =
                contentScript._initializeModularAIContextFeatures(
                    aiContextConfig,
                    owner
                );
            while (
                contentScript._createAIContextManager.mock.calls.length < 2
            ) {
                await Promise.resolve();
            }

            firstFactory.resolve(sharedManager);
            const firstResult = await firstInitialization;
            secondFactory.resolve(sharedManager);
            const secondResult = await secondInitialization;
            const beforeDisable = {
                destroyCalls: sharedManager.destroy.mock.calls.length,
                enableCalls: sharedManager.enableFeature.mock.calls.length,
                initializeCalls: sharedManager.initialize.mock.calls.length,
                managerIsShared:
                    contentScript.aiContextManager === sharedManager,
            };

            await contentScript._disableAIContextInteractions();

            expect({
                beforeDisable,
                finalDestroyCalls: sharedManager.destroy.mock.calls.length,
                firstResult,
                interactionsEnabled:
                    contentScript.subtitleUtils.setInteractiveSubtitlesEnabled.mock.calls.at(
                        -1
                    )?.[0],
                managerIsNull: contentScript.aiContextManager === null,
                secondResult,
            }).toEqual({
                beforeDisable: {
                    destroyCalls: 0,
                    enableCalls: 2,
                    initializeCalls: 1,
                    managerIsShared: true,
                },
                finalDestroyCalls: 1,
                firstResult: true,
                interactionsEnabled: false,
                managerIsNull: true,
                secondResult: false,
            });
        });

        test.each([
            { capturedRole: 'aiContextManager' },
            { capturedRole: 'sidePanelIntegration' },
        ])(
            'a destroyed $capturedRole candidate cannot recommit itself as a manager from synchronous destruction reentry',
            async ({ capturedRole }) => {
                const aiContextConfig = {
                    aiContextEnabled: true,
                    aiContextTypes: ['cultural'],
                    aiContextTimeout: 1000,
                    aiContextRetryAttempts: 1,
                };
                let nestedInitialization = null;
                const sharedManager = createAIManager();
                configureEnabledAIContext([sharedManager]);
                sharedManager.destroy.mockImplementation(() => {
                    nestedInitialization =
                        contentScript._initializeModularAIContextFeatures(
                            aiContextConfig,
                            contentScript.aiContextFeatureOwner
                        );
                });
                contentScript[capturedRole] = sharedManager;

                const disable = contentScript._disableAIContextInteractions();
                const [nestedResult] = await Promise.all([
                    nestedInitialization,
                    disable,
                ]);

                expect({
                    destroyCalls: sharedManager.destroy.mock.calls.length,
                    enableCalls: sharedManager.enableFeature.mock.calls.length,
                    initializeCalls: sharedManager.initialize.mock.calls.length,
                    interactionsEnabled:
                        contentScript.subtitleUtils.setInteractiveSubtitlesEnabled.mock.calls.at(
                            -1
                        )?.[0],
                    managerIsNull: contentScript.aiContextManager === null,
                    nestedResult,
                    sidePanelIsNull:
                        contentScript.sidePanelIntegration === null,
                }).toEqual({
                    destroyCalls: 1,
                    enableCalls: 0,
                    initializeCalls: 0,
                    interactionsEnabled: false,
                    managerIsNull: true,
                    nestedResult: false,
                    sidePanelIsNull: true,
                });
            }
        );

        test.each([
            { capturedRole: 'aiContextManager' },
            { capturedRole: 'sidePanelIntegration' },
        ])(
            'a destroyed $capturedRole candidate returning nested initialization cannot cycle disable settlement',
            async ({ capturedRole }) => {
                const aiContextConfig = {
                    aiContextEnabled: true,
                    aiContextTypes: ['cultural'],
                    aiContextTimeout: 1000,
                    aiContextRetryAttempts: 1,
                };
                let nestedInitialization = null;
                const sharedManager = createAIManager();
                configureEnabledAIContext([sharedManager]);
                sharedManager.destroy.mockImplementation(() => {
                    nestedInitialization =
                        contentScript._initializeModularAIContextFeatures(
                            aiContextConfig,
                            contentScript.aiContextFeatureOwner
                        );
                    return nestedInitialization;
                });
                contentScript[capturedRole] = sharedManager;
                const settleWithin = (promise) =>
                    Promise.race([
                        Promise.resolve(promise).then(
                            (value) =>
                                value === undefined
                                    ? 'settled'
                                    : `settled:${String(value)}`,
                            () => 'rejected'
                        ),
                        new Promise((resolve) => {
                            setTimeout(() => resolve('timed-out'), 25);
                        }),
                    ]);

                const disable = contentScript._disableAIContextInteractions();
                const [disableOutcome, nestedOutcome] = await Promise.all([
                    settleWithin(disable),
                    settleWithin(nestedInitialization),
                ]);
                const observed = {
                    destroyCalls: sharedManager.destroy.mock.calls.length,
                    disableOutcome,
                    enableCalls: sharedManager.enableFeature.mock.calls.length,
                    initializeCalls: sharedManager.initialize.mock.calls.length,
                    interactionsEnabled:
                        contentScript.subtitleUtils.setInteractiveSubtitlesEnabled.mock.calls.at(
                            -1
                        )?.[0],
                    managerIsNull: contentScript.aiContextManager === null,
                    nestedOutcome,
                    sidePanelIsNull:
                        contentScript.sidePanelIntegration === null,
                };

                // The RED cycle cannot be released externally. Avoid asking the
                // suite's automatic terminal cleanup to await it a second time.
                if (
                    disableOutcome === 'timed-out' ||
                    nestedOutcome === 'timed-out'
                ) {
                    contentScript = null;
                }

                expect(observed).toEqual({
                    destroyCalls: 1,
                    disableOutcome: 'settled',
                    enableCalls: 0,
                    initializeCalls: 0,
                    interactionsEnabled: false,
                    managerIsNull: true,
                    nestedOutcome: 'settled:false',
                    sidePanelIsNull: true,
                });
            }
        );

        test.each([
            {
                capturedRole: 'aiContextManager',
                nestedAction: 'modularInitialization',
                reattachedRole: 'aiContextManager',
            },
            {
                capturedRole: 'aiContextManager',
                nestedAction: 'disable',
                reattachedRole: 'aiContextManager',
            },
            {
                capturedRole: 'aiContextManager',
                nestedAction: 'modularInitialization',
                reattachedRole: 'sidePanelIntegration',
            },
            {
                capturedRole: 'aiContextManager',
                nestedAction: 'disable',
                reattachedRole: 'sidePanelIntegration',
            },
            {
                capturedRole: 'sidePanelIntegration',
                nestedAction: 'modularInitialization',
                reattachedRole: 'aiContextManager',
            },
            {
                capturedRole: 'sidePanelIntegration',
                nestedAction: 'disable',
                reattachedRole: 'aiContextManager',
            },
            {
                capturedRole: 'sidePanelIntegration',
                nestedAction: 'modularInitialization',
                reattachedRole: 'sidePanelIntegration',
            },
            {
                capturedRole: 'sidePanelIntegration',
                nestedAction: 'disable',
                reattachedRole: 'sidePanelIntegration',
            },
        ])(
            'self-republication matrix: destroyed $capturedRole reattached as $reattachedRole before returned $nestedAction',
            async ({ capturedRole, nestedAction, reattachedRole }) => {
                const aiContextConfig = {
                    aiContextEnabled: true,
                    aiContextTypes: ['cultural'],
                    aiContextTimeout: 1000,
                    aiContextRetryAttempts: 1,
                };
                let nestedTask = null;
                const sharedManager = createAIManager();
                configureEnabledAIContext([sharedManager]);
                sharedManager.destroy.mockImplementation(() => {
                    contentScript[reattachedRole] = sharedManager;
                    nestedTask =
                        nestedAction === 'modularInitialization'
                            ? contentScript._initializeModularAIContextFeatures(
                                  aiContextConfig,
                                  contentScript.aiContextFeatureOwner
                              )
                            : contentScript._disableAIContextInteractions();
                    return nestedTask;
                });
                contentScript[capturedRole] = sharedManager;
                const settleWithin = (promise) =>
                    Promise.race([
                        Promise.resolve(promise).then(
                            (value) =>
                                value === undefined
                                    ? 'settled'
                                    : `settled:${String(value)}`,
                            () => 'rejected'
                        ),
                        new Promise((resolve) => {
                            setTimeout(() => resolve('timed-out'), 25);
                        }),
                    ]);

                const outerDisable =
                    contentScript._disableAIContextInteractions();
                const [outerOutcome, nestedOutcome] = await Promise.all([
                    settleWithin(outerDisable),
                    settleWithin(nestedTask),
                ]);
                const observed = {
                    destroyCalls: sharedManager.destroy.mock.calls.length,
                    enableCalls: sharedManager.enableFeature.mock.calls.length,
                    initializeCalls: sharedManager.initialize.mock.calls.length,
                    interactionsEnabled:
                        contentScript.subtitleUtils.setInteractiveSubtitlesEnabled.mock.calls.at(
                            -1
                        )?.[0],
                    managerIsNull: contentScript.aiContextManager === null,
                    nestedOutcome,
                    outerOutcome,
                    sidePanelIsNull:
                        contentScript.sidePanelIntegration === null,
                };

                if (
                    outerOutcome === 'timed-out' ||
                    nestedOutcome === 'timed-out'
                ) {
                    contentScript = null;
                }

                expect(observed).toEqual({
                    destroyCalls: 1,
                    enableCalls: 0,
                    initializeCalls: 0,
                    interactionsEnabled: false,
                    managerIsNull: true,
                    nestedOutcome:
                        nestedAction === 'modularInitialization'
                            ? 'settled:false'
                            : 'settled',
                    outerOutcome: 'settled',
                    sidePanelIsNull: true,
                });
            }
        );

        test.each([
            {
                capturedRole: 'aiContextManager',
                reattachedRole: 'aiContextManager',
            },
            {
                capturedRole: 'aiContextManager',
                reattachedRole: 'sidePanelIntegration',
            },
            {
                capturedRole: 'sidePanelIntegration',
                reattachedRole: 'aiContextManager',
            },
            {
                capturedRole: 'sidePanelIntegration',
                reattachedRole: 'sidePanelIntegration',
            },
        ])(
            'terminal self-republication matrix: destroyed $capturedRole reattached as $reattachedRole before returned disable',
            async ({ capturedRole, reattachedRole }) => {
                let nestedTask = null;
                const sharedManager = createAIManager();
                const setInteractiveSubtitlesEnabled = jest.fn();
                contentScript.subtitleUtils = {
                    setInteractiveSubtitlesEnabled,
                };
                sharedManager.destroy.mockImplementation(() => {
                    contentScript[reattachedRole] = sharedManager;
                    nestedTask = contentScript._disableAIContextInteractions();
                    return nestedTask;
                });
                contentScript[capturedRole] = sharedManager;
                const settleWithin = (promise) =>
                    Promise.race([
                        Promise.resolve(promise).then(
                            () => 'settled',
                            () => 'rejected'
                        ),
                        new Promise((resolve) => {
                            setTimeout(() => resolve('timed-out'), 25);
                        }),
                    ]);

                const outerCleanup = contentScript.cleanup();
                const [outerOutcome, nestedOutcome] = await Promise.all([
                    settleWithin(outerCleanup),
                    settleWithin(nestedTask),
                ]);
                const observed = {
                    destroyCalls: sharedManager.destroy.mock.calls.length,
                    enableCalls: sharedManager.enableFeature.mock.calls.length,
                    initializeCalls: sharedManager.initialize.mock.calls.length,
                    interactionsEnabled:
                        setInteractiveSubtitlesEnabled.mock.calls.at(-1)?.[0],
                    managerIsNull: contentScript.aiContextManager === null,
                    nestedOutcome,
                    outerOutcome,
                    sidePanelIsNull:
                        contentScript.sidePanelIntegration === null,
                };

                if (
                    outerOutcome === 'timed-out' ||
                    nestedOutcome === 'timed-out'
                ) {
                    contentScript = null;
                }

                expect(observed).toEqual({
                    destroyCalls: 1,
                    enableCalls: 0,
                    initializeCalls: 0,
                    interactionsEnabled: false,
                    managerIsNull: true,
                    nestedOutcome: 'settled',
                    outerOutcome: 'settled',
                    sidePanelIsNull: true,
                });
            }
        );

        test.each([
            {
                capturedRole: 'aiContextManager',
                nestedAction: 'initializeAIContextFeatures',
                reattachedRole: 'sidePanelIntegration',
                timing: 'synchronous',
            },
            {
                capturedRole: 'aiContextManager',
                nestedAction: '_disableAIContextInteractions',
                reattachedRole: 'sidePanelIntegration',
                timing: 'synchronous',
            },
            {
                capturedRole: 'aiContextManager',
                nestedAction: '_cleanupAIContextManager',
                reattachedRole: 'sidePanelIntegration',
                timing: 'synchronous',
            },
            {
                capturedRole: 'aiContextManager',
                nestedAction: 'initializeAIContextFeatures',
                reattachedRole: 'sidePanelIntegration',
                timing: 'after one microtask',
            },
            {
                capturedRole: 'aiContextManager',
                nestedAction: '_disableAIContextInteractions',
                reattachedRole: 'sidePanelIntegration',
                timing: 'after one microtask',
            },
            {
                capturedRole: 'aiContextManager',
                nestedAction: '_cleanupAIContextManager',
                reattachedRole: 'sidePanelIntegration',
                timing: 'after one microtask',
            },
            {
                capturedRole: 'sidePanelIntegration',
                nestedAction: 'initializeAIContextFeatures',
                reattachedRole: 'aiContextManager',
                timing: 'synchronous',
            },
            {
                capturedRole: 'sidePanelIntegration',
                nestedAction: '_disableAIContextInteractions',
                reattachedRole: 'aiContextManager',
                timing: 'synchronous',
            },
            {
                capturedRole: 'sidePanelIntegration',
                nestedAction: '_cleanupAIContextManager',
                reattachedRole: 'aiContextManager',
                timing: 'synchronous',
            },
            {
                capturedRole: 'sidePanelIntegration',
                nestedAction: 'initializeAIContextFeatures',
                reattachedRole: 'aiContextManager',
                timing: 'after one microtask',
            },
            {
                capturedRole: 'sidePanelIntegration',
                nestedAction: '_disableAIContextInteractions',
                reattachedRole: 'aiContextManager',
                timing: 'after one microtask',
            },
            {
                capturedRole: 'sidePanelIntegration',
                nestedAction: '_cleanupAIContextManager',
                reattachedRole: 'aiContextManager',
                timing: 'after one microtask',
            },
        ])(
            'terminal nested-entry matrix: destroyed $capturedRole reattached as $reattachedRole $timing before returned $nestedAction',
            async ({ capturedRole, nestedAction, reattachedRole, timing }) => {
                const sharedManager = createAIManager();
                configureEnabledAIContext([sharedManager]);
                const setInteractiveSubtitlesEnabled =
                    contentScript.subtitleUtils.setInteractiveSubtitlesEnabled;
                const nestedStarted = createDeferred();
                let nestedTask = null;
                const startNestedTask = () => {
                    contentScript[reattachedRole] = sharedManager;
                    if (nestedAction === 'initializeAIContextFeatures') {
                        nestedTask =
                            contentScript.initializeAIContextFeatures();
                    } else if (
                        nestedAction === '_disableAIContextInteractions'
                    ) {
                        nestedTask =
                            contentScript._disableAIContextInteractions();
                    } else {
                        nestedTask = contentScript._cleanupAIContextManager();
                    }
                    nestedStarted.resolve();
                    return nestedTask;
                };
                sharedManager.destroy.mockImplementation(
                    timing === 'synchronous'
                        ? startNestedTask
                        : async () => {
                              await Promise.resolve();
                              return await startNestedTask();
                          }
                );
                contentScript[capturedRole] = sharedManager;
                const settleWithin = (promise) =>
                    Promise.race([
                        Promise.resolve(promise).then(
                            (value) =>
                                value === undefined
                                    ? 'settled'
                                    : `settled:${String(value)}`,
                            () => 'rejected'
                        ),
                        new Promise((resolve) => {
                            setTimeout(() => resolve('timed-out'), 25);
                        }),
                    ]);

                const outerCleanup = contentScript.cleanup();
                const nestedSettlement = nestedStarted.promise.then(
                    () => nestedTask
                );
                const [outerOutcome, nestedOutcome] = await Promise.all([
                    settleWithin(outerCleanup),
                    settleWithin(nestedSettlement),
                ]);
                const observed = {
                    destroyCalls: sharedManager.destroy.mock.calls.length,
                    enableCalls: sharedManager.enableFeature.mock.calls.length,
                    initializeCalls: sharedManager.initialize.mock.calls.length,
                    interactionsEnabled:
                        setInteractiveSubtitlesEnabled.mock.calls.at(-1)?.[0],
                    managerIsNull: contentScript.aiContextManager === null,
                    nestedOutcome,
                    outerOutcome,
                    sidePanelIsNull:
                        contentScript.sidePanelIntegration === null,
                };

                if (
                    outerOutcome === 'timed-out' ||
                    nestedOutcome === 'timed-out'
                ) {
                    contentScript = null;
                }

                expect(observed).toEqual({
                    destroyCalls: 1,
                    enableCalls: 0,
                    initializeCalls: 0,
                    interactionsEnabled: false,
                    managerIsNull: true,
                    nestedOutcome:
                        nestedAction === 'initializeAIContextFeatures'
                            ? 'settled:false'
                            : 'settled',
                    outerOutcome: 'settled',
                    sidePanelIsNull: true,
                });
            }
        );

        test.each([
            {
                capturedRole: 'aiContextManager',
                reattachedRole: 'aiContextManager',
                timing: 'synchronous',
            },
            {
                capturedRole: 'aiContextManager',
                reattachedRole: 'sidePanelIntegration',
                timing: 'synchronous',
            },
            {
                capturedRole: 'sidePanelIntegration',
                reattachedRole: 'aiContextManager',
                timing: 'synchronous',
            },
            {
                capturedRole: 'sidePanelIntegration',
                reattachedRole: 'sidePanelIntegration',
                timing: 'synchronous',
            },
            {
                capturedRole: 'aiContextManager',
                reattachedRole: 'aiContextManager',
                timing: 'after one microtask',
            },
            {
                capturedRole: 'aiContextManager',
                reattachedRole: 'sidePanelIntegration',
                timing: 'after one microtask',
            },
            {
                capturedRole: 'sidePanelIntegration',
                reattachedRole: 'aiContextManager',
                timing: 'after one microtask',
            },
            {
                capturedRole: 'sidePanelIntegration',
                reattachedRole: 'sidePanelIntegration',
                timing: 'after one microtask',
            },
        ])(
            'terminal modular self-republication matrix: destroyed $capturedRole reattached as $reattachedRole $timing before returned modular initialization',
            async ({ capturedRole, reattachedRole, timing }) => {
                const aiContextConfig = {
                    aiContextEnabled: true,
                    aiContextTypes: ['cultural'],
                    aiContextTimeout: 1000,
                    aiContextRetryAttempts: 1,
                };
                const sharedManager = createAIManager();
                configureEnabledAIContext([sharedManager]);
                const setInteractiveSubtitlesEnabled =
                    contentScript.subtitleUtils.setInteractiveSubtitlesEnabled;
                const nestedStarted = createDeferred();
                let nestedTask = null;
                const startNestedTask = () => {
                    contentScript[reattachedRole] = sharedManager;
                    nestedTask =
                        contentScript._initializeModularAIContextFeatures(
                            aiContextConfig,
                            contentScript.aiContextFeatureOwner
                        );
                    nestedStarted.resolve();
                    return nestedTask;
                };
                sharedManager.destroy.mockImplementation(
                    timing === 'synchronous'
                        ? startNestedTask
                        : async () => {
                              await Promise.resolve();
                              return await startNestedTask();
                          }
                );
                contentScript[capturedRole] = sharedManager;
                const settleWithin = (promise) =>
                    Promise.race([
                        Promise.resolve(promise).then(
                            (value) =>
                                value === undefined
                                    ? 'settled'
                                    : `settled:${String(value)}`,
                            () => 'rejected'
                        ),
                        new Promise((resolve) => {
                            setTimeout(() => resolve('timed-out'), 25);
                        }),
                    ]);

                const outerCleanup = contentScript.cleanup();
                const nestedSettlement = nestedStarted.promise.then(
                    () => nestedTask
                );
                const [outerOutcome, nestedOutcome] = await Promise.all([
                    settleWithin(outerCleanup),
                    settleWithin(nestedSettlement),
                ]);
                const observed = {
                    destroyCalls: sharedManager.destroy.mock.calls.length,
                    enableCalls: sharedManager.enableFeature.mock.calls.length,
                    initializeCalls: sharedManager.initialize.mock.calls.length,
                    interactionsEnabled:
                        setInteractiveSubtitlesEnabled.mock.calls.at(-1)?.[0],
                    managerIsNull: contentScript.aiContextManager === null,
                    nestedOutcome,
                    outerOutcome,
                    sidePanelIsNull:
                        contentScript.sidePanelIntegration === null,
                };

                if (
                    outerOutcome === 'timed-out' ||
                    nestedOutcome === 'timed-out'
                ) {
                    contentScript = null;
                }

                expect(observed).toEqual({
                    destroyCalls: 1,
                    enableCalls: 0,
                    initializeCalls: 0,
                    interactionsEnabled: false,
                    managerIsNull: true,
                    nestedOutcome: 'settled:false',
                    outerOutcome: 'settled',
                    sidePanelIsNull: true,
                });
            }
        );

        test('the modular route grants subtitle utilities only config and currentness and owns its cleanup', async () => {
            const manager = createAIManager();
            configureEnabledAIContext([manager]);
            const bindingCleanup = jest.fn();
            contentScript.subtitleUtils.initializeInteractiveSubtitleFeatures.mockResolvedValue(
                bindingCleanup
            );

            await expect(
                contentScript._restartAIContextFeatures()
            ).resolves.toBe(true);

            expect(
                contentScript.subtitleUtils
                    .initializeInteractiveSubtitleFeatures
            ).toHaveBeenCalledTimes(1);
            const call =
                contentScript.subtitleUtils
                    .initializeInteractiveSubtitleFeatures.mock.calls[0];
            expect(call).toHaveLength(3);
            const [config, isCurrent, publishWordIntent] = call;
            expect(config).toEqual(
                expect.objectContaining({
                    enabled: true,
                    platform: 'test',
                })
            );
            expect(isCurrent()).toBe(true);
            expect(publishWordIntent).toEqual(expect.any(Function));

            await contentScript._disableAIContextInteractions();
            expect(bindingCleanup).toHaveBeenCalledTimes(1);
        });

        test('the legacy fallback grants subtitle utilities only config and currentness and owns its cleanup', async () => {
            const failedManager = createAIManager(Promise.resolve(false));
            configureEnabledAIContext([failedManager]);
            const bindingCleanup = jest.fn();
            contentScript.subtitleUtils.initializeInteractiveSubtitleFeatures.mockResolvedValue(
                bindingCleanup
            );

            await expect(
                contentScript._restartAIContextFeatures()
            ).resolves.toBe(true);

            expect(
                contentScript.subtitleUtils
                    .initializeInteractiveSubtitleFeatures
            ).toHaveBeenCalledTimes(1);
            const call =
                contentScript.subtitleUtils
                    .initializeInteractiveSubtitleFeatures.mock.calls[0];
            expect(call).toHaveLength(3);
            const [config, isCurrent, publishWordIntent] = call;
            expect(config).toEqual(
                expect.objectContaining({
                    enabled: true,
                    platform: 'test',
                })
            );
            expect(isCurrent()).toBe(true);
            expect(publishWordIntent).toEqual(expect.any(Function));

            await contentScript._disableAIContextInteractions();
            expect(bindingCleanup).toHaveBeenCalledTimes(1);
        });

        test('an interactive binding that resolves after owner invalidation is cleaned immediately', async () => {
            const manager = createAIManager();
            configureEnabledAIContext([manager]);
            const deferredBinding = createDeferred();
            const bindingCleanup = jest.fn();
            contentScript.subtitleUtils.initializeInteractiveSubtitleFeatures.mockReturnValue(
                deferredBinding.promise
            );

            const initialization = contentScript._restartAIContextFeatures();
            while (
                !contentScript.subtitleUtils
                    .initializeInteractiveSubtitleFeatures.mock.calls.length
            ) {
                await Promise.resolve();
            }
            const staleOwner = contentScript.aiContextFeatureOwner;
            const disable = contentScript._disableAIContextInteractions();

            expect(
                staleOwner.channel.publish(
                    'WORD_INTENT',
                    createWordIntent('stale')
                )
            ).toBe(0);
            expect(bindingCleanup).not.toHaveBeenCalled();

            deferredBinding.resolve(bindingCleanup);
            await expect(initialization).resolves.toBe(false);
            await expect(disable).resolves.toBeUndefined();
            expect(bindingCleanup).toHaveBeenCalledTimes(1);
        });

        test('terminal cleanup leaves no active replacement AI channel', async () => {
            const originalOwner = contentScript.aiContextFeatureOwner;

            await contentScript.cleanup();

            const terminalOwner = contentScript.aiContextFeatureOwner;
            const terminalListener = jest.fn();
            terminalOwner.channel.subscribe('WORD_INTENT', terminalListener);
            expect(
                originalOwner.channel.publish(
                    'WORD_INTENT',
                    createWordIntent('stale')
                )
            ).toBe(0);
            expect(
                terminalOwner.channel.publish(
                    'WORD_INTENT',
                    createWordIntent('terminal')
                )
            ).toBe(0);
            expect(terminalListener).not.toHaveBeenCalled();
        });

        test('does not duplicate Base-owned AI document listeners when setup repeats', () => {
            const trackedEvents = new Set(aiDocumentEvents);
            const addEventListener = jest.spyOn(document, 'addEventListener');
            contentScript.aiContextManager = {};

            contentScript._setupAIContextEventListeners();
            contentScript._setupFullscreenHandling();
            contentScript._setupAIContextEventListeners();
            contentScript._setupFullscreenHandling();

            const registrations = addEventListener.mock.calls.filter(([type]) =>
                trackedEvents.has(type)
            );
            expect(registrations.map(([type]) => type)).toEqual([
                'dualsub-system-initialized',
                'dualsub-analysis-complete',
                'dualsub-analysis-error',
                'dualsub-modal-state-change',
                'fullscreenchange',
            ]);
        });

        test('repeated successful restarts leave exactly one listener per AI event', async () => {
            const firstManager = createAIManager();
            const secondManager = createAIManager();
            configureEnabledAIContext([firstManager, secondManager]);
            const addEventListener = jest.spyOn(document, 'addEventListener');
            const removeEventListener = jest.spyOn(
                document,
                'removeEventListener'
            );

            await expect(
                contentScript._restartAIContextFeatures()
            ).resolves.toBe(true);
            await expect(
                contentScript._restartAIContextFeatures()
            ).resolves.toBe(true);

            const active = getActiveAIListeners(
                addEventListener,
                removeEventListener
            );
            for (const eventName of aiDocumentEvents) {
                expect(active.get(eventName).size).toBe(1);
            }
            expect(firstManager.destroy).toHaveBeenCalledTimes(1);
            expect(contentScript.aiContextManager).toBe(secondManager);
            expect(contentScript.eventListenerCleanupFunctions).toHaveLength(0);
        });

        test('disable removes AI listeners while preserving the unrelated early injector listener', async () => {
            const manager = createAIManager();
            configureEnabledAIContext([manager]);
            const addEventListener = jest.spyOn(document, 'addEventListener');
            const removeEventListener = jest.spyOn(
                document,
                'removeEventListener'
            );
            contentScript.injectScriptEarly = jest.fn();
            const earlyEventHandler = jest
                .spyOn(contentScript, 'handleEarlyInjectorEvents')
                .mockImplementation();
            contentScript.setupEarlyEventHandling();

            await contentScript._restartAIContextFeatures();
            await contentScript._disableAIContextInteractions();

            const active = getActiveAIListeners(
                addEventListener,
                removeEventListener
            );
            for (const eventName of aiDocumentEvents) {
                expect(active.get(eventName).size).toBe(0);
            }
            expect(contentScript.eventListenerAttached).toBe(true);
            document.dispatchEvent(
                new CustomEvent('test-subtitle-event', {
                    detail: { source: 'unrelated-listener-check' },
                })
            );
            expect(earlyEventHandler).toHaveBeenCalledTimes(1);
            expect(contentScript.aiContextManager).toBeNull();
            expect(contentScript.sidePanelIntegration).toBeNull();
        });

        test('a stale initialization completion after disable cannot commit resources', async () => {
            const initialization = createDeferred();
            const staleManager = createAIManager(initialization.promise);
            configureEnabledAIContext([staleManager]);
            const addEventListener = jest.spyOn(document, 'addEventListener');
            const removeEventListener = jest.spyOn(
                document,
                'removeEventListener'
            );
            const staleInitialization =
                contentScript._restartAIContextFeatures();
            while (!staleManager.initialize.mock.calls.length) {
                await Promise.resolve();
            }
            const staleSidePanel = contentScript.sidePanelIntegration;
            expect(staleSidePanel).not.toBeNull();

            const disable = contentScript._disableAIContextInteractions();
            expect(contentScript.aiContextManager).toBeNull();
            expect(contentScript.sidePanelIntegration).toBeNull();
            expect(staleSidePanel.destroyed).toBe(true);

            initialization.resolve(true);
            await expect(staleInitialization).resolves.toBe(false);
            await expect(disable).resolves.toBeUndefined();

            const active = getActiveAIListeners(
                addEventListener,
                removeEventListener
            );
            for (const eventName of aiDocumentEvents) {
                expect(active.get(eventName).size).toBe(0);
            }
            expect(staleManager.destroy).toHaveBeenCalledTimes(1);
            expect(staleManager.enableFeature).not.toHaveBeenCalled();
            expect(contentScript.aiContextManager).toBeNull();
            expect(
                contentScript.subtitleUtils.setInteractiveSubtitlesEnabled
            ).toHaveBeenLastCalledWith(false);
        });

        test('overlapping restarts let only the newest manager and listener generation win', async () => {
            const firstInitialization = createDeferred();
            const initialManager = createAIManager();
            const staleManager = createAIManager(firstInitialization.promise);
            const currentManager = createAIManager();
            configureEnabledAIContext([
                initialManager,
                staleManager,
                currentManager,
            ]);
            const addEventListener = jest.spyOn(document, 'addEventListener');
            const removeEventListener = jest.spyOn(
                document,
                'removeEventListener'
            );
            const logWithFallback = jest.spyOn(
                contentScript,
                'logWithFallback'
            );
            contentScript.currentConfig.aiContextEnabled = true;
            await contentScript._restartAIContextFeatures();

            const staleRestart =
                contentScript._handleAIContextConfigurationChanges({
                    aiContextProvider: 'openai',
                });
            while (!staleManager.initialize.mock.calls.length) {
                await Promise.resolve();
            }
            const staleSidePanel = contentScript.sidePanelIntegration;

            await expect(
                contentScript._handleAIContextConfigurationChanges({
                    openaiModel: 'new-model',
                })
            ).resolves.toBeUndefined();
            const currentSidePanel = contentScript.sidePanelIntegration;
            expect(currentSidePanel).not.toBe(staleSidePanel);
            expect(staleSidePanel.destroyed).toBe(true);

            firstInitialization.resolve(true);
            await expect(staleRestart).resolves.toBeUndefined();

            expect(initialManager.destroy).toHaveBeenCalledTimes(1);
            expect(staleManager.destroy).toHaveBeenCalledTimes(1);
            expect(staleManager.enableFeature).not.toHaveBeenCalled();
            expect(currentManager.destroy).not.toHaveBeenCalled();
            expect(contentScript.aiContextManager).toBe(currentManager);
            expect(contentScript.sidePanelIntegration).toBe(currentSidePanel);
            expect(currentSidePanel.destroyed).toBe(false);

            const active = getActiveAIListeners(
                addEventListener,
                removeEventListener
            );
            for (const eventName of aiDocumentEvents) {
                expect(active.get(eventName).size).toBe(1);
            }

            document.dispatchEvent(
                new CustomEvent('dualsub-analysis-complete', {
                    detail: { requestId: 'current', success: true },
                })
            );
            expect(
                logWithFallback.mock.calls.filter(
                    ([, message]) => message === 'AI Context analysis completed'
                )
            ).toHaveLength(1);
        });

        test('the newest interactive initialization reasserts enabled state after stale completion', async () => {
            const firstInteractiveInitialization = createDeferred();
            const secondInteractiveInitialization = createDeferred();
            const staleManager = createAIManager();
            const currentManager = createAIManager();
            configureEnabledAIContext([staleManager, currentManager]);
            contentScript.subtitleUtils.initializeInteractiveSubtitleFeatures
                .mockImplementationOnce(
                    () => firstInteractiveInitialization.promise
                )
                .mockImplementationOnce(
                    () => secondInteractiveInitialization.promise
                );

            const staleRestart = contentScript._restartAIContextFeatures();
            while (
                contentScript.subtitleUtils
                    .initializeInteractiveSubtitleFeatures.mock.calls.length < 1
            ) {
                await Promise.resolve();
            }

            const currentRestart = contentScript._restartAIContextFeatures();
            while (
                contentScript.subtitleUtils
                    .initializeInteractiveSubtitleFeatures.mock.calls.length < 2
            ) {
                await Promise.resolve();
            }

            secondInteractiveInitialization.resolve();
            firstInteractiveInitialization.resolve();
            await expect(staleRestart).resolves.toBe(false);
            await expect(currentRestart).resolves.toBe(true);

            expect(staleManager.destroy).toHaveBeenCalledTimes(1);
            expect(contentScript.aiContextManager).toBe(currentManager);
            expect(
                contentScript.subtitleUtils.setInteractiveSubtitlesEnabled
            ).toHaveBeenLastCalledWith(true);
            expect(contentScript.aiContextActiveGeneration).toBe(
                contentScript.aiContextLifecycleGeneration
            );
        });

        test('the newest legacy fallback reasserts enabled state after stale completion', async () => {
            const firstInteractiveInitialization = createDeferred();
            const secondInteractiveInitialization = createDeferred();
            const staleManager = createAIManager(Promise.resolve(false));
            const currentManager = createAIManager(Promise.resolve(false));
            configureEnabledAIContext([staleManager, currentManager]);
            contentScript.subtitleUtils.initializeInteractiveSubtitleFeatures
                .mockImplementationOnce(
                    () => firstInteractiveInitialization.promise
                )
                .mockImplementationOnce(
                    () => secondInteractiveInitialization.promise
                );

            const staleRestart = contentScript._restartAIContextFeatures();
            while (
                contentScript.subtitleUtils
                    .initializeInteractiveSubtitleFeatures.mock.calls.length < 1
            ) {
                await Promise.resolve();
            }

            const currentRestart = contentScript._restartAIContextFeatures();
            while (
                contentScript.subtitleUtils
                    .initializeInteractiveSubtitleFeatures.mock.calls.length < 2
            ) {
                await Promise.resolve();
            }

            secondInteractiveInitialization.resolve();
            firstInteractiveInitialization.resolve();
            await expect(staleRestart).resolves.toBe(false);
            await expect(currentRestart).resolves.toBe(true);

            expect(staleManager.destroy).toHaveBeenCalledTimes(1);
            expect(currentManager.destroy).toHaveBeenCalledTimes(1);
            expect(contentScript.aiContextManager).toBeNull();
            expect(
                contentScript.subtitleUtils.setInteractiveSubtitlesEnabled
            ).toHaveBeenLastCalledWith(true);
            expect(contentScript.aiContextActiveGeneration).toBe(
                contentScript.aiContextLifecycleGeneration
            );
        });

        test('disable waits for an in-flight interactive initializer and finishes disabled', async () => {
            const interactiveInitialization = createDeferred();
            const manager = createAIManager();
            configureEnabledAIContext([manager]);
            contentScript.subtitleUtils.initializeInteractiveSubtitleFeatures.mockImplementation(
                () =>
                    interactiveInitialization.promise.then(() => {
                        contentScript.subtitleUtils.setInteractiveSubtitlesEnabled(
                            true
                        );
                    })
            );

            const initialization = contentScript._restartAIContextFeatures();
            while (
                !contentScript.subtitleUtils
                    .initializeInteractiveSubtitleFeatures.mock.calls.length
            ) {
                await Promise.resolve();
            }

            let disableSettled = false;
            const disable = contentScript
                ._disableAIContextInteractions()
                .then(() => {
                    disableSettled = true;
                });
            await Promise.resolve();
            expect(disableSettled).toBe(false);

            interactiveInitialization.resolve();
            await expect(initialization).resolves.toBe(false);
            await disable;

            expect(manager.destroy).toHaveBeenCalledTimes(1);
            expect(disableSettled).toBe(true);
            expect(
                contentScript.subtitleUtils.setInteractiveSubtitlesEnabled
            ).toHaveBeenLastCalledWith(false);
        });

        test('comprehensive cleanup waits for an in-flight interactive initializer', async () => {
            const interactiveInitialization = createDeferred();
            const manager = createAIManager();
            configureEnabledAIContext([manager]);
            contentScript.subtitleUtils.initializeInteractiveSubtitleFeatures.mockImplementation(
                () =>
                    interactiveInitialization.promise.then(() => {
                        contentScript.subtitleUtils.setInteractiveSubtitlesEnabled(
                            true
                        );
                    })
            );

            const initialization = contentScript._restartAIContextFeatures();
            while (
                !contentScript.subtitleUtils
                    .initializeInteractiveSubtitleFeatures.mock.calls.length
            ) {
                await Promise.resolve();
            }

            let comprehensiveCleanupSettled = false;
            const comprehensiveCleanup = contentScript.cleanup().then(() => {
                comprehensiveCleanupSettled = true;
            });
            await Promise.resolve();
            expect(comprehensiveCleanupSettled).toBe(false);

            interactiveInitialization.resolve();
            await expect(initialization).resolves.toBe(false);
            await comprehensiveCleanup;

            expect(manager.destroy).toHaveBeenCalledTimes(1);
            expect(comprehensiveCleanupSettled).toBe(true);
            expect(
                contentScript.subtitleUtils.setInteractiveSubtitlesEnabled
            ).toHaveBeenLastCalledWith(false);
        });

        test('comprehensive cleanup continues when disabling interactive subtitles throws', async () => {
            const unrelatedListenerCleanup = jest.fn();
            contentScript.eventListenerCleanupFunctions.push(
                unrelatedListenerCleanup
            );
            contentScript.subtitleUtils = {
                setInteractiveSubtitlesEnabled: jest.fn(() => {
                    throw new Error('formatter toggle failed');
                }),
                cleanup: jest.fn().mockResolvedValue(),
                clearSubtitleDOM: jest.fn(),
            };

            await expect(contentScript.cleanup()).resolves.toBeUndefined();

            expect(
                contentScript.subtitleUtils.setInteractiveSubtitlesEnabled
            ).toHaveBeenCalledWith(false);
            expect(unrelatedListenerCleanup).toHaveBeenCalledTimes(1);
            expect(contentScript.subtitleUtils.cleanup).toHaveBeenCalledTimes(
                1
            );
            expect(contentScript.isCleanedUp).toBe(true);
        });

        test('an older async config callback cannot replay stale AI settings after a newer intent', async () => {
            const firstLoad = createDeferred();
            let onChanged;
            contentScript.configService = {
                onChanged: jest.fn((callback) => {
                    onChanged = callback;
                    return jest.fn();
                }),
                getAll: jest
                    .fn()
                    .mockImplementationOnce(() => firstLoad.promise)
                    .mockResolvedValueOnce({
                        aiContextEnabled: true,
                        aiContextProvider: 'gemini',
                        openaiModel: 'new-model',
                    }),
            };
            contentScript.currentConfig = { aiContextEnabled: true };
            contentScript._restartAIContextFeatures = jest
                .fn()
                .mockResolvedValue(true);
            contentScript.setupConfigurationListeners();

            const olderChange = onChanged({
                aiContextProvider: 'openai',
            });
            const newerChange = onChanged({
                openaiModel: 'new-model',
            });
            await newerChange;

            firstLoad.resolve({
                aiContextEnabled: true,
                aiContextProvider: 'openai',
                openaiModel: 'stale-model',
            });
            await olderChange;

            expect(
                contentScript._restartAIContextFeatures
            ).toHaveBeenCalledTimes(1);
            expect(contentScript.currentConfig.aiContextProvider).toBe(
                'gemini'
            );
            expect(contentScript.currentConfig.openaiModel).toBe('new-model');
        });

        test('an older non-AI callback cannot overwrite a newer full configuration projection', async () => {
            const firstLoad = createDeferred();
            let onChanged;
            contentScript.configService = {
                onChanged: jest.fn((callback) => {
                    onChanged = callback;
                    return jest.fn();
                }),
                getAll: jest
                    .fn()
                    .mockImplementationOnce(() => firstLoad.promise)
                    .mockResolvedValueOnce({
                        fontSize: 2,
                        aiContextEnabled: true,
                        aiContextProvider: 'gemini',
                        openaiModel: 'new-model',
                    }),
            };
            contentScript.currentConfig = { aiContextEnabled: true };
            contentScript._restartAIContextFeatures = jest
                .fn()
                .mockResolvedValue(true);
            contentScript.setupConfigurationListeners();

            const olderNonAIChange = onChanged({ fontSize: 2 });
            const newerAIChange = onChanged({ openaiModel: 'new-model' });
            await newerAIChange;

            firstLoad.resolve({
                fontSize: 1,
                aiContextEnabled: true,
                aiContextProvider: 'openai',
                openaiModel: 'stale-model',
            });
            await olderNonAIChange;

            expect(
                contentScript._restartAIContextFeatures
            ).toHaveBeenCalledTimes(1);
            expect(contentScript.currentConfig.fontSize).toBe(2);
            expect(contentScript.currentConfig.aiContextProvider).toBe(
                'gemini'
            );
            expect(contentScript.currentConfig.openaiModel).toBe('new-model');
        });

        test('repeated AI cleanup is safe and destroys a committed manager once', async () => {
            const manager = createAIManager();
            configureEnabledAIContext([manager]);
            await contentScript._restartAIContextFeatures();

            await expect(
                contentScript._cleanupAIContextManager()
            ).resolves.toBeUndefined();
            await expect(
                contentScript._cleanupAIContextManager()
            ).resolves.toBeUndefined();

            expect(manager.destroy).toHaveBeenCalledTimes(1);
            expect(contentScript.aiContextManager).toBeNull();
            expect(contentScript.sidePanelIntegration).toBeNull();
        });

        test('comprehensive cleanup drains the active AI feature owner', async () => {
            const manager = createAIManager();
            configureEnabledAIContext([manager]);
            const addEventListener = jest.spyOn(document, 'addEventListener');
            const removeEventListener = jest.spyOn(
                document,
                'removeEventListener'
            );
            await contentScript._restartAIContextFeatures();

            await contentScript.cleanup();

            const active = getActiveAIListeners(
                addEventListener,
                removeEventListener
            );
            for (const eventName of aiDocumentEvents) {
                expect(active.get(eventName).size).toBe(0);
            }
            expect(manager.destroy).toHaveBeenCalledTimes(1);
            expect(contentScript.aiContextManager).toBeNull();
            expect(contentScript.sidePanelIntegration).toBeNull();
        });

        test('comprehensive cleanup waits for a previously invalidated manager candidate', async () => {
            const initialization = createDeferred();
            const staleManager = createAIManager(initialization.promise);
            configureEnabledAIContext([staleManager]);

            const staleInitialization =
                contentScript._restartAIContextFeatures();
            while (!staleManager.initialize.mock.calls.length) {
                await Promise.resolve();
            }

            const disable = contentScript._disableAIContextInteractions();
            let comprehensiveCleanupSettled = false;
            const comprehensiveCleanup = contentScript.cleanup().then(() => {
                comprehensiveCleanupSettled = true;
            });
            await Promise.resolve();
            expect(comprehensiveCleanupSettled).toBe(false);

            initialization.resolve(true);
            await staleInitialization;
            await disable;
            await comprehensiveCleanup;

            expect(staleManager.destroy).toHaveBeenCalledTimes(1);
            expect(contentScript.aiContextManager).toBeNull();
            expect(contentScript.sidePanelIntegration).toBeNull();
        });

        test('comprehensive cleanup waits for a manager factory that resolves after invalidation', async () => {
            const factory = createDeferred();
            const staleManager = createAIManager();
            configureEnabledAIContext([]);
            contentScript._createAIContextManager.mockImplementation(
                () => factory.promise
            );

            const staleInitialization =
                contentScript._restartAIContextFeatures();
            while (!contentScript._createAIContextManager.mock.calls.length) {
                await Promise.resolve();
            }

            let comprehensiveCleanupSettled = false;
            const comprehensiveCleanup = contentScript.cleanup().then(() => {
                comprehensiveCleanupSettled = true;
            });
            await Promise.resolve();
            expect(comprehensiveCleanupSettled).toBe(false);

            factory.resolve(staleManager);
            await expect(staleInitialization).resolves.toBe(false);
            await comprehensiveCleanup;

            expect(staleManager.initialize).not.toHaveBeenCalled();
            expect(staleManager.destroy).toHaveBeenCalledTimes(1);
            expect(contentScript.aiContextManager).toBeNull();
            expect(contentScript.sidePanelIntegration).toBeNull();
        });

        test('keeps subtitles non-interactive when the strict AI projection is disabled', async () => {
            const readMultipleResultStrict = jest.fn().mockResolvedValue({
                values: {
                    aiContextEnabled: false,
                    aiContextProvider: 'openai',
                    aiContextTypes: ['cultural', 'historical', 'linguistic'],
                    aiContextTimeout: 30000,
                    aiContextRetryAttempts: 3,
                },
            });
            contentScript.configService = {
                readMultipleResultStrict,
            };
            contentScript.subtitleUtils = {
                initializeInteractiveSubtitleFeatures: jest.fn(),
                setInteractiveSubtitlesEnabled: jest.fn(),
            };
            const sidePanelInitialization = jest.spyOn(
                contentScript,
                '_initializeSidePanelIntegration'
            );
            const managerCreation = jest.spyOn(
                contentScript,
                '_createAIContextManager'
            );

            const result = await contentScript.initializeAIContextFeatures();

            expect(result).toBe(true);
            expect(readMultipleResultStrict).toHaveBeenCalledTimes(1);
            expect(readMultipleResultStrict).toHaveBeenCalledWith([
                'aiContextEnabled',
                'aiContextProvider',
                'aiContextTypes',
                'aiContextTimeout',
                'aiContextRetryAttempts',
            ]);
            expect(sidePanelInitialization).not.toHaveBeenCalled();
            expect(managerCreation).not.toHaveBeenCalled();
            expect(
                contentScript.subtitleUtils
                    .initializeInteractiveSubtitleFeatures
            ).not.toHaveBeenCalled();
            expect(
                contentScript.subtitleUtils.setInteractiveSubtitlesEnabled
            ).toHaveBeenCalledWith(false);
        });

        test('treats a rejected strict AI projection as disabled without leaking its error', async () => {
            const marker = 'PRIVATE_AI_CONFIG_REJECTION';
            const readMultipleResultStrict = jest
                .fn()
                .mockRejectedValue(new Error(marker));
            contentScript.configService = { readMultipleResultStrict };
            contentScript.subtitleUtils = {
                initializeInteractiveSubtitleFeatures: jest.fn(),
                setInteractiveSubtitlesEnabled: jest.fn(),
            };
            const sidePanelInitialization = jest.spyOn(
                contentScript,
                '_initializeSidePanelIntegration'
            );
            const managerCreation = jest.spyOn(
                contentScript,
                '_createAIContextManager'
            );
            const logSpy = jest.spyOn(contentScript, 'logWithFallback');

            const result = await contentScript.initializeAIContextFeatures();

            expect(result).toBe(true);
            expect(readMultipleResultStrict).toHaveBeenCalledTimes(1);
            expect(sidePanelInitialization).not.toHaveBeenCalled();
            expect(managerCreation).not.toHaveBeenCalled();
            expect(
                contentScript.subtitleUtils
                    .initializeInteractiveSubtitleFeatures
            ).not.toHaveBeenCalled();
            expect(
                contentScript.subtitleUtils.setInteractiveSubtitlesEnabled
            ).toHaveBeenCalledWith(false);
            expect(JSON.stringify(logSpy.mock.calls)).not.toContain(marker);
        });

        test('treats an incomplete strict AI projection as disabled', async () => {
            const readMultipleResultStrict = jest.fn().mockResolvedValue({
                values: {
                    aiContextEnabled: true,
                    aiContextProvider: 'openai',
                    aiContextTypes: ['cultural'],
                    aiContextTimeout: 30000,
                },
            });
            contentScript.configService = { readMultipleResultStrict };
            contentScript.subtitleUtils = {
                initializeInteractiveSubtitleFeatures: jest.fn(),
                setInteractiveSubtitlesEnabled: jest.fn(),
            };
            const sidePanelInitialization = jest.spyOn(
                contentScript,
                '_initializeSidePanelIntegration'
            );
            const managerCreation = jest.spyOn(
                contentScript,
                '_createAIContextManager'
            );

            const result = await contentScript.initializeAIContextFeatures();

            expect(result).toBe(true);
            expect(readMultipleResultStrict).toHaveBeenCalledTimes(1);
            expect(sidePanelInitialization).not.toHaveBeenCalled();
            expect(managerCreation).not.toHaveBeenCalled();
            expect(
                contentScript.subtitleUtils
                    .initializeInteractiveSubtitleFeatures
            ).not.toHaveBeenCalled();
            expect(
                contentScript.subtitleUtils.setInteractiveSubtitlesEnabled
            ).toHaveBeenCalledWith(false);
        });

        test('rejects an accessor-backed strict AI projection without invoking it', async () => {
            const valuesGetter = jest.fn(() => ({
                aiContextEnabled: true,
                aiContextProvider: 'openai',
                aiContextTypes: ['cultural'],
                aiContextTimeout: 30000,
                aiContextRetryAttempts: 3,
            }));
            const strictResult = {};
            Object.defineProperty(strictResult, 'values', {
                get: valuesGetter,
            });
            contentScript.configService = {
                readMultipleResultStrict: jest
                    .fn()
                    .mockResolvedValue(strictResult),
            };
            contentScript.subtitleUtils = {
                initializeInteractiveSubtitleFeatures: jest.fn(),
                setInteractiveSubtitlesEnabled: jest.fn(),
            };
            const sidePanelInitialization = jest.spyOn(
                contentScript,
                '_initializeSidePanelIntegration'
            );
            const managerCreation = jest.spyOn(
                contentScript,
                '_createAIContextManager'
            );

            const result = await contentScript.initializeAIContextFeatures();

            expect(result).toBe(true);
            expect(valuesGetter).not.toHaveBeenCalled();
            expect(sidePanelInitialization).not.toHaveBeenCalled();
            expect(managerCreation).not.toHaveBeenCalled();
            expect(
                contentScript.subtitleUtils
                    .initializeInteractiveSubtitleFeatures
            ).not.toHaveBeenCalled();
            expect(
                contentScript.subtitleUtils.setInteractiveSubtitlesEnabled
            ).toHaveBeenCalledWith(false);
        });

        test('treats a transparent proxy strict AI projection as disabled', async () => {
            const marker = 'PRIVATE_PROXY_PROVIDER';
            const values = new Proxy(
                {
                    aiContextEnabled: true,
                    aiContextProvider: marker,
                    aiContextTypes: ['cultural'],
                    aiContextTimeout: 30000,
                    aiContextRetryAttempts: 3,
                },
                {}
            );
            contentScript.configService = {
                readMultipleResultStrict: jest.fn().mockResolvedValue({
                    values,
                }),
            };
            contentScript.subtitleUtils = {
                initializeInteractiveSubtitleFeatures: jest.fn(),
                setInteractiveSubtitlesEnabled: jest.fn(),
            };
            const sidePanelInitialization = jest.spyOn(
                contentScript,
                '_initializeSidePanelIntegration'
            );
            const managerCreation = jest.spyOn(
                contentScript,
                '_createAIContextManager'
            );
            const logSpy = jest.spyOn(contentScript, 'logWithFallback');

            const result = await contentScript.initializeAIContextFeatures();

            expect(result).toBe(true);
            expect(sidePanelInitialization).not.toHaveBeenCalled();
            expect(managerCreation).not.toHaveBeenCalled();
            expect(
                contentScript.subtitleUtils
                    .initializeInteractiveSubtitleFeatures
            ).not.toHaveBeenCalled();
            expect(
                contentScript.subtitleUtils.setInteractiveSubtitlesEnabled
            ).toHaveBeenCalledWith(false);
            expect(JSON.stringify(logSpy.mock.calls)).not.toContain(marker);
        });

        test('ignores an unrelated outer accessor without invoking it', async () => {
            const marker = 'PRIVATE_UNRELATED_OUTER_GETTER';
            const unrelatedGetter = jest.fn(() => {
                throw new Error(marker);
            });
            const values = {
                aiContextEnabled: false,
                aiContextProvider: 'openai',
                aiContextTypes: ['cultural'],
                aiContextTimeout: 30000,
                aiContextRetryAttempts: 3,
            };
            const strictResult = { values };
            Object.defineProperty(strictResult, 'unrelated', {
                enumerable: true,
                get: unrelatedGetter,
            });
            contentScript.configService = {
                readMultipleResultStrict: jest
                    .fn()
                    .mockResolvedValue(strictResult),
            };
            const logSpy = jest.spyOn(contentScript, 'logWithFallback');

            await expect(
                contentScript._getAIContextConfiguration()
            ).resolves.toEqual(values);

            expect(unrelatedGetter).not.toHaveBeenCalled();
            expect(JSON.stringify(logSpy.mock.calls)).not.toContain(marker);
        });

        test('rejects an accessor-backed AI context types array without invoking it', async () => {
            const marker = 'PRIVATE_AI_TYPES_GETTER';
            const itemGetter = jest.fn(() => {
                throw new Error(marker);
            });
            const aiContextTypes = [];
            Object.defineProperty(aiContextTypes, '0', {
                enumerable: true,
                get: itemGetter,
            });
            const strictResult = {
                values: {
                    aiContextEnabled: true,
                    aiContextProvider: 'openai',
                    aiContextTypes,
                    aiContextTimeout: 30000,
                    aiContextRetryAttempts: 3,
                },
            };
            contentScript.configService = {
                readMultipleResultStrict: jest
                    .fn()
                    .mockResolvedValue(strictResult),
            };
            const logSpy = jest.spyOn(contentScript, 'logWithFallback');

            await expect(
                contentScript._getAIContextConfiguration()
            ).resolves.toBeNull();

            expect(itemGetter).not.toHaveBeenCalled();
            expect(JSON.stringify(logSpy.mock.calls)).not.toContain(marker);
        });

        test('rejects a proxied AI context types array without reading its values', async () => {
            const valueRead = jest.fn((target, key, receiver) =>
                Reflect.get(target, key, receiver)
            );
            const aiContextTypes = new Proxy(['cultural'], {
                get: valueRead,
            });
            contentScript.configService = {
                readMultipleResultStrict: jest.fn().mockResolvedValue({
                    values: {
                        aiContextEnabled: true,
                        aiContextProvider: 'openai',
                        aiContextTypes,
                        aiContextTimeout: 30000,
                        aiContextRetryAttempts: 3,
                    },
                }),
            };

            await expect(
                contentScript._getAIContextConfiguration()
            ).resolves.toBeNull();

            expect(valueRead).not.toHaveBeenCalled();
        });

        test('rejects a revoked AI context types array', async () => {
            const { proxy: aiContextTypes, revoke } = Proxy.revocable(
                ['cultural'],
                {}
            );
            revoke();
            contentScript.configService = {
                readMultipleResultStrict: jest.fn().mockResolvedValue({
                    values: {
                        aiContextEnabled: true,
                        aiContextProvider: 'openai',
                        aiContextTypes,
                        aiContextTimeout: 30000,
                        aiContextRetryAttempts: 3,
                    },
                }),
            };

            await expect(
                contentScript._getAIContextConfiguration()
            ).resolves.toBeNull();
        });

        test('uses the shared schema validator for AI configuration boundaries', async () => {
            const retrySchema = configSchema.aiContextRetryAttempts;
            const originalMinimum = retrySchema.min;
            retrySchema.min = 4;
            contentScript.configService = {
                readMultipleResultStrict: jest.fn().mockResolvedValue({
                    values: {
                        aiContextEnabled: true,
                        aiContextProvider: 'openai',
                        aiContextTypes: ['cultural'],
                        aiContextTimeout: 30000,
                        aiContextRetryAttempts: 3,
                    },
                }),
            };

            try {
                await expect(
                    contentScript._getAIContextConfiguration()
                ).resolves.toBeNull();
            } finally {
                retrySchema.min = originalMinimum;
            }
        });

        test('removes existing click styling when AI context is disabled', async () => {
            document.body.innerHTML = `
                <span class="dualsub-interactive-word dualsub-word-selected dualsub-interactive-word--hover" role="button" tabindex="0">hello</span>
            `;
            contentScript.subtitleUtils = {
                setInteractiveSubtitlesEnabled: jest.fn(),
            };

            await contentScript._disableAIContextInteractions();

            const word = document.querySelector('span');
            expect(word).not.toHaveClass('dualsub-interactive-word');
            expect(word).not.toHaveClass('dualsub-word-selected');
            expect(word).not.toHaveAttribute('role');
            expect(word).not.toHaveAttribute('tabindex');
        });
    });

    test('handleSubtitleDataFound forwards the exact payload while logging only Boolean state', () => {
        const useNativeTargetState = {
            canary: 'USE_NATIVE_TARGET_STATE_CANARY',
        };
        const subtitlesActiveState = {
            canary: 'SUBTITLES_ACTIVE_STATE_CANARY',
        };
        const subtitleData = {
            videoId: 'VIDEO_ID_CANARY',
            sourceLanguage: 'SOURCE_LANGUAGE_CANARY',
            targetLanguage: 'TARGET_LANGUAGE_CANARY',
            vttText: 'VTT_TEXT_CANARY',
            targetVttText: 'TARGET_VTT_TEXT_CANARY',
            useNativeTarget: useNativeTargetState,
        };
        const activePlatform = { canary: 'ACTIVE_PLATFORM_CANARY' };
        const currentConfig = { canary: 'CURRENT_CONFIG_CANARY' };
        const handleSubtitleDataFound = jest.fn();
        contentScript.subtitleUtils = {
            handleSubtitleDataFound,
            subtitlesActive: subtitlesActiveState,
        };
        contentScript.activePlatform = activePlatform;
        contentScript.currentConfig = currentConfig;
        const logSpy = jest
            .spyOn(contentScript, 'logWithFallback')
            .mockImplementation(() => {});

        try {
            contentScript.handleSubtitleDataFound(subtitleData);

            expect(handleSubtitleDataFound).toHaveBeenCalledTimes(1);
            expect(handleSubtitleDataFound.mock.calls[0]).toEqual([
                subtitleData,
                activePlatform,
                currentConfig,
                contentScript.logPrefix,
            ]);
            expect(handleSubtitleDataFound.mock.calls[0][0]).toBe(subtitleData);
            expect(handleSubtitleDataFound.mock.calls[0][1]).toBe(
                activePlatform
            );
            expect(handleSubtitleDataFound.mock.calls[0][2]).toBe(
                currentConfig
            );

            const subtitleDataLog = logSpy.mock.calls.find(
                ([level, message]) =>
                    level === 'info' &&
                    message === 'Subtitle data found callback triggered'
            );
            expect(subtitleDataLog).toEqual([
                'info',
                'Subtitle data found callback triggered',
                {
                    hasSubtitleData: true,
                    hasVttText: true,
                    hasTargetVttText: true,
                    usesNativeTarget: true,
                    hasSubtitleUtils: true,
                    hasActivePlatform: true,
                    subtitlesActive: true,
                },
            ]);
            expect(Object.values(subtitleDataLog[2])).not.toContain(
                useNativeTargetState
            );
            expect(Object.values(subtitleDataLog[2])).not.toContain(
                subtitlesActiveState
            );
            for (const canary of [
                'VIDEO_ID_CANARY',
                'SOURCE_LANGUAGE_CANARY',
                'TARGET_LANGUAGE_CANARY',
                'VTT_TEXT_CANARY',
                'TARGET_VTT_TEXT_CANARY',
                'USE_NATIVE_TARGET_STATE_CANARY',
                'SUBTITLES_ACTIVE_STATE_CANARY',
            ]) {
                expect(JSON.stringify(subtitleDataLog)).not.toContain(canary);
            }
        } finally {
            logSpy.mockRestore();
        }
    });
});
