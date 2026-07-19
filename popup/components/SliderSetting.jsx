import React, { useEffect, useRef, useCallback, useState } from 'react';

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
    const lastCommittedValueRef = useRef(value);
    const commitInFlightRef = useRef(null);
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
        if (sliderRef.current) {
            setDraftValue(value);
            lastCommittedValueRef.current = value;
            updateSliderProgress(sliderRef.current, value);
        }
    }, [value, min, max, updateSliderProgress]);

    const handleInput = (e) => {
        const newValue = parseFloat(e.target.value);
        setDraftValue(newValue);
        updateSliderProgress(e.target, newValue);
        onChange(newValue);
    };

    const commitValue = useCallback(async () => {
        if (
            !onChangeEnd ||
            draftValue === lastCommittedValueRef.current ||
            commitInFlightRef.current
        ) {
            return commitInFlightRef.current;
        }

        const valueToCommit = draftValue;
        const commitPromise = (async () => {
            try {
                await onChangeEnd(valueToCommit);
                lastCommittedValueRef.current = valueToCommit;
            } catch {
                // Keep the previous committed value so the same draft can be retried.
            } finally {
                commitInFlightRef.current = null;
            }
        })();
        commitInFlightRef.current = commitPromise;
        return commitPromise;
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
