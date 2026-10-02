import { describe, expect, it } from 'vitest';
import { AUTO_PLACEMENT, type CuePlacement } from '@/shared/cuePlacement';
import type { Cue } from '../subtitles/cueModel';
import {
    blockKey,
    composeBlockText,
    groupActiveCues,
    placeBlock,
    samePlacement,
    scanActiveCues,
    STANDARD_PLACEMENT,
} from './cueSelect';

function cue(overrides: Partial<Cue> & { start: number; end: number }): Cue {
    return {
        id: `${overrides.start}`,
        cueType: 'original',
        original: 'text',
        translated: null,
        useNativeTarget: false,
        placement: AUTO_PLACEMENT,
        ...overrides,
    };
}

const TOP: CuePlacement = { line: 0.15, lineAlign: 'start' };
const BOTTOM: CuePlacement = { line: 0.85, lineAlign: 'end' };

describe('scanActiveCues', () => {
    const cues = [
        cue({ start: 1, end: 2 }),
        cue({ start: 2, end: 3 }),
        cue({ start: 3, end: 5 }),
        cue({ start: 4, end: 6 }),
    ];

    it('reports the next start before any cue', () => {
        expect(scanActiveCues(cues, 0.5)).toEqual({
            activeCues: [],
            nextBoundaryTime: 1,
        });
    });

    it('activates a cue at its start and ends it at its end, so back-to-back cues never overlap', () => {
        expect(scanActiveCues(cues, 1).activeCues.map((c) => c.start)).toEqual([
            1,
        ]);
        expect(scanActiveCues(cues, 2).activeCues.map((c) => c.start)).toEqual([
            2,
        ]);
        expect(scanActiveCues(cues, 2).nextBoundaryTime).toBe(3);
    });

    it('reports the earliest end while inside overlapping cues', () => {
        const scan = scanActiveCues(cues, 4.5);
        expect(scan.activeCues.map((c) => c.start)).toEqual([3, 4]);
        expect(scan.nextBoundaryTime).toBe(5);
    });

    it('has no boundary after the last cue', () => {
        expect(scanActiveCues(cues, 10).nextBoundaryTime).toBeNull();
    });
});

describe('placeBlock', () => {
    it('sends the automatic placement and the bottom band to the standard block, higher lines to their own', () => {
        expect(placeBlock(AUTO_PLACEMENT)).toBe(STANDARD_PLACEMENT);
        expect(placeBlock(BOTTOM)).toBe(STANDARD_PLACEMENT);
        expect(placeBlock({ line: 0.75, lineAlign: 'start' })).toBe(
            STANDARD_PLACEMENT
        );
        expect(placeBlock(TOP)).toEqual({
            kind: 'line',
            line: 0.15,
            lineAlign: 'start',
        });
    });

    it('keys lines authored a fraction apart into one block', () => {
        expect(blockKey(placeBlock(TOP))).toBe('start:3');
        expect(blockKey(placeBlock({ line: 0.1481, lineAlign: 'start' }))).toBe(
            'start:3'
        );
        expect(blockKey(placeBlock({ line: 0.15, lineAlign: 'end' }))).toBe(
            'end:3'
        );
        expect(blockKey(STANDARD_PLACEMENT)).toBe('standard');
    });

    it('tells placements apart by exact line within a bucket', () => {
        const top = placeBlock(TOP);
        expect(samePlacement(top, placeBlock({ ...TOP }))).toBe(true);
        expect(
            samePlacement(top, placeBlock({ line: 0.16, lineAlign: 'start' }))
        ).toBe(false);
        expect(samePlacement(top, STANDARD_PLACEMENT)).toBe(false);
        expect(samePlacement(STANDARD_PLACEMENT, placeBlock(BOTTOM))).toBe(
            true
        );
    });
});

describe('groupActiveCues', () => {
    it('groups by block, the standard block first and then from the top down, in cue order', () => {
        const top = cue({ start: 1, end: 2, placement: TOP, original: 'Sign' });
        const dialogue = cue({ start: 1, end: 2, original: 'Hi' });
        const raised = cue({
            start: 1.5,
            end: 2,
            placement: BOTTOM,
            original: 'There',
        });
        const middle = cue({
            start: 1,
            end: 2,
            placement: { line: 0.5, lineAlign: 'center' },
        });
        const groups = groupActiveCues([top, dialogue, middle, raised]);
        expect(groups.map((group) => group.key)).toEqual([
            'standard',
            'start:3',
            'center:10',
        ]);
        expect(groups[0]!.cues).toEqual([dialogue, raised]);
        expect(groups[1]!.placement).toEqual({
            kind: 'line',
            line: 0.15,
            lineAlign: 'start',
        });
    });
});

describe('groupActiveCues with official translations', () => {
    it('keeps a translation with the original it shares the most time with', () => {
        const raised = cue({
            start: 1,
            end: 3,
            placement: TOP,
            original: 'SIGN',
        });
        const dialogue = cue({ start: 2, end: 5, original: 'Hi' });
        const signTarget = cue({
            start: 1.1,
            end: 2.9,
            cueType: 'target',
            original: null,
            translated: '标志',
            useNativeTarget: true,
        });
        const dialogueTarget = cue({
            start: 2.2,
            end: 5,
            cueType: 'target',
            original: null,
            translated: '嗨',
            useNativeTarget: true,
        });
        const groups = groupActiveCues([
            raised,
            signTarget,
            dialogue,
            dialogueTarget,
        ]);
        expect(groups.map((group) => group.key)).toEqual([
            'standard',
            'start:3',
        ]);
        expect(groups[0]!.cues).toEqual([dialogue, dialogueTarget]);
        expect(groups[1]!.cues).toEqual([raised, signTarget]);
    });

    it('draws a translation with no active original at its own placement', () => {
        const target = cue({
            start: 1,
            end: 2,
            cueType: 'target',
            original: null,
            translated: '甲',
            useNativeTarget: true,
            placement: TOP,
        });
        expect(groupActiveCues([target]).map((group) => group.key)).toEqual([
            'start:3',
        ]);
    });
});

describe('composeBlockText', () => {
    it("stacks the cues' lines, translations from the cues or the target track", () => {
        const a = cue({ start: 1, end: 2, original: 'A', translated: '甲' });
        const b = cue({ start: 1.5, end: 2, original: 'B' });
        expect(composeBlockText([a, b])).toEqual({
            originalText: 'A\nB',
            translatedText: '甲',
        });
        const target = cue({
            start: 1,
            end: 2,
            cueType: 'target',
            original: null,
            translated: '乙',
            useNativeTarget: true,
        });
        expect(composeBlockText([b, target])).toEqual({
            originalText: 'B',
            translatedText: '乙',
        });
        expect(composeBlockText([])).toEqual({
            originalText: '',
            translatedText: '',
        });
    });
});
