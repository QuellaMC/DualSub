export function ToggleSwitch({
    id,
    checked,
    onChange,
}: {
    id: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
}) {
    return (
        <div className="toggle-switch">
            <input
                type="checkbox"
                id={id}
                className="toggle-input"
                checked={checked}
                onChange={(event) => onChange(event.target.checked)}
            />
            <label htmlFor={id} className="toggle-label">
                <span className="toggle-switch-handle"></span>
            </label>
        </div>
    );
}
