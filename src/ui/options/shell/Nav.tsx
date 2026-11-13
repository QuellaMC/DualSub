import { useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../../design/Icon';
import type { Translate } from '../../hooks/useI18n';
import { SECTION_IDS, SECTIONS, type SectionId } from '../sections';

/** Every section by name, with a highlight that slides to the open one. */
export function Nav({
    t,
    section,
    advanced,
    onSection,
}: {
    t: Translate;
    section: SectionId;
    advanced: boolean;
    onSection: (section: SectionId) => void;
}) {
    const visible = SECTION_IDS.filter(
        (id) => advanced || !SECTIONS[id].advanced
    );
    const list = useRef<HTMLUListElement>(null);
    // Unset until measured, so the highlight does not slide in from the
    // top as the page opens.
    const [highlightTop, setHighlightTop] = useState<number | null>(null);

    useLayoutEffect(() => {
        const items = list.current;
        if (!items) {
            return;
        }
        const place = (): void =>
            setHighlightTop(
                items.querySelector<HTMLElement>('[aria-current="page"]')
                    ?.offsetTop ?? null
            );
        place();
        // A narrow window lays the menu out in a row, which moves every
        // link; the highlight measures again once it is a column.
        const observer = new ResizeObserver(place);
        observer.observe(items);
        return () => observer.disconnect();
    }, [section, advanced]);

    return (
        <nav className="rail" aria-label={t('navLabel')}>
            {highlightTop !== null && (
                <span
                    className="rail-highlight"
                    aria-hidden="true"
                    style={{ transform: `translateY(${highlightTop}px)` }}
                />
            )}
            <ul ref={list}>
                {visible.map((id) => (
                    <li
                        key={id}
                        className={id === 'help' ? 'rail-help' : undefined}
                    >
                        <a
                            href={`#${id}`}
                            aria-current={id === section ? 'page' : undefined}
                            onClick={(event) => {
                                event.preventDefault();
                                onSection(id);
                            }}
                        >
                            <Icon name={SECTIONS[id].icon} />
                            <span>{t(SECTIONS[id].labelKey)}</span>
                        </a>
                    </li>
                ))}
            </ul>
        </nav>
    );
}
