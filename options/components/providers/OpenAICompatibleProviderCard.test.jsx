import { jest } from '@jest/globals';
import {
    act,
    fireEvent,
    render,
    screen,
    waitFor,
} from '@testing-library/react';

const fetchModels = jest.fn();
const testConnection = jest.fn();
const invalidateRequests = jest.fn();
const initializeStatus = jest.fn();
const useOpenAITest = jest.fn(() => ({
    testResult: { visible: false, message: '', type: 'info' },
    testing: false,
    fetchingModels: false,
    testConnection,
    fetchModels,
    invalidateRequests,
    initializeStatus,
}));

jest.unstable_mockModule('../../hooks/index.js', () => ({
    useOpenAITest,
}));

const { OpenAICompatibleProviderCard } =
    await import('./OpenAICompatibleProviderCard.jsx');

function deferred() {
    let resolve;
    const promise = new Promise((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

function getCard(props = {}) {
    return (
        <OpenAICompatibleProviderCard
            t={(_key, fallback) => fallback}
            apiKey=""
            baseUrl="https://first.example.com/v1"
            model=""
            models={[]}
            onApiKeyChange={jest.fn()}
            onBaseUrlChange={jest.fn().mockResolvedValue(true)}
            onModelChange={jest.fn()}
            onModelsLoaded={jest.fn()}
            {...props}
        />
    );
}

function renderCard(props = {}) {
    const onBaseUrlChange =
        props.onBaseUrlChange || jest.fn().mockResolvedValue(true);
    return {
        onBaseUrlChange,
        ...render(getCard({ ...props, onBaseUrlChange })),
    };
}

beforeEach(() => {
    fetchModels.mockReset();
    testConnection.mockReset();
    invalidateRequests.mockReset();
    initializeStatus.mockReset();
});

afterEach(() => {
    jest.useRealTimers();
});

test('the compatible base URL stays local until blur commits it once', async () => {
    const { onBaseUrlChange } = renderCard();
    const input = screen.getByLabelText('Base URL:');

    fireEvent.change(input, {
        target: { value: 'https://second.example.com/v2' },
    });
    expect(input).toHaveValue('https://second.example.com/v2');
    expect(onBaseUrlChange).not.toHaveBeenCalled();

    fireEvent.blur(input);
    await waitFor(() =>
        expect(onBaseUrlChange).toHaveBeenCalledWith(
            'https://second.example.com/v2'
        )
    );
    expect(onBaseUrlChange).toHaveBeenCalledTimes(1);
});

test('an invalid compatible URL remains editable without persistence', () => {
    const { onBaseUrlChange } = renderCard();
    const input = screen.getByLabelText('Base URL:');

    fireEvent.change(input, {
        target: { value: 'https://second.example.com/v2?' },
    });
    fireEvent.blur(input);

    expect(input).toHaveValue('https://second.example.com/v2?');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription(
        'Enter a valid value before saving.'
    );
    expect(onBaseUrlChange).not.toHaveBeenCalled();
});

test('a committed compatible URL fetches models for the new endpoint', async () => {
    jest.useFakeTimers();
    const { onBaseUrlChange, rerender } = renderCard({
        apiKey: 'current-key',
    });
    const input = screen.getByLabelText('Base URL:');

    fireEvent.change(input, {
        target: { value: 'https://second.example.com/v2' },
    });
    fireEvent.blur(input);
    await act(async () => {
        await Promise.resolve();
    });
    expect(onBaseUrlChange).toHaveBeenCalledWith(
        'https://second.example.com/v2'
    );
    rerender(
        getCard({
            apiKey: 'current-key',
            baseUrl: 'https://second.example.com/v2',
            onBaseUrlChange,
        })
    );

    act(() => {
        jest.advanceTimersByTime(1000);
    });
    expect(fetchModels).toHaveBeenLastCalledWith(
        'current-key',
        'https://second.example.com/v2',
        expect.any(Function)
    );
});

test('a normalized prop echo owns the model-fetch identity after commit', async () => {
    jest.useFakeTimers();
    const persistence = deferred();
    const onBaseUrlChange = jest.fn(() => persistence.promise);
    const { rerender } = renderCard({
        apiKey: 'current-key',
        onBaseUrlChange,
    });
    const input = screen.getByLabelText('Base URL:');

    fireEvent.change(input, {
        target: { value: 'https://next.example.com/v2/' },
    });
    fireEvent.blur(input);
    rerender(
        getCard({
            apiKey: 'current-key',
            baseUrl: 'https://next.example.com/v2',
            onBaseUrlChange,
        })
    );

    await act(async () => {
        persistence.resolve(true);
        await persistence.promise;
        await Promise.resolve();
    });
    act(() => {
        jest.advanceTimersByTime(1000);
    });

    expect(fetchModels).toHaveBeenLastCalledWith(
        'current-key',
        'https://next.example.com/v2',
        expect.any(Function)
    );
});

test('only the newest debounced fetch publishes through the current callback', () => {
    jest.useFakeTimers();
    const requests = [];
    fetchModels.mockImplementation((key, url, onLoaded) => {
        requests.push({ key, url, onLoaded });
    });
    const firstOnModelsLoaded = jest.fn();
    const { rerender } = renderCard({
        onModelsLoaded: firstOnModelsLoaded,
    });
    const apiKeyInput = screen.getByLabelText('API Key:');

    fireEvent.change(apiKeyInput, { target: { value: 'first-key' } });
    act(() => {
        jest.advanceTimersByTime(1000);
    });
    fireEvent.change(apiKeyInput, { target: { value: 'second-key' } });
    act(() => {
        jest.advanceTimersByTime(1000);
    });
    expect(requests).toHaveLength(2);

    const currentOnModelsLoaded = jest.fn();
    rerender(
        getCard({
            apiKey: 'second-key',
            onModelsLoaded: currentOnModelsLoaded,
        })
    );
    expect(invalidateRequests).toHaveBeenCalledTimes(3);
    act(() => {
        requests[1].onLoaded(['current-model']);
        requests[0].onLoaded(['stale-model']);
    });

    expect(currentOnModelsLoaded).toHaveBeenCalledTimes(1);
    expect(currentOnModelsLoaded).toHaveBeenCalledWith(['current-model'], {
        apiKey: 'second-key',
        baseUrl: 'https://first.example.com/v1',
    });
    expect(firstOnModelsLoaded.mock.calls).toEqual([[[]], [[]], [[]]]);
});

test('an external credential change invalidates the old request identity', () => {
    const requests = [];
    const onModelsLoaded = jest.fn();
    fetchModels.mockImplementation((key, url, onLoaded) => {
        requests.push({ key, url, onLoaded });
    });
    const { rerender } = renderCard({
        apiKey: 'first-key',
        onModelsLoaded,
    });
    expect(requests).toHaveLength(1);

    rerender(
        getCard({
            apiKey: 'external-key',
            baseUrl: 'https://external.example.com/v1',
            onModelsLoaded,
        })
    );
    expect(invalidateRequests).toHaveBeenCalledTimes(3);
    expect(fetchModels).toHaveBeenCalledTimes(1);
    expect(testConnection).not.toHaveBeenCalled();
    act(() => {
        requests[0].onLoaded(['stale-model']);
    });

    expect(onModelsLoaded.mock.calls).toEqual([[[]], [[]]]);
});

test('returning to an earlier credential pair cannot revive its older generation', () => {
    jest.useFakeTimers();
    const requests = [];
    const onModelsLoaded = jest.fn();
    fetchModels.mockImplementation((key, url, onLoaded) => {
        requests.push({ key, url, onLoaded });
    });
    const { rerender } = renderCard({
        apiKey: 'key-a',
        baseUrl: 'https://a.example.com/v1',
        onModelsLoaded,
    });
    expect(requests).toHaveLength(1);

    rerender(
        getCard({
            apiKey: 'key-b',
            baseUrl: 'https://b.example.com/v1',
            onModelsLoaded,
        })
    );
    act(() => jest.advanceTimersByTime(1000));
    rerender(
        getCard({
            apiKey: 'key-a',
            baseUrl: 'https://a.example.com/v1',
            onModelsLoaded,
        })
    );
    act(() => jest.advanceTimersByTime(1000));
    expect(requests).toHaveLength(3);

    act(() => {
        requests[0].onLoaded(['stale-a1']);
        requests[1].onLoaded(['stale-b']);
        requests[2].onLoaded(['current-a2']);
    });

    expect(onModelsLoaded).not.toHaveBeenCalledWith(['stale-a1']);
    expect(onModelsLoaded).not.toHaveBeenCalledWith(['stale-b']);
    expect(onModelsLoaded).toHaveBeenCalledWith(['current-a2'], {
        apiKey: 'key-a',
        baseUrl: 'https://a.example.com/v1',
    });
});

test('a newer credential fetch invalidates older fetch and test results', () => {
    jest.useFakeTimers();
    const fetchRequests = [];
    const testRequests = [];
    const onModelsLoaded = jest.fn();
    fetchModels.mockImplementation((key, url, onLoaded) => {
        fetchRequests.push({ key, url, onLoaded });
    });
    testConnection.mockImplementation((key, url, onLoaded) => {
        testRequests.push({ key, url, onLoaded });
    });
    renderCard({ apiKey: 'first-key', onModelsLoaded });

    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));
    fireEvent.change(screen.getByLabelText('API Key:'), {
        target: { value: 'second-key' },
    });
    expect(onModelsLoaded.mock.calls).toEqual([[[]], [[]]]);
    act(() => {
        jest.advanceTimersByTime(1000);
    });
    expect(fetchRequests).toHaveLength(2);
    expect(testRequests).toHaveLength(1);

    act(() => {
        fetchRequests[0].onLoaded(['stale-auto-fetch']);
        testRequests[0].onLoaded(['stale-test']);
        fetchRequests[1].onLoaded(['latest-fetch']);
    });

    expect(onModelsLoaded.mock.calls).toEqual([
        [[]],
        [[]],
        [
            ['latest-fetch'],
            {
                apiKey: 'second-key',
                baseUrl: 'https://first.example.com/v1',
            },
        ],
    ]);
});

test('editing the base URL clears the old catalog and rejects its stale completion', () => {
    const requests = [];
    const onModelsLoaded = jest.fn();
    fetchModels.mockImplementation((key, url, onLoaded) => {
        requests.push({ key, url, onLoaded });
    });
    renderCard({ apiKey: 'current-key', onModelsLoaded });
    expect(requests).toHaveLength(1);

    fireEvent.change(screen.getByLabelText('Base URL:'), {
        target: { value: 'https://next.example.com/v1' },
    });

    expect(onModelsLoaded.mock.calls).toEqual([[[]], [[]]]);
    act(() => {
        requests[0].onLoaded(['stale-model']);
    });
    expect(onModelsLoaded.mock.calls).toEqual([[[]], [[]]]);
});

test('unmount cancels a debounced fetch and invalidates its hook state', () => {
    jest.useFakeTimers();
    const { unmount } = renderCard();

    fireEvent.change(screen.getByLabelText('API Key:'), {
        target: { value: 'pending-key' },
    });
    expect(invalidateRequests).toHaveBeenCalledTimes(2);

    unmount();
    expect(invalidateRequests).toHaveBeenCalledTimes(3);
    act(() => {
        jest.advanceTimersByTime(1000);
    });

    expect(fetchModels).not.toHaveBeenCalled();
});
