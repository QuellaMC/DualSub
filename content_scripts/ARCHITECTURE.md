# Content Scripts Architecture

## Design Principles

The content script architecture is built on several key design principles:

1. **Template Method Pattern**: BaseContentScript defines the algorithm structure, subclasses implement specific steps
2. **Dependency Injection**: Modules are loaded dynamically for better testability
3. **Event-Driven Architecture**: Extensible message handling with action-based routing
4. **Resource Management**: Comprehensive cleanup and memory management
5. **Error Recovery**: Graceful degradation and retry mechanisms

## Class Hierarchy

```
BaseContentScript (abstract)
├── Common functionality (80% of code)
├── Abstract methods for platform-specific behavior
├── Template methods for initialization flow
└── Extensible message handling system

NetflixContentScript extends BaseContentScript
├── Netflix-specific configurations
├── Enhanced SPA navigation detection
└── Netflix injection parameters

DisneyPlusContentScript extends BaseContentScript
├── Disney+ specific configurations
├── Standard navigation detection
└── Disney+ injection parameters
```

## Initialization Flow

The initialization follows a strict template method pattern:

```javascript
async initialize() {
    // Step 1: Initialize core modules
    await this.initializeCore()
        └── loadModules()
            ├── _loadSubtitleUtilities()
            ├── _loadPlatformClass()
            ├── _loadConfigService()
            └── _loadAndInitializeLogger()

    // Step 2: Initialize configuration
    await this.initializeConfiguration()
        ├── Load configuration from configService
        ├── Normalize configuration
        └── Setup configuration listeners

    // Step 3: Initialize event handling
    await this.initializeEventHandling()
        ├── Setup early event handling
        └── Initialize platform (if subtitles enabled)

    // Step 4: Initialize observers
    await this.initializeObservers()
        ├── Setup navigation detection (platform-specific)
        ├── Setup DOM observation
        └── Setup cleanup handlers
}
```

## Abstract Method Contracts

Platform-specific classes must implement these abstract methods:

### Required Methods

```javascript
/**
 * Get the platform name (e.g., 'netflix', 'disneyplus')
 * @returns {string} Platform name
 */
getPlatformName()

/**
 * Get the platform class constructor name
 * @returns {string} Platform class name (e.g., 'NetflixPlatform')
 */
getPlatformClass()

/**
 * Get the inject script configuration
 * @returns {Object} Inject script configuration
 */
getInjectScriptConfig()

/**
 * Setup platform-specific navigation detection
 */
setupNavigationDetection()

/**
 * Check for URL changes (platform-specific implementation)
 */
checkForUrlChange()

/**
 * Handle platform-specific Chrome messages
 * @param {Object} request - Chrome message request
 * @param {Function} sendResponse - Response callback
 * @returns {boolean} Whether response is handled asynchronously
 */
handlePlatformSpecificMessage(request, sendResponse)
```

## Message Handling System

The architecture includes an extensible message handling system:

### Message Handler Registry

```javascript
// Register a message handler
registerMessageHandler(action, handler, options)

// Common handlers are automatically registered:
// - 'toggleSubtitles': Toggle subtitle display
// - 'configChanged': Handle configuration changes
// - 'LOGGING_LEVEL_CHANGED': Update logging level
```

### Handler Configuration

```javascript
const handlerConfig = {
    handler: Function,              // Handler function
    requiresUtilities: boolean,     // Whether utilities must be loaded
    description: string,            // Handler description
    registeredAt: string           // Registration timestamp
}
```

## Navigation Detection Strategies

Different platforms require different navigation detection approaches:

### Netflix (Complex SPA)
- Interval-based URL checking (fallback)
- History API interception (pushState/replaceState)
- Browser navigation events (popstate, hashchange)
- Focus and visibility events
- Enhanced page transition handling

### Disney+ (Standard SPA)
- Similar to Netflix but with simpler URL patterns
- Player page detection for multiple URL patterns
- Standard page transition handling

## Resource Management

### Cleanup System

The architecture includes comprehensive resource management:

```javascript
// AbortController for event listener cleanup
this.abortController = new AbortController()

// Interval management
this.intervalManager = new IntervalManager()

// Event listener tracking
this.eventListenerCleanupFunctions = []
this.domObserverCleanupFunctions = []
```

