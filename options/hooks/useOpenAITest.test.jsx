import { jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react';

const hasHostPermission = jest.fn();
const requestHostPermission = jest.fn();

jest.unstable_mockModule('../../utils/hostPermissions.js', () => ({
    hasHostPermission,
    requestHostPermission,
}));

const { useOpenAITest } = await import('./useOpenAITest.js');

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((promiseResolve, promiseReject) => {
        resolve = promiseResolve;
        reject = promiseReject;
    });
    return { promise, reject, resolve };
}

const t = (_key, fallback, ...substitutions) => {
    let index = 0;
    return fallback.replace(/%s/g, () => String(substitutions[index++]));
};

beforeEach(() => {
    hasHostPermission.mockReset();
    requestHostPermission.mockReset();
});

test('testing a connection requests endpoint access and publishes its catalog identity', async () => {
    const permission = deferred();
    const models = deferred();
    const fetchAvailableModels = jest.fn(() => models.promise);
    const onModelsLoaded = jest.fn();
    requestHostPermission.mockReturnValue(permission.promise);
    const { result } = renderHook(() => useOpenAITest(t, fetchAvailableModels));

    let request;
    act(() => {
        request = result.current.testConnection(
            'secret-key',
            'https://api.example.com/v1',
            onModelsLoaded
        );
    });

    expect(result.current.testing).toBe(true);
    expect(result.current.fetchingModels).toBe(false);
    expect(result.current.testResult).toMatchObject({
        message: 'Testing connection...',
        type: 'info',
    });
    expect(requestHostPermission).toHaveBeenCalledWith(
        'https://api.example.com/v1'
    );

    await act(async () => {
        permission.resolve(true);
        await permission.promise;
    });
    expect(fetchAvailableModels).toHaveBeenCalledWith(
        'secret-key',
        'https://api.example.com/v1'
    );

    await act(async () => {
        models.resolve(['model-a']);
        await request;
    });

    expect(onModelsLoaded).toHaveBeenCalledWith(['model-a'], {
        apiKey: 'secret-key',
        baseUrl: 'https://api.example.com/v1',
    });
    expect(result.current.testing).toBe(false);
    expect(result.current.testResult).toMatchObject({
        message: 'Connection successful!',
        type: 'success',
    });
    expect(hasHostPermission).not.toHaveBeenCalled();
});

test('automatic model loading checks existing access and explains when permission is needed', async () => {
    const permission = deferred();
    const fetchAvailableModels = jest.fn();
    hasHostPermission.mockReturnValue(permission.promise);
    const { result } = renderHook(() => useOpenAITest(t, fetchAvailableModels));

    let request;
    act(() => {
        request = result.current.fetchModels(
            'secret-key',
            'https://api.example.com/v1'
        );
    });
    expect(result.current.fetchingModels).toBe(true);
    expect(result.current.testResult.message).toBe('Fetching models...');

    await act(async () => {
        permission.resolve(false);
        await request;
    });

    expect(fetchAvailableModels).not.toHaveBeenCalled();
    expect(result.current.fetchingModels).toBe(false);
    expect(result.current.testResult).toMatchObject({
        message: 'Use Test Connection to grant access to this endpoint.',
        type: 'warning',
    });
});

test('only the newest request can publish models, status, or loading completion', async () => {
    const olderModels = deferred();
    const newerModels = deferred();
    const fetchAvailableModels = jest
        .fn()
        .mockReturnValueOnce(olderModels.promise)
        .mockReturnValueOnce(newerModels.promise);
    const onModelsLoaded = jest.fn();
    hasHostPermission.mockResolvedValue(true);
    const { result } = renderHook(() => useOpenAITest(t, fetchAvailableModels));

    let olderRequest;
    await act(async () => {
        olderRequest = result.current.fetchModels(
            'older-key',
            'https://older.example.com/v1',
            onModelsLoaded
        );
        await Promise.resolve();
    });
    let newerRequest;
    await act(async () => {
        newerRequest = result.current.fetchModels(
            'newer-key',
            'https://newer.example.com/v1',
            onModelsLoaded
        );
        await Promise.resolve();
    });

    await act(async () => {
        olderModels.resolve(['stale-model']);
        await olderRequest;
    });
    expect(onModelsLoaded).not.toHaveBeenCalled();
    expect(result.current.fetchingModels).toBe(true);
    expect(result.current.testResult.message).toBe('Fetching models...');

    await act(async () => {
        newerModels.resolve(['current-model']);
        await newerRequest;
    });
    expect(onModelsLoaded).toHaveBeenCalledWith(['current-model'], {
        apiKey: 'newer-key',
        baseUrl: 'https://newer.example.com/v1',
    });
    expect(result.current.fetchingModels).toBe(false);
    expect(result.current.testResult).toMatchObject({
        message: 'Models fetched successfully.',
        type: 'success',
    });
});

test('unmount prevents an in-flight request from publishing', async () => {
    const models = deferred();
    const fetchAvailableModels = jest.fn(() => models.promise);
    const onModelsLoaded = jest.fn();
    hasHostPermission.mockResolvedValue(true);
    const { result, unmount } = renderHook(() =>
        useOpenAITest(t, fetchAvailableModels)
    );

    let request;
    await act(async () => {
        request = result.current.fetchModels(
            'secret-key',
            'https://api.example.com/v1',
            onModelsLoaded
        );
        await Promise.resolve();
    });
    unmount();

    await act(async () => {
        models.resolve(['late-model']);
        await request;
    });
    expect(onModelsLoaded).not.toHaveBeenCalled();
});
