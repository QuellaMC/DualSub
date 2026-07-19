import { jest } from '@jest/globals';

import { AIContextProvider } from '../providers/AIContextProvider.js';
import { MessageActions } from '../../shared/constants/messageActions.js';

function createProvider() {
    const provider = new AIContextProvider();
    provider.initialized = true;
    return provider;
}

function createDeferred() {
    let resolve;
    const promise = new Promise((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

function createSuccessWire(request, analysis = { summary: 'Valid analysis' }) {
    return {
        success: true,
        result: {
            analysis,
            contextType: 'cultural',
            contextTypes: ['cultural'],
            isStructured: true,
        },
        requestId: request.requestId,
    };
}

describe('AIContextProvider ANALYZE_CONTEXT protocol', () => {
    beforeEach(() => {
        delete chrome.runtime.lastError;
        chrome.runtime.sendMessage.mockImplementation((_message, callback) => {
            const response = { success: true };
            if (typeof callback === 'function') callback(response);
            return Promise.resolve(response);
        });
    });

    afterEach(() => {
        jest.useRealTimers();
        delete chrome.runtime.lastError;
    });

    test('uses an exact ping request and parses the correlated readiness response', async () => {
        const provider = new AIContextProvider();
        chrome.runtime.sendMessage.mockImplementation((request) =>
            Promise.resolve({
                action: request.action,
                ready: true,
                services: {
                    translation: true,
                    subtitle: true,
                    aiContext: true,
                    aiContextInitialized: true,
                },
            })
        );

        await provider._testBackgroundConnection();

        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
            action: MessageActions.PING,
        });
    });

    test('single-flights initialization and terminal destroy revokes a deferred commit', async () => {
        const provider = new AIContextProvider();
        const connection = createDeferred();
        const discoverProviders = jest
            .spyOn(provider, '_discoverProviders')
            .mockResolvedValue(undefined);
        const setupRateLimiting = jest
            .spyOn(provider, '_setupRateLimiting')
            .mockResolvedValue(undefined);
        const testBackgroundConnection = jest
            .spyOn(provider, '_testBackgroundConnection')
            .mockReturnValue(connection.promise);

        const firstInitialization = provider.initialize();
        const simultaneousInitialization = provider.initialize();

        expect(simultaneousInitialization).toBe(firstInitialization);
        await Promise.resolve();
        await Promise.resolve();
        expect(testBackgroundConnection).toHaveBeenCalledTimes(1);

        await provider.destroy();
        connection.resolve();

        await expect(firstInitialization).resolves.toBe(false);
        expect(provider.initialized).toBe(false);
        expect(discoverProviders).toHaveBeenCalledTimes(1);
        expect(setupRateLimiting).toHaveBeenCalledTimes(1);
        await expect(provider.initialize()).resolves.toBe(false);
        await expect(
            provider.analyzeContext('must not dispatch', {
                requestId: 'destroyed-provider',
            })
        ).rejects.toThrow('Provider not initialized');
        expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    test('sends an exact request and returns detached success', async () => {
        const provider = createProvider();
        let sentRequest;
        const wireAnalysis = { summary: 'Cultural explanation' };

        chrome.runtime.sendMessage.mockImplementation((message, callback) => {
            sentRequest = message;
            const response = {
                success: true,
                result: {
                    analysis: wireAnalysis,
                    contextType: 'cultural',
                    contextTypes: ['cultural'],
                    isStructured: true,
                },
                requestId: message.requestId,
            };
            callback(response);
        });

        const result = await provider.analyzeContext('hello', {
            contextTypes: ['cultural'],
            language: 'en',
            targetLanguage: 'es',
            platform: 'netflix',
            requestId: 'analysis-1',
        });

        expect(sentRequest).toEqual({
            action: MessageActions.ANALYZE_CONTEXT,
            text: 'hello',
            contextTypes: ['cultural'],
            language: 'en',
            targetLanguage: 'es',
            platform: 'netflix',
            requestId: 'analysis-1',
        });
        expect(Object.isFrozen(sentRequest)).toBe(true);
        expect(Object.isFrozen(sentRequest.contextTypes)).toBe(true);
        expect(result).toEqual({
            success: true,
            result: {
                analysis: { summary: 'Cultural explanation' },
                contextType: 'cultural',
                contextTypes: ['cultural'],
                isStructured: true,
            },
            requestId: 'analysis-1',
        });
        expect(Object.isFrozen(result)).toBe(true);
        expect(Object.isFrozen(result.result)).toBe(true);

        wireAnalysis.summary = 'mutated after settlement';
        expect(result.result.analysis.summary).toBe('Cultural explanation');
    });

    test('rejects a success with the wrong request ID', async () => {
        const provider = createProvider();

        chrome.runtime.sendMessage.mockImplementation((message, callback) => {
            callback({
                success: true,
                result: {
                    analysis: { summary: 'Must not escape' },
                    contextType: 'cultural',
                    contextTypes: ['cultural'],
                    isStructured: true,
                },
                requestId: `${message.requestId}-forged`,
            });
        });

        const result = await provider.analyzeContext('hello', {
            contextTypes: ['cultural'],
            language: 'en',
            targetLanguage: 'es',
            platform: 'netflix',
            requestId: 'analysis-2',
        });

        expect(result).toEqual({
            success: false,
            error: 'Invalid analysis response',
            requestId: 'analysis-2',
            shouldRetry: false,
        });
        expect(Object.isFrozen(result)).toBe(true);
        expect(JSON.stringify(result)).not.toContain('Must not escape');
    });

    test('does not resend ambiguous acceptance or leak its error', async () => {
        const provider = createProvider();
        const directFallback = jest.spyOn(provider, '_sendRequestWithTimeout');
        const privateRuntimeError =
            'The message port closed before a response was received. PRIVATE';

        chrome.runtime.sendMessage.mockImplementation((_message, callback) => {
            chrome.runtime.lastError = { message: privateRuntimeError };
            callback(undefined);
            delete chrome.runtime.lastError;
        });

        const result = await provider.analyzeContext('hello', {
            contextTypes: ['cultural'],
            language: 'en',
            targetLanguage: 'es',
            platform: 'netflix',
            requestId: 'analysis-3',
        });

        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
        expect(directFallback).not.toHaveBeenCalled();
        expect(result).toEqual({
            success: false,
            error: 'Analysis request failed',
            requestId: 'analysis-3',
            shouldRetry: false,
        });
        expect(Object.isFrozen(result)).toBe(true);
        expect(JSON.stringify(result)).not.toContain(privateRuntimeError);
    });

    test('retries proven non-delivery without wake-up messages', async () => {
        jest.useFakeTimers();
        const provider = createProvider();
        const actions = [];
        let analyzeDispatches = 0;

        chrome.runtime.sendMessage.mockImplementation((message, callback) => {
            actions.push(message.action);
            if (message.action !== MessageActions.ANALYZE_CONTEXT) {
                callback({ success: true });
                return;
            }

            analyzeDispatches++;
            if (analyzeDispatches === 1) {
                chrome.runtime.lastError = {
                    message:
                        'Could not establish connection. Receiving end does not exist.',
                };
                callback(undefined);
                delete chrome.runtime.lastError;
                return;
            }

            callback({
                success: true,
                result: {
                    analysis: { summary: 'Delivered once' },
                    contextType: 'cultural',
                    contextTypes: ['cultural'],
                    isStructured: true,
                },
                requestId: message.requestId,
            });
        });

        const resultPromise = provider.analyzeContext('hello', {
            contextTypes: ['cultural'],
            language: 'en',
            targetLanguage: 'es',
            platform: 'netflix',
            requestId: 'analysis-4',
        });
        await jest.advanceTimersByTimeAsync(120);

        await expect(resultPromise).resolves.toEqual({
            success: true,
            result: {
                analysis: { summary: 'Delivered once' },
                contextType: 'cultural',
                contextTypes: ['cultural'],
                isStructured: true,
            },
            requestId: 'analysis-4',
        });
        expect(actions).toEqual([
            MessageActions.ANALYZE_CONTEXT,
            MessageActions.ANALYZE_CONTEXT,
        ]);
        expect(jest.getTimerCount()).toBe(0);
    });

    test('cancellation blocks retry and keeps metrics finite', async () => {
        jest.useFakeTimers();
        const provider = createProvider();
        let analyzeDispatches = 0;

        chrome.runtime.sendMessage.mockImplementation((message, callback) => {
            analyzeDispatches++;
            if (analyzeDispatches === 1) {
                chrome.runtime.lastError = {
                    message:
                        'Could not establish connection. Receiving end does not exist.',
                };
                callback(undefined);
                delete chrome.runtime.lastError;
                return;
            }
            callback({
                success: true,
                result: {
                    analysis: { summary: 'Must be suppressed' },
                    contextType: 'cultural',
                    contextTypes: ['cultural'],
                    isStructured: true,
                },
                requestId: message.requestId,
            });
        });

        const resultPromise = provider.analyzeContext('hello', {
            contextTypes: ['cultural'],
            language: 'en',
            targetLanguage: 'es',
            platform: 'netflix',
            requestId: 'analysis-5',
        });
        expect(provider.cancelRequest('analysis-5')).toBe(true);
        await jest.advanceTimersByTimeAsync(120);

        await expect(resultPromise).resolves.toEqual({
            success: false,
            error: 'Analysis request cancelled',
            requestId: 'analysis-5',
            shouldRetry: false,
        });
        expect(analyzeDispatches).toBe(1);
        expect(Number.isFinite(provider.metrics.totalResponseTime)).toBe(true);
        expect(Number.isFinite(provider.metrics.averageResponseTime)).toBe(
            true
        );
        expect(provider.activeRequests.size).toBe(0);
        expect(provider.requestStartTimes.size).toBe(0);
        expect(jest.getTimerCount()).toBe(0);
    });

    test('suppresses a result that settles after cancellation', async () => {
        const provider = createProvider();
        const response = createDeferred();
        let request;

        chrome.runtime.sendMessage.mockImplementation((message) => {
            request = message;
            return response.promise;
        });

        const resultPromise = provider.analyzeContext('hello', {
            contextTypes: ['cultural'],
            language: 'en',
            targetLanguage: 'es',
            platform: 'netflix',
            requestId: 'analysis-6',
        });
        const activeRequest = provider.activeRequests.get('analysis-6');
        expect(Object.keys(activeRequest)).toEqual(['requestId', 'startedAt']);
        expect(Object.isFrozen(activeRequest)).toBe(true);
        expect(JSON.stringify(activeRequest)).not.toContain('hello');
        expect(provider.cancelRequest('analysis-6')).toBe(true);
        response.resolve({
            success: true,
            result: {
                analysis: { summary: 'Must be discarded' },
                contextType: 'cultural',
                contextTypes: ['cultural'],
                isStructured: true,
            },
            requestId: request.requestId,
        });

        await expect(resultPromise).resolves.toEqual({
            success: false,
            error: 'Analysis request cancelled',
            requestId: 'analysis-6',
            shouldRetry: false,
        });
        expect(Number.isFinite(provider.metrics.totalResponseTime)).toBe(true);
        expect(Number.isFinite(provider.metrics.averageResponseTime)).toBe(
            true
        );
        expect(provider.metrics.successCount).toBe(0);
        expect(provider.metrics.errorCount).toBe(1);
    });

    test('suppresses a result that settles after provider destruction', async () => {
        const provider = createProvider();
        const response = createDeferred();
        let request;
        chrome.runtime.sendMessage.mockImplementation((message) => {
            request = message;
            return response.promise;
        });

        const resultPromise = provider.analyzeContext('hello', {
            contextTypes: ['cultural'],
            language: 'en',
            targetLanguage: 'es',
            platform: 'netflix',
            requestId: 'analysis-destroyed',
        });
        await provider.destroy();
        response.resolve(createSuccessWire(request, { summary: 'Too late' }));

        await expect(resultPromise).resolves.toEqual({
            success: false,
            error: 'Analysis request cancelled',
            requestId: 'analysis-destroyed',
            shouldRetry: false,
        });
        expect(provider.initialized).toBe(false);
        expect(provider.activeRequests.size).toBe(0);
        expect(provider.requestStartTimes.size).toBe(0);
    });

    test('bounds persistent non-delivery with fixed retry advice', async () => {
        jest.useFakeTimers();
        const provider = createProvider();
        const privateRuntimeError =
            'No matching service worker for this scope. PRIVATE';

        chrome.runtime.sendMessage.mockImplementation((_message, callback) => {
            chrome.runtime.lastError = { message: privateRuntimeError };
            callback(undefined);
            delete chrome.runtime.lastError;
        });

        const resultPromise = provider.analyzeContext('hello', {
            contextTypes: ['cultural'],
            language: 'en',
            targetLanguage: 'es',
            platform: 'netflix',
            requestId: 'analysis-7',
        });
        await jest.advanceTimersByTimeAsync(360);

        await expect(resultPromise).resolves.toEqual({
            success: false,
            error: 'Analysis request could not be delivered',
            requestId: 'analysis-7',
            shouldRetry: true,
        });
        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(3);
        expect(JSON.stringify(await resultPromise)).not.toContain(
            privateRuntimeError
        );
        expect(jest.getTimerCount()).toBe(0);
    });

    test('does not retry an unbranded lookalike rejection', async () => {
        const provider = createProvider();
        const privateFailure = new Error(
            'Could not establish connection. Receiving end does not exist. PRIVATE'
        );
        chrome.runtime.sendMessage.mockRejectedValue(privateFailure);

        const result = await provider.analyzeContext('hello', {
            contextTypes: ['cultural'],
            language: 'en',
            targetLanguage: 'es',
            platform: 'netflix',
            requestId: 'analysis-8',
        });

        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
        expect(result).toEqual({
            success: false,
            error: 'Analysis request failed',
            requestId: 'analysis-8',
            shouldRetry: false,
        });
        expect(JSON.stringify(result)).not.toContain(privateFailure.message);
    });

    test('rejects an invalid request without dispatch', async () => {
        const provider = createProvider();

        const result = await provider.analyzeContext('   ', {
            contextTypes: ['cultural'],
            language: 'en',
            targetLanguage: 'es',
            platform: 'netflix',
            requestId: 'analysis-9',
        });

        expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
        expect(result).toEqual({
            success: false,
            error: 'Invalid analysis request',
            requestId: 'analysis-9',
            shouldRetry: false,
        });
        expect(Object.isFrozen(result)).toBe(true);
        expect(provider.metrics).toMatchObject({
            requestCount: 1,
            successCount: 0,
            errorCount: 1,
        });
        expect(Number.isFinite(provider.metrics.totalResponseTime)).toBe(true);
        expect(Number.isFinite(provider.metrics.averageResponseTime)).toBe(
            true
        );
    });

    test('does not replace an explicitly empty request ID', async () => {
        const provider = createProvider();

        const result = await provider.analyzeContext('hello', {
            contextTypes: ['cultural'],
            language: 'en',
            targetLanguage: 'es',
            platform: 'netflix',
            requestId: '',
        });

        expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
        expect(result).toEqual({
            success: false,
            error: 'Invalid analysis request',
            requestId: '',
            shouldRetry: false,
        });
    });

    test('records finite metrics for a rate-limited request', async () => {
        const provider = createProvider();
        provider.rateLimiter = {
            requests: [Date.now()],
            maxRequests: 1,
            windowMs: 60_000,
        };

        const result = await provider.analyzeContext('hello', {
            contextTypes: ['cultural'],
            language: 'en',
            targetLanguage: 'es',
            platform: 'netflix',
            requestId: 'analysis-10',
        });

        expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
        expect(result).toEqual({
            success: false,
            error: 'Rate limit exceeded',
            requestId: 'analysis-10',
            shouldRetry: true,
        });
        expect(Object.isFrozen(result)).toBe(true);
        expect(provider.metrics).toMatchObject({
            requestCount: 1,
            successCount: 0,
            errorCount: 1,
        });
        expect(Number.isFinite(provider.metrics.totalResponseTime)).toBe(true);
        expect(Number.isFinite(provider.metrics.averageResponseTime)).toBe(
            true
        );
        expect(provider.activeRequests.size).toBe(0);
        expect(provider.requestStartTimes.size).toBe(0);
    });

    test.each([
        [
            'outer extras',
            (request) => ({ ...createSuccessWire(request), extra: true }),
        ],
        [
            'wrong context projection',
            (request) => ({
                ...createSuccessWire(request),
                result: {
                    ...createSuccessWire(request).result,
                    contextType: 'historical',
                },
            }),
        ],
        [
            'non-record analysis',
            (request) => createSuccessWire(request, 'PRIVATE STRING'),
        ],
        [
            'accessor properties',
            () => {
                const response = {};
                Object.defineProperty(response, 'success', {
                    enumerable: true,
                    get() {
                        throw new Error('PRIVATE ACCESSOR');
                    },
                });
                return response;
            },
        ],
        [
            'exotic response objects',
            (request) => Object.assign(new Date(0), createSuccessWire(request)),
        ],
    ])('fixed-rejects %s in a success response', async (_label, makeWire) => {
        const provider = createProvider();
        chrome.runtime.sendMessage.mockImplementation((message, callback) => {
            callback(makeWire(message));
        });

        const result = await provider.analyzeContext('hello', {
            contextTypes: ['cultural'],
            language: 'en',
            targetLanguage: 'es',
            platform: 'netflix',
            requestId: 'analysis-11',
        });

        expect(result).toEqual({
            success: false,
            error: 'Invalid analysis response',
            requestId: 'analysis-11',
            shouldRetry: false,
        });
        expect(Object.isFrozen(result)).toBe(true);
        expect(JSON.stringify(result)).not.toMatch(/PRIVATE|extra/);
    });

    test('projects a validated failure without inference', async () => {
        const provider = createProvider();
        chrome.runtime.sendMessage.mockImplementation((message, callback) => {
            callback({
                success: false,
                error: 'Provider is temporarily busy',
                shouldRetry: false,
                requestId: message.requestId,
            });
        });

        const result = await provider.analyzeContext('hello', {
            contextTypes: ['cultural'],
            language: 'en',
            targetLanguage: 'es',
            platform: 'netflix',
            requestId: 'analysis-12',
        });

        expect(result).toEqual({
            success: false,
            error: 'Provider is temporarily busy',
            requestId: 'analysis-12',
            shouldRetry: false,
        });
        expect(Object.isFrozen(result)).toBe(true);
        expect(provider.metrics.successCount).toBe(0);
        expect(provider.metrics.errorCount).toBe(1);
    });

    test('stale same-ID settlement cannot clear its replacement', async () => {
        const provider = createProvider();
        const firstResponse = createDeferred();
        const secondResponse = createDeferred();
        const requests = [];

        chrome.runtime.sendMessage
            .mockImplementationOnce((message) => {
                requests.push(message);
                return firstResponse.promise;
            })
            .mockImplementationOnce((message) => {
                requests.push(message);
                return secondResponse.promise;
            });

        const firstResult = provider.analyzeContext('first text', {
            contextTypes: ['cultural'],
            language: 'en',
            targetLanguage: 'es',
            platform: 'netflix',
            requestId: 'analysis-shared',
        });
        const secondResult = provider.analyzeContext('second text', {
            contextTypes: ['cultural'],
            language: 'en',
            targetLanguage: 'es',
            platform: 'netflix',
            requestId: 'analysis-shared',
        });

        firstResponse.resolve(
            createSuccessWire(requests[0], { summary: 'Stale result' })
        );
        await expect(firstResult).resolves.toEqual({
            success: false,
            error: 'Analysis request cancelled',
            requestId: 'analysis-shared',
            shouldRetry: false,
        });
        expect(provider.activeRequests.size).toBe(1);
        expect(provider.requestStartTimes.size).toBe(1);

        secondResponse.resolve(
            createSuccessWire(requests[1], { summary: 'Current result' })
        );
        await expect(secondResult).resolves.toEqual({
            success: true,
            result: {
                analysis: { summary: 'Current result' },
                contextType: 'cultural',
                contextTypes: ['cultural'],
                isStructured: true,
            },
            requestId: 'analysis-shared',
        });
        expect(provider.activeRequests.size).toBe(0);
        expect(provider.requestStartTimes.size).toBe(0);
        expect(provider.metrics).toMatchObject({
            requestCount: 2,
            successCount: 1,
            errorCount: 1,
        });
    });
});
