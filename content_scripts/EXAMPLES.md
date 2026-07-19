# Content Scripts Examples

This document provides practical examples of implementing and using the content script architecture.

## Table of Contents

1. [Basic Platform Implementation](#basic-platform-implementation)
2. [Advanced Navigation Detection](#advanced-navigation-detection)
3. [Centralized Runtime Messaging](#centralized-runtime-messaging)
4. [Configuration Management](#configuration-management)
5. [Error Handling Patterns](#error-handling-patterns)
6. [Testing Examples](#testing-examples)
7. [Debugging Techniques](#debugging-techniques)

## Basic Platform Implementation

### Minimal Platform Implementation

Here's a minimal example for a hypothetical "StreamingService" platform:

```javascript
import { BaseContentScript } from '../core/BaseContentScript.js';

export class StreamingServiceContentScript extends BaseContentScript {
    constructor() {
        super('StreamingServiceContent');

        // Platform-specific configuration
        this.injectConfig = {
            filename: 'injected_scripts/streamingServiceInject.js',
            tagId: 'streamingservice-dualsub-injector-script-tag',
            eventId: 'streamingservice-dualsub-injector-event',
        };

        this.urlPatterns = ['*.streamingservice.com'];
    }

    // Required abstract method implementations
    getPlatformName() {
        return 'streamingservice';
    }

    getPlatformClass() {
        return 'StreamingServicePlatform';
    }

    getInjectScriptConfig() {
        return this.injectConfig;
    }

    setupNavigationDetection() {
        this._setupNavigationManager();
    }

    _isPlayerPath(pathname) {
        return pathname.includes('/watch/');
    }

    _handlePageTransition(wasOnPlayerPage, isOnPlayerPage) {
        if (wasOnPlayerPage && !isOnPlayerPage) {
            this._cleanupOnPageLeave();
        } else if (!wasOnPlayerPage && isOnPlayerPage) {
            this._initializeOnPageEnter();
        }
    }
}
```

### Entry Point Example

```javascript
// streamingServiceContent.js
(async () => {
    try {
        const { StreamingServiceContentScript } =
            await import('./StreamingServiceContentScript.js');
        const contentScript = new StreamingServiceContentScript();
        const success = await contentScript.initialize();

        if (success) {
            console.log(
                '[StreamingServiceContent] Content script initialized successfully'
            );
        } else {
            console.error(
                '[StreamingServiceContent] Content script initialization failed'
            );
        }
    } catch (error) {
        console.error(
            '[StreamingServiceContent] Error during initialization:',
            error
        );
    }
})();
```

## Advanced Navigation Detection

### Base-Owned SPA Navigation

`BaseContentScript` owns one navigation manager. A subclass may tune documented manager
options, but it does not install its own timers, History API wrappers, or browser event
listeners.

```javascript
export class ComplexSPAContentScript extends BaseContentScript {
    setupNavigationDetection() {
        this._setupNavigationManager({
            intervalMs: 2000,
            useHistoryAPI: true,
            usePopstateEvents: true,
            useIntervalChecking: true,
            useFocusEvents: true,
        });
    }

    _isPlayerPath(pathname) {
        return (
            pathname.includes('/watch/') ||
            pathname.includes('/play/') ||
            pathname.includes('/video/')
        );
    }

    _handlePageTransition(wasOnPlayerPage, isOnPlayerPage) {
        if (wasOnPlayerPage && !isOnPlayerPage) {
            this._cleanupOnPageLeave();
        } else if (!wasOnPlayerPage && isOnPlayerPage) {
            this._initializeOnPageEnter();
        }
    }
}
```

## Centralized Runtime Messaging

Platform subclasses do not register runtime actions. Build and validate messages with
the shared protocol. For example, a content script can check background readiness with
the exact request and response contract:

```javascript
import { MessageActions } from './shared/constants/messageActions.js';
import { sendRuntimeMessageWithRetry } from './shared/messaging.js';
import {
    buildBackgroundReadinessRequestMessage,
    parseBackgroundReadinessResponseMessage,
} from './shared/protocol/messageProtocol.js';

const request = buildBackgroundReadinessRequestMessage(
    MessageActions.CHECK_BACKGROUND_READY
);
const response = await sendRuntimeMessageWithRetry(request);
const readiness = parseBackgroundReadinessResponseMessage(response, request);

if (!readiness) {
    throw new Error('Invalid background-readiness response');
}
```

## Configuration Management

### Dynamic Configuration Updates

```javascript
export class ConfigurationAwareContentScript extends BaseContentScript {
    constructor() {
        super('ConfigAwareContent');
        this.configChangeHandlers = new Map();
        this.setupConfigurationHandlers();
    }

    setupConfigurationHandlers() {
        // Register handlers for specific configuration changes
        this.configChangeHandlers.set(
            'subtitlesEnabled',
            this.handleSubtitlesEnabledChange.bind(this)
        );
        this.configChangeHandlers.set(
            'translationProvider',
            this.handleTranslationProviderChange.bind(this)
        );
        this.configChangeHandlers.set(
            'subtitlePosition',
            this.handleSubtitlePositionChange.bind(this)
        );
        this.configChangeHandlers.set(
            'loggingLevel',
            this.handleLoggingLevelChange.bind(this)
        );
    }

    async handleConfigChanged(request, sendResponse) {
        try {
            const { changes, newConfig } = request.data;

            this.logWithFallback('info', 'Configuration change detected', {
                changes: Object.keys(changes),
                changeCount: Object.keys(changes).length,
            });

            // Update current config
            this.currentConfig = { ...this.currentConfig, ...newConfig };

            // Process each change with specific handlers
            const results = {};
            for (const [key, change] of Object.entries(changes)) {
                if (this.configChangeHandlers.has(key)) {
                    try {
                        const handler = this.configChangeHandlers.get(key);
                        const result = await handler(
                            change.newValue,
                            change.oldValue
                        );
                        results[key] = { success: true, result };
                    } catch (error) {
                        results[key] = { success: false, error: error.message };
                        this.logWithFallback(
                            'error',
                            `Error handling config change for ${key}`,
                            {
                                error: error.message,
                                newValue: change.newValue,
                                oldValue: change.oldValue,
                            }
                        );
                    }
                } else {
                    // Generic handling for unspecified changes
                    results[key] = await this.handleGenericConfigChange(
                        key,
                        change
                    );
                }
            }

            // Apply changes to platform if ready
            if (
                this.activePlatform &&
                this.activePlatform.applyConfigurationChanges
            ) {
                await this.activePlatform.applyConfigurationChanges(changes);
            }

            sendResponse({
                success: true,
                platform: this.getPlatformName(),
                results: results,
                appliedChanges: Object.keys(changes),
            });

            return true; // Async handling
        } catch (error) {
            this.logWithFallback(
                'error',
                'Error in configuration change handling',
                {
                    error: error.message,
                    stack: error.stack,
                }
            );

            sendResponse({
                success: false,
                error: error.message,
                platform: this.getPlatformName(),
            });

            return false;
        }
    }

    async handleSubtitlesEnabledChange(newValue, oldValue) {
        this.logWithFallback('info', 'Subtitles enabled state changed', {
            from: oldValue,
            to: newValue,
        });

        if (newValue && !oldValue) {
            // Subtitles were enabled
            if (this._isPlayerPath(window.location.pathname)) {
                await this.initializePlatform();
                return 'Platform initialized for subtitle display';
            }
            return 'Subtitles enabled, will initialize on player page';
        } else if (!newValue && oldValue) {
            // Subtitles were disabled
            if (this.activePlatform) {
                await this.activePlatform.cleanup();
                this.activePlatform = null;
                this.platformReady = false;
                return 'Platform cleaned up, subtitles disabled';
            }
            return 'Subtitles disabled';
        }

        return 'No action required';
    }

    async handleTranslationProviderChange(newValue, oldValue) {
        this.logWithFallback('info', 'Translation provider changed', {
            from: oldValue,
            to: newValue,
        });

        if (
            this.activePlatform &&
            this.activePlatform.updateTranslationProvider
        ) {
            await this.activePlatform.updateTranslationProvider(newValue);
            return `Translation provider updated to ${newValue}`;
        }

        return 'Translation provider change noted, will apply on next initialization';
    }

    async handleSubtitlePositionChange(newValue, oldValue) {
        this.logWithFallback('info', 'Subtitle position changed', {
            from: oldValue,
            to: newValue,
        });

        if (this.activePlatform && this.activePlatform.updateSubtitlePosition) {
            await this.activePlatform.updateSubtitlePosition(newValue);
            return `Subtitle position updated to ${newValue}`;
        }

        return 'Subtitle position change noted';
    }

    async handleLoggingLevelChange(newValue, oldValue) {
        if (this.contentLogger && this.contentLogger.updateLevel) {
            this.contentLogger.updateLevel(newValue);
            this.logWithFallback('info', 'Logging level updated', {
                from: oldValue,
                to: newValue,
            });
            return `Logging level updated to ${newValue}`;
        }

        return 'Logging level change noted';
    }

    async handleGenericConfigChange(key, change) {
        this.logWithFallback('debug', 'Generic config change handling', {
            key,
            newValue: change.newValue,
            oldValue: change.oldValue,
        });

        // Apply generic change to platform if it supports it
        if (this.activePlatform && this.activePlatform.updateConfig) {
            try {
                await this.activePlatform.updateConfig(key, change.newValue);
                return {
                    success: true,
                    result: `Generic update applied for ${key}`,
                };
            } catch (error) {
                return { success: false, error: error.message };
            }
        }

        return {
            success: true,
            result: 'Change noted, no specific handler available',
        };
    }
}
```

## Error Handling Patterns

### Comprehensive Error Recovery

```javascript
export class RobustContentScript extends BaseContentScript {
    constructor() {
        super('RobustContent');
        this.errorRecoveryStrategies = new Map();
        this.setupErrorRecovery();
    }

    setupErrorRecovery() {
        // Define recovery strategies for different error types
        this.errorRecoveryStrategies.set(
            'ModuleLoadError',
            this.recoverFromModuleLoadError.bind(this)
        );
        this.errorRecoveryStrategies.set(
            'PlatformInitError',
            this.recoverFromPlatformInitError.bind(this)
        );
        this.errorRecoveryStrategies.set(
            'ExtensionContextError',
            this.recoverFromExtensionContextError.bind(this)
        );
        this.errorRecoveryStrategies.set(
            'VideoDetectionError',
            this.recoverFromVideoDetectionError.bind(this)
        );
    }

    async initializePlatform(retryCount = 0) {
        const maxRetries = 3;
        const retryDelay = 1000 * Math.pow(2, retryCount); // Exponential backoff

        try {
            this.logWithFallback('info', 'Attempting platform initialization', {
                attempt: retryCount + 1,
                maxRetries: maxRetries + 1,
            });

            // Call parent implementation
            const success = await super.initializePlatform(retryCount);

            if (success) {
                this.logWithFallback(
                    'info',
                    'Platform initialization successful'
                );
                return true;
            } else {
                throw new Error('Platform initialization failed');
            }
        } catch (error) {
            this.logWithFallback('error', 'Platform initialization error', {
                error: error.message,
                attempt: retryCount + 1,
                willRetry: retryCount < maxRetries,
            });

            // Try error recovery
            const recovered = await this.attemptErrorRecovery(
                error,
                'PlatformInitError'
            );

            if (recovered && retryCount < maxRetries) {
                this.logWithFallback(
                    'info',
                    'Retrying platform initialization after recovery',
                    {
                        delay: retryDelay,
                    }
                );

                await this.delay(retryDelay);
                return this.initializePlatform(retryCount + 1);
            }

            this.logWithFallback(
                'error',
                'Platform initialization failed permanently',
                {
                    totalAttempts: retryCount + 1,
                    finalError: error.message,
                }
            );

            return false;
        }
    }

    async attemptErrorRecovery(error, errorType) {
        try {
            if (this.errorRecoveryStrategies.has(errorType)) {
                const recoveryStrategy =
                    this.errorRecoveryStrategies.get(errorType);
                const recovered = await recoveryStrategy(error);

                this.logWithFallback('info', 'Error recovery attempted', {
                    errorType,
                    recovered,
                    error: error.message,
                });

                return recovered;
            }

            return false;
        } catch (recoveryError) {
            this.logWithFallback('error', 'Error recovery failed', {
                originalError: error.message,
                recoveryError: recoveryError.message,
            });

            return false;
        }
    }

    async recoverFromModuleLoadError(error) {
        this.logWithFallback('info', 'Attempting module load error recovery');

        try {
            // Clear any partially loaded modules
            this.subtitleUtils = null;
            this.PlatformClass = null;
            this.configService = null;
            this.contentLogger = null;

            // Wait a bit for any transient issues to resolve
            await this.delay(500);

            // Try to reload modules
            return await this.loadModules();
        } catch (recoveryError) {
            this.logWithFallback('error', 'Module load recovery failed', {
                recoveryError: recoveryError.message,
            });
            return false;
        }
    }

    async recoverFromPlatformInitError(error) {
        this.logWithFallback(
            'info',
            'Attempting platform initialization error recovery'
        );

        try {
            // Clean up any partial initialization
            if (this.activePlatform) {
                try {
                    await this.activePlatform.cleanup();
                } catch (cleanupError) {
                    this.logWithFallback('warn', 'Error during cleanup', {
                        cleanupError,
                    });
                }
                this.activePlatform = null;
            }

            this.platformReady = false;
            this.eventBuffer.clear();

            // Reset video detection state
            this.videoDetectionRetries = 0;
            this.stopVideoElementDetection();

            return true; // Recovery successful, can retry
        } catch (recoveryError) {
            this.logWithFallback('error', 'Platform init recovery failed', {
                recoveryError: recoveryError.message,
            });
            return false;
        }
    }

    async recoverFromExtensionContextError(error) {
        this.logWithFallback(
            'info',
            'Attempting extension context error recovery'
        );

        try {
            // Stop all intervals that might be causing context issues
            this.intervalManager.clearAll();

            // Remove event listeners that might be problematic
            if (this.abortController) {
                this.abortController.abort();
                this.abortController = new AbortController();
            }

            // Clear any Chrome API related state
            this.eventListenerAttached = false;

            return true; // Can attempt to continue with limited functionality
        } catch (recoveryError) {
            this.logWithFallback('error', 'Extension context recovery failed', {
                recoveryError: recoveryError.message,
            });
            return false;
        }
    }

    async recoverFromVideoDetectionError(error) {
        this.logWithFallback(
            'info',
            'Attempting video detection error recovery'
        );

        try {
            // Reset video detection state
            this.videoDetectionRetries = 0;
            this.stopVideoElementDetection();

            // Wait for DOM to stabilize
            await this.delay(1000);

            // Try alternative video detection methods
            const videoElement = this.findVideoElementAlternative();
            if (videoElement) {
                this.logWithFallback(
                    'info',
                    'Alternative video detection successful'
                );
                return true;
            }

            return false;
        } catch (recoveryError) {
            this.logWithFallback('error', 'Video detection recovery failed', {
                recoveryError: recoveryError.message,
            });
            return false;
        }
    }

    findVideoElementAlternative() {
        // Try multiple selectors for video elements
        const selectors = [
            'video',
            '[data-testid*="video"]',
            '[class*="video"]',
            '[id*="video"]',
            'video-js video',
            '.video-player video',
        ];

        for (const selector of selectors) {
            try {
                const element = document.querySelector(selector);
                if (element && element.tagName.toLowerCase() === 'video') {
                    this.logWithFallback(
                        'debug',
                        'Found video element with alternative selector',
                        {
                            selector,
                        }
                    );
                    return element;
                }
            } catch (selectorError) {
                // Continue to next selector
            }
        }

        return null;
    }

    delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    // Enhanced error handling in critical methods
    async loadModules() {
        const maxRetries = 3;
        let lastError;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                return await super.loadModules();
            } catch (error) {
                lastError = error;
                this.logWithFallback(
                    'warn',
                    'Module loading failed, retrying',
                    {
                        attempt: attempt + 1,
                        maxRetries,
                        error: error.message,
                    }
                );

                if (attempt < maxRetries - 1) {
                    await this.delay(1000 * (attempt + 1)); // Progressive delay
                }
            }
        }

        // All retries failed
        await this.attemptErrorRecovery(lastError, 'ModuleLoadError');
        throw lastError;
    }
}
```

## Testing Examples

### Unit Test Examples

```javascript
// Example unit test for a custom content script
import { CustomContentScript } from '../platforms/CustomContentScript.js';
import {
    setupMockEnvironment,
    cleanupMockEnvironment,
} from '../../test-utils/test-helpers.js';

describe('CustomContentScript', () => {
    let contentScript;
    let mockEnvironment;

    beforeEach(() => {
        mockEnvironment = setupMockEnvironment();
        contentScript = new CustomContentScript();
    });

    afterEach(() => {
        cleanupMockEnvironment(mockEnvironment);
    });

    describe('Initialization', () => {
        test('should initialize successfully with all modules', async () => {
            // Mock successful module loading
            mockEnvironment.mockModuleLoader.mockResolvedValue({
                subtitleUtils: { mockUtility: jest.fn() },
                PlatformClass: jest.fn(),
                configService: { getAll: jest.fn().mockResolvedValue({}) },
            });

            const result = await contentScript.initialize();
            expect(result).toBe(true);
            expect(contentScript.contentLogger).toBeDefined();
        });

        test('should handle module loading failures gracefully', async () => {
            // Mock module loading failure
            mockEnvironment.mockModuleLoader.mockRejectedValue(
                new Error('Module load failed')
            );

            const result = await contentScript.initialize();
            expect(result).toBe(false);
        });
    });

    describe('Navigation Detection', () => {
        test('delegates navigation ownership to the Base manager', () => {
            const setupManager = jest
                .spyOn(contentScript, '_setupNavigationManager')
                .mockReturnValue(true);

            contentScript.setupNavigationDetection();

            expect(setupManager).toHaveBeenCalledTimes(1);
        });
    });

    describe('Error Recovery', () => {
        test('should recover from platform initialization errors', async () => {
            const spy = jest.spyOn(contentScript, 'attemptErrorRecovery');

            // Mock platform initialization failure
            jest.spyOn(
                contentScript,
                'initializePlatform'
            ).mockRejectedValueOnce(new Error('Init failed'));

            await contentScript.initializePlatform();

            expect(spy).toHaveBeenCalledWith(
                expect.any(Error),
                'PlatformInitError'
            );
        });
    });
});
```

### Integration Test Examples

```javascript
// Integration test example
import { NetflixContentScript } from '../platforms/NetflixContentScript.js';
import { setupIntegrationEnvironment } from '../../test-utils/integration-helpers.js';

describe('NetflixContentScript Integration', () => {
    let contentScript;
    let integrationEnv;

    beforeEach(async () => {
        integrationEnv = await setupIntegrationEnvironment('netflix');
        contentScript = new NetflixContentScript();
    });

    afterEach(async () => {
        await integrationEnv.cleanup();
    });

    test('should complete full initialization flow', async () => {
        // Mock Netflix page environment
        integrationEnv.mockNetflixPlayerPage();

        const result = await contentScript.initialize();

        expect(result).toBe(true);
        expect(contentScript.platformReady).toBe(true);
        expect(contentScript.activePlatform).toBeDefined();
    });

    test('should handle navigation between pages', async () => {
        await contentScript.initialize();

        // Simulate navigation from home to player page
        integrationEnv.simulateNavigation('/', '/watch/12345');

        // Wait for navigation detection
        await integrationEnv.waitForNavigation();

        expect(contentScript.currentUrl).toContain('/watch/12345');
        expect(contentScript.platformReady).toBe(true);
    });
});
```

## Debugging Techniques

### Debug Logging

```javascript
export class DebuggableContentScript extends BaseContentScript {
    constructor() {
        super('DebuggableContent');
        this.debugMode = false;
        this.performanceMetrics = new Map();
        this.setupDebugging();
    }

    setupDebugging() {
        // Enable debug mode based on configuration or URL parameter
        const urlParams = new URLSearchParams(window.location.search);
        this.debugMode =
            urlParams.has('debug') ||
            localStorage.getItem('dualsub-debug') === 'true';

        if (this.debugMode) {
            this.enableDebugMode();
        }
    }

    enableDebugMode() {
        this.logWithFallback('info', 'Debug mode enabled');

        // Add debug information to window object
        window.dualsubDebug = {
            contentScript: this,
            getState: () => this.getDebugState(),
            getMetrics: () => this.getPerformanceMetrics(),
            forceReinitialization: () => this.forceReinitialization(),
        };

        // Log all method calls in debug mode
        this.wrapMethodsForDebugging();
    }

    getDebugState() {
        return {
            platform: this.getPlatformName(),
            platformReady: this.platformReady,
            currentUrl: this.currentUrl,
            lastKnownPathname: this.lastKnownPathname,
            moduleStatus: {
                logger: !!this.contentLogger,
                configService: !!this.configService,
                subtitleUtils: !!this.subtitleUtils,
                platformClass: !!this.PlatformClass,
                activePlatform: !!this.activePlatform,
            },
            activeIntervals: this.intervalManager.getActiveIntervals(),
            eventBufferSize: this.eventBuffer.size(),
            currentConfig: this.currentConfig,
            isCleanedUp: this.isCleanedUp,
        };
    }

    getPerformanceMetrics() {
        const metrics = {};
        for (const [key, value] of this.performanceMetrics.entries()) {
            metrics[key] = {
                totalTime: value.totalTime,
                callCount: value.callCount,
                averageTime: value.totalTime / value.callCount,
                lastCall: value.lastCall,
            };
        }
        return metrics;
    }

    wrapMethodsForDebugging() {
        const methodsToWrap = [
            'initialize',
            'loadModules',
            'initializePlatform',
            'handleChromeMessage',
        ];

        methodsToWrap.forEach((methodName) => {
            const originalMethod = this[methodName];
            if (typeof originalMethod === 'function') {
                this[methodName] = this.createDebugWrapper(
                    methodName,
                    originalMethod
                );
            }
        });
    }

    createDebugWrapper(methodName, originalMethod) {
        return async function (...args) {
            const startTime = performance.now();

            this.logWithFallback('debug', `[DEBUG] Calling ${methodName}`, {
                args: args.length > 0 ? args : undefined,
                timestamp: new Date().toISOString(),
            });

            try {
                const result = await originalMethod.apply(this, args);
                const endTime = performance.now();
                const duration = endTime - startTime;

                // Track performance metrics
                if (!this.performanceMetrics.has(methodName)) {
                    this.performanceMetrics.set(methodName, {
                        totalTime: 0,
                        callCount: 0,
                        lastCall: null,
                    });
                }

                const metrics = this.performanceMetrics.get(methodName);
                metrics.totalTime += duration;
                metrics.callCount += 1;
                metrics.lastCall = new Date().toISOString();

                this.logWithFallback(
                    'debug',
                    `[DEBUG] ${methodName} completed`,
                    {
                        duration: `${duration.toFixed(2)}ms`,
                        result: typeof result,
                        success: true,
                    }
                );

                return result;
            } catch (error) {
                const endTime = performance.now();
                const duration = endTime - startTime;

                this.logWithFallback('error', `[DEBUG] ${methodName} failed`, {
                    duration: `${duration.toFixed(2)}ms`,
                    error: error.message,
                    stack: error.stack,
                });

                throw error;
            }
        }.bind(this);
    }

    async forceReinitialization() {
        this.logWithFallback('info', '[DEBUG] Forcing reinitialization');

        try {
            await this.cleanup();
            const result = await this.initialize();
            this.logWithFallback(
                'info',
                '[DEBUG] Forced reinitialization result',
                { success: result }
            );
            return result;
        } catch (error) {
            this.logWithFallback(
                'error',
                '[DEBUG] Forced reinitialization failed',
                { error }
            );
            throw error;
        }
    }

    // Enhanced logging with stack traces in debug mode
    logWithFallback(level, message, data = {}) {
        if (this.debugMode && level === 'debug') {
            // Add stack trace for debug messages in debug mode
            data.stack = new Error().stack;
        }

        super.logWithFallback(level, message, data);

        // Also log to console in debug mode for easier debugging
        if (this.debugMode) {
            console.log(
                `[${this.logPrefix}] [${level.toUpperCase()}] ${message}`,
                data
            );
        }
    }
}
```

### Browser DevTools Integration

```javascript
// Add this to your content script for enhanced debugging
if (typeof window !== 'undefined') {
    // Create debug utilities
    window.dualsubDebugUtils = {
        // Get current content script instance
        getContentScript: () => {
            return window.dualsubDebug?.contentScript;
        },

        // Inspect current state
        inspectState: () => {
            const cs = window.dualsubDebug?.contentScript;
            if (cs) {
                console.table(cs.getDebugState());
            } else {
                console.log(
                    'Content script not available or debug mode not enabled'
                );
            }
        },

        // Monitor performance
        showPerformanceMetrics: () => {
            const cs = window.dualsubDebug?.contentScript;
            if (cs) {
                console.table(cs.getPerformanceMetrics());
            }
        },

        // Force reinitialization
        reinitialize: () => {
            const cs = window.dualsubDebug?.contentScript;
            if (cs) {
                return cs.forceReinitialization();
            }
        },
    };

    console.log(
        'DualSub debug utilities available at window.dualsubDebugUtils'
    );
}
```

These examples demonstrate the flexibility and power of the BaseContentScript architecture. You can mix and match these patterns based on your specific platform requirements and use cases.
