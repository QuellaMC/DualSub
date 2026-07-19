import { ttmlParser } from '../../background/parsers/ttmlParser.js';
import {
    clearSubtitleDOM,
    clearSubtitlesDisplayAndQueue,
    formatSubtitleTextForDisplay,
    handleSubtitleDataFound,
    originalSubtitleElement,
    parseTimestampToSeconds,
    parseVTT,
    setCurrentVideoId,
    setSubtitlesActive,
    subtitleQueue,
    translatedSubtitleElement,
    updateSubtitles,
} from '../shared/subtitleUtilities.js';

describe('WebVTT cue boundary', () => {
    test.each([
        ['00:00:00.000', 0],
        ['01:02:03.456', 3723.456],
        ['02:03.250', 123.25],
    ])('accepts the supported WebVTT timestamp %s', (timestamp, seconds) => {
        expect(parseTimestampToSeconds(timestamp)).toBe(seconds);
    });

    test('reports a malformed timestamp as invalid instead of time zero', () => {
        expect(parseTimestampToSeconds('not-a-timestamp')).toBeNull();
    });

    test.each([
        ['LF with single spaces', '\n', ' ', ' ', ' ', ' '],
        ['CRLF with repeated spaces', '\r\n', '  ', '   ', '  ', '   '],
        ['CR with tabs', '\r', '\t', '\t', '\t', '\t'],
        ['mixed horizontal whitespace', '\n', ' \t', '\t ', '\t ', ' \t'],
    ])(
        'accepts %s around the cue delimiter and settings',
        (
            _label,
            lineEnding,
            beforeArrow,
            afterArrow,
            beforeSettings,
            betweenSettings
        ) => {
            const timing =
                `00:00:00.000${beforeArrow}-->${afterArrow}` +
                `00:00:01.000${beforeSettings}align:start` +
                `${betweenSettings}position:50%`;
            const vtt = ['WEBVTT', '', 'cue-1', timing, 'first', 'second'].join(
                lineEnding
            );

            expect(parseVTT(vtt)).toEqual([
                { start: 0, end: 1, text: 'first\nsecond' },
            ]);
        }
    );

    test.each([
        ['missing whitespace before arrow', '00:00:00.000--> 00:00:01.000'],
        ['missing whitespace after arrow', '00:00:00.000 -->00:00:01.000'],
        ['malformed start', 'bad\t-->\t00:00:01.000 align:start'],
        ['malformed end', '00:00:00.000\t-->\tbad\talign:start'],
        ['non-finite start', `${'9'.repeat(400)}:00:00.000 --> 00:00:01.000`],
        ['non-finite end', `00:00:00.000 --> ${'9'.repeat(400)}:00:00.000`],
        ['equal range', '00:00:01.000 --> 00:00:01.000'],
        ['reversed range', '00:00:02.000 --> 00:00:01.000'],
        [
            'multiple delimiters',
            '00:00:00.000 --> 00:00:01.000 --> 00:00:02.000',
        ],
    ])('rejects %s', (_label, timing) => {
        expect(parseVTT(`WEBVTT\n\n${timing}\ninvalid`)).toEqual([]);
    });

    test.each([
        '00:60:00.000',
        '00:00:60.000',
        '60:00.000',
        '00:00:01',
        '00:00:01.00',
        '00:00:01.000junk',
        'Infinity',
        '1e309',
        `${'9'.repeat(400)}:00:00.000`,
    ])('rejects an invalid or non-finite timestamp: %s', (timestamp) => {
        expect(parseTimestampToSeconds(timestamp)).toBeNull();
    });

    test('skips a cue whose timestamp is malformed', () => {
        const vtt = `WEBVTT

bad --> 00:00:02.000
must not enter the queue`;

        expect(parseVTT(vtt)).toEqual([]);
    });

    test('keeps a zero-start cue but skips equal and reversed ranges', () => {
        const vtt = `WEBVTT

00:00:00.000 --> 00:00:01.000
valid zero start

00:00:02.000 --> 00:00:02.000
equal

00:00:04.000 --> 00:00:03.000
reversed`;

        expect(parseVTT(vtt)).toEqual([
            { start: 0, end: 1, text: 'valid zero start' },
        ]);
    });

    test('decodes direct WebVTT entities into semantic cue text exactly once', () => {
        const vtt = `WEBVTT

00:00:00.000 --> 00:00:01.000
Fish &amp; Chips &lt;tag&gt;`;

        const cues = parseVTT(vtt);
        expect(cues).toEqual([
            { start: 0, end: 1, text: 'Fish & Chips <tag>' },
        ]);

        const rendered = document.createElement('div');
        rendered.innerHTML = formatSubtitleTextForDisplay(cues[0].text);
        expect(rendered.innerHTML).toBe('Fish &amp; Chips &lt;tag&gt;');
        expect(rendered.textContent).toBe('Fish & Chips <tag>');
    });

    test('keeps script-like VTT text inert at the renderer boundary', () => {
        const vtt = `WEBVTT

00:00:00.000 --> 00:00:01.000
<script>alert(1)</script>`;
        const [cue] = parseVTT(vtt);
        const rendered = document.createElement('div');

        rendered.innerHTML = formatSubtitleTextForDisplay(cue.text);

        expect(cue.text).toBe('<script>alert(1)</script>');
        expect(rendered.textContent).toBe('<script>alert(1)</script>');
        expect(rendered.querySelector('script')).toBeNull();
    });

    test('preserves an out-of-range numeric entity as inert cue text', () => {
        const vtt = `WEBVTT

00:00:00.000 --> 00:00:01.000
invalid &#x110000; entity`;

        expect(parseVTT(vtt)[0].text).toBe('invalid &#x110000; entity');
    });

    test('preserves cue line breaks and removes only supported VTT formatting tags', () => {
        const vtt = `WEBVTT

00:00:00.000 --> 00:00:02.000
First line
Second<br/>third
<b>bold</b> <i>italic</i> <u>underlined</u> <c.emphasis>colored</c>
<v Speaker>voice</v> <lang en>language</lang> <ruby>base<rt>(reading)</rt></ruby> <00:00:01.000>timed literal <example>`;

        expect(parseVTT(vtt)[0].text).toBe(
            'First line\nSecond\nthird\nbold italic underlined colored\nvoice language base(reading) timed literal <example>'
        );
    });
});

