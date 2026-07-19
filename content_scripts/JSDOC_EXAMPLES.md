# JSDoc Documentation Examples

This document provides comprehensive JSDoc documentation examples for implementing
platform-specific content scripts using the `BaseContentScript` architecture.
These examples are designed to serve as a reference for developers contributing to
the extension.

## Table of Contents

1. [Class Documentation](#class-documentation)
2. [Method Documentation](#method-documentation)
3. [Property Documentation](#property-documentation)
4. [Abstract Method Documentation](#abstract-method-documentation)
5. [Event Documentation](#event-documentation)
6. [Configuration Documentation](#configuration-documentation)
7. [Error Documentation](#error-documentation)

## Class Documentation

### Platform Content Script Class

````javascript
/**
 * ExampleContentScript - Example platform-specific content script extending BaseContentScript
 *
 * This class demonstrates how to implement a platform-specific content script that extends
 * BaseContentScript. It provides Example platform-specific functionality including navigation
 * detection and injection configuration while leveraging the common
 * functionality provided by BaseContentScript.
 * Cross-context runtime actions remain in the centralized shared protocol and are not
 * implemented as platform-specific methods.
 *
 * ## Platform-Specific Features
 *
 * - Custom navigation detection for Example platform's SPA routing
 * - Specialized video element detection for Example's player architecture
 * - Optimized configuration for Example's performance characteristics
 *
 * ## Usage
 *
 * ```javascript
 * // Create and initialize the content script
 * const contentScript = new ExampleContentScript();
 * const success = await contentScript.initialize();
 *
 * if (success) {
 *     console.log('Example content script initialized successfully');
 * } else {
 *     console.error('Example content script initialization failed');
 * }
 * ```
 *
 * ## Configuration
 *
 * The Example platform requires specific configuration for optimal performance:
 *
 * ```javascript
 * const exampleConfig = {
 *     maxVideoDetectionRetries: 25,     // Example loads videos slowly
 *     videoDetectionInterval: 1500,     // Check every 1.5 seconds
 *     urlChangeCheckInterval: 1000,     // Example has fast navigation
 *     pageTransitionDelay: 2000         // Example needs time for DOM updates
 * };
 * ```
 *
 * ## Navigation Patterns
 *
 * Example platform uses the following URL patterns:
 * - Player pages: `/watch/*`, `/play/*`, `/stream/*`
 * - Home page: `/`, `/home`, `/dashboard`
 * - Browse pages: `/browse/*`, `/category/*`
 *
 * @extends BaseContentScript
 * @author DualSub Extension
 * @version 1.0.0
 * @since 1.0.0
 *
 * @example
 * // Basic initialization
 * const exampleCS = new ExampleContentScript();
 * await exampleCS.initialize();
 *
 * @example
 * // With custom configuration
 * const exampleCS = new ExampleContentScript();
 * exampleCS.applyExampleConfigOverrides({
 *     maxVideoDetectionRetries: 30,
 *     customFeatureEnabled: true
 * });
 * await exampleCS.initialize();
 *
 */
export class ExampleContentScript extends BaseContentScript {
    /**
     * Creates a new `ExampleContentScript` instance.
     *
     * Initializes the Example platform-specific content script with default configuration
     * and sets up the injection parameters required for Example platform integration.
     *
     * @constructor
     * @example
     * const contentScript = new ExampleContentScript();
     */
    constructor() {
        super('ExampleContent');
        this._initializeExampleSpecificState();
    }
}
````

## Method Documentation

### Abstract Method Implementation

```javascript
/**
 * Get the platform name identifier
 *
 * Returns the lowercase string identifier used throughout the extension to identify
 * this platform. This identifier is used for:
 * - Configuration keys and namespacing
 * - Log message prefixes and filtering
 * - Platform-specific feature toggles
 * - Analytics and error reporting
 *
 * @override
 * @returns {string} The platform identifier 'example'
 *
 * @example
 * const contentScript = new ExampleContentScript();
 * console.log(contentScript.getPlatformName()); // 'example'
 *
 * @example
 * // Used internally for configuration
 * const configKey = `${this.getPlatformName()}_enabled`; // 'example_enabled'
 */
getPlatformName() {
    return 'example';
}

/**
 * Get the platform class constructor name
 *
 * Returns the name of the platform class that will be dynamically loaded from
 * the video_platforms directory. This class must exist and be exported from
 * the corresponding platform file.
 *
 * @override
 * @returns {string} The platform class name 'ExamplePlatform'
 *
 * @throws {Error} If the platform class cannot be found during module loading
 *
 * @example
 * const contentScript = new ExampleContentScript();
 * console.log(contentScript.getPlatformClass()); // 'ExamplePlatform'
 *
 * @example
 * // The class will be loaded from:
 * // video_platforms/examplePlatform.js
 * // and must export: export class ExamplePlatform { ... }
 */
getPlatformClass() {
    return 'ExamplePlatform';
}

/**
 * Get the inject script configuration
 *
 * Returns the configuration object used to inject the platform-specific script
 * into the page context. This script enables deep integration with the platform's
 * video player and subtitle systems.
 *
 * @override
 * @returns {Object} Inject script configuration
 * @returns {string} returns.filename - Path to the inject script relative to extension root
 * @returns {string} returns.tagId - Unique DOM element ID for the script tag
 * @returns {string} returns.eventId - Unique event ID for script communication
 *
 * @example
 * const contentScript = new ExampleContentScript();
 * const config = contentScript.getInjectScriptConfig();
 * console.log(config);
 * // {
 * //   filename: 'injected_scripts/exampleInject.js',
 * //   tagId: 'example-dualsub-injector-script-tag',
 * //   eventId: 'example-dualsub-injector-event'
 * // }
 *
 * @example
 * // The inject script will be loaded as:
 * // <script id="example-dualsub-injector-script-tag"
 * //         src="chrome-extension://[id]/injected_scripts/exampleInject.js">
 * // </script>
 */
getInjectScriptConfig() {
    return {
        filename: 'injected_scripts/exampleInject.js',
        tagId: 'example-dualsub-injector-script-tag',
        eventId: 'example-dualsub-injector-event'
    };
}

/**
 * Configure the Base-owned navigation manager
 *
 * Platform subclasses select documented manager options and provide route
 * classification/transition behavior. Base owns all navigation listeners, timers,
 * manager replacement, URL-change dispatch, and cleanup.
 *
 * @override
 * @throws {Error} If managed navigation setup fails
 *
 * @example
 * // Called automatically during initialization
 * const contentScript = new ExampleContentScript();
 * await contentScript.initialize();
 */
setupNavigationDetection() {
    this._setupNavigationManager({ intervalMs: 1500 });
}

/**
 * Classify Example player routes for the Base-owned manager.
 *
 * @param {string} pathname - URL pathname to classify
 * @returns {boolean} Whether the pathname is a player route
 * @private
 */
_isPlayerPath(pathname) {
    return (
        pathname.includes('/watch/') ||
        pathname.includes('/play/') ||
        pathname.includes('/stream/')
    );
}

/**
 * Handle transitions reported by the Base-owned manager.
 *
 * @param {boolean} wasOnPlayerPage - Whether the prior route was a player route
 * @param {boolean} isOnPlayerPage - Whether the current route is a player route
 * @private
 */
_handlePageTransition(wasOnPlayerPage, isOnPlayerPage) {
    if (wasOnPlayerPage && !isOnPlayerPage) {
        this._cleanupOnPageLeave();
    } else if (!wasOnPlayerPage && isOnPlayerPage) {
        this._initializeOnPageEnter();
    }
}

```

## Property Documentation

### Instance Properties

```javascript
/**
 * @class ExampleContentScript
 * @extends BaseContentScript
 */
export class ExampleContentScript extends BaseContentScript {
    /**
     * Example platform-specific injection configuration
     *
     * Contains the configuration needed to inject the Example platform script
     * into the page context for deep integration with the video player.
     *
     * @type {Object}
     * @property {string} filename - Path to the inject script
     * @property {string} tagId - Unique DOM element ID for the script tag
     * @property {string} eventId - Unique event ID for script communication
     *
     * @example
     * const contentScript = new ExampleContentScript();
     * console.log(contentScript.injectConfig.filename); // 'injected_scripts/exampleInject.js'
     */
    injectConfig = {
        filename: 'injected_scripts/exampleInject.js',
        tagId: 'example-dualsub-injector-script-tag',
        eventId: 'example-dualsub-injector-event',
    };

    /**
     * URL patterns for Example platform detection
     *
     * Array of URL patterns used to identify when the extension is running
     * on the Example platform. Supports wildcard matching.
     *
     * @type {string[]}
     *
     * @example
     * const contentScript = new ExampleContentScript();
     * console.log(contentScript.urlPatterns); // ['*.example.com']
     *
     * @example
     * // Check if current URL matches platform
     * const isExamplePlatform = contentScript.urlPatterns.some(pattern =>
     *     window.location.hostname.match(pattern.replace('*', '.*'))
     * );
     */
    urlPatterns = ['*.example.com'];

    /**
     * Example platform-specific configuration defaults
     *
     * Default configuration values optimized for the Example platform's
     * performance characteristics and behavior patterns.
     *
     * @type {Object}
     * @property {number} maxVideoDetectionRetries - Maximum video detection attempts
     * @property {number} videoDetectionInterval - Interval between detection attempts (ms)
     * @property {number} urlChangeCheckInterval - URL change check interval (ms)
     * @property {number} pageTransitionDelay - Delay after page transitions (ms)
     * @property {number} injectRetryDelay - Delay between injection retries (ms)
     * @property {number} injectMaxRetries - Maximum injection attempts
     *
     * @example
     * const contentScript = new ExampleContentScript();
     * const config = contentScript.getExampleSpecificConfig();
     * console.log(config.maxVideoDetectionRetries); // 25
     */
    exampleSpecificConfig = {
        maxVideoDetectionRetries: 25,
        videoDetectionInterval: 1500,
        urlChangeCheckInterval: 1000,
        pageTransitionDelay: 2000,
        injectRetryDelay: 10,
        injectMaxRetries: 100,
    };
}
```

## Abstract Method Documentation

### Template for Abstract Methods

````javascript
/**
 * Abstract method template for platform identification
 *
 * This method must be implemented by all platform-specific content scripts
 * to provide a unique identifier for the platform.
 *
 * ## Implementation Requirements
 *
 * - Must return a lowercase string
 * - Must be unique across all platforms
 * - Should match the platform's common name
 * - Used for configuration keys and logging
 *
 * ## Common Platform Names
 *
 * - 'netflix' - Netflix streaming platform
 * - 'disneyplus' - Disney+ streaming platform
 * - 'hulu' - Hulu streaming platform
 * - 'amazonprime' - Amazon Prime Video
 * - 'hbomax' - HBO Max streaming platform
 *
 * @abstract
 * @returns {string} Platform identifier (lowercase, unique)
 * @throws {Error} If not implemented by subclass
 *
 * @example
 * // Implementation example
 * getPlatformName() {
 *     return 'myplatform';
 * }
 *
 * @example
 * // Usage in configuration
 * const configKey = `${this.getPlatformName()}_enabled`;
 * const isEnabled = await configService.get(configKey);
 */
getPlatformName() {
    throw new Error('getPlatformName() must be implemented by subclass');
}

/**
 * Abstract method template for platform class identification
 *
 * This method must be implemented to specify which platform class should be
 * dynamically loaded from the video_platforms directory.
 *
 * ## Implementation Requirements
 *
 * - Must return the exact class name as exported from the platform file
 * - Class must exist in video_platforms/{platformName}Platform.js
 * - Class must extend the base platform interface
 * - Class name should follow PascalCase convention
 *
 * ## File Naming Convention
 *
 * - Platform file: `video_platforms/{platformName}Platform.js`
 * - Class name: `{PlatformName}Platform`
 * - Export: `export class {PlatformName}Platform { ... }`
 *
 * @abstract
 * @returns {string} Platform class name (PascalCase)
 * @throws {Error} If not implemented by subclass
 * @throws {Error} If platform class cannot be found during loading
 *
 * @example
 * // Implementation example
 * getPlatformClass() {
 *     return 'MyPlatformPlatform';
 * }
 *
 * @example
 * // Corresponding file structure
 * // video_platforms/myPlatformPlatform.js
 * export class MyPlatformPlatform {
 *     // Platform implementation
 * }
 */
getPlatformClass() {
    throw new Error('getPlatformClass() must be implemented by subclass');
}

/**
 * Abstract method template for injection script configuration
 *
 * This method must be implemented to provide the configuration needed to
 * inject platform-specific scripts into the page context.
 *
 * ## Configuration Object Structure
 *
 * ```javascript
 * {
 *     filename: string,    // Path to inject script (relative to extension root)
 *     tagId: string,       // Unique DOM element ID for script tag
 *     eventId: string      // Unique event ID for script communication
 * }
 * ```
 *
 * ## Implementation Requirements
 *
 * - `filename` must point to existing script in injected_scripts directory
 * - `tagId` must be unique across all platforms to avoid conflicts
 * - `eventId` must be unique for proper event handling
 * - All IDs should include platform name for uniqueness
 *
 * ## Naming Conventions
 *
 * - Filename: `injected_scripts/{platformName}Inject.js`
 * - Tag ID: `{platformName}-dualsub-injector-script-tag`
 * - Event ID: `{platformName}-dualsub-injector-event`
 *
 * @abstract
 * @returns {Object} Injection script configuration
 * @returns {string} returns.filename - Path to inject script
 * @returns {string} returns.tagId - Unique DOM element ID
 * @returns {string} returns.eventId - Unique event ID
 * @throws {Error} If not implemented by subclass
 *
 * @example
 * // Implementation example
 * getInjectScriptConfig() {
 *     return {
 *         filename: 'injected_scripts/myPlatformInject.js',
 *         tagId: 'myplatform-dualsub-injector-script-tag',
 *         eventId: 'myplatform-dualsub-injector-event'
 *     };
 * }
 *
 * @example
 * // Usage in script injection
 * const config = this.getInjectScriptConfig();
 * const script = document.createElement('script');
 * script.src = chrome.runtime.getURL(config.filename);
 * script.id = config.tagId;
 * document.head.appendChild(script);
 */
getInjectScriptConfig() {
    throw new Error('getInjectScriptConfig() must be implemented by subclass');
}
````

## Event Documentation

### Custom Events

```javascript
/**
 * Platform-specific custom events
 *
 * Documents the custom events that can be dispatched and handled by
 * platform-specific content scripts.
 */

/**
 * Subtitle data received event
 *
 * Fired when subtitle data is received from the injected script.
 * This event contains the subtitle text and timing information.
 *
 * @event ExampleContentScript#subtitleDataReceived
 * @type {CustomEvent}
 * @property {Object} detail - Event detail object
 * @property {string} detail.text - Subtitle text content
 * @property {number} detail.startTime - Subtitle start time in seconds
 * @property {number} detail.endTime - Subtitle end time in seconds
 * @property {string} detail.language - Subtitle language code
 * @property {string} detail.source - Data source identifier
 *
 * @example
 * // Listen for subtitle data
 * document.addEventListener('example-subtitle-data', (event) => {
 *     const { text, startTime, endTime, language } = event.detail;
 *     console.log(`Subtitle [${startTime}-${endTime}]: ${text}`);
 * });
 *
 * @example
 * // Dispatch subtitle data (from injected script)
 * const subtitleEvent = new CustomEvent('example-subtitle-data', {
 *     detail: {
 *         text: 'Hello, world!',
 *         startTime: 10.5,
 *         endTime: 13.2,
 *         language: 'en',
 *         source: 'example-player'
 *     }
 * });
 * document.dispatchEvent(subtitleEvent);
 */

/**
 * Player state changed event
 *
 * Fired when the video player state changes (e.g., play, pause, seek).
 * This event is essential for synchronizing the subtitle display with the player's
 * current state and ensuring a seamless user experience.
 *
 * @event ExampleContentScript#playerStateChanged
 * @type {CustomEvent}
 * @property {Object} detail - Event detail object
 * @property {string} detail.state - Player state ('playing', 'paused', 'seeking', 'ended')
 * @property {number} detail.currentTime - Current playback time in seconds
 * @property {number} detail.duration - Total video duration in seconds
 * @property {number} detail.playbackRate - Current playback rate (1.0 = normal speed)
 *
 * @example
 * // Listen for player state changes
 * document.addEventListener('example-player-state', (event) => {
 *     const { state, currentTime, duration } = event.detail;
 *     console.log(`Player ${state} at ${currentTime}/${duration}`);
 * });
 */

/**
 * Navigation event
 *
 * Fired when platform-specific navigation is detected.
 * This event provides information about page transitions.
 *
 * @event ExampleContentScript#navigationDetected
 * @type {CustomEvent}
 * @property {Object} detail - Event detail object
 * @property {string} detail.from - Previous URL
 * @property {string} detail.to - New URL
 * @property {string} detail.fromPath - Previous pathname
 * @property {string} detail.toPath - New pathname
 * @property {boolean} detail.isPlayerPage - Whether new page is a player page
 * @property {string} detail.transitionType - Type of transition ('enter-player', 'exit-player', 'page-change')
 *
 * @example
 * // Listen for navigation events
 * document.addEventListener('example-navigation', (event) => {
 *     const { from, to, transitionType } = event.detail;
 *     console.log(`Navigation: ${from} -> ${to} (${transitionType})`);
 * });
 */
```

## Configuration Documentation

### Configuration Schema

```javascript
/**
 * Platform-specific configuration schema
 *
 * Documents the configuration options available for platform-specific
 * content scripts and their expected types and values.
 */

/**
 * Example platform configuration schema
 *
 * @typedef {Object} ExamplePlatformConfig
 * @property {boolean} enabled - Whether Example platform support is enabled
 * @property {number} maxVideoDetectionRetries - Maximum attempts to detect video element
 * @property {number} videoDetectionInterval - Interval between video detection attempts (ms)
 * @property {number} urlChangeCheckInterval - Interval for URL change detection (ms)
 * @property {number} pageTransitionDelay - Delay after page transitions (ms)
 * @property {boolean} enhancedNavigationDetection - Enable enhanced navigation detection
 * @property {string[]} customPlayerSelectors - Additional CSS selectors for video elements
 * @property {Object} subtitleSettings - Subtitle-specific settings
 * @property {string} subtitleSettings.position - Subtitle position ('top', 'bottom')
 * @property {number} subtitleSettings.fontSize - Font size in pixels
 * @property {string} subtitleSettings.fontFamily - Font family name
 * @property {string} subtitleSettings.backgroundColor - Background color (CSS color)
 * @property {number} subtitleSettings.opacity - Background opacity (0-1)
 *
 * @example
 * // Default configuration
 * const defaultConfig = {
 *     enabled: true,
 *     maxVideoDetectionRetries: 25,
 *     videoDetectionInterval: 1500,
 *     urlChangeCheckInterval: 1000,
 *     pageTransitionDelay: 2000,
 *     enhancedNavigationDetection: true,
 *     customPlayerSelectors: [
 *         '.example-video-player video',
 *         '[data-testid="video-player"]'
 *     ],
 *     subtitleSettings: {
 *         position: 'bottom',
 *         fontSize: 16,
 *         fontFamily: 'Arial, sans-serif',
 *         backgroundColor: 'rgba(0, 0, 0, 0.8)',
 *         opacity: 0.9
 *     }
 * };
 *
 * @example
 * // Configuration validation
 * function validateExampleConfig(config) {
 *     const errors = [];
 *
 *     if (typeof config.enabled !== 'boolean') {
 *         errors.push('enabled must be a boolean');
 *     }
 *
 *     if (!Number.isInteger(config.maxVideoDetectionRetries) || config.maxVideoDetectionRetries < 1) {
 *         errors.push('maxVideoDetectionRetries must be a positive integer');
 *     }
 *
 *     if (!Number.isInteger(config.videoDetectionInterval) || config.videoDetectionInterval < 100) {
 *         errors.push('videoDetectionInterval must be at least 100ms');
 *     }
 *
 *     return errors;
 * }
 */

/**
 * Apply platform-specific configuration overrides
 *
 * Merges platform-specific configuration with base configuration,
 * ensuring platform-specific values take precedence.
 *
 * @param {Object} baseConfig - Base configuration object
 * @returns {Object} Configuration with platform-specific overrides applied
 *
 * @example
 * // Apply Example platform overrides
 * applyExampleConfigOverrides(baseConfig) {
 *     const exampleConfig = this.getExampleSpecificConfig();
 *
 *     return {
 *         ...baseConfig,
 *         ...exampleConfig,
 *         // Ensure platform-specific values take precedence
 *         platformName: this.getPlatformName(),
 *         injectConfig: this.getInjectScriptConfig(),
 *         urlPatterns: this.urlPatterns
 *     };
 * }
 */
```

## Error Documentation

### Error Types and Handling

```javascript
/**
 * Platform-specific error types and handling strategies
 *
 * Documents the types of errors that can occur in platform-specific
 * content scripts and how they should be handled.
 */

/**
 * Platform initialization error
 *
 * Thrown when platform-specific initialization fails.
 * This can occur due to missing dependencies, network issues,
 * or platform-specific API changes.
 *
 * @class PlatformInitializationError
 * @extends Error
 * @property {string} name - Error name 'PlatformInitializationError'
 * @property {string} message - Error description
 * @property {string} platform - Platform identifier
 * @property {string} phase - Initialization phase where error occurred
 * @property {Error} [cause] - Original error that caused this error
 *
 * @example
 * // Throwing a platform initialization error
 * throw new PlatformInitializationError(
 *     'Failed to load Example platform class',
 *     'example',
 *     'module-loading',
 *     originalError
 * );
 *
 * @example
 * // Handling platform initialization errors
 * try {
 *     await contentScript.initialize();
 * } catch (error) {
 *     if (error instanceof PlatformInitializationError) {
 *         console.error(`Platform ${error.platform} failed to initialize in ${error.phase}:`, error.message);
 *         // Attempt recovery or fallback
 *     }
 * }
 */
class PlatformInitializationError extends Error {
    constructor(message, platform, phase, cause) {
        super(message);
        this.name = 'PlatformInitializationError';
        this.platform = platform;
        this.phase = phase;
        this.cause = cause;
    }
}

/**
 * Navigation detection error
 *
 * Thrown when navigation detection fails or encounters
 * unexpected conditions.
 *
 * @class NavigationDetectionError
 * @extends Error
 * @property {string} name - Error name 'NavigationDetectionError'
 * @property {string} message - Error description
 * @property {string} platform - Platform identifier
 * @property {string} detectionMethod - Navigation detection method that failed
 * @property {string} currentUrl - Current URL when error occurred
 *
 * @example
 * // Throwing a navigation detection error
 * throw new NavigationDetectionError(
 *     'History API interception failed',
 *     'example',
 *     'history-api',
 *     window.location.href
 * );
 */
class NavigationDetectionError extends Error {
    constructor(message, platform, detectionMethod, currentUrl) {
        super(message);
        this.name = 'NavigationDetectionError';
        this.platform = platform;
        this.detectionMethod = detectionMethod;
        this.currentUrl = currentUrl;
    }
}

/**
 * Error recovery strategies
 *
 * Documents the strategies for recovering from different types of errors.
 */

/**
 * Recover from platform initialization error
 *
 * Attempts to recover from platform initialization failures using
 * various strategies based on the error type and phase.
 *
 * @param {PlatformInitializationError} error - The initialization error
 * @returns {Promise<boolean>} Whether recovery was successful
 *
 * @example
 * // Error recovery implementation
 * async recoverFromInitializationError(error) {
 *     this.logWithFallback('info', 'Attempting platform initialization recovery', {
 *         platform: error.platform,
 *         phase: error.phase,
 *         error: error.message
 *     });
 *
 *     switch (error.phase) {
 *         case 'module-loading':
 *             return await this.retryModuleLoading();
 *
 *         case 'platform-creation':
 *             return await this.retryPlatformCreation();
 *
 *         case 'video-detection':
 *             return await this.retryVideoDetection();
 *
 *         default:
 *             return false; // No recovery strategy available
 *     }
 * }
 */
```

This comprehensive JSDoc documentation provides developers with detailed information about implementing platform-specific content scripts, including examples, error handling, configuration options, and best practices. The documentation follows JSDoc standards and includes practical examples for each concept.
