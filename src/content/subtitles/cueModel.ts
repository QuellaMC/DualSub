import { raisedLine, type CuePlacement } from '@/shared/cuePlacement';
import type { FetchVttResponse } from '@/messaging/contracts/fetchVtt';
import { parseVtt, type VttCue } from './vtt';

export type CueId = string;

/**
 * One timed subtitle entry in a session's queue.
 * - Translate mode: cueType 'original' carrying `original`; `translated` is
 *   filled in by the translation loop.
 * - Native-target mode: separate 'original' and 'target' cues whose timings
 *   may not align; the renderer draws the active ones together.
 */
export interface Cue {
    readonly id: CueId;
    readonly start: number;
    readonly end: number;
    readonly cueType: 'original' | 'target';
    readonly original: string | null;
    translated: string | null;
    readonly useNativeTarget: boolean;
    readonly placement: CuePlacement;
    /** The originals an official line belongs with. It spans their time
     *  and shows while one of them shows, once, with the first of them on
     *  screen. Empty for an original, and for an official line on its own
     *  timing. */
    readonly pairedWith: readonly CueId[];
}

export interface CueSet {
    readonly cues: Cue[];
    readonly useNativeTarget: boolean;
    readonly sourceLanguage: string;
    readonly targetLanguage: string;
}

/** Two lines are on screen together when they share at least this much of
 *  the shorter one's time: enough that a line ending just as the next
 *  begins does not count, and that one long line can be with two short
 *  ones in turn. */
const PAIRING_SHARE = 0.5;

function sharedTime(a: VttCue, b: VttCue): number {
    return Math.min(a.end, b.end) - Math.max(a.start, b.start);
}

function together(a: VttCue, b: VttCue): boolean {
    const shorter = Math.min(a.end - a.start, b.end - b.start);
    return shorter > 0 && sharedTime(a, b) >= PAIRING_SHARE * shorter;
}

/** How far down the picture a line sits, from the top at 0 to the dialogue
 *  band at 1. */
function depth(placement: CuePlacement): number {
    return raisedLine(placement) ?? 1;
}

/** The most a match gains for two lines sitting in the same place: enough
 *  to settle lines timed alike, such as a sign and the dialogue under it,
 *  never enough to outweigh clearly different timing. */
const SAME_PLACE_PREFERENCE = 0.1;

/** How well an official line matches an original: the time they share
 *  over the time either is on screen, and how near each other they sit. */
function matchScore(original: VttCue, target: VttCue): number {
    const timeMatch =
        sharedTime(original, target) /
        (Math.max(original.end, target.end) -
            Math.min(original.start, target.start));
    const nearness =
        1 - Math.abs(depth(original.placement) - depth(target.placement));
    return timeMatch + SAME_PLACE_PREFERENCE * nearness;
}

interface TrackCue {
    readonly index: number;
    readonly cue: VttCue;
}

function inTimeOrder(cues: readonly VttCue[]): TrackCue[] {
    return cues
        .map((cue, index) => ({ index, cue }))
        .sort((a, b) => a.cue.start - b.cue.start);
}

/** Originals in the order an official line matches them, best first: by
 *  score, then, between originals that score alike, the one whose edge
 *  meets its line as the official line's does, since a line hanging from
 *  a mark and one standing on it are drawn in different places. */
function bestMatchFirst(target: VttCue): (a: TrackCue, b: TrackCue) => number {
    const sameEdge = ({ cue }: TrackCue): number =>
        Number(cue.placement.lineAlign === target.placement.lineAlign);
    return (a, b) =>
        matchScore(b.cue, target) - matchScore(a.cue, target) ||
        sameEdge(b) - sameEdge(a);
}

/**
 * For each official line, the originals it belongs with: each original it
 * is on screen with in turn, but of originals on screen together, such as
 * a sign above the dialogue, only the one it matches best. Both tracks are
 * walked in time order, so each official line is weighed against the
 * originals around it rather than the whole track.
 */
function pairOfficialLines(
    originals: readonly VttCue[],
    targets: readonly VttCue[]
): number[][] {
    const belongsWith = targets.map((): number[] => []);
    const upcoming = inTimeOrder(originals);
    let next = 0;
    let around: TrackCue[] = [];
    for (const { index: targetIndex, cue: target } of inTimeOrder(targets)) {
        while (
            next < upcoming.length &&
            upcoming[next]!.cue.start < target.end
        ) {
            around.push(upcoming[next]!);
            next += 1;
        }
        around = around.filter(({ cue }) => cue.end > target.start);
        const candidates = around
            .filter(({ cue }) => together(cue, target))
            .sort(bestMatchFirst(target));
        const chosen: VttCue[] = [];
        for (const { index, cue } of candidates) {
            if (chosen.some((other) => together(other, cue))) {
                continue;
            }
            chosen.push(cue);
            belongsWith[targetIndex]!.push(index);
        }
    }
    return belongsWith;
}

