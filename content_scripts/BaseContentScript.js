/**
 * BaseContentScript - Abstract base class for platform-specific content scripts
 * 
 * This class provides common functionality shared across all streaming platform
 * content scripts, including module loading, platform initialization, video element
 * detection, configuration management, Chrome message handling, and navigation detection.
 * 
 * Platform-specific content scripts should extend this class and implement the
 * abstract methods to provide platform-specific behavior.
 * 
 * @abstract
 * @author DualSub Extension
 * @version 1.0.0
 */

import { 
    EventBuffer, 
    IntervalManager, 
    analyzeConfigChanges, 
    injectScript,
    isExtensionContextValid,
    safeChromeApiCall
} from './contentScriptUtils.js';

export class BaseContentScript {
    /**
     * Creates a new BaseContentScript instance
     * @param {string} logPrefix - The log prefix for this content script (e.g., 'NetflixContent')
     */
    constructor(logPrefix) {
        if (new.target === BaseContentScript) {
            throw new Error('BaseContentScript is abstract and cannot be instantiated directly');
        }

        // Core properties
        this.logPrefix = logPrefix;
        this.contentLogger = null;
        this.activePlatform = null;
        this.currentConfig = {};
        
        // Module references (loaded dynamically)
        this.subtitleUtils = null;
        this.PlatformClass = null;
        this.configService = null;
        
        // Video detection state
        this.videoDetectionRetries = 0;
        this.videoDetectionIntervalId = null;
        this.maxVideoDetectionRetries = 30; // 30 seconds max
        this.videoDetectionInterval = 1000; // Check every 1 second
        
        // Event buffering for early subtitle data
        this.eventBuffer = new EventBuffer((msg, data) => this.logWithFallback('debug', msg, data));
        this.eventListenerAttached = false;
        this.platformReady = false;
        
        // Navigation detection state
        this.currentUrl = window.location.href;
        this.lastKnownPathname = window.location.pathname;
        
        // Interval management
        this.intervalManager = new IntervalManager();
        
        // DOM observer
        this.pageObserver = null;
        
        // Cleanup tracking
        this.isCleanedUp = false;
    }

    /**
     * Initialize fallback console logging until Logger is loaded
     * @param {string} level - Log level (error, warn, info, debug)
     * @param {string} message - Log message
     * @param {Object} data - Additional data to log
     */
    logWithFallback(level, message, data = {}) {
        if (this.contentLogger) {
            this.contentLogger[level](message, data);
        } else {
            console.log(
                `[${this.logPrefix}] [${level.toUpperCase()}] ${message}`,
                data
            );
        }
    }

    // ========================================
    // ABSTRACT METHODS - Must be implemented by subclasses
    // ========================================

    /**
     * Get the platform name (e.g., 'netflix', 'disneyplus')
     * @abstract
     * @returns {string} Platform name
     */
    getPlatformName() {
        throw new Error('getPlatformName() must be implemented by subclass');
    }

    /**
     * Get the platform class constructor
     * @abstract
     * @returns {Function} Platform class constructor
     */
    getPlatformClass() {
        throw new Error('getPlatformClass() must be implemented by subclass');
    }

    /**
     * Get the inject script configuration
     * @abstract
     * @returns {Object} Inject script configuration
     * @returns {string} returns.filename - Path to inject script
     * @returns {string} returns.tagId - DOM element ID for script tag
     * @returns {string} returns.eventId - Custom event ID for communication
     */
    getInjectScriptConfig() {
        throw new Error('getInjectScriptConfig() must be implemented by subclass');
    }

    /**
     * Setup platform-specific navigation detection
     * @abstract
     */
    setupNavigationDetection() {
        throw new Error('setupNavigationDetection() must be implemented by subclass');
    }

    /**
     * Check for URL changes (platform-specific implementation)
     * @abstract
     */
    checkForUrlChange() {
        throw new Error('checkForUrlChange() must be implemented by subclass');
    }

    /**
     * Handle platform-specific Chrome messages
     * @abstract
     * @param {Object} request - Chrome message request
     * @param {Function} sendResponse - Response callback
     * @returns {boolean} Whether response is handled asynchronously
     */
    handlePlatformSpecificMessage(request, sendResponse) { // eslint-disable-line no-unused-vars
        throw new Error('handlePlatformSpecificMessage() must be implemented by subclass');
    }

    // ========================================
    // TEMPLATE METHODS - Common initialization flow
    // ========================================

