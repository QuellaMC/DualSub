import {
    afterEach,
    beforeEach,
    describe,
    expect,
    jest,
    test,
} from '@jest/globals';
import { subtitleService } from './subtitleService.js';

describe('SubtitleService performance metrics', () => {
    let originalMetrics;
    let originalLogger;

    beforeEach(() => {
        originalMetrics = subtitleService.performanceMetrics;
        originalLogger = subtitleService.logger;
        subtitleService.performanceMetrics = {
            totalProcessed: 0,
            successfulProcessed: 0,
            averageProcessingTime: 0,
            errors: 0,
        };
        subtitleService.logger = {
            debug: jest.fn(),
            error: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
        };
    });

    afterEach(() => {
        subtitleService.performanceMetrics = originalMetrics;
        subtitleService.logger = originalLogger;
    });

    test('averages processing time over successful operations only', () => {
        subtitleService.updatePerformanceMetrics(100, true);
        subtitleService.updatePerformanceMetrics(50, false);
        subtitleService.updatePerformanceMetrics(300, true);

        const metrics = subtitleService.getPerformanceMetrics();
        expect(metrics).toMatchObject({
            totalProcessed: 3,
            successfulProcessed: 2,
            averageProcessingTime: 200,
            errors: 1,
        });
        expect(metrics.errorRate).toBeCloseTo(100 / 3);
    });

    test('does not expose an unused processing cache or cache-hit metric', () => {
        expect(subtitleService).not.toHaveProperty('processingCache');
        expect(subtitleService).not.toHaveProperty('clearCache');
        expect(subtitleService.getPerformanceMetrics()).not.toHaveProperty(
            'cacheHits'
        );
    });
});
