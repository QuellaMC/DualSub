/**
 * NetflixContentScript - Netflix-specific content script extending BaseContentScript
 * 
 * This class implements Netflix-specific functionality including navigation detection,
 * injection configuration, and platform-specific message handling while leveraging
 * the common functionality provided by BaseContentScript.
 * 
 * @extends BaseContentScript
 * @author DualSub Extension
 * @version 1.0.0
 */

import { BaseContentScript } from '../core/BaseContentScript.js';

export class NetflixContentScript extends BaseContentScript {
    /**
     * Creates a new NetflixContentScript instance
     */
    constructor() {
        super('NetflixContent');
        this._initializeNetflixSpecificState();
    }

    /**
     * Initialize Netflix-specific state properties
     * @private
     */
    _initializeNetflixSpecificState() {
        // Netflix-specific injection configuration
        this.injectConfig = {
            filename: 'injected_scripts/netflixInject.js',
            tagId: 'netflix-dualsub-injector-script-tag',
            eventId: 'netflix-dualsub-injector-event'
        };

        // Netflix URL patterns for platform detection
        this.urlPatterns = ['*.netflix.com'];
    }

    // ========================================
    // ABSTRACT METHOD IMPLEMENTATIONS - Required by BaseContentScript
    // ========================================

    /**
     * Get the platform name
     * @returns {string} Platform name
     */
    getPlatformName() {
        return 'netflix';
    }

