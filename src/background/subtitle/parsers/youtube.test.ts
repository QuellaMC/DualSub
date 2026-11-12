import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FetchAbortedError } from '@/shared/fetchWithTimeout';
import { parseVtt } from '@/shared/vtt';
import { fetchAuthorizedSubtitleText } from '../fetch';
import type { YouTubeAuthorizedRequest } from '../policy';
import { consolidateAsrCues, processYouTubeSubtitles } from './youtube';

vi.mock('../fetch', () => ({
    fetchAuthorizedSubtitleText: vi.fn(),
}));

const mockedFetch = vi.mocked(fetchAuthorizedSubtitleText);

/** A speech-recognition line YouTube leaves blank holds one space. */
const BLANK = ' ';

// Speech recognition as YouTube serves it: each line types in word by word
// under the line before it, then flashes alone for 10 ms.
const ENGLISH_ASR = [
    'WEBVTT',
    'Kind: captions',
    'Language: en',
    '',
    '00:00:01.000 --> 00:00:02.500 align:start position:0%',
    BLANK,
    'the<00:00:01.200><c> quick</c><00:00:01.400><c> brown</c>',
    '',
    '00:00:02.500 --> 00:00:02.510 align:start position:0%',
    'the quick brown',
    BLANK,
    '',
    '00:00:02.510 --> 00:00:04.000 align:start position:0%',
    'the quick brown',
    'fox<00:00:02.800><c> jumps</c><00:00:03.100><c> over</c>',
    '',
    '00:00:04.000 --> 00:00:04.010 align:start position:0%',
    'fox jumps over',
    BLANK,
    '',
    '00:00:04.010 --> 00:00:06.000 align:start position:0%',
    'fox jumps over',
    'the<00:00:04.300><c> lazy</c><00:00:04.600><c> dog</c>',
    '',
    '00:00:06.000 --> 00:00:06.010 align:start position:0%',
    BLANK,
    BLANK,
    '',
    '00:00:06.010 --> 00:00:08.000 align:start position:0%',
    BLANK,
    '[Music]',
    '',
].join('\n');

const JAPANESE_ASR = [
    'WEBVTT',
    'Kind: captions',
    'Language: ja',
    '',
    '00:00:10.000 --> 00:00:12.000 align:start position:0%',
    BLANK,
    '今日は<00:00:10.500><c>いい</c><00:00:11.000><c>天気</c>',
    '',
    '00:00:12.000 --> 00:00:12.010 align:start position:0%',
    '今日はいい天気',
    BLANK,
    '',
    '00:00:12.010 --> 00:00:14.000 align:start position:0%',
    '今日はいい天気',
    'ですね<00:00:12.500><c>散歩</c>',
    '',
].join('\n');

const MANUAL = `WEBVTT
Kind: captions
Language: en

00:00:01.000 --> 00:00:02.000
So in college,

00:00:02.000 --> 00:00:02.010
I

00:00:02.010 --> 00:00:04.000
I was a government major,
`;

const TARGET = `WEBVTT

00:00:01.000 --> 00:00:04.000
大学时，我主修政治。
`;

function texts(vtt: string): { start: number; end: number; text: string }[] {
    return parseVtt(vtt).map(({ start, end, text }) => ({ start, end, text }));
}

describe('consolidateAsrCues', () => {
    it('folds each flash into the cue that repeats it and keeps that cue’s text', () => {
        expect(
            consolidateAsrCues(parseVtt(ENGLISH_ASR)).map(
                ({ start, end, text }) => ({ start, end, text })
            )
        ).toEqual([
            { start: 1, end: 2.5, text: 'the quick brown' },
            { start: 2.5, end: 4, text: 'the quick brown\nfox jumps over' },
            { start: 4, end: 6, text: 'fox jumps over\nthe lazy dog' },
            { start: 6.01, end: 8, text: '[Music]' },
        ]);
    });

    it('compares text without spaces between the words', () => {
        expect(
            consolidateAsrCues(parseVtt(JAPANESE_ASR)).map(
                ({ start, text }) => ({ start, text })
            )
        ).toEqual([
            { start: 10, text: '今日はいい天気' },
            { start: 12, text: '今日はいい天気\nですね散歩' },
        ]);
    });

    it('keeps a flash the next cue does not repeat, or does not follow at once', () => {
        const cues = parseVtt(`WEBVTT

00:00:01.000 --> 00:00:01.010
not a prefix

00:00:01.010 --> 00:00:03.000
something else

00:00:03.000 --> 00:00:03.010
held

00:00:03.500 --> 00:00:05.000
held after a gap
`);
        expect(consolidateAsrCues(cues)).toEqual(cues);
    });
});

