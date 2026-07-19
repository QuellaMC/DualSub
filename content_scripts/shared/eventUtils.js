/**
 * Provides shared event listener management and cleanup utilities, designed to be
 * reusable across different streaming platforms. This module includes robust event
 * handling with automatic cleanup, debouncing, and custom event dispatching to
 * prevent memory leaks and improve performance.
 *
 * @author DualSub Extension
 * @version 1.0.0
 */

/**
 * Manages event listeners with automatic cleanup to prevent memory leaks.
 * This class provides centralized event listener management with support for
 * AbortController-based cleanup for modern, efficient resource management.
 */
export class EventListenerManager {
    /**
     * Creates a new `EventListenerManager` instance.
     * @param {string} platform - The platform name for logging purposes.
     * @param {Object} [options={}] - Configuration options.
     * @param {Function} [options.logger] - A logger function.
     * @param {boolean} [options.useAbortController=true] - Whether to use `AbortController` for cleanup.
     */
    constructor(platform, options = {}) {
        this.platform = platform;
        this.options = {
            logger: null,
            useAbortController: true,
            ...options,
        };

        // Event listener tracking
        this.listeners = new Map();
        this.abortController = null;
        this.listenerCount = 0;

        // Initialize AbortController if supported and enabled
        if (
            this.options.useAbortController &&
            typeof AbortController !== 'undefined'
        ) {
            this.abortController = new AbortController();
        }
    }

    /**
     * Adds an event listener with automatic tracking for cleanup.
     * @param {EventTarget} target - The event target (e.g., element, `document`, `window`).
     * @param {string} type - The event type (e.g., 'click', 'keydown').
     * @param {Function} listener - The event listener function.
     * @param {Object|boolean} [options={}] - Event listener options.
     * @returns {string|null} A unique listener ID for manual removal, or `null` on failure.
     */
    addEventListener(target, type, listener, options = {}) {
        if (!target || typeof listener !== 'function') {
            this._log('error', 'Invalid addEventListener parameters', {
                hasTarget: !!target,
                listenerType: typeof listener,
                eventType: type,
            });
            return null;
        }

        try {
            const listenerId = this._generateListenerId();

            // Prepare options with AbortController signal if available
            const eventOptions = this._prepareEventOptions(options);

            // Wrap listener for error handling and logging
            const wrappedListener = this._wrapListener(
                listener,
                type,
                listenerId
            );

            // Add event listener
            target.addEventListener(type, wrappedListener, eventOptions);

            // Track listener for cleanup
            this.listeners.set(listenerId, {
                target,
                type,
                listener: wrappedListener,
                originalListener: listener,
                options: eventOptions,
                addedAt: Date.now(),
            });

            this._log('debug', 'Event listener added', {
                listenerId,
                eventType: type,
                targetType: this._getTargetType(target),
                totalListeners: this.listeners.size,
            });

            return listenerId;
        } catch (error) {
            this._log('error', 'Error adding event listener.', {
                error: error.message,
                eventType: type,
                targetType: this._getTargetType(target),
            });
            return null;
        }
    }

    /**
     * Removes a specific event listener by its ID.
     * @param {string} listenerId - The ID of the listener to remove.
     * @returns {boolean} `true` if the removal was successful, otherwise `false`.
     */
    removeEventListener(listenerId) {
        const listenerInfo = this.listeners.get(listenerId);
        if (!listenerInfo) {
            this._log('warn', 'Listener not found for removal.', {
                listenerId,
            });
            return false;
        }

        try {
            const { target, type, listener } = listenerInfo;
            target.removeEventListener(type, listener);
            this.listeners.delete(listenerId);

            this._log('debug', 'Event listener removed.', {
                listenerId,
                eventType: type,
                remainingListeners: this.listeners.size,
            });

            return true;
        } catch (error) {
            this._log('error', 'Error removing event listener.', {
                error: error.message,
                listenerId,
            });
            return false;
        }
    }

    /**
     * Removes all event listeners for a specific target.
     * @param {EventTarget} target - The event target.
     * @returns {number} The number of listeners that were removed.
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

        this._log('info', 'Removed listeners for target.', {
            targetType: this._getTargetType(target),
            removedCount,
        });

        return removedCount;
    }

    /**
     * Removes all event listeners of a specific type.
     * @param {string} eventType - The event type.
     * @returns {number} The number of listeners that were removed.
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

        this._log('info', 'Removed listeners by type.', {
            eventType,
            removedCount,
        });

        return removedCount;
    }

    /**
     * Gets information about all active listeners.
     * @returns {Object[]} An array of listener information objects.
     */
    getActiveListeners() {
        return Array.from(this.listeners.entries()).map(([id, info]) => ({
            id,
            type: info.type,
            targetType: this._getTargetType(info.target),
            addedAt: info.addedAt,
            age: Date.now() - info.addedAt,
        }));
    }

