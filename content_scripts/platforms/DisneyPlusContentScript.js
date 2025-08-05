/**
 * Implements Disney+ specific functionalities, including navigation detection,
 * injection configuration, and message handling, by extending the `BaseContentScript`.
 *
 * @extends BaseContentScript
 * @author DualSub Extension
 * @version 1.0.0
 */
import { BaseContentScript } from '../core/BaseContentScript.js';

export class DisneyPlusContentScript extends BaseContentScript {
    /**
     * Creates a new instance of `DisneyPlusContentScript`.
     */
    constructor() {
        super('DisneyPlusContent');
        this._initializeDisneyPlusSpecificState();
        this.setupEarlyEventHandling();
    }

    /**
     * Initializes Disney+ specific state properties.
     * @private
     */
    _initializeDisneyPlusSpecificState() {
        this.injectConfig = {
            filename: 'injected_scripts/disneyPlusInject.js',
            tagId: 'disneyplus-dualsub-injector-script-tag',
            eventId: 'disneyplus-dualsub-injector-event',
        };
        this.urlPatterns = ['*.disneyplus.com'];
    }

    /**
     * Checks if the current page is a video player page.
     * @returns {boolean} `true` if the page is a player page, otherwise `false`.
     * @private
     */
    _isPlayerPage() {
        return this._isPlayerPath(window.location.pathname);
    }

    /**
     * Gets the platform name.
     * @returns {string} The platform name, 'disneyplus'.
     */
    getPlatformName() {
        return 'disneyplus';
    }

    /**
     * Gets the platform class constructor name.
     * @returns {string} The platform class name, 'DisneyPlusPlatform'.
     */
    getPlatformClass() {
        return 'DisneyPlusPlatform';
    }

    /**
     * Gets the inject script configuration.
     * @returns {Object} The inject script configuration.
     */
    getInjectScriptConfig() {
        return this.injectConfig;
    }

    /**
     * Sets up Disney+ specific navigation detection.
     */
    setupNavigationDetection() {
        this.logWithFallback(
            'info',
            'Setting up Disney+ navigation detection.'
        );
        this._setupIntervalBasedDetection();
        this._setupHistoryAPIInterception();
        this._setupBrowserNavigationEvents();
        this._setupFocusAndVisibilityEvents();
        this.logWithFallback(
            'info',
            'Enhanced Disney+ navigation detection is set up.'
        );
    }

    /**
     * Checks for URL changes with Disney+ specific logic.
     */
    checkForUrlChange() {
        try {
            const newUrl = window.location.href;
            const newPathname = window.location.pathname;

            if (
                newUrl !== this.currentUrl ||
                newPathname !== this.lastKnownPathname
            ) {
                this.logWithFallback('info', 'URL change detected.', {
                    from: this.currentUrl,
                    to: newUrl,
                });

                const wasOnPlayerPage = this._isPlayerPath(
                    this.lastKnownPathname
                );
                const isOnPlayerPage = this._isPlayerPath(newPathname);

                this.currentUrl = newUrl;
                this.lastKnownPathname = newPathname;

                this._handlePageTransition(wasOnPlayerPage, isOnPlayerPage);
            }
        } catch (error) {
            this.logWithFallback('error', 'Error in URL change detection.', {
                error,
            });
            this._handleExtensionContextError(error);
        }
    }

    /**
     * Checks if a given path corresponds to a player page.
     * @param {string} pathname - The URL pathname to check.
     * @returns {boolean} `true` if it's a player page, otherwise `false`.
     * @private
     */
    _isPlayerPath(pathname) {
        return (
            pathname.includes('/play/') ||
            pathname.includes('/video/') ||
            pathname.includes('/movies/') ||
            pathname.includes('/series/')
        );
    }

    /**
     * Handles platform-specific Chrome messages.
     * @param {Object} request - The Chrome message request.
     * @param {Function} sendResponse - The callback to send a response.
     * @returns {boolean} `true` if the response is sent asynchronously.
     */
    handlePlatformSpecificMessage(request, sendResponse) {
        try {
            const action = request.action || request.type;

            this.logWithFallback(
                'debug',
                'Processing Disney+ specific message.',
                {
                    action,
                    hasRequest: !!request,
                    requestKeys: Object.keys(request || {}),
                }
            );

            switch (action) {
                case 'toggleInteractiveSubtitles':
                    return this._handleToggleInteractiveSubtitles(request, sendResponse);

                case 'updateContextPreferences':
                    return this._handleUpdateContextPreferences(request, sendResponse);

                default:
                    this.logWithFallback(
                        'debug',
                        'No Disney+ specific handling required.',
                        {
                            action,
                            message: 'Delegating to default handling.',
                        }
                    );

                    sendResponse({
                        success: true,
                        handled: false,
                        platform: 'disneyplus',
                        message: 'No platform-specific handling required.',
                    });
                    return false;
            }
        } catch (error) {
            const action = request ? request.action || request.type : 'unknown';

            this.logWithFallback(
                'error',
                'Error in Disney+ specific message handling.',
                {
                    error: error.message,
                    stack: error.stack,
                    action,
                }
            );

            try {
                if (typeof sendResponse === 'function') {
                    sendResponse({
                        success: false,
                        error: error.message,
                        platform: 'disneyplus',
                    });
                }
            } catch (responseError) {
                this.logWithFallback('error', 'Error sending error response.', {
                    originalError: error.message,
                    responseError: responseError.message,
                });
            }
            return false;
        }
    }

