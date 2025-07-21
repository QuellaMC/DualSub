/**
 * Content Script Utilities
 * 
 * Shared utility functions for content scripts including video detection,
 * event handling, configuration processing, and navigation helpers.
 * 
 * @author DualSub Extension
 * @version 1.0.0
 */

// Common constants used across content scripts
export const COMMON_CONSTANTS = {
    // Video detection
    MAX_VIDEO_DETECTION_RETRIES: 30,
    VIDEO_DETECTION_INTERVAL: 1000,

    // Progress bar detection settings
    MAX_FIND_PROGRESS_BAR_RETRIES: 20,
    FIND_PROGRESS_BAR_INTERVAL: 500,

    // Navigation detection
    URL_CHECK_INTERVAL: 2000,
    NAVIGATION_DELAY: 100,

    // Script injection
    INJECT_RETRY_DELAY: 100,
    MAX_INJECT_RETRIES: 3,

    // Initialization delays
    PLATFORM_INIT_DELAY: 1000,
    PLATFORM_INIT_MAX_RETRIES: 3,
    PLATFORM_INIT_RETRY_DELAY: 2000,
    PLATFORM_INIT_TIMEOUT: 10000,
    
    // Cleanup timeouts
    CLEANUP_TIMEOUT: 5000,
    REINIT_DELAY: 1500,

    // Platform initialization settings
    PLATFORM_INIT_MAX_RETRIES: 3,
    PLATFORM_INIT_RETRY_DELAY: 1000,
    PLATFORM_INIT_TIMEOUT: 10000,

    // Logging settings
    TIME_UPDATE_LOG_INTERVAL: 30,

    // Cleanup settings
    CLEANUP_TIMEOUT: 5000,

    // UI-only configuration settings
    UI_ONLY_SETTINGS: ['appearanceAccordionOpen'],

    // Event buffer settings
    EVENT_BUFFER_MAX_SIZE: 100,
    EVENT_BUFFER_MAX_AGE: 30000, // 30 seconds

    // Event types
    EVENT_TYPES: {
        INJECT_SCRIPT_READY: 'INJECT_SCRIPT_READY',
        SUBTITLE_DATA_FOUND: 'SUBTITLE_DATA_FOUND'
    }
};

/**
 * Platform configuration interface
 * @typedef {Object} PlatformConfig
 * @property {string} name - Platform name ('netflix' | 'disneyplus')
 * @property {Object} injectScript - Injection configuration
 * @property {string} injectScript.filename - Path to inject script
 * @property {string} injectScript.tagId - DOM element ID for script tag
 * @property {string} injectScript.eventId - Custom event ID for communication
 * @property {Object} navigation - Navigation configuration
 * @property {string[]} navigation.urlPatterns - URL patterns for platform detection
 * @property {boolean} navigation.spaHandling - Whether complex SPA handling is needed
 * @property {number} navigation.checkInterval - URL change check interval
 * @property {string} navigation.playerUrlPattern - URL pattern for player pages
 * @property {Object} videoDetection - Video detection configuration
 * @property {number} videoDetection.maxRetries - Max video detection attempts
 * @property {number} videoDetection.retryInterval - Retry interval in ms
 * @property {string} logPrefix - Log prefix for the platform
 */

/**
 * Message handler interface
 * @typedef {Object} MessageHandler
 * @property {string} action - Action name
 * @property {Function} handler - Handler function
 * @property {boolean} requiresUtilities - Whether utilities are required
 */

/**
 * Video detection helper - attempts to find video element with retry logic
 * @param {Function} getVideoElement - Function to get video element
 * @param {number} maxRetries - Maximum retry attempts
 * @param {number} retryInterval - Retry interval in milliseconds
 * @param {Function} onSuccess - Success callback
 * @param {Function} onFailure - Failure callback
 * @param {Function} logger - Logger function
 * @returns {number} Interval ID for cleanup
 */
export function startVideoDetection(
    getVideoElement,
    maxRetries = 30,
    retryInterval = 1000,
    onSuccess = () => { },
    onFailure = () => { },
    logger = console.log
) {
    // Input validation
    if (typeof getVideoElement !== 'function') {
        throw new TypeError('getVideoElement must be a function');
    }
    if (maxRetries < 1 || !Number.isInteger(maxRetries)) {
        throw new RangeError('maxRetries must be a positive integer');
    }
    if (retryInterval < 0 || !Number.isInteger(retryInterval)) {
        throw new RangeError('retryInterval must be a non-negative integer');
    }

    let retries = 0;

    // Try immediately first
    let videoElement;
    try {
        videoElement = getVideoElement();
    } catch (error) {
        logger('Error calling getVideoElement:', error);
        onFailure(error);
        return null;
    }

    if (videoElement) {
        onSuccess(videoElement);
        return null;
    }

    // Start retry mechanism
    const intervalId = setInterval(() => {
        retries++;
        logger(`Video detection attempt ${retries}/${maxRetries}`);

        const video = getVideoElement();
        if (video) {
            clearInterval(intervalId);
            logger(`Video element found after ${retries} attempts`);
            onSuccess(video);
        } else if (retries >= maxRetries) {
            clearInterval(intervalId);
            logger(`Video detection failed after ${maxRetries} attempts`);
            onFailure();
        }
    }, retryInterval);

    return intervalId;
}

/**
 * URL change detection helper
 * @param {string} currentUrl - Current URL to compare against
 * @param {Function} onUrlChange - Callback when URL changes
 * @param {Function} logger - Logger function
 * @returns {string} New URL if changed, null otherwise
 */
export function detectUrlChange(currentUrl, onUrlChange = () => { }, logger = console.log) {
    try {
        const newUrl = window.location.href;
        const newPathname = window.location.pathname;

        if (newUrl !== currentUrl) {
            logger(`URL changed from ${currentUrl} to ${newUrl}`);
            onUrlChange(newUrl, newPathname);
            return newUrl;
        }

        return null;
    } catch (urlError) {
        logger('Error in URL change detection', urlError);
        // If we get an extension context error, return special value to stop detection
        if (urlError.message && urlError.message.includes('Extension context invalidated')) {
            return 'CONTEXT_INVALIDATED';
        }
        return null;
    }
}

/**
 * Enhanced navigation detection setup for SPA applications
 * @param {Function} onNavigate - Callback for navigation events
 * @param {Object} options - Configuration options
 * @param {boolean} options.enableHistoryAPI - Enable history API interception
 * @param {boolean} options.enablePopstate - Enable popstate event listening
 * @param {boolean} options.enableHashChange - Enable hashchange event listening
 * @param {boolean} options.enableFocusCheck - Enable focus event checking
 * @param {number} options.intervalCheck - Interval for URL checking (0 to disable)
 * @param {Function} logger - Logger function
 * @returns {Function} Cleanup function
 */
