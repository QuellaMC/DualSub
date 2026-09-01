import { loggingManager } from './loggingManager.js';

const PERFORMANCE_THRESHOLDS = {
    translation: 5000,
    subtitle_processing: 2000,
};

export class PerformanceMonitor {
    constructor() {
        this.logger = loggingManager.createLogger('PerformanceMonitor');
        this.timers = new Map();
        this.nextTimerId = 1;
    }

    startTiming(name) {
        const timerId = this.nextTimerId++;
        this.timers.set(timerId, { name, startedAt: performance.now() });
        return timerId;
    }

    endTiming(timerId) {
        const timer = this.timers.get(timerId);
        if (!timer) return 0;

        this.timers.delete(timerId);
        const elapsedTime = performance.now() - timer.startedAt;
        const threshold = PERFORMANCE_THRESHOLDS[timer.name];
        if (threshold !== undefined && elapsedTime > threshold) {
            try {
                this.logger.warn('Performance threshold exceeded', {
                    metric: timer.name,
                    value: elapsedTime,
                    threshold,
                });
            } catch {
                // Timing must not affect the operation being measured.
            }
        }
        return elapsedTime;
    }
}

export const performanceMonitor = new PerformanceMonitor();