    /**
     * Sets up interval-based URL change detection.
     * @private
     */
    _setupIntervalBasedDetection() {
        this.intervalManager.set(
            'urlChangeCheck',
            () => this.checkForUrlChange(),
            1000
        );
    }

    /**
     * Sets up History API interception for programmatic navigation.
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

        this._originalHistoryMethods = {
            pushState: originalPushState,
            replaceState: originalReplaceState,
        };
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
                setTimeout(() => this.checkForUrlChange(), delay);

            const options = this.abortController
                ? { signal: this.abortController.signal }
                : {};
            window.addEventListener(name, handler, options);
        });
    }

    /**
     * Sets up focus and visibility event listeners.
     * @private
     */
    _setupFocusAndVisibilityEvents() {
        const focusHandler = () =>
            setTimeout(() => this.checkForUrlChange(), 100);

        const options = this.abortController
            ? { signal: this.abortController.signal }
            : {};
        window.addEventListener('focus', focusHandler, options);
        document.addEventListener('visibilitychange', focusHandler, options);
    }

    /**
     * Handles page transitions between player and non-player pages.
     * @private
     * @param {boolean} wasOnPlayerPage - Whether the previous page was a player page.
     * @param {boolean} isOnPlayerPage - Whether the current page is a player page.
     */
    _handlePageTransition(wasOnPlayerPage, isOnPlayerPage) {
        if (wasOnPlayerPage && !isOnPlayerPage) {
            this.logWithFallback(
                'info',
                'Leaving player page, cleaning up platform.'
            );
            this._cleanupOnPageLeave();
        } else if (!wasOnPlayerPage && isOnPlayerPage) {
            this.logWithFallback(
                'info',
                'Entering player page, preparing for initialization.'
            );
            this._initializeOnPageEnter();
        }
    }

    /**
     * Cleans up resources when leaving a player page.
     * @private
     */
    _cleanupOnPageLeave() {
        this.stopVideoElementDetection();

        if (
            this.activePlatform &&
            typeof this.activePlatform.cleanup === 'function'
        ) {
            this.activePlatform.cleanup();
        }

        this.activePlatform = null;
        this.platformReady = false;
        this.eventBuffer.clear();
    }

    /**
     * Initializes the platform when entering a player page.
     * @private
     */
    _initializeOnPageEnter() {
        this._reinjectScript();

        setTimeout(async () => {
            try {
                const config = await this.configService.getAll();
                if (config?.subtitlesEnabled) {
                    this.logWithFallback(
                        'info',
                        'Subtitles enabled, initializing platform.'
                    );
                    await this.initializePlatform();
                }
            } catch (error) {
                this.logWithFallback(
                    'error',
                    'Error during URL change initialization.',
                    { error }
                );
            }
        }, 1500);
    }

    /**
     * Re-injects the platform-specific script for a new page.
     * @private
     */
    _reinjectScript() {
        try {
            const existingScript = document.getElementById(
                this.injectConfig.tagId
            );
            if (existingScript) {
                existingScript.remove();
            }

            const script = document.createElement('script');
            script.src = chrome.runtime.getURL(this.injectConfig.filename);
            script.id = this.injectConfig.tagId;

            const target = document.head || document.documentElement;
            if (target) {
                target.appendChild(script);
                script.onload = () =>
                    this.logWithFallback(
                        'info',
                        'Script re-injected successfully.'
                    );
                script.onerror = (e) =>
                    this.logWithFallback(
                        'error',
                        'Failed to re-inject script.',
                        { error: e }
                    );
            }
        } catch (error) {
            this.logWithFallback('error', 'Error during script re-injection.', {
                error,
            });
        }
    }

    /**
     * Handles errors related to an invalidated extension context.
     * @private
     * @param {Error} error - The error that occurred.
     */
    _handleExtensionContextError(error) {
        if (error.message?.includes('Extension context invalidated')) {
            this.intervalManager.clear('urlChangeCheck');
            this.logWithFallback(
                'info',
                'Stopped URL change detection due to extension context invalidation.'
            );
        }
    }

