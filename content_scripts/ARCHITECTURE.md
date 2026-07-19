# Content Scripts Architecture

This document provides a detailed overview of the content script architecture,
outlining its design principles, class hierarchy, initialization flow, and key systems.

## Design Principles

The content script architecture is built on several core design principles to ensure
robustness, maintainability, and extensibility:

1.  **Template Method Pattern**: `BaseContentScript` defines the high-level algorithm structure, allowing subclasses to implement platform-specific details without altering the overall workflow.
2.  **Dependency Injection**: Modules are loaded dynamically, promoting loose coupling and enhancing testability by allowing dependencies to be mocked.
3.  **Validated Messaging**: Active extension routes use centralized, exact schemas and explicit sender roles.
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
└── Owns the closed content-script message route table.

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
 * Configures the Base-owned navigation manager for the platform.
 */
setupNavigationDetection();
```

## Message Handling System

The content-script runtime accepts only centralized active actions. Every route has an
explicit sender role plus an exact request/response contract in
`content_scripts/shared/protocol/messageProtocol.js`. Unknown actions, extra or malformed
fields, and unauthorized senders fail closed; platform subclasses do not receive a
fallback message hook.

### Closed Route Table

`BaseContentScript` constructs its internal route table from the supported common
actions. Its registry helpers are setup and diagnostic implementation details, not a
platform extension API.

The control/readiness boundary is centralized in the shared protocol:

- Configuration updates use `buildConfigChangedRequestMessage()` and
  `parseConfigChangedRequestMessage()` and accept only the popup sender role.
- Logging updates and side-panel pause commands use their dedicated builders/parsers
  and accept only the background sender role.
- All three content-control routes share `buildContentControlResponseMessage()` and
  `parseContentControlResponseMessage()`, which bind each response to its request action.
- `PING` and `CHECK_BACKGROUND_READY` use the background-readiness request/response
  builders and parsers and accept only content-script or side-panel senders.
- `readProtocolMessageAction()` recognizes only catalogued `action` values before route
  selection; there is no `type` alias.

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
    senderRoles: string[], // Exact extension roles allowed to invoke the handler.
    description: string, // A description of the handler's purpose.
    registeredAt: string, // The timestamp of registration.
};
```

## Navigation Ownership

`BaseContentScript` is the sole owner of `NavigationDetectionManager`. A platform
subclass implements `setupNavigationDetection()` by calling the protected
`_setupNavigationManager(options?)` seam and supplies its route classifier through
`_isPlayerPath()`.

The manager owns interval, History API, browser-navigation, focus, and visibility
signals. Base owns manager replacement and cleanup, forwards URL changes to the active
platform, invalidates stale player identity when the player route changes, and invokes
the subclass transition handler when entering or leaving a player page. Subclasses do
not install parallel navigation listeners or timers.

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
4.  **Navigation Detection Failures**: Cleans up a failed manager candidate before surfacing the setup error.
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
2.  Implement all required abstract methods; `setupNavigationDetection()` should delegate to `_setupNavigationManager()`.
3.  Add any platform-specific configuration overrides.
4.  Create an entry point file for the new platform.
5.  Update `manifest.json` to include the new content script.

### Adding New Message Types

A new runtime action is a shared protocol change, not a platform override. Add the action
constant, exact request/response builders and parsers, one centralized route with an
explicit sender role, and positive/negative contract tests. Do not add a platform-only
action or a generic fallback handler.

### Adding New Utilities

```javascript
// Create a new utility module in `content_scripts/shared/`.
// content_scripts/shared/customUtils.js

// Import and use the utility in `BaseContentScript` or platform-specific classes.
import { customUtility } from '../shared/customUtils.js';
```

## Migration Strategy

### Contract Migration

- Migrate active senders and receivers together with their shared protocol contract.
- Remove dormant actions and source guards once no production sender remains.
- Do not retain generic platform fallbacks or undocumented compatibility aliases.

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