    /**
     * Main initialization method - template method pattern
     * Orchestrates the complete initialization flow
     */
    async initialize() {
        try {
            this.logWithFallback('info', 'Starting content script initialization');
            
            const success = await this.initializeCore() && 
                           await this.initializeConfiguration() &&
                           await this.initializeEventHandling() &&
                           await this.initializeObservers();

            if (!success) {
                this.logWithFallback('error', 'Initialization failed at one of the core steps');
                return false;
            }

            this.logWithFallback('info', 'Content script initialization completed successfully');
            return true;

        } catch (error) {
            this.logWithFallback('error', 'Error during initialization', { error });
            return false;
        }
    }

    /**
     * Initialize core modules and services
     * @returns {Promise<boolean>} Success status
     */
    async initializeCore() {
        const modulesLoaded = await this.loadModules();
        if (!modulesLoaded) {
            this.logWithFallback('error', 'Failed to load required modules');
            return false;
        }
        return true;
    }

    /**
     * Initialize configuration and listeners
     * @returns {Promise<boolean>} Success status
     */
    async initializeConfiguration() {
        this.currentConfig = await this.configService.getAll();
        this.logWithFallback('info', 'Loaded initial configuration', { 
            config: this.currentConfig 
        });
        this.setupConfigurationListeners();
        return true;
    }

    /**
     * Initialize event handling and platform
     * @returns {Promise<boolean>} Success status
     */
    async initializeEventHandling() {
        this.setupEarlyEventHandling();
        
        if (this.currentConfig.subtitlesEnabled) {
            await this.initializePlatform();
        }
        return true;
    }

    /**
     * Initialize observers and cleanup handlers
     * @returns {Promise<boolean>} Success status
     */
    async initializeObservers() {
        this.setupNavigationDetection();
        this.setupDOMObservation();
        this.setupCleanupHandlers();
        return true;
    }

    /**
     * Load required modules dynamically
     * @returns {Promise<boolean>} Success status
     */
    async loadModules() {
        try {
            // Load subtitle utilities
            const utilsModule = await import(
                chrome.runtime.getURL('content_scripts/subtitleUtilities.js')
            );
            this.subtitleUtils = utilsModule;

            // Load platform class
            const platformModule = await import(
                chrome.runtime.getURL(`video_platforms/${this.getPlatformName()}Platform.js`)
            );
            this.PlatformClass = platformModule[`${this.getPlatformName().charAt(0).toUpperCase() + this.getPlatformName().slice(1)}Platform`];

            // Load config service
            const configModule = await import(
                chrome.runtime.getURL('services/configService.js')
            );
            this.configService = configModule.configService;

            // Load and initialize logger
            const loggerModule = await import(
                chrome.runtime.getURL('utils/logger.js')
            );
            const Logger = loggerModule.default;

            // Initialize content script logger
            this.contentLogger = Logger.create(this.logPrefix);

            // Initialize logging level from configuration
            try {
                const loggingLevel = await this.configService.get('loggingLevel');
                this.contentLogger.updateLevel(loggingLevel);
                this.contentLogger.info('Content script logger initialized', {
                    level: loggingLevel,
                });
            } catch (error) {
                // Fallback to INFO level if config can't be read
                this.contentLogger.updateLevel(Logger.LEVELS.INFO);
                this.contentLogger.warn(
                    'Failed to load logging level from config, using INFO level',
                    error
                );
            }

            return true;
        } catch (error) {
            this.logWithFallback('error', 'Error loading modules', { error });
            return false;
        }
    }

    /**
     * Initialize the platform instance
     * @returns {Promise<void>}
     */
    async initializePlatform() {
        if (!this.PlatformClass || !this.subtitleUtils || !this.configService) {
            this.logWithFallback('error', 'Required modules not loaded for platform initialization');
            return;
        }

        try {
            // Sync subtitleUtils state with saved configuration
            if (this.subtitleUtils && typeof this.subtitleUtils.setSubtitlesActive === 'function') {
                this.subtitleUtils.setSubtitlesActive(this.currentConfig.subtitlesEnabled);
            }

            // Instantiate the platform
            this.activePlatform = new this.PlatformClass();

            if (this.activePlatform.isPlayerPageActive()) {
                this.logWithFallback('info', 'Initializing platform on player page');

                // Initialize the platform with callbacks
                await this.activePlatform.initialize(
                    (subtitleData) => this.handleSubtitleDataFound(subtitleData),
                    (newVideoId) => this.handleVideoIdChange(newVideoId)
                );

                // Handle native subtitles
                this.activePlatform.handleNativeSubtitles();

                // Mark platform as ready and process buffered events
                this.platformReady = true;
                this.processBufferedEvents();

                // Start video element detection
                this.startVideoElementDetection();

            } else {
                this.logWithFallback('info', 'Not on a player page. UI setup deferred');
                if (this.subtitleUtils && this.subtitleUtils.hideSubtitleContainer) {
                    this.subtitleUtils.hideSubtitleContainer();
                }
            }

        } catch (error) {
            this.logWithFallback('error', 'Error initializing platform', { error });
            this.activePlatform = null;
            this.platformReady = false;
        }
    }

