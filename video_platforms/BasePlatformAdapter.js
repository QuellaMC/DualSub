import { VideoPlatform } from './platform_interface.js';
import Logger from '../utils/logger.js';
import { configService } from '../services/configService.js';
import {
    MessageActions,
    SubtitleRequestSources,
} from '../content_scripts/shared/constants/messageActions.js';

/**
 * BasePlatformAdapter - shared wiring for platform adapters
 * Provides common logger initialization, videoId tracking, and VTT request helpers.
 */
export class BasePlatformAdapter extends VideoPlatform {
    constructor(adapterName = 'BasePlatformAdapter') {
        super();
        try {
            this.logger = Logger.create(adapterName, configService);
        } catch (error) {
            // Fallback logger to avoid hard failures in non-extension contexts
            this.logger = {
                debug: (...args) => console.debug(`[${adapterName}]`, ...args),
                info: (...args) => console.info(`[${adapterName}]`, ...args),
                warn: (...args) => console.warn(`[${adapterName}]`, ...args),
                error: (...args) => console.error(`[${adapterName}]`, ...args),
                updateLevel: () => Promise.resolve(),
            };
        }

        this.currentVideoId = null;
        this.onSubtitleUrlFoundCallback = null;
        this.onVideoIdChangeCallback = null;
        this.lastKnownVttUrlForVideoId = Object.create(null);
        this.pendingVttUrlForVideoId = Object.create(null);
        this.eventListener = null;
        this.ownedTimeouts = new Map();
        this.ownedTimeoutGeneration = 0;
    }

    /**
     * Start a new adapter-owned timeout lifecycle and cancel older work.
     * @protected
     * @returns {number} The new timeout lifecycle generation.
     */
    _resetOwnedTimeoutLifecycle() {
        this._clearOwnedTimeouts();
        return this.ownedTimeoutGeneration;
    }

    /**
     * Schedule one keyed timeout owned by the captured adapter lifecycle.
     * Reusing a key replaces the prior pending timeout.
     * @protected
     * @param {string} key - Stable ownership key.
     * @param {Function} callback - Work to run while the lifecycle is current.
     * @param {number} delay - Delay in milliseconds.
     * @param {number} generation - Captured timeout lifecycle generation.
     * @returns {*} The timeout identifier, or null when already stale.
     */
    _scheduleOwnedTimeout(
        key,
        callback,
        delay,
        generation = this.ownedTimeoutGeneration
    ) {
        if (generation !== this.ownedTimeoutGeneration) {
            return null;
        }

        const existingTask = this.ownedTimeouts.get(key);
        if (
            existingTask?.timeoutId !== null &&
            existingTask?.timeoutId !== undefined
        ) {
            clearTimeout(existingTask.timeoutId);
        }

        const task = { timeoutId: null };
        this.ownedTimeouts.set(key, task);
        task.timeoutId = setTimeout(() => {
            if (
                this.ownedTimeouts.get(key) !== task ||
                generation !== this.ownedTimeoutGeneration
            ) {
                return;
            }

            this.ownedTimeouts.delete(key);
            callback();
        }, delay);
        return task.timeoutId;
    }

    /**
     * Cancel and invalidate every adapter-owned timeout.
     * @protected
     */
    _clearOwnedTimeouts() {
        this.ownedTimeoutGeneration += 1;
        for (const task of this.ownedTimeouts.values()) {
            if (task.timeoutId !== null && task.timeoutId !== undefined) {
                clearTimeout(task.timeoutId);
            }
        }
        this.ownedTimeouts.clear();
    }

    async initializeLogger() {
        try {
            if (this.logger && this.logger.updateLevel) {
                await this.logger.updateLevel();
            }
        } catch {
            this._logBestEffort(
                'warn',
                'Failed to initialize logger level, continuing with defaults',
                { loggerInitialized: false }
            );
        }
    }

    /**
     * Snapshot one array length without trusting a page-owned Proxy result.
     * Callers reuse the returned primitive instead of reflecting the source.
     * @protected
     * @param {*} value Potentially untrusted array value.
     * @returns {number} A non-negative safe integer, or zero when unsafe.
     */
    _getSafeArrayLength(value) {
        try {
            if (!Array.isArray(value)) return 0;
            const length = value.length;
            return Number.isSafeInteger(length) && length >= 0 ? length : 0;
        } catch {
            return 0;
        }
    }

