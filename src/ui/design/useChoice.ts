import { useState } from 'react';

/**
 * What an on/off control shows: the choice just made until the change
 * `onChange` returns settles, then `checked`. A second press turns back
 * what the first turned, saved or not.
 */
export function useChoice(
    checked: boolean,
    onChange: (checked: boolean) => Promise<unknown> | void
): readonly [shown: boolean, toggle: () => void] {
    const [chosen, setChosen] = useState<boolean | null>(null);
    const shown = chosen ?? checked;
    const toggle = (): void => {
        const next = !shown;
        setChosen(next);
        const settle = (): void =>
            setChosen((current) => (current === next ? null : current));
        void Promise.resolve(onChange(next)).then(settle, settle);
    };
    return [shown, toggle];
}