    /**
     * Checks if a specific listener is active.
     * @param {string} listenerId - The ID of the listener to check.
     * @returns {boolean} `true` if the listener is active, otherwise `false`.
     */
    hasListener(listenerId) {
        return this.listeners.has(listenerId);
    }

    /**
     * Gets the number of active listeners.
     * @returns {number} The number of active listeners.
     */
    getListenerCount() {
        return this.listeners.size;
    }

    /**
     * Cleans up all registered event listeners.
     * @returns {number} The number of listeners that were cleaned up.
     */
    cleanup() {
        const initialCount = this.listeners.size;

        // If using AbortController, abort all listeners at once
        if (this.abortController) {
            try {
                this.abortController.abort();
                this._log('info', 'Aborted all listeners via AbortController.');
            } catch (error) {
                this._log('warn', 'Error aborting listeners.', {
                    error: error.message,
                });
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
                    this._log('warn', 'Error manually removing listener.', {
                        listenerId,
                        error: error.message,
                    });
                }
            }
        }

        // Clear tracking
        this.listeners.clear();
        this.abortController = null;

        this._log('info', 'Event listener cleanup completed.', {
            initialCount,
            manuallyRemoved,
            abortControllerUsed: !!this.abortController,
        });

        return initialCount;
    }

    /**
     * Generates a unique listener ID.
     * @private
     * @returns {string} A unique listener ID.
     */
    _generateListenerId() {
        return `${this.platform}-listener-${++this.listenerCount}-${Date.now()}`;
    }

    /**
     * Prepares event options, adding an `AbortController` signal if available.
     * @private
     * @param {Object|boolean} options - The original event listener options.
     * @returns {Object} The prepared options.
     */
    _prepareEventOptions(options) {
        if (typeof options === 'boolean') {
            options = { capture: options };
        }

        if (this.abortController && !options.signal) {
            options = { ...options, signal: this.abortController.signal };
        }

        return options;
    }

    /**
     * Wraps a listener function with error handling and logging.
     * @private
     * @param {Function} listener - The original listener function.
     * @param {string} eventType - The event type.
     * @param {string} listenerId - The listener ID.
     * @returns {Function} The wrapped listener function.
     */
    _wrapListener(listener, eventType, listenerId) {
        return (event) => {
            try {
                listener(event);
            } catch (error) {
                this._log('error', 'Error in event listener.', {
                    listenerId,
                    eventType,
                    error: error.message,
                    stack: error.stack,
                });
            }
        };
    }

    /**
     * Gets a descriptive type for an event target.
     * @private
     * @param {EventTarget} target - The event target.
     * @returns {string} A description of the target type.
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
     * Logs messages with a fallback to the console.
     * @private
     * @param {string} level - The log level.
     * @param {string} message - The log message.
     * @param {Object} [data] - Additional data to log.
     */
    _log(level, message, data = {}) {
        if (this.options.logger) {
            this.options.logger(
                level,
                `[EventListenerManager:${this.platform}] ${message}`,
                data
            );
        } else {
            console.log(
                `[EventListenerManager:${this.platform}] [${level.toUpperCase()}] ${message}`,
                data
            );
        }
    }
}

/**
 * Debounces event handlers to prevent excessive calls, which is useful for events
 * like scroll, resize, and input that can fire rapidly.
 */
export class EventDebouncer {
    /**
     * Creates a new `EventDebouncer` instance.
     * @param {Object} [options={}] - Configuration options.
     * @param {Function} [options.logger] - A logger function.
     */
    constructor(options = {}) {
        this.options = {
            logger: null,
            ...options,
        };

        // Track active timeouts for cleanup
        this.activeTimeouts = new Set();
    }

