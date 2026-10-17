import {
    useCallback,
    useLayoutEffect,
    useRef,
    useState,
    type ReactNode,
} from 'react';
import { getDefaultValue } from '@/config/schema';
import type { SubtitleLook } from '@/content/renderer/looks';
import {
    bottomPercentToVerticalPosition,
    verticalPositionToBottomPercent,
    type DisplaySettings,
} from '@/content/renderer/styling';
import { clampPosition } from '../../adjustments';
import type { Translate } from '../../hooks/useI18n';
import { Scene } from '../../preview/Scene';
import { useSubtitleBlock } from '../../preview/useSubtitleBlock';

export type StageLine = 'original' | 'translated';

/** A press that moves less than this is a click on a line. */
const DRAG_THRESHOLD_PX = 4;

/** The room between the lines and the outline drawn around them. */
const OUTLINE_PADDING = { x: 12, y: 8 } as const;

const USUAL_BOTTOM_PERCENT = verticalPositionToBottomPercent(
    getDefaultValue('subtitleVerticalPosition')
);

interface Drag {
    readonly pointerId: number;
    readonly startY: number;
    readonly startBottomPercent: number;
    readonly height: number;
    /** Where the block was dragged last; none while the press has not
     *  moved far enough to be a drag. */
    position: number | null;
}

/**
 * A mock video picture with the subtitles at their true size and height,
 * drawn by the renderer. Each line is a button that opens its settings,
 * and the block drags up and down. `ring` outlines what the settings open
 * are about.
 */
