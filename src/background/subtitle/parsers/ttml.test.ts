import { describe, expect, it } from 'vitest';
import {
    convertTtmlToVtt,
    parseTtmlTimeToSeconds,
    TTMLConversionError,
} from './ttml';

const TTML_SAMPLE = `<?xml version="1.0"?>
<tt xmlns="http://www.w3.org/ns/ttml">
  <head>
    <layout>
      <region xml:id="topRegion" tts:origin="10% 10%"/>
      <region xml:id="bottomRegion" tts:origin="10% 80%"/>
    </layout>
  </head>
  <body>
    <div>
      <p begin="1000000t" end="20000000t" region="bottomRegion">Lower &amp;lt;line&amp;gt;</p>
      <p begin="1000000t" end="20000000t" region="topRegion">Upper <span>styled</span> line</p>
      <p begin="00:00:03.000" end="00:00:04.500">Second<br/>cue</p>
    </div>
  </body>
</tt>`;

describe('parseTtmlTimeToSeconds', () => {
    it.each([
        ['10000000t', 1],
        ['00:01:30.500', 90.5],
        ['01:00:00', 3600],
        ['2h', 7200],
        ['3m', 180],
        ['1.5s', 1.5],
        ['250ms', 0.25],
    ])('parses %s as %d seconds', (input, expected) => {
        expect(parseTtmlTimeToSeconds(input)).toBeCloseTo(expected, 6);
    });

    it.each([['garbage'], ['00:99:00'], ['00:00:75'], ['5x']])(
        'yields NaN for %s',
        (input) => {
            expect(Number.isNaN(parseTtmlTimeToSeconds(input))).toBe(true);
        }
    );
});

describe('convertTtmlToVtt', () => {
    it('merges same-timestamp cues top-to-bottom by region and strips markup', () => {
        const vtt = convertTtmlToVtt(TTML_SAMPLE);
        expect(vtt.startsWith('WEBVTT\n\n')).toBe(true);
        expect(vtt).toContain('00:00:00.100 --> 00:00:02.000');
        // Region-sorted: upper region text before lower, in one merged cue,
        // entities decoded once and re-encoded for the VTT transport.
        expect(vtt).toContain('Upper styled line Lower &amp;lt;line&amp;gt;');
        expect(vtt).toContain('00:00:03.000 --> 00:00:04.500');
        expect(vtt).toContain('Second\ncue');
    });

    it('rejects empty input, invalid timestamps, and inverted ranges', () => {
        expect(() => convertTtmlToVtt('   ')).toThrow(TTMLConversionError);
        expect(() => convertTtmlToVtt('<tt><body></body></tt>')).toThrow(
            'No valid TTML subtitle entries'
        );
        expect(() =>
            convertTtmlToVtt('<tt><p begin="bogus" end="1s">x</p></tt>')
        ).toThrow('Unsupported TTML timestamp');
        expect(() =>
            convertTtmlToVtt('<tt><p begin="2s" end="1s">x</p></tt>')
        ).toThrow('Invalid TTML cue range');
    });
});
