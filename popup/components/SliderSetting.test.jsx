import { jest } from '@jest/globals';
import {
    act,
    fireEvent,
    render,
    screen,
    waitFor,
} from '@testing-library/react';
import { SliderSetting } from './SliderSetting.jsx';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, reject, resolve };
}

function renderSlider(props = {}) {
    return render(
        <SliderSetting
            id="font-size"
            label="Font size"
            min={0.5}
            max={2}
            step={0.1}
            value={1}
            onChange={jest.fn()}
            onChangeEnd={jest.fn()}
            {...props}
        />
    );
}

describe('SliderSetting', () => {
    test('previews continuously and persists a released value once', () => {
        const onChange = jest.fn();
        const onChangeEnd = jest.fn();
        renderSlider({ onChange, onChangeEnd });

        const slider = screen.getByRole('slider', { name: 'Font size' });
        fireEvent.change(slider, { target: { value: '1.2' } });
        fireEvent.change(slider, { target: { value: '1.4' } });

        expect(onChange.mock.calls.map(([value]) => value)).toEqual([1.2, 1.4]);
        expect(screen.getByText('1.4')).toBeInTheDocument();
        expect(onChangeEnd).not.toHaveBeenCalled();

        fireEvent.pointerUp(slider);
        fireEvent.blur(slider);

        expect(onChangeEnd).toHaveBeenCalledTimes(1);
        expect(onChangeEnd.mock.calls[0][0]).toBe(1.4);
        expect(onChangeEnd.mock.calls[0][1].getConfirmedValue()).toBe(1);
        expect(onChangeEnd.mock.calls[0][1].isCurrent()).toBe(true);
    });

    test('uses successful persistence as confirmation for the latest preview', async () => {
        const first = deferred();
        const second = deferred();
        const onChangeEnd = jest
            .fn()
            .mockReturnValueOnce(first.promise)
            .mockReturnValueOnce(second.promise);
        renderSlider({ onChangeEnd });

        const slider = screen.getByRole('slider', { name: 'Font size' });
        fireEvent.change(slider, { target: { value: '1.4' } });
        fireEvent.pointerUp(slider);
        fireEvent.change(slider, { target: { value: '1.8' } });
        fireEvent.pointerUp(slider);

        const firstContext = onChangeEnd.mock.calls[0][1];
        const latestContext = onChangeEnd.mock.calls[1][1];
        expect(firstContext.isCurrent()).toBe(false);
        expect(latestContext.isCurrent()).toBe(true);

        await act(async () => {
            first.resolve();
            await first.promise;
        });
        expect(latestContext.getConfirmedValue()).toBe(1.4);

        await act(async () => {
            second.resolve();
            await second.promise;
        });
    });

    test('accepts authoritative props and invalidates an older preview', () => {
        const pending = deferred();
        const onChangeEnd = jest.fn(() => pending.promise);
        const view = renderSlider({ onChangeEnd });
        const slider = screen.getByRole('slider', { name: 'Font size' });

        fireEvent.change(slider, { target: { value: '1.4' } });
        fireEvent.pointerUp(slider);
        const context = onChangeEnd.mock.calls[0][1];

        view.rerender(
            <SliderSetting
                id="font-size"
                label="Font size"
                min={0.5}
                max={2}
                step={0.1}
                value={1.8}
                onChange={jest.fn()}
                onChangeEnd={onChangeEnd}
            />
        );

        expect(slider).toHaveValue('1.8');
        expect(screen.getByText('1.8')).toBeInTheDocument();
        expect(context.isCurrent()).toBe(false);
    });

    test('allows a failed released value to be retried', async () => {
        const onChangeEnd = jest
            .fn()
            .mockRejectedValueOnce(new Error('storage unavailable'))
            .mockResolvedValueOnce(undefined);
        renderSlider({ onChangeEnd });
        const slider = screen.getByRole('slider', { name: 'Font size' });

        fireEvent.change(slider, { target: { value: '1.4' } });
        fireEvent.pointerUp(slider);
        await waitFor(() => expect(onChangeEnd).toHaveBeenCalledTimes(1));
        await act(async () => {
            await Promise.resolve();
        });
        fireEvent.pointerUp(slider);

        await waitFor(() => expect(onChangeEnd).toHaveBeenCalledTimes(2));
        expect(onChangeEnd.mock.calls.map(([value]) => value)).toEqual([
            1.4, 1.4,
        ]);
    });
});
