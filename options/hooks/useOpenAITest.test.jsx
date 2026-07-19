import { jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react';

const hasHostPermission = jest.fn();
const requestHostPermission = jest.fn();

jest.unstable_mockModule('../../utils/hostPermissions.js', () => ({
    hasHostPermission,
    requestHostPermission,
}));

const { useOpenAITest } = await import('./useOpenAITest.js');

function createDeferred() {
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

test('an older fetch success cannot publish or clear the newer fetch busy state', async () => {
    const olderModels = createDeferred();
    const newerModels = createDeferred();
    const fetchAvailableModels = jest
        .fn()
        .mockReturnValueOnce(olderModels.promise)
        .mockReturnValueOnce(newerModels.promise);
    const olderLoaded = jest.fn();
    const newerLoaded = jest.fn();
    hasHostPermission.mockResolvedValue(true);
    const { result } = renderHook(() => useOpenAITest(t, fetchAvailableModels));

    let olderOperation;
    await act(async () => {
        olderOperation = result.current.fetchModels(
            'older-key',
            'https://older.example.com/v1',
            olderLoaded
        );
        await Promise.resolve();
    });
    let newerOperation;
    await act(async () => {
        newerOperation = result.current.fetchModels(
            'newer-key',
            'https://newer.example.com/v1',
            newerLoaded
        );
        await Promise.resolve();
    });

    expect(result.current.fetchingModels).toBe(true);
    expect(result.current.testResult).toMatchObject({
        message: 'Fetching models...',
        type: 'info',
    });

    await act(async () => {
        olderModels.resolve(['older-model']);
        await olderOperation;
    });

    expect(olderLoaded).not.toHaveBeenCalled();
    expect(result.current.fetchingModels).toBe(true);
    expect(result.current.testResult).toMatchObject({
        message: 'Fetching models...',
        type: 'info',
    });

    await act(async () => {
        newerModels.resolve(['newer-model']);
        await newerOperation;
    });

    expect(newerLoaded).toHaveBeenCalledWith(['newer-model']);
    expect(result.current.fetchingModels).toBe(false);
    expect(result.current.testResult).toMatchObject({
        message: 'Models fetched successfully.',
        type: 'success',
    });
});

test('an older test failure cannot overwrite a newer fetch or clear its busy state', async () => {
    const olderTest = createDeferred();
    const newerFetch = createDeferred();
    const fetchAvailableModels = jest
        .fn()
        .mockReturnValueOnce(olderTest.promise)
        .mockReturnValueOnce(newerFetch.promise);
    const newerLoaded = jest.fn();
    requestHostPermission.mockResolvedValue(true);
    hasHostPermission.mockResolvedValue(true);
    const { result } = renderHook(() => useOpenAITest(t, fetchAvailableModels));

    let olderOperation;
    await act(async () => {
        olderOperation = result.current.testConnection(
            'older-key',
            'https://older.example.com/v1'
        );
        await Promise.resolve();
    });
    let newerOperation;
    await act(async () => {
        newerOperation = result.current.fetchModels(
            'newer-key',
            'https://newer.example.com/v1',
            newerLoaded
        );
        await Promise.resolve();
    });

    expect(result.current.testing).toBe(false);
    expect(result.current.fetchingModels).toBe(true);

    await act(async () => {
        olderTest.reject(new Error('older failure'));
        await olderOperation;
    });

    expect(result.current.fetchingModels).toBe(true);
    expect(result.current.testResult).toMatchObject({
        message: 'Fetching models...',
        type: 'info',
    });

    await act(async () => {
        newerFetch.resolve(['newer-model']);
        await newerOperation;
    });

    expect(newerLoaded).toHaveBeenCalledWith(['newer-model']);
    expect(result.current.fetchingModels).toBe(false);
    expect(result.current.testResult.type).toBe('success');
});

test('explicit invalidation suppresses a deferred permission warning', async () => {
    const permission = createDeferred();
    hasHostPermission.mockReturnValue(permission.promise);
    const fetchAvailableModels = jest.fn();
    const { result } = renderHook(() => useOpenAITest(t, fetchAvailableModels));

    let operation;
    act(() => {
        operation = result.current.fetchModels(
            'old-key',
            'https://old.example.com/v1'
        );
    });
    expect(result.current.fetchingModels).toBe(true);

    act(() => {
        result.current.invalidateRequests();
    });
    expect(result.current.fetchingModels).toBe(false);
    expect(result.current.testResult).toEqual({
        visible: false,
        message: '',
        type: 'info',
    });

    await act(async () => {
        permission.resolve(false);
        await operation;
    });

    expect(fetchAvailableModels).not.toHaveBeenCalled();
    expect(result.current.testResult).toEqual({
        visible: false,
        message: '',
        type: 'info',
    });
});

test('unmount invalidates a deferred request without publishing its result', async () => {
    const models = createDeferred();
    const fetchAvailableModels = jest.fn(() => models.promise);
    const onModelsLoaded = jest.fn();
    const renderSnapshots = [];
    hasHostPermission.mockResolvedValue(true);
    const { result, unmount } = renderHook(() => {
        const state = useOpenAITest(t, fetchAvailableModels);
        renderSnapshots.push({
            fetchingModels: state.fetchingModels,
            testResult: state.testResult,
            testing: state.testing,
        });
        return state;
    });

    let operation;
    await act(async () => {
        operation = result.current.fetchModels(
            'current-key',
            'https://current.example.com/v1',
            onModelsLoaded
        );
        await Promise.resolve();
    });
    const renderCountAtUnmount = renderSnapshots.length;
    unmount();

    await act(async () => {
        models.resolve(['late-model']);
        await operation;
    });

    expect(onModelsLoaded).not.toHaveBeenCalled();
    expect(renderSnapshots).toHaveLength(renderCountAtUnmount);
});
