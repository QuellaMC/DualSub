# Platform Implementation Guide

This guide provides step-by-step instructions for implementing a new streaming platform content script using the BaseContentScript architecture.

## Overview

Adding a new platform involves:
1. Creating a platform-specific content script class
2. Implementing required abstract methods
3. Creating an entry point file
4. Updating the Chrome extension manifest
5. Adding tests

## Step 1: Create Platform Content Script Class

Create a new file: `content_scripts/platforms/{PlatformName}ContentScript.js`

### Basic Template

```javascript
/**
 * {PlatformName}ContentScript - {Platform} specific content script extending BaseContentScript
 * 
 * This class implements {Platform} specific functionality including navigation detection,
 * injection configuration, and platform-specific message handling while leveraging
 * the common functionality provided by BaseContentScript.
 * 
 * @extends BaseContentScript
 * @author DualSub Extension
 * @version 1.0.0
 */

import { BaseContentScript } from '../core/BaseContentScript.js';

export class {PlatformName}ContentScript extends BaseContentScript {
    /**
     * Creates a new {PlatformName}ContentScript instance
     */
    constructor() {
        super('{PlatformName}Content');
        this._initialize{PlatformName}SpecificState();
    }

    /**
     * Initialize {Platform} specific state properties
     * @private
     */
    _initialize{PlatformName}SpecificState() {
        // Platform-specific injection configuration
        this.injectConfig = {
            filename: 'injected_scripts/{platformName}Inject.js',
            tagId: '{platformName}-dualsub-injector-script-tag',
            eventId: '{platformName}-dualsub-injector-event'
        };

        // Platform URL patterns for platform detection
        this.urlPatterns = ['*.{platform}.com'];
    }

    // ========================================
    // ABSTRACT METHOD IMPLEMENTATIONS - Required by BaseContentScript
    // ========================================

    /**
     * Get the platform name
     * @returns {string} Platform name
     */
    getPlatformName() {
        return '{platformName}';
    }

    /**
     * Get the platform class constructor name
     * @returns {string} Platform class name
     */
    getPlatformClass() {
        return '{PlatformName}Platform';
    }

    /**
     * Get the inject script configuration
     * @returns {Object} Inject script configuration
     */
    getInjectScriptConfig() {
        return {
            filename: this.injectConfig.filename,
            tagId: this.injectConfig.tagId,
            eventId: this.injectConfig.eventId
        };
    }

    /**
     * Setup {Platform} specific navigation detection
     */
    setupNavigationDetection() {
        this.logWithFallback('info', 'Setting up {Platform} navigation detection');

        // Method 1: Interval-based URL checking (always include as fallback)
        this._setupIntervalBasedDetection();

        // Method 2: History API interception (for SPA navigation)
        this._setupHistoryAPIInterception();

        // Method 3: Browser navigation events
        this._setupBrowserNavigationEvents();

        // Method 4: Focus and visibility events (optional)
        this._setupFocusAndVisibilityEvents();

        this.logWithFallback('info', '{Platform} navigation detection set up');
    }

    /**
     * Check for URL changes with {Platform} specific logic
     */
    checkForUrlChange() {
        try {
            const newUrl = window.location.href;
            const newPathname = window.location.pathname;

            if (newUrl !== this.currentUrl || newPathname !== this.lastKnownPathname) {
                this.logWithFallback('info', 'URL change detected', {
                    from: this.currentUrl,
                    to: newUrl,
                });

                const wasOnPlayerPage = this._isPlayerPath(this.lastKnownPathname);
                const isOnPlayerPage = this._isPlayerPath(newPathname);

                this.currentUrl = newUrl;
                this.lastKnownPathname = newPathname;

                this._handlePageTransition(wasOnPlayerPage, isOnPlayerPage);
            }
        } catch (error) {
            this.logWithFallback('error', 'Error in URL change detection', { error });
            this._handleExtensionContextError(error);
        }
    }

    /**
     * Handle platform-specific Chrome messages
     * @param {Object} request - Chrome message request
     * @param {Function} sendResponse - Response callback
     * @returns {boolean} Whether response is handled asynchronously
     */
    handlePlatformSpecificMessage(request, sendResponse) {
        try {
            const action = request.action || request.type;
            
            this.logWithFallback('debug', 'Processing {Platform} specific message', {
                action,
                hasRequest: !!request,
                requestKeys: Object.keys(request || {})
            });

            // Handle platform-specific message types here
            switch (action) {
                // Example platform-specific message:
                // case '{platformName}-specific-action':
                //     return this._handle{PlatformName}SpecificAction(request, sendResponse);
                
                default:
                    // No platform-specific handling needed for this message
                    this.logWithFallback('debug', 'No {Platform} specific handling required', {
                        action,
                        message: 'Delegating to default handling or returning success'
                    });
                    
                    // Ensure backward compatibility
                    sendResponse({ 
                        success: true, 
                        handled: false,
                        platform: '{platformName}',
                        message: 'No platform-specific handling required'
                    });
                    return false; // Synchronous handling
            }
        } catch (error) {
            const action = request ? (request.action || request.type) : 'unknown';
            
            this.logWithFallback('error', 'Error in {Platform} specific message handling', {
                error: error.message,
                stack: error.stack,
                action
            });
            
            // Ensure backward compatibility even on error
            try {
                if (typeof sendResponse === 'function') {
                    sendResponse({
                        success: false,
                        error: error.message,
                        platform: '{platformName}'
                    });
                }
            } catch (responseError) {
                this.logWithFallback('error', 'Error sending error response', {
                    originalError: error.message,
                    responseError: responseError.message
                });
            }
            return false; // Synchronous error handling
        }
    }

    // ========================================
    // PLATFORM-SPECIFIC HELPER METHODS
    // ========================================

    /**
     * Check if a given path is a player page
     * @param {string} pathname - The URL pathname
     * @returns {boolean} True if it's a player page
     * @private
     */
    _isPlayerPath(pathname) {
        // Define platform-specific player page patterns
        // Examples:
        // Netflix: pathname.includes('/watch/')
        // Disney+: pathname.includes('/play/') || pathname.includes('/video/')
        // Hulu: pathname.includes('/watch/')
        // Amazon Prime: pathname.includes('/detail/') && pathname.includes('/play')
        
        return pathname.includes('/watch/'); // Customize for your platform
    }

    // ... (implement other helper methods as needed)
}
```

