/**
 * NavigationUtils - Comprehensive navigation detection utilities for streaming platforms
 * 
 * This module provides robust navigation detection capabilities extracted from Netflix's
 * comprehensive implementation, making them available to all platforms. It handles
 * complex SPA routing, history API interception, and multiple detection strategies.
 * 
 * @author DualSub Extension
 * @version 1.0.0
 */

import { NavigationLogger } from './loggingUtils.js';

/**
 * NavigationDetectionManager - Manages comprehensive navigation detection for streaming platforms
 * 
 * This class provides multiple detection strategies including:
 * - History API interception (pushState/replaceState)
 * - Browser navigation events (popstate, hashchange)
 * - Interval-based URL checking
 * - Focus and visibility events
 * - Extension context validation
 * 
 * @example
 * ```javascript
 * const navigationManager = new NavigationDetectionManager('netflix', {
 *     useHistoryAPI: true,
 *     usePopstateEvents: true,
 *     useIntervalChecking: true,
 *     intervalMs: 1000,
 *     onUrlChange: (oldUrl, newUrl) => console.log('URL changed:', oldUrl, '->', newUrl),
 *     onPageTransition: (wasPlayerPage, isPlayerPage) => console.log('Page transition:', wasPlayerPage, '->', isPlayerPage)
 * });
 * 
 * navigationManager.setupComprehensiveNavigation();
 * ```
 */
export class NavigationDetectionManager {
    /**
     * Creates a new NavigationDetectionManager instance
     * @param {string} platform - Platform name (e.g., 'netflix', 'disneyplus')
     * @param {Object} options - Configuration options
     * @param {boolean} [options.useHistoryAPI=true] - Enable History API interception
     * @param {boolean} [options.usePopstateEvents=true] - Enable popstate event listeners
     * @param {boolean} [options.useIntervalChecking=true] - Enable interval-based URL checking
     * @param {number} [options.intervalMs=1000] - Interval for URL checking in milliseconds
     * @param {boolean} [options.useFocusEvents=true] - Enable focus and visibility event listeners
     * @param {Function} [options.onUrlChange] - Callback for URL changes (oldUrl, newUrl)
     * @param {Function} [options.onPageTransition] - Callback for page transitions (wasPlayerPage, isPlayerPage)
     * @param {Function} [options.isPlayerPage] - Function to determine if current page is a player page
     * @param {Function} [options.logger] - Logger function for debugging
     * @param {boolean} [options.enableNavigationLogging=true] - Enable enhanced navigation logging
     */
    constructor(platform, options = {}) {
        this.platform = platform;
        this.options = {
            useHistoryAPI: true,
            usePopstateEvents: true,
            useIntervalChecking: true,
            intervalMs: 1000,
            useFocusEvents: true,
            onUrlChange: null,
            onPageTransition: null,
            isPlayerPage: null,
            logger: null,
            enableNavigationLogging: true,
            ...options
        };

        // Navigation state
        this.currentUrl = window.location.href;
        this.lastKnownPathname = window.location.pathname;
        
        // Cleanup tracking
        this.intervalId = null;
        this.abortController = null;
        this._originalHistoryMethods = null;
        this.isSetup = false;

        // Enhanced navigation logging
        if (this.options.enableNavigationLogging) {
            this.navigationLogger = new NavigationLogger(platform, {
                logger: this.options.logger,
                enablePerformanceTracking: true
            });
        }

        // Bind methods to preserve context
        this.checkForUrlChange = this.checkForUrlChange.bind(this);
        this._handleHistoryChange = this._handleHistoryChange.bind(this);
        this._handleNavigationEvent = this._handleNavigationEvent.bind(this);
        this._handleFocusEvent = this._handleFocusEvent.bind(this);
    }

    /**
     * Set up comprehensive navigation detection using all configured strategies
     * This method combines Netflix's most robust detection mechanisms
     */
    setupComprehensiveNavigation() {
        if (this.isSetup) {
            this._log('warn', 'Navigation detection already set up, skipping');
            return;
        }

        this._log('info', 'Setting up comprehensive navigation detection', {
            platform: this.platform,
            options: this.options
        });

        // Create AbortController for event listener cleanup
        this.abortController = new AbortController();

        // Method 1: Interval-based URL checking (most reliable fallback)
        if (this.options.useIntervalChecking) {
            this._setupIntervalBasedDetection();
        }

        // Method 2: History API interception (for programmatic navigation)
        if (this.options.useHistoryAPI) {
            this._setupHistoryAPIInterception();
        }

        // Method 3: Browser navigation events
        if (this.options.usePopstateEvents) {
            this._setupBrowserNavigationEvents();
        }

        // Method 4: Focus and visibility events
        if (this.options.useFocusEvents) {
            this._setupFocusAndVisibilityEvents();
        }

        this.isSetup = true;
        this._log('info', 'Comprehensive navigation detection set up successfully');
    }

