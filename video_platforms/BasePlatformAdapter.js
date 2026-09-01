import Logger from '../utils/logger.js';
import { configService } from '../services/configService.js';
import {
    MessageActions,
    SubtitleRequestSources,
} from '../content_scripts/shared/constants/messageActions.js';

const OBSERVER_RETRY_DELAY_MS = 250;
const OBSERVER_MAX_ATTEMPTS = 20;

const createFallbackLogger = () => ({
    debug() {},
    info() {},
    warn() {},
    error() {},
    async updateLevel() {},
});

export class BasePlatformAdapter {
    constructor(adapterName = 'BasePlatformAdapter') {
        try {
            this.logger = Logger.create(adapterName, configService);
        } catch {
            this.logger = createFallbackLogger();
        }

        this._lifecycleGeneration = 0;
        this._platformLifecycleStarted = false;
        this._nativeSubtitleSettings = null;
        this._hideOfficialSubtitles = undefined;
        this.currentVideoId = null;
        this.onSubtitleUrlFoundCallback = null;
        this.onVideoIdChangeCallback = null;
        this.lastKnownVttUrlForVideoId = Object.create(null);
        this.pendingVttUrlForVideoId = Object.create(null);
        this.ownedTimeouts = new Map();
        this.ownedTimeoutGeneration = 0;
        void this.initializeLogger();
    }

    _beginPlatformLifecycle() {
        this._platformLifecycleStarted = true;
        return ++this._lifecycleGeneration;
    }

    _invalidatePlatformLifecycle() {
        this._platformLifecycleStarted = false;
        this._lifecycleGeneration += 1;
    }

    _isPlatformLifecycleCurrent(generation) {
        return (
            this._platformLifecycleStarted &&
            generation === this._lifecycleGeneration
        );
    }

    _logBestEffort(level, ...args) {
        try {
            this.logger?.[level]?.call(this.logger, ...args);
        } catch {}
    }

    async initializeLogger() {
        try {
            await this.logger?.updateLevel?.();
        } catch {
            this._logBestEffort('warn', 'Logger level update failed');
        }
    }

    getPlaybackTime(preferredVideoElement = null) {
        const video = preferredVideoElement || this.getVideoElement();
        return Number.isFinite(video?.currentTime) ? video.currentTime : null;
    }

    invalidatePlaybackClockCalibration() {}

    hasAdoptedPlayerRoute() {
        return false;
    }

    allowsDirectMediaPlaybackFallback() {
        return true;
    }

    getProgressBarElement() {
        return null;
    }

    supportsProgressBarTracking() {
        return true;
    }

    hideOfficialSubtitleContainers(selectors) {
        for (const selector of selectors) {
            for (const container of document.querySelectorAll(selector)) {
                container.style.display = 'none';
                container.style.visibility = 'hidden';
                container.style.opacity = '0';
                container.setAttribute('data-dualsub-hidden', 'true');
            }
        }
    }

    showOfficialSubtitleContainers() {
        const containers = document.querySelectorAll(
            '[data-dualsub-hidden="true"]'
        );
        for (const container of containers) {
            container.style.display = '';
            container.style.visibility = '';
            container.style.opacity = '';
            container.removeAttribute('data-dualsub-hidden');
        }
        this._logBestEffort('debug', 'Restored official subtitle containers', {
            restoredContainerCount: containers.length,
        });
    }

    async handleNativeSubtitlesWithSetting(
        selectors,
        additionalCurrentnessCheck = null
    ) {
        const generation = this._lifecycleGeneration;
        const session = this._nativeSubtitleSettings;
        const operation = session ? ++session.operation : 0;
        const isCurrent = () =>
            this._isPlatformLifecycleCurrent(generation) &&
            this._nativeSubtitleSettings === session &&
            (!session || session.operation === operation) &&
            (typeof additionalCurrentnessCheck !== 'function' ||
                additionalCurrentnessCheck());

        if (!isCurrent()) return;

        let shouldHide = this._hideOfficialSubtitles;
        if (shouldHide === undefined) {
            try {
                shouldHide = Boolean(
                    await configService.get('hideOfficialSubtitles')
                );
            } catch {
                shouldHide = false;
            }
            if (!isCurrent()) return;
            this._hideOfficialSubtitles = shouldHide;
        }

        if (!isCurrent()) return;
        if (shouldHide) this.hideOfficialSubtitleContainers(selectors);
        else this.showOfficialSubtitleContainers();
    }

