# Content Scripts Architecture

This document provides a detailed overview of the content script architecture,
outlining its design principles, class hierarchy, initialization flow, and key systems.

## Design Principles

The content script architecture is built on several core design principles to ensure
robustness, maintainability, and extensibility:

1.  **Template Method Pattern**: `BaseContentScript` defines the high-level algorithm structure, allowing subclasses to implement platform-specific details without altering the overall workflow.
2.  **Dependency Injection**: Modules are loaded dynamically, promoting loose coupling and enhancing testability by allowing dependencies to be mocked.
3.  **Event-Driven Architecture**: An extensible message handling system with action-based routing allows for flexible and decoupled communication.
4.  **Resource Management**: A comprehensive cleanup system and memory management practices prevent resource leaks and ensure stability.
5.  **Error Recovery**: Graceful degradation and retry mechanisms provide resilience against transient failures and unexpected platform changes.

## Class Hierarchy

The class hierarchy is designed to maximize code reuse while providing a clear structure
for platform-specific implementations:

```
BaseContentScript (abstract)
├── Provides common functionality (~80% of the code).
├── Defines abstract methods for platform-specific behavior.
├── Implements template methods for the initialization flow.
└── Includes an extensible message handling system.

NetflixContentScript extends BaseContentScript
├── Implements Netflix-specific configurations.
├── Provides enhanced SPA navigation detection.
└── Defines Netflix-specific injection parameters.

DisneyPlusContentScript extends BaseContentScript
├── Implements Disney+-specific configurations.
├── Uses standard navigation detection strategies.
└── Defines Disney+-specific injection parameters.
```

## Initialization Flow

The initialization process follows a strict template method pattern, ensuring a consistent
and predictable setup sequence across all platforms:

```javascript
async initialize() {
    // Step 1: Initialize core modules and services.
    await this.initializeCore();
        └── loadModules()
            ├── _loadSubtitleUtilities()
            ├── _loadPlatformClass()
            ├── _loadConfigService()
            └── _loadAndInitializeLogger()

    // Step 2: Initialize configuration and listeners.
    await this.initializeConfiguration();
        ├── Load configuration from configService.
        ├── Normalize configuration for consistency.
        └── Set up listeners for configuration changes.

    // Step 3: Initialize event handling and the platform.
    await this.initializeEventHandling();
        ├── Set up early event handling for buffering.
        └── Initialize the platform if subtitles are enabled.

    // Step 4: Initialize observers and cleanup handlers.
    await this.initializeObservers();
        ├── Set up platform-specific navigation detection.
        ├── Set up DOM observation for dynamic content.
        └── Set up cleanup handlers for resource management.
}
```

## Abstract Method Contracts

Platform-specific classes are required to implement the following abstract methods to
ensure they adhere to the contract defined by `BaseContentScript`.

### Required Methods

```javascript
/**
 * Gets the platform name (e.g., 'netflix', 'disneyplus').
 * @returns {string} The platform name.
 */
getPlatformName();

/**
 * Gets the platform class constructor name.
 * @returns {string} The platform class name (e.g., 'NetflixPlatform').
 */
getPlatformClass();

/**
 * Gets the inject script configuration.
 * @returns {Object} The inject script configuration.
 */
getInjectScriptConfig();

/**
 * Sets up platform-specific navigation detection.
 */
setupNavigationDetection();

/**
 * Checks for URL changes with platform-specific logic.
 */
checkForUrlChange();

/**
 * Handles platform-specific Chrome messages.
 * @param {Object} request - The Chrome message request.
 * @param {Function} sendResponse - The callback to send a response.
 * @returns {boolean} `true` if the response is sent asynchronously.
 */
handlePlatformSpecificMessage(request, sendResponse);
```

## Message Handling System

The architecture includes an extensible message handling system that allows for
decoupled communication and easy addition of new message types.

### Message Handler Registry

