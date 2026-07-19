import { jest } from '@jest/globals';
import {
    act,
    fireEvent,
    render,
    screen,
    waitFor,
} from '@testing-library/react';
import { useEffect, useRef, useState } from 'react';
import { SliderSetting } from './SliderSetting.jsx';

function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((promiseResolve, promiseReject) => {
        resolve = promiseResolve;
        reject = promiseReject;
    });
    return { promise, reject, resolve };
}

function ControlledSlider({
    authoritativeValue = 1,
    onCommitStarted = () => {},
    onPersist,
    optimistic = true,
}) {
    const [value, setValue] = useState(authoritativeValue);
    const mountedRef = useRef(true);

    useEffect(() => {
        setValue(authoritativeValue);
    }, [authoritativeValue]);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    const handleChangeEnd = async (nextValue) => {
        onCommitStarted({ mounted: mountedRef.current, value: nextValue });
        if (optimistic && mountedRef.current) {
            setValue(nextValue);
        }
        await onPersist(nextValue);
    };

    return (
        <SliderSetting
            id="font-size"
            label="Font size"
            min={0.5}
            max={2}
            step={0.1}
            value={value}
            onChange={jest.fn()}
            onChangeEnd={handleChangeEnd}
        />
    );
}

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
        expect(onChangeEnd.mock.calls[0][0]).toBe(1.4);
        expect(onChangeEnd.mock.calls[0][1].confirmedValue).toBe(1);
        expect(onChangeEnd.mock.calls[0][1].isCurrent()).toBe(true);
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
        expect(onChangeEnd.mock.calls.map(([value]) => value)).toEqual([
            1.4, 1.4,
        ]);
    });

    test('invalidates an active commit context after a newer preview', () => {
        const commit = createDeferred();
        const onChangeEnd = jest.fn(() => commit.promise);

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
        fireEvent.pointerUp(slider);

        const terminalContext = onChangeEnd.mock.calls[0][1];
        expect(terminalContext.confirmedValue).toBe(1);
        expect(terminalContext.isCurrent()).toBe(true);

        fireEvent.change(slider, { target: { value: '1.8' } });
        expect(terminalContext.isCurrent()).toBe(false);
    });

    test('invalidates an active commit context after authoritative props change', () => {
        const commit = createDeferred();
        const onChangeEnd = jest.fn(() => commit.promise);
        const { rerender } = render(
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
        fireEvent.pointerUp(slider);

        const terminalContext = onChangeEnd.mock.calls[0][1];
        rerender(
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

        expect(terminalContext.confirmedValue).toBe(1);
        expect(terminalContext.isCurrent()).toBe(false);
        expect(slider).toHaveValue('1.8');
    });

    test('persists the latest distinct release after an overlapping commit', async () => {
        const firstCommit = createDeferred();
        const secondCommit = createDeferred();
        const onPersist = jest
            .fn()
            .mockReturnValueOnce(firstCommit.promise)
            .mockReturnValueOnce(secondCommit.promise);

        render(<ControlledSlider onPersist={onPersist} />);

        const slider = screen.getByRole('slider', { name: 'Font size' });
        fireEvent.change(slider, { target: { value: '1.4' } });
        fireEvent.pointerUp(slider);
        fireEvent.blur(slider);

        expect(onPersist).toHaveBeenCalledTimes(1);
        expect(onPersist).toHaveBeenLastCalledWith(1.4);

        fireEvent.change(slider, { target: { value: '1.8' } });
        fireEvent.pointerUp(slider);
        fireEvent.blur(slider);

        expect(onPersist).toHaveBeenCalledTimes(1);

        await act(async () => {
            firstCommit.resolve();
            await firstCommit.promise;
        });
        await waitFor(() => expect(onPersist).toHaveBeenCalledTimes(2));
        expect(onPersist).toHaveBeenNthCalledWith(2, 1.8);

        await act(async () => {
            secondCommit.resolve();
            await secondCommit.promise;
        });
        expect(onPersist.mock.calls.map(([value]) => value)).toEqual([
            1.4, 1.8,
        ]);
    });

    test('retries a failed value after its optimistic prop echo', async () => {
        const firstCommit = createDeferred();
        const onPersist = jest
            .fn()
            .mockReturnValueOnce(firstCommit.promise)
            .mockResolvedValueOnce(undefined);

        render(<ControlledSlider onPersist={onPersist} />);

        const slider = screen.getByRole('slider', { name: 'Font size' });
        fireEvent.change(slider, { target: { value: '1.4' } });
        fireEvent.pointerUp(slider);
        fireEvent.blur(slider);

        expect(onPersist).toHaveBeenCalledTimes(1);
        expect(slider).toHaveValue('1.4');

        await act(async () => {
            firstCommit.reject(new Error('storage unavailable'));
            await firstCommit.promise.catch(() => undefined);
        });

        fireEvent.pointerUp(slider);
        fireEvent.blur(slider);

        await waitFor(() => expect(onPersist).toHaveBeenCalledTimes(2));
        expect(onPersist).toHaveBeenNthCalledWith(2, 1.4);
    });

    test('authoritative state supersedes a queued local commit', async () => {
        const firstCommit = createDeferred();
        const onPersist = jest
            .fn()
            .mockReturnValueOnce(firstCommit.promise)
            .mockResolvedValue(undefined);
        const { rerender } = render(
            <ControlledSlider authoritativeValue={1} onPersist={onPersist} />
        );

        const slider = screen.getByRole('slider', { name: 'Font size' });
        fireEvent.change(slider, { target: { value: '1.4' } });
        fireEvent.pointerUp(slider);
        fireEvent.change(slider, { target: { value: '1.6' } });
        fireEvent.pointerUp(slider);

        expect(onPersist).toHaveBeenCalledTimes(1);

        rerender(
            <ControlledSlider authoritativeValue={1.8} onPersist={onPersist} />
        );
        await waitFor(() => expect(slider).toHaveValue('1.8'));

        await act(async () => {
            firstCommit.resolve();
            await firstCommit.promise;
        });

        expect(slider).toHaveValue('1.8');
        fireEvent.pointerUp(slider);
        fireEvent.blur(slider);
        expect(onPersist.mock.calls.map(([value]) => value)).toEqual([1.4]);
    });

    test('uses the latest persistence callback for a queued commit', async () => {
        const firstCommit = createDeferred();
        const firstPersist = jest
            .fn()
            .mockReturnValueOnce(firstCommit.promise)
            .mockResolvedValue(undefined);
        const latestPersist = jest.fn().mockResolvedValue(undefined);
        const { rerender } = render(
            <ControlledSlider onPersist={firstPersist} />
        );

        const slider = screen.getByRole('slider', { name: 'Font size' });
        fireEvent.change(slider, { target: { value: '1.4' } });
        fireEvent.pointerUp(slider);
        fireEvent.change(slider, { target: { value: '1.6' } });
        fireEvent.pointerUp(slider);

        rerender(<ControlledSlider onPersist={latestPersist} />);

        await act(async () => {
            firstCommit.resolve();
            await firstCommit.promise;
        });

        await waitFor(() => expect(latestPersist).toHaveBeenCalledWith(1.6));
        expect(firstPersist.mock.calls.map(([value]) => value)).toEqual([1.4]);
    });

    test('accepts an authoritative value equal to a failed non-optimistic commit', async () => {
        const failedCommit = createDeferred();
        const onPersist = jest.fn().mockReturnValueOnce(failedCommit.promise);
        const { rerender } = render(
            <ControlledSlider
                authoritativeValue={1}
                onPersist={onPersist}
                optimistic={false}
            />
        );

        const slider = screen.getByRole('slider', { name: 'Font size' });
        fireEvent.change(slider, { target: { value: '1.4' } });
        fireEvent.pointerUp(slider);

        await act(async () => {
            failedCommit.reject(new Error('storage unavailable'));
            await failedCommit.promise.catch(() => undefined);
        });

        rerender(
            <ControlledSlider
                authoritativeValue={1.4}
                onPersist={onPersist}
                optimistic={false}
            />
        );
        await waitFor(() => expect(slider).toHaveValue('1.4'));

        fireEvent.pointerUp(slider);
        fireEvent.blur(slider);

        expect(onPersist.mock.calls.map(([value]) => value)).toEqual([1.4]);
    });

    test('coalesces three newer releases to the latest value', async () => {
        const firstCommit = createDeferred();
        const latestCommit = createDeferred();
        const onPersist = jest
            .fn()
            .mockReturnValueOnce(firstCommit.promise)
            .mockReturnValueOnce(latestCommit.promise);
        render(<ControlledSlider onPersist={onPersist} />);

        const slider = screen.getByRole('slider', { name: 'Font size' });
        for (const value of ['1.2', '1.4', '1.6', '1.8']) {
            fireEvent.change(slider, { target: { value } });
            fireEvent.pointerUp(slider);
        }

        expect(onPersist.mock.calls.map(([value]) => value)).toEqual([1.2]);

        await act(async () => {
            firstCommit.resolve();
            await firstCommit.promise;
        });
        await waitFor(() => expect(onPersist).toHaveBeenCalledTimes(2));
        expect(onPersist.mock.calls.map(([value]) => value)).toEqual([
            1.2, 1.8,
        ]);

        await act(async () => {
            latestCommit.resolve();
            await latestCommit.promise;
        });
    });

    test('finishes released and queued persistence after unmount', async () => {
        const firstCommit = createDeferred();
        const latestCommit = createDeferred();
        const onPersist = jest
            .fn()
            .mockReturnValueOnce(firstCommit.promise)
            .mockReturnValueOnce(latestCommit.promise);
        const onCommitStarted = jest.fn();
        const { unmount } = render(
            <ControlledSlider
                onCommitStarted={onCommitStarted}
                onPersist={onPersist}
            />
        );

        const slider = screen.getByRole('slider', { name: 'Font size' });
        fireEvent.change(slider, { target: { value: '1.4' } });
        fireEvent.pointerUp(slider);
        fireEvent.change(slider, { target: { value: '1.8' } });
        fireEvent.pointerUp(slider);
        unmount();

        await act(async () => {
            firstCommit.resolve();
            await firstCommit.promise;
        });
        await waitFor(() => expect(onPersist).toHaveBeenCalledTimes(2));
        expect(onPersist.mock.calls.map(([value]) => value)).toEqual([
            1.4, 1.8,
        ]);
        expect(onCommitStarted.mock.calls.map(([event]) => event)).toEqual([
            { mounted: true, value: 1.4 },
            { mounted: false, value: 1.8 },
        ]);

        await act(async () => {
            latestCommit.resolve();
            await latestCommit.promise;
        });
    });
});
