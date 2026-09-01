import { jest } from '@jest/globals';
import React, { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';

const fetchModels = jest.fn();
const testConnection = jest.fn();
const invalidateRequests = jest.fn();
const initializeStatus = jest.fn();
const useOpenAITest = jest.fn();
let hookState;

jest.unstable_mockModule('../../hooks/index.js', () => ({
    useOpenAITest,
}));

const { OpenAICompatibleProviderCard } =
    await import('./OpenAICompatibleProviderCard.jsx');

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

function StatefulCard({
    initialApiKey = '',
    initialBaseUrl = 'https://first.example.com/v1',
    onBaseUrlCommit = jest.fn().mockResolvedValue(true),
    onModelsLoaded,
}) {
    const [apiKey, setApiKey] = useState(initialApiKey);
    const [baseUrl, setBaseUrl] = useState(initialBaseUrl);

    const commitBaseUrl = async (value) => {
        const accepted = await onBaseUrlCommit(value);
        if (accepted !== false) {
            setBaseUrl(value);
        }
        return accepted;
    };

    return getCard({
        apiKey,
        baseUrl,
        onApiKeyChange: setApiKey,
        onBaseUrlChange: commitBaseUrl,
        onModelsLoaded,
    });
}

beforeEach(() => {
    fetchModels.mockReset();
    testConnection.mockReset();
    invalidateRequests.mockReset();
    initializeStatus.mockReset();
    hookState = {
        testResult: { visible: false, message: '', type: 'info' },
        testing: false,
        fetchingModels: false,
        testConnection,
        fetchModels,
        invalidateRequests,
        initializeStatus,
    };
    useOpenAITest.mockImplementation(() => hookState);
});

afterEach(() => {
    jest.useRealTimers();
});

test('the base URL remains a draft until blur commits and then fetches the committed endpoint', async () => {
    jest.useFakeTimers();
    const onBaseUrlCommit = jest.fn().mockResolvedValue(true);
    const onModelsLoaded = jest.fn();
    render(
        <StatefulCard
            initialApiKey="current-key"
            onBaseUrlCommit={onBaseUrlCommit}
            onModelsLoaded={onModelsLoaded}
        />
    );
    const input = screen.getByLabelText('Base URL:');

    fireEvent.change(input, {
        target: { value: 'https://second.example.com/v2' },
    });
    expect(input).toHaveValue('https://second.example.com/v2');
    expect(onBaseUrlCommit).not.toHaveBeenCalled();

    await act(async () => {
        fireEvent.blur(input);
        await Promise.resolve();
        await Promise.resolve();
    });
    expect(onBaseUrlCommit).toHaveBeenCalledWith(
        'https://second.example.com/v2'
    );

    act(() => {
        jest.advanceTimersByTime(999);
    });
    expect(fetchModels).not.toHaveBeenCalled();
    act(() => {
        jest.advanceTimersByTime(1);
    });
    expect(fetchModels).toHaveBeenCalledWith(
        'current-key',
        'https://second.example.com/v2',
        onModelsLoaded
    );
});

test('an invalid base URL stays editable without being persisted', () => {
    const onBaseUrlCommit = jest.fn();
    render(
        <StatefulCard
            onBaseUrlCommit={onBaseUrlCommit}
            onModelsLoaded={jest.fn()}
        />
    );
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
    expect(onBaseUrlCommit).not.toHaveBeenCalled();
});

test('rapid credential edits produce one debounced fetch for the rendered identity', () => {
    jest.useFakeTimers();
    const onModelsLoaded = jest.fn();
    render(<StatefulCard onModelsLoaded={onModelsLoaded} />);
    const input = screen.getByLabelText('API Key:');

    fireEvent.change(input, { target: { value: 'first-key' } });
    fireEvent.change(input, { target: { value: 'current-key' } });
    act(() => {
        jest.advanceTimersByTime(999);
    });
    expect(fetchModels).not.toHaveBeenCalled();

    act(() => {
        jest.advanceTimersByTime(1);
    });
    expect(fetchModels).toHaveBeenCalledTimes(1);
    expect(fetchModels).toHaveBeenCalledWith(
        'current-key',
        'https://first.example.com/v1',
        onModelsLoaded
    );
});

test('connection status and catalog loading are visible', () => {
    hookState.testResult = {
        visible: true,
        message: 'Models are loading.',
        type: 'info',
    };
    hookState.fetchingModels = true;

    render(getCard());

    expect(screen.getByText('Models are loading.')).toBeVisible();
    expect(screen.getByRole('option', { name: 'Loading...' })).toBeVisible();
});

test('testing uses the rendered identity and cancels its pending automatic fetch', () => {
    jest.useFakeTimers();
    const onModelsLoaded = jest.fn();
    render(
        getCard({
            apiKey: 'current-key',
            baseUrl: 'https://current.example.com/v1',
            onModelsLoaded,
        })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));
    expect(testConnection).toHaveBeenCalledWith(
        'current-key',
        'https://current.example.com/v1',
        onModelsLoaded
    );

    act(() => {
        jest.advanceTimersByTime(1000);
    });
    expect(fetchModels).not.toHaveBeenCalled();
});

test('unmount cancels a pending model fetch', () => {
    jest.useFakeTimers();
    const { unmount } = render(
        getCard({
            apiKey: 'current-key',
            onModelsLoaded: jest.fn(),
        })
    );

    unmount();
    act(() => {
        jest.advanceTimersByTime(1000);
    });

    expect(fetchModels).not.toHaveBeenCalled();
});
