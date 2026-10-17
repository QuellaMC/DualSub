import { raisedLine, type CuePlacement } from '@/shared/cuePlacement';
import type { FetchVttResponse } from '@/messaging/contracts/fetchVtt';
import { parseVtt, type VttCue } from './vtt';

export type CueId = string;

/**
 * One timed subtitle entry in a session's queue.
 * - Translate mode: cueType 'original' carrying `original`; `translated` is
 *   filled in by the translation loop.
 * - Native-target mode: separate 'original' and 'target' cues whose timings
 *   may not align; the renderer draws the active ones together. Paired, an
 *   original carries the official lines it belongs with as `translated`,
 *   and only the official lines that belong with no original stay 'target'.
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

/**
 * Each original's official lines, in the order they are spoken, and which
 * official lines belong with some original. An official line belongs with
 * each original it is on screen with in turn; of originals on screen
 * together, such as a sign above the dialogue, only with the one it matches
 * best, so no official line shows twice. Both tracks are walked in time
 * order, so each official line is weighed against the originals around it
 * rather than the whole track.
 */
function pairOfficialLines(
    originals: readonly VttCue[],
    targets: readonly VttCue[]
): { translations: (string | null)[]; paired: Set<number> } {
    const lines = originals.map((): string[] => []);
    const paired = new Set<number>();
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
            .sort(
                (a, b) => matchScore(b.cue, target) - matchScore(a.cue, target)
            );
        const chosen: VttCue[] = [];
        for (const { index, cue } of candidates) {
            if (chosen.some((other) => together(other, cue))) {
                continue;
            }
            chosen.push(cue);
            lines[index]!.push(target.text);
            paired.add(targetIndex);
        }
    }
    return {
        translations: lines.map((texts) =>
            texts.length > 0 ? texts.join('\n') : null
        ),
        paired,
    };
}

/** The answer's cues. With `pairOfficial`, each line of the show's own
 *  translation shows with the original lines it belongs with, for as long
 *  as they show, instead of on its own timing. */
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
    const pairing =
        useNativeTarget && pairOfficial
            ? pairOfficialLines(originalCues, targetCues)
            : null;

    const cues: Cue[] = originalCues.map((cue, index) => ({
        id: `o${index}`,
        start: cue.start,
        end: cue.end,
        cueType: 'original',
        original: cue.text,
        translated: pairing?.translations[index] ?? null,
        useNativeTarget,
        placement: cue.placement,
    }));
    if (useNativeTarget) {
        for (const [index, cue] of targetCues.entries()) {
            if (pairing?.paired.has(index)) {
                continue;
            }
            cues.push({
                id: `t${index}`,
                start: cue.start,
                end: cue.end,
                cueType: 'target',
                original: null,
                translated: cue.text,
                useNativeTarget,
                placement: cue.placement,
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
