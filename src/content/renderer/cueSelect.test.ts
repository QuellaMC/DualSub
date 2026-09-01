import { describe, expect, it } from 'vitest';
import type { Cue } from '../subtitles/cueModel';
import { pairActiveCues, scanActiveCues } from './cueSelect';

function cue(overrides: Partial<Cue> & { start: number; end: number }): Cue {
    return {
        id: `${overrides.start}`,
        cueType: 'original',
        original: 'text',
        translated: null,
        useNativeTarget: false,
        ...overrides,
    };
}

describe('scanActiveCues', () => {
    const cues = [
        cue({ start: 1, end: 2 }),
        cue({ start: 3, end: 5 }),
        cue({ start: 4, end: 6 }),
    ];

    it('reports the next inclusive start boundary before any cue', () => {
        expect(scanActiveCues(cues, 0.5)).toEqual({
            activeCues: [],
            nextBoundaryTime: 1,
            nextBoundaryInclusive: true,
        });
    });

    it('reports the earliest exclusive end while inside overlapping cues', () => {
        const scan = scanActiveCues(cues, 4.5);
        expect(scan.activeCues.map((c) => c.start)).toEqual([3, 4]);
        expect(scan.nextBoundaryTime).toBe(5);
        expect(scan.nextBoundaryInclusive).toBe(false);
    });

    it('has no boundary after the last cue', () => {
        expect(scanActiveCues(cues, 10).nextBoundaryTime).toBeNull();
    });
});

describe('pairActiveCues', () => {
    it('uses the first cue for translate mode', () => {
        const first = cue({ start: 1, end: 2, translated: 'x' });
        expect(pairActiveCues([first, cue({ start: 1.5, end: 3 })])).toEqual({
            original: first,
            translated: null,
        });
    });

    it('pairs original with target cues in native mode', () => {
        const original = cue({ start: 1, end: 2, useNativeTarget: true });
        const target = cue({
            start: 1.1,
            end: 2.1,
            cueType: 'target',
            original: null,
            translated: '甲',
            useNativeTarget: true,
        });
        expect(pairActiveCues([target, original])).toEqual({
            original,
            translated: target,
        });
    });

    it('returns only the target when no original is active', () => {
        const target = cue({
            start: 1,
            end: 2,
            cueType: 'target',
            original: null,
            translated: '甲',
            useNativeTarget: true,
        });
        expect(pairActiveCues([target])).toEqual({
            original: null,
            translated: target,
        });
    });
});
