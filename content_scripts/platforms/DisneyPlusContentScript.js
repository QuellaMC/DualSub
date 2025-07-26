/**
 * DisneyPlusContentScript - Disney+ specific content script extending BaseContentScript
 * 
 * This class implements Disney+ specific functionality including navigation detection,
 * injection configuration, and platform-specific message handling while leveraging
 * the common functionality provided by BaseContentScript.
 * 
 * @extends BaseContentScript
 * @author DualSub Extension
 * @version 1.0.0
 */

import { BaseContentScript } from '../core/BaseContentScript.js';

export class DisneyPlusContentScript extends BaseContentScript {
    /**
     * Creates a new DisneyPlusContentScript instance
     */
    constructor() {
        super('DisneyPlusContent');
        this._initializeDisneyPlusSpecificState();

        // Inject the script and attach the early event listener immediately
        // so that we can capture subtitle data even before the full
        // initialization flow (configuration fetch, etc.) completes.
        // BaseContentScript is safe against duplicate calls later on.
        this.setupEarlyEventHandling();
    }

    /**
     * Initialize Disney+ specific state properties
     * @private
     */
    _initializeDisneyPlusSpecificState() {
        // Disney+ specific injection configuration
        this.injectConfig = {
            filename: 'injected_scripts/disneyPlusInject.js',
            tagId: 'disneyplus-dualsub-injector-script-tag',
            eventId: 'disneyplus-dualsub-injector-event'
        };

        // Disney+ URL patterns for platform detection
        this.urlPatterns = ['*.disneyplus.com'];
    }

    /**
     * Check if the current page is a video player page
     * @returns {boolean} - True if the page is a player page, false otherwise
     * @private
     */
    _isPlayerPage() {
        return this._isPlayerPath(window.location.pathname);
    }

    // ========================================
    // ABSTRACT METHOD IMPLEMENTATIONS - Required by BaseContentScript
    // ========================================

    /**
     * Get the platform name
     * @returns {string} Platform name
     */
    getPlatformName() {
        return 'disneyplus';
    }

    /**
     * Get the platform class constructor
     * @returns {Function} Platform class constructor
     */
    getPlatformClass() {
        // This will be loaded dynamically by BaseContentScript
        // The actual class will be available as this.PlatformClass after loadModules()
        return 'DisneyPlusPlatform';
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
     * Setup Disney+ specific navigation detection
     * Disney+ requires enhanced navigation detection due to complex SPA routing
     */
    setupNavigationDetection() {
        this.logWithFallback('info', 'Setting up Disney+ navigation detection');

        // Method 1: Interval-based URL checking (fallback)
        this._setupIntervalBasedDetection();

        // Method 2: History API interception (for programmatic navigation)
        this._setupHistoryAPIInterception();

        // Method 3: Browser navigation events
        this._setupBrowserNavigationEvents();

        // Method 4: Focus and visibility events
        this._setupFocusAndVisibilityEvents();

        this.logWithFallback('info', 'Enhanced Disney+ navigation detection set up');
    }

    /**
     * Check for URL changes with Disney+ specific logic
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
     * Check if a given path is a player page
     * @param {string} pathname - The URL pathname
     * @returns {boolean} True if it's a player page, false otherwise
     * @private
     */
    _isPlayerPath(pathname) {
        // Disney+ player pages include /play/, /video/, /movies/, and /series/
        return (
            pathname.includes('/play/') ||
            pathname.includes('/video/') ||
            pathname.includes('/movies/') ||
            pathname.includes('/series/')
        );
    }

    /**
     * Handle platform-specific Chrome messages
     * Implements Disney+ specific message handling while ensuring backward compatibility
     * @param {Object} request - Chrome message request
     * @param {Function} sendResponse - Response callback
     * @returns {boolean} Whether response is handled asynchronously
     */
    handlePlatformSpecificMessage(request, sendResponse) {
        try {
            const action = request.action || request.type;

            this.logWithFallback('debug', 'Processing Disney+ specific message', {
                action,
                hasRequest: !!request,
                requestKeys: Object.keys(request || {})
            });

            // Disney+ currently doesn't have platform-specific messages beyond the common ones
            // All standard messages (toggleSubtitles, configChanged, LOGGING_LEVEL_CHANGED) 
            // are handled by BaseContentScript's registered handlers

            // Handle any future Disney+ specific message types here
            switch (action) {
                // Example of how to handle Disney+ specific messages in the future:
                // case 'disneyplus-specific-action':
                //     return this._handleDisneyPlusSpecificAction(request, sendResponse);

                default:
                    // No Disney+ specific handling needed for this message
                    this.logWithFallback('debug', 'No Disney+ specific handling required', {
                        action,
                        message: 'Delegating to default handling or returning success'
                    });

                    // Ensure backward compatibility by providing a successful response
                    sendResponse({
                        success: true,
                        handled: false,
                        platform: 'disneyplus',
                        message: 'No platform-specific handling required'
                    });
                    return false; // Synchronous handling
            }
        } catch (error) {
            const action = request ? (request.action || request.type) : 'unknown';

            this.logWithFallback('error', 'Error in Disney+ specific message handling', {
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
                        platform: 'disneyplus'
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
    // DISNEY+ SPECIFIC NAVIGATION DETECTION METHODS
    // ========================================

    /**
     * Setup interval-based URL change detection
     * @private
     */
    _setupIntervalBasedDetection() {
        this.intervalManager.set(
            'urlChangeCheck',
            () => this.checkForUrlChange(),
            1000 // Check every second for Disney+
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
    }

    /**
     * Handle page transitions between player and non-player pages
     * @private
     * @param {boolean} wasOnPlayerPage - Whether we were on a player page
     * @param {boolean} isOnPlayerPage - Whether we are now on a player page
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
        }, 1500);
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
    // CLEANUP AND RESOURCE MANAGEMENT
    // ========================================

    /**
     * Cleanup Disney+ specific resources
     * @override
     */
    async cleanup() {
        try {
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

            this.logWithFallback('info', 'Disney+ specific cleanup completed');
        } catch (error) {
            this.logWithFallback('error', 'Error during Disney+ specific cleanup', { error });
            throw error;
        }
    }

    // ========================================
    // DISNEY+ SPECIFIC CONFIGURATION
    // ========================================

    /**
     * Get Disney+ specific configuration defaults
     * @returns {Object} Disney+ specific configuration
     */
    getDisneyPlusSpecificConfig() {
        return {
            // Disney+ requires more aggressive retry logic due to complex SPA behavior
            maxVideoDetectionRetries: 40, // 40 seconds max
            videoDetectionInterval: 1000, // Check every 1 second
            
            // Disney+ navigation detection settings
            urlChangeCheckInterval: 1000, // Check URL changes every 1 second
            pageTransitionDelay: 1500, // Wait 1.5s after page transition
            
            // Disney+ injection settings
            injectRetryDelay: 10, // Retry injection every 10ms if needed
            injectMaxRetries: 100 // Maximum injection attempts
        };
    }

    /**
     * Apply Disney+ specific configuration overrides
     * @param {Object} baseConfig - Base configuration
     * @returns {Object} Configuration with Disney+ specific overrides
     */
    applyDisneyPlusConfigOverrides(baseConfig) {
        const disneyPlusConfig = this.getDisneyPlusSpecificConfig();
        
        return {
            ...baseConfig,
            ...disneyPlusConfig,
            // Ensure Disney+ specific values take precedence
            platformName: this.getPlatformName(),
            injectConfig: this.getInjectScriptConfig(),
            urlPatterns: this.urlPatterns
        };
    }
}