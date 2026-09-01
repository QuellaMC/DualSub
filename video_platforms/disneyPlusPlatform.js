import { configService } from '../services/configService.js';
import {
    extractDisneyPlusVideoIdFromPathname,
    extractDisneyPlusVideoIdFromUrl,
    normalizeDisneyPlusVideoId,
    readOwnPrimitiveDataProperty,
} from '../content_scripts/shared/subtitleRequestIdentity.js';
import { BasePlatformAdapter } from './BasePlatformAdapter.js';

const PLAYBACK_TRANSITION_DELAY_MS = 160;
const PLAYBACK_BRIDGE_RESUME = 'PLAYBACK_BRIDGE_RESUME';
const PLAYBACK_BRIDGE_PAUSE = 'PLAYBACK_BRIDGE_PAUSE';
const TIMELINE_DRIFT_TOLERANCE_SECONDS = 1.5;
const RUNTIME_SAMPLE_STABILITY_MS = 100;
const TIMELINE_SELECTORS = [
    '.progress-bar__seekable-range[role="slider"][aria-valuenow]',
    '.progress-bar__seekable-range[aria-valuenow]',
    '[role="slider"][aria-label="Timeline"][aria-valuenow]',
    '[role="slider"][aria-valuenow][aria-valuemax]',
    '.progress-bar__thumb[aria-valuenow][aria-valuemax]',
];
const SUBTITLE_SELECTORS = [
    '.TimedTextOverlay',
    '.hive-subtitle-renderer-wrapper',
    '.hive-subtitle-renderer-cue-positioning-box',
    '.hive-subtitle-renderer-cue-window',
];
const STYLE_ID = 'dualsub-disneyplus-subtitle-hider';
const SUBTITLE_CSS = `
    .TimedTextOverlay[data-dualsub-hidden="true"],
    .hive-subtitle-renderer-wrapper[data-dualsub-hidden="true"],
    .hive-subtitle-renderer-cue-positioning-box[data-dualsub-hidden="true"],
    .hive-subtitle-renderer-cue-window[data-dualsub-hidden="true"] {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
    }
`;

export class DisneyPlusPlatform extends BasePlatformAdapter {
    constructor() {
        super('DisneyPlusPlatform');
        this._dispatchInjectorControl = null;
        this._stalePlaybackIdentity = null;
        this._resetPlaybackClockState();
    }

    _resetPlaybackClockState(needsFreshTimeline = false) {
        this._runtimePlaybackAnchor = null;
        this._runtimePendingAnchor = null;
        this._runtimeAnchorValid = false;
        this._runtimeAnchorNeedsCoherentSample = needsFreshTimeline;
        this._runtimeInterstitialActive = false;
        this._runtimeLastSequence = -1;
        this._cachedProgressBarElement = null;
        this._clockNeedsFreshTimeline = needsFreshTimeline;
    }

    isPlatformActive() {
        return window.location.hostname.includes('disneyplus.com');
    }

    extractVideoIdFromCurrentRoute() {
        return extractDisneyPlusVideoIdFromPathname(window.location.pathname);
    }

    isPlayerPageActive() {
        return Boolean(this.extractVideoIdFromCurrentRoute());
    }

    hasAdoptedPlayerRoute(url) {
        const routeVideoId = extractDisneyPlusVideoIdFromUrl(url);
        return Boolean(routeVideoId && routeVideoId === this.currentVideoId);
    }

    async initialize(
        onSubtitleUrlFound,
        onVideoIdChange,
        dispatchInjectorControl
    ) {
        this._retirePlatformLifecycle();
        if (!this.isPlatformActive()) return;

        this._dispatchInjectorControl =
            typeof dispatchInjectorControl === 'function'
                ? dispatchInjectorControl
                : null;
        this.setCallbacks(onSubtitleUrlFound, onVideoIdChange);
        this._beginPlatformLifecycle();
        this._resumePlaybackTimeline();
        this._requestPlaybackTimeline();
        this.setupNativeSubtitleSettingsListener(SUBTITLE_SELECTORS);
    }

    _dispatchPlaybackBridgeControl(type) {
        try {
            return this._dispatchInjectorControl?.(type) === true;
        } catch {
            return false;
        }
    }

    _requestPlaybackTimeline() {
        this._dispatchPlaybackBridgeControl('REQUEST_PLAYBACK_TIMELINE');
    }

    _resumePlaybackTimeline() {
        this._dispatchPlaybackBridgeControl(PLAYBACK_BRIDGE_RESUME);
    }

    _pausePlaybackTimeline() {
        this._dispatchPlaybackBridgeControl(PLAYBACK_BRIDGE_PAUSE);
    }

    prepareForInjectionChannelRevocation() {
        if (this._platformLifecycleStarted) this._pausePlaybackTimeline();
        this._dispatchInjectorControl = null;
    }

