/**
 * Provides comprehensive navigation detection utilities for streaming platforms,
 * handling complex SPA routing, history API interception, and multiple detection
 * strategies to ensure robust navigation event handling.
 *
 * @author DualSub Extension
 * @version 1.0.0
 */

import { NavigationLogger } from './loggingUtils.js';

/**
 * Manages comprehensive navigation detection for streaming platforms, using a
 * combination of strategies to reliably detect URL changes in SPAs.
 */
export class NavigationDetectionManager {
    /**
     * Creates a new `NavigationDetectionManager` instance.
     * @param {string} platform - The platform name (e.g., 'netflix', 'disneyplus').
     * @param {Object} [options={}] - Configuration options for the manager.
     * @param {boolean} [options.useHistoryAPI=true] - Whether to use History API interception.
     * @param {boolean} [options.usePopstateEvents=true] - Whether to use popstate event listeners.
     * @param {boolean} [options.useIntervalChecking=true] - Whether to use interval-based URL checking.
     * @param {number} [options.intervalMs=1000] - The interval for URL checking in milliseconds.
     * @param {boolean} [options.useFocusEvents=true] - Whether to use focus and visibility event listeners.
     * @param {Function} [options.onUrlChange] - A callback for URL changes, receiving `(oldUrl, newUrl)`.
     * @param {Function} [options.onPageTransition] - A callback for page transitions, receiving `(wasPlayerPage, isPlayerPage)`.
     * @param {Function} [options.isPlayerPage] - A function to determine if the current page is a player page.
     * @param {Function} [options.logger] - A logger function for debugging.
     * @param {boolean} [options.enableNavigationLogging=true] - Whether to enable enhanced navigation logging.
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
            ...options,
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
                enablePerformanceTracking: true,
            });
        }

        // Bind methods to preserve context
        this.checkForUrlChange = this.checkForUrlChange.bind(this);
        this._handleHistoryChange = this._handleHistoryChange.bind(this);
        this._handleNavigationEvent = this._handleNavigationEvent.bind(this);
        this._handleFocusEvent = this._handleFocusEvent.bind(this);
    }

    /**
     * Sets up comprehensive navigation detection using all configured strategies.
     */
    setupComprehensiveNavigation() {
        if (this.isSetup) {
            this._log(
                'warn',
                'Navigation detection is already set up; skipping.'
            );
            return;
        }

        this._log('info', 'Setting up comprehensive navigation detection.', {
            platform: this.platform,
            options: this.options,
        });

        this.abortController = new AbortController();

        if (this.options.useIntervalChecking) {
            this._setupIntervalBasedDetection();
        }
        if (this.options.useHistoryAPI) {
            this._setupHistoryAPIInterception();
        }
        if (this.options.usePopstateEvents) {
            this._setupBrowserNavigationEvents();
        }
        if (this.options.useFocusEvents) {
            this._setupFocusAndVisibilityEvents();
        }

        this.isSetup = true;
        this._log(
            'info',
            'Comprehensive navigation detection has been set up successfully.'
        );
    }

    /**
     * Checks for URL changes and triggers appropriate callbacks.
     */
    checkForUrlChange() {
        try {
            const newUrl = window.location.href;
            const newPathname = window.location.pathname;

            if (
                newUrl !== this.currentUrl ||
                newPathname !== this.lastKnownPathname
            ) {
                const oldUrl = this.currentUrl;
                const wasOnPlayerPage = this._isPlayerPage(
                    this.lastKnownPathname
                );
                const isOnPlayerPage = this._isPlayerPage(newPathname);

                // Enhanced navigation logging
                if (this.navigationLogger) {
                    this.navigationLogger.logNavigationDetection(
                        oldUrl,
                        newUrl,
                        {
                            detectionMethod: 'url_check',
                            fromPathname: this.lastKnownPathname,
                            toPathname: newPathname,
                            wasOnPlayerPage,
                            isOnPlayerPage,
                            pageTransition: wasOnPlayerPage !== isOnPlayerPage,
                        }
                    );
                }

                this._log('info', 'URL change detected', {
                    from: this.currentUrl,
                    to: newUrl,
                    fromPathname: this.lastKnownPathname,
                    toPathname: newPathname,
                });

                // Update state
                this.currentUrl = newUrl;
                this.lastKnownPathname = newPathname;

                // Notify callbacks
                if (this.options.onUrlChange) {
                    this.options.onUrlChange(oldUrl, newUrl);
                }

                if (
                    this.options.onPageTransition &&
                    wasOnPlayerPage !== isOnPlayerPage
                ) {
                    this.options.onPageTransition(
                        wasOnPlayerPage,
                        isOnPlayerPage
                    );
                }
            }
        } catch (error) {
            this._log('error', 'Error occurred during URL change detection.', {
                error: error.message,
            });

            if (this.navigationLogger) {
                this.navigationLogger.logNavigationDiagnostic(
                    'URL change detection error',
                    {
                        error: error.message,
                        stack: error.stack,
                        currentUrl: this.currentUrl,
                        attemptedUrl: window.location.href,
                    },
                    'error'
                );
            }

            this._handleExtensionContextError(error);
        }
    }

