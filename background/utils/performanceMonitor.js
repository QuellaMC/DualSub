/**
 * Performance Timing Monitor
 *
 * Tracks in-flight operations and logs immediate warnings when a completed
 * operation exceeds its performance threshold.
 *
 * @author DualSub Extension
 * @version 2.0.0
 */

import { loggingManager } from './loggingManager.js';

/**
 * Performance thresholds
 */
const PerformanceThresholds = {
    TRANSLATION_TIME: 5000, // ms
    SUBTITLE_PROCESSING_TIME: 2000, // ms
};

function logBestEffort(logger, level, ...args) {
    try {
        logger[level](...args);
    } catch {
        // Performance telemetry must never affect translation control flow.
    }
}

/**
 * Performance Monitor
 */
export class PerformanceMonitor {
    constructor() {
        this.logger = loggingManager.createLogger('PerformanceMonitor');
        this.timers = new Map();
    }

    /**
     * Start timing a performance metric
     * @param {string} name - Metric name
     */
    startTiming(name) {
        const timerId = `${name}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this.timers.set(timerId, {
            name,
            startTime: performance.now(),
        });
        return timerId;
    }

    /**
     * End timing and check its performance threshold
     * @param {string} timerId - Timer ID from startTiming
     * @returns {number} Elapsed time in milliseconds
     */
    endTiming(timerId) {
        const timer = this.timers.get(timerId);
        if (!timer) {
            logBestEffort(this.logger, 'warn', 'Timer not found', { timerId });
            return 0;
        }

        this.timers.delete(timerId);
        const elapsedTime = performance.now() - timer.startTime;

        // Check performance thresholds
        this.checkPerformanceThresholds(timer.name, elapsedTime);

        return elapsedTime;
    }

    /**
     * Check performance thresholds and log warnings
     * @param {string} metricName - Metric name
     * @param {number} value - Metric value
     */
    checkPerformanceThresholds(metricName, value) {
        const thresholds = {
            translation: PerformanceThresholds.TRANSLATION_TIME,
            subtitle_processing: PerformanceThresholds.SUBTITLE_PROCESSING_TIME,
        };

        const threshold = thresholds[metricName];
        if (threshold && value > threshold) {
            logBestEffort(
                this.logger,
                'warn',
                'Performance threshold exceeded',
                {
                    metric: metricName,
                    value,
                    threshold,
                    exceedBy: value - threshold,
                }
            );

            // Suggest optimizations
            this.suggestOptimizations(metricName, value);
        }
    }

    /**
     * Suggest performance optimizations
     * @param {string} metricName - Metric name
     * @param {number} value - Metric value
     */
    suggestOptimizations(metricName, value) {
        const suggestions = [];

        if (
            metricName === 'translation' &&
            value > PerformanceThresholds.TRANSLATION_TIME
        ) {
            suggestions.push('Enable translation caching');
            suggestions.push('Consider switching to a faster provider');
            suggestions.push('Implement request timeout');
        }

        if (
            metricName === 'subtitle_processing' &&
            value > PerformanceThresholds.SUBTITLE_PROCESSING_TIME
        ) {
            suggestions.push('Enable subtitle caching');
            suggestions.push('Optimize VTT parsing');
            suggestions.push('Use shared utility integration');
        }

        if (suggestions.length > 0) {
            logBestEffort(
                this.logger,
                'info',
                'Performance optimization suggestions',
                {
                    metric: metricName,
                    value,
                    suggestions,
                }
            );
        }
    }
}
// Export singleton instance
export const performanceMonitor = new PerformanceMonitor();
