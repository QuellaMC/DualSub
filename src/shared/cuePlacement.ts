/**
 * Where a cue sits in the picture, as WebVTT cue settings describe it. The
 * platforms place cues vertically only: Disney+ cues carry `line:85%,end`
 * for dialogue and `line:15%,start` over on-screen text, and Netflix regions
 * resolve to the same two anchors. Horizontal layout stays DualSub's own.
 */
export type LineAlign = 'start' | 'center' | 'end';

export interface CuePlacement {
    /** Vertical anchor as a fraction of the picture height from the top;
     *  null is the platform's automatic bottom placement. */
    readonly line: number | null;
    /** The block edge that sits on the anchor. */
    readonly lineAlign: LineAlign;
}

export const AUTO_PLACEMENT: CuePlacement = { line: null, lineAlign: 'end' };

/** A cue anchored at or below this fraction of the picture height sits
 *  where the platform draws ordinary dialogue (Disney+ anchors at 85%,
 *  Netflix at 90%); anything higher is raised over on-screen text. */
const DIALOGUE_BAND = 0.75;

/** The line a raised cue hangs on; null for a cue in the dialogue band. */
export function raisedLine(placement: CuePlacement): number | null {
    return placement.line === null || placement.line >= DIALOGUE_BAND
        ? null
        : placement.line;
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

/** A cue in the dialogue band takes the viewer's position; a raised one is
 *  drawn where the platform put it. */
export function placeBlock(placement: CuePlacement): BlockPlacement {
    const line = raisedLine(placement);
    return line === null
        ? STANDARD_PLACEMENT
        : { kind: 'line', line, lineAlign: placement.lineAlign };
}

export function blockKey(placement: BlockPlacement): string {
    return placement.kind === 'standard'
        ? 'standard'
        : `${placement.lineAlign}:${placement.line}`;
}

/** The standard block first, then positioned blocks from the top down. */
export function placementOrder(placement: BlockPlacement): number {
    return placement.kind === 'standard' ? -1 : placement.line;
}

const LINE_ALIGNS: readonly LineAlign[] = ['start', 'center', 'end'];

/** The placement in a cue's settings text (`line:85%,end position:50%`).
 *  Anything but a percentage line, snap-to-lines rows included, is the
 *  automatic placement: a row is a multiple of the renderer's own line
 *  height, which this model does not describe. */
export function parseCueSettings(settings: string): CuePlacement {
    for (const token of settings.trim().split(/\s+/)) {
        if (!token.startsWith('line:')) {
            continue;
        }
        const [value = '', align] = token.slice('line:'.length).split(',');
        const percent = /^(\d+(?:\.\d+)?)%$/.exec(value);
        if (!percent) {
            return AUTO_PLACEMENT;
        }
        return {
            line: Math.min(1, Number(percent[1]) / 100),
            lineAlign:
                LINE_ALIGNS.find((candidate) => candidate === align) ?? 'start',
        };
    }
    return AUTO_PLACEMENT;
}

/** The cue settings text for a placement; empty for the automatic one. */
export function formatCueSettings(placement: CuePlacement): string {
    if (placement.line === null) {
        return '';
    }
    const percent = Math.round(placement.line * 10_000) / 100;
    return `line:${percent}%,${placement.lineAlign}`;
}
