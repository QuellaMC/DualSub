import React from 'react';

export function SettingToggle({ label, checked, onChange, id }) {
    return (
        <div className="card">
            <div className="setting-item">
                <label htmlFor={id}>{label}</label>
                <label className="switch">
                    <input
                        type="checkbox"
                        id={id}
                        checked={checked}
                        onChange={(e) => onChange(e.target.checked)}
                    />
                    <span className="slider"></span>
                </label>
            </div>
        </div>
    );
}
