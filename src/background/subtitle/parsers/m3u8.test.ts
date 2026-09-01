import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DisneyAuthorizedRequest } from '../policy';
import { fetchAuthorizedSubtitleText } from '../fetch';
import {
    EmptyPlaylistError,
    fetchAndCombineVttSegments,
    MAX_VTT_AGGREGATE_BYTES,
    parsePlaylistForVttSegmentReferences,
    processM3U8PlaylistText,
    VTTResourceLimitError,
    VttSegmentsUnavailableError,
} from './m3u8';

vi.mock('../fetch', () => ({
    fetchAuthorizedSubtitleText: vi.fn(),
}));

const mockedFetch = vi.mocked(fetchAuthorizedSubtitleText);
const snapshot = { source: 'disneyplus' } as DisneyAuthorizedRequest;
const BASE = 'https://cdn.media.dssott.com/playlists/lang.m3u8';

describe('parsePlaylistForVttSegmentReferences', () => {
    it('collects non-comment lines in order, tolerating CRLF', () => {
        expect(
            parsePlaylistForVttSegmentReferences(
                '#EXTM3U\r\n#EXTINF:6.0,\r\nseg1.vtt\r\n\r\nseg2.vtt\n#EXT-X-ENDLIST'
            )
        ).toEqual(['seg1.vtt', 'seg2.vtt']);
    });

    it('enforces line and segment-count limits', () => {
        expect(() =>
            parsePlaylistForVttSegmentReferences('x'.repeat(9000))
        ).toThrow(VTTResourceLimitError);
        const manySegments = Array.from(
            { length: 5001 },
            (_, i) => `seg${i}.vtt`
        ).join('\n');
        expect(() =>
            parsePlaylistForVttSegmentReferences(manySegments)
        ).toThrow(VTTResourceLimitError);
    });
});

describe('fetchAndCombineVttSegments', () => {
    beforeEach(() => {
        mockedFetch.mockReset();
    });

    it('combines segments in playlist order with headers stripped', async () => {
        mockedFetch.mockImplementation((_snapshot, reference) =>
            Promise.resolve({
                text: `WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n${String(reference)}`,
                canonicalUrl: String(reference),
            })
        );
        const combined = await fetchAndCombineVttSegments(
            snapshot,
            ['a.vtt', 'b.vtt'],
            BASE
        );
        expect(combined.startsWith('WEBVTT\n\n')).toBe(true);
        expect(combined.indexOf('a.vtt')).toBeLessThan(
            combined.indexOf('b.vtt')
        );
        expect(combined.match(/WEBVTT/g)).toHaveLength(1);
    });

    it('tolerates individual segment failures but not total failure', async () => {
        mockedFetch.mockImplementation((_snapshot, reference) =>
            reference === 'bad.vtt'
                ? Promise.reject(new Error('segment 404'))
                : Promise.resolve({
                      text: 'WEBVTT\n\ncue',
                      canonicalUrl: String(reference),
                  })
        );
        await expect(
            fetchAndCombineVttSegments(snapshot, ['ok.vtt', 'bad.vtt'], BASE)
        ).resolves.toContain('cue');

        mockedFetch.mockRejectedValue(new Error('all down'));
        await expect(
            fetchAndCombineVttSegments(snapshot, ['a.vtt', 'b.vtt'], BASE)
        ).rejects.toBeInstanceOf(VttSegmentsUnavailableError);
    });

    it('treats the aggregate byte cap as terminal', async () => {
        const huge = 'x'.repeat(MAX_VTT_AGGREGATE_BYTES / 2 + 1);
        mockedFetch.mockImplementation(() =>
            Promise.resolve({ text: huge, canonicalUrl: 'u' })
        );
        await expect(
            fetchAndCombineVttSegments(
                snapshot,
                ['a.vtt', 'b.vtt', 'c.vtt'],
                BASE
            )
        ).rejects.toBeInstanceOf(VTTResourceLimitError);
    });

    it('stops on caller abort', async () => {
        const controller = new AbortController();
        mockedFetch.mockImplementation(() => {
            controller.abort();
            return Promise.reject(
                Object.assign(new Error('aborted'), { name: 'AbortError' })
            );
        });
        await expect(
            fetchAndCombineVttSegments(snapshot, ['a.vtt'], BASE, {
                signal: controller.signal,
            })
        ).rejects.toMatchObject({ name: 'AbortError' });
    });
});

describe('processM3U8PlaylistText', () => {
    it('rejects playlists with no segments', async () => {
        await expect(
            processM3U8PlaylistText(snapshot, '#EXTM3U\n#EXT-X-ENDLIST', BASE)
        ).rejects.toBeInstanceOf(EmptyPlaylistError);
    });
});
