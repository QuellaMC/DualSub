# Content Scripts Examples

This document provides practical examples of implementing and using the content script architecture.

## Table of Contents

1. [Basic Platform Implementation](#basic-platform-implementation)
2. [Advanced Navigation Detection](#advanced-navigation-detection)
3. [Custom Message Handling](#custom-message-handling)
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
            eventId: 'streamingservice-dualsub-injector-event'
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
        this.logWithFallback('info', 'Setting up StreamingService navigation detection');
        
        // Basic interval-based detection
        this.intervalManager.set(
            'urlChangeCheck',
            () => this.checkForUrlChange(),
            1000
        );
        
        this.logWithFallback('info', 'StreamingService navigation detection set up');
    }

    checkForUrlChange() {
        try {
            const newUrl = window.location.href;
            const newPathname = window.location.pathname;

            if (newUrl !== this.currentUrl || newPathname !== this.lastKnownPathname) {
                this.logWithFallback('info', 'URL change detected', {
                    from: this.currentUrl,
                    to: newUrl,
                });

                this.currentUrl = newUrl;
                this.lastKnownPathname = newPathname;

                // Simple player page detection
                const isPlayerPage = newPathname.includes('/watch/');
                if (isPlayerPage && this.currentConfig.subtitlesEnabled) {
                    this.initializePlatform();
                }
            }
        } catch (error) {
            this.logWithFallback('error', 'Error in URL change detection', { error });
        }
    }

    handlePlatformSpecificMessage(request, sendResponse) {
        // No platform-specific messages for this simple example
        sendResponse({ 
            success: true, 
            handled: false,
            platform: 'streamingservice',
            message: 'No platform-specific handling required'
        });
        return false;
    }
}
```

### Entry Point Example

```javascript
// streamingServiceContent.js
(async () => {
    try {
        const { StreamingServiceContentScript } = await import('./StreamingServiceContentScript.js');
        const contentScript = new StreamingServiceContentScript();
        const success = await contentScript.initialize();
        
        if (success) {
            console.log('[StreamingServiceContent] Content script initialized successfully');
        } else {
            console.error('[StreamingServiceContent] Content script initialization failed');
        }
    } catch (error) {
        console.error('[StreamingServiceContent] Error during initialization:', error);
    }
})();
```

## Advanced Navigation Detection

### Complex SPA Navigation (Netflix-style)

```javascript
export class ComplexSPAContentScript extends BaseContentScript {
    setupNavigationDetection() {
        this.logWithFallback('info', 'Setting up complex SPA navigation detection');

        // Method 1: Interval-based checking (fallback)
        this._setupIntervalBasedDetection();

        // Method 2: History API interception
        this._setupHistoryAPIInterception();

        // Method 3: Browser navigation events
        this._setupBrowserNavigationEvents();

        // Method 4: Focus and visibility events
        this._setupFocusAndVisibilityEvents();

        // Method 5: Custom DOM mutation observer
        this._setupDOMObserver();

        this.logWithFallback('info', 'Complex SPA navigation detection set up');
    }

    _setupIntervalBasedDetection() {
        this.intervalManager.set(
            'urlChangeCheck',
            () => this.checkForUrlChange(),
            2000 // Check every 2 seconds for complex SPAs
        );
    }

    _setupHistoryAPIInterception() {
        const originalPushState = history.pushState;
        const originalReplaceState = history.replaceState;

        // Enhanced pushState interception with error handling
        history.pushState = (...args) => {
            try {
                originalPushState.apply(history, args);
                // Delayed check to allow DOM updates
                setTimeout(() => this.checkForUrlChange(), 200);
            } catch (error) {
                this.logWithFallback('error', 'Error in pushState interception', { error });
                originalPushState.apply(history, args);
            }
        };

        // Enhanced replaceState interception
        history.replaceState = (...args) => {
            try {
                originalReplaceState.apply(history, args);
                setTimeout(() => this.checkForUrlChange(), 200);
            } catch (error) {
                this.logWithFallback('error', 'Error in replaceState interception', { error });
                originalReplaceState.apply(history, args);
            }
        };

        this._originalHistoryMethods = {
            pushState: originalPushState,
            replaceState: originalReplaceState
        };
    }

    _setupBrowserNavigationEvents() {
        const events = [
            { name: 'popstate', delay: 100 },
            { name: 'hashchange', delay: 100 },
            { name: 'beforeunload', delay: 0 }
        ];

        events.forEach(({ name, delay }) => {
            const handler = () => {
                if (delay > 0) {
                    setTimeout(() => this.checkForUrlChange(), delay);
                } else {
                    this.checkForUrlChange();
                }
            };
            
            const options = this.abortController ? { signal: this.abortController.signal } : {};
            window.addEventListener(name, handler, options);
            
            this.logWithFallback('debug', `Added ${name} event listener`);
        });
    }

    _setupFocusAndVisibilityEvents() {
        const focusHandler = () => {
            // Check for changes when user returns to tab
            setTimeout(() => this.checkForUrlChange(), 100);
        };
        
        const options = this.abortController ? { signal: this.abortController.signal } : {};
        
        window.addEventListener('focus', focusHandler, options);
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                focusHandler();
            }
        }, options);

        this.logWithFallback('debug', 'Added focus and visibility event listeners');
    }

    _setupDOMObserver() {
        // Observe changes to specific elements that indicate navigation
        const targetNode = document.body;
        const config = { 
            childList: true, 
            subtree: true, 
            attributes: true,
            attributeFilter: ['data-page-id', 'data-route'] // Platform-specific attributes
        };

        const callback = (mutationsList) => {
            for (const mutation of mutationsList) {
                if (mutation.type === 'attributes' || 
                    (mutation.type === 'childList' && mutation.addedNodes.length > 0)) {
                    // Debounce the URL check
                    clearTimeout(this._domObserverTimeout);
                    this._domObserverTimeout = setTimeout(() => {
                        this.checkForUrlChange();
                    }, 500);
                    break;
                }
            }
        };

        if (targetNode) {
            this.domObserver = new MutationObserver(callback);
            this.domObserver.observe(targetNode, config);
            this.logWithFallback('debug', 'DOM mutation observer set up');
        }
    }

    checkForUrlChange() {
        try {
            const newUrl = window.location.href;
            const newPathname = window.location.pathname;

            if (newUrl !== this.currentUrl || newPathname !== this.lastKnownPathname) {
                this.logWithFallback('info', 'URL change detected', {
                    from: this.currentUrl,
                    to: newUrl,
                    pathname: newPathname
                });

                // Enhanced page type detection
                const wasOnPlayerPage = this._isPlayerPath(this.lastKnownPathname);
                const isOnPlayerPage = this._isPlayerPath(newPathname);
                const wasOnHomePage = this._isHomePath(this.lastKnownPathname);
                const isOnHomePage = this._isHomePath(newPathname);

                this.currentUrl = newUrl;
                this.lastKnownPathname = newPathname;

                // Handle different types of transitions
                this._handleComplexPageTransition({
                    wasOnPlayerPage,
                    isOnPlayerPage,
                    wasOnHomePage,
                    isOnHomePage
                });
            }
        } catch (error) {
            this.logWithFallback('error', 'Error in complex URL change detection', { error });
            this._handleExtensionContextError(error);
        }
    }

    _handleComplexPageTransition(transitionInfo) {
        const { wasOnPlayerPage, isOnPlayerPage, wasOnHomePage, isOnHomePage } = transitionInfo;

        if (wasOnPlayerPage && !isOnPlayerPage) {
            this.logWithFallback('info', 'Leaving player page');
            this._cleanupOnPageLeave();
        }

        if (!wasOnPlayerPage && isOnPlayerPage) {
            this.logWithFallback('info', 'Entering player page');
            this._initializeOnPageEnter();
        }

        if (wasOnHomePage && !isOnHomePage) {
            this.logWithFallback('debug', 'Leaving home page');
            // Perform any home page cleanup
        }

        if (!wasOnHomePage && isOnHomePage) {
            this.logWithFallback('debug', 'Entering home page');
            // Perform any home page initialization
        }
    }

    _isPlayerPath(pathname) {
        return pathname.includes('/watch/') || 
               pathname.includes('/play/') || 
               pathname.includes('/video/');
    }

    _isHomePath(pathname) {
        return pathname === '/' || 
               pathname === '/home' || 
               pathname === '/browse';
    }
}
```

## Custom Message Handling

### Platform-Specific Message Handlers

```javascript
export class CustomMessageContentScript extends BaseContentScript {
    constructor() {
        super('CustomMessageContent');
        // Register custom message handlers after parent initialization
        this.registerCustomMessageHandlers();
    }

