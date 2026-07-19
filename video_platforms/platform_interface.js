import Logger from '../utils/logger.js';
import { configService } from '../services/configService.js';

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
    constructor() {
        this.logger = Logger.create('VideoPlatform');
        this.unsubscribeFromChanges = null;
        // Cache for frequently-read settings to avoid repetitive storage calls
        this._hideOfficialSubtitles = undefined;
        this._lifecycleGeneration = 0;
        this._activeLifecycleGeneration = 0;
        this._platformLifecycleStarted = false;
        this._nativeSubtitleSettingsGeneration = 0;
        this._activeNativeSubtitleSettingsGeneration = null;
        this._nativeSubtitleSettingOperationGeneration = 0;
    }

    _beginPlatformLifecycle() {
        const generation = ++this._lifecycleGeneration;
        this._activeLifecycleGeneration = generation;
        this._platformLifecycleStarted = true;
        return generation;
    }

    _invalidatePlatformLifecycle() {
        this._activeLifecycleGeneration = null;
        this._platformLifecycleStarted = false;
        this._lifecycleGeneration += 1;
    }

    _isPlatformLifecycleCurrent(generation) {
        return (
            this._activeLifecycleGeneration === generation &&
            this._lifecycleGeneration === generation
        );
    }

    _logBestEffort(level, ...args) {
        try {
            const log = this.logger?.[level];
            if (typeof log === 'function') {
                log.call(this.logger, ...args);
            }
        } catch {
            // Telemetry must never alter subtitle behavior or ownership.
        }
    }
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
     * @param {function(SubtitleData): void} _onSubtitleUrlFound - Callback to be invoked when a subtitle URL/data is found.
     *                                                            The callback expects an object { vttText, videoId, url }.
     * @param {function(string): void} _onVideoIdChange - Callback for when the video ID changes.
     * @returns {Promise<void>}
     */
    async initialize(_onSubtitleUrlFound, _onVideoIdChange) {
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
     * Gets the platform playback time in subtitle-timeline seconds.
     * Platforms with non-standard media clocks can override this while keeping
     * the active HTML video element as the primary clock source.
     * @param {HTMLVideoElement | null} [preferredVideoElement=null] The video element that emitted the playback event.
     * @returns {number | null} A finite playback time, or null when unavailable.
     */
    getPlaybackTime(preferredVideoElement = null) {
        const videoElement = preferredVideoElement || this.getVideoElement();
        const currentTime = videoElement?.currentTime;
        return Number.isFinite(currentTime) ? currentTime : null;
    }

    /**
     * Optional: Invalidates platform-specific clock calibration after a seek.
     */
    invalidatePlaybackClockCalibration() {}

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
     * Proves that the adapter has already adopted the player identity in a
     * newly observed SPA route. The default is fail-closed so navigation can
     * safely retire stale playback state for adapters without this proof.
     * @param {string} _url The newly observed player URL.
     * @returns {boolean} True only when the route matches current adapter state.
     */
    hasAdoptedPlayerRoute(_url) {
        return false;
    }

    /**
     * Declares whether the content script may call HTMLMediaElement.pause()
     * after a platform playback action fails. Platforms whose controller owns
     * playback state must override this and return false so controller and
     * media state cannot diverge.
     * @returns {boolean} True when a raw media-element fallback is safe.
     */
    allowsDirectMediaPlaybackFallback() {
        return true;
    }

    /**
     * Gets the element that serves as the container for the video player,
     * to which the subtitle display elements will be appended.
     * @abstract
     * @returns {HTMLElement | null} The player container element or null.
     */
    getPlayerContainerElement() {
        throw new Error(
            "Method 'getPlayerContainerElement()' must be implemented."
        );
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
     * Optional: Gets a progress bar element for platforms that need UI-derived
     * timing data or clock calibration.
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
     * Utility method: Hide official subtitles based on platform-specific selectors
     * @param {string[]} selectors - Array of CSS selectors for subtitle containers
     */
    hideOfficialSubtitleContainers(selectors) {
        selectors.forEach((selector) => {
            const containers = document.querySelectorAll(selector);
            containers.forEach((container) => {
                container.style.display = 'none';
                container.style.visibility = 'hidden';
                container.style.opacity = '0';
                container.setAttribute('data-dualsub-hidden', 'true');
            });
        });
    }

    /**
     * Utility method: Show previously hidden official subtitles
     */
    showOfficialSubtitleContainers() {
        const hiddenContainers = document.querySelectorAll(
            '[data-dualsub-hidden="true"]'
        );
        let restoredContainerCount = 0;
        hiddenContainers.forEach((container) => {
            container.style.display = '';
            container.style.visibility = '';
            container.style.opacity = '';
            container.removeAttribute('data-dualsub-hidden');
            restoredContainerCount += 1;
        });
        this._logBestEffort('debug', 'Restored official subtitle containers', {
            restoredContainerCount,
            restoredAny: restoredContainerCount > 0,
        });
    }

    /**
     * Utility method: Handle native subtitles based on user setting
     * @param {string[]} selectors - Array of CSS selectors for subtitle containers
     */
    async handleNativeSubtitlesWithSetting(
        selectors,
        additionalCurrentnessCheck = null
    ) {
        const lifecycleGeneration = this._lifecycleGeneration;
        const nativeSettingsGeneration =
            this._activeNativeSubtitleSettingsGeneration;
        const operationGeneration = ++this
            ._nativeSubtitleSettingOperationGeneration;
        const isCurrent = () =>
            this._isPlatformLifecycleCurrent(lifecycleGeneration) &&
            (nativeSettingsGeneration === null ||
                this._activeNativeSubtitleSettingsGeneration ===
                    nativeSettingsGeneration) &&
            this._nativeSubtitleSettingOperationGeneration ===
                operationGeneration &&
            (typeof additionalCurrentnessCheck !== 'function' ||
                additionalCurrentnessCheck());

        if (!isCurrent()) return;

        // Use cached value when available to avoid repeated storage reads
        let hideOfficialSubtitles = this._hideOfficialSubtitles;
        if (hideOfficialSubtitles === undefined) {
            try {
                hideOfficialSubtitles = await configService.get(
                    'hideOfficialSubtitles'
                );
                if (!isCurrent()) return;
                this._hideOfficialSubtitles = !!hideOfficialSubtitles;
            } catch (_) {
                if (!isCurrent()) return;
                hideOfficialSubtitles = false;
            }
        }

        if (!isCurrent()) return;

        if (hideOfficialSubtitles) {
            this.hideOfficialSubtitleContainers(selectors);
        } else {
            this.showOfficialSubtitleContainers();
        }
    }

    /**
     * Utility method: Set up storage listener for settings changes
     * @param {string[]} selectors - Array of CSS selectors for subtitle containers
     */
    setupNativeSubtitleSettingsListener(selectors) {
        this.cleanupNativeSubtitleSettingsListener();

        const lifecycleGeneration = this._lifecycleGeneration;
        const nativeSettingsGeneration = ++this
            ._nativeSubtitleSettingsGeneration;
        this._activeNativeSubtitleSettingsGeneration = nativeSettingsGeneration;
        this.subtitleSelectors = selectors;

        const isCurrent = () =>
            this._isPlatformLifecycleCurrent(lifecycleGeneration) &&
            this._activeNativeSubtitleSettingsGeneration ===
                nativeSettingsGeneration;

        this.storageListener = (changes) => {
            if (!isCurrent()) return;
            if (changes.hideOfficialSubtitles !== undefined) {
                const newValue = changes.hideOfficialSubtitles;
                this._nativeSubtitleSettingOperationGeneration += 1;
                // Cache the latest value
                this._hideOfficialSubtitles = !!newValue;
                if (newValue) {
                    this.hideOfficialSubtitleContainers(this.subtitleSelectors);
                } else {
                    this.showOfficialSubtitleContainers();
                }
            }
        };

        // Use configService to listen for changes
        if (configService && configService.onChanged) {
            const unsubscribeFromChanges = configService.onChanged(
                this.storageListener
            );
            if (!isCurrent()) {
                if (typeof unsubscribeFromChanges === 'function') {
                    try {
                        unsubscribeFromChanges();
                    } catch (_) {}
                }
                return;
            }
            this.unsubscribeFromChanges = unsubscribeFromChanges;
            this._logBestEffort(
                'debug',
                'configService change listener added successfully'
            );
            // Warm up cache asynchronously without spamming logs
            (async () => {
                const operationGeneration = ++this
                    ._nativeSubtitleSettingOperationGeneration;
                try {
                    const v = await configService.get('hideOfficialSubtitles');
                    if (
                        !isCurrent() ||
                        this._nativeSubtitleSettingOperationGeneration !==
                            operationGeneration
                    ) {
                        return;
                    }
                    this._hideOfficialSubtitles = !!v;
                    if (v) {
                        this.hideOfficialSubtitleContainers(
                            this.subtitleSelectors
                        );
                    } else {
                        this.showOfficialSubtitleContainers();
                    }
                } catch (_) {}
            })();
        } else {
            this._logBestEffort(
                'warn',
                'configService.onChanged API not available, skipping listener setup'
            );
        }
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
     * Utility method: Clean up storage listener for subtitle settings
     */
    cleanupNativeSubtitleSettingsListener() {
        this._activeNativeSubtitleSettingsGeneration = null;
        this._nativeSubtitleSettingsGeneration += 1;
        this._nativeSubtitleSettingOperationGeneration += 1;
        this._hideOfficialSubtitles = undefined;

        this.showOfficialSubtitleContainers();

        const unsubscribeFromChanges = this.unsubscribeFromChanges;
        this.storageListener = null;
        this.subtitleSelectors = null;
        this.unsubscribeFromChanges = null;

        if (typeof unsubscribeFromChanges === 'function') {
            try {
                unsubscribeFromChanges();
                this._logBestEffort(
                    'debug',
                    'configService change listener removed successfully'
                );
            } catch (_) {
                this._logBestEffort(
                    'warn',
                    'configService change listener removal failed'
                );
            }
        }
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
