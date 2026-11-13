import { describe, expect, it } from 'vitest';
import { AUTO_PLACEMENT } from './cuePlacement';
import {
    formatVtt,
    parseTimestampToSeconds,
    parseVtt,
    type VttCue,
} from './vtt';

const SAMPLE = [
    'WEBVTT',
    '',
    'STYLE',
    '::cue() { font-family: Arial; }',
    '',
    '1',
    '00:00:01.000 --> 00:00:02.500 align:middle',
    'Hello <i>there</i>',
    'second line',
    '',
    '00:00:03.000 --> 00:00:04.000 line:85.19%,end',
    '[crowd cheering]',
    '',
    '00:00:05.000 --> 00:00:06.000 line:14.81%,start',
    '<i>Tonight, President Ross</i>',
    '',
    '00:01:05.250 --> 00:01:06.000',
    'Caf&eacute; &amp; bar',
    '',
    'NOTE this block has no arrow',
    '',
    '01:00:00.000 --> 01:00:01.000',
    'Late cue',
    '',
    '00:00:09.000 --> 00:00:08.000',
    'Inverted (dropped)',
].join('\r\n');

describe('parseVtt', () => {
    it('parses cues with optional ids, settings, markup, entities, and CRLF', () => {
        const cues = parseVtt(SAMPLE);
        expect(
            cues.map(({ start, end, text }) => ({ start, end, text }))
        ).toEqual([
            { start: 1, end: 2.5, text: 'Hello there\nsecond line' },
            { start: 3, end: 4, text: '[crowd cheering]' },
            { start: 5, end: 6, text: 'Tonight, President Ross' },
            { start: 65.25, end: 66, text: 'Caf&eacute; & bar' },
            { start: 3600, end: 3601, text: 'Late cue' },
        ]);
    });

    it("keeps the platforms' line placement and treats other settings as automatic", () => {
        const [first, cheering, tonight, ...rest] = parseVtt(SAMPLE);
        expect(first!.placement).toBe(AUTO_PLACEMENT);
        expect(cheering!.placement.line).toBeCloseTo(0.8519, 6);
        expect(cheering!.placement.lineAlign).toBe('end');
        expect(tonight!.placement.line).toBeCloseTo(0.1481, 6);
        expect(tonight!.placement.lineAlign).toBe('start');
        expect(rest.map((cue) => cue.placement)).toEqual([
            AUTO_PLACEMENT,
            AUTO_PLACEMENT,
        ]);
    });

    it('rejects input without a WEBVTT header', () => {
        expect(parseVtt('00:00:01.000 --> 00:00:02.000\nx')).toEqual([]);
    });

    it.each([
        ['00:00:01.000', 1],
        ['12:34:56.789', 45296.789],
        ['00:00.000', 0],
        ['00:60:00.000', null],
        ['1:00:00.000', null],
    ])('parseTimestampToSeconds(%s)', (input, expected) => {
        expect(parseTimestampToSeconds(input)).toBe(expected);
    });
});

describe('formatVtt', () => {
    it('writes cues that parseVtt reads back as written', () => {
        const cues: VttCue[] = [
            {
                start: 1.5,
                end: 3,
                text: 'Fish & <chips>\nsecond line',
                placement: AUTO_PLACEMENT,
            },
            {
                start: 3725.007,
                end: 3726,
                text: 'Over the sign',
                placement: { line: 0.15, lineAlign: 'start' },
            },
        ];
        const vtt = formatVtt(cues);
        expect(vtt).toContain('01:02:05.007 --> 01:02:06.000 line:15%,start');
        expect(vtt).toContain('Fish &amp; &lt;chips&gt;');
        expect(parseVtt(vtt)).toEqual(cues);
    });

    it('leaves out blank lines, which would end the cue', () => {
        const [cue] = parseVtt(
            formatVtt([
                {
                    start: 0,
                    end: 1,
                    text: 'top\n\nbottom',
                    placement: AUTO_PLACEMENT,
                },
            ])
        );
        expect(cue!.text).toBe('top\nbottom');
    });
});
