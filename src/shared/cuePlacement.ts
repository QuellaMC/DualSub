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

/** One snap-to-lines row as a fraction of the picture height: the line
 *  height of the browsers' default cue size. */
const SNAP_ROW = 0.06;

const LINE_ALIGNS: readonly LineAlign[] = ['start', 'center', 'end'];

function clampFraction(value: number): number {
    return Math.min(1, Math.max(0, value));
}

function parseLineAlign(value: string | undefined): LineAlign | null {
    return LINE_ALIGNS.find((candidate) => candidate === value) ?? null;
}

/** The placement in a cue's settings text (`line:85%,end position:50%`);
 *  anything but a well-formed `line` is the automatic placement. */
export function parseCueSettings(settings: string): CuePlacement {
    for (const token of settings.trim().split(/\s+/)) {
        if (!token.startsWith('line:')) {
            continue;
        }
        const [value = '', align] = token.slice('line:'.length).split(',');
        const lineAlign = parseLineAlign(align);
        const percent = /^(\d+(?:\.\d+)?)%$/.exec(value);
        if (percent) {
            return {
                line: clampFraction(Number(percent[1]) / 100),
                lineAlign: lineAlign ?? 'start',
            };
        }
        if (!/^-?\d+$/.test(value)) {
            return AUTO_PLACEMENT;
        }
        const row = Number(value);
        return row >= 0
            ? {
                  line: clampFraction(row * SNAP_ROW),
                  lineAlign: lineAlign ?? 'start',
              }
            : {
                  line: clampFraction(1 + (row + 1) * SNAP_ROW),
                  lineAlign: lineAlign ?? 'end',
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
