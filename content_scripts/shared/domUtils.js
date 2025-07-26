/**
 * DOMUtils - Shared DOM manipulation and video element detection utilities
 * 
 * This module provides robust DOM utilities for video element detection,
 * DOM manipulation helpers, and player ready detection with configurable
 * retry logic. These utilities are extracted from platform-specific
 * implementations to be shared across all platforms.
 * 
 * @author DualSub Extension
 * @version 1.0.0
 */

/**
 * VideoElementDetector - Detects and manages video elements on streaming platforms
 * 
 * This class provides comprehensive video element detection with multiple
 * strategies, retry logic, and platform-specific selectors.
 * 
 * @example
 * ```javascript
 * const detector = new VideoElementDetector('netflix', {
 *     selectors: ['video', '.video-player video'],
 *     maxRetries: 30,
 *     retryInterval: 1000,
 *     onVideoFound: (video) => console.log('Video found:', video),
 *     logger: myLogger
 * });
 * 
 * detector.startDetection();
 * ```
 */
export class VideoElementDetector {
    /**
     * Creates a new VideoElementDetector instance
     * @param {string} platform - Platform name (e.g., 'netflix', 'disneyplus')
     * @param {Object} options - Configuration options
     * @param {string[]} [options.selectors] - CSS selectors for video elements
     * @param {number} [options.maxRetries=30] - Maximum detection attempts
     * @param {number} [options.retryInterval=1000] - Interval between attempts in ms
     * @param {Function} [options.onVideoFound] - Callback when video is found
     * @param {Function} [options.onDetectionFailed] - Callback when detection fails
     * @param {Function} [options.logger] - Logger function
     */
    constructor(platform, options = {}) {
        this.platform = platform;
        this.options = {
            selectors: this._getDefaultSelectors(platform),
            maxRetries: 30,
            retryInterval: 1000,
            onVideoFound: null,
            onDetectionFailed: null,
            logger: null,
            ...options
        };

        // Detection state
        this.isDetecting = false;
        this.retryCount = 0;
        this.detectionInterval = null;
        this.currentVideo = null;

        // Bind methods
        this._detectVideo = this._detectVideo.bind(this);
    }

    /**
     * Start video element detection
     * @returns {Promise<HTMLVideoElement|null>} Promise that resolves with video element or null
     */
    async startDetection() {
        if (this.isDetecting) {
            this._log('warn', 'Video detection already in progress');
            return this.currentVideo;
        }

        this._log('info', 'Starting video element detection', {
            platform: this.platform,
            selectors: this.options.selectors,
            maxRetries: this.options.maxRetries
        });

        this.isDetecting = true;
        this.retryCount = 0;

        return new Promise((resolve) => {
            const attemptDetection = () => {
                const video = this._detectVideo();
                
                if (video) {
                    this._onVideoFound(video);
                    resolve(video);
                    return;
                }

                this.retryCount++;
                
                if (this.retryCount >= this.options.maxRetries) {
                    this._onDetectionFailed();
                    resolve(null);
                    return;
                }

                this._log('debug', 'Video not found, retrying', {
                    attempt: this.retryCount,
                    maxRetries: this.options.maxRetries
                });

                this.detectionInterval = setTimeout(attemptDetection, this.options.retryInterval);
            };

            attemptDetection();
        });
    }

    /**
     * Stop video element detection
     */
    stopDetection() {
        if (this.detectionInterval) {
            clearTimeout(this.detectionInterval);
            this.detectionInterval = null;
        }
        
        this.isDetecting = false;
        this._log('info', 'Video element detection stopped');
    }

    /**
     * Get the currently detected video element
     * @returns {HTMLVideoElement|null} Current video element or null
     */
    getCurrentVideo() {
        return this.currentVideo;
    }

    /**
     * Check if a video element is ready for subtitle processing
     * @param {HTMLVideoElement} video - Video element to check
     * @returns {boolean} Whether the video is ready
     */
    isVideoReady(video) {
        if (!video) return false;

        return (
            video.readyState >= HTMLMediaElement.HAVE_METADATA &&
            video.videoWidth > 0 &&
            video.videoHeight > 0 &&
            !video.paused
        );
    }

