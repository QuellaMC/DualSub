import Logger from '../utils/logger.js';
import { configService } from '../services/configService.js';

import { Injection } from '../content_scripts/shared/constants/injection.js';

const INJECT_EVENT_ID = Injection.disneyplus.EVENT_ID; // Must match inject.js

import { BasePlatformAdapter } from './BasePlatformAdapter.js';

const PLAYBACK_TRANSITION_DELAY_MS = 160;
const DEEP_TIMELINE_SEARCH_INTERVAL_MS = 1000;
const TIMELINE_DRIFT_TOLERANCE_SECONDS = 1.5;
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
        this.lastKnownVttUrlForVideoId = {};
        this.pendingVttUrlForVideoId = {};
        this.eventListener = null; // To store the bound event listener for removal
        this._clockVideoElement = null;
        this._clockTimelineElement = null;
        this._clockTimelineValue = null;
        this._clockRawVideoTime = null;
        this._clockNeedsFreshTimeline = false;
        this._playbackTimeOffset = null;
        this._cachedProgressBarElement = null;
        this._lastDeepTimelineSearchAt = 0;
        this.initializeLogger();
    }

    /**
     * Initialize logger with logging level detection
     */
    async initializeLogger() {
        try {
            await this.logger.updateLevel();
        } catch (error) {
            console.warn(
                'DisneyPlusPlatform: Failed to initialize logger level:',
                error
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
        // For Disney+, player pages typically include "/video/" in the pathname.
        return (
            window.location.pathname.includes('/video/') ||
            window.location.pathname.includes('/play/')
        );
    }

    async initialize(onSubtitleUrlFound, onVideoIdChange) {
        if (!this.isPlatformActive()) return;

        this.setCallbacks(onSubtitleUrlFound, onVideoIdChange);

        this.eventListener = this._handleInjectorEvents.bind(this);
        document.addEventListener(INJECT_EVENT_ID, this.eventListener);

        const disneyPlusSubtitleSelectors = [
            '.TimedTextOverlay',
            '.hive-subtitle-renderer-wrapper',
            '.hive-subtitle-renderer-cue-positioning-box',
            '.hive-subtitle-renderer-cue-window',
        ];
        this.setupNativeSubtitleSettingsListener(disneyPlusSubtitleSelectors);

        this.logger.info('Initialized and event listener added', {
            selectors: disneyPlusSubtitleSelectors,
        });
    }

    _handleInjectorEvents(e) {
        const data = e.detail;
        if (!data || !data.type) return;

        if (data.type === 'INJECT_SCRIPT_READY') {
            this.logger.info('Inject script is ready');
        } else if (data.type === 'SUBTITLE_URL_FOUND') {
            const injectedVideoId = data.videoId;
            const vttMasterUrl = data.url;

            if (!injectedVideoId) {
                this.logger.error(
                    'SUBTITLE_URL_FOUND event without a videoId',
                    null,
                    {
                        urlLength: vttMasterUrl.length,
                    }
                );
                return;
            }
            this.logger.info('SUBTITLE_URL_FOUND for injectedVideoId', {
                injectedVideoId: injectedVideoId,
                urlLength: vttMasterUrl.length,
            });

            if (this.currentVideoId !== injectedVideoId) {
                this.logger.info('Video context changing', {
                    previousVideoId: this.currentVideoId || 'null',
                    newVideoId: injectedVideoId,
                });
                if (this.currentVideoId) {
                    delete this.lastKnownVttUrlForVideoId[this.currentVideoId];
                    delete this.pendingVttUrlForVideoId[this.currentVideoId];
                }
                this.setVideoIdAndNotify(injectedVideoId);
            }

            const requestVideoId = this.currentVideoId;
            const pendingRequest = this.pendingVttUrlForVideoId[requestVideoId];
            if (
                this.lastKnownVttUrlForVideoId[requestVideoId] ===
                    vttMasterUrl ||
                pendingRequest?.url === vttMasterUrl
            ) {
                this.logger.debug('VTT URL already processed or known', {
                    urlLength: vttMasterUrl.length,
                    hasVideoId: Boolean(requestVideoId),
                    inFlight: pendingRequest?.url === vttMasterUrl,
                });
                return;
            }

            const requestMarker = { url: vttMasterUrl };
            this.pendingVttUrlForVideoId[requestVideoId] = requestMarker;

            this.logger.info('Requesting VTT from background', {
                urlLength: vttMasterUrl.length,
                hasVideoId: Boolean(this.currentVideoId),
            });

            // Get user settings for language preferences
            configService
                .getMultiple(['targetLanguage', 'originalLanguage'])
                .then((settings) => {
                    const targetLanguage = settings.targetLanguage || 'zh-CN';
                    const originalLanguage = settings.originalLanguage || 'en';

                    return this.requestVttViaMessaging(
                        vttMasterUrl,
                        targetLanguage,
                        originalLanguage,
                        requestVideoId
                    )
                        .then((response) => {
                            const requestIsCurrent =
                                this.pendingVttUrlForVideoId[requestVideoId] ===
                                requestMarker;

                            if (
                                response &&
                                response.success &&
                                response.videoId === this.currentVideoId &&
                                requestIsCurrent
                            ) {
                                this.logger.info('VTT fetched successfully', {
                                    videoId: this.currentVideoId,
                                    sourceLanguage: response.sourceLanguage,
                                    targetLanguage: response.targetLanguage,
                                });
                                this.lastKnownVttUrlForVideoId[
                                    response.videoId
                                ] = vttMasterUrl;
                                if (this.onSubtitleUrlFoundCallback) {
                                    this.onSubtitleUrlFoundCallback({
                                        vttText: response.vttText,
                                        targetVttText: response.targetVttText,
                                        videoId: response.videoId,
                                        url: response.url,
                                        sourceLanguage: response.sourceLanguage,
                                        targetLanguage: response.targetLanguage,
                                        useNativeTarget:
                                            response.useNativeTarget,
                                        availableLanguages:
                                            response.availableLanguages,
                                        selectedLanguage:
                                            response.selectedLanguage,
                                        targetLanguageInfo:
                                            response.targetLanguageInfo,
                                    });
                                }
                            } else if (response?.success && !requestIsCurrent) {
                                this.logger.warn(
                                    'Received VTT for superseded subtitle request - discarding',
                                    {
                                        receivedVideoId: response.videoId,
                                        currentVideoId: this.currentVideoId,
                                        urlLength: vttMasterUrl.length,
                                    }
                                );
                            } else if (response && !response.success) {
                                this.logger.error(
                                    'Background failed to fetch VTT',
                                    null,
                                    {
                                        errorLength:
                                            typeof response.error === 'string'
                                                ? response.error.length
                                                : 0,
                                        hasResponseUrl: Boolean(response.url),
                                        hasVideoId: Boolean(
                                            this.currentVideoId
                                        ),
                                    }
                                );
                            } else if (
                                response &&
                                response.videoId !== this.currentVideoId
                            ) {
                                this.logger.warn(
                                    'Received VTT for different video context - discarding',
                                    {
                                        receivedVideoId: response.videoId,
                                        currentVideoId: this.currentVideoId,
                                    }
                                );
                            } else {
                                this.logger.error(
                                    'No/invalid response from background for fetchVTT',
                                    null,
                                    {
                                        urlLength: vttMasterUrl.length,
                                        hasVideoId: Boolean(
                                            this.currentVideoId
                                        ),
                                    }
                                );
                            }
                        })
                        .catch((_error) => {
                            // Log chrome lastError if present for detailed diagnostics (test expectations)
                            const lastErr = chrome?.runtime?.lastError;
                            if (lastErr) {
                                this.logger.error(
                                    'Error for VTT fetch',
                                    lastErr,
                                    {
                                        urlLength: vttMasterUrl.length,
                                        hasVideoId: Boolean(
                                            this.currentVideoId
                                        ),
                                    }
                                );
                            } else {
                                this.logger.error(
                                    'No/invalid response from background for fetchVTT',
                                    null,
                                    {
                                        urlLength: vttMasterUrl.length,
                                        hasVideoId: Boolean(
                                            this.currentVideoId
                                        ),
                                    }
                                );
                            }
                        });
                })
                .catch((error) => {
                    this.logger.error(
                        'Failed to resolve subtitle request settings',
                        error,
                        {
                            urlLength: vttMasterUrl.length,
                            hasVideoId: Boolean(requestVideoId),
                        }
                    );
                })
                .finally(() => {
                    if (
                        this.pendingVttUrlForVideoId[requestVideoId] ===
                        requestMarker
                    ) {
                        delete this.pendingVttUrlForVideoId[requestVideoId];
                    }
                });
        }
    }

    handleInjectorEvents(e) {
        this._handleInjectorEvents(e);
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

    /**
     * Use the active HTML video as the continuously advancing clock. Disney+'s
     * lazily mounted timeline is sampled only to calibrate the media timestamp
     * onto the episode subtitle timeline.
     * @returns {number | null}
     */
    getPlaybackTime(preferredVideoElement = null) {
        const videoElement = preferredVideoElement || this.getVideoElement();
        const rawVideoTime = videoElement?.currentTime;
        if (!Number.isFinite(rawVideoTime)) return null;

        const previousVideoElement = this._clockVideoElement;
        const previousRawVideoTime = this._clockRawVideoTime;
        const previousTimelineElement = this._clockTimelineElement;
        const previousTimelineValue = this._clockTimelineValue;
        const videoElementChanged = videoElement !== previousVideoElement;

        if (videoElementChanged) {
            this._clockVideoElement = videoElement;
            this._playbackTimeOffset = null;
            this._clockNeedsFreshTimeline = previousVideoElement !== null;
            this._cachedProgressBarElement = null;
        }

        const timelineElement = this.getProgressBarElement();
        const timelineTime = this._readTimelineTime(timelineElement);

        const rawVideoTimeChanged =
            !videoElementChanged &&
            Number.isFinite(previousRawVideoTime) &&
            Math.abs(rawVideoTime - previousRawVideoTime) >
                TIMELINE_DRIFT_TOLERANCE_SECONDS;
        const timelineTimeChanged =
            !videoElementChanged &&
            timelineTime !== null &&
            Number.isFinite(previousTimelineValue) &&
            Math.abs(timelineTime - previousTimelineValue) >
                TIMELINE_DRIFT_TOLERANCE_SECONDS;
        const coherentClockJump =
            rawVideoTimeChanged &&
            timelineTimeChanged &&
            Math.abs(
                rawVideoTime -
                    previousRawVideoTime -
                    (timelineTime - previousTimelineValue)
            ) <= TIMELINE_DRIFT_TOLERANCE_SECONDS;

        // During a seek, Disney's slider and media clock often update on
        // different frames. Never turn that temporary disagreement into a
        // persistent offset; prefer the active video until the timeline moves
        // again and proves it is fresh.
        if (
            (rawVideoTimeChanged || timelineTimeChanged) &&
            !coherentClockJump &&
            (timelineTime !== null || this._clockNeedsFreshTimeline)
        ) {
            this._playbackTimeOffset = null;
            this._clockNeedsFreshTimeline = true;
            this._clockRawVideoTime = rawVideoTime;
            if (timelineElement && timelineTime !== null) {
                this._clockTimelineElement = timelineElement;
                this._clockTimelineValue = timelineTime;
            }
            return rawVideoTime;
        }

        if (this._clockNeedsFreshTimeline) {
            const hasFreshTimelineSample =
                timelineElement &&
                timelineTime !== null &&
                Number.isFinite(previousTimelineValue) &&
                Math.abs(timelineTime - previousTimelineValue) > 0.01;

            this._clockRawVideoTime = rawVideoTime;
            if (!hasFreshTimelineSample) {
                if (timelineElement && timelineTime !== null) {
                    this._clockTimelineElement = timelineElement;
                    this._clockTimelineValue = timelineTime;
                }
                return rawVideoTime;
            }

            this._clockNeedsFreshTimeline = false;
            this._playbackTimeOffset = timelineTime - rawVideoTime;
        }

        if (timelineElement && timelineTime !== null) {
            const timelineElementChanged =
                timelineElement !== previousTimelineElement;
            const timelineValueChanged =
                previousTimelineValue === null ||
                Math.abs(timelineTime - previousTimelineValue) > 0.01;
            const predictedTime =
                rawVideoTime + (this._playbackTimeOffset || 0);
            const clockDrift = Math.abs(timelineTime - predictedTime);

            if (
                this._playbackTimeOffset === null ||
                timelineElementChanged ||
                (timelineValueChanged &&
                    clockDrift > TIMELINE_DRIFT_TOLERANCE_SECONDS)
            ) {
                this._playbackTimeOffset = timelineTime - rawVideoTime;
            }

            this._clockTimelineElement = timelineElement;
            this._clockTimelineValue = timelineTime;
        } else {
            // Keep the calibrated offset while Disney+ unmounts idle controls.
            this._clockTimelineElement = null;
            this._clockTimelineValue = null;
        }

        this._clockRawVideoTime = rawVideoTime;
        return rawVideoTime + (this._playbackTimeOffset || 0);
    }

    invalidatePlaybackClockCalibration() {
        this._playbackTimeOffset = null;
        this._clockNeedsFreshTimeline = true;
    }

    supportsProgressBarTracking() {
        // The generic observer treats the UI control as the primary clock and
        // blocks startup while it is absent. Disney+ uses it only for internal
        // calibration, so native timeupdate events remain authoritative.
        return false;
    }

    /**
     * Platform-specific playback helpers for Disney+
     */
    _getToggleButtonRoot() {
        try {
            const toggleHost = document.querySelector(
                'disney-web-player-ui toggle-play-pause'
            );
            return toggleHost?.shadowRoot || null;
        } catch (_) {
            return null;
        }
    }

    isPlaying() {
        try {
            const root = this._getToggleButtonRoot();
            if (!root) return null;
            const roleBtn = root.querySelector('[role="button"]');
            const label = roleBtn?.getAttribute('aria-label');
            if (!label) return null;
            return label === 'Pause';
        } catch (_) {
            return null;
        }
    }

    async pausePlayback() {
        try {
            const state = this.isPlaying();
            if (state === false) return true;
            const root = this._getToggleButtonRoot();
            if (!root) return false;
            const btn =
                root.querySelector('button') ||
                root.querySelector('[role="button"]');
            if (!btn) return false;
            btn.click();
            await new Promise((r) =>
                setTimeout(r, PLAYBACK_TRANSITION_DELAY_MS)
            );
            const after = this.isPlaying();
            return after === false;
        } catch (_) {
            return false;
        }
    }

    async resumePlayback() {
        try {
            const state = this.isPlaying();
            if (state === true) return true;
            const root = this._getToggleButtonRoot();
            if (!root) return false;
            const btn =
                root.querySelector('button') ||
                root.querySelector('[role="button"]');
            if (!btn) return false;
            btn.click();
            await new Promise((r) =>
                setTimeout(r, PLAYBACK_TRANSITION_DELAY_MS)
            );
            const after = this.isPlaying();
            return after === true;
        } catch (_) {
            return false;
        }
    }

    /**
     * Deep querySelector that traverses shadow DOM trees to find the first match
     * @param {string[]|string} selectors - One or more selectors to try
     * @returns {Element|null}
     * @private
     */
    _querySelectorDeep(selectors) {
        const selectorList = Array.isArray(selectors) ? selectors : [selectors];
        const visited = new Set();
        const queue = [document];

        while (queue.length) {
            const root = queue.shift();
            if (!root || visited.has(root)) continue;
            visited.add(root);

            for (const sel of selectorList) {
                try {
                    const el = root.querySelector(sel);
                    if (el) return el;
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
                console.warn(
                    '[DisneyPlusPlatform] document.head not available, cannot inject CSS'
                );
                return;
            }

            try {
                styleElement = document.createElement('style');
                styleElement.id = cssId;
                document.head.appendChild(styleElement);
            } catch (error) {
                console.error(
                    '[DisneyPlusPlatform] Failed to inject CSS:',
                    error
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

    setupSubtitleMutationObserver() {
        // Disconnect any existing observer
        if (this.subtitleObserver) {
            this.subtitleObserver.disconnect();
        }

        // Validate that document.body exists before setting up observer
        if (!document.body || !(document.body instanceof Node)) {
            console.warn(
                '[DisneyPlusPlatform] document.body not available, retrying in 100ms'
            );
            setTimeout(() => {
                this.setupSubtitleMutationObserver();
            }, 100);
            return;
        }

        try {
            // Set up mutation observer to catch dynamically created subtitle elements
            this.subtitleObserver = new MutationObserver((mutations) => {
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
                    setTimeout(() => {
                        this.applyCurrentSubtitleSetting();
                    }, 100);
                }
            });

            // Start observing the document body for changes
            this.subtitleObserver.observe(document.body, {
                childList: true,
                subtree: true,
            });

            console.log(
                '[DisneyPlusPlatform] Subtitle mutation observer set up successfully'
            );
        } catch (error) {
            console.error(
                '[DisneyPlusPlatform] Failed to set up subtitle mutation observer:',
                error
            );
            // Retry after a delay
            setTimeout(() => {
                this.setupSubtitleMutationObserver();
            }, 500);
        }
    }

    async applyCurrentSubtitleSetting() {
        // Reuse base class cache when possible to avoid frequent storage calls
        let hideOfficialSubtitles = this._hideOfficialSubtitles;
        if (hideOfficialSubtitles === undefined) {
            try {
                hideOfficialSubtitles = await configService.get(
                    'hideOfficialSubtitles'
                );
                this._hideOfficialSubtitles = !!hideOfficialSubtitles;
            } catch (_) {
                hideOfficialSubtitles = false;
            }
        }

        const disneyPlusSubtitleSelectors = [
            '.TimedTextOverlay',
            '.hive-subtitle-renderer-wrapper',
            '.hive-subtitle-renderer-cue-positioning-box',
            '.hive-subtitle-renderer-cue-window',
        ];

        if (hideOfficialSubtitles) {
            this.hideOfficialSubtitleContainers(disneyPlusSubtitleSelectors);
        } else {
            this.showOfficialSubtitleContainers();
        }
    }

    cleanup() {
        if (this.eventListener) {
            document.removeEventListener(INJECT_EVENT_ID, this.eventListener);
            this.eventListener = null;
            this.logger.debug('Event listener removed');
        }

        this.cleanupNativeSubtitleSettingsListener();

        if (this.subtitleObserver) {
            this.subtitleObserver.disconnect();
            this.subtitleObserver = null;
            this.logger.debug('Subtitle mutation observer cleaned up');
        }

        // Remove our custom CSS
        const cssElement = document.getElementById(
            'dualsub-disneyplus-subtitle-hider'
        );
        if (cssElement) {
            cssElement.remove();
        }

        this.currentVideoId = null;
        this.onSubtitleUrlFoundCallback = null;
        this.onVideoIdChangeCallback = null;
        this.lastKnownVttUrlForVideoId = {};
        this.pendingVttUrlForVideoId = {};
        this._clockVideoElement = null;
        this._clockTimelineElement = null;
        this._clockTimelineValue = null;
        this._clockRawVideoTime = null;
        this._clockNeedsFreshTimeline = false;
        this._playbackTimeOffset = null;
        this._cachedProgressBarElement = null;
        this._lastDeepTimelineSearchAt = 0;
        this.logger.info('Platform cleaned up successfully');
    }
}