export function setupNavigationDetection(
    onNavigate,
    options = {},
    logger = logWithFallback
) {
    const config = {
        enableHistoryAPI: true,
        enablePopstate: true,
        enableHashChange: true,
        enableFocusCheck: true,
        intervalCheck: COMMON_CONSTANTS.URL_CHECK_INTERVAL,
        ...options
    };

    const cleanupFunctions = [];
    let currentUrl = window.location.href;

    const handleNavigation = createNavigationHandler(currentUrl, onNavigate, logger, cleanupFunctions);

    // Setup different detection methods
    if (config.enableHistoryAPI) {
        setupHistoryAPIInterception(handleNavigation, cleanupFunctions);
    }

    if (config.enablePopstate) {
        setupPopstateDetection(handleNavigation, cleanupFunctions);
    }

    if (config.enableHashChange) {
        setupHashChangeDetection(handleNavigation, cleanupFunctions);
    }

    if (config.enableFocusCheck) {
        setupFocusDetection(handleNavigation, cleanupFunctions);
    }

    if (config.intervalCheck > 0) {
        setupIntervalDetection(config.intervalCheck, currentUrl, onNavigate, logger, cleanupFunctions);
    }

    const cleanup = createCleanupFunction(cleanupFunctions, logger);

    logger('info', 'Navigation detection setup completed', { config });
    return cleanup;
}

/**
 * Create navigation handler with context invalidation support
 * @private
 */
function createNavigationHandler(currentUrl, onNavigate, logger, cleanupFunctions) {
    return () => {
        setTimeout(() => {
            const newUrl = detectUrlChange(currentUrl, onNavigate, logger);
            if (newUrl && newUrl !== 'CONTEXT_INVALIDATED') {
                currentUrl = newUrl;
            } else if (newUrl === 'CONTEXT_INVALIDATED') {
                // Stop all navigation detection
                createCleanupFunction(cleanupFunctions, logger)();
            }
        }, COMMON_CONSTANTS.NAVIGATION_DELAY);
    };
}

/**
 * Setup History API interception
 * @private
 */
function setupHistoryAPIInterception(handleNavigation, cleanupFunctions) {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function () {
        originalPushState.apply(history, arguments);
        handleNavigation();
    };

    history.replaceState = function () {
        originalReplaceState.apply(history, arguments);
        handleNavigation();
    };

    cleanupFunctions.push(() => {
        history.pushState = originalPushState;
        history.replaceState = originalReplaceState;
    });
}

/**
 * Setup popstate event detection
 * @private
 */
function setupPopstateDetection(handleNavigation, cleanupFunctions) {
    const popstateHandler = () => handleNavigation();
    window.addEventListener('popstate', popstateHandler);
    cleanupFunctions.push(() => {
        window.removeEventListener('popstate', popstateHandler);
    });
}

/**
 * Setup hash change detection
 * @private
 */
function setupHashChangeDetection(handleNavigation, cleanupFunctions) {
    const hashChangeHandler = () => handleNavigation();
    window.addEventListener('hashchange', hashChangeHandler);
    cleanupFunctions.push(() => {
        window.removeEventListener('hashchange', hashChangeHandler);
    });
}

/**
 * Setup focus event detection
 * @private
 */
function setupFocusDetection(handleNavigation, cleanupFunctions) {
    const focusHandler = () => handleNavigation();
    window.addEventListener('focus', focusHandler);
    cleanupFunctions.push(() => {
        window.removeEventListener('focus', focusHandler);
    });
}

/**
 * Setup interval-based detection
 * @private
 */
function setupIntervalDetection(intervalCheck, currentUrl, onNavigate, logger, cleanupFunctions) {
    const intervalId = setInterval(() => {
        const newUrl = detectUrlChange(currentUrl, onNavigate, logger);
        if (newUrl && newUrl !== 'CONTEXT_INVALIDATED') {
            currentUrl = newUrl;
        } else if (newUrl === 'CONTEXT_INVALIDATED') {
            createCleanupFunction(cleanupFunctions, logger)();
        }
    }, intervalCheck);

    cleanupFunctions.push(() => {
        if (intervalId) {
            clearInterval(intervalId);
        }
    });
}

/**
 * Create cleanup function with error handling
 * @private
 */
function createCleanupFunction(cleanupFunctions, logger) {
    return () => {
        cleanupFunctions.forEach(fn => {
            try {
                fn();
            } catch (error) {
                logger('error', 'Error during navigation cleanup', { error });
            }
        });
        cleanupFunctions.length = 0;
    };
}

/**
 * Check if current page is a player page
 * @param {string} playerUrlPattern - Pattern to match player URLs
 * @param {string} url - URL to check (defaults to current URL)
 * @returns {boolean} Whether current page is a player page
 */
export function isPlayerPage(playerUrlPattern, url = window.location.pathname) {
    return url.includes(playerUrlPattern);
}

/**
 * Safe script injection helper
 * @param {string} scriptSrc - Script source URL
 * @param {string} scriptId - Script element ID
 * @param {Function} onLoad - Load success callback
 * @param {Function} onError - Load error callback
 * @param {Function} logger - Logger function
 * @returns {boolean} Whether injection was attempted
 */
export function injectScript(
    scriptSrc,
    scriptId,
    onLoad = () => { },
    onError = () => { },
    logger = console.log
) {
    // Check if script already exists
    if (document.getElementById(scriptId)) {
        logger(`Script ${scriptId} already exists`);
        return false;
    }

    try {
        const script = document.createElement('script');
        script.src = scriptSrc;
        script.id = scriptId;
        script.onload = () => {
            logger(`Script ${scriptId} loaded successfully`);
            onLoad();
        };
        script.onerror = (error) => {
            logger(`Failed to load script ${scriptId}`, error);
            onError(error);
        };

        const target = document.head || document.documentElement;
        if (target) {
            target.appendChild(script);
            return true;
        } else {
            logger('No target element found for script injection');
            return false;
        }
    } catch (error) {
        logger(`Error during script injection: ${error.message}`);
        onError(error);
        return false;
    }
}

/**
 * Enhanced event buffer manager for handling early events with memory management
 */
export class EventBuffer {
    constructor(logger = console.log, maxSize = 100, maxAge = 30000) {
        this.buffer = [];
        this.logger = logger;
        this.isProcessing = false;
        this.maxSize = maxSize; // Maximum number of events to buffer
        this.maxAge = maxAge; // Maximum age of events in milliseconds (30 seconds)
        this.createdAt = Date.now();
    }

