import { jest } from '@jest/globals';

import { AIContextProvider } from '../providers/AIContextProvider.js';
import { MessageActions } from '../../shared/constants/messageActions.js';
import {
    buildAnalyzeContextSuccessResponse,
    MessageSenderRoles,
    parseAnalyzeContextResponseMessage,
} from '../../shared/protocol/messageProtocol.js';

const OPTIONS = Object.freeze({
    contextTypes: ['cultural'],
    language: 'en',
    targetLanguage: 'es',
    platform: 'netflix',
});

function deferred() {
    let resolve;
    const promise = new Promise((settle) => {
        resolve = settle;
    });
    return { promise, resolve };
}

async function initializedProvider() {
    const provider = new AIContextProvider();
    await provider.initialize();
    return provider;
}

function analyze(provider, requestId, text = 'hello') {
    return provider.analyzeContext(text, { ...OPTIONS, requestId });
}

function successResponse(request, summary = 'Cultural explanation') {
    return buildAnalyzeContextSuccessResponse(
        MessageSenderRoles.CONTENT,
        request,
        { analysis: { summary } }
    );
}

describe('AIContextProvider analysis transport', () => {
    beforeEach(() => {
        chrome.runtime.sendMessage.mockResolvedValue({ success: true });
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('initializes once and cannot be revived after destruction', async () => {
        const provider = new AIContextProvider();

        await expect(provider.initialize()).resolves.toBe(true);
        expect(provider.initialized).toBe(true);

        provider.destroy();

        expect(provider.initialized).toBe(false);
        await expect(provider.initialize()).resolves.toBe(false);
        await expect(analyze(provider, 'destroyed')).rejects.toThrow(
            'Provider not initialized'
        );
    });

    test('sends the canonical request and leaves response parsing to the controller', async () => {
        const provider = await initializedProvider();
        let request;
        chrome.runtime.sendMessage.mockImplementation((message) => {
            request = message;
            return Promise.resolve(successResponse(message));
        });

        const response = await analyze(provider, 'analysis-1');

        expect(request).toEqual({
            action: MessageActions.ANALYZE_CONTEXT,
            text: 'hello',
            contextTypes: ['cultural'],
            language: 'en',
            targetLanguage: 'es',
            platform: 'netflix',
            requestId: 'analysis-1',
        });
        expect(response).toEqual({
            success: true,
            result: { analysis: { summary: 'Cultural explanation' } },
        });
        expect(
            parseAnalyzeContextResponseMessage(
                response,
                request,
                MessageSenderRoles.CONTENT
            )
        ).toEqual({
            status: 'success',
            requestId: 'analysis-1',
            result: {
                analysis: { summary: 'Cultural explanation' },
                contextType: 'cultural',
                contextTypes: ['cultural'],
                isStructured: true,
            },
        });
    });

    test('rejects an invalid request before dispatch', async () => {
        const provider = await initializedProvider();

        await expect(analyze(provider, 'analysis-2', '   ')).resolves.toEqual({
            success: false,
            error: 'Invalid analysis request',
            shouldRetry: false,
        });
        expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    test('does not retry or expose an ambiguous runtime failure', async () => {
        const provider = await initializedProvider();
        chrome.runtime.sendMessage.mockRejectedValue(
            new Error('The message port closed. PRIVATE')
        );

        const response = await analyze(provider, 'analysis-3');

        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
        expect(response).toEqual({
            success: false,
            error: 'Analysis request failed',
            shouldRetry: false,
        });
        expect(JSON.stringify(response)).not.toContain('PRIVATE');
    });

    test('retries proven non-delivery and returns the minimal response', async () => {
        jest.useFakeTimers();
        const provider = await initializedProvider();
        chrome.runtime.sendMessage
            .mockRejectedValueOnce(
                new Error(
                    'Could not establish connection. Receiving end does not exist.'
                )
            )
            .mockImplementation((message) =>
                Promise.resolve(successResponse(message, 'Delivered'))
            );

        const responsePromise = analyze(provider, 'analysis-4');
        await jest.advanceTimersByTimeAsync(120);

        await expect(responsePromise).resolves.toEqual({
            success: true,
            result: { analysis: { summary: 'Delivered' } },
        });
        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(2);
        expect(jest.getTimerCount()).toBe(0);
    });

    test('bounds persistent non-delivery and returns fixed retry advice', async () => {
        jest.useFakeTimers();
        const provider = await initializedProvider();
        chrome.runtime.sendMessage.mockRejectedValue(
            new Error('No matching service worker. PRIVATE')
        );

        const responsePromise = analyze(provider, 'analysis-5');
        await jest.advanceTimersByTimeAsync(360);
        const response = await responsePromise;

        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(3);
        expect(response).toEqual({
            success: false,
            error: 'Analysis request could not be delivered',
            shouldRetry: true,
        });
        expect(JSON.stringify(response)).not.toContain('PRIVATE');
    });

    test('cancellation stops a scheduled retry', async () => {
        jest.useFakeTimers();
        const provider = await initializedProvider();
        chrome.runtime.sendMessage.mockRejectedValue(
            new Error('No matching service worker')
        );

        const responsePromise = analyze(provider, 'analysis-6');
        expect(provider.cancelRequest('analysis-6')).toBe(true);
        await jest.advanceTimersByTimeAsync(120);

        await expect(responsePromise).resolves.toEqual({
            success: false,
            error: 'Analysis request cancelled',
            shouldRetry: false,
        });
        expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
        expect(provider.activeRequests.size).toBe(0);
    });

    test('suppresses a response that arrives after cancellation or destruction', async () => {
        const provider = await initializedProvider();
        const cancelled = deferred();
        const destroyed = deferred();
        chrome.runtime.sendMessage
            .mockReturnValueOnce(cancelled.promise)
            .mockReturnValueOnce(destroyed.promise);

        const cancelledResult = analyze(provider, 'analysis-7');
        provider.cancelRequest('analysis-7');
        cancelled.resolve({ success: true });
        await expect(cancelledResult).resolves.toEqual({
            success: false,
            error: 'Analysis request cancelled',
            shouldRetry: false,
        });

        const destroyedResult = analyze(provider, 'analysis-8');
        provider.destroy();
        destroyed.resolve({ success: true });
        await expect(destroyedResult).resolves.toEqual({
            success: false,
            error: 'Analysis request cancelled',
            shouldRetry: false,
        });
    });

    test('a stale same-ID completion cannot clear its replacement', async () => {
        const provider = await initializedProvider();
        const first = deferred();
        const second = deferred();
        chrome.runtime.sendMessage
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);

        const firstResult = analyze(provider, 'shared');
        const secondResult = analyze(provider, 'shared');

        first.resolve({ success: true, result: { analysis: {} } });
        await expect(firstResult).resolves.toEqual({
            success: false,
            error: 'Analysis request cancelled',
            shouldRetry: false,
        });
        expect(provider.activeRequests.size).toBe(1);

        second.resolve({ success: true, result: { analysis: {} } });
        await expect(secondResult).resolves.toEqual({
            success: true,
            result: { analysis: {} },
        });
        expect(provider.activeRequests.size).toBe(0);
    });
});