export function Stage({
    t,
    display,
    look,
    originalText,
    translatedText,
    enabled,
    day,
    ring,
    onPickLine,
    onDrag,
    onDrop,
    onNudge,
    children,
}: {
    t: Translate;
    display: DisplaySettings;
    look: SubtitleLook;
    originalText: string;
    translatedText: string;
    enabled: boolean;
    day: boolean;
    ring: 'block' | StageLine | null;
    onPickLine: (line: StageLine) => void;
    /** The block is dragged to `position`, and dropped at the last. */
    onDrag: (position: number) => void;
    onDrop: (position: number) => void;
    /** An arrow key on a line moves the block a step up (1) or down. */
    onNudge: (direction: 1 | -1, large: boolean) => void;
    /** Controls over the picture. */
    children?: ReactNode;
}) {
    const frame = useRef<HTMLDivElement>(null);
    const [pictureHeight, setPictureHeight] = useState(0);
    const [elements, attach] = useSubtitleBlock({
        display,
        look,
        pictureHeight,
        originalText,
        translatedText,
    });
    const [outline] = useState(() => {
        const element = document.createElement('span');
        element.className = 'stage-outline';
        return element;
    });
    const drag = useRef<Drag | null>(null);
    const [dragging, setDragging] = useState(false);
    /** The click that ends a drag picks no line. */
    const dropped = useRef(false);

    useLayoutEffect(() => {
        const picture = frame.current;
        if (!picture) {
            return;
        }
        setPictureHeight(picture.getBoundingClientRect().height);
        const observer = new ResizeObserver(([entry]) => {
            if (entry) {
                setPictureHeight(entry.contentRect.height);
            }
        });
        observer.observe(picture);
        return () => observer.disconnect();
    }, []);

    useLayoutEffect(() => {
        const lines: readonly [HTMLElement, string][] = [
            [elements.original, t('lookLineTop')],
            [elements.translated, t('lookLineYours')],
        ];
        for (const [line, label] of lines) {
            line.setAttribute('role', 'button');
            line.setAttribute('aria-label', label);
            line.tabIndex = 0;
        }
    }, [elements, t]);

    const fitOutline = useCallback((): void => {
        const shown = [elements.original, elements.translated].filter(
            (line) => line.textContent !== ''
        );
        const left = Math.min(...shown.map((line) => line.offsetLeft));
        const top = Math.min(...shown.map((line) => line.offsetTop));
        const right = Math.max(
            ...shown.map((line) => line.offsetLeft + line.offsetWidth)
        );
        const bottom = Math.max(
            ...shown.map((line) => line.offsetTop + line.offsetHeight)
        );
        Object.assign(outline.style, {
            left: `${left - OUTLINE_PADDING.x}px`,
            top: `${top - OUTLINE_PADDING.y}px`,
            width: `${right - left + 2 * OUTLINE_PADDING.x}px`,
            height: `${bottom - top + 2 * OUTLINE_PADDING.y}px`,
        });
    }, [elements, outline]);

    // Restyling the block puts back only its lines, so the outline joins
    // them again after every render.
    useLayoutEffect(() => {
        elements.container.append(outline);
        outline.classList.toggle('on', ring === 'block');
        elements.translated.classList.toggle(
            'stage-picked',
            ring === 'translated'
        );
        fitOutline();
    });

    // A line's size also changes as its font loads.
    useLayoutEffect(() => {
        const observer = new ResizeObserver(fitOutline);
        observer.observe(elements.original);
        observer.observe(elements.translated);
        return () => observer.disconnect();
    }, [elements, fitOutline]);

    const lineAt = (target: EventTarget): StageLine | null =>
        target === elements.original
            ? 'original'
            : target === elements.translated
              ? 'translated'
              : null;

    const drop = (): void => {
        const position = drag.current?.position ?? null;
        drag.current = null;
        if (position !== null) {
            setDragging(false);
            dropped.current = true;
            onDrop(position);
        }
    };

    return (
        <div
            ref={frame}
            className={dragging ? 'stage dragging' : 'stage'}
            role="group"
            aria-label={t('previewLabel')}
            onPointerDown={(event) => {
                dropped.current = false;
                if (
                    event.button !== 0 ||
                    !(event.target instanceof Node) ||
                    !elements.container.contains(event.target)
                ) {
                    return;
                }
                drag.current = {
                    pointerId: event.pointerId,
                    startY: event.clientY,
                    startBottomPercent: verticalPositionToBottomPercent(
                        display.verticalPosition
                    ),
                    height: event.currentTarget.getBoundingClientRect().height,
                    position: null,
                };
            }}
            onPointerMove={(event) => {
                const current = drag.current;
                if (!current) {
                    return;
                }
                if ((event.buttons & 1) === 0) {
                    drop();
                    return;
                }
                const rise = current.startY - event.clientY;
                if (current.position === null) {
                    if (Math.abs(rise) < DRAG_THRESHOLD_PX) {
                        return;
                    }
                    setDragging(true);
                    event.currentTarget.setPointerCapture(current.pointerId);
                }
                current.position = clampPosition(
                    bottomPercentToVerticalPosition(
                        current.startBottomPercent +
                            (rise / current.height) * 100
                    )
                );
                onDrag(current.position);
            }}
            onPointerUp={drop}
            onPointerCancel={drop}
            onClick={(event) => {
                const line = lineAt(event.target);
                if (line && !dropped.current) {
                    onPickLine(line);
                }
                dropped.current = false;
            }}
            onKeyDown={(event) => {
                const line = lineAt(event.target);
                if (!line) {
                    return;
                }
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onPickLine(line);
                } else if (
                    event.key === 'ArrowUp' ||
                    event.key === 'ArrowDown'
                ) {
                    event.preventDefault();
                    onNudge(event.key === 'ArrowUp' ? 1 : -1, event.shiftKey);
                }
            }}
        >
            <Scene day={day} />
            {dragging && (
                <div
                    className="stage-guide"
                    style={{ bottom: `${USUAL_BOTTOM_PERCENT}%` }}
                >
                    <span>{t('lookUsualHeight')}</span>
                </div>
            )}
            {enabled ? (
                <div className="stage-block" ref={attach} />
            ) : (
                <p className="stage-off">{t('previewOff')}</p>
            )}
            <div className="player-bar" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                </svg>
                <span className="player-track">
                    <span />
                </span>
            </div>
            {children}
        </div>
    );
}