    /**
     * Check for URL changes with platform-agnostic logic
     * Enhanced URL change detection with extension context error handling
     */
    checkForUrlChange() {
        try {
            const newUrl = window.location.href;
            const newPathname = window.location.pathname;

            if (newUrl !== this.currentUrl || newPathname !== this.lastKnownPathname) {
                const oldUrl = this.currentUrl;
                const wasOnPlayerPage = this._isPlayerPage(this.lastKnownPathname);
                const isOnPlayerPage = this._isPlayerPage(newPathname);

                // Enhanced navigation logging
                if (this.navigationLogger) {
                    this.navigationLogger.logNavigationDetection(oldUrl, newUrl, {
                        detectionMethod: 'url_check',
                        fromPathname: this.lastKnownPathname,
                        toPathname: newPathname,
                        wasOnPlayerPage,
                        isOnPlayerPage,
                        pageTransition: wasOnPlayerPage !== isOnPlayerPage
                    });
                }

                this._log('info', 'URL change detected', {
                    from: this.currentUrl,
                    to: newUrl,
                    fromPathname: this.lastKnownPathname,
                    toPathname: newPathname
                });

                // Update state
                this.currentUrl = newUrl;
                this.lastKnownPathname = newPathname;

                // Notify callbacks
                if (this.options.onUrlChange) {
                    this.options.onUrlChange(oldUrl, newUrl);
                }

                if (this.options.onPageTransition && wasOnPlayerPage !== isOnPlayerPage) {
                    this.options.onPageTransition(wasOnPlayerPage, isOnPlayerPage);
                }
            }
        } catch (error) {
            this._log('error', 'Error in URL change detection', { error: error.message });
            
            // Log navigation diagnostic
            if (this.navigationLogger) {
                this.navigationLogger.logNavigationDiagnostic('URL change detection error', {
                    error: error.message,
                    stack: error.stack,
                    currentUrl: this.currentUrl,
                    attemptedUrl: window.location.href
                }, 'error');
            }
            
            this._handleExtensionContextError(error);
        }
    }

    /**
     * Log initialization sequence step
     * @param {string} initializationId - Unique identifier for initialization sequence
     * @param {string} step - Step name
     * @param {string} status - Step status ('started', 'completed', 'failed')
     * @param {Object} [stepData] - Step-specific data
     */
    logInitializationStep(initializationId, step, status, stepData = {}) {
        if (this.navigationLogger) {
            this.navigationLogger.logInitializationStep(initializationId, step, status, stepData);
        }
    }

    /**
     * Log player ready detection events
     * @param {string} event - Event type
     * @param {Object} [eventData] - Event-specific data
     */
    logPlayerReadyDetection(event, eventData = {}) {
        if (this.navigationLogger) {
            this.navigationLogger.logPlayerReadyDetection(event, eventData);
        }
    }

    /**
     * Log navigation diagnostic information
     * @param {string} issue - Issue description
     * @param {Object} [diagnosticData] - Diagnostic data
     * @param {string} [severity='warn'] - Log severity
     */
    logNavigationDiagnostic(issue, diagnosticData = {}, severity = 'warn') {
        if (this.navigationLogger) {
            this.navigationLogger.logNavigationDiagnostic(issue, diagnosticData, severity);
        }
    }

    /**
     * Get navigation performance report
     * @returns {Object} Performance report
     */
    getPerformanceReport() {
        if (this.navigationLogger) {
            return this.navigationLogger.getPerformanceReport();
        }
        return null;
    }

    /**
     * Clean up all navigation detection resources
     */
    cleanup() {
        this._log('info', 'Cleaning up navigation detection');

        // Clear interval
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }

        // Abort all event listeners
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }

        // Restore original history methods
        if (this._originalHistoryMethods) {
            history.pushState = this._originalHistoryMethods.pushState;
            history.replaceState = this._originalHistoryMethods.replaceState;
            this._originalHistoryMethods = null;
        }

        this.isSetup = false;
        this._log('info', 'Navigation detection cleanup completed');
    }

    // ========================================
    // PRIVATE DETECTION METHODS
    // ========================================

    /**
     * Setup interval-based URL change detection
     * @private
     */
    _setupIntervalBasedDetection() {
        this.intervalId = setInterval(this.checkForUrlChange, this.options.intervalMs);
        this._log('debug', 'Interval-based URL detection set up', {
            intervalMs: this.options.intervalMs
        });
    }

    /**
     * Setup History API interception for programmatic navigation
     * @private
     */
    _setupHistoryAPIInterception() {
        // Store original methods
        this._originalHistoryMethods = {
            pushState: history.pushState,
            replaceState: history.replaceState
        };

        // Intercept pushState
        history.pushState = (...args) => {
            this._originalHistoryMethods.pushState.apply(history, args);
            setTimeout(this._handleHistoryChange, 100);
        };

        // Intercept replaceState
        history.replaceState = (...args) => {
            this._originalHistoryMethods.replaceState.apply(history, args);
            setTimeout(this._handleHistoryChange, 100);
        };

        this._log('debug', 'History API interception set up');
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
            const handler = () => setTimeout(this._handleNavigationEvent, delay);
            
            window.addEventListener(name, handler, { 
                signal: this.abortController.signal 
            });
            
            this._log('debug', `Added ${name} event listener for navigation detection`);
        });
    }

    /**
     * Setup focus and visibility event listeners
     * @private
     */
    _setupFocusAndVisibilityEvents() {
        const options = { signal: this.abortController.signal };
        
        window.addEventListener('focus', this._handleFocusEvent, options);
        document.addEventListener('visibilitychange', this._handleFocusEvent, options);

        this._log('debug', 'Added focus and visibility event listeners for navigation detection');
    }

    /**
     * Handle history API changes
     * @private
     */
    _handleHistoryChange() {
        const eventTime = Date.now();
        
        this._log('debug', 'History API change detected', {
            eventTime,
            currentUrl: window.location.href,
            pathname: window.location.pathname
        });

        // Enhanced logging for history changes
        if (this.navigationLogger) {
            this.navigationLogger.logNavigationDetection(
                this.currentUrl,
                window.location.href,
                {
                    detectionMethod: 'history_api',
                    eventTime,
                    historyState: history.state,
                    trigger: 'programmatic_navigation'
                }
            );
        }

        this.checkForUrlChange();
    }

    /**
     * Handle navigation events
     * @private
     */
    _handleNavigationEvent() {
        const eventTime = Date.now();
        
        this._log('debug', 'Browser navigation event detected', {
            eventTime,
            currentUrl: window.location.href,
            pathname: window.location.pathname
        });

        // Enhanced logging for browser navigation events
        if (this.navigationLogger) {
            this.navigationLogger.logNavigationDetection(
                this.currentUrl,
                window.location.href,
                {
                    detectionMethod: 'browser_event',
                    eventTime,
                    trigger: 'user_navigation'
                }
            );
        }

        this.checkForUrlChange();
    }

    /**
     * Handle focus events
     * @private
     */
    _handleFocusEvent() {
        const eventTime = Date.now();
        
        this._log('debug', 'Focus/visibility event detected', {
            eventTime,
            visibilityState: document.visibilityState,
            hasFocus: document.hasFocus()
        });

        // Enhanced logging for focus events
        if (this.navigationLogger) {
            this.navigationLogger.logNavigationDetection(
                this.currentUrl,
                window.location.href,
                {
                    detectionMethod: 'focus_event',
                    eventTime,
                    visibilityState: document.visibilityState,
                    hasFocus: document.hasFocus(),
                    trigger: 'focus_change'
                }
            );
        }

        setTimeout(this.checkForUrlChange, 100);
    }

    /**
     * Handle extension context errors
     * @private
     * @param {Error} error - The error that occurred
     */
    _handleExtensionContextError(error) {
        if (error.message && error.message.includes('Extension context invalidated')) {
            this.cleanup();
            this._log('info', 'Stopped navigation detection due to extension context invalidation');
        }
    }

    /**
     * Determine if a pathname represents a player page
     * @private
     * @param {string} pathname - The pathname to check
     * @returns {boolean} Whether the pathname is a player page
     */
    _isPlayerPage(pathname) {
        if (this.options.isPlayerPage) {
            return this.options.isPlayerPage(pathname);
        }

        // Default implementations for common platforms
        switch (this.platform.toLowerCase()) {
            case 'netflix':
                return pathname.includes('/watch/');
            case 'disneyplus':
                return pathname.includes('/video/') || pathname.includes('/movies/') || pathname.includes('/series/');
            default:
                return pathname.includes('/watch/') || pathname.includes('/video/');
        }
    }

    /**
     * Log messages with fallback
     * @private
     * @param {string} level - Log level
     * @param {string} message - Log message
     * @param {Object} [data] - Additional data
     */
    _log(level, message, data = {}) {
        if (this.options.logger) {
            this.options.logger(level, `[NavigationDetection:${this.platform}] ${message}`, data);
        } else {
            console.log(`[NavigationDetection:${this.platform}] [${level.toUpperCase()}] ${message}`, data);
        }
    }
}

