/**
 * @typedef {Object} SubtitleCue
 * @property {string} original - The original subtitle text.
 * @property {string | null} translated - The translated subtitle text.
 * @property {number} start - Start time of the cue in seconds.
 * @property {number} end - End time of the cue in seconds.
 * @property {string} videoId - The ID of the video this cue belongs to.
 */

/**
 * @typedef {Object} SubtitleData
 * @property {string} vttText - The VTT content as a string.
 * @property {string} videoId - The ID of the video this VTT content belongs to.
 * @property {string} url - The URL from which the VTT was fetched/derived.
 */

/**
 * @interface VideoPlatform
 * Defines the contract for platform-specific subtitle handling.
 */
export class VideoPlatform {
    /**
     * Checks if the current page is relevant to this platform.
     * @abstract
     * @returns {boolean} True if the platform is active, false otherwise.
     */
    isPlatformActive() {
        throw new Error("Method 'isPlatformActive()' must be implemented.");
    }

    /**
     * Initializes the platform-specific logic, sets up observers, etc.
     * @abstract
     * @param {function(SubtitleData): void} onSubtitleUrlFound - Callback to be invoked when a subtitle URL/data is found.
     *                                                            The callback expects an object { vttText, videoId, url }.
     * @param {function(string): void} onVideoIdChange - Callback for when the video ID changes.
     * @returns {Promise<void>}
     */
    async initialize(onSubtitleUrlFound, onVideoIdChange) {
        throw new Error("Method 'initialize()' must be implemented.");
    }

    /**
     * Gets the main video HTML element.
     * @abstract
     * @returns {HTMLVideoElement | null} The video element or null if not found.
     */
    getVideoElement() {
        throw new Error("Method 'getVideoElement()' must be implemented.");
    }

    /**
     * Gets a unique identifier for the current video.
     * This ID is used to associate subtitles with a specific video.
     * @abstract
     * @returns {string | null} The video ID or null if not determinable.
     */
    getCurrentVideoId() {
        throw new Error("Method 'getCurrentVideoId()' must be implemented.");
    }
    
    /**
     * Gets the element that serves as the container for the video player,
     * to which the subtitle display elements will be appended.
     * @abstract
     * @returns {HTMLElement | null} The player container element or null.
     */
    getPlayerContainerElement() {
        throw new Error("Method 'getPlayerContainerElement()' must be implemented.");
    }

    /**
     * Optional: Checks if the current page is the main video player page for this platform.
     * This helps differentiate from pages with previews or other non-primary video content.
     * @abstract
     * @returns {boolean} True if the current page is the main player page, false otherwise.
     */
    isPlayerPageActive() {
        // Default implementation can return true if isPlatformActive() is true,
        // or a more specific check can be implemented by the platform.
        // Forcing platform to implement this for clarity if they have such distinction
        throw new Error("Method 'isPlayerPageActive()' must be implemented.");
    }

    /**
     * Optional: Gets the progress bar element if the platform uses a specific
     * element for tracking progress that is more reliable than video.currentTime.
     * @abstract
     * @returns {HTMLElement | null} The progress bar element or null.
     */
    getProgressBarElement() {
        // This method is optional as not all platforms might have/need this.
        // Default implementation can return null.
        return null;
    }

    /**
     * Optional: Defines how the platform's native subtitles should be handled.
     * For example, they might need to be hidden or observed.
     * @abstract
     */
    handleNativeSubtitles() {
        // Optional: Implement if native subtitles need special handling.
    }

    /**
     * Optional: Whether this platform supports/needs progress bar tracking for accurate time.
     * Some platforms have reliable HTML5 video.currentTime, while others need progress bar tracking
     * for better accuracy during seeking operations.
     * @returns {boolean} True if progress bar tracking should be used, false to rely on HTML5 video currentTime
     */
    supportsProgressBarTracking() {
        // Default: use progress bar tracking for better accuracy during seeking
        return true;
    }

    /**
     * Cleans up any event listeners, observers, or other resources
     * used by the platform implementation. Called when the platform is no longer active
     * or the extension is disabled.
     * @abstract
     */
    cleanup() {
        throw new Error("Method 'cleanup()' must be implemented.");
    }
} 