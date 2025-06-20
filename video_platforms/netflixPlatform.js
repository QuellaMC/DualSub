import { VideoPlatform } from './platform_interface.js';

// Define constants for the injected script and communication events
// It is crucial that these values match what you will use in 'netflixInject.js'
const INJECT_SCRIPT_FILENAME = 'injected_scripts/netflixInject.js';
const INJECT_SCRIPT_TAG_ID = 'netflix-dualsub-injector-script-tag';
const INJECT_EVENT_ID = 'netflix-dualsub-injector-event'; // Must match netflixInject.js

export class NetflixPlatform extends VideoPlatform {
    constructor() {
        super();
        this.currentVideoId = null;
        this.onSubtitleUrlFoundCallback = null;
        this.onVideoIdChangeCallback = null;
        this.lastKnownVttUrlForVideoId = {}; // To prevent reprocessing the same subtitle data
        this.eventListener = null; // To hold the bound event listener for later removal
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

        this.onSubtitleUrlFoundCallback = onSubtitleUrlFound;
        this.onVideoIdChangeCallback = onVideoIdChange;

        // The inject script should already be loaded by early injection in netflixContent.js
        // Just ensure our event listener is attached
        this.eventListener = this.handleInjectorEvents.bind(this);
        document.addEventListener(INJECT_EVENT_ID, this.eventListener);
        
        // Set up storage listener for subtitle settings
        const netflixSubtitleSelectors = [
            '.player-timedtext',
            '.watch-video--bottom-controls-container .timedtext-text-container',
            '.player-timedtext-text-container',
            '[data-uia="player-timedtext-text-container"]'
        ];
        this.setupNativeSubtitleSettingsListener(netflixSubtitleSelectors);
        
        console.log("NetflixPlatform: Initialized and event listener added.");
    }

