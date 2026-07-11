import { ErrorCategory, errorHandler } from './errorHandler.js';

describe('ErrorHandler recovery contract', () => {
    it('describes the same-provider retry that is actually implemented', () => {
        const recovery = errorHandler.determineRecoveryStrategy({
            category: ErrorCategory.TRANSLATION,
            isRecoverable: true,
            context: { retryCount: 0 },
        });
        const message = errorHandler.generateUserMessage({
            category: ErrorCategory.TRANSLATION,
            recovery,
        });

        expect(recovery).toMatchObject({
            shouldRetry: true,
            strategy: 'fixed_delay',
            retryDelay: 1000,
        });
        expect(recovery).not.toHaveProperty('fallbackOptions');
        expect(message).toContain('Retrying automatically');
        expect(message).not.toMatch(/alternative provider/i);
    });
});
