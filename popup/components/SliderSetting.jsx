import React, {
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
} from 'react';

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
    const lastRequestedValueRef = useRef(value);
    const commitWorkerRef = useRef(null);
    const pendingCommitRef = useRef(null);
    const activeCommitRef = useRef(null);
    // Authoritative props advance the generation so stale queued releases are
    // discarded without cancelling persistence that has already started.
    const propGenerationRef = useRef(0);
    const previewGenerationRef = useRef(0);
    const onChangeEndRef = useRef(onChangeEnd);
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

    useLayoutEffect(() => {
        onChangeEndRef.current = onChangeEnd;
    }, [onChangeEnd]);

    useLayoutEffect(() => {
        const activeCommit = activeCommitRef.current;
        const isOptimisticEcho =
            activeCommit !== null &&
            activeCommit.generation === propGenerationRef.current &&
            Object.is(value, activeCommit.value) &&
            !Object.is(value, confirmedValueRef.current);
        if (isOptimisticEcho) {
            return;
        }

        propGenerationRef.current += 1;
        pendingCommitRef.current = null;
        setDraftValue(value);
        confirmedValueRef.current = value;
        lastRequestedValueRef.current = value;
    }, [value]);

    useEffect(() => {
        if (sliderRef.current) {
            updateSliderProgress(sliderRef.current, draftValue);
        }
    }, [draftValue, updateSliderProgress]);

    const handleInput = (e) => {
        const newValue = parseFloat(e.target.value);
        previewGenerationRef.current += 1;
        setDraftValue(newValue);
        updateSliderProgress(e.target, newValue);
        onChange(newValue);
    };

    const drainCommitQueue = useCallback(async (initialCommit) => {
        let commit = initialCommit;

        try {
            while (commit !== null) {
                let persisted = false;
                activeCommitRef.current = commit;
                try {
                    await onChangeEndRef.current(commit.value, {
                        confirmedValue: confirmedValueRef.current,
                        isCurrent: () =>
                            commit.generation === propGenerationRef.current &&
                            commit.previewGeneration ===
                                previewGenerationRef.current,
                    });
                    if (commit.generation === propGenerationRef.current) {
                        confirmedValueRef.current = commit.value;
                    }
                    persisted = true;
                } catch {
                    // Keep the previous committed value so this draft can be retried.
                }

                const pendingCommit = pendingCommitRef.current;
                pendingCommitRef.current = null;

                if (
                    !persisted &&
                    pendingCommit === null &&
                    commit.generation === propGenerationRef.current &&
                    lastRequestedValueRef.current === commit.value
                ) {
                    lastRequestedValueRef.current = confirmedValueRef.current;
                }

                commit =
                    pendingCommit !== null &&
                    pendingCommit.generation === propGenerationRef.current &&
                    pendingCommit.value !== confirmedValueRef.current
                        ? pendingCommit
                        : null;
            }
        } finally {
            activeCommitRef.current = null;
            commitWorkerRef.current = null;
        }
    }, []);

    const commitValue = useCallback(() => {
        if (
            !onChangeEndRef.current ||
            draftValue === lastRequestedValueRef.current
        ) {
            return commitWorkerRef.current?.promise ?? null;
        }

        lastRequestedValueRef.current = draftValue;
        if (commitWorkerRef.current) {
            pendingCommitRef.current = {
                generation: propGenerationRef.current,
                previewGeneration: previewGenerationRef.current,
                value: draftValue,
            };
            return commitWorkerRef.current.promise;
        }

        // Released persistence intentionally survives React component unmount
        // while this document remains alive. The worker only mutates refs and
        // invokes the supplied callback; it never schedules component state or
        // timers.
        const commitWorker = {};
        commitWorkerRef.current = commitWorker;
        commitWorker.promise = drainCommitQueue({
            generation: propGenerationRef.current,
            previewGeneration: previewGenerationRef.current,
            value: draftValue,
        });
        return commitWorker.promise;
    }, [draftValue, drainCommitQueue]);

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
