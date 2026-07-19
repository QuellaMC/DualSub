/**
 * Performance Monitoring and Optimization System
 *
 * Monitors performance metrics, identifies bottlenecks, and provides
 * optimization recommendations for the background services.
 *
 * @author DualSub Extension
 * @version 2.0.0
 */

import { loggingManager } from './loggingManager.js';

/**
 * Performance metric types
 */
export const MetricType = {
    TIMING: 'timing',
    MEMORY: 'memory',
    COUNTER: 'counter',
    GAUGE: 'gauge',
};

/**
 * Performance thresholds
 */
export const PerformanceThresholds = {
    BATCH_PROCESSING_TIME: 100, // ms
    TRANSLATION_TIME: 5000, // ms
    SUBTITLE_PROCESSING_TIME: 2000, // ms
    MEMORY_USAGE_WARNING: 50 * 1024 * 1024, // 50MB
    MEMORY_USAGE_CRITICAL: 100 * 1024 * 1024, // 100MB
    API_CALL_RATE_WARNING: 60, // calls per minute
    ERROR_RATE_WARNING: 5, // errors per minute
};

/**
 * Performance Monitor
 */
class PerformanceMonitor {
    constructor() {
        this.logger = loggingManager.createLogger('PerformanceMonitor');
        this.metrics = new Map();
        this.timers = new Map();
        this.memoryBaseline = this.getMemoryUsage();
        this.startTime = Date.now();
        this.optimizations = new Map();
        this.setupOptimizations();
    }

    /**
     * Setup performance optimizations
     */
    setupOptimizations() {
        // Cache optimization
        this.optimizations.set('cache', {
            enabled: true,
            maxSize: 1000,
            ttl: 300000, // 5 minutes
            cleanupInterval: 60000, // 1 minute
        });

        // Batch processing optimization
        this.optimizations.set('batch', {
            enabled: true,
            maxBatchSize: 10,
            batchTimeout: 100, // ms
            concurrentBatches: 2,
        });

        // Memory optimization
        this.optimizations.set('memory', {
            enabled: true,
            gcThreshold: 50 * 1024 * 1024, // 50MB
            gcInterval: 300000, // 5 minutes
        });
    }

