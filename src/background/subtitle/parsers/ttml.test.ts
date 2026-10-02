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
    it('keeps each paragraph as its own cue, its region as the line setting, and strips markup', () => {
        expect(convertTtmlToVtt(TTML_SAMPLE)).toBe(
            [
                'WEBVTT',
                '',
                '00:00:00.100 --> 00:00:02.000 line:80%,start',
                // Entities decoded once and re-encoded for the VTT transport.
                'Lower &amp;lt;line&amp;gt;',
                '',
                '00:00:00.100 --> 00:00:02.000 line:10%,start',
                'Upper styled line',
                '',
                '00:00:03.000 --> 00:00:04.500',
                'Second\ncue',
                '',
                '',
            ].join('\n')
        );
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

const NETFLIX_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ttp:tickRate="10000000">
  <head>
    <styling>
      <style xml:id="box" tts:origin="10% 10%" tts:extent="80% 80%"/>
      <style xml:id="raised" style="box" tts:displayAlign="before"/>
    </styling>
    <layout>
      <region xml:id="styledTop" style="raised"/>
      <region xml:id="topCenter" tts:origin="10.00% 10.00%" tts:extent="80.00% 80.00%" tts:displayAlign="before"/>
      <region xml:id="bottomCenter" tts:origin="10.00% 10.00%" tts:extent="80.00% 80.00%" tts:displayAlign="after"/>
      <region xml:id="middle" tts:origin="10% 10%" tts:extent="80% 80%" tts:displayAlign="center"/>
      <region xml:id="unplaced"/>
      <region xml:id="pixels" tts:origin="100px 100px" tts:extent="400px 50px" tts:displayAlign="before"/>
    </layout>
  </head>
  <body>
    <div region="bottomCenter">
      <p begin="10000000t" end="30000000t">Dialogue</p>
      <p begin="20000000t" end="40000000t" region="topCenter">SIGN</p>
      <p begin="50000000t" end="60000000t" region="middle">Center</p>
    </div>
    <div>
      <p begin="70000000t" end="80000000t" region="unplaced">Free</p>
      <p begin="90000000t" end="100000000t" region="styledTop">Styled</p>
      <p begin="110000000t" end="120000000t" region="pixels">Pixels</p>
    </div>
  </body>
</tt>`;

describe('convertTtmlToVtt (Netflix regions)', () => {
    it('anchors on the edge displayAlign names, inherits the region of the enclosing div, resolves region styles, and places only percentage boxes', () => {
        const vtt = convertTtmlToVtt(NETFLIX_SAMPLE);
        expect(vtt).toContain(
            '00:00:01.000 --> 00:00:03.000 line:90%,end\nDialogue'
        );
        expect(vtt).toContain(
            '00:00:02.000 --> 00:00:04.000 line:10%,start\nSIGN'
        );
        expect(vtt).toContain(
            '00:00:05.000 --> 00:00:06.000 line:50%,center\nCenter'
        );
        expect(vtt).toContain('00:00:07.000 --> 00:00:08.000\nFree');
        expect(vtt).toContain(
            '00:00:09.000 --> 00:00:10.000 line:10%,start\nStyled'
        );
        expect(vtt).toContain('00:00:11.000 --> 00:00:12.000\nPixels');
    });
});

const IMSC_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ttp:tickRate="90000" xml:lang="ja">
  <head>
    <styling>
      <style xml:id="rubyContainer" tts:ruby="container"/>
      <style xml:id="rubyBase" tts:ruby="base"/>
      <style xml:id="rubyText" tts:ruby="text"/>
    </styling>
    <layout>
      <region xml:id="r1" tts:origin="10% 80%"/>
    </layout>
  </head>
  <body>
    <div>
      <p begin="90000t" dur="180000t" region="r1"><span style="rubyContainer"><span style="rubyBase">漢字</span><span style="rubyText">かんじ</span></span>です</p>
    </div>
    <div>
      <p begin="360000t" end="450000t">Second<br/>line <span tts:ruby="text">rt</span>base</p>
    </div>
  </body>
</tt>`;

describe('convertTtmlToVtt (IMSC 1.1)', () => {
    it('honors the declared tick rate, dur, dropped ruby readings, and multiple divs', () => {
        const vtt = convertTtmlToVtt(IMSC_SAMPLE);
        expect(vtt).toContain(
            '00:00:01.000 --> 00:00:03.000 line:80%,start\n漢字です'
        );
        expect(vtt).toContain(
            '00:00:04.000 --> 00:00:05.000\nSecond\nline base'
        );
    });

    it('parses ticks against a custom tick rate', () => {
        expect(parseTtmlTimeToSeconds('90000t', 90_000)).toBe(1);
        expect(parseTtmlTimeToSeconds('10000000t')).toBe(1);
    });
});
