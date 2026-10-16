import { useCallback, useEffect, useRef, useState } from 'react';
import type { SaveFeedback } from '../types';

/** Sliders and color pickers report every movement; one write per pause
 *  keeps a drag within the sync storage write quota. */
const SAVE_DELAY_MS = 400;

const INTERACTION_ENDS = ['pointerup', 'keyup', 'blur', 'pagehide'] as const;

export interface Draft<T> {
    /** What the control shows: the stored value, or an edit on its way. */
    readonly value: T;
    /** Show `value` at once and write it quietly after a pause, or once
     *  the interaction that made it ends. */
    readonly edit: (value: T) => void;
    /** Show `value` at once and write it now, confirmed with `notice`. */
    readonly set: (value: T, notice: SaveFeedback) => void;
    /** Drop an edit still waiting to be written and show the stored value
     *  again; a write already on its way still lands. */
    readonly cancel: () => void;
}

/**
 * One setting's only writer, for a control that edits continuously next to
 * buttons that pick a value outright. A pick replaces an edit still waiting
 * for its pause. Writes go one at a time, the newest draft once the one in
 * flight settles, or when the editor goes away; a write that fails snaps
 * the draft back to the stored value unless a newer edit is waiting. A
 * value arriving from storage (another window, a synced device) is adopted
 * unless an edit is waiting.
 */
export function useDraft<T>(
    saved: T,
    write: (value: T, notice: SaveFeedback) => Promise<boolean>
): Draft<T> {
    const [draft, setDraft] = useState(saved);
    /** How to confirm the edit storage has not seen yet; null when none. */
    const pending = useRef<SaveFeedback | null>(null);
    const inFlight = useRef(false);
    const latest = useRef({ draft, write, saved });

    useEffect(() => {
        latest.current = { draft, write, saved };
    });

    useEffect(() => {
        if (pending.current === null) {
            setDraft(saved);
        }
    }, [saved]);

    const flush = useCallback(function flush(): void {
        const notice = pending.current;
        if (notice === null || inFlight.current) {
            return;
        }
        pending.current = null;
        inFlight.current = true;
        void latest.current
            .write(latest.current.draft, notice)
            .then((persisted) => {
                inFlight.current = false;
                if (pending.current !== null) {
                    flush();
                } else if (!persisted) {
                    setDraft(latest.current.saved);
                }
            });
    }, []);

    useEffect(() => {
        if (pending.current === null) {
            return;
        }
        const timer = setTimeout(flush, SAVE_DELAY_MS);
        return () => clearTimeout(timer);
    }, [draft, flush]);

    useEffect(() => flush, [flush]);

    // An edit goes out once the interaction that made it ends (a pointer or
    // key going up, the window losing focus) and before the page goes away,
    // where no timer would run.
    useEffect(() => {
        for (const type of INTERACTION_ENDS) {
            window.addEventListener(type, flush);
        }
        return () => {
            for (const type of INTERACTION_ENDS) {
                window.removeEventListener(type, flush);
            }
        };
    }, [flush]);

    const cancel = useCallback((): void => {
        pending.current = null;
        setDraft(latest.current.saved);
    }, []);

    const show = (value: T, notice: SaveFeedback): void => {
        // A pick's confirmation outlasts the quiet edits that follow it
        // before the write goes out.
        if (notice !== 'quiet' || pending.current === null) {
            pending.current = notice;
        }
        latest.current = { ...latest.current, draft: value };
        setDraft(value);
    };

    return {
        value: draft,
        edit: (value) => show(value, 'quiet'),
        set: (value, notice) => {
            show(value, notice);
            flush();
        },
        cancel,
    };
}
