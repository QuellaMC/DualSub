import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { netflixParser } from './netflixParser.js';
import { ttmlParser } from './ttmlParser.js';
import { vttParser } from './vttParser.js';
import {
    createAuthorizedDisneySubtitleSnapshot,
    createAuthorizedNetflixSubtitleSnapshot,
    createSubtitleFetchResponse,
} from '../../test-utils/subtitle-fetch-fixtures.js';

const originalFetch = global.fetch;

afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
});

function createNetflixTrack(language, url, trackType = 'PRIMARY') {
    return {
        language,
        displayName: language,
        trackType,
        isNoneTrack: false,
        isForcedNarrative: false,
        ttDownloadables: { dfxp: { urls: [{ url }] } },
    };
}

describe('TTMLParser', () => {
    test('converts a basic cue to exact VTT bytes', () => {
        expect(
            ttmlParser.convertTtmlToVtt(
                '<tt><body><p begin="0s" end="1.25s">Alpha &amp; Beta</p></body></tt>'
            )
        ).toBe('WEBVTT\n\n00:00:00.000 --> 00:00:01.250\nAlpha &amp; Beta\n\n');
    });

    test('orders namespaced cues by region position', () => {
        const ttml = `
            <tt:tt xmlns:tt="urn:tt" xmlns:tts="urn:styles">
                <tt:layout>
                    <tt:region tts:origin='80% 70%' xml:id='bottom' />
                    <tt:region xml:id="top" tts:origin="10% 10%" />
                </tt:layout>
                <tt:body><tt:div>
                    <tt:p region="bottom" end="2s" begin="1s">Bottom</tt:p>
                    <tt:p end='2s' begin='1s' region='top'>Top</tt:p>
                </tt:div></tt:body>
            </tt:tt>`;

        expect(ttmlParser.convertTtmlToVtt(ttml)).toContain(
            '00:00:01.000 --> 00:00:02.000\nTop Bottom'
        );
    });

    test('normalizes clock, offset, and Netflix tick timestamps', () => {
        const vtt = ttmlParser.convertTtmlToVtt(`
            <tt><body><div>
                <p begin="00:00:01,500" end="00:00:02.75">clock</p>
                <p end="4250ms" begin="3.5s">offset</p>
                <p begin="50000000t" end="62500000t">tick</p>
            </div></body></tt>`);

        expect(vtt).toContain('00:00:01.500 --> 00:00:02.750\nclock');
        expect(vtt).toContain('00:00:03.500 --> 00:00:04.250\noffset');
        expect(vtt).toContain('00:00:05.000 --> 00:00:06.250\ntick');
    });

    test('normalizes TTML text while preserving line breaks and literals', () => {
        const vtt = ttmlParser.convertTtmlToVtt(`
            <tt:tt xmlns:tt="urn:tt"><tt:body><tt:div>
                <tt:p begin="0s" end="1s">
                    Fish &amp; Chips<tt:br/> &lt;tag&gt; &#x1F600; &#x110000;
                </tt:p>
            </tt:div></tt:body></tt:tt>`);

        expect(vtt).toContain(
            'Fish &amp; Chips\n&lt;tag&gt; 😀 &amp;#x110000;'
        );
    });

    test.each([
        [null, 'TTML input must be a non-empty string'],
        ['   ', 'TTML input must be a non-empty string'],
        [
            '<tt><body /></tt>',
            'TTML conversion failed: No valid TTML subtitle entries found',
        ],
        [
            '<tt><body><p begin="bad" end="1s">bad</p></body></tt>',
            'TTML conversion failed: Unsupported TTML timestamp',
        ],
        [
            '<tt><body><p begin="2s" end="1s">backwards</p></body></tt>',
            'TTML conversion failed: Invalid TTML cue range',
        ],
        [
            '<tt><body><p begin="0t" end="1t">too short</p></body></tt>',
            'TTML conversion failed: Invalid TTML cue range',
        ],
    ])('rejects invalid TTML input %#', (input, message) => {
        expect(() => ttmlParser.convertTtmlToVtt(input)).toThrow(message);
    });
});