    /**
     * Wait for video element to be ready
     * @param {HTMLVideoElement} video - Video element to wait for
     * @param {number} [timeout=10000] - Timeout in milliseconds
     * @returns {Promise<boolean>} Promise that resolves when video is ready
     */
    async waitForVideoReady(video, timeout = 10000) {
        if (!video) return false;

        return new Promise((resolve) => {
            const startTime = Date.now();
            
            const checkReady = () => {
                if (this.isVideoReady(video)) {
                    this._log('info', 'Video is ready for subtitle processing');
                    resolve(true);
                    return;
                }

                if (Date.now() - startTime > timeout) {
                    this._log('warn', 'Video ready timeout exceeded', { timeout });
                    resolve(false);
                    return;
                }

                setTimeout(checkReady, 100);
            };

            checkReady();
        });
    }

    /**
     * Detect video element using configured selectors
     * @private
     * @returns {HTMLVideoElement|null} Found video element or null
     */
    _detectVideo() {
        for (const selector of this.options.selectors) {
            try {
                const videos = document.querySelectorAll(selector);
                
                for (const video of videos) {
                    if (this._isValidVideo(video)) {
                        this._log('debug', 'Video element found', {
                            selector,
                            videoSrc: video.src || 'no src',
                            readyState: video.readyState
                        });
                        return video;
                    }
                }
            } catch (error) {
                this._log('error', 'Error querying video selector', {
                    selector,
                    error: error.message
                });
            }
        }

        return null;
    }

    /**
     * Validate if a video element is suitable for subtitle processing
     * @private
     * @param {HTMLVideoElement} video - Video element to validate
     * @returns {boolean} Whether the video is valid
     */
    _isValidVideo(video) {
        if (!video || video.tagName !== 'VIDEO') return false;

        // Check if video has dimensions (not hidden)
        const rect = video.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;

        // Check if video is not a preview/thumbnail
        if (video.duration && video.duration < 10) return false;

        return true;
    }

    /**
     * Handle video found event
     * @private
     * @param {HTMLVideoElement} video - Found video element
     */
    _onVideoFound(video) {
        this.currentVideo = video;
        this.isDetecting = false;
        
        if (this.detectionInterval) {
            clearTimeout(this.detectionInterval);
            this.detectionInterval = null;
        }

        this._log('info', 'Video element detected successfully', {
            videoSrc: video.src || 'no src',
            readyState: video.readyState,
            dimensions: `${video.videoWidth}x${video.videoHeight}`
        });

        if (this.options.onVideoFound) {
            this.options.onVideoFound(video);
        }
    }

    /**
     * Handle detection failed event
     * @private
     */
    _onDetectionFailed() {
        this.isDetecting = false;
        
        if (this.detectionInterval) {
            clearTimeout(this.detectionInterval);
            this.detectionInterval = null;
        }

        this._log('error', 'Video element detection failed', {
            maxRetries: this.options.maxRetries,
            selectors: this.options.selectors
        });

        if (this.options.onDetectionFailed) {
            this.options.onDetectionFailed();
        }
    }

    /**
     * Get default selectors for a platform
     * @private
     * @param {string} platform - Platform name
     * @returns {string[]} Default selectors
     */
    _getDefaultSelectors(platform) {
        const defaultSelectors = {
            netflix: [
                'video',
                '.watch-video video',
                '.nfp-video-player video',
                '[data-uia="video-canvas"] video'
            ],
            disneyplus: [
                'video',
                '.btm-media-client-element video',
                '.video-player video',
                '[data-testid="video-player"] video'
            ]
        };

        return defaultSelectors[platform.toLowerCase()] || ['video'];
    }

    /**
     * Log messages with fallback
     * @private
     * @param {string} level - Log level
     * @param {string} message - Log message
     * @param {Object} [data] - Additional data
     */
    _log(level, message, data = {}) {
        if (this.options.logger) {
            this.options.logger(level, `[VideoElementDetector:${this.platform}] ${message}`, data);
        } else {
            console.log(`[VideoElementDetector:${this.platform}] [${level.toUpperCase()}] ${message}`, data);
        }
    }
}