## Step 2: Implement Required Abstract Methods

### getPlatformName()

Return a lowercase string identifier for your platform:

```javascript
getPlatformName() {
    return 'hulu'; // Example: 'netflix', 'disneyplus', 'hulu', 'amazonprime'
}
```

### getPlatformClass()

Return the name of the platform class (must match the class name in `video_platforms/`):

```javascript
getPlatformClass() {
    return 'HuluPlatform'; // Must match class name in video_platforms/huluPlatform.js
}
```

### getInjectScriptConfig()

Return configuration for the injected script:

```javascript
getInjectScriptConfig() {
    return {
        filename: 'injected_scripts/huluInject.js',    // Path to inject script
        tagId: 'hulu-dualsub-injector-script-tag',     // Unique DOM element ID
        eventId: 'hulu-dualsub-injector-event'         // Unique event ID
    };
}
```

### setupNavigationDetection()

Implement navigation detection appropriate for your platform:

```javascript
setupNavigationDetection() {
    this.logWithFallback('info', 'Setting up Hulu navigation detection');

    // Always include interval-based detection as fallback
    this._setupIntervalBasedDetection();

    // Add other detection methods based on platform needs:
    
    // For SPA platforms (most modern streaming sites):
    this._setupHistoryAPIInterception();
    this._setupBrowserNavigationEvents();
    
    // Optional for enhanced detection:
    this._setupFocusAndVisibilityEvents();

    this.logWithFallback('info', 'Hulu navigation detection set up');
}
```

### checkForUrlChange()

Implement URL change detection with platform-specific logic:

```javascript
checkForUrlChange() {
    try {
        const newUrl = window.location.href;
        const newPathname = window.location.pathname;

        if (newUrl !== this.currentUrl || newPathname !== this.lastKnownPathname) {
            this.logWithFallback('info', 'URL change detected', {
                from: this.currentUrl,
                to: newUrl,
            });

            // Determine if we're transitioning between player and non-player pages
            const wasOnPlayerPage = this._isPlayerPath(this.lastKnownPathname);
            const isOnPlayerPage = this._isPlayerPath(newPathname);

            // Update current state
            this.currentUrl = newUrl;
            this.lastKnownPathname = newPathname;

            // Handle page transitions
            this._handlePageTransition(wasOnPlayerPage, isOnPlayerPage);
        }
    } catch (error) {
        this.logWithFallback('error', 'Error in URL change detection', { error });
        this._handleExtensionContextError(error);
    }
}
```

### handlePlatformSpecificMessage()

Handle platform-specific Chrome messages:

