function hasPlayerRouteShape(pathname, routeSegments) {
    if (typeof pathname !== 'string') return false;
    const segments = pathname.split('/');
    return (
        segments[0] === '' &&
        routeSegments.includes(segments[1]) &&
        Boolean(segments[2]) &&
        (segments.length === 3 || (segments.length === 4 && segments[3] === ''))
    );
}

export function isNetflixPlayerPath(pathname) {
    return hasPlayerRouteShape(pathname, ['watch']);
}

export function isDisneyPlusPlayerPath(pathname) {
    return hasPlayerRouteShape(pathname, ['play', 'video']);
}

export class NavigationDetectionManager {
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
            ...options,
        };
        this.currentUrl = window.location.href;
        this.lastKnownPathname = window.location.pathname;
        this.intervalId = null;
        this.pendingUrlCheckTimeoutId = null;
        this.navigationLifecycleGeneration = 0;
        this.abortController = null;
        this.originalHistory = null;
        this.isSetup = false;
        this.checkForUrlChange = this.checkForUrlChange.bind(this);
    }

    setupComprehensiveNavigation() {
        if (this.isSetup) return;
        this.navigationLifecycleGeneration += 1;
        try {
            this.abortController = new AbortController();
            if (this.options.useIntervalChecking) {
                this.intervalId = setInterval(
                    this.checkForUrlChange,
                    this.options.intervalMs
                );
            }
            if (this.options.useHistoryAPI) this.#interceptHistory();
            if (this.options.usePopstateEvents) {
                for (const eventName of ['popstate', 'hashchange']) {
                    window.addEventListener(
                        eventName,
                        () => this.#scheduleUrlCheck(),
                        { signal: this.abortController.signal }
                    );
                }
            }
            if (this.options.useFocusEvents) {
                const schedule = () => this.#scheduleUrlCheck();
                window.addEventListener('focus', schedule, {
                    signal: this.abortController.signal,
                });
                document.addEventListener('visibilitychange', schedule, {
                    signal: this.abortController.signal,
                });
            }
            this.isSetup = true;
        } catch (error) {
            this.cleanup();
            throw error;
        }
    }

    checkForUrlChange() {
        try {
            const newUrl = window.location.href;
            const newPathname = window.location.pathname;
            if (
                newUrl === this.currentUrl &&
                newPathname === this.lastKnownPathname
            ) {
                return;
            }

            const oldUrl = this.currentUrl;
            const wasPlayerPage = this.#isPlayerPage(this.lastKnownPathname);
            const isPlayerPage = this.#isPlayerPage(newPathname);
            this.currentUrl = newUrl;
            this.lastKnownPathname = newPathname;
            this.options.onUrlChange?.(oldUrl, newUrl);
            if (wasPlayerPage !== isPlayerPage) {
                this.options.onPageTransition?.(wasPlayerPage, isPlayerPage);
            }
        } catch (error) {
            this.#log('error', 'URL change detection failed');
            if (error?.message?.includes('Extension context invalidated')) {
                this.cleanup();
            }
        }
    }

    cleanup() {
        this.navigationLifecycleGeneration += 1;
        if (this.intervalId !== null) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        if (this.pendingUrlCheckTimeoutId !== null) {
            clearTimeout(this.pendingUrlCheckTimeoutId);
            this.pendingUrlCheckTimeoutId = null;
        }
        this.abortController?.abort();
        this.abortController = null;

        const original = this.originalHistory;
        if (original) {
            if (history.pushState === original.pushStateWrapper) {
                history.pushState = original.pushState;
            }
            if (history.replaceState === original.replaceStateWrapper) {
                history.replaceState = original.replaceState;
            }
            this.originalHistory = null;
        }
        this.isSetup = false;
    }

    #interceptHistory() {
        const pushState = history.pushState;
        const replaceState = history.replaceState;
        const pushStateWrapper = (...args) => {
            const result = pushState.apply(history, args);
            this.#scheduleUrlCheck();
            return result;
        };
        const replaceStateWrapper = (...args) => {
            const result = replaceState.apply(history, args);
            this.#scheduleUrlCheck();
            return result;
        };
        this.originalHistory = {
            pushState,
            replaceState,
            pushStateWrapper,
            replaceStateWrapper,
        };
        history.pushState = pushStateWrapper;
        history.replaceState = replaceStateWrapper;
    }

    #scheduleUrlCheck(delay = 100) {
        if (!this.isSetup || this.pendingUrlCheckTimeoutId !== null) return;
        const generation = this.navigationLifecycleGeneration;
        const timeoutId = setTimeout(() => {
            if (
                generation !== this.navigationLifecycleGeneration ||
                this.pendingUrlCheckTimeoutId !== timeoutId
            ) {
                return;
            }
            this.pendingUrlCheckTimeoutId = null;
            this.checkForUrlChange();
        }, delay);
        this.pendingUrlCheckTimeoutId = timeoutId;
    }

    #isPlayerPage(pathname) {
        if (typeof this.options.isPlayerPage === 'function') {
            return this.options.isPlayerPage(pathname);
        }
        if (this.platform.toLowerCase() === 'netflix') {
            return isNetflixPlayerPath(pathname);
        }
        if (this.platform.toLowerCase() === 'disneyplus') {
            return isDisneyPlusPlayerPath(pathname);
        }
        return (
            isNetflixPlayerPath(pathname) || isDisneyPlusPlayerPath(pathname)
        );
    }

    #log(level, message) {
        try {
            this.options.logger?.(
                level,
                `[NavigationDetection:${this.platform}] ${message}`
            );
        } catch {}
    }
}
