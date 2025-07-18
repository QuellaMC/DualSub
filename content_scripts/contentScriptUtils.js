/**
 * Content Script Utilities
 * 
 * Shared utility functions for content scripts including video detection,
 * event handling, configuration processing, and navigation helpers.
 * 
 * @author DualSub Extension
 * @version 1.0.0
 */

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
 * @property {Object} videoDetection - Video detection configuration
 * @property {number} videoDetection.maxRetries - Max video detection attempts
 * @property {number} videoDetection.retryInterval - Retry interval in ms
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
    onSuccess = () => {},
    onFailure = () => {},
    logger = console.log
) {
    let retries = 0;

    // Try immediately first
    const videoElement = getVideoElement();
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
export function detectUrlChange(currentUrl, onUrlChange = () => {}, logger = console.log) {
    const newUrl = window.location.href;
    const newPathname = window.location.pathname;
    
    if (newUrl !== currentUrl) {
        logger(`URL changed from ${currentUrl} to ${newUrl}`);
        onUrlChange(newUrl, newPathname);
        return newUrl;
    }
    
    return null;
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
    onLoad = () => {},
    onError = () => {},
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
 * Event buffer manager for handling early events
 */
export class EventBuffer {
    constructor(logger = console.log) {
        this.buffer = [];
        this.logger = logger;
        this.isProcessing = false;
    }

    /**
     * Add event to buffer
     * @param {Object} eventData - Event data to buffer
     */
    add(eventData) {
        this.buffer.push(eventData);
        this.logger(`Event buffered. Buffer size: ${this.buffer.length}`);
    }

    /**
     * Process all buffered events
     * @param {Function} processor - Function to process each event
     */
    processAll(processor) {
        if (this.isProcessing || this.buffer.length === 0) {
            return;
        }

        this.isProcessing = true;
        const events = [...this.buffer];
        this.buffer = [];

        this.logger(`Processing ${events.length} buffered events`);
        
        events.forEach((eventData, index) => {
            try {
                processor(eventData, index);
            } catch (error) {
                this.logger(`Error processing buffered event ${index}:`, error);
            }
        });

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
 * Safe element query with retry mechanism
 * @param {string} selector - CSS selector
 * @param {number} maxRetries - Maximum retry attempts
 * @param {number} retryInterval - Retry interval in milliseconds
 * @param {Element} context - Context element (default: document)
 * @returns {Promise<Element|null>} Found element or null
 */
export function waitForElement(
    selector,
    maxRetries = 10,
    retryInterval = 500,
    context = document
) {
    return new Promise((resolve) => {
        let retries = 0;

        const tryFind = () => {
            const element = context.querySelector(selector);
            if (element) {
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
 * Safe Chrome API call wrapper
 * @param {Function} apiCall - Chrome API function to call
 * @param {Array} args - Arguments for the API call
 * @param {Function} onSuccess - Success callback
 * @param {Function} onError - Error callback
 */
export function safeChromeApiCall(apiCall, args = [], onSuccess = () => {}, onError = () => {}) {
    if (!isExtensionContextValid()) {
        onError(new Error('Extension context is invalid'));
        return;
    }

    try {
        const result = apiCall.apply(chrome, args);
        
        // Handle both callback and promise-based APIs
        if (result && typeof result.then === 'function') {
            result.then(onSuccess).catch(onError);
        } else {
            onSuccess(result);
        }
    } catch (error) {
        onError(error);
    }
}

/**
 * Memory-safe interval manager
 */
export class IntervalManager {
    constructor() {
        this.intervals = new Map();
    }

    /**
     * Set an interval with automatic cleanup
     * @param {string} name - Interval name for reference
     * @param {Function} callback - Function to execute
     * @param {number} delay - Delay in milliseconds
     * @returns {boolean} Whether interval was set successfully
     */
    set(name, callback, delay) {
        this.clear(name); // Clear existing interval with same name
        
        try {
            const intervalId = setInterval(callback, delay);
            this.intervals.set(name, intervalId);
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
        const intervalId = this.intervals.get(name);
        if (intervalId) {
            clearInterval(intervalId);
            this.intervals.delete(name);
        }
    }

    /**
     * Clear all intervals
     */
    clearAll() {
        for (const [name, intervalId] of this.intervals) {
            clearInterval(intervalId);
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
}

/**
 * Default platform configurations
 */
export const DEFAULT_PLATFORM_CONFIGS = {
    netflix: {
        name: 'netflix',
        injectScript: {
            filename: 'injected_scripts/netflixInject.js',
            tagId: 'netflix-inject-script',
            eventId: 'netflix-subtitle-event'
        },
        navigation: {
            urlPatterns: ['.*\\.netflix\\.com.*'],
            spaHandling: true,
            checkInterval: 1000
        },
        videoDetection: {
            maxRetries: 30,
            retryInterval: 1000
        }
    },
    disneyplus: {
        name: 'disneyplus',
        injectScript: {
            filename: 'injected_scripts/disneyPlusInject.js',
            tagId: 'disneyplus-inject-script',
            eventId: 'disneyplus-subtitle-event'
        },
        navigation: {
            urlPatterns: ['.*\\.disneyplus\\.com.*'],
            spaHandling: false,
            checkInterval: 2000
        },
        videoDetection: {
            maxRetries: 30,
            retryInterval: 1000
        }
    }
};