```javascript
handlePlatformSpecificMessage(request, sendResponse) {
    try {
        const action = request.action || request.type;
        
        switch (action) {
            case 'hulu-specific-action':
                return this._handleHuluSpecificAction(request, sendResponse);
            
            default:
                // No platform-specific handling needed
                sendResponse({ 
                    success: true, 
                    handled: false,
                    platform: 'hulu',
                    message: 'No platform-specific handling required'
                });
                return false; // Synchronous handling
        }
    } catch (error) {
        this.logWithFallback('error', 'Error in Hulu specific message handling', {
            error: error.message,
            action: request ? (request.action || request.type) : 'unknown'
        });
        
        sendResponse({
            success: false,
            error: error.message,
            platform: 'hulu'
        });
        return false;
    }
}
```

## Step 3: Implement Navigation Detection Helpers

### Standard Helper Methods

```javascript
/**
 * Setup interval-based URL change detection (always include)
 * @private
 */
_setupIntervalBasedDetection() {
    this.intervalManager.set(
        'urlChangeCheck',
        () => this.checkForUrlChange(),
        1000 // Check every second
    );
}

/**
 * Setup History API interception for SPA navigation
 * @private
 */
_setupHistoryAPIInterception() {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    // Intercept pushState
    history.pushState = (...args) => {
        originalPushState.apply(history, args);
        setTimeout(() => this.checkForUrlChange(), 100);
    };

    // Intercept replaceState
    history.replaceState = (...args) => {
        originalReplaceState.apply(history, args);
        setTimeout(() => this.checkForUrlChange(), 100);
    };

    // Store original functions for cleanup
    this._originalHistoryMethods = {
        pushState: originalPushState,
        replaceState: originalReplaceState
    };
}

/**
 * Setup browser navigation event listeners
 * @private
 */
_setupBrowserNavigationEvents() {
    const events = [
        { name: 'popstate', delay: 100 },
        { name: 'hashchange', delay: 100 }
    ];

    events.forEach(({ name, delay }) => {
        const handler = () => setTimeout(() => this.checkForUrlChange(), delay);
        
        const options = this.abortController ? { signal: this.abortController.signal } : {};
        window.addEventListener(name, handler, options);
    });
}

/**
 * Handle page transitions between player and non-player pages
 * @private
 */
_handlePageTransition(wasOnPlayerPage, isOnPlayerPage) {
    if (wasOnPlayerPage && !isOnPlayerPage) {
        this.logWithFallback('info', 'Leaving player page, cleaning up platform');
        this._cleanupOnPageLeave();
    } else if (!wasOnPlayerPage && isOnPlayerPage) {
        this.logWithFallback('info', 'Entering player page, preparing for initialization');
        this._initializeOnPageEnter();
    }
}

/**
 * Cleanup when leaving a player page
 * @private
 */
_cleanupOnPageLeave() {
    this.stopVideoElementDetection();
    
    if (this.activePlatform && typeof this.activePlatform.cleanup === 'function') {
        this.activePlatform.cleanup();
    }
    
    this.activePlatform = null;
    this.platformReady = false;
    this.eventBuffer.clear();
}

/**
 * Initialize when entering a player page
 * @private
 */
_initializeOnPageEnter() {
    this._reinjectScript();

    setTimeout(async () => {
        try {
            const config = await this.configService.getAll();
            if (config && config.subtitlesEnabled) {
                this.logWithFallback('info', 'Subtitles enabled, initializing platform');
                await this.initializePlatform();
            }
        } catch (error) {
            this.logWithFallback('error', 'Error during URL change initialization', { error });
        }
    }, 1500); // Adjust delay based on platform needs
}
```

## Step 4: Create Entry Point File

Create `content_scripts/platforms/{platformName}Content.js`:

```javascript
/**
 * {Platform} Content Script Entry Point
 * 
 * This file serves as the entry point for the {Platform} content script.
 * It instantiates and initializes the {PlatformName}ContentScript class.
 * 
 * @author DualSub Extension
 * @version 1.0.0
 */

(async () => {
    try {
        const { {PlatformName}ContentScript } = await import('./{PlatformName}ContentScript.js');
        const {platformName}ContentScript = new {PlatformName}ContentScript();
        const success = await {platformName}ContentScript.initialize();
        if (success) {
            console.log('[{PlatformName}Content] Content script initialized successfully');
        } else {
            console.error('[{PlatformName}Content] Content script initialization failed');
        }
    } catch (error) {
        console.error('[{PlatformName}Content] Error during initialization:', error);
    }
})();
```

## Step 5: Update Chrome Extension Manifest

