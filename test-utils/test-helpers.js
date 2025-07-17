/**
 * Test Helper Utilities
 * 
 * Provides common test setup, assertion utilities, platform test suite generator,
 * and mock state management functionality for consistent testing patterns.
 */

import { jest, describe, test, beforeEach, afterEach, expect } from '@jest/globals';
import { LocationMock, mockWindowLocation } from './location-mock.js';
import { ChromeApiMock, mockChromeApi } from './chrome-api-mock.js';
import { createLoggerMock } from './logger-mock.js';
import Logger from '../utils/logger.js';

/**
 * Mock State Management Registry
 * Tracks all active mocks and provides centralized cleanup
 */
class MockStateRegistry {
  constructor() {
    this.activeMocks = new Map();
    this.cleanupFunctions = [];
  }

  /**
   * Register a mock with cleanup function
   * @param {string} name - Mock identifier
   * @param {Object} mock - Mock instance
   * @param {Function} cleanup - Cleanup function
   */
  register(name, mock, cleanup) {
    this.activeMocks.set(name, mock);
    if (cleanup) {
      this.cleanupFunctions.push(cleanup);
    }
  }

  /**
   * Get a registered mock by name
   * @param {string} name - Mock identifier
   * @returns {Object|null} Mock instance or null if not found
   */
  get(name) {
    return this.activeMocks.get(name) || null;
  }

  /**
   * Reset all registered mocks to clean state
   */
  resetAll() {
    this.activeMocks.forEach(mock => {
      if (mock && typeof mock.reset === 'function') {
        mock.reset();
      }
    });
  }

  /**
   * Run all cleanup functions and clear registry
   */
  cleanup() {
    this.cleanupFunctions.forEach(cleanup => {
      try {
        cleanup();
      } catch (error) {
        console.warn('Mock cleanup error:', error);
      }
    });
    this.cleanupFunctions = [];
    this.activeMocks.clear();
  }
}

/**
 * Platform Test Configuration Schema
 */
const PlatformTestConfig = {
  netflix: {
    name: 'Netflix',
    hostname: 'www.netflix.com',
    playerPath: '/watch/12345',
    videoId: '12345',
    className: 'NetflixPlatform',
    eventTypes: {
      ready: 'INJECT_SCRIPT_READY',
      subtitleData: 'SUBTITLE_DATA_FOUND'
    }
  },
  disneyplus: {
    name: 'Disney Plus',
    hostname: 'www.disneyplus.com',
    playerPath: '/video/abc123',
    videoId: 'abc123',
    className: 'DisneyPlusPlatform',
    eventTypes: {
      ready: 'INJECT_SCRIPT_READY',
      subtitleUrl: 'SUBTITLE_URL_FOUND'
    }
  }
};

/**
 * Test Helper Class
 * Provides common test setup and utilities
 */
class TestHelpers {
  constructor() {
    this.mockRegistry = new MockStateRegistry();
  }

  /**
   * Setup complete test environment with all mocks
   * @param {Object} options - Configuration options
   * @returns {Object} Test environment with all mocks
   */
  setupTestEnvironment(options = {}) {
    const {
      platform = 'netflix',
      enableLogger = true,
      enableChromeApi = true,
      enableLocation = true,
      loggerDebugMode = false
    } = options;

    const env = {
      mocks: {},
      cleanup: () => this.mockRegistry.cleanup()
    };

    // Setup Chrome API mock
    if (enableChromeApi) {
      const chromeApiMock = ChromeApiMock.create();
      const chromeCleanup = mockChromeApi(chromeApiMock);
      this.mockRegistry.register('chromeApi', chromeApiMock, chromeCleanup);
      env.mocks.chromeApi = chromeApiMock;
    }

    // Setup location mock
    if (enableLocation) {
      const platformConfig = PlatformTestConfig[platform];
      const locationMock = new LocationMock({
        hostname: platformConfig.hostname,
        pathname: platformConfig.playerPath,
        protocol: 'https:',
        href: `https://${platformConfig.hostname}${platformConfig.playerPath}`
      });
      const locationCleanup = mockWindowLocation(locationMock);
      this.mockRegistry.register('location', locationMock, locationCleanup);
      env.mocks.location = locationMock;
    }

    // Setup logger mock
    if (enableLogger) {
      const loggerMock = createLoggerMock({ debugMode: loggerDebugMode });
      jest.spyOn(Logger, 'create').mockReturnValue(loggerMock);
      this.mockRegistry.register('logger', loggerMock, () => {
        Logger.create.mockRestore?.();
      });
      env.mocks.logger = loggerMock;
    }

    return env;
  }

