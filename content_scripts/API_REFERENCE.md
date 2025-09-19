# Content Scripts API Reference

This document provides a comprehensive API reference for the content script architecture,
detailing the `BaseContentScript` class, its abstract methods, platform-specific
implementations, and related utility classes.

## BaseContentScript

The abstract base class that provides common functionality for all platform content scripts.

### Constructor

```javascript
/**
 * Creates a new BaseContentScript instance.
 * @param {string} logPrefix - The log prefix for this content script (e.g., 'NetflixContent').
 * @throws {Error} If instantiated directly, as this is an abstract class.
 */
constructor(logPrefix);
```

### Abstract Methods

These methods must be implemented by all subclasses to provide platform-specific behavior.

#### getPlatformName()

```javascript
/**
 * Gets the platform name (e.g., 'netflix', 'disneyplus').
 * @abstract
 * @returns {string} The platform name.
 * @throws {Error} If not implemented by the subclass.
 */
getPlatformName();
```

#### getPlatformClass()

```javascript
/**
 * Gets the platform class constructor name.
 * @abstract
 * @returns {string} The platform class name (e.g., 'NetflixPlatform').
 * @throws {Error} If not implemented by the subclass.
 */
getPlatformClass();
```

#### getInjectScriptConfig()

```javascript
/**
 * Gets the inject script configuration.
 * @abstract
 * @returns {Object} The inject script configuration.
 * @property {string} filename - The path to the inject script.
 * @property {string} tagId - The DOM element ID for the script tag.
 * @property {string} eventId - The custom event ID for communication.
 * @throws {Error} If not implemented by the subclass.
 */
getInjectScriptConfig();
```

#### setupNavigationDetection()

```javascript
/**
 * Sets up platform-specific navigation detection.
 * @abstract
 * @throws {Error} If not implemented by the subclass.
 */
setupNavigationDetection();
```

#### checkForUrlChange()

```javascript
/**
 * Checks for URL changes with platform-specific logic.
 * @abstract
 * @throws {Error} If not implemented by the subclass.
 */
checkForUrlChange();
```

#### handlePlatformSpecificMessage()

```javascript
/**
 * Handles platform-specific Chrome messages.
 * @abstract
 * @param {Object} request - The Chrome message request.
 * @param {Function} sendResponse - The callback to send a response.
 * @returns {boolean} `true` if the response is sent asynchronously.
 * @throws {Error} If not implemented by the subclass.
 */
handlePlatformSpecificMessage(request, sendResponse);
```

### Template Methods

These methods orchestrate the initialization flow and should not be overridden.

#### initialize()

```javascript
/**
 * The main initialization method, following the template method pattern.
 * Orchestrates the complete initialization flow.
 * @returns {Promise<boolean>} A promise that resolves to `true` on success.
 */
async initialize()
```

#### initializeCore()

```javascript
/**
 * Initializes core modules and services.
 * @returns {Promise<boolean>} A promise that resolves to `true` on success.
 */
async initializeCore()
```

#### initializeConfiguration()

```javascript
/**
 * Initializes configuration and sets up listeners for changes.
 * @returns {Promise<boolean>} A promise that resolves to `true` on success.
 */
async initializeConfiguration()
```

#### initializeEventHandling()

```javascript
/**
 * Initializes event handling and the platform-specific implementation.
 * @returns {Promise<boolean>} A promise that resolves to `true` on success.
 */
async initializeEventHandling()
```

#### initializeObservers()

```javascript
/**
 * Initializes observers and cleanup handlers.
 * @returns {Promise<boolean>} A promise that resolves to `true` on success.
 */
async initializeObservers()
```

### Module Loading Methods

#### loadModules()

```javascript
/**
 * Loads required modules dynamically.
 * @returns {Promise<boolean>} A promise that resolves to `true` on success.
 */
async loadModules()
```

### Platform Management Methods

#### initializePlatform()

```javascript
/**
 * Initializes the platform instance with error handling and retry logic.
 * @param {number} [retryCount=0] - The current retry attempt (for internal use).
 * @returns {Promise<boolean>} A promise that resolves to `true` on success.
 */
async initializePlatform(retryCount = 0)
```

### Message Handling Methods

#### registerMessageHandler()

