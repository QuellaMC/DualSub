import { useEffect, useState } from 'react';
import {
    onTranslationHealthChanged,
    readTranslationHealth,
    type TranslationHealth,
} from '@/shared/translationHealth';

/** The chosen translation provider's standing failure, or null while it
 *  works. */
export function useTranslationHealth(): TranslationHealth | null {
    const [health, setHealth] = useState<TranslationHealth | null>(null);

    useEffect(() => {
        let active = true;
        // A change that lands while the first read is in flight is newer
        // than what that read returns.
        let changed = false;
        const stop = onTranslationHealthChanged((next) => {
            changed = true;
            if (active) {
                setHealth(next);
            }
        });
        void readTranslationHealth()
            .then((current) => {
                if (active && !changed) {
                    setHealth(current);
                }
            })
            .catch(() => undefined);
        return () => {
            active = false;
            stop();
        };
    }, []);

    return health;
}
