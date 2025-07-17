/**
 * Test Helper Utilities Tests
 * 
 * Tests to verify the test helper utilities work correctly
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { 
  TestHelpers, 
  MockStateRegistry, 
  PlatformTestSuiteGenerator,
  PlatformTestConfig,
  globalTestHelpers 
} from './test-helpers.js';

describe('Test Helper Utilities', () => {
  let testHelpers;

  beforeEach(() => {
    testHelpers = new TestHelpers();
  });

  afterEach(() => {
    testHelpers.mockRegistry.cleanup();
  });

  describe('MockStateRegistry', () => {
    let registry;

    beforeEach(() => {
      registry = new MockStateRegistry();
    });

    afterEach(() => {
      registry.cleanup();
    });

    test('should register and retrieve mocks', () => {
      const mockObject = { reset: jest.fn() };
      const cleanup = jest.fn();

      registry.register('test', mockObject, cleanup);

      expect(registry.get('test')).toBe(mockObject);
      expect(registry.get('nonexistent')).toBeNull();
    });

    test('should reset all registered mocks', () => {
      const mock1 = { reset: jest.fn() };
      const mock2 = { reset: jest.fn() };

      registry.register('mock1', mock1);
      registry.register('mock2', mock2);

      registry.resetAll();

      expect(mock1.reset).toHaveBeenCalled();
      expect(mock2.reset).toHaveBeenCalled();
    });

    test('should run cleanup functions', () => {
      const cleanup1 = jest.fn();
      const cleanup2 = jest.fn();

      registry.register('mock1', {}, cleanup1);
      registry.register('mock2', {}, cleanup2);

      registry.cleanup();

      expect(cleanup1).toHaveBeenCalled();
      expect(cleanup2).toHaveBeenCalled();
    });
  });

  describe('TestHelpers', () => {
    test('should create mock events', () => {
      const event = testHelpers.createMockEvent('TEST_EVENT', { data: 'test' });

      expect(event).toEqual({
        detail: {
          type: 'TEST_EVENT',
          data: 'test'
        }
      });
    });

    test('should create Netflix events', () => {
      const readyEvent = testHelpers.createNetflixEvent('ready');
      expect(readyEvent.detail.type).toBe('INJECT_SCRIPT_READY');

      const subtitleEvent = testHelpers.createNetflixEvent('subtitleData');
      expect(subtitleEvent.detail.type).toBe('SUBTITLE_DATA_FOUND');
      expect(subtitleEvent.detail.payload.movieId).toBe('12345');
    });

    test('should create Disney Plus events', () => {
      const readyEvent = testHelpers.createDisneyPlusEvent('ready');
      expect(readyEvent.detail.type).toBe('INJECT_SCRIPT_READY');

      const urlEvent = testHelpers.createDisneyPlusEvent('subtitleUrl');
      expect(urlEvent.detail.type).toBe('SUBTITLE_URL_FOUND');
      expect(urlEvent.detail.videoId).toBe('abc123');
    });

    test('should setup test environment with Chrome API mock', () => {
      const env = testHelpers.setupTestEnvironment({
        enableChromeApi: true,
        enableLogger: false,
        enableLocation: false
      });

      expect(env.mocks.chromeApi).toBeDefined();
      expect(env.mocks.chromeApi.storage).toBeDefined();
      expect(env.mocks.chromeApi.runtime).toBeDefined();
      expect(typeof env.cleanup).toBe('function');

      env.cleanup();
    });

    test('should setup Chrome API responses', () => {
      const env = testHelpers.setupTestEnvironment({
        enableChromeApi: true,
        enableLogger: false,
        enableLocation: false
      });

      testHelpers.setupChromeApiResponses(
        { customSetting: 'value' },
        { customResponse: 'response' }
      );

      // Test storage mock
      env.mocks.chromeApi.storage.sync.get({}, (result) => {
        expect(result.customSetting).toBe('value');
        expect(result.targetLanguage).toBe('zh-CN'); // Default value
      });

      // Test runtime mock
      env.mocks.chromeApi.runtime.sendMessage({}, (response) => {
        expect(response.customResponse).toBe('response');
        expect(response.success).toBe(true); // Default value
      });

      env.cleanup();
    });

    test('should provide assertion helpers', () => {
      const assertions = testHelpers.assertions;

      expect(typeof assertions.expectLoggerCalled).toBe('function');
      expect(typeof assertions.expectStorageAccessed).toBe('function');
      expect(typeof assertions.expectRuntimeMessageSent).toBe('function');
      expect(typeof assertions.expectPlatformInitialized).toBe('function');
    });
  });

  describe('PlatformTestConfig', () => {
    test('should have Netflix configuration', () => {
      const config = PlatformTestConfig.netflix;

      expect(config.name).toBe('Netflix');
      expect(config.hostname).toBe('www.netflix.com');
      expect(config.className).toBe('NetflixPlatform');
      expect(config.eventTypes.ready).toBe('INJECT_SCRIPT_READY');
      expect(config.eventTypes.subtitleData).toBe('SUBTITLE_DATA_FOUND');
    });

    test('should have Disney Plus configuration', () => {
      const config = PlatformTestConfig.disneyplus;

      expect(config.name).toBe('Disney Plus');
      expect(config.hostname).toBe('www.disneyplus.com');
      expect(config.className).toBe('DisneyPlusPlatform');
      expect(config.eventTypes.ready).toBe('INJECT_SCRIPT_READY');
      expect(config.eventTypes.subtitleUrl).toBe('SUBTITLE_URL_FOUND');
    });
  });

  describe('PlatformTestSuiteGenerator', () => {
    test('should generate test suite function', () => {
      class MockPlatform {
        constructor() {
          this.logger = null;
        }
        isPlatformActive() { return true; }
        isPlayerPageActive() { return true; }
        async initialize() {}
        cleanup() {}
      }

      const testSuite = PlatformTestSuiteGenerator.generateTestSuite(
        MockPlatform,
        { platform: 'netflix', className: 'MockPlatform', eventTypes: { ready: 'READY' } }
      );

      expect(typeof testSuite).toBe('function');
    });
  });

  describe('Global Test Helpers', () => {
    test('should provide global test helpers instance', () => {
      expect(globalTestHelpers).toBeInstanceOf(TestHelpers);
      expect(typeof globalTestHelpers.createMockEvent).toBe('function');
    });
  });
});