    /**
     * Add event to buffer with size and age management
     * @param {Object} eventData - Event data to buffer
     */
    add(eventData) {
        // Add timestamp if not present
        if (!eventData.timestamp) {
            eventData.timestamp = Date.now();
        }

        // Clean old events before adding new one
        this._cleanOldEvents();

        // Check buffer size limit
        if (this.buffer.length >= this.maxSize) {
            this.logger(`Event buffer size limit (${this.maxSize}) reached, removing oldest events`);
            // Remove oldest 25% of events to make room
            const removeCount = Math.floor(this.maxSize * 0.25);
            this.buffer.splice(0, removeCount);
        }

        this.buffer.push(eventData);
        this.logger(`Event buffered. Buffer size: ${this.buffer.length}/${this.maxSize}`);
    }

    /**
     * Process all buffered events with enhanced error handling
     * @param {Function} processor - Function to process each event
     */
    processAll(processor) {
        if (this.isProcessing || this.buffer.length === 0) {
            return;
        }

        this.isProcessing = true;
        
        // Clean old events before processing
        this._cleanOldEvents();
        
        const events = [...this.buffer];
        this.buffer = [];

        this.logger(`Processing ${events.length} buffered events`);

        let processedCount = 0;
        let skippedCount = 0;
        let errorCount = 0;

        events.forEach((eventData, index) => {
            try {
                // Validate event data
                if (!eventData || typeof eventData !== 'object') {
                    this.logger(`Skipping invalid event at index ${index}:`, eventData);
                    skippedCount++;
                    return;
                }

                // Check if event is still relevant (not too old)
                const eventAge = Date.now() - (eventData.timestamp || 0);
                if (eventAge > this.maxAge) {
                    this.logger(`Skipping stale event at index ${index}, age: ${eventAge}ms`);
                    skippedCount++;
                    return;
                }

                processor(eventData, index);
                processedCount++;
            } catch (error) {
                this.logger(`Error processing buffered event ${index}:`, error);
                errorCount++;
            }
        });

        this.logger(`Event processing completed: ${processedCount} processed, ${skippedCount} skipped, ${errorCount} errors`);
        this.isProcessing = false;
    }

    /**
     * Clear all buffered events
     */
    clear() {
        const count = this.buffer.length;
        this.buffer = [];
        this.logger(`Cleared ${count} buffered events`);
    }

    /**
     * Get buffer size
     * @returns {number} Number of buffered events
     */
    size() {
        return this.buffer.length;
    }

    /**
     * Get buffer statistics
     * @returns {Object} Buffer statistics
     */
    getStats() {
        const now = Date.now();
        const ages = this.buffer.map(event => now - (event.timestamp || 0));
        
        return {
            size: this.buffer.length,
            maxSize: this.maxSize,
            maxAge: this.maxAge,
            oldestEventAge: ages.length > 0 ? Math.max(...ages) : 0,
            newestEventAge: ages.length > 0 ? Math.min(...ages) : 0,
            averageAge: ages.length > 0 ? ages.reduce((sum, age) => sum + age, 0) / ages.length : 0,
            bufferAge: now - this.createdAt
        };
    }

    /**
     * Clean old events from buffer using more efficient approach
     * @private
     */
    _cleanOldEvents() {
        const now = Date.now();
        const originalSize = this.buffer.length;
        
        // Use reverse iteration to avoid index shifting issues
        for (let i = this.buffer.length - 1; i >= 0; i--) {
            const event = this.buffer[i];
            const eventAge = now - (event.timestamp || 0);
            if (eventAge > this.maxAge) {
                this.buffer.splice(i, 1);
            }
        }

        const removedCount = originalSize - this.buffer.length;
        if (removedCount > 0) {
            this.logger(`Removed ${removedCount} stale events from buffer`);
        }
    }

    /**
     * Check if buffer needs maintenance
     * @returns {boolean} Whether maintenance is needed
     */
    needsMaintenance() {
        const stats = this.getStats();
        return stats.size > this.maxSize * 0.8 || stats.oldestEventAge > this.maxAge * 0.8;
    }

    /**
     * Perform buffer maintenance
     */
    performMaintenance() {
        this._cleanOldEvents();
        
        // If still too large, remove oldest events
        if (this.buffer.length > this.maxSize * 0.8) {
            const targetSize = Math.floor(this.maxSize * 0.6);
            const removeCount = this.buffer.length - targetSize;
            if (removeCount > 0) {
                this.buffer.splice(0, removeCount);
                this.logger(`Maintenance: removed ${removeCount} oldest events, buffer size now: ${this.buffer.length}`);
            }
        }
    }
}

/**
 * Configuration change processor
 * @param {Object} oldConfig - Previous configuration
 * @param {Object} newConfig - New configuration
 * @param {string[]} uiOnlySettings - Settings that don't affect functionality
 * @returns {Object} Analysis of configuration changes
 */
export function analyzeConfigChanges(oldConfig, newConfig, uiOnlySettings = []) {
    const changes = {};
    const functionalChanges = {};
    const uiOnlyChanges = {};

    // Find all changes
    for (const key in newConfig) {
        if (oldConfig[key] !== newConfig[key]) {
            changes[key] = {
                old: oldConfig[key],
                new: newConfig[key]
            };

            if (uiOnlySettings.includes(key)) {
                uiOnlyChanges[key] = changes[key];
            } else {
                functionalChanges[key] = changes[key];
            }
        }
    }

    return {
        hasChanges: Object.keys(changes).length > 0,
        hasFunctionalChanges: Object.keys(functionalChanges).length > 0,
        hasUiOnlyChanges: Object.keys(uiOnlyChanges).length > 0,
        changes,
        functionalChanges,
        uiOnlyChanges
    };
}

/**
 * DOM ready helper - ensures DOM is ready before executing callback
 * @param {Function} callback - Function to execute when DOM is ready
 */
export function onDOMReady(callback) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', callback);
    } else {
        // DOM is already ready
        callback();
    }
}

/**
 * Element cache for performance optimization with automatic cleanup
 */
class ElementCache {
    constructor(maxSize = 100, ttl = 300000) { // 5 minutes TTL
        this.cache = new Map();
        this.maxSize = maxSize;
        this.ttl = ttl;
        this.timers = new Map();
    }

    set(key, element) {
        // Clear existing timer if any
        if (this.timers.has(key)) {
            clearTimeout(this.timers.get(key));
        }

        // Implement LRU eviction if cache is full
        if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
            const firstKey = this.cache.keys().next().value;
            this.delete(firstKey);
        }

        this.cache.set(key, element);
        
        // Set TTL timer
        const timer = setTimeout(() => {
            this.delete(key);
        }, this.ttl);
        this.timers.set(key, timer);
    }

    get(key) {
        return this.cache.get(key);
    }

    has(key) {
        return this.cache.has(key);
    }

    delete(key) {
        if (this.timers.has(key)) {
            clearTimeout(this.timers.get(key));
            this.timers.delete(key);
        }
        return this.cache.delete(key);
    }

    clear() {
        for (const timer of this.timers.values()) {
            clearTimeout(timer);
        }
        this.timers.clear();
        this.cache.clear();
    }
}