    _getRuntimeIdentity(value) {
        if (!value) return null;
        const availId = readOwnPrimitiveDataProperty(value, 'availId');
        const playbackSessionId = readOwnPrimitiveDataProperty(
            value,
            'playbackSessionId'
        );
        const identity = {
            availId: typeof availId === 'string' && availId ? availId : null,
            playbackSessionId:
                typeof playbackSessionId === 'string' && playbackSessionId
                    ? playbackSessionId
                    : null,
        };
        return identity.availId || identity.playbackSessionId ? identity : null;
    }

    _runtimeIdentitiesMatch(leftValue, rightValue) {
        const left = this._getRuntimeIdentity(leftValue);
        const right = this._getRuntimeIdentity(rightValue);
        if (!left || !right) return false;
        if (left.playbackSessionId && right.playbackSessionId) {
            return left.playbackSessionId === right.playbackSessionId;
        }
        return Boolean(left.availId && left.availId === right.availId);
    }

    _handlePlaybackTimelineUpdate(data) {
        const videoId = normalizeDisneyPlusVideoId(
            readOwnPrimitiveDataProperty(data, 'videoId')
        );
        const programTime = readOwnPrimitiveDataProperty(
            data,
            'programTimeSeconds'
        );
        const identity = this._getRuntimeIdentity(data);
        if (
            !this.currentVideoId ||
            videoId !== this.currentVideoId ||
            !identity ||
            !Number.isFinite(programTime) ||
            programTime < 0 ||
            (this._stalePlaybackIdentity &&
                this._runtimeIdentitiesMatch(this._stalePlaybackIdentity, data))
        ) {
            return;
        }

        const video = this.getVideoElement();
        const mediaTime = video?.currentTime;
        if (!Number.isFinite(mediaTime)) return;

        const sequence = Number(readOwnPrimitiveDataProperty(data, 'sequence'));
        if (
            Number.isFinite(sequence) &&
            sequence <= this._runtimeLastSequence
        ) {
            return;
        }

        const isInterstitialPlaying = readOwnPrimitiveDataProperty(
            data,
            'isInterstitialPlaying'
        );
        if (typeof isInterstitialPlaying === 'boolean') {
            this._runtimeInterstitialActive = isInterstitialPlaying;
        }

        const previous = this._runtimePlaybackAnchor;
        const sameRuntime = this._runtimeIdentitiesMatch(previous, data);
        if (
            this._runtimeAnchorNeedsCoherentSample &&
            previous?.videoElement === video &&
            sameRuntime
        ) {
            const coherent =
                Math.abs(
                    mediaTime -
                        previous.mediaTime -
                        (programTime - previous.programTime)
                ) <= TIMELINE_DRIFT_TOLERANCE_SECONDS;
            if (!coherent) {
                const pending = this._runtimePendingAnchor;
                const pendingCoherent =
                    pending?.videoElement === video &&
                    this._runtimeIdentitiesMatch(pending, data) &&
                    Math.abs(
                        mediaTime -
                            pending.mediaTime -
                            (programTime - pending.programTime)
                    ) <= TIMELINE_DRIFT_TOLERANCE_SECONDS &&
                    Date.now() - pending.observedAt >=
                        RUNTIME_SAMPLE_STABILITY_MS;
                if (!pendingCoherent) {
                    this._runtimePendingAnchor = {
                        videoElement: video,
                        mediaTime,
                        programTime,
                        observedAt: Date.now(),
                        ...identity,
                    };
                    this._runtimeLastSequence = Number.isFinite(sequence)
                        ? sequence
                        : this._runtimeLastSequence + 1;
                    return;
                }
            }
        }

        this._runtimePlaybackAnchor = {
            videoElement: video,
            videoId,
            mediaTime,
            programTime,
            ...identity,
        };
        this._runtimePendingAnchor = null;
        this._runtimeAnchorValid = true;
        this._runtimeAnchorNeedsCoherentSample = false;
        this._clockNeedsFreshTimeline = false;
        this._runtimeLastSequence = Number.isFinite(sequence)
            ? sequence
            : this._runtimeLastSequence + 1;
        this._stalePlaybackIdentity = null;
    }

    handleInjectorEvents(data, generation = this._lifecycleGeneration) {
        if (!data || !this._isPlatformLifecycleCurrent(generation)) return;
        const type = readOwnPrimitiveDataProperty(data, 'type');
        if (type === 'INJECT_SCRIPT_READY') {
            this._resumePlaybackTimeline();
            this._requestPlaybackTimeline();
            return;
        }
        if (type === 'PLAYBACK_TIMELINE_UPDATE') {
            this._handlePlaybackTimelineUpdate(data);
            return;
        }
        if (type !== 'SUBTITLE_URL_FOUND') return;
        return this._handleSubtitleUrl(data, generation);
    }