```javascript
/**
 * Registers a message handler for a specific action.
 * @param {string} action - The action or type to handle.
 * @param {Function} handler - The handler function: `(request, sendResponse) => boolean`.
 * @param {Object} [options] - Optional configuration.
 * @param {boolean} [options.requiresUtilities=true] - `true` if the handler requires utilities to be loaded.
 * @param {string} [options.description] - A description of the handler.
 * @throws {Error} If the action is not a string or the handler is not a function.
 */
registerMessageHandler(action, handler, (options = {}));
```

#### unregisterMessageHandler()

```javascript
/**
 * Unregisters a message handler.
 * @param {string} action - The action or type to unregister.
 * @returns {boolean} `true` if a handler was removed.
 */
unregisterMessageHandler(action);
```

#### hasMessageHandler()

```javascript
/**
 * Checks if a message handler is registered for a specific action.
 * @param {string} action - The action to check.
 * @returns {boolean} `true` if a handler is registered.
 */
hasMessageHandler(action);
```

#### getRegisteredHandlers()

```javascript
/**
 * Gets information about all registered message handlers.
 * @returns {Array<Object>} An array of handler information objects.
 */
getRegisteredHandlers();
```

#### handleChromeMessage()

```javascript
/**
 * Handles incoming Chrome messages with extensible, action-based routing.
 * @param {Object} request - The Chrome message request.
 * @param {Object} sender - Information about the message sender.
 * @param {Function} sendResponse - The callback to send a response.
 * @returns {boolean} `true` if the response is sent asynchronously.
 */
handleChromeMessage(request, sender, sendResponse);
```

### Common Message Handlers

These handlers are automatically registered by `BaseContentScript`.

#### handleToggleSubtitles()

```javascript
/**
 * Handles the 'toggleSubtitles' message.
 * @param {Object} request - The Chrome message request.
 * @param {Function} sendResponse - The callback to send a response.
 * @returns {Promise<boolean>} `true` if the response is sent asynchronously.
 */
async handleToggleSubtitles(request, sendResponse)
```

#### handleConfigChanged()

```javascript
/**
 * Handles the 'configChanged' message.
 * @param {Object} request - The Chrome message request.
 * @param {Function} sendResponse - The callback to send a response.
 * @returns {Promise<boolean>} `true` if the response is sent asynchronously.
 */
async handleConfigChanged(request, sendResponse)
```

#### handleLoggingLevelChanged()

```javascript
/**
 * Handles the 'LOGGING_LEVEL_CHANGED' message.
 * @param {Object} request - The Chrome message request.
 * @param {Function} sendResponse - The callback to send a response.
 * @returns {boolean} `true` if the response is sent asynchronously.
 */
handleLoggingLevelChanged(request, sendResponse);
```

### Utility Methods

#### logWithFallback()

```javascript
/**
 * Logs a message, falling back to the console if the logger is not available.
 * @param {string} level - The log level ('error', 'warn', 'info', 'debug').
 * @param {string} message - The log message.
 * @param {Object} [data] - Additional data to log.
 */
logWithFallback(level, message, (data = {}));
```

### Cleanup Methods

#### cleanup()

```javascript
/**
 * Cleans up resources and event listeners to prevent memory leaks.
 * @returns {Promise<void>}
 */
async cleanup()
```

### Properties

#### Core Properties

```javascript
this.logPrefix; // String: The log prefix for this instance.
this.contentLogger; // Object: The logger instance (null until loaded).
this.activePlatform; // Object: The active platform instance.
this.currentConfig; // Object: The current configuration.
```

#### Module References

```javascript
this.subtitleUtils; // Object: The subtitle utilities module.
this.PlatformClass; // Function: The platform class constructor.
this.configService; // Object: The configuration service instance.
```

#### State Properties

```javascript
this.platformReady; // Boolean: `true` if the platform is ready.
this.isCleanedUp; // Boolean: `true` if cleanup has been performed.
this.currentUrl; // String: The current page URL.
this.lastKnownPathname; // String: The last known pathname.
```

#### Management Objects

```javascript
this.eventBuffer; // EventBuffer: Buffers early events.
this.intervalManager; // IntervalManager: Manages intervals.
this.messageHandlers; // Map: Registered message handlers.
this.abortController; // AbortController: Manages event listener cleanup.
```

## NetflixContentScript

A Netflix-specific implementation that extends `BaseContentScript`.

