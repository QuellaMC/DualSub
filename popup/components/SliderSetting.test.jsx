import { jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { SliderSetting } from './SliderSetting.jsx';

describe('SliderSetting', () => {
    test('previews changes continuously and persists once interaction ends', () => {
        const onChange = jest.fn();
        const onChangeEnd = jest.fn();

        render(
            <SliderSetting
                id="font-size"
                label="Font size"
                min={0.5}
                max={2}
                step={0.1}
                value={1}
                onChange={onChange}
                onChangeEnd={onChangeEnd}
            />
        );

        const slider = screen.getByRole('slider', { name: 'Font size' });
        fireEvent.change(slider, { target: { value: '1.4' } });

        expect(onChange).toHaveBeenCalledWith(1.4);
        expect(onChangeEnd).not.toHaveBeenCalled();
        expect(screen.getByText('1.4')).toBeInTheDocument();

        fireEvent.pointerUp(slider);
        fireEvent.blur(slider);

        expect(onChangeEnd).toHaveBeenCalledTimes(1);
        expect(onChangeEnd).toHaveBeenCalledWith(1.4);
    });

    test('synchronizes its draft when the stored value changes', () => {
        const { rerender } = render(
            <SliderSetting
                id="gap"
                label="Gap"
                min={0}
                max={2}
                step={0.1}
                value={0.3}
                onChange={jest.fn()}
                onChangeEnd={jest.fn()}
            />
        );

        rerender(
            <SliderSetting
                id="gap"
                label="Gap"
                min={0}
                max={2}
                step={0.1}
                value={0.8}
                onChange={jest.fn()}
                onChangeEnd={jest.fn()}
            />
        );

        expect(screen.getByRole('slider', { name: 'Gap' })).toHaveValue('0.8');
        expect(screen.getByText('0.8')).toBeInTheDocument();
    });

    test('allows a failed asynchronous commit to be retried', async () => {
        const onChangeEnd = jest
            .fn()
            .mockRejectedValueOnce(new Error('storage unavailable'))
            .mockResolvedValueOnce(undefined);

        render(
            <SliderSetting
                id="font-size"
                label="Font size"
                min={0.5}
                max={2}
                step={0.1}
                value={1}
                onChange={jest.fn()}
                onChangeEnd={onChangeEnd}
            />
        );

        const slider = screen.getByRole('slider', { name: 'Font size' });
        fireEvent.change(slider, { target: { value: '1.4' } });
        await act(async () => {
            fireEvent.pointerUp(slider);
        });
        await act(async () => {
            fireEvent.pointerUp(slider);
        });

        expect(onChangeEnd).toHaveBeenCalledTimes(2);
        expect(onChangeEnd).toHaveBeenNthCalledWith(1, 1.4);
        expect(onChangeEnd).toHaveBeenNthCalledWith(2, 1.4);
    });
});
