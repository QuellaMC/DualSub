# Content Scripts API Reference

## BaseContentScript

The abstract base class that provides common functionality for all platform content scripts.

### Constructor

```javascript
/**
 * Creates a new BaseContentScript instance
 * @param {string} logPrefix - The log prefix for this content script (e.g., 'NetflixContent')
 * @throws {Error} If instantiated directly (abstract class)
 */
constructor(logPrefix)
```

### Abstract Methods

These methods must be implemented by all subclasses:

#### getPlatformName()

```javascript
/**
 * Get the platform name (e.g., 'netflix', 'disneyplus')
 * @abstract
 * @returns {string} Platform name
 * @throws {Error} If not implemented by subclass
 */
getPlatformName()
```

#### getPlatformClass()

```javascript
/**
 * Get the platform class constructor name
 * @abstract
 * @returns {string} Platform class name (e.g., 'NetflixPlatform')
 * @throws {Error} If not implemented by subclass
 */
getPlatformClass()
```

#### getInjectScriptConfig()

```javascript
/**
 * Get the inject script configuration
 * @abstract
 * @returns {Object} Inject script configuration
 * @returns {string} returns.filename - Path to inject script
 * @returns {string} returns.tagId - DOM element ID for script tag
 * @returns {string} returns.eventId - Custom event ID for communication
 * @throws {Error} If not implemented by subclass
 */
getInjectScriptConfig()
```

#### setupNavigationDetection()

```javascript
/**
 * Setup platform-specific navigation detection
 * @abstract
 * @throws {Error} If not implemented by subclass
 */
setupNavigationDetection()
```

#### checkForUrlChange()

```javascript
/**
 * Check for URL changes (platform-specific implementation)
 * @abstract
 * @throws {Error} If not implemented by subclass
 */
checkForUrlChange()
```

#### handlePlatformSpecificMessage()

```javascript
/**
 * Handle platform-specific Chrome messages
 * @abstract
 * @param {Object} request - Chrome message request
 * @param {Function} sendResponse - Response callback
 * @returns {boolean} Whether response is handled asynchronously
 * @throws {Error} If not implemented by subclass
 */
handlePlatformSpecificMessage(request, sendResponse)
```

### Template Methods

These methods orchestrate the initialization flow and should not be overridden:

#### initialize()

```javascript
/**
 * Main initialization method - template method pattern
 * Orchestrates the complete initialization flow
 * @returns {Promise<boolean>} Success status
 */
async initialize()
```

#### initializeCore()

```javascript
/**
 * Initialize core modules and services
 * @returns {Promise<boolean>} Success status
 */
async initializeCore()
```

#### initializeConfiguration()

```javascript
/**
 * Initialize configuration and listeners
 * @returns {Promise<boolean>} Success status
 */
async initializeConfiguration()
```

#### initializeEventHandling()

```javascript
/**
 * Initialize event handling and platform
 * @returns {Promise<boolean>} Success status
 */
async initializeEventHandling()
```

#### initializeObservers()

```javascript
/**
 * Initialize observers and cleanup handlers
 * @returns {Promise<boolean>} Success status
 */
async initializeObservers()
```

### Module Loading Methods

#### loadModules()

```javascript
/**
 * Load required modules dynamically
 * @returns {Promise<boolean>} Success status
 */
async loadModules()
```

### Platform Management Methods

#### initializePlatform()

```javascript
/**
 * Initialize the platform instance with error handling and retry logic
 * @param {number} retryCount - Current retry attempt (internal use)
 * @returns {Promise<boolean>} Success status
 */
async initializePlatform(retryCount = 0)
```

### Message Handling Methods

#### registerMessageHandler()

```javascript
/**
 * Register a message handler for a specific action/type
 * @param {string} action - The action or type to handle
 * @param {Function} handler - Handler function (request, sendResponse) => boolean
 * @param {Object} options - Optional configuration
 * @param {boolean} options.requiresUtilities - Whether handler requires utilities (default: true)
 * @param {string} options.description - Description of handler
 * @throws {Error} If action is not a string or handler is not a function
 */
registerMessageHandler(action, handler, options = {})
```

#### unregisterMessageHandler()

```javascript
/**
 * Unregister a message handler
 * @param {string} action - The action or type to unregister
 * @returns {boolean} Whether a handler was actually removed
 */
unregisterMessageHandler(action)
```

#### hasMessageHandler()

```javascript
/**
 * Check if a message handler is registered for a specific action
 * @param {string} action - The action to check
 * @returns {boolean} Whether a handler is registered
 */
hasMessageHandler(action)
```

#### getRegisteredHandlers()

```javascript
/**
 * Get information about registered message handlers
 * @returns {Array<Object>} Array of handler information
 */
getRegisteredHandlers()
```