    registerCustomMessageHandlers() {
        // Register a custom message handler
        this.registerMessageHandler(
            'customPlatformAction',
            this.handleCustomPlatformAction.bind(this),
            {
                requiresUtilities: true,
                description: 'Handle custom platform-specific action'
            }
        );

        // Register another handler that doesn't require utilities
        this.registerMessageHandler(
            'quickStatusCheck',
            this.handleQuickStatusCheck.bind(this),
            {
                requiresUtilities: false,
                description: 'Quick status check without utility dependencies'
            }
        );
    }

    async handleCustomPlatformAction(request, sendResponse) {
        try {
            this.logWithFallback('info', 'Handling custom platform action', {
                action: request.action,
                data: request.data
            });

            // Perform custom logic
            const result = await this._performCustomAction(request.data);

            sendResponse({
                success: true,
                platform: this.getPlatformName(),
                action: request.action,
                result: result
            });

            return true; // Async handling
        } catch (error) {
            this.logWithFallback('error', 'Error in custom platform action', {
                error: error.message,
                action: request.action
            });

            sendResponse({
                success: false,
                error: error.message,
                platform: this.getPlatformName()
            });

            return false; // Error handling is synchronous
        }
    }

    handleQuickStatusCheck(request, sendResponse) {
        // Quick synchronous status check
        const status = {
            platform: this.getPlatformName(),
            isPlayerPage: this._isPlayerPath(window.location.pathname),
            platformReady: this.platformReady,
            currentUrl: this.currentUrl,
            timestamp: Date.now()
        };

        sendResponse({
            success: true,
            status: status
        });

        return false; // Synchronous handling
    }