### Memory Management

- Automatic cleanup on page navigation
- Proper disposal of event listeners
- Resource pooling for repeated operations
- Weak references where appropriate

## Error Handling

### Graceful Degradation

1. **Module Loading Failures**: Fallback to console logging
2. **Platform Initialization Errors**: Clean up and retry with backoff
3. **Video Detection Timeouts**: Continue with limited functionality
4. **Navigation Detection Failures**: Fall back to interval-based checking
5. **Extension Context Invalidation**: Clean up all listeners

### Retry Mechanisms

```javascript
// Platform initialization with retry
const retryConfig = {
    maxRetries: 3,
    retryDelay: 1000,
    backoffMultiplier: 2
}
```

## Configuration System

### Configuration Loading

```javascript
// Load configuration from configService
this.currentConfig = await this.configService.getAll()

// Normalize configuration
this._normalizeConfiguration()

// Setup change listeners
this.setupConfigurationListeners()
```

### Platform-Specific Overrides

```javascript
// Netflix-specific configuration
getNetflixSpecificConfig() {
    return {
        maxVideoDetectionRetries: 40,
        videoDetectionInterval: 1000,
        urlChangeCheckInterval: 2000,
        pageTransitionDelay: 1500
    }
}
```

## Event System

### Event Buffering

Early events are buffered until platform initialization:

```javascript
this.eventBuffer = new EventBuffer(logger)

// Buffer events before platform is ready
this.eventBuffer.add(eventData)

// Process buffered events after initialization
this.eventBuffer.processAll(handler)
```

### Event Listener Management

```javascript
// Add event listener with cleanup tracking
const options = this.abortController ? 
    { signal: this.abortController.signal } : {}
window.addEventListener('event', handler, options)
```

## Testing Architecture

### Test Structure

```javascript
// Unit tests for BaseContentScript
BaseContentScript.test.js
├── Mock platform-specific methods
├── Test common functionality
├── Verify template method execution
└── Test error handling

// Platform-specific tests
NetflixContentScript.test.js
├── Test concrete implementations
├── Verify platform configurations
├── Test navigation detection
└── Mock Chrome APIs
```

### Mock Infrastructure

- `test-utils/chrome-api-mock.js`: Chrome API mocking
- `test-utils/test-helpers.js`: Centralized mock management
- `test-utils/logger-mock.js`: Logger mocking
- `test-utils/test-fixtures.js`: Standardized test data

## Performance Considerations

### Initialization Optimization

- Lazy loading of non-critical modules
- Parallel module loading where possible
- Efficient video element detection
- Minimal DOM manipulation during setup

### Runtime Performance

- Debounced event handlers
- Efficient navigation detection
- Optimized subtitle update cycles
- Minimal memory allocations in hot paths

### Memory Management

- Proper cleanup of event listeners
- Weak references for circular references
- Resource pooling for repeated operations
- Garbage collection friendly patterns

## Extension Points

### Adding New Platforms

1. Extend BaseContentScript
2. Implement abstract methods
3. Add platform-specific configuration
4. Create entry point
5. Update manifest.json

### Adding New Message Types

```javascript
// Register custom message handler
this.registerMessageHandler('customAction', this.handleCustomAction.bind(this), {
    requiresUtilities: true,
    description: 'Handle custom platform action'
})
```

### Adding New Utilities

```javascript
// Add to shared utilities
content_scripts/shared/customUtils.js

// Import in BaseContentScript or platform classes
import { customUtility } from '../shared/customUtils.js'
```

## Migration Strategy

### Backward Compatibility

- Maintain existing Chrome message API
- Preserve all current functionality
- Keep identical user experience
- Maintain configuration compatibility

### Rollback Plan

- Keep original files as `.backup`
- Feature flags for gradual rollout
- Comprehensive testing before deployment
- Quick rollback mechanism

## Security Considerations

### Content Script Isolation

- Proper module loading with Chrome extension URLs
- Secure message passing between contexts
- Input validation for all external data
- Safe DOM manipulation practices

### Extension Context Management

- Handle extension context invalidation gracefully
- Proper cleanup on context loss
- Secure communication with background script
- Validate all Chrome API calls