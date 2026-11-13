import { describe, expect, it } from 'vitest';
import {
    AUTO_PLACEMENT,
    blockKey,
    formatCueSettings,
    mayJoin,
    parseCueSettings,
    placeBlock,
    STANDARD_PLACEMENT,
    type CuePlacement,
} from './cuePlacement';

const TOP: CuePlacement = { line: 0.15, lineAlign: 'start' };
const BOTTOM: CuePlacement = { line: 0.85, lineAlign: 'end' };

function expectPlacement(
    placement: CuePlacement,
    line: number,
    lineAlign: CuePlacement['lineAlign']
): void {
    expect(placement.line).toBeCloseTo(line, 6);
    expect(placement.lineAlign).toBe(lineAlign);
}

describe('parseCueSettings', () => {
    it("reads the platforms' percentage lines with their alignment", () => {
        expectPlacement(parseCueSettings('line:85.19%,end'), 0.8519, 'end');
        expectPlacement(
            parseCueSettings('position:50% line:15%,start align:center'),
            0.15,
            'start'
        );
        expectPlacement(parseCueSettings('line:40%'), 0.4, 'start');
        expectPlacement(parseCueSettings('line:150%'), 1, 'start');
    });

    it('is the automatic placement without a percentage line', () => {
        expect(parseCueSettings('')).toBe(AUTO_PLACEMENT);
        expect(parseCueSettings('align:middle size:80%')).toBe(AUTO_PLACEMENT);
        expect(parseCueSettings('line:auto')).toBe(AUTO_PLACEMENT);
        // Snap-to-lines rows are multiples of a line height the model does
        // not describe.
        expect(parseCueSettings('line:2')).toBe(AUTO_PLACEMENT);
        expect(parseCueSettings('line:-1,end')).toBe(AUTO_PLACEMENT);
    });
});

describe('formatCueSettings', () => {
    it('round-trips through parseCueSettings', () => {
        const placement: CuePlacement = { line: 0.1481, lineAlign: 'start' };
        expect(formatCueSettings(placement)).toBe('line:14.81%,start');
        expectPlacement(
            parseCueSettings(formatCueSettings(placement)),
            0.1481,
            'start'
        );
        expect(formatCueSettings(AUTO_PLACEMENT)).toBe('');
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

    it('keys a block by its exact line', () => {
        expect(blockKey(placeBlock(TOP))).toBe('start:0.15');
        expect(blockKey(placeBlock({ line: 0.15, lineAlign: 'end' }))).toBe(
            'end:0.15'
        );
        expect(blockKey(STANDARD_PLACEMENT)).toBe('standard');
    });
});

describe('mayJoin', () => {
    it('keeps a raised translation out of dialogue, and lets one in the dialogue band join a raised original', () => {
        expect(mayJoin(TOP, BOTTOM)).toBe(false);
        expect(mayJoin(TOP, AUTO_PLACEMENT)).toBe(false);
        expect(mayJoin(TOP, { line: 0.5, lineAlign: 'center' })).toBe(true);
        expect(mayJoin(BOTTOM, TOP)).toBe(true);
        expect(mayJoin(AUTO_PLACEMENT, BOTTOM)).toBe(true);
    });
});
