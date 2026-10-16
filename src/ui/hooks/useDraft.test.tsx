// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useDraft } from './useDraft';

describe('useDraft', () => {
    it('builds on its own picks while their writes are out, whatever echoes back meanwhile', async () => {
        const writes: number[] = [];
        const releases: (() => void)[] = [];
        const write = (value: number): Promise<boolean> => {
            writes.push(value);
            return new Promise((resolve) => {
                releases.push(() => resolve(true));
            });
        };
        const { result, rerender } = renderHook(
            ({ saved }) => useDraft(saved, write),
            { initialProps: { saved: 0 } }
        );

        act(() => result.current.set(0.5, 'quiet'));
        act(() => result.current.set(result.current.value + 0.5, 'quiet'));
        await act(async () => {
            releases.shift()?.();
            await Promise.resolve();
        });
        rerender({ saved: 0.5 });
        expect(result.current.value).toBe(1);

        act(() => result.current.set(result.current.value + 0.5, 'quiet'));
        await act(async () => {
            releases.shift()?.();
            await Promise.resolve();
        });
        rerender({ saved: 1 });
        expect(result.current.value).toBe(1.5);
        await act(async () => {
            releases.shift()?.();
            await Promise.resolve();
        });
        rerender({ saved: 1.5 });

        expect(writes).toEqual([0.5, 1, 1.5]);
        expect(result.current.value).toBe(1.5);
    });

    it('adopts a value from storage once nothing of its own is waiting', () => {
        const { result, rerender } = renderHook(
            ({ saved }) => useDraft(saved, () => Promise.resolve(true)),
            { initialProps: { saved: 1 } }
        );
        rerender({ saved: 2 });
        expect(result.current.value).toBe(2);
    });
});
