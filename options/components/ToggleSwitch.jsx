import React from 'react';

export function ToggleSwitch({ id, checked, onChange }) {
    return (
        <div className="toggle-switch">
            <input
                type="checkbox"
                id={id}
                className="toggle-input"
                checked={checked}
                onChange={(e) => onChange(e.target.checked)}
            />
            <label htmlFor={id} className="toggle-label">
                <span className="toggle-inner"></span>
                <span className="toggle-switch-handle"></span>
            </label>
        </div>
    );
}