    async _performCustomAction(data) {
        // Example custom action implementation
        switch (data.type) {
            case 'refreshSubtitles':
                if (this.activePlatform && this.activePlatform.refreshSubtitles) {
                    return await this.activePlatform.refreshSubtitles();
                }
                throw new Error('Platform not ready or method not available');

            case 'getVideoInfo':
                return this._getVideoInfo();

            case 'updateSettings':
                return await this._updatePlatformSettings(data.settings);

            default:
                throw new Error(`Unknown custom action type: ${data.type}`);
        }
    }

    _getVideoInfo() {
        // Extract video information from the page
        const videoElement = document.querySelector('video');
        if (!videoElement) {
            return { error: 'No video element found' };
        }

        return {
            duration: videoElement.duration,
            currentTime: videoElement.currentTime,
            paused: videoElement.paused,
            volume: videoElement.volume,
            src: videoElement.src || videoElement.currentSrc
        };
    }

    async _updatePlatformSettings(settings) {
        // Update platform-specific settings
        if (this.activePlatform && this.activePlatform.updateSettings) {
            return await this.activePlatform.updateSettings(settings);
        }
        throw new Error('Platform not ready or settings update not supported');
    }

    handlePlatformSpecificMessage(request, sendResponse) {
        // This method is still required but can delegate to registered handlers
        const action = request.action || request.type;
        
        // Check if we have a registered handler
        if (this.hasMessageHandler(action)) {
            // The message will be handled by the registered handler
            // This method should return false to indicate no additional handling
            return false;
        }

        // Handle any messages not covered by registered handlers
        switch (action) {
            case 'legacyAction':
                return this._handleLegacyAction(request, sendResponse);
            
            default:
                sendResponse({ 
                    success: true, 
                    handled: false,
                    platform: this.getPlatformName(),
                    message: 'No platform-specific handling required'
                });
                return false;
        }
    }
}
```

### Message Handler Registry Usage

```javascript
// Example of using the message handler registry
export class AdvancedMessageHandling extends BaseContentScript {
    constructor() {
        super('AdvancedContent');
        this.setupAdvancedMessageHandling();
    }