/**
 * NavigationEventHandler - Handles page transitions and navigation events
 * 
 * This class provides utilities for handling the results of navigation detection,
 * including page transition logic, cleanup, and reinitialization.
 * 
 * @example
 * ```javascript
 * const eventHandler = new NavigationEventHandler('netflix', {
 *     onEnterPlayerPage: () => console.log('Entered player page'),
 *     onLeavePlayerPage: () => console.log('Left player page'),
 *     logger: myLogger
 * });
 * 
 * // Use with NavigationDetectionManager
 * const navigationManager = new NavigationDetectionManager('netflix', {
 *     onPageTransition: eventHandler.handlePageTransition.bind(eventHandler)
 * });
 * ```
 */
export class NavigationEventHandler {
    /**
     * Creates a new NavigationEventHandler instance
     * @param {string} platform - Platform name
     * @param {Object} options - Configuration options
     * @param {Function} [options.onEnterPlayerPage] - Callback when entering player page
     * @param {Function} [options.onLeavePlayerPage] - Callback when leaving player page
     * @param {Function} [options.onUrlChange] - Callback for any URL change
     * @param {Function} [options.logger] - Logger function
     * @param {boolean} [options.enableNavigationLogging=true] - Enable enhanced navigation logging
     */
    constructor(platform, options = {}) {
        this.platform = platform;
        this.options = {
            onEnterPlayerPage: null,
            onLeavePlayerPage: null,
            onUrlChange: null,
            logger: null,
            enableNavigationLogging: true,
            ...options
        };

        // Enhanced navigation logging
        if (this.options.enableNavigationLogging) {
            this.navigationLogger = new NavigationLogger(platform, {
                logger: this.options.logger,
                enablePerformanceTracking: true
            });
        }

        // Track page transition state
        this.transitionState = {
            lastTransitionTime: null,
            transitionCount: 0,
            playerPageEntries: 0,
            playerPageExits: 0
        };
    }

    /**
     * Handle page transitions between player and non-player pages
     * @param {boolean} wasOnPlayerPage - Whether we were on a player page
     * @param {boolean} isOnPlayerPage - Whether we are now on a player page
     */
    handlePageTransition(wasOnPlayerPage, isOnPlayerPage) {
        const transitionTime = Date.now();
        const timeSinceLastTransition = this.transitionState.lastTransitionTime 
            ? transitionTime - this.transitionState.lastTransitionTime 
            : 0;

        // Update transition state
        this.transitionState.lastTransitionTime = transitionTime;
        this.transitionState.transitionCount++;

        this._log('info', 'Handling page transition', {
            wasOnPlayerPage,
            isOnPlayerPage,
            platform: this.platform,
            transitionTime,
            timeSinceLastTransition: timeSinceLastTransition > 0 ? `${timeSinceLastTransition}ms` : 'first transition',
            transitionCount: this.transitionState.transitionCount
        });

        // Clean up when leaving a player page
        if (wasOnPlayerPage && !isOnPlayerPage) {
            this.transitionState.playerPageExits++;
            
            this._log('info', 'Leaving player page, triggering cleanup', {
                playerPageExits: this.transitionState.playerPageExits,
                currentUrl: window.location.href
            });

            // Enhanced logging for page exit
            if (this.navigationLogger) {
                this.navigationLogger.logInitializationStep(
                    `transition-${transitionTime}`,
                    'player_page_exit',
                    'started',
                    {
                        exitTime: transitionTime,
                        totalExits: this.transitionState.playerPageExits,
                        timeSinceLastTransition
                    }
                );
            }

            if (this.options.onLeavePlayerPage) {
                try {
                    this.options.onLeavePlayerPage();
                    
                    // Log successful cleanup
                    if (this.navigationLogger) {
                        this.navigationLogger.logInitializationStep(
                            `transition-${transitionTime}`,
                            'player_page_exit',
                            'completed',
                            { cleanupSuccessful: true }
                        );
                    }
                } catch (error) {
                    this._log('error', 'Error during player page exit cleanup', {
                        error: error.message,
                        stack: error.stack
                    });

                    // Log cleanup failure
                    if (this.navigationLogger) {
                        this.navigationLogger.logInitializationStep(
                            `transition-${transitionTime}`,
                            'player_page_exit',
                            'failed',
                            { 
                                cleanupSuccessful: false,
                                error: error.message 
                            }
                        );
                    }
                }
            }
        }

        // Initialize when entering a player page
        if (!wasOnPlayerPage && isOnPlayerPage) {
            this.transitionState.playerPageEntries++;
            
            this._log('info', 'Entering player page, triggering initialization', {
                playerPageEntries: this.transitionState.playerPageEntries,
                currentUrl: window.location.href
            });

            // Enhanced logging for page entry
            if (this.navigationLogger) {
                this.navigationLogger.logInitializationStep(
                    `transition-${transitionTime}`,
                    'player_page_entry',
                    'started',
                    {
                        entryTime: transitionTime,
                        totalEntries: this.transitionState.playerPageEntries,
                        timeSinceLastTransition
                    }
                );
            }

            if (this.options.onEnterPlayerPage) {
                try {
                    this.options.onEnterPlayerPage();
                    
                    // Log successful initialization
                    if (this.navigationLogger) {
                        this.navigationLogger.logInitializationStep(
                            `transition-${transitionTime}`,
                            'player_page_entry',
                            'completed',
                            { initializationTriggered: true }
                        );
                    }
                } catch (error) {
                    this._log('error', 'Error during player page entry initialization', {
                        error: error.message,
                        stack: error.stack
                    });

                    // Log initialization failure
                    if (this.navigationLogger) {
                        this.navigationLogger.logInitializationStep(
                            `transition-${transitionTime}`,
                            'player_page_entry',
                            'failed',
                            { 
                                initializationTriggered: false,
                                error: error.message 
                            }
                        );
                    }
                }
            }
        }
    }

