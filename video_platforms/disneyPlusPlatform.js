import Logger from '../utils/logger.js';
import { configService } from '../services/configService.js';

import { Injection } from '../content_scripts/shared/constants/injection.js';
import { createInjectionChannel } from '../content_scripts/shared/injectionChannel.js';
import {
    extractDisneyPlusVideoIdFromPathname,
    extractDisneyPlusVideoIdFromUrl,
    normalizeDisneyPlusVideoId,
    readOwnPrimitiveDataProperty,
} from '../content_scripts/shared/subtitleRequestIdentity.js';

const INJECT_EVENT_ID = Injection.disneyplus.EVENT_ID; // Must match inject.js

import { BasePlatformAdapter } from './BasePlatformAdapter.js';

const PLAYBACK_TRANSITION_DELAY_MS = 160;
const PLAYBACK_BRIDGE_RESUME = 'PLAYBACK_BRIDGE_RESUME';
const PLAYBACK_BRIDGE_PAUSE = 'PLAYBACK_BRIDGE_PAUSE';
const DEEP_TIMELINE_SEARCH_INTERVAL_MS = 1000;
const TIMELINE_DRIFT_TOLERANCE_SECONDS = 1.5;
const RUNTIME_SAMPLE_STABILITY_MS = 100;
const SUBTITLE_OBSERVER_RETRY_DELAY_MS = 250;
const SUBTITLE_OBSERVER_MAX_ATTEMPTS = 20;
const TIMELINE_SELECTORS = [
    '.progress-bar__seekable-range[role="slider"][aria-valuenow]',
    '.progress-bar__seekable-range[aria-valuenow]',
    '[role="slider"][aria-label="Timeline"][aria-valuenow]',
    '[role="slider"][aria-valuenow][aria-valuemax]',
    '.progress-bar__thumb[aria-valuenow][aria-valuemax]',
];

export class DisneyPlusPlatform extends BasePlatformAdapter {
    constructor() {
        super();
        this.logger = Logger.create('DisneyPlusPlatform', configService);
        this.currentVideoId = null;
        this.onSubtitleUrlFoundCallback = null;
        this.onVideoIdChangeCallback = null;
        this.eventListener = null; // To store the bound event listener for removal
        this._injectionChannel = null;
        this._stalePlaybackIdentity = null;
        this._resetPlaybackClockState();
        this.initializeLogger();
    }

    _resetPlaybackClockState(needsFreshTimeline = false) {
        this._clockVideoElement = null;
        this._clockTimelineElement = null;
        this._clockTimelineValue = null;
        this._clockProgramTime = null;
        this._clockNeedsFreshTimeline = needsFreshTimeline;
        this._playbackTimeOffset = null;
        this._cachedProgressBarElement = null;
        this._lastDeepTimelineSearchAt = 0;
        this._runtimePlaybackAnchor = null;
        this._runtimeAnchorValid = false;
        this._runtimeAnchorNeedsCoherentSample = false;
        this._runtimePendingAnchor = null;
        this._runtimeInterstitialActive = false;
        this._runtimeLastSequence = -1;
    }

    /**
     * Initialize logger with logging level detection
     */
    async initializeLogger() {
        try {
            await this.logger.updateLevel();
        } catch {
            this._logBestEffort(
                'warn',
                'DisneyPlusPlatform: Failed to initialize logger level'
            );
        }
    }

    /**
     * Gets the platform name.
     * @returns {string} The platform name, 'disneyplus'.
     */
    getPlatformName() {
        return 'disneyplus';
    }

    isPlatformActive() {
        return window.location.hostname.includes('disneyplus.com');
    }

    isPlayerPageActive() {
        return Boolean(this.extractVideoIdFromCurrentRoute());
    }

    extractVideoIdFromCurrentRoute() {
        return extractDisneyPlusVideoIdFromPathname(window.location.pathname);
    }

    hasAdoptedPlayerRoute(url) {
        const routeVideoId = extractDisneyPlusVideoIdFromUrl(url);
        return Boolean(routeVideoId && routeVideoId === this.currentVideoId);
    }

    async initialize(onSubtitleUrlFound, onVideoIdChange) {
        this._retirePlatformLifecycle();

        if (!this.isPlatformActive()) return;

        const channel = createInjectionChannel('disneyplus');
        if (!channel) {
            this._logBestEffort(
                'warn',
                'Disney injection channel unavailable; platform event bridge disabled'
            );
            return;
        }
        this._injectionChannel = channel;
        this.setCallbacks(onSubtitleUrlFound, onVideoIdChange);

        const lifecycleGeneration = this._beginPlatformLifecycle();
        this.eventListener = (event) => {
            if (!this._isPlatformLifecycleCurrent(lifecycleGeneration)) return;
            this._handleInjectorEvents(event, channel, lifecycleGeneration);
        };
        document.addEventListener(INJECT_EVENT_ID, this.eventListener);
        this._resumePlaybackTimeline();
        this._requestPlaybackTimeline();

        const disneyPlusSubtitleSelectors = [
            '.TimedTextOverlay',
            '.hive-subtitle-renderer-wrapper',
            '.hive-subtitle-renderer-cue-positioning-box',
            '.hive-subtitle-renderer-cue-window',
        ];
        this.setupNativeSubtitleSettingsListener(disneyPlusSubtitleSelectors);

        this._logBestEffort('info', 'Initialized and event listener added', {
            selectors: disneyPlusSubtitleSelectors,
        });
    }

    _requestPlaybackTimeline() {
        this._dispatchPlaybackBridgeControl('REQUEST_PLAYBACK_TIMELINE');
    }