    setupAdvancedMessageHandling() {
        // Register multiple handlers with different configurations
        const handlers = [
            {
                action: 'batchOperation',
                handler: this.handleBatchOperation.bind(this),
                options: { requiresUtilities: true, description: 'Handle batch operations' }
            },
            {
                action: 'diagnostics',
                handler: this.handleDiagnostics.bind(this),
                options: { requiresUtilities: false, description: 'System diagnostics' }
            },
            {
                action: 'emergencyStop',
                handler: this.handleEmergencyStop.bind(this),
                options: { requiresUtilities: false, description: 'Emergency stop all operations' }
            }
        ];

        handlers.forEach(({ action, handler, options }) => {
            this.registerMessageHandler(action, handler, options);
        });

        this.logWithFallback('info', 'Advanced message handlers registered', {
            handlerCount: handlers.length,
            handlers: this.getRegisteredHandlers()
        });
    }

    async handleBatchOperation(request, sendResponse) {
        const operations = request.data.operations || [];
        const results = [];

        for (const operation of operations) {
            try {
                const result = await this._executeOperation(operation);
                results.push({ success: true, operation, result });
            } catch (error) {
                results.push({ success: false, operation, error: error.message });
            }
        }

        sendResponse({
            success: true,
            batchResults: results,
            totalOperations: operations.length,
            successCount: results.filter(r => r.success).length
        });

        return true; // Async handling
    }

    handleDiagnostics(request, sendResponse) {
        const diagnostics = {
            platform: this.getPlatformName(),
            registeredHandlers: this.getRegisteredHandlers().length,
            platformReady: this.platformReady,
            moduleStatus: {
                logger: !!this.contentLogger,
                configService: !!this.configService,
                subtitleUtils: !!this.subtitleUtils,
                platformClass: !!this.PlatformClass
            },
            intervals: this.intervalManager.getActiveIntervals(),
            currentConfig: Object.keys(this.currentConfig),
            timestamp: new Date().toISOString()
        };

        sendResponse({
            success: true,
            diagnostics: diagnostics
        });

        return false; // Synchronous handling
    }

    handleEmergencyStop(request, sendResponse) {
        this.logWithFallback('warn', 'Emergency stop requested');

        try {
            // Stop all intervals
            this.intervalManager.clearAll();

            // Cleanup platform
            if (this.activePlatform && this.activePlatform.cleanup) {
                this.activePlatform.cleanup();
            }

            // Clear event buffer
            this.eventBuffer.clear();

            // Reset state
            this.platformReady = false;

            sendResponse({
                success: true,
                message: 'Emergency stop completed',
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            sendResponse({
                success: false,
                error: error.message,
                message: 'Emergency stop failed'
            });
        }

        return false; // Synchronous handling
    }
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
        this.configChangeHandlers.set('subtitlesEnabled', this.handleSubtitlesEnabledChange.bind(this));
        this.configChangeHandlers.set('translationProvider', this.handleTranslationProviderChange.bind(this));
        this.configChangeHandlers.set('subtitlePosition', this.handleSubtitlePositionChange.bind(this));
        this.configChangeHandlers.set('loggingLevel', this.handleLoggingLevelChange.bind(this));
    }

    async handleConfigChanged(request, sendResponse) {
        try {
            const { changes, newConfig } = request.data;
            
            this.logWithFallback('info', 'Configuration change detected', {
                changes: Object.keys(changes),
                changeCount: Object.keys(changes).length
            });

            // Update current config
            this.currentConfig = { ...this.currentConfig, ...newConfig };

            // Process each change with specific handlers
            const results = {};
            for (const [key, change] of Object.entries(changes)) {
                if (this.configChangeHandlers.has(key)) {
                    try {
                        const handler = this.configChangeHandlers.get(key);
                        const result = await handler(change.newValue, change.oldValue);
                        results[key] = { success: true, result };
                    } catch (error) {
                        results[key] = { success: false, error: error.message };
                        this.logWithFallback('error', `Error handling config change for ${key}`, {
                            error: error.message,
                            newValue: change.newValue,
                            oldValue: change.oldValue
                        });
                    }
                } else {
                    // Generic handling for unspecified changes
                    results[key] = await this.handleGenericConfigChange(key, change);
                }
            }

            // Apply changes to platform if ready
            if (this.activePlatform && this.activePlatform.applyConfigurationChanges) {
                await this.activePlatform.applyConfigurationChanges(changes);
            }

            sendResponse({
                success: true,
                platform: this.getPlatformName(),
                results: results,
                appliedChanges: Object.keys(changes)
            });

            return true; // Async handling
        } catch (error) {
            this.logWithFallback('error', 'Error in configuration change handling', {
                error: error.message,
                stack: error.stack
            });

            sendResponse({
                success: false,
                error: error.message,
                platform: this.getPlatformName()
            });

            return false;
        }
    }

    async handleSubtitlesEnabledChange(newValue, oldValue) {
        this.logWithFallback('info', 'Subtitles enabled state changed', {
            from: oldValue,
            to: newValue
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
            to: newValue
        });

        if (this.activePlatform && this.activePlatform.updateTranslationProvider) {
            await this.activePlatform.updateTranslationProvider(newValue);
            return `Translation provider updated to ${newValue}`;
        }

        return 'Translation provider change noted, will apply on next initialization';
    }

    async handleSubtitlePositionChange(newValue, oldValue) {
        this.logWithFallback('info', 'Subtitle position changed', {
            from: oldValue,
            to: newValue
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
                to: newValue
            });
            return `Logging level updated to ${newValue}`;
        }

        return 'Logging level change noted';
    }

