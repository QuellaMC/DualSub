/**
 * EventUtils - Shared event listener management and cleanup utilities
 * 
 * This module provides robust event handling utilities with automatic cleanup,
 * event listener management, and error recovery mechanisms. These utilities
 * ensure proper resource management and prevent memory leaks in content scripts.
 * 
 * @author DualSub Extension
 * @version 1.0.0
 */

/**
 * EventListenerManager - Manages event listeners with automatic cleanup
 * 
 * This class provides centralized event listener management with automatic
 * cleanup, error handling, and support for AbortController-based cleanup.
 * 
 * @example
 * ```javascript
 * const eventManager = new EventListenerManager('netflix', {
 *     logger: myLogger
 * });
 * 
 * eventManager.addEventListener(videoElement, 'play', handlePlay);
 * eventManager.addEventListener(document, 'keydown', handleKeydown, { passive: true });
 * 
 * // Cleanup all listeners
 * eventManager.cleanup();
 * ```
 */
export class EventListenerManager {
    /**
     * Creates a new EventListenerManager instance
     * @param {string} platform - Platform name for logging
     * @param {Object} options - Configuration options
     * @param {Function} [options.logger] - Logger function
     * @param {boolean} [options.useAbortController=true] - Use AbortController for cleanup
     */
    constructor(platform, options = {}) {
        this.platform = platform;
        this.options = {
            logger: null,
            useAbortController: true,
            ...options
        };

        // Event listener tracking
        this.listeners = new Map();
        this.abortController = null;
        this.listenerCount = 0;

        // Initialize AbortController if supported and enabled
        if (this.options.useAbortController && typeof AbortController !== 'undefined') {
            this.abortController = new AbortController();
        }
    }

    /**
     * Add an event listener with automatic tracking
     * @param {EventTarget} target - Event target (element, document, window, etc.)
     * @param {string} type - Event type
     * @param {Function} listener - Event listener function
     * @param {Object|boolean} [options] - Event listener options
     * @returns {string} Listener ID for manual removal
     */
    addEventListener(target, type, listener, options = {}) {
        if (!target || typeof listener !== 'function') {
            this._log('error', 'Invalid addEventListener parameters', {
                hasTarget: !!target,
                listenerType: typeof listener,
                eventType: type
            });
            return null;
        }

        try {
            const listenerId = this._generateListenerId();
            
            // Prepare options with AbortController signal if available
            const eventOptions = this._prepareEventOptions(options);
            
            // Wrap listener for error handling and logging
            const wrappedListener = this._wrapListener(listener, type, listenerId);
            
            // Add event listener
            target.addEventListener(type, wrappedListener, eventOptions);
            
            // Track listener for cleanup
            this.listeners.set(listenerId, {
                target,
                type,
                listener: wrappedListener,
                originalListener: listener,
                options: eventOptions,
                addedAt: Date.now()
            });

            this._log('debug', 'Event listener added', {
                listenerId,
                eventType: type,
                targetType: this._getTargetType(target),
                totalListeners: this.listeners.size
            });

            return listenerId;
        } catch (error) {
            this._log('error', 'Error adding event listener', {
                error: error.message,
                eventType: type,
                targetType: this._getTargetType(target)
            });
            return null;
        }
    }

    /**
     * Remove a specific event listener
     * @param {string} listenerId - Listener ID returned by addEventListener
     * @returns {boolean} Whether removal was successful
     */
    removeEventListener(listenerId) {
        const listenerInfo = this.listeners.get(listenerId);
        if (!listenerInfo) {
            this._log('warn', 'Listener not found for removal', { listenerId });
            return false;
        }

        try {
            const { target, type, listener } = listenerInfo;
            target.removeEventListener(type, listener);
            this.listeners.delete(listenerId);

            this._log('debug', 'Event listener removed', {
                listenerId,
                eventType: type,
                remainingListeners: this.listeners.size
            });

            return true;
        } catch (error) {
            this._log('error', 'Error removing event listener', {
                error: error.message,
                listenerId
            });
            return false;
        }
    }

    /**
     * Remove all event listeners for a specific target
     * @param {EventTarget} target - Event target
     * @returns {number} Number of listeners removed
     */
    removeListenersForTarget(target) {
        let removedCount = 0;
        
        for (const [listenerId, listenerInfo] of this.listeners) {
            if (listenerInfo.target === target) {
                if (this.removeEventListener(listenerId)) {
                    removedCount++;
                }
            }
        }

        this._log('info', 'Removed listeners for target', {
            targetType: this._getTargetType(target),
            removedCount
        });

        return removedCount;
    }

