/**
 * Implements Netflix-specific functionalities, including navigation detection,
 * injection configuration, and message handling, by extending the `BaseContentScript`.
 *
 * @extends BaseContentScript
 * @author DualSub Extension
 * @version 1.0.0
 */
import { BaseContentScript } from '../core/BaseContentScript.js';
import { createInjectionChannel } from '../shared/injectionChannel.js';
import { isNetflixPlayerPath } from '../shared/navigationUtils.js';

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
        const channel = createInjectionChannel('netflix');
        this.injectConfig = {
            filename: 'injected_scripts/netflixInject.js',
            tagId: 'netflix-dualsub-injector-script-tag',
            eventId: 'netflix-dualsub-injector-event',
            channel,
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
     * Checks whether a pathname is an active Netflix player route.
     * @param {string} pathname - The pathname to classify.
     * @returns {boolean} Whether the pathname is a player route.
     * @private
     */
    _isPlayerPath(pathname) {
        return isNetflixPlayerPath(pathname);
    }

    /**
     * Sets up Netflix-specific navigation detection.
     */
    setupNavigationDetection() {
        this.logWithFallback(
            'info',
            'Setting up Netflix-specific navigation detection.'
        );
        this._setupNavigationManager();
        this.logWithFallback(
            'info',
            'Enhanced Netflix navigation detection is set up.'
        );
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
        } else if (isOnPlayerPage && !wasOnPlayerPage) {
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
        this._cleanupOnPlayerPageLeave();
    }

    /**
     * Initializes the platform when entering a player page.
     * @private
     */
    _initializeOnPageEnter() {
        this._reinjectScript();
        this._schedulePlatformInitializationOnPageEnter(
            () => this.currentConfig,
            () => this.isPlayerPageActive(),
            1500
        );
    }

    /**
     * Re-injects the platform-specific script for a new page.
     * @private
     */
    _reinjectScript() {
        try {
            const config = this.injectConfig;
            const channelDescriptor = Object.getOwnPropertyDescriptor(
                config,
                'channel'
            );
            const channel = channelDescriptor?.value;
            const createUrlDescriptor = Object.getOwnPropertyDescriptor(
                channel,
                'createScriptUrl'
            );
            if (
                !channelDescriptor?.enumerable ||
                !Object.hasOwn(channelDescriptor, 'value') ||
                !createUrlDescriptor?.enumerable ||
                !Object.hasOwn(createUrlDescriptor, 'value') ||
                typeof createUrlDescriptor.value !== 'function'
            ) {
                return;
            }

            const baseScriptUrl = chrome.runtime.getURL(config.filename);
            const scriptUrl = createUrlDescriptor.value.call(
                channel,
                baseScriptUrl
            );
            if (typeof scriptUrl !== 'string') return;

            const existingScript = document.getElementById(config.tagId);
            if (existingScript) {
                existingScript.remove();
            }

            const script = document.createElement('script');
            script.src = scriptUrl;
            script.id = config.tagId;

            const target = document.head || document.documentElement;
            if (target) {
                target.appendChild(script);
                script.onload = () =>
                    this.logWithFallback(
                        'info',
                        'Script re-injected successfully.'
                    );
                script.onerror = () =>
                    this.logWithFallback(
                        'error',
                        'Failed to re-inject script.'
                    );
            }
        } catch {
            this.logWithFallback('error', 'Error during script re-injection.');
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
        return this._isPlayerPath(window.location.pathname);
    }

    /**
     * Gets Netflix-specific URL patterns for platform detection.
     * @returns {string[]} An array of URL patterns.
     */
    getUrlPatterns() {
        return this.urlPatterns;
    }

    /**
     * Gets Netflix-specific configuration defaults.
     * @returns {Object} An object with Netflix-specific configuration.
     */
    getNetflixSpecificConfig() {
        return {
            maxVideoDetectionRetries: 40,
            videoDetectionInterval: 1000,
            pageTransitionDelay: 1500,
            injectRetryDelay: 10,
            injectMaxRetries: 100,
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
            urlPatterns: this.getUrlPatterns(),
        };
    }
}
