import React from 'react';
import { jest } from '@jest/globals';
import {
    act,
    fireEvent,
    render,
    screen,
    waitFor,
} from '@testing-library/react';
import { useCommittedTextField } from './useCommittedTextField.js';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

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

test('typing stays local until blur commits the exact draft once', async () => {
    const onCommit = jest.fn().mockResolvedValue(true);
    render(<DraftField value="original" onCommit={onCommit} />);

    const input = screen.getByLabelText('Draft value');
    fireEvent.change(input, { target: { value: '  exact draft  ' } });

    expect(input).toHaveValue('  exact draft  ');
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.blur(input);

    await waitFor(() =>
        expect(onCommit).toHaveBeenCalledWith('  exact draft  ')
    );
    expect(onCommit).toHaveBeenCalledTimes(1);
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

test('Escape restores the latest external value without committing', () => {
    const onCommit = jest.fn().mockResolvedValue(true);
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

test('a new external value synchronizes a clean draft', () => {
    const onCommit = jest.fn().mockResolvedValue(true);
    const view = render(<DraftField value="first" onCommit={onCommit} />);

    view.rerender(<DraftField value="second" onCommit={onCommit} />);

    expect(screen.getByLabelText('Draft value')).toHaveValue('second');
    expect(onCommit).not.toHaveBeenCalled();
});

test('an invalid commit stays editable and does not call persistence', () => {
    const onCommit = jest.fn().mockResolvedValue(true);
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

    expect(input).toHaveValue('   ');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: 'valid again' } });
    expect(input).toHaveAttribute('aria-invalid', 'false');
});

test('a rejected commit rolls back to the latest external value', async () => {
    const onCommit = jest
        .fn()
        .mockRejectedValue(new Error('persistence failed'));
    render(<DraftField value="authoritative" onCommit={onCommit} />);

    const input = screen.getByLabelText('Draft value');
    fireEvent.change(input, { target: { value: 'rejected' } });
    fireEvent.blur(input);

    await waitFor(() => expect(input).toHaveValue('authoritative'));
    expect(onCommit).toHaveBeenCalledWith('rejected');
});

test('a resolved false commit also rolls back for OptionsApp callbacks', async () => {
    const onCommit = jest.fn().mockResolvedValue(false);
    render(<DraftField value="authoritative" onCommit={onCommit} />);

    const input = screen.getByLabelText('Draft value');
    fireEvent.change(input, { target: { value: 'rejected' } });
    fireEvent.blur(input);

    await waitFor(() => expect(input).toHaveValue('authoritative'));
});

test('a rejected optimistic prop echo rolls back to the pre-commit authority', async () => {
    const pendingCommit = deferred();
    const onCommit = jest.fn().mockReturnValue(pendingCommit.promise);
    const view = render(<DraftField value="A" onCommit={onCommit} />);

    const input = screen.getByLabelText('Draft value');
    fireEvent.change(input, { target: { value: 'B' } });
    fireEvent.blur(input);
    view.rerender(<DraftField value="B" onCommit={onCommit} />);

    expect(input).toHaveValue('B');
    pendingCommit.resolve(false);

    await waitFor(() => expect(input).toHaveValue('A'));
});

test('an older commit echo and rejection cannot overwrite a newer draft', async () => {
    const olderCommit = deferred();
    const onCommit = jest.fn().mockReturnValue(olderCommit.promise);
    const view = render(<DraftField value="A" onCommit={onCommit} />);

    const input = screen.getByLabelText('Draft value');
    fireEvent.change(input, { target: { value: 'B' } });
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: 'C' } });

    view.rerender(<DraftField value="B" onCommit={onCommit} />);
    expect(input).toHaveValue('C');

    olderCommit.reject(new Error('older commit failed'));
    await waitFor(() => expect(input).toHaveValue('C'));
});

test('an older prop echo cannot overwrite a newer pending commit', async () => {
    const olderCommit = deferred();
    const newerCommit = deferred();
    const onCommit = jest
        .fn()
        .mockReturnValueOnce(olderCommit.promise)
        .mockReturnValueOnce(newerCommit.promise);
    const view = render(<DraftField value="A" onCommit={onCommit} />);

    const input = screen.getByLabelText('Draft value');
    fireEvent.change(input, { target: { value: 'B' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.change(input, { target: { value: 'C' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    view.rerender(<DraftField value="B" onCommit={onCommit} />);
    expect(input).toHaveValue('C');

    olderCommit.resolve(true);
    newerCommit.resolve(true);
    view.rerender(<DraftField value="C" onCommit={onCommit} />);
    await waitFor(() => expect(input).toHaveValue('C'));
});

test('a successful same-value commit releases ownership for later external updates', async () => {
    const pendingCommit = deferred();
    const onCommit = jest.fn().mockReturnValue(pendingCommit.promise);
    const view = render(<DraftField value="A" onCommit={onCommit} />);

    const input = screen.getByLabelText('Draft value');
    fireEvent.change(input, { target: { value: 'temporary' } });
    fireEvent.change(input, { target: { value: 'A' } });
    fireEvent.blur(input);

    await waitFor(() => expect(onCommit).toHaveBeenCalledWith('A'));
    await act(async () => {
        pendingCommit.resolve(true);
        await pendingCommit.promise;
        await Promise.resolve();
    });
    view.rerender(<DraftField value="external update" onCommit={onCommit} />);

    await waitFor(() => expect(input).toHaveValue('external update'));
});

test('a canonical external echo masked during commit is shown after success', async () => {
    const pendingCommit = deferred();
    const onCommit = jest.fn().mockReturnValue(pendingCommit.promise);
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

    expect(input).toHaveValue('https://canonical.test/');
    pendingCommit.resolve(true);

    await waitFor(() => expect(input).toHaveValue('https://canonical.test'));
});

test('an older successful commit cannot release or overwrite a newer draft', async () => {
    const olderCommit = deferred();
    const onCommit = jest.fn().mockReturnValue(olderCommit.promise);
    const view = render(<DraftField value="A" onCommit={onCommit} />);

    const input = screen.getByLabelText('Draft value');
    fireEvent.change(input, { target: { value: 'B' } });
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: 'newer draft' } });

    await act(async () => {
        olderCommit.resolve(true);
        await olderCommit.promise;
        await Promise.resolve();
    });
    view.rerender(<DraftField value="later authority" onCommit={onCommit} />);

    expect(input).toHaveValue('newer draft');
});