    /**
     * Remove all event listeners of a specific type
     * @param {string} eventType - Event type
     * @returns {number} Number of listeners removed
     */
    removeListenersByType(eventType) {
        let removedCount = 0;
        
        for (const [listenerId, listenerInfo] of this.listeners) {
            if (listenerInfo.type === eventType) {
                if (this.removeEventListener(listenerId)) {
                    removedCount++;
                }
            }
        }

        this._log('info', 'Removed listeners by type', {
            eventType,
            removedCount
        });

        return removedCount;
    }

    /**
     * Get information about all active listeners
     * @returns {Object[]} Array of listener information objects
     */
    getActiveListeners() {
        return Array.from(this.listeners.entries()).map(([id, info]) => ({
            id,
            type: info.type,
            targetType: this._getTargetType(info.target),
            addedAt: info.addedAt,
            age: Date.now() - info.addedAt
        }));
    }

    /**
     * Check if a specific listener is active
     * @param {string} listenerId - Listener ID
     * @returns {boolean} Whether the listener is active
     */
    hasListener(listenerId) {
        return this.listeners.has(listenerId);
    }

    /**
     * Get the number of active listeners
     * @returns {number} Number of active listeners
     */
    getListenerCount() {
        return this.listeners.size;
    }

    /**
     * Clean up all event listeners
     * @returns {number} Number of listeners cleaned up
     */
    cleanup() {
        const initialCount = this.listeners.size;

        // If using AbortController, abort all listeners at once
        if (this.abortController) {
            try {
                this.abortController.abort();
                this._log('info', 'Aborted all listeners via AbortController');
            } catch (error) {
                this._log('warn', 'Error aborting listeners', { error: error.message });
            }
        }

        // Manual cleanup for listeners not using AbortController
        const listenersToRemove = Array.from(this.listeners.keys());
        let manuallyRemoved = 0;

        for (const listenerId of listenersToRemove) {
            const listenerInfo = this.listeners.get(listenerId);
            if (listenerInfo && !listenerInfo.options?.signal) {
                try {
                    const { target, type, listener } = listenerInfo;
                    target.removeEventListener(type, listener);
                    manuallyRemoved++;
                } catch (error) {
                    this._log('warn', 'Error manually removing listener', {
                        listenerId,
                        error: error.message
                    });
                }
            }
        }

        // Clear tracking
        this.listeners.clear();
        this.abortController = null;

        this._log('info', 'Event listener cleanup completed', {
            initialCount,
            manuallyRemoved,
            abortControllerUsed: !!this.abortController
        });

        return initialCount;
    }

    /**
     * Generate a unique listener ID
     * @private
     * @returns {string} Unique listener ID
     */
    _generateListenerId() {
        return `${this.platform}-listener-${++this.listenerCount}-${Date.now()}`;
    }

    /**
     * Prepare event options with AbortController signal if available
     * @private
     * @param {Object|boolean} options - Original options
     * @returns {Object} Prepared options
     */
    _prepareEventOptions(options) {
        // Handle boolean options (for passive/capture)
        if (typeof options === 'boolean') {
            options = { capture: options };
        }

        // Add AbortController signal if available and not already specified
        if (this.abortController && !options.signal) {
            options = { ...options, signal: this.abortController.signal };
        }

        return options;
    }

    /**
     * Wrap listener function with error handling and logging
     * @private
     * @param {Function} listener - Original listener function
     * @param {string} eventType - Event type
     * @param {string} listenerId - Listener ID
     * @returns {Function} Wrapped listener function
     */
    _wrapListener(listener, eventType, listenerId) {
        return (event) => {
            try {
                listener(event);
            } catch (error) {
                this._log('error', 'Error in event listener', {
                    listenerId,
                    eventType,
                    error: error.message,
                    stack: error.stack
                });
            }
        };
    }

    /**
     * Get a descriptive type for an event target
     * @private
     * @param {EventTarget} target - Event target
     * @returns {string} Target type description
     */
    _getTargetType(target) {
        if (!target) return 'null';
        if (target === window) return 'window';
        if (target === document) return 'document';
        if (target.nodeType === Node.ELEMENT_NODE) {
            return `${target.tagName.toLowerCase()}${target.id ? '#' + target.id : ''}${target.className ? '.' + target.className.split(' ')[0] : ''}`;
        }
        return target.constructor.name || 'unknown';
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
            this.options.logger(level, `[EventListenerManager:${this.platform}] ${message}`, data);
        } else {
            console.log(`[EventListenerManager:${this.platform}] [${level.toUpperCase()}] ${message}`, data);
        }
    }
}

