# Test Pattern Documentation and Examples

This document provides comprehensive documentation and examples for the test infrastructure patterns used in the DualSub browser extension project.

## Overview

The test infrastructure provides standardized patterns for testing platform-specific functionality, Chrome extension APIs, and browser environment interactions. It addresses common testing challenges including JSDOM limitations, mock management, and test isolation.

## Core Components

### 1. Test Helpers (`test-helpers.js`)

The `TestHelpers` class provides centralized test setup and utilities:

```javascript
import { TestHelpers } from './test-utils/test-helpers.js';

const testHelpers = new TestHelpers();

// Setup complete test environment
const env = testHelpers.setupTestEnvironment({
  platform: 'netflix',           // 'netflix' | 'disneyplus'
  enableLogger: true,            // Enable logger mocking
  enableChromeApi: true,         // Enable Chrome API mocking
  enableLocation: true,          // Enable location mocking
  loggerDebugMode: false         // Logger debug mode
});

// Use mocks in tests
expect(env.mocks.logger).toBeDefined();
expect(env.mocks.chromeApi).toBeDefined();
expect(env.mocks.location).toBeDefined();

// Cleanup after test
env.cleanup();
```

### 2. Mock State Registry

Centralized mock management with automatic cleanup:

```javascript
import { MockStateRegistry } from './test-utils/test-helpers.js';

const registry = new MockStateRegistry();

// Register mocks with cleanup functions
registry.register('myMock', mockObject, cleanupFunction);

// Reset all mocks
registry.resetAll();

// Run all cleanup functions
registry.cleanup();
```

### 3. Test Fixtures (`test-fixtures.js`)

Standardized test data for consistent testing:

```javascript
import { NetflixFixtures, DisneyPlusFixtures, ChromeApiFixtures } from './test-utils/test-fixtures.js';

// Use predefined Netflix events
const subtitleEvent = NetflixFixtures.subtitleDataEvent;
const readyEvent = NetflixFixtures.injectReadyEvent;

// Use predefined Chrome API responses
const successResponse = ChromeApiFixtures.successfulVttResponse;
const errorResponse = ChromeApiFixtures.failedVttResponse;
```

## Testing Patterns

### 1. Platform Test Pattern

Standard pattern for testing platform classes:

```javascript
import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { TestHelpers } from './test-utils/test-helpers.js';
import { NetflixPlatform } from './netflixPlatform.js';

describe('NetflixPlatform Tests', () => {
  let testHelpers;
  let platform;
  let testEnv;

  beforeEach(() => {
    testHelpers = new TestHelpers();
    testEnv = testHelpers.setupTestEnvironment({
      platform: 'netflix',
      enableLogger: true,
      enableChromeApi: true,
      enableLocation: true
    });

    platform = new NetflixPlatform();
  });

  afterEach(() => {
    if (platform && typeof platform.cleanup === 'function') {
      platform.cleanup();
    }
    testEnv.cleanup();
    testHelpers.resetAllMocks();
  });

  test('should initialize correctly', async () => {
    const mockOnSubtitleFound = jest.fn();
    const mockOnVideoIdChange = jest.fn();

    await platform.initialize(mockOnSubtitleFound, mockOnVideoIdChange);

    testHelpers.assertions.expectPlatformInitialized(platform, testEnv.mocks.logger);
  });
});
```

### 2. Event Handling Pattern

Testing platform event handling:

```javascript
test('should handle subtitle data events', () => {
  const subtitleEvent = testHelpers.createNetflixEvent('subtitleData', {
    movieId: '12345',
    timedtexttracks: [{ language: 'en' }]
  });

  testHelpers.setupChromeApiResponses();
  platform.handleInjectorEvents(subtitleEvent);

  testHelpers.assertions.expectLoggerCalled(
    testEnv.mocks.logger,
    'debug',
    'Raw subtitle data received'
  );
});
```

### 3. Chrome API Testing Pattern

Testing Chrome extension API interactions:

```javascript
test('should communicate with background script', () => {
  // Setup Chrome API responses
  testHelpers.setupChromeApiResponses(
    { targetLanguage: 'zh-CN' },  // Storage response
    { success: true, videoId: '12345' }  // Runtime response
  );

  // Trigger functionality that uses Chrome APIs
  platform.processSubtitleData(mockData);

  // Verify API calls
  testHelpers.assertions.expectStorageAccessed(
    testEnv.mocks.chromeApi,
    'get',
    ['targetLanguage', 'originalLanguage']
  );

  testHelpers.assertions.expectRuntimeMessageSent(
    testEnv.mocks.chromeApi,
    { type: 'PROCESS_VTT' }
  );
});
```

### 4. Location Mocking Pattern

Testing URL-dependent functionality:

```javascript
test('should extract video ID from URL', () => {
  // Set specific location
  testEnv.mocks.location.setLocation({
    hostname: 'www.netflix.com',
    pathname: '/watch/67890'
  });

  const videoId = platform.extractMovieIdFromUrl();

  expect(videoId).toBe('67890');
  testHelpers.assertions.expectLoggerCalled(
    testEnv.mocks.logger,
    'debug',
    'Extracted movieId from URL'
  );
});
```

### 5. Error Handling Pattern

Testing error scenarios:

```javascript
test('should handle Chrome API errors', () => {
  // Setup error response
  testEnv.mocks.chromeApi.runtime.sendMessage.mockImplementation((message, callback) => {
    callback({ success: false, error: 'Network timeout' });
  });

  platform.processSubtitleData(mockData);

  testHelpers.assertions.expectLoggerCalled(
    testEnv.mocks.logger,
    'error',
    'Background failed to process VTT'
  );
});
```

## Advanced Patterns

### 1. Platform Test Suite Generator

Automated test suite generation for consistent platform testing:

```javascript
import { PlatformTestSuiteGenerator } from './test-utils/test-helpers.js';

describe('Netflix Platform', PlatformTestSuiteGenerator.generateNetflixTestSuite(NetflixPlatform));
```

### 2. Scenario-Based Testing

Using test fixtures for comprehensive scenario coverage:

```javascript
import { TestScenarioGenerator } from './test-utils/test-fixtures.js';

const scenarios = TestScenarioGenerator.generateNetflixScenarios();

scenarios.forEach(scenario => {
  test(`should handle ${scenario.name}`, () => {
    // Setup environment for scenario
    testEnv.mocks.location.setLocation(scenario.location);
    
    if (scenario.chromeResponse) {
      testHelpers.setupChromeApiResponses({}, scenario.chromeResponse);
    }

    // Execute scenario
    platform.handleInjectorEvents(scenario.event);

    // Verify expected outcome
    if (scenario.expectedOutcome === 'success') {
      expect(/* success condition */).toBeTruthy();
    } else {
      expect(/* error condition */).toBeTruthy();
    }
  });
});
```

### 3. Integration Testing Pattern

Testing complete workflows:

```javascript
test('should handle complete subtitle processing workflow', async () => {
  // Setup initial state
  testHelpers.setupChromeApiResponses(
    { targetLanguage: 'zh-CN', originalLanguage: 'en' },
    { success: true, vttText: 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nTest' }
  );

  // Initialize platform
  const onSubtitleFound = jest.fn();
  await platform.initialize(onSubtitleFound, jest.fn());

  // Trigger subtitle data event
  const subtitleEvent = testHelpers.createNetflixEvent('subtitleData');
  platform.handleInjectorEvents(subtitleEvent);

  // Verify complete workflow
  expect(onSubtitleFound).toHaveBeenCalled();
  testHelpers.assertions.expectLoggerCalled(
    testEnv.mocks.logger,
    'info',
    'VTT processed successfully'
  );
});
```

## Best Practices

### 1. Test Isolation

Always ensure tests are isolated and don't affect each other:

```javascript
beforeEach(() => {
  // Setup fresh environment for each test
  testEnv = testHelpers.setupTestEnvironment(/* config */);
});

afterEach(() => {
  // Clean up after each test
  testEnv.cleanup();
  testHelpers.resetAllMocks();
});
```

### 2. Mock Management