    _dispatchPlaybackBridgeControl(type) {
        try {
            const detail = this._injectionChannel?.createEventDetail(type);
            if (!detail) return false;
            document.dispatchEvent(
                new CustomEvent(INJECT_EVENT_ID, {
                    detail,
                })
            );
            return true;
        } catch (_) {
            return false;
        }
    }

    _resumePlaybackTimeline() {
        this._dispatchPlaybackBridgeControl(PLAYBACK_BRIDGE_RESUME);
    }

    _pausePlaybackTimeline() {
        this._dispatchPlaybackBridgeControl(PLAYBACK_BRIDGE_PAUSE);
    }

    _getRuntimeIdentity(value) {
        if (!value) return null;

        const rawAvailId = readOwnPrimitiveDataProperty(value, 'availId');
        const rawPlaybackSessionId = readOwnPrimitiveDataProperty(
            value,
            'playbackSessionId'
        );
        const availId =
            typeof rawAvailId === 'string' && rawAvailId ? rawAvailId : null;
        const playbackSessionId =
            typeof rawPlaybackSessionId === 'string' && rawPlaybackSessionId
                ? rawPlaybackSessionId
                : null;

        return availId || playbackSessionId
            ? { availId, playbackSessionId }
            : null;
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
        const timelineVideoId = normalizeDisneyPlusVideoId(
            readOwnPrimitiveDataProperty(data, 'videoId')
        );
        if (!this.currentVideoId || timelineVideoId !== this.currentVideoId) {
            return;
        }

        const programTime = readOwnPrimitiveDataProperty(
            data,
            'programTimeSeconds'
        );
        if (
            typeof programTime !== 'number' ||
            !Number.isFinite(programTime) ||
            programTime < 0
        ) {
            return;
        }

        const runtimeIdentity = this._getRuntimeIdentity(data);
        if (!runtimeIdentity) return;

        if (
            this._stalePlaybackIdentity &&
            this._runtimeIdentitiesMatch(this._stalePlaybackIdentity, data)
        ) {
            return;
        }

        const videoElement = this.getVideoElement();
        const mediaTime = videoElement?.currentTime;
        if (!Number.isFinite(mediaTime)) return;

        const sequence = Number(readOwnPrimitiveDataProperty(data, 'sequence'));
        if (
            Number.isFinite(sequence) &&
            sequence <= this._runtimeLastSequence
        ) {
            return;
        }

        const previousAnchor = this._runtimePlaybackAnchor;
        const sameRuntime = this._runtimeIdentitiesMatch(previousAnchor, data);
        const isInterstitialPlaying = readOwnPrimitiveDataProperty(
            data,
            'isInterstitialPlaying'
        );
        const isBumper = readOwnPrimitiveDataProperty(data, 'isBumper');
        const interstitialStateKnown =
            typeof isInterstitialPlaying === 'boolean';
        if (interstitialStateKnown) {
            const wasInterstitialActive = this._runtimeInterstitialActive;
            this._runtimeInterstitialActive = isInterstitialPlaying;
            if (wasInterstitialActive !== this._runtimeInterstitialActive) {
                this._logBestEffort(
                    'info',
                    'Disney interstitial playback state changed',
                    {
                        hasVideoId: Boolean(this.currentVideoId),
                        isInterstitialPlaying: this._runtimeInterstitialActive,
                        isBumper: isBumper === true,
                    }
                );
            }
        }

        if (
            this._runtimeAnchorNeedsCoherentSample &&
            previousAnchor &&
            sameRuntime &&
            previousAnchor.videoElement === videoElement
        ) {
            const mediaDelta = mediaTime - previousAnchor.mediaTime;
            const programDelta = programTime - previousAnchor.programTime;
            const coherentWithPrevious =
                Math.abs(mediaDelta - programDelta) <=
                TIMELINE_DRIFT_TOLERANCE_SECONDS;

            if (!coherentWithPrevious) {
                const pendingAnchor = this._runtimePendingAnchor;
                const pendingMatchesRuntime =
                    pendingAnchor?.videoElement === videoElement &&
                    this._runtimeIdentitiesMatch(pendingAnchor, data);
                const coherentWithPending =
                    pendingMatchesRuntime &&
                    Math.abs(
                        mediaTime -
                            pendingAnchor.mediaTime -
                            (programTime - pendingAnchor.programTime)
                    ) <= TIMELINE_DRIFT_TOLERANCE_SECONDS;
                const pendingIsStable =
                    coherentWithPending &&
                    Date.now() - pendingAnchor.observedAt >=
                        RUNTIME_SAMPLE_STABILITY_MS;

                if (!pendingIsStable) {
                    if (!coherentWithPending) {
                        this._runtimePendingAnchor = {
                            videoElement,
                            videoId: timelineVideoId,
                            mediaTime,
                            programTime,
                            observedAt: Date.now(),
                            ...runtimeIdentity,
                        };
                    }
                    this._runtimeLastSequence = Number.isFinite(sequence)
                        ? sequence
                        : this._runtimeLastSequence + 1;
                    return;
                }
            }
        } else {
            this._runtimePendingAnchor = null;
        }

        this._runtimePendingAnchor = null;

        this._runtimePlaybackAnchor = {
            videoElement,
            videoId: timelineVideoId,
            mediaTime,
            programTime,
            ...runtimeIdentity,
        };
        this._runtimeAnchorValid = true;
        this._runtimeAnchorNeedsCoherentSample = false;
        this._runtimeLastSequence = Number.isFinite(sequence)
            ? sequence
            : this._runtimeLastSequence + 1;
        this._stalePlaybackIdentity = null;
    }