const elementCache = new ElementCache();

/**
 * Input validation helper for utility functions
 * @private
 * @param {Object} params - Parameters to validate
 * @param {Object} schema - Validation schema
 * @throws {Error} If validation fails
 */
function validateInputs(params, schema) {
    for (const [key, rules] of Object.entries(schema)) {
        const value = params[key];
        
        if (rules.required && (value === undefined || value === null)) {
            throw new Error(`${key} is required`);
        }
        
        if (value !== undefined && rules.type && typeof value !== rules.type) {
            throw new TypeError(`${key} must be of type ${rules.type}, got ${typeof value}`);
        }
        
        if (rules.min !== undefined && value < rules.min) {
            throw new RangeError(`${key} must be >= ${rules.min}, got ${value}`);
        }
        
        if (rules.max !== undefined && value > rules.max) {
            throw new RangeError(`${key} must be <= ${rules.max}, got ${value}`);
        }
        
        if (rules.validator && !rules.validator(value)) {
            throw new Error(`${key} failed custom validation`);
        }
    }
}

/**
 * Safe element query with retry mechanism and caching
 * @param {string} selector - CSS selector
 * @param {number} maxRetries - Maximum retry attempts
 * @param {number} retryInterval - Retry interval in milliseconds
 * @param {Element} context - Context element (default: document)
 * @param {boolean} useCache - Whether to use element caching
 * @returns {Promise<Element|null>} Found element or null
 */
export async function waitForElement(
    selector,
    maxRetries = 10,
    retryInterval = 500,
    context = document,
    useCache = false
) {
    // Input validation
    validateInputs({ selector, maxRetries, retryInterval }, {
        selector: { required: true, type: 'string' },
        maxRetries: { required: true, type: 'number', min: 1 },
        retryInterval: { required: true, type: 'number', min: 0 }
    });
    
    const cacheKey = `${selector}:${context === document ? 'document' : 'context'}`;

    // Check cache first if enabled
    if (useCache && elementCache.has(cacheKey)) {
        const cachedElement = elementCache.get(cacheKey);
        if (cachedElement && document.contains(cachedElement)) {
            return cachedElement;
        } else {
            elementCache.delete(cacheKey);
        }
    }

    // Use async/await with a helper function for cleaner code
    return await new Promise((resolve) => {
        let retries = 0;

        const tryFind = async () => {
            const element = context.querySelector(selector);
            if (element) {
                if (useCache) {
                    elementCache.set(cacheKey, element);
                }
                resolve(element);
                return;
            }

            retries++;
            if (retries >= maxRetries) {
                resolve(null);
                return;
            }

            setTimeout(tryFind, retryInterval);
        };

        tryFind();
    });
}

/**
 * Clear element cache
 * @param {string} selector - Specific selector to clear, or null for all
 */
export function clearElementCache(selector = null) {
    if (selector) {
        for (const key of elementCache.keys()) {
            if (key.startsWith(selector)) {
                elementCache.delete(key);
            }
        }
    } else {
        elementCache.clear();
    }
}

/**
 * Debounce function to limit function execution frequency
 * @param {Function} func - Function to debounce
 * @param {number} delay - Delay in milliseconds
 * @returns {Function} Debounced function
 */
export function debounce(func, delay) {
    let timeoutId;
    return function (...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => func.apply(this, args), delay);
    };
}

/**
 * Throttle function to limit function execution frequency
 * @param {Function} func - Function to throttle
 * @param {number} limit - Time limit in milliseconds
 * @returns {Function} Throttled function
 */