    _cleanupNativeSubtitleSettingsBestEffort() {
        try {
            this.cleanupNativeSubtitleSettingsListener();
        } catch {
            this.storageListener = null;
            this.subtitleSelectors = null;
            this.unsubscribeFromChanges = null;
        }
    }

    /**
     * Read the authoritative HTML media playback state.
     * @protected
     * @param {HTMLVideoElement|null} video - Video element to inspect.
     * @returns {boolean|null} True only while media is actively playing, or
     * null when no video is available.
     */
    _getMediaPlayingState(video = this.getVideoElement()) {
        if (!video) return null;
        return !video.paused && !video.ended;
    }

    setCallbacks(onSubtitleUrlFound, onVideoIdChange) {
        this.onSubtitleUrlFoundCallback = onSubtitleUrlFound;
        this.onVideoIdChangeCallback = onVideoIdChange;
    }

    setVideoIdAndNotify(newVideoId) {
        if (this.currentVideoId !== newVideoId) {
            const previousVideoId = this.currentVideoId;
            this._logBestEffort('info', 'Video context changing', {
                hadPreviousVideoId: Boolean(previousVideoId),
                hasNewVideoId: Boolean(newVideoId),
            });
            if (previousVideoId) {
                delete this.lastKnownVttUrlForVideoId[previousVideoId];
                delete this.pendingVttUrlForVideoId[previousVideoId];
            }
            this.currentVideoId = newVideoId;
            this.onVideoIdChangeCallback?.(this.currentVideoId);
        }
    }

    beginVttRequest(url, videoId = this.currentVideoId) {
        const pendingRequest = this.pendingVttUrlForVideoId[videoId];
        const inFlight = pendingRequest?.url === url;
        if (this.lastKnownVttUrlForVideoId[videoId] === url || inFlight) {
            return { request: null, inFlight };
        }

        const request = Object.freeze({ url, videoId });
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

    finishVttRequest(request) {
        if (
            request &&
            this.pendingVttUrlForVideoId[request.videoId] === request
        ) {
            delete this.pendingVttUrlForVideoId[request.videoId];
        }
    }

    resetVttRequestState() {
        this.lastKnownVttUrlForVideoId = Object.create(null);
        this.pendingVttUrlForVideoId = Object.create(null);
    }

    async _sendMessageResilient(
        message,
        { retries = 3, baseDelayMs = 150, canDispatch } = {}
    ) {
        // Delegate to shared resilient messaging wrapper which handles callback vs. promise paths and retries.
        const { sendRuntimeMessageWithRetry } = await import(
            chrome.runtime.getURL('content_scripts/shared/messaging.js')
        );
        return await sendRuntimeMessageWithRetry(message, {
            retries,
            baseDelayMs,
            canDispatch,
        });
    }

    async requestVttViaMessaging(
        vttUrl,
        targetLanguage,
        originalLanguage,
        videoId = this.currentVideoId,
        canDispatch
    ) {
        const message = {
            action: MessageActions.FETCH_VTT,
            url: vttUrl,
            videoId,
            targetLanguage,
            originalLanguage,
            source: SubtitleRequestSources.DISNEY_PLUS,
        };
        return await this._sendMessageResilient(message, {
            retries: 3,
            baseDelayMs: 150,
            canDispatch,
        });
    }

    async requestNetflixVttWithTracks(
        timedtexttracks,
        targetLanguage,
        originalLanguage,
        useOfficialSubtitles,
        videoId = this.currentVideoId,
        canDispatch
    ) {
        const message = {
            action: MessageActions.FETCH_VTT,
            data: { tracks: timedtexttracks },
            videoId,
            targetLanguage,
            originalLanguage,
            useNativeSubtitles: useOfficialSubtitles,
            useOfficialTranslations: useOfficialSubtitles,
            source: SubtitleRequestSources.NETFLIX,
        };
        return await this._sendMessageResilient(message, {
            retries: 3,
            baseDelayMs: 150,
            canDispatch,
        });
    }
}
