import { jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react';

import { useTranslation } from './useTranslation.js';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, reject, resolve };
}

function response(messages) {
    return {
        ok: true,
        json: jest.fn().mockResolvedValue(messages),
    };
}

describe('useTranslation', () => {
    test('keeps the latest locale when requests finish out of order', async () => {
        const olderRequest = deferred();
        const latestMessages = { greeting: { message: 'Latest' } };
        global.fetch = jest.fn((url) => {
            if (url.includes('_locales/popup_older/')) {
                return olderRequest.promise;
            }
            return Promise.resolve(response(latestMessages));
        });

        const hook = renderHook(({ locale }) => useTranslation(locale), {
            initialProps: { locale: 'popup-older' },
        });
        hook.rerender({ locale: 'popup-latest' });

        await waitFor(() => {
            expect(hook.result.current.t('greeting')).toBe('Latest');
            expect(hook.result.current.loading).toBe(false);
        });

        await act(async () => {
            olderRequest.resolve(response({ greeting: { message: 'Stale' } }));
            await olderRequest.promise;
        });

        expect(hook.result.current.t('greeting')).toBe('Latest');
    });

    test('reuses cached messages and formats substitutions', async () => {
        const messages = { greeting: { message: 'Hello %s, count %d' } };
        global.fetch = jest.fn().mockResolvedValue(response(messages));

        const first = renderHook(() => useTranslation('popup-cache'));
        await waitFor(() => expect(first.result.current.loading).toBe(false));
        expect(first.result.current.t('greeting', '', 'Sam', 2)).toBe(
            'Hello Sam, count 2'
        );
        first.unmount();

        const second = renderHook(() => useTranslation('popup-cache'));
        await waitFor(() => expect(second.result.current.loading).toBe(false));
        expect(second.result.current.translations).toBe(messages);
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('falls back to English when the selected locale is unavailable', async () => {
        const fallback = { greeting: { message: 'English' } };
        global.fetch = jest.fn((url) =>
            Promise.resolve(
                url.includes('_locales/en/')
                    ? response(fallback)
                    : { ok: false, status: 404 }
            )
        );

        const { result } = renderHook(() => useTranslation('popup-missing'));

        await waitFor(() => {
            expect(result.current.t('greeting')).toBe('English');
            expect(result.current.loading).toBe(false);
        });
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    test('does not start fallback work after unmount', async () => {
        const request = deferred();
        global.fetch = jest.fn(() => request.promise);
        const hook = renderHook(() => useTranslation('popup-unmounted'));

        await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
        hook.unmount();
        await act(async () => {
            request.reject(new Error('request failed'));
            await request.promise.catch(() => undefined);
        });

        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(console.warn).not.toHaveBeenCalled();
    });
});
