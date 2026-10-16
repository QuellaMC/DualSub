import { useEffect, useState } from 'react';

/** The longest wait a browser timer keeps. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * The time now, read again at each of `moments` still to come, so what
 * depends on reaching one, such as a token running out, shows once it is
 * reached rather than at the next render.
 */
export function useNow(moments: readonly number[]): number {
    const [now, setNow] = useState(Date.now);
    const next = Math.min(...moments.filter((moment) => moment > now));

    useEffect(() => {
        if (!Number.isFinite(next)) {
            return;
        }
        const timer = setTimeout(
            () => setNow(Date.now()),
            Math.min(next - Date.now(), MAX_TIMER_MS)
        );
        return () => clearTimeout(timer);
    }, [next]);

    return now;
}
