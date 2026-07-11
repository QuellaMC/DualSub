import { jest } from '@jest/globals';
import { PerformanceMonitor } from './performanceMonitor.js';

describe('PerformanceMonitor lifecycle', () => {
    afterEach(() => {
        jest.useRealTimers();
    });

    it('uses epoch timestamps when expiring active timers', () => {
        const monitor = new PerformanceMonitor();
        const timerId = monitor.startTiming('translation');
        const timer = monitor.timers.get(timerId);

        timer.startedAt = Date.now() - 299_999;
        monitor.clearOldTimers();
        expect(monitor.timers.has(timerId)).toBe(true);

        timer.startedAt = Date.now() - 300_001;
        monitor.clearOldTimers();
        expect(monitor.timers.has(timerId)).toBe(false);
    });

    it('starts one pair of monitoring intervals and stops both', () => {
        jest.useFakeTimers();
        const monitor = new PerformanceMonitor();

        monitor.startMonitoring();
        monitor.startMonitoring();
        expect(jest.getTimerCount()).toBe(2);

        monitor.stopMonitoring();
        expect(jest.getTimerCount()).toBe(0);
    });

    it('recomputes aggregates after removing expired observations', () => {
        const monitor = new PerformanceMonitor();
        monitor.recordMetric('translation', 10);
        monitor.recordMetric('translation', 30);
        const metric = monitor.metrics.get('translation');
        metric.values[0].timestamp = Date.now() - 3_600_001;

        monitor.clearOldMetrics();

        expect(metric).toMatchObject({
            total: 30,
            count: 1,
            min: 30,
            max: 30,
            average: 30,
        });
    });

    it('recomputes extrema when bounded history evicts an old outlier', () => {
        const monitor = new PerformanceMonitor();
        monitor.recordMetric('translation', -1_000);
        for (let index = 0; index < 1_000; index++) {
            monitor.recordMetric('translation', 5);
        }

        expect(monitor.metrics.get('translation')).toMatchObject({
            total: 5_000,
            count: 1_000,
            min: 5,
            max: 5,
            average: 5,
        });
    });
});