    /**
     * Creates a debounced version of a function that delays its execution.
     * @param {Function} func - The function to debounce.
     * @param {number} delay - The delay in milliseconds.
     * @param {Object} [options={}] - Debounce options.
     * @param {boolean} [options.immediate=false] - `true` to execute immediately on the first call.
     * @returns {Function} The debounced function.
     */
    debounce(func, delay, options = {}) {
        if (typeof func !== 'function') {
            this._log('error', 'Debounce target must be a function');
            return func;
        }

        const { immediate = false } = options;
        let timeoutId = null;

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

                if (!immediate) {
                    try {
                        func.apply(this, args);
                    } catch (error) {
                        this._log('error', 'Error in debounced function.', {
                            error: error.message,
                            delay,
                        });
                    }
                }
            }, delay);

            this.activeTimeouts.add(timeoutId);

            // Execute immediately if configured
            if (callNow) {
                try {
                    func.apply(this, args);
                } catch (error) {
                    this._log(
                        'error',
                        'Error in immediate debounced function.',
                        {
                            error: error.message,
                            delay,
                        }
                    );
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
                    this._log('error', 'Error in flushed debounced function.', {
                        error: error.message,
                        delay,
                    });
                }
            }
        };

        return debouncedFunction;
    }

    /**
     * Creates a throttled version of a function that limits its execution rate.
     * @param {Function} func - The function to throttle.
     * @param {number} delay - The minimum delay between calls in milliseconds.
     * @returns {Function} The throttled function.
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
                    this._log('error', 'Error in throttled function.', {
                        error: error.message,
                        delay,
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
                        this._log(
                            'error',
                            'Error in delayed throttled function.',
                            {
                                error: error.message,
                                delay,
                            }
                        );
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
     * Cleans up all active timeouts.
     * @returns {number} The number of timeouts that were cleared.
     */
    cleanup() {
        let clearedCount = 0;

        for (const timeoutId of this.activeTimeouts) {
            try {
                clearTimeout(timeoutId);
                clearedCount++;
            } catch (error) {
                this._log('warn', 'Error clearing timeout.', {
                    timeoutId,
                    error: error.message,
                });
            }
        }

        this.activeTimeouts.clear();

        this._log('info', 'EventDebouncer cleanup completed.', {
            clearedTimeouts: clearedCount,
        });

        return clearedCount;
    }

    /**
     * Logs messages with a fallback to the console.
     * @private
     * @param {string} level - The log level.
     * @param {string} message - The log message.
     * @param {Object} [data] - Additional data to log.
     */
    _log(level, message, data = {}) {
        if (this.options.logger) {
            this.options.logger(level, `[EventDebouncer] ${message}`, data);
        } else {
            console.log(
                `[EventDebouncer] [${level.toUpperCase()}] ${message}`,
                data
            );
        }
    }
}

/**
 * Dispatches and manages custom events, providing a centralized system for
 * communication between different parts of the content script.
 */
export class CustomEventDispatcher {
    /**
     * Creates a new `CustomEventDispatcher` instance.
     * @param {string} platform - The platform name for event namespacing.
     * @param {Object} [options={}] - Configuration options.
     * @param {Function} [options.logger] - A logger function.
     */
    constructor(platform, options = {}) {
        this.platform = platform;
        this.options = {
            logger: null,
            ...options,
        };

        // Event listeners storage
        this.eventListeners = new Map();
        this.eventHistory = [];
        this.maxHistorySize = 100;
    }

    /**
     * Adds an event listener for custom events.
     * @param {string} eventType - The event type to listen for.
     * @param {Function} listener - The event listener function.
     * @param {Object} [options={}] - Listener options.
     * @param {boolean} [options.once=false] - `true` to remove the listener after its first execution.
     * @returns {string|null} A unique listener ID for removal, or `null` on failure.
     */
    addEventListener(eventType, listener, options = {}) {
        if (typeof listener !== 'function') {
            this._log('error', 'Event listener must be a function', {
                eventType,
            });
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
                this._log('error', 'Error in custom event listener.', {
                    eventType,
                    listenerId,
                    error: error.message,
                });
            }
        };

        this.eventListeners.get(eventType).set(listenerId, {
            listener: wrappedListener,
            originalListener: listener,
            once,
            addedAt: Date.now(),
        });

        this._log('debug', 'Custom event listener added.', {
            eventType,
            listenerId,
            once,
            totalListeners: this.eventListeners.get(eventType).size,
        });

