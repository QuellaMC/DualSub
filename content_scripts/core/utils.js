/**
 * Runtime utilities shared by the active content-script lifecycle.
 *
 * Keep this module limited to utilities imported by production code.
 */

/**
 * Injects a script into the page.
 * @param {string} scriptSrc - Script source URL
 * @param {string} scriptId - Script element ID
 * @param {Function} onLoad - Load success callback
 * @param {Function} onError - Load error callback
 * @param {Function} logger - Logger function
 * @param {boolean} isModule - Whether the script should be treated as a module
 * @returns {boolean} Whether injection was attempted
 */
export function injectScript(
    scriptSrc,
    scriptId,
    onLoad = () => {},
    onError = () => {},
    logger = console.log,
    isModule = false
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
        if (isModule) {
            script.type = 'module';
        }
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
 * A buffer for managing early events with memory management.
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
     * Adds an event to the buffer with size and age management.
     * @param {Object} eventData - The event data to buffer.
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
            this.logger(
                `Event buffer size limit (${this.maxSize}) reached, removing oldest events`
            );
            // Remove oldest 25% of events to make room
            const removeCount = Math.floor(this.maxSize * 0.25);
            this.buffer.splice(0, removeCount);
        }

        this.buffer.push(eventData);
        this.logger(
            `Event buffered. Buffer size: ${this.buffer.length}/${this.maxSize}`
        );
    }

    /**
     * Processes all buffered events.
     * @param {Function} processor - The function to process each event.
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
                    this.logger(
                        `Skipping invalid event at index ${index}:`,
                        eventData
                    );
                    skippedCount++;
                    return;
                }

                // Check if event is still relevant (not too old)
                const eventAge = Date.now() - (eventData.timestamp || 0);
                if (eventAge > this.maxAge) {
                    this.logger(
                        `Skipping stale event at index ${index}, age: ${eventAge}ms`
                    );
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

        this.logger(
            `Event processing completed: ${processedCount} processed, ${skippedCount} skipped, ${errorCount} errors`
        );
        this.isProcessing = false;
    }

    /**
     * Clears all buffered events.
     */
    clear() {
        const count = this.buffer.length;
        this.buffer = [];
        this.logger(`Cleared ${count} buffered events`);
    }

    /**
     * Gets the current size of the buffer.
     * @returns {number} The number of buffered events.
     */
    size() {
        return this.buffer.length;
    }

    /**
     * Gets statistics about the buffer.
     * @returns {Object} An object containing buffer statistics.
     */
    getStats() {
        const now = Date.now();
        const ages = this.buffer.map((event) => now - (event.timestamp || 0));

        return {
            size: this.buffer.length,
            maxSize: this.maxSize,
            maxAge: this.maxAge,
            oldestEventAge: ages.length > 0 ? Math.max(...ages) : 0,
            newestEventAge: ages.length > 0 ? Math.min(...ages) : 0,
            averageAge:
                ages.length > 0
                    ? ages.reduce((sum, age) => sum + age, 0) / ages.length
                    : 0,
            bufferAge: now - this.createdAt,
        };
    }

    /**
     * Cleans old events from buffer using more efficient approach
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
     * Checks if the buffer needs maintenance.
     * @returns {boolean} `true` if maintenance is needed, otherwise `false`.
     */
    needsMaintenance() {
        const stats = this.getStats();
        return (
            stats.size > this.maxSize * 0.8 ||
            stats.oldestEventAge > this.maxAge * 0.8
        );
    }

    /**
     * Performs maintenance on the buffer by cleaning old and oversized events.
     */
    performMaintenance() {
        this._cleanOldEvents();

        // If still too large, remove oldest events
        if (this.buffer.length > this.maxSize * 0.8) {
            const targetSize = Math.floor(this.maxSize * 0.6);
            const removeCount = this.buffer.length - targetSize;
            if (removeCount > 0) {
                this.buffer.splice(0, removeCount);
                this.logger(
                    `Maintenance: removed ${removeCount} oldest events, buffer size now: ${this.buffer.length}`
                );
            }
        }
    }
}
/**
 * A fallback logging helper for when the logger is not yet initialized.
 * @param {string} level - The log level ('info', 'warn', 'error', 'debug').
 * @param {string} message - The log message.
 * @param {Object} [data={}] - Additional data to log.
 * @param {string} [prefix='ContentScript'] - The log prefix.
 */
export function logWithFallback(
    level,
    message,
    data = {},
    prefix = 'ContentScript'
) {
    console.log(`[${prefix}] [${level.toUpperCase()}] ${message}`, data);
}
/**
 * A memory-safe interval manager with automatic cleanup and monitoring.
 */
export class IntervalManager {
    constructor() {
        this.intervals = new Map();
        this.createdAt = Date.now();
        this.maxIntervals = 50; // Prevent runaway interval creation
    }

    /**
     * Sets an interval with automatic cleanup.
     * @param {string} name - A name for the interval for reference.
     * @param {Function} callback - The function to execute.
     * @param {number} delay - The delay in milliseconds.
     * @param {Object} [options={}] - Additional options.
     * @param {number} [options.maxExecutions] - The maximum number of executions.
     * @param {number} [options.timeout] - An auto-clear timeout.
     * @returns {boolean} `true` if the interval was set successfully.
     */
    set(name, callback, delay, options = {}) {
        // Prevent too many intervals
        if (this.intervals.size >= this.maxIntervals) {
            console.warn(
                `IntervalManager: Maximum intervals (${this.maxIntervals}) reached`
            );
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
                timeout,
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
     * Clears a specific interval.
     * @param {string} name - The name of the interval.
     */
    clear(name) {
        const intervalInfo = this.intervals.get(name);
        if (intervalInfo) {
            clearInterval(intervalInfo.id);
            this.intervals.delete(name);
        }
    }

    /**
     * Clears all managed intervals.
     */
    clearAll() {
        for (const intervalInfo of this.intervals.values()) {
            clearInterval(intervalInfo.id);
        }
        this.intervals.clear();
    }

    /**
     * Gets the number of active intervals.
     * @returns {number} The number of active intervals.
     */
    count() {
        return this.intervals.size;
    }

    /**
     * Gets statistics about the active intervals.
     * @returns {Object} An object containing statistics.
     */
    getStats() {
        const now = Date.now();
        const intervals = Array.from(this.intervals.values());

        return {
            count: this.intervals.size,
            maxIntervals: this.maxIntervals,
            oldestInterval:
                intervals.length > 0
                    ? Math.min(...intervals.map((i) => i.createdAt))
                    : null,
            averageAge:
                intervals.length > 0
                    ? intervals.reduce(
                          (sum, i) => sum + (now - i.createdAt),
                          0
                      ) / intervals.length
                    : 0,
            managerAge: now - this.createdAt,
        };
    }

    /**
     * Cleans up stale intervals that are older than the specified age.
     * @param {number} [maxAge=300000] - The maximum age in milliseconds.
     * @returns {number} The number of intervals that were cleared.
     */
    cleanupStale(maxAge = 300000) {
        // 5 minutes default
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
     * Checks if an interval exists.
     * @param {string} name - The name of the interval.
     * @returns {boolean} `true` if the interval exists.
     */
    has(name) {
        return this.intervals.has(name);
    }

    /**
     * Gets information about a specific interval.
     * @param {string} name - The name of the interval.
     * @returns {Object|null} An object with interval information, or `null`.
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
            timeout: intervalInfo.timeout,
        };
    }
}
