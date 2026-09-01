import React from 'react';
import { jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useCommittedTextField } from './useCommittedTextField.js';

function DraftField({ value, onCommit, validate = () => true }) {
    const field = useCommittedTextField({ value, onCommit, validate });
    return (
        <input
            aria-label="Draft value"
            aria-invalid={field.invalid}
            value={field.value}
            onChange={(event) => field.change(event.target.value)}
            onBlur={() => void field.commit()}
            onKeyDown={field.handleKeyDown}
        />
    );
}

test('keeps typing local until blur commits the draft', async () => {
    const onCommit = jest.fn().mockResolvedValue(true);
    render(<DraftField value="original" onCommit={onCommit} />);

    const input = screen.getByLabelText('Draft value');
    fireEvent.change(input, { target: { value: '  exact draft  ' } });
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.blur(input);

    await waitFor(() =>
        expect(onCommit).toHaveBeenCalledWith('  exact draft  ')
    );
});

test('Enter commits once and the following blur does not duplicate it', async () => {
    const onCommit = jest.fn().mockResolvedValue(true);
    render(<DraftField value="original" onCommit={onCommit} />);

    const input = screen.getByLabelText('Draft value');
    fireEvent.change(input, { target: { value: 'next' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith('next'));
    fireEvent.blur(input);

    expect(onCommit).toHaveBeenCalledTimes(1);
});

test('Escape restores the latest external value', () => {
    const onCommit = jest.fn();
    const view = render(
        <DraftField value="first authority" onCommit={onCommit} />
    );

    const input = screen.getByLabelText('Draft value');
    fireEvent.change(input, { target: { value: 'unfinished' } });
    view.rerender(<DraftField value="latest authority" onCommit={onCommit} />);
    expect(input).toHaveValue('unfinished');

    fireEvent.keyDown(input, { key: 'Escape' });

    expect(input).toHaveValue('latest authority');
    expect(onCommit).not.toHaveBeenCalled();
});

test('synchronizes external values while the field is clean', () => {
    const onCommit = jest.fn();
    const view = render(<DraftField value="first" onCommit={onCommit} />);

    view.rerender(<DraftField value="second" onCommit={onCommit} />);

    expect(screen.getByLabelText('Draft value')).toHaveValue('second');
});

test('rejects invalid drafts without calling persistence', () => {
    const onCommit = jest.fn();
    render(
        <DraftField
            value="valid"
            onCommit={onCommit}
            validate={(draft) => draft.trim().length > 0}
        />
    );

    const input = screen.getByLabelText('Draft value');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.blur(input);

    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(onCommit).not.toHaveBeenCalled();
});

test('rolls a failed commit back to current authority', async () => {
    const onCommit = jest.fn().mockRejectedValue(new Error('write failed'));
    render(<DraftField value="authoritative" onCommit={onCommit} />);

    const input = screen.getByLabelText('Draft value');
    fireEvent.change(input, { target: { value: 'rejected' } });
    fireEvent.blur(input);

    await waitFor(() => expect(input).toHaveValue('authoritative'));
});

test('rolls back an optimistic prop echo when persistence rejects it', async () => {
    const pending = Promise.withResolvers();
    const onCommit = jest.fn().mockReturnValue(pending.promise);
    const view = render(<DraftField value="A" onCommit={onCommit} />);

    const input = screen.getByLabelText('Draft value');
    fireEvent.change(input, { target: { value: 'B' } });
    fireEvent.blur(input);
    view.rerender(<DraftField value="B" onCommit={onCommit} />);
    pending.resolve(false);

    await waitFor(() => expect(input).toHaveValue('A'));
});

test('an older commit cannot overwrite a newer draft', async () => {
    const older = Promise.withResolvers();
    const onCommit = jest.fn().mockReturnValueOnce(older.promise);
    render(<DraftField value="A" onCommit={onCommit} />);

    const input = screen.getByLabelText('Draft value');
    fireEvent.change(input, { target: { value: 'B' } });
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: 'C' } });
    older.resolve(false);

    await waitFor(() => expect(input).toHaveValue('C'));
});

test('shows a canonical external echo after a successful commit', async () => {
    const pending = Promise.withResolvers();
    const onCommit = jest.fn().mockReturnValue(pending.promise);
    const view = render(
        <DraftField value="https://old.test" onCommit={onCommit} />
    );

    const input = screen.getByLabelText('Draft value');
    fireEvent.change(input, {
        target: { value: 'https://canonical.test/' },
    });
    fireEvent.blur(input);
    view.rerender(
        <DraftField value="https://canonical.test" onCommit={onCommit} />
    );
    pending.resolve(true);

    await waitFor(() => expect(input).toHaveValue('https://canonical.test'));
});

test('returning to the authoritative value releases the local draft', () => {
    const onCommit = jest.fn();
    const view = render(<DraftField value="A" onCommit={onCommit} />);

    const input = screen.getByLabelText('Draft value');
    fireEvent.change(input, { target: { value: 'temporary' } });
    fireEvent.change(input, { target: { value: 'A' } });
    fireEvent.blur(input);
    view.rerender(<DraftField value="external" onCommit={onCommit} />);

    expect(input).toHaveValue('external');
    expect(onCommit).not.toHaveBeenCalled();
});
