// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useNow } from './useNow';

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('useNow', () => {
    it('reads the time again at a moment its timer reached a little early', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        let clock = 1_000;
        vi.spyOn(Date, 'now').mockImplementation(() => clock);
        const { result } = renderHook(() => useNow([1_100]));
        expect(result.current).toBe(1_000);

        clock = 1_099;
        await act(() => vi.advanceTimersByTimeAsync(100));
        clock = 1_100;
        await act(() => vi.advanceTimersByTimeAsync(1));
        expect(result.current).toBe(1_100);
    });
});