function originalId(index: number): CueId {
    return `o${index}`;
}

/** A gap shorter than this between two lines of a track is no pause:
 *  subtitle style guides close such gaps to a couple of frames. */
const CHAINED_GAP = 0.5;

interface Timing {
    readonly start: number;
    readonly end: number;
}

/** How many of the ascending `values` are below `limit`, or also at it
 *  with `orAt`. */
function countBelow(
    values: readonly number[],
    limit: number,
    orAt: boolean
): number {
    let low = 0;
    let high = values.length;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        const value = values[middle]!;
        if (value < limit || (orAt && value === limit)) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    return low;
}

/** `track` with each line held until the next one begins when the gap
 *  between them is short and a line of `steady` shows through all of it,
 *  so that line does not blink while the lines beside it change. */
function holdThroughShortGaps<Line extends Timing>(
    track: readonly Line[],
    steady: readonly Timing[]
): Line[] {
    const starts = track.map((line) => line.start).sort((a, b) => a - b);
    const steadyByStart = [...steady].sort((a, b) => a.start - b.start);
    const steadyStarts = steadyByStart.map((line) => line.start);
    const latestEnds: number[] = [];
    for (const line of steadyByStart) {
        latestEnds.push(Math.max(line.end, latestEnds.at(-1) ?? -Infinity));
    }
    return track.map((line) => {
        const next = starts[countBelow(starts, line.end, false)];
        const shownBefore = countBelow(steadyStarts, line.end, true);
        const held =
            next !== undefined &&
            next > line.end &&
            next - line.end < CHAINED_GAP &&
            shownBefore > 0 &&
            latestEnds[shownBefore - 1]! >= next;
        return held ? { ...line, end: next } : line;
    });
}

/** The answer's cues. With `pairOfficial`, each line of the show's own
 *  translation shows with the original lines it belongs with, for as long
 *  as they show, instead of on its own timing. A line that stays on screen
 *  through a short gap in the other track holds the line before the gap
 *  until the next begins. Official lines go in the order they are spoken,
 *  so lines that come to share a start keep it. */
export function buildCueSet(
    response: Extract<FetchVttResponse, { success: true }>,
    pairOfficial: boolean
): CueSet {
    const originalCues = parseVtt(response.vttText);
    const targetCues =
        response.useNativeTarget && response.targetVttText
            ? parseVtt(response.targetVttText)
            : [];
    const useNativeTarget = response.useNativeTarget && targetCues.length > 0;
    const belongsWith =
        useNativeTarget && pairOfficial
            ? pairOfficialLines(originalCues, targetCues)
            : null;
    const officialCues = targetCues.map((cue, index) => {
        const owners = (belongsWith?.[index] ?? []).map(
            (owner) => originalCues[owner]!
        );
        return owners.length > 0
            ? {
                  ...cue,
                  start: Math.min(...owners.map((owner) => owner.start)),
                  end: Math.max(...owners.map((owner) => owner.end)),
              }
            : cue;
    });
    const originals = holdThroughShortGaps(originalCues, officialCues);
    const officials = holdThroughShortGaps(officialCues, originals);

    const cues: Cue[] = originals.map((cue, index) => ({
        id: originalId(index),
        start: cue.start,
        end: cue.end,
        cueType: 'original',
        original: cue.text,
        translated: null,
        useNativeTarget,
        placement: cue.placement,
        pairedWith: [],
    }));
    if (useNativeTarget) {
        for (const { index, cue } of inTimeOrder(targetCues)) {
            const shown = officials[index]!;
            cues.push({
                id: `t${index}`,
                start: shown.start,
                end: shown.end,
                cueType: 'target',
                original: null,
                translated: cue.text,
                useNativeTarget,
                placement: cue.placement,
                pairedWith: (belongsWith?.[index] ?? []).map(originalId),
            });
        }
    }
    cues.sort((a, b) => a.start - b.start);

    return {
        cues,
        useNativeTarget,
        sourceLanguage: response.sourceLanguage,
        targetLanguage: response.targetLanguage,
    };
}
