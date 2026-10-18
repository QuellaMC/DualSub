import { describe, expect, it } from 'vitest';
import { AUTO_PLACEMENT } from '@/shared/cuePlacement';
import {
    composeBlockText,
    groupActiveCues,
    scanActiveCues,
} from '../renderer/cueSelect';
import { buildCueSet, type CueSet } from './cueModel';
import { parseTimestampToSeconds, parseVtt } from './vtt';

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
        const set = buildCueSet(
            {
                ...base,
                vttText: 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nA',
                targetVttText: null,
                useNativeTarget: false,
            },
            false
        );
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
                pairedWith: [],
            },
        ]);
    });

    it('interleaves original and target cues sorted by start in native mode, each with its placement', () => {
        const set = buildCueSet(
            {
                ...base,
                vttText:
                    'WEBVTT\n\n00:00:05.000 --> 00:00:06.000 line:15%,start\nA',
                targetVttText: 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n甲',
                useNativeTarget: true,
            },
            false
        );
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
        const set = buildCueSet(
            {
                ...base,
                vttText: 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nA',
                targetVttText: 'garbage',
                useNativeTarget: true,
            },
            false
        );
        expect(set.useNativeTarget).toBe(false);
        expect(set.cues).toHaveLength(1);
    });
});

describe('buildCueSet pairing the show’s own translation', () => {
    const base = {
        success: true as const,
        sourceLanguage: 'ja',
        targetLanguage: 'en',
        selectedLanguage: { normalizedCode: 'ja', displayName: '日本語' },
        useNativeTarget: true,
    };

    function vtt(...lines: readonly [string, string, string][]): string {
        return [
            'WEBVTT',
            ...lines.map(
                ([start, end, text]) =>
                    `00:00:${start} --> 00:00:${end}\n${text}`
            ),
        ].join('\n\n');
    }

    function paired(vttText: string, targetVttText: string): CueSet {
        return buildCueSet({ ...base, vttText, targetVttText }, true);
    }

    /** Each block on screen at `time`: its original lines and its
     *  translation lines. */
    function shownAt(set: CueSet, time: number): [string, string][] {
        return groupActiveCues(scanActiveCues(set.cues, time).activeCues).map(
            (group) => {
                const text = composeBlockText(group.cues);
                return [text.originalText, text.translatedText];
            }
        );
    }

    it('shows each official line with the original it belongs with, for as long as the original shows', () => {
        const set = paired(
            vtt(
                ['10.000', '12.000', 'どこに行くの？'],
                ['12.400', '14.000', '駅まで。']
            ),
            vtt(
                ['09.600', '11.200', 'Where are you going?'],
                ['11.200', '13.500', 'To the station.']
            )
        );
        expect(shownAt(set, 9.8)).toEqual([]);
        expect(shownAt(set, 11.5)).toEqual([
            ['どこに行くの？', 'Where are you going?'],
        ]);
        expect(shownAt(set, 12.2)).toEqual([]);
        expect(shownAt(set, 13.8)).toEqual([['駅まで。', 'To the station.']]);
    });

    it('shows a long official line under both originals it covers, and not in a pause between them', () => {
        const set = paired(
            vtt(
                ['10.000', '12.000', 'どこに'],
                ['13.000', '15.000', '行くの？']
            ),
            vtt(['10.000', '15.000', 'Where are you going?'])
        );
        expect(shownAt(set, 11)).toEqual([['どこに', 'Where are you going?']]);
        expect(shownAt(set, 12.5)).toEqual([]);
        expect(shownAt(set, 14)).toEqual([
            ['行くの？', 'Where are you going?'],
        ]);
    });

    it('holds the first of two originals through the short gap before the second while one official line spans both, paired or not', () => {
        const originals = vtt(
            ['10.000', '12.000', 'どこに'],
            ['12.083', '14.000', '行くの？']
        );
        const official = vtt(['10.000', '14.000', 'Where are you going?']);
        for (const pairOfficial of [true, false]) {
            const set = buildCueSet(
                { ...base, vttText: originals, targetVttText: official },
                pairOfficial
            );
            expect(shownAt(set, 12.04)).toEqual([
                ['どこに', 'Where are you going?'],
            ]);
            expect(shownAt(set, 12.1)).toEqual([
                ['行くの？', 'Where are you going?'],
            ]);
        }
    });

    it('holds the first of two official lines through the short gap before the second while one original spans both', () => {
        const set = buildCueSet(
            {
                ...base,
                vttText: vtt(['10.000', '14.000', 'どこに行くの？駅まで。']),
                targetVttText: vtt(
                    ['10.000', '12.000', 'Where are you going?'],
                    ['12.083', '14.000', 'To the station.']
                ),
            },
            false
        );
        expect(shownAt(set, 12.04)).toEqual([
            ['どこに行くの？駅まで。', 'Where are you going?'],
        ]);
        expect(shownAt(set, 12.1)).toEqual([
            ['どこに行くの？駅まで。', 'To the station.'],
        ]);
    });

    it('shows an official line once while the two originals it belongs with hand over', () => {
        const set = paired(
            vtt(
                ['10.000', '12.100', 'どこに'],
                ['12.000', '14.000', '行くの？']
            ),
            vtt(['10.000', '14.000', 'Where are you going?'])
        );
        expect(shownAt(set, 11)).toEqual([['どこに', 'Where are you going?']]);
        expect(shownAt(set, 12.05)).toEqual([
            ['どこに\n行くの？', 'Where are you going?'],
        ]);
        expect(shownAt(set, 13)).toEqual([
            ['行くの？', 'Where are you going?'],
        ]);
    });

    it('gives each of two originals on screen together only the official line that matches its time', () => {
        const set = buildCueSet(
            {
                ...base,
                vttText: [
                    'WEBVTT',
                    '00:00:10.000 --> 00:00:14.000 line:15%,start\n3番線',
                    '00:00:11.000 --> 00:00:13.000\nどこに行くの？',
                ].join('\n\n'),
                targetVttText: [
                    'WEBVTT',
                    '00:00:10.000 --> 00:00:14.000 line:15%,start\nPLATFORM 3',
                    '00:00:11.000 --> 00:00:13.000\nWhere are you going?',
                ].join('\n\n'),
            },
            true
        );
        expect(shownAt(set, 12)).toEqual([
            ['どこに行くの？', 'Where are you going?'],
            ['3番線', 'PLATFORM 3'],
        ]);
    });

    it('tells apart a sign and dialogue timed alike by where each is drawn', () => {
        const set = buildCueSet(
            {
                ...base,
                vttText: [
                    'WEBVTT',
                    '00:00:10.000 --> 00:00:14.000 line:15%,start\n3番線',
                    '00:00:10.000 --> 00:00:14.000\nどこに行くの？',
                ].join('\n\n'),
                targetVttText: [
                    'WEBVTT',
                    '00:00:10.000 --> 00:00:14.000\nWhere are you going?',
                    '00:00:10.000 --> 00:00:14.000 line:10%,start\nPLATFORM 3',
                ].join('\n\n'),
            },
            true
        );
        expect(shownAt(set, 12)).toEqual([
            ['どこに行くの？', 'Where are you going?'],
            ['3番線', 'PLATFORM 3'],
        ]);
    });

    it('lets clearly different timing outweigh where a line is drawn', () => {
        const set = buildCueSet(
            {
                ...base,
                vttText: [
                    'WEBVTT',
                    '00:00:10.000 --> 00:00:14.000 line:15%,start\n3番線',
                    '00:00:11.000 --> 00:00:13.000\nどこに行くの？',
                ].join('\n\n'),
                targetVttText:
                    'WEBVTT\n\n00:00:10.000 --> 00:00:14.000\nPLATFORM 3',
            },
            true
        );
        expect(shownAt(set, 12)).toEqual([
            ['どこに行くの？', ''],
            ['3番線', 'PLATFORM 3'],
        ]);
    });

    it('tells apart two signs timed alike by how near each official line sits', () => {
        const set = buildCueSet(
            {
                ...base,
                vttText: [
                    'WEBVTT',
                    '00:00:10.000 --> 00:00:14.000 line:10%,start\n3番線',
                    '00:00:10.000 --> 00:00:14.000 line:50%,center\n出口',
                ].join('\n\n'),
                targetVttText: [
                    'WEBVTT',
                    '00:00:10.000 --> 00:00:14.000 line:45%,center\nEXIT',
                    '00:00:10.000 --> 00:00:14.000 line:15%,start\nPLATFORM 3',
                ].join('\n\n'),
            },
            true
        );
        expect(shownAt(set, 12)).toEqual([
            ['3番線', 'PLATFORM 3'],
            ['出口', 'EXIT'],
        ]);
    });

    it('tells apart two signs on one line by which edge meets it', () => {
        const set = buildCueSet(
            {
                ...base,
                vttText: [
                    'WEBVTT',
                    '00:00:10.000 --> 00:00:14.000 line:50%,end\n東京駅',
                    '00:00:10.000 --> 00:00:14.000 line:50%,start\n出口',
                ].join('\n\n'),
                targetVttText: [
                    'WEBVTT',
                    '00:00:10.000 --> 00:00:14.000 line:50%,start\nEXIT',
                    '00:00:10.000 --> 00:00:14.000 line:50%,end\nTOKYO STATION',
                ].join('\n\n'),
            },
            true
        );
        expect(shownAt(set, 12)).toEqual([
            ['東京駅', 'TOKYO STATION'],
            ['出口', 'EXIT'],
        ]);
    });

    it('joins, in order, the official lines that fall within one original', () => {
        const set = paired(
            vtt(['10.000', '14.000', 'どこに行くの？駅まで。']),
            vtt(
                ['10.000', '12.000', 'Where are you going?'],
                ['12.000', '14.000', 'To the station.']
            )
        );
        const both: [string, string][] = [
            ['どこに行くの？駅まで。', 'Where are you going?\nTo the station.'],
        ];
        expect(shownAt(set, 10.5)).toEqual(both);
        expect(shownAt(set, 13.5)).toEqual(both);
    });

    it('pairs tracks listed out of time order, joining lines as they are spoken', () => {
        const set = paired(
            vtt(
                ['20.000', '22.000', 'またね。'],
                ['10.000', '14.000', 'どこに行くの？駅まで。']
            ),
            vtt(
                ['12.000', '14.000', 'To the station.'],
                ['20.000', '22.000', 'See you.'],
                ['10.000', '12.000', 'Where are you going?']
            )
        );
        expect(shownAt(set, 11)).toEqual([
            ['どこに行くの？駅まで。', 'Where are you going?\nTo the station.'],
        ]);
        expect(shownAt(set, 21)).toEqual([['またね。', 'See you.']]);
    });

    it('leaves an official line that belongs with no original on its own timing', () => {
        const set = paired(
            vtt(['10.000', '12.000', 'どこに行くの？']),
            vtt(
                ['11.800', '15.000', 'To the station.'],
                ['20.000', '21.000', 'PLATFORM 3']
            )
        );
        expect(
            set.cues.map((cue) => [cue.id, cue.cueType, cue.pairedWith])
        ).toEqual([
            ['o0', 'original', []],
            ['t0', 'target', []],
            ['t1', 'target', []],
        ]);
        expect(shownAt(set, 13)).toEqual([['', 'To the station.']]);
        expect(shownAt(set, 20.5)).toEqual([['', 'PLATFORM 3']]);
    });

    it('draws both tracks on their own timing while pairing is off', () => {
        const set = buildCueSet(
            {
                ...base,
                vttText: vtt(['10.000', '12.000', 'どこに行くの？']),
                targetVttText: vtt([
                    '09.600',
                    '11.200',
                    'Where are you going?',
                ]),
            },
            false
        );
        expect(
            set.cues.map((cue) => [cue.id, cue.cueType, cue.translated])
        ).toEqual([
            ['t0', 'target', 'Where are you going?'],
            ['o0', 'original', null],
        ]);
        expect(shownAt(set, 9.8)).toEqual([['', 'Where are you going?']]);
    });
});
