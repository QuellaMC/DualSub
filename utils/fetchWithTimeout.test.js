import { jest } from '@jest/globals';
import { fetchWithTimeout } from './fetchWithTimeout.js';

describe('fetchWithTimeout', () => {
    test('aborts a stalled request with a retryable timeout error', async () => {
        jest.useFakeTimers();
        const originalFetch = global.fetch;
        global.fetch = jest.fn(
            (_input, { signal }) =>
                new Promise((_resolve, reject) => {
                    signal.addEventListener('abort', () => {
                        const error = new Error('aborted');
                        error.name = 'AbortError';
                        reject(error);
                    });
                })
        );

        try {
            const request = fetchWithTimeout(
                'https://provider.example.test/request',
                {},
                25
            );
            const expectation = expect(request).rejects.toMatchObject({
                name: 'TimeoutError',
                retryable: true,
            });
            await jest.advanceTimersByTimeAsync(25);

            await expectation;
        } finally {
            global.fetch = originalFetch;
            jest.useRealTimers();
        }
    });

    test('keeps the deadline active while a response body is being read', async () => {
        jest.useFakeTimers();
        const originalFetch = global.fetch;
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: jest.fn(() => new Promise(() => {})),
        });

        try {
            const response = await fetchWithTimeout(
                'https://provider.example.test/request',
                {},
                25
            );
            const bodyRead = response.json();
            const expectation = expect(bodyRead).rejects.toMatchObject({
                name: 'TimeoutError',
                retryable: true,
            });

            await jest.advanceTimersByTimeAsync(25);

            await expectation;
        } finally {
            global.fetch = originalFetch;
            jest.useRealTimers();
        }
    });

    test('preserves response properties and successful body methods', async () => {
        const originalFetch = global.fetch;
        const json = jest.fn().mockResolvedValue({ translated: true });
        global.fetch = jest
            .fn()
            .mockResolvedValue({ ok: true, status: 200, json });

        try {
            const response = await fetchWithTimeout(
                'https://provider.example.test/request'
            );

            expect(response).toMatchObject({ ok: true, status: 200 });
            await expect(response.json()).resolves.toEqual({
                translated: true,
            });
            expect(json).toHaveBeenCalledTimes(1);
        } finally {
            global.fetch = originalFetch;
        }
    });
});
