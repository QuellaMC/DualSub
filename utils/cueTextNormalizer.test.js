import { describe, expect, test } from '@jest/globals';
import {
    normalizeCueLineEndings,
    normalizeCueText,
} from './cueTextNormalizer.js';

describe('normalizeCueText', () => {
    test.each([
        ['LF', 'first\nsecond'],
        ['CRLF', 'first\r\nsecond'],
        ['CR', 'first\rsecond'],
    ])(
        'normalizes %s cue line endings through the shared seam',
        (_label, raw) => {
            expect(normalizeCueLineEndings(raw)).toBe('first\nsecond');
        }
    );

    test('normalizes TTML elements and namespaced breaks into semantic lines', () => {
        const rawText = `
            <span>Alpha</span><tt:br/>Beta<br />Gamma
        `;

        expect(normalizeCueText(rawText, 'ttml')).toBe('Alpha\nBeta\nGamma');
    });

    test('decodes the XML entity set once while preserving non-XML names', () => {
        const rawText =
            '<span>Fish &amp; Chips</span> &lt;tag&gt; &gt; ' +
            '&quot;yes&quot; &apos;ok&apos; &nbsp; &amp;lt;';

        expect(normalizeCueText(rawText, 'ttml')).toBe(
            `Fish & Chips <tag> > "yes" 'ok' &nbsp; &lt;`
        );
    });

    test.each(['ttml', 'webvtt'])(
        'decodes only %s numeric entities that are valid Unicode scalar values',
        (sourceFormat) => {
            const rawText =
                'valid &#x1F600; &#169; invalid &#xD800; &#55296; ' +
                '&#x110000; &#999999999999999999999999; &#xZZ;';

            expect(normalizeCueText(rawText, sourceFormat)).toBe(
                'valid 😀 © invalid &#xD800; &#55296; ' +
                    '&#x110000; &#999999999999999999999999; &#xZZ;'
            );
        }
    );

    test.each(['ttml', 'webvtt'])(
        'decodes each %s entity token without reprocessing its replacement',
        (sourceFormat) => {
            const encodedText = [
                '&#38;lt;',
                '&#x26;lt;',
                '&amp;#x3C;',
                '&amp;lt;',
            ];

            expect(
                encodedText.map((text) => normalizeCueText(text, sourceFormat))
            ).toEqual(['&lt;', '&lt;', '&#x3C;', '&lt;']);
        }
    );

    test('normalizes supported WebVTT markup while preserving semantic line breaks and unsupported literals', () => {
        const rawText = `First line
Second<br/>third
<b>bold</b> <i>italic</i> <u>underlined</u> <c.emphasis>colored</c>
<v Speaker>voice</v> <lang en>language</lang> <ruby>base<rt>(reading)</rt></ruby> <00:00:01.000>timed literal <example> <script>alert(1)</script>`;

        expect(normalizeCueText(rawText, 'webvtt')).toBe(
            'First line\nSecond\nthird\nbold italic underlined colored\n' +
                'voice language base(reading) timed literal <example> <script>alert(1)</script>'
        );
    });

    test('decodes the WebVTT entity set once without reinterpreting encoded angle literals', () => {
        const rawText =
            'Fish &amp; Chips &lt;b&gt;literal&lt;/b&gt; ' +
            '&quot;yes&quot; &apos;ok&apos; A&nbsp;B&lrm;&rlm; &amp;lt;';

        expect(normalizeCueText(rawText, 'webvtt')).toBe(
            `Fish & Chips <b>literal</b> "yes" 'ok' A\u00a0B\u200e\u200f &lt;`
        );
    });

    test('rejects unsupported source formats with a fixed non-disclosing TypeError', () => {
        const hostileRawText = {
            toString() {
                throw new Error('raw text must not be coerced');
            },
        };
        const hostileSourceFormat = 'PRIVATE_<script>alert(1)</script>';

        expect(() =>
            normalizeCueText(hostileRawText, hostileSourceFormat)
        ).toThrow(new TypeError('Unsupported cue text source format'));

        try {
            normalizeCueText(hostileRawText, hostileSourceFormat);
        } catch (error) {
            expect(error.message).toBe('Unsupported cue text source format');
            expect(error.message).not.toContain(hostileSourceFormat);
        }
    });
});