    /**
     * Cleans up Disney+ specific resources.
     * @override
     */
    async cleanup() {
        try {
            if (this._originalHistoryMethods) {
                history.pushState = this._originalHistoryMethods.pushState;
                history.replaceState =
                    this._originalHistoryMethods.replaceState;
                this._originalHistoryMethods = null;
            }

            // Cleanup AI Context Manager
            if (this.aiContextManager) {
                try {
                    await this.aiContextManager.destroy();
                    this.aiContextManager = null;
                    this.logWithFallback('debug', 'AI Context Manager destroyed');
                } catch (error) {
                    this.logWithFallback('error', 'Error destroying AI Context Manager', error);
                }
            }

            await super.cleanup();

            this.logWithFallback('info', 'Disney+ specific cleanup completed.');
        } catch (error) {
            this.logWithFallback(
                'error',
                'Error during Disney+ specific cleanup.',
                { error }
            );
            throw error;
        }
    }

    /**
     * Gets Disney+ specific configuration defaults.
     * @returns {Object} An object with Disney+ specific configuration.
     */
    getDisneyPlusSpecificConfig() {
        return {
            maxVideoDetectionRetries: 40,
            videoDetectionInterval: 1000,
            urlChangeCheckInterval: 1000,
            pageTransitionDelay: 1500,
            injectRetryDelay: 10,
            injectMaxRetries: 100,
        };
    }

    /**
     * Applies Disney+ specific configuration overrides.
     * @param {Object} baseConfig - The base configuration.
     * @returns {Object} The configuration with Disney+ specific overrides.
     */
    applyDisneyPlusConfigOverrides(baseConfig) {
        const disneyPlusConfig = this.getDisneyPlusSpecificConfig();

        return {
            ...baseConfig,
            ...disneyPlusConfig,
            // Ensure Disney+ specific values take precedence
            platformName: this.getPlatformName(),
            injectConfig: this.getInjectScriptConfig(),
            urlPatterns: this.urlPatterns,
        };
    }



    /**
     * Handle interactive subtitles toggle
     * @param {Object} request - Message request
     * @param {Function} sendResponse - Response callback
     * @returns {boolean} True if async response
     */
    _handleToggleInteractiveSubtitles(request, sendResponse) {
        const { enabled } = request;

        this.logWithFallback('info', 'Toggling interactive subtitles for Disney+', {
            enabled
        });

        try {
            this._toggleInteractiveSubtitles(enabled);
            sendResponse({
                success: true,
                platform: 'disneyplus',
                interactiveEnabled: enabled
            });
        } catch (error) {
            this.logWithFallback('error', 'Failed to toggle interactive subtitles', {
                error: error.message
            });
            sendResponse({
                success: false,
                platform: 'disneyplus',
                error: error.message
            });
        }

        return false; // Sync response
    }

    /**
     * Handle context preferences update
     * @param {Object} request - Message request
     * @param {Function} sendResponse - Response callback
     * @returns {boolean} True if async response
     */
    _handleUpdateContextPreferences(request, sendResponse) {
        const { preferences } = request;

        this.logWithFallback('info', 'Updating context preferences for Disney+', {
            preferences
        });

        this._updateContextPreferences(preferences)
            .then((result) => {
                sendResponse({
                    success: true,
                    platform: 'disneyplus',
                    updated: result.updated,
                    preferences: result.preferences
                });
            })
            .catch((error) => {
                this.logWithFallback('error', 'Failed to update context preferences', {
                    error: error.message
                });
                sendResponse({
                    success: false,
                    platform: 'disneyplus',
                    error: error.message
                });
            });

        return true; // Async response
    }





    /**
     * Toggle interactive subtitles functionality
     * @param {boolean} enabled - Whether to enable interactive subtitles
     */
    _toggleInteractiveSubtitles(enabled) {
        if (this.subtitleUtils?.setInteractiveSubtitlesEnabled) {
            this.subtitleUtils.setInteractiveSubtitlesEnabled(enabled);
            this.logWithFallback('info', 'Interactive subtitles toggled for Disney+', {
                enabled
            });
        } else {
            this.logWithFallback('warn', 'Subtitle utilities not available for interactive toggle');
        }
    }

    /**
     * Update context preferences
     * @param {Object} preferences - New context preferences
     * @returns {Promise<Object>} Update result
     */
    async _updateContextPreferences(preferences) {
        try {
            // Update interactive subtitle configuration if available
            if (this.subtitleUtils?.updateInteractiveConfig) {
                this.subtitleUtils.updateInteractiveConfig(preferences);
            }

            this.logWithFallback('info', 'Context preferences updated for Disney+', {
                preferences
            });

            return {
                updated: true,
                preferences
            };

        } catch (error) {
            this.logWithFallback('error', 'Failed to update context preferences', {
                error: error.message
            });
            throw error;
        }
    }
}
