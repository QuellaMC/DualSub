/**
 * Implements Disney+ specific functionalities, including navigation detection,
 * injection configuration, and message handling, by extending the `BaseContentScript`.
 *
 * @extends BaseContentScript
 * @author DualSub Extension
 * @version 1.0.0
 */
import { BaseContentScript } from '../core/BaseContentScript.js';
import { createInjectionChannel } from '../shared/injectionChannel.js';
import { isDisneyPlusPlayerPath } from '../shared/navigationUtils.js';

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
        const channel = createInjectionChannel('disneyplus');
        this.injectConfig = {
            filename: 'injected_scripts/disneyPlusInject.js',
            tagId: 'disneyplus-dualsub-injector-script-tag',
            eventId: 'disneyplus-dualsub-injector-event',
            channel,
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
        this._setupNavigationManager();
        this.logWithFallback(
            'info',
            'Enhanced Disney+ navigation detection is set up.'
        );
    }

    /**
     * Checks if a given path corresponds to a player page.
     * @param {string} pathname - The URL pathname to check.
     * @returns {boolean} `true` if it's a player page, otherwise `false`.
     * @private
     */
    _isPlayerPath(pathname) {
        return isDisneyPlusPlayerPath(pathname);
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
        this._cleanupOnPlayerPageLeave();
    }

    /**
     * Initializes the platform when entering a player page.
     * @private
     */
    _initializeOnPageEnter() {
        this._reinjectScript();
        this._schedulePlatformInitializationOnPageEnter(
            () =>
                this.configService.getAll({
                    includeSensitive: false,
                }),
            () => this._isPlayerPage(),
            1500
        );
    }

    /**
     * Re-injects the platform-specific script for a new page.
     * @private
     */
    _reinjectScript() {
        try {
            const baseScriptUrl = chrome.runtime.getURL(
                this.injectConfig.filename
            );
            const scriptUrl =
                this.injectConfig.channel?.createScriptUrl(baseScriptUrl);
            if (!scriptUrl) {
                this.logWithFallback(
                    'error',
                    'Cannot re-inject script without an active injection channel.'
                );
                return false;
            }

            const existingScript = document.getElementById(
                this.injectConfig.tagId
            );
            if (existingScript) {
                existingScript.remove();
            }

            const script = document.createElement('script');
            script.src = scriptUrl;
            script.id = this.injectConfig.tagId;

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
                return true;
            }
        } catch {
            this.logWithFallback('error', 'Error during script re-injection.');
        }
        return false;
    }

    /**
     * Gets Disney+ specific configuration defaults.
     * @returns {Object} An object with Disney+ specific configuration.
     */
    getDisneyPlusSpecificConfig() {
        return {
            maxVideoDetectionRetries: 40,
            videoDetectionInterval: 1000,
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
}
