# Platform Implementation Guide

This guide provides a step-by-step walkthrough for implementing a new streaming
platform content script using the `BaseContentScript` architecture. Following these
steps will ensure that the new platform integrates correctly with the existing
framework and leverages the shared functionality.

## Overview

Adding a new platform involves the following key steps:

1. Creating a platform-specific content script class
2. Implementing required abstract methods
3. Creating an entry point file
4. Updating the Chrome extension manifest
5. Adding tests

## Step 1: Create Platform Content Script Class

Create a new file: `content_scripts/platforms/{PlatformName}ContentScript.js`

- **Location**: `content_scripts/platforms/`
- **Purpose**: To provide platform-specific implementations of the abstract methods
  defined in `BaseContentScript`.

### Basic Template

```javascript
/**
 * {PlatformName}ContentScript - {Platform} specific content script extending BaseContentScript
 *
 * This class implements {Platform} specific navigation detection and injection
 * configuration while leveraging the common functionality provided by BaseContentScript.
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
     * Configure the Base-owned navigation manager
     */
    setupNavigationDetection() {
        this._setupNavigationManager();
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

    /**
     * Handle player-page transitions reported by the Base-owned manager
     * @private
     */
    _handlePageTransition(wasOnPlayerPage, isOnPlayerPage) {
        if (wasOnPlayerPage && !isOnPlayerPage) {
            this._cleanupOnPageLeave();
        } else if (!wasOnPlayerPage && isOnPlayerPage) {
            this._initializeOnPageEnter();
        }
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

Delegate navigation ownership to Base. Pass only documented
`NavigationDetectionManager` options when a platform needs an override:

```javascript
setupNavigationDetection() {
    this._setupNavigationManager({ intervalMs: 1500 });
}
```

Base replaces and cleans the prior manager, owns all detection signals, forwards URL
changes to the active platform, and invokes the subclass transition handler. The
subclass supplies route classification through `_isPlayerPath()`; it does not create a
parallel URL watcher.

### Runtime Message Boundary

Runtime actions are not a platform extension point. Do not implement a platform message
hook or register an ad hoc action. Any new active action must be added to the shared
message catalog and exact protocol builders/parsers, then routed centrally with an
explicit sender role and contract tests.

## Step 3: Implement Route Classification and Transitions

### Classify Player Routes

The Base-owned manager calls `_isPlayerPath()` with old and new pathnames:

```javascript
_isPlayerPath(pathname) {
    return (
        pathname.includes('/watch/') ||
        pathname.includes('/play/')
    );
}
```

Keep this classifier side-effect free. It determines when Base invalidates prior player
identity and when a player/non-player transition is reported.

### Handle Managed Transitions

React only to transitions delivered by Base:

```javascript
_handlePageTransition(wasOnPlayerPage, isOnPlayerPage) {
    if (wasOnPlayerPage && !isOnPlayerPage) {
        this._cleanupOnPageLeave();
    } else if (!wasOnPlayerPage && isOnPlayerPage) {
        this._initializeOnPageEnter();
    }
}
```

Do not install a second interval, History API wrapper, browser listener, or navigation
observer. The shared manager owns those resources and Base cleans them during
replacement and content-script cleanup.

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
        test('delegates setup to the Base-owned manager', () => {
            const setupManager = jest
                .spyOn(contentScript, '_setupNavigationManager')
                .mockReturnValue(true);

            contentScript.setupNavigationDetection();

            expect(setupManager).toHaveBeenCalledTimes(1);
        });

        test('classifies only platform player routes', () => {
            expect(contentScript._isPlayerPath('/watch/123')).toBe(true);
            expect(contentScript._isPlayerPath('/browse')).toBe(false);
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

### 2. Reimplementing Navigation Detection

Do not add platform-owned intervals, History API wrappers, browser listeners, or DOM
observers for navigation. Delegate once through the Base seam:

```javascript
setupNavigationDetection() {
    this._setupNavigationManager();
}
```

### 3. Bypassing Base Cleanup

Do not retain or replace a navigation manager directly. `_setupNavigationManager()`
cleans the previous owner before installing its successor, and Base cleanup tears down
the current manager.

## Best Practices

1. **Delegate navigation ownership to the Base manager**
2. **Handle extension context invalidation gracefully**
3. **Use only documented navigation-manager options**
4. **Implement comprehensive error handling**
5. **Add thorough logging for debugging**
6. **Test on actual platform extensively**
7. **Follow existing naming conventions**
8. **Document platform-specific behavior**
9. **Include comprehensive unit tests**
10. **Keep runtime actions in the shared exact protocol**

## Getting Help

If you encounter issues:

1. Check existing platform implementations for reference
2. Review the BaseContentScript documentation
3. Run tests to identify specific problems
4. Check browser console for error messages
5. Use the extension's debug logging features

## See Also

- [ARCHITECTURE.md](./ARCHITECTURE.md) - For a high-level overview of the content script architecture.
- [API_REFERENCE.md](./API_REFERENCE.md) - For a detailed API reference of `BaseContentScript` and related classes.
- [EXAMPLES.md](./EXAMPLES.md) - For practical code examples of the architecture in use.
- [JSDOC_EXAMPLES.md](./JSDOC_EXAMPLES.md) - For JSDoc documentation examples.
