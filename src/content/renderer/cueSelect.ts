import type { Cue } from '../subtitles/cueModel';

export interface ActiveCueScan {
    readonly activeCues: Cue[];
    /** Next playback time at which the active set can change. */
    readonly nextBoundaryTime: number | null;
    readonly nextBoundaryInclusive: boolean;
}

export function scanActiveCues(
    cues: readonly Cue[],
    time: number
): ActiveCueScan {
    const activeCues: Cue[] = [];
    let nextBoundaryTime: number | null = null;
    let nextBoundaryInclusive = false;
    const consider = (boundary: number, inclusive: boolean): void => {
        if (
            nextBoundaryTime === null ||
            boundary < nextBoundaryTime ||
            (boundary === nextBoundaryTime && inclusive)
        ) {
            nextBoundaryTime = boundary;
            nextBoundaryInclusive = inclusive;
        }
    };
    for (const cue of cues) {
        if (time < cue.start) {
            consider(cue.start, true);
        } else if (time <= cue.end) {
            activeCues.push(cue);
            consider(cue.end, false);
        }
    }
    return { activeCues, nextBoundaryTime, nextBoundaryInclusive };
}

export interface CuePair {
    readonly original: Cue | null;
    readonly translated: Cue | null;
}

/** Native-target mode pairs one original with one target cue (best overlap
 *  fallback); translate mode uses the first active cue for both texts. */
export function pairActiveCues(activeCues: readonly Cue[]): CuePair {
    if (activeCues.length === 0) {
        return { original: null, translated: null };
    }
    if (!activeCues.some((cue) => cue.useNativeTarget)) {
        return { original: activeCues[0]!, translated: null };
    }

    let original = activeCues.find((cue) => cue.cueType === 'original') ?? null;
    let translated = activeCues.find((cue) => cue.cueType === 'target') ?? null;

    if (!original && !translated) {
        original = activeCues[0]!;
    }
    if (original && !translated) {
        let bestOverlap = 0;
        for (const cue of activeCues) {
            if (cue === original || !cue.translated) {
                continue;
            }
            const overlap = Math.max(
                0,
                Math.min(original.end, cue.end) -
                    Math.max(original.start, cue.start)
            );
            if (overlap > bestOverlap) {
                bestOverlap = overlap;
                translated = cue;
            }
        }
    }
    return { original, translated };
}