/**
 * EventDebouncer - Debounces event handlers to prevent excessive calls
 * 
 * This class provides event debouncing functionality to limit the rate
 * of event handler execution, useful for scroll, resize, and input events.
 * 
 * @example
 * ```javascript
 * const debouncer = new EventDebouncer();
 * 
 * const debouncedHandler = debouncer.debounce(handleScroll, 100);
 * window.addEventListener('scroll', debouncedHandler);
 * 
 * // Cleanup
 * debouncer.cleanup();
 * ```
 */
export class EventDebouncer {
    /**
     * Creates a new EventDebouncer instance
     * @param {Object} options - Configuration options
     * @param {Function} [options.logger] - Logger function
     */
    constructor(options = {}) {
        this.options = {
            logger: null,
            ...options
        };

        // Track active timeouts for cleanup
        this.activeTimeouts = new Set();
    }

    /**
     * Create a debounced version of a function
     * @param {Function} func - Function to debounce
     * @param {number} delay - Delay in milliseconds
     * @param {Object} [options] - Debounce options
     * @param {boolean} [options.immediate=false] - Execute immediately on first call
     * @returns {Function} Debounced function
     */
    debounce(func, delay, options = {}) {
        if (typeof func !== 'function') {
            this._log('error', 'Debounce target must be a function');
            return func;
        }

        const { immediate = false } = options;
        let timeoutId = null;
        let lastCallTime = 0;

        const debouncedFunction = (...args) => {
            const now = Date.now();
            const callNow = immediate && !timeoutId;

            // Clear existing timeout
            if (timeoutId) {
                clearTimeout(timeoutId);
                this.activeTimeouts.delete(timeoutId);
            }

            // Set new timeout
            timeoutId = setTimeout(() => {
                this.activeTimeouts.delete(timeoutId);
                timeoutId = null;
                lastCallTime = Date.now();
                
                if (!immediate) {
                    try {
                        func.apply(this, args);
                    } catch (error) {
                        this._log('error', 'Error in debounced function', {
                            error: error.message,
                            delay
                        });
                    }
                }
            }, delay);

            this.activeTimeouts.add(timeoutId);

            // Execute immediately if configured
            if (callNow) {
                try {
                    lastCallTime = now;
                    func.apply(this, args);
                } catch (error) {
                    this._log('error', 'Error in immediate debounced function', {
                        error: error.message,
                        delay
                    });
                }
            }
        };

        // Add cleanup method to debounced function
        debouncedFunction.cancel = () => {
            if (timeoutId) {
                clearTimeout(timeoutId);
                this.activeTimeouts.delete(timeoutId);
                timeoutId = null;
            }
        };

        // Add flush method to execute immediately
        debouncedFunction.flush = () => {
            if (timeoutId) {
                clearTimeout(timeoutId);
                this.activeTimeouts.delete(timeoutId);
                timeoutId = null;
                try {
                    func.apply(this, arguments);
                } catch (error) {
                    this._log('error', 'Error in flushed debounced function', {
                        error: error.message,
                        delay
                    });
                }
            }
        };

        return debouncedFunction;
    }

    /**
     * Create a throttled version of a function
     * @param {Function} func - Function to throttle
     * @param {number} delay - Minimum delay between calls in milliseconds
     * @returns {Function} Throttled function
     */
    throttle(func, delay) {
        if (typeof func !== 'function') {
            this._log('error', 'Throttle target must be a function');
            return func;
        }

        let lastCallTime = 0;
        let timeoutId = null;

        const throttledFunction = (...args) => {
            const now = Date.now();
            const timeSinceLastCall = now - lastCallTime;

            if (timeSinceLastCall >= delay) {
                // Execute immediately
                lastCallTime = now;
                try {
                    func.apply(this, args);
                } catch (error) {
                    this._log('error', 'Error in throttled function', {
                        error: error.message,
                        delay
                    });
                }
            } else if (!timeoutId) {
                // Schedule execution
                const remainingDelay = delay - timeSinceLastCall;
                timeoutId = setTimeout(() => {
                    this.activeTimeouts.delete(timeoutId);
                    timeoutId = null;
                    lastCallTime = Date.now();
                    try {
                        func.apply(this, args);
                    } catch (error) {
                        this._log('error', 'Error in delayed throttled function', {
                            error: error.message,
                            delay
                        });
                    }
                }, remainingDelay);

                this.activeTimeouts.add(timeoutId);
            }
        };

        // Add cancel method
        throttledFunction.cancel = () => {
            if (timeoutId) {
                clearTimeout(timeoutId);
                this.activeTimeouts.delete(timeoutId);
                timeoutId = null;
            }
        };

        return throttledFunction;
    }

