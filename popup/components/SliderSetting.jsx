import React, { useCallback, useEffect, useRef, useState } from 'react';

export function SliderSetting({
    label,
    id,
    value,
    min,
    max,
    step,
    onChange,
    onChangeEnd,
}) {
    const sliderRef = useRef(null);
    const confirmedValueRef = useRef(value);
    const lastReleasedValueRef = useRef(value);
    const activeCommitRef = useRef(null);
    const authorityRevisionRef = useRef(0);
    const previewRevisionRef = useRef(0);
    const [draftValue, setDraftValue] = useState(value);

    const updateSliderProgress = useCallback(
        (sliderElement, val) => {
            const minVal = parseFloat(min) || 0;
            const maxVal = parseFloat(max) || 100;
            const percentage = ((val - minVal) / (maxVal - minVal)) * 100;
            sliderElement.style.backgroundSize = `${percentage}% 100%`;
        },
        [min, max]
    );

    useEffect(() => {
        const activeCommit = activeCommitRef.current;
        const isOptimisticEcho =
            activeCommit !== null &&
            activeCommit.authorityRevision === authorityRevisionRef.current &&
            Object.is(value, activeCommit.value) &&
            !Object.is(value, confirmedValueRef.current);
        if (isOptimisticEcho) {
            return;
        }

        authorityRevisionRef.current += 1;
        activeCommitRef.current = null;
        setDraftValue(value);
        confirmedValueRef.current = value;
        lastReleasedValueRef.current = value;
    }, [value]);

    useEffect(() => {
        if (sliderRef.current) {
            updateSliderProgress(sliderRef.current, draftValue);
        }
    }, [draftValue, updateSliderProgress]);

    const handleInput = (e) => {
        const newValue = parseFloat(e.target.value);
        previewRevisionRef.current += 1;
        setDraftValue(newValue);
        updateSliderProgress(e.target, newValue);
        onChange(newValue);
    };

    const commitValue = useCallback(() => {
        if (
            !onChangeEnd ||
            Object.is(draftValue, lastReleasedValueRef.current)
        ) {
            return;
        }

        const commit = {
            authorityRevision: authorityRevisionRef.current,
            previewRevision: previewRevisionRef.current,
            value: draftValue,
        };
        activeCommitRef.current = commit;
        lastReleasedValueRef.current = draftValue;

        const isCurrent = () =>
            activeCommitRef.current === commit &&
            commit.authorityRevision === authorityRevisionRef.current &&
            commit.previewRevision === previewRevisionRef.current;

        Promise.resolve(
            onChangeEnd(draftValue, {
                getConfirmedValue: () => confirmedValueRef.current,
                isCurrent,
            })
        )
            .then(() => {
                if (commit.authorityRevision === authorityRevisionRef.current) {
                    confirmedValueRef.current = commit.value;
                }
            })
            .catch(() => {
                if (isCurrent()) {
                    lastReleasedValueRef.current = confirmedValueRef.current;
                }
            });
    }, [draftValue, onChangeEnd]);

    const formatValue = (val) => {
        return parseFloat(val).toFixed(1);
    };

    return (
        <div className="setting-item-slider">
            <label htmlFor={id}>{label}</label>
            <div className="slider-control">
                <input
                    ref={sliderRef}
                    type="range"
                    id={id}
                    min={min}
                    max={max}
                    step={step}
                    value={draftValue}
                    onChange={handleInput}
                    onPointerUp={commitValue}
                    onPointerCancel={commitValue}
                    onKeyUp={commitValue}
                    onBlur={commitValue}
                />
                <span className="slider-value">{formatValue(draftValue)}</span>
            </div>
        </div>
    );
}
