import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

interface Fit {
    readonly scale: number;
    readonly height: number;
}

/**
 * Lays an illustration out at its designed pixel size, then scales it to the
 * width available so it resizes as a whole, the way an image would. The
 * board's class sets that designed size; the layout around the artboard
 * sets its width.
 */
export function Artboard({
    className,
    label,
    children,
}: {
    className: string;
    label: string;
    children: ReactNode;
}) {
    const frameRef = useRef<HTMLDivElement>(null);
    const boardRef = useRef<HTMLDivElement>(null);
    const [fit, setFit] = useState<Fit | null>(null);

    useLayoutEffect(() => {
        const frame = frameRef.current;
        const board = boardRef.current;
        if (!frame || !board) {
            return;
        }
        const measure = (): void => {
            const scale = frame.clientWidth / board.offsetWidth;
            const height = board.offsetHeight * scale;
            setFit((current) =>
                current?.scale === scale && current.height === height
                    ? current
                    : { scale, height }
            );
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(frame);
        observer.observe(board);
        return () => observer.disconnect();
    }, []);

    return (
        <div
            ref={frameRef}
            className="artboard"
            role="img"
            aria-label={label}
            style={{ height: fit?.height }}
        >
            <div
                ref={boardRef}
                className={`artboard-board ${className}`}
                style={{
                    transform: `translateX(-50%) scale(${fit?.scale ?? 1})`,
                }}
            >
                {children}
            </div>
        </div>
    );
}
