import { useRef, useState } from 'react';

/**
 * A range input that previews every movement and commits once the
 * interaction ends. It shows the persisted value except while the user
 * holds a draft; a draft gives way when its commit settles, so a failed
 * commit snaps the slider back unless the user has already moved on.
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
    onCommit: (value: number) => Promise<void>;
}) {
    const [draft, setDraft] = useState<number | null>(null);
    /** The draft whose commit is on its way: a pointerup and the blur
     *  after it commit it once. */
    const committing = useRef<number | null>(null);
    const shown = draft ?? value;

    const release = (): void => {
        if (draft === null || draft === committing.current) {
            return;
        }
        const target = draft;
        committing.current = target;
        void onCommit(target).then(() => {
            if (committing.current === target) {
                committing.current = null;
            }
            setDraft((current) => (current === target ? null : current));
        });
    };

    const progress = ((shown - min) / (max - min)) * 100;

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
                    value={shown}
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
                <span className="slider-value">{shown.toFixed(1)}</span>
            </div>
        </div>
    );
}