/**
 * DOMManipulator - Provides DOM manipulation utilities for subtitle containers
 * 
 * This class handles creation, management, and cleanup of DOM elements
 * needed for subtitle display across different platforms.
 * 
 * @example
 * ```javascript
 * const manipulator = new DOMManipulator('netflix', {
 *     containerClass: 'dualsub-container',
 *     logger: myLogger
 * });
 * 
 * const container = manipulator.createSubtitleContainer(videoElement);
 * manipulator.injectCSS('.dualsub-subtitle { color: white; }');
 * ```
 */
export class DOMManipulator {
    /**
     * Creates a new DOMManipulator instance
     * @param {string} platform - Platform name
     * @param {Object} options - Configuration options
     * @param {string} [options.containerClass='dualsub-container'] - CSS class for subtitle containers
     * @param {string} [options.containerPrefix='dualsub'] - Prefix for generated IDs
     * @param {Function} [options.logger] - Logger function
     */
    constructor(platform, options = {}) {
        this.platform = platform;
        this.options = {
            containerClass: 'dualsub-container',
            containerPrefix: 'dualsub',
            logger: null,
            ...options
        };

        // Track created elements for cleanup
        this.createdElements = new Set();
        this.injectedStyles = new Set();
    }

    /**
     * Create a subtitle container element
     * @param {HTMLVideoElement} videoElement - Video element to attach container to
     * @param {Object} [options] - Container options
     * @param {string} [options.position='bottom'] - Container position ('top', 'bottom')
     * @param {string} [options.id] - Custom container ID
     * @returns {HTMLElement|null} Created container element
     */
    createSubtitleContainer(videoElement, options = {}) {
        if (!videoElement) {
            this._log('error', 'Cannot create subtitle container: video element is null');
            return null;
        }

        const {
            position = 'bottom',
            id = `${this.options.containerPrefix}-${position}-${Date.now()}`
        } = options;

        try {
            // Find or create parent container
            const parentContainer = this._findOrCreateParentContainer(videoElement);
            if (!parentContainer) {
                this._log('error', 'Could not find or create parent container');
                return null;
            }

            // Create subtitle container
            const container = document.createElement('div');
            container.id = id;
            container.className = `${this.options.containerClass} ${this.options.containerClass}--${position}`;
            
            // Set container styles
            this._applyContainerStyles(container, position);
            
            // Append to parent
            parentContainer.appendChild(container);
            
            // Track for cleanup
            this.createdElements.add(container);
            
            this._log('info', 'Subtitle container created', {
                id,
                position,
                parentContainer: parentContainer.tagName
            });

            return container;
        } catch (error) {
            this._log('error', 'Error creating subtitle container', {
                error: error.message,
                position
            });
            return null;
        }
    }

    /**
     * Remove a subtitle container
     * @param {HTMLElement|string} container - Container element or ID to remove
     * @returns {boolean} Whether removal was successful
     */
    removeSubtitleContainer(container) {
        try {
            const element = typeof container === 'string' 
                ? document.getElementById(container)
                : container;

            if (!element) {
                this._log('warn', 'Container not found for removal', { container });
                return false;
            }

            element.remove();
            this.createdElements.delete(element);
            
            this._log('info', 'Subtitle container removed', {
                id: element.id,
                className: element.className
            });

            return true;
        } catch (error) {
            this._log('error', 'Error removing subtitle container', {
                error: error.message,
                container
            });
            return false;
        }
    }