    async _handleSubtitleUrl(data, generation) {
        const isLifecycleCurrent = () =>
            this._isPlatformLifecycleCurrent(generation);
        const url = readOwnPrimitiveDataProperty(data, 'url');
        const eventVideoId = normalizeDisneyPlusVideoId(
            readOwnPrimitiveDataProperty(data, 'videoId')
        );
        const routeVideoId = this.extractVideoIdFromCurrentRoute();
        if (
            typeof url !== 'string' ||
            !url ||
            !eventVideoId ||
            eventVideoId !== routeVideoId
        ) {
            return;
        }

        if (this.currentVideoId !== routeVideoId) {
            this._stalePlaybackIdentity = this._getRuntimeIdentity(
                this._runtimePlaybackAnchor
            );
            this._resetPlaybackClockState(true);
            this.setVideoIdAndNotify(routeVideoId);
        }
        if (!isLifecycleCurrent()) return;

        const { request } = this.beginVttRequest(url, routeVideoId);
        if (!request) return;
        const requestIsCurrent = () =>
            isLifecycleCurrent() &&
            this.extractVideoIdFromCurrentRoute() === routeVideoId &&
            this.isVttRequestCurrent(request);

        try {
            const settings = await configService.getMultiple([
                'targetLanguage',
                'originalLanguage',
            ]);
            if (!requestIsCurrent()) return;
            const response = await this.requestVttViaMessaging(
                url,
                settings.targetLanguage || 'zh-CN',
                settings.originalLanguage || 'en',
                routeVideoId,
                requestIsCurrent
            );
            this.deliverVttResponse(request, response, requestIsCurrent);
        } catch {
            this._logBestEffort('error', 'Disney subtitle request failed');
        } finally {
            this.finishVttRequest(request);
        }
    }

    getVideoElement() {
        const videos = [...document.querySelectorAll('video')];
        if (videos.length < 2) return videos[0] || null;
        return videos.reduce((best, video) =>
            this._scoreVideo(video) > this._scoreVideo(best) ? video : best
        );
    }

    _scoreVideo(video) {
        try {
            const rect = video.getBoundingClientRect();
            return (
                (rect.width > 0 && rect.height > 0 ? 100 : 0) +
                (video.readyState >= 2 ? 40 : 0) +
                (video.currentSrc ? 25 : 0) +
                (!video.paused && !video.ended ? 30 : 0) +
                (video.currentTime > 0 ? 15 : 0)
            );
        } catch {
            return 0;
        }
    }

    getCurrentVideoId() {
        return this.currentVideoId;
    }

    getPlayerContainerElement() {
        return this.getVideoElement()?.parentElement || null;
    }

    getProgressBarElement() {
        if (this._cachedProgressBarElement?.isConnected) {
            return this._cachedProgressBarElement;
        }
        this._cachedProgressBarElement = null;

        for (const overlay of document.querySelectorAll(
            'main-app-controls-overlay'
        )) {
            const timeline = this._findTimelineInProgressHosts(
                overlay.shadowRoot?.querySelectorAll('progress-bar') || []
            );
            if (timeline) return (this._cachedProgressBarElement = timeline);
        }

        const lightDomTimeline = this._findTimelineInProgressHosts(
            document.querySelectorAll('progress-bar')
        );
        if (lightDomTimeline) {
            return (this._cachedProgressBarElement = lightDomTimeline);
        }

        const deepTimeline = this._querySelectorDeep(TIMELINE_SELECTORS);
        if (deepTimeline) {
            this._cachedProgressBarElement = deepTimeline;
        }
        return deepTimeline;
    }

    _findTimelineInProgressHosts(progressHosts) {
        for (const progressHost of progressHosts) {
            const root = progressHost.shadowRoot || progressHost;
            for (const selector of TIMELINE_SELECTORS) {
                try {
                    const timeline = root.querySelector(selector);
                    if (timeline) return timeline;
                } catch {}
            }
        }
        return null;
    }

    _readTimelineTime(timeline) {
        const value = Number(timeline?.getAttribute?.('aria-valuenow'));
        return Number.isFinite(value) && value >= 0 ? value : null;
    }

    getPlaybackTime(preferredVideoElement = null) {
        if (this._runtimeInterstitialActive) return null;
        const video = preferredVideoElement || this.getVideoElement();
        const mediaTime = video?.currentTime;
        if (!Number.isFinite(mediaTime)) return null;

        const anchor = this._runtimePlaybackAnchor;
        if (
            this._runtimeAnchorValid &&
            anchor?.videoElement === video &&
            anchor.videoId === this.currentVideoId
        ) {
            return Math.max(
                0,
                anchor.programTime + (mediaTime - anchor.mediaTime)
            );
        }

        if (!this._clockNeedsFreshTimeline) {
            const timelineTime = this._readTimelineTime(
                this.getProgressBarElement()
            );
            if (
                timelineTime !== null &&
                Math.abs(timelineTime - mediaTime) >
                    TIMELINE_DRIFT_TOLERANCE_SECONDS
            ) {
                return timelineTime;
            }
        }
        return mediaTime;
    }