Add your platform to `manifest.json`:

```json
{
    "content_scripts": [
        {
            "matches": ["*://*.{platform}.com/*"],
            "js": ["content_scripts/platforms/{platformName}Content.js"],
            "run_at": "document_start"
        }
    ],
    "web_accessible_resources": [
        {
            "resources": [
                "content_scripts/platforms/{PlatformName}ContentScript.js",
                "injected_scripts/{platformName}Inject.js"
            ],
            "matches": ["*://*.{platform}.com/*"]
        }
    ]
}
```

## Step 6: Create Platform-Specific Configuration (Optional)

Add platform-specific configuration methods:

```javascript
/**
 * Get {Platform} specific configuration defaults
 * @returns {Object} Platform-specific configuration
 */
get{PlatformName}SpecificConfig() {
    return {
        // Platform-specific retry settings
        maxVideoDetectionRetries: 30,
        videoDetectionInterval: 1000,
        
        // Navigation detection settings
        urlChangeCheckInterval: 1000,
        pageTransitionDelay: 1500,
        
        // Injection settings
        injectRetryDelay: 10,
        injectMaxRetries: 100
    };
}

/**
 * Apply {Platform} specific configuration overrides
 * @param {Object} baseConfig - Base configuration
 * @returns {Object} Configuration with platform-specific overrides
 */
apply{PlatformName}ConfigOverrides(baseConfig) {
    const platformConfig = this.get{PlatformName}SpecificConfig();
    
    return {
        ...baseConfig,
        ...platformConfig,
        platformName: this.getPlatformName(),
        injectConfig: this.getInjectScriptConfig(),
        urlPatterns: this.urlPatterns
    };
}
```

## Step 7: Create Tests

Create `content_scripts/tests/{PlatformName}ContentScript.test.js`:

```javascript
/**
 * {PlatformName}ContentScript Tests
 */

import { {PlatformName}ContentScript } from '../platforms/{PlatformName}ContentScript.js';
import { setupMockEnvironment, cleanupMockEnvironment } from '../../test-utils/test-helpers.js';

describe('{PlatformName}ContentScript', () => {
    let contentScript;
    let mockEnvironment;

    beforeEach(() => {
        mockEnvironment = setupMockEnvironment();
        contentScript = new {PlatformName}ContentScript();
    });

    afterEach(() => {
        cleanupMockEnvironment(mockEnvironment);
    });

    describe('Abstract Method Implementations', () => {
        test('getPlatformName returns correct platform name', () => {
            expect(contentScript.getPlatformName()).toBe('{platformName}');
        });

        test('getPlatformClass returns correct class name', () => {
            expect(contentScript.getPlatformClass()).toBe('{PlatformName}Platform');
        });

        test('getInjectScriptConfig returns correct configuration', () => {
            const config = contentScript.getInjectScriptConfig();
            expect(config).toEqual({
                filename: 'injected_scripts/{platformName}Inject.js',
                tagId: '{platformName}-dualsub-injector-script-tag',
                eventId: '{platformName}-dualsub-injector-event'
            });
        });
    });

    describe('Navigation Detection', () => {
        test('setupNavigationDetection sets up detection methods', () => {
            const spy = jest.spyOn(contentScript, 'logWithFallback');
            contentScript.setupNavigationDetection();
            
            expect(spy).toHaveBeenCalledWith('info', 'Setting up {Platform} navigation detection');
            expect(spy).toHaveBeenCalledWith('info', '{Platform} navigation detection set up');
        });

        test('checkForUrlChange handles URL changes', () => {
            const originalUrl = window.location.href;
            const spy = jest.spyOn(contentScript, '_handlePageTransition');
            
            // Mock URL change
            Object.defineProperty(window, 'location', {
                value: { href: 'https://{platform}.com/new-page', pathname: '/new-page' },
                writable: true
            });
            
            contentScript.checkForUrlChange();
            
            expect(spy).toHaveBeenCalled();
        });
    });

    describe('Message Handling', () => {
        test('handlePlatformSpecificMessage handles unknown messages gracefully', () => {
            const request = { action: 'unknown-action' };
            const sendResponse = jest.fn();
            
            const result = contentScript.handlePlatformSpecificMessage(request, sendResponse);
            
            expect(result).toBe(false); // Synchronous handling
            expect(sendResponse).toHaveBeenCalledWith({
                success: true,
                handled: false,
                platform: '{platformName}',
                message: 'No platform-specific handling required'
            });
        });
    });
});
```

## Step 8: Platform-Specific Considerations

