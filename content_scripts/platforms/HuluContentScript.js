/**
 * Implements Hulu-specific functionalities, including navigation detection,
 * injection configuration, and message handling, by extending the `BaseContentScript`.
 *
 * @extends BaseContentScript
 * @author DualSub Extension
 * @version 1.0.0
 */
import { BaseContentScript } from '../core/BaseContentScript.js';

export class HuluContentScript extends BaseContentScript {
    /**
     * Creates a new instance of `HuluContentScript`.
     */
    constructor() {
        super('HuluContent');
        this._initializeHuluSpecificState();
    }

    /**
     * Initializes Hulu-specific state properties.
     * @private
     */
    _initializeHuluSpecificState() {
        this.injectConfig = {
            filename: 'injected_scripts/huluInject.js',
            tagId: 'hulu-dualsub-injector-script-tag',
            eventId: 'hulu-dualsub-injector-event',
        };
        this.urlPatterns = ['*.hulu.com'];
    }

    /**
     * Gets the platform name.
     * @returns {string} The platform name, 'hulu'.
     */
    getPlatformName() {
        return 'hulu';
    }

    /**
     * Gets the platform class constructor name.
     * @returns {string} The platform class name, 'HuluPlatform'.
     */
    getPlatformClass() {
        return 'HuluPlatform';
    }

    /**
     * Gets the inject script configuration.
     * @returns {Object} The inject script configuration.
     */
    getInjectScriptConfig() {
        return this.injectConfig;
    }

    /**
     * Sets up Hulu-specific navigation detection (SPA-friendly).
     */
    setupNavigationDetection() {
        this.logWithFallback('info', 'Setting up Hulu navigation detection.');
        // Use unified navigation manager used across platforms; disable focus-based events to avoid noisy logs
        this._setupNavigationManager({ intervalMs: 1000, useFocusEvents: false });
        this.logWithFallback('info', 'Hulu navigation detection is set up.');
    }

    /**
     * Checks for URL changes with Hulu-specific logic.
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

                // Notify platform of URL changes if applicable
                try {
                    if (this.activePlatform && this.activePlatform.onUrlChange) {
                        this.activePlatform.onUrlChange(newUrl);
                    }
                } catch (e) {
                    this.logWithFallback('debug', 'Platform onUrlChange notification failed', {
                        error: e.message,
                    });
                }
            }
        } catch (error) {
            this.logWithFallback('error', 'Error in URL change detection.', { error });
            this._handleExtensionContextError(error);
        }
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
                script.onload = () =>
                    this.logWithFallback('info', 'Hulu script re-injected successfully.');
                script.onerror = (e) =>
                    this.logWithFallback('error', 'Failed to re-inject Hulu script.', {
                        error: e,
                    });
            }
        } catch (error) {
            this.logWithFallback('error', 'Error during Hulu script re-injection.', {
                error,
            });
        }
    }
}