    /**
     * Clean up all active timeouts
     * @returns {number} Number of timeouts cleared
     */
    cleanup() {
        let clearedCount = 0;

        for (const timeoutId of this.activeTimeouts) {
            try {
                clearTimeout(timeoutId);
                clearedCount++;
            } catch (error) {
                this._log('warn', 'Error clearing timeout', {
                    timeoutId,
                    error: error.message
                });
            }
        }

        this.activeTimeouts.clear();

        this._log('info', 'EventDebouncer cleanup completed', {
            clearedTimeouts: clearedCount
        });

        return clearedCount;
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
            this.options.logger(level, `[EventDebouncer] ${message}`, data);
        } else {
            console.log(`[EventDebouncer] [${level.toUpperCase()}] ${message}`, data);
        }
    }
}

/**
 * CustomEventDispatcher - Dispatches and manages custom events
 * 
 * This class provides a centralized custom event system for communication
 * between different parts of the content script system.
 * 
 * @example
 * ```javascript
 * const dispatcher = new CustomEventDispatcher('netflix');
 * 
 * // Listen for custom events
 * dispatcher.addEventListener('subtitle-found', handleSubtitleFound);
 * 
 * // Dispatch custom events
 * dispatcher.dispatchEvent('subtitle-found', { subtitleData: data });
 * ```
 */
export class CustomEventDispatcher {
    /**
     * Creates a new CustomEventDispatcher instance
     * @param {string} platform - Platform name for event namespacing
     * @param {Object} options - Configuration options
     * @param {Function} [options.logger] - Logger function
     */
    constructor(platform, options = {}) {
        this.platform = platform;
        this.options = {
            logger: null,
            ...options
        };

        // Event listeners storage
        this.eventListeners = new Map();
        this.eventHistory = [];
        this.maxHistorySize = 100;
    }