    /**
     * Logs a step in the initialization sequence.
     * @param {string} initializationId - A unique identifier for the initialization sequence.
     * @param {string} step - The name of the step.
     * @param {string} status - The status of the step ('started', 'completed', 'failed').
     * @param {Object} [stepData={}] - Additional data specific to the step.
     */
    logInitializationStep(initializationId, step, status, stepData = {}) {
        if (this.navigationLogger) {
            this.navigationLogger.logInitializationStep(
                initializationId,
                step,
                status,
                stepData
            );
        }
    }

    /**
     * Logs events related to player ready detection.
     * @param {string} event - The type of the event.
     * @param {Object} [eventData={}] - Additional data specific to the event.
     */
    logPlayerReadyDetection(event, eventData = {}) {
        if (this.navigationLogger) {
            this.navigationLogger.logPlayerReadyDetection(event, eventData);
        }
    }

    /**
     * Logs diagnostic information for navigation issues.
     * @param {string} issue - A description of the issue.
     * @param {Object} [diagnosticData={}] - Additional diagnostic data.
     * @param {string} [severity='warn'] - The severity of the log.
     */
    logNavigationDiagnostic(issue, diagnosticData = {}, severity = 'warn') {
        if (this.navigationLogger) {
            this.navigationLogger.logNavigationDiagnostic(
                issue,
                diagnosticData,
                severity
            );
        }
    }

    /**
     * Gets a report on navigation performance.
     * @returns {Object|null} A performance report object, or `null` if logging is disabled.
     */
    getPerformanceReport() {
        if (this.navigationLogger) {
            return this.navigationLogger.getPerformanceReport();
        }
        return null;
    }

