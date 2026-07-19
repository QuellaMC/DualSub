import { jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react';

import { useTranslation } from './useTranslation.js';

function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function createResponse(messages) {
    return {
        ok: true,
        json: jest.fn().mockResolvedValue(messages),
    };
}

describe('useTranslation locale loading', () => {
    test('keeps the latest locale when an older request resolves afterward', async () => {
        const olderResponse = createDeferred();
        const olderMessages = {
            greeting: { message: 'Older locale' },
        };
        const latestMessages = {
            greeting: { message: 'Latest locale' },
        };
        global.fetch = jest.fn((url) => {
            if (url.includes('_locales/l02_older/')) {
                return olderResponse.promise;
            }
            if (url.includes('_locales/l02_latest/')) {
                return Promise.resolve(createResponse(latestMessages));
            }
            throw new Error(`Unexpected translation URL: ${url}`);
        });

        const { result, rerender } = renderHook(
            ({ locale }) => useTranslation(locale),
            { initialProps: { locale: 'l02-older' } }
        );

        rerender({ locale: 'l02-latest' });
        await waitFor(() => {
            expect(result.current.translations).toBe(latestMessages);
            expect(result.current.loading).toBe(false);
        });

        await act(async () => {
            olderResponse.resolve(createResponse(olderMessages));
            await olderResponse.promise;
        });

        expect(result.current.translations).toBe(latestMessages);
        expect(result.current.t('greeting')).toBe('Latest locale');
        expect(result.current.loading).toBe(false);
    });

    test('keeps a cached latest locale when an older request resolves afterward', async () => {
        const cachedMessages = {
            greeting: { message: 'Cached latest locale' },
        };
        global.fetch = jest
            .fn()
            .mockResolvedValue(createResponse(cachedMessages));

        const cachedHook = renderHook(() => useTranslation('l02-cachelatest'));
        await waitFor(() => {
            expect(cachedHook.result.current.translations).toBe(cachedMessages);
        });
        cachedHook.unmount();

        const olderResponse = createDeferred();
        const olderMessages = {
            greeting: { message: 'Older network locale' },
        };
        global.fetch = jest.fn((url) => {
            if (url.includes('_locales/l02_cacheolder/')) {
                return olderResponse.promise;
            }
            throw new Error(`Unexpected translation URL: ${url}`);
        });

        const { result, rerender } = renderHook(
            ({ locale }) => useTranslation(locale),
            { initialProps: { locale: 'l02-cacheolder' } }
        );
        await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

        rerender({ locale: 'l02-cachelatest' });
        await waitFor(() => {
            expect(result.current.translations).toBe(cachedMessages);
            expect(result.current.loading).toBe(false);
        });

        await act(async () => {
            olderResponse.resolve(createResponse(olderMessages));
            await olderResponse.promise;
        });

        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(result.current.translations).toBe(cachedMessages);
        expect(result.current.t('greeting')).toBe('Cached latest locale');
        expect(result.current.loading).toBe(false);
    });

    test('does not let an older locale fallback overwrite the latest locale', async () => {
        const fallbackResponse = createDeferred();
        const fallbackMessages = {
            greeting: { message: 'Older English fallback' },
        };
        const latestMessages = {
            greeting: { message: 'Latest primary locale' },
        };
        global.fetch = jest.fn((url) => {
            if (url.includes('_locales/l02_fallbackolder/')) {
                return Promise.resolve({ ok: false, status: 404 });
            }
            if (url.includes('_locales/en/')) {
                return fallbackResponse.promise;
            }
            if (url.includes('_locales/l02_fallbacklatest/')) {
                return Promise.resolve(createResponse(latestMessages));
            }
            throw new Error(`Unexpected translation URL: ${url}`);
        });

        const { result, rerender, unmount } = renderHook(
            ({ locale }) => useTranslation(locale),
            { initialProps: { locale: 'l02-fallbackolder' } }
        );
        await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));

        rerender({ locale: 'l02-fallbacklatest' });
        await waitFor(() => {
            expect(result.current.translations).toBe(latestMessages);
            expect(result.current.loading).toBe(false);
        });

        await act(async () => {
            fallbackResponse.resolve(createResponse(fallbackMessages));
            await fallbackResponse.promise;
        });

        expect(result.current.translations).toBe(latestMessages);
        expect(result.current.t('greeting')).toBe('Latest primary locale');
        expect(result.current.loading).toBe(false);

        unmount();
        const freshEnglishMessages = {
            greeting: { message: 'Fresh English locale' },
        };
        global.fetch = jest
            .fn()
            .mockResolvedValue(createResponse(freshEnglishMessages));
        const englishHook = renderHook(() => useTranslation('en'));
        await waitFor(() => {
            expect(englishHook.result.current.translations).toBe(
                freshEnglishMessages
            );
        });
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('does not start fallback after a primary request becomes stale', async () => {
        const stalePrimaryResponse = createDeferred();
        const latestMessages = {
            greeting: { message: 'Latest without stale fallback' },
        };
        global.fetch = jest.fn((url) => {
            if (url.includes('_locales/l02_staleprimary/')) {
                return stalePrimaryResponse.promise;
            }
            if (url.includes('_locales/l02_staleprimarylatest/')) {
                return Promise.resolve(createResponse(latestMessages));
            }
            if (url.includes('_locales/en/')) {
                return Promise.resolve(
                    createResponse({
                        greeting: { message: 'Unwanted fallback' },
                    })
                );
            }
            throw new Error(`Unexpected translation URL: ${url}`);
        });

        const { result, rerender } = renderHook(
            ({ locale }) => useTranslation(locale),
            { initialProps: { locale: 'l02-staleprimary' } }
        );
        rerender({ locale: 'l02-staleprimarylatest' });
        await waitFor(() => {
            expect(result.current.translations).toBe(latestMessages);
        });

        await act(async () => {
            stalePrimaryResponse.resolve({ ok: false, status: 404 });
            await stalePrimaryResponse.promise;
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        const requestedUrls = global.fetch.mock.calls.map(([url]) => url);
        expect(requestedUrls).toHaveLength(2);
        expect(requestedUrls.some((url) => url.includes('_locales/en/'))).toBe(
            false
        );
        expect(result.current.translations).toBe(latestMessages);
    });

    test('ignores a fallback failure after its locale becomes stale', async () => {
        const staleFallback = createDeferred();
        const latestMessages = {
            greeting: { message: 'Latest after stale fallback error' },
        };
        global.fetch = jest.fn((url) => {
            if (url.includes('_locales/l02_stalefallbackerror/')) {
                return Promise.resolve({ ok: false, status: 404 });
            }
            if (url.includes('_locales/en/')) {
                return staleFallback.promise;
            }
            if (url.includes('_locales/l02_stalefallbacklatest/')) {
                return Promise.resolve(createResponse(latestMessages));
            }
            throw new Error(`Unexpected translation URL: ${url}`);
        });

        const { result, rerender } = renderHook(
            ({ locale }) => useTranslation(locale),
            { initialProps: { locale: 'l02-stalefallbackerror' } }
        );
        await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
        rerender({ locale: 'l02-stalefallbacklatest' });
        await waitFor(() => {
            expect(result.current.translations).toBe(latestMessages);
        });

        await act(async () => {
            staleFallback.reject(new Error('stale fallback failed'));
            await staleFallback.promise.catch(() => {});
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        expect(console.error).not.toHaveBeenCalled();
        expect(result.current.translations).toBe(latestMessages);
        expect(result.current.loading).toBe(false);
    });

    test('loads English when the current locale is unavailable', async () => {
        const fallbackMessages = {
            greeting: { message: 'English fallback' },
        };
        global.fetch = jest.fn((url) => {
            if (url.includes('_locales/l02_missing/')) {
                return Promise.resolve({ ok: false, status: 404 });
            }
            if (url.includes('_locales/en/')) {
                return Promise.resolve(createResponse(fallbackMessages));
            }
            throw new Error(`Unexpected translation URL: ${url}`);
        });

        const { result } = renderHook(() => useTranslation('l02-missing'));

        await waitFor(() => {
            expect(result.current.translations).toBe(fallbackMessages);
            expect(result.current.t('greeting')).toBe('English fallback');
            expect(result.current.loading).toBe(false);
        });
    });

    test('stays loading when only a stale locale request has completed', async () => {
        const olderResponse = createDeferred();
        const latestResponse = createDeferred();
        const latestMessages = {
            greeting: { message: 'Latest after loading' },
        };
        global.fetch = jest.fn((url) => {
            if (url.includes('_locales/l02_loadingolder/')) {
                return olderResponse.promise;
            }
            if (url.includes('_locales/l02_loadinglatest/')) {
                return latestResponse.promise;
            }
            throw new Error(`Unexpected translation URL: ${url}`);
        });

        const { result, rerender } = renderHook(
            ({ locale }) => useTranslation(locale),
            { initialProps: { locale: 'l02-loadingolder' } }
        );
        rerender({ locale: 'l02-loadinglatest' });

        await act(async () => {
            olderResponse.resolve(
                createResponse({ greeting: { message: 'Stale' } })
            );
            await olderResponse.promise;
        });

        expect(result.current.translations).toEqual({});
        expect(result.current.loading).toBe(true);

        await act(async () => {
            latestResponse.resolve(createResponse(latestMessages));
            await latestResponse.promise;
        });

        await waitFor(() => {
            expect(result.current.translations).toBe(latestMessages);
            expect(result.current.loading).toBe(false);
        });
    });

    test('does not cache a stale locale response for a later mount', async () => {
        const staleResponse = createDeferred();
        const staleMessages = {
            greeting: { message: 'Stale cached locale' },
        };
        const staleResponseValue = createResponse(staleMessages);
        const latestMessages = {
            greeting: { message: 'Latest other locale' },
        };
        global.fetch = jest.fn((url) => {
            if (url.includes('_locales/l02_stalecache/')) {
                return staleResponse.promise;
            }
            if (url.includes('_locales/l02_stalecachelatest/')) {
                return Promise.resolve(createResponse(latestMessages));
            }
            throw new Error(`Unexpected translation URL: ${url}`);
        });

        const firstHook = renderHook(({ locale }) => useTranslation(locale), {
            initialProps: { locale: 'l02-stalecache' },
        });
        firstHook.rerender({ locale: 'l02-stalecachelatest' });
        await waitFor(() => {
            expect(firstHook.result.current.translations).toBe(latestMessages);
        });

        await act(async () => {
            staleResponse.resolve(staleResponseValue);
            await staleResponse.promise;
            await Promise.resolve();
        });
        expect(staleResponseValue.json).not.toHaveBeenCalled();
        firstHook.unmount();

        const freshMessages = {
            greeting: { message: 'Fresh locale' },
        };
        global.fetch = jest
            .fn()
            .mockResolvedValue(createResponse(freshMessages));
        const freshHook = renderHook(() => useTranslation('l02-stalecache'));

        await waitFor(() => {
            expect(freshHook.result.current.translations).toBe(freshMessages);
            expect(freshHook.result.current.loading).toBe(false);
        });
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('does not commit a response that finishes after unmount', async () => {
        const unmountedResponse = createDeferred();
        const staleMessages = {
            greeting: { message: 'Unmounted stale locale' },
        };
        const staleResponseValue = createResponse(staleMessages);
        global.fetch = jest.fn(() => unmountedResponse.promise);

        const unmountedHook = renderHook(() => useTranslation('l02-unmounted'));
        await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
        unmountedHook.unmount();

        await act(async () => {
            unmountedResponse.resolve(staleResponseValue);
            await unmountedResponse.promise;
            await Promise.resolve();
        });
        expect(staleResponseValue.json).not.toHaveBeenCalled();

        const freshMessages = {
            greeting: { message: 'Fresh remounted locale' },
        };
        global.fetch = jest
            .fn()
            .mockResolvedValue(createResponse(freshMessages));
        const remountedHook = renderHook(() => useTranslation('l02-unmounted'));

        await waitFor(() => {
            expect(remountedHook.result.current.translations).toBe(
                freshMessages
            );
            expect(remountedHook.result.current.loading).toBe(false);
        });
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });
});
