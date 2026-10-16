// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
    writeTranslationHealth,
    type TranslationHealth,
} from '@/shared/translationHealth';
import { useTranslationHealth } from './useTranslationHealth';

const RECORD: TranslationHealth = {
    provider: 'deepl',
    problem: 'quota',
    fallback: 'microsoft_edge',
    since: 1,
};

beforeEach(async () => {
    await fakeBrowser.storage.session.clear();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('useTranslationHealth', () => {
    it('follows the record as the translation service writes and clears it', async () => {
        await writeTranslationHealth(RECORD);
        const { result } = renderHook(() => useTranslationHealth());
        await waitFor(() => expect(result.current).toEqual(RECORD));

        await act(() => writeTranslationHealth(null));
        expect(result.current).toBeNull();
    });

    it('keeps a change that lands while the first read is in flight', async () => {
        let finishRead: (items: Record<string, unknown>) => void = () =>
            undefined;
        vi.spyOn(browser.storage.session, 'get').mockReturnValueOnce(
            new Promise((resolve) => {
                finishRead = resolve;
            }) as never
        );
        const { result } = renderHook(() => useTranslationHealth());

        await act(() => writeTranslationHealth(RECORD));
        await act(async () => {
            finishRead({});
            await Promise.resolve();
        });
        expect(result.current).toEqual(RECORD);
    });
});