export function throttle(func, limit) {
    let inThrottle;
    return function (...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

/**
 * Platform detection helper
 * @param {string} url - URL to check
 * @param {Object} platformPatterns - Platform URL patterns
 * @returns {string|null} Detected platform name or null
 */
export function detectPlatform(url, platformPatterns) {
    for (const [platform, patterns] of Object.entries(platformPatterns)) {
        for (const pattern of patterns) {
            if (new RegExp(pattern).test(url)) {
                return platform;
            }
        }
    }
    return null;
}

/**
 * Video element setup helper that integrates with subtitleUtilities
 * @param {Object} activePlatform - Platform instance
 * @param {Object} subtitleUtils - Subtitle utilities instance
 * @param {Object} config - Configuration object
 * @param {string} logPrefix - Log prefix
 * @returns {boolean} Whether setup was successful
 */
export function attemptVideoSetup(activePlatform, subtitleUtils, config, logPrefix) {
    if (!activePlatform || !subtitleUtils || !config) {
        return false;
    }

    const videoElement = activePlatform.getVideoElement();
    if (!videoElement) {
        return false; // Video not ready yet
    }

    logWithFallback('info', 'Video element found! Setting up subtitle container and listeners', {}, logPrefix);
    logWithFallback('debug', 'Current subtitlesActive state', {
        subtitlesActive: subtitleUtils.subtitlesActive
    }, logPrefix);

    // Ensure container and timeupdate listener
    subtitleUtils.ensureSubtitleContainer(activePlatform, config, logPrefix);

    if (subtitleUtils.subtitlesActive) {
        logWithFallback('info', 'Subtitles are active, showing container and setting up listeners', {}, logPrefix);
        subtitleUtils.showSubtitleContainer();
        if (videoElement.currentTime > 0) {
            subtitleUtils.updateSubtitles(
                videoElement.currentTime,
                activePlatform,
                config,
                logPrefix
            );
        }
    } else {
        logWithFallback('info', 'Subtitles are not active, hiding container', {}, logPrefix);
        subtitleUtils.hideSubtitleContainer();
    }

    return true; // Success
}

/**
 * Configuration change analyzer that uses common UI-only settings
 * @param {Object} oldConfig - Previous configuration
 * @param {Object} newConfig - New configuration
 * @returns {Object} Analysis of configuration changes
 * @deprecated Use analyzeConfigChanges directly with COMMON_CONSTANTS.UI_ONLY_SETTINGS
 */
export function analyzeConfigurationChanges(oldConfig, newConfig) {
    console.warn('analyzeConfigurationChanges is deprecated. Use analyzeConfigChanges directly.');
    return analyzeConfigChanges(oldConfig, newConfig, COMMON_CONSTANTS.UI_ONLY_SETTINGS);
}

/**
 * Early event listener setup helper
 * @param {string} eventId - Event ID to listen for
 * @param {Function} eventHandler - Event handler function
 * @param {Function} logger - Logger function
 * @returns {Function} Cleanup function
 */
export function setupEarlyEventListener(eventId, eventHandler, logger = logWithFallback) {
    let listenerAttached = false;

    const attachListener = () => {
        if (!listenerAttached) {
            document.addEventListener(eventId, eventHandler);
            listenerAttached = true;
            logger('info', `Early event listener attached for: ${eventId}`);
        }
    };

    const cleanup = () => {
        if (listenerAttached) {
            document.removeEventListener(eventId, eventHandler);
            listenerAttached = false;
            logger('info', `Event listener removed for: ${eventId}`);
        }
    };

    // Attach immediately
    attachListener();

    return cleanup;
}

/**
 * DOM mutation observer setup for video element changes
 * @param {Function} onVideoChange - Callback when video element changes
 * @param {Object} context - Context with platform and utilities
 * @param {Function} logger - Logger function
 * @returns {MutationObserver} Observer instance
 */
export function setupVideoElementObserver(onVideoChange, context, logger = logWithFallback) {
    const observer = new MutationObserver((mutationsList) => {
        if (!context.subtitleUtils) return; // Utilities not loaded yet

        for (let mutation of mutationsList) {
            if (mutation.type === 'childList') {
                const videoElementNow = context.activePlatform?.getVideoElement();
                const currentDOMVideoElement = document.querySelector(
                    'video[data-listener-attached="true"]'
                );

                if (videoElementNow && (!currentDOMVideoElement || currentDOMVideoElement !== videoElementNow)) {
                    logger('debug', 'Video element appearance or change detected');
                    onVideoChange(videoElementNow, 'appeared');
                } else if (currentDOMVideoElement && !videoElementNow) {
                    logger('debug', 'Video element removal detected');
                    onVideoChange(null, 'removed');
                }
            }
        }
    });

    // Start observing when body is available
    const startObserving = () => {
        if (document.body) {
            observer.observe(document.body, { childList: true, subtree: true });
            logger('info', 'Video element observer started');
        } else {
            setTimeout(startObserving, 100);
        }
    };

    startObserving();
    return observer;
}

/**
 * Cleanup helper for content script resources
 * @param {Object} context - Context object with resources to cleanup
 * @param {Function} logger - Logger function
 */
export function cleanupContentScriptResources(context, logger = logWithFallback) {
    try {
        // Stop intervals
        if (context.intervalManager) {
            context.intervalManager.clearAll();
        }

        // Stop video element detection
        if (context.stopVideoElementDetection) {
            context.stopVideoElementDetection();
        }

        // Cleanup platform
        if (context.activePlatform) {
            context.activePlatform.cleanup();
            context.activePlatform = null;
        }

        // Disconnect observers
        if (context.pageObserver) {
            context.pageObserver.disconnect();
        }

        if (context.videoObserver) {
            context.videoObserver.disconnect();
        }

        // Remove event listeners
        if (context.cleanupNavigation) {
            context.cleanupNavigation();
        }

        if (context.cleanupEventListener) {
            context.cleanupEventListener();
        }

        // Clear state
        context.platformReady = false;
        if (context.eventBuffer) {
            context.eventBuffer.clear();
        }

        logger('info', 'Content script cleanup completed');
    } catch (error) {
        logger('error', 'Error during content script cleanup', { error });
    }
}

/**
 * Extension context invalidation handler
 * @param {Function} onInvalidation - Callback when context is invalidated
 * @param {Function} logger - Logger function
 */
export function handleExtensionContextInvalidation(onInvalidation, logger = logWithFallback) {
    // Listen for extension context invalidation
    chrome.runtime.onConnect.addListener((port) => {
        port.onDisconnect.addListener(() => {
            if (chrome.runtime.lastError) {
                logger('info', 'Extension context invalidated');
                onInvalidation();
            }
        });
    });

    // Handle page unload
    window.addEventListener('beforeunload', onInvalidation);
}

/**
 * Platform Configuration Factory
 */
export class PlatformConfigFactory {
    static getConfig(name) {
        const config = DEFAULT_PLATFORM_CONFIGS[name];
        if (!config) {
            throw new Error(`Unknown platform: ${name}`);
        }
        return { ...config }; // Return a copy to prevent mutations
    }

    static getConfigByUrl(url = window.location.href) {
        for (const [platformName, config] of Object.entries(DEFAULT_PLATFORM_CONFIGS)) {
            for (const pattern of config.navigation.urlPatterns) {
                if (url.includes(pattern)) {
                    return { ...config }; // Return a copy
                }
            }
        }
        return null;
    }

    static getSupportedPlatforms() {
        return Object.keys(DEFAULT_PLATFORM_CONFIGS);
    }

    static validateConfig(config) {
        const required = ['name', 'injectScript', 'navigation', 'videoDetection', 'logPrefix'];
        for (const field of required) {
            if (!config[field]) {
                throw new Error(`Missing required config field: ${field}`);
            }
        }
        return true;
    }
}

/**
 * Get platform configuration by name
 * @deprecated Use PlatformConfigFactory.getConfig() instead
 * @param {string} name - Platform name
 * @returns {Object|null} Platform configuration or null
 */
export function getPlatformConfig(name) {
    return DEFAULT_PLATFORM_CONFIGS[name] || null;
}

/**
 * Get platform configuration by URL
 * @deprecated Use PlatformConfigFactory.getConfigByUrl() instead
 * @param {string} url - URL to check
 * @returns {Object|null} Platform configuration or null
 */
export function getPlatformConfigByUrl(url = window.location.href) {
    for (const [platformName, config] of Object.entries(DEFAULT_PLATFORM_CONFIGS)) {
        for (const pattern of config.navigation.urlPatterns) {
            if (url.includes(pattern)) {
                return config;
            }
        }
    }
    return null;
}

/**
 * Create a standardized content script context object
 * @param {string} name - Platform name
 * @returns {Object} Context object with common properties
 */
export function createContentScriptContext(name) {
    const config = getPlatformConfig(name);

    return {
        // Platform info
        platformName: name,
        config,
        logPrefix: config?.logPrefix || 'ContentScript',

        // State
        activePlatform: null,
        platformReady: false,

        // Utilities (to be populated)
        subtitleUtils: null,
        configService: null,
        contentLogger: null,

        // Managers
        intervalManager: new IntervalManager(),
        eventBuffer: new EventBuffer(),
        messageRegistry: new MessageHandlerRegistry(),

        // Cleanup functions
        cleanupFunctions: [],

        // Helper methods
        addCleanup: function (cleanupFn) {
            this.cleanupFunctions.push(cleanupFn);
        },

        cleanup: function () {
            cleanupContentScriptResources(this);
            this.cleanupFunctions.forEach(fn => {
                try {
                    fn();
                } catch (cleanupError) {
                    console.error('Cleanup function error:', cleanupError);
                }
            });
            this.cleanupFunctions.length = 0;
        }
    };
}

/**
 * Extension context validation helper
 * @returns {boolean} Whether extension context is valid
 */
export function isExtensionContextValid() {
    try {
        return !!(chrome && chrome.runtime && chrome.runtime.id);
    } catch (error) {
        return false;
    }
}

/**
 * Safe Chrome API call wrapper with context validation
 * @param {Function} apiCall - Chrome API function to call
 * @param {Array} args - Arguments to pass to the API call
 * @param {Function} onSuccess - Success callback
 * @param {Function} onError - Error callback
 */
export function safeChromeApiCall(apiCall, args = [], onSuccess = () => {}, onError = () => {}) {
    if (!isExtensionContextValid()) {
        onError(new Error('Extension context is invalid'));
        return;
    }

    try {
        const result = apiCall(...args);
        
        // Check for Chrome runtime lastError
        if (chrome.runtime && chrome.runtime.lastError) {
            onError(new Error(`Runtime error: ${chrome.runtime.lastError.message}`));
            return;
        }
        
        onSuccess(result);
    } catch (error) {
        if (error.message?.includes('Extension context invalidated')) {
            onError(new Error('CONTEXT_INVALIDATED'));
        } else {
            onError(error);
        }
    }
}

/**
 * Fallback logging helper for when logger is not yet initialized
 * @param {string} level - Log level (info, warn, error, debug)
 * @param {string} message - Log message
 * @param {Object} data - Additional data to log
 * @param {string} prefix - Log prefix
 */
export function logWithFallback(level, message, data = {}, prefix = 'ContentScript') {
    console.log(
        `[${prefix}] [${level.toUpperCase()}] ${message}`,
        data
    );
}

/**
 * Module loader helper with error handling
 * @param {string} modulePath - Path to module to load
 * @param {Function} logger - Logger function
 * @returns {Promise<Object|null>} Loaded module or null on error
 */
export async function loadModule(modulePath, logger = logWithFallback) {
    try {
        const module = await import(chrome.runtime.getURL(modulePath));
        logger('info', `Module loaded successfully: ${modulePath}`);
        return module;
    } catch (error) {
        logger('error', `Failed to load module: ${modulePath}`, { error });
        return null;
    }
}

/**
 * Initialize logger with configuration
 * @param {string} logPrefix - Prefix for log messages
 * @param {Object} configService - Configuration service instance
 * @param {Object} Logger - Logger class
 * @returns {Promise<Object>} Initialized logger instance
 */
export async function initializeLogger(logPrefix, configService, Logger) {
    const logger = Logger.create(logPrefix);

    try {
        const loggingLevel = await configService.get('loggingLevel');
        logger.updateLevel(loggingLevel);
        logger.info('Logger initialized', { level: loggingLevel });
    } catch (error) {
        logger.updateLevel(Logger.LEVELS.INFO);
        logger.warn('Failed to load logging level from config, using INFO level', error);
    }

    return logger;
}

/**
 * Wait for DOM to be ready with optional timeout
 * @param {number} timeout - Timeout in milliseconds (default: 10000)
 * @returns {Promise<void>} Resolves when DOM is ready
 */
export function waitForDOMReady(timeout = 10000) {
    return new Promise((resolve, reject) => {
        if (document.readyState !== 'loading') {
            resolve();
            return;
        }

        const timeoutId = setTimeout(() => {
            document.removeEventListener('DOMContentLoaded', onReady);
            reject(new Error('DOM ready timeout'));
        }, timeout);

        const onReady = () => {
            clearTimeout(timeoutId);
            resolve();
        };

        document.addEventListener('DOMContentLoaded', onReady);
    });
}

/**
 * Enhanced script injection with retry mechanism
 * @param {string} scriptSrc - Script source URL
 * @param {string} scriptId - Script element ID
 * @param {number} maxRetries - Maximum retry attempts
 * @param {number} retryDelay - Delay between retries in ms
 * @param {Function} logger - Logger function
 * @returns {Promise<boolean>} Whether injection was successful
 */
export function injectScriptWithRetry(
    scriptSrc,
    scriptId,
    maxRetries = 3,
    retryDelay = 10,
    logger = logWithFallback
) {
    return new Promise((resolve) => {
        let attempts = 0;

        const attemptInject = () => {
            attempts++;

            // Check if script already exists
            if (document.getElementById(scriptId)) {
                logger('info', `Script ${scriptId} already exists`);
                resolve(true);
                return;
            }

            try {
                const script = document.createElement('script');
                script.src = scriptSrc;
                script.id = scriptId;

                script.onload = () => {
                    logger('info', `Script ${scriptId} loaded successfully`);
                    resolve(true);
                };

                script.onerror = (error) => {
                    logger('error', `Failed to load script ${scriptId} (attempt ${attempts})`, { error });

                    if (attempts < maxRetries) {
                        setTimeout(attemptInject, retryDelay);
                    } else {
                        resolve(false);
                    }
                };

                const target = document.head || document.documentElement;
                if (target) {
                    target.appendChild(script);
                } else {
                    if (attempts < maxRetries) {
                        setTimeout(attemptInject, retryDelay);
                    } else {
                        logger('error', 'No target element found for script injection');
                        resolve(false);
                    }
                }
            } catch (error) {
                logger('error', `Error during script injection (attempt ${attempts})`, { error });

                if (attempts < maxRetries) {
                    setTimeout(attemptInject, retryDelay);
                } else {
                    resolve(false);
                }
            }
        };

        attemptInject();
    });
}

/**
 * Safe Chrome API call wrapper with Promise support
 * @param {Function} apiCall - Chrome API function to call
 * @param {Array} args - Arguments for the API call
 * @returns {Promise<*>} Promise that resolves with the API result
 */
export function chromeApiCall(apiCall, ...args) {
    return new Promise((resolve, reject) => {
        try {
            apiCall(...args, (result) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve(result);
                }
            });
        } catch (error) {
            reject(error);
        }
    });
}

