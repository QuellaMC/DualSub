// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CapturedEvent } from '../protocol';

// The recipe captures window timers at module evaluation, so fake timers
// must be installed before the module loads.
vi.useFakeTimers();
const { netflixRecipe } = await import('./netflix-recipe');

interface FakeTrack {
    trackId: string;
    bcp47: string;
    displayName: string;
    trackType?: string;
    rawTrackType?: string;
    isNoneTrack?: boolean;
    isForcedNarrative?: boolean;
    isImageBased?: boolean;
}

const OFF: FakeTrack = {
    trackId: 'off',
    bcp47: 'none',
    displayName: 'Off',
    isNoneTrack: true,
};
const EN: FakeTrack = {
    trackId: 'en-1',
    bcp47: 'en',
    displayName: 'English',
    trackType: 'PRIMARY',
    rawTrackType: 'subtitles',
};
const EN_CC: FakeTrack = {
    trackId: 'en-cc',
    bcp47: 'en',
    displayName: 'English (CC)',
    trackType: 'ASSISTIVE',
    rawTrackType: 'CLOSEDCAPTIONS',
};
const JA: FakeTrack = {
    trackId: 'ja-1',
    bcp47: 'ja',
    displayName: '日本語',
    rawTrackType: 'subtitles',
};

function url(trackId: string): string {
    return `https://sub.nflxvideo.net/${trackId}?o=1`;
}

function installNetflix(options: {
    movieId: string | number;
    tracks: FakeTrack[];
    urls?: string[];
    ready?: boolean;
}) {
    const timedText: unknown[] = (options.urls ?? []).map((trackId) => ({
        type: 'timedtext',
        trackId,
        urls: [{ url: url(trackId) }],
    }));
    let current: FakeTrack | undefined =
        options.tracks.find((track) => track.isNoneTrack) ?? options.tracks[0];
    const switches: string[] = [];
    const player = {
        getMovieId: () => options.movieId,
        getTimedTextTrackList: () =>
            options.ready === false ? [] : options.tracks,
        getTimedTextTrack: () => current,
        setTimedTextTrack: (track: FakeTrack) => {
            current = track;
            switches.push(track.trackId);
            return Promise.resolve();
        },
    };
    const playersById = {
        'session-1': { deep: { nested: { timedText } } },
    };
    (globalThis as { netflix?: unknown }).netflix = {
        appContext: {
            state: {
                playerApp: {
                    getAPI: () => ({
                        videoPlayer: {
                            getAllPlayerSessionIds: () => ['session-1'],
                            getVideoPlayerBySessionId: (id: string) =>
                                id === 'session-1' ? player : undefined,
                        },
                    }),
                    getState: () => ({
                        videoPlayer: {
                            cadmiumPlayerRepository: { playersById },
                        },
                    }),
                },
            },
        },
    };
    return {
        switches,
        current: () => current,
        addUrl(trackId: string): void {
            timedText.push({
                type: 'timedtext',
                trackId,
                urls: [{ url: url(trackId) }],
            });
        },
        setReady(): void {
            options.ready = true;
        },
    };
}

const emitted: CapturedEvent[] = [];
const emit = (event: CapturedEvent): void => {
    emitted.push(event);
};

function request(videoId: string, languages: string[]): void {
    netflixRecipe.onControl?.(
        { t: 'request-subtitle-tracks', videoId, languages },
        emit
    );
}

async function settle(ms = 0): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
    for (let i = 0; i < 10; i += 1) {
        await Promise.resolve();
    }
}

beforeEach(() => {
    emitted.length = 0;
});

afterEach(() => {
    netflixRecipe.onClose?.();
    delete (globalThis as { netflix?: unknown }).netflix;
});

