// @vitest-environment happy-dom
import { createRoot } from 'react-dom/client';
import { act, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useDraft } from './useDraft';

function Counter({ write }: { write: (value: number) => Promise<boolean> }) {
    const draft = useDraft<number>(0, write);
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