    /**
     * Inject CSS styles into the document
     * @param {string} css - CSS styles to inject
     * @param {string} [id] - Optional ID for the style element
     * @returns {HTMLStyleElement|null} Created style element
     */
    injectCSS(css, id = null) {
        try {
            const styleId = id || `${this.options.containerPrefix}-styles-${Date.now()}`;
            
            // Check if style already exists
            if (document.getElementById(styleId)) {
                this._log('debug', 'CSS already injected', { styleId });
                return document.getElementById(styleId);
            }

            const style = document.createElement('style');
            style.id = styleId;
            style.textContent = css;
            
            document.head.appendChild(style);
            this.injectedStyles.add(style);
            
            this._log('info', 'CSS injected successfully', {
                styleId,
                cssLength: css.length
            });

            return style;
        } catch (error) {
            this._log('error', 'Error injecting CSS', {
                error: error.message,
                cssLength: css?.length || 0
            });
            return null;
        }
    }

    /**
     * Find the best parent container for subtitle elements
     * @param {HTMLVideoElement} videoElement - Video element
     * @returns {HTMLElement|null} Parent container element
     */
    findSubtitleParent(videoElement) {
        if (!videoElement) return null;

        // Platform-specific parent selectors
        const parentSelectors = this._getParentSelectors();
        
        for (const selector of parentSelectors) {
            try {
                const parent = videoElement.closest(selector);
                if (parent) {
                    this._log('debug', 'Found subtitle parent', {
                        selector,
                        parentTag: parent.tagName,
                        parentClass: parent.className
                    });
                    return parent;
                }
            } catch (error) {
                this._log('debug', 'Error checking parent selector', {
                    selector,
                    error: error.message
                });
            }
        }

        // Fallback to video's parent
        return videoElement.parentElement;
    }

    /**
     * Clean up all created elements and styles
     */
    cleanup() {
        let cleanedCount = 0;

        // Remove created elements
        for (const element of this.createdElements) {
            try {
                if (element.parentNode) {
                    element.remove();
                    cleanedCount++;
                }
            } catch (error) {
                this._log('warn', 'Error removing element during cleanup', {
                    error: error.message,
                    elementId: element.id
                });
            }
        }
        this.createdElements.clear();

        // Remove injected styles
        for (const style of this.injectedStyles) {
            try {
                if (style.parentNode) {
                    style.remove();
                    cleanedCount++;
                }
            } catch (error) {
                this._log('warn', 'Error removing style during cleanup', {
                    error: error.message,
                    styleId: style.id
                });
            }
        }
        this.injectedStyles.clear();

        this._log('info', 'DOM cleanup completed', {
            elementsRemoved: cleanedCount
        });
    }

    /**
     * Find or create parent container for subtitles
     * @private
     * @param {HTMLVideoElement} videoElement - Video element
     * @returns {HTMLElement|null} Parent container
     */
    _findOrCreateParentContainer(videoElement) {
        // Try to find existing parent
        const existingParent = this.findSubtitleParent(videoElement);
        if (existingParent) return existingParent;

        // Create wrapper if needed
        const wrapper = document.createElement('div');
        wrapper.className = `${this.options.containerPrefix}-wrapper`;
        wrapper.style.position = 'relative';
        wrapper.style.display = 'inline-block';
        wrapper.style.width = '100%';
        wrapper.style.height = '100%';

        // Insert wrapper
        videoElement.parentNode.insertBefore(wrapper, videoElement);
        wrapper.appendChild(videoElement);

        this.createdElements.add(wrapper);
        return wrapper;
    }

    /**
     * Apply styles to subtitle container
     * @private
     * @param {HTMLElement} container - Container element
     * @param {string} position - Container position
     */
    _applyContainerStyles(container, position) {
        const baseStyles = {
            position: 'absolute',
            left: '0',
            right: '0',
            zIndex: '9999',
            pointerEvents: 'none',
            textAlign: 'center'
        };

        const positionStyles = {
            top: { top: '10px' },
            bottom: { bottom: '10px' }
        };

        const styles = { ...baseStyles, ...positionStyles[position] };
        
        Object.assign(container.style, styles);
    }

    /**
     * Get platform-specific parent selectors
     * @private
     * @returns {string[]} Parent selectors
     */
    _getParentSelectors() {
        const selectors = {
            netflix: [
                '.watch-video',
                '.nfp-video-player',
                '[data-uia="video-canvas"]',
                '.VideoContainer'
            ],
            disneyplus: [
                '.btm-media-client-element',
                '.video-player',
                '[data-testid="video-player"]',
                '.media-container'
            ]
        };

        return selectors[this.platform.toLowerCase()] || ['.video-container', '.player-container'];
    }