  /**
   * Reset all mocks to clean state
   */
  resetAllMocks() {
    jest.clearAllMocks();
    this.mockRegistry.resetAll();
  }

  /**
   * Create mock event for platform testing
   * @param {string} type - Event type
   * @param {Object} payload - Event payload
   * @returns {Object} Mock event object
   */
  createMockEvent(type, payload = {}) {
    return {
      detail: {
        type,
        ...payload
      }
    };
  }

  /**
   * Create Netflix-specific mock events
   * @param {string} type - Event type ('ready' | 'subtitleData')
   * @param {Object} options - Event options
   * @returns {Object} Mock event
   */
  createNetflixEvent(type, options = {}) {
    const { movieId = '12345', timedtexttracks = [] } = options;

    switch (type) {
      case 'ready':
        return this.createMockEvent('INJECT_SCRIPT_READY');
      
      case 'subtitleData':
        return this.createMockEvent('SUBTITLE_DATA_FOUND', {
          payload: {
            movieId,
            timedtexttracks: timedtexttracks.length > 0 ? timedtexttracks : [
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
        });
      
      default:
        throw new Error(`Unknown Netflix event type: ${type}`);
    }
  }

  /**
   * Create Disney Plus-specific mock events
   * @param {string} type - Event type ('ready' | 'subtitleUrl')
   * @param {Object} options - Event options
   * @returns {Object} Mock event
   */
  createDisneyPlusEvent(type, options = {}) {
    const { videoId = 'abc123', url = 'http://example.com/master.m3u8' } = options;

    switch (type) {
      case 'ready':
        return this.createMockEvent('INJECT_SCRIPT_READY');
      
      case 'subtitleUrl':
        return this.createMockEvent('SUBTITLE_URL_FOUND', {
          videoId,
          url
        });
      
      default:
        throw new Error(`Unknown Disney Plus event type: ${type}`);
    }
  }

  /**
   * Setup Chrome API mock with common responses
   * @param {Object} storageData - Initial storage data
   * @param {Object} runtimeResponses - Runtime message responses
   */
  setupChromeApiResponses(storageData = {}, runtimeResponses = {}) {
    const chromeApiMock = this.mockRegistry.get('chromeApi');
    if (!chromeApiMock) {
      throw new Error('Chrome API mock not registered. Call setupTestEnvironment first.');
    }

    // Setup storage responses
    const defaultStorageData = {
      targetLanguage: 'zh-CN',
      originalLanguage: 'en',
      useNativeSubtitles: true,
      ...storageData
    };

    chromeApiMock.storage.sync.get.mockImplementation((keys, callback) => {
      callback(defaultStorageData);
    });

    // Setup runtime message responses
    const defaultRuntimeResponse = {
      success: true,
      videoId: '12345',
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      ...runtimeResponses
    };

    chromeApiMock.runtime.sendMessage.mockImplementation((message, callback) => {
      callback(defaultRuntimeResponse);
    });
  }

  /**
   * Create assertion helpers for common test patterns
   * @returns {Object} Assertion helper functions
   */
  get assertions() {
    return {
      /**
       * Assert that logger was called with specific message
       * @param {Object} loggerMock - Logger mock instance
       * @param {string} level - Log level
       * @param {string} message - Expected message
       * @param {Object} context - Expected context (optional)
       */
      expectLoggerCalled: (loggerMock, level, message, context = null) => {
        if (context) {
          expect(loggerMock[level]).toHaveBeenCalledWith(
            message,
            expect.objectContaining(context)
          );
        } else {
          expect(loggerMock[level]).toHaveBeenCalledWith(message);
        }
      },

      /**
       * Assert that Chrome API storage was accessed
       * @param {Object} chromeApiMock - Chrome API mock instance
       * @param {string} method - Storage method ('get' | 'set' | 'remove')
       * @param {*} expectedArgs - Expected arguments
       */
      expectStorageAccessed: (chromeApiMock, method, expectedArgs = null) => {
        if (expectedArgs) {
          expect(chromeApiMock.storage.sync[method]).toHaveBeenCalledWith(
            expectedArgs,
            expect.any(Function)
          );
        } else {
          expect(chromeApiMock.storage.sync[method]).toHaveBeenCalled();
        }
      },

      /**
       * Assert that Chrome runtime message was sent
       * @param {Object} chromeApiMock - Chrome API mock instance
       * @param {Object} expectedMessage - Expected message object
       */
      expectRuntimeMessageSent: (chromeApiMock, expectedMessage = null) => {
        if (expectedMessage) {
          expect(chromeApiMock.runtime.sendMessage).toHaveBeenCalledWith(
            expect.objectContaining(expectedMessage),
            expect.any(Function)
          );
        } else {
          expect(chromeApiMock.runtime.sendMessage).toHaveBeenCalled();
        }
      },

      /**
       * Assert that platform is properly initialized
       * @param {Object} platform - Platform instance
       * @param {Object} loggerMock - Logger mock instance
       */
      expectPlatformInitialized: (platform, loggerMock) => {
        expect(platform.logger).toBe(loggerMock);
        expect(loggerMock.info).toHaveBeenCalledWith(
          'Initialized and event listener added',
          expect.objectContaining({
            selectors: expect.any(Array)
          })
        );
      }
    };
  }
}

/**
 * Platform Test Suite Generator
 * Creates consistent test patterns for platform classes
 */
class PlatformTestSuiteGenerator {
  /**
   * Generate common platform test suite
   * @param {Function} PlatformClass - Platform class constructor
   * @param {Object} config - Platform configuration
   * @returns {Function} Test suite function
   */
  static generateTestSuite(PlatformClass, config) {
    return function() {
      const testHelpers = new TestHelpers();
      let platform;
      let testEnv;

      beforeEach(() => {
        testEnv = testHelpers.setupTestEnvironment({
          platform: config.platform,
          enableLogger: true,
          enableChromeApi: true,
          enableLocation: true
        });

        platform = new PlatformClass();
      });

      afterEach(() => {
        if (platform && typeof platform.cleanup === 'function') {
          platform.cleanup();
        }
        testEnv.cleanup();
        testHelpers.resetAllMocks();
      });

      describe('Logger Initialization', () => {
        test('should create logger instance with correct component name', () => {
          expect(Logger.create).toHaveBeenCalledWith(config.className);
          expect(platform.logger).toBe(testEnv.mocks.logger);
        });
      });

      describe('Platform Detection', () => {
        test('should detect platform as active', () => {
          const isActive = platform.isPlatformActive();
          expect(isActive).toBe(true);
        });

        test('should detect player page as active', () => {
          const isPlayerActive = platform.isPlayerPageActive();
          expect(isPlayerActive).toBe(true);
        });
      });

      describe('Initialization', () => {
        test('should initialize successfully with callbacks', async () => {
          const mockOnSubtitleFound = jest.fn();
          const mockOnVideoIdChange = jest.fn();

          await platform.initialize(mockOnSubtitleFound, mockOnVideoIdChange);

          testHelpers.assertions.expectPlatformInitialized(platform, testEnv.mocks.logger);
        });
      });

      describe('Event Handling', () => {
        test('should handle inject script ready event', () => {
          const readyEvent = testHelpers.createMockEvent(config.eventTypes.ready);
          
          if (platform.handleInjectorEvents) {
            platform.handleInjectorEvents(readyEvent);
          } else if (platform._handleInjectorEvents) {
            platform._handleInjectorEvents(readyEvent);
          }

          testHelpers.assertions.expectLoggerCalled(
            testEnv.mocks.logger,
            'info',
            'Inject script is ready'
          );
        });
      });

      describe('Cleanup', () => {
        test('should cleanup successfully', () => {
          platform.eventListener = jest.fn();
          platform.subtitleObserver = { disconnect: jest.fn() };
          
          platform.cleanup();

          testHelpers.assertions.expectLoggerCalled(
            testEnv.mocks.logger,
            'info',
            'Platform cleaned up successfully'
          );
        });
      });

      return { testHelpers, testEnv, platform };
    };
  }

  /**
   * Generate Netflix-specific test suite
   * @param {Function} NetflixPlatformClass - Netflix platform class
   * @returns {Function} Test suite function
   */
  static generateNetflixTestSuite(NetflixPlatformClass) {
    const baseConfig = {
      platform: 'netflix',
      className: 'NetflixPlatform',
      eventTypes: PlatformTestConfig.netflix.eventTypes
    };

    const baseSuite = this.generateTestSuite(NetflixPlatformClass, baseConfig);

    return function() {
      const baseResult = baseSuite.call(this);
      const { testHelpers, testEnv } = baseResult;

      describe('Netflix-Specific Tests', () => {
        test('should handle subtitle data found event', () => {
          const subtitleEvent = testHelpers.createNetflixEvent('subtitleData');
          
          testHelpers.setupChromeApiResponses();
          baseResult.platform.handleInjectorEvents(subtitleEvent);

          testHelpers.assertions.expectLoggerCalled(
            testEnv.mocks.logger,
            'debug',
            'Raw subtitle data received'
          );
        });

        test('should extract movie ID from URL', () => {
          const movieId = baseResult.platform.extractMovieIdFromUrl();
          
          expect(movieId).toBe('12345');
          testHelpers.assertions.expectLoggerCalled(
            testEnv.mocks.logger,
            'debug',
            'Extracted movieId from URL'
          );
        });
      });

      return baseResult;
    };
  }

  /**
   * Generate Disney Plus-specific test suite
   * @param {Function} DisneyPlusPlatformClass - Disney Plus platform class
   * @returns {Function} Test suite function
   */
  static generateDisneyPlusTestSuite(DisneyPlusPlatformClass) {
    const baseConfig = {
      platform: 'disneyplus',
      className: 'DisneyPlusPlatform',
      eventTypes: PlatformTestConfig.disneyplus.eventTypes
    };

    const baseSuite = this.generateTestSuite(DisneyPlusPlatformClass, baseConfig);

    return function() {
      const baseResult = baseSuite.call(this);
      const { testHelpers, testEnv } = baseResult;

      describe('Disney Plus-Specific Tests', () => {
        test('should handle subtitle URL found event', () => {
          const subtitleEvent = testHelpers.createDisneyPlusEvent('subtitleUrl');
          
          testHelpers.setupChromeApiResponses();
          baseResult.platform._handleInjectorEvents(subtitleEvent);

          testHelpers.assertions.expectLoggerCalled(
            testEnv.mocks.logger,
            'info',
            'SUBTITLE_URL_FOUND for injectedVideoId'
          );
        });
      });

      return baseResult;
    };
  }
}

// Global test helper instance for convenience
const globalTestHelpers = new TestHelpers();

export {
  TestHelpers,
  MockStateRegistry,
  PlatformTestSuiteGenerator,
  PlatformTestConfig,
  globalTestHelpers
};