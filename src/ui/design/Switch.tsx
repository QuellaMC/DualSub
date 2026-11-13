import type { Ref } from 'react';
import { useChoice } from './useChoice';

/** An on/off control, named by the visible text `labelledBy` points at,
 *  showing the choice just made as `useChoice` does. */
export function Switch({
    checked,
    onChange,
    labelledBy,
    disabled,
    small = false,
    ref,
}: {
    checked: boolean;
    /** Returns the change it starts, or nothing when `checked` follows at
     *  once. */
    onChange: (checked: boolean) => Promise<unknown> | void;
    labelledBy: string;
    disabled?: boolean;
    /** Drawn smaller, for a bar or a compact pane. */
    small?: boolean;
    ref?: Ref<HTMLButtonElement>;
}) {
    const [shown, toggle] = useChoice(checked, onChange);

    return (
        <button
            ref={ref}
            type="button"
            role="switch"
            className={small ? 'switch small' : 'switch'}
            aria-checked={shown}
            aria-labelledby={labelledBy}
            disabled={disabled}
            onClick={toggle}
        />
    );
}
