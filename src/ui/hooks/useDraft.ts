import { useCallback, useEffect, useRef, useState } from 'react';

/** How a write is confirmed to the viewer: a named change, or nothing. */
export type SaveFeedback = { readonly message: string } | 'quiet';

/** Sliders and color pickers report every movement; one write per pause
 *  keeps a drag within the sync storage write quota. */
const SAVE_DELAY_MS = 400;

export interface Draft<T> {
    /** What the control shows: the stored value, or an edit on its way. */
    readonly value: T;
    /** Show `value` at once and write it quietly after a pause. */
    readonly edit: (value: T) => void;
    /** Show `value` at once and write it now, confirmed with `notice`. */
    readonly set: (value: T, notice: SaveFeedback) => void;
}

/**
 * One setting's only writer, for a control that edits continuously next to
 * buttons that pick a value outright. A pick replaces an edit still waiting
 * for its pause. Writes go one at a time, the newest draft once the one in
 * flight settles, or when the editor goes away; a write that fails snaps
 * the draft back to the stored value unless a newer edit is waiting. A
 * value arriving from storage (another window, a synced device) is adopted
 * unless an edit is waiting or a write is out.
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
        // While a write is out, a value arriving from storage is the echo of
        // an older write, not news.
        if (pending.current === null && !inFlight.current) {
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
    };
}