    // ========================================
    // CONFIGURATION MANAGEMENT
    // ========================================

    /**
     * Setup configuration change listeners
     */
    setupConfigurationListeners() {
        this.configService.onChanged(async (changes) => {
            this.logWithFallback('info', 'Config changed, updating', { changes });
            const newConfig = await this.configService.getAll();

            // Update existing object properties while preserving the reference
            Object.keys(this.currentConfig).forEach((key) => delete this.currentConfig[key]);
            Object.assign(this.currentConfig, newConfig);

            // Apply configuration changes
            this.applyConfigurationChanges(changes);
        });
    }

    /**
     * Apply configuration changes with immediate visual feedback
     * @param {Object} changes - Configuration changes
     */
    applyConfigurationChanges(changes) {
        // Check if any changes affect subtitle functionality (exclude UI-only settings)
        const uiOnlySettings = ['appearanceAccordionOpen'];
        const functionalChanges = Object.keys(changes).filter(
            (key) => !uiOnlySettings.includes(key)
        );

        // Re-apply styles and trigger a subtitle re-render only if functional settings changed
        if (
            functionalChanges.length > 0 &&
            this.activePlatform &&
            this.subtitleUtils &&
            this.subtitleUtils.subtitlesActive
        ) {
            this.subtitleUtils.applySubtitleStyling(this.currentConfig);
            const videoElement = this.activePlatform.getVideoElement();
            if (videoElement) {
                this.subtitleUtils.updateSubtitles(
                    videoElement.currentTime,
                    this.activePlatform,
                    this.currentConfig,
                    this.logPrefix
                );
            }
        }
    }

    // ========================================
    // EVENT HANDLING AND BUFFERING
    // ========================================

    /**
     * Setup early event handling for subtitle data
     */
    setupEarlyEventHandling() {
        const config = this.getInjectScriptConfig();
        
        // Attach event listener immediately to catch early events
        if (!this.eventListenerAttached) {
            document.addEventListener(config.eventId, (e) => this.handleEarlyInjectorEvents(e));
            this.eventListenerAttached = true;
        }

        // Inject script early to catch subtitle data
        this.injectScriptEarly();
    }

    /**
     * Handle early injector events and buffer them until platform is ready
     * @param {Event} e - Custom event from injected script
     */
    handleEarlyInjectorEvents(e) {
        try {
            if (!e || !e.detail) {
                this.logWithFallback('warn', 'Received invalid event data');
                return;
            }

            const data = e.detail;
            if (!data || !data.type) {
                this.logWithFallback('warn', 'Event data missing required type field');
                return;
            }

            if (data.type === 'INJECT_SCRIPT_READY') {
                this.logWithFallback('info', 'Inject script is ready');
            } else if (data.type === 'SUBTITLE_DATA_FOUND') {
                this.eventBuffer.add(data);
            }

            // Process buffered events if platform is ready
            if (this.platformReady && this.activePlatform && this.eventBuffer.size() > 0) {
                this.processBufferedEvents();
            }
        } catch (error) {
            this.logWithFallback('error', 'Error handling early injector event', { error });
        }
    }

    /**
     * Process buffered events
     */
    processBufferedEvents() {
        this.eventBuffer.processAll((eventData) => {
            if (eventData.type === 'SUBTITLE_DATA_FOUND') {
                this.activePlatform.handleInjectorEvents({ detail: eventData });
            }
        });
    }

    /**
     * Inject script early to catch subtitle data
     */
    injectScriptEarly() {
        const config = this.getInjectScriptConfig();
        
        injectScript(
            chrome.runtime.getURL(config.filename),
            config.tagId,
            () => this.logWithFallback('info', 'Early inject script loaded successfully'),
            (error) => {
                this.logWithFallback('error', 'Failed to load early inject script!', { error });
                // Retry after a short delay
                setTimeout(() => this.injectScriptEarly(), 100);
            },
            (msg) => this.logWithFallback('debug', msg)
        );
    }

    // ========================================
    // SUBTITLE DATA HANDLING
    // ========================================

    /**
     * Handle subtitle data found callback
     * @param {Object} subtitleData - Subtitle data from platform
     */
    handleSubtitleDataFound(subtitleData) {
        if (this.subtitleUtils && this.subtitleUtils.handleSubtitleDataFound) {
            this.subtitleUtils.handleSubtitleDataFound(
                subtitleData,
                this.activePlatform,
                this.currentConfig,
                this.logPrefix
            );
        }
    }

