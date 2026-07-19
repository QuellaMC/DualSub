import { jest } from '@jest/globals';
import { PerformanceMonitor } from './performanceMonitor.js';

describe('PerformanceMonitor lifecycle', () => {
    afterEach(() => {
        jest.restoreAllMocks();
        jest.useRealTimers();
    });

    it('constructs without recurring monitoring timers', () => {
        jest.useFakeTimers();
        const monitor = new PerformanceMonitor();

        expect(jest.getTimerCount()).toBe(0);
        expect(monitor.startMonitoring).toBeUndefined();
        expect(monitor.stopMonitoring).toBeUndefined();
    });

    it('does not expose retained telemetry or memory polling APIs', () => {
        const monitor = new PerformanceMonitor();

        expect(monitor.recordMetric).toBeUndefined();
        expect(monitor.getPerformanceSummary).toBeUndefined();
        expect(monitor.getPerformanceRecommendations).toBeUndefined();
        expect(monitor.monitorMemory).toBeUndefined();
        expect(monitor).not.toHaveProperty('metrics');
        expect(monitor).not.toHaveProperty('optimizations');
        expect(monitor).not.toHaveProperty('monitoringIntervals');
    });

    it('deletes an active timer when timing ends', () => {
        jest.spyOn(performance, 'now')
            .mockReturnValueOnce(100)
            .mockReturnValueOnce(250);
        const monitor = new PerformanceMonitor();
        const timerId = monitor.startTiming('translation');

        expect(monitor.endTiming(timerId)).toBe(150);
        expect(monitor.timers.has(timerId)).toBe(false);
    });

    it('logs a warning and suggestions when a timing exceeds its threshold', () => {
        jest.spyOn(performance, 'now')
            .mockReturnValueOnce(100)
            .mockReturnValueOnce(5_201);
        const monitor = new PerformanceMonitor();
        const warn = jest.spyOn(monitor.logger, 'warn').mockImplementation();
        const info = jest.spyOn(monitor.logger, 'info').mockImplementation();
        const timerId = monitor.startTiming('translation');

        monitor.endTiming(timerId);

        expect(warn).toHaveBeenCalledWith('Performance threshold exceeded', {
            metric: 'translation',
            value: 5_101,
            threshold: 5_000,
            exceedBy: 101,
        });
        expect(info).toHaveBeenCalledWith(
            'Performance optimization suggestions',
            {
                metric: 'translation',
                value: 5_101,
                suggestions: [
                    'Enable translation caching',
                    'Consider switching to a faster provider',
                    'Implement request timeout',
                ],
            }
        );
    });

    it('contains threshold logger failures after deleting the timer', () => {
        jest.spyOn(performance, 'now')
            .mockReturnValueOnce(100)
            .mockReturnValueOnce(5_201);
        const monitor = new PerformanceMonitor();
        const warn = jest
            .spyOn(monitor.logger, 'warn')
            .mockImplementation(() => {
                throw new Error('warning logger unavailable');
            });
        const info = jest
            .spyOn(monitor.logger, 'info')
            .mockImplementation(() => {
                throw new Error('info logger unavailable');
            });
        const timerId = monitor.startTiming('translation');

        expect(monitor.endTiming(timerId)).toBe(5_101);
        expect(monitor.timers.has(timerId)).toBe(false);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(info).toHaveBeenCalledTimes(1);
    });

    it('safely ignores unknown and already-ended timer IDs', () => {
        jest.spyOn(performance, 'now')
            .mockReturnValueOnce(100)
            .mockReturnValueOnce(200);
        const monitor = new PerformanceMonitor();
        const warn = jest.spyOn(monitor.logger, 'warn').mockImplementation();

        expect(monitor.endTiming('unknown-timer')).toBe(0);

        const timerId = monitor.startTiming('translation');
        expect(monitor.endTiming(timerId)).toBe(100);
        expect(monitor.endTiming(timerId)).toBe(0);
        expect(warn).toHaveBeenNthCalledWith(1, 'Timer not found', {
            timerId: 'unknown-timer',
        });
        expect(warn).toHaveBeenNthCalledWith(2, 'Timer not found', {
            timerId,
        });
    });

    it('returns zero for an unknown timer when warning logging throws', () => {
        const monitor = new PerformanceMonitor();
        jest.spyOn(monitor.logger, 'warn').mockImplementation(() => {
            throw new Error('logger unavailable');
        });

        expect(monitor.endTiming('unknown-timer')).toBe(0);
    });
});
