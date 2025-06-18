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
        // To ensure our subtitles are not obstructed, we can try to hide Netflix's native subtitles.
        const nativeSubtitleContainers = [
            '.player-timedtext',
            '.watch-video--bottom-controls-container .timedtext-text-container',
            '.player-timedtext-text-container',
            '[data-uia="player-timedtext-text-container"]'
        ];
        
        nativeSubtitleContainers.forEach(selector => {
            const container = document.querySelector(selector);
            if (container) {
                container.style.display = 'none';
                console.log('NetflixPlatform: Hidden native subtitle container:', selector);
            }
        });
    }

    cleanup() {
        if (this.eventListener) {
            document.removeEventListener(INJECT_EVENT_ID, this.eventListener);
            this.eventListener = null;
            console.log("NetflixPlatform: Event listener removed.");
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