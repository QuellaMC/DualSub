/**
 * Implements Netflix-specific functionalities, including navigation detection,
 * injection configuration, and message handling, by extending the `BaseContentScript`.
 *
 * @extends BaseContentScript
 * @author DualSub Extension
 * @version 1.0.0
 */
import { BaseContentScript } from '../core/BaseContentScript.js';

export class NetflixContentScript extends BaseContentScript {
    /**
     * Creates a new instance of `NetflixContentScript`.
     */
    constructor() {
        super('NetflixContent');
        this._initializeNetflixSpecificState();
    }

    /**
     * Initializes Netflix-specific state properties.
     * @private
     */
    _initializeNetflixSpecificState() {
        this.injectConfig = {
            filename: 'injected_scripts/netflixInject.js',
            tagId: 'netflix-dualsub-injector-script-tag',
            eventId: 'netflix-dualsub-injector-event'
        };
        this.urlPatterns = ['*.netflix.com'];
    }

    /**
     * Gets the platform name.
     * @returns {string} The platform name, 'netflix'.
     */
    getPlatformName() {
        return 'netflix';
    }

    /**
     * Gets the platform class constructor name.
     * @returns {string} The platform class name, 'NetflixPlatform'.
     */
    getPlatformClass() {
        return 'NetflixPlatform';
    }

    /**
     * Gets the inject script configuration.
     * @returns {Object} The inject script configuration.
     */
    getInjectScriptConfig() {
        return this.injectConfig;
    }

    /**
     * Sets up Netflix-specific navigation detection.
     */
    setupNavigationDetection() {
        this.logWithFallback('info', 'Setting up Netflix-specific navigation detection.');
        this._setupIntervalBasedDetection();
        this._setupHistoryAPIInterception();
        this._setupBrowserNavigationEvents();
        this._setupFocusAndVisibilityEvents();
        this.logWithFallback('info', 'Enhanced Netflix navigation detection is set up.');
    }

