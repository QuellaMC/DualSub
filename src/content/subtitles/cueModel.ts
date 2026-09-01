import type { FetchVttResponse } from '@/messaging/contracts/fetchVtt';
import { parseVtt } from './vtt';

export type CueId = string;

/**
 * One timed subtitle entry in a session's queue.
 * - Translate mode: cueType 'original' carrying `original`; `translated` is
 *   filled in by the translation loop.
 * - Native-target mode: separate 'original' and 'target' cues whose timings
 *   may not align; the renderer pairs the active ones.
 */
export interface Cue {
    readonly id: CueId;
    readonly start: number;
    readonly end: number;
    readonly cueType: 'original' | 'target';
    readonly original: string | null;
    translated: string | null;
    readonly useNativeTarget: boolean;
}

export interface CueSet {
    readonly cues: Cue[];
    readonly useNativeTarget: boolean;
    readonly sourceLanguage: string;
    readonly targetLanguage: string;
}

export function buildCueSet(
    response: Extract<FetchVttResponse, { success: true }>
): CueSet {
    const originalCues = parseVtt(response.vttText);
    const targetCues =
        response.useNativeTarget && response.targetVttText
            ? parseVtt(response.targetVttText)
            : [];
    const useNativeTarget = response.useNativeTarget && targetCues.length > 0;

    const cues: Cue[] = originalCues.map((cue, index) => ({
        id: `o${index}`,
        start: cue.start,
        end: cue.end,
        cueType: 'original',
        original: cue.text,
        translated: null,
        useNativeTarget,
    }));
    if (useNativeTarget) {
        for (const [index, cue] of targetCues.entries()) {
            cues.push({
                id: `t${index}`,
                start: cue.start,
                end: cue.end,
                cueType: 'target',
                original: null,
                translated: cue.text,
                useNativeTarget,
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