    /**
     * Cleans up all resources used for navigation detection.
     */
    cleanup() {
        this._log('info', 'Cleaning up navigation detection resources.');

        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }

        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }

        if (this._originalHistoryMethods) {
            history.pushState = this._originalHistoryMethods.pushState;
            history.replaceState = this._originalHistoryMethods.replaceState;
            this._originalHistoryMethods = null;
        }

        this.isSetup = false;
        this._log('info', 'Navigation detection cleanup is complete.');
    }

    // ========================================
    // PRIVATE DETECTION METHODS
    // ========================================

    /**
     * Sets up interval-based URL change detection.
     * @private
     */
    _setupIntervalBasedDetection() {
        this.intervalId = setInterval(
            this.checkForUrlChange,
            this.options.intervalMs
        );
        this._log('debug', 'Interval-based URL detection has been set up.', {
            intervalMs: this.options.intervalMs,
        });
    }

    /**
     * Sets up History API interception for programmatic navigation.
     * @private
     */
    _setupHistoryAPIInterception() {
        this._originalHistoryMethods = {
            pushState: history.pushState,
            replaceState: history.replaceState,
        };

        history.pushState = (...args) => {
            this._originalHistoryMethods.pushState.apply(history, args);
            setTimeout(this._handleHistoryChange, 100);
        };

        history.replaceState = (...args) => {
            this._originalHistoryMethods.replaceState.apply(history, args);
            setTimeout(this._handleHistoryChange, 100);
        };

        this._log('debug', 'History API interception has been set up.');
    }

    /**
     * Sets up browser navigation event listeners.
     * @private
     */
    _setupBrowserNavigationEvents() {
        const events = [
            { name: 'popstate', delay: 100 },
            { name: 'hashchange', delay: 100 },
        ];

        events.forEach(({ name, delay }) => {
            const handler = () =>
                setTimeout(this._handleNavigationEvent, delay);

            window.addEventListener(name, handler, {
                signal: this.abortController.signal,
            });

            this._log(
                'debug',
                `Added ${name} event listener for navigation detection.`
            );
        });
    }

    /**
     * Sets up focus and visibility event listeners.
     * @private
     */
    _setupFocusAndVisibilityEvents() {
        const options = { signal: this.abortController.signal };

        window.addEventListener('focus', this._handleFocusEvent, options);
        document.addEventListener(
            'visibilitychange',
            this._handleFocusEvent,
            options
        );

        this._log(
            'debug',
            'Added focus and visibility event listeners for navigation detection.'
        );
    }

    /**
     * Handles changes triggered by the History API.
     * @private
     */
    _handleHistoryChange() {
        const eventTime = Date.now();

        this._log('debug', 'History API change detected.', {
            eventTime,
            currentUrl: window.location.href,
            pathname: window.location.pathname,
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
                    trigger: 'programmatic_navigation',
                }
            );
        }

        this.checkForUrlChange();
    }

    /**
     * Handles navigation events like `popstate` and `hashchange`.
     * @private
     */
    _handleNavigationEvent() {
        const eventTime = Date.now();

        this._log('debug', 'Browser navigation event detected.', {
            eventTime,
            currentUrl: window.location.href,
            pathname: window.location.pathname,
        });

        // Enhanced logging for browser navigation events
        if (this.navigationLogger) {
            this.navigationLogger.logNavigationDetection(
                this.currentUrl,
                window.location.href,
                {
                    detectionMethod: 'browser_event',
                    eventTime,
                    trigger: 'user_navigation',
                }
            );
        }

        this.checkForUrlChange();
    }

    /**
     * Handles focus and visibility change events.
     * @private
     */
    _handleFocusEvent() {
        const eventTime = Date.now();

        this._log('debug', 'Focus/visibility event detected.', {
            eventTime,
            visibilityState: document.visibilityState,
            hasFocus: document.hasFocus(),
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
                    trigger: 'focus_change',
                }
            );
        }

        setTimeout(this.checkForUrlChange, 100);
    }

    /**
     * Handles errors related to an invalidated extension context.
     * @private
     * @param {Error} error - The error that occurred.
     */
    _handleExtensionContextError(error) {
        if (error.message?.includes('Extension context invalidated')) {
            this.cleanup();
            this._log(
                'info',
                'Stopped navigation detection due to extension context invalidation.'
            );
        }
    }

    /**
     * Determines if a given pathname represents a player page.
     * @private
     * @param {string} pathname - The pathname to check.
     * @returns {boolean} `true` if the pathname is a player page, otherwise `false`.
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
                return (
                    pathname.includes('/video/') ||
                    pathname.includes('/movies/') ||
                    pathname.includes('/series/')
                );
            default:
                return (
                    pathname.includes('/watch/') || pathname.includes('/video/')
                );
        }
    }

    /**
     * Logs messages with a fallback to the console.
     * @private
     * @param {string} level - The log level.
     * @param {string} message - The log message.
     * @param {Object} [data] - Additional data to log.
     */
    _log(level, message, data = {}) {
        if (this.options.logger) {
            this.options.logger(
                level,
                `[NavigationDetection:${this.platform}] ${message}`,
                data
            );
        } else {
            console.log(
                `[NavigationDetection:${this.platform}] [${level.toUpperCase()}] ${message}`,
                data
            );
        }
    }
}

/**
 * Handles page transitions and navigation events, providing callbacks for entering
 * and leaving player pages, as well as for general URL changes.
 */
export class NavigationEventHandler {
    /**
     * Creates a new `NavigationEventHandler` instance.
     * @param {string} platform - The platform name.
     * @param {Object} [options={}] - Configuration options.
     * @param {Function} [options.onEnterPlayerPage] - A callback for when the user enters a player page.
     * @param {Function} [options.onLeavePlayerPage] - A callback for when the user leaves a player page.
     * @param {Function} [options.onUrlChange] - A callback for any URL change.
     * @param {Function} [options.logger] - A logger function.
     * @param {boolean} [options.enableNavigationLogging=true] - Whether to enable enhanced navigation logging.
     */
    constructor(platform, options = {}) {
        this.platform = platform;
        this.options = {
            onEnterPlayerPage: null,
            onLeavePlayerPage: null,
            onUrlChange: null,
            logger: null,
            enableNavigationLogging: true,
            ...options,
        };

        // Enhanced navigation logging
        if (this.options.enableNavigationLogging) {
            this.navigationLogger = new NavigationLogger(platform, {
                logger: this.options.logger,
                enablePerformanceTracking: true,
            });
        }

        // Track page transition state
        this.transitionState = {
            lastTransitionTime: null,
            transitionCount: 0,
            playerPageEntries: 0,
            playerPageExits: 0,
        };
    }

