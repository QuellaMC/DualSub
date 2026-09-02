export function SettingToggle({
    id,
    label,
    checked,
    onChange,
}: {
    id: string;
    label: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
}) {
    return (
        <div className="card">
            <div className="setting-item">
                <label htmlFor={id}>{label}</label>
                <label className="switch">
                    <input
                        type="checkbox"
                        id={id}
                        checked={checked}
                        onChange={(event) => onChange(event.target.checked)}
                    />
                    <span className="slider"></span>
                </label>
            </div>
        </div>
    );
}
