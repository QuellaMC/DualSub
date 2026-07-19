import { useCallback, useEffect, useRef, useState } from 'react';

function isAccepted(validate, value) {
    try {
        return validate(value) === true;
    } catch {
        return false;
    }
}

export function useCommittedTextField({ value, onCommit, validate }) {
    const [draft, setDraft] = useState(value);
    const [validationAttempted, setValidationAttempted] = useState(false);
    const draftRef = useRef(value);
    const authoritativeValueRef = useRef(value);
    const onCommitRef = useRef(onCommit);
    const validateRef = useRef(validate);
    const draftRevisionRef = useRef(0);
    const localChangeRevisionRef = useRef(0);
    const authoritativeRevisionRef = useRef(0);
    const committedRevisionRef = useRef(-1);
    const externalSyncRevisionRef = useRef(-1);
    const mountedRef = useRef(true);
    onCommitRef.current = onCommit;
    validateRef.current = validate;

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    useEffect(() => {
        authoritativeValueRef.current = value;
        authoritativeRevisionRef.current += 1;
        const hasLocallyOwnedDraft =
            draftRevisionRef.current !== externalSyncRevisionRef.current;
        if (hasLocallyOwnedDraft && !Object.is(draftRef.current, value)) {
            return;
        }
        draftRevisionRef.current += 1;
        committedRevisionRef.current = draftRevisionRef.current;
        externalSyncRevisionRef.current = draftRevisionRef.current;
        draftRef.current = value;
        setDraft(value);
        setValidationAttempted(false);
    }, [value]);

    const change = useCallback((nextValue) => {
        draftRevisionRef.current += 1;
        localChangeRevisionRef.current += 1;
        draftRef.current = nextValue;
        setDraft(nextValue);
    }, []);

    const commit = useCallback(async () => {
        if (!isAccepted(validateRef.current, draftRef.current)) {
            setValidationAttempted(true);
            return false;
        }
        setValidationAttempted(false);
        if (committedRevisionRef.current === draftRevisionRef.current) {
            return true;
        }
        const committedRevision = draftRevisionRef.current;
        const committedLocalChangeRevision = localChangeRevisionRef.current;
        const committedDraft = draftRef.current;
        const authoritativeValueAtStart = authoritativeValueRef.current;
        const authoritativeRevisionAtStart = authoritativeRevisionRef.current;
        committedRevisionRef.current = committedRevision;

        let result;
        try {
            result = await onCommitRef.current(committedDraft);
        } catch {
            result = false;
        }
        if (result !== false) {
            if (
                mountedRef.current &&
                draftRevisionRef.current === committedRevision &&
                localChangeRevisionRef.current === committedLocalChangeRevision
            ) {
                if (
                    authoritativeRevisionRef.current !==
                    authoritativeRevisionAtStart
                ) {
                    const latestExternalValue = authoritativeValueRef.current;
                    draftRevisionRef.current += 1;
                    committedRevisionRef.current = draftRevisionRef.current;
                    externalSyncRevisionRef.current = draftRevisionRef.current;
                    draftRef.current = latestExternalValue;
                    setDraft(latestExternalValue);
                    setValidationAttempted(false);
                } else {
                    externalSyncRevisionRef.current = committedRevision;
                }
            }
            return true;
        }

        if (
            mountedRef.current &&
            localChangeRevisionRef.current === committedLocalChangeRevision
        ) {
            const latestExternalValue = authoritativeValueRef.current;
            const rollbackValue = Object.is(latestExternalValue, committedDraft)
                ? authoritativeValueAtStart
                : latestExternalValue;
            draftRevisionRef.current += 1;
            localChangeRevisionRef.current += 1;
            committedRevisionRef.current = draftRevisionRef.current;
            externalSyncRevisionRef.current = draftRevisionRef.current;
            draftRef.current = rollbackValue;
            setDraft(rollbackValue);
            setValidationAttempted(false);
        }
        return false;
    }, []);

    const reset = useCallback(() => {
        draftRevisionRef.current += 1;
        localChangeRevisionRef.current += 1;
        committedRevisionRef.current = draftRevisionRef.current;
        externalSyncRevisionRef.current = draftRevisionRef.current;
        draftRef.current = authoritativeValueRef.current;
        setDraft(authoritativeValueRef.current);
        setValidationAttempted(false);
    }, []);

    const handleKeyDown = useCallback(
        (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                void commit();
            } else if (event.key === 'Escape') {
                event.preventDefault();
                reset();
            }
        },
        [commit, reset]
    );

    const valid = isAccepted(validateRef.current, draft);

    return {
        value: draft,
        valid,
        invalid: validationAttempted && !valid,
        change,
        commit,
        reset,
        handleKeyDown,
    };
}
