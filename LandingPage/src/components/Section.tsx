import type { ReactNode } from 'react';
import type { SectionId } from '../site';

export function Section({
    id,
    className,
    children,
}: {
    id?: SectionId;
    className?: string;
    children: ReactNode;
}) {
    return (
        <section
            id={id}
            className={className ? `section ${className}` : 'section'}
        >
            <div className="container">{children}</div>
        </section>
    );
}

export function SectionHeading({
    eyebrow,
    title,
    lead,
    align = 'center',
    compact = false,
}: {
    eyebrow: string;
    title: ReactNode;
    lead?: string;
    align?: 'center' | 'start';
    compact?: boolean;
}) {
    const classes = [
        'section-heading',
        `section-heading-${align}`,
        compact && 'section-heading-compact',
    ].filter(Boolean);
    return (
        <header className={classes.join(' ')}>
            <p className="eyebrow">{eyebrow}</p>
            <h2 className="section-title">{title}</h2>
            {lead ? <p className="lead">{lead}</p> : null}
        </header>
    );
}
