import { jest } from '@jest/globals';
import { ContextRateLimiter } from './contextRateLimiter.js';

describe('ContextRateLimiter', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(1_000);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('records the timestamp after a mandatory wait', async () => {
        const limiter = new ContextRateLimiter('openai', {
            mandatoryDelay: 100,
            requests: 60,
            burstLimit: 10,
        });

        await limiter.checkLimit('cultural');
        const second = limiter.checkLimit('historical');
        await jest.advanceTimersByTimeAsync(100);
        await second;

        expect(limiter.requests.map(({ timestamp }) => timestamp)).toEqual([
            1_000, 1_100,
        ]);
        expect(limiter.lastRequest).toBe(1_100);
    });

    it('serializes concurrent acquisitions instead of releasing a burst', async () => {
        const limiter = new ContextRateLimiter('gemini', {
            mandatoryDelay: 100,
            requests: 60,
            burstLimit: 10,
        });

        await limiter.checkLimit('cultural');
        const second = limiter.checkLimit('historical');
        const third = limiter.checkLimit('linguistic');

        await jest.advanceTimersByTimeAsync(100);
        await second;
        expect(limiter.requests.at(-1).timestamp).toBe(1_100);

        await jest.advanceTimersByTimeAsync(100);
        await third;
        expect(limiter.requests.map(({ timestamp }) => timestamp)).toEqual([
            1_000, 1_100, 1_200,
        ]);
    });
});