```javascript
// Register a new message handler.
registerMessageHandler(action, handler, options);

// Common handlers are automatically registered for all platforms:
// - 'toggleSubtitles': Toggles the subtitle display.
// - 'configChanged': Handles dynamic configuration changes.
// - 'LOGGING_LEVEL_CHANGED': Updates the logging level.
```

### Messaging Reliability (MV3)

To communicate with the background service worker reliably under Manifest V3, use the shared messaging utilities that include retry and optional wake-up pings.

- Location: `content_scripts/shared/messaging.js`
- Use `sendRuntimeMessageWithRetry(message, options?)` for calls that may race with service worker startup or suspend.
- On transient failures (e.g., receiving end does not exist, message port closed, no matching service worker, extension context invalidated), it will back off and optionally send `CHECK_BACKGROUND_READY`/`PING` signals before retrying.

### Handler Configuration

```javascript
const handlerConfig = {
    handler: Function, // The function to execute for the message.
    requiresUtilities: boolean, // `true` if utilities must be loaded.
    description: string, // A description of the handler's purpose.
    registeredAt: string, // The timestamp of registration.
};
```

## Navigation Detection Strategies

Different platforms require different navigation detection strategies due to their
unique SPA implementations.

### Netflix (Complex SPA)

- Interval-based URL checking as a reliable fallback.
- History API interception (`pushState`/`replaceState`) for programmatic navigation.
- Browser navigation events (`popstate`, `hashchange`) for user-initiated navigation.
- Focus and visibility events to detect changes when the tab becomes active.
- Enhanced page transition handling for complex routing logic.

### Disney+ (Standard SPA)

- Similar strategies to Netflix but with simpler URL patterns.
- Player page detection for multiple URL variations.
- Standard page transition handling.

## Resource Management

### Cleanup System

The architecture includes a comprehensive resource management system to prevent
memory leaks and ensure stability.

```javascript
// An AbortController is used for cleaning up event listeners.
this.abortController = new AbortController();

// An IntervalManager tracks and cleans up all intervals.
this.intervalManager = new IntervalManager();

// Arrays for tracking cleanup functions for event listeners and DOM observers.
this.eventListenerCleanupFunctions = [];
this.domObserverCleanupFunctions = [];
```

### Memory Management

- Automatic cleanup of resources on page navigation.
- Proper disposal of all registered event listeners.
- Resource pooling for frequently used objects.
- Use of weak references where appropriate to avoid memory leaks.

## Error Handling

### Graceful Degradation

The system is designed to handle errors gracefully and degrade functionality
without crashing the extension.

1.  **Module Loading Failures**: Falls back to console logging if the logger fails to load.
2.  **Platform Initialization Errors**: Cleans up and retries with an exponential backoff.
3.  **Video Detection Timeouts**: Continues with limited functionality if the video element is not found.
4.  **Navigation Detection Failures**: Falls back to interval-based checking.
5.  **Extension Context Invalidation**: Cleans up all listeners and stops operations.

### Retry Mechanisms

```javascript
// Platform initialization is performed with a configurable retry mechanism.
const retryConfig = {
    maxRetries: 3,
    retryDelay: 1000,
    backoffMultiplier: 2,
};
```

## Configuration System

### Configuration Loading

```javascript
// Load the full configuration from the configService.
this.currentConfig = await this.configService.getAll();

// Normalize the configuration to handle backward compatibility.
this._normalizeConfiguration();

// Set up listeners to handle dynamic configuration changes.
this.setupConfigurationListeners();
```

### Platform-Specific Overrides

```javascript
// Netflix-specific configuration overrides.
getNetflixSpecificConfig() {
    return {
        maxVideoDetectionRetries: 40,
        videoDetectionInterval: 1000,
        urlChangeCheckInterval: 2000,
        pageTransitionDelay: 1500
    };
}
```

## Event System

### Event Buffering

Early events, such as subtitle data, are buffered until the platform is fully
initialized and ready to process them.

```javascript
this.eventBuffer = new EventBuffer(logger);

// Buffer events that arrive before the platform is ready.
this.eventBuffer.add(eventData);

// Process all buffered events after initialization.
this.eventBuffer.processAll(handler);
```