    /**
     * Handles page transitions between player and non-player pages.
     * @param {boolean} wasOnPlayerPage - Whether the previous page was a player page.
     * @param {boolean} isOnPlayerPage - Whether the current page is a player page.
     */
    handlePageTransition(wasOnPlayerPage, isOnPlayerPage) {
        const transitionTime = Date.now();
        const timeSinceLastTransition = this.transitionState.lastTransitionTime
            ? transitionTime - this.transitionState.lastTransitionTime
            : 0;

        // Update transition state
        this.transitionState.lastTransitionTime = transitionTime;
        this.transitionState.transitionCount++;

        this._log('info', 'Handling page transition.', {
            wasOnPlayerPage,
            isOnPlayerPage,
            platform: this.platform,
            transitionTime,
            timeSinceLastTransition:
                timeSinceLastTransition > 0
                    ? `${timeSinceLastTransition}ms`
                    : 'first transition',
            transitionCount: this.transitionState.transitionCount,
        });

        // Clean up when leaving a player page
        if (wasOnPlayerPage && !isOnPlayerPage) {
            this.transitionState.playerPageExits++;

            this._log('info', 'Leaving player page, triggering cleanup.', {
                playerPageExits: this.transitionState.playerPageExits,
                currentUrl: window.location.href,
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
                        timeSinceLastTransition,
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
                    this._log(
                        'error',
                        'Error during player page exit cleanup',
                        {
                            error: error.message,
                            stack: error.stack,
                        }
                    );

                    // Log cleanup failure
                    if (this.navigationLogger) {
                        this.navigationLogger.logInitializationStep(
                            `transition-${transitionTime}`,
                            'player_page_exit',
                            'failed',
                            {
                                cleanupSuccessful: false,
                                error: error.message,
                            }
                        );
                    }
                }
            }
        }

        // Initialize when entering a player page
        if (!wasOnPlayerPage && isOnPlayerPage) {
            this.transitionState.playerPageEntries++;

            this._log(
                'info',
                'Entering player page, triggering initialization.',
                {
                    playerPageEntries: this.transitionState.playerPageEntries,
                    currentUrl: window.location.href,
                }
            );

            // Enhanced logging for page entry
            if (this.navigationLogger) {
                this.navigationLogger.logInitializationStep(
                    `transition-${transitionTime}`,
                    'player_page_entry',
                    'started',
                    {
                        entryTime: transitionTime,
                        totalEntries: this.transitionState.playerPageEntries,
                        timeSinceLastTransition,
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
                    this._log(
                        'error',
                        'Error during player page entry initialization',
                        {
                            error: error.message,
                            stack: error.stack,
                        }
                    );

                    // Log initialization failure
                    if (this.navigationLogger) {
                        this.navigationLogger.logInitializationStep(
                            `transition-${transitionTime}`,
                            'player_page_entry',
                            'failed',
                            {
                                initializationTriggered: false,
                                error: error.message,
                            }
                        );
                    }
                }
            }
        }
    }

    /**
     * Handles URL changes.
     * @param {string} oldUrl - The previous URL.
     * @param {string} newUrl - The new URL.
     */
    handleUrlChange(oldUrl, newUrl) {
        this._log('debug', 'Handling URL change.', {
            from: oldUrl,
            to: newUrl,
            platform: this.platform,
        });

        if (this.options.onUrlChange) {
            this.options.onUrlChange(oldUrl, newUrl);
        }
    }

    /**
     * Logs messages with a fallback to the console.
     * @private
     * @param {string} level - The log level.
     * @param {string} message - The log message.
     * @param {Object} [data] - Additional data to log.
     */
    _log(level, message, data = {}) {
        if (this.options.logger) {
            this.options.logger(
                level,
                `[NavigationEventHandler:${this.platform}] ${message}`,
                data
            );
        } else {
            console.log(
                `[NavigationEventHandler:${this.platform}] [${level.toUpperCase()}] ${message}`,
                data
            );
        }
    }
}

/**
 * Provides platform-specific navigation configurations with optimized default settings.
 */
export const PLATFORM_NAVIGATION_CONFIGS = {
    netflix: {
        intervalMs: 1000,
        useHistoryAPI: true,
        usePopstateEvents: true,
        useIntervalChecking: true,
        useFocusEvents: true,
        isPlayerPage: (pathname) => pathname.includes('/watch/'),
    },

    disneyplus: {
        intervalMs: 500,
        useHistoryAPI: true,
        usePopstateEvents: true,
        useIntervalChecking: true,
        useFocusEvents: true,
        isPlayerPage: (pathname) =>
            pathname.includes('/video/') ||
            pathname.includes('/movies/') ||
            pathname.includes('/series/'),
    },
};

/**
 * Creates a pre-configured `NavigationDetectionManager` for a specific platform.
 * @param {string} platform - The platform name (e.g., 'netflix', 'disneyplus').
 * @param {Object} [customOptions={}] - Custom options to override the platform defaults.
 * @returns {NavigationDetectionManager} A configured `NavigationDetectionManager` instance.
 */
export function createPlatformNavigationManager(platform, customOptions = {}) {
    const platformConfig =
        PLATFORM_NAVIGATION_CONFIGS[platform.toLowerCase()] || {};
    const options = { ...platformConfig, ...customOptions };

    return new NavigationDetectionManager(platform, options);
}
