import { describe, expect, it } from 'vitest';
import {
    AUTO_PLACEMENT,
    formatCueSettings,
    parseCueSettings,
    type CuePlacement,
} from './cuePlacement';

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
