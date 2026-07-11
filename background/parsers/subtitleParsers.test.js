import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { netflixParser } from './netflixParser.js';
import { ttmlParser } from './ttmlParser.js';
import { vttParser } from './vttParser.js';

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
        ttDownloadables: {
            dfxp: {
                urls: [{ url }],
            },
        },
    };
}

describe('TTMLParser', () => {
    test('parses namespaced elements and attributes in any order', () => {
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
        const ttml = `
            <tt><body><div>
                <p begin="00:00:01,500" end="00:00:02.75">clock</p>
                <p end="4250ms" begin="3.5s">offset</p>
                <p begin="50000000t" end="62500000t">tick</p>
            </div></body></tt>`;

        const vtt = ttmlParser.convertTtmlToVtt(ttml);
        expect(vtt).toContain('00:00:01.500 --> 00:00:02.750\nclock');
        expect(vtt).toContain('00:00:03.500 --> 00:00:04.250\noffset');
        expect(vtt).toContain('00:00:05.000 --> 00:00:06.250\ntick');
    });

    test('decodes named, decimal, and hexadecimal entities after stripping markup', () => {
        const ttml = `
            <tt><body><div>
                <p begin="0s" end="1s">
                    <span>Fish &amp; Chips</span> &#x1F600; &#169;
                    &quot;yes&quot; &apos;ok&apos; &lt;tag&gt;
                </p>
            </div></body></tt>`;

        expect(ttmlParser.convertTtmlToVtt(ttml)).toContain(
            `Fish & Chips 😀 © "yes" 'ok' <tag>`
        );
    });

    test.each([
        [null, 'non-empty string'],
        ['   ', 'non-empty string'],
        ['<tt><body /></tt>', 'No valid TTML subtitle entries'],
        [
            '<tt><body><p begin="not-a-tickt" end="1s">bad</p></body></tt>',
            'Unsupported TTML timestamp',
        ],
        [
            '<tt><body><p begin="2s" end="1s">backwards</p></body></tt>',
            'Invalid TTML cue range',
        ],
    ])('rejects malformed TTML input %#', (input, message) => {
        expect(() => ttmlParser.convertTtmlToVtt(input)).toThrow(message);
    });
});

describe('NetflixParser', () => {
    test('normalizes regional, case, underscore, and script locale variants', () => {
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

    test('propagates subtitle fetch failures instead of returning an error-shaped success', async () => {
        const track = createNetflixTrack(
            'en-US',
            'https://example.test/en.ttml'
        );
        global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 });

        await expect(
            netflixParser.processNetflixSubtitleData(
                { tracks: [track] },
                'zh-CN',
                'en',
                false,
                false
            )
        ).rejects.toThrow('Netflix subtitle fetch failed: 503');
    });

    test('rejects malformed track collections', async () => {
        await expect(
            netflixParser.processNetflixSubtitleData({ tracks: {} })
        ).rejects.toThrow('tracks must be an array');
    });

    test('rejects a track collection with no usable subtitle track', async () => {
        await expect(
            netflixParser.processNetflixSubtitleData({
                tracks: [
                    {
                        language: 'en',
                        isForcedNarrative: true,
                    },
                ],
            })
        ).rejects.toThrow('No usable Netflix subtitle track');
    });
});

describe('VTTParser M3U8 handling', () => {
    test('resolves every relative media-playlist URI, including extensionless query URLs', () => {
        const playlist = `
            #EXTM3U
            #EXTINF:2.0,
            ../segments/one?token=abc
            #EXTINF:2.0,
            /captions/two.webvtt
            #EXTINF:2.0,
            https://other.example/three.vtt`;

        expect(
            vttParser.parsePlaylistForVttSegments(
                playlist,
                'https://cdn.example/show/en/index.m3u8'
            )
        ).toEqual([
            'https://cdn.example/show/segments/one?token=abc',
            'https://cdn.example/captions/two.webvtt',
            'https://other.example/three.vtt',
        ]);
    });

    test('keeps successful segments in playlist order when another segment fails', async () => {
        global.fetch = jest.fn(async (url) => {
            if (url.endsWith('two.vtt')) {
                return { ok: false, status: 502 };
            }
            return {
                ok: true,
                text: async () =>
                    url.endsWith('one.vtt')
                        ? 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nOne'
                        : 'WEBVTT\n\n00:00:02.000 --> 00:00:03.000\nThree',
            };
        });

        const result = await vttParser.fetchAndCombineVttSegments([
            'https://example.test/one.vtt',
            'https://example.test/two.vtt',
            'https://example.test/three.vtt',
        ]);

        expect(result).toContain('One');
        expect(result).toContain('Three');
        expect(result.indexOf('One')).toBeLessThan(result.indexOf('Three'));
    });

    test('throws when every playlist segment fails', async () => {
        global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 });

        await expect(
            vttParser.fetchAndCombineVttSegments([
                'https://example.test/one.vtt',
                'https://example.test/two.vtt',
            ])
        ).rejects.toThrow('Failed to fetch any of the 2 VTT segments');
    });

    test('rejects a playlist without segment URIs', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            text: async () => '#EXTM3U\n#EXT-X-VERSION:6',
        });

        await expect(
            vttParser.processM3U8Playlist(
                'https://example.test/empty/index.m3u8'
            )
        ).rejects.toThrow('No VTT segments found');
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('uses resolved relative segment URLs throughout playlist processing', async () => {
        global.fetch = jest.fn(async (url) => {
            if (url.endsWith('index.m3u8')) {
                return {
                    ok: true,
                    text: async () =>
                        '#EXTM3U\n#EXTINF:2.0,\n../segments/one?token=abc',
                };
            }
            return {
                ok: true,
                text: async () =>
                    'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nOne',
            };
        });

        await expect(
            vttParser.processM3U8Playlist(
                'https://cdn.example/show/en/index.m3u8'
            )
        ).resolves.toContain('One');
        expect(global.fetch).toHaveBeenCalledWith(
            'https://cdn.example/show/segments/one?token=abc',
            expect.objectContaining({ signal: expect.any(AbortSignal) })
        );
    });
});
