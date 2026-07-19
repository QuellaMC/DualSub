import Logger from '../utils/logger.js';
import { configService } from '../services/configService.js';

// Define constants for the injected script and communication events
// It is crucial that these values match what you will use in 'netflixInject.js'
import { Injection } from '../content_scripts/shared/constants/injection.js';
import { createInjectionChannel } from '../content_scripts/shared/injectionChannel.js';
import {
    extractNetflixVideoIdFromPathname,
    extractNetflixVideoIdFromUrl,
    normalizeNetflixVideoId,
    readOwnDataProperty,
    readOwnPrimitiveDataProperty,
} from '../content_scripts/shared/subtitleRequestIdentity.js';

const INJECT_SCRIPT_TAG_ID = Injection.netflix.SCRIPT_TAG_ID;
const INJECT_EVENT_ID = Injection.netflix.EVENT_ID; // Must match netflixInject.js
const SUBTITLE_OBSERVER_RETRY_DELAY_MS = 250;
const SUBTITLE_OBSERVER_MAX_ATTEMPTS = 20;

import { BasePlatformAdapter } from './BasePlatformAdapter.js';

export class NetflixPlatform extends BasePlatformAdapter {
    constructor() {
        super();

        this.chromeApiAvailable = !!(
            chrome &&
            chrome.runtime &&
            chrome.storage
        );

        try {
            this.logger = Logger.create('NetflixPlatform', configService);
        } catch {
            this.logger = {
                debug: (...args) => console.debug('[NetflixPlatform]', ...args),
                info: (...args) => console.info('[NetflixPlatform]', ...args),
                warn: (...args) => console.warn('[NetflixPlatform]', ...args),
                error: (...args) => console.error('[NetflixPlatform]', ...args),
                updateLevel: () => Promise.resolve(),
            };
            this._logBestEffort(
                'warn',
                'Failed to create proper logger, using fallback',
                { loggerCreated: false }
            );
        }

        this.currentVideoId = null;
        this.onSubtitleUrlFoundCallback = null;
        this.onVideoIdChangeCallback = null;
        this.eventListener = null; // To hold the bound event listener for later removal
        this.injectionChannel = null;
        // Buffer for preloaded subtitle data keyed by upcoming movieId
        this.preloadedSubtitleBuffer = Object.create(null);

        this.initializeLogger().catch(() => {
            this._logBestEffort(
                'warn',
                'Logger initialization failed, continuing with defaults',
                { loggerInitialized: false }
            );
        });
    }

    /**
     * Gets the platform name.
     * @returns {string} The platform name, 'netflix'.
     */
    getPlatformName() {
        return 'netflix';
    }

    /**
     * Initialize logger with logging level detection
     */
    async initializeLogger() {
        try {
            if (this.chromeApiAvailable && this.logger.updateLevel) {
                await this.logger.updateLevel();
                this._logBestEffort(
                    'debug',
                    'Logger level updated successfully'
                );
            } else {
                this._logBestEffort(
                    'warn',
                    'Chrome API not available or logger.updateLevel missing, using default logging level'
                );
            }
        } catch {
            this._logBestEffort(
                'warn',
                'Failed to initialize logger level, continuing with defaults',
                {
                    chromeApiAvailable: this.chromeApiAvailable,
                }
            );
        }
    }

    isPlatformActive() {
        return window.location.hostname.includes('netflix.com');
    }

    isPlayerPageActive() {
        return Boolean(
            extractNetflixVideoIdFromPathname(window.location.pathname)
        );
    }

    hasAdoptedPlayerRoute(url) {
        const routeVideoId = extractNetflixVideoIdFromUrl(url);
        return Boolean(routeVideoId && routeVideoId === this.currentVideoId);
    }

    async initialize(onSubtitleUrlFound, onVideoIdChange) {
        this._retirePlatformLifecycle();

        if (!this.isPlatformActive()) return;

        const channel = createInjectionChannel('netflix');
        if (!channel) {
            this._logBestEffort(
                'warn',
                'Netflix injection channel unavailable; platform event bridge disabled'
            );
            return;
        }
        this.injectionChannel = channel;

        this.setCallbacks(onSubtitleUrlFound, onVideoIdChange);
        const lifecycleGeneration = this._beginPlatformLifecycle();

        this.eventListener = (event) =>
            this._handleInjectorEventWithChannel(
                channel,
                event,
                lifecycleGeneration
            );
        document.addEventListener(INJECT_EVENT_ID, this.eventListener);

        const netflixSubtitleSelectors = [
            '.player-timedtext',
            '.watch-video--bottom-controls-container .timedtext-text-container',
            '.player-timedtext-text-container',
            '[data-uia="player-timedtext-text-container"]',
        ];
        this.setupNativeSubtitleSettingsListener(netflixSubtitleSelectors);

        this._logBestEffort('info', 'Initialized and event listener added', {
            selectors: netflixSubtitleSelectors,
        });
    }

    handleInjectorEvents(event) {
        return this._handleInjectorEventWithChannel(
            this.injectionChannel,
            event,
            this._lifecycleGeneration
        );
    }

    _handleInjectorEventWithChannel(
        channel,
        event,
        lifecycleGeneration = this._lifecycleGeneration
    ) {
        if (!this._isPlatformLifecycleCurrent(lifecycleGeneration)) return;
        const data = channel?.accept(event);
        if (!data || !this._isPlatformLifecycleCurrent(lifecycleGeneration)) {
            return;
        }
        return this._handleAlreadyAuthorizedInjectorData(
            data,
            lifecycleGeneration
        );
    }

    _handleAlreadyAuthorizedInjectorData(
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
        } else if (eventType === 'SUBTITLE_DATA_FOUND') {
            const payload = readOwnDataProperty(data, 'payload');
            const rawMovieId = readOwnPrimitiveDataProperty(payload, 'movieId');
            const movieId = normalizeNetflixVideoId(rawMovieId);
            const timedtexttracks = readOwnDataProperty(
                payload,
                'timedtexttracks'
            );
            const trackCount = this._getSafeArrayLength(timedtexttracks);
            this._logBestEffort('debug', 'Raw subtitle data received', {
                hasPayload: Boolean(payload),
                trackCount,
            });

            if (!movieId) {
                this._logBestEffort(
                    'error',
                    'SUBTITLE_DATA_FOUND event missing a valid movieId',
                    null,
                    {
                        hasPayload: Boolean(payload),
                        receivedType: typeof rawMovieId,
                    }
                );
                return;
            }

            if (!timedtexttracks) {
                this._logBestEffort(
                    'error',
                    'SUBTITLE_DATA_FOUND event missing timedtexttracks',
                    null,
                    {
                        hasPayload: Boolean(payload),
                    }
                );
                return;
            }

            this._logBestEffort(
                'debug',
                'Netflix SUBTITLE_DATA_FOUND for movieId',
                {
                    movieIdLength: movieId.length,
                    dataType: typeof timedtexttracks,
                    trackCount,
                }
            );

            // The isolated-world route is authoritative for current state and requests.
            const urlMovieId = this.extractMovieIdFromUrl();
            if (!urlMovieId) {
                this._logBestEffort(
                    'warn',
                    'Rejected subtitle event outside a watch route',
                    {
                        eventMovieIdLength: movieId.length,
                        trackCount,
                    }
                );
                return;
            }

            if (movieId !== urlMovieId) {
                if (trackCount === 0) {
                    this._logBestEffort(
                        'warn',
                        'Rejected preloaded subtitle data without tracks',
                        {
                            eventMovieIdLength: movieId.length,
                            routeMovieIdLength: urlMovieId.length,
                        }
                    );
                    return;
                }

                // Netflix often preloads next episode data before navigation. Buffer it.
                this._logBestEffort(
                    'info',
                    'Buffering preloaded subtitle data for upcoming movieId',
                    {
                        eventMovieIdLength: movieId.length,
                        routeMovieIdLength: urlMovieId.length,
                        idsMatch: false,
                        trackCount,
                    }
                );
                if (!lifecycleIsCurrent()) return;
                this.preloadedSubtitleBuffer[movieId] = timedtexttracks;
                return;
            }
            this._logBestEffort(
                'debug',
                'MovieId matches URL - processing subtitle data',
                {
                    movieIdLength: movieId.length,
                    idsMatch: true,
                }
            );

            // Handle video ID change
            if (this.currentVideoId !== urlMovieId) {
                if (!lifecycleIsCurrent()) return;
                this.setVideoIdAndNotify(urlMovieId);
                if (!lifecycleIsCurrent()) return;
            }

            // Check if timedtexttracks is an array and has content
            if (trackCount === 0) {
                this._logBestEffort(
                    'warn',
                    'No subtitle tracks available in timedtexttracks data'
                );
                return;
            }

            this._logBestEffort('info', 'Found subtitle tracks for movieId', {
                trackCount,
                hasMovieId: true,
            });

            // Filter tracks first: exclude forced narrative tracks and None tracks
            const validTracks = timedtexttracks.filter(
                (track) => !track.isNoneTrack && !track.isForcedNarrative
            );
            const validTrackCount = this._getSafeArrayLength(validTracks);

            this._logBestEffort('debug', 'Netflix filtered to valid tracks', {
                validTrackCount,
                originalCount: trackCount,
                filterCriteria: 'non-forced, non-None',
            });

            if (validTrackCount === 0) {
                this._logBestEffort(
                    'warn',
                    'No valid subtitle tracks available after filtering'
                );
                return;
            }

            // Find the first track with downloadable content
            let primaryTrackUrl = null;
            for (const track of validTracks) {
                // Check both possible locations for downloadables
                let downloadables = null;

                // First check track.ttDownloadables (direct location)
                if (
                    track.ttDownloadables &&
                    typeof track.ttDownloadables === 'object' &&
                    !Array.isArray(track.ttDownloadables)
                ) {
                    downloadables = track.ttDownloadables;
                }
                // Fallback to track.rawTrack.ttDownloadables
                else if (track.rawTrack?.ttDownloadables) {
                    downloadables = track.rawTrack.ttDownloadables;
                }

                if (downloadables) {
                    // Try to find any downloadable format
                    const formats = Object.keys(downloadables);
                    for (const format of formats) {
                        const formatData = downloadables[format];
                        if (
                            formatData &&
                            Array.isArray(formatData.urls) &&
                            formatData.urls.length > 0
                        ) {
                            const urlObject = formatData.urls[0];
                            if (
                                urlObject &&
                                typeof urlObject.url === 'string'
                            ) {
                                primaryTrackUrl = urlObject.url;
                                break;
                            }
                        }
                    }
                    if (primaryTrackUrl) break;
                }
            }

            if (!primaryTrackUrl) {
                this._logBestEffort(
                    'warn',
                    'No downloadable subtitle URLs found in any track'
                );
                this._logBestEffort('debug', 'Full tracks data for debugging', {
                    trackCount,
                });
                return;
            }

            const requestVideoId = this.currentVideoId;
            const { request, inFlight } = this.beginVttRequest(
                primaryTrackUrl,
                requestVideoId
            );
            if (!request) {
                this._logBestEffort(
                    'debug',
                    'Subtitle data already processed',
                    {
                        hasVideoId: Boolean(requestVideoId),
                        inFlight,
                    }
                );
                return;
            }

            this._logBestEffort(
                'info',
                'Requesting VTT processing from background',
                {
                    trackCount: validTrackCount,
                }
            );

            return Promise.resolve()
                .then(() =>
                    configService.getMultiple([
                        'targetLanguage',
                        'originalLanguage',
                        'useNativeSubtitles',
                        'useOfficialTranslations',
                    ])
                )
                .then((settings) => {
                    if (!lifecycleIsCurrent()) return;
                    const {
                        targetLanguage = 'zh-CN',
                        originalLanguage = 'en',
                        useNativeSubtitles = true,
                        useOfficialTranslations,
                    } = settings; // Defaults from subtitleUtilities.js

                    // Use useOfficialTranslations if available, fallback to useNativeSubtitles for backward compatibility
                    const useOfficialSubtitles =
                        useOfficialTranslations !== undefined
                            ? useOfficialTranslations
                            : useNativeSubtitles;
                    const hasTargetLanguage =
                        typeof targetLanguage === 'string' &&
                        targetLanguage.length > 0;
                    const hasOriginalLanguage =
                        typeof originalLanguage === 'string' &&
                        originalLanguage.length > 0;

                    // Enhanced logging for debugging official translation functionality
                    this._logBestEffort(
                        'info',
                        'Netflix subtitle processing mode determined',
                        {
                            useOfficialTranslations:
                                useOfficialTranslations === true,
                            useNativeSubtitles: useNativeSubtitles === true,
                            useOfficialSubtitles: useOfficialSubtitles === true,
                            hasTargetLanguage,
                            hasOriginalLanguage,
                            hasMovieId: Boolean(requestVideoId),
                        }
                    );

                    if (useOfficialSubtitles) {
                        this._logBestEffort(
                            'info',
                            'Netflix will attempt to use official subtitles',
                            {
                                hasTargetLanguage,
                                hasOriginalLanguage,
                                trackCount,
                            }
                        );
                    } else {
                        this._logBestEffort(
                            'info',
                            'Netflix will use translation API mode',
                            {
                                hasTargetLanguage,
                                hasOriginalLanguage,
                            }
                        );
                    }

                    const dispatchRouteVideoId = this.extractMovieIdFromUrl();
                    const requestIsCurrent = this.isVttRequestCurrent(request);
                    if (
                        !lifecycleIsCurrent() ||
                        dispatchRouteVideoId !== requestVideoId ||
                        !requestIsCurrent
                    ) {
                        this._logBestEffort(
                            'warn',
                            'Discarding stale Netflix subtitle request before background dispatch',
                            {
                                hasRouteVideoId: Boolean(dispatchRouteVideoId),
                                idsMatch:
                                    dispatchRouteVideoId === requestVideoId,
                                requestIsCurrent,
                                trackCount,
                            }
                        );
                        return;
                    }

                    const canDispatch = () =>
                        lifecycleIsCurrent() &&
                        this.extractMovieIdFromUrl() === requestVideoId &&
                        this.isVttRequestCurrent(request);

                    return this.requestNetflixVttWithTracks(
                        timedtexttracks,
                        targetLanguage,
                        originalLanguage,
                        useOfficialSubtitles,
                        requestVideoId,
                        canDispatch
                    )
                        .then((response) => {
                            if (!lifecycleIsCurrent()) return;
                            const responseRouteVideoId =
                                this.extractMovieIdFromUrl();
                            const requestIsCurrent =
                                this.isVttRequestCurrent(request);
                            const routeIsCurrent =
                                responseRouteVideoId === requestVideoId;

                            if (!routeIsCurrent || !requestIsCurrent) {
                                this._logBestEffort(
                                    'warn',
                                    'Discarding stale Netflix subtitle response after route change',
                                    {
                                        hasRouteVideoId:
                                            Boolean(responseRouteVideoId),
                                        idsMatch: routeIsCurrent,
                                        requestIsCurrent,
                                        hasReceivedVideoId: Boolean(
                                            response?.videoId
                                        ),
                                        trackCount,
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
                                    useNativeTarget:
                                        subtitleData.useNativeTarget === true,
                                    hasTargetVtt: !!subtitleData.targetVttText,
                                };

                                if (!lifecycleIsCurrent()) return;
                                onSubtitleUrlFound.call(this, subtitleData);

                                if (
                                    !lifecycleIsCurrent() ||
                                    this.extractMovieIdFromUrl() !==
                                        request.videoId ||
                                    !this.acceptVttResponse(request, response)
                                ) {
                                    return;
                                }

                                this._logBestEffort(
                                    'info',
                                    'Netflix VTT processed successfully',
                                    successTelemetry
                                );
                            } else if (response && !response.success) {
                                // Enhanced error logging for debugging official translation functionality
                                this._logBestEffort(
                                    'error',
                                    'Netflix background failed to process VTT',
                                    null,
                                    {
                                        backgroundRejected: true,
                                        hasVideoId: Boolean(requestVideoId),
                                        useOfficialSubtitles:
                                            useOfficialSubtitles === true,
                                        hasTargetLanguage,
                                        hasOriginalLanguage,
                                        trackCount,
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
                                // Generic failure path
                                this._logBestEffort(
                                    'error',
                                    'No/invalid response from background for Netflix fetchVTT',
                                    {
                                        hasVideoId: Boolean(requestVideoId),
                                    }
                                );
                            }
                        })
                        .catch(() => {
                            if (!lifecycleIsCurrent()) return;
                            this._logBestEffort(
                                'error',
                                'No/invalid response from background for Netflix fetchVTT',
                                {
                                    hasVideoId: Boolean(requestVideoId),
                                }
                            );
                        });
                })
                .catch(() => {
                    if (!lifecycleIsCurrent()) return;
                    this._logBestEffort(
                        'error',
                        'Failed to resolve subtitle request settings',
                        null,
                        {
                            hasVideoId: Boolean(requestVideoId),
                            trackCount,
                        }
                    );
                })
                .finally(() => {
                    this.finishVttRequest(request);
                });
        }
    }

    /**
     * Called by content script when URL changes (SPA navigation). If we buffered
     * subtitle data for the new movieId, process it now.
     * @param {string} _newUrl
     */
    onUrlChange(_newUrl) {
        try {
            const lifecycleGeneration = this._lifecycleGeneration;
            if (!this._isPlatformLifecycleCurrent(lifecycleGeneration)) return;
            const urlMovieId = this.extractMovieIdFromUrl();
            if (!urlMovieId) return;

            const bufferedTracks = this.preloadedSubtitleBuffer[urlMovieId];
            const bufferedTrackCount = this._getSafeArrayLength(bufferedTracks);
            if (bufferedTrackCount > 0) {
                this._logBestEffort(
                    'info',
                    'Processing buffered preloaded subtitles after navigation',
                    {
                        movieIdLength: urlMovieId.length,
                        trackCount: bufferedTrackCount,
                    }
                );
                // Clear buffer for this id before processing to avoid loops
                delete this.preloadedSubtitleBuffer[urlMovieId];
                // This data crossed the raw event authority gate before it was
                // buffered, so replay it only through the internal authorized path.
                this._handleAlreadyAuthorizedInjectorData(
                    {
                        type: 'SUBTITLE_DATA_FOUND',
                        payload: {
                            movieId: urlMovieId,
                            timedtexttracks: bufferedTracks,
                        },
                    },
                    lifecycleGeneration
                );
            }
        } catch {
            this._logBestEffort('warn', 'onUrlChange processing failed', {
                processingSucceeded: false,
            });
        }
    }

    getVideoElement() {
        return document.querySelector('video');
    }

    getCurrentVideoId() {
        return this.currentVideoId;
    }

    extractMovieIdFromUrl() {
        try {
            const extractedId = extractNetflixVideoIdFromUrl(
                window.location.href
            );
            if (extractedId) {
                this._logBestEffort('debug', 'Extracted movieId from URL', {
                    movieIdLength: extractedId.length,
                    pathnameLength: window.location.pathname.length,
                });
                return extractedId;
            }

            this._logBestEffort('warn', 'Could not extract movieId from URL', {
                pathnameLength: window.location.pathname.length,
            });
            return null;
        } catch {
            this._logBestEffort('error', 'Error extracting movieId from URL', {
                extractionSucceeded: false,
            });
            return null;
        }
    }

    getPlayerContainerElement() {
        const videoElement = this.getVideoElement();
        // The Netflix player container is typically a few levels above the video element.
        // This selector targets a div that contains the player UI.
        return videoElement ? videoElement.closest('div.watch-video') : null;
    }

    getProgressBarElement() {
        // Netflix: We don't use progress bar tracking since HTML5 video currentTime is reliable
        return null;
    }

    /**
     * Platform-specific playback helpers for Netflix
     */

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

            video.pause();
            return this.isPlaying() === false;
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

            await video.play();
            return this.isPlaying() === true;
        } catch (_) {
            return false;
        }
    }

    supportsProgressBarTracking() {
        // Netflix doesn't need progress bar tracking - HTML5 video currentTime is reliable
        return false;
    }

    handleNativeSubtitles() {
        // Netflix subtitle containers to hide
        const netflixSubtitleSelectors = [
            '.player-timedtext',
            '.watch-video--bottom-controls-container .timedtext-text-container',
            '.player-timedtext-text-container',
            '[data-uia="player-timedtext-text-container"]',
        ];

        // Use the utility method from the base class
        this.handleNativeSubtitlesWithSetting(netflixSubtitleSelectors);

        // Also set up a more robust monitoring system for Netflix
        this.setupNetflixSubtitleMonitoring();
    }

    setupNetflixSubtitleMonitoring() {
        // Add CSS to force hide Netflix subtitles when needed
        this.addNetflixSubtitleCSS();

        // Monitor for dynamically created subtitle elements
        this.setupSubtitleMutationObserver();
    }

    addNetflixSubtitleCSS() {
        // Add CSS rules that are more specific and use !important
        const cssId = 'dualsub-netflix-subtitle-hider';
        let styleElement = document.getElementById(cssId);

        if (!styleElement) {
            // Validate that document.head exists before appending
            if (!document.head || !(document.head instanceof Node)) {
                this._logBestEffort(
                    'warn',
                    '[NetflixPlatform] document.head not available, cannot inject CSS'
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
                    '[NetflixPlatform] Failed to inject CSS'
                );
                return;
            }
        }

        // CSS rules that will be applied when hiding is enabled
        const hidingCSS = `
            .player-timedtext[data-dualsub-hidden="true"] {
                display: none !important;
                visibility: hidden !important;
                opacity: 0 !important;
            }
            .player-timedtext-text-container[data-dualsub-hidden="true"] {
                display: none !important;
                visibility: hidden !important;
                opacity: 0 !important;
            }
            [data-uia="player-timedtext-text-container"][data-dualsub-hidden="true"] {
                display: none !important;
                visibility: hidden !important;
                opacity: 0 !important;
            }
        `;

        styleElement.textContent = hidingCSS;
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

        let playerRoot = null;
        try {
            playerRoot = this.getPlayerContainerElement();
        } catch (_) {
            this._scheduleSubtitleObserverRetry(
                timerGeneration,
                attempt,
                'player-root-lookup-failed'
            );
            return;
        }

        if (!(playerRoot instanceof Node)) {
            this._scheduleSubtitleObserverRetry(
                timerGeneration,
                attempt,
                'player-root-unavailable'
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
                                        'player-timedtext'
                                    ) ||
                                    node.classList?.contains(
                                        'player-timedtext-text-container'
                                    ) ||
                                    node.querySelector?.(
                                        '.player-timedtext, .player-timedtext-text-container'
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

            observer.observe(playerRoot, {
                childList: true,
                subtree: true,
            });

            if (timerGeneration !== this.ownedTimeoutGeneration) {
                observer.disconnect();
                return;
            }

            this.subtitleObserver = observer;
        } catch (_) {
            try {
                observer?.disconnect();
            } catch (_) {}
            this._scheduleSubtitleObserverRetry(
                timerGeneration,
                attempt,
                'observer-setup-failed'
            );
        }
    }

    async applyCurrentSubtitleSetting(timerGeneration = null) {
        const netflixSubtitleSelectors = [
            '.player-timedtext',
            '.player-timedtext-text-container',
            '[data-uia="player-timedtext-text-container"]',
            '.watch-video--bottom-controls-container .timedtext-text-container',
        ];

        await this.handleNativeSubtitlesWithSetting(
            netflixSubtitleSelectors,
            () =>
                timerGeneration === null ||
                timerGeneration === this.ownedTimeoutGeneration
        );
    }

    _retirePlatformLifecycle() {
        this._invalidatePlatformLifecycle();
        this._clearOwnedTimeouts();

        const channel = this.injectionChannel;
        this.injectionChannel = null;
        channel?.revoke();

        if (this.eventListener) {
            document.removeEventListener(INJECT_EVENT_ID, this.eventListener);
            this.eventListener = null;
            this._logBestEffort('debug', 'Event listener removed');
        }

        // Clean up storage listener for subtitle settings
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
        this.preloadedSubtitleBuffer = Object.create(null);
    }

    cleanup() {
        this._retirePlatformLifecycle();

        // Remove our custom CSS
        const cssElement = document.getElementById(
            'dualsub-netflix-subtitle-hider'
        );
        if (cssElement) {
            cssElement.remove();
        }

        const scriptTag = document.getElementById(INJECT_SCRIPT_TAG_ID);
        if (scriptTag) {
            scriptTag.remove();
        }

        this._logBestEffort('info', 'Platform cleaned up successfully');
    }
}
