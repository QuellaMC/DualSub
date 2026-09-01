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
    const authorityRef = useRef(value);
    const dirtyRef = useRef(false);
    const revisionRef = useRef(0);
    const lastCommittedRef = useRef(value);
    const mountedRef = useRef(true);
    const onCommitRef = useRef(onCommit);
    const validateRef = useRef(validate);
    onCommitRef.current = onCommit;
    validateRef.current = validate;

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    useEffect(() => {
        authorityRef.current = value;
        if (dirtyRef.current) return;

        draftRef.current = value;
        lastCommittedRef.current = value;
        setDraft(value);
        setValidationAttempted(false);
    }, [value]);

    const change = useCallback((nextValue) => {
        revisionRef.current += 1;
        dirtyRef.current = true;
        draftRef.current = nextValue;
        setDraft(nextValue);
    }, []);

    const commit = useCallback(() => {
        const committedDraft = draftRef.current;
        if (!isAccepted(validateRef.current, committedDraft)) {
            setValidationAttempted(true);
            return Promise.resolve(false);
        }
        setValidationAttempted(false);

        if (!dirtyRef.current) {
            return Promise.resolve(true);
        }
        if (Object.is(authorityRef.current, committedDraft)) {
            dirtyRef.current = false;
            lastCommittedRef.current = committedDraft;
            return Promise.resolve(true);
        }
        if (Object.is(lastCommittedRef.current, committedDraft)) {
            return Promise.resolve(true);
        }

        const committedRevision = revisionRef.current;
        const authorityAtStart = authorityRef.current;
        lastCommittedRef.current = committedDraft;

        const run = async () => {
            let accepted = false;
            try {
                accepted =
                    (await onCommitRef.current(committedDraft)) !== false;
            } catch {
                accepted = false;
            }

            if (
                !mountedRef.current ||
                revisionRef.current !== committedRevision
            ) {
                return accepted;
            }

            if (accepted) {
                dirtyRef.current = false;
                if (!Object.is(authorityRef.current, authorityAtStart)) {
                    draftRef.current = authorityRef.current;
                    lastCommittedRef.current = authorityRef.current;
                    setDraft(authorityRef.current);
                }
                return true;
            }

            const rollbackValue = Object.is(
                authorityRef.current,
                committedDraft
            )
                ? authorityAtStart
                : authorityRef.current;
            revisionRef.current += 1;
            dirtyRef.current = false;
            draftRef.current = rollbackValue;
            lastCommittedRef.current = rollbackValue;
            setDraft(rollbackValue);
            setValidationAttempted(false);
            return false;
        };

        return run();
    }, []);

    const reset = useCallback(() => {
        revisionRef.current += 1;
        dirtyRef.current = false;
        draftRef.current = authorityRef.current;
        lastCommittedRef.current = authorityRef.current;
        setDraft(authorityRef.current);
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