    _handleInjectorEvents(
        e,
        channel = this._injectionChannel,
        lifecycleGeneration = this._lifecycleGeneration
    ) {
        if (!this._isPlatformLifecycleCurrent(lifecycleGeneration)) return;
        let data;
        try {
            data = channel?.accept(e);
        } catch (_) {
            return;
        }
        if (!data || !this._isPlatformLifecycleCurrent(lifecycleGeneration)) {
            return;
        }
        return this._handleAuthorizedInjectorData(data, lifecycleGeneration);
    }

    _handleAuthorizedInjectorData(
        data,
        lifecycleGeneration = this._lifecycleGeneration
    ) {
        const lifecycleIsCurrent = () =>
            this._isPlatformLifecycleCurrent(lifecycleGeneration);
        if (!lifecycleIsCurrent()) return;

        const eventType = readOwnPrimitiveDataProperty(data, 'type');
        if (typeof eventType !== 'string') return;

        if (eventType === 'INJECT_SCRIPT_READY') {
            this._logBestEffort('info', 'Inject script is ready');
            this._resumePlaybackTimeline();
            this._requestPlaybackTimeline();
        } else if (eventType === 'PLAYBACK_TIMELINE_UPDATE') {
            this._handlePlaybackTimelineUpdate(data);
        } else if (eventType === 'SUBTITLE_URL_FOUND') {
            const vttMasterUrl = readOwnPrimitiveDataProperty(data, 'url');
            const injectedVideoId = normalizeDisneyPlusVideoId(
                readOwnPrimitiveDataProperty(data, 'videoId')
            );
            const canonicalVideoId = this.extractVideoIdFromCurrentRoute();

            if (typeof vttMasterUrl !== 'string' || !vttMasterUrl) {
                this._logBestEffort(
                    'error',
                    'SUBTITLE_URL_FOUND event without a valid URL',
                    null,
                    { hasVideoId: Boolean(injectedVideoId) }
                );
                return;
            }

            if (!injectedVideoId) {
                this._logBestEffort(
                    'error',
                    'SUBTITLE_URL_FOUND event without a valid videoId',
                    null,
                    {
                        urlLength: vttMasterUrl.length,
                    }
                );
                return;
            }

            if (!canonicalVideoId || injectedVideoId !== canonicalVideoId) {
                this._logBestEffort(
                    'warn',
                    'Rejected subtitle event outside current route',
                    {
                        hasCanonicalVideoId: Boolean(canonicalVideoId),
                        eventVideoIdLength: injectedVideoId.length,
                        idsMatch: injectedVideoId === canonicalVideoId,
                        urlLength: vttMasterUrl.length,
                    }
                );
                return;
            }

            this._logBestEffort(
                'info',
                'SUBTITLE_URL_FOUND for current route',
                {
                    videoIdLength: canonicalVideoId.length,
                    urlLength: vttMasterUrl.length,
                }
            );

            if (this.currentVideoId !== canonicalVideoId) {
                if (!lifecycleIsCurrent()) return;
                this._stalePlaybackIdentity = this._getRuntimeIdentity(
                    this._runtimePlaybackAnchor
                );
                this._resetPlaybackClockState(true);
                this.setVideoIdAndNotify(canonicalVideoId);
                if (!lifecycleIsCurrent()) return;
            }

            const requestVideoId = canonicalVideoId;
            const { request, inFlight } = this.beginVttRequest(
                vttMasterUrl,
                requestVideoId
            );
            if (!request) {
                this._logBestEffort(
                    'debug',
                    'VTT URL already processed or known',
                    {
                        urlLength: vttMasterUrl.length,
                        hasVideoId: Boolean(requestVideoId),
                        inFlight,
                    }
                );
                return;
            }

            this._logBestEffort('info', 'Requesting VTT from background', {
                urlLength: vttMasterUrl.length,
                hasVideoId: Boolean(requestVideoId),
            });

            // Get user settings for language preferences
            return Promise.resolve()
                .then(() =>
                    configService.getMultiple([
                        'targetLanguage',
                        'originalLanguage',
                    ])
                )
                .then((settings) => {
                    if (!lifecycleIsCurrent()) return;
                    const targetLanguage = settings.targetLanguage || 'zh-CN';
                    const originalLanguage = settings.originalLanguage || 'en';
                    const dispatchRouteVideoId =
                        this.extractVideoIdFromCurrentRoute();
                    const requestIsCurrent = this.isVttRequestCurrent(request);

                    if (
                        !lifecycleIsCurrent() ||
                        dispatchRouteVideoId !== requestVideoId ||
                        !requestIsCurrent
                    ) {
                        this._logBestEffort(
                            'warn',
                            'Discarding stale subtitle request before background dispatch',
                            {
                                hasRouteVideoId: Boolean(dispatchRouteVideoId),
                                idsMatch:
                                    dispatchRouteVideoId === requestVideoId,
                                requestIsCurrent,
                                urlLength: vttMasterUrl.length,
                            }
                        );
                        return;
                    }

                    const canDispatch = () =>
                        lifecycleIsCurrent() &&
                        this.extractVideoIdFromCurrentRoute() ===
                            requestVideoId &&
                        this.isVttRequestCurrent(request);

                    return this.requestVttViaMessaging(
                        vttMasterUrl,
                        targetLanguage,
                        originalLanguage,
                        requestVideoId,
                        canDispatch
                    )
                        .then((response) => {
                            if (!lifecycleIsCurrent()) return;
                            const responseRouteVideoId =
                                this.extractVideoIdFromCurrentRoute();
                            const requestIsCurrent =
                                this.isVttRequestCurrent(request);
                            const routeIsCurrent =
                                responseRouteVideoId === requestVideoId;

                            if (!routeIsCurrent || !requestIsCurrent) {
                                this._logBestEffort(
                                    'warn',
                                    'Discarding stale subtitle response after route change',
                                    {
                                        hasRouteVideoId:
                                            Boolean(responseRouteVideoId),
                                        idsMatch: routeIsCurrent,
                                        requestIsCurrent,
                                        hasReceivedVideoId: Boolean(
                                            response?.videoId
                                        ),
                                        urlLength: vttMasterUrl.length,
                                    }
                                );
                                return;
                            }

                            if (this.canAcceptVttResponse(request, response)) {
                                const onSubtitleUrlFound =
                                    this.onSubtitleUrlFoundCallback;
                                if (
                                    !lifecycleIsCurrent() ||
                                    typeof onSubtitleUrlFound !== 'function'
                                ) {
                                    return;
                                }

                                const subtitleData = {
                                    vttText: response.vttText,
                                    targetVttText: response.targetVttText,
                                    videoId: response.videoId,
                                    sourceLanguage: response.sourceLanguage,
                                    targetLanguage: response.targetLanguage,
                                    useNativeTarget: response.useNativeTarget,
                                    selectedLanguage: {
                                        normalizedCode:
                                            response.selectedLanguage
                                                .normalizedCode,
                                        displayName:
                                            response.selectedLanguage
                                                .displayName,
                                    },
                                };
                                const successTelemetry = {
                                    hasVideoId: Boolean(requestVideoId),
                                    hasSourceLanguage:
                                        typeof subtitleData.sourceLanguage ===
                                            'string' &&
                                        subtitleData.sourceLanguage.length > 0,
                                    hasTargetLanguage:
                                        typeof subtitleData.targetLanguage ===
                                            'string' &&
                                        subtitleData.targetLanguage.length > 0,
                                };

                                if (!lifecycleIsCurrent()) return;
                                onSubtitleUrlFound.call(this, subtitleData);

                                if (
                                    !lifecycleIsCurrent() ||
                                    this.extractVideoIdFromCurrentRoute() !==
                                        request.videoId ||
                                    !this.acceptVttResponse(request, response)
                                ) {
                                    return;
                                }

                                this._logBestEffort(
                                    'info',
                                    'VTT fetched successfully',
                                    successTelemetry
                                );
                            } else if (response && !response.success) {
                                this._logBestEffort(
                                    'error',
                                    'Background failed to fetch VTT',
                                    null,
                                    {
                                        backgroundRejected: true,
                                        hasVideoId: Boolean(requestVideoId),
                                    }
                                );
                            } else if (
                                response &&
                                response.videoId !== this.currentVideoId
                            ) {
                                this._logBestEffort(
                                    'warn',
                                    'Received VTT for different video context - discarding',
                                    {
                                        hasReceivedVideoId: Boolean(
                                            response.videoId
                                        ),
                                        idsMatch:
                                            response.videoId ===
                                            this.currentVideoId,
                                    }
                                );
                            } else {
                                this._logBestEffort(
                                    'error',
                                    'No/invalid response from background for fetchVTT',
                                    null,
                                    {
                                        urlLength: vttMasterUrl.length,
                                        hasVideoId: Boolean(requestVideoId),
                                    }
                                );
                            }
                        })
                        .catch(() => {
                            if (!lifecycleIsCurrent()) return;
                            const hasRuntimeError = Boolean(
                                chrome?.runtime?.lastError
                            );
                            if (hasRuntimeError) {
                                this._logBestEffort(
                                    'error',
                                    'Error for VTT fetch',
                                    null,
                                    {
                                        hasRuntimeError,
                                        urlLength: vttMasterUrl.length,
                                        hasVideoId: Boolean(requestVideoId),
                                    }
                                );
                            } else {
                                this._logBestEffort(
                                    'error',
                                    'No/invalid response from background for fetchVTT',
                                    null,
                                    {
                                        urlLength: vttMasterUrl.length,
                                        hasVideoId: Boolean(requestVideoId),
                                    }
                                );
                            }
                        });
                })
                .catch(() => {
                    if (!lifecycleIsCurrent()) return;
                    this._logBestEffort(
                        'error',
                        'Failed to resolve subtitle request settings',
                        null,
                        {
                            urlLength: vttMasterUrl.length,
                            hasVideoId: Boolean(requestVideoId),
                        }
                    );
                })
                .finally(() => {
                    this.finishVttRequest(request);
                });
        }
    }

