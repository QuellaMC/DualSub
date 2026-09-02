import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_DURATION_MS = 3000;

/** A transient status line: the latest message replaces the previous one
 *  and clears itself after the duration. */
export function useStatusMessage(durationMs = DEFAULT_DURATION_MS): {
    readonly message: string;
    readonly show: (message: string) => void;
} {
    const [message, setMessage] = useState('');
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(
        () => () => {
            if (timer.current !== null) {
                clearTimeout(timer.current);
            }
        },
        []
    );

    const show = useCallback(
        (next: string) => {
            if (timer.current !== null) {
                clearTimeout(timer.current);
            }
            setMessage(next);
            timer.current = setTimeout(() => {
                timer.current = null;
                setMessage('');
            }, durationMs);
        },
        [durationMs]
    );

    return { message, show };
}
