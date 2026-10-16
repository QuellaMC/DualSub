// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCommittedTextField } from './useCommittedTextField';

function setup(initial = 'a', onCommit = vi.fn(() => Promise.resolve(true))) {
    const hook = renderHook(
        ({ value }: { value: string }) =>
            useCommittedTextField({
                value,
                validate: (draft) => draft.trim() !== '',
                onCommit,
            }),
        { initialProps: { value: initial } }
    );
    return { ...hook, onCommit };
}

afterEach(() => {
    cleanup();
});

describe('useCommittedTextField', () => {
    it('keeps typing local until a commit persists the exact draft once', async () => {
        const { result, onCommit } = setup();
        act(() => result.current.change('ab'));
        expect(result.current.value).toBe('ab');
        expect(onCommit).not.toHaveBeenCalled();

        await act(() => result.current.commit());
        await act(() => result.current.commit());
        expect(onCommit).toHaveBeenCalledTimes(1);
        expect(onCommit).toHaveBeenCalledWith('ab');
    });

    it('commits on Enter and resets on Escape', async () => {
        const { result, onCommit } = setup();
        act(() => result.current.change('typed'));
        await act(async () => {
            result.current.handleKeyDown({
                key: 'Enter',
                preventDefault: vi.fn(),
            });
            await Promise.resolve();
        });
        expect(onCommit).toHaveBeenCalledWith('typed');

        act(() => result.current.change('again'));
        act(() =>
            result.current.handleKeyDown({
                key: 'Escape',
                preventDefault: vi.fn(),
            })
        );
        expect(result.current.value).toBe('a');
        expect(onCommit).toHaveBeenCalledTimes(1);
    });

    it('stands for a valid draft before it is persisted, else the persisted value', async () => {
        const { result } = setup();
        act(() => result.current.change('next'));
        await act(() => result.current.commit());
        expect(result.current.effective).toBe('next');

        act(() => result.current.change('  '));
        expect(result.current.effective).toBe('a');
    });

    it('keeps an invalid draft editable without persisting it', async () => {
        const { result, onCommit } = setup();
        act(() => result.current.change('   '));
        expect(result.current.valid).toBe(false);
        expect(result.current.invalid).toBe(false);

        await act(() => result.current.commit());
        expect(onCommit).not.toHaveBeenCalled();
        expect(result.current.invalid).toBe(true);
        expect(result.current.value).toBe('   ');
    });

    it('follows an external value while clean and keeps a dirty draft', () => {
        const { result, rerender } = setup();
        rerender({ value: 'b' });
        expect(result.current.value).toBe('b');

        act(() => result.current.change('typing'));
        rerender({ value: 'c' });
        expect(result.current.value).toBe('typing');
    });

    it('follows external values again once the persisted value catches up with the draft', () => {
        const { result, rerender } = setup();
        act(() => result.current.change('b'));
        rerender({ value: 'b' });
        rerender({ value: 'c' });
        expect(result.current.value).toBe('c');
    });

    it('shows an adopted value at once and persists it through its own save', async () => {
        const { result, onCommit } = setup();
        const persist = vi.fn(() => Promise.resolve(true));
        await act(() => result.current.adopt('chosen', persist));
        expect(result.current.value).toBe('chosen');
        expect(persist).toHaveBeenCalledWith('chosen');
        expect(onCommit).not.toHaveBeenCalled();
    });

    it('rolls back a failed adoption, but not over a newer one', async () => {
        const { result } = setup();
        await act(() => result.current.adopt('lost', () => false));
        expect(result.current.value).toBe('a');

        const older = Promise.withResolvers<boolean>();
        let first: Promise<boolean> = Promise.resolve(true);
        act(() => {
            first = result.current.adopt('older', () => older.promise);
        });
        act(() => {
            void result.current.adopt('newer', () => new Promise(() => {}));
        });
        older.resolve(false);
        await act(() => first);
        expect(result.current.value).toBe('newer');
    });

    it('rolls a failed commit back to the persisted value', async () => {
        const { result } = setup(
            'a',
            vi.fn(() => Promise.resolve(false))
        );
        act(() => result.current.change('nope'));
        await act(() => result.current.commit());
        expect(result.current.value).toBe('a');
    });

    it('keeps a newer draft when an older commit fails', async () => {
        const gate = Promise.withResolvers<boolean>();
        const { result } = setup(
            'a',
            vi.fn(() => gate.promise)
        );
        act(() => result.current.change('first'));
        let pending: Promise<boolean> | undefined;
        act(() => {
            pending = result.current.commit();
        });
        act(() => result.current.change('second'));
        gate.resolve(false);
        await act(async () => {
            await pending;
        });
        expect(result.current.value).toBe('second');
    });
});
