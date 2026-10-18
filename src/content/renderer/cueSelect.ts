import {
    blockKey,
    placeBlock,
    placementOrder,
    type BlockPlacement,
} from '@/shared/cuePlacement';
import type { Cue } from '../subtitles/cueModel';

export interface ActiveCueScan {
    readonly activeCues: Cue[];
    /** Next playback time at which the active set changes. */
    readonly nextBoundaryTime: number | null;
}

/** A cue is active from its start up to, not including, its end, so a cue
 *  that ends exactly when the next starts never shares a frame with it. */
export function scanActiveCues(
    cues: readonly Cue[],
    time: number
): ActiveCueScan {
    const activeCues: Cue[] = [];
    let nextBoundaryTime: number | null = null;
    const consider = (boundary: number): void => {
        if (nextBoundaryTime === null || boundary < nextBoundaryTime) {
            nextBoundaryTime = boundary;
        }
    };
    for (const cue of cues) {
        if (time < cue.start) {
            consider(cue.start);
        } else if (time < cue.end) {
            activeCues.push(cue);
            consider(cue.end);
        }
    }
    return { activeCues, nextBoundaryTime };
}

export interface CueGroup {
    readonly key: string;
    readonly placement: BlockPlacement;
    readonly cues: Cue[];
}

/** The cue an official translation is drawn with. A paired one shows only
 *  with its own originals, with the first of them on screen. Any other
 *  goes with the original it shares the most time with, or on its own:
 *  the two tracks need not agree on timing or placement. */
function anchorOf(target: Cue, originals: readonly Cue[]): Cue | null {
    if (target.pairedWith.length > 0) {
        return (
            originals.find((original) =>
                target.pairedWith.includes(original.id)
            ) ?? null
        );
    }
    let anchor = target;
    let bestOverlap = 0;
    for (const original of originals) {
        const overlap =
            Math.min(original.end, target.end) -
            Math.max(original.start, target.start);
        if (overlap > bestOverlap) {
            bestOverlap = overlap;
            anchor = original;
        }
    }
    return anchor;
}

/** Active cues grouped by the block that draws them, in block order: each
 *  original followed by its translations, at the original's placement, and
 *  a translation drawn on its own at its own placement. */
export function groupActiveCues(activeCues: readonly Cue[]): CueGroup[] {
    const originals = activeCues.filter((cue) => cue.cueType === 'original');
    const translations = new Map<Cue, Cue[]>();
    for (const cue of activeCues) {
        const anchor =
            cue.cueType === 'target' ? anchorOf(cue, originals) : null;
        if (anchor) {
            translations.set(anchor, [
                ...(translations.get(anchor) ?? []),
                cue,
            ]);
        }
    }

    const groups = new Map<string, CueGroup>();
    const draw = (anchor: Cue, cues: Cue[]): void => {
        const placement = placeBlock(anchor.placement);
        const key = blockKey(placement);
        const group = groups.get(key);
        if (group) {
            group.cues.push(...cues);
        } else {
            groups.set(key, { key, placement, cues });
        }
    };
    for (const original of originals) {
        draw(original, [original, ...(translations.get(original) ?? [])]);
    }
    for (const [anchor, cues] of translations) {
        if (anchor.cueType === 'target') {
            draw(anchor, cues);
        }
    }
    return [...groups.values()].sort(
        (a, b) => placementOrder(a.placement) - placementOrder(b.placement)
    );
}

export interface BlockText {
    readonly originalText: string;
    readonly translatedText: string;
}

function joinLines(lines: readonly (string | null)[]): string {
    return lines
        .filter((line): line is string => line !== null && line !== '')
        .join('\n');
}

/** A block's two lines, one entry per cue in group order: the originals,
 *  and the translations (a cue's own, or the official target cues'). */
export function composeBlockText(cues: readonly Cue[]): BlockText {
    return {
        originalText: joinLines(cues.map((cue) => cue.original)),
        translatedText: joinLines(cues.map((cue) => cue.translated)),
    };
}