    /**
     * Log messages with fallback
     * @private
     * @param {string} level - Log level
     * @param {string} message - Log message
     * @param {Object} [data] - Additional data
     */
    _log(level, message, data = {}) {
        if (this.options.logger) {
            this.options.logger(level, `[DOMManipulator:${this.platform}] ${message}`, data);
        } else {
            console.log(`[DOMManipulator:${this.platform}] [${level.toUpperCase()}] ${message}`, data);
        }
    }
}

/**
 * PlayerReadyDetector - Detects when video player is ready for subtitle processing
 * 
 * This class provides robust player ready detection with multiple strategies
 * and configurable retry logic, ensuring subtitle systems initialize at the
 * optimal time.
 * 
 * @example
 * ```javascript
 * const detector = new PlayerReadyDetector('netflix', {
 *     maxRetries: 20,
 *     retryInterval: 500,
 *     onPlayerReady: () => console.log('Player is ready!'),
 *     logger: myLogger
 * });
 * 
 * detector.waitForPlayerReady();
 * ```
 */
export class PlayerReadyDetector {
    /**
     * Creates a new PlayerReadyDetector instance
     * @param {string} platform - Platform name
     * @param {Object} options - Configuration options
     * @param {number} [options.maxRetries=20] - Maximum detection attempts
     * @param {number} [options.retryInterval=500] - Interval between attempts in ms
     * @param {Function} [options.onPlayerReady] - Callback when player is ready
     * @param {Function} [options.onDetectionTimeout] - Callback when detection times out
     * @param {Function} [options.logger] - Logger function
     */
    constructor(platform, options = {}) {
        this.platform = platform;
        this.options = {
            maxRetries: 20,
            retryInterval: 500,
            onPlayerReady: null,
            onDetectionTimeout: null,
            logger: null,
            ...options
        };

        this.isDetecting = false;
        this.retryCount = 0;
    }

    /**
     * Wait for player to be ready
     * @returns {Promise<boolean>} Promise that resolves when player is ready
     */
    async waitForPlayerReady() {
        if (this.isDetecting) {
            this._log('warn', 'Player ready detection already in progress');
            return false;
        }

        this._log('info', 'Starting player ready detection', {
            platform: this.platform,
            maxRetries: this.options.maxRetries
        });

        this.isDetecting = true;
        this.retryCount = 0;

        return new Promise((resolve) => {
            const checkReady = () => {
                if (this._isPlayerReady()) {
                    this._onPlayerReady();
                    resolve(true);
                    return;
                }

                this.retryCount++;
                
                if (this.retryCount >= this.options.maxRetries) {
                    this._onDetectionTimeout();
                    resolve(false);
                    return;
                }

                this._log('debug', 'Player not ready, retrying', {
                    attempt: this.retryCount,
                    maxRetries: this.options.maxRetries
                });

                setTimeout(checkReady, this.options.retryInterval);
            };

            checkReady();
        });
    }

    /**
     * Check if player is ready using platform-specific logic
     * @private
     * @returns {boolean} Whether player is ready
     */
    _isPlayerReady() {
        // Check for video element
        const video = document.querySelector('video');
        if (!video) return false;

        // Check video readiness
        if (video.readyState < HTMLMediaElement.HAVE_METADATA) return false;

        // Platform-specific readiness checks
        return this._platformSpecificReadyCheck();
    }

    /**
     * Platform-specific readiness checks
     * @private
     * @returns {boolean} Whether platform-specific conditions are met
     */
    _platformSpecificReadyCheck() {
        switch (this.platform.toLowerCase()) {
            case 'netflix':
                return this._isNetflixReady();
            case 'disneyplus':
                return this._isDisneyPlusReady();
            default:
                return true; // Generic check passed
        }
    }