    /**
     * Start timing a performance metric
     * @param {string} name - Metric name
     * @param {Object} context - Additional context
     */
    startTiming(name, context = {}) {
        const timerId = `${name}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this.timers.set(timerId, {
            name,
            startTime: performance.now(),
            context,
        });
        return timerId;
    }

    /**
     * End timing and record metric
     * @param {string} timerId - Timer ID from startTiming
     * @returns {number} Elapsed time in milliseconds
     */
    endTiming(timerId) {
        const timer = this.timers.get(timerId);
        if (!timer) {
            this.logger.warn('Timer not found', { timerId });
            return 0;
        }

        const elapsedTime = performance.now() - timer.startTime;
        this.recordMetric(
            timer.name,
            elapsedTime,
            MetricType.TIMING,
            timer.context
        );
        this.timers.delete(timerId);

        // Check performance thresholds
        this.checkPerformanceThresholds(timer.name, elapsedTime);

        return elapsedTime;
    }

    /**
     * Record a performance metric
     * @param {string} name - Metric name
     * @param {number} value - Metric value
     * @param {string} type - Metric type
     * @param {Object} context - Additional context
     */
    recordMetric(name, value, type = MetricType.GAUGE, context = {}) {
        if (!this.metrics.has(name)) {
            this.metrics.set(name, {
                type,
                values: [],
                total: 0,
                count: 0,
                min: Infinity,
                max: -Infinity,
                average: 0,
            });
        }

        const metric = this.metrics.get(name);
        metric.values.push({ value, timestamp: Date.now(), context });
        metric.total += value;
        metric.count++;
        metric.min = Math.min(metric.min, value);
        metric.max = Math.max(metric.max, value);
        metric.average = metric.total / metric.count;

        // Keep only last 1000 values to prevent memory bloat
        if (metric.values.length > 1000) {
            const removed = metric.values.shift();
            metric.total -= removed.value;
            metric.count--;
            metric.average = metric.total / metric.count;
        }

        this.logger.debug('Performance metric recorded', {
            name,
            value,
            type,
            average: metric.average,
        });
    }

    /**
     * Check performance thresholds and log warnings
     * @param {string} metricName - Metric name
     * @param {number} value - Metric value
     */
    checkPerformanceThresholds(metricName, value) {
        const thresholds = {
            batch_processing: PerformanceThresholds.BATCH_PROCESSING_TIME,
            translation: PerformanceThresholds.TRANSLATION_TIME,
            subtitle_processing: PerformanceThresholds.SUBTITLE_PROCESSING_TIME,
        };

        const threshold = thresholds[metricName];
        if (threshold && value > threshold) {
            this.logger.warn('Performance threshold exceeded', {
                metric: metricName,
                value,
                threshold,
                exceedBy: value - threshold,
            });

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
            metricName === 'batch_processing' &&
            value > PerformanceThresholds.BATCH_PROCESSING_TIME
        ) {
            suggestions.push('Consider reducing batch size');
            suggestions.push('Enable batch processing optimizations');
            suggestions.push('Check network latency');
        }

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
            this.logger.info('Performance optimization suggestions', {
                metric: metricName,
                value,
                suggestions,
            });
        }
    }

    /**
     * Get memory usage information
     * @returns {Object} Memory usage stats
     */
    getMemoryUsage() {
        if (typeof performance !== 'undefined' && performance.memory) {
            return {
                used: performance.memory.usedJSHeapSize,
                total: performance.memory.totalJSHeapSize,
                limit: performance.memory.jsHeapSizeLimit,
                timestamp: Date.now(),
            };
        }
        return null;
    }

    /**
     * Monitor memory usage
     */
    monitorMemory() {
        const memoryUsage = this.getMemoryUsage();
        if (!memoryUsage) return;

        this.recordMetric('memory_usage', memoryUsage.used, MetricType.GAUGE);

        // Check memory thresholds
        if (memoryUsage.used > PerformanceThresholds.MEMORY_USAGE_CRITICAL) {
            this.logger.error('Critical memory usage detected', {
                used: memoryUsage.used,
                total: memoryUsage.total,
                percentage: (memoryUsage.used / memoryUsage.total) * 100,
            });
            this.triggerMemoryOptimization();
        } else if (
            memoryUsage.used > PerformanceThresholds.MEMORY_USAGE_WARNING
        ) {
            this.logger.warn('High memory usage detected', {
                used: memoryUsage.used,
                total: memoryUsage.total,
                percentage: (memoryUsage.used / memoryUsage.total) * 100,
            });
        }
    }

    /**
     * Trigger memory optimization
     */
    triggerMemoryOptimization() {
        this.logger.info('Triggering memory optimization');

        // Clear old metrics
        this.clearOldMetrics();

        // Clear old timers
        this.clearOldTimers();

        // Perform additional memory cleanup if necessary
        this.logger.debug(
            'Memory optimization completed without manual garbage collection'
        );
    }

    /**
     * Clear old metrics to free memory
     */
    clearOldMetrics() {
        const oneHourAgo = Date.now() - 3600000;
        let clearedCount = 0;

        for (const [name, metric] of this.metrics.entries()) {
            const oldValues = metric.values.filter(
                (v) => v.timestamp < oneHourAgo
            );
            if (oldValues.length > 0) {
                metric.values = metric.values.filter(
                    (v) => v.timestamp >= oneHourAgo
                );
                clearedCount += oldValues.length;
            }
        }

        this.logger.debug('Cleared old metrics', { clearedCount });
    }

    /**
     * Clear old timers
     */
    clearOldTimers() {
        const fiveMinutesAgo = Date.now() - 300000;
        let clearedCount = 0;

        for (const [timerId, timer] of this.timers.entries()) {
            if (timer.startTime < fiveMinutesAgo) {
                this.timers.delete(timerId);
                clearedCount++;
            }
        }

        this.logger.debug('Cleared old timers', { clearedCount });
    }

    /**
     * Get performance summary
     * @returns {Object} Performance summary
     */
    getPerformanceSummary() {
        const summary = {
            uptime: Date.now() - this.startTime,
            memoryUsage: this.getMemoryUsage(),
            metrics: {},
            activeTimers: this.timers.size,
            optimizations: Object.fromEntries(this.optimizations),
        };

        // Summarize metrics
        for (const [name, metric] of this.metrics.entries()) {
            summary.metrics[name] = {
                type: metric.type,
                count: metric.count,
                average: metric.average,
                min: metric.min,
                max: metric.max,
                recent: metric.values.slice(-10).map((v) => v.value),
            };
        }

        return summary;
    }

    /**
     * Get performance recommendations
     * @returns {Array} Performance recommendations
     */
    getPerformanceRecommendations() {
        const recommendations = [];
        const summary = this.getPerformanceSummary();

        // Memory recommendations
        if (
            summary.memoryUsage &&
            summary.memoryUsage.used >
                PerformanceThresholds.MEMORY_USAGE_WARNING
        ) {
            recommendations.push({
                type: 'memory',
                priority: 'high',
                message:
                    'High memory usage detected. Consider enabling memory optimizations.',
                action: 'Enable memory cleanup and reduce cache sizes',
            });
        }

        // Timing recommendations
        for (const [name, metric] of Object.entries(summary.metrics)) {
            if (metric.type === MetricType.TIMING && metric.average > 1000) {
                recommendations.push({
                    type: 'performance',
                    priority: 'medium',
                    message: `${name} operations are slow (avg: ${metric.average.toFixed(2)}ms)`,
                    action: 'Consider optimization strategies for this operation',
                });
            }
        }

        // Active timer recommendations
        if (summary.activeTimers > 50) {
            recommendations.push({
                type: 'resource',
                priority: 'medium',
                message: `High number of active timers (${summary.activeTimers})`,
                action: 'Review timer cleanup and consider timer pooling',
            });
        }

        return recommendations;
    }

    /**
     * Start periodic monitoring
     */
    startMonitoring() {
        // Monitor memory every 30 seconds
        setInterval(() => {
            this.monitorMemory();
        }, 30000);

        // Clean up old data every 5 minutes
        setInterval(() => {
            this.clearOldMetrics();
            this.clearOldTimers();
        }, 300000);

        this.logger.info('Performance monitoring started');
    }

    /**
     * Stop monitoring and cleanup
     */
    stopMonitoring() {
        this.metrics.clear();
        this.timers.clear();
        this.logger.info('Performance monitoring stopped');
    }
}

// Export singleton instance
export const performanceMonitor = new PerformanceMonitor();