/**
 * Enhanced module loader with dependency injection
 * @param {string} modulePath - Path to module to load
 * @param {Object} dependencies - Dependencies to inject
 * @param {Function} logger - Logger function
 * @returns {Promise<Object|null>} Loaded module or null on error
 */
export async function loadModuleWithDependencies(modulePath, dependencies = {}, logger = logWithFallback) {
    try {
        const module = await import(chrome.runtime.getURL(modulePath));

        // If module has an init function, call it with dependencies
        if (typeof module.init === 'function') {
            await module.init(dependencies);
        }

        logger('info', `Module loaded successfully: ${modulePath}`);
        return module;
    } catch (error) {
        logger('error', `Failed to load module: ${modulePath}`, { error });
        return null;
    }
}



/**
 * Memory-safe interval manager with automatic cleanup and monitoring
 */
export class IntervalManager {
    constructor() {
        this.intervals = new Map();
        this.createdAt = Date.now();
        this.maxIntervals = 50; // Prevent runaway interval creation
    }

    /**
     * Set an interval with automatic cleanup
     * @param {string} name - Interval name for reference
     * @param {Function} callback - Function to execute
     * @param {number} delay - Delay in milliseconds
     * @param {Object} options - Additional options
     * @param {number} options.maxExecutions - Maximum number of executions (optional)
     * @param {number} options.timeout - Auto-clear after timeout (optional)
     * @returns {boolean} Whether interval was set successfully
     */
    set(name, callback, delay, options = {}) {
        // Prevent too many intervals
        if (this.intervals.size >= this.maxIntervals) {
            console.warn(`IntervalManager: Maximum intervals (${this.maxIntervals}) reached`);
            return false;
        }

        this.clear(name); // Clear existing interval with same name

        try {
            let executionCount = 0;
            const { maxExecutions, timeout } = options;
            
            const wrappedCallback = () => {
                try {
                    callback();
                    executionCount++;
                    
                    // Auto-clear after max executions
                    if (maxExecutions && executionCount >= maxExecutions) {
                        this.clear(name);
                    }
                } catch (error) {
                    console.error(`Error in interval ${name}:`, error);
                    this.clear(name); // Clear on error to prevent repeated failures
                }
            };

            const intervalId = setInterval(wrappedCallback, delay);
            
            const intervalInfo = {
                id: intervalId,
                createdAt: Date.now(),
                delay,
                executionCount: 0,
                maxExecutions,
                timeout
            };
            
            this.intervals.set(name, intervalInfo);

            // Auto-clear after timeout
            if (timeout) {
                setTimeout(() => {
                    this.clear(name);
                }, timeout);
            }

            return true;
        } catch (error) {
            console.error(`Failed to set interval ${name}:`, error);
            return false;
        }
    }