    /**
     * Netflix-specific readiness check
     * @private
     * @returns {boolean} Whether Netflix player is ready
     */
    _isNetflixReady() {
        // Check for Netflix player elements
        const playerContainer = document.querySelector('.watch-video, .nfp-video-player');
        if (!playerContainer) return false;

        // Check for subtitle track elements (indicates player is fully loaded)
        const subtitleElements = document.querySelectorAll('.player-timedtext, .timedtext');
        return subtitleElements.length > 0;
    }

    /**
     * Disney+ specific readiness check
     * @private
     * @returns {boolean} Whether Disney+ player is ready
     */
    _isDisneyPlusReady() {
        // Check for Disney+ player elements
        const playerContainer = document.querySelector('.btm-media-client-element, .video-player');
        if (!playerContainer) return false;

        // Check for control elements (indicates player is interactive)
        const controls = document.querySelector('.controls, .player-controls');
        return !!controls;
    }

    /**
     * Handle player ready event
     * @private
     */
    _onPlayerReady() {
        this.isDetecting = false;
        
        this._log('info', 'Player is ready for subtitle processing', {
            retryCount: this.retryCount
        });

        if (this.options.onPlayerReady) {
            this.options.onPlayerReady();
        }
    }

    /**
     * Handle detection timeout event
     * @private
     */
    _onDetectionTimeout() {
        this.isDetecting = false;
        
        this._log('warn', 'Player ready detection timed out', {
            maxRetries: this.options.maxRetries,
            totalTime: this.options.maxRetries * this.options.retryInterval
        });

        if (this.options.onDetectionTimeout) {
            this.options.onDetectionTimeout();
        }
    }

    /**
     * Log messages with fallback
     * @private
     * @param {string} level - Log level
     * @param {string} message - Log message
     * @param {Object} [data] - Additional data
     */
    _log(level, message, data = {}) {
        if (this.options.logger) {
            this.options.logger(level, `[PlayerReadyDetector:${this.platform}] ${message}`, data);
        } else {
            console.log(`[PlayerReadyDetector:${this.platform}] [${level.toUpperCase()}] ${message}`, data);
        }
    }
}

/**
 * Platform-specific DOM configurations
 */
export const PLATFORM_DOM_CONFIGS = {
    netflix: {
        videoSelectors: [
            'video',
            '.watch-video video',
            '.nfp-video-player video',
            '[data-uia="video-canvas"] video'
        ],
        parentSelectors: [
            '.watch-video',
            '.nfp-video-player',
            '[data-uia="video-canvas"]',
            '.VideoContainer'
        ],
        maxRetries: 40,
        retryInterval: 1000
    },
    
    disneyplus: {
        videoSelectors: [
            'video',
            '.btm-media-client-element video',
            '.video-player video',
            '[data-testid="video-player"] video'
        ],
        parentSelectors: [
            '.btm-media-client-element',
            '.video-player',
            '[data-testid="video-player"]',
            '.media-container'
        ],
        maxRetries: 30,
        retryInterval: 500
    }
};

/**
 * Create a pre-configured VideoElementDetector for a specific platform
 * @param {string} platform - Platform name
 * @param {Object} [customOptions] - Custom options to override defaults
 * @returns {VideoElementDetector} Configured video detector
 */
export function createPlatformVideoDetector(platform, customOptions = {}) {
    const platformConfig = PLATFORM_DOM_CONFIGS[platform.toLowerCase()] || {};
    const options = {
        selectors: platformConfig.videoSelectors,
        maxRetries: platformConfig.maxRetries,
        retryInterval: platformConfig.retryInterval,
        ...customOptions
    };
    
    return new VideoElementDetector(platform, options);
}

/**
 * Create a pre-configured DOMManipulator for a specific platform
 * @param {string} platform - Platform name
 * @param {Object} [customOptions] - Custom options to override defaults
 * @returns {DOMManipulator} Configured DOM manipulator
 */
export function createPlatformDOMManipulator(platform, customOptions = {}) {
    const options = {
        containerClass: `dualsub-${platform.toLowerCase()}-container`,
        containerPrefix: `dualsub-${platform.toLowerCase()}`,
        ...customOptions
    };
    
    return new DOMManipulator(platform, options);
}