import type { ReactNode } from 'react';
import './Subtitles.css';

/** Both subtitle lines in DualSub's own look (src/content/renderer/looks.ts). */
export function DualSubtitles({
    original,
    translation,
    originalLang,
    translationLang,
    translationFirst = false,
    sideBySide = false,
    className,
}: {
    original: ReactNode;
    translation: ReactNode;
    originalLang?: string;
    translationLang?: string;
    translationFirst?: boolean;
    sideBySide?: boolean;
    className?: string;
}) {
    const classes = [
        'subtitles',
        sideBySide && 'subtitles-side-by-side',
        translationFirst && 'subtitles-translation-first',
        className,
    ].filter(Boolean);
    return (
        <div className={classes.join(' ')}>
            <span className="subtitle-line" lang={originalLang}>
                {original}
            </span>
            <span
                className="subtitle-line subtitle-translation"
                lang={translationLang}
            >
                {translation}
            </span>
        </div>
    );
}