        return listenerId;
    }

    /**
     * Removes a custom event listener.
     * @param {string} eventType - The event type.
     * @param {string} listenerId - The ID of the listener to remove.
     * @returns {boolean} `true` if the removal was successful, otherwise `false`.
     */
    removeEventListener(eventType, listenerId) {
        const typeListeners = this.eventListeners.get(eventType);
        if (!typeListeners || !typeListeners.has(listenerId)) {
            this._log('warn', 'Custom event listener not found.', {
                eventType,
                listenerId,
            });
            return false;
        }

        typeListeners.delete(listenerId);

        // Clean up empty event type maps
        if (typeListeners.size === 0) {
            this.eventListeners.delete(eventType);
        }

        this._log('debug', 'Custom event listener removed.', {
            eventType,
            listenerId,
            remainingListeners: typeListeners.size,
        });

        return true;
    }

    /**
     * Dispatches a custom event to all registered listeners.
     * @param {string} eventType - The event type.
     * @param {*} [eventData=null] - The event data to pass to listeners.
     * @param {Object} [options={}] - Dispatch options.
     * @param {boolean} [options.async=false] - `true` to dispatch asynchronously.
     * @returns {number} The number of listeners that were notified.
     */
    dispatchEvent(eventType, eventData = null, options = {}) {
        const { async = false } = options;
        const typeListeners = this.eventListeners.get(eventType);

        if (!typeListeners || typeListeners.size === 0) {
            this._log('debug', 'No listeners for custom event.', { eventType });
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
                    this._log(
                        'error',
                        'Error notifying custom event listener.',
                        {
                            eventType,
                            error: error.message,
                        }
                    );
                }
            }
        };

        if (async) {
            setTimeout(notifyListeners, 0);
        } else {
            notifyListeners();
        }

        this._log('debug', 'Custom event dispatched.', {
            eventType,
            listenersNotified: notifiedCount,
            async,
        });

        return notifiedCount;
    }

    /**
     * Gets all listeners for a specific event type.
     * @param {string} eventType - The event type.
     * @returns {Object[]} An array of listener information.
     */
    getListeners(eventType) {
        const typeListeners = this.eventListeners.get(eventType);
        if (!typeListeners) return [];

        return Array.from(typeListeners.entries()).map(([id, info]) => ({
            id,
            eventType,
            once: info.once,
            addedAt: info.addedAt,
            age: Date.now() - info.addedAt,
        }));
    }

    /**
     * Gets the event history.
     * @param {string} [eventType=null] - Filters the history by event type.
     * @param {number} [limit=null] - Limits the number of results.
     * @returns {Object[]} An array of historical events.
     */
    getEventHistory(eventType = null, limit = null) {
        let history = this.eventHistory;

        if (eventType) {
            history = history.filter((event) => event.type === eventType);
        }

        if (limit && limit > 0) {
            history = history.slice(-limit);
        }

        return history;
    }

    /**
     * Clears the event history.
     * @param {string} [eventType=null] - Clears only a specific event type from the history.
     */
    clearHistory(eventType = null) {
        if (eventType) {
            this.eventHistory = this.eventHistory.filter(
                (event) => event.type !== eventType
            );
        } else {
            this.eventHistory = [];
        }

        this._log('info', 'Event history cleared.', { eventType });
    }

    /**
     * Cleans up all event listeners and clears the event history.
     * @returns {number} The number of listeners that were removed.
     */
    cleanup() {
        let totalListeners = 0;

        for (const typeListeners of this.eventListeners.values()) {
            totalListeners += typeListeners.size;
        }

        this.eventListeners.clear();
        this.eventHistory = [];

        this._log('info', 'CustomEventDispatcher cleanup completed.', {
            listenersRemoved: totalListeners,
        });

        return totalListeners;
    }

    /**
     * Adds an event to the history.
     * @private
     * @param {string} eventType - The event type.
     * @param {*} eventData - The event data.
     */
    _addToHistory(eventType, eventData) {
        this.eventHistory.push({
            type: eventType,
            data: eventData,
            timestamp: Date.now(),
            platform: this.platform,
        });

        // Limit history size
        if (this.eventHistory.length > this.maxHistorySize) {
            this.eventHistory = this.eventHistory.slice(-this.maxHistorySize);
        }
    }

    /**
     * Logs messages with a fallback to the console.
     * @private
     * @param {string} level - The log level.
     * @param {string} message - The log message.
     * @param {Object} [data] - Additional data to log.
     */
    _log(level, message, data = {}) {
        if (this.options.logger) {
            this.options.logger(
                level,
                `[CustomEventDispatcher:${this.platform}] ${message}`,
                data
            );
        } else {
            console.log(
                `[CustomEventDispatcher:${this.platform}] [${level.toUpperCase()}] ${message}`,
                data
            );
        }
    }
}

/**
 * Creates a pre-configured `EventListenerManager` for a specific platform.
 * @param {string} platform - The platform name.
 * @param {Object} [customOptions={}] - Custom options to override the defaults.
 * @returns {EventListenerManager} A configured `EventListenerManager` instance.
 */
export function createPlatformEventManager(platform, customOptions = {}) {
    const options = {
        useAbortController: true,
        ...customOptions,
    };

    return new EventListenerManager(platform, options);
}

/**
 * Creates a shared `EventDebouncer` instance.
 * @param {Object} [options={}] - Configuration options.
 * @returns {EventDebouncer} An `EventDebouncer` instance.
 */
export function createEventDebouncer(options = {}) {
    return new EventDebouncer(options);
}

/**
 * Creates a platform-specific `CustomEventDispatcher`.
 * @param {string} platform - The platform name.
 * @param {Object} [customOptions={}] - Custom options to override the defaults.
 * @returns {CustomEventDispatcher} A configured `CustomEventDispatcher` instance.
 */
export function createPlatformEventDispatcher(platform, customOptions = {}) {
    return new CustomEventDispatcher(platform, customOptions);
}