### Constructor

```javascript
/**
 * Creates a new `NetflixContentScript` instance.
 */
constructor();
```

### Abstract Method Implementations

#### getPlatformName()

```javascript
/**
 * Gets the platform name.
 * @returns {string} Always returns 'netflix'.
 */
getPlatformName();
```

#### getPlatformClass()

```javascript
/**
 * Gets the platform class constructor name.
 * @returns {string} Always returns 'NetflixPlatform'.
 */
getPlatformClass();
```

#### getInjectScriptConfig()

```javascript
/**
 * Gets the inject script configuration for Netflix.
 * @returns {Object} The Netflix injection configuration.
 */
getInjectScriptConfig();
```

#### setupNavigationDetection()

```javascript
/**
 * Sets up Netflix-specific navigation detection, using multiple strategies
 * for complex SPA routing.
 */
setupNavigationDetection();
```

#### checkForUrlChange()

```javascript
/**
 * Checks for URL changes with Netflix-specific logic, including enhanced
 * detection with extension context error handling.
 */
checkForUrlChange();
```

#### handlePlatformSpecificMessage()

```javascript
/**
 * Handles Netflix-specific Chrome messages.
 * @param {Object} request - The Chrome message request.
 * @param {Function} sendResponse - The callback to send a response.
 * @returns {boolean} `true` if the response is sent asynchronously.
 */
handlePlatformSpecificMessage(request, sendResponse);
```

### Netflix-Specific Methods

#### isPlatformActive()

```javascript
/**
 * Checks if the current page is a Netflix platform page.
 * @returns {boolean} `true` if on a Netflix page.
 */
isPlatformActive();
```

#### isPlayerPageActive()

```javascript
/**
 * Checks if the current page is a Netflix player page.
 * @returns {boolean} `true` if on a Netflix player page.
 */
isPlayerPageActive();
```

#### getUrlPatterns()

```javascript
/**
 * Gets Netflix-specific URL patterns for platform detection.
 * @returns {string[]} An array of URL patterns.
 */
getUrlPatterns();
```

#### getNetflixSpecificConfig()

```javascript
/**
 * Gets Netflix-specific configuration defaults.
 * @returns {Object} The Netflix-specific configuration.
 */
getNetflixSpecificConfig();
```

#### applyNetflixConfigOverrides()

```javascript
/**
 * Applies Netflix-specific configuration overrides to a base configuration.
 * @param {Object} baseConfig - The base configuration.
 * @returns {Object} The configuration with Netflix-specific overrides.
 */
applyNetflixConfigOverrides(baseConfig);
```

### Netflix-Specific Properties

```javascript
this.injectConfig; // Object: The Netflix injection configuration.
this.urlPatterns; // Array: Netflix URL patterns.
```

## DisneyPlusContentScript

A Disney+-specific implementation that extends `BaseContentScript`.

### Constructor

```javascript
/**
 * Creates a new `DisneyPlusContentScript` instance.
 */
constructor();
```

### Abstract Method Implementations

#### getPlatformName()

```javascript
/**
 * Gets the platform name.
 * @returns {string} Always returns 'disneyplus'.
 */
getPlatformName();
```

#### getPlatformClass()

```javascript
/**
 * Gets the platform class constructor name.
 * @returns {string} Always returns 'DisneyPlusPlatform'.
 */
getPlatformClass();
```

#### getInjectScriptConfig()

```javascript
/**
 * Gets the inject script configuration for Disney+.
 * @returns {Object} The Disney+ injection configuration.
 */
getInjectScriptConfig();
```

#### setupNavigationDetection()

```javascript
/**
 * Sets up Disney+-specific navigation detection using standard strategies.
 */
setupNavigationDetection();
```

#### checkForUrlChange()

```javascript
/**
 * Checks for URL changes with Disney+-specific logic, including enhanced
 * detection with extension context error handling.
 */
checkForUrlChange();
```

#### handlePlatformSpecificMessage()

```javascript
/**
 * Handles Disney+-specific Chrome messages.
 * @param {Object} request - The Chrome message request.
 * @param {Function} sendResponse - The callback to send a response.
 * @returns {boolean} `true` if the response is sent asynchronously.
 */
handlePlatformSpecificMessage(request, sendResponse);
```

### Disney+ Specific Methods