    handleInjectorEvents(e) {
        return this._handleInjectorEvents(e);
    }

    getVideoElement() {
        const videos = Array.from(document.querySelectorAll('video'));
        if (videos.length <= 1) return videos[0] || null;

        let bestVideo = videos[0];
        let bestScore = -Infinity;

        for (const video of videos) {
            let score = 0;
            try {
                const rect = video.getBoundingClientRect?.();
                const width = rect?.width || 0;
                const height = rect?.height || 0;
                if (width > 0 && height > 0) {
                    score += 100;
                    score += Math.min((width * height) / 20000, 50);
                }

                if (video.readyState >= 2) score += 40;
                if (video.readyState >= 4) score += 10;
                if (
                    video.currentSrc ||
                    video.getAttribute('src') ||
                    video.querySelector('source[src]')
                ) {
                    score += 25;
                }
                if (!video.paused && !video.ended) score += 30;
                if (
                    Number.isFinite(video.currentTime) &&
                    video.currentTime > 0
                ) {
                    score += 15;
                }
            } catch (_) {}

            if (score > bestScore) {
                bestScore = score;
                bestVideo = video;
            }
        }

        return bestVideo;
    }

    getCurrentVideoId() {
        return this.currentVideoId;
    }

    getPlayerContainerElement() {
        const videoElement = this.getVideoElement();
        return videoElement ? videoElement.parentElement : null;
    }