    /**
     * Clear a specific interval
     * @param {string} name - Interval name
     */
    clear(name) {
        const intervalInfo = this.intervals.get(name);
        if (intervalInfo) {
            clearInterval(intervalInfo.id);
            this.intervals.delete(name);
        }
    }

    /**
     * Clear all intervals
     */
    clearAll() {
        for (const [name, intervalInfo] of this.intervals) {
            clearInterval(intervalInfo.id);
        }
        this.intervals.clear();
    }

    /**
     * Get active interval count
     * @returns {number} Number of active intervals
     */
    count() {
        return this.intervals.size;
    }

    /**
     * Get interval statistics
     * @returns {Object} Statistics about active intervals
     */
    getStats() {
        const now = Date.now();
        const intervals = Array.from(this.intervals.values());
        
        return {
            count: this.intervals.size,
            maxIntervals: this.maxIntervals,
            oldestInterval: intervals.length > 0 ? Math.min(...intervals.map(i => i.createdAt)) : null,
            averageAge: intervals.length > 0 ? 
                intervals.reduce((sum, i) => sum + (now - i.createdAt), 0) / intervals.length : 0,
            managerAge: now - this.createdAt
        };
    }

    /**
     * Clean up stale intervals (older than specified age)
     * @param {number} maxAge - Maximum age in milliseconds
     * @returns {number} Number of intervals cleared
     */
    cleanupStale(maxAge = 300000) { // 5 minutes default
        const now = Date.now();
        let cleared = 0;
        
        for (const [name, intervalInfo] of this.intervals) {
            if (now - intervalInfo.createdAt > maxAge) {
                this.clear(name);
                cleared++;
            }
        }
        
        return cleared;
    }

    /**
     * Check if interval exists
     * @param {string} name - Interval name
     * @returns {boolean} Whether interval exists
     */
    has(name) {
        return this.intervals.has(name);
    }

    /**
     * Get interval information
     * @param {string} name - Interval name
     * @returns {Object|null} Interval information or null
     */
    getInfo(name) {
        const intervalInfo = this.intervals.get(name);
        if (!intervalInfo) return null;
        
        return {
            name,
            delay: intervalInfo.delay,
            age: Date.now() - intervalInfo.createdAt,
            executionCount: intervalInfo.executionCount,
            maxExecutions: intervalInfo.maxExecutions,
            timeout: intervalInfo.timeout
        };
    }
}

/**
 * Message handler registry for Chrome extension messages
 */
export class MessageHandlerRegistry {
    constructor(logger = logWithFallback) {
        this.handlers = new Map();
        this.logger = logger;
    }

    /**
     * Register a message handler
     * @param {string} action - Action name
     * @param {Function} handler - Handler function
     * @param {boolean} requiresUtilities - Whether utilities are required
     */
    register(action, handler, requiresUtilities = false) {
        this.handlers.set(action, {
            handler,
            requiresUtilities
        });
        this.logger('info', `Message handler registered: ${action}`);
    }

    /**
     * Handle incoming Chrome message
     * @param {Object} request - Chrome message request
     * @param {Object} sender - Message sender
     * @param {Function} sendResponse - Response callback
     * @param {Object} context - Context object with utilities
     * @returns {boolean} Whether response is async
     */
    handle(request, sender, sendResponse, context = {}) {
        const action = request.action || request.type;

        if (!action) {
            this.logger('warn', 'Message received without action', { request });
            sendResponse({ success: false, error: 'No action specified' });
            return false;
        }

        const handlerInfo = this.handlers.get(action);
        if (!handlerInfo) {
            this.logger('debug', `No handler for action: ${action}`);
            sendResponse({ success: true }); // Default success for unknown actions
            return false;
        }

        const { handler, requiresUtilities } = handlerInfo;

        // Check if utilities are required but not available
        if (requiresUtilities && (!context.subtitleUtils || !context.configService)) {
            this.logger('error', `Utilities not loaded for action: ${action}`);
            sendResponse({ success: false, error: 'Utilities not loaded' });
            return false;
        }

        try {
            const result = handler(request, sendResponse, context);

            // If handler returns a promise, handle it
            if (result && typeof result.then === 'function') {
                result
                    .then(response => sendResponse(response))
                    .catch(error => {
                        this.logger('error', `Handler error for action ${action}`, { error });
                        sendResponse({ success: false, error: error.message });
                    });
                return true; // Async response
            }

            // If handler returns true, it will send response asynchronously
            return result === true;
        } catch (error) {
            this.logger('error', `Handler error for action ${action}`, { error });
            sendResponse({ success: false, error: error.message });
            return false;
        }
    }

    /**
     * Get all registered actions
     * @returns {string[]} Array of registered action names
     */
    getActions() {
        return Array.from(this.handlers.keys());
    }

    /**
     * Clear all handlers
     */
    clear() {
        this.handlers.clear();
        this.logger('info', 'All message handlers cleared');
    }
}

/**
 * Message handler for logging level changes
 */
export class LoggingLevelHandler {
    constructor(logger = logWithFallback) {
        this.logger = logger;
    }