    invalidatePlaybackClockCalibration() {
        this._clockNeedsFreshTimeline = true;
        this._runtimeAnchorValid = false;
        this._runtimeAnchorNeedsCoherentSample = true;
        this._runtimePendingAnchor = null;
        this._requestPlaybackTimeline();
    }

    supportsProgressBarTracking() {
        return false;
    }

    allowsDirectMediaPlaybackFallback() {
        return false;
    }

    _querySelectorDeep(selectors, acceptCandidate = null) {
        const selectorList = Array.isArray(selectors) ? selectors : [selectors];
        const visited = new Set();
        const queue = [document];
        while (queue.length > 0) {
            const root = queue.shift();
            if (!root || visited.has(root)) continue;
            visited.add(root);
            for (const selector of selectorList) {
                try {
                    if (acceptCandidate) {
                        for (const candidate of root.querySelectorAll(
                            selector
                        )) {
                            if (acceptCandidate(candidate)) return candidate;
                        }
                    } else {
                        const candidate = root.querySelector(selector);
                        if (candidate) return candidate;
                    }
                } catch {}
            }
            try {
                for (const node of root.querySelectorAll('*')) {
                    if (node.shadowRoot) queue.push(node.shadowRoot);
                }
            } catch {}
        }
        return null;
    }

    _getActionableToggleButton(root) {
        if (!root) return null;
        for (const selector of ['button', '[role="button"]']) {
            try {
                for (const candidate of root.querySelectorAll(selector)) {
                    if (
                        candidate.isConnected &&
                        !candidate.disabled &&
                        candidate.getAttribute('aria-disabled') !== 'true' &&
                        typeof candidate.click === 'function'
                    ) {
                        return candidate;
                    }
                }
            } catch {}
        }
        return null;
    }

    _getToggleButtonRoot() {
        const isActionable = (candidate) =>
            Boolean(this._getActionableToggleButton(candidate?.shadowRoot));
        try {
            const direct = document.querySelector(
                'disney-web-player-ui toggle-play-pause'
            );
            const host = isActionable(direct)
                ? direct
                : this._querySelectorDeep('toggle-play-pause', isActionable);
            return host?.shadowRoot || null;
        } catch {
            return null;
        }
    }

    isPlaying() {
        return this._getMediaPlayingState();
    }

    async _setPlaybackState(shouldPlay) {
        try {
            const video = this.getVideoElement();
            const state = this._getMediaPlayingState(video);
            if (state === null) return false;
            if (state === shouldPlay) return true;
            const button = this._getActionableToggleButton(
                this._getToggleButtonRoot()
            );
            if (!button) return false;
            button.click();
            await new Promise((resolve) =>
                setTimeout(resolve, PLAYBACK_TRANSITION_DELAY_MS)
            );
            return (
                video.isConnected &&
                this._getMediaPlayingState(video) === shouldPlay
            );
        } catch {
            return false;
        }
    }

    pausePlayback() {
        return this._setPlaybackState(false);
    }

    resumePlayback() {
        return this._setPlaybackState(true);
    }

    handleNativeSubtitles() {
        void this.handleNativeSubtitlesWithSetting(SUBTITLE_SELECTORS);
        this.installSubtitleHidingStyle(STYLE_ID, SUBTITLE_CSS);
        this.setupSubtitleObserver({
            getRoots: () => {
                const roots = [this.getPlayerContainerElement()];
                for (const overlay of document.querySelectorAll(
                    'main-app-controls-overlay'
                )) {
                    roots.push(overlay.shadowRoot);
                }
                return roots;
            },
            matches: (node) =>
                node?.nodeType === Node.ELEMENT_NODE &&
                (node.matches?.(
                    '.TimedTextOverlay, .hive-subtitle-renderer-wrapper'
                ) ||
                    node.querySelector?.(
                        '.TimedTextOverlay, .hive-subtitle-renderer-wrapper'
                    )),
            reapply: (generation) =>
                this.handleNativeSubtitlesWithSetting(
                    SUBTITLE_SELECTORS,
                    () => generation === this.ownedTimeoutGeneration
                ),
        });
    }

    _retirePlatformLifecycle() {
        if (this._platformLifecycleStarted) this._pausePlaybackTimeline();
        this._dispatchInjectorControl = null;
        this._retireAdapterLifecycle();
        this._stalePlaybackIdentity = null;
        this._resetPlaybackClockState();
    }

    cleanup() {
        this._retirePlatformLifecycle();
        document.getElementById(STYLE_ID)?.remove();
    }
}