    /**
     * Get the platform class constructor
     * @returns {Function} Platform class constructor
     */
    getPlatformClass() {
        // This will be loaded dynamically by BaseContentScript
        // The actual class will be available as this.PlatformClass after loadModules()
        return 'NetflixPlatform';
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
     * Setup Netflix-specific navigation detection
     * Netflix requires enhanced navigation detection due to complex SPA routing
     */
    setupNavigationDetection() {
        this.logWithFallback('info', 'Setting up Netflix-specific navigation detection');

        // Method 1: Interval-based URL checking (fallback)
        this._setupIntervalBasedDetection();

        // Method 2: History API interception (for programmatic navigation)
        this._setupHistoryAPIInterception();

        // Method 3: Browser navigation events
        this._setupBrowserNavigationEvents();

        // Method 4: Focus and visibility events
        this._setupFocusAndVisibilityEvents();

        this.logWithFallback('info', 'Enhanced Netflix navigation detection set up');
    }

    /**
     * Check for URL changes with Netflix-specific logic
     * Enhanced URL change detection with extension context error handling
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

                const wasOnPlayerPage = this.lastKnownPathname.includes('/watch/');
                const isOnPlayerPage = newPathname.includes('/watch/');

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
     * Implements Netflix-specific message handling while ensuring backward compatibility
     * with existing Chrome message API used by popup and options pages
     * @param {Object} request - Chrome message request
     * @param {Function} sendResponse - Response callback
     * @returns {boolean} Whether response is handled asynchronously
     */
    handlePlatformSpecificMessage(request, sendResponse) {
        try {
            const action = request.action || request.type;
            
            this.logWithFallback('debug', 'Processing Netflix-specific message', {
                action,
                hasRequest: !!request,
                requestKeys: Object.keys(request || {})
            });

            // Netflix currently doesn't have platform-specific messages beyond the common ones
            // All standard messages (toggleSubtitles, configChanged, LOGGING_LEVEL_CHANGED) 
            // are handled by BaseContentScript's registered handlers
            
            // Handle any future Netflix-specific message types here
            switch (action) {
                // Example of how to handle Netflix-specific messages in the future:
                // case 'netflix-specific-action':
                //     return this._handleNetflixSpecificAction(request, sendResponse);
                
                default:
                    // No Netflix-specific handling needed for this message
                    this.logWithFallback('debug', 'No Netflix-specific handling required', {
                        action,
                        message: 'Delegating to default handling or returning success'
                    });
                    
                    // Ensure backward compatibility by providing a successful response
                    sendResponse({ 
                        success: true, 
                        handled: false,
                        platform: 'netflix',
                        message: 'No platform-specific handling required'
                    });
                    return false; // Synchronous handling
            }
        } catch (error) {
            const action = request ? (request.action || request.type) : 'unknown';
            
            this.logWithFallback('error', 'Error in Netflix-specific message handling', {
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
                        platform: 'netflix'
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

    /**
     * Example method for handling Netflix-specific actions (for future use)
     * @private
     * @param {Object} request - Chrome message request
     * @param {Function} sendResponse - Response callback
     * @returns {boolean} Whether response is handled asynchronously
     */
    _handleNetflixSpecificAction(request, sendResponse) {
        // Example implementation for future Netflix-specific functionality
        this.logWithFallback('info', 'Handling Netflix-specific action', {
            action: request.action,
            data: request.data
        });
        
        // Perform Netflix-specific logic here
        // For example: Netflix-specific subtitle format handling, 
        // Netflix-specific navigation events, etc.
        
        sendResponse({
            success: true,
            platform: 'netflix',
            action: request.action,
            result: 'Netflix-specific action completed'
        });
        
        return false; // Synchronous handling
    }

    // ========================================
    // NETFLIX-SPECIFIC NAVIGATION DETECTION METHODS
    // ========================================

    /**
     * Setup interval-based URL change detection
     * @private
     */
    _setupIntervalBasedDetection() {
        this.intervalManager.set(
            'urlChangeCheck',
            () => this.checkForUrlChange(),
            1000 // Check every second for Netflix
        );
    }

    /**
     * Setup History API interception for programmatic navigation
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
            
            // Add event listener with AbortController signal if available
            const options = this.abortController ? { signal: this.abortController.signal } : {};
            window.addEventListener(name, handler, options);
            
            this.logWithFallback('debug', `Added ${name} event listener for navigation detection`);
        });
    }

    /**
     * Setup focus and visibility event listeners
     * @private
     */
    _setupFocusAndVisibilityEvents() {
        const focusHandler = () => setTimeout(() => this.checkForUrlChange(), 100);
        
        // Add event listeners with AbortController signal if available
        const options = this.abortController ? { signal: this.abortController.signal } : {};
        window.addEventListener('focus', focusHandler, options);
        document.addEventListener('visibilitychange', focusHandler, options);

        this.logWithFallback('debug', 'Added focus and visibility event listeners for navigation detection');
    }

    /**
     * Handle page transitions between player and non-player pages
     * @private
     * @param {boolean} wasOnPlayerPage - Whether we were on a player page
     * @param {boolean} isOnPlayerPage - Whether we are now on a player page
     */
    _handlePageTransition(wasOnPlayerPage, isOnPlayerPage) {
        // Clean up existing platform if we're leaving a player page
        if (wasOnPlayerPage && this.activePlatform) {
            this.logWithFallback('info', 'Leaving player page, cleaning up platform');
            this._cleanupOnPageLeave();
        }

        // Initialize platform if we're entering a player page and subtitles are enabled
        if (isOnPlayerPage && !wasOnPlayerPage) {
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
        // Re-inject script immediately to catch subtitle data
        this._reinjectScript();

        // Check settings and initialize platform after a delay
        setTimeout(async () => {
            try {
                if (this.currentConfig && this.currentConfig.subtitlesEnabled) {
                    this.logWithFallback('info', 'Subtitles enabled, initializing platform');
                    await this.initializePlatform();
                }
            } catch (error) {
                this.logWithFallback('error', 'Error during URL change initialization', { error });
            }
        }, 1500); // Netflix needs more time for page transitions
    }

    /**
     * Re-inject script for new page
     * @private
     */
    _reinjectScript() {
        try {
            // Remove existing script if present
            const existingScript = document.getElementById(this.injectConfig.tagId);
            if (existingScript) {
                existingScript.remove();
            }

            // Inject new script
            const script = document.createElement('script');
            script.src = chrome.runtime.getURL(this.injectConfig.filename);
            script.id = this.injectConfig.tagId;

            const target = document.head || document.documentElement;
            if (target) {
                target.appendChild(script);
                script.onload = () => this.logWithFallback('info', 'Script re-injected successfully');
                script.onerror = (e) => this.logWithFallback('error', 'Failed to re-inject script', { error: e });
            }
        } catch (error) {
            this.logWithFallback('error', 'Error during script re-injection', { error });
        }
    }

    /**
     * Handle extension context errors
     * @private
     * @param {Error} error - The error that occurred
     */
    _handleExtensionContextError(error) {
        if (error.message && error.message.includes('Extension context invalidated')) {
            this.intervalManager.clear('urlChangeCheck');
            this.logWithFallback('info', 'Stopped URL change detection due to extension context invalidation');
        }
    }

    // ========================================
    // NETFLIX-SPECIFIC PLATFORM DETECTION
    // ========================================

    /**
     * Check if current page is a Netflix platform page
     * @returns {boolean} Whether we're on Netflix
     */
    isPlatformActive() {
        return window.location.hostname.includes('netflix.com');
    }

    /**
     * Check if current page is a Netflix player page
     * @returns {boolean} Whether we're on a Netflix player page
     */
    isPlayerPageActive() {
        return window.location.pathname.includes('/watch/');
    }

    /**
     * Get Netflix-specific URL patterns for platform detection
     * @returns {string[]} Array of URL patterns
     */
    getUrlPatterns() {
        return this.urlPatterns;
    }

    // ========================================
    // CLEANUP AND RESOURCE MANAGEMENT
    // ========================================

    /**
     * Cleanup Netflix-specific resources
     * @override
     */
    async cleanup() {
        try {
            // The urlChangeCheckInterval is now managed by intervalManager,
            // which is handled by the parent's cleanup method.

            // Restore original history methods
            if (this._originalHistoryMethods) {
                history.pushState = this._originalHistoryMethods.pushState;
                history.replaceState = this._originalHistoryMethods.replaceState;
                this._originalHistoryMethods = null;
            }

            // Call parent cleanup
            if (super.cleanup) {
                await super.cleanup();
            }

            this.logWithFallback('info', 'Netflix-specific cleanup completed');
        } catch (error) {
            this.logWithFallback('error', 'Error during Netflix-specific cleanup', { error });
            throw error;
        }
    }

    // ========================================
    // NETFLIX-SPECIFIC CONFIGURATION
    // ========================================

    /**
     * Get Netflix-specific configuration defaults
     * @returns {Object} Netflix-specific configuration
     */
    getNetflixSpecificConfig() {
        return {
            // Netflix requires more aggressive retry logic due to complex SPA behavior
            maxVideoDetectionRetries: 40, // 40 seconds max
            videoDetectionInterval: 1000, // Check every 1 second
            
            // Netflix navigation detection settings
            urlChangeCheckInterval: 2000, // Check URL changes every 2 seconds
            pageTransitionDelay: 1500, // Wait 1.5s after page transition
            
            // Netflix injection settings
            injectRetryDelay: 10, // Retry injection every 10ms if needed
            injectMaxRetries: 100 // Maximum injection attempts
        };
    }

    /**
     * Apply Netflix-specific configuration overrides
     * @param {Object} baseConfig - Base configuration
     * @returns {Object} Configuration with Netflix-specific overrides
     */
    applyNetflixConfigOverrides(baseConfig) {
        const netflixConfig = this.getNetflixSpecificConfig();
        
        return {
            ...baseConfig,
            ...netflixConfig,
            // Ensure Netflix-specific values take precedence
            platformName: this.getPlatformName(),
            injectConfig: this.getInjectScriptConfig(),
            urlPatterns: this.getUrlPatterns()
        };
    }
}