#### handleChromeMessage()

```javascript
/**
 * Handle incoming Chrome messages with extensible action-based routing
 * @param {Object} request - Chrome message request
 * @param {Object} sender - Message sender information
 * @param {Function} sendResponse - Response callback
 * @returns {boolean} Whether response is handled asynchronously
 */
handleChromeMessage(request, sender, sendResponse)
```

### Common Message Handlers

These handlers are automatically registered by BaseContentScript:

#### handleToggleSubtitles()

```javascript
/**
 * Handle toggle subtitles message
 * @param {Object} request - Chrome message request
 * @param {Function} sendResponse - Response callback
 * @returns {Promise<boolean>} Async handling indicator
 */
async handleToggleSubtitles(request, sendResponse)
```

#### handleConfigChanged()

```javascript
/**
 * Handle configuration change message
 * @param {Object} request - Chrome message request
 * @param {Function} sendResponse - Response callback
 * @returns {Promise<boolean>} Async handling indicator
 */
async handleConfigChanged(request, sendResponse)
```

#### handleLoggingLevelChanged()

```javascript
/**
 * Handle logging level change message
 * @param {Object} request - Chrome message request
 * @param {Function} sendResponse - Response callback
 * @returns {boolean} Sync handling indicator
 */
handleLoggingLevelChanged(request, sendResponse)
```

### Utility Methods

#### logWithFallback()

```javascript
/**
 * Log with fallback to console if logger not available
 * @param {string} level - Log level (error, warn, info, debug)
 * @param {string} message - Log message
 * @param {Object} data - Additional data to log
 */
logWithFallback(level, message, data = {})
```

### Cleanup Methods

#### cleanup()

```javascript
/**
 * Cleanup resources and event listeners
 * @returns {Promise<void>}
 */
async cleanup()
```

### Properties

#### Core Properties

```javascript
this.logPrefix          // String: Log prefix for this instance
this.contentLogger      // Object: Logger instance (null until loaded)
this.activePlatform     // Object: Active platform instance
this.currentConfig      // Object: Current configuration
```

#### Module References

```javascript
this.subtitleUtils      // Object: Subtitle utilities module
this.PlatformClass      // Function: Platform class constructor
this.configService      // Object: Configuration service instance
```

#### State Properties

```javascript
this.platformReady      // Boolean: Whether platform is ready
this.isCleanedUp        // Boolean: Whether cleanup has been performed
this.currentUrl         // String: Current page URL
this.lastKnownPathname  // String: Last known pathname
```

#### Management Objects

```javascript
this.eventBuffer        // EventBuffer: Early event buffering
this.intervalManager    // IntervalManager: Interval management
this.messageHandlers    // Map: Registered message handlers
this.abortController    // AbortController: Event listener cleanup
```

## NetflixContentScript

Netflix-specific implementation extending BaseContentScript.

### Constructor

```javascript
/**
 * Creates a new NetflixContentScript instance
 */
constructor()
```

### Abstract Method Implementations

#### getPlatformName()

```javascript
/**
 * Get the platform name
 * @returns {string} 'netflix'
 */
getPlatformName()
```

#### getPlatformClass()

```javascript
/**
 * Get the platform class constructor name
 * @returns {string} 'NetflixPlatform'
 */
getPlatformClass()
```

#### getInjectScriptConfig()

```javascript
/**
 * Get the inject script configuration
 * @returns {Object} Netflix injection configuration
 */
getInjectScriptConfig()
```

#### setupNavigationDetection()

```javascript
/**
 * Setup Netflix-specific navigation detection
 * Uses multiple detection strategies for complex SPA routing
 */
setupNavigationDetection()
```

#### checkForUrlChange()

```javascript
/**
 * Check for URL changes with Netflix-specific logic
 * Enhanced detection with extension context error handling
 */
checkForUrlChange()
```

#### handlePlatformSpecificMessage()

```javascript
/**
 * Handle Netflix-specific Chrome messages
 * @param {Object} request - Chrome message request
 * @param {Function} sendResponse - Response callback
 * @returns {boolean} Whether response is handled asynchronously
 */
handlePlatformSpecificMessage(request, sendResponse)
```

### Netflix-Specific Methods

#### isPlatformActive()

```javascript
/**
 * Check if current page is a Netflix platform page
 * @returns {boolean} Whether we're on Netflix
 */
isPlatformActive()
```

#### isPlayerPageActive()

```javascript
/**
 * Check if current page is a Netflix player page
 * @returns {boolean} Whether we're on a Netflix player page
 */
isPlayerPageActive()
```

#### getUrlPatterns()

```javascript
/**
 * Get Netflix-specific URL patterns for platform detection
 * @returns {string[]} Array of URL patterns
 */
getUrlPatterns()
```

#### getNetflixSpecificConfig()

