import type { CuePlacement, LineAlign } from '@/shared/cuePlacement';
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

/** Where a block is drawn: at the viewer's own position, where the platform
 *  draws ordinary dialogue, or on the line the platform chose. */
export type BlockPlacement =
    | { readonly kind: 'standard' }
    | {
          readonly kind: 'line';
          readonly line: number;
          readonly lineAlign: LineAlign;
      };

export const STANDARD_PLACEMENT: BlockPlacement = { kind: 'standard' };

/** A cue anchored at or below this fraction of the picture height sits
 *  where the platform draws ordinary dialogue (Disney+ anchors at 85%,
 *  Netflix at 90%), so it takes the viewer's position; anything higher is
 *  drawn where the platform put it. */
export const STANDARD_BAND = 0.75;

export function placeBlock(placement: CuePlacement): BlockPlacement {
    return placement.line === null || placement.line >= STANDARD_BAND
        ? STANDARD_PLACEMENT
        : {
              kind: 'line',
              line: placement.line,
              lineAlign: placement.lineAlign,
          };
}

export function samePlacement(a: BlockPlacement, b: BlockPlacement): boolean {
    if (a.kind === 'standard' || b.kind === 'standard') {
        return a.kind === b.kind;
    }
    return a.line === b.line && a.lineAlign === b.lineAlign;
}

/** Lines within the same twentieth of the picture share a block, so an
 *  original and an official translation authored a fraction apart stack
 *  instead of overlapping. */
const LINE_BUCKETS = 20;

export function blockKey(placement: BlockPlacement): string {
    return placement.kind === 'standard'
        ? 'standard'
        : `${placement.lineAlign}:${Math.round(placement.line * LINE_BUCKETS)}`;
}

/** The standard block first, then positioned blocks from the top down. */
export function placementOrder(placement: BlockPlacement): number {
    return placement.kind === 'standard' ? -1 : placement.line;
}

export interface CueGroup {
    readonly key: string;
    readonly placement: BlockPlacement;
    readonly cues: Cue[];
}

/** An official translation belongs with the original it shares the most
 *  time with; the two tracks need not agree on timing or placement. */
function sourceOf(target: Cue, originals: readonly Cue[]): Cue | null {
    let source: Cue | null = null;
    let bestOverlap = 0;
    for (const original of originals) {
        const overlap =
            Math.min(original.end, target.end) -
            Math.max(original.start, target.start);
        if (overlap > bestOverlap) {
            bestOverlap = overlap;
            source = original;
        }
    }
    return source;
}

/** Active cues grouped by the block that draws them, in block order. A
 *  block is placed where its first cue is. */
export function groupActiveCues(activeCues: readonly Cue[]): CueGroup[] {
    const originals = activeCues.filter((cue) => cue.cueType === 'original');
    const groups = new Map<string, CueGroup>();
    for (const cue of activeCues) {
        const anchor =
            cue.cueType === 'target' ? (sourceOf(cue, originals) ?? cue) : cue;
        const placement = placeBlock(anchor.placement);
        const key = blockKey(placement);
        const group = groups.get(key);
        if (group) {
            group.cues.push(cue);
        } else {
            groups.set(key, { key, placement, cues: [cue] });
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

/** A block's two lines, one entry per cue in cue order: the originals, and
 *  the translations (a cue's own, or the official target cues'). */
export function composeBlockText(cues: readonly Cue[]): BlockText {
    return {
        originalText: joinLines(cues.map((cue) => cue.original)),
        translatedText: joinLines(cues.map((cue) => cue.translated)),
    };
}
