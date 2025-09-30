import React from 'react';

export function SettingCard({ title, description, children }) {
    return (
        <div className="setting-card">
            {title && <h3>{title}</h3>}
            {description && <p>{description}</p>}
            {children}
        </div>
    );
}