    /**
     * Handle URL changes
     * @param {string} oldUrl - Previous URL
     * @param {string} newUrl - New URL
     */
    handleUrlChange(oldUrl, newUrl) {
        this._log('debug', 'Handling URL change', {
            from: oldUrl,
            to: newUrl,
            platform: this.platform
        });

        if (this.options.onUrlChange) {
            this.options.onUrlChange(oldUrl, newUrl);
        }
    }

    /**
     * Log messages with fallback
     * @private
     * @param {string} level - Log level
     * @param {string} message - Log message
     * @param {Object} [data] - Additional data
     */
    _log(level, message, data = {}) {
        if (this.options.logger) {
            this.options.logger(level, `[NavigationEventHandler:${this.platform}] ${message}`, data);
        } else {
            console.log(`[NavigationEventHandler:${this.platform}] [${level.toUpperCase()}] ${message}`, data);
        }
    }
}

/**
 * Platform-specific navigation configurations
 * These provide default settings optimized for each platform
 */
export const PLATFORM_NAVIGATION_CONFIGS = {
    netflix: {
        intervalMs: 1000,
        useHistoryAPI: true,
        usePopstateEvents: true,
        useIntervalChecking: true,
        useFocusEvents: true,
        isPlayerPage: (pathname) => pathname.includes('/watch/')
    },
    
    disneyplus: {
        intervalMs: 500, // More frequent checking for Disney+
        useHistoryAPI: true,
        usePopstateEvents: true,
        useIntervalChecking: true,
        useFocusEvents: true,
        isPlayerPage: (pathname) => pathname.includes('/video/') || pathname.includes('/movies/') || pathname.includes('/series/')
    }
};

/**
 * Create a pre-configured NavigationDetectionManager for a specific platform
 * @param {string} platform - Platform name ('netflix', 'disneyplus', etc.)
 * @param {Object} [customOptions] - Custom options to override defaults
 * @returns {NavigationDetectionManager} Configured navigation manager
 * 
 * @example
 * ```javascript
 * const navigationManager = createPlatformNavigationManager('netflix', {
 *     onUrlChange: (oldUrl, newUrl) => console.log('URL changed'),
 *     logger: myLogger
 * });
 * 
 * navigationManager.setupComprehensiveNavigation();
 * ```
 */
export function createPlatformNavigationManager(platform, customOptions = {}) {
    const platformConfig = PLATFORM_NAVIGATION_CONFIGS[platform.toLowerCase()] || {};
    const options = { ...platformConfig, ...customOptions };
    
    return new NavigationDetectionManager(platform, options);
}