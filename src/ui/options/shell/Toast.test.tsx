// @vitest-environment happy-dom
import { createRoot } from 'react-dom/client';
import { act, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Toast } from './Toast';

const t = (key: string): string => key;

describe('Toast', () => {
    it('takes Ctrl+Z from the moment it shows', async () => {
        // React runs a render's effects in a task after its commit, and a key
        // press can land in between.
        const undo = vi.fn(() => Promise.resolve(true));
        const container = document.body.appendChild(
            document.createElement('div')
        );
        const root = createRoot(container);
        const pressed = new Promise<void>((resolve) => {
            new MutationObserver((_records, observer) => {
                if (container.querySelector('.toast')) {
                    observer.disconnect();
                    fireEvent.keyDown(document.body, {
                        key: 'z',
                        ctrlKey: true,
                    });
                    resolve();
                }
            }).observe(container, { childList: true, subtree: true });
        });
        root.render(
            <Toast
                t={t}
                toast={{ id: 1, message: 'Saved', tone: 'done', undo }}
                onDismiss={vi.fn()}
                onHold={vi.fn()}
            />
        );
        await pressed;

        expect(undo).toHaveBeenCalledOnce();
        act(() => root.unmount());
        container.remove();
    });
});