### Event Listener Management

```javascript
// Add event listeners with automatic cleanup tracking via AbortController.
const options = this.abortController
    ? { signal: this.abortController.signal }
    : {};
window.addEventListener('event', handler, options);
```

## Testing Architecture

### Test Structure

```javascript
// Unit tests for BaseContentScript.
BaseContentScript.test.js
├── Mocks platform-specific methods to test common functionality.
├── Verifies the execution of the template methods.
└── Tests error handling and graceful degradation.

// Platform-specific integration tests.
NetflixContentScript.test.js
├── Tests concrete implementations of abstract methods.
├── Verifies platform-specific configurations.
├── Tests navigation detection and SPA routing.
└── Mocks Chrome APIs to simulate the extension environment.
```

### Mock Infrastructure

- `test-utils/chrome-api-mock.js`: Provides mocks for the Chrome extension APIs.
- `test-utils/test-helpers.js`: Offers centralized mock management and test environment setup.
- `test-utils/logger-mock.js`: Provides a mock for the logger.
- `test-utils/test-fixtures.js`: Contains standardized test data and fixtures.

## Performance Considerations

### Initialization Optimization

- Lazy loading of non-critical modules to speed up initial load.
- Parallel loading of modules where possible.
- Efficient video element detection algorithms.
- Minimal DOM manipulation during the setup phase.

### Runtime Performance

- Debounced event handlers for high-frequency events.
- Optimized navigation detection strategies to reduce overhead.
- Efficient subtitle update cycles to minimize re-renders.
- Minimal memory allocations in performance-critical code paths.

### Memory Management

- Proper cleanup of all event listeners and observers.
- Use of weak references to prevent circular dependencies.
- Resource pooling for frequently created objects.
- Garbage collection-friendly coding patterns.

## Extension Points

### Adding New Platforms

1.  Extend `BaseContentScript` to create a new platform-specific class.
2.  Implement all required abstract methods.
3.  Add any platform-specific configuration overrides.
4.  Create an entry point file for the new platform.
5.  Update `manifest.json` to include the new content script.

### Adding New Message Types

```javascript
// Register a custom message handler in the platform-specific class.
this.registerMessageHandler(
    'customAction',
    this.handleCustomAction.bind(this),
    {
        requiresUtilities: true,
        description: 'Handles a custom platform-specific action.',
    }
);
```

### Adding New Utilities

```javascript
// Create a new utility module in `content_scripts/shared/`.
// content_scripts/shared/customUtils.js

// Import and use the utility in `BaseContentScript` or platform-specific classes.
import { customUtility } from '../shared/customUtils.js';
```

## Migration Strategy

### Backward Compatibility

- Maintains the existing Chrome message API to ensure compatibility with popup and options pages.
- Preserves all current functionality and user experience.
- Maintains compatibility with existing configuration formats.

### Rollback Plan

- Original files are kept as `.backup` for easy rollback.
- Feature flags can be used for a gradual rollout.
- Comprehensive testing is performed before deployment.
- A quick rollback mechanism is in place if issues are discovered.

## Security Considerations

### Content Script Isolation

- Proper module loading using Chrome extension URLs to prevent cross-site scripting.
- Secure message passing between different extension contexts.
- Input validation for all external data and messages.
- Safe DOM manipulation practices to avoid vulnerabilities.

### Extension Context Management

- Graceful handling of extension context invalidation.
- Proper cleanup of all resources when the context is lost.
- Secure communication with the background script.
- Validation of all Chrome API calls.

## See Also

- [API_REFERENCE.md](./API_REFERENCE.md) - For a detailed API reference.
- [PLATFORM_IMPLEMENTATION_GUIDE.md](./PLATFORM_IMPLEMENTATION_GUIDE.md) - For a guide on adding new platforms.
- [EXAMPLES.md](./EXAMPLES.md) - For practical implementation examples.