    handleInjectorEvents(e) {
        const data = e.detail;
        if (!data || !data.type) return;

        if (data.type === 'INJECT_SCRIPT_READY') {
            console.log("NetflixPlatform: Inject script is ready.");
        } else if (data.type === 'SUBTITLE_DATA_FOUND') {
            console.log("NetflixPlatform: Raw subtitle data received:", data.payload);
            
            const { movieId, timedtexttracks } = data.payload;

            if (!movieId) {
                console.error("NetflixPlatform: SUBTITLE_DATA_FOUND event missing movieId.", data.payload);
                return;
            }
            
            if (!timedtexttracks) {
                console.error("NetflixPlatform: SUBTITLE_DATA_FOUND event missing timedtexttracks.", data.payload);
                return;
            }
            
            console.log(`NetflixPlatform: SUBTITLE_DATA_FOUND for movieId: '${movieId}'. Data type:`, typeof timedtexttracks, "Content:", timedtexttracks);
            
            // Extract movieId from current URL to ensure we only process subtitles for the current content
            const urlMovieId = this.extractMovieIdFromUrl();
            if (urlMovieId && String(movieId) !== String(urlMovieId)) {
                console.log(`NetflixPlatform: Ignoring subtitle data for movieId '${movieId}' (type: ${typeof movieId}) - doesn't match current URL movieId '${urlMovieId}' (type: ${typeof urlMovieId})`);
                return;
            }
            console.log(`NetflixPlatform: MovieId '${movieId}' matches URL movieId '${urlMovieId}' - processing subtitle data`);

            // Handle video ID change
            if (this.currentVideoId !== movieId) {
                console.log(`NetflixPlatform: Video context changing from '${this.currentVideoId || "null"}' to '${movieId}'.`);
                if (this.currentVideoId) {
                    delete this.lastKnownVttUrlForVideoId[this.currentVideoId];
                }
                this.currentVideoId = movieId;
                if (this.onVideoIdChangeCallback) {
                    this.onVideoIdChangeCallback(this.currentVideoId);
                }
            }

            // Check if timedtexttracks is an array and has content
            if (!Array.isArray(timedtexttracks) || timedtexttracks.length === 0) {
                console.warn("NetflixPlatform: No subtitle tracks available in timedtexttracks data.");
                return;
            }

            console.log(`NetflixPlatform: Found ${timedtexttracks.length} subtitle tracks for movieId: '${movieId}'.`);
            
            // Filter tracks first: exclude forced narrative tracks and None tracks
            const validTracks = timedtexttracks.filter(track => 
                !track.isNoneTrack && !track.isForcedNarrative
            );
            
            console.log(`NetflixPlatform: Filtered to ${validTracks.length} valid tracks (non-forced, non-None)`);
            
            if (validTracks.length === 0) {
                console.warn("NetflixPlatform: No valid subtitle tracks available after filtering.");
                return;
            }

            // Find the first track with downloadable content
            let primaryTrackUrl = null;
            for (const track of validTracks) {
                // Check both possible locations for downloadables
                let downloadables = null;
                
                // First check track.ttDownloadables (direct location)
                if (track.ttDownloadables && typeof track.ttDownloadables === 'object' && !Array.isArray(track.ttDownloadables)) {
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
                        if (formatData && Array.isArray(formatData.urls) && formatData.urls.length > 0) {
                            const urlObject = formatData.urls[0];
                            if (urlObject && typeof urlObject.url === 'string') {
                                 primaryTrackUrl = urlObject.url;
                                 break;
                            }
                        }
                    }
                    if (primaryTrackUrl) break;
                }
            }

            if (!primaryTrackUrl) {
                console.warn("NetflixPlatform: No downloadable subtitle URLs found in any track.");
                console.log("NetflixPlatform: Full tracks data for debugging:", JSON.stringify(timedtexttracks, null, 2));
                return;
            }

            if (this.lastKnownVttUrlForVideoId[this.currentVideoId] === primaryTrackUrl) {
                console.log(`NetflixPlatform: Subtitle data for videoId ${this.currentVideoId} already processed.`);
                return;
            }
            this.lastKnownVttUrlForVideoId[this.currentVideoId] = primaryTrackUrl;

            console.log("NetflixPlatform: Requesting VTT processing from background. Video ID:", this.currentVideoId);

            chrome.storage.sync.get(['targetLanguage', 'originalLanguage', 'useNativeSubtitles'], (settings) => {
                const { targetLanguage = 'zh-CN', originalLanguage = 'en', useNativeSubtitles = true } = settings; // Defaults from subtitleUtilities.js

                chrome.runtime.sendMessage({
                    action: "fetchVTT", // Re-using the same action as Disney+, background will need to handle Netflix data structure
                    data: { tracks: timedtexttracks }, // Pass the whole tracks object
                    videoId: this.currentVideoId,
                    targetLanguage: targetLanguage,
                    originalLanguage: originalLanguage,
                    useNativeSubtitles: useNativeSubtitles,
                    source: 'netflix' // Add a source identifier for the background script
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.error("NetflixPlatform: Error for VTT fetch:", chrome.runtime.lastError.message);
                        delete this.lastKnownVttUrlForVideoId[this.currentVideoId]; // Allow retry
                        return;
                    }
                    if (response && response.success && response.videoId === this.currentVideoId) {
                        console.log(`NetflixPlatform: VTT processed successfully for ${this.currentVideoId}.`);
                        if (this.onSubtitleUrlFoundCallback) {
                            // The callback expects a 'SubtitleData' object, as defined in subtitleUtilities.js
                            this.onSubtitleUrlFoundCallback({
                                vttText: response.vttText,
                                targetVttText: response.targetVttText,
                                videoId: response.videoId,
                                url: response.url, // URL of the original language subtitle file
                                sourceLanguage: response.sourceLanguage,
                                targetLanguage: response.targetLanguage,
                                useNativeTarget: response.useNativeTarget,
                                availableLanguages: response.availableLanguages,
                            });
                        }
                    } else if (response && !response.success) {
                        console.error("NetflixPlatform: Background failed to process VTT:", response.error);
                        delete this.lastKnownVttUrlForVideoId[this.currentVideoId];
                    } else if (response && response.videoId !== this.currentVideoId) {
                        console.warn(`NetflixPlatform: Received VTT for '${response.videoId}', but current context is '${this.currentVideoId}'. Discarding.`);
                    }
                });
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
                console.log(`NetflixPlatform: Extracted movieId '${extractedId}' from URL: ${window.location.href}`);
                return extractedId;
            }
            
            console.warn(`NetflixPlatform: Could not extract movieId from URL: ${window.location.href}`);
            return null;
        } catch (error) {
            console.error(`NetflixPlatform: Error extracting movieId from URL:`, error);
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
            '[data-uia="player-timedtext-text-container"]'
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
            styleElement = document.createElement('style');
            styleElement.id = cssId;
            document.head.appendChild(styleElement);
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
        
        // Set up mutation observer to catch dynamically created subtitle elements
        this.subtitleObserver = new MutationObserver((mutations) => {
            let foundNewSubtitles = false;
            
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            // Check if the added node or its children contain subtitle elements
                            if (node.classList?.contains('player-timedtext') || 
                                node.classList?.contains('player-timedtext-text-container') ||
                                node.querySelector?.('.player-timedtext, .player-timedtext-text-container')) {
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
            subtree: true
        });
    }

    applyCurrentSubtitleSetting() {
        chrome.storage.sync.get(['hideOfficialSubtitles'], (result) => {
            const hideOfficialSubtitles = result.hideOfficialSubtitles || false;
            
            const netflixSubtitleSelectors = [
                '.player-timedtext',
                '.player-timedtext-text-container',
                '[data-uia="player-timedtext-text-container"]',
                '.watch-video--bottom-controls-container .timedtext-text-container'
            ];
            
            if (hideOfficialSubtitles) {
                this.hideOfficialSubtitleContainers(netflixSubtitleSelectors);
            } else {
                this.showOfficialSubtitleContainers();
            }
        });
    }

    cleanup() {
        if (this.eventListener) {
            document.removeEventListener(INJECT_EVENT_ID, this.eventListener);
            this.eventListener = null;
            console.log("NetflixPlatform: Event listener removed.");
        }
        
        // Clean up storage listener for subtitle settings
        this.cleanupNativeSubtitleSettingsListener();
        
        // Clean up mutation observer
        if (this.subtitleObserver) {
            this.subtitleObserver.disconnect();
            this.subtitleObserver = null;
            console.log("NetflixPlatform: Subtitle mutation observer cleaned up.");
        }
        
        // Remove our custom CSS
        const cssElement = document.getElementById('dualsub-netflix-subtitle-hider');
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
        console.log("NetflixPlatform: Cleaned up.");
    }
}