### URL Pattern Detection

Different platforms have different URL patterns for player pages:

```javascript
// Netflix
_isPlayerPath(pathname) {
    return pathname.includes('/watch/');
}

// Disney+
_isPlayerPath(pathname) {
    return pathname.includes('/play/') || 
           pathname.includes('/video/') || 
           pathname.includes('/movies/') || 
           pathname.includes('/series/');
}

// Hulu
_isPlayerPath(pathname) {
    return pathname.includes('/watch/') || 
           pathname.includes('/movie/') || 
           pathname.includes('/series/');
}

// Amazon Prime Video
_isPlayerPath(pathname) {
    return pathname.includes('/detail/') && pathname.includes('/play');
}
```

### Navigation Complexity

Consider the complexity of your platform's SPA routing:

- **Simple SPA**: Use basic interval + history API interception
- **Complex SPA** (like Netflix): Add focus/visibility events and enhanced error handling
- **Multi-domain**: Handle subdomain changes and cross-origin navigation

### Platform-Specific Timing

Adjust timing based on platform behavior:

```javascript
// Fast platforms (simple SPAs)
pageTransitionDelay: 1000,
urlChangeCheckInterval: 1000,

// Slow platforms (complex SPAs)
pageTransitionDelay: 2000,
urlChangeCheckInterval: 2000,

// Very slow platforms
pageTransitionDelay: 3000,
urlChangeCheckInterval: 3000,
```

## Step 9: Testing Your Implementation

### Manual Testing Checklist

1. **Basic Functionality**
   - [ ] Content script loads without errors
   - [ ] Platform detection works correctly
   - [ ] Navigation between pages works
   - [ ] Subtitle toggle works
   - [ ] Configuration changes apply correctly

2. **Navigation Testing**
   - [ ] URL changes are detected
   - [ ] Page transitions trigger correctly
   - [ ] Player page detection works
   - [ ] Non-player page detection works
   - [ ] Browser back/forward buttons work

3. **Error Handling**
   - [ ] Extension context invalidation is handled
   - [ ] Module loading failures are handled gracefully
   - [ ] Platform initialization errors are recovered
   - [ ] Network errors don't break functionality

### Automated Testing

Run the test suite:

```bash
npm test content_scripts/tests/{PlatformName}ContentScript.test.js
```

## Step 10: Documentation

Update documentation files:

1. Add your platform to `content_scripts/README.md`
2. Update `content_scripts/ARCHITECTURE.md` with platform-specific details
3. Add examples to `content_scripts/EXAMPLES.md`

## Common Pitfalls

### 1. Incorrect URL Pattern Matching

```javascript
// Wrong - too broad
_isPlayerPath(pathname) {
    return pathname.includes('video');
}

// Right - specific to actual player pages
_isPlayerPath(pathname) {
    return pathname.includes('/watch/') || pathname.includes('/play/');
}
```

### 2. Missing Error Handling

```javascript
// Wrong - no error handling
checkForUrlChange() {
    const newUrl = window.location.href;
    // ... rest of method
}

// Right - comprehensive error handling
checkForUrlChange() {
    try {
        const newUrl = window.location.href;
        // ... rest of method
    } catch (error) {
        this.logWithFallback('error', 'Error in URL change detection', { error });
        this._handleExtensionContextError(error);
    }
}
```

### 3. Forgetting Cleanup

```javascript
// Wrong - no cleanup
setupNavigationDetection() {
    history.pushState = (...args) => {
        originalPushState.apply(history, args);
        setTimeout(() => this.checkForUrlChange(), 100);
    };
}

// Right - store original for cleanup
setupNavigationDetection() {
    const originalPushState = history.pushState;
    history.pushState = (...args) => {
        originalPushState.apply(history, args);
        setTimeout(() => this.checkForUrlChange(), 100);
    };
    
    this._originalHistoryMethods = { pushState: originalPushState };
}
```

## Best Practices

1. **Always include interval-based detection as fallback**
2. **Handle extension context invalidation gracefully**
3. **Use appropriate timing delays for your platform**
4. **Implement comprehensive error handling**
5. **Add thorough logging for debugging**
6. **Test on actual platform extensively**
7. **Follow existing naming conventions**
8. **Document platform-specific behavior**
9. **Include comprehensive unit tests**
10. **Maintain backward compatibility**

## Getting Help

If you encounter issues:

1. Check existing platform implementations for reference
2. Review the BaseContentScript documentation
3. Run tests to identify specific problems
4. Check browser console for error messages
5. Use the extension's debug logging features