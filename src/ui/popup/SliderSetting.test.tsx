// @vitest-environment happy-dom
import { createRoot } from 'react-dom/client';
import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SliderSetting } from './SliderSetting';

function sizeSlider(
    value: number,
    onPreview: (value: number) => void,
    onCommit: (value: number) => Promise<void>
) {
    return (
        <SliderSetting
            id="size"
            label="Size"
            value={value}
            min={1}
            max={3}
            step={0.1}
            onPreview={onPreview}
            onCommit={onCommit}
        />
    );
}

function setup(value = 1.1, onCommit = vi.fn(() => Promise.resolve())) {
    const onPreview = vi.fn();
    const view = render(sizeSlider(value, onPreview, onCommit));
    const rerender = (next: number): void =>
        view.rerender(sizeSlider(next, onPreview, onCommit));
    return {
        slider: screen.getByRole('slider', { name: 'Size' }),
        onPreview,
        onCommit,
        rerender,
    };
}

afterEach(() => {
    cleanup();
});

describe('SliderSetting', () => {
    it('previews every change and commits once on release', () => {
        const { slider, onPreview, onCommit } = setup();
        fireEvent.change(slider, { target: { value: '1.4' } });
        expect(onPreview).toHaveBeenCalledWith(1.4);
        expect(onCommit).not.toHaveBeenCalled();
        expect(screen.getByText('1.4')).toBeTruthy();

        fireEvent.pointerUp(slider);
        fireEvent.pointerUp(slider);
        fireEvent.blur(slider);
        expect(onCommit).toHaveBeenCalledTimes(1);
        expect(onCommit).toHaveBeenCalledWith(1.4);
    });

    it('does not commit a release without a change', () => {
        const { slider, onCommit } = setup();
        fireEvent.pointerUp(slider);
        fireEvent.keyUp(slider, { key: 'ArrowRight' });
        expect(onCommit).not.toHaveBeenCalled();
    });

    it('snaps back to the persisted value when a commit leaves it unchanged', async () => {
        const { slider } = setup();
        fireEvent.change(slider, { target: { value: '1.4' } });
        fireEvent.pointerUp(slider);
        await waitFor(() =>
            expect((slider as HTMLInputElement).value).toBe('1.1')
        );
    });

    it('keeps a newer draft when an older commit settles', async () => {
        const gate = Promise.withResolvers<void>();
        const { slider } = setup(
            1.1,
            vi.fn(() => gate.promise)
        );
        fireEvent.change(slider, { target: { value: '1.4' } });
        fireEvent.pointerUp(slider);
        fireEvent.change(slider, { target: { value: '1.8' } });

        gate.resolve();
        await act(() => gate.promise);
        expect((slider as HTMLInputElement).value).toBe('1.8');
    });

    it('follows the authoritative value', () => {
        const { slider, rerender } = setup();
        rerender(2);
        expect((slider as HTMLInputElement).value).toBe('2');
        expect(screen.getByText('2.0')).toBeTruthy();
    });

    it('follows the authoritative value again once a commit settles', async () => {
        const commit = Promise.withResolvers<void>();
        const { slider, rerender } = setup(
            1.1,
            vi.fn(() => commit.promise)
        );
        fireEvent.change(slider, { target: { value: '1.4' } });
        fireEvent.pointerUp(slider);
        commit.resolve();
        await act(() => commit.promise);

        rerender(2);
        expect((slider as HTMLInputElement).value).toBe('2');
    });

    it('keeps a draft over a value that arrives while the user drags', () => {
        const { slider, onCommit, rerender } = setup();
        fireEvent.change(slider, { target: { value: '1.4' } });
        rerender(2);
        expect((slider as HTMLInputElement).value).toBe('1.4');

        fireEvent.pointerUp(slider);
        expect(onCommit).toHaveBeenCalledWith(1.4);
    });

    it('keeps a change made the moment the slider appears', async () => {
        // React runs a render's effects in a task after its commit, and an
        // input can land in between, as the popup's first drag can on a
        // busy machine.
        const onCommit = vi.fn(() => Promise.resolve());
        const container = document.body.appendChild(
            document.createElement('div')
        );
        const root = createRoot(container);
        const released = new Promise<void>((resolve) => {
            new MutationObserver((_records, observer) => {
                observer.disconnect();
                const input = screen.getByRole('slider', { name: 'Size' });
                fireEvent.change(input, { target: { value: '1.4' } });
                fireEvent.pointerUp(input);
                resolve();
            }).observe(container, { childList: true });
        });
        root.render(sizeSlider(1.1, vi.fn(), onCommit));
        await released;

        expect(onCommit).toHaveBeenCalledWith(1.4);
        act(() => root.unmount());
        container.remove();
    });
});
