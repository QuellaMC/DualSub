import { jest } from '@jest/globals';
import { RateLimitError } from '../services/serviceInterfaces.js';
import {
    ContextRateLimiter,
    ContextRateLimiterManager,
} from './contextRateLimiter.js';

describe('ContextRateLimiter', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(1_000);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('serializes concurrent acquisitions around the mandatory delay', async () => {
        const limiter = new ContextRateLimiter('openai', {
            mandatoryDelay: 100,
            requests: 60,
            burstLimit: 10,
        });

        await limiter.checkLimit();
        const second = limiter.checkLimit();
        const third = limiter.checkLimit();
        await jest.advanceTimersByTimeAsync(100);
        await second;
        await jest.advanceTimersByTimeAsync(100);
        await third;

        expect(limiter.requests).toEqual([1_000, 1_100, 1_200]);
    });

    it('returns a typed window-limit error with safe retry metadata', async () => {
        const limiter = new ContextRateLimiter('gemini', {
            mandatoryDelay: 0,
            requests: 1,
            burstLimit: 10,
            window: 5_000,
        });
        await limiter.checkLimit();

        await expect(limiter.checkLimit()).rejects.toMatchObject({
            name: 'RateLimitError',
            details: { retryAfter: 5_000, provider: 'gemini' },
        });
        await expect(limiter.checkLimit()).rejects.toBeInstanceOf(
            RateLimitError
        );
    });

    it('enforces the burst limit before the larger request window', async () => {
        const limiter = new ContextRateLimiter('openai', {
            mandatoryDelay: 0,
            requests: 20,
            burstLimit: 2,
        });
        await limiter.checkLimit();
        await limiter.checkLimit();

        await expect(limiter.checkLimit()).rejects.toMatchObject({
            name: 'RateLimitError',
            message: 'Too many requests in a short time. Please slow down.',
            details: { retryAfter: 10_000, provider: 'openai' },
        });
    });

    it('reuses a provider limiter while applying live configuration', () => {
        const manager = new ContextRateLimiterManager();
        const first = manager.getLimiter('openai', { requests: 60 });
        const updated = manager.getLimiter('openai', { requests: 25 });

        expect(updated).toBe(first);
        expect(updated.config.requests).toBe(25);
        manager.cleanup();
        expect(manager.limiters.size).toBe(0);
    });
});