    setupNativeSubtitleSettingsListener(selectors) {
        this.cleanupNativeSubtitleSettingsListener();

        const generation = this._lifecycleGeneration;
        const session = {
            selectors,
            operation: 0,
            unsubscribe: null,
        };
        this._nativeSubtitleSettings = session;
        const isCurrent = () =>
            this._nativeSubtitleSettings === session &&
            this._isPlatformLifecycleCurrent(generation);
        const apply = (shouldHide) => {
            if (!isCurrent()) return;
            this._hideOfficialSubtitles = Boolean(shouldHide);
            if (shouldHide) this.hideOfficialSubtitleContainers(selectors);
            else this.showOfficialSubtitleContainers();
        };

        session.listener = (changes) => {
            if (!isCurrent() || changes.hideOfficialSubtitles === undefined) {
                return;
            }
            session.operation += 1;
            apply(changes.hideOfficialSubtitles);
        };

        if (typeof configService?.onChanged !== 'function') return;
        try {
            session.unsubscribe = configService.onChanged(session.listener);
        } catch {
            return;
        }
        if (!isCurrent()) {
            try {
                session.unsubscribe?.();
            } catch {}
            return;
        }

        const operation = ++session.operation;
        Promise.resolve()
            .then(() => configService.get('hideOfficialSubtitles'))
            .then((value) => {
                if (isCurrent() && operation === session.operation) {
                    apply(value);
                }
            })
            .catch(() => {});
    }

    cleanupNativeSubtitleSettingsListener() {
        const session = this._nativeSubtitleSettings;
        this._nativeSubtitleSettings = null;
        this._hideOfficialSubtitles = undefined;
        this.showOfficialSubtitleContainers();
        try {
            session?.unsubscribe?.();
        } catch {}
    }

    _resetOwnedTimeoutLifecycle() {
        this._clearOwnedTimeouts();
        return this.ownedTimeoutGeneration;
    }

    _scheduleOwnedTimeout(
        key,
        callback,
        delay,
        generation = this.ownedTimeoutGeneration
    ) {
        if (generation !== this.ownedTimeoutGeneration) return null;
        clearTimeout(this.ownedTimeouts.get(key));
        const timeoutId = setTimeout(() => {
            if (
                generation !== this.ownedTimeoutGeneration ||
                this.ownedTimeouts.get(key) !== timeoutId
            ) {
                return;
            }
            this.ownedTimeouts.delete(key);
            callback();
        }, delay);
        this.ownedTimeouts.set(key, timeoutId);
        return timeoutId;
    }

    _clearOwnedTimeouts() {
        this.ownedTimeoutGeneration += 1;
        for (const timeoutId of this.ownedTimeouts.values()) {
            clearTimeout(timeoutId);
        }
        this.ownedTimeouts.clear();
    }

    _cleanupNativeSubtitleSettingsBestEffort() {
        try {
            this.cleanupNativeSubtitleSettingsListener();
        } catch {
            this._nativeSubtitleSettings = null;
        }
    }

    _getMediaPlayingState(video = this.getVideoElement()) {
        return video ? !video.paused && !video.ended : null;
    }

    setCallbacks(onSubtitleUrlFound, onVideoIdChange) {
        this.onSubtitleUrlFoundCallback = onSubtitleUrlFound;
        this.onVideoIdChangeCallback = onVideoIdChange;
    }

    setVideoIdAndNotify(videoId) {
        if (this.currentVideoId === videoId) return;
        const previousVideoId = this.currentVideoId;
        if (previousVideoId) {
            delete this.lastKnownVttUrlForVideoId[previousVideoId];
            delete this.pendingVttUrlForVideoId[previousVideoId];
        }
        this.currentVideoId = videoId;
        this.onVideoIdChangeCallback?.(videoId);
    }

    beginVttRequest(url, videoId = this.currentVideoId) {
        const pending = this.pendingVttUrlForVideoId[videoId];
        if (
            this.lastKnownVttUrlForVideoId[videoId] === url ||
            pending?.url === url
        ) {
            return { request: null, inFlight: pending?.url === url };
        }
        const request = { url, videoId };
        this.pendingVttUrlForVideoId[videoId] = request;
        return { request, inFlight: false };
    }

    isVttRequestCurrent(request) {
        return Boolean(
            request &&
            this.currentVideoId === request.videoId &&
            this.pendingVttUrlForVideoId[request.videoId] === request
        );
    }

    canAcceptVttResponse(request, response) {
        return Boolean(
            response?.success &&
            response.videoId === request?.videoId &&
            this.isVttRequestCurrent(request)
        );
    }

    acceptVttResponse(request, response) {
        if (!this.canAcceptVttResponse(request, response)) return false;
        this.lastKnownVttUrlForVideoId[request.videoId] = request.url;
        return true;
    }

    deliverVttResponse(request, response, isCurrent) {
        if (
            !isCurrent() ||
            !this.canAcceptVttResponse(request, response) ||
            typeof this.onSubtitleUrlFoundCallback !== 'function'
        ) {
            return false;
        }

        this.onSubtitleUrlFoundCallback({
            vttText: response.vttText,
            targetVttText: response.targetVttText,
            videoId: response.videoId,
            sourceLanguage: response.sourceLanguage,
            targetLanguage: response.targetLanguage,
            useNativeTarget: response.useNativeTarget,
            selectedLanguage: {
                normalizedCode: response.selectedLanguage.normalizedCode,
                displayName: response.selectedLanguage.displayName,
            },
        });

        return isCurrent() && this.acceptVttResponse(request, response);
    }