describe('TTML to subtitle DOM text', () => {
    const videoId = 'text-pipeline-video';
    const config = {
        originalLanguage: 'en',
        targetLanguage: 'zh-CN',
        subtitleTimeOffset: 0,
        subtitleFontSize: 2.5,
        subtitleGap: 0,
        subtitleLayoutOrder: 'original_top',
        subtitleLayoutOrientation: 'column',
        subtitleVerticalPosition: 2.8,
    };

    beforeEach(() => {
        document.body.replaceChildren();
        clearSubtitleDOM();
        setSubtitlesActive(true);
        setCurrentVideoId(videoId);
        clearSubtitlesDisplayAndQueue(null, true);
    });

    afterEach(() => {
        clearSubtitleDOM();
        clearSubtitlesDisplayAndQueue(null, true);
        document.body.replaceChildren();
    });

    test('keeps TTML literals and breaks as inert semantic text through queue and DOM', () => {
        const video = document.createElement('video');
        Object.defineProperties(video, {
            currentTime: { configurable: true, value: 0.5 },
            readyState: { configurable: true, value: 4 },
            HAVE_CURRENT_DATA: { configurable: true, value: 2 },
        });
        document.body.appendChild(video);
        const platform = {
            getCurrentVideoId: () => videoId,
            getPlaybackTime: () => 0.5,
            getVideoElement: () => video,
            getPlayerContainerElement: () => document.body,
            isPlayerPageActive: () => true,
            supportsProgressBarTracking: () => false,
        };
        const vttText = ttmlParser.convertTtmlToVtt(`
            <tt:tt xmlns:tt="urn:tt"><tt:body><tt:div>
                <tt:p begin="0s" end="1s">&lt;script&gt;alert(1)&lt;/script&gt;<tt:br/>Fish &amp; Chips<tt:br/>&lt;tag&gt;</tt:p>
            </tt:div></tt:body></tt:tt>`);

        handleSubtitleDataFound(
            {
                videoId,
                vttText,
                targetVttText:
                    'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\ntranslation',
                useNativeTarget: true,
                sourceLanguage: 'en',
                targetLanguage: 'zh-CN',
                selectedLanguage: {
                    normalizedCode: 'en',
                    displayName: 'English',
                },
            },
            platform,
            config,
            'TextPipelineTest'
        );

        const semanticText = '<script>alert(1)</script>\nFish & Chips\n<tag>';
        expect(
            subtitleQueue.find((cue) => cue.cueType === 'original').original
        ).toBe(semanticText);
        expect(originalSubtitleElement.textContent).toBe(semanticText);
        expect(originalSubtitleElement.querySelector('script')).toBeNull();
        expect(originalSubtitleElement.style.whiteSpace).toBe('pre-line');
    });

    test('keeps TTML transport and direct WebVTT semantically identical through queue and DOM', () => {
        const video = document.createElement('video');
        Object.defineProperties(video, {
            currentTime: { configurable: true, value: 0.5 },
            readyState: { configurable: true, value: 4 },
            HAVE_CURRENT_DATA: { configurable: true, value: 2 },
        });
        document.body.appendChild(video);
        const platform = {
            getCurrentVideoId: () => videoId,
            getPlaybackTime: () => 0.5,
            getVideoElement: () => video,
            getPlayerContainerElement: () => document.body,
            isPlayerPageActive: () => true,
            supportsProgressBarTracking: () => false,
        };
        const convertedTtmlVtt = ttmlParser.convertTtmlToVtt(`
            <tt:tt xmlns:tt="urn:tt"><tt:body><tt:div>
                <tt:p begin="0s" end="1s"><span>Alpha</span><tt:br/>&lt;script&gt;alert(1)&lt;/script&gt; &lt;tag&gt;<tt:br/><span>Fish &amp; Chips &#38;lt; &#x26;lt; &amp;#x3C; &amp;lt; &#x1F600;</span></tt:p>
            </tt:div></tt:body></tt:tt>`);
        const directVtt = `WEBVTT

00:00:00.000 --> 00:00:01.000
<b>Alpha</b><br/>&lt;script&gt;alert(1)&lt;/script&gt; &lt;tag&gt;<br/><v Speaker>Fish</v> &amp; <i>Chips</i> &#38;lt; &#x26;lt; &amp;#x3C; &amp;lt; &#x1F600;`;
        const semanticText =
            'Alpha\n<script>alert(1)</script> <tag>\n' +
            'Fish & Chips &lt; &lt; &#x3C; &lt; 😀';

        expect(parseVTT(convertedTtmlVtt)).toEqual([
            { start: 0, end: 1, text: semanticText },
        ]);
        expect(parseVTT(directVtt)).toEqual([
            { start: 0, end: 1, text: semanticText },
        ]);

        handleSubtitleDataFound(
            {
                videoId,
                vttText: convertedTtmlVtt,
                targetVttText: directVtt,
                useNativeTarget: true,
                sourceLanguage: 'en',
                targetLanguage: 'zh-CN',
                selectedLanguage: {
                    normalizedCode: 'en',
                    displayName: 'English',
                },
            },
            platform,
            config,
            'TextPipelineTest'
        );

        const originalCue = subtitleQueue.find(
            (cue) => cue.cueType === 'original'
        );
        const targetCue = subtitleQueue.find((cue) => cue.cueType === 'target');
        expect(originalCue.original).toBe(semanticText);
        expect(targetCue.translated).toBe(semanticText);
        expect(originalCue.original).toBe(targetCue.translated);
        expect(originalSubtitleElement.textContent).toBe(semanticText);
        expect(translatedSubtitleElement.textContent).toBe(semanticText);
        expect(originalSubtitleElement.querySelectorAll('*')).toHaveLength(0);
        expect(translatedSubtitleElement.querySelectorAll('*')).toHaveLength(0);
    });

    test('rerenders when only semantic line breaks and angle-bracket literals change', () => {
        const video = document.createElement('video');
        document.body.appendChild(video);
        const platform = {
            getCurrentVideoId: () => videoId,
            getPlaybackTime: () => 0.5,
            getVideoElement: () => video,
            getPlayerContainerElement: () => document.body,
            isPlayerPageActive: () => true,
            supportsProgressBarTracking: () => false,
        };
        const vttText = ttmlParser.convertTtmlToVtt(`
            <tt:tt xmlns:tt="urn:tt"><tt:body><tt:div>
                <tt:p begin="0s" end="1s">Alpha Beta &lt;a&gt;</tt:p>
                <tt:p begin="1s" end="2s">Alpha<tt:br/>Beta &lt;b&gt;</tt:p>
            </tt:div></tt:body></tt:tt>`);

        handleSubtitleDataFound(
            {
                videoId,
                vttText,
                targetVttText: `WEBVTT

00:00:00.000 --> 00:00:01.000
first translation

00:00:01.000 --> 00:00:02.000
second translation`,
                useNativeTarget: true,
                sourceLanguage: 'en',
                targetLanguage: 'zh-CN',
                selectedLanguage: {
                    normalizedCode: 'en',
                    displayName: 'English',
                },
            },
            platform,
            config,
            'TextPipelineTest'
        );

        expect(originalSubtitleElement.textContent).toBe('Alpha Beta <a>');
        expect(translatedSubtitleElement.textContent).toBe('first translation');

        updateSubtitles(1.5, platform, config, 'TextPipelineTest');

        expect(originalSubtitleElement.textContent).toBe('Alpha\nBeta <b>');
        expect(translatedSubtitleElement.textContent).toBe(
            'second translation'
        );
    });
});