```javascript
/**
 * Get Netflix-specific configuration defaults
 * @returns {Object} Netflix-specific configuration
 */
getNetflixSpecificConfig()
```

#### applyNetflixConfigOverrides()

```javascript
/**
 * Apply Netflix-specific configuration overrides
 * @param {Object} baseConfig - Base configuration
 * @returns {Object} Configuration with Netflix-specific overrides
 */
applyNetflixConfigOverrides(baseConfig)
```

### Netflix-Specific Properties

```javascript
this.injectConfig       // Object: Netflix injection configuration
this.urlPatterns        // Array: Netflix URL patterns
```

## DisneyPlusContentScript

Disney+ specific implementation extending BaseContentScript.

### Constructor

```javascript
/**
 * Creates a new DisneyPlusContentScript instance
 */
constructor()
```

### Abstract Method Implementations

#### getPlatformName()

```javascript
/**
 * Get the platform name
 * @returns {string} 'disneyplus'
 */
getPlatformName()
```

#### getPlatformClass()

```javascript
/**
 * Get the platform class constructor name
 * @returns {string} 'DisneyPlusPlatform'
 */
getPlatformClass()
```

#### getInjectScriptConfig()

```javascript
/**
 * Get the inject script configuration
 * @returns {Object} Disney+ injection configuration
 */
getInjectScriptConfig()
```

#### setupNavigationDetection()

```javascript
/**
 * Setup Disney+ specific navigation detection
 * Uses standard navigation detection strategies
 */
setupNavigationDetection()
```

#### checkForUrlChange()

```javascript
/**
 * Check for URL changes with Disney+ specific logic
 * Enhanced detection with extension context error handling
 */
checkForUrlChange()
```

#### handlePlatformSpecificMessage()

```javascript
/**
 * Handle Disney+ specific Chrome messages
 * @param {Object} request - Chrome message request
 * @param {Function} sendResponse - Response callback
 * @returns {boolean} Whether response is handled asynchronously
 */
handlePlatformSpecificMessage(request, sendResponse)
```

### Disney+ Specific Methods

#### getDisneyPlusSpecificConfig()

```javascript
/**
 * Get Disney+ specific configuration defaults
 * @returns {Object} Disney+ specific configuration
 */
getDisneyPlusSpecificConfig()
```

#### applyDisneyPlusConfigOverrides()

```javascript
/**
 * Apply Disney+ specific configuration overrides
 * @param {Object} baseConfig - Base configuration
 * @returns {Object} Configuration with Disney+ specific overrides
 */
applyDisneyPlusConfigOverrides(baseConfig)
```

### Disney+ Specific Properties

```javascript
this.injectConfig       // Object: Disney+ injection configuration
this.urlPatterns        // Array: Disney+ URL patterns
```

## Utility Classes

### EventBuffer

```javascript
/**
 * Buffer events until platform is ready
 * @param {Function} logger - Logger function
 */
class EventBuffer {
    add(eventData)          // Add event to buffer
    processAll(handler)     // Process all buffered events
    clear()                 // Clear buffer
    size()                  // Get buffer size
}
```

### IntervalManager

```javascript
/**
 * Manage intervals with automatic cleanup
 */
class IntervalManager {
    set(name, callback, interval)   // Set named interval
    clear(name)                     // Clear specific interval
    clearAll()                      // Clear all intervals
    has(name)                       // Check if interval exists
}
```

## Constants

### COMMON_CONSTANTS

```javascript
const COMMON_CONSTANTS = {
    MAX_VIDEO_DETECTION_RETRIES: 30,
    VIDEO_DETECTION_INTERVAL: 1000,
    PLATFORM_INIT_MAX_RETRIES: 3,
    PLATFORM_INIT_RETRY_DELAY: 1000,
    CONFIG_CHANGE_DEBOUNCE_DELAY: 100,
    MESSAGE_HANDLER_TIMEOUT: 5000
}
```

## Error Types

### Common Errors

- `Error('BaseContentScript is abstract and cannot be instantiated directly')`
- `Error('{method}() must be implemented by subclass')`
- `Error('Action must be a non-empty string')`
- `Error('Handler must be a function')`

### Platform Errors

- Module loading failures
- Platform initialization failures
- Video detection timeouts
- Navigation detection failures
- Extension context invalidation

## Message Format

### Standard Message Format

```javascript
{
    action: string,         // Action type (e.g., 'toggleSubtitles')
    data: Object,          // Optional data payload
    timestamp: number,     // Message timestamp
    source: string         // Message source identifier
}
```

### Response Format

```javascript
{
    success: boolean,      // Operation success status
    data: Object,         // Response data
    error: string,        // Error message (if success: false)
    platform: string,     // Platform identifier
    handled: boolean      // Whether message was handled
}
```