    getProgressBarElement() {
        try {
            if (this._cachedProgressBarElement?.isConnected) {
                return this._cachedProgressBarElement;
            }
            this._cachedProgressBarElement = null;

            // Current Disney+ player: controls overlay -> progress-bar, with
            // both components exposing open shadow roots.
            const overlayHosts = document.querySelectorAll(
                'main-app-controls-overlay'
            );
            for (const overlayHost of overlayHosts) {
                const progressHosts =
                    overlayHost.shadowRoot?.querySelectorAll('progress-bar') ||
                    [];
                const timeline =
                    this._findTimelineInProgressHosts(progressHosts);
                if (timeline) {
                    this._cachedProgressBarElement = timeline;
                    return timeline;
                }
            }

            // Retain compatibility with older layouts whose progress-bar host
            // lived in the light DOM.
            const lightDomTimeline = this._findTimelineInProgressHosts(
                document.querySelectorAll('progress-bar')
            );
            if (lightDomTimeline) {
                this._cachedProgressBarElement = lightDomTimeline;
                return lightDomTimeline;
            }

            // Bound the expensive recursive fallback. The active video clock
            // remains usable while the lazily mounted controls are absent.
            const now = Date.now();
            if (
                now - this._lastDeepTimelineSearchAt <
                DEEP_TIMELINE_SEARCH_INTERVAL_MS
            ) {
                return null;
            }
            this._lastDeepTimelineSearchAt = now;

            const deepProgressHost = this._querySelectorDeep('progress-bar');
            const deepTimeline = this._findTimelineInProgressHosts(
                deepProgressHost ? [deepProgressHost] : []
            );
            if (deepTimeline) {
                this._cachedProgressBarElement = deepTimeline;
                return deepTimeline;
            }

            const semanticTimeline = this._querySelectorDeep([
                TIMELINE_SELECTORS[0],
                TIMELINE_SELECTORS[2],
            ]);
            this._cachedProgressBarElement = semanticTimeline;
            return semanticTimeline;
        } catch (_) {
            return null;
        }
    }

    _findTimelineInProgressHosts(progressHosts) {
        let bestTimeline = null;
        let bestMaximum = -Infinity;

        for (const host of progressHosts) {
            if (!host?.shadowRoot) continue;

            let timeline = null;
            for (const selector of TIMELINE_SELECTORS) {
                timeline = host.shadowRoot.querySelector(selector);
                if (timeline) break;
            }
            if (!timeline) continue;

            const maximum = Number.parseFloat(
                timeline.getAttribute('aria-valuemax') || '0'
            );
            if (
                !bestTimeline ||
                (Number.isFinite(maximum) && maximum > bestMaximum)
            ) {
                bestTimeline = timeline;
                bestMaximum = Number.isFinite(maximum) ? maximum : bestMaximum;
            }
        }

        return bestTimeline;
    }

    _readTimelineTime(timelineElement) {
        const value = Number.parseFloat(
            timelineElement?.getAttribute('aria-valuenow') || 'NaN'
        );
        return Number.isFinite(value) && value >= 0 ? value : null;
    }

    _getMeaningfulTimelineOffset(timelineTime, programTime) {
        const measuredOffset = timelineTime - programTime;
        // Small differences are normal UI sampling lag; keep the active video
        // authoritative unless the timeline proves a distinct clock origin.
        return Math.abs(measuredOffset) > TIMELINE_DRIFT_TOLERANCE_SECONDS
            ? measuredOffset
            : 0;
    }

    /**
     * Use Disney's live program playhead to anchor the active HTML video clock.
     * The lazily mounted progress slider remains a fallback when the runtime
     * facade is unavailable.
     * @returns {number | null}
     */
    getPlaybackTime(preferredVideoElement = null) {
        const videoElement = preferredVideoElement || this.getVideoElement();
        const mediaTime = videoElement?.currentTime;
        if (!Number.isFinite(mediaTime)) return null;

        if (this._runtimeInterstitialActive) return -1;

        const runtimeAnchor = this._runtimePlaybackAnchor;
        const runtimeAnchorMatchesVideo =
            runtimeAnchor?.videoElement === videoElement;
        if (runtimeAnchor && !runtimeAnchorMatchesVideo) {
            this._runtimeAnchorValid = false;
            this._runtimeAnchorNeedsCoherentSample = false;
        }

        if (
            this._runtimeAnchorValid &&
            runtimeAnchor?.videoId === this.currentVideoId &&
            runtimeAnchorMatchesVideo
        ) {
            return (
                runtimeAnchor.programTime +
                (mediaTime - runtimeAnchor.mediaTime)
            );
        }

        // A seek can move the media clock before Disney publishes its matching
        // program playhead. Suppress cues during that short disagreement rather
        // than briefly rendering subtitles from the wrong scene.
        if (
            runtimeAnchorMatchesVideo &&
            this._runtimeAnchorNeedsCoherentSample
        ) {
            return -1;
        }

        const programTime = mediaTime;

        const previousVideoElement = this._clockVideoElement;
        const previousProgramTime = this._clockProgramTime;
        const previousTimelineElement = this._clockTimelineElement;
        const previousTimelineValue = this._clockTimelineValue;
        const videoElementChanged = videoElement !== previousVideoElement;

        if (videoElementChanged) {
            this._clockVideoElement = videoElement;
            this._playbackTimeOffset = null;
            this._clockNeedsFreshTimeline =
                this._clockNeedsFreshTimeline || previousVideoElement !== null;
            this._cachedProgressBarElement = null;
        }

        const timelineElement = this.getProgressBarElement();
        const timelineTime = this._readTimelineTime(timelineElement);

        const programTimeChanged =
            !videoElementChanged &&
            Number.isFinite(previousProgramTime) &&
            Math.abs(programTime - previousProgramTime) >
                TIMELINE_DRIFT_TOLERANCE_SECONDS;
        const timelineTimeChanged =
            !videoElementChanged &&
            timelineTime !== null &&
            Number.isFinite(previousTimelineValue) &&
            Math.abs(timelineTime - previousTimelineValue) >
                TIMELINE_DRIFT_TOLERANCE_SECONDS;
        const coherentClockJump =
            programTimeChanged &&
            timelineTimeChanged &&
            Math.abs(
                programTime -
                    previousProgramTime -
                    (timelineTime - previousTimelineValue)
            ) <= TIMELINE_DRIFT_TOLERANCE_SECONDS;

        // During a seek, Disney's slider and media clock often update on
        // different frames. Never turn that temporary disagreement into a
        // persistent offset; prefer the active video until the timeline moves
        // again and proves it is fresh.
        if (
            (programTimeChanged || timelineTimeChanged) &&
            !coherentClockJump &&
            (timelineTime !== null || this._clockNeedsFreshTimeline)
        ) {
            this._playbackTimeOffset = null;
            this._clockNeedsFreshTimeline = true;
            this._clockProgramTime = programTime;
            if (timelineElement && timelineTime !== null) {
                this._clockTimelineElement = timelineElement;
                this._clockTimelineValue = timelineTime;
            }
            return programTime;
        }

        if (this._clockNeedsFreshTimeline) {
            const hasFreshTimelineSample =
                timelineElement &&
                timelineTime !== null &&
                Number.isFinite(previousTimelineValue) &&
                Math.abs(timelineTime - previousTimelineValue) > 0.01;

            this._clockProgramTime = programTime;
            if (!hasFreshTimelineSample) {
                if (timelineElement && timelineTime !== null) {
                    this._clockTimelineElement = timelineElement;
                    this._clockTimelineValue = timelineTime;
                }
                return programTime;
            }

            this._clockNeedsFreshTimeline = false;
            this._playbackTimeOffset = this._getMeaningfulTimelineOffset(
                timelineTime,
                programTime
            );
        }

        if (timelineElement && timelineTime !== null) {
            const timelineElementChanged =
                timelineElement !== previousTimelineElement;
            const timelineValueChanged =
                previousTimelineValue === null ||
                Math.abs(timelineTime - previousTimelineValue) > 0.01;
            const predictedTime = programTime + (this._playbackTimeOffset || 0);
            const clockDrift = Math.abs(timelineTime - predictedTime);
            const measuredOffset = this._getMeaningfulTimelineOffset(
                timelineTime,
                programTime
            );

            if (this._playbackTimeOffset === null) {
                this._playbackTimeOffset = measuredOffset;
            } else if (
                (timelineElementChanged || timelineValueChanged) &&
                clockDrift > TIMELINE_DRIFT_TOLERANCE_SECONDS
            ) {
                this._playbackTimeOffset = measuredOffset;
            }

            this._clockTimelineElement = timelineElement;
            this._clockTimelineValue = timelineTime;
        } else {
            // Keep the calibrated offset while Disney+ unmounts idle controls.
            this._clockTimelineElement = null;
            this._clockTimelineValue = null;
        }

        this._clockProgramTime = programTime;
        return programTime + (this._playbackTimeOffset || 0);
    }

    invalidatePlaybackClockCalibration() {
        this._playbackTimeOffset = null;
        this._clockNeedsFreshTimeline = true;
        if (this._runtimePlaybackAnchor) {
            this._runtimeAnchorValid = false;
            this._runtimeAnchorNeedsCoherentSample = true;
            this._runtimePendingAnchor = null;
        }
        this._requestPlaybackTimeline();
    }

    supportsProgressBarTracking() {
        // The generic observer treats the UI control as the primary clock and
        // blocks startup while it is absent. Disney+ uses it only for internal
        // calibration, so native timeupdate events remain authoritative.
        return false;
    }

    allowsDirectMediaPlaybackFallback() {
        // Disney's controller owns both playback and its UI projection. Calling
        // video.pause() behind that controller can leave the control showing a
        // playing state and consume the user's first attempt to resume.
        return false;
    }

    /**
     * Platform-specific playback helpers for Disney+
     */
    _getToggleButtonRoot() {
        try {
            const isActionableToggleHost = (candidate) =>
                Boolean(
                    candidate?.isConnected &&
                    this._getActionableToggleButton(candidate.shadowRoot)
                );
            const directToggleHost = document.querySelector(
                'disney-web-player-ui toggle-play-pause'
            );
            const toggleHost = isActionableToggleHost(directToggleHost)
                ? directToggleHost
                : this._querySelectorDeep(
                      'toggle-play-pause',
                      isActionableToggleHost
                  );
            return toggleHost?.shadowRoot || null;
        } catch (_) {
            return null;
        }
    }

    _getActionableToggleButton(root) {
        if (!root) return null;
        for (const selector of ['button', '[role="button"]']) {
            let candidates;
            try {
                candidates = root.querySelectorAll(selector);
            } catch (_) {
                continue;
            }
            for (const candidate of candidates) {
                try {
                    if (
                        candidate.isConnected &&
                        candidate.disabled !== true &&
                        candidate.getAttribute('aria-disabled') !== 'true' &&
                        typeof candidate.click === 'function'
                    ) {
                        return candidate;
                    }
                } catch (_) {}
            }
        }
        return null;
    }

    isPlaying() {
        try {
            return this._getMediaPlayingState();
        } catch (_) {
            return null;
        }
    }

    async pausePlayback() {
        try {
            const video = this.getVideoElement();
            const state = this._getMediaPlayingState(video);
            if (state === null) return false;
            if (state === false) return true;
            const root = this._getToggleButtonRoot();
            if (!root) return false;
            const btn = this._getActionableToggleButton(root);
            if (!btn) return false;
            btn.click();
            await new Promise((r) =>
                setTimeout(r, PLAYBACK_TRANSITION_DELAY_MS)
            );
            const after = video.isConnected
                ? this._getMediaPlayingState(video)
                : null;
            return after === false;
        } catch (_) {
            return false;
        }
    }

    async resumePlayback() {
        try {
            const video = this.getVideoElement();
            const state = this._getMediaPlayingState(video);
            if (state === null) return false;
            if (state === true) return true;
            const root = this._getToggleButtonRoot();
            if (!root) return false;
            const btn = this._getActionableToggleButton(root);
            if (!btn) return false;
            btn.click();
            await new Promise((r) =>
                setTimeout(r, PLAYBACK_TRANSITION_DELAY_MS)
            );
            const after = video.isConnected
                ? this._getMediaPlayingState(video)
                : null;
            return after === true;
        } catch (_) {
            return false;
        }
    }

    /**
     * Deep querySelector that traverses shadow DOM trees to find the first match
     * @param {string[]|string} selectors - One or more selectors to try
     * @param {((candidate: Element) => boolean)|null} [acceptCandidate=null] Optional candidate filter.
     * @returns {Element|null}
     * @private
     */
    _querySelectorDeep(selectors, acceptCandidate = null) {
        const selectorList = Array.isArray(selectors) ? selectors : [selectors];
        const visited = new Set();
        const queue = [document];

        while (queue.length) {
            const root = queue.shift();
            if (!root || visited.has(root)) continue;
            visited.add(root);

            for (const sel of selectorList) {
                try {
                    if (typeof acceptCandidate === 'function') {
                        for (const candidate of root.querySelectorAll(sel)) {
                            if (acceptCandidate(candidate)) return candidate;
                        }
                    } else {
                        const el = root.querySelector(sel);
                        if (el) return el;
                    }
                } catch (_) {}
            }

            let nodes = [];
            try {
                nodes = root.querySelectorAll('*');
            } catch (_) {
                nodes = [];
            }
            for (const node of nodes) {
                if (node && node.shadowRoot) {
                    queue.push(node.shadowRoot);
                }
            }
        }
        return null;
    }

    handleNativeSubtitles() {
        // Disney+ subtitle containers to hide (actual selectors from Disney+ DOM)
        const disneyPlusSubtitleSelectors = [
            '.TimedTextOverlay',
            '.hive-subtitle-renderer-wrapper',
            '.hive-subtitle-renderer-cue-positioning-box',
            '.hive-subtitle-renderer-cue-window',
        ];

        this.handleNativeSubtitlesWithSetting(disneyPlusSubtitleSelectors);
        this.setupDisneyPlusSubtitleMonitoring();
    }

    setupDisneyPlusSubtitleMonitoring() {
        // Add CSS to force hide Disney+ subtitles when needed
        this.addDisneyPlusSubtitleCSS();

        // Monitor for dynamically created subtitle elements
        this.setupSubtitleMutationObserver();
    }

    addDisneyPlusSubtitleCSS() {
        // Add CSS rules that are more specific and use !important
        const cssId = 'dualsub-disneyplus-subtitle-hider';
        let styleElement = document.getElementById(cssId);

        if (!styleElement) {
            // Validate that document.head exists before appending
            if (!document.head || !(document.head instanceof Node)) {
                this._logBestEffort(
                    'warn',
                    '[DisneyPlusPlatform] document.head not available, cannot inject CSS'
                );
                return;
            }

            try {
                styleElement = document.createElement('style');
                styleElement.id = cssId;
                document.head.appendChild(styleElement);
            } catch {
                this._logBestEffort(
                    'error',
                    '[DisneyPlusPlatform] Failed to inject CSS'
                );
                return;
            }
        }

        // CSS rules that will be applied when hiding is enabled
        const hidingCSS = `
            .TimedTextOverlay[data-dualsub-hidden="true"] {
                display: none !important;
                visibility: hidden !important;
                opacity: 0 !important;
            }
            .hive-subtitle-renderer-wrapper[data-dualsub-hidden="true"] {
                display: none !important;
                visibility: hidden !important;
                opacity: 0 !important;
            }
            .hive-subtitle-renderer-cue-positioning-box[data-dualsub-hidden="true"] {
                display: none !important;
                visibility: hidden !important;
                opacity: 0 !important;
            }
            .hive-subtitle-renderer-cue-window[data-dualsub-hidden="true"] {
                display: none !important;
                visibility: hidden !important;
                opacity: 0 !important;
            }
        `;

        styleElement.textContent = hidingCSS;
    }

    _getSubtitleObservationRoots() {
        const roots = [];
        const seen = new Set();
        const addRoot = (root) => {
            if (
                !(root instanceof Node) ||
                root === document.body ||
                seen.has(root)
            ) {
                return;
            }
            seen.add(root);
            roots.push(root);
        };

        try {
            addRoot(this.getPlayerContainerElement());
        } catch (_) {}

        try {
            document
                .querySelectorAll('main-app-controls-overlay')
                .forEach((overlay) => addRoot(overlay.shadowRoot));
        } catch (_) {}

        return roots;
    }

    setupSubtitleMutationObserver() {
        const timerGeneration = this._resetOwnedTimeoutLifecycle();
        this._disconnectSubtitleMutationObserver();
        this._attemptSubtitleMutationObserverSetup(timerGeneration, 1);
    }

    _disconnectSubtitleMutationObserver() {
        const observer = this.subtitleObserver;
        this.subtitleObserver = null;
        if (observer) {
            try {
                observer.disconnect();
            } catch (_) {}
        }
    }

    _scheduleSubtitleObserverRetry(timerGeneration, attempt, reason) {
        if (timerGeneration !== this.ownedTimeoutGeneration) {
            return;
        }

        if (attempt >= SUBTITLE_OBSERVER_MAX_ATTEMPTS) {
            this._logBestEffort(
                'warn',
                'Subtitle observer discovery budget exhausted',
                {
                    attempts: Number.isSafeInteger(attempt) ? attempt : 0,
                    hasReason: typeof reason === 'string',
                }
            );
            return;
        }

        this._scheduleOwnedTimeout(
            'subtitle-observer-retry',
            () =>
                this._attemptSubtitleMutationObserverSetup(
                    timerGeneration,
                    attempt + 1
                ),
            SUBTITLE_OBSERVER_RETRY_DELAY_MS,
            timerGeneration
        );
    }

    _attemptSubtitleMutationObserverSetup(timerGeneration, attempt) {
        if (timerGeneration !== this.ownedTimeoutGeneration) {
            return;
        }

        const observationRoots = this._getSubtitleObservationRoots();
        if (observationRoots.length === 0) {
            this._scheduleSubtitleObserverRetry(
                timerGeneration,
                attempt,
                'scoped-roots-unavailable'
            );
            return;
        }

        let observer = null;
        try {
            // Set up mutation observer to catch dynamically created subtitle elements
            observer = new MutationObserver((mutations) => {
                if (
                    timerGeneration !== this.ownedTimeoutGeneration ||
                    this.subtitleObserver !== observer
                ) {
                    return;
                }

                let foundNewSubtitles = false;

                mutations.forEach((mutation) => {
                    if (mutation.type === 'childList') {
                        mutation.addedNodes.forEach((node) => {
                            if (node.nodeType === Node.ELEMENT_NODE) {
                                // Check if the added node or its children contain subtitle elements
                                if (
                                    node.classList?.contains(
                                        'TimedTextOverlay'
                                    ) ||
                                    node.classList?.contains(
                                        'hive-subtitle-renderer-wrapper'
                                    ) ||
                                    node.querySelector?.(
                                        '.TimedTextOverlay, .hive-subtitle-renderer-wrapper'
                                    )
                                ) {
                                    foundNewSubtitles = true;
                                }
                            }
                        });
                    }
                });

                if (foundNewSubtitles) {
                    // Reapply hiding rules after a short delay
                    this._scheduleOwnedTimeout(
                        'subtitle-setting-reapply',
                        () => this.applyCurrentSubtitleSetting(timerGeneration),
                        100,
                        timerGeneration
                    );
                }
            });
        } catch (_) {
            this._scheduleSubtitleObserverRetry(
                timerGeneration,
                attempt,
                'observer-construction-failed'
            );
            return;
        }

        let attachedRootCount = 0;
        for (const root of observationRoots) {
            try {
                observer.observe(root, {
                    childList: true,
                    subtree: true,
                });
                attachedRootCount += 1;
            } catch (_) {}
        }

        if (timerGeneration !== this.ownedTimeoutGeneration) {
            try {
                observer.disconnect();
            } catch (_) {}
            return;
        }

        if (attachedRootCount === 0) {
            try {
                observer.disconnect();
            } catch (_) {}
            this._scheduleSubtitleObserverRetry(
                timerGeneration,
                attempt,
                'observer-attachment-failed'
            );
            return;
        }

        this.subtitleObserver = observer;
    }

    async applyCurrentSubtitleSetting(timerGeneration = null) {
        const disneyPlusSubtitleSelectors = [
            '.TimedTextOverlay',
            '.hive-subtitle-renderer-wrapper',
            '.hive-subtitle-renderer-cue-positioning-box',
            '.hive-subtitle-renderer-cue-window',
        ];

        await this.handleNativeSubtitlesWithSetting(
            disneyPlusSubtitleSelectors,
            () =>
                timerGeneration === null ||
                timerGeneration === this.ownedTimeoutGeneration
        );
    }

    _retirePlatformLifecycle() {
        if (this._platformLifecycleStarted) {
            this._pausePlaybackTimeline();
        }
        this._invalidatePlatformLifecycle();
        this._clearOwnedTimeouts();
        this._injectionChannel?.revoke();
        this._injectionChannel = null;

        if (this.eventListener) {
            document.removeEventListener(INJECT_EVENT_ID, this.eventListener);
            this.eventListener = null;
            this._logBestEffort('debug', 'Event listener removed');
        }

        this._cleanupNativeSubtitleSettingsBestEffort();

        const hadSubtitleObserver = Boolean(this.subtitleObserver);
        this._disconnectSubtitleMutationObserver();
        if (hadSubtitleObserver) {
            this._logBestEffort(
                'debug',
                'Subtitle mutation observer cleaned up'
            );
        }

        this.currentVideoId = null;
        this.onSubtitleUrlFoundCallback = null;
        this.onVideoIdChangeCallback = null;
        this.resetVttRequestState();
        this._stalePlaybackIdentity = null;
        this._resetPlaybackClockState();
    }

    cleanup() {
        this._retirePlatformLifecycle();

        // Remove our custom CSS
        const cssElement = document.getElementById(
            'dualsub-disneyplus-subtitle-hider'
        );
        if (cssElement) {
            cssElement.remove();
        }

        this._logBestEffort('info', 'Platform cleaned up successfully');
    }
}
