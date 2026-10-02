import { describe, expect, it } from 'vitest';
import { AUTO_PLACEMENT } from '@/shared/cuePlacement';
import { parseTimestampToSeconds, parseVtt } from './vtt';
import { buildCueSet } from './cueModel';

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

describe('buildCueSet', () => {
    const base = {
        success: true as const,
        sourceLanguage: 'en',
        targetLanguage: 'zh-CN',
        selectedLanguage: { normalizedCode: 'en', displayName: 'English' },
    };

    it('builds translate-mode cues with empty translations', () => {
        const set = buildCueSet({
            ...base,
            vttText: 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nA',
            targetVttText: null,
            useNativeTarget: false,
        });
        expect(set.useNativeTarget).toBe(false);
        expect(set.cues).toEqual([
            {
                id: 'o0',
                start: 1,
                end: 2,
                cueType: 'original',
                original: 'A',
                translated: null,
                useNativeTarget: false,
                placement: AUTO_PLACEMENT,
            },
        ]);
    });

    it('interleaves original and target cues sorted by start in native mode, each with its placement', () => {
        const set = buildCueSet({
            ...base,
            vttText:
                'WEBVTT\n\n00:00:05.000 --> 00:00:06.000 line:15%,start\nA',
            targetVttText: 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n甲',
            useNativeTarget: true,
        });
        expect(set.useNativeTarget).toBe(true);
        expect(set.cues.map((cue) => cue.id)).toEqual(['t0', 'o0']);
        expect(set.cues[0]).toMatchObject({
            cueType: 'target',
            translated: '甲',
            placement: AUTO_PLACEMENT,
        });
        expect(set.cues[1]).toMatchObject({
            placement: { line: 0.15, lineAlign: 'start' },
        });
    });

    it('falls back to translate mode when the native target parses to nothing', () => {
        const set = buildCueSet({
            ...base,
            vttText: 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nA',
            targetVttText: 'garbage',
            useNativeTarget: true,
        });
        expect(set.useNativeTarget).toBe(false);
        expect(set.cues).toHaveLength(1);
    });
});
