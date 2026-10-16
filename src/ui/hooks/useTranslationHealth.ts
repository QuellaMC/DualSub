import { useEffect, useState } from 'react';
import {
    onTranslationHealthChanged,
    readTranslationHealth,
    type TranslationHealth,
} from '@/shared/translationHealth';

/** How long a failed read waits before it asks again. */
const RETRY_MS = 1000;

/** The chosen translation provider's standing failure, or null while it
 *  works. */
export function useTranslationHealth(): TranslationHealth | null {
    const [health, setHealth] = useState<TranslationHealth | null>(null);

    useEffect(() => {
        let active = true;
        // A change that lands while a read is in flight is newer than what
        // that read returns.
        let changed = false;
        let retry: ReturnType<typeof setTimeout> | undefined;
        const stop = onTranslationHealthChanged((next) => {
            changed = true;
            if (active) {
                setHealth(next);
            }
        });
        // A failed read says nothing about the service, so it asks again
        // rather than show a failing service as working.
        const read = (): void => {
            readTranslationHealth().then(
                (current) => {
                    if (active && !changed) {
                        setHealth(current);
                    }
                },
                () => {
                    if (active && !changed) {
                        retry = setTimeout(read, RETRY_MS);
                    }
                }
            );
        };
        read();
        return () => {
            active = false;
            clearTimeout(retry);
            stop();
        };
    }, []);

    return health;
}