    /**
     * Handle video ID change callback
     * @param {string} newVideoId - New video ID
     */
    handleVideoIdChange(newVideoId) {
        if (this.subtitleUtils) {
            if (this.subtitleUtils.handleVideoIdChange) {
                this.subtitleUtils.handleVideoIdChange(newVideoId, this.logPrefix);
            }
            if (this.subtitleUtils.setCurrentVideoId) {
                this.subtitleUtils.setCurrentVideoId(newVideoId);
            }
        }
    }

    // ========================================
    // VIDEO ELEMENT DETECTION
    // ========================================

    /**
     * Start video element detection with retry mechanism
     */
    startVideoElementDetection() {
        this.logWithFallback('info', 'Starting video element detection');
        this.videoDetectionRetries = 0;

        // Clear any existing detection interval
        if (this.videoDetectionIntervalId) {
            clearInterval(this.videoDetectionIntervalId);
            this.videoDetectionIntervalId = null;
        }

        // Try immediately first
        if (this.attemptVideoSetup()) {
            return; // Success, no need for interval
        }

        // Start retry mechanism
        this.videoDetectionIntervalId = setInterval(() => {
            this.videoDetectionRetries++;
            this.logWithFallback('debug', 'Video detection attempt', {
                attempt: this.videoDetectionRetries,
                maxAttempts: this.maxVideoDetectionRetries,
            });

            if (this.attemptVideoSetup()) {
                // Success! Clear the interval
                clearInterval(this.videoDetectionIntervalId);
                this.videoDetectionIntervalId = null;
                this.logWithFallback('info', 'Video element found and setup completed', {
                    attempts: this.videoDetectionRetries,
                });
            } else if (this.videoDetectionRetries >= this.maxVideoDetectionRetries) {
                // Give up after max retries
                clearInterval(this.videoDetectionIntervalId);
                this.videoDetectionIntervalId = null;
                this.logWithFallback(
                    'warn',
                    'Could not find video element after max attempts. Giving up',
                    {
                        maxAttempts: this.maxVideoDetectionRetries,
                    }
                );
            }
        }, this.videoDetectionInterval);
    }

    /**
     * Attempt to setup video element and subtitle container
     * @returns {boolean} Success status
     */
    attemptVideoSetup() {
        if (!this.activePlatform || !this.subtitleUtils || !this.currentConfig) {
            return false;
        }

        const videoElement = this.activePlatform.getVideoElement();
        if (!videoElement) {
            return false; // Video not ready yet
        }

        this.logWithFallback(
            'info',
            'Video element found! Setting up subtitle container and listeners'
        );
        this.logWithFallback('debug', 'Current subtitlesActive state', {
            subtitlesActive: this.subtitleUtils.subtitlesActive,
        });

        // Ensure container and timeupdate listener
        this.subtitleUtils.ensureSubtitleContainer(
            this.activePlatform,
            this.currentConfig,
            this.logPrefix
        );

        if (this.subtitleUtils.subtitlesActive) {
            this.logWithFallback(
                'info',
                'Subtitles are active, showing container and setting up listeners'
            );
            this.subtitleUtils.showSubtitleContainer();
            if (videoElement.currentTime > 0) {
                this.subtitleUtils.updateSubtitles(
                    videoElement.currentTime,
                    this.activePlatform,
                    this.currentConfig,
                    this.logPrefix
                );
            }
        } else {
            this.logWithFallback('info', 'Subtitles are not active, hiding container');
            this.subtitleUtils.hideSubtitleContainer();
        }

        return true; // Success
    }

    /**
     * Stop video element detection
     */
    stopVideoElementDetection() {
        if (this.videoDetectionIntervalId) {
            clearInterval(this.videoDetectionIntervalId);
            this.videoDetectionIntervalId = null;
            this.logWithFallback('info', 'Video element detection stopped');
        }
    }

    // ========================================
    // DOM OBSERVATION
    // ========================================