    /**
     * Checks for URL changes with Netflix-specific logic.
     */
    checkForUrlChange() {
        try {
            const newUrl = window.location.href;
            const newPathname = window.location.pathname;

            if (newUrl !== this.currentUrl || newPathname !== this.lastKnownPathname) {
                this.logWithFallback('info', 'URL change detected.', {
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
            this.logWithFallback('error', 'Error in URL change detection.', { error });
            this._handleExtensionContextError(error);
        }
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
            
            this.logWithFallback('debug', 'Processing Netflix-specific message.', {
                action,
                hasRequest: !!request,
                requestKeys: Object.keys(request || {})
            });

            switch (action) {
                default:
                    this.logWithFallback('debug', 'No Netflix-specific handling required.', {
                        action,
                        message: 'Delegating to default handling.'
                    });
                    
                    sendResponse({ 
                        success: true, 
                        handled: false,
                        platform: 'netflix',
                        message: 'No platform-specific handling required.'
                    });
                    return false;
            }
        } catch (error) {
            const action = request ? (request.action || request.type) : 'unknown';
            
            this.logWithFallback('error', 'Error in Netflix-specific message handling.', {
                error: error.message,
                stack: error.stack,
                action
            });
            
            try {
                if (typeof sendResponse === 'function') {
                    sendResponse({
                        success: false,
                        error: error.message,
                        platform: 'netflix'
                    });
                }
            } catch (responseError) {
                this.logWithFallback('error', 'Error sending error response.', {
                    originalError: error.message,
                    responseError: responseError.message
                });
            }
            return false;
        }
    }

    /**
     * An example method for handling Netflix-specific actions.
     * @private
     * @param {Object} request - The Chrome message request.
     * @param {Function} sendResponse - The callback to send a response.
     * @returns {boolean} `false` for synchronous handling.
     */
    _handleNetflixSpecificAction(request, sendResponse) {
        this.logWithFallback('info', 'Handling Netflix-specific action.', {
            action: request.action,
            data: request.data
        });
        
        sendResponse({
            success: true,
            platform: 'netflix',
            action: request.action,
            result: 'Netflix-specific action completed.'
        });
        
        return false;
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

        history.pushState = (...args) => {
            originalPushState.apply(history, args);
            setTimeout(() => this.checkForUrlChange(), 100);
        };

        history.replaceState = (...args) => {
            originalReplaceState.apply(history, args);
            setTimeout(() => this.checkForUrlChange(), 100);
        };

        this._originalHistoryMethods = {
            pushState: originalPushState,
            replaceState: originalReplaceState
        };
    }

    /**
     * Sets up browser navigation event listeners.
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
            
            this.logWithFallback('debug', `Added ${name} event listener for navigation detection.`);
        });
    }

    /**
     * Sets up focus and visibility event listeners.
     * @private
     */
    _setupFocusAndVisibilityEvents() {
        const focusHandler = () => setTimeout(() => this.checkForUrlChange(), 100);
        
        const options = this.abortController ? { signal: this.abortController.signal } : {};
        window.addEventListener('focus', focusHandler, options);
        document.addEventListener('visibilitychange', focusHandler, options);

        this.logWithFallback('debug', 'Added focus and visibility event listeners for navigation detection.');
    }

    /**
     * Handles page transitions between player and non-player pages.
     * @private
     * @param {boolean} wasOnPlayerPage - Whether the previous page was a player page.
     * @param {boolean} isOnPlayerPage - Whether the current page is a player page.
     */
    _handlePageTransition(wasOnPlayerPage, isOnPlayerPage) {
        if (wasOnPlayerPage && !isOnPlayerPage) {
            this.logWithFallback('info', 'Leaving player page, cleaning up platform.');
            this._cleanupOnPageLeave();
        } else if (isOnPlayerPage && !wasOnPlayerPage) {
            this.logWithFallback('info', 'Entering player page, preparing for initialization.');
            this._initializeOnPageEnter();
        }
    }

    /**
     * Cleans up resources when leaving a player page.
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

        try {
            const script = document.createElement('script');
            script.textContent = 'window.netflixDualSubInjectorLoaded = false;';
            (document.head || document.documentElement).appendChild(script);
            script.remove(); // The script executes instantly, so we can clean it up immediately.
            this.logWithFallback('info', 'Injected script to reset injector guard flag.');
        } catch (e) {
            this.logWithFallback('error', 'Failed to inject script to reset injector flag.', { error: e.message });
        }
    }

    /**
     * Initializes the platform when entering a player page.
     * @private
     */
    _initializeOnPageEnter() {
        this._reinjectScript();

        setTimeout(async () => {
            try {
                if (this.currentConfig?.subtitlesEnabled) {
                    this.logWithFallback('info', 'Subtitles enabled, initializing platform.');
                    await this.initializePlatform();
                }
            } catch (error) {
                this.logWithFallback('error', 'Error during URL change initialization.', { error });
            }
        }, 1500);
    }

    /**
     * Re-injects the platform-specific script for a new page.
     * @private
     */
    _reinjectScript() {
        try {
            const existingScript = document.getElementById(this.injectConfig.tagId);
            if (existingScript) {
                existingScript.remove();
            }

            const script = document.createElement('script');
            script.src = chrome.runtime.getURL(this.injectConfig.filename);
            script.id = this.injectConfig.tagId;

            const target = document.head || document.documentElement;
            if (target) {
                target.appendChild(script);
                script.onload = () => this.logWithFallback('info', 'Script re-injected successfully.');
                script.onerror = (e) => this.logWithFallback('error', 'Failed to re-inject script.', { error: e });
            }
        } catch (error) {
            this.logWithFallback('error', 'Error during script re-injection.', { error });
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
            this.logWithFallback('info', 'Stopped URL change detection due to extension context invalidation.');
        }
    }

    /**
     * Checks if the current page is a Netflix platform page.
     * @returns {boolean} `true` if on Netflix, otherwise `false`.
     */
    isPlatformActive() {
        return window.location.hostname.includes('netflix.com');
    }

    /**
     * Checks if the current page is a Netflix player page.
     * @returns {boolean} `true` if on a player page, otherwise `false`.
     */
    isPlayerPageActive() {
        return window.location.pathname.includes('/watch/');
    }

    /**
     * Gets Netflix-specific URL patterns for platform detection.
     * @returns {string[]} An array of URL patterns.
     */
    getUrlPatterns() {
        return this.urlPatterns;
    }

    /**
     * Cleans up Netflix-specific resources.
     * @override
     */
    async cleanup() {
        try {
            if (this._originalHistoryMethods) {
                history.pushState = this._originalHistoryMethods.pushState;
                history.replaceState = this._originalHistoryMethods.replaceState;
                this._originalHistoryMethods = null;
            }

            await super.cleanup();

            this.logWithFallback('info', 'Netflix-specific cleanup completed.');
        } catch (error) {
            this.logWithFallback('error', 'Error during Netflix-specific cleanup.', { error });
            throw error;
        }
    }

    /**
     * Gets Netflix-specific configuration defaults.
     * @returns {Object} An object with Netflix-specific configuration.
     */
    getNetflixSpecificConfig() {
        return {
            maxVideoDetectionRetries: 40,
            videoDetectionInterval: 1000,
            urlChangeCheckInterval: 2000,
            pageTransitionDelay: 1500,
            injectRetryDelay: 10,
            injectMaxRetries: 100
        };
    }

    /**
     * Applies Netflix-specific configuration overrides.
     * @param {Object} baseConfig - The base configuration.
     * @returns {Object} The configuration with Netflix-specific overrides.
     */
    applyNetflixConfigOverrides(baseConfig) {
        const netflixConfig = this.getNetflixSpecificConfig();
        
        return {
            ...baseConfig,
            ...netflixConfig,
            platformName: this.getPlatformName(),
            injectConfig: this.getInjectScriptConfig(),
            urlPatterns: this.getUrlPatterns()
        };
    }
}