describe('NetflixParser', () => {
    test('normalizes regional, case, underscore, and script locales', () => {
        const english = createNetflixTrack(
            'EN_us',
            'https://example.test/en.ttml'
        );
        const traditionalChinese = createNetflixTrack(
            'zh-Hant-HK',
            'https://example.test/zh.ttml'
        );

        const result = netflixParser.extractNetflixTracks(
            { tracks: [english, traditionalChinese] },
            'en-US',
            'zh_TW'
        );

        expect(result.originalTrack).toMatchObject({ language: 'EN_us' });
        expect(result.targetTrack).toMatchObject({ language: 'zh-Hant-HK' });
        expect(result.availableLanguages).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ normalizedCode: 'en' }),
                expect.objectContaining({ normalizedCode: 'zh-TW' }),
            ])
        );
    });

    test('propagates subtitle fetch failures', async () => {
        const track = createNetflixTrack(
            'en-US',
            'https://captions.nflxvideo.net/show/en.ttml'
        );
        const snapshot = createAuthorizedNetflixSubtitleSnapshot({
            tracks: [track],
            originalLanguage: 'en',
            useNativeSubtitles: false,
            useOfficialTranslations: false,
        });
        global.fetch = jest.fn(async (url) =>
            createSubtitleFetchResponse('unavailable', url, {
                ok: false,
                status: 503,
            })
        );

        await expect(
            netflixParser.processNetflixSubtitleData(snapshot)
        ).rejects.toMatchObject({ code: 'ERR_SUBTITLE_FETCH_HTTP' });
    });

    test('rejects raw tracks outside the authorized request boundary', async () => {
        await expect(
            netflixParser.processNetflixSubtitleData({ tracks: [] })
        ).rejects.toMatchObject({
            code: 'ERR_NETFLIX_SUBTITLE_REQUEST_UNAUTHORIZED',
        });
    });
});

describe('VTTParser M3U8 handling', () => {
    test('returns ordered raw segment references', () => {
        expect(
            vttParser.parsePlaylistForVttSegmentReferences(`
                #EXTM3U
                #EXTINF:2.0,
                ../segments/one?token=abc
                #EXTINF:2.0,
                /captions/two.webvtt
                #EXTINF:2.0,
                https://other.example/three.vtt`)
        ).toEqual([
            '../segments/one?token=abc',
            '/captions/two.webvtt',
            'https://other.example/three.vtt',
        ]);
    });

    test('keeps allowed successes in order and skips blocked segments', async () => {
        const playlistUrl = 'https://captions.media.dssott.com/show/index.m3u8';
        global.fetch = jest.fn(async (url) => {
            const text = url.endsWith('/one.vtt')
                ? 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nOne'
                : 'WEBVTT\n\n00:00:02.000 --> 00:00:03.000\nThree';
            return createSubtitleFetchResponse(text, url);
        });

        const result = await vttParser.fetchAndCombineVttSegments(
            createAuthorizedDisneySubtitleSnapshot(),
            ['one.vtt', 'https://attacker.example/two.vtt', 'three.vtt'],
            playlistUrl
        );

        expect(result).toBe(
            'WEBVTT\n\n' +
                '00:00:00.000 --> 00:00:01.000\nOne\n\n' +
                '00:00:02.000 --> 00:00:03.000\nThree\n\n'
        );
        expect(global.fetch.mock.calls.map(([url]) => url)).toEqual([
            'https://captions.media.dssott.com/show/one.vtt',
            'https://captions.media.dssott.com/show/three.vtt',
        ]);
    });

    test('fails when every segment is blocked', async () => {
        global.fetch = jest.fn();

        await expect(
            vttParser.fetchAndCombineVttSegments(
                createAuthorizedDisneySubtitleSnapshot(),
                [
                    'https://attacker.example/one.vtt',
                    'http://captions.media.dssott.com/two.vtt',
                ],
                'https://captions.media.dssott.com/show/index.m3u8'
            )
        ).rejects.toMatchObject({ code: 'ERR_VTT_SEGMENTS_UNAVAILABLE' });
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('rejects a playlist without segment references', async () => {
        global.fetch = jest.fn();

        await expect(
            vttParser.processM3U8PlaylistText(
                createAuthorizedDisneySubtitleSnapshot(),
                '#EXTM3U\n#EXT-X-VERSION:6',
                'https://captions.media.dssott.com/empty/index.m3u8'
            )
        ).rejects.toMatchObject({ code: 'ERR_VTT_SEGMENTS_EMPTY' });
        expect(global.fetch).not.toHaveBeenCalled();
    });
});
