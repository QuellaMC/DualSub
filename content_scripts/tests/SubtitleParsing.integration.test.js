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

const VIDEO_ID = 'text-pipeline-video';
const CONFIG = {
    originalLanguage: 'en',
    targetLanguage: 'zh-CN',
    subtitleTimeOffset: 0,
    subtitleFontSize: 2.5,
    subtitleGap: 0,
    subtitleLayoutOrder: 'original_top',
    subtitleLayoutOrientation: 'column',
    subtitleVerticalPosition: 2.8,
};

function createPlatform(time = 0.5) {
    const video = document.createElement('video');
    document.body.appendChild(video);
    return {
        getCurrentVideoId: () => VIDEO_ID,
        getPlaybackTime: () => time,
        getVideoElement: () => video,
        getPlayerContainerElement: () => document.body,
        isPlayerPageActive: () => true,
        supportsProgressBarTracking: () => false,
    };
}

function loadNativeSubtitles(platform, originalVtt, targetVtt = originalVtt) {
    handleSubtitleDataFound(
        {
            videoId: VIDEO_ID,
            vttText: originalVtt,
            targetVttText: targetVtt,
            useNativeTarget: true,
            sourceLanguage: 'en',
            targetLanguage: 'zh-CN',
            selectedLanguage: {
                normalizedCode: 'en',
                displayName: 'English',
            },
        },
        platform,
        CONFIG,
        'TextPipelineTest'
    );
}

describe('WebVTT parsing', () => {
    test.each([
        ['00:00:00.000', 0],
        ['01:02:03.456', 3723.456],
        ['02:03.250', 123.25],
        ['00:60:00.000', null],
        ['00:00:60.000', null],
        ['00:00:01', null],
        ['not-a-timestamp', null],
    ])('parses %s as %s', (timestamp, expected) => {
        expect(parseTimestampToSeconds(timestamp)).toBe(expected);
    });

    test.each([
        ['LF', '\n', ' '],
        ['CRLF', '\r\n', '  '],
        ['CR and tabs', '\r', '\t'],
    ])('accepts %s cue delimiters and timing settings', (_label, eol, gap) => {
        const vtt = [
            'WEBVTT',
            '',
            'cue-1',
            `00:00:00.000${gap}-->${gap}00:00:01.000${gap}align:start`,
            'first',
            'second',
        ].join(eol);

        expect(parseVTT(vtt)).toEqual([
            { start: 0, end: 1, text: 'first\nsecond' },
        ]);
    });

    test.each([
        'bad --> 00:00:01.000',
        '00:00:01.000 --> bad',
        '00:00:01.000 --> 00:00:01.000',
        '00:00:02.000 --> 00:00:01.000',
        '00:00:00.000--> 00:00:01.000',
    ])('rejects an invalid cue range: %s', (timing) => {
        expect(parseVTT(`WEBVTT\n\n${timing}\ninvalid`)).toEqual([]);
    });

    test('normalizes supported markup while preserving literal text and line breaks', () => {
        const [cue] = parseVTT(`WEBVTT

00:00:00.000 --> 00:00:02.000
First &amp; second<br/><b>bold</b>
&lt;script&gt;alert(1)&lt;/script&gt; <example>`);

        expect(cue.text).toBe(
            'First & second\nbold\n<script>alert(1)</script> <example>'
        );
        const rendered = document.createElement('div');
        rendered.innerHTML = formatSubtitleTextForDisplay(cue.text);
        expect(rendered.textContent).toBe(cue.text);
        expect(rendered.querySelector('script')).toBeNull();
    });
});

describe('subtitle text pipeline', () => {
    beforeEach(() => {
        document.body.replaceChildren();
        clearSubtitleDOM();
        setSubtitlesActive(true);
        setCurrentVideoId(VIDEO_ID);
        clearSubtitlesDisplayAndQueue(null, true);
    });

    afterEach(() => {
        clearSubtitleDOM();
        clearSubtitlesDisplayAndQueue(null, true);
        document.body.replaceChildren();
    });

    test('TTML and direct WebVTT produce the same inert semantic DOM text', () => {
        const platform = createPlatform();
        const ttmlVtt = ttmlParser.convertTtmlToVtt(`
            <tt:tt xmlns:tt="urn:tt"><tt:body><tt:div>
                <tt:p begin="0s" end="1s">Alpha<tt:br/>&lt;script&gt;alert(1)&lt;/script&gt; &amp; Chips</tt:p>
            </tt:div></tt:body></tt:tt>`);
        const directVtt = `WEBVTT

00:00:00.000 --> 00:00:01.000
Alpha<br/>&lt;script&gt;alert(1)&lt;/script&gt; &amp; Chips`;
        const semanticText = 'Alpha\n<script>alert(1)</script> & Chips';

        expect(parseVTT(ttmlVtt)[0].text).toBe(semanticText);
        expect(parseVTT(directVtt)[0].text).toBe(semanticText);
        loadNativeSubtitles(platform, ttmlVtt, directVtt);

        expect(
            subtitleQueue.find((queuedCue) => queuedCue.cueType === 'original')
                .original
        ).toBe(semanticText);
        expect(originalSubtitleElement.textContent).toBe(semanticText);
        expect(translatedSubtitleElement.textContent).toBe(semanticText);
        expect(originalSubtitleElement.querySelectorAll('*')).toHaveLength(0);
        expect(translatedSubtitleElement.querySelectorAll('*')).toHaveLength(0);
        expect(originalSubtitleElement.style.whiteSpace).toBe('pre-line');
    });

    test('rerenders when only line breaks and angle-bracket literals change', () => {
        const platform = createPlatform();
        loadNativeSubtitles(
            platform,
            `WEBVTT

00:00:00.000 --> 00:00:01.000
Alpha Beta &lt;a&gt;

00:00:01.000 --> 00:00:02.000
Alpha<br/>Beta &lt;b&gt;`,
            `WEBVTT

00:00:00.000 --> 00:00:01.000
first

00:00:01.000 --> 00:00:02.000
second`
        );

        expect(originalSubtitleElement.textContent).toBe('Alpha Beta <a>');
        updateSubtitles(1.5, platform, CONFIG, 'TextPipelineTest');
        expect(originalSubtitleElement.textContent).toBe('Alpha\nBeta <b>');
        expect(translatedSubtitleElement.textContent).toBe('second');
    });
});
