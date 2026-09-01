import { jest } from '@jest/globals';

const openaiAnalyze = jest.fn();
const geminiAnalyze = jest.fn();

jest.unstable_mockModule(
    '../../context_providers/openaiContextProvider.js',
    () => ({ analyzeContext: openaiAnalyze })
);
jest.unstable_mockModule(
    '../../context_providers/geminiContextProvider.js',
    () => ({ analyzeContext: geminiAnalyze })
);

const { configService } = await import('../../services/configService.js');
const { loggingManager } = await import('../utils/loggingManager.js');
const { errorHandler } = await import('../utils/errorHandler.js');
const { AIContextService } = await import('./aiContextService.js');

const SUCCESS = {
    success: true,
    analysis: { summary: 'result' },
    shouldCache: true,
};

describe('AIContextService', () => {
    let service;
    let readEnabled;
    let onConfigChanged;
    let removeConfigListener;

    beforeEach(() => {
        openaiAnalyze.mockReset().mockResolvedValue(SUCCESS);
        geminiAnalyze.mockReset().mockResolvedValue(SUCCESS);
        jest.spyOn(configService, 'getMultiple').mockResolvedValue({
            aiContextProvider: 'openai',
            aiContextMandatoryDelay: 1,
            aiContextRetryAttempts: 1,
            aiContextRetryDelay: 1,
        });
        readEnabled = jest
            .spyOn(configService, 'readStoredBooleanStrict')
            .mockResolvedValue(true);
        removeConfigListener = jest.fn();
        jest.spyOn(configService, 'onChanged').mockImplementation(
            (listener) => {
                onConfigChanged = listener;
                return removeConfigListener;
            }
        );
        jest.spyOn(loggingManager, 'createLogger').mockReturnValue({
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        });
    });

    afterEach(() => {
        service?.cleanup();
        service = null;
        jest.restoreAllMocks();
        jest.clearAllMocks();
        jest.useRealTimers();
    });

    it('initializes the configured provider and observes credential changes', async () => {
        configService.getMultiple.mockResolvedValue({
            aiContextProvider: 'gemini',
            aiContextMandatoryDelay: 1,
            aiContextRetryAttempts: 1,
            aiContextRetryDelay: 1,
        });
        service = new AIContextService();

        await service.initialize();
        await service.analyzeContext('hello', 'cultural');
        onConfigChanged({ geminiApiKey: 'rotated' });
        await service.analyzeContext('hello', 'cultural');

        expect(geminiAnalyze).toHaveBeenCalledTimes(2);
        expect(openaiAnalyze).not.toHaveBeenCalled();
        expect(configService.getMultiple.mock.calls[0][0]).not.toEqual(
            expect.arrayContaining(['openaiApiKey', 'geminiApiKey'])
        );
        expect(configService.onChanged).toHaveBeenCalledWith(
            expect.any(Function),
            { includeSensitive: true }
        );

        service.cleanup();
        service = null;
        expect(removeConfigListener).toHaveBeenCalledTimes(1);
    });

    it('caches by request identity and invalidates on provider configuration changes', async () => {
        service = new AIContextService();
        await service.initialize();

        const first = await service.analyzeContext('That is sick', 'cultural', {
            surroundingContext: 'A skateboard trick lands.',
        });
        const cached = await service.analyzeContext(
            'That is sick',
            'cultural',
            { surroundingContext: 'A skateboard trick lands.' }
        );
        onConfigChanged({ openaiModel: 'different-model' });
        await service.analyzeContext('That is sick', 'cultural', {
            surroundingContext: 'A skateboard trick lands.',
        });
        await service.analyzeContext('That is sick', 'cultural', {
            surroundingContext: 'A doctor reads a chart.',
        });

        expect(first).toMatchObject(SUCCESS);
        expect(cached).toMatchObject({ ...SUCCESS, cached: true });
        expect(openaiAnalyze).toHaveBeenCalledTimes(3);
    });

    it.each([
        ['disabled', false, 'AI context analysis is disabled'],
        [
            'unavailable',
            undefined,
            'AI context availability could not be verified',
        ],
    ])('fails closed when enablement is %s', async (_name, value, error) => {
        readEnabled.mockResolvedValue(value);
        service = new AIContextService();
        await service.initialize();

        await expect(
            service.analyzeContext(' hello ', 'cultural')
        ).resolves.toMatchObject({
            success: false,
            error,
            originalText: 'hello',
            shouldRetry: false,
        });
        expect(openaiAnalyze).not.toHaveBeenCalled();
    });

    it('sanitizes rejected enablement reads', async () => {
        readEnabled.mockRejectedValue(
            new Error('storage failed with PRIVATE_ENABLEMENT_SECRET')
        );
        service = new AIContextService();
        await service.initialize();

        const result = await service.analyzeContext('hello', 'cultural');

        expect(result).toMatchObject({
            success: false,
            error: 'AI context availability could not be verified',
        });
        expect(JSON.stringify(result)).not.toContain('PRIVATE_');
        expect(openaiAnalyze).not.toHaveBeenCalled();
    });

    it.each([
        ['blank text', '   ', 'cultural'],
        ['non-string text', null, 'cultural'],
        ['unsupported context', 'hello', 'invented'],
    ])(
        'rejects %s before provider dispatch',
        async (_name, text, contextType) => {
            service = new AIContextService();
            await service.initialize();

            await expect(
                service.analyzeContext(text, contextType)
            ).resolves.toMatchObject({ success: false, shouldRetry: false });
            expect(openaiAnalyze).not.toHaveBeenCalled();
        }
    );

    it('rechecks enablement before serving a cached result', async () => {
        service = new AIContextService();
        await service.initialize();
        await service.analyzeContext('hello', 'cultural');
        readEnabled.mockResolvedValue(false);

        await expect(
            service.analyzeContext('hello', 'cultural')
        ).resolves.toMatchObject({
            success: false,
            error: 'AI context analysis is disabled',
        });
        expect(openaiAnalyze).toHaveBeenCalledTimes(1);
    });

    it('suppresses an in-flight result when enablement is revoked', async () => {
        let resolveAnalysis;
        readEnabled
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(true)
            .mockResolvedValueOnce(false);
        openaiAnalyze.mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveAnalysis = resolve;
                })
        );
        service = new AIContextService();
        await service.initialize();

        const resultPromise = service.analyzeContext('hello', 'cultural');
        for (let turn = 0; turn < 10 && !resolveAnalysis; turn += 1) {
            await new Promise((resolve) => setTimeout(resolve, 1));
        }
        expect(resolveAnalysis).toEqual(expect.any(Function));
        resolveAnalysis(SUCCESS);

        await expect(resultPromise).resolves.toMatchObject({
            success: false,
            error: 'AI context analysis is disabled',
        });
    });

    it('retries retryable results but not failures requiring user action', async () => {
        configService.getMultiple.mockResolvedValue({
            aiContextProvider: 'openai',
            aiContextCacheEnabled: false,
            aiContextMandatoryDelay: 1,
            aiContextRetryAttempts: 2,
            aiContextRetryDelay: 1,
        });
        openaiAnalyze
            .mockResolvedValueOnce({ success: false, shouldRetry: true })
            .mockResolvedValueOnce(SUCCESS)
            .mockResolvedValueOnce({
                success: false,
                error: 'Check provider settings',
                shouldRetry: false,
            });
        service = new AIContextService();
        await service.initialize();

        const retrying = service.analyzeContext('hello', 'linguistic');
        await expect(retrying).resolves.toMatchObject(SUCCESS);
        await service.analyzeContext('different', 'all');

        expect(openaiAnalyze).toHaveBeenCalledTimes(3);
    });

    it('returns a sanitized failure when the provider throws', async () => {
        openaiAnalyze.mockRejectedValue(new Error('PRIVATE_PROVIDER_SECRET'));
        jest.spyOn(errorHandler, 'handleError').mockReturnValue({
            userMessage: 'Provider request failed.',
            shouldRetry: false,
        });
        service = new AIContextService();
        await service.initialize();

        const result = await service.analyzeContext('hello', 'historical');

        expect(result).toMatchObject({
            success: false,
            error: 'Provider request failed.',
            shouldRetry: false,
        });
        expect(JSON.stringify(result)).not.toContain('PRIVATE_');
    });

    it('does not reuse a result completed after credential rotation', async () => {
        let resolveAnalysis;
        openaiAnalyze.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    resolveAnalysis = resolve;
                })
        );
        service = new AIContextService();
        await service.initialize();

        const first = service.analyzeContext('hello', 'cultural');
        for (let turn = 0; turn < 10 && !resolveAnalysis; turn += 1) {
            await new Promise((resolve) => setTimeout(resolve, 1));
        }
        expect(resolveAnalysis).toEqual(expect.any(Function));
        onConfigChanged({ openaiApiKey: 'rotated' });
        resolveAnalysis(SUCCESS);
        await first;
        await service.analyzeContext('hello', 'cultural');

        expect(openaiAnalyze).toHaveBeenCalledTimes(2);
    });
});
