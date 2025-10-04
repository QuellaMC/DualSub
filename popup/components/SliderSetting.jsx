import React, { useEffect, useRef, useCallback } from 'react';

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

    const updateSliderProgress = useCallback((sliderElement, val) => {
        const minVal = parseFloat(min) || 0;
        const maxVal = parseFloat(max) || 100;
        const percentage = ((val - minVal) / (maxVal - minVal)) * 100;
        sliderElement.style.backgroundSize = `${percentage}% 100%`;
    }, [min, max]);

    useEffect(() => {
        if (sliderRef.current) {
            updateSliderProgress(sliderRef.current, value);
        }
    }, [value, min, max, updateSliderProgress]);

    const handleInput = (e) => {
        const newValue = parseFloat(e.target.value);
        updateSliderProgress(e.target, newValue);
        onChange(newValue);
    };

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
                    value={value}
                    onInput={handleInput}
                    onChange={(e) => onChangeEnd && onChangeEnd(parseFloat(e.target.value))}
                />
                <span className="slider-value">{formatValue(value)}</span>
            </div>
        </div>
    );
}