describe('netflixRecipe track resolution', () => {
    it('emits the requested languages, original first, without switching when URLs exist', async () => {
        const page = installNetflix({
            movieId: 70283145,
            tracks: [OFF, EN_CC, EN, JA],
            urls: ['en-1', 'ja-1'],
        });
        request('70283145', ['en', 'ja']);
        await settle();

        expect(page.switches).toEqual([]);
        expect(emitted).toEqual([
            {
                t: 'subtitle-data',
                platform: 'netflix',
                movieId: '70283145',
                tracks: [
                    {
                        language: 'en',
                        displayName: 'English',
                        trackType: 'PRIMARY',
                        url: url('en-1'),
                    },
                    { language: 'ja', displayName: '日本語', url: url('ja-1') },
                ],
            },
        ]);
    });

    it('waits for the player session to expose its track list', async () => {
        const page = installNetflix({
            movieId: '1',
            tracks: [OFF, EN],
            urls: ['en-1'],
            ready: false,
        });
        request('1', ['en']);
        await settle(2000);
        expect(emitted).toEqual([]);

        page.setReady();
        await settle(500);
        expect(emitted).toHaveLength(1);
    });

    it('switches a track on to obtain its URL, then restores the previous track', async () => {
        const page = installNetflix({
            movieId: '1',
            tracks: [OFF, EN, JA],
            urls: ['en-1'],
        });
        request('1', ['en', 'ja']);
        await settle();
        expect(page.switches).toEqual(['ja-1']);
        expect(emitted).toEqual([]);

        page.addUrl('ja-1');
        await settle(500);
        expect(page.switches).toEqual(['ja-1', 'off']);
        expect(page.current()).toBe(OFF);
        expect(emitted[0]).toMatchObject({
            tracks: [
                { language: 'en', url: url('en-1') },
                { language: 'ja', url: url('ja-1') },
            ],
        });
    });

    it('gives up on a language whose URL never appears and emits the rest', async () => {
        const page = installNetflix({
            movieId: '1',
            tracks: [OFF, EN, JA],
            urls: ['en-1'],
        });
        request('1', ['en', 'ja']);
        await settle(10_500);
        expect(page.current()).toBe(OFF);
        expect(emitted[0]).toMatchObject({
            tracks: [{ language: 'en', url: url('en-1') }],
        });
    });

    it('falls back to English, then the first subtitle track, for a missing original language', async () => {
        installNetflix({
            movieId: '1',
            tracks: [OFF, JA, EN],
            urls: ['en-1', 'ja-1'],
        });
        request('1', ['ko']);
        await settle();
        expect(emitted[0]).toMatchObject({
            tracks: [{ language: 'en' }],
        });

        netflixRecipe.onClose?.();
        emitted.length = 0;
        installNetflix({
            movieId: '1',
            tracks: [OFF, EN_CC, JA],
            urls: ['en-cc', 'ja-1'],
        });
        request('1', ['ko']);
        await settle();
        expect(emitted[0]).toMatchObject({
            tracks: [{ language: 'en', trackType: 'ASSISTIVE' }],
        });

        netflixRecipe.onClose?.();
        emitted.length = 0;
        installNetflix({
            movieId: '1',
            tracks: [
                OFF,
                { ...JA, trackId: 'ja-cc', rawTrackType: 'CLOSEDCAPTIONS' },
                JA,
            ],
            urls: ['ja-cc', 'ja-1'],
        });
        request('1', ['ko']);
        await settle();
        expect(emitted[0]).toMatchObject({
            tracks: [{ language: 'ja', url: url('ja-1') }],
        });
    });

    it('skips off, forced, and image-based tracks and prefers subtitles over captions', async () => {
        installNetflix({
            movieId: '1',
            tracks: [
                OFF,
                { ...EN, trackId: 'en-forced', isForcedNarrative: true },
                { ...EN, trackId: 'en-image', isImageBased: true },
                EN_CC,
                EN,
            ],
            urls: ['en-forced', 'en-image', 'en-cc', 'en-1'],
        });
        request('1', ['en']);
        await settle();
        expect(emitted[0]).toMatchObject({
            tracks: [{ language: 'en', url: url('en-1') }],
        });
    });

    it('is superseded by a newer request and dropped by a cancel', async () => {
        const page = installNetflix({
            movieId: '1',
            tracks: [OFF, EN],
            urls: ['en-1'],
            ready: false,
        });
        request('1', ['en']);
        await settle(1000);
        netflixRecipe.onControl?.({ t: 'cancel-subtitle-tracks' }, emit);
        page.setReady();
        await settle(1000);
        expect(emitted).toEqual([]);

        request('1', ['en']);
        await settle();
        expect(emitted).toHaveLength(1);
    });

    it('answers nothing when no matching player appears within the wait budget', async () => {
        installNetflix({ movieId: '999', tracks: [OFF, EN], urls: ['en-1'] });
        request('1', ['en']);
        await settle(61_000);
        expect(emitted).toEqual([]);
    });

    it('answers nothing when the player API is absent', async () => {
        request('1', ['en']);
        await settle(61_000);
        expect(emitted).toEqual([]);
    });
});