    /**
     * Add an event listener for custom events
     * @param {string} eventType - Event type
     * @param {Function} listener - Event listener function
     * @param {Object} [options] - Listener options
     * @param {boolean} [options.once=false] - Remove listener after first call
     * @returns {string} Listener ID for removal
     */
    addEventListener(eventType, listener, options = {}) {
        if (typeof listener !== 'function') {
            this._log('error', 'Event listener must be a function', { eventType });
            return null;
        }

        const { once = false } = options;
        const listenerId = `${eventType}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        if (!this.eventListeners.has(eventType)) {
            this.eventListeners.set(eventType, new Map());
        }

        const wrappedListener = (eventData) => {
            try {
                listener(eventData);
                
                if (once) {
                    this.removeEventListener(eventType, listenerId);
                }
            } catch (error) {
                this._log('error', 'Error in custom event listener', {
                    eventType,
                    listenerId,
                    error: error.message
                });
            }
        };

        this.eventListeners.get(eventType).set(listenerId, {
            listener: wrappedListener,
            originalListener: listener,
            once,
            addedAt: Date.now()
        });

        this._log('debug', 'Custom event listener added', {
            eventType,
            listenerId,
            once,
            totalListeners: this.eventListeners.get(eventType).size
        });

        return listenerId;
    }

    /**
     * Remove a custom event listener
     * @param {string} eventType - Event type
     * @param {string} listenerId - Listener ID
     * @returns {boolean} Whether removal was successful
     */
    removeEventListener(eventType, listenerId) {
        const typeListeners = this.eventListeners.get(eventType);
        if (!typeListeners || !typeListeners.has(listenerId)) {
            this._log('warn', 'Custom event listener not found', { eventType, listenerId });
            return false;
        }

        typeListeners.delete(listenerId);
        
        // Clean up empty event type maps
        if (typeListeners.size === 0) {
            this.eventListeners.delete(eventType);
        }

        this._log('debug', 'Custom event listener removed', {
            eventType,
            listenerId,
            remainingListeners: typeListeners.size
        });

        return true;
    }

    /**
     * Dispatch a custom event to all listeners
     * @param {string} eventType - Event type
     * @param {*} eventData - Event data to pass to listeners
     * @param {Object} [options] - Dispatch options
     * @param {boolean} [options.async=false] - Dispatch asynchronously
     * @returns {number} Number of listeners notified
     */
    dispatchEvent(eventType, eventData = null, options = {}) {
        const { async = false } = options;
        const typeListeners = this.eventListeners.get(eventType);
        
        if (!typeListeners || typeListeners.size === 0) {
            this._log('debug', 'No listeners for custom event', { eventType });
            return 0;
        }

        // Add to event history
        this._addToHistory(eventType, eventData);

        const listeners = Array.from(typeListeners.values());
        let notifiedCount = 0;

        const notifyListeners = () => {
            for (const listenerInfo of listeners) {
                try {
                    listenerInfo.listener(eventData);
                    notifiedCount++;
                } catch (error) {
                    this._log('error', 'Error notifying custom event listener', {
                        eventType,
                        error: error.message
                    });
                }
            }
        };

        if (async) {
            setTimeout(notifyListeners, 0);
        } else {
            notifyListeners();
        }

        this._log('debug', 'Custom event dispatched', {
            eventType,
            listenersNotified: notifiedCount,
            async
        });

        return notifiedCount;
    }

    /**
     * Get all listeners for an event type
     * @param {string} eventType - Event type
     * @returns {Object[]} Array of listener information
     */
    getListeners(eventType) {
        const typeListeners = this.eventListeners.get(eventType);
        if (!typeListeners) return [];

        return Array.from(typeListeners.entries()).map(([id, info]) => ({
            id,
            eventType,
            once: info.once,
            addedAt: info.addedAt,
            age: Date.now() - info.addedAt
        }));
    }

    /**
     * Get event history
     * @param {string} [eventType] - Filter by event type
     * @param {number} [limit] - Limit number of results
     * @returns {Object[]} Array of historical events
     */
    getEventHistory(eventType = null, limit = null) {
        let history = this.eventHistory;

        if (eventType) {
            history = history.filter(event => event.type === eventType);
        }

        if (limit && limit > 0) {
            history = history.slice(-limit);
        }

        return history;
    }

    /**
     * Clear event history
     * @param {string} [eventType] - Clear only specific event type
     */
    clearHistory(eventType = null) {
        if (eventType) {
            this.eventHistory = this.eventHistory.filter(event => event.type !== eventType);
        } else {
            this.eventHistory = [];
        }

        this._log('info', 'Event history cleared', { eventType });
    }

    /**
     * Clean up all event listeners and history
     * @returns {number} Number of listeners removed
     */
    cleanup() {
        let totalListeners = 0;
        
        for (const typeListeners of this.eventListeners.values()) {
            totalListeners += typeListeners.size;
        }

        this.eventListeners.clear();
        this.eventHistory = [];

        this._log('info', 'CustomEventDispatcher cleanup completed', {
            listenersRemoved: totalListeners
        });

        return totalListeners;
    }

    /**
     * Add event to history
     * @private
     * @param {string} eventType - Event type
     * @param {*} eventData - Event data
     */
    _addToHistory(eventType, eventData) {
        this.eventHistory.push({
            type: eventType,
            data: eventData,
            timestamp: Date.now(),
            platform: this.platform
        });

        // Limit history size
        if (this.eventHistory.length > this.maxHistorySize) {
            this.eventHistory = this.eventHistory.slice(-this.maxHistorySize);
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
            this.options.logger(level, `[CustomEventDispatcher:${this.platform}] ${message}`, data);
        } else {
            console.log(`[CustomEventDispatcher:${this.platform}] [${level.toUpperCase()}] ${message}`, data);
        }
    }
}

/**
 * Create a pre-configured EventListenerManager for a specific platform
 * @param {string} platform - Platform name
 * @param {Object} [customOptions] - Custom options to override defaults
 * @returns {EventListenerManager} Configured event manager
 */
export function createPlatformEventManager(platform, customOptions = {}) {
    const options = {
        useAbortController: true,
        ...customOptions
    };
    
    return new EventListenerManager(platform, options);
}

/**
 * Create a shared EventDebouncer instance
 * @param {Object} [options] - Configuration options
 * @returns {EventDebouncer} Event debouncer instance
 */
export function createEventDebouncer(options = {}) {
    return new EventDebouncer(options);
}

/**
 * Create a platform-specific CustomEventDispatcher
 * @param {string} platform - Platform name
 * @param {Object} [customOptions] - Custom options to override defaults
 * @returns {CustomEventDispatcher} Configured event dispatcher
 */
export function createPlatformEventDispatcher(platform, customOptions = {}) {
    return new CustomEventDispatcher(platform, customOptions);
}