function snapshot(
    tracks: YouTubeAuthorizedRequest['tracks'],
    overrides: Partial<YouTubeAuthorizedRequest> = {}
): YouTubeAuthorizedRequest {
    return {
        source: 'youtube',
        tabId: 1,
        videoId: 'arj7oStGLkU',
        targetLanguage: 'zh-CN',
        originalLanguage: 'en',
        useOfficialTranslations: true,
        tracks,
        ...overrides,
    };
}

function track(
    language: string,
    asr: boolean
): YouTubeAuthorizedRequest['tracks'][number] {
    return {
        language,
        displayName: asr ? `${language} (auto-generated)` : language,
        asr,
        downloadUrl: `https://www.youtube.com/api/timedtext?v=arj7oStGLkU&lang=${language}${asr ? '&kind=asr' : ''}`,
    };
}

function serve(bodies: Record<string, string>): void {
    mockedFetch.mockImplementation((_snapshot, reference) => {
        const url = new URL(reference);
        const key = `${url.searchParams.get('lang')}${url.searchParams.has('kind') ? ':asr' : ''}`;
        return Promise.resolve({
            text: bodies[key] ?? '',
            canonicalUrl: reference,
        });
    });
}

describe('processYouTubeSubtitles', () => {
    beforeEach(() => {
        mockedFetch.mockReset();
    });

    it('prefers captions a person wrote and passes them through unchanged', async () => {
        serve({ en: MANUAL, 'en:asr': ENGLISH_ASR, 'zh-CN': TARGET });
        const result = await processYouTubeSubtitles(
            snapshot([
                track('en', true),
                track('en', false),
                track('zh-CN', false),
            ])
        );
        expect(result.vttText).toBe(MANUAL);
        expect(texts(result.vttText)).toHaveLength(3);
        expect(result.useNativeTarget).toBe(true);
        expect(result.targetVttText).toBe(TARGET);
        expect(result.selectedLanguage).toEqual({
            normalizedCode: 'en',
            displayName: 'en',
        });
    });

    it('consolidates a speech-recognition original before it is shown or translated', async () => {
        serve({ 'ja:asr': JAPANESE_ASR });
        const result = await processYouTubeSubtitles(
            snapshot([track('ja', true)], {
                originalLanguage: 'ja',
                useOfficialTranslations: false,
            })
        );
        expect(texts(result.vttText)).toEqual([
            { start: 10, end: 12, text: '今日はいい天気' },
            { start: 12, end: 14, text: '今日はいい天気\nですね散歩' },
        ]);
        expect(result.sourceLanguage).toBe('ja');
        expect(result.targetVttText).toBeNull();
    });

    it('never takes speech recognition as the show’s own translation', async () => {
        serve({ en: MANUAL, 'zh-CN:asr': TARGET });
        const result = await processYouTubeSubtitles(
            snapshot([track('en', false), track('zh-CN', true)])
        );
        expect(result.useNativeTarget).toBe(false);
        expect(mockedFetch).toHaveBeenCalledTimes(1);
    });

    it('falls back to English, then the first track, for a missing original', async () => {
        serve({ en: MANUAL, 'fr:asr': ENGLISH_ASR });
        const english = await processYouTubeSubtitles(
            snapshot([track('fr', true), track('en', false)], {
                originalLanguage: 'sv',
                useOfficialTranslations: false,
            })
        );
        expect(english.sourceLanguage).toBe('en');
        const first = await processYouTubeSubtitles(
            snapshot([track('fr', true)], {
                originalLanguage: 'sv',
                useOfficialTranslations: false,
            })
        );
        expect(first.sourceLanguage).toBe('fr');
    });

    it.each([
        ['an empty body', ''],
        ['an HTML body', '<!doctype html><html></html>'],
        ['a WebVTT header without cues', 'WEBVTT\nKind: captions\n\n'],
    ])('fails on %s, though the status was 200', async (_label, body) => {
        serve({ en: body });
        await expect(
            processYouTubeSubtitles(snapshot([track('en', false)]))
        ).rejects.toThrow();
    });

    it('keeps the original when the official translation fails', async () => {
        serve({ en: MANUAL, 'zh-CN': '' });
        const result = await processYouTubeSubtitles(
            snapshot([track('en', false), track('zh-CN', false)])
        );
        expect(result.vttText).toBe(MANUAL);
        expect(result.useNativeTarget).toBe(false);
        expect(result.targetVttText).toBeNull();
    });

    it('rethrows a caller abort', async () => {
        mockedFetch.mockRejectedValue(new FetchAbortedError());
        await expect(
            processYouTubeSubtitles(snapshot([track('en', false)]))
        ).rejects.toBeInstanceOf(FetchAbortedError);
    });
});
