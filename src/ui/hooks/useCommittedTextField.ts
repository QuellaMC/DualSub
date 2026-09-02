import { useCallback, useEffect, useRef, useState } from 'react';

export interface CommittedTextField<T> {
    /** The draft the control shows. */
    readonly value: T;
    /** The draft would be accepted by `validate`. */
    readonly valid: boolean;
    /** A commit was attempted with an invalid draft; show guidance. */
    readonly invalid: boolean;
    readonly change: (next: T) => void;
    /** Persist the draft if it changed and validates; resolves true on success. */
    readonly commit: () => Promise<boolean>;
    /** Discard the draft in favour of the persisted value. */
    readonly reset: () => void;
    readonly handleKeyDown: (event: {
        key: string;
        preventDefault(): void;
    }) => void;
}

/**
 * A text control whose typing stays local until blur or Enter commits it.
 * An invalid draft stays editable and is never persisted; a failed commit
 * rolls the draft back to the persisted value unless the user has typed on.
 */
export function useCommittedTextField<T>({
    value,
    validate,
    onCommit,
}: {
    value: T;
    validate: (draft: T) => boolean;
    onCommit: (draft: T) => Promise<boolean> | boolean;
}): CommittedTextField<T> {
    const [draft, setDraft] = useState(value);
    const [attempted, setAttempted] = useState(false);
    const draftRef = useRef(value);
    const persistedRef = useRef(value);
    const dirtyRef = useRef(false);
    const onCommitRef = useRef(onCommit);
    const validateRef = useRef(validate);
    onCommitRef.current = onCommit;
    validateRef.current = validate;

    useEffect(() => {
        persistedRef.current = value;
        if (!dirtyRef.current) {
            draftRef.current = value;
            setDraft(value);
            setAttempted(false);
        }
    }, [value]);

    const change = useCallback((next: T) => {
        draftRef.current = next;
        dirtyRef.current = !Object.is(next, persistedRef.current);
        setDraft(next);
    }, []);

    const reset = useCallback(() => {
        dirtyRef.current = false;
        draftRef.current = persistedRef.current;
        setDraft(persistedRef.current);
        setAttempted(false);
    }, []);

    const commit = useCallback(async (): Promise<boolean> => {
        const target = draftRef.current;
        let accepted = false;
        try {
            accepted = validateRef.current(target) === true;
        } catch {
            accepted = false;
        }
        if (!accepted) {
            setAttempted(true);
            return false;
        }
        setAttempted(false);
        if (!dirtyRef.current) {
            return true;
        }
        dirtyRef.current = false;
        let persisted = false;
        try {
            persisted = (await onCommitRef.current(target)) !== false;
        } catch {
            persisted = false;
        }
        if (!persisted && Object.is(draftRef.current, target)) {
            reset();
        }
        return persisted;
    }, [reset]);

    const handleKeyDown = useCallback(
        (event: { key: string; preventDefault(): void }) => {
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

    let valid = false;
    try {
        valid = validateRef.current(draft) === true;
    } catch {
        valid = false;
    }

    return {
        value: draft,
        valid,
        invalid: attempted && !valid,
        change,
        commit,
        reset,
        handleKeyDown,
    };
}
