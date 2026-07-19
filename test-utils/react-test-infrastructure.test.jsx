import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

function TestCounter() {
    const [count, setCount] = useState(0);

    return (
        <button type="button" onClick={() => setCount((value) => value + 1)}>
            Count: {count}
        </button>
    );
}

describe('React test infrastructure', () => {
    test('renders JSX and handles user interaction', async () => {
        const user = userEvent.setup();
        render(<TestCounter />);

        const button = screen.getByRole('button', { name: 'Count: 0' });
        await user.click(button);

        expect(button).toHaveTextContent('Count: 1');
    });
});
