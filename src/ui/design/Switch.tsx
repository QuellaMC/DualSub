import type { Ref } from 'react';

/** An on/off control, named by the visible text `labelledBy` points at. */
export function Switch({
    checked,
    onChange,
    labelledBy,
    disabled,
    ref,
}: {
    checked: boolean;
    onChange: (checked: boolean) => void;
    labelledBy: string;
    disabled?: boolean;
    ref?: Ref<HTMLButtonElement>;
}) {
    return (
        <button
            ref={ref}
            type="button"
            role="switch"
            className="switch"
            aria-checked={checked}
            aria-labelledby={labelledBy}
            disabled={disabled}
            onClick={() => onChange(!checked)}
        />
    );
}
