import type { ReactNode } from 'react';

export function SettingCard({
    title,
    description,
    children,
}: {
    title: string;
    description?: string;
    children: ReactNode;
}) {
    return (
        <div className="setting-card">
            <h3>{title}</h3>
            {description !== undefined && <p>{description}</p>}
            {children}
        </div>
    );
}
