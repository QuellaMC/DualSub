// @vitest-environment happy-dom
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SliderSetting } from './SliderSetting';

function setup(value = 1.1, onCommit = vi.fn(() => Promise.resolve(true))) {
    const onPreview = vi.fn();
    const view = render(
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
    const slider = screen.getByRole('slider', { name: 'Size' });
    const rerender = (next: number): void =>
        view.rerender(
            <SliderSetting
                id="size"
                label="Size"
                value={next}
                min={1}
                max={3}
                step={0.1}
                onPreview={onPreview}
                onCommit={onCommit}
            />
        );
    return { slider, onPreview, onCommit, rerender };
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

    it('does not commit when released at the persisted value', () => {
        const { slider, onCommit } = setup();
        fireEvent.pointerUp(slider);
        fireEvent.keyUp(slider, { key: 'ArrowRight' });
        expect(onCommit).not.toHaveBeenCalled();
    });

    it('snaps back to the persisted value when the commit fails', async () => {
        const { slider } = setup(
            1.1,
            vi.fn(() => Promise.resolve(false))
        );
        fireEvent.change(slider, { target: { value: '1.4' } });
        fireEvent.pointerUp(slider);
        await waitFor(() =>
            expect((slider as HTMLInputElement).value).toBe('1.1')
        );
    });

    it('keeps a newer draft when an older commit fails', async () => {
        const gate = Promise.withResolvers<boolean>();
        const { slider, onCommit } = setup(
            1.1,
            vi.fn(() => gate.promise)
        );
        fireEvent.change(slider, { target: { value: '1.4' } });
        fireEvent.pointerUp(slider);
        fireEvent.change(slider, { target: { value: '1.8' } });

        gate.resolve(false);
        await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
        await Promise.resolve();
        expect((slider as HTMLInputElement).value).toBe('1.8');
    });

    it('follows the authoritative value', () => {
        const { slider, rerender } = setup();
        rerender(2);
        expect((slider as HTMLInputElement).value).toBe('2');
        expect(screen.getByText('2.0')).toBeTruthy();
    });
});