#### getDisneyPlusSpecificConfig()

```javascript
/**
 * Gets Disney+-specific configuration defaults.
 * @returns {Object} The Disney+-specific configuration.
 */
getDisneyPlusSpecificConfig();
```

#### applyDisneyPlusConfigOverrides()

```javascript
/**
 * Applies Disney+-specific configuration overrides to a base configuration.
 * @param {Object} baseConfig - The base configuration.
 * @returns {Object} The configuration with Disney+-specific overrides.
 */
applyDisneyPlusConfigOverrides(baseConfig);
```

### Disney+ Specific Properties

```javascript
this.injectConfig; // Object: The Disney+ injection configuration.
this.urlPatterns; // Array: Disney+ URL patterns.
```

## Utility Classes

### EventBuffer

```javascript
/**
 * Buffers events until the platform is ready to process them.
 * @param {Function} logger - A logger function.
 */
class EventBuffer {
    add(eventData);      // Adds an event to the buffer.
    processAll(handler); // Processes all buffered events.
    clear();             // Clears the buffer.
    size();              // Gets the buffer size.
}
```

### IntervalManager

```javascript
/**
 * Manages intervals with automatic cleanup to prevent memory leaks.
 */
class IntervalManager {
    set(name, callback, interval); // Sets a named interval.
    clear(name);                   // Clears a specific interval.
    clearAll();                    // Clears all intervals.
    has(name);                     // Checks if an interval exists.
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
    MESSAGE_HANDLER_TIMEOUT: 5000,
};
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
    "action": "actionType",      // e.g., 'toggleSubtitles'
    "data": { /* payload */ },   // Optional data payload
    "timestamp": 1629876543210,
    "source": "sourceIdentifier" // e.g., 'popup'
}
```

### Response Format

```javascript
{
    "success": true,
    "data": { /* response data */ },
    "error": null,
    "platform": "platformName",
    "handled": true
}
```

## Messaging Utilities

The shared messaging module provides resilient wrappers around Chrome's runtime messaging with automatic retries and MV3 service worker wake-up.

- Location: `content_scripts/shared/messaging.js`

### Exports

- `rawSendMessage(message): Promise<any>`
  - Thin wrapper around `chrome.runtime.sendMessage`
  - Prefers the promise form when available; falls back to callback style when supported
  - Surfaces `chrome.runtime.lastError` as an `Error`

- `sendRuntimeMessageWithRetry(message, options?): Promise<any>`
  - Retries on transient connection errors (e.g., "Could not establish connection. Receiving end does not exist.", "The message port closed before a response was received.", "No matching service worker for this scope.", "Extension context invalidated.")
  - Options:
    - `retries` (default: 3)
    - `baseDelayMs` (default: 100)
    - `backoffFactor` (default: 2)
    - `pingBeforeRetry` (default: true) — attempts `CHECK_BACKGROUND_READY` and then `PING` to wake the background before retrying

### Example

```javascript
import { sendRuntimeMessageWithRetry } from '../shared/messaging.js';
import { MessageActions } from '../shared/constants/messageActions.js';

async function ensureBackgroundReady() {
    const response = await sendRuntimeMessageWithRetry(
        { action: MessageActions.CHECK_BACKGROUND_READY },
        { retries: 3, baseDelayMs: 100, backoffFactor: 2, pingBeforeRetry: true }
    );
    return response;
}
```

### Typing Notes (JSDoc @ts-check)

This repository uses JSDoc type-checking for plain JS. To avoid TypeScript name errors for the Chrome API without requiring ambient type packages, `messaging.js` uses a local alias that reads from the global object:

```js
// Inside JS files that need Chrome APIs without TS types
const chrome = /** @type {any} */ (globalThis).chrome;
```

For richer IntelliSense in editors, you may optionally install official Chrome types:

```bash
npm i -D chrome-types
```

If installed, files may include a directive like `/// <reference types="chrome" />` to enable those types.

## See Also

- [ARCHITECTURE.md](./ARCHITECTURE.md) - For an overview of the content script architecture.
- [PLATFORM_IMPLEMENTATION_GUIDE.md](./PLATFORM_IMPLEMENTATION_GUIDE.md) - For a guide on adding new platforms.
- [EXAMPLES.md](./EXAMPLES.md) - For practical implementation examples.
