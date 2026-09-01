import { BaseContentScript } from '../core/BaseContentScript.js';
import { createInjectionChannel } from '../shared/injectionChannel.js';
import { isDisneyPlusPlayerPath } from '../shared/navigationUtils.js';

export class DisneyPlusContentScript extends BaseContentScript {
    constructor() {
        super('DisneyPlusContent');
        this.injectConfig = {
            filename: 'injected_scripts/disneyPlusInject.js',
            tagId: 'disneyplus-dualsub-injector-script-tag',
            eventId: 'disneyplus-dualsub-injector-event',
            channel: createInjectionChannel('disneyplus'),
        };
        this.setupEarlyEventHandling();
    }

    getPlatformName() {
        return 'disneyplus';
    }

    getPlatformClass() {
        return 'DisneyPlusPlatform';
    }

    getInjectScriptConfig() {
        return this.injectConfig;
    }

    _isPlayerPath(pathname) {
        return isDisneyPlusPlayerPath(pathname);
    }

    _isPlayerPage() {
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
            () => this.configService.getAll({ includeSensitive: false }),
            () => this._isPlayerPage(),
            1500
        );
    }

    _reinjectScript() {
        try {
            const config = this.injectConfig;
            const scriptUrl = config.channel?.createScriptUrl?.(
                chrome.runtime.getURL(config.filename)
            );
            if (!scriptUrl) {
                this.logWithFallback(
                    'error',
                    'Cannot re-inject script without an active injection channel.'
                );
                return false;
            }

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
