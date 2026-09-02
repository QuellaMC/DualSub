import { useEffect, useRef, useState } from 'react';

/**
 * A range input that previews every movement and commits once the
 * interaction ends. A commit that fails snaps the slider back to the
 * persisted value unless the user has already moved on to a newer draft.
 */
export function SliderSetting({
    id,
    label,
    value,
    min,
    max,
    step,
    onPreview,
    onCommit,
}: {
    id: string;
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    onPreview: (value: number) => void;
    onCommit: (value: number) => Promise<boolean>;
}) {
    const [draft, setDraft] = useState(value);
    const draftRef = useRef(value);
    const committed = useRef(value);

    useEffect(() => {
        draftRef.current = draft;
    }, [draft]);

    useEffect(() => {
        setDraft(value);
        committed.current = value;
    }, [value]);

    const release = (): void => {
        const target = draft;
        if (target === committed.current) {
            return;
        }
        committed.current = target;
        void onCommit(target).then((persisted) => {
            if (persisted) {
                return;
            }
            if (committed.current === target) {
                committed.current = value;
            }
            if (draftRef.current === target) {
                setDraft(value);
            }
        });
    };

    const progress = ((draft - min) / (max - min)) * 100;

    return (
        <div className="setting-item-slider">
            <label htmlFor={id}>{label}</label>
            <div className="slider-control">
                <input
                    type="range"
                    id={id}
                    min={min}
                    max={max}
                    step={step}
                    value={draft}
                    style={{ backgroundSize: `${progress}% 100%` }}
                    onChange={(event) => {
                        const next = Number(event.target.value);
                        setDraft(next);
                        onPreview(next);
                    }}
                    onPointerUp={release}
                    onPointerCancel={release}
                    onKeyUp={release}
                    onBlur={release}
                />
                <span className="slider-value">{draft.toFixed(1)}</span>
            </div>
        </div>
    );
}