    handle(request, sendResponse, context) {
        if (context.contentLogger) {
            context.contentLogger.updateLevel(request.level);
            context.contentLogger.info('Logging level updated from background script', {
                newLevel: request.level
            });
        } else {
            this.logger('info', 'Logging level change received but logger not initialized yet', {
                level: request.level
            });
        }
        sendResponse({ success: true });
        return false;
    }
}

/**
 * Message handler for subtitle toggle operations
 */
export class SubtitleToggleHandler {
    constructor(logger = logWithFallback) {
        this.logger = logger;
    }

    async handle(request, sendResponse, context) {
        const { subtitleUtils, activePlatform } = context;

        subtitleUtils.setSubtitlesActive(request.enabled);
        this.logger('info', 'Subtitle active state changed', { enabled: request.enabled });

        if (!request.enabled) {
            return this.#disableSubtitles(context, sendResponse, request);
        } else {
            return this.#enableSubtitles(context, sendResponse, request);
        }
    }

    #disableSubtitles(context, sendResponse, request) {
        const { subtitleUtils, activePlatform } = context;

        if (context.stopVideoElementDetection) {
            context.stopVideoElementDetection();
        }

        subtitleUtils.hideSubtitleContainer();
        subtitleUtils.clearSubtitlesDisplayAndQueue(activePlatform, true, context.logPrefix);

        if (activePlatform) {
            activePlatform.cleanup();
            context.activePlatform = null;
            context.platformReady = false;
        }

        sendResponse({ success: true, subtitlesEnabled: request.enabled });
        return false;
    }

    #enableSubtitles(context, sendResponse, request) {
        const { activePlatform } = context;

        if (!activePlatform) {
            if (context.initializePlatform) {
                context.initializePlatform()
                    .then(() => {
                        sendResponse({ success: true, subtitlesEnabled: request.enabled });
                    })
                    .catch((error) => {
                        this.logger('error', 'Error in platform initialization', { error });
                        sendResponse({ success: false, error: error.message });
                    });
                return true; // Async response
            }
        } else if (activePlatform.isPlayerPageActive()) {
            if (context.startVideoElementDetection) {
                context.startVideoElementDetection();
            }
            sendResponse({ success: true, subtitlesEnabled: request.enabled });
        } else {
            sendResponse({ success: true, subtitlesEnabled: request.enabled });
        }
        return false;
    }
}

/**
 * Message handler for configuration changes
 */
export class ConfigChangeHandler {
    constructor(logger = logWithFallback) {
        this.logger = logger;
    }

    handle(request, sendResponse, context) {
        const { subtitleUtils, activePlatform, currentConfig } = context;

        if (request.changes && activePlatform && subtitleUtils.subtitlesActive) {
            // Update local config with the changes for immediate effect
            Object.assign(currentConfig, request.changes);

            // Apply the changes immediately for instant visual feedback
            subtitleUtils.applySubtitleStyling(currentConfig);
            const videoElement = activePlatform.getVideoElement();
            if (videoElement) {
                subtitleUtils.updateSubtitles(
                    videoElement.currentTime,
                    activePlatform,
                    currentConfig,
                    context.logPrefix
                );
            }
            this.logger('info', 'Applied immediate config changes', { changes: request.changes });
        }
        sendResponse({ success: true });
        return false;
    }
}

/**
 * Factory for creating common message handlers
 */
export const createCommonMessageHandlers = (logger = logWithFallback) => ({
    LOGGING_LEVEL_CHANGED: new LoggingLevelHandler(logger),
    toggleSubtitles: new SubtitleToggleHandler(logger),
    configChanged: new ConfigChangeHandler(logger)
});



/**
 * Platform-specific constants extracted from existing content scripts
 */
export const PLATFORM_CONSTANTS = {
    netflix: {
        INJECT_SCRIPT_FILENAME: 'injected_scripts/netflixInject.js',
        INJECT_SCRIPT_TAG_ID: 'netflix-dualsub-injector-script-tag',
        INJECT_EVENT_ID: 'netflix-dualsub-injector-event',
        URL_PATTERNS: ['netflix.com'],
        PLAYER_URL_PATTERN: '/watch/',
        LOG_PREFIX: 'NetflixContent'
    },
    disneyplus: {
        INJECT_SCRIPT_FILENAME: 'injected_scripts/disneyPlusInject.js',
        INJECT_SCRIPT_TAG_ID: 'disneyplus-dualsub-injector-script-tag',
        INJECT_EVENT_ID: 'disneyplus-dualsub-injector-event',
        URL_PATTERNS: ['disneyplus.com'],
        PLAYER_URL_PATTERN: '/video/',
        LOG_PREFIX: 'DisneyPlusContent'
    }
};

/**
 * Default platform configurations
 */
export const DEFAULT_PLATFORM_CONFIGS = {
    netflix: {
        name: 'netflix',
        injectScript: {
            filename: PLATFORM_CONSTANTS.netflix.INJECT_SCRIPT_FILENAME,
            tagId: PLATFORM_CONSTANTS.netflix.INJECT_SCRIPT_TAG_ID,
            eventId: PLATFORM_CONSTANTS.netflix.INJECT_EVENT_ID
        },
        navigation: {
            urlPatterns: PLATFORM_CONSTANTS.netflix.URL_PATTERNS,
            spaHandling: true,
            checkInterval: COMMON_CONSTANTS.URL_CHECK_INTERVAL,
            playerUrlPattern: PLATFORM_CONSTANTS.netflix.PLAYER_URL_PATTERN
        },
        videoDetection: {
            maxRetries: COMMON_CONSTANTS.MAX_VIDEO_DETECTION_RETRIES,
            retryInterval: COMMON_CONSTANTS.VIDEO_DETECTION_INTERVAL
        },
        logPrefix: PLATFORM_CONSTANTS.netflix.LOG_PREFIX
    },
    disneyplus: {
        name: 'disneyplus',
        injectScript: {
            filename: PLATFORM_CONSTANTS.disneyplus.INJECT_SCRIPT_FILENAME,
            tagId: PLATFORM_CONSTANTS.disneyplus.INJECT_SCRIPT_TAG_ID,
            eventId: PLATFORM_CONSTANTS.disneyplus.INJECT_EVENT_ID
        },
        navigation: {
            urlPatterns: PLATFORM_CONSTANTS.disneyplus.URL_PATTERNS,
            spaHandling: false,
            checkInterval: COMMON_CONSTANTS.URL_CHECK_INTERVAL,
            playerUrlPattern: PLATFORM_CONSTANTS.disneyplus.PLAYER_URL_PATTERN
        },
        videoDetection: {
            maxRetries: COMMON_CONSTANTS.MAX_VIDEO_DETECTION_RETRIES,
            retryInterval: COMMON_CONSTANTS.VIDEO_DETECTION_INTERVAL
        },
        logPrefix: PLATFORM_CONSTANTS.disneyplus.LOG_PREFIX
    }
};