    /**
     * Setup DOM mutation observer for dynamic content changes
     */
    setupDOMObservation() {
        this.pageObserver = new MutationObserver((mutationsList) => {
            if (!this.subtitleUtils) return; // Utilities not loaded yet

            // Check for URL changes in case other detection methods missed it
            setTimeout(() => this.checkForUrlChange(), 100);

            if (!this.activePlatform && this.subtitleUtils.subtitlesActive) {
                this.logWithFallback(
                    'info',
                    'PageObserver detected DOM changes. Attempting to initialize platform'
                );
                this.initializePlatform();
                return;
            }

            if (!this.activePlatform) return;

            for (let mutation of mutationsList) {
                if (mutation.type === 'childList') {
                    const videoElementNow = this.activePlatform.getVideoElement();
                    const currentDOMVideoElement = document.querySelector(
                        'video[data-listener-attached="true"]'
                    );

                    if (
                        videoElementNow &&
                        (!currentDOMVideoElement ||
                            currentDOMVideoElement !== videoElementNow)
                    ) {
                        this.logWithFallback(
                            'debug',
                            'PageObserver detected video element appearance or change'
                        );
                        if (
                            this.subtitleUtils.subtitlesActive &&
                            this.platformReady &&
                            this.activePlatform
                        ) {
                            this.logWithFallback(
                                'debug',
                                'Platform is ready, re-ensuring container/listeners'
                            );
                            this.subtitleUtils.ensureSubtitleContainer(
                                this.activePlatform,
                                this.currentConfig,
                                this.logPrefix
                            );
                        }
                    } else if (currentDOMVideoElement && !videoElementNow) {
                        this.logWithFallback(
                            'debug',
                            'PageObserver detected video element removal'
                        );
                        this.subtitleUtils.hideSubtitleContainer();
                        if (this.subtitleUtils.clearSubtitleDOM) {
                            this.subtitleUtils.clearSubtitleDOM();
                        }
                    }
                }
            }
        });

        // Ensure document.body exists before observing
        if (document.body) {
            this.pageObserver.observe(document.body, { childList: true, subtree: true });
        } else {
            // Wait for body to be available
            const waitForBody = () => {
                if (document.body) {
                    this.pageObserver.observe(document.body, {
                        childList: true,
                        subtree: true,
                    });
                    this.logWithFallback(
                        'info',
                        'Page observer started after body became available'
                    );
                } else {
                    setTimeout(waitForBody, 100);
                }
            };
            waitForBody();
        }
    }

    // ========================================
    // CHROME MESSAGE HANDLING
    // ========================================