Use the centralized mock registry for consistent cleanup:

```javascript
// Register custom mocks with cleanup
testHelpers.mockRegistry.register('customMock', mockObject, () => {
  // Custom cleanup logic
});
```

### 3. Assertion Helpers

Use provided assertion helpers for consistent verification:

```javascript
// Instead of manual Jest assertions
testHelpers.assertions.expectLoggerCalled(logger, 'info', 'Expected message');
testHelpers.assertions.expectStorageAccessed(chromeApi, 'get', ['key']);
testHelpers.assertions.expectRuntimeMessageSent(chromeApi, { type: 'MESSAGE' });
```

### 4. Error Testing

Always test error scenarios:

```javascript
test('should handle missing data gracefully', () => {
  const invalidEvent = { detail: { type: 'INVALID' } };
  
  expect(() => {
    platform.handleInjectorEvents(invalidEvent);
  }).not.toThrow();

  testHelpers.assertions.expectLoggerCalled(
    testEnv.mocks.logger,
    'error',
    'Unknown event type'
  );
});
```

### 5. Performance Considerations

Be mindful of test performance:

```javascript
test('should handle large data efficiently', () => {
  const startTime = Date.now();
  
  // Test with large dataset
  platform.processLargeDataset(largeData);
  
  const duration = Date.now() - startTime;
  expect(duration).toBeLessThan(1000); // Should complete within 1 second
});
```

## Common Pitfalls and Solutions

### 1. JSDOM Navigation Errors

**Problem**: Setting `window.location` properties triggers JSDOM navigation errors.

**Solution**: Use the centralized location mock:

```javascript
// ❌ Don't do this
window.location.href = 'https://netflix.com/watch/12345';

// ✅ Do this instead
testEnv.mocks.location.setLocation({
  href: 'https://netflix.com/watch/12345'
});
```

### 2. Mock Persistence Between Tests

**Problem**: Mocks persist between tests causing interference.

**Solution**: Always cleanup and reset:

```javascript
afterEach(() => {
  testEnv.cleanup();
  testHelpers.resetAllMocks();
});
```

### 3. Chrome API Mock Configuration

**Problem**: Chrome API mocks not configured correctly.

**Solution**: Use the helper methods:

```javascript
// ❌ Manual mock setup
chrome.storage.sync.get.mockImplementation(/* ... */);

// ✅ Use helper
testHelpers.setupChromeApiResponses(storageData, runtimeResponse);
```

### 4. Async Test Handling

**Problem**: Async operations not properly awaited in tests.

**Solution**: Always await async operations:

```javascript
test('should handle async initialization', async () => {
  await platform.initialize(mockCallback, mockCallback);
  
  // Assertions after async completion
  expect(platform.isInitialized).toBe(true);
});
```

## Integration with CI/CD

The test infrastructure is designed to work reliably in CI/CD environments:

1. **Deterministic**: Tests produce consistent results across environments
2. **Isolated**: No external dependencies or side effects
3. **Fast**: Efficient mock management and cleanup
4. **Comprehensive**: Full coverage of platform-specific functionality

## Extending the Test Infrastructure

To add support for new platforms or functionality:

1. **Add Platform Configuration**: Update `PlatformTestConfig` in `test-helpers.js`
2. **Create Fixtures**: Add platform-specific fixtures to `test-fixtures.js`
3. **Generate Test Suites**: Create platform-specific test suite generators
4. **Document Patterns**: Update this documentation with new patterns

## Troubleshooting

### Common Issues

1. **Tests failing intermittently**: Check for proper cleanup and mock reset
2. **JSDOM errors**: Ensure using location mock instead of direct window.location
3. **Chrome API errors**: Verify Chrome API mock is properly configured
4. **Memory leaks**: Ensure all cleanup functions are called

### Debug Tips

1. Enable debug logging in test environment
2. Use `console.log` in mock implementations to trace calls
3. Check mock call counts and arguments
4. Verify cleanup is working by running tests multiple times

This documentation provides a comprehensive guide to the test infrastructure patterns. Follow these patterns for consistent, reliable, and maintainable tests.