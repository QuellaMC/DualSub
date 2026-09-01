import { BaseContentScript } from '../core/BaseContentScript.js';
import { createInjectionChannel } from '../shared/injectionChannel.js';
import { isNetflixPlayerPath } from '../shared/navigationUtils.js';

export class NetflixContentScript extends BaseContentScript {
    constructor() {
        super('NetflixContent');
        this.injectConfig = {
            filename: 'injected_scripts/netflixInject.js',
            tagId: 'netflix-dualsub-injector-script-tag',
            eventId: 'netflix-dualsub-injector-event',
            channel: createInjectionChannel('netflix'),
        };
    }

    getPlatformName() {
        return 'netflix';
    }

    getPlatformClass() {
        return 'NetflixPlatform';
    }

    getInjectScriptConfig() {
        return this.injectConfig;
    }

    _isPlayerPath(pathname) {
        return isNetflixPlayerPath(pathname);
    }

    isPlayerPageActive() {
        return this._isPlayerPath(window.location.pathname);
    }

    setupNavigationDetection() {
        this._setupNavigationManager();
    }

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

    _cleanupOnPageLeave() {
        this._cleanupOnPlayerPageLeave();
    }

    _initializeOnPageEnter() {
        this._reinjectScript();
        this._schedulePlatformInitializationOnPageEnter(
            () => this.currentConfig,
            () => this.isPlayerPageActive(),
            1500
        );
    }

    _reinjectScript() {
        try {
            const config = this.injectConfig;
            const scriptUrl = config.channel?.createScriptUrl?.(
                chrome.runtime.getURL(config.filename)
            );
            if (!scriptUrl) return false;

            document.getElementById(config.tagId)?.remove();
            const script = document.createElement('script');
            script.src = scriptUrl;
            script.id = config.tagId;
            const target = document.head || document.documentElement;
            if (!target) return false;

            target.appendChild(script);
            script.onload = () =>
                this.logWithFallback(
                    'info',
                    'Script re-injected successfully.'
                );
            script.onerror = () =>
                this.logWithFallback('error', 'Failed to re-inject script.');
            return true;
        } catch {
            this.logWithFallback('error', 'Error during script re-injection.');
            return false;
        }
    }
}