    /**
     * Setup Chrome message handler with common message types
     */
    setupChromeMessageHandler() {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            return this.handleChromeMessage(request, sender, sendResponse);
        });
    }

    /**
     * Handle Chrome messages with common functionality
     * @param {Object} request - Chrome message request
     * @param {Object} sender - Message sender
     * @param {Function} sendResponse - Response callback
     * @returns {boolean} Whether response is handled asynchronously
     */
    handleChromeMessage(request, sender, sendResponse) {
        // Handle logging level changes immediately, even if utilities aren't loaded
        if (request.type === 'LOGGING_LEVEL_CHANGED') {
            if (this.contentLogger) {
                this.contentLogger.updateLevel(request.level);
                this.contentLogger.info('Logging level updated from background script', {
                    newLevel: request.level,
                });
            } else {
                this.logWithFallback(
                    'info',
                    'Logging level change received but logger not initialized yet',
                    {
                        level: request.level,
                    }
                );
            }
            sendResponse({ success: true });
            return false;
        }

        if (!this.subtitleUtils || !this.configService) {
            this.logWithFallback(
                'error',
                'Utilities not loaded, cannot handle message',
                {
                    action: request.action || request.type,
                }
            );
            sendResponse({ success: false, error: 'Utilities not loaded' });
            return true;
        }

        switch (request.action) {
            case 'toggleSubtitles':
                return this.handleToggleSubtitles(request, sendResponse);

            case 'configChanged':
                return this.handleConfigChanged(request, sendResponse);

            default:
                // Delegate to platform-specific handler
                return this.handlePlatformSpecificMessage(request, sendResponse);
        }
    }

    /**
     * Handle toggle subtitles message
     * @param {Object} request - Message request
     * @param {Function} sendResponse - Response callback
     * @returns {boolean} Whether response is handled asynchronously
     */
    handleToggleSubtitles(request, sendResponse) {
        this.subtitleUtils.setSubtitlesActive(request.enabled);
        
        if (!request.enabled) {
            this.stopVideoElementDetection();
            this.subtitleUtils.hideSubtitleContainer();
            this.subtitleUtils.clearSubtitlesDisplayAndQueue(
                this.activePlatform,
                true,
                this.logPrefix
            );
            if (this.activePlatform) {
                this.activePlatform.cleanup();
            }
            this.activePlatform = null;
            this.platformReady = false;
            sendResponse({
                success: true,
                subtitlesEnabled: request.enabled,
            });
        } else {
            if (!this.activePlatform) {
                this.initializePlatform()
                    .then(() => {
                        sendResponse({
                            success: true,
                            subtitlesEnabled: request.enabled,
                        });
                    })
                    .catch((error) => {
                        this.logWithFallback(
                            'error',
                            'Error in platform initialization',
                            { error }
                        );
                        sendResponse({
                            success: false,
                            error: error.message,
                        });
                    });
                return true; // Async response
            } else if (this.activePlatform.isPlayerPageActive()) {
                this.startVideoElementDetection();
                sendResponse({
                    success: true,
                    subtitlesEnabled: request.enabled,
                });
            } else {
                sendResponse({
                    success: true,
                    subtitlesEnabled: request.enabled,
                    message: 'Not on player page',
                });
            }
        }
        return false;
    }

    /**
     * Handle config changed message
     * @param {Object} request - Message request
     * @param {Function} sendResponse - Response callback
     * @returns {boolean} Whether response is handled asynchronously
     */
    handleConfigChanged(request, sendResponse) {
        this.logWithFallback('info', 'Config change message received', {
            changes: request.changes,
        });
        // Configuration changes are handled by the onChanged listener
        sendResponse({ success: true });
        return false;
    }

    // ========================================
    // CLEANUP AND LIFECYCLE MANAGEMENT
    // ========================================

    /**
     * Setup cleanup handlers for proper resource disposal
     */
    setupCleanupHandlers() {
        // Setup Chrome message handler
        this.setupChromeMessageHandler();

        // Handle extension context invalidation
        window.addEventListener('beforeunload', () => {
            this.cleanup();
        });

        // Handle page visibility changes
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.logWithFallback('debug', 'Page hidden, pausing operations');
            } else {
                this.logWithFallback('debug', 'Page visible, resuming operations');
                // Re-check video setup when page becomes visible
                if (this.activePlatform && this.subtitleUtils && this.subtitleUtils.subtitlesActive) {
                    setTimeout(() => this.attemptVideoSetup(), 500);
                }
            }
        });
    }

    /**
     * Clean up all resources and event listeners
     */
    cleanup() {
        if (this.isCleanedUp) return;

        this.logWithFallback('info', 'Cleaning up content script resources');

        // Stop video detection
        this.stopVideoElementDetection();

        // Stop all managed intervals
        this.intervalManager.clearAll();

        // Disconnect DOM observer
        if (this.pageObserver) {
            this.pageObserver.disconnect();
            this.pageObserver = null;
        }

        // Clean up platform
        if (this.activePlatform) {
            this.activePlatform.cleanup();
            this.activePlatform = null;
        }

        // Clear subtitle utilities
        if (this.subtitleUtils && this.subtitleUtils.clearSubtitleDOM) {
            this.subtitleUtils.clearSubtitleDOM();
        }

        // Clear event buffer
        this.eventBuffer.clear();
        this.platformReady = false;

        this.isCleanedUp = true;
        this.logWithFallback('info', 'Content script cleanup completed');
    }

    // ========================================
    // VIDEO ELEMENT DETECTION
    // ========================================

    /**
     * Start video element detection with retry mechanism
     */
    startVideoElementDetection() {
        this.logWithFallback('info', 'Starting video element detection');
        this.videoDetectionRetries = 0;

        // Clear any existing detection interval
        if (this.videoDetectionIntervalId) {
            clearInterval(this.videoDetectionIntervalId);
            this.videoDetectionIntervalId = null;
        }

        // Try immediately first
        if (this.attemptVideoSetup()) {
            return; // Success, no need for interval
        }

        // Start retry mechanism
        this.videoDetectionIntervalId = setInterval(() => {
            this.videoDetectionRetries++;
            this.logWithFallback('debug', 'Video detection attempt', {
                attempt: this.videoDetectionRetries,
                maxAttempts: this.maxVideoDetectionRetries,
            });

            if (this.attemptVideoSetup()) {
                // Success! Clear the interval
                clearInterval(this.videoDetectionIntervalId);
                this.videoDetectionIntervalId = null;
                this.logWithFallback('info', 'Video element found and setup completed', {
                    attempts: this.videoDetectionRetries,
                });
            } else if (this.videoDetectionRetries >= this.maxVideoDetectionRetries) {
                // Give up after max retries
                clearInterval(this.videoDetectionIntervalId);
                this.videoDetectionIntervalId = null;
                this.logWithFallback(
                    'warn',
                    'Could not find video element after max attempts. Giving up',
                    {
                        maxAttempts: this.maxVideoDetectionRetries,
                    }
                );
            }
        }, this.videoDetectionInterval);
    }

    /**
     * Attempt to setup video element and subtitle container
     * @returns {boolean} Success status
     */
    attemptVideoSetup() {
        if (!this.activePlatform || !this.subtitleUtils || !this.currentConfig) {
            return false;
        }

        const videoElement = this.activePlatform.getVideoElement();
        if (!videoElement) {
            return false; // Video not ready yet
        }

        this.logWithFallback(
            'info',
            'Video element found! Setting up subtitle container and listeners'
        );
        this.logWithFallback('debug', 'Current subtitlesActive state', {
            subtitlesActive: this.subtitleUtils.subtitlesActive,
        });

        // Ensure container and timeupdate listener
        this.subtitleUtils.ensureSubtitleContainer(
            this.activePlatform,
            this.currentConfig,
            this.logPrefix
        );

        if (this.subtitleUtils.subtitlesActive) {
            this.logWithFallback(
                'info',
                'Subtitles are active, showing container and setting up listeners'
            );
            this.subtitleUtils.showSubtitleContainer();
            if (videoElement.currentTime > 0) {
                this.subtitleUtils.updateSubtitles(
                    videoElement.currentTime,
                    this.activePlatform,
                    this.currentConfig,
                    this.logPrefix
                );
            }
        } else {
            this.logWithFallback('info', 'Subtitles are not active, hiding container');
            this.subtitleUtils.hideSubtitleContainer();
        }

        return true; // Success
    }

    /**
     * Stop video element detection
     */
    stopVideoElementDetection() {
        if (this.videoDetectionIntervalId) {
            clearInterval(this.videoDetectionIntervalId);
            this.videoDetectionIntervalId = null;
            this.logWithFallback('info', 'Video element detection stopped');
        }
    }

    // ========================================
    // DOM OBSERVATION
    // ========================================

    /**
     * Setup DOM mutation observer for dynamic content changes
     */
    setupDOMObservation() {
        this.pageObserver = new MutationObserver((mutationsList) => {
            if (!this.subtitleUtils) return; // Utilities not loaded yet

            // Check for URL changes in case other detection methods missed it
            setTimeout(() => this.checkForUrlChange(), 100);

            if (!this.activePlatform && this.subtitleUtils.subtitlesActive) {
                this.logWithFallback(
                    'info',
                    'PageObserver detected DOM changes. Attempting to initialize platform'
                );
                this.initializePlatform();
                return;
            }

            if (!this.activePlatform) return;

            for (let mutation of mutationsList) {
                if (mutation.type === 'childList') {
                    const videoElementNow = this.activePlatform.getVideoElement();
                    const currentDOMVideoElement = document.querySelector(
                        'video[data-listener-attached="true"]'
                    );

                    if (
                        videoElementNow &&
                        (!currentDOMVideoElement ||
                            currentDOMVideoElement !== videoElementNow)
                    ) {
                        this.logWithFallback(
                            'debug',
                            'PageObserver detected video element appearance or change'
                        );
                        if (
                            this.subtitleUtils.subtitlesActive &&
                            this.platformReady &&
                            this.activePlatform
                        ) {
                            this.logWithFallback(
                                'debug',
                                'Platform is ready, re-ensuring container/listeners'
                            );
                            this.subtitleUtils.ensureSubtitleContainer(
                                this.activePlatform,
                                this.currentConfig,
                                this.logPrefix
                            );
                        }
                    } else if (currentDOMVideoElement && !videoElementNow) {
                        this.logWithFallback(
                            'debug',
                            'PageObserver detected video element removal'
                        );
                        this.subtitleUtils.hideSubtitleContainer();
                        if (this.subtitleUtils.clearSubtitleDOM) {
                            this.subtitleUtils.clearSubtitleDOM();
                        }
                    }
                }
            }
        });

        // Ensure document.body exists before observing
        if (document.body) {
            this.pageObserver.observe(document.body, { childList: true, subtree: true });
        } else {
            // Wait for body to be available
            const waitForBody = () => {
                if (document.body) {
                    this.pageObserver.observe(document.body, {
                        childList: true,
                        subtree: true,
                    });
                    this.logWithFallback(
                        'info',
                        'Page observer started after body became available'
                    );
                } else {
                    setTimeout(waitForBody, 100);
                }
            };
            waitForBody();
        }
    }

    // ========================================
    // CHROME MESSAGE HANDLING
    // ========================================

    /**
     * Setup Chrome message handler with common message types
     */
    setupChromeMessageHandler() {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            return this.handleChromeMessage(request, sender, sendResponse);
        });
    }

    /**
     * Handle Chrome messages with common functionality
     * @param {Object} request - Chrome message request
     * @param {Object} sender - Message sender
     * @param {Function} sendResponse - Response callback
     * @returns {boolean} Whether response is handled asynchronously
     */
    handleChromeMessage(request, sender, sendResponse) {
        // Handle logging level changes immediately, even if utilities aren't loaded
        if (request.type === 'LOGGING_LEVEL_CHANGED') {
            if (this.contentLogger) {
                this.contentLogger.updateLevel(request.level);
                this.contentLogger.info('Logging level updated from background script', {
                    newLevel: request.level,
                });
            } else {
                this.logWithFallback(
                    'info',
                    'Logging level change received but logger not initialized yet',
                    {
                        level: request.level,
                    }
                );
            }
            sendResponse({ success: true });
            return false;
        }

        if (!this.subtitleUtils || !this.configService) {
            this.logWithFallback(
                'error',
                'Utilities not loaded, cannot handle message',
                {
                    action: request.action || request.type,
                }
            );
            sendResponse({ success: false, error: 'Utilities not loaded' });
            return true;
        }

        switch (request.action) {
            case 'toggleSubtitles':
                return this.handleToggleSubtitles(request, sendResponse);

            case 'configChanged':
                return this.handleConfigChanged(request, sendResponse);

            default:
                // Delegate to platform-specific handler
                return this.handlePlatformSpecificMessage(request, sendResponse);
        }
    }

    /**
     * Handle toggle subtitles message
     * @param {Object} request - Message request
     * @param {Function} sendResponse - Response callback
     * @returns {boolean} Whether response is handled asynchronously
     */
    handleToggleSubtitles(request, sendResponse) {
        this.subtitleUtils.setSubtitlesActive(request.enabled);
        
        if (!request.enabled) {
            this.stopVideoElementDetection();
            this.subtitleUtils.hideSubtitleContainer();
            this.subtitleUtils.clearSubtitlesDisplayAndQueue(
                this.activePlatform,
                true,
                this.logPrefix
            );
            if (this.activePlatform) {
                this.activePlatform.cleanup();
            }
            this.activePlatform = null;
            this.platformReady = false;
            sendResponse({
                success: true,
                subtitlesEnabled: request.enabled,
            });
        } else {
            if (!this.activePlatform) {
                this.initializePlatform()
                    .then(() => {
                        sendResponse({
                            success: true,
                            subtitlesEnabled: request.enabled,
                        });
                    })
                    .catch((error) => {
                        this.logWithFallback(
                            'error',
                            'Error in platform initialization',
                            { error }
                        );
                        sendResponse({
                            success: false,
                            error: error.message,
                        });
                    });
                return true; // Async response
            } else if (this.activePlatform.isPlayerPageActive()) {
                this.startVideoElementDetection();
                sendResponse({
                    success: true,
                    subtitlesEnabled: request.enabled,
                });
            } else {
                sendResponse({
                    success: true,
                    subtitlesEnabled: request.enabled,
                });
            }
        }
        
        return false;
    }

    /**
     * Handle config changed message
     * @param {Object} request - Message request
     * @param {Function} sendResponse - Response callback
     * @returns {boolean} Whether response is handled asynchronously
     */
    handleConfigChanged(request, sendResponse) {
        if (
            request.changes &&
            this.activePlatform &&
            this.subtitleUtils.subtitlesActive
        ) {
            // Update local config with the changes for immediate effect
            Object.assign(this.currentConfig, request.changes);

            // Apply the changes immediately for instant visual feedback
            this.subtitleUtils.applySubtitleStyling(this.currentConfig);
            const videoElement = this.activePlatform.getVideoElement();
            if (videoElement) {
                this.subtitleUtils.updateSubtitles(
                    videoElement.currentTime,
                    this.activePlatform,
                    this.currentConfig,
                    this.logPrefix
                );
            }
            this.logWithFallback('info', 'Applied immediate config changes', {
                changes: request.changes,
            });
        }
        sendResponse({ success: true });
        return false;
    }

    // ========================================
    // CLEANUP AND MEMORY MANAGEMENT
    // ========================================

    /**
     * Setup cleanup handlers to prevent memory leaks
     */
    setupCleanupHandlers() {
        // Setup Chrome message handler
        this.setupChromeMessageHandler();

        // Listen for extension context invalidation
        chrome.runtime.onConnect.addListener((port) => {
            port.onDisconnect.addListener(() => {
                if (chrome.runtime.lastError) {
                    this.logWithFallback(
                        'info',
                        'Extension context invalidated, cleaning up'
                    );
                    this.cleanup();
                }
            });
        });

        // Handle page unload
        window.addEventListener('beforeunload', () => this.cleanup());
    }

}