    async handleGenericConfigChange(key, change) {
        this.logWithFallback('debug', 'Generic config change handling', {
            key,
            newValue: change.newValue,
            oldValue: change.oldValue
        });

        // Apply generic change to platform if it supports it
        if (this.activePlatform && this.activePlatform.updateConfig) {
            try {
                await this.activePlatform.updateConfig(key, change.newValue);
                return { success: true, result: `Generic update applied for ${key}` };
            } catch (error) {
                return { success: false, error: error.message };
            }
        }

        return { success: true, result: 'Change noted, no specific handler available' };
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
        this.errorRecoveryStrategies.set('ModuleLoadError', this.recoverFromModuleLoadError.bind(this));
        this.errorRecoveryStrategies.set('PlatformInitError', this.recoverFromPlatformInitError.bind(this));
        this.errorRecoveryStrategies.set('ExtensionContextError', this.recoverFromExtensionContextError.bind(this));
        this.errorRecoveryStrategies.set('VideoDetectionError', this.recoverFromVideoDetectionError.bind(this));
    }

    async initializePlatform(retryCount = 0) {
        const maxRetries = 3;
        const retryDelay = 1000 * Math.pow(2, retryCount); // Exponential backoff

        try {
            this.logWithFallback('info', 'Attempting platform initialization', {
                attempt: retryCount + 1,
                maxRetries: maxRetries + 1
            });

            // Call parent implementation
            const success = await super.initializePlatform(retryCount);
            
            if (success) {
                this.logWithFallback('info', 'Platform initialization successful');
                return true;
            } else {
                throw new Error('Platform initialization failed');
            }
        } catch (error) {
            this.logWithFallback('error', 'Platform initialization error', {
                error: error.message,
                attempt: retryCount + 1,
                willRetry: retryCount < maxRetries
            });

            // Try error recovery
            const recovered = await this.attemptErrorRecovery(error, 'PlatformInitError');
            
            if (recovered && retryCount < maxRetries) {
                this.logWithFallback('info', 'Retrying platform initialization after recovery', {
                    delay: retryDelay
                });
                
                await this.delay(retryDelay);
                return this.initializePlatform(retryCount + 1);
            }

            this.logWithFallback('error', 'Platform initialization failed permanently', {
                totalAttempts: retryCount + 1,
                finalError: error.message
            });
            
            return false;
        }
    }

    async attemptErrorRecovery(error, errorType) {
        try {
            if (this.errorRecoveryStrategies.has(errorType)) {
                const recoveryStrategy = this.errorRecoveryStrategies.get(errorType);
                const recovered = await recoveryStrategy(error);
                
                this.logWithFallback('info', 'Error recovery attempted', {
                    errorType,
                    recovered,
                    error: error.message
                });
                
                return recovered;
            }
            
            return false;
        } catch (recoveryError) {
            this.logWithFallback('error', 'Error recovery failed', {
                originalError: error.message,
                recoveryError: recoveryError.message
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
                recoveryError: recoveryError.message
            });
            return false;
        }
    }

    async recoverFromPlatformInitError(error) {
        this.logWithFallback('info', 'Attempting platform initialization error recovery');
        
        try {
            // Clean up any partial initialization
            if (this.activePlatform) {
                try {
                    await this.activePlatform.cleanup();
                } catch (cleanupError) {
                    this.logWithFallback('warn', 'Error during cleanup', { cleanupError });
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
                recoveryError: recoveryError.message
            });
            return false;
        }
    }

    async recoverFromExtensionContextError(error) {
        this.logWithFallback('info', 'Attempting extension context error recovery');
        
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
                recoveryError: recoveryError.message
            });
            return false;
        }
    }

    async recoverFromVideoDetectionError(error) {
        this.logWithFallback('info', 'Attempting video detection error recovery');
        
        try {
            // Reset video detection state
            this.videoDetectionRetries = 0;
            this.stopVideoElementDetection();

            // Wait for DOM to stabilize
            await this.delay(1000);

            // Try alternative video detection methods
            const videoElement = this.findVideoElementAlternative();
            if (videoElement) {
                this.logWithFallback('info', 'Alternative video detection successful');
                return true;
            }

            return false;
        } catch (recoveryError) {
            this.logWithFallback('error', 'Video detection recovery failed', {
                recoveryError: recoveryError.message
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
            '.video-player video'
        ];

        for (const selector of selectors) {
            try {
                const element = document.querySelector(selector);
                if (element && element.tagName.toLowerCase() === 'video') {
                    this.logWithFallback('debug', 'Found video element with alternative selector', {
                        selector
                    });
                    return element;
                }
            } catch (selectorError) {
                // Continue to next selector
            }
        }

        return null;
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
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
                this.logWithFallback('warn', 'Module loading failed, retrying', {
                    attempt: attempt + 1,
                    maxRetries,
                    error: error.message
                });

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
import { setupMockEnvironment, cleanupMockEnvironment } from '../../test-utils/test-helpers.js';

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
                configService: { getAll: jest.fn().mockResolvedValue({}) }
            });

            const result = await contentScript.initialize();
            expect(result).toBe(true);
            expect(contentScript.contentLogger).toBeDefined();
        });

        test('should handle module loading failures gracefully', async () => {
            // Mock module loading failure
            mockEnvironment.mockModuleLoader.mockRejectedValue(new Error('Module load failed'));

            const result = await contentScript.initialize();
            expect(result).toBe(false);
        });
    });

    describe('Message Handling', () => {
        test('should register custom message handlers', () => {
            expect(contentScript.hasMessageHandler('customAction')).toBe(true);
            expect(contentScript.getRegisteredHandlers()).toHaveLength(4); // 3 common + 1 custom
        });

        test('should handle custom messages correctly', async () => {
            const request = { action: 'customAction', data: { test: 'data' } };
            const sendResponse = jest.fn();

            const result = await contentScript.handleChromeMessage(request, {}, sendResponse);
            
            expect(sendResponse).toHaveBeenCalledWith(
                expect.objectContaining({
                    success: true,
                    platform: 'custom'
                })
            );
        });
    });

    describe('Navigation Detection', () => {
        test('should detect URL changes correctly', () => {
            const spy = jest.spyOn(contentScript, '_handlePageTransition');
            
            // Mock URL change
            Object.defineProperty(window, 'location', {
                value: { href: 'https://example.com/watch/123', pathname: '/watch/123' },
                writable: true
            });

            contentScript.checkForUrlChange();
            
            expect(spy).toHaveBeenCalled();
        });

        test('should handle navigation errors gracefully', () => {
            // Mock location access error
            Object.defineProperty(window, 'location', {
                get: () => { throw new Error('Location access denied'); }
            });

            expect(() => contentScript.checkForUrlChange()).not.toThrow();
        });
    });

    describe('Error Recovery', () => {
        test('should recover from platform initialization errors', async () => {
            const spy = jest.spyOn(contentScript, 'attemptErrorRecovery');
            
            // Mock platform initialization failure
            jest.spyOn(contentScript, 'initializePlatform').mockRejectedValueOnce(new Error('Init failed'));
            
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

    test('should handle configuration changes end-to-end', async () => {
        await contentScript.initialize();
        
        const configChange = {
            action: 'configChanged',
            data: {
                changes: { subtitlesEnabled: { newValue: false, oldValue: true } },
                newConfig: { subtitlesEnabled: false }
            }
        };
        
        const sendResponse = jest.fn();
        await contentScript.handleChromeMessage(configChange, {}, sendResponse);
        
        expect(sendResponse).toHaveBeenCalledWith(
            expect.objectContaining({ success: true })
        );
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
        this.debugMode = urlParams.has('debug') || localStorage.getItem('dualsub-debug') === 'true';

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
            testMessage: (action, data) => this.testMessage(action, data),
            forceReinitialization: () => this.forceReinitialization()
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
                activePlatform: !!this.activePlatform
            },
            registeredHandlers: this.getRegisteredHandlers(),
            activeIntervals: this.intervalManager.getActiveIntervals(),
            eventBufferSize: this.eventBuffer.size(),
            currentConfig: this.currentConfig,
            isCleanedUp: this.isCleanedUp
        };
    }

    getPerformanceMetrics() {
        const metrics = {};
        for (const [key, value] of this.performanceMetrics.entries()) {
            metrics[key] = {
                totalTime: value.totalTime,
                callCount: value.callCount,
                averageTime: value.totalTime / value.callCount,
                lastCall: value.lastCall
            };
        }
        return metrics;
    }

    wrapMethodsForDebugging() {
        const methodsToWrap = [
            'initialize',
            'loadModules',
            'initializePlatform',
            'checkForUrlChange',
            'handleChromeMessage'
        ];

        methodsToWrap.forEach(methodName => {
            const originalMethod = this[methodName];
            if (typeof originalMethod === 'function') {
                this[methodName] = this.createDebugWrapper(methodName, originalMethod);
            }
        });
    }

    createDebugWrapper(methodName, originalMethod) {
        return async function(...args) {
            const startTime = performance.now();
            
            this.logWithFallback('debug', `[DEBUG] Calling ${methodName}`, {
                args: args.length > 0 ? args : undefined,
                timestamp: new Date().toISOString()
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
                        lastCall: null
                    });
                }

                const metrics = this.performanceMetrics.get(methodName);
                metrics.totalTime += duration;
                metrics.callCount += 1;
                metrics.lastCall = new Date().toISOString();

                this.logWithFallback('debug', `[DEBUG] ${methodName} completed`, {
                    duration: `${duration.toFixed(2)}ms`,
                    result: typeof result,
                    success: true
                });

                return result;
            } catch (error) {
                const endTime = performance.now();
                const duration = endTime - startTime;

                this.logWithFallback('error', `[DEBUG] ${methodName} failed`, {
                    duration: `${duration.toFixed(2)}ms`,
                    error: error.message,
                    stack: error.stack
                });

                throw error;
            }
        }.bind(this);
    }

    testMessage(action, data = {}) {
        const request = { action, data, timestamp: Date.now() };
        const sendResponse = (response) => {
            console.log('[DEBUG] Test message response:', response);
        };

        this.logWithFallback('info', '[DEBUG] Testing message', { request });
        return this.handleChromeMessage(request, {}, sendResponse);
    }

    async forceReinitialization() {
        this.logWithFallback('info', '[DEBUG] Forcing reinitialization');
        
        try {
            await this.cleanup();
            const result = await this.initialize();
            this.logWithFallback('info', '[DEBUG] Forced reinitialization result', { success: result });
            return result;
        } catch (error) {
            this.logWithFallback('error', '[DEBUG] Forced reinitialization failed', { error });
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
            console.log(`[${this.logPrefix}] [${level.toUpperCase()}] ${message}`, data);
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
                console.log('Content script not available or debug mode not enabled');
            }
        },

        // Test specific functionality
        testSubtitleToggle: () => {
            const cs = window.dualsubDebug?.contentScript;
            if (cs) {
                return cs.testMessage('toggleSubtitles', { enabled: true });
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
        }
    };

    console.log('DualSub debug utilities available at window.dualsubDebugUtils');
}
```

These examples demonstrate the flexibility and power of the BaseContentScript architecture. You can mix and match these patterns based on your specific platform requirements and use cases.