import { VideoPlatform } from './platform_interface.js';
import Logger from '../utils/logger.js';
import { configService } from '../services/configService.js';
import { MessageActions } from '../content_scripts/shared/constants/messageActions.js';

// Define constants for the injected script and communication events
// It is crucial that these values match what you will use in 'netflixInject.js'
import { Injection } from '../content_scripts/shared/constants/injection.js';

const INJECT_SCRIPT_FILENAME = Injection.netflix.SCRIPT_FILENAME;
const INJECT_SCRIPT_TAG_ID = Injection.netflix.SCRIPT_TAG_ID;
const INJECT_EVENT_ID = Injection.netflix.EVENT_ID; // Must match netflixInject.js

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
        } catch (error) {
            this.logger = {
                debug: (...args) => console.debug('[NetflixPlatform]', ...args),
                info: (...args) => console.info('[NetflixPlatform]', ...args),
                warn: (...args) => console.warn('[NetflixPlatform]', ...args),
                error: (...args) => console.error('[NetflixPlatform]', ...args),
                updateLevel: () => Promise.resolve(),
            };
            this.logger.warn('Failed to create proper logger, using fallback', {
                error: error.message,
            });
        }

        this.currentVideoId = null;
        this.onSubtitleUrlFoundCallback = null;
        this.onVideoIdChangeCallback = null;
        this.lastKnownVttUrlForVideoId = {}; // To prevent reprocessing the same subtitle data
        this.eventListener = null; // To hold the bound event listener for later removal
        // Buffer for preloaded subtitle data keyed by upcoming movieId
        this.preloadedSubtitleBuffer = Object.create(null);

        this.initializeLogger().catch((error) => {
            this.logger.warn(
                'Logger initialization failed, continuing with defaults',
                { error: error.message }
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
                this.logger.debug('Logger level updated successfully');
            } else {
                this.logger.warn(
                    'Chrome API not available or logger.updateLevel missing, using default logging level'
                );
            }
        } catch (error) {
            this.logger.warn(
                'Failed to initialize logger level, continuing with defaults',
                {
                    error: error.message,
                    chromeApiAvailable: this.chromeApiAvailable,
                }
            );
        }
    }

    isPlatformActive() {
        return window.location.hostname.includes('netflix.com');
    }

    isPlayerPageActive() {
        // Netflix player pages typically have "/watch/" in the URL path.
        return window.location.pathname.includes('/watch/');
    }

    async initialize(onSubtitleUrlFound, onVideoIdChange) {
        if (!this.isPlatformActive()) return;

        this.setCallbacks(onSubtitleUrlFound, onVideoIdChange);

        this.eventListener = this.handleInjectorEvents.bind(this);
        document.addEventListener(INJECT_EVENT_ID, this.eventListener);

        const netflixSubtitleSelectors = [
            '.player-timedtext',
            '.watch-video--bottom-controls-container .timedtext-text-container',
            '.player-timedtext-text-container',
            '[data-uia="player-timedtext-text-container"]',
        ];
        this.setupNativeSubtitleSettingsListener(netflixSubtitleSelectors);

        this.logger.info('Initialized and event listener added', {
            selectors: netflixSubtitleSelectors,
        });
    }

    handleInjectorEvents(e) {
        const data = e.detail;
        if (!data || !data.type) return;

        if (data.type === 'INJECT_SCRIPT_READY') {
            this.logger.info('Inject script is ready');
        } else if (data.type === 'SUBTITLE_DATA_FOUND') {
            this.logger.debug('Raw subtitle data received', {
                payload: data.payload,
            });

            const { movieId, timedtexttracks } = data.payload;

            if (!movieId) {
                this.logger.error(
                    'SUBTITLE_DATA_FOUND event missing movieId',
                    null,
                    {
                        payload: data.payload,
                    }
                );
                return;
            }

            if (!timedtexttracks) {
                this.logger.error(
                    'SUBTITLE_DATA_FOUND event missing timedtexttracks',
                    null,
                    {
                        payload: data.payload,
                    }
                );
                return;
            }

            this.logger.debug('Netflix SUBTITLE_DATA_FOUND for movieId', {
                movieId: movieId,
                dataType: typeof timedtexttracks,
                trackCount: Array.isArray(timedtexttracks)
                    ? timedtexttracks.length
                    : 0,
                content: timedtexttracks,
            });

            // Extract movieId from current URL to ensure we only process subtitles for the current content
            const urlMovieId = this.extractMovieIdFromUrl();
            if (urlMovieId && String(movieId) !== String(urlMovieId)) {
                // Netflix often preloads next episode data before navigation. Buffer it.
                this.logger.info(
                    'Buffering preloaded subtitle data for upcoming movieId',
                    {
                        receivedMovieId: movieId,
                        receivedType: typeof movieId,
                        urlMovieId: urlMovieId,
                        urlType: typeof urlMovieId,
                    }
                );
                this.preloadedSubtitleBuffer[movieId] = timedtexttracks;
                return;
            }
            this.logger.debug(
                'MovieId matches URL - processing subtitle data',
                {
                    movieId: movieId,
                    urlMovieId: urlMovieId,
                }
            );

            // Handle video ID change
            if (this.currentVideoId !== movieId) {
                this.logger.info('Video context changing', {
                    previousVideoId: this.currentVideoId || 'null',
                    newVideoId: movieId,
                });
                if (this.currentVideoId) {
                    delete this.lastKnownVttUrlForVideoId[this.currentVideoId];
                }
                this.setVideoIdAndNotify(movieId);
            }

            // Check if timedtexttracks is an array and has content
            if (
                !Array.isArray(timedtexttracks) ||
                timedtexttracks.length === 0
            ) {
                this.logger.warn(
                    'No subtitle tracks available in timedtexttracks data'
                );
                return;
            }

            this.logger.info('Found subtitle tracks for movieId', {
                trackCount: timedtexttracks.length,
                movieId: movieId,
            });

            // Filter tracks first: exclude forced narrative tracks and None tracks
            const validTracks = timedtexttracks.filter(
                (track) => !track.isNoneTrack && !track.isForcedNarrative
            );

            this.logger.debug('Netflix filtered to valid tracks', {
                validTrackCount: validTracks.length,
                originalCount: timedtexttracks.length,
                filterCriteria: 'non-forced, non-None',
                validTrackLanguages: validTracks.map((track) => ({
                    language: track.language,
                    displayName: track.displayName,
                    trackType: track.trackType,
                })),
            });

            if (validTracks.length === 0) {
                this.logger.warn(
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
                this.logger.warn(
                    'No downloadable subtitle URLs found in any track'
                );
                this.logger.debug('Full tracks data for debugging', {
                    tracksData: JSON.stringify(timedtexttracks, null, 2),
                });
                return;
            }

            if (
                this.lastKnownVttUrlForVideoId[this.currentVideoId] ===
                primaryTrackUrl
            ) {
                this.logger.debug('Subtitle data already processed', {
                    videoId: this.currentVideoId,
                    url: primaryTrackUrl,
                });
                return;
            }
            this.lastKnownVttUrlForVideoId[this.currentVideoId] =
                primaryTrackUrl;

            this.logger.info('Requesting VTT processing from background', {
                videoId: this.currentVideoId,
                primaryTrackUrl: primaryTrackUrl,
            });

            configService
                .getMultiple([
                    'targetLanguage',
                    'originalLanguage',
                    'useNativeSubtitles',
                    'useOfficialTranslations',
                ])
                .then((settings) => {
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

                    // Enhanced logging for debugging official translation functionality
                    this.logger.info(
                        'Netflix subtitle processing mode determined',
                        {
                            useOfficialTranslations,
                            useNativeSubtitles,
                            useOfficialSubtitles,
                            targetLanguage,
                            originalLanguage,
                            movieId: this.currentVideoId,
                        }
                    );

                    if (useOfficialSubtitles) {
                        this.logger.info(
                            'Netflix will attempt to use official subtitles',
                            {
                                targetLanguage,
                                originalLanguage,
                                trackCount: timedtexttracks.length,
                            }
                        );
                    } else {
                        this.logger.info(
                            'Netflix will use translation API mode',
                            {
                                targetLanguage,
                                originalLanguage,
                            }
                        );
                    }

                    import(
                        chrome.runtime.getURL(
                            'content_scripts/shared/messaging.js'
                        )
                    )
                        .then(({ sendRuntimeMessageWithRetry }) =>
                            sendRuntimeMessageWithRetry(
                                {
                                    action: MessageActions.FETCH_VTT,
                                    data: { tracks: timedtexttracks },
                                    videoId: this.currentVideoId,
                                    targetLanguage: targetLanguage,
                                    originalLanguage: originalLanguage,
                                    useNativeSubtitles: useOfficialSubtitles,
                                    useOfficialTranslations:
                                        useOfficialSubtitles,
                                    source: 'netflix',
                                },
                                { retries: 3, baseDelayMs: 150 }
                            )
                        )
                        .then((response) => {
                            if (
                                response &&
                                response.success &&
                                response.videoId === this.currentVideoId
                            ) {
                                // Enhanced logging for debugging official translation functionality
                                this.logger.info(
                                    'Netflix VTT processed successfully',
                                    {
                                        videoId: this.currentVideoId,
                                        sourceLanguage: response.sourceLanguage,
                                        targetLanguage: response.targetLanguage,
                                        useNativeTarget:
                                            response.useNativeTarget,
                                        hasTargetVtt: !!response.targetVttText,
                                        availableLanguagesCount:
                                            response.availableLanguages
                                                ?.length || 0,
                                    }
                                );

                                if (response.useNativeTarget) {
                                    this.logger.info(
                                        'Netflix official subtitles successfully used',
                                        {
                                            targetLanguage:
                                                response.targetLanguage,
                                            sourceLanguage:
                                                response.sourceLanguage,
                                            targetVttLength:
                                                response.targetVttText
                                                    ?.length || 0,
                                        }
                                    );
                                } else {
                                    this.logger.info(
                                        'Netflix using translation API mode (official subtitles not available or disabled)',
                                        {
                                            targetLanguage:
                                                response.targetLanguage,
                                            sourceLanguage:
                                                response.sourceLanguage,
                                            reason:
                                                response.useNativeTarget ===
                                                false
                                                    ? 'not available'
                                                    : 'disabled',
                                        }
                                    );
                                }

                                if (this.onSubtitleUrlFoundCallback) {
                                    this.logger.info(
                                        'Netflix subtitle callback is available, preparing data',
                                        {
                                            hasCallback:
                                                !!this
                                                    .onSubtitleUrlFoundCallback,
                                            callbackType:
                                                typeof this
                                                    .onSubtitleUrlFoundCallback,
                                            videoId: response.videoId,
                                        }
                                    );

                                    // Enhanced logging for subtitle processing pipeline
                                    const subtitleData = {
                                        vttText: response.vttText,
                                        targetVttText: response.targetVttText,
                                        videoId: response.videoId,
                                        url: response.url, // URL of the original language subtitle file
                                        sourceLanguage: response.sourceLanguage,
                                        targetLanguage: response.targetLanguage,
                                        useNativeTarget:
                                            response.useNativeTarget || false,
                                        availableLanguages:
                                            response.availableLanguages,
                                        selectedLanguage: {
                                            displayName:
                                                response.sourceLanguage,
                                            normalizedCode:
                                                response.sourceLanguage,
                                        },
                                    };

                                    this.logger.debug(
                                        'Netflix subtitle data prepared for dual display',
                                        {
                                            hasOriginalVtt:
                                                !!subtitleData.vttText,
                                            hasTargetVtt:
                                                !!subtitleData.targetVttText,
                                            useNativeTarget:
                                                subtitleData.useNativeTarget,
                                            originalVttLength:
                                                subtitleData.vttText?.length ||
                                                0,
                                            targetVttLength:
                                                subtitleData.targetVttText
                                                    ?.length || 0,
                                            displayMode:
                                                subtitleData.targetVttText
                                                    ? 'dual'
                                                    : 'original-only',
                                        }
                                    );

                                    // The callback expects a 'SubtitleData' object, as defined in subtitleUtilities.js
                                    this.logger.info(
                                        'Calling Netflix subtitle callback with data',
                                        {
                                            videoId: subtitleData.videoId,
                                            hasVttText: !!subtitleData.vttText,
                                            hasTargetVttText:
                                                !!subtitleData.targetVttText,
                                            useNativeTarget:
                                                subtitleData.useNativeTarget,
                                            vttTextLength:
                                                subtitleData.vttText?.length ||
                                                0,
                                            targetVttTextLength:
                                                subtitleData.targetVttText
                                                    ?.length || 0,
                                        }
                                    );

                                    this.onSubtitleUrlFoundCallback(
                                        subtitleData
                                    );

                                    this.logger.debug(
                                        'Netflix subtitle callback completed'
                                    );
                                } else {
                                    this.logger.error(
                                        'Netflix subtitle callback is not available',
                                        {
                                            hasCallback:
                                                !!this
                                                    .onSubtitleUrlFoundCallback,
                                            callbackValue:
                                                this.onSubtitleUrlFoundCallback,
                                        }
                                    );
                                }
                            } else if (response && !response.success) {
                                // Enhanced error logging for debugging official translation functionality
                                this.logger.error(
                                    'Netflix background failed to process VTT',
                                    null,
                                    {
                                        error: response.error,
                                        videoId: this.currentVideoId,
                                        useOfficialSubtitles,
                                        targetLanguage,
                                        originalLanguage,
                                        trackCount: timedtexttracks.length,
                                    }
                                );

                                // Log specific error details for official subtitle failures
                                if (useOfficialSubtitles && response.error) {
                                    if (
                                        response.error.includes(
                                            'No downloadable subtitle tracks'
                                        )
                                    ) {
                                        this.logger.warn(
                                            'Netflix official subtitles not available for this content',
                                            {
                                                targetLanguage,
                                                originalLanguage,
                                                suggestion:
                                                    'Try using translation API mode instead',
                                            }
                                        );
                                    } else if (
                                        response.error.includes(
                                            'No suitable Netflix subtitle language'
                                        )
                                    ) {
                                        this.logger.warn(
                                            'Netflix requested languages not found in available tracks',
                                            {
                                                targetLanguage,
                                                originalLanguage,
                                                availableTrackCount:
                                                    timedtexttracks.length,
                                            }
                                        );
                                    }
                                }

                                delete this.lastKnownVttUrlForVideoId[
                                    this.currentVideoId
                                ];
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
                                // Generic failure path
                                this.logger.error(
                                    'No/invalid response from background for Netflix fetchVTT',
                                    {
                                        videoId: this.currentVideoId,
                                    }
                                );
                                delete this.lastKnownVttUrlForVideoId[
                                    this.currentVideoId
                                ];
                            }
                        })
                        .catch((_error) => {
                            // Fallback to legacy callback-based messaging to satisfy tests and environments without web-accessible module
                            chrome.runtime.sendMessage(
                                {
                                    action: 'fetchVTT',
                                    data: { tracks: timedtexttracks },
                                    videoId: this.currentVideoId,
                                    targetLanguage: targetLanguage,
                                    originalLanguage: originalLanguage,
                                    useNativeSubtitles: useOfficialSubtitles,
                                    useOfficialTranslations:
                                        useOfficialSubtitles,
                                    source: 'netflix',
                                },
                                (response) => {
                                    if (chrome.runtime.lastError) {
                                        this.logger.error(
                                            'Error for VTT fetch',
                                            chrome.runtime.lastError,
                                            {
                                                videoId: this.currentVideoId,
                                            }
                                        );
                                        delete this.lastKnownVttUrlForVideoId[
                                            this.currentVideoId
                                        ];
                                        return;
                                    }
                                    // Reuse same response handling as above
                                    if (
                                        response &&
                                        response.success &&
                                        response.videoId === this.currentVideoId
                                    ) {
                                        this.logger.info(
                                            'Netflix VTT processed successfully',
                                            {
                                                videoId: this.currentVideoId,
                                                sourceLanguage:
                                                    response.sourceLanguage,
                                                targetLanguage:
                                                    response.targetLanguage,
                                                useNativeTarget:
                                                    response.useNativeTarget,
                                                hasTargetVtt:
                                                    !!response.targetVttText,
                                                availableLanguagesCount:
                                                    response.availableLanguages
                                                        ?.length || 0,
                                            }
                                        );
                                        if (this.onSubtitleUrlFoundCallback) {
                                            const subtitleData = {
                                                vttText: response.vttText,
                                                targetVttText:
                                                    response.targetVttText,
                                                videoId: response.videoId,
                                                url: response.url,
                                                sourceLanguage:
                                                    response.sourceLanguage,
                                                targetLanguage:
                                                    response.targetLanguage,
                                                useNativeTarget:
                                                    response.useNativeTarget ||
                                                    false,
                                                availableLanguages:
                                                    response.availableLanguages,
                                                selectedLanguage: {
                                                    displayName:
                                                        response.sourceLanguage,
                                                    normalizedCode:
                                                        response.sourceLanguage,
                                                },
                                            };
                                            this.onSubtitleUrlFoundCallback(
                                                subtitleData
                                            );
                                        }
                                    } else if (response && !response.success) {
                                        this.logger.error(
                                            'Netflix background failed to process VTT',
                                            null,
                                            {
                                                error: response.error,
                                                videoId: this.currentVideoId,
                                                useOfficialSubtitles,
                                                targetLanguage,
                                                originalLanguage,
                                                trackCount:
                                                    timedtexttracks.length,
                                            }
                                        );
                                        delete this.lastKnownVttUrlForVideoId[
                                            this.currentVideoId
                                        ];
                                    } else if (
                                        response &&
                                        response.videoId !== this.currentVideoId
                                    ) {
                                        this.logger.warn(
                                            'Received VTT for different video context - discarding',
                                            {
                                                receivedVideoId:
                                                    response.videoId,
                                                currentVideoId:
                                                    this.currentVideoId,
                                            }
                                        );
                                    } else {
                                        this.logger.error(
                                            'No/invalid response from background for Netflix fetchVTT',
                                            {
                                                videoId: this.currentVideoId,
                                            }
                                        );
                                        delete this.lastKnownVttUrlForVideoId[
                                            this.currentVideoId
                                        ];
                                    }
                                }
                            );
                        });
                });
        }
    }

    /**
     * Called by content script when URL changes (SPA navigation). If we buffered
     * subtitle data for the new movieId, process it now.
     * @param {string} newUrl
     */
    onUrlChange(newUrl) {
        try {
            const urlMovieId = this.extractMovieIdFromUrl();
            if (!urlMovieId) return;

            const bufferedTracks = this.preloadedSubtitleBuffer[urlMovieId];
            if (
                bufferedTracks &&
                Array.isArray(bufferedTracks) &&
                bufferedTracks.length > 0
            ) {
                this.logger.info(
                    'Processing buffered preloaded subtitles after navigation',
                    {
                        movieId: urlMovieId,
                        trackCount: bufferedTracks.length,
                    }
                );
                // Clear buffer for this id before processing to avoid loops
                delete this.preloadedSubtitleBuffer[urlMovieId];
                // Reuse the same handler path as real-time events
                this.handleInjectorEvents({
                    detail: {
                        type: 'SUBTITLE_DATA_FOUND',
                        payload: {
                            movieId: urlMovieId,
                            timedtexttracks: bufferedTracks,
                        },
                    },
                });
            }
        } catch (e) {
            this.logger.warn('onUrlChange processing failed', {
                error: e.message,
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
            // Netflix URLs are typically in the format: https://www.netflix.com/watch/MOVIEID or similar
            const path = window.location.pathname;
            const match = path.match(/\/watch\/(\d+)/);
            if (match && match[1]) {
                const extractedId = match[1];
                this.logger.debug('Extracted movieId from URL', {
                    extractedId: extractedId,
                    url: window.location.href,
                });
                return extractedId;
            }

            this.logger.warn('Could not extract movieId from URL', {
                url: window.location.href,
                pathname: path,
            });
            return null;
        } catch (error) {
            this.logger.error('Error extracting movieId from URL', error, {
                url: window.location.href,
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
                console.warn(
                    '[NetflixPlatform] document.head not available, cannot inject CSS'
                );
                return;
            }

            try {
                styleElement = document.createElement('style');
                styleElement.id = cssId;
                document.head.appendChild(styleElement);
            } catch (error) {
                console.error('[NetflixPlatform] Failed to inject CSS:', error);
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
        // Disconnect any existing observer
        if (this.subtitleObserver) {
            this.subtitleObserver.disconnect();
        }

        // Validate that document.body exists before setting up observer
        if (!document.body || !(document.body instanceof Node)) {
            console.warn(
                '[NetflixPlatform] document.body not available, retrying in 100ms'
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
                '[NetflixPlatform] Subtitle mutation observer set up successfully'
            );
        } catch (error) {
            console.error(
                '[NetflixPlatform] Failed to set up subtitle mutation observer:',
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

        const netflixSubtitleSelectors = [
            '.player-timedtext',
            '.player-timedtext-text-container',
            '[data-uia="player-timedtext-text-container"]',
            '.watch-video--bottom-controls-container .timedtext-text-container',
        ];

        if (hideOfficialSubtitles) {
            this.hideOfficialSubtitleContainers(netflixSubtitleSelectors);
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

        // Clean up storage listener for subtitle settings
        this.cleanupNativeSubtitleSettingsListener();

        // Clean up mutation observer
        if (this.subtitleObserver) {
            this.subtitleObserver.disconnect();
            this.subtitleObserver = null;
            this.logger.debug('Subtitle mutation observer cleaned up');
        }

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
        this.currentVideoId = null;
        this.onSubtitleUrlFoundCallback = null;
        this.onVideoIdChangeCallback = null;
        this.lastKnownVttUrlForVideoId = {};
        this.preloadedSubtitleBuffer = Object.create(null);
        this.logger.info('Platform cleaned up successfully');
    }
}
