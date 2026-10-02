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

    it('maps snap-to-lines rows from the top or the bottom', () => {
        expectPlacement(parseCueSettings('line:0'), 0, 'start');
        expectPlacement(parseCueSettings('line:2'), 0.12, 'start');
        expectPlacement(parseCueSettings('line:-1'), 1, 'end');
        expectPlacement(parseCueSettings('line:-3'), 0.88, 'end');
    });

    it('is the automatic placement without a usable line', () => {
        expect(parseCueSettings('')).toBe(AUTO_PLACEMENT);
        expect(parseCueSettings('align:middle size:80%')).toBe(AUTO_PLACEMENT);
        expect(parseCueSettings('line:auto')).toBe(AUTO_PLACEMENT);
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
