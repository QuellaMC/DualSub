// @vitest-environment happy-dom
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act, fireEvent, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useDraft } from './useDraft';

/** A count that each write stores, as a settings handle would. */
function Counter({ write }: { write: (value: number) => Promise<boolean> }) {
    const [stored, setStored] = useState(0);
    const draft = useDraft(stored, async (value) => {
        const persisted = await write(value);
        setStored(value);
        return persisted;
    });
    return (
        <button
            type="button"
            onClick={() => draft.update((count) => count + 1, 'quiet')}
        >
            {draft.value}
        </button>
    );
}

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

        act(() => {
            result.current.set(0.5, 'quiet');
        });
        act(() => {
            result.current.set(result.current.value + 0.5, 'quiet');
        });
        await act(async () => {
            releases.shift()?.();
            await Promise.resolve();
        });
        rerender({ saved: 0.5 });
        expect(result.current.value).toBe(1);

        act(() => {
            result.current.set(result.current.value + 0.5, 'quiet');
        });
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

    it('adopts a value stored elsewhere while its write was out, once that write settles', async () => {
        let release: () => void = () => undefined;
        const write = (): Promise<boolean> =>
            new Promise((resolve) => {
                release = () => resolve(true);
            });
        const { result, rerender } = renderHook(
            ({ saved }) => useDraft(saved, write),
            { initialProps: { saved: 1 } }
        );
        act(() => {
            result.current.set(2, 'quiet');
        });
        // Another window stores a newer value while this write is out.
        rerender({ saved: 3 });
        expect(result.current.value).toBe(2);

        await act(async () => {
            release();
            await Promise.resolve();
        });
        expect(result.current.value).toBe(3);
    });

    it('builds on presses made the moment the control shows', async () => {
        // React runs a render's effects in a task after its commit, and a
        // press can land in between.
        const writes: number[] = [];
        const write = (value: number): Promise<boolean> => {
            writes.push(value);
            return Promise.resolve(true);
        };
        const container = document.body.appendChild(
            document.createElement('div')
        );
        const root = createRoot(container);
        const pressed = new Promise<void>((resolve) => {
            new MutationObserver((_records, observer) => {
                const button = container.querySelector('button');
                if (button) {
                    observer.disconnect();
                    fireEvent.click(button);
                    fireEvent.click(button);
                    resolve();
                }
            }).observe(container, { childList: true, subtree: true });
        });
        root.render(<Counter write={write} />);
        await pressed;

        await waitFor(() => expect(writes).toEqual([1, 2]));
        expect(container.querySelector('button')?.textContent).toBe('2');
        act(() => root.unmount());
        container.remove();
    });
});