    finishVttRequest(request) {
        if (this.pendingVttUrlForVideoId[request?.videoId] === request) {
            delete this.pendingVttUrlForVideoId[request.videoId];
        }
    }

    resetVttRequestState() {
        this.lastKnownVttUrlForVideoId = Object.create(null);
        this.pendingVttUrlForVideoId = Object.create(null);
    }

    installSubtitleHidingStyle(id, css) {
        let style = document.getElementById(id);
        if (!style) {
            if (!document.head) return;
            style = document.createElement('style');
            style.id = id;
            document.head.appendChild(style);
        }
        style.textContent = css;
    }

    setupSubtitleObserver({ getRoots, matches, reapply }) {
        const generation = this._resetOwnedTimeoutLifecycle();
        this._disconnectSubtitleMutationObserver();

        const attemptSetup = (attempt) => {
            if (generation !== this.ownedTimeoutGeneration) return;

            let roots = [];
            try {
                roots = [...new Set(getRoots())].filter(
                    (root) => root instanceof Node && root !== document.body
                );
            } catch {}

            if (roots.length === 0) {
                scheduleRetry(attempt);
                return;
            }

            let observer;
            try {
                observer = new MutationObserver((mutations) => {
                    if (
                        generation !== this.ownedTimeoutGeneration ||
                        this.subtitleObserver !== observer
                    ) {
                        return;
                    }
                    const found = mutations.some(
                        (mutation) =>
                            mutation.type === 'childList' &&
                            [...mutation.addedNodes].some(matches)
                    );
                    if (found) {
                        this._scheduleOwnedTimeout(
                            'subtitle-setting-reapply',
                            () => {
                                Promise.resolve(reapply(generation)).catch(
                                    () => {}
                                );
                            },
                            100,
                            generation
                        );
                    }
                });
            } catch {
                scheduleRetry(attempt);
                return;
            }

            let attached = false;
            for (const root of roots) {
                try {
                    observer.observe(root, { childList: true, subtree: true });
                    attached = true;
                } catch {}
            }

            if (!attached || generation !== this.ownedTimeoutGeneration) {
                try {
                    observer.disconnect();
                } catch {}
                if (!attached) scheduleRetry(attempt);
                return;
            }
            this.subtitleObserver = observer;
        };

        const scheduleRetry = (attempt) => {
            if (attempt >= OBSERVER_MAX_ATTEMPTS) return;
            this._scheduleOwnedTimeout(
                'subtitle-observer-retry',
                () => attemptSetup(attempt + 1),
                OBSERVER_RETRY_DELAY_MS,
                generation
            );
        };

        attemptSetup(1);
    }

    _disconnectSubtitleMutationObserver() {
        try {
            this.subtitleObserver?.disconnect();
        } catch {}
        this.subtitleObserver = null;
    }

    _retireAdapterLifecycle() {
        this._invalidatePlatformLifecycle();
        this._clearOwnedTimeouts();
        this._cleanupNativeSubtitleSettingsBestEffort();
        this._disconnectSubtitleMutationObserver();
        this.currentVideoId = null;
        this.onSubtitleUrlFoundCallback = null;
        this.onVideoIdChangeCallback = null;
        this.resetVttRequestState();
    }

    async _sendMessageResilient(message, options = {}) {
        const { sendRuntimeMessageWithRetry } = await import(
            chrome.runtime.getURL('content_scripts/shared/messaging.js')
        );
        return sendRuntimeMessageWithRetry(message, {
            retries: 3,
            baseDelayMs: 150,
            ...options,
        });
    }

    requestVttViaMessaging(
        url,
        targetLanguage,
        originalLanguage,
        videoId = this.currentVideoId,
        canDispatch
    ) {
        return this._sendMessageResilient(
            {
                action: MessageActions.FETCH_VTT,
                url,
                videoId,
                targetLanguage,
                originalLanguage,
                source: SubtitleRequestSources.DISNEY_PLUS,
            },
            { canDispatch }
        );
    }

    requestNetflixVttWithTracks(
        tracks,
        targetLanguage,
        originalLanguage,
        useOfficialSubtitles,
        videoId = this.currentVideoId,
        canDispatch
    ) {
        return this._sendMessageResilient(
            {
                action: MessageActions.FETCH_VTT,
                data: { tracks },
                videoId,
                targetLanguage,
                originalLanguage,
                useNativeSubtitles: useOfficialSubtitles,
                useOfficialTranslations: useOfficialSubtitles,
                source: SubtitleRequestSources.NETFLIX,
            },
            { canDispatch }
        );
    }
}
