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
        ttDownloadables: {
            dfxp: {
                urls: [{ url }],
            },
        },
    };
}

function spyOnLoggerMethods(logger) {
    return Object.fromEntries(
        ['debug', 'error', 'info', 'warn'].map((method) => [
            method,
            jest.spyOn(logger, method).mockImplementation(() => {}),
        ])
    );
}

function collectLoggerCalls(loggerSpies) {
    return Object.values(loggerSpies).flatMap((spy) => spy.mock.calls);
}

describe('TTMLParser', () => {
    test('keeps collaborator failures out of logs and the public parse error', () => {
        const sensitiveMarker = 'PRIVATE_TTML_COLLABORATOR_FAILURE';
        const rawError = new Error(`${sensitiveMarker}:message`);
        rawError.stack = `${sensitiveMarker}:stack`;
        rawError.cause = new Error(`${sensitiveMarker}:cause`);
        rawError.url = `https://captions.example/${sensitiveMarker}`;
        rawError.details = { marker: sensitiveMarker };
        const loggerSpies = spyOnLoggerMethods(ttmlParser.logger);
        const ttml = '<tt><body><p begin="0s" end="1s">Private</p></body></tt>';
        jest.spyOn(ttmlParser, 'parseTtmlTimeToSeconds').mockImplementation(
            () => {
                throw rawError;
            }
        );

        let publicError;
        try {
            ttmlParser.convertTtmlToVtt(ttml);
        } catch (error) {
            publicError = error;
        }

        expect(publicError).toBeInstanceOf(Error);
        expect(publicError).not.toBe(rawError);
        expect(publicError).toMatchObject({
            name: 'TTMLConversionError',
            message: 'TTML conversion failed.',
        });
        expect(Reflect.ownKeys(publicError).map(String).sort()).toEqual([
            'message',
            'name',
            'stack',
        ]);
        for (const property of ['cause', 'url', 'details']) {
            expect(Object.hasOwn(publicError, property)).toBe(false);
        }

        expect(loggerSpies.error.mock.calls).toEqual([
            [
                'TTML conversion failed',
                {
                    inputLength: ttml.length,
                    stage: 'conversion',
                },
            ],
        ]);
        const loggerCalls = collectLoggerCalls(loggerSpies);
        expect(loggerCalls.flat()).not.toContain(rawError);
        const rendered = JSON.stringify(
            { loggerCalls, publicError },
            (_key, value) =>
                value instanceof Error
                    ? {
                          name: value.name,
                          message: value.message,
                          stack: value.stack,
                          cause: value.cause,
                          url: value.url,
                          details: value.details,
                      }
                    : value
        );
        expect(rendered).not.toContain(sensitiveMarker);
    });

    test('does not reflect a hostile thrown value while classifying failures', () => {
        const sensitiveMarker = 'PRIVATE_TTML_PROXY_TRAP_FAILURE';
        const trapError = new Error(`${sensitiveMarker}:message`);
        trapError.stack = `${sensitiveMarker}:stack`;
        trapError.cause = new Error(`${sensitiveMarker}:cause`);
        trapError.url = `https://captions.example/${sensitiveMarker}`;
        trapError.details = { marker: sensitiveMarker };
        const hostileThrownValue = new Proxy(
            {},
            {
                getPrototypeOf() {
                    throw trapError;
                },
            }
        );
        const loggerSpies = spyOnLoggerMethods(ttmlParser.logger);
        jest.spyOn(ttmlParser, 'parseTtmlTimeToSeconds').mockImplementation(
            () => {
                throw hostileThrownValue;
            }
        );

        let publicError;
        try {
            ttmlParser.convertTtmlToVtt(
                '<tt><body><p begin="0s" end="1s">Private</p></body></tt>'
            );
        } catch (error) {
            publicError = error;
        }

        expect(publicError).not.toBe(trapError);
        expect(publicError).not.toBe(hostileThrownValue);
        expect(publicError).toMatchObject({
            name: 'TTMLConversionError',
            message: 'TTML conversion failed.',
        });
        const loggerCalls = collectLoggerCalls(loggerSpies);
        expect(loggerCalls.flat()).not.toContain(trapError);
        expect(loggerCalls.flat()).not.toContain(hostileThrownValue);
        const rendered = JSON.stringify(
            { loggerCalls, publicError },
            (_key, value) =>
                value instanceof Error
                    ? {
                          name: value.name,
                          message: value.message,
                          stack: value.stack,
                          cause: value.cause,
                          url: value.url,
                          details: value.details,
                      }
                    : value
        );
        expect(rendered).not.toContain(sensitiveMarker);
    });

    test('keeps malformed timestamp contents out of logs and parse errors', () => {
        const sensitiveMarker = 'PRIVATE_TTML_TIMESTAMP';
        const ttml =
            `<tt><layout><region xml:id="${sensitiveMarker}" ` +
            `tts:origin="10% 20%" /></layout><body><p ` +
            `region="${sensitiveMarker}" begin="${sensitiveMarker}" ` +
            'end="1s">Private</p></body></tt>';
        const loggerSpies = spyOnLoggerMethods(ttmlParser.logger);

        let publicError;
        try {
            ttmlParser.convertTtmlToVtt(ttml);
        } catch (error) {
            publicError = error;
        }

        expect(publicError).toMatchObject({
            name: 'TTMLConversionError',
            message: 'TTML conversion failed: Unsupported TTML timestamp',
        });
        expect(loggerSpies.error.mock.calls).toEqual([
            [
                'TTML conversion failed',
                {
                    inputLength: ttml.length,
                    stage: 'conversion',
                },
            ],
        ]);
        const loggerCalls = collectLoggerCalls(loggerSpies);
        expect(
            JSON.stringify({ loggerCalls, publicError }, (_key, value) =>
                value instanceof Error
                    ? {
                          name: value.name,
                          message: value.message,
                          stack: value.stack,
                          ownKeys: Reflect.ownKeys(value).map(String),
                      }
                    : value
            )
        ).not.toContain(sensitiveMarker);
    });

    test('preserves the exact VTT bytes for a valid TTML fixture', () => {
        const ttml =
            '<tt><body><p begin="0s" end="1.25s">Alpha &amp; Beta</p></body></tt>';

        expect(ttmlParser.convertTtmlToVtt(ttml)).toBe(
            'WEBVTT\n\n00:00:00.000 --> 00:00:01.250\nAlpha &amp; Beta\n\n'
        );
    });

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

    test.each([
        ['sub-millisecond tick interval', '0t', '1t'],
        [
            'distinct timestamps that round to the same millisecond',
            '5000t',
            '14999t',
        ],
    ])(
        'rejects %s after converting both endpoints to VTT milliseconds',
        (_label, begin, end) => {
            const ttml = `<tt><body><p begin="${begin}" end="${end}">too short</p></body></tt>`;

            expect(() => ttmlParser.convertTtmlToVtt(ttml)).toThrow(
                'TTML conversion failed: Invalid TTML cue range'
            );
        }
    );

    test('serializes the first tick boundary that rounds to a distinct millisecond', () => {
        const ttml =
            '<tt><body><p begin="0t" end="5000t">one millisecond</p></body></tt>';

        expect(ttmlParser.convertTtmlToVtt(ttml)).toContain(
            '00:00:00.000 --> 00:00:00.001\none millisecond'
        );
    });

    test('decodes TTML entities before safely serializing semantic VTT text', () => {
        const ttml = `
            <tt><body><div>
                <p begin="0s" end="1s">
                    <span>Fish &amp; Chips</span> &#x1F600; &#169;
                    &quot;yes&quot; &apos;ok&apos; &lt;tag&gt;
                </p>
            </div></body></tt>`;

        expect(ttmlParser.convertTtmlToVtt(ttml)).toContain(
            `Fish &amp; Chips 😀 © "yes" 'ok' &lt;tag&gt;`
        );
    });

    test('preserves namespaced and plain TTML breaks as cue line breaks', () => {
        const ttml = `
            <tt:tt xmlns:tt="urn:tt"><tt:body><tt:div>
                <tt:p begin="0s" end="1s">Alpha<tt:br/>Beta<br />Gamma</tt:p>
            </tt:div></tt:body></tt:tt>`;

        expect(ttmlParser.convertTtmlToVtt(ttml)).toContain(
            'Alpha\nBeta\nGamma'
        );
    });

    test('serializes decoded TTML literals as VTT text rather than cue markup', () => {
        const ttml = `
            <tt><body><div>
                <p begin="0s" end="1s">&lt;tag&gt; Fish &amp; Chips</p>
            </div></body></tt>`;

        expect(ttmlParser.convertTtmlToVtt(ttml)).toContain(
            '&lt;tag&gt; Fish &amp; Chips'
        );
    });

    test('preserves an out-of-range numeric entity as inert VTT text', () => {
        const ttml = `
            <tt><body><div>
                <p begin="0s" end="1s">invalid &#x110000; entity</p>
            </div></body></tt>`;

        expect(ttmlParser.convertTtmlToVtt(ttml)).toContain(
            'invalid &amp;#x110000; entity'
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
            '<tt><body><p begin="not-a-tickt" end="1s">bad</p></body></tt>',
            'TTML conversion failed: Unsupported TTML timestamp',
        ],
        [
            '<tt><body><p begin="2s" end="1s">backwards</p></body></tt>',
            'TTML conversion failed: Invalid TTML cue range',
        ],
    ])('rejects malformed TTML input %#', (input, expectedMessage) => {
        let publicError;
        try {
            ttmlParser.convertTtmlToVtt(input);
        } catch (error) {
            publicError = error;
        }

        expect(publicError).toBeInstanceOf(Error);
        expect(publicError.message).toBe(expectedMessage);
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
        ).rejects.toMatchObject({
            message: 'Subtitle response rejected.',
            code: 'ERR_SUBTITLE_FETCH_HTTP',
        });
    });

    test('rejects a raw track collection outside the authorized request boundary', async () => {
        await expect(
            netflixParser.processNetflixSubtitleData({ tracks: [] })
        ).rejects.toMatchObject({
            name: 'NetflixParserAuthorizationError',
            code: 'ERR_NETFLIX_SUBTITLE_REQUEST_UNAUTHORIZED',
        });
    });
});

