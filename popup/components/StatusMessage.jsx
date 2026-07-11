import React from 'react';

export function StatusMessage({ message }) {
    return (
        <p
            id="statusMessage"
            role="status"
            aria-live="polite"
            aria-atomic="true"
        >
            {message}
        </p>
    );
}
