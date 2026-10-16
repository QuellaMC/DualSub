import { useState, type Ref } from 'react';

/**
 * An on/off control, named by the visible text `labelledBy` points at. It
 * shows the choice just made until the change `onChange` returns settles,
 * so a second press turns back what the first turned, saved or not.
 */
export function Switch({
    checked,
    onChange,
    labelledBy,
    disabled,
    ref,
}: {
    checked: boolean;
    /** Returns the change it starts, or nothing when `checked` follows at
     *  once. */
    onChange: (checked: boolean) => Promise<unknown> | void;
    labelledBy: string;
    disabled?: boolean;
    ref?: Ref<HTMLButtonElement>;
}) {
    const [chosen, setChosen] = useState<boolean | null>(null);
    const shown = chosen ?? checked;

    return (
        <button
            ref={ref}
            type="button"
            role="switch"
            className="switch"
            aria-checked={shown}
            aria-labelledby={labelledBy}
            disabled={disabled}
            onClick={() => {
                const next = !shown;
                setChosen(next);
                const settle = (): void =>
                    setChosen((current) => (current === next ? null : current));
                void Promise.resolve(onChange(next)).then(settle, settle);
            }}
        />
    );
}