describe('VTTParser M3U8 handling', () => {
    test('retains ordered raw media references without resolving them', () => {
        const playlist = `
            #EXTM3U
            #EXTINF:2.0,
            ../segments/one?token=abc
            #EXTINF:2.0,
            /captions/two.webvtt
            #EXTINF:2.0,
            https://other.example/three.vtt`;

        expect(
            vttParser.parsePlaylistForVttSegmentReferences(playlist)
        ).toEqual([
            '../segments/one?token=abc',
            '/captions/two.webvtt',
            'https://other.example/three.vtt',
        ]);
    });

    test('keeps allowed successes in order while a blocked segment stays soft', async () => {
        const snapshot = createAuthorizedDisneySubtitleSnapshot();
        const playlistCanonicalUrl =
            'https://captions.media.dssott.com/show/index.m3u8';
        global.fetch = jest.fn(async (url) => {
            const text = url.endsWith('one.vtt')
                ? 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nOne'
                : 'WEBVTT\n\n00:00:02.000 --> 00:00:03.000\nThree';
            return createSubtitleFetchResponse(text, url);
        });

        const result = await vttParser.fetchAndCombineVttSegments(
            snapshot,
            ['one.vtt', 'https://attacker.example/two.vtt', 'three.vtt'],
            playlistCanonicalUrl
        );

        expect(result).toContain('One');
        expect(result).toContain('Three');
        expect(result.indexOf('One')).toBeLessThan(result.indexOf('Three'));
        expect(global.fetch).toHaveBeenCalledTimes(2);
        expect(global.fetch.mock.calls.map(([url]) => url)).toEqual([
            'https://captions.media.dssott.com/show/one.vtt',
            'https://captions.media.dssott.com/show/three.vtt',
        ]);
    });

    test('fails with a fixed error when every segment is blocked', async () => {
        const snapshot = createAuthorizedDisneySubtitleSnapshot();
        global.fetch = jest.fn();

        await expect(
            vttParser.fetchAndCombineVttSegments(
                snapshot,
                [
                    'https://attacker.example/one.vtt',
                    'http://captions.media.dssott.com/two.vtt',
                ],
                'https://captions.media.dssott.com/show/index.m3u8'
            )
        ).rejects.toMatchObject({
            message: 'No VTT segments could be fetched.',
            code: 'ERR_VTT_SEGMENTS_UNAVAILABLE',
        });
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('rejects a playlist without segment URIs', async () => {
        const snapshot = createAuthorizedDisneySubtitleSnapshot();
        global.fetch = jest.fn();

        await expect(
            vttParser.processM3U8PlaylistText(
                snapshot,
                '#EXTM3U\n#EXT-X-VERSION:6',
                'https://captions.media.dssott.com/empty/index.m3u8'
            )
        ).rejects.toThrow('No VTT segments found');
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('resolves a raw segment only against the exact canonical playlist parent', async () => {
        const snapshot = createAuthorizedDisneySubtitleSnapshot();
        const playlistCanonicalUrl =
            'https://captions.media.dssott.com/show/en/index.m3u8';
        const expectedSegmentUrl =
            'https://captions.media.dssott.com/show/segments/one?token=abc';
        global.fetch = jest.fn(async (url) =>
            createSubtitleFetchResponse(
                'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nOne',
                url
            )
        );

        await expect(
            vttParser.processM3U8PlaylistText(
                snapshot,
                '#EXTM3U\n#EXTINF:2.0,\n../segments/one?token=abc',
                playlistCanonicalUrl
            )
        ).resolves.toContain('One');
        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(global.fetch.mock.calls[0][0]).toBe(expectedSegmentUrl);
        expect(global.fetch.mock.calls[0][1]).toMatchObject({
            credentials: 'omit',
            method: 'GET',
            redirect: 'follow',
            signal: expect.any(AbortSignal),
        });
    });
});
