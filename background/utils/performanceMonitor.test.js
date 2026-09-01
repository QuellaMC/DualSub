import { jest } from '@jest/globals';
import { PerformanceMonitor } from './performanceMonitor.js';

describe('PerformanceMonitor', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('measures an operation and releases its timer', () => {
        jest.spyOn(performance, 'now')
            .mockReturnValueOnce(100)
            .mockReturnValueOnce(250);
        const monitor = new PerformanceMonitor();
        const timerId = monitor.startTiming('translation');

        expect(monitor.endTiming(timerId)).toBe(150);
        expect(monitor.timers.size).toBe(0);
    });

    test('warns when a known operation exceeds its threshold', () => {
        jest.spyOn(performance, 'now')
            .mockReturnValueOnce(100)
            .mockReturnValueOnce(5200);
        const monitor = new PerformanceMonitor();
        const warn = jest
            .spyOn(monitor.logger, 'warn')
            .mockImplementation(() => {});

        monitor.endTiming(monitor.startTiming('translation'));

        expect(warn).toHaveBeenCalledWith('Performance threshold exceeded', {
            metric: 'translation',
            value: 5100,
            threshold: 5000,
        });
    });

    test('does not warn for fast or unconfigured operations', () => {
        jest.spyOn(performance, 'now')
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(10)
            .mockReturnValueOnce(20)
            .mockReturnValueOnce(20000);
        const monitor = new PerformanceMonitor();
        const warn = jest
            .spyOn(monitor.logger, 'warn')
            .mockImplementation(() => {});

        monitor.endTiming(monitor.startTiming('translation'));
        monitor.endTiming(monitor.startTiming('custom'));

        expect(warn).not.toHaveBeenCalled();
    });

    test('returns zero for an unknown or already-ended timer', () => {
        const monitor = new PerformanceMonitor();

        expect(monitor.endTiming(999)).toBe(0);
        expect(monitor.endTiming(999)).toBe(0);
    });

    test('contains warning logger failures', () => {
        jest.spyOn(performance, 'now')
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(6000);
        const monitor = new PerformanceMonitor();
        jest.spyOn(monitor.logger, 'warn').mockImplementation(() => {
            throw new Error('logger failed');
        });

        expect(monitor.endTiming(monitor.startTiming('translation'))).toBe(
            6000
        );
        expect(monitor.timers.size).toBe